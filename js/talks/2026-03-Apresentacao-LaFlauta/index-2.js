
            // these variables will be filled when generating the file - the template format is 'variable_name'
            const staticryptInitiator = ((function(){
  const exports = {};
  const cryptoEngine = ((function(){
  const exports = {};
  const { subtle } = crypto;

const IV_BITS = 16 * 8;
const HEX_BITS = 4;
const ENCRYPTION_ALGO = "AES-CBC";

/**
 * Translates between utf8 encoded hexadecimal strings
 * and Uint8Array bytes.
 */
const HexEncoder = {
    /**
     * hex string -> bytes
     * @param {string} hexString
     * @returns {Uint8Array}
     */
    parse: function (hexString) {
        if (hexString.length % 2 !== 0) throw "Invalid hexString";
        const arrayBuffer = new Uint8Array(hexString.length / 2);

        for (let i = 0; i < hexString.length; i += 2) {
            const byteValue = parseInt(hexString.substring(i, i + 2), 16);
            if (isNaN(byteValue)) {
                throw "Invalid hexString";
            }
            arrayBuffer[i / 2] = byteValue;
        }
        return arrayBuffer;
    },

    /**
     * bytes -> hex string
     * @param {Uint8Array} bytes
     * @returns {string}
     */
    stringify: function (bytes) {
        const hexBytes = [];

        for (let i = 0; i < bytes.length; ++i) {
            let byteString = bytes[i].toString(16);
            if (byteString.length < 2) {
                byteString = "0" + byteString;
            }
            hexBytes.push(byteString);
        }
        return hexBytes.join("");
    },
};

/**
 * Translates between utf8 strings and Uint8Array bytes.
 */
const UTF8Encoder = {
    parse: function (str) {
        return new TextEncoder().encode(str);
    },

    stringify: function (bytes) {
        return new TextDecoder().decode(bytes);
    },
};

/**
 * Salt and encrypt a msg with a password.
 */
async function encrypt(msg, hashedPassword) {
    // Must be 16 bytes, unpredictable, and preferably cryptographically random. However, it need not be secret.
    // https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt#parameters
    const iv = crypto.getRandomValues(new Uint8Array(IV_BITS / 8));

    const key = await subtle.importKey("raw", HexEncoder.parse(hashedPassword), ENCRYPTION_ALGO, false, ["encrypt"]);

    const encrypted = await subtle.encrypt(
        {
            name: ENCRYPTION_ALGO,
            iv: iv,
        },
        key,
        UTF8Encoder.parse(msg)
    );

    // iv will be 32 hex characters, we prepend it to the ciphertext for use in decryption
    return HexEncoder.stringify(iv) + HexEncoder.stringify(new Uint8Array(encrypted));
}
exports.encrypt = encrypt;

/**
 * Decrypt a salted msg using a password.
 *
 * @param {string} encryptedMsg
 * @param {string} hashedPassword
 * @returns {Promise<string>}
 */
async function decrypt(encryptedMsg, hashedPassword) {
    const ivLength = IV_BITS / HEX_BITS;
    const iv = HexEncoder.parse(encryptedMsg.substring(0, ivLength));
    const encrypted = encryptedMsg.substring(ivLength);

    const key = await subtle.importKey("raw", HexEncoder.parse(hashedPassword), ENCRYPTION_ALGO, false, ["decrypt"]);

    const outBuffer = await subtle.decrypt(
        {
            name: ENCRYPTION_ALGO,
            iv: iv,
        },
        key,
        HexEncoder.parse(encrypted)
    );

    return UTF8Encoder.stringify(new Uint8Array(outBuffer));
}
exports.decrypt = decrypt;

/**
 * Salt and hash the password so it can be stored in localStorage without opening a password reuse vulnerability.
 *
 * @param {string} password
 * @param {string} salt
 * @returns {Promise<string>}
 */
async function hashPassword(password, salt) {
    // we hash the password in multiple steps, each adding more iterations. This is because we used to allow less
    // iterations, so for backward compatibility reasons, we need to support going from that to more iterations.
    let hashedPassword = await hashLegacyRound(password, salt);

    hashedPassword = await hashSecondRound(hashedPassword, salt);

    return hashThirdRound(hashedPassword, salt);
}
exports.hashPassword = hashPassword;

/**
 * This hashes the password with 1k iterations. This is a low number, we need this function to support backwards
 * compatibility.
 *
 * @param {string} password
 * @param {string} salt
 * @returns {Promise<string>}
 */
function hashLegacyRound(password, salt) {
    return pbkdf2(password, salt, 1000, "SHA-1");
}
exports.hashLegacyRound = hashLegacyRound;

/**
 * Add a second round of iterations. This is because we used to use 1k, so for backwards compatibility with
 * remember-me/autodecrypt links, we need to support going from that to more iterations.
 *
 * @param hashedPassword
 * @param salt
 * @returns {Promise<string>}
 */
function hashSecondRound(hashedPassword, salt) {
    return pbkdf2(hashedPassword, salt, 14000, "SHA-256");
}
exports.hashSecondRound = hashSecondRound;

/**
 * Add a third round of iterations to bring total number to 600k. This is because we used to use 1k, then 15k, so for
 * backwards compatibility with remember-me/autodecrypt links, we need to support going from that to more iterations.
 *
 * @param hashedPassword
 * @param salt
 * @returns {Promise<string>}
 */
function hashThirdRound(hashedPassword, salt) {
    return pbkdf2(hashedPassword, salt, 585000, "SHA-256");
}
exports.hashThirdRound = hashThirdRound;

/**
 * Salt and hash the password so it can be stored in localStorage without opening a password reuse vulnerability.
 *
 * @param {string} password
 * @param {string} salt
 * @param {int} iterations
 * @param {string} hashAlgorithm
 * @returns {Promise<string>}
 */
async function pbkdf2(password, salt, iterations, hashAlgorithm) {
    const key = await subtle.importKey("raw", UTF8Encoder.parse(password), "PBKDF2", false, ["deriveBits"]);

    const keyBytes = await subtle.deriveBits(
        {
            name: "PBKDF2",
            hash: hashAlgorithm,
            iterations,
            salt: UTF8Encoder.parse(salt),
        },
        key,
        256
    );

    return HexEncoder.stringify(new Uint8Array(keyBytes));
}

function generateRandomSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(128 / 8));

    return HexEncoder.stringify(new Uint8Array(bytes));
}
exports.generateRandomSalt = generateRandomSalt;

async function signMessage(hashedPassword, message) {
    const key = await subtle.importKey(
        "raw",
        HexEncoder.parse(hashedPassword),
        {
            name: "HMAC",
            hash: "SHA-256",
        },
        false,
        ["sign"]
    );
    const signature = await subtle.sign("HMAC", key, UTF8Encoder.parse(message));

    return HexEncoder.stringify(new Uint8Array(signature));
}
exports.signMessage = signMessage;

function getRandomAlphanum() {
    const possibleCharacters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let byteArray;
    let parsedInt;

    // Keep generating new random bytes until we get a value that falls
    // within a range that can be evenly divided by possibleCharacters.length
    do {
        byteArray = crypto.getRandomValues(new Uint8Array(1));
        // extract the lowest byte to get an int from 0 to 255 (probably unnecessary, since we're only generating 1 byte)
        parsedInt = byteArray[0] & 0xff;
    } while (parsedInt >= 256 - (256 % possibleCharacters.length));

    // Take the modulo of the parsed integer to get a random number between 0 and totalLength - 1
    const randomIndex = parsedInt % possibleCharacters.length;

    return possibleCharacters[randomIndex];
}

/**
 * Generate a random string of a given length.
 *
 * @param {int} length
 * @returns {string}
 */
function generateRandomString(length) {
    let randomString = "";

    for (let i = 0; i < length; i++) {
        randomString += getRandomAlphanum();
    }

    return randomString;
}
exports.generateRandomString = generateRandomString;

  return exports;
})());
const codec = ((function(){
  const exports = {};
  /**
 * Initialize the codec with the provided cryptoEngine - this return functions to encode and decode messages.
 *
 * @param cryptoEngine - the engine to use for encryption / decryption
 */
function init(cryptoEngine) {
    const exports = {};

    /**
     * Top-level function for encoding a message.
     * Includes password hashing, encryption, and signing.
     *
     * @param {string} msg
     * @param {string} password
     * @param {string} salt
     *
     * @returns {string} The encoded text
     */
    async function encode(msg, password, salt) {
        const hashedPassword = await cryptoEngine.hashPassword(password, salt);

        const encrypted = await cryptoEngine.encrypt(msg, hashedPassword);

        // we use the hashed password in the HMAC because this is effectively what will be used a password (so we can store
        // it in localStorage safely, we don't use the clear text password)
        const hmac = await cryptoEngine.signMessage(hashedPassword, encrypted);

        return hmac + encrypted;
    }
    exports.encode = encode;

    /**
     * Encode using a password that has already been hashed. This is useful to encode multiple messages in a row, that way
     * we don't need to hash the password multiple times.
     *
     * @param {string} msg
     * @param {string} hashedPassword
     *
     * @returns {string} The encoded text
     */
    async function encodeWithHashedPassword(msg, hashedPassword) {
        const encrypted = await cryptoEngine.encrypt(msg, hashedPassword);

        // we use the hashed password in the HMAC because this is effectively what will be used a password (so we can store
        // it in localStorage safely, we don't use the clear text password)
        const hmac = await cryptoEngine.signMessage(hashedPassword, encrypted);

        return hmac + encrypted;
    }
    exports.encodeWithHashedPassword = encodeWithHashedPassword;

    /**
     * Top-level function for decoding a message.
     * Includes signature check and decryption.
     *
     * @param {string} signedMsg
     * @param {string} hashedPassword
     * @param {string} salt
     * @param {int} backwardCompatibleAttempt
     * @param {string} originalPassword
     *
     * @returns {Object} {success: true, decoded: string} | {success: false, message: string}
     */
    async function decode(signedMsg, hashedPassword, salt, backwardCompatibleAttempt = 0, originalPassword = "") {
        const encryptedHMAC = signedMsg.substring(0, 64);
        const encryptedMsg = signedMsg.substring(64);
        const decryptedHMAC = await cryptoEngine.signMessage(hashedPassword, encryptedMsg);

        if (decryptedHMAC !== encryptedHMAC) {
            // we have been raising the number of iterations in the hashing algorithm multiple times, so to support the old
            // remember-me/autodecrypt links we need to try bringing the old hashes up to speed.
            originalPassword = originalPassword || hashedPassword;
            if (backwardCompatibleAttempt === 0) {
                const updatedHashedPassword = await cryptoEngine.hashThirdRound(originalPassword, salt);

                return decode(signedMsg, updatedHashedPassword, salt, backwardCompatibleAttempt + 1, originalPassword);
            }
            if (backwardCompatibleAttempt === 1) {
                let updatedHashedPassword = await cryptoEngine.hashSecondRound(originalPassword, salt);
                updatedHashedPassword = await cryptoEngine.hashThirdRound(updatedHashedPassword, salt);

                return decode(signedMsg, updatedHashedPassword, salt, backwardCompatibleAttempt + 1, originalPassword);
            }

            return { success: false, message: "Signature mismatch" };
        }

        return {
            success: true,
            decoded: await cryptoEngine.decrypt(encryptedMsg, hashedPassword),
        };
    }
    exports.decode = decode;

    return exports;
}
exports.init = init;

  return exports;
})());
const decode = codec.init(cryptoEngine).decode;

/**
 * Initialize the staticrypt module, that exposes functions callbable by the password_template.
 *
 * @param {{
 *  staticryptEncryptedMsgUniqueVariableName: string,
 *  isRememberEnabled: boolean,
 *  rememberDurationInDays: number,
 *  staticryptSaltUniqueVariableName: string,
 * }} staticryptConfig - object of data that is stored on the password_template at encryption time.
 *
 * @param {{
 *  rememberExpirationKey: string,
 *  rememberPassphraseKey: string,
 *  replaceHtmlCallback: function,
 *  clearLocalStorageCallback: function,
 * }} templateConfig - object of data that can be configured by a custom password_template.
 */
function init(staticryptConfig, templateConfig) {
    const exports = {};

    /**
     * Decrypt our encrypted page, replace the whole HTML.
     *
     * @param {string} hashedPassword
     * @returns {Promise<boolean>}
     */
    async function decryptAndReplaceHtml(hashedPassword) {
        const { staticryptEncryptedMsgUniqueVariableName, staticryptSaltUniqueVariableName } = staticryptConfig;
        const { replaceHtmlCallback } = templateConfig;

        const result = await decode(
            staticryptEncryptedMsgUniqueVariableName,
            hashedPassword,
            staticryptSaltUniqueVariableName
        );
        if (!result.success) {
            return false;
        }
        const plainHTML = result.decoded;

        // if the user configured a callback call it, otherwise just replace the whole HTML
        if (typeof replaceHtmlCallback === "function") {
            replaceHtmlCallback(plainHTML);
        } else {
            document.write(plainHTML);
            document.close();
        }

        return true;
    }

    /**
     * Attempt to decrypt the page and replace the whole HTML.
     *
     * @param {string} password
     * @param {boolean} isRememberChecked
     *
     * @returns {Promise<{isSuccessful: boolean, hashedPassword?: string}>} - we return an object, so that if we want to
     *   expose more information in the future we can do it without breaking the password_template
     */
    async function handleDecryptionOfPage(password, isRememberChecked) {
        const { staticryptSaltUniqueVariableName } = staticryptConfig;

        // decrypt and replace the whole page
        const hashedPassword = await cryptoEngine.hashPassword(password, staticryptSaltUniqueVariableName);
        return handleDecryptionOfPageFromHash(hashedPassword, isRememberChecked);
    }
    exports.handleDecryptionOfPage = handleDecryptionOfPage;

    async function handleDecryptionOfPageFromHash(hashedPassword, isRememberChecked) {
        const { isRememberEnabled, rememberDurationInDays } = staticryptConfig;
        const { rememberExpirationKey, rememberPassphraseKey } = templateConfig;

        const isDecryptionSuccessful = await decryptAndReplaceHtml(hashedPassword);

        if (!isDecryptionSuccessful) {
            return {
                isSuccessful: false,
                hashedPassword,
            };
        }

        // remember the hashedPassword and set its expiration if necessary
        if (isRememberEnabled && isRememberChecked) {
            window.localStorage.setItem(rememberPassphraseKey, hashedPassword);

            // set the expiration if the duration isn't 0 (meaning no expiration)
            if (rememberDurationInDays > 0) {
                window.localStorage.setItem(
                    rememberExpirationKey,
                    (new Date().getTime() + rememberDurationInDays * 24 * 60 * 60 * 1000).toString()
                );
            }
        }

        return {
            isSuccessful: true,
            hashedPassword,
        };
    }
    exports.handleDecryptionOfPageFromHash = handleDecryptionOfPageFromHash;

    /**
     * Clear localstorage from staticrypt related values
     */
    function clearLocalStorage() {
        const { clearLocalStorageCallback, rememberExpirationKey, rememberPassphraseKey } = templateConfig;

        if (typeof clearLocalStorageCallback === "function") {
            clearLocalStorageCallback();
        } else {
            localStorage.removeItem(rememberPassphraseKey);
            localStorage.removeItem(rememberExpirationKey);
        }
    }

    async function handleDecryptOnLoad() {
        let isSuccessful = await decryptOnLoadFromUrl();

        if (!isSuccessful) {
            isSuccessful = await decryptOnLoadFromRememberMe();
        }

        return { isSuccessful };
    }
    exports.handleDecryptOnLoad = handleDecryptOnLoad;

    /**
     * Clear storage if we are logging out
     *
     * @returns {boolean} - whether we logged out
     */
    function logoutIfNeeded() {
        const logoutKey = "staticrypt_logout";

        // handle logout through query param
        const queryParams = new URLSearchParams(window.location.search);
        if (queryParams.has(logoutKey)) {
            clearLocalStorage();
            return true;
        }

        // handle logout through URL fragment
        const hash = window.location.hash.substring(1);
        if (hash.includes(logoutKey)) {
            clearLocalStorage();
            return true;
        }

        return false;
    }

    /**
     * To be called on load: check if we want to try to decrypt and replace the HTML with the decrypted content, and
     * try to do it if needed.
     *
     * @returns {Promise<boolean>} true if we derypted and replaced the whole page, false otherwise
     */
    async function decryptOnLoadFromRememberMe() {
        const { rememberDurationInDays } = staticryptConfig;
        const { rememberExpirationKey, rememberPassphraseKey } = templateConfig;

        // if we are login out, terminate
        if (logoutIfNeeded()) {
            return false;
        }

        // if there is expiration configured, check if we're not beyond the expiration
        if (rememberDurationInDays && rememberDurationInDays > 0) {
            const expiration = localStorage.getItem(rememberExpirationKey),
                isExpired = expiration && new Date().getTime() > parseInt(expiration);

            if (isExpired) {
                clearLocalStorage();
                return false;
            }
        }

        const hashedPassword = localStorage.getItem(rememberPassphraseKey);

        if (hashedPassword) {
            // try to decrypt
            const isDecryptionSuccessful = await decryptAndReplaceHtml(hashedPassword);

            // if the decryption is unsuccessful the password might be wrong - silently clear the saved data and let
            // the user fill the password form again
            if (!isDecryptionSuccessful) {
                clearLocalStorage();
                return false;
            }

            return true;
        }

        return false;
    }

    async function decryptOnLoadFromUrl() {
        const passwordKey = "staticrypt_pwd";
        const rememberMeKey = "remember_me";

        // try to get the password from the query param (for backward compatibility - we now want to avoid this method,
        // since it sends the hashed password to the server which isn't needed)
        const queryParams = new URLSearchParams(window.location.search);
        const hashedPasswordQuery = queryParams.get(passwordKey);
        const rememberMeQuery = queryParams.get(rememberMeKey);

        const urlFragment = window.location.hash.substring(1);
        // get the password from the url fragment
        const hashedPasswordRegexMatch = urlFragment.match(new RegExp(passwordKey + "=([^&]*)"));
        const hashedPasswordFragment = hashedPasswordRegexMatch ? hashedPasswordRegexMatch[1] : null;
        const rememberMeFragment = urlFragment.includes(rememberMeKey);

        const hashedPassword = hashedPasswordFragment || hashedPasswordQuery;
        const rememberMe = rememberMeFragment || rememberMeQuery;

        if (hashedPassword) {
            return handleDecryptionOfPageFromHash(hashedPassword, rememberMe);
        }

        return false;
    }

    return exports;
}
exports.init = init;

  return exports;
})());
            const templateError = "Bad password!",
                templateToggleAltShow = "Show password",
                templateToggleAltHide = "Hide password",
                isRememberEnabled = true,
                staticryptConfig = {"staticryptEncryptedMsgUniqueVariableName":"fe1579083ef4080b6e0e8a5c32413e152862a06945ac3b33346b29484a6c48049cfea902bc850f7113e08288e1dbaa1dabbaa8a57f406ba222bbed5ac6e03957fbd5d26693934d7d00e50313790773dc5af994e59dd73f4f7759189f5732c471927358b91fdc384e62e3a3dfbb3c2a8c09c77bef9abe27dced7da64c20266942c143ac3ce769edd5150fb7c745c7fa5ce830f7f0dc6a174c71f94f8922bb00b9655f94e28fc7582801a325462f84b45a9616c8b597a431e5293be79d72096a94cf0b4bc59851936531d175fb7ded1b8da636ba5621c51a7bb23b261819c3fb99f41defc2e3a91806fa1c109f7ba93cfe5768d32345bab7638451787f036321c1b23be1adb60d2e60bee06989e353d8a8bee8a678069948564d9ad1651c291032a3184c73b14e9a4263e4517f8c91c65594ebab52d5a2390ff8041f21c18183bb18a71b53d45a087cfd3ab6f68d0142d6595e3cf0efa81ba43007c67a4046aa519cf11310ab09a82fdeefdab8f15996baffa81afeeaefc37443e7594358ac4498c56cc7162a911c0b73383f9216c023cc974039864287c6c844f9acbf016ea179db5b0450a9ce65efa62948019018cc5de3da66a15db8e388ff929f1801b6ab7b5256252f90ffc3e00a0e390a58710f8b02308e6775bfa9378710f351da64b34d3dc61a9b008bbc4ea9908bdfdfc852bd1d456ff8ba2919824c05b2a8fb1a7b19f3b19aaeda54754b43a58fa31840ce893873e65dc3b6d22b0884e925fb6f68d5479e7ccf3da5b37153108391b36cc6a9b63d97094606939748c7bbca924b0944b3ef4d7d0a9b18d3ffea2c604c4931f7542cefedf49cc15a163fa74c101f6448f2d1c2a5f38f2271f6cffd7565f2cab1f0a74c505a5ce97f83c62bda0b12b4b993f208661755fc52ad3487364b696ed492911ccf7a6ce3da70d839add9d05785bf932bd0967772345e54e2786dc074effd0ca0b3ea9a8765f4a8d032b39a5c3c0125506c48b04fa84f4357ebdd206cf5f560fc8c357b591b9822ef77f98eab8fcaf30043b193c1cb863cb348c374dce43b31532a897269e19469f3c063753b527ad341d693b4a37d8ea1d5fd61684ee9250c0a85b95864c55a2cb63b550ec22fe992d40adbaea6f44f2e674f162acac346355e3d5053eed701344ae000feea24c9410f579931aeb50da888417e7017086bc2782548974f8066086148d7ac946b488dada1d8f403aa16eebd25b37ee7522a2c5d941682dfb1e50fa00136d6c81bfdb8f32879263a13fad1be648e08e71759aaee00bee653cf447bd03deb49c832f8c48cf125e084ae2a1b1bee538ddc574207933bd3fc2bb8839856b85099707e1bdd513a7fd73d60d161364f4b152083add73c93727c913329d56e5d8ee78c40099524faae4f4e7a2381bdd05c98568acddd84805c81a63ce28448509010671847d361db4dd4503447bbeea206cdfb585c1ef6b0310b1a38fcf9ca3ee15f3bce5f2607c9874b2f168cd4b1155f98c1e5b850ff20dfa24186685d91a4be2df4fc3b96066d2a62c352f92ae680a90605dc533f7ea491f6a0c3c1a6e206c082f7a1e4dbbfb07d20518abf18b45c98d568f4e18ee1924b116c4bbda8540b68a7e980e7c85bb4928d889f2ffbd9c13e1ce495679d578dc9d0f8d66de97b9e53ed79cb4535e366a9099d7a5c202b66bda6ccbf25c0863e4e9e6184a76862e32d4aedec6498307460912dcac6c3fa686dadf8b4f1b35ee0504a1abd8420359004bfc9205bdcbc7d222947e163701c6eaf2e3f207e08d0c76e1787a3e4e90bc1889bc76fc9c5631d063b263c17bdddfe4c6485a750cc1582fb44dedeef72b9b6472e4d0c48bafd27bfd909e0d3e7ff14de5e62f3e7571d0ce091a8c72623be9c06c2dd3497822c25774076127d71584b2d4c49b0dd516855e087f457e6480216732da27b7752c455effc96a719301f02c5a83cdaa848c1b64ac327b1b26daaf900d0f15ad604727a2b192f59710f54d95d54265cce630a0abffdf70282c18d9a313e775ba3bc6a8986725eb63748c850722654206270b1773ac604256751e06ef495a6a320a9d593afd6babf1f219de6851b40c641c9de1d275f8e0c053eab217ba69ce0feea66d2c88df852a41d979dcbd030bd4fac378a7080aeab009e2a9d592b52e92960e64f11bc80956512ea8f476c2939da00950218994a0ca52b02d70e07f8d2b28a9db4aae6297e88b4f1f990e8196f306261b42b4446853ec831c63ee7d550dfdc24dc5e1f29b6c8a78c11aca5cc6447a09148fcd39fc63bd68a40c9b82fd5606efa8fd8d0431f005e7742f9f37d8a92440dd011b944d7d10405cf9f1dda25549ac24de9188b74bbe3ac3d3cbe07a48d39ef95974be444358780b1b583c788ce67258f34d5529c7c83a5a833f374b8bd6a823a2312ac4a6c7976a50e9c8711f9f325e057c0ccbff1bf221e99365e93bef90568eaad330c1647f9252fc7af505d738fe2dc20663862f379b775261b56a28d162a9d4f839b0fac0f073bd45d6a5e526d22236471a36739caf7144b23b2b9d04fab477ae160ac1a8b2fee54942d379366b3ed9bf6ddeb240c428c53f10dc39f24778beb4a7025880404565cad8f861c38893a6af2c212afa6b10deb77b6ae5cc1b6e2d0651e4aff8642eb6682f52b36de464d32bb71b44ac32dd83c48805039ea273c8d6a77132f7ba6951c49f98218be52083c0e46fed250c9cc1aebf822d225b8ac19f7a4b352d2ff6fa7ec72842cabdef93a8249945f2aea8df1c6b2dadadf479acc100004ee31993e2083d1a7119bad31be84c04b845e52024d9427599c7656da601adeca1c3ba545f83898db7d4efe6aacfee60445e9e7c307d9e9cc968107732dfaf4aaf44e78c812daa51928398f6d81997988961bd07150178c7b4f1d7da07949a0e175611879a265e145d648c7f2b6ead26a242fd1f439650961bdc0028875149f748f19b1ec3b2de8dc57bb796760138674b8195a033a5c45415b6d51d4795e33c1cbc313a31dbe17abc93b230b3070a54b90154610ded23e1801148af591c8435b2be760fc3d6db3c8a2a7712ae575271c0910bd3069d3c3e45591b0c1ff5c7b271142517ea323e54477f1ccd5fbe2871076d4a3edcdac546049822abe1476a1bce2641b9d8120c7072464f4577ee4f609f851c412d4a64b190fccffdef563a192419b14b3152c375f2c15a9485d8a890838e5e72af33799b85fd6be3d4cc32fd8968b9df6d96854697d3457faf8c15bdfc02ba0a793757ac64f8e2abd452dcfbd473f599c69fda6bb43516469cd45de8951b34adb112b7512f66136fb6819408e93af94bd96ae76d69914be9e6af3521bca616afc3f00c064128670be3ef2fb8866073ba3d19b98133c09517f0b5e6ccdd716d999da0c152cb7e587d279cfbc826ef804cd6eec2bb2f92615facf960e11c57cf544bc65b043079d7e5950c325b1c9628c38f8c69bbde690a995b41e6b326f28e86bba120b6ac1c0c5017971b234cefc010366612a2dd60d297fa564535346ba0c15a34699da6be2dbdd1e2330446dc557132d8aa3cd19306dce0875e7f6eb14768a8b2e079c52ffb775909121b1a3656e3c5b70e6de132f76e53a5822410eb60d8837928e98e86bad373dc0a3537f973c3c74b3bd4378d31b02326ecfc4bf9e0591aa169848de458f14dfff20708423b89b1304192563ca77d19e243f31f8dbade758c4174b442bc92cfe7f037776f0804d606c401ce3c23eb1997b7afc3cc95b3802c2ad109b282fb296dcc35d090fd2a54bf1ed6b171b538ed750907133fcfb2ad7ff54f768ecd6407a4db90096bf07792c111a261a3065e1eb0a32aa72190cc35983eebe4987e35c12e28a090f26247184a7dd7c667f61d21b7990eab168186db4a81565a7990f8d05c891cc2ec7f37760838263fbcd7db696c2ad265085288d37f89eda767a45ba540d8bcaf1e8896794d1a77e92569a7fa109d84198ded77400b57a5e75439439a48338413ead72251462c9721a8c9b8e7268e55957d92f92acccd91b1a500eab05d48d81cd2ea47727b3d83a05227eee0c2ff1c2e396f055f67011dea9c50dc2cc8c14ab41ff399a8cc7bdbe5981fc3da9998ef997666686e38d98104b4fb42ded994cac11ca28470f13c623d11bbfe84223ffaae87f763b4d137bf425662a2f5945ea82b87fa2b80fdc2fddf9d3b817226800ad01b24fdc3e83099313c4246e4d3a46ba47ff5ba7d6066df966e1cfed9b34bde0406ca176d4c6dd33622f0aa47050ac08f17f1b268e5ce807928b5301b067373800288af6484a631be4e4f88b1ef6b0600050b07969f07e5d2125e806bca872596235d7a5dbdc8bdfd1b6e0a8dc253669c416e0225b04f7e3eb8b8d8ca5fa2369e01f19122d95cf5f4ec5f7656cc3b828262fed7dc61386df853f927c83ea06927c31a5f7d513901363072b071cb8abd072ebb38061d88bb7c3773b7376d44988dbc46109fd2a2de3ab345340c1a4e44db506209756f634503663bf61e1aac9e7155c5bede736d8ae50b3fb9cd371168fcb85ba049a569ddd0d92bf8003414296e286a175988f4cd45fc255f320bf9d46f8709223cab2292e767838ab858982db2c0594e039261d74e8ff2121d12b69be166ce495681c73579d8432c435ae321c6f647258f5abba95d6532ac8d48d0aeca58badc771a8dd6fc0e5b2c280370e80b005e989e4a396cd701b4cb581cbd1c06eef1a704541c6c55a2ddd67dc9ce5918c8aba61f647f4d34aece00d4d0196be820f63d6b4b2704a7678b293708e17e686687ae362d453dd0d095c0e12454c394358339ffe2bc5057880f758f4e8b2a2982d97b834f9c0ceb80476344792976287ce62657299208f34bf487e752530d6a4720e3e2b58320ca498e8e4599ae045b7347a030587771266255a8d36dfee731d4eab5a6a98bb442ec67a2a395e8b30a15940f25a26699a2b3883ea1b0bf54a31afbf29d1c27ba607796145e15110849448dee8101e0ada5dc641abc25051e074809b7091b311c4184b97489cd45cff9ebfd2adf19b7766dd69efee34025d15a01c6d50267c5b4197dd0144988cf8ff27f93330a742bfb7397377e2a1c82b3bf08c76554a108eeb04ddf11b6eaf5e29bfc245b945efb14878a2ce6641e20cbdec46454fbef2dc4655b98056d1449c1fe42f64a08fd4dc16df51bb4afcf1bdd2fbb28a7deef48b41b84988cf3960832be0a320c33c5a11677b202f22350c895761b776d29721ae2da301e46d1f000afd334772b1011a73e6f4e1c0685f06073ac2b6081b72a63b4013cb52aad37eb9943a446408beacd1801d70985f4bb0c2cfa95801d2433c5c3fdfefb0de37d196e76e5c8abac16ee524f0dead5d36a606af460132adf3cd7cc5a7e0feab46d1f1878dd56c80b99310019e099ba6c1a0f7971022df22e466d123946a901e4bdcbb667eb39c4d4edefeb3508ed792cd4a3acb1d0191c36405308c852293effd259eadd263055c7ee0259a8a30989f7a51066797807e33af38c8a857abb9174c0ec66a8c4fb29f81cfb5287a03f18bc9dcfa19464f6aa34b64f854c5f8d97a5b347b9a07d26a8431b323aeacc1c1591b4a9aeb08d266b5fe46a0b8b839490286268fbd1015c16ece85d27aeea6ce8731b6ce3905513178bb181e48db9262608f65eb5c24e07ae64b1897e49549ab0b813efe543735a07a6f650eb9b105eafd3a385edd68b39413f1758540e6f5aa1900969b06a7d0591f05bab33d8056f6da1374b911f5dfbcb9d41f0ef734037d75de3e06bd2acdaf60cbf5b600499c74892c2c89b7ae39e31474608489ece5ca166d99de254cc7897c03059f16b449b16f00b09af6e9ad656300ceb72b6d257c255cd7cb4726a28981b42af75411623862d3a1794f7b4084d7a5935ee0df30f345221fdc40020466d93f24999e417a8cd049426504484071c08f7339719137a65e51902ffb4b51f78334821d8e8e983ff4030f81d8711aa3db965e6d94d5737799ec27928b6a23b74e944338050ef0c9e216c908abeb6ad1b50969661a26e77f0374a749c4722efcefa095f2b765643012929ac20b129793ef4f8618437e392fd825ca317c07c0be6c78cb29314997c293848788fdec359a548daf305fa8c856c95bf5726f61cc1362c69329a62a5b98424b600f0e95a509cda9cb326c47545664aa8651d952ef8fcc5e0e74890e11c1c9f06482f6a6ae0fe5c868f0b3e9cdfc9e72e9a1e4d850f825ad2bb5e304482c0caf6287e5c45e3ca3f9a78047ea1967456de2f918ad8ef7aab044475ada26f733270eb8e48ad7657fc4d00792441ab977f4c5eea381fe272a14d35deb116477f5a52a0a11a6e7e2b677375558bd5e74fc99ffc16f24080be67d385bd5dc804be752d99307059a72bb810983095731647fff153b91d8a45a6e84e79c93967d5f980cf61e29682e2a17ad451a928fedf02b6b18b65b7272b87dbb0aaff1724ccdbb12d7f92f403bd4d647a97f0da1d327d19c963a40c2b5babbd75aabe923c9eb65ac0dc636ecee59d09ba7c1a4fd3388a7f951431a5bf87eb51f57276d8058ce0349e30937973c44a046ef198dc4de159df8a7c3184492609b2b04029234454ea9514a7a13c24dd877e9c897e8b401e9b5ea5a2ce76dcb81b9176e039a7c43d84cca7318c804062b9d278515e60587c458d5a758fa4effb5f41ccef10923fbd7c8feb5a25ad3896debe32b757c79100939b6eaf0868d2ba1be751e3f7d275977e310c667a914ad39ac99c5a3c8c6d856b23a6495bb5fe1b5af3074fdc58e43f031440b768587686a3bcdadf3960cc142b7849f5f9f032c2b56f6d88f994eb8b384e3551bd41e11df7c89275506747771d6ea72258f1f9e086daba422d92581c4a643867ee96265a3dfac92aafc8e5c63a2111b3e15e15e587130199196a0fb200220e25cdebc5aa7225ea3e863e67421a15eb9ff58089dcd6c7fcfae0dc662ff01d61d83e5aa7d8cf9447e7e798dc1d59de3d0577be07a475c2f9ba69953ba8439bd13f8184d9a6bed2b6c87c0a8ca54e6e9e1e00854e8339bb2a43bd11487e6cbc62602933b636c1f0ac68b5fe399d272a91588684918d9d4c6e574615ef0aec546c48541aaf691e4bd5b1492798dfdc9a2cc204b2572175bd374099dcc11758832e0a8e9e063a9a0e26adda04a50fe71f36909bb8e5a2ef24236d109ccd43fea6ac91e879145209339df27fefabc3f1f408efcdd48840763915a4fe29670aa39629f60bb079cced555db3cb28cbaa9c83d5614ffccaa3f64a2c964914e485b7e6b8143864d73930a75a78f8465ea4ff3a16104c7bafd76f3ca284366e52a75a4ed02d8098358e23f1ee9d99d4e9aa55b58828f69b087c5f1d33ad8d6a1ac27574c4f49c04c6a19f53b2c9b88287689bced553f56a2666e0ffaebfdee63e2134bb6f2d57cd8212a65144357a7225098d0827be7579a556bb2b85cfa45c2d6e84b996d2c1c753a8a1d2d064af072b1323c649cc355991f1f7e251ba156a0f25c43c3606aa3c96733edd6c8f2bdf53f0f7c9ee8a09df7f7d5038114feee22c4264cd7e51bc53ad1cf3dbfb8c54dcbe1bd79d85f8a3399e6d21132945cefdf411163b3367accbf5bac90cbc732c9007180044b3e20f41139b7ddd5f549d85141146eaa326018232234b953ca973baa2320e95498fbe6ec658eba542a4400ccaff8a58b468a420c8907df7058a839a23d2f37cbe924664e87ca9e96ce69a57b1d47df41e327c4df9e208c502341dd53b5ecae9e6ee55f34eb19fcb1d9436e115f6a7d7f36bd50d2c892cd0e8dcae6f23bf061057c98122c93c4336bf1a72b2472ae5a1e52e6c2817bdd5d70111776da4588fb3d4609ba73127f68f616b8a5f20e38ec81606271fc4a50d5c9dcac20bc03b41aa7ab703070aac6770a4936c424b91e75b0853e717b39e46e5d76a62afe7333ef1614ea8a0e9ed0d9fbdb9e6ae1411eb49fb80f3bb97d2647f6ecd0e56c9120f4f72a1103416a97e4f874bb82e172e4b5ccd852cb39de5d1538bf3400bf9ed873615d06acff12213c18f5c3215ed1f0bcb2d8bc141c0ad8e3de65f463b3ffbc14413b1b731021bb3a087f5ebc2d78a36c8936615025da9a6bc8f3f61916c3b853005702f1c57363424ca3dec614ff71b8beab04ceb43c5ed0ba7588de27a31390939a580ae20dfa1131e1e7934c4c5732cde3892eed7def831cdcb32835fea16c59ad9016bbe5e53a7471848632c55193edbe93b1af89fecf2c82e701d3e80d0171fe22ae5391d276831666f09b0c457d5892b5f4c7ae8a9098f17d57fb7da4aeaa513b92cd399bf7b0c5d5aeffff923d4be55000c8fd0a3ee52978507e220886f1074b94f6abcc5849a3061c10f01976875d0af993d83720dd39a7eb2af2a3ebc96007ad43f033c86194da63afa5601d241e924bbae9ce0c5769a71af9df204efaf7a3a9baa9a3760bdc8594da402edb6ef21442638778be7a939560c53010113b7dd34f36624323b890a8f21485df194b62d6350e84c12358554564ea8483ad7c622c10339a698cff9ee840c9038d942f5664353d0653bd37558cd5e5592701853d391e6ea733e131b3fbb37c1ce50a8ee5db455bd9cf68d4d9afbd75faba80c3c645e47d8e22f2503b0ff2eaf20027931fd78097ff106f9795506718b900a0fa071741618b8fa4266abc812dfd6e05555957a53c473e544664206282eb64411022cbd65ebfcb31af417add57bf38b170de62b226d157820736f4f74068a74034a009c88389b42bd9ad8b7be5f6766dc77dc19058f1f1e03c71cc1d09366d9d140f3066199b058c435c17c0c3940b03105ac949fb64e69f4809bcd56057d8d9bb448f942fc2cdd8478cb1b79bd5cdf876a2a6ac43899a68ec9918d99c3bbff9aa0f9755734406df8851078b79ed5af685985645665889c4c7e1446d5b2c92b0125fba67c8bc39c9bde7b95804ca1cc901a31391023fa8853595bb73d1a0d9888d12014003163c337368ef1a449f130a4170fbdedabe8b24d8f8c6b23dc8bfcdaaf3c4e5e412dc01c200a2326a3ffde9f6ee6a87ca4bf825d8c52a10bb4d5f673fb46bd8d4d04fe911ea011adbddb3d53b9b40e82ef4adfbb4cdffcfd05209116776bf98c94199855f02089d4e3a405a7a9c903a8a664b7bf4e951915279625ceb72b05b71068ff3a809be2cb4ceb621bde97a31080bf9def12619ec2ca0e0b2dc6ee55207ac19ffcf40f2623d1829735f2d980fe501b028fb57a408376e0e97d041e7781414534f8808f8f7472c2d25ab65dc89a08524394730ed229455494fa8bd02fc76e722db646010a347de7f3873566c193530a0b9d693b55953ded9e4fba433a3c4ca6eb1faf136a6c44f5d88d530c6d8d4de09039d5d616e49b684ab8be8fe0a851efc09b3a3b55b1bd47f1d8e4e2c6ec44b9821d7628d18d283ca91a97fd8c72a343ddbc07f405e50e5f7a50d12c48a7dab229fdd7cb2a7720fd45535d4c2653dbe196418dabf3d9b5a53b11729f5dfc25770a0b6d0d2cf50d00401797c3f5a98d21dc8dfcb63cab1e39be5611a496527c106745fb1c91feb76ef357bc431cb5324f5245715cf631d040c34ea9cffed3f4f54b5f6dbc670df3d2d01ddf465db788811139d12b08feecdab4d9c85da61d0f57c85d3fa675b0fb71ac37f17626fa212ae9ef4fc070b5bab99dac38e8adae51abc1a20e44d380bf9cc5660ab0399651404b8c59daeb465df8794b4729f9a9d228f6bf4f1df71814e69a73bb82e6a7ef407dc0114406a30bb3956b7d199e945501cb4469fedb735ffd39f383d30ab5140fbe28d45bcfce2b48456dbcde89c806418cd380a8d3110c763eacfaddec7b0ce5faeecc4b5e118a34271b6648536e7369e4a1d10ece9d5c0b879ce2d906e2ac5f1e1f4d0e59e9a0c058526d2bb4a9446ee21a8de03ba2fd45f81407a94f55242e3e52a953ed13c38f6a18c75288e5caa95d8036fd2b3175e821535e1f2aa6595b53d72630cbd088ce146e9868337a598414d5646314f97398c7b4725e57cbf4fda409f6cf16df532f2f583ffeab674eafee9f0761b34df24429acb6dca9933a888ecefcdedd04eaada5e354f0b2bd0396def828a90701cbc7dac6d87b30a089142c933ee91e0ac237942eca8bbadc665c4086d22fc82854c19d4ff31215efd1e3314d0ee88117a3453020545dbe1419f7ede7619c1f3ba822713d71b9fac435025dc7c41ab882027b603123a429e4482392a4ce5fbc96aae3ba822a1bfdd428489282ffdde886caa8117caf0d6b28dd725dc435e64238cf1eba2104745d5ad7dc3744699c51792e5761b4a9f6aed3338269b96b71b0fdd8770d54fff5cb8f784af9201a6f865abe31537b9e36e4e4ba0920cf30e3c97c1016a8ac06453b50b460c1e4a5c5d1ad50e2b347a7ac7237227abc5afdf3d53cdd1dd4a9a508777dff1ecb729c2ee16a452d4feacfab28714aa977f850a2754e54d355d5f16f67d5fc4347e54a29ded5c0c589b51f51bad21a1477e2bf4e096d5b7151a614e596e2f0d7fb74088cae0eb3d4edda759f8e5c572e6dc60aff12d0531c952e56f025d3d96963384f9e17b47e4ae3443d224e80473a7f6e70c032bde58cd6ec503c9322cab4ee7e7490d75b0962fcf2b5c805ab150da3c11915de985000da7bfc2ef3b84eebeeb30e6c503d2600cb85ecea0b6955ffca4c265984b299318f0aaa7160861dc27628d6daa81c40cc26fb5bb672ef22ac48fb08177498d9ee6494922069e427e4a21a6c62f8c82748a555eee7eb50da3553faec52a15c7407011ebe63a787ca3d6c702b7b3bd706108f4b232979ae5ec0364b3d87ae8641af40726b3c0aa7d9fc98004f5456300b5117f40c7ada3cb4d5d3212a2caab0e0c665e750afe0d87893af20065e5bd82952330168f5223f1ab2c490fb3e325d97ac28b3aff69dd236029a8f40e3f545fade0234c5a354a010a103464a2137f3ff114782f50cc4a89851cff4d919fa061ebc6e5544ac4b9078c05f52691fbbfd0f51d9fd2f79eb4b9cd8c482c4d17bdd583dcf1900e29063f9bac1d0a5e73055c24527055cf17146362f8849ab2073a3bf9a50aa1edee53c163e5e325d2464171749e2c93423fb6db156754af05f28fb7a123e5f1e8a6393dd6b2725dab7f790a6e4a75957e8bf9bc299bdc80de70c3b80b8ec7b10225de1f1a6fe7f8ecb36d07dbaccc771752e6c5c859fbc49f1797574a28e47dad0b98367b00713602e6ace258b6013ef66a7ae2f86d20856c898a889524d366f130fe1fb27a0cc373af2b8d618456b57e7f24232526b59deacee6b2980d18cfe87cbc7055868b178e0788102927bd5c2131345d0778da6969bcea86ee7247cc43322c1f60e14cdf7c4e59d86db4210e96bbfec222c6056af18f3502e99ab24880208973ab27935143e1ac8aba45d2a573b59a3697443fa4fd564d87b1e1d909b569545e2ac1a8ff70cdcad0b32c2663bf3d845e70245f3bea15c879709c451728de099dbbdb4368676ccafa0841e25a28e7d5eeb8ea192d1409e6cd5282b18b61de1a4d6d2fe2cf9f87990618e9ab7c03645352d47f643a675b6d6a6418159732bcdb55525a751342dadaed2d3347808b5eb55c8f54d1f84a1a30d201575f83a820c64a502cdd0115284006901047158fccc3ff2324f24bfe58c2709b36beb5130c7a80e937e26cb643d00be10589d1526a0cf1076b2aa5993fd41cc493ac5c346dc018505289175a8147501f7ffd3d1f4b544dd7027dbb4ba01b0dc4562f081e3c3e0bebada2668ff05ffa8852d357fa2259776109aef547f3feb9bb1bdfb8d75c554c7e516516f85cecd73cfee519a7e3f482d18af720317dba427c2bd34df5d95b3261484700ab023eed4864f32509d6b5b1702e624363a8861c8aa07522f6a8c81d25681fbf94b85f5cf0492a57498f10c15a4157f5eec13d12d0d898b763f1006a378ad179167dc6105c9f9f806b974c5483941d5639708640dd05656fde6960225a583d630ef07def2be440f436a089b628f4b29ccc359ae602eb4ac7bef1082da5c3d9d6ee411815e7a9153cbc86a7df8e351247c5aefd890280993e471470a05d1ae2ca4da778d4ec3a6892368e61263df09084646ec0d9c5fbf552823876e1d046163be51f68d997931e181da004d7280e058a0c343431d0ca3912b1c5e51ab702d6c0b1ac4c673811f97a24965c1c3cec973764f17a9e2146625d93c4552b1feb25a2738928cc3923b0279dccdb524616339cf865543a5a82b198be8660b05be2a9ebbe29744dead1b09b025dc1095ea1844752d18e483d689b9489bbec726f7d0a2c5323a1e48504946462d878eca71fd8808441794eda8d4992302d572213a002a6acbf96222b3e05574dfc66185b78469462c38f41e157745001a93aa06fffe8e31ff60bfdcbddd1c5a61aaedba55747f09775f9452891c63dedfc0c8be9e3589bb7dfd73df940e7229cfc49277895ba090a1b0262d77ea8a1ee795bdd0542cd0b87701a1ea28cf4408b651ee014aa676fb6889976f509d4a7f494670a9c31273d95b47533142bf8187575bab3c7478161e9e3669b36561ea94f41208178e7b79b0db0329fda5f07bbb8f79c1b894126b603fd624b91ba4f1452e81ac6364ead6f48ae7ccdc130919248fa247e51e2cfc458c69ef9becea2fd714bcc9e25c8611ba863fa6b68ac7f6d79d8025178bac147895d8758f9edfc6fde70c19685164e0b7b5bd97b91e6f5d4ad7540d579630b78764c064a160605f4fe8002d005eef01faa27f4f13ed11586b6b1e9542e917a3880a3e03e3260fe00ba99ad2956f43b116c858520b644cb7bc1aa5d34f0c3be7492e7ba4c4e35d0d1a36282e5b18777e2b3cf444921381bc3af002374cd037c3181f071cef9984eb01b38d5a496de69b7ec7bd56c95f122d61b1989c593b778ac5efbba6857a5ee00c46c5a26cd5cda803ad73a81d589e93ef5831a40efe4ce4e12b0a387bc7c0167702d752b372a11330ddfa450255549600b96c61aceff0441f2f624b0086ae8371a26355b7d251a106d1257a9c3cf8f148941a7c761e74cb1a22db64014362a03f2b6e8ea128855778cf633f5823eba39c22df7030da0e023d9f6508786727dcb41426c7a57eba2f8acee4bb58a9f93b079c18527b1795063918749e2f6b35d935f3a992f5bf1013fd3e6f4a364ee2e4b92d064518162fd8e607c8918b8344b5c59443562574e86404c16752af591bb0d0a7fa42045db36e10c2472c99bfd1b8408b71a5d069520848264da2990c76540ec55681dc49778965db78112fdd7019e300dddf1e8b3e9e5eca652e00faa52e8f46d623f3d8b17cea9b00b9a42874b6cc33fd704b1c9451295aa4bfa55fe20c89b8ccae26dfca1abdc1d679b66d9cf0e4c1c529fdb43de51c3e4c6672580683b9299d179c88f1d8d13844931bf21d389714459d6719df389ca554bb817f015604c4a618b9f02505cf13c72ed73c41ba112470929d9fe73cfec450fafafa7d3dedf1fab1f969ee6a13bb69b6520f938532ae0bdef2a0c784099049f70d3377f91480d8beaa7ced63cd18294e65318aa26c8c9b91607257d70b3ba233849f628b2be046c1cafb0611fe855462a7c227bbb344f58b3793ec4a74d2f0e7d7509f8f8af462c98ee7168473a2cfe1e57bf6c705fb27f8ed2ace6ac5a16a5de46f0318b7516fd1a752f238866a845a7df3e8d139f95b7166ba725bc03895b03f65f52120260bd8d748413606607ffcb4d498ae08971bde106cc45bf729d8596bb1ddd234c310d6184b276f94376583c2a862eeedb4f0eda2c113e2651ef52a14189e31d7bdeaa0504c396dd170a443318111eec56ee7bacae181c15afa49ccf5f768f47224417f4c42541f73a3263aca75852c889297faf2f7360158487f1973bfd5d6ac56e6098d89b3cfb1ffa7d4ddffdf95bbe8804f728342044ff1c223ccfcbd740677e9b0010500c823461a4bb9f27b31acc5a6b8e4a8b663c51dfd130673e523f78603721fb9a1151e5e6579004f299b63aa41b09a129f7193ab0f0a3808bf1c132d294470cee585d38443568d5056206f23942eef7d8ff2504756ebf790872467ff8c8faa6c519f7fdfdc177c5cd089926b260010eb622834b46212fb8aab3335151cd2efa5a7b3259d4f669600c76641bce7e21b3c96720ae5fbd294ed4dc36e9f5507c7f0ec07e9083771bf7d84411b06211952e7fcdd0e7bc3ef3a1b6b9e9413f2061353b3b1fb6dc6b83d24faa2da43b78723d9cb1e0b93943fdfdb7fd53f20918250b9bd527b9a86492d5fbf2e97c278b39214e23f9dbbc59bbfabe98cce278fa99deb1c9c001fe52bcab033d71173b5b1e1f658665ba2e05285b6d5a86b083ca2350116765ae60dc67a3652a0fad0d042a3d6b5a48c508fe140b4dbb88e331b22e0e68f34e3518f26cf91a485709470309b00a9f8e059429ca3fccef75b5c1f0e630d27aef30fd6f885658aee7953df86b3988315926f90039173446066457450e62d496433bbbf6a515eecdee0f8a61d75d34a7fb0b1e9c56c4f3a8226e4230d89d41a2b68dc667b1d647d38aff15d1a05344241941e0e2b757f20d1441c2e4c29b84c4c6cef7b582de7e5b1e490d599c1fa73e85ab480e679597188f15c25f293245ec04cbb498488af9067c4083599201744a65e03df009409dea76086e2d4bf2cdaf70064a10a1bab4af47e3aeecae5213dc399d67f11dbcf439c41325ddf0c04aeb48c9943e16a9ba9c157a59f2945a317729a5daa0abfc1911aedd0cf96313ecff7579b89cea26d7be911bdb6c4f72759fb38ac3931b6ebd45319a66a341a26a7e62267359afc3ade0e15ba6e61017935811996de1b76385f4201ca9bd3e6cec67d2c4b899252f806868801a000dce809a08cf3221a0dfb2f52ffd1354bdcad289b7d16a1c3f4e280518c994b6d1368746ec5989873eb077987ee69789ac2896f58fe6aee9139b9330a4a67523fa07385649ca0dc400e91c6cc878d84106cf3384103531cce6c6e53a3e2f634518772ad034ef354cd5da0e2d2076533be1d4040bef4adeaad75dade11356f2d0211525a2f5d7d4cddbe30d53b59f5dc4ff981ea749fa6643d9e399dadb099e488cb68ca8c801b0df0e5590a3a59223cef15b12317ba3a2c0cb85a834bf755432f5bf536fed5812f64108f9a163f99c3041e51bc4dd72c6217e4f5420ecbd448b423ec22c4f2e737b46afd510b39923e35f1b5f8faeeee1f3e93820ddb0e2a15ac88447671847f84f90f75afc8bde68b1b61e828ef2ed3c59508d7f78c7ff97916e1c1f16e6d34aa8c013e224918f536d9e5ae130921d1d2b402edc05a7225affd80de07727499a24cb541759f7434dbc9951663e5f3b3a4ca40dbe859b7915b1857a7186f016abf67702d827da9e671882a98aef7016c48d8c7c11204546b3fc1d8631b13858874d14d11e3e94a65894858b51d8a9dcd337c1e8b5afbdef5538ffe036c9d64265a930225f3e22fb2b0cb078e99b34a46d35d38ac0855a93521068e74dafde7c1a55fda99643bbf2cf452ea997f900deddb636be69c543d57c7a8cf95c60a49a961ccc8dfec5b593f7d9ae915fea42a1187062f53cb272a15034027a6be188a86a061b25672af7e73aa8041faa0316e4c32cf1ddf453da8ee769bd2c711065a357942cefb46fb96ea08e5e5436c4feca6cfb9c3b87524c73ecceabad7b691e8e5965601e263886ab38b9ed115107c649a794a2efca77450d747bee949471f278166732e69099a9faf1e436097923748f0832949915d48a1ecc4d9b4e34172876a76cff58576795a41fb2f3861be291d982f675d9ecb7eff5e3ccb06980a2a9b9f926b84b431024030307eb6ad4e648c0d9482cac35102861c27082f0b4fa148e906cfe8cc46cc64203bcc93df1d205025beecec8f67e76d16f6b143bec935876131cc4bde608e9484ea56c676e33a079aac1680a28e6f183d9f93f81dbcee3fc5f833586329509a9e9081fa3a027674fd9a1b6ea3bb6ba4d2ebf0f3eb35ae9a39e6eb98a1e9d6e890982474aff01e9a060e6b484282df8d1fd1aa45c02cf31068711d7ee3475ac5c3bbd920701fefb5b0a56caff6f53afaea58b3e1007ee6d287e696d7ba2ad117a4dc1f39ebec6933ec39203d7db74eac7ae74a9f1da8f2fcc50f046f5ff46a676266a7137151f4c79b962aa04612e6acbc9cd8604409c6d77eb711bdc1230e2d8452d2b717637d573ccf6ee2f90f1caf0afc2dbb833cd1d647d201483bb037a108d3c9b600a86808a37c53dfcefea08c32c68b1c4eeec85b86ce1806a8c80d46ae9818a1855b65f866afafc1b88ef7c27432759b84c12e5a49a4d435e40ab91f396dae65b20d174e71d9a07cf4a60c4d768bfadde6a8b18f7c67b2d029afce6189a9288dffe56e3beca199ef669b04818144b051e72872e014b2842bfd8b843999eeb33287016f519419fb89384fab3594eb505d2581d6013669df598dd9bfcdec4c81f6a376e7a9b0be082785690f127317da9cf45c1a0c45caecab9fb3b0326185de0a98ea897dde93c1b5497f7291ce0498af6e7f79705f0017499f23fcfe0787c7decebc8ca48b0d6425699bb9205ee7a3f047a4eb130e889ea221c41c8b28d3e6a8d05884c8c562f2f249c9b20e7efb4b24a7bc8f8cd1b5a567127aad0d3c9fdb7bc3a60d1f60a4d6d366a0fcdeb86bfe5998026296a3ddfac6c71b50dc913a96481b3c5b1c812caaa0ce277e32605fdaa83f43bc123317bad53f8923a6d02ad1ba4199071d7aae0750f8259d19bed6c9e037f474e402585a6c1ebb9d3180bd24158222fdb2974d9c8dd5d9391122c41d77abcab18c3c136af3eef6f2b72f50529c1f5a2351825fc55747ebaee6b013f310ccfeb45d5ece7c92d11a99ab1fe8c6bdf3c27ff2f7df629f6a4b38da6106eca8ba2618c75785c4350145e4c1181cc7c0ce5a76fe2353df52ee36c70b67e573d0b23f3f338b8c6437c4bebdbe9fe9ec8a8af12360e4dc3e0f2884e72adcbcc56da5d3ffd090522998f982fd002cd5ef2831d9a2e7f179b3185c9868096a5487aafa3d424db245bd7117507ed4fe68bfd5710f95a14d84f2906d9521850cfcc192aca0156ad5f6295be677164551f1cbd990c79c9f61215bbb531e42f9e9cfe01df70b567611867afac481ddbe9581148bc984e8c6256da8da1c51ba9fa37639af2ccaaa0bfc2dd97a3481171d971cd9248580a97ad387af7902fc0ebd0351e19632504bc22e5a0e3e62669e971a8467c702dba9212f6f05ddc9036ce1267ec38898b8dec8f23f342fa5be3947f4f90a27587ee4371a4f90e7eba792f5471f0d7946384ca935350ae6e484ac8ac6f83e8c7d8431b769763761eb61b0aabbf8962561e64b2a7892101f43608e40b9ae4caa9fbf7780230afccb00906bfaed1a94371ceccded83bcc82b9c59db240e155af8b3741b8805ed9b4a8a12a949cf6e9142d55a2a7fa2ec5df9332008a70844c171aac887e4581ab47471f33fb81aa4f86e26dfbd4477a33d0b19c1cb576942cd7f100b82d719d5ce6b9b24f82f3f2ef90b5aa4f365b8e7869a40040044f364b267eacb3656a9b0f10de6f5067233b85b92bc9295dba656b5c58e497f30cdcd0268577590da343d601f33145e8de407a5aebbb4c7bb280091e89a30d36a845397ec1c5e38b3ae99cb3f4ae553079e831aee481ade61dd31fc9992aa53d12567f4be8a387315f3e347f3d05962cad47a18e8d7752e4361db09df28fa52cd45619fe1785e578fec58af2e78d5a7590c40230835de3212ce8bd06216f416b6c2f8bc3a1fc15bd1b64d43c8b6dcf0e5951b8eea0dccc605d8854066ff6286fc226c26fea524fa732e17a02e3141c86b95b01093aaf51528cdf294162b3ece2e4fcf9bf0f43f1323fa8bb49af9ccaa1a34b88465d2249f41adbfddb4981ccab7d9429e17d038ee1e553ec0019c448b860fb0e8e12486d3e2d91c2a163a42f731b537782348be46e623b24cab712fc119ab7c4ed2a1aa028187cffa748b985dda4001c3127a4ca31e3a7bfa50eeb9fc32ba7f471e72574e2c48a7586361f5787a33f8052b8aaa93151dddda02a26bf818bdfec64e0cb3134fd6fc7dbca7911255bef5591d89890ea30517a5d2d3e6ea3e567822a7e3604a8c00754a4e0b7a730f2aefab54eba107540dff27d8ae80615c9e71a7b276699744026ce5f7ace684505d1cc39ed1ef508f30a4c4f6a4a8cf2be488e607e0aee21cb52a88ffd662d83eac6c574466a720cbc5fa2f6d6d8ba1ca449a5a574c59b0a988a394d49a07f96e739da7886c2f763e1bd5144da10e837bd67b447cfb353dfef54893da569b8a27784686bf9ded990261f88da0665004abff6aeae6805c6e5e2a970c8036c0de6e2a519094206b8f09e6163c395980c9a099d9ab82b9f0d92a760d75f860226aa013ae18a5487a859a5a8e729fd047a236c3a924632638b2bd0447b8079003a762555294c64f1659712af81c0cc636e3f1359509d3ac633f8679cbd2480793ec35cf2f76502e2d54656b3eab868940a8f5ee07157a601e4f6cbf4d0d22a834f790aefc4c76c462ece623323efdd64ddf9d15f09fa47dedb7235bc5a7d32b3331c34a038d700b2047d8d8c3dc0085ff3db5a34a191ff1e6f9413ea81db2c97e2693354b12774ea1a8e57fe48f150fd7e379e3bf5bd566252c9de0475fe85c4ba74b994777fa1f414ac9c5fe058deb397809356a79b40bb6a32c5028366d8becf0c2cc84ca013a2495520f7dbfbe7aa3f098d21fa5f9c38a13eaae9e3d2b39e29abe89dac52a39c8a0683165891268a3661c7c279e030d76282e27b47b7fc5e3558da1dcd18d7784dab89642e8bae0f34688090ed6358f205454e2a2f5277869b52d649e493f58fcfba0eecf2b233e9ac11d3e2bf588ce5b497db2d00e3ee21a5cc3a47b586b8f35c983c2668fe8db9e48610e5f288b7f17030a9123a839b46285c7332cde58e4134ca158b78bf3f1290c1918e770173cc47887596c37c74f2698e959037d94fb8648f945d2ffdf8873eed88e739b8182a412f66bdd5ba449de06547759b5ed1807a8a20aa8cccc7188bbb423ca57a0982989eaacbaf176e16c81e660f97825999d8af4c9cf62429aa9cdebe81f8a1c3a3c807a8a3bd68c6fad332777ac16744c5ac0dcaa779dc3b32dce6decc45358f7e07a19517dd36d27284a58787d06d68722f3db0232aaaa52e228f146c787c3f7df02f4f79b1806ed66bc1bd55dc2302e2642ce1f7e35aa91cd4e2708c36d3e1a9e07cc1359b18bb05283ab94d130ecc3a8c1f425d9c2f48d8904fd6cb9141aacf2f8b4b074b68b0e47019ee62720e608f3c419693003692b48d7fae9c073762e83274a942b566c42c2eabda3a17b93d192b2de753163ef82955ab14c653827aba301526a647264b9f02bb34d81d8e1a3a204b5763bb6b746c69dcc99be26df2ca1080b676b2c81cf1be0ca362e574031ff9ed69580dc976666e749ee7cc2d9d566567d36b16f45c038387371d0fe28f89712573744985c5246df0b1212c1d05871bffd4238a07facc35dffba8b6b18b20ffb110e550b7d40a7dc49cc98a2c733dfec1bd99c328301424150d075ff69a49b3088a23b2e03d7374bffeecab5d9ede5b5891f81a0bf24c8d102f76c9c6b4ddde602e5a057aff1f7eb159944db347dfed7fea7facc19d3fe5f368c4ef7b56e7eb826e71fbe7725315bbc4a3b6ce446bca26d1872e8a56992543b83d647d101d559779afe141e14f0a67119f56bff871ea52837b2077fe4c51ded92a750247ad374958fb2de6725160671ac31d835dab8037d15b4713237028bfcf351996e5b69b2e5407d070958360a54d7187fbaf63c3387668f1354416b057d545e8748a37355f871e8191b417515bf99d7cd9ee9195a9682582e32ee7fda8ee6eef1b6a0d2c76476f567ba4b78bfa85daa482d5eeebe2bf98697711a5fb7306ac9e51ef8a308512c7cd38a05f80a4a507901308a34ed3804571fd141695cf0ec099afeaa42f2a6594d20d84c6c18e053849f0f1ad606c63cb789723b7be8be0dacc38c705d5fea787f788bb51cc3ceb07bea59d734d40edab01ef93b9d990087c9a678f7494d91661d04ab7a51e119ca566769a04af6967d94344279366269d35ec7be13e787febfcc69bb5722d8477f09ecf7d7b0969815aa6d9b22fc5c61893ee608590178c858183d17de91f20a2c23739749145090bd0251f1854952f4d4f7d08b14780b282ef2c955cf2128ecf51d2a70a351627437f1b129b55996777b2cdd324ab5584e5219883b1d6ad0b40eee528d04056e5881fcf1990886fcc458d8373c8fce288899ed6fa50dc5ccc750a85b1628830c047ab8d8c35f20bfb6f19a46bde152229936787805ff2e3d4733037a9c357798b9c83312f412e54c80512ee2938995b905901010f70c3aab1196640e9a80bd67c5088e82ba96939b1306210be1e389fbe3d5df9a153a0a81b8c0cb66730a038a38440c76899339626f504966e8ab462236b867912f45d61e8feda68d9308f09cd4ba09722e356536dae72d1d2f5f59aa51c032a7d11e300359ddfb50c3c4016283d815ca45700582c4a35972bf35830a08daa057ae7359cd501121cfe7eebb5a96d60e79888d5d472dc9eaf8af892da5293c21f2d80908f59923b5431293d6ad8ad5577618ca448c548dfff908e7c5c046ab20594f9ea21f80b5fe70a435ca5f7c7a33792eda76552b53f0dd006cf24c68158f8d33196615f6e28754c0f9249100b980f759114f396f318d186d39f3887cee4c86a12500fc76c89dae8d95f2c0f90b233294c8c258fcda96240b8bad517038f114a796e8714cd089f87c04e5f44933f9b044e616227f826a8a806639c5e1c856f2ddacca53dee4b990c8cbb1b8bd21cdd482e7e6cfdb4d03d013fa057643e723aeee7fc50717b519a515c0cc02c4c31a70f9bac5a5656456e628bb9049287061ae47e515cbf348b4d2824f4e50320cbc38a4c8e2cffef7febfee982dd421b94d8d3b33f6bfd835e80061059dc436a1a8d62fd2dcdfb4d4ad6eb83653ec2f92608b05dffd581e6de6e97065724a9a8ea45f157145b83834a91efe38f9d1df89cb3c62684f793e2ce477cf65a76da3cedacedd93aecb5bc54ea2086c6ebccade9e64baa7c55a627d4aed2f1184a50e1c35dabf356bac48ab6bbda280b717d18f879cb071462f5d883e72bf1644407db2a786ff615b6554d0a06df82be5adf020f6f00db97c403b65e17d3c617a3fb3fbe4e9d3c5a418251dde787f710cf3fc6e5a706d6033f38cf3e3b4bc616908e0c6c6980bc9596dbbcbf1e7d0fd3ac5399bcdc967e25a60f67b3d9e8e561ed630c0db39f71fbe34fa74ad1d0d3d694989e08021b7cd152fe2928d340ef6fb0e25f4e060f73b128c76c85efc1ec4b96a31720c471ed7e5f3deb1925b1aff33d4e2d3231b00e356954599e2044baf2f8788b1d82193007c1a5a357de2e221913a73f884a36054e829f381b945565f440211b765674fbe14ac44f6100c0122b2b908ddfe90e5c0a6360badd6a1bbbafaa082737cd5b4886002b360a73b8749be6352de169c0bb4d7ce6d2a394a320924533d0e3e2d5f28797072889d0a98c6bdf947f5f0fa0208b208ac60b7be2f1ce483bc17b145752593e37d631d6c5202798af5c6b0df09975b285169998e97a696d258d0d3a89a21e2e861cded88a2013b4a9144588acf4e0b23b23d89af81edfb33dfad027d3d058b83df567cb6cf14fe54d9a9203c90718540f156b9b5afb8816b9f5bc2fd1137d314d76aa777f000f1e3f774dd69622a03d0409c581e359897272079688aa6ef9f74d823c96aa5d78ff3e79bc85128f39a71b9e7236648aa83d16ba048533a8d3a8940a80060ffe43df34a3b975a63daacff7dc838e8cd2c2bc727e826045c44517ccb3d08cf6bdf64d06f035df44afc327d352d28a2ec796e9f00b16681531ad98375cbc522b9a30f51a414c39b14c0577046d2748b55fad43b9ab7788e3c7688fde7a2c04e05adf121683fd65e554ee617c7408464113f2a6cf21168ae7af9a47a175f5889617a17854ada9107607a4233fd64e036857d0bc5f17b64d65244f1fea6a0435bcbbc2b068a25cbaafdcd018510c7db292eece473fd272b1b419792726fd59aa9a332ec921e0b58dc8788ac166613ce835923533b38cc92ca162f7ae4d17726b392b05a93b6a406ebfdb497e5d1e1fc497ce56371d0f0995177b4b5c35b991987bd9ca8d6d81df9f9a301f197648fce5aac02dea484b5da99c2d0ab9600fc01594a86677d7c32708394714bb58ec104e8c7c2d6622013125b21af00ddcd4ccdb228457ba76ce1637c9597feb64e035d8e82ea6a82ed9786f1eb9cdd5d2b91ed762a4b7dacd463be4ab905d2dd542493531cc99b40b9c39bf4785c11d01fef6318bd8b4e9380bab9919b2ee68ea6b6fbc9c9fde43063b83d256d74e905e85302bc86386e04fd38f5edb239564bfac515929eb9fc7185e5e57cb262dc5d32fdaff6fd41ab102b10beaa96a8fd99494c4d1ee3d7a1e891bca85c4621fec11a0118b96cdf6c0536c55bdb77c506666e175a3a772ee26ba14c4bb053af4aadd8e05575eb69a6946feb23e4f4fbff776aae3f6a503563b05712d04e109ee3a9fdd9efccd75eb6f8e0918112b598b4a2e3b93354041b2f49c39f5079d19b75e92dfec0e00f725b99ac131f6238f1cdf7ef797c6440004182661351135add14e8731a0ccae4a4c7250729110c0e7cb681b6affc98a5458d8bc757faec5bba3cd88a8ae0305dd79839d9efc0703237c3dff0ad270edc5696d1115321e5d4edf5da697f5b5511f0cd6d87a07cba104a5737f8051de830a1dd8e5e0bc1e3aba45feb53745106092418603f786a4cda832575761656658ffce972c987eab47687ff341b51fd712e6a6173b6cd9a1d7d5c369a69a5cd2ecdd63a8912e6317b1bbfe3444f3f2ab423dea62970d6aadd848fa8a94a12fda189491a0597f15c3ffb64ce3c622f455f122b3ed01ddcf441cc76fd6e889f54e1070966600fc62a938851f293e2651799d33a76759e89777eb9f3b845c1d62ed2f187b4e48a72b162fbe895b6dc30fdd6750d2d01659310bee21c55417df652402e2476d2cfcd52cd85742b1b994e46abfe6ed4d63a38bd7f8cff4ee60c911453edce64a971369a75d47d11ec488e623ae35335610663b4568efacce2ca38018d440d9cc35dbd6147922a24d3b690d6c19aa61d8a1e84ef28c854f4dea50225a2ce84bb2a65f5327954274bb0a699ae6c4d81b6453e8755e29e9ba9aa1de7372c55a2ca23f6e374e71d508cd9f947bf4f9a7b0121482327104db77856bec69f46db97c912a22746451d3d1bcedc8325552e08e0ccbc6c388b7809dade9f2a8ad641039f74cb03a973eb05e736e7c70aa38fa9fce23a2601de43d11e3ec5e22d3199b2486e6a75f5eb55fc5437f730296a3a429e0864e47ac89ab46fe8d0cfba90db0843acea533c2494cc020cfc42e2133998809f1b1d8a0819537a7b95fa6e40d94b6f3972bcd8946deb31b27af08f8608db9ea415c0c33e783fc87cad836f55f291fc5b9e234ff98f9883c8c4a3c8bcf0ef9a54d92fc55c57b914ad37a1cb2957e7793de2ae7e6e1bebc7348c8931704f7f91db405ae113f239a7a05400a0d26f6e07a5938cee28622a013267d00fcb14df2e25cf8a669ab9e71eef690e01b2812ee4c979d02fbd8402970485e969edd302dc8dee97f76f8cd01dd7baac63535a8d4d8b0f34a609ddb08ab5f5ec2a5dbdf450c5f3fcb4f8a8d0106ea6481051b1c521c16ae376ba63bf7c8b5dc2fc644083cc2b82bd835b1dfb96921a538ee13eec199861a97c6475db88ab9f1bd5d514e3042c6d3d17d45e921f5f20659b308e5a7a4d97084bc928212e47bdd4e290de884a1848fa5a2b9ad6e2fbcde87d6410ac81eac3c00c0c48cc86f74cf2ae0d30ef24b6c71b9b45b71fa090c10f69a6d0e11b99efd16bbf37b568d7564e8e514075a97667f399868eb352b217118ac9ff7ce4c82418ef4c61677266f49f628ec97e2da23d2e4d64f26aa707b08f6a23c64f5c260c185effacef9e630c47cfca91da0f93647f8cbe1c9188f0bd3ede84840b32ba63887fad78e1e513be25ffac9ca2031c4ec672ade7fb69b1c4a06192bf1fceb6a001a679553e8e2438cee817e903d69db67405fd73a39094376d11e54bf599a87b73d19cf800494664e570aa4d51260a34e9814735dcb356e595de9178a9b36eb7824ebfbd09954acce9ee7ccfaff0f607fbb43cd225dd188e38b39ee45957c6981220686d0d8960a59dc110472999bd864e9d1fa455b623f70c40df7a9a2c792acd02322ba1c804154726ffdf458399a556d34df50ecabaccd1fb873df8a61603670350584877448354c0bb756ddbe5e0675f73d5f9de896893ac462aaee3a744397d312e9ba418ffbc9097506280c0571c43937d1afe9387a6c81b0424e594ab3b580309f9d50d9444340428ca46ec4f3d7ef8eff9a81c76e50bc44589f21cfaef4d4e61ac30aee4217c8348fe9a5218c08d74ac36478792fa94ead0c91041fc5540a90b5811689853cc065015e21e963da45beab7fd1b171c3d3a5356e7a6902f6ca9b55015faab2820a18cbd3e8a9ed025f0d538fc7d366a4371ed93618bd09969c3404ea5a736c5fcd326acb7e5c2b9de6d95ccd2c12137f406b9a07ab323864f268a78810d9ea92c25ad9a4120799b874af261140245020f9b5e2e3e0cbf51184b31d1661cc0e49ccbb16357f10df622caf5bafce6309eb33c87020de40bdfbf46dfcdac42a7d10a71910682dc8fb7783c51e914bb0a95714353d0986419c76b93d0f735390b983814b46322739b260a884cd98df78cc0970d0cff3d94d3511b438ede7bd8cd9ac7f0179f33cf40a231958c7288397db740b9c2ecf219aa1d401d5182718fca6fb183a8714548c86c17c6d36948e7fa7174dc2dd24e402f25b8fc57d6f9aab049a82ba82498683575dde681dd181e5e8cb31be71d0f8cdd27f47635f65c65f403f4583044d980cc5faa5e09a2ff2f1254e6058f8c4aff1b44cbf3d93e7b4754a06156ae5586acb4e38296a35d579407452a56dcea8222986551a264c0ba4710cfe8751c8f26c360ee8a425f1b36aad3d85f731f12f75b5e92a1ffa4bf3b25bf0260154615d6efd4b49126a75d417078913e90710ef8969578e5b909d78c249937c55f805b2d141a6a90120d07628712918cd81f5f364f74994fba6b5124a356934ce1ade28792e8c90b35946615693159ee65e21e1e06ec2bbdfc61a51be5abea11e06dbfe5b72421306739a4c2c4eda0b448bcaa2247ff611d533e1896e8286a5501c22acc193a046bd4a50a0e645524fa30508605cf0f892855c10b941303ae1493a55503305aa51e406aaeea4672481c74124bb3bfa9c839a459e66ef438375c5c09c380ea46d3dc32addc302431ad9d5ce21470087df196c41eb19fa292fa61f8b0ac8788beb944f923956a18ac31bd537582f7fcbfa224d8328ae9e3a692ff9d02113e4a3df77d842f139e5a65f7ba17b0ac906cc17b289006bb08656e43c3e57050892526f43d046d351bfc73801c6ef54ee080689d077459f7cd6852c8f10a50db8633f87eeff66b4ccf982227edbf3e8588abe18b7f8bc7b51e5fa2eb15f722c9b5eaa810cac39907f73cc0fbbfa3ddcc15f8d5c64bcd2ae14586e4acca0ade6326dee43ecd45ca8f515391240377374bb1489cd14e6d3678c1aef81be784ff5086d1a1709745e4ab58e5e4f7a21420294419d571c08396b2ff5fa30abeff2034e1d5f818f6a64cf2f339d4ff030411a3d6c9f463b49f1dae5ca7a3cb36e4c46fe2101e006dbc759923d321b37e3c17d55dd77a7a2af90530269f580a455d87352362387a70e006d50dac6c176edcd49557b9923012db49a80772b60e9623b40bcf79a6b72390c7748f7d97fc114ce7547ec3aee8b29af61ab33a482b944d32865d82c6267aec2fd03d7e9054a8daf4ab4a6cfb07ae9184ec78391b701762134fe9c2a5b7c49eaaffd65bbf3a9b1eef184ee826de5c49219edbe5f2a518880870fb7a01982e0bada790e8f2bc745be7bb0234ff1ff7a011dad6f8fbe0818df52df044620bc6a1d1da7c672046185e06268d21f55d217b1f650001708806a6369139f03770b1df506347c4993d8b66e610a841cf100af4ab872480a2426bb8113b900242d1d27f2e5d8de75a5d7ed95d04820a650895e3c48063b741f34f2a4c54e26bbaf5fd43186038e72eec7c9b658229442fa3d508350b31ad99897708b02786d14b2af2b6231e641c9194c988a35b8bff1379827a5301858397153a568c845b8db4acf0bd1d88d45c7df99b662240225d13e423ef99881c215811af8833930055360aae8f2d07e9071f4863d5f27c77ef349bc901f29ebf7da87bb9b8eb9ab5b76b16840324e1cd6b81839364d9c979df3883666a12448de8b07cc61e07cee7de0a809bfd6fa7b187b78bb0fdb3b15dc732f125f43c82fa223853f333d8efcb0e00ed7787172e6867e34bc067084b9c2f145db26ee3e9dfd5190372345a90c8bce50bcd39fc3f1aa230d048b19684bc35dea0856244d1533036fc492ea014bf0dc4fde9a6032f228fabd8d4a4540acc9058fdf248e89199c49d45e2b1b5b0df48fef3a67de5f9e59c42fc36e80c15c91660b44b30576f7bead81e4de18e0d09094348f94c006b08e5c5094aadfec7d8926550bf8cb4a33dd137b93efcd7f7f684667660858f2f55b330837399f1aad3a60b452fa55ec3e9da102d0798f820c5e55010cd730baf2b05ffa115a23f67ff9b08ee2ac5b9947329af7b92612f3c26ea713869f60fb067f0a880223f70894117fcaa69600dc71a601ee002855b9b3f6bc032d6fe8171a26622d3e57b10d6f6a63929ff9076c735f4615c2d0d487f37df5098cfef377c06763599a3eeb3060fa41a2c65f7dbc3ac857badc288ce9ed1b8c990c6feb6fd3bd660d8de678598db61a9eb6e268b04b14f6e63062b208b3a29cdd2f69a5352c20118c6906351703bebfc3b1133e72be2b4b9ab426740be80989b75a22a61669ccf4230446a5d928bf0b280a62ea48f26014549f09aacbd7967df83eafaaa3545342b15d7131fd8bb1ebc5250d564850afddab80d474a18a9717009a4aa6a7e84c62da6f41d46bb0c0f0131fa99cfc164beab2bf65dce47d7c2668c5a7472f68a798bc8f62519d5465e900125b4375e65afd8717b640e9800f46e96724b165634b41f58ed52ed7a199e2c59637da6748506ad6960c1ba2038eb356ae6519fcf6bd8f72eccb38e7decccad1319c99b7a010529dac7e9dd04b6fc4dbee87df5377ced9003948056fb871e09b43a1f837edfcd1d8f1de9e89391dbd39f461984cd36216c536c421ecabc3f06207de043bf6b317b2b4165deb2366b1f48acfaad4c5ea96cd57ed1db6e51ce02d21a5b40deeb5770a7e0eba0bab906131f785d0e86558f7b24e576d383608e32c8c2330ed8e74a93bdb5eabafc88082881b5cd615851e6597ff29b44629cebf3c413bca1eae1463a7fbfc7b57b901273a1977c363469ca1938c5817fc5ec5e6aea1a80a50c8f9bd465d1771da98379440d51314586e8ab3e11cff4c46f4d126cd3e05f608555a835ff2254606295284cc8e4addb9d73586ce5785aa62888a9f79bb3bff56bd7bd3bea9499fda7c0f3b6bac5dc57441148cecb491ee35515e5153ba02708c436a9281f802ed64e533e241f140e87c1fd1b9ebc4c4610b706b4d3cd43022b7a9e1cd2e0c20852fbb4fd2315695cf95986c4b517914c0054903baeae0488d4d9e051c23b5d1e5c1d11a29533b3938778b2a2aa513ce17ef0a2bfd79d83880edfbe9ad070f733035061edd5c5f1329f3d50c29b0be18bc48529911a5dcd703b8718ed466f2821409d63525f618fe5cf35ac1f4f9b2248878bdf91e14656c0e5befa679a9e58b31883c76e086a54dbf27f523f9038b3f8aaa5d70a9582199e0a253ec6283427da443454adc0064c3ed3745f24b3025f856defcc0edca46a568cf9924bb175f328e146b1a2bd3a15abe84e7c52203341de852025f846e3742849847da421b3354b636471dd5a246d53cf48463db59be8db0f57e5f9849c341f6dfa3926304c74fabe0ddd35a1b0a8da820639acef02d25ce20ecaa5c4a5654f9240106267e1095ad92d2b339c32b4d4aefd32ade3f3587c7e44ac946523703f89d24fa429e4e35613e586a0bec73395dd0d976da1bced1e3c80216380fb84c2d27e60349550885a61741aae85cf04b380cfe589e7fe849ab6944dfe6ae4dcc3f8d9570d34855b14e10f1d82270920cc49dfe1777b3a0d5a8612e4313fbdcb0707b54056c53051a0446b0cc962eefff6c6d74ace8b9a76777170d1c45d91800654275d5cd2054bb70a9fdf228e26f87e0cc54320199057d7c7f21907cae15cd00b4c59b109735f242ed384a2ff54b1f5e6d9d9bcc63425199695ddac99706cd5e7dd6dfe491f2b0bf2c534d7ed3899702acbc9cf009add20546fbb4234d210d2afd9dc7e4e4e39e511aa967394967712d0addb93a1c36d4c05faebcedf22bbb6b88c58aa690e1d82d03d3a22376b56d74cc833c7435cf92c8e9b51956eb3657441f8a1dadb13292714dc4fec4d78165729f5b1cb30fbcf89fa04952d829f213c411ad99a8d31e9f4367d220c805b1113cb9beb20886b01b72dab4fd87b1c940e98cc5fec96101467c412a68f724e1b959042684cb36d7ef672d0adbe20e2dab5afd74b0e7d8862f0dfb96847756f264398029fd59d00aa40aea8c80b31e3b3ced541b1732b0acd1f966f0aa28fc1d5d3f2bc3bcc0cf9d02778955579e838cc4266dda1fe6a5d74eaba6ed47352938e5d85325082cdad6e5c6299d49e39c5ca99df64c292ea800852ef29a0ce6b6211eea3bdbf8d98a095411c21558226dd765823855ae612f9c91182fcd53c23d66764f83b870ac3f65e85cda720b097449a31daa49ebf8250d2103d26ab1a5234eeb1737f001d5f976e847dbfd37a1db4cbfc14d9b36207f2e3521a47aadc4591ac2c99a42bcf5f633c256cfa7e1239c8de0287ccb56a4314ea9870496868461102588e259de3b2d412cfd9f383b097f2d9f04d2039ef812259f2b45fc87a84481b25092c49c0593e8cf31f78b184309b1a5ba81409a68be5b1be862989a87345849be5af5e4ddfe7eb031cb4554f9563c83cba1bd6af6a1f3dd7478c749e5cc916c3e2368ebfb2c8e88cae89f16ff4bc4386fe9b10825a3e3c31b291f9e05cda94c32cf0b7122797268499f81d133082e97fe888819a5de2a0e47d7080c2e2a7873e0f20b383e2347c5eff805dcbf5b1581b8be7c799cdd755e40ba092a997d7156dd3e6b6cb66f5c1b995769b8f73b913762195a4f9e34648fbcba2cb40e50ff9445020d4dc7657368f8f077182c6f2a51310d52bcd30dabc912f00d913716e870787547016463ef9ccba4c9a879013b7bd3dbc340b7ef95b2461768cd1b45d0b0d35daf66fab956fadea5b98cbf150502492ce5caf9851f919b0a7fda6cf4288110ef437de8311f3bcf73f1f721b653decd659d425f5937b1a264d4df96ce910eeecadda797f6cbe9ae862e234dc28de8351a64560d1f89a40f6b2755c39e35371e770c8f7b36de68dea8b45bd41768ff61ba0f782e7d81b5b616e6f7965b4c385f6d197154c349e7f2cb10ce8788a13781a494da0ea49757aecd08c397261ce83ec70bc398c2f0873c71c65dced954921fe4e334992ef2bb075882d97bef0f9bb6ab843ca088fbea43b9ff07e7075d40cc24709f1b298a73923e7fa4143115f070126349707100ccdc2d9a7b1d5982177ec9b04e4a0aac087c105d5a993e2d360cfd15c827d19e0166d54d28b498e3a8fa192c3f12338d70a26637fd58d85154bccfcacdd4ed2ad3662ac6415396df25fe6d80aa9d394290d49387c6bc5e540bc36bd058aac680a38b7458257ef00e2904fddb8d0caa1337b9da4826a7c7890cf7216c035f017aff105371d4dd8d1836909cc49d98ca4c4c111bb323d4e8807b606fbbdfc6ca312bc00f54c190f6b219d2bbbb17ad32de53c010484f8d87d7c37cb6fe9b15157419c805f28d08520d121c3d5399ffc83a5cf281bde68018fb83e4ed18492dc57363cb2e5fb0f8c231c2dffcf59de8f289dfd765c94df9d81138771ff0f03e0ec1e092c1bb50f8bb9d0165572f983433743a8b238e37d85374ca103063973da97cffe2e1acbc4ea36549aba174f1a5113e69252e8170ecb945bb2eabaf487685a0ce65cc9f4489bcf71c93829e71ebddd5c8e280dffd9e374983d08c97bdb04b9f1aa68604ac79fc7d4211f93674cff05f09e31793f52f2104b5815767ccec47c686ae4954f26aefaddc11da385e4a8c269eed9ffb2e254b9811bdc63c665c9883b053a4ebde05139da09c4d3b41745d6a5897a74f3ce9eca5238cd4ba987454978a115f51a3c09cc6f40d953099c193db2925759ade7caafec9bc78b6959bbe962059631305c13ef6fad364804b06c451f10177411543b51b8beb7f393a8c55ffccec48a1373243d0809b350fa3619f4fc0ec73f9f194b3d33a5aa00fd12d721f07134fa8a5e221b07772bd194aa28b858ea53953d26bd880fb95978f97e513cad7d3627c4979b20c635b505b6cf666835e1a22cd49b6be535b688752f680d50ab4d0683fa1fdc4737888414e2fd6376e1863336d700a3944e5125b513537e348a57401bbabbfd31d964159f33c7400e22683b3490416907bf4c16c7d508edf031c73f693ea4324d05cf01707415229238d577face73664bb26f66f80682afd62a4f974be24a3fce5832fd5c5638df0590dfb9a46c2bf8edbdb70cadeb7529e2818d504585d5a21c76dd10d8ad6ef589c9e6f24f1d29c9ff62e500a1d5e266209357d41eb99eda909eb9b89dc1b7cdc22d4feab0082795c6ae2ae4ca71e644144adc21ecbd4d885fab46fb15e3c0d73d936ee0d81435543be20a373da5ba4805a9a7fe6ca8ec9b0e7fa4b57cd3b24f48b90952634773ae7abcac898b464ec45f26b7042698f2235710549d7c4e05687111f8ca71e995110be9b1b830f410fae6304f9d2521dcaea0fc94dd50376d6b36c1490a92aa097db3b0da2a2e8bd2f2ee2d9db621d10c9d86f534c21aacf6532a27d722b1cb0b1ca427eb2ace0a951efaf37300fb7f4ff6ca12271970cf03a3c52fe57f83679acc6137b0ab2b6eb9163f34b5d2e38f4e34a2e479952d13de1a5c4d660c5f57b783cda6a6f6eb2b0d382d8a61c0bc3c4d4000156d39033611caead11013a4fa6dd9bc7cdf0795da7f33b1798225b6e9761e2e4f0a35410bf4847e57cd4f58aa1a00101475eafa5058f507a3efea95701baf09698832a6cf13a40f22b91e5fc189b371e1e4b64ea4042728b6016918be6ecdf92397ca612dcd96e6046d33a8d1743cbf84bbcfa6a71f45b8a71a41351dbb6bf67df7526ffb815c6fcd215319fff66cfd8f7cdde745e82baf8be2103b8f0f228abff58cf086c89ce11372fdbbf4ca28aa534d1ec0af261a4ef7b5a26eac7b19fe63ce4437c0c2fd4ee35a0064813fa0a0978d9637ba759723d5eab0b8b5633473212612ae7f71e5d9d4c6d4c7c5e7ae329651eec4917969e2bf49cd0439c4309d0077c1599ee755a864282061c13c6dfc78d1ac7a66ec14f7dbb9ad37f709d2b4de76ab14fd938d3c93415e14319bb35e57f257663f46133cef032ae4acf602b3fe3e812b25562e029766ca334c3243ff1000dccf3c87024c28b0120fa1b4693360357428b4f1fef2b6622c3b5a9a8dbd92caf5203a0fa298971be7cd67e012b80de6ca68b5f0b360c37efb30dcfb498bb50e347e3ad92661838057c163d5cd054f29a7dea96f062dae216cb400dd753db57f828e7db221be71493937b17cf360798fcfa37d3313a8f0099214b81214dd18a802af600b4ccb2507732d133038e2f1ccdaa5598aeb1aa41d8a47bb797a1bddf4440393269405863801535dfe1ef1ce7fb98c5a26ff4d21043c87628abeb8c4ec9001c0202f5a46dc3aaf6b5a27a033c13eb8448d1cf903755461eb4f315e53df1bd397444c49f018298c30c7fa9972badf9d1f866b15cae7ec050bc67c02b0312e21fdc0874b059e6726efe74e833cabf7e90299d9b4473cb1b548c349061e9a494705ada911101e62a03f09da18f94c07179fb4b8a5f884f24e2f8ce34ed53afb4936be43a21e983229892dc1a5693aefc37cae1d38c9262b176b6c72b41c989e03bb17e7e34f937fc253fa53a71132e9be66e673e2dfab87b0a7b76af488b9a81c68fc31974a1e28876f7a0d42cc62aa3444e351c5416c979aaf2da1fbc809c8bdcb44236c88b043a7003f62808bd995d2e17d7b4e53573147343b627146e853fdc6311efd4ed4d9bf7f9630daa7486939a593a83e67994ac093cbcba52e3ceef201f686c1c15101e9838dd345e9122da0e907a251f7d92516c6f7110d56882dc146251448050a3f37d76f6e4df2f7dbca21d3e12d800c7cc2a9c8a68af0f319ec4fc9169fe6659676b49f7c8ebfe4abccc11c13369cf85e383d4bc5229533122cd4d110adb4c4f2fe9556428baac96455e54b84d5fcb86217a15c36cba6765032f7617c4dbd427bfc722cca11162fc9a9048f51fe88c07b7f743264646683842e26300317b4c7318cde29f390d2365d3da2b597553da17649d214970e5ac89c7e5c0806222853f061a549dffeb194b65382998822b8ec361ff1e7b568c52d065c36b8c483a8176b802f305a95170438f42885ce28f4058d54790705ddf66ddc90184a74adbd456735c5d8eb3cb1d40b80b5a08a909310a13cd2092ccb1609d477362c4a57907dbdeb3eadcddc46f3545b53679a01d19f630720718fd2557aa430fdfe8f4e859de46a010fed1bda71f930a491fdb45e9d5554bb0373c840f551e0ac7cf8d2e103b798d99ab7758ddf9dfc3ff93470d81cfdfe955d18e44046c7a441b005d36187fb6577491c20866d172f3b01c139a23d14b6cdd30ffcac93f29fd186b6c1bb05dffaa96ae4d6330c69ac23d75995fa5d8142b54d54adfce53a0ebf7eb20dae9c61b441224135851e9f3b8388dc5a1fe7ebb2f554ecfc399a08e572cd2b711b36a8fe358082f78b6b0dff877b5b5044c0b6cae0672c2863f7477e02fbf6fd673dee955e90182899e18e28dc76e00b4792affb46ce5cb4f5f9fe322c889c3c36219bb995a3746908d61a92c4f04f164bc36263917119269f0359b0b7106c7b816e14b7829e33ba478aae47559e0a3f2a9da22b7d72ff022f92aa4c0b71fc873fb331933a5b3eb50f142c599a4b632e18d318ab6aec5c1384526927a5962ccd51aa18bed222448b13ac998718da410ccc66e33fa42c817f82675b2b6c7046ab9f0e81e275a3331e135614deb932eba82938e77c73b79d67349c95a0fe4c085da7a962cce56174601299ec700ffaff4569a3800121efc159f0c624ae2d49c843b530308549f937ffb8fbe3c19ddd352718b37e04ed36040ebd9198b32d9b0ba2227dfd8af5e5bafe849048385f21882552d96e21063d97822529f3bef009df6b0f79c8db1f831c25858cbefa10cf8f4c9946575f4bd6ca45a334caa11610f7c154d437af9cc61d9d33e0cb5fa7f5106b9231f7227dcd38d5468a888091322b5b29f736c1976331c43e438976ac5acba10523bb811ffd6b6012a4680611eb812598c4da76077a875cb915da76ff7b6c6550b9496f027c6eb58b57b48f20fe235a5c4fa20e0558f63cd6f432923603e7bcab61d25f0590b58cd8ac2a917387d2d28faa4199343a7a0a246854dd78a8a18f2b1fbcc027d21f67b6afb2dc6b9f23b896b74e31b577ca65a811675b01ebf1e0e12b91536fb437a2ae5add7c78256d3b628d91986e0e6a25fc26ccb46fd9a996d78f90528bff06efdff3d577714074aa30d8cb72b960cf72070b6b7c59e3346b659dd6d11c49ddfefe5c6fbe88955a76fc3fb9161d16f9a07390fefa815077c4cb92c2ed8bfd504583513c3d10f2bb647ac25223bf83025a1d5f8586bb1ea3ece9bd8d435644fe206e20c87a59a44fb7a05d0bd3e1ca21d0e5b55d512b7b64650db1efe7a1782d65d301d7c535608872ae1a7fc31543d024394c84964be9baca7c6db60fcfc99ea83a0f3c009939d181226145d7c0b7a98dadf2e467dc46244bff84720f9f56dae475392e84c7b27e5f2a3b9c56e3efab464040cfe738729389c5f2fdd6b6d244a66305b30a7f072253ad8b0b3c72aebd168723840c044004f357cd6ced769c22659efbf49af1398e5eb8561e04241df8dd7058879ca6342303c9516bd7a6cb5d7cbce9174179ed1c8b4b683ce07ae96d4afe9846261aeb10e3bd88a643ed75b24e9f34d6a2225433baa9f286fdb4221432f73815d6939f26919c2e6dcd543e523366a38609838881e76fe5de188f55f713933139994976353c176ab1dec9891f67ef37c9a34b70e9117db362ed1c0c0732afa1a1d77e62c4806b3b06993acc6e29c4b8e4ca7722ae0dd4b2d6f80c3281e9a953437f946bc2639db9992aeb00506927addebb2b8d38263a44ad78ca3a742b5b8ee3fc2a082a2c2b72f0738aa26ed7d665b21f42d772e8ef83d19f88e38e7522d9730d15ab0b3a1343ad9636ba5cd7fcbe40cf83976a082efdf1a4527cc2f67e77674987c97f0fbd1ff109774d1b826fec8a07aa4751434c00b001486fed909b00029f2367618e58cbbd6f049f4f5d9c4e60bff692fa9c40f42c1aed6dfc967cd8b213376fee8a855f72be113fd40987c4cd148f39e1195235f1895239c65b8d9ffc195282aafdeedd172a7bc94a7d0715f4fb5bc03f05b9c5d716e2b2f096de6b237edda174fd86e988aaf976fc282a1d27b5b79110b181fadf13ae8353af01847bda3f3769c56d53741ba3e0e35eb4f3213f814d52853110967f323b3cf11b2fd9792dce1d74e8cfa8d240ce2dfb0d94b6763c80c84ba43a22f3fd776cded28f1514cb1d24dc75c606f928e6bed0fb432dd6c7d3daea9a44386e4c1b854dd5863e71bff8e1f2b2b18ebd2238ab6782caf4f305bf1db8277774a9a77d0b02684e4641eb0c6332073455681b2fb03caee35b230e9baaece7bbb777a8d9e4a4b36e0f7890ce84b44466f1fd999380996f25034d5b7fbe48f9fe6eeb09677e0964730c7a3cb588579c8017c88e177acf68809459ef991688e07a191c1b46bb38c3e9cf8cc753b6c270cd1c5153a050e1e31ce47fd9ff5f46c4bacec3c0b819e6df36613c251ddc430c0b9e57876e200261a9886aab0ebb2ed909c43d1734b498f12ee7d2bd6d2c8278c26b46fdd54fd4291d104d47ef56da67907b6ac9bb966942f05e850d9653fa29917d61ad21ad51d54818371ebe332b2d5c9e97c3118c1263c321a86df361a6d2b9612fdf6f751d6641e05d0262b195f04939566f381b50ca8ee3d15e04d171c12a84f120fcbea3bf7d23d7ffd8d3099b22a91cce93f08582a9d4c785bcbddcd94022cccee37175d2a6d84a69380aea9ec780c3e8281e87774754e368ada9705f1a9978971d2c4e5c096e554c2ac8e6618be30744008a9a4e9f1584d11e792477cca812c0505a8b93d7c4c97d28fc5b7452d3099b6812e76166911bfb82eb5ee5f76b6e9d86845e92f22366e66e577aa0357d9d5d46e9c6eae564aea63c8320ef73db8a6196e1809b7437025848854b380d17d1a2c6b6eb395aa03b6ef5650a44956f6ad22dcfe1ce06505c41e68a7c627aa374ca5f0363ee61c0da45750b978d719d1be549f6effe8ddb57d2ba67d3bb6cd70d71b6c9f4945c2ae9fb55db424f629b8b4c3e5a04ba9d6aba189d23fb3f94b0ba054a1d92b4a8397c0cacf0bc9a43f52e5958660312139fa755547a609657e3ba938427c625dad9d4861400822906463ebacbebe4c1986f2d5d185b6cb03eb8d61ad2779fb12409248ecb6837328c1a574049ebd5ff7c1009a83266775421959b1fad0b19e628f04a15aa3b60522f3e288eaede84d24cd1d2881ef03707fc89bc2c04ccb620cb82388e3d0dadbeb526ed4ad11aa6161a7237433023f3fea0f72202e65e6bea75c1d890a91b188f3b2278a28faad42e6c046d33758bb3340874a76f16f18738546bae29ddb37cb8ebd6abf28cdcd0db5af5343b9430a82da065bb80aea906f700c1c55263f34086bfff36af450f8bda74bbdc9ea71f1e9c9daf44d8d0ea39ef37094c9528eaa7941388d7776f4dbe8cc79f0c428f08ae47327d55fab2c713a06d273415a07e53e32a9ffd557aaf3f2383ae33d8b5c24efbee8e37f67ee13e9d7b07da2d7ed4d4e672f434d66479582ab15253043e3c938887f679b49eeaf676e8ddca5257f43d2fe4584be20df65d825d31a1961e5b52dd28342b63a27485ca9b0e4c5106d62dc2ca8e7d668018ecb70be9164be7e6d95450a3d0700fe5c5301c85e75705e43ce953cd35cf77007ab1c29481df73e55c1650ff8d16e8f283a87391846c391288fb5e0d28884d8d46eb9870bd8383f6efaa0e3cd243afecfbd09c618df2e440b769aaa2e7186911671f814eb9d8ba3a53407c158fcbfc9a7e98bfe3c2a0f981a69f5bb8e19ef61f8c8735854f2d069ffffb117e88a59c650bba269a1c758c8a8b08dd88bcbbd37eb2fdbb97e9ba54ffba3ffab6a4ef9b23fe5cd6172790621819e9afce1fb15e034796316f7422c93eb35def562a300f43a389a6ac3fe9382bdb26d461aaf21d18caae8544b8671347e7c71600b96d8db5f73c76d7d2b4014a3539ef40f251e4db3e4db48d58e5fd9cba631868c278d1ed13894c6c1c222faad175059a6eeb89f52d24cf0fadd3a8a3031dcaf6975a9f48992b1b07908195228506cd097dbb4615bdef61596ef8aa0938da9989387803a48e41ad328b27d0567145c6cb952de28313221ba5343db0c400987d23930a97b8fe92be9a91ae072519edfb3bde2c9f3fa0d75016dc152eb41bd5ff340474334cdd9e8a412f89b993b1bd5a8530c9803274f0fcaeeaeeff2f0cf45814b592deb72f1fe7d8f79b3ba98d1460e7529505fdb5efdad57da6ced90a36e2e012838fcc3284e426a879bc694ce740c34754c6c130da3ac866477f224c8a648063dc897341c19cec0ca756b4ebed836418f1950ac869ef5948d89237e9c369159cfff3df858333845fc5d2150199b714d72bfff987bbafa553d55065be093375e5ddaf673abbabf6fbb70d4d305f6f249e9c38c85ea7136331788e4e420aad3db169ef2b8c608d7e402b62fd573057a1314caf5ce94bbd2f2fea83ea42f086174b45c4fb6a7","isRememberEnabled":true,"rememberDurationInDays":0,"staticryptSaltUniqueVariableName":"302f04ab65624dcfc8b384e844909600"};

            // you can edit these values to customize some of the behavior of StatiCrypt
            const templateConfig = {
                rememberExpirationKey: "staticrypt_expiration",
                rememberPassphraseKey: "staticrypt_passphrase",
                replaceHtmlCallback: null,
                clearLocalStorageCallback: null,
            };

            // init the staticrypt engine
            const staticrypt = staticryptInitiator.init(staticryptConfig, templateConfig);

            // try to automatically decrypt on load if there is a saved password
            window.onload = async function () {
                const { isSuccessful } = await staticrypt.handleDecryptOnLoad();

                // if we didn't decrypt anything on load, show the password prompt. Otherwise the content has already been
                // replaced, no need to do anything
                if (!isSuccessful) {
                    // hide loading screen
                    document.getElementById("staticrypt_loading").classList.add("hidden");
                    document.getElementById("staticrypt_content").classList.remove("hidden");
                    document.getElementById("staticrypt-password").focus();

                    // show the remember me checkbox
                    if (isRememberEnabled) {
                        document.getElementById("staticrypt-remember-label").classList.remove("hidden");
                    }
                }
            };

            // toggle password visibility
            const toggleIcon = document.querySelector(".staticrypt-toggle-password-visibility");
            const imgSrcEyeClosed =
                "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDAgNTEyIj48IS0tIUZvbnQgQXdlc29tZSBGcmVlIDYuNS4yIGJ5IEBmb250YXdlc29tZSAtIGh0dHBzOi8vZm9udGF3ZXNvbWUuY29tIExpY2Vuc2UgLSBodHRwczovL2ZvbnRhd2Vzb21lLmNvbS9saWNlbnNlL2ZyZWUgQ29weXJpZ2h0IDIwMjQgRm9udGljb25zLCBJbmMuLS0+PHBhdGggZD0iTTM4LjggNS4xQzI4LjQtMy4xIDEzLjMtMS4yIDUuMSA5LjJTLTEuMiAzNC43IDkuMiA0Mi45bDU5MiA0NjRjMTAuNCA4LjIgMjUuNSA2LjMgMzMuNy00LjFzNi4zLTI1LjUtNC4xLTMzLjdMNTI1LjYgMzg2LjdjMzkuNi00MC42IDY2LjQtODYuMSA3OS45LTExOC40YzMuMy03LjkgMy4zLTE2LjcgMC0yNC42Yy0xNC45LTM1LjctNDYuMi04Ny43LTkzLTEzMS4xQzQ2NS41IDY4LjggNDAwLjggMzIgMzIwIDMyYy02OC4yIDAtMTI1IDI2LjMtMTY5LjMgNjAuOEwzOC44IDUuMXpNMjIzLjEgMTQ5LjVDMjQ4LjYgMTI2LjIgMjgyLjcgMTEyIDMyMCAxMTJjNzkuNSAwIDE0NCA2NC41IDE0NCAxNDRjMCAyNC45LTYuMyA0OC4zLTE3LjQgNjguN0w0MDggMjk0LjVjOC40LTE5LjMgMTAuNi00MS40IDQuOC02My4zYy0xMS4xLTQxLjUtNDcuOC02OS40LTg4LjYtNzEuMWMtNS44LS4yLTkuMiA2LjEtNy40IDExLjdjMi4xIDYuNCAzLjMgMTMuMiAzLjMgMjAuM2MwIDEwLjItMi40IDE5LjgtNi42IDI4LjNsLTkwLjMtNzAuOHpNMzczIDM4OS45Yy0xNi40IDYuNS0zNC4zIDEwLjEtNTMgMTAuMWMtNzkuNSAwLTE0NC02NC41LTE0NC0xNDRjMC02LjkgLjUtMTMuNiAxLjQtMjAuMkw4My4xIDE2MS41QzYwLjMgMTkxLjIgNDQgMjIwLjggMzQuNSAyNDMuN2MtMy4zIDcuOS0zLjMgMTYuNyAwIDI0LjZjMTQuOSAzNS43IDQ2LjIgODcuNyA5MyAxMzEuMUMxNzQuNSA0NDMuMiAyMzkuMiA0ODAgMzIwIDQ4MGM0Ny44IDAgODkuOS0xMi45IDEyNi4yLTMyLjVMMzczIDM4OS45eiIvPjwvc3ZnPg==";
            const imgSrcEyeOpened =
                "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1NzYgNTEyIj48IS0tIUZvbnQgQXdlc29tZSBGcmVlIDYuNS4yIGJ5IEBmb250YXdlc29tZSAtIGh0dHBzOi8vZm9udGF3ZXNvbWUuY29tIExpY2Vuc2UgLSBodHRwczovL2ZvbnRhd2Vzb21lLmNvbS9saWNlbnNlL2ZyZWUgQ29weXJpZ2h0IDIwMjQgRm9udGljb25zLCBJbmMuLS0+PHBhdGggZD0iTTI4OCAzMmMtODAuOCAwLTE0NS41IDM2LjgtMTkyLjYgODAuNkM0OC42IDE1NiAxNy4zIDIwOCAyLjUgMjQzLjdjLTMuMyA3LjktMy4zIDE2LjcgMCAyNC42QzE3LjMgMzA0IDQ4LjYgMzU2IDk1LjQgMzk5LjRDMTQyLjUgNDQzLjIgMjA3LjIgNDgwIDI4OCA0ODBzMTQ1LjUtMzYuOCAxOTIuNi04MC42YzQ2LjgtNDMuNSA3OC4xLTk1LjQgOTMtMTMxLjFjMy4zLTcuOSAzLjMtMTYuNyAwLTI0LjZjLTE0LjktMzUuNy00Ni4yLTg3LjctOTMtMTMxLjFDNDMzLjUgNjguOCAzNjguOCAzMiAyODggMzJ6TTE0NCAyNTZhMTQ0IDE0NCAwIDEgMSAyODggMCAxNDQgMTQ0IDAgMSAxIC0yODggMHptMTQ0LTY0YzAgMzUuMy0yOC43IDY0LTY0IDY0Yy03LjEgMC0xMy45LTEuMi0yMC4zLTMuM2MtNS41LTEuOC0xMS45IDEuNi0xMS43IDcuNGMuMyA2LjkgMS4zIDEzLjggMy4yIDIwLjdjMTMuNyA1MS4yIDY2LjQgODEuNiAxMTcuNiA2Ny45czgxLjYtNjYuNCA2Ny45LTExNy42Yy0xMS4xLTQxLjUtNDcuOC02OS40LTg4LjYtNzEuMWMtNS44LS4yLTkuMiA2LjEtNy40IDExLjdjMi4xIDYuNCAzLjMgMTMuMiAzLjMgMjAuM2MwIDEwLjItMi40IDE5LjgtNi42IDI4LjNsLTkwLjMtNzAuOHpNMzczIDM4OS45Yy0xNi40IDYuNS0zNC4zIDEwLjEtNTMgMTAuMWMtNzkuNSAwLTE0NC02NC41LTE0NC0xNDRjMC02LjkgLjUtMTMuNiAxLjQtMjAuMkw4My4xIDE2MS41QzYwLjMgMTkxLjIgNDQgMjIwLjggMzQuNSAyNDMuN2MtMy4zIDcuOS0zLjMgMTYuNyAwIDI0LjZjMTQuOSAzNS43IDQ2LjIgODcuNyA5MyAxMzEuMUMxNzQuNSA0NDMuMiAyMzkuMiA0ODAgMzIwIDQ4MGM0Ny44IDAgODkuOS0xMi45IDEyNi4yLTMyLjVMMzczIDM4OS45eiIvPjwvc3ZnPg==";
            toggleIcon.addEventListener("click", function () {
                const passwordInput = document.getElementById("staticrypt-password");
                if (passwordInput.type === "password") {
                    passwordInput.type = "text";
                    toggleIcon.src = imgSrcEyeOpened;
                    toggleIcon.alt = templateToggleAltHide;
                    toggleIcon.title = templateToggleAltHide;
                } else {
                    passwordInput.type = "password";
                    toggleIcon.src = imgSrcEyeClosed;
                    toggleIcon.alt = templateToggleAltShow;
                    toggleIcon.title = templateToggleAltShow;
                }
            });

            // handle password form submission
            document.getElementById("staticrypt-form").addEventListener("submit", async function (e) {
                e.preventDefault();

                const password = document.getElementById("staticrypt-password").value,
                    isRememberChecked = document.getElementById("staticrypt-remember").checked;

                const { isSuccessful } = await staticrypt.handleDecryptionOfPage(password, isRememberChecked);

                if (!isSuccessful) {
                    // you can replace this with a nicer inline message if you want
                    alert(templateError);
                }
            });
        