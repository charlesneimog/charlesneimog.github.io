class Markdown2Slide {
    constructor(markdown) {
        this.markdown = markdown;
        this.lastStyles = new Map();
        const self = this;
        this.marked = new marked.Marked({
            tokenizer: {
                table(src) {
                    const match = /^([^\n]*\|)[ \t]*\{([^}\n]+)\}[ \t]*(?=\n|$)/.exec(src);
                    if (!match) return false;

                    const attrs = self.parseAttrs(match[2]);
                    if (Object.keys(attrs).length === 0) return false;

                    // Remove header attributes before Marked counts the table's columns.
                    const normalized = match[1] + src.slice(match[0].length);
                    const token = marked.Tokenizer.prototype.table.call(this, normalized);
                    if (!token) return false;

                    token.raw = src.slice(0, token.raw.length + match[0].length - match[1].length);
                    token._attrs = attrs;
                    return token;
                },
            },
            extensions: [{
                name: "slideMath",
                level: "inline",
                start(src) {
                    return src.indexOf("$$");
                },
                tokenizer(src, tokens) {
                    const match = /^\$\$([^\n]+?)\$\$/.exec(src);
                    if (!match) return;

                    const before = tokens.map((token) => token.raw).join("").split("\n").pop();
                    const after = src.slice(match[0].length).split("\n")[0];
                    // Use inline math when the equation shares a line with text.
                    const inline = before.trim() !== "" || after.trim() !== "";

                    return {
                        type: "text",
                        raw: match[0],
                        text: inline ? `\\(${match[1]}\\)` : match[0],
                    };
                },
            }],
        });
        this.parser();
        this.renderer = this.createRenderer();
    }

    // ─────────────────────────────────────
    parseAttrs(str) {
        const attrs = {};
        const regex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
        let match;
        while ((match = regex.exec(str)) !== null) {
            attrs[match[1]] = match[2];
        }
        return attrs;
    }

    // ─────────────────────────────────────
    processInlineTokens(inlineTokens, parentToken = null) {
        for (let i = 0; i < inlineTokens.length; i++) {
            const token = inlineTokens[i];
            if (token.type === "text" || token.type === "escape") {
                const match = token.text.match(/\{([^}]+)\}\s*$/);
                if (match) {
                    const attrs = this.parseAttrs(match[1]);
                    if (Object.keys(attrs).length === 0) continue;
                    const textBefore = token.text.substring(0, match.index);
                    const isStandalone = textBefore.trim() === "";
                    token.text = textBefore;
                    if (token.raw) {
                        token.raw = token.text;
                    }
                    // Heading and bullet attributes belong to their whole element,
                    // even when the final words use bold, links, or other formatting.
                    if (isStandalone && i > 0 && parentToken?.type !== "heading" && parentToken?.type !== "list_item") {
                        const prev = inlineTokens[i - 1];
                        prev._attrs = {
                            ...(prev._attrs || {}),
                            ...attrs,
                        };
                    } else if (parentToken) {
                        parentToken._attrs = {
                            ...(parentToken._attrs || {}),
                            ...attrs,
                        };
                    }
                }
            }

            if (token.tokens) {
                this.processInlineTokens(token.tokens, token);
            }
            if (token.items) {
                this.processAllTokens(token.items);
            }
        }
    }

    // ─────────────────────────────────────
    processAllTokens(tokens, parentToken = null) {
        for (const token of tokens) {
            if (token.type === "list_item" || token.type === "blockquote") {
                this.processAllTokens(token.tokens, token);
            } else if (token.tokens) {
                const target = parentToken?.type === "list_item" && (token.type === "text" || token.type === "paragraph")
                    ? parentToken : token;
                this.processInlineTokens(token.tokens, target);
            }
            if (token.items) {
                this.processAllTokens(token.items);
            }
        }

        return tokens;
    }

    // Reveal uses section attributes for slides and CSS classes for fragments.
    fragmentAttrs(attrs) {
        const transition = attrs?.["data-transition"]?.trim();
        if (!transition) return attrs;

        const aliases = { fade: "fade-in", zoom: "zoom-in", slide: "fade-left", none: "instant" };
        const effects = transition.split(/\s+/).map((effect) => aliases[effect] || effect);
        const classes = new Set([...(attrs.class || "").split(/\s+/).filter(Boolean), "fragment", ...effects]);
        return { ...attrs, class: [...classes].join(" ") };
    }

    // ─────────────────────────────────────
    isHTMLAttribute(name) {
        const standardHTML = ["id", "class", "width", "height", "src", "href", "alt", "title", "target"];
        return standardHTML.includes(name) || name.startsWith("data-");
    }

    // ─────────────────────────────────────
    attrsToString(attrs) {
        if (!attrs) return "";
        const htmlAttrs = [];
        const styles = [];
        for (const [k, v] of Object.entries(attrs)) {
            if (this.isHTMLAttribute(k)) {
                htmlAttrs.push(`${k}="${v}"`);
            } else {
                styles.push(`${k}: ${v};`);
            }
        }
        if (styles.length > 0) {
            htmlAttrs.push(`style="${styles.join(" ")}"`);
        }

        return htmlAttrs.join(" ");
    }

    // ─────────────────────────────────────
    createRenderer() {
        const self = this;
        const renderer = new marked.Renderer();
        const base = new marked.Renderer();
        let listitemDepth = 0;
        function inject(html, attributes) {
            const attrs = self.attrsToString(self.fragmentAttrs(attributes));
            if (!attrs) return html;
            return html.replace(/^<([a-z0-9\-]+)/i, `<$1 ${attrs}`);
        }

        function override(type) {
            renderer[type] = function (...args) {
                const token = typeof args[0] === "object" ? args[0] : this.parser.token;
                let attrs = token?._attrs;
                if (type === "heading" && token.depth <= 2) {
                    attrs = { ...attrs };
                    delete attrs["data-transition"];
                    delete attrs["data-transition-speed"];
                }

                // List paragraphs inherit from their li, rather than the last standalone paragraph.
                if (type !== "paragraph" || listitemDepth === 0) {
                    const key = type === "heading" ? `heading:${token.depth}` : type;
                    const styles = { ...self.lastStyles.get(key) };
                    for (const [name, value] of Object.entries(attrs || {})) {
                        if (!self.isHTMLAttribute(name)) {
                            styles[name] = value;
                        }
                    }
                    self.lastStyles.set(key, styles);
                    attrs = { ...styles, ...attrs };
                }

                // Remember a parent's style before rendering its nested elements.
                if (type === "listitem") listitemDepth++;
                try {
                    return inject(base[type].apply(this, args), attrs);
                } finally {
                    if (type === "listitem") listitemDepth--;
                }
            };
        }

        override("paragraph");
        override("heading");
        override("image");
        override("link");
        override("listitem");
        override("table");
        override("strong");
        override("em");
        override("del");
        override("codespan");

        renderer.code = function (code, infostring, escaped) {
            return base.code.call(this, code, infostring, escaped);
        };

        return renderer;
    }

    // ─────────────────────────────────────
    parser() {
        const tokens = this.marked.lexer(this.markdown);

        const groups = [];

        let current = null;

        for (const token of tokens) {
            if (token.type === "heading" && (token.depth === 1 || token.depth === 2)) {
                const type = token.depth === 1 ? "title" : "newslide";

                if (current) {
                    groups.push(current);
                }

                current = {
                    type,
                    title: token.text,
                    tokens: [token],
                };
            } else {
                if (!current) {
                    current = {
                        title: null,
                        tokens: [],
                    };
                }

                current.tokens.push(token);
            }
        }

        if (current) {
            groups.push(current);
        }

        this.groups = groups;
    }

    // ─────────────────────────────────────
    render() {
        const slides = document.getElementById("slides");

        this.lastStyles.clear();
        slides.innerHTML = "";

        for (const [index, group] of this.groups.entries()) {
            const section = document.createElement("section");

            if (index === 0) {
                section.classList.add("title-slide");
            }

            const tokens = this.processAllTokens(group.tokens);

            const heading = tokens[0]?.type === "heading" && tokens[0].depth <= 2 ? tokens[0] : null;
            section.setAttribute("data-transition", heading?._attrs?.["data-transition"] || "fade");
            if (heading?._attrs?.["data-transition-speed"]) {
                section.setAttribute("data-transition-speed", heading._attrs["data-transition-speed"]);
            }

            if (group.title) {
                const title = heading?._attrs ? group.title.replace(/\s*\{[^}]+\}\s*$/, "") : group.title;
                section.setAttribute("data-title", title);
            }

            section.innerHTML = this.marked.parser(tokens, {
                renderer: this.renderer,
            });

            slides.appendChild(section);
        }

        // Apply the same shorthand to embedded HTML, including <li> and <div>.
        for (const element of slides.querySelectorAll("[data-transition]")) {
            if (element.tagName === "SECTION") continue;
            const attrs = this.fragmentAttrs({
                "data-transition": element.getAttribute("data-transition"),
                class: element.getAttribute("class") || "",
            });
            element.setAttribute("class", attrs.class);
        }

        enableSlideImageZoom(slides);
    }
}

//╭─────────────────────────────────────╮
//│             Image Zoom              │
//╰─────────────────────────────────────╯

const imageZoomRoots = new WeakSet();
let slideImageZoom = null;

function getSlideImageZoom() {
    if (slideImageZoom) return slideImageZoom;

    const dialog = document.createElement("dialog");
    dialog.id = "slide-image-zoom";
    dialog.className = "slide-image-zoom";
    dialog.setAttribute("aria-label", "Enlarged image");

    const image = document.createElement("img");
    image.className = "slide-image-zoom-image";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "slide-image-zoom-close";
    close.setAttribute("aria-label", "Close enlarged image");
    close.textContent = "×";

    const zoom = { dialog, image, source: null };
    dialog.append(image, close);
    dialog.addEventListener("click", () => dialog.close());
    dialog.addEventListener("keydown", (event) => {
        // Keep presentation shortcuts from changing slides behind the modal.
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            dialog.close();
        }
    });
    dialog.addEventListener("close", () => {
        document.body.classList.remove("slide-image-zoom-open");
        image.removeAttribute("src");
        if (zoom.source?.isConnected) zoom.source.focus({ preventScroll: true });
        zoom.source = null;
    });

    // Reveal scales its slide container; the modal belongs to the full page instead.
    document.body.appendChild(dialog);
    slideImageZoom = zoom;
    return zoom;
}

function enableSlideImageZoom(slides) {
    if (slideImageZoom?.dialog.open) slideImageZoom.dialog.close();

    const images = slides.querySelectorAll("img");
    if (images.length === 0) return;

    for (const image of images) {
        image.classList.add("slide-image-zoom-trigger");
        if (!image.hasAttribute("tabindex")) image.tabIndex = 0;
        if (!image.hasAttribute("role")) image.setAttribute("role", "button");
        if (!image.hasAttribute("aria-label")) image.setAttribute("aria-label", image.alt || "Zoom image");
        image.setAttribute("aria-haspopup", "dialog");
    }

    if (imageZoomRoots.has(slides)) return;
    imageZoomRoots.add(slides);

    function openImage(event) {
        const image = event.target.closest("img");
        if (!image || !slides.contains(image)) return;
        const src = image.currentSrc || image.src;
        if (!src) return;

        event.preventDefault();
        event.stopPropagation();
        const zoom = getSlideImageZoom();
        zoom.source = image;
        zoom.image.src = src;
        zoom.image.alt = image.alt || "";
        document.body.classList.add("slide-image-zoom-open");
        zoom.dialog.showModal();
    }

    slides.addEventListener("click", openImage);
    slides.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") openImage(event);
    });
}

//╭─────────────────────────────────────╮
//│              Helpers                │
//╰─────────────────────────────────────╯

function getOuterHeight(element) {
    const style = window.getComputedStyle(element);

    const marginTop = Number.parseFloat(style.marginTop) || 0;

    const marginBottom = Number.parseFloat(style.marginBottom) || 0;

    return element.offsetHeight + marginTop + marginBottom;
}

//╭─────────────────────────────────────╮
//│             QR Codes                │
//╰─────────────────────────────────────╯

let slideQrCodeGeneratorPromise = null;
let slideQrCodeAccessibleId = 0;

