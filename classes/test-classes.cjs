const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const TextEncoderClass = globalThis.TextEncoder;
const TextDecoderClass = globalThis.TextDecoder;

function loadCodec() {
    const context = vm.createContext({
        crypto: webcrypto,
        TextEncoder: TextEncoderClass,
        TextDecoder: TextDecoderClass,
    });
    context.globalThis = context;
    vm.runInContext(
        readFileSync(path.join(__dirname, "../js/staticrypt-markdown.js"), "utf8"),
        context,
        { filename: "staticrypt-markdown.js" },
    );
    return context.StaticryptMarkdown;
}

function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
    return Uint8Array.from(value.match(/../g), (byte) => Number.parseInt(byte, 16));
}

async function encryptedPayload(codec, source, password) {
    const normalized = await codec.normalizePassword(password);
    const salt = "00112233445566778899aabbccddeeff";
    const hashedPassword = await codec.deriveKey(normalized, salt);
    const iv = Uint8Array.from({ length: 16 }, (_, index) => index);
    const aesKey = await webcrypto.subtle.importKey(
        "raw", fromHex(hashedPassword), "AES-CBC", false, ["encrypt"],
    );
    const ciphertext = await webcrypto.subtle.encrypt(
        { name: "AES-CBC", iv }, aesKey, new TextEncoderClass().encode(source),
    );
    const encryptedMessage = toHex(iv) + toHex(new Uint8Array(ciphertext));
    const hmacKey = await webcrypto.subtle.importKey(
        "raw", fromHex(hashedPassword), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const signature = await webcrypto.subtle.sign(
        "HMAC", hmacKey, new TextEncoderClass().encode(encryptedMessage),
    );
    return {
        format: "staticrypt-markdown",
        version: 1,
        staticryptSaltUniqueVariableName: salt,
        staticryptEncryptedMsgUniqueVariableName: toHex(new Uint8Array(signature)) + encryptedMessage,
    };
}

function lessonViewer(codec, payload, storedKey = null) {
    const coursePath = "2026/Test-Course";
    const storage = new Map();
    if (storedKey) {
        storage.set(`classCourseKey:${coursePath}/`, JSON.stringify(storedKey));
    }
    const pageUrl = new URL(
        `/classes/slide.html?v=4&course=${encodeURIComponent(coursePath)}&md=aula1.md`,
        "http://127.0.0.1:5004",
    );
    const context = vm.createContext({
        URL,
        URLSearchParams,
        console,
        StaticryptMarkdown: codec,
        RevealHighlight: function RevealHighlight() {},
        Markdown2Slide: class {
            constructor(markdown) { context.renderedMarkdown = markdown; }
            render() {}
        },
        Reveal: class {
            async initialize() {}
            on() {}
            configure() {}
        },
        createSlideEnhancer() { return async () => {}; },
        sessionStorage: {
            getItem(key) { return storage.get(key) ?? null; },
            setItem(key, value) { storage.set(key, value); },
            removeItem(key) { storage.delete(key); },
        },
        document: {
            documentElement: {
                classList: { add() {} },
                clientWidth: 1280,
                clientHeight: 720,
            },
            addEventListener() {},
            getElementById() { return { innerHTML: "" }; },
            querySelectorAll() { return []; },
        },
        async fetch(target) {
            if (String(target).endsWith("course.json")) {
                return { ok: true, json: async () => ({ title: "Test", encrypt: true }) };
            }
            return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
        },
    });
    context.window = {
        StaticryptMarkdown: codec,
        location: {
            href: pageUrl.href,
            search: pageUrl.search,
            replace(target) { context.redirect = target; },
        },
        matchMedia() { return { matches: false, addEventListener() {} }; },
        addEventListener() {},
        mermaid: { initialize() {} },
    };
    vm.runInContext(
        readFileSync(path.join(__dirname, "../js/lesson-slide.js"), "utf8"),
        context,
        { filename: "lesson-slide.js" },
    );
    return context;
}

test("StatiCrypt Markdown payloads decrypt with a normalized course password", async () => {
    const codec = loadCodec();
    const source = "# Private lesson\n\nOnly students should read this.\n";
    const payload = await encryptedPayload(codec, source, "course-password");
    const normalized = await codec.normalizePassword("course-password");
    const result = await codec.decrypt(payload, normalized);

    assert.equal(result.decoded, source);
    assert.match(result.hashedPassword, /^[0-9a-f]{64}$/);
    assert.equal(await codec.decryptWithKey(payload, result.hashedPassword), source);
});

test("wrong passwords fail authentication without returning plaintext", async () => {
    const codec = loadCodec();
    const payload = await encryptedPayload(codec, "Secret", "correct-password");
    const wrong = await codec.normalizePassword("wrong-password");

    assert.equal(await codec.decrypt(payload, wrong), null);
});

test("payload parsing distinguishes plaintext from damaged ciphertext", async () => {
    const codec = loadCodec();
    assert.equal(codec.parsePayload("# Public lesson"), null);
    assert.throws(
        () => codec.parsePayload('{"format":"staticrypt-markdown","version":1}'),
        /Malformed encrypted Markdown payload/,
    );
    assert.throws(
        () => codec.parsePayload('{"format":"staticrypt-markdown",'),
        /Malformed encrypted Markdown payload/,
    );
});

test("direct encrypted lesson links without a derived key return to the versioned course gate", async () => {
    const codec = loadCodec();
    const payload = await encryptedPayload(codec, "# Private lesson", "course-password");
    const page = lessonViewer(codec, payload);

    await page.renderLessonSlide();

    assert.match(page.redirect, /^course\.html\?v=2&course=2026%2FTest-Course$/);
    assert.equal(page.renderedMarkdown, undefined);
});

test("lesson pages decrypt with the course key stored in the browser session", async () => {
    const codec = loadCodec();
    const source = "# Private lesson\n\nRendered after login.";
    const payload = await encryptedPayload(codec, source, "course-password");
    const normalized = await codec.normalizePassword("course-password");
    const decrypted = await codec.decrypt(payload, normalized);
    const storedKey = {
        version: 1,
        salt: payload.staticryptSaltUniqueVariableName,
        key: decrypted.hashedPassword,
    };
    const page = lessonViewer(codec, payload, storedKey);

    await page.renderLessonSlide();

    assert.equal(page.redirect, undefined);
    assert.equal(page.renderedMarkdown, source);
});

