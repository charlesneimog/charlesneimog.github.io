document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.classList.add("class-slides");

    renderLessonSlide().catch((error) => {
        alert(error);
        const slides = document.getElementById("slides");
        if (slides) {
            slides.innerHTML = "<section><h1>Erro</h1><p>Não foi possível carregar esta aula.</p></section>";
        }
    });
});

const PASSWORD_SESSION_PREFIX = "classCourseUnlocked:";
const COURSE_KEY_SESSION_PREFIX = "classCourseKey:";
const COURSE_PAGE_VERSION = "2";
const SMARTPHONE_MEDIA_QUERY = "(max-width: 900px)";

function getSlideDimensions() {
    if (!window.matchMedia(SMARTPHONE_MEDIA_QUERY).matches) {
        return { width: 960, height: 700, margin: 0.04 };
    }

    return {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
        margin: 0,
    };
}

function initializeMermaid() {
    if (!window.mermaid) return;

    window.mermaid.initialize({
        startOnLoad: false,
        flowchart: {
            useMaxWidth: true,
            width: "100%",
        },
    });
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

    if (configResponse.ok) {
        document.title = config.title || document.title;
    }

    initializeMermaid();
    const slide = new Markdown2Slide(markdown);
    slide.render();
    rebaseLessonLinks(markdownUrl);

    const deck = new Reveal({
        center: false,
        hash: true,
        plugins: typeof RevealHighlight === "undefined" ? [] : [RevealHighlight],
        scrollActivationWidth: null,
        slideNumber: true,
        ...getSlideDimensions(),
    });

    await deck.initialize();

    const enhanceCurrentSlide = createSlideEnhancer(deck);
    deck.on("ready", enhanceCurrentSlide);
    deck.on("slidechanged", enhanceCurrentSlide);
    await enhanceCurrentSlide();

    const smartphoneQuery = window.matchMedia(SMARTPHONE_MEDIA_QUERY);
    const updateSlideDimensions = () => deck.configure(getSlideDimensions());

    smartphoneQuery.addEventListener("change", updateSlideDimensions);
    window.addEventListener("orientationchange", updateSlideDimensions);
    window.addEventListener("resize", updateSlideDimensions);
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
    window.location.replace(`course.html?${new URLSearchParams({ v: COURSE_PAGE_VERSION, course: coursePath })}`);
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

function rebaseLessonLinks(markdownUrl) {
    const baseUrl = new URL(markdownUrl, window.location.href);
    document.querySelectorAll("#slides [src], #slides [href]").forEach((element) => {
        for (const attribute of ["src", "href"]) {
            const value = element.getAttribute(attribute);
            if (!value || value.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(value)) continue;
            element.setAttribute(attribute, new URL(value, baseUrl).href);
        }
    });
}
