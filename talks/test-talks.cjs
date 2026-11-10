const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const marked = require("../js/marked.umd.js");

const origin = "https://example.test";
const markdown = '# A presentation\n\nAn introduction.\n\n## Images\n\n![Picture](picture.png){width="50%"}\n\n## Links\n\n[Read more](notes.pdf){target="_blank"}\n';

function element(attributes = {}) {
    return {
        attributes: { ...attributes },
        children: [],
        classList: { add() {} },
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); return child; },
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name] ?? null; },
    };
}

function viewer(talk, { files = {}, mobile = false, hash = "", printPdf = false } = {}) {
    const url = new URL("/talks/slide.html", origin);
    if (talk !== null) url.searchParams.set("talk", talk);
    if (printPdf) url.searchParams.set("print-pdf", "");
    url.hash = hash;
    const requests = [];
    const sections = [];
    const status = element();
    const highlightPlugin = function RevealHighlight() {};
    const slides = { appendChild(section) { sections.push(section); }, querySelectorAll: () => [] };
    const events = {};
    const qrTargets = [];
    const qrOptions = [];
    const context = vm.createContext({
        URL, URLSearchParams, marked, console, RevealHighlight: highlightPlugin,
        qrcode() {
            const qr = {
                addData(target) { qrTargets.push(target); },
                make() {},
                createSvgTag(options) { qrOptions.push(options); return "<svg></svg>"; },
            };
            return qr;
        },
        document: {
            title: "Presentation",
            documentElement: { clientWidth: 390, clientHeight: 844 },
            addEventListener(name, callback) { events[name] = callback; },
            getElementById(id) { return id === "slides" ? slides : status; },
            createElement: () => element(),
            querySelector(selector) {
                if (selector === "#slides .title-slide") return sections[0] || null;
                return { textContent: "A presentation" };
            },
            querySelectorAll: () => [],
        },
        window: {
            location: {
                href: url.href, origin, search: url.search, hash: url.hash,
                replace(target) { context.redirect = target; },
            },
            matchMedia: () => ({ matches: mobile }),
            addEventListener() {},
            mermaid: { initialize() {} },
            MathJax: { async typesetPromise() { context.mathTypeset = true; } },
        },
        async fetch(target, options = {}) {
            const request = { pathname: new URL(target).pathname, method: options.method || "GET" };
            requests.push(request);
            const file = files[request.pathname];
            const status = typeof file === "number" ? file : file === undefined ? 404 : 200;
            return { ok: status === 200, status, text: async () => file };
        },
        Reveal: class {
            constructor(options) { context.deckOptions = options; }
            async initialize() { context.deckInitialized = true; }
            on(name, handler) { events[name] = handler; }
        },
    });
    for (const file of ["../js/markdown2slide.js", "../js/talk-slide.js"]) {
        vm.runInContext(readFileSync(path.join(__dirname, file), "utf8"), context, { filename: file });
    }
    return { context, requests, sections, status, events, qrTargets, qrOptions };
}

test("folder links prefer HTML and retain the selected slide", async () => {
    const state = viewer("html-talk", {
        files: { "/talks/html-talk/index.html": "<html></html>" }, hash: "#/3",
    });
    await state.context.renderTalk();
    assert.equal(state.context.redirect, `${origin}/talks/html-talk/index.html#/3`);
    assert.deepEqual(state.requests, [{ pathname: "/talks/html-talk/index.html", method: "HEAD" }]);
    assert.equal(state.sections.length, 0);
});

test("Markdown-only folders render slides without an HTML wrapper", async () => {
    const state = viewer("markdown-talk/", { files: { "/talks/markdown-talk/slide.md": markdown } });
    await state.context.renderTalk();
    assert.equal(state.context.redirect, undefined);
    assert.equal(state.sections.length, 3);
    assert.match(state.sections[0].innerHTML, /<h1>A presentation<\/h1>/);
    assert.match(state.sections[1].innerHTML, /width="50%"/);
    assert.match(state.sections[2].innerHTML, /<a target="_blank" href="notes.pdf"/);
    assert.equal(state.status.hidden, true);
    assert.equal(state.context.deckInitialized, true);
    assert.equal(state.context.mathTypeset, true);
    assert.equal(state.context.deckOptions.hash, true);
    assert.equal(state.context.deckOptions.plugins.length, 1);
    assert.equal(state.context.deckOptions.plugins[0], state.context.RevealHighlight);
    assert.deepEqual(state.requests.map((request) => request.method), ["HEAD", "GET"]);
});

