document.addEventListener("DOMContentLoaded", () => {
    renderTalk().catch((error) => {
        console.error("Presentation render failed:", error);
        const status = document.getElementById("presentation-status");
        status.hidden = false;
        status.setAttribute("role", "alert");
        status.textContent = `Unable to load this presentation. ${error.message}`;
    });
});

function getTalkSource() {
    const path = new URLSearchParams(window.location.search).get("talk");
    if (!path) throw new Error("Choose a presentation from the talks page.");

    const talksRoot = new URL("./", window.location.href);
    const source = new URL(path, talksRoot);
    if (source.origin !== talksRoot.origin || !source.pathname.startsWith(talksRoot.pathname)) {
        throw new Error("Invalid presentation path.");
    }

    source.search = "";
    source.hash = "";
    if (!/(?:\/index\.html|\/slide\.md)$/i.test(source.pathname)) {
        source.pathname = source.pathname.replace(/\/+$/, "") + "/";
    }
    return source;
}

async function renderTalk() {
    const embedded = document.getElementById("presentation-markdown");
    let markdownUrl;
    let markdown;

    if (embedded?.getAttribute("type") === "application/json") {
        markdownUrl = new URL("slide.md", window.location.href);
        markdown = JSON.parse(embedded.textContent);
    } else {
        const source = getTalkSource();
        const isMarkdown = /\/slide\.md$/i.test(source.pathname);

        if (!isMarkdown) {
            const htmlUrl = /\/index\.html$/i.test(source.pathname) ? source : new URL("index.html", source);
            const response = await fetch(htmlUrl, { method: "HEAD", cache: "no-store" });
            if (response.ok) {
                htmlUrl.hash = window.location.hash;
                window.location.replace(htmlUrl.href);
                return;
            }
            if (response.status !== 404) throw new Error(`Could not load index.html (HTTP ${response.status}).`);
        }

        markdownUrl = isMarkdown ? source : new URL("slide.md", source);
        const response = await fetch(markdownUrl, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(response.status === 404
                ? "This folder needs an index.html or slide.md file."
                : `Could not load slide.md (HTTP ${response.status}).`);
        }
        markdown = await response.text();
        if (isEncryptedTalkMarkdown(markdown)) {
            const htmlUrl = new URL("index.html", markdownUrl);
            htmlUrl.hash = window.location.hash;
            window.location.replace(htmlUrl.href);
            return;
        }
    }

    window.mermaid.initialize({ startOnLoad: false, flowchart: { useMaxWidth: true } });
    new Markdown2Slide(markdown).render();
    rebaseTalkLinks(markdownUrl);
    await addPdfShareLink();

    const title = document.querySelector("#slides h1, #slides h2")?.textContent;
    if (title) document.title = `${title} | Charles K. Neimog`;

    const deck = new Reveal({
        center: false,
        hash: true,
        plugins: typeof RevealHighlight === "undefined" ? [] : [RevealHighlight],
        scrollActivationWidth: null,
        slideNumber: true,
        ...getTalkDimensions(),
    });
    await deck.initialize();
    document.getElementById("presentation-status").hidden = true;

    const enhanceCurrentSlide = createSlideEnhancer(deck);
    deck.on("slidechanged", enhanceCurrentSlide);
    await enhanceCurrentSlide();
    await window.MathJax?.typesetPromise?.();

    const updateDimensions = () => deck.configure(getTalkDimensions());
    window.addEventListener("resize", updateDimensions);
    window.addEventListener("orientationchange", updateDimensions);
}

let qrCodeGeneratorPromise = null;

function getTalkPdfUrl() {
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.delete("print-pdf");
    return `${url.href}${url.search ? "&" : "?"}print-pdf`;
}

function loadQrCodeGenerator() {
    if (typeof qrcode === "function") return Promise.resolve(qrcode);
    if (qrCodeGeneratorPromise) return qrCodeGeneratorPromise;

    qrCodeGeneratorPromise = new Promise((resolve, reject) => {
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

    return qrCodeGeneratorPromise;
}

async function addPdfShareLink() {
    if (new URLSearchParams(window.location.search).has("print-pdf")) return;

    const titleSlide = document.querySelector("#slides .title-slide");
    if (!titleSlide || titleSlide.querySelector?.(".pdf-share-link")) return;

    try {
        const createQrCode = await loadQrCodeGenerator();
        const pdfUrl = getTalkPdfUrl();
        const qr = createQrCode(0, "M");
        qr.addData(pdfUrl, "Byte");
        qr.make();

        const link = document.createElement("a");
        link.className = "pdf-share-link";
        link.href = pdfUrl;
        link.target = "_blank";
        link.rel = "noopener";
        link.setAttribute("aria-label", "Abrir versão para PDF");
        link.title = "Abrir versão para PDF";

        const qrContainer = document.createElement("span");
        qrContainer.className = "pdf-share-qrcode";
        qrContainer.innerHTML = qr.createSvgTag({
            cellSize: 4,
            margin: 16,
            scalable: true,
            title: "PDF",
            alt: "QR code para abrir a versão em PDF",
        });

        const label = document.createElement("span");
        label.className = "pdf-share-label";
        label.textContent = "PDF";

        link.append(qrContainer, label);
        titleSlide.appendChild(link);
    } catch (error) {
        console.error("Could not create the PDF QR code:", error);
    }
}

function isEncryptedTalkMarkdown(source) {
    try {
        const payload = JSON.parse(source);
        return payload?.format === "staticrypt-markdown" && payload.version === 1 &&
            typeof payload.staticryptEncryptedMsgUniqueVariableName === "string" &&
            typeof payload.staticryptSaltUniqueVariableName === "string";
    } catch {
        return false;
    }
}

function getTalkDimensions() {
    if (window.matchMedia("(max-width: 900px)").matches) {
        return {
            width: document.documentElement.clientWidth,
            height: document.documentElement.clientHeight,
            margin: 0,
        };
    }
    const height = 700;
    const aspectRatio = document.documentElement.clientWidth / document.documentElement.clientHeight;
    return { width: Math.max(960, Math.round(height * aspectRatio)), height, margin: 0.02 };
}

function rebaseTalkLinks(markdownUrl) {
    document.querySelectorAll("#slides [src], #slides [href], #slides [poster], #slides [data-src]").forEach((element) => {
        for (const attribute of ["src", "href", "poster", "data-src"]) {
            const value = element.getAttribute(attribute);
            if (!value || value.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(value)) continue;
            element.setAttribute(attribute, new URL(value, markdownUrl).href);
        }
    });
}