function loadSlideQrCodeGenerator() {
    if (typeof qrcode === "function") return Promise.resolve(qrcode);
    if (slideQrCodeGeneratorPromise) return slideQrCodeGeneratorPromise;

    slideQrCodeGeneratorPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/js/qrcode-generator.js";
        script.dataset.qrcodeGenerator = "true";
        script.addEventListener("load", () => {
            if (typeof qrcode === "function") resolve(qrcode);
            else reject(new Error("QR code generator did not initialize."));
        }, { once: true });
        script.addEventListener("error", () => reject(new Error("Could not load QR code generator.")), {
            once: true,
        });
        document.head.appendChild(script);
    });

    return slideQrCodeGeneratorPromise;
}

async function renderQrCodesForSlide(slide) {
    if (!slide) return;

    const qrCodeElements = Array.from(slide.querySelectorAll("qrcode"))
        .filter((element) => !element.dataset.processed && element.getAttribute("link")?.trim());
    if (qrCodeElements.length === 0) return;

    let createQrCode;
    try {
        createQrCode = await loadSlideQrCodeGenerator();
    } catch (error) {
        console.error("Could not load the slide QR code generator:", error);
        return;
    }

    for (const element of qrCodeElements) {
        try {
            const link = element.getAttribute("link").trim();
            const title = element.getAttribute("title") || "QR code";
            const alt = element.getAttribute("alt") || `QR code for ${link}`;
            const accessibleId = ++slideQrCodeAccessibleId;
            const qr = createQrCode(0, "M");
            qr.addData(link, "Byte");
            qr.make();

            element.classList.add("slide-qrcode");
            element.setAttribute("role", "img");
            element.setAttribute("aria-label", alt);
            element.innerHTML = qr.createSvgTag({
                cellSize: 4,
                margin: 16,
                scalable: true,
                title: { text: title, id: `slide-qrcode-title-${accessibleId}` },
                alt: { text: alt, id: `slide-qrcode-description-${accessibleId}` },
            });
            element.dataset.processed = "true";
        } catch (error) {
            element.dataset.processed = "error";
            console.error("Could not create a slide QR code:", error);
        }
    }
}

//╭─────────────────────────────────────╮
//│             Mermaid                 │
//╰─────────────────────────────────────╯

function normalizeMermaidBlocks(root) {
    if (!root) return;

    const codeBlocks = root.querySelectorAll(
        'pre > code.language-mermaid, pre > code.lang-mermaid, pre > code[class*="language-mermaid"]',
    );

    for (const code of codeBlocks) {
        const pre = code.parentElement;

        if (!pre) continue;

        const div = document.createElement("div");

        div.className = "mermaid";

        div.textContent = code.textContent || "";

        pre.replaceWith(div);
    }
}

function getMermaidBlocks(slide) {
    if (!slide) return [];

    return Array.from(slide.querySelectorAll(".mermaid"));
}

function cacheMermaidSource(block) {
    if (!block.dataset.mermaidSource) {
        block.dataset.mermaidSource = block.textContent || "";
    }
}

function resetMermaidBlock(block) {
    cacheMermaidSource(block);

    block.removeAttribute("data-processed");

    block.innerHTML = block.dataset.mermaidSource;
}

function fitMermaidToSlides() {
    const sections = document.querySelectorAll(".reveal .slides section");

    for (const section of sections) {
        const mermaidBlocks = Array.from(section.querySelectorAll(".mermaid"));

        if (mermaidBlocks.length === 0) continue;

        const sectionHeight = section.clientHeight;

        let nonMermaidHeight = 0;

        for (const child of section.children) {
            if (!child.classList.contains("mermaid")) {
                nonMermaidHeight += getOuterHeight(child);
            }
        }

        const availableHeight = Math.max(220, sectionHeight - nonMermaidHeight - 20);

        for (const mermaidBlock of mermaidBlocks) {
            mermaidBlock.style.width = "100%";

            mermaidBlock.style.height = `${availableHeight}px`;

            const svg = mermaidBlock.querySelector("svg");

            if (!svg) continue;

            svg.setAttribute("width", "100%");
            svg.setAttribute("height", "100%");

            svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

            svg.style.width = "100%";
            svg.style.height = "100%";
            svg.style.maxWidth = "100%";
            svg.style.maxHeight = "100%";
        }
    }
}