test("title slides link and encode Reveal's PDF view", async () => {
    const state = viewer("markdown-talk/slide.md", {
        files: { "/talks/markdown-talk/slide.md": markdown },
        hash: "#/2",
    });
    await state.context.renderTalk();

    const link = state.sections[0].children.at(-1);
    const pdfUrl = `${origin}/talks/slide.html?talk=markdown-talk%2Fslide.md&print-pdf`;
    assert.equal(link.className, "pdf-share-link");
    assert.equal(link.href, pdfUrl);
    assert.equal(link.target, "_blank");
    assert.equal(link.children[1].textContent, "PDF");
    assert.deepEqual(state.qrTargets, [pdfUrl]);
});

test("Reveal's PDF view omits its own PDF link and QR code", async () => {
    const state = viewer("markdown-talk/slide.md", {
        files: { "/talks/markdown-talk/slide.md": markdown },
        printPdf: true,
    });
    await state.context.renderTalk();

    assert.equal(state.sections[0].children.length, 0);
    assert.deepEqual(state.qrTargets, []);
});

test("custom qrcode elements render accessible SVG images once", async () => {
    const state = viewer(null);
    const qrElement = element({
        link: "https://example.test/handout",
        title: "Handout",
        alt: "QR code for the handout",
    });
    qrElement.dataset = {};
    const slide = {
        querySelectorAll(selector) {
            assert.equal(selector, "qrcode");
            return [qrElement];
        },
    };

    await state.context.renderQrCodesForSlide(slide);
    await state.context.renderQrCodesForSlide(slide);

    assert.deepEqual(state.qrTargets, ["https://example.test/handout"]);
    assert.equal(qrElement.dataset.processed, "true");
    assert.equal(qrElement.getAttribute("role"), "img");
    assert.equal(qrElement.getAttribute("aria-label"), "QR code for the handout");
    assert.equal(qrElement.innerHTML, "<svg></svg>");
    assert.equal(state.qrOptions[0].title.text, "Handout");
    assert.equal(state.qrOptions[0].alt.text, "QR code for the handout");
    assert.match(state.qrOptions[0].title.id, /^slide-qrcode-title-\d+$/);
    assert.match(state.qrOptions[0].alt.id, /^slide-qrcode-description-\d+$/);
});

