const COURSE_CONFIG_FILE = "course.json";
const PASSWORD_SESSION_PREFIX = "classCourseUnlocked:";
const COURSE_KEY_SESSION_PREFIX = "classCourseKey:";
const DEFAULT_MAX_LESSONS = 50;
const DEFAULT_LESSON_PREFIX = "aula";
const DEFAULT_LESSON_EXTENSION = ".md";
const SLIDE_PAGE_VERSION = "4";
const PASSWORD_ERROR_MESSAGE = "Senha incorreta.";
const TOGGLE_ALT_SHOW = "Mostrar senha";
const TOGGLE_ALT_HIDE = "Ocultar senha";
const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/i;

class CourseAccessError extends Error {}
const IMG_SRC_EYE_CLOSED =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1NzYgNTEyIj48cGF0aCBkPSJNMjg4IDMyYy04MC44IDAtMTQ1LjUgMzYuOC0xOTIuNiA4MC42LTQ2LjggNDMuNS03OC4xIDk1LjQtOTMgMTMxLjEtMy4zIDcuOS0zLjMgMTYuNyAwIDI0LjYgMTQuOSAzNS43IDQ2LjIgODcuNyA5MyAxMzEuMSA0Ny4xIDQzLjcgMTExLjggODAuNiAxOTIuNiA4MC42czE0NS41LTM2LjggMTkyLjYtODAuNmM0Ni44LTQzLjUgNzguMS05NS40IDkzLTEzMS4xIDMuMy03LjkgMy4zLTE2LjcgMC0yNC42LTE0LjktMzUuNy00Ni4yLTg3LjctOTMtMTMxLjEtNDcuMS00My43LTExMS44LTgwLjYtMTkyLjYtODAuNnpNMTQ0IDI1NmExNDQgMTQ0IDAgMSAxIDI4OCAwIDE0NCAxNDQgMCAxIDEgLTI4OCAwem0xNDQtNjRjMCAzNS4zLTI4LjcgNjQtNjQgNjQtMTEuNSAwLTIyLjMtMy0zMS43LTguNC0xIDEwLjktLjEgMjIuMSAyLjkgMzMuMiAxMy43IDUxLjIgNjYuNCA4MS42IDExNy42IDY3LjlzODEuNi02Ni40IDY3LjktMTE3LjZjLTEyLjItNDUuNy01NS41LTc0LjgtMTAxLjEtNzAuOCA1LjMgOS4zIDguNCAyMC4xIDguNCAzMS43eiIvPjwvc3ZnPg==";
const IMG_SRC_EYE_OPENED =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1NzYgNTEyIj48cGF0aCBkPSJNNDEtMjQuOWMtOS40LTkuNC0yNC42LTkuNC0zMy45IDBTLTIuMy0uMyA3IDkuMWw1MjggNTI4YzkuNCA5LjQgMjQuNiA5LjQgMzMuOSAwczkuNC0yNC42IDAtMzMuOWwtOTYuNC05Ni40YzIuNy0yLjQgNS40LTQuOCA4LTcuMiA0Ni44LTQzLjUgNzguMS05NS40IDkzLTEzMS4xIDMuMy03LjkgMy4zLTE2LjcgMC0yNC42LTE0LjktMzUuNy00Ni4yLTg3LjctOTMtMTMxLjEtNDcuMS00My43LTExMS44LTgwLjYtMTkyLjYtODAuNi01Ni44IDAtMTA1LjYgMTguMi0xNDYgNDQuMkw0MS0yNC45ek0yMDQuNSAxMzguN2MyMy41LTE2LjggNTIuNC0yNi43IDgzLjUtMjYuNyA3OS41IDAgMTQ0IDY0LjUgMTQ0IDE0NCAwIDMxLjEtOS45IDU5LjktMjYuNyA4My41bC0zNC43LTM0LjdjMTIuNy0yMS40IDE3LTQ3LjcgMTAuMS03My43LTEzLjctNTEuMi02Ni40LTgxLjYtMTE3LjYtNjcuOS04LjYgMi4zLTE2LjcgNS43LTI0IDEwbC0zNC43LTM0Ljd6TTMyNS4zIDM5NS4xYy0xMS45IDMuMi0yNC40IDQuOS0zNy4zIDQuOS03OS41IDAtMTQ0LTY0LjUtMTQ0LTE0NCAwLTEyLjkgMS43LTI1LjQgNC45LTM3LjNMNjkuNCAxMzkuMmMtMzIuNiAzNi44LTU1IDc1LjgtNjYuOSAxMDQuNS0zLjMgNy45LTMuMyAxNi43IDAgMjQuNiAxNC45IDM1LjcgNDYuMiA4Ny43IDkzIDEzMS4xIDQ3LjEgNDMuNyAxMTEuOCA4MC42IDE5Mi42IDgwLjYgMzcuMyAwIDcxLjItNy45IDEwMS41LTIwLjZsLTY0LjItNjQuMnoiLz48L3N2Zz4=";

document.addEventListener("DOMContentLoaded", () => {
    initCoursePage().catch((error) => {
        console.error("Course init failed:", error);
        showPageError("Não foi possível carregar este curso.");
    });
});

async function initCoursePage() {
    const coursePath = getCoursePath();
    const config = await fetchJson(getCourseFileUrl(coursePath, COURSE_CONFIG_FILE));
    const courseKey = getCourseKey(coursePath);

    setText("[data-course-title]", config.title || document.title);
    setText("[data-course-heading]", config.title || document.title);
    setText("[data-course-description]", config.description || "");
    document.title = `${config.title || "Curso"} | Classes`;
    setupPasswordToggle();

    const form = document.getElementById("staticrypt-form");
    const input = document.getElementById("staticrypt-password");

    if (!form || !input) return;

    if (config.encrypt === true) {
        const storedKey = readStoredCourseKey(courseKey);
        if (storedKey) {
            try {
                await unlockCourse(config, coursePath, { storedKey });
                return;
            } catch (error) {
                sessionStorage.removeItem(COURSE_KEY_SESSION_PREFIX + courseKey);
                console.warn("Stored course key is no longer valid:", error);
            }
        }
    } else if (!config.passwordHash && typeof config.password !== "string") {
        await unlockCourse(config, coursePath);
        return;
    } else if (sessionStorage.getItem(PASSWORD_SESSION_PREFIX + courseKey) === "true") {
        await unlockCourse(config, coursePath);
        return;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        try {
            if (config.encrypt === true) {
                const result = await unlockCourse(config, coursePath, { password: input.value });
                if (result.storedKey) storeCourseKey(courseKey, result.storedKey);
            } else {
                const isValid = await validatePassword(input.value, config);
                if (!isValid) throw new CourseAccessError(PASSWORD_ERROR_MESSAGE);
                sessionStorage.setItem(PASSWORD_SESSION_PREFIX + courseKey, "true");
                await unlockCourse(config, coursePath);
            }
        } catch (error) {
            if (!(error instanceof CourseAccessError)) throw error;
            alert(PASSWORD_ERROR_MESSAGE);
            input.select();
        }
    });
}

async function unlockCourse(config, coursePath, credentials = {}) {
    const section = document.querySelector("[data-lessons-section]");
    const container = document.querySelector("[data-lessons]");
    if (!section || !container) return {};

    const { lessons, storedKey } = await discoverLessons(config, coursePath, credentials);
    document.querySelector("[data-password-screen]")?.classList.add("hidden");
    document.querySelector("[data-course-app]")?.classList.remove("hidden");
    if (!lessons.length) {
        container.innerHTML =
            '<p class="text-sm text-text-light-secondary dark:text-text-dark-secondary">Nenhuma aula encontrada ainda.</p>';
        return { storedKey };
    }

    container.innerHTML = "";
    for (const lesson of lessons) {
        container.appendChild(createLessonCard(lesson, coursePath));
    }
    return { storedKey };
}