async function renderMermaidForSlide(slide) {
    if (!slide) return;

    normalizeMermaidBlocks(slide);

    const mermaidBlocks = getMermaidBlocks(slide);

    if (mermaidBlocks.length === 0) return;

    for (const block of mermaidBlocks) {
        resetMermaidBlock(block);
    }

    await window.mermaid.run({
        nodes: mermaidBlocks,
    });

    fitMermaidToSlides();
}

//╭─────────────────────────────────────╮
//│              Waves                  │
//╰─────────────────────────────────────╯
async function renderWaveForSlide(slide) {
    if (!slide) return;

    const waves = [...slide.querySelectorAll("wave"), ...slide.querySelectorAll("audio")];
    const isTouchDevice = window.matchMedia("(hover: none) and (pointer: coarse)").matches;

    for (const waveEl of waves) {
        if (waveEl.dataset.processed) continue;

        const src = waveEl.getAttribute("src");
        if (!src) continue;

        const possibleAudioGroup = waveEl.parentElement?.parentElement;
        if (
            possibleAudioGroup &&
            window.getComputedStyle(possibleAudioGroup).display.includes("flex") &&
            possibleAudioGroup.querySelectorAll("wave, audio").length > 1
        ) {
            possibleAudioGroup.classList.add("audio-wave-group");
        }

        const wrapper = document.createElement("div");
        wrapper.className = "audio-wave-wrapper";
        wrapper.style.display = "flex";
        wrapper.style.justifyContent = "center";
        wrapper.style.alignItems = "center";
        wrapper.style.width = "100%";
        wrapper.style.marginTop = "2rem";
        wrapper.style.marginBottom = "2rem";

        const card = document.createElement("div");
        card.className = "audio-wave-card";
        card.style.width = "70%";
        card.style.padding = "1.5rem";
        card.style.borderRadius = "14px";
        card.style.background = "rgba(255,255,255,0.92)";
        card.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)";
        card.style.border = "1px solid rgba(0,0,0,0.08)";
        card.style.backdropFilter = "blur(8px)";
        card.style.cursor = "pointer";
        card.style.transition = "transform 0.15s ease";

        const container = document.createElement("div");
        container.className = "waveform";

        card.appendChild(container);
        wrapper.appendChild(card);

        waveEl.replaceWith(wrapper);

        const ws = WaveSurfer.create({
            container,
            url: src,
            height: 120,
            waveColor: "#888",
            progressColor: "#222",
            cursorColor: "#000",
            normalize: true,
            interact: !isTouchDevice,
        });

        container.dataset.processed = "true";

        card.addEventListener("click", () => {
            if (isTouchDevice) {
                if (ws.isPlaying()) {
                    ws.pause();
                    return;
                }

                ws.setTime(0);
                ws.play();
                return;
            }

            ws.playPause();
        });

        // Hover focus
        card.addEventListener("mouseenter", () => {
            activeWaveSurfer = ws;
            card.style.transform = "scale(1.01)";
        });

        card.addEventListener("mouseleave", () => {
            if (activeWaveSurfer === ws) {
                activeWaveSurfer = null;
            }

            card.style.transform = "scale(1)";
        });
    }
}

//╭─────────────────────────────────────╮
//│          Widget Registry            │
//╰─────────────────────────────────────╯
const widgetRenderers = [renderQrCodesForSlide, renderMermaidForSlide, renderWaveForSlide];

//╭─────────────────────────────────────╮
//│          Unified Renderer           │
//╰─────────────────────────────────────╯

function createSlideEnhancer(deck) {
    let renderId = 0;
    return async function enhanceCurrentSlide() {
        const currentSlide = deck?.getCurrentSlide?.();
        if (!currentSlide) return;
        renderId += 1;
        const id = renderId;
        for (const renderer of widgetRenderers) {
            await renderer(currentSlide);
        }
        if (id !== renderId) return;
    };
}

//╭─────────────────────────────────────╮
//│              KeyBoard               │
//╰─────────────────────────────────────╯
let activeWaveSurfer = null;
window.addEventListener(
    "keydown",
    (e) => {
        if (slideImageZoom?.dialog.open) return;
        if (!activeWaveSurfer) return;
        if (e.code === "Space") {
            e.preventDefault();
            e.stopPropagation();
            activeWaveSurfer.playPause();
        }
    },
    true,
);