test("slide heading transitions apply to their sections and stay local", async () => {
    const source = `# Title {data-transition="none"}

## SLIDE 2 — **Presentation Map** {data-transition="zoom" data-transition-speed="fast" font-size="50px"}

## Next slide

## Separate entry and exit {data-transition="slide-in fade-out"}
`;
    const state = viewer("transitions/slide.md", { files: { "/talks/transitions/slide.md": source } });
    await state.context.renderTalk();
    assert.deepEqual(state.sections.map((section) => section.getAttribute("data-transition")),
        ["none", "zoom", "fade", "slide-in fade-out"]);
    assert.equal(state.sections[1].getAttribute("data-transition-speed"), "fast");
    assert.equal(state.sections[2].getAttribute("data-transition-speed"), null);
    assert.equal(state.sections[1].getAttribute("data-title"), "SLIDE 2 — **Presentation Map**");
    assert.match(state.sections[1].innerHTML, /<h2 style="font-size: 50px;">SLIDE 2 — <strong>Presentation Map<\/strong>/);
    for (const section of state.sections) {
        assert.doesNotMatch(section.innerHTML, /data-transition|class="fragment|\{data-transition=/);
    }
});

test("text, inline formatting, and smaller headings use fragment transitions", async () => {
    const source = `## A slide

### SLIDE 2 — Presentation Map {data-transition="zoom"}

Plain text {data-transition="slide" class="accent" data-fragment-index="2"}

**Bold text** {data-transition="fade-up" class="fragment accent" font-size="32px"}

Normal **inline text** {data-transition="fade"}

Instant text {data-transition="none"}

Unstyled text
`;
    const state = viewer("transitions/slide.md", { files: { "/talks/transitions/slide.md": source } });
    await state.context.renderTalk();
    const html = state.sections[0].innerHTML;
    assert.equal(state.sections.length, 1);
    assert.equal(state.sections[0].getAttribute("data-transition"), "fade");
    assert.match(html, /<h3 data-transition="zoom" class="fragment zoom-in">SLIDE 2 — Presentation Map/);
    assert.match(html, /<p data-transition="slide" class="accent fragment fade-left" data-fragment-index="2">Plain text/);
    assert.match(html, /<strong data-transition="fade-up" class="fragment accent fade-up" style="font-size: 32px;">Bold text/);
    assert.match(html, /<strong [^>]*data-transition="fade"[^>]*class="fragment fade-in"[^>]*>inline text/);
    assert.match(html, /<p data-transition="none" class="fragment instant">Instant text/);
    assert.match(html, /<p>Unstyled text<\/p>/);
    assert.doesNotMatch(html, /\{data-transition=/);
});

test("bullet transitions animate the li, including formatted, nested, and loose items", async () => {
    const source = `## Bullets

- Plain {data-transition="fade"}
- **Formatted** {data-transition="zoom" class="accent" data-fragment-index="1" font-size="30px"}
  - [Nested](notes.pdf) {data-transition="fade-up"}
- Next item

## Loose bullets

1. First **item** {data-transition="fade-right"}

   Another paragraph in the same item.

2. Second item
`;
    const state = viewer("transitions/slide.md", { files: { "/talks/transitions/slide.md": source } });
    await state.context.renderTalk();
    const html = state.sections.map((section) => section.innerHTML).join("");
    assert.match(html, /<li data-transition="fade" class="fragment fade-in">Plain/);
    assert.match(html, /<li [^>]*data-transition="zoom"[^>]*class="accent fragment zoom-in"[^>]*data-fragment-index="1"[^>]*><strong>Formatted<\/strong>/);
    assert.match(html, /<li [^>]*data-transition="fade-up"[^>]*class="fragment fade-up"[^>]*><a href="notes.pdf">Nested<\/a>/);
    assert.match(html, /<li style="font-size: 30px;">Next item<\/li>/);
    assert.match(html, /<li [^>]*data-transition="fade-right"[^>]*class="fragment fade-right"[^>]*><p>First <strong>item<\/strong>/);
    assert.match(html, /Another paragraph in the same item\./);
    assert.equal((html.match(/class="[^"]*fragment/g) || []).length, 4);
    assert.doesNotMatch(html, /<(strong|a|p) [^>]*data-transition|\{data-transition=/);
});

test("fragment transitions remain stable on rerender without affecting later elements", () => {
    const state = viewer(null);
    state.context.source = '## Zoom {data-transition="zoom"}\n\n- **One** {data-transition="zoom" class="fragment"}\n- Two\n\nText {data-transition="fade-up"}\n\nMore text\n';
    vm.runInContext("const transitionSlides = new Markdown2Slide(source); transitionSlides.render();", state.context);
    const firstRender = state.sections.map((section) => section.innerHTML);
    state.sections.length = 0;
    vm.runInContext("transitionSlides.render();", state.context);
    assert.deepEqual(state.sections.map((section) => section.innerHTML), firstRender);
    assert.match(firstRender[0], /<li>Two<\/li>/);
    assert.match(firstRender[0], /<p>More text<\/p>/);
    assert.equal((firstRender[0].match(/class="fragment zoom-in"/g) || []).length, 1);
});

test("heading styles carry across slides by heading level and use the latest values", async () => {
    const source = '# Title {font-size="50px"}\n\n## Before styling\n\n## Styled {font-size="60px" color="teal" id="styled"}\n\n### Subheading {font-size="40px"}\n\n## Next heading\n\n### Next subheading\n\n# Another title\n\n## Smaller {font-size="55px"}\n\n## Recolored {color="red"}\n\n## Final heading\n';
    const state = viewer("styles/slide.md", { files: { "/talks/styles/slide.md": source } });
    await state.context.renderTalk();
    const html = state.sections.map((section) => section.innerHTML).join("");
    assert.match(html, /<h2>Before styling<\/h2>/);
    assert.match(html, /<h2 style="font-size: 60px; color: teal;">Next heading<\/h2>/);
    assert.match(html, /<h3 style="font-size: 40px;">Next subheading<\/h3>/);
    assert.match(html, /<h1 style="font-size: 50px;">Another title<\/h1>/);
    assert.match(html, /<h2 style="font-size: 55px; color: teal;">Smaller <\/h2>/);
    assert.match(html, /<h2 style="font-size: 55px; color: red;">Final heading<\/h2>/);
    assert.equal((html.match(/id="styled"/g) || []).length, 1);
});

test("bullet styles carry across lists without inheriting standalone paragraph sizes", async () => {
    const source = '## First slide {font-size="60px"}\n\nIntroduction {font-size="20px"}\n\n- Before styling\n- Based on research; {font-size="30px" color="teal"}\n- Tracks **extended techniques**;\n\n- Smaller bullet {font-size="24px"}\n\n## Next slide\n\n- Another bullet\n\nA paragraph\n';
    const state = viewer("styles/slide.md", { files: { "/talks/styles/slide.md": source } });
    await state.context.renderTalk();
    const html = state.sections.map((section) => section.innerHTML).join("");
    assert.match(html, /<li><p>Before styling<\/p>/);
    assert.match(html, /<li style="font-size: 30px; color: teal;"><p>Tracks <strong>extended techniques<\/strong>;<\/p>/);
    assert.match(html, /<li style="font-size: 24px; color: teal;">Another bullet<\/li>/);
    assert.match(html, /<p style="font-size: 20px;">A paragraph<\/p>/);
});

test("nested bullets remember styles in document order", async () => {
    const source = '## Nested list\n\n- Parent {font-size="30px"}\n  - Nested {font-size="20px"}\n  - Next nested\n- Next parent\n';
    const state = viewer("styles/slide.md", { files: { "/talks/styles/slide.md": source } });
    await state.context.renderTalk();
    const html = state.sections[0].innerHTML;
    assert.match(html, /<li style="font-size: 30px;">Parent/);
    assert.match(html, /<li style="font-size: 20px;">Nested/);
    assert.match(html, /<li style="font-size: 20px;">Next nested<\/li>/);
    assert.match(html, /<li style="font-size: 20px;">Next parent<\/li>/);
    assert.doesNotMatch(html, /\{font-size=/);
});

test("links and images retain CSS styles while HTML attributes stay local", async () => {
    const source = '## Media\n\n[First](first.pdf){color="red" id="first-link" target="_blank" data-label="first"}\n\n[Second](second.pdf)\n\n![First](first.png){opacity="0.5" width="50%"}\n\n![Second](second.png)\n';
    const state = viewer("styles/slide.md", { files: { "/talks/styles/slide.md": source } });
    await state.context.renderTalk();
    const html = state.sections[0].innerHTML;
    assert.match(html, /<a style="color: red;" href="second.pdf">Second<\/a>/);
    assert.match(html, /<img style="opacity: 0.5;" src="second.png" alt="Second">/);
    for (const attribute of ['id="first-link"', 'target="_blank"', 'data-label="first"', 'width="50%"']) {
        assert.equal(html.split(attribute).length - 1, 1);
    }
});

test("bold text renders trailing attributes and remembers its latest styles", async () => {
    const source = `## Bold text

Introduction {font-size="20px"}

**Before styling.**

**These limitations can become pedagogical and expressive materials.** {font-size="40px"}

## Next slide

**Next bold paragraph.**

Normal text **Smaller inline text** {font-size="32px"}

**Final bold paragraph.**
`;
    const state = viewer("styles/slide.md", { files: { "/talks/styles/slide.md": source } });
    await state.context.renderTalk();
    const html = state.sections.map((section) => section.innerHTML).join("");
    assert.match(html, /<strong>Before styling\.<\/strong>/);
    assert.match(html, /<strong style="font-size: 40px;">These limitations can become pedagogical and expressive materials\.<\/strong>/);
    assert.match(html, /<strong style="font-size: 40px;">Next bold paragraph\.<\/strong>/);
    assert.match(html, /<p style="font-size: 20px;">Normal text <strong style="font-size: 32px;">Smaller inline text<\/strong>/);
    assert.match(html, /<strong style="font-size: 32px;">Final bold paragraph\.<\/strong>/);
    assert.doesNotMatch(html, /\{font-size=/);
});

test("italics, strikethrough, and inline code render and retain their own styles", async () => {
    const source = '## Inline formatting\n\n*Italic* {font-size="24px"}\n\n*Next italic*\n\n~~Deleted~~ {font-size="22px"}\n\n~~Next deleted~~\n\n`Code` {font-size="18px"}\n\n`Next code`\n';
    const state = viewer("styles/slide.md", { files: { "/talks/styles/slide.md": source } });
    await state.context.renderTalk();
    const html = state.sections[0].innerHTML;
    assert.match(html, /<em style="font-size: 24px;">Italic<\/em>/);
    assert.match(html, /<em style="font-size: 24px;">Next italic<\/em>/);
    assert.match(html, /<del style="font-size: 22px;">Deleted<\/del>/);
    assert.match(html, /<del style="font-size: 22px;">Next deleted<\/del>/);
    assert.match(html, /<code style="font-size: 18px;">Code<\/code>/);
    assert.match(html, /<code style="font-size: 18px;">Next code<\/code>/);
    assert.doesNotMatch(html, /\{font-size=/);
});

test("attributes after a table header style the entire table without adding a column", async () => {
    const source = `## Comparison

| Criterion | Random Forest / CatBoost | Deep Learning | {font-size="30px"}
|---|---|---|
| Training data | Works well with small datasets | Often requires more data |
| Training cost | Low | Medium–high |
| Inference cost | Generally low | Architecture-dependent |
| Accuracy | Good with relevant features | Higher potential with large datasets |
| Feature extraction | Handcrafted descriptors | Learns features automatically |
| Interpretability | Higher | Lower |
| Temporal patterns | Requires explicit features | Can learn temporal patterns |
| Smartphones | Lightweight deployment | Requires optimization |

## After table

Text after table.
`;
    const state = viewer("styles/slide.md", { files: { "/talks/styles/slide.md": source } });
    await state.context.renderTalk();
    const html = state.sections[0].innerHTML;
    assert.match(html, /<table style="font-size: 30px;">/);
    assert.equal((html.match(/<th>/g) || []).length, 3);
    assert.equal((html.match(/<td>/g) || []).length, 24);
    assert.match(html, /<th>Deep Learning<\/th>/);
    assert.match(html, /<td>Requires optimization<\/td>/);
    assert.doesNotMatch(html, /\{font-size=/);
    assert.equal(state.sections.length, 2);
    assert.match(state.sections[1].innerHTML, /<h2>After table<\/h2>/);
    assert.match(state.sections[1].innerHTML, /<p>Text after table\.<\/p>/);
});

test("table styles carry across slides and later attributes update their defaults", async () => {
    const table = (attrs = "") => `| Criterion | Value | ${attrs}\n|:---|---:|\n| Cost | Low |\n`;
    const source = [
        `## Plain\n\n${table()}`,
        `## Styled\n\n${table('{font-size="30px" color="teal" id="comparison"}')}`,
        `## Inherited\n\n${table()}`,
        `## Smaller\n\n${table('{font-size="24px"}')}`,
        `## Final\n\n${table()}`,
    ].join("\n");
    const state = viewer("styles/slide.md", { files: { "/talks/styles/slide.md": source } });
    await state.context.renderTalk();
    assert.match(state.sections[0].innerHTML, /<table>/);
    assert.match(state.sections[1].innerHTML, /<table id="comparison" style="font-size: 30px; color: teal;">/);
    assert.match(state.sections[2].innerHTML, /<table style="font-size: 30px; color: teal;">/);
    assert.match(state.sections[3].innerHTML, /<table style="font-size: 24px; color: teal;">/);
    assert.match(state.sections[4].innerHTML, /<table style="font-size: 24px; color: teal;">/);
    const html = state.sections.map((section) => section.innerHTML).join("");
    assert.equal((html.match(/id="comparison"/g) || []).length, 1);
    assert.equal((html.match(/align="left"/g) || []).length, 10);
    assert.equal((html.match(/align="right"/g) || []).length, 10);
});

test("style memory resets on rerender and for separate presentations", () => {
    const state = viewer(null);
    state.context.source = '## Before styling\n\n- Before styling\n\n| Plain | Table |\n|---|---|\n| A | B |\n\n## Styled {font-size="60px"}\n\n- Styled {font-size="30px"}\n\n| Styled | Table | {font-size="30px"}\n|---|---|\n| A | B |\n\n## Smaller {font-size="55px"}\n\n- Smaller {font-size="24px"}\n';
    vm.runInContext("const styledSlides = new Markdown2Slide(source); styledSlides.render();", state.context);
    const firstRender = state.sections.map((section) => section.innerHTML);
    state.sections.length = 0;
    vm.runInContext("styledSlides.render();", state.context);
    assert.deepEqual(state.sections.map((section) => section.innerHTML), firstRender);
    state.sections.length = 0;
    state.context.source = '## Separate presentation\n\n- Plain bullet\n\n| Plain | Table |\n|---|---|\n| A | B |\n';
    vm.runInContext("new Markdown2Slide(source).render();", state.context);
    assert.match(state.sections[0].innerHTML, /<h2>Separate presentation<\/h2>/);
    assert.match(state.sections[0].innerHTML, /<li>Plain bullet<\/li>/);
    assert.match(state.sections[0].innerHTML, /<table>/);
});

test("explicit slide.md skips HTML even when both formats exist", async () => {
    const state = viewer("both/slide.md", { files: {
        "/talks/both/index.html": "<html></html>",
        "/talks/both/slide.md": markdown,
    } });
    await state.context.renderTalk();
    assert.equal(state.sections.length, 3);
    assert.deepEqual(state.requests, [{ pathname: "/talks/both/slide.md", method: "GET" }]);
});

test("encrypted Markdown opens the protected HTML and preserves the selected slide", async () => {
    const encrypted = JSON.stringify({
        format: "staticrypt-markdown", version: 1,
        staticryptEncryptedMsgUniqueVariableName: "encrypted-presentation",
        staticryptSaltUniqueVariableName: "salt",
    });
    const state = viewer("private/slide.md", { hash: "#/4", files: { "/talks/private/slide.md": encrypted } });
    await state.context.renderTalk();
    assert.equal(state.context.redirect, `${origin}/talks/private/index.html#/4`);
    assert.equal(state.sections.length, 0);
    assert.equal(state.context.deckInitialized, undefined);
});

test("decrypted embedded Markdown renders without fetching the protected source again", async () => {
    const state = viewer(null);
    const embedded = element({ type: "application/json" });
    embedded.textContent = JSON.stringify(markdown);
    const getElementById = state.context.document.getElementById;
    state.context.document.getElementById = (id) => id === "presentation-markdown" ? embedded : getElementById(id);
    state.context.window.location.href = `${origin}/talks/private/index.html`;
    await state.context.renderTalk();
    assert.equal(state.sections.length, 3);
    assert.equal(state.requests.length, 0);
    assert.equal(state.context.deckInitialized, true);
});

test("explicit index.html falls back to its sibling slide.md when missing", async () => {
    const state = viewer("example/index.html", { files: { "/talks/example/slide.md": markdown } });
    await state.context.renderTalk();
    assert.equal(state.sections.length, 3);
    assert.equal(state.requests[1].pathname, "/talks/example/slide.md");
});

test("mobile slides use the viewport dimensions", async () => {
    const state = viewer("example/slide.md", { mobile: true, files: { "/talks/example/slide.md": markdown } });
    await state.context.renderTalk();
    assert.equal(state.context.deckOptions.width, 390);
    assert.equal(state.context.deckOptions.height, 844);
    assert.equal(state.context.deckOptions.margin, 0);
});

test("relative media resolve from the presentation folder", () => {
    const { context } = viewer("example/slide.md");
    const nodes = [
        element({ src: "image.png" }),
        element({ href: "../notes.pdf" }),
        element({ src: "/images/shared.png" }),
        element({ poster: "poster.jpg", "data-src": "video.mp4" }),
        element({ src: "https://media.test/audio.mp3" }),
        element({ href: "#details" }),
        element({ src: "data:image/svg+xml;base64,AAAA" }),
    ];
    context.document.querySelectorAll = () => nodes;
    context.rebaseTalkLinks(new URL(`${origin}/talks/example/slide.md`));
    assert.equal(nodes[0].attributes.src, `${origin}/talks/example/image.png`);
    assert.equal(nodes[1].attributes.href, `${origin}/talks/notes.pdf`);
    assert.equal(nodes[2].attributes.src, `${origin}/images/shared.png`);
    assert.equal(nodes[3].attributes.poster, `${origin}/talks/example/poster.jpg`);
    assert.equal(nodes[3].attributes["data-src"], `${origin}/talks/example/video.mp4`);
    assert.equal(nodes[4].attributes.src, "https://media.test/audio.mp3");
    assert.equal(nodes[5].attributes.href, "#details");
    assert.equal(nodes[6].attributes.src, "data:image/svg+xml;base64,AAAA");
});

test("missing presentations produce a visible error", async () => {
    const state = viewer("missing");
    state.context.console = { error() {} };
    state.events.DOMContentLoaded();
    await new Promise(setImmediate);
    assert.equal(state.status.hidden, false);
    assert.equal(state.status.attributes.role, "alert");
    assert.match(state.status.textContent, /needs an index.html or slide.md/);
});

test("HTML server errors do not silently fall back to Markdown", async () => {
    const state = viewer("error", { files: { "/talks/error/index.html": 500 } });
    await assert.rejects(state.context.renderTalk(), /HTTP 500/);
    assert.equal(state.requests.length, 1);
});

test("missing, external, and out-of-directory paths are rejected", () => {
    for (const source of [null, "https://external.test/slide.md", "../classes/", "/talks-other/example", "../../slide.md"]) {
        assert.throws(() => viewer(source).context.getTalkSource());
    }
    const state = viewer("Percepção II/slide.md");
    assert.equal(decodeURI(state.context.getTalkSource().pathname), "/talks/Percepção II/slide.md");
});

test("cards route folders and Markdown to the viewer and preserve direct HTML links", () => {
    const { context } = viewer(null);
    context.window.location.href = `${origin}/talks/`;
    vm.runInContext(readFileSync(path.join(__dirname, "../js/talks.js"), "utf8"), context);
    for (const link of ["./example", "./example/", "./example/slide.md"]) {
        const result = new URL(context.getTalkLink(link));
        assert.equal(result.pathname, "/talks/slide.html");
        assert.equal(result.searchParams.get("talk"), new URL(link, context.window.location.href).pathname);
    }
    assert.equal(context.getTalkLink("./example/index.html"), `${origin}/talks/example/index.html`);
    assert.equal(context.getTalkLink("https://external.test/deck"), "https://external.test/deck");
    assert.equal(new URL(context.getTalkLink("./example/#/2")).hash, "#/2");
    assert.equal(context.getTalkLink(null), null);
});
