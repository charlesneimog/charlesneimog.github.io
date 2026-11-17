const PASSWORD_SESSION_PREFIX = "classCourseUnlocked:";
const COURSE_KEY_SESSION_PREFIX = "classCourseKey:";
const COURSE_PAGE_VERSION = "2";
const SLIDE_MEDIA_QUERY = "(max-width: 900px)";

document.addEventListener("DOMContentLoaded", () => {
    const mode = document.documentElement.dataset?.slideMode ||
        (new URL(window.location.href).pathname.includes("/classes/") ? "lesson" : "talk");
    const render = mode === "lesson" ? renderLessonSlide : renderTalk;

    render().catch((error) => showSlideError(mode, error));
});

function showSlideError(mode, error) {
    console.error(`${mode === "lesson" ? "Lesson" : "Presentation"} render failed:`, error);
    const status = document.getElementById("presentation-status");
    if (status) {
        status.hidden = false;
        status.setAttribute("role", "alert");
        status.textContent = mode === "lesson"
            ? `Não foi possível carregar esta aula. ${error.message}`
            : `Unable to load this presentation. ${error.message}`;
        return;
    }

    const slides = document.getElementById("slides");
    if (slides) {
        slides.innerHTML = "<section><h1>Erro</h1><p>Não foi possível carregar esta aula.</p></section>";
    }
}

async function renderSlideDeck({ markdown, markdownUrl, getDimensions, beforeInitialize }) {
    initializeSlideMermaid();
    new Markdown2Slide(markdown).render();
    rebaseSlideLinks(markdownUrl);
    await beforeInitialize?.();

    const deck = new Reveal({
        center: false,
        hash: true,
        plugins: typeof RevealHighlight === "undefined" ? [] : [RevealHighlight],
        scrollActivationWidth: null,
        slideNumber: true,
        ...getDimensions(),
    });
    await deck.initialize();

    const enhanceCurrentSlide = createSlideEnhancer(deck);
    deck.on("slidechanged", enhanceCurrentSlide);
    await enhanceCurrentSlide();
    await window.MathJax?.typesetPromise?.();

    const updateDimensions = () => deck.configure(getDimensions());
    window.addEventListener("resize", updateDimensions);
    window.addEventListener("orientationchange", updateDimensions);
    return deck;
}

function initializeSlideMermaid() {
    if (!window.mermaid) return;
    window.mermaid.initialize({
        startOnLoad: false,
        flowchart: { useMaxWidth: true, width: "100%" },
    });
}

function rebaseSlideLinks(markdownUrl) {
    const baseUrl = new URL(markdownUrl, window.location.href);
    document.querySelectorAll("#slides [src], #slides [href], #slides [poster], #slides [data-src]")
        .forEach((element) => {
            for (const attribute of ["src", "href", "poster", "data-src"]) {
                const value = element.getAttribute(attribute);
                if (!value || value.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(value)) continue;
                element.setAttribute(attribute, new URL(value, baseUrl).href);
            }
        });
}

function getResponsiveSlideDimensions(desktopDimensions) {
    if (!window.matchMedia(SLIDE_MEDIA_QUERY).matches) return desktopDimensions();
    return {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
        margin: 0,
    };
}

function getTalkDimensions() {
    return getResponsiveSlideDimensions(() => {
        const height = 700;
        const aspectRatio = document.documentElement.clientWidth / document.documentElement.clientHeight;
        return { width: Math.max(960, Math.round(height * aspectRatio)), height, margin: 0.02 };
    });
}

function getLessonDimensions() {
    return getResponsiveSlideDimensions(() => ({ width: 960, height: 700, margin: 0.04 }));
}

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

async function loadTalkMarkdown() {
    const embedded = document.getElementById("presentation-markdown");
    if (embedded?.getAttribute("type") === "application/json") {
        return {
            markdownUrl: new URL("slide.md", window.location.href),
            markdown: JSON.parse(embedded.textContent),
        };
    }

    const source = getTalkSource();
    const isMarkdown = /\/slide\.md$/i.test(source.pathname);
    if (!isMarkdown) {
        const htmlUrl = /\/index\.html$/i.test(source.pathname) ? source : new URL("index.html", source);
        const response = await fetch(htmlUrl, { method: "HEAD", cache: "no-store" });
        if (response.ok) {
            htmlUrl.hash = window.location.hash;
            window.location.replace(htmlUrl.href);
            return null;
        }
        if (response.status !== 404) {
            throw new Error(`Could not load index.html (HTTP ${response.status}).`);
        }
    }

    const markdownUrl = isMarkdown ? source : new URL("slide.md", source);
    const response = await fetch(markdownUrl, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(response.status === 404
            ? "This folder needs an index.html or slide.md file."
            : `Could not load slide.md (HTTP ${response.status}).`);
    }

    const markdown = await response.text();
    if (isEncryptedTalkMarkdown(markdown)) {
        const htmlUrl = new URL("index.html", markdownUrl);
        htmlUrl.hash = window.location.hash;
        window.location.replace(htmlUrl.href);
        return null;
    }
    return { markdownUrl, markdown };
}