async function discoverLessons(config, coursePath, credentials = {}) {
    const prefix = config.lessonPrefix || DEFAULT_LESSON_PREFIX;
    const extension = config.lessonExtension || DEFAULT_LESSON_EXTENSION;
    const maxLessons = Number(config.maxLessons) || DEFAULT_MAX_LESSONS;
    const lessons = [];
    let storedKey = credentials.storedKey || null;
    let normalizedPassword = null;
    let misses = 0;

    for (let index = 1; index <= maxLessons && misses < 3; index += 1) {
        const file = `${prefix}${index}${extension}`;
        const response = await fetch(getCourseFileUrl(coursePath, file), { cache: "no-store" });

        if (!response.ok) {
            misses += 1;
            continue;
        }

        misses = 0;
        let markdown = await response.text();
        const payload = window.StaticryptMarkdown?.parsePayload(markdown);
        if (payload) {
            if (!window.StaticryptMarkdown) throw new Error("Encrypted Markdown support is unavailable");
            const salt = payload.staticryptSaltUniqueVariableName;
            let decoded;
            if (storedKey) {
                if (storedKey.salt !== salt) {
                    throw new CourseAccessError("Course encryption salt changed");
                }
                decoded = await window.StaticryptMarkdown.decryptWithKey(payload, storedKey.key);
            } else {
                if (typeof credentials.password !== "string") {
                    throw new CourseAccessError("Course password required");
                }
                normalizedPassword ||= await window.StaticryptMarkdown.normalizePassword(credentials.password);
                const result = await window.StaticryptMarkdown.decrypt(payload, normalizedPassword);
                decoded = result?.decoded ?? null;
                if (result) storedKey = { version: 1, salt, key: result.hashedPassword };
            }
            if (decoded === null) throw new CourseAccessError(PASSWORD_ERROR_MESSAGE);
            markdown = decoded;
        } else if (config.encrypt === true) {
            alert(`Protected course contains plaintext lesson ${file}`);
        }
        lessons.push({
            file,
            number: index,
            title: getMarkdownTitle(markdown) || `Aula ${index}`,
            description: getMarkdownDescription(markdown),
        });
    }

    return { lessons, storedKey };
}

function createLessonCard(lesson, coursePath) {
    const card = document.createElement("article");
    card.className =
        "lesson-card cursor-pointer rounded-lg border border-gray-300 dark:border-gray-700 p-6 transition-shadow duration-300 hover:shadow-lg";

    const meta = document.createElement("p");
    meta.className = "text-sm font-medium text-text-light-secondary dark:text-text-dark-secondary";
    meta.textContent = `Aula ${lesson.number}`;

    const title = document.createElement("h2");
    title.className = "mt-2 text-xl font-bold text-text-light-primary dark:text-text-dark-primary";
    title.textContent = lesson.title;

    const description = document.createElement("p");
    description.className = "mt-3 text-base leading-relaxed text-text-light-secondary dark:text-text-dark-secondary";
    description.textContent = lesson.description || lesson.file;

    card.append(meta, title, description);
    card.addEventListener("click", () => {
        const params = new URLSearchParams({
            v: SLIDE_PAGE_VERSION,
            course: coursePath,
            md: lesson.file,
        });
        window.location.href = `slide.html?${params}`;
    });

    return card;
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
            !HEX_KEY_PATTERN.test(value.key)
        ) {
            return null;
        }
        return value;
    } catch {
        return null;
    }
}

function storeCourseKey(courseKey, storedKey) {
    sessionStorage.setItem(COURSE_KEY_SESSION_PREFIX + courseKey, JSON.stringify(storedKey));
}

async function validatePassword(value, config) {
    if (config.passwordHash) {
        return (await sha256(value)) === config.passwordHash;
    }

    return value === config.password;
}

async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

function getCoursePath() {
    const coursePath = new URLSearchParams(window.location.search).get("course")?.replace(/\/+$/, "");
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

function getCourseKey(coursePath) {
    return `${coursePath}/`;
}

function getMarkdownTitle(markdown) {
    return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function getMarkdownDescription(markdown) {
    const lines = markdown
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && !line.startsWith("```"));

    return lines[0] || "";
}

function setText(selector, text) {
    const element = document.querySelector(selector);
    if (element) element.textContent = text;
}

function setupPasswordToggle() {
    const toggleIcon = document.querySelector(".staticrypt-toggle-password-visibility");
    const passwordInput = document.getElementById("staticrypt-password");
    if (!toggleIcon || !passwordInput) return;

    toggleIcon.addEventListener("click", () => {
        if (passwordInput.type === "password") {
            passwordInput.type = "text";
            toggleIcon.src = IMG_SRC_EYE_OPENED;
            toggleIcon.alt = TOGGLE_ALT_HIDE;
            toggleIcon.title = TOGGLE_ALT_HIDE;
        } else {
            passwordInput.type = "password";
            toggleIcon.src = IMG_SRC_EYE_CLOSED;
            toggleIcon.alt = TOGGLE_ALT_SHOW;
            toggleIcon.title = TOGGLE_ALT_SHOW;
        }
    });
}

function showPageError(message) {
    const main = document.querySelector("main");
    if (main) {
        main.innerHTML = `<p class="mx-auto max-w-3xl text-sm text-red-500">${message}</p>`;
    }
}
