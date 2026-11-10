(function (global) {
    "use strict";

    const ENCRYPTION_ALGORITHM = "AES-CBC";
    const PAYLOAD_FORMAT = "staticrypt-markdown";
    const PAYLOAD_VERSION = 1;
    const HMAC_HEX_LENGTH = 64;
    const IV_HEX_LENGTH = 32;
    const KEY_HEX_LENGTH = 64;
    const HEX_PATTERN = /^[0-9a-f]+$/i;

    function parseHex(value) {
        if (typeof value !== "string" || value.length % 2 || !HEX_PATTERN.test(value)) {
            throw new Error("Invalid hexadecimal value");
        }
        const bytes = new Uint8Array(value.length / 2);
        for (let index = 0; index < value.length; index += 2) {
            bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
        }
        return bytes;
    }

    function toHex(bytes) {
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    function validatePayload(payload) {
        const ciphertext = payload?.staticryptEncryptedMsgUniqueVariableName;
        const salt = payload?.staticryptSaltUniqueVariableName;
        if (
            !payload ||
            payload.format !== PAYLOAD_FORMAT ||
            payload.version !== PAYLOAD_VERSION ||
            typeof ciphertext !== "string" ||
            ciphertext.length <= HMAC_HEX_LENGTH + IV_HEX_LENGTH ||
            ciphertext.length % 2 ||
            !HEX_PATTERN.test(ciphertext) ||
            typeof salt !== "string" ||
            !salt.length ||
            salt.length % 2 ||
            !HEX_PATTERN.test(salt)
        ) {
            throw new Error("Malformed encrypted Markdown payload");
        }
        return payload;
    }

    function parsePayload(source) {
        let payload;
        try {
            payload = JSON.parse(source);
        } catch (error) {
            if (String(source).trimStart().startsWith("{") && String(source).includes(PAYLOAD_FORMAT)) {
                throw new Error("Malformed encrypted Markdown payload", { cause: error });
            }
            return null;
        }
        if (payload?.format !== PAYLOAD_FORMAT) return null;
        return validatePayload(payload);
    }

    async function pbkdf2(password, salt, iterations, hash) {
        const key = await global.crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(password),
            "PBKDF2",
            false,
            ["deriveBits"],
        );
        const bits = await global.crypto.subtle.deriveBits(
            {
                name: "PBKDF2",
                hash,
                iterations,
                salt: new TextEncoder().encode(salt),
            },
            key,
            256,
        );
        return toHex(new Uint8Array(bits));
    }

    async function deriveKey(password, salt) {
        let key = await pbkdf2(password, salt, 1000, "SHA-1");
        key = await pbkdf2(key, salt, 14000, "SHA-256");
        return pbkdf2(key, salt, 585000, "SHA-256");
    }

    async function normalizePassword(password) {
        const digest = await global.crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(password),
        );
        return toHex(new Uint8Array(digest));
    }

    function equalHex(left, right) {
        if (left.length !== right.length) return false;
        let difference = 0;
        for (let index = 0; index < left.length; index += 1) {
            difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
        }
        return difference === 0;
    }

    async function decryptWithKey(payload, hashedPassword) {
        validatePayload(payload);
        if (
            typeof hashedPassword !== "string" ||
            hashedPassword.length !== KEY_HEX_LENGTH ||
            !HEX_PATTERN.test(hashedPassword)
        ) {
            return null;
        }

        const signedMessage = payload.staticryptEncryptedMsgUniqueVariableName;
        const expectedSignature = signedMessage.slice(0, HMAC_HEX_LENGTH);
        const encryptedMessage = signedMessage.slice(HMAC_HEX_LENGTH);
        const signingKey = await global.crypto.subtle.importKey(
            "raw",
            parseHex(hashedPassword),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
        );
        const signature = await global.crypto.subtle.sign(
            "HMAC",
            signingKey,
            new TextEncoder().encode(encryptedMessage),
        );
        if (!equalHex(toHex(new Uint8Array(signature)), expectedSignature)) return null;

        const iv = parseHex(encryptedMessage.slice(0, IV_HEX_LENGTH));
        const ciphertext = parseHex(encryptedMessage.slice(IV_HEX_LENGTH));
        const decryptionKey = await global.crypto.subtle.importKey(
            "raw",
            parseHex(hashedPassword),
            ENCRYPTION_ALGORITHM,
            false,
            ["decrypt"],
        );
        try {
            const plaintext = await global.crypto.subtle.decrypt(
                { name: ENCRYPTION_ALGORITHM, iv },
                decryptionKey,
                ciphertext,
            );
            return new TextDecoder().decode(plaintext);
        } catch {
            return null;
        }
    }

    async function decrypt(payload, password) {
        validatePayload(payload);
        const hashedPassword = await deriveKey(password, payload.staticryptSaltUniqueVariableName);
        const decoded = await decryptWithKey(payload, hashedPassword);
        return decoded === null ? null : { decoded, hashedPassword };
    }

    global.StaticryptMarkdown = Object.freeze({
        decrypt,
        decryptWithKey,
        deriveKey,
        normalizePassword,
        parsePayload,
        validatePayload,
    });
})(globalThis);