async function renderTalk() {
    const source = await loadTalkMarkdown();
    if (!source) return;

    await renderSlideDeck({
        ...source,
        getDimensions: getTalkDimensions,
        beforeInitialize: addPdfShareLink,
    });

    const title = document.querySelector("#slides h1, #slides h2")?.textContent;
    if (title) document.title = `${title} | Charles K. Neimog`;
    const status = document.getElementById("presentation-status");
    if (status) status.hidden = true;
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

async function renderLessonSlide() {
    const params = new URLSearchParams(window.location.search);
    const coursePath = getCoursePath(params);
    const markdownFile = params.get("md");
    if (!markdownFile || markdownFile.includes("/") || markdownFile.includes("\\")) {
        throw new Error("Invalid markdown file");
    }

    const markdownUrl = getCourseFileUrl(coursePath, markdownFile);
    const [response, configResponse] = await Promise.all([
        fetch(markdownUrl, { cache: "no-store" }),
        fetch(getCourseFileUrl(coursePath, "course.json"), { cache: "no-store" }),
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const config = configResponse.ok ? await configResponse.json() : {};
    const courseKey = `${coursePath}/`;
    let markdown = await response.text();
    const payload = window.StaticryptMarkdown?.parsePayload(markdown);
    if (payload) {
        const storedKey = readStoredCourseKey(courseKey);
        if (!storedKey || storedKey.salt !== payload.staticryptSaltUniqueVariableName) {
            redirectToCourse(coursePath);
            return;
        }
        const decoded = await window.StaticryptMarkdown.decryptWithKey(payload, storedKey.key);
        if (decoded === null) {
            sessionStorage.removeItem(COURSE_KEY_SESSION_PREFIX + courseKey);
            redirectToCourse(coursePath);
            return;
        }
        markdown = decoded;
    } else if (config.encrypt === true) {
        alert("Lesson not encrypted");
    } else if (
        (config.passwordHash || typeof config.password === "string") &&
        sessionStorage.getItem(PASSWORD_SESSION_PREFIX + courseKey) !== "true"
    ) {
        redirectToCourse(coursePath);
        return;
    }

    if (configResponse.ok) document.title = config.title || document.title;
    await renderSlideDeck({ markdown, markdownUrl, getDimensions: getLessonDimensions });

    const status = document.getElementById("presentation-status");
    if (status) status.hidden = true;
}

function readStoredCourseKey(courseKey) {
    const source = sessionStorage.getItem(COURSE_KEY_SESSION_PREFIX + courseKey);
    if (!source) return null;
    try {
        const value = JSON.parse(source);
        if (
            value?.version !== 1 ||
            typeof value.salt !== "string" ||
            !/^[0-9a-f]+$/i.test(value.salt) ||
            typeof value.key !== "string" ||
            !/^[0-9a-f]{64}$/i.test(value.key)
        ) {
            return null;
        }
        return value;
    } catch {
        return null;
    }
}

function redirectToCourse(coursePath) {
    window.location.replace(`course.html?${new URLSearchParams({
        v: COURSE_PAGE_VERSION,
        course: coursePath,
    })}`);
}

function getCoursePath(params) {
    const coursePath = params.get("course")?.replace(/\/+$/, "");
    const segments = coursePath?.split("/");
    if (
        !coursePath ||
        coursePath.startsWith("/") ||
        coursePath.includes("\\") ||
        segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
        throw new Error("Invalid course path");
    }
    return coursePath;
}

function getCourseFileUrl(coursePath, file) {
    const encodedCoursePath = coursePath.split("/").map(encodeURIComponent).join("/");
    return `${encodedCoursePath}/${encodeURIComponent(file)}`;
}
