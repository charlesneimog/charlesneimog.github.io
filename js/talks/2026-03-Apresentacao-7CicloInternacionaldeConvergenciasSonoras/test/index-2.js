
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
                staticryptConfig = {"staticryptEncryptedMsgUniqueVariableName":"bd25a815b1739e492242bdcf3db90978e4cf104ab74738a9b1084e07dcbd34a223f6edf1f98c53612f3ef3a1604a9ef40baf406088f1af0ab9106f16ac95b0bb1715a06af4d29651588274242f0fcebb67b9a87932bc05acd175b79e84adebb247c3bb408ca512e0cab124938522936c65e67433bbdeffef468c1f428ed237b9fd2cd851ea667948d57268e79c93d855581816b627f41d6bf59c120cecebc041742ca95b1444962f8070f55b933df8156ae699c92b5383c3ef62279938f4878036ab52d040085aff63c8b4333a2e0308e5296700aba67d64960c557555d51df7cdb8c0531d6b6e73a2b5a8ca31a7530b9d4e209225284441e6c8482eb3bae8ff68cb50eb1fb65762d1e07fd88a67f77e734f9833b69b4c9fcecab6b238d84c8d108c94b043b25634dff9f28a03c52be5b810af6064b9e6994d6c3a0972adb04081ccee1d9eb47696fba104c2e4389c495b3ae5d41a1002e36b56119b314c9e214374e8c297d4f35c16764d935f31a991ba5345187dcba0d39856d5adbdef8814d36c942b553771a3a1f70d2e6e72fe4856a1df258437cdf56e8124b691e2037b622d41238bbb41c72947df0e029e237b582aba4bc17cd3e1e0f1e816918436a4105785d098863000d74cdac94cc8aa8ded04235a60e0c1975ecc91770e66748a35844575b204befbe7c6b4e8555d3dba48d0914953dc913ca493c32340739ba5cfd389f47c26073b06282aca87e6afc10d36ab4cd1c0cdeabdad8eb48e2104dfdd4626d57bace4e594ab8c40c4e23700fba0e117686c82f3a603fc802a34d1e437f4c4818ac8940332b13b86e2f2557bfdcc9b334b7ab2ea4533ddd245f10cc7b8c7771a1b166e69b414577d6a39c96870e2413dc116506ab0d09b7cebc037f194ac5f7ae230561361e59d435d3d48b7f35c18096d5e8f112b0a0a839db7959600ae55b4f63b20d28c6da28eefeed8f833d2f5b7344360ac9bd21a42c9121ac99f99b4c2b3cf414564a3756e247ee37b0581d454e9f309edc20d640725b2ee698b232bd3a5a3ce66525e6bc8926a54e8c3abae783b88a8f19f3d67f5d1260a97b437c574e9a7d0da96680dca1c4d171d8e527623e5e750c731f4025cb53748c48173419ef21e6779e941727a21524a45ce6519d1e385ff0fa3e280f9498e7e6b35ccffbf909003667daea8aa4b2a7fa19df19ee32067117d7867753b44bc141cec2bf8096158d78b769c3da1c53f4aa7036aea784853f8bd8ab30fe2a006e6aa7db3489e7771bd2db3c7a9ce76f76d599707990951ba3a4670eae63287facac3a88767e3d18eb1aad473e9d6204ad15f0a182ac007e1a6aab7c4cdcedbda0521614d2f20dae2842e65b57220f4b29c81c4d3764ee7cc9ea027ee63e42069d05811f95bde375b5e21c3624a24c9124a861e6cc278ff0f4cd018ed316b56a6883c62f2697e6943f7885334cff5621bc762a1dd13e3ee579a2f07870adbd1b5c46ccd73bf52a1f1e4e66c45b413df55d64c0e57491e53bd4a93e3aaf6313140b8a54c1d8d34c9f78839929933d63d5955fb7afd34262c4f1dc8d27bf2b2b458cc9609821dbca32a215e6cd8384d44894512a90cf9e2c57ff5762879b21620d23991d062243a1aaf42991b600afab54476ac898df7e5bf0ccb19ba61e42e4aa85c0f5d9e74f144ca454a4323b581747cca4e70b8c88c97cceca9ef8a87155bb5e7a29b60a2a3a47411107b1fa33bad4800ecb19595ec70030e7659888a2a0ac3eed79bf70a144a8b753c686fa90cafc807dde8cba57aacd8d714b70fd54fc7c1dd48036a754f40c40e304508cda5528c01b56cb847e4da215c9e4313a9c5ddd6a77a11b1a6d2e71a5d5df884c30c04d022db3c8cf92fe67edc262e679c28bbb0636de3b1f72e2fd71f9cb292311788c02d1afb58a1b521f85325826720c8305baa6d27ef49b4e82f6c93444b41176ed93d098cd3dfa64a5f268582c61e9370cfa3747af76d29d87da147185a15b4e88ce64d0f4f84d5dbf9a1a9deae5603f0586c9adecdf72f6e931557b047562ff4611b938fccc7960bca0e5afb6ebb3a7313de4fcd87e57ce4ea47332cbf1d3d60064b3f625747c6087613712ffeac544f6e62270757db12b3ddfa2b512c411b4b9639328b85d1d0b5ab7846580f0e1116aa2df4a2222b755815580208c2a3dd2124315ffd48cb129782b5d32573964cd613cd960ab1c525105358f26a86305a3f846e2e689889fa039f2600c77c002ddd9a5726a22a29f73125fee6bc95b2aecdb3bef30f0617fcfbf5d8df4f654123c95ee3becef04538a032fb3e839508b886fb47ba086bc6cb9dcebca7de35d39c00146bd7fcad12b2ca3e901dc2b9d512229347c592f6c39f04245f4e1e47774846550c4c07ffe23c3c45df49ff5f03963cead37932be26df1c435260ca3e3972855b31f069cefa8f5449ce411c7e55f2bdd4e7dfedabcbae63d10ca96964c42f1ce5f094b2e923f8fdaf236f036da80e1635b2d47c1545d9806a54968b8bef8109a3a4aabf93cd2c2585226dfbf0df938cbd40ede141a8de55fae58a96a5ffd91279396b821e2ac444483e27ad5e3230e915799878d4df683437f9ab3bb0a8e17e14e26b1b8484fb8f7f9e9b6e9c0692d0b11cead760379afae6432a76e8b88cde2614b62232dcbb662e927cd7e0efaf17fd5152bca5db89f898278cf72ab6f2e5073917548130a248b9d6141a3f8170ff3e08dee336e1d9f163dc3c70cdc158d98924d2377f89afb0ccf3387f886233625b96f50c4c409900ad50ac88d85da59b971f8f56695e25f88f5f33fda977565a877fb5d1101899626c6024b2315821d8ee7c7b0790bc9efc74a95148bc78409dd1485b688bf2a858a020f4535afcf1db2f68ffe59fb689518629e4f077510edd45a92c9e006e8cac6597cafdaab2319261ab608629c1072f99010a83d00ad9052d10e623302cd8f0ea871585e499b30bc45c752346b713b3c73786234f7f29e6222ab8e8141f8afd26a9e1ca1aa6ac3a98be2c0a4801eae5e9f343b34ac66173d619b321e958ceee44845e7211effa13828eb0765ab6a6582f6fa954d48e44325d6efc7ab50d90d5fcc62df34fab1943d6ebef694aa503c489de9a1f454075f41855124e821fc05efa292d99f60b8bc704214ca2c62949ac3c6cc4c873a21346bcf83dd6e07cb759ab35bdd669b91e7764319c3ebe83ffc9e1a54fa13e91a4ff997bbb5ca37f32f22d643620d491488e60484c261a8ec503269740ce954fa8d5b14caacbca63124b9f39b592030f17f803595c051f2c8e15a74addcc97688d240da06ab49c59ab47e4b8c14a6a11566140b0ff9661ba1427514b4788978ae6b5376f21868b89d92af27274c1421e8fd7d5a4018e3839008f6f949689816c9ad98b3d1fe8f4687fe9192a555e99d19886cfbdf3a73f8fa9a5aac3aec72da729187e069b06e3b96a7e0d20e6d0ad63b1346b91129417ab488cd51ca837c337a63cb776915ab1e32b72fa6373f499b46b536d371c43c3be6488990d0cc0101d56ba00dc52adf2d03c8ea76ad425d870470375abd4270578b1f5ecbe67e514230cd389895dddaa4c9627449fdb338cc43e7dd8ec27cf5fcae20aec60a137e32b4bbbe0163414393ae5d0bc587df680c5979baef9516088cf5febd18efde17abed558677e776bbdda60a6644759aa89f0c7132afe05df716a8121c45f22ec7cdcbfe6912493a640b65d00a84189fab58ed6bf2c5e1a615011a1ba8d6d4a645724cd742e0e540d7a3649307aa80a867baa7cd5292b440f86895687be3b4ed8ce3f5560c7f81aab980887a866b1532b1e2eab0225a957055c4abac14718afe45cdabdc06300fc3eb5455a2b9d5cd549368efb3c309a56bd78af3067c8e5e5a8d57d69d6d4e424f493e90a347f0518feed486ce657d018d2e52b2472523b3fcfc9249f7caef8b640a2205972e8e0a7de7efb42583e7acae5edba6159591cfedd44d96725d31503ba37e8e4a53fd3ad5cb703d805422dd14a45c6312d76d4728572df7b107a446cd0492b0dec631dc41f70b0cc8f556116feb49af76fa1c8c38d1dd59e01b78440fc2cac65b5a8fc022745df357f939777f90f121359bc2d1305ff36632b2ce18236b1c67e15d03ad30f0fad883a2dd62c9e8aa6692683c9edcab5c7a1f9293aa1dbad27f605ce009ea034a299b334193ce697ef548754230cd0c4fea052c2fe60d3fffaf03e581b271d7991916c75360c1a25a7c4c6db72eca04e4a792475b47013be0b51c1419f855e6f9c05577a35bc1247908821847114e5f2383ffaf8134ceedc95d15594f30f4d106963c5991e70e2645c368adb98bf9c0e9767841bc83d6b83fa723a67427df26cf4322ded2e6aa625544e2ec5c1609b9a04b606c3af2d96cf9722531b256ab99808440bb0c6d19a923ff54e76174ebe145b6e8da781a4960d72850a542e7769970de91445dd207a4fdcf41955c530bf828f0bba860ee3f5bc4a5110702579da2660aa2533a4f3dd85f11a4a208585412a9c5221ec66a795d1650057dc8e362f262063899bc816cf68348bbce248630fc15e4b82c01ebff15aa8218312451873abd775af9294a6e0fb440fd51365ea6ebcbb994fe2a812b22f8a826e800f6039f0a049163e1ee2fb983425d4634e564d8b11df65c463863ea372e9a69b879e677aad891fc6e14c4a2f993db6f1ec827e06e9c96a00fae44c4a7b6a0cea277604e039177af3dba70e09ad58a07aa4198b92c666a6431c51bc1ff8030eb8850a2aff174a9e5a30e7484d365ef3dd84426f00f2d8457a5e03d1ad95b457f5263ad1ad2dd71f04689573cfdaef8aa0c8507c327210cf30f4c03c2e26e1381ac6ff8d0f70a55a4a86cdf2596a6aaa0d39961af6a614cbf02aeffce08edff3615612a6fb6fa74fedf573fa9f7ba081d6e809c1742f5823e8c11677ab01220cb52d4e1910a96c288048ee6c9593275fcba69478e42c4e1467dcfa5f706b3913fd7206a08960880540bae24872e508cebaa024d17912d674dd2647dd810d16ede66a2686258b028cb05cf215b0f268a5195b3061c7cd40fceb084844248cafced8e2361f2da8dd4482781f8604c2253e68d34afc67965576f0414a48c49c22099a55831b0229d74493a4cb9550be64e21384125b17469847efbeef9a4aea159833c2a96ff32601a2aedce667ffa3d55c1be68d259dde4d16510ae301edc9375fecb119a33b8ce1591a73812c6558c810c97a12e651631f500fff37f4cdd1c6c629793915c50c629c6f939cb4aee11a7615b5feeffac999ab51f7f9d0230eda3719e816690170eadc53ca5fb2781dd5c57c01622d110caaa423a1ff5dc7faee64a014994cdfa7b7a95d104a4a775ea1cfaf7f8c1e9f0cdc945687d679f6adedc430d5215624b1f9eeb9ce238a10a91a48faca5ae88fa1d8964c92b5cb9bd071c89959512deb8ed275684957b69d06899cb7ee70ddd8b24f3e471249e0e619839718ccd5052512d586f489f410ba08472e0737cdb163b12c9cdf823ea81ed170783f03393d30518723952fb1b307dc6036ac6f383a88cbbbb89e65e8e0a263f3d2d920d3571d4065567d7d255afbbfa123c2e70041df149e667e6a210498e8f5bd9ad72c3038a0ef9bfeaf7887d58a2a6c445c73c5ef76e05c238acce18366c64a61bcf60445662af732aa51e649c3eaa5079c0b3e6ab6c0426ed3486d449c41f83ce914598ede5dec4ecbcbb9f970096ee4af9ac2d75d3e213d2f29fe1506c1a37701a38ed7ec282f87738864869165bb60488aacf75709ca40fe29badc22df4b0e612cb460bb7bb3f38f2169c5ec121296ab76e09dae9d990242f0583d77c2f7e9845c2ac039841ae104faca5588615210cb8763a18635847aeca8f7abbdc5244fbe9eba1dbc9457e6d62169159b88a998a8d25eeda32b4bee6c115d60953cfdd872cce2aab034922c9d13f2b6778e23985a94f1a7282a643d9ce5de078f41ed94811c05cb47f791eab28ee052bc2c5d243f36b543825a8e100524a456b4be4ff84aae4554748cf3b07eb5539a532eed2370129c8118d1dd64a6db2ffebba294d4223ed7549f6ac99e41e7b48382adfd5dcb3eee5f3c467ca4fa3885ae4ce8aa437be3bada606770639c39b82930fafa81000f5ccd4c2281c46023c93bf6b5bb8abeae8bfdd32fccaf7c10716367b7ff76c1f6c2202a8a1fad0645c04a5d956bb151702db0384ffed20ffbd510b3f72ef7ee16e8b9fe394dffb193c096ed88fbbbb58608caa677b4112fe5f9dd29a50f58b9087c73bfc8b2549a785daea4f4aeb759981a20fc7b04c296e0ccbca9686269006114b3ecf206222cb47d31455247a85bff79167480db66789caa1a76342d3651db46eca54baea562fe223e7032cd4b85e775f93dc6ae7dc148633948cf50a8bffbf3ceeffe45ed1476c440d435b75037c7b571dd923c7aed47763a236535db53415891450f1d08be494578568abfbd97b204be4423cc7239c379a76a6882168c79d03027dfd9d7052d9e54540b5f3e9964c10d66aaee62d1f7666ff62a30bf91b91987f2fc6ee805417f921d52a9a91e0d0ad043592b2524c69bb27630d7fd7f4702ae21e7e4a703d26063b2b5bf2f3e6fbe76fd10b3ee42ba4a634ee3a4ed5c8d404ef393bb5cd5c8973b4dea2a7f1d11f7105eefd0c3f5282fb86def90efa245588e97ef2b50cc0d0bfaceeebe036fba2d1d17f2a1dc3b67706c048e71e1eb794b76156c7c10b52d94e01e188d8b9b7c39b5354298c9e7029de9c30ad7e21b4184133c5fcc5adfb3a431e5f838b5f7e4f9c248abfa4622f5d20a78b3924dd3b613ba07f6a475ee8bcade5cc1128423eba5400c5a105f5c0b446681008f62dfbde3c0048ee411f652d2d7ab0d069894c5a9a3e2a4f83308b28a19920671792a69d55b0820c2864ede816d580ffb733f4380e62b00e96446d7bd2cefd09d559e62002414c1caf15e28b33b489c7d9addd8fae9121bcdf37be8d1e3d1de0a33421f1019868e7b6730316fd3df7c731b822e236a2337ee5ea2088fa69806503a223603bfeba9bf280d2239631a15bb479428e63e63e52ed46afc86585e02a8d0b8883f55cfb5bdc50cde12a679bffedaa80d82acec32eded235cc2a12ac3c482512600ca391c8fbc58847a18b8939111e3a921e762291add665a775ecbd1cf938b9f2c434185af0af514616341bd6017b3b615fee869a57a04cb571c9d7fb6b99db2bc9b2f6fe1e7aef4d8ff7556edaee8cbd8be357f4feae414f715347b898cdcf39927c95b2be61f14d838bd5d852dadb5f8b78df5de7fe64734b53fcc70108a5ead3b4d73fd9f7f08147a1770750a3f12507cae53b208e7cd4266e41c9c9f78e995e2da4a16539e3cec61c489668024e3a2775d616df08198f346af705e3264ee46373784c256b5aa1ff136aad61f45cbde5c540668995c02351a747ce8c53491af20312ad1ccfcf8a16e14145cebf680e1c44e038d3a5b17bebcce2813b745355354e3755a32f456a92cfde4988722ee98a0f98a0995f55a565a4712bff2521070dfd96fbd0c3127f23defcabc96cc26ad2697da119a932f617eb766e5c210a4302edcd4888b183140449f0e958f77efd63daf0bf2dcfb0114537f884d79448b55341c0e989802b2e1ad1df566318f067fe3bed35b0b262f1c07cbde8e1f522f8e7b5d3a5494ecf0ed23717a4aff5640c230aaba900ecd903a4b370b5bc946a165caa898b0ef2e3a8c1d443ac2607c7d24abbd52991b382206816255386c7bb7fb09d061f7a17300e94d61bf5797aace2fba46d6224ba7f355decc78a299f92cb1bb5e30d31e8a854f1870314820e9b831a57ef0b49e451b01cdaa330bf05736f8e22935b95481f2f27fc27d8552cd914a8c4436da27e5a57d5bead0d343d784cd996ecf690f04ee515c36886d25484982ac65fdf05d72a88f72b14a56279103f43fdfb2b392b0846b61c77595b49c624b20c786129d1732ad7dda3b8ac010fc4045718aaa9191b83f72916950cd0c13e0fe635791c4e6d4e1ce17963c4a150dd3176182906bcdb5943cb9da7ffb3656070ecc8179406c3e80b1435d75219f40c8160fc50244acb62e74023fff85b99d1733c3056290ab04010feb683b31d7f807d2aaef926b1f81c6a67c3908cfb0ec36768f38e5c5fe76127541efb1aa2b902fd086ef5955ac4255da241452b65e6e5b5ade65eac7d7c684e8f63fc5256fcea668e05fc147176fc8dab1ae9082bc9b833ad5586fdf756b93be62cbf99a253e908105534306b68f29d801acb819b03dc35dd0708f5f1353452f0f72f9f7481ec5195f02ad110cc61c1557c3b754afcb484314c78155ead27ae09b2957bd6ac87459368ac7cca2277e1025d533d87ee346084560453b84005c9895990134d01ea6ee9ec2dfb06262450c908cccafbf129488a2f65bc36ae18b053b9a9b2ace35eee41b984ef291f0d46ba06c96ee038e2f3822684fb6ded286d44e740f61be175bbe69046212a22d3d1bb476d12b1cdfe925688539fbb670be7ae07ede7b0be701e8fb5228bcf47765b6402db129400c741474f5c1ea21077b88119391d9363889f5d154d6444ee45a96d65409a1eb6b1fee1f357920658c2385ea36804ae3743c0a84e48bbf67394257b305f2e373d412e90ad8783fb404a545341e8a943d6a20fce38a3ed41c737bc1136c2f3ec37b34dc010f804565869c85d4faaad62303ef8cb7803bea47cdcfd82fd5047af3dcedbce71aeb4853f1c9f7288629b5a811a42257872b5d1fb2c2c1b755dac9d5d821a8bd8ce789deb1c8ffe0f1c35c91381f47ea9c6fd46ae032579c7c881a49f9bd688a98d5d7b39fbd742fdca7d348e0c8712ea25ef9c0ddddd191b4905897418f5cac3506899f353f9ea7a7ca1172a271354af96a186f44c68b9c950d8dac40b1da36a4002350dab175d876efe0fcd16f9197f5f0b8e2cb3c5b8bea778c67930e016134c5d9469b9f569b9cc66faab054e4a9a4a3da7672685994eff34b5d3700abdc118dfd533236731a7adaf5b979eb27b74ca5bbdac701fa3c1d3ace98bc5a28b41b87d95aaf53b6118a80cb4d8b13e296b5963156c0518f64c967b21402ab19a9095048ada2eb1186f9fb8638dc3671b60e28335363d8add9e427dcd71f00fddfcc0cdfd360ce29d743bccee59eb46b6b0f80736eaa6233bfe8c2b9e44a932be7f2c337366a34bd454a9ba327eb8fbcf5f6dd82b3b79871ca9317113b9dcc9b213346d2ba3e1e48fd480af0a6756ad14c14cbe7f4118bb7a08308169ba255825db34e9f709ae6260418d5067bb0c853c0a05e6209fd97e92f30e10e123e15dd443ba3c3476a464e26d9ce4a640e299ca1df16f6c15a5c86b5d33f9ea5b9743115e7fe729ad0e6cd80c10972902787ad419808553ee45e0e8d5c1d388010453cd9ac77a6207c02237542e5c4d66a147b6876fa1d89545b3de28ac72b8cc40203ac2ab90cef99f70a18e392b39b354c72f8fd6432b7df04f4b91e811d78d04def88be7f1eb777ac1bbec06caa6d606bff68a962690d8c73850c46bc44224283c68af55a77c2752e72abcc2bbd2530f8d20d360a870bca193ff949564a54ddc29f599e07a2192524766b07130f80227fcd0a2dd074cd483ce0d718f128156d2ee1074734e01ec7a308c351273fa64fbadb22149fa14405cc51cc94f59191fe718c0262153632f1af758f965f9a3b4ca4158ee6f66fdee7679d5c2f7601f79b36bf0eb996a6781e508be807814ba0cc5f5f66206210d1ec08c701f675a26438fe1c82e341fcdabd2e1b921878a496a72b16b06107f45f58ab2a6ef60283732cb9eb845b99f295d48cc5e237ab10fd12f0c8b92f77470caa2d4c46b2b746ac56cf47a7fb2116919f5967d6c382e5880c48f38d60f8357f73a795997c10de78ad32dc16634ef6ff9e2e503f07424ac12f597a1bfcddb2b36155386713b76d45cdee0e4dc4647d4bf7fa79a068d7c88ef49ee9edc24bffa492e001606f85e6ff193cd6a90683037210be8be6ac4dfd745f77c10d39087e5314dd489177efef1ab8254cc09d32d7dd1fe66f4141f25a216346bf8770be5fd7183a378be405d9b82e12cb34a64ebfc13615e7a1022b2601a52aa42bb15ac1309654428d3243fdc03b6672aeb86c4a9b3fca2fa98573695ed697575f160da5210cf576370a4270ebf51d82e7d247fd25e5ab6d94217cf7f316e2840cfe780f3f9f17816c3debecfb500c28d3a4eb0061b8fa7b15b274cde1b680d0f2926e8628c10666a2894e53795708b1e0a427d3e9d9e8b25c1d1f085bb06ffb3a3d9a92a18b831bc0711ae39735c61eadb1cb11811362fc1e920c13d0c9b27084560093a75c92e64fb7b63dda584b5cd8c1fae8c723aa5c362fa243282605a05a560804fa4aef0c617df0a1f58da6b5aafd13060d7fc4ce7beddaf0ea9a16a9fa3e79c95b68d6e1cbe864832e9c41cd1a2f138e0da2d70844bc591b56c271e6e33978501bae09fdf196b93d319ca2ce58c7029d6d847f34f964725743fa3e5e73f5f88f37c4185fc1c0307da2c6422026d3eef077495a363fbef5b1600d8655f9fac9da60f0fbbf7d78305c3f2cce342483077115acfcd59d51e6c3e46d1e5db00e7f020d740f52b10075d04e34d275b54eb22b6b0080458cd1c97d7e0144bca9e428444e2b3845885e70e57fb80b52966540ecffe27bc3c1a0355b21a13d7144888188751563fff3382d3b4a00fdbea3a01176c32e6c9e393735dc4960f5c981f9b700ac3fba3be2b4ffc64d0e8e6bb02d8cd1a22ec32ceb22e2df88a2ea936661635fc77a9a7b08cc09daa9a87d0a2eee3c5dd7ef778e72608674fbc6ac003412f651794381e8e884ba98a705bd3344066152b3897749e20bf9b18c72bf33ad7c39f71f1f29a866fdd6ebd4799e1f9c95229f438756605c1a169ccc42da5e83cb9dc712d6c95486d2aef4f3a1cf6487b8361d6441d7cb12542b6ed91f2905170a941d28e74971c24ee3125bb841eedcbd0d8246414d2f193ea21bbe7b82fbc1465e738d8626851b131f6f88eee83b1cee25a7c74ad4612f1a20143b94273987146e3e3d64b84dfeb687e16aa4d4f0ea486f4c46abb4b200341bcfeccb029e919b7eb849fcf990996d61a5fa3080324671ba05e132d4dd7f252609ed605b02f0dc0a9a847c787f3e8de11cf563d94d3e7e45fd3d2840688f433f7fd714a38089cb27998918855d0f069efd2327212ec5369c3e53953e3e1e05340ac766b4e89cff2818407ba4313387b1c69fe9c04ee62185391e9b9db8b2343b85a980567446f2cc60953e40716985714dfe3b37f46f5a1db21a0c9827aacfa5e381ca48b4a016f02bb277e7ef01d6306a383fc51b79fd21e9c9844da3e73a77c7d168e8f62c5c917153c27feb3a730ecd8248c2322d256b3560885b08e809421185472ea43ce55196391dd54590c2fd895bc042aec905c9dc79d72177dbdb943aba623a375c078ea941f60dba45690b86949f752b0d2ce25755a902f7390fcb457cb3a4db10550b63103bbbe1824da9666a5250f318f1dd0b6fde4cf8814b2771f611dc02d0b462e4fa226ba475af532db599e020c8e733499dc3e048add006db9886edf50a27e41a43764b080ea6a871f2cd4737b5888a77d6732a05892caa39aee0ff14355747e959191296bd50a5c527eb4a7cdc40ef7acba50146de0417a5e680c71ace2c327d577c1cc218562b5f6e0a2ba01a8c1dc24287bb658050f09f6bc6d3274679e3af5b074ab66c7f4099c1ca3ba1bcffb96681238d483043b5307eb20b24163b4e9b819e24e2b1b7cb1d9b525508dd6adf2db56e28e51e21e1a71d881f2e56038ea25805c6a52b1ff996bfcae2a4f5fa4cab3040efb764f9725725e4e87a8f5c2adc2fa2693fda413b6bb52fdb3a81c9b2605395d056f7098954a0bed19a96b6bd62450aea65b411287c94162c65d178401c8f07a2b04d0c5a9b08a15d87bf6f3c9b0494ba35f75195e4c03f446e4b3de2cd036cbd961c6870be26c66042bf8dcccf7b1280ef34b0fd4122705f7e90168c32b44b2495fdb22b382a8acf592be0029dd43dc584217b218711b298c27c50e22bb583a722156b6fc9eee57758c45843b2cb24400fcff7f8a9c38523db7650976e599b4e0e8e1ba442f4ee42211a7e1d35e8e18b9fc4530c0e3d661dfd329d9869d6f291c73118068cdbf5f4fd92db4ac97d229b31c464df6b8f44c62a0ad4a95d068d3eaa2e23d9ced7a16980dd33a33d86475ab2d1add7cb37b51aebeee06a836b3acf8e27f8614fccf7e5e408ba5026ba88a861ebb71bf5c1a57cec008e76b656bf31827680422c4cb6d6675d76b424f64b32aabadc20d8b53854bd6a170cba3ec87f7119cd2f6723deae3fee393cafc7a9439cd873016b3b79d8fe2963aa4d306800b3fdb121ba7d84c4c70181e6e5d1d1be116e3dc28de7ba24ee5ea86c76aa0d596785b35f7ccc7a671bfaaf676af060d36ba797ff4d62932c75f57bf09c6e3cd770efed7ba4cdb8101c619cf42262a7ea719c16bcd2c24624b542823bc5af3e26ce3d0d05224b98a47bb4e6d1b5e9485c2a2b57e753ca29061d8749419718ceff2a4fda88286cd0247f1fb3f8c021e4438ed63773d32560c87e23c4d0171f793aecee100c9ddde173466465fee545d06481f2c6c73099099b1436d0c26485c35543bdf56a3490332e97730be16cb9a3dde0e5fc5c4c6712058cfafb040cf034d90cee7eb7d1fbb294a2b3ef0fd18c24cbb04355c7ceef1aa537c577cfcde02e80c50c0de283d0b9511fadb864eacc608827b72f461d6bff8d4edfbd4b3ff7f640f622fc056f237564c8f3d1a0c93cdfac3f34dac84c781ebe263bb71bc8ad226ec2e169dde5ffce26a840bcb1ab7ebe4a03078f63a29d6a1f0611d79fb6665c9a8e09546428e6a5a333ec2b7272fa0ad574a0c297af52b244730cbdaa1821c21d04db361af267be1c86ad65bd74a6642d8e2079e0433c405ba19c3c6b1dfa7e19006ddf0b759b2e7d7cb69855eb2947e78032fae7d5d8349b744085d1af3f71be03d487dfc21a74f868aee0a26d6e14916250004f7e1c86a4e7654faa8e19d671e878a91fca9baee8dc68b25cb6ec7fa3d5cb68ebb90045511c7302476215b3cd3b53a82bb98faba8f0d9b4b0cbc8e567084aa3be176539cba95c200032d1f6bc154ea170d10271bbef11cd28667da6f87d0b33536725ae9c8622532b5980dbd4e1f2c33aba7c7b0982ab2cfc08a85adeb1be741b6a67f1cb2361bbe6b4b17dfc75b60459fa68a719c12a5d1600046c6f784ed7a40299f2d6ac7728f1513f5f415b7cb9d974e13279ce29410071d6321513f8f253a37147b1337343daf414a81dc4751c49bbde447c1f8470caf436ef8cd472b62a3f898c0dc8eae23d1ace999b49155ab739f93b472c141ff6fbe6aea2521729be5e4096f506f8a4cc75e227060b07542673094eb420f54eafa58b8d12ab1e0d7f5e26c5c9f95783e2d6eca6c18d0a786337c9d58155cad13bb9734b973aff33f001f21abf8dc05f2d451564ca99a1db0622b105dc0bcec635c0feed82fe7696e287d7cecdfb7ed53aa07202d4d5175a6f31ac2535e785d7a1dbacab5d59c0c2cdfb15aaa51498e6851988801c610fcddd128e55316d6fd5862b7c0033fdb662495651e46c7eb26d979c640464cc78ef0fe8b217c4092c7621f4a36790cb64e141b0f7a8141e365858b6781aa610141f98308b955b09512478537e0604db54c21d9e3395d6e92855d1c319cba4e3efd16e383d41e74b6bc46577415f7130a523c1271994cad61a5c1bf39dc329c072487f7a8bcdb50b9bd32a98c562bf352d2def59fc61b86a6a512722fc3dd2bbc24195d57c22961b92f70fb27a5ee581962b33ff0a93d235e08a5b8835d129a603dcdfda917ffdaf44d63d3d55fe942fe57dcfd4fc6b26f228136ef2f0a28041d0c840e0b8475c179c4ecfeda93afb2b6684b189adf90a4b08598272c55b6cbc1c2040272d8496323a3721db43cb9eefeed83671f4bd84b03a69af9f2160006be276d4fb6d57bb0403a539f84c6d1a1f99912e29cb3021b06e6bb5df08a19a8d28469c856135273b2583604dd005b833dcf8bab976d47f7ee1a3d00449d5ddf8323be30b78d3768b1ef473d6e959ff576e9c25a3bd48815f9d1d8ca9904b7dbf27ebe29526d0e1850c50c58b46bfc88414a24efc57853a237e3808eccce6be15a7e762a4d3c5d3329a7e9e12673c5017b7dec667760248e81dcb7ac491e92fe2ae0b4eab3616687f83d05b33032a9ec80703f720ea6490b20e7b2410110b49e68f6580c2bc9e906efd4c414b27c53495c56276070556a5820750f1ccfa4326d5dad5163975bdcd5f05e525ab3814f3c2f616fc6319b8bb06a89bda989fa8472b3d6a90ae942cb813383f64417ccb8877101ac01249a772310b79fe669ad7cf345549411571ad8aa61eaff6238d6678f49f64848caebe01ba2dc188ed31b1f0e8f2d06710edbae9d115892d649770a52705c02c9fb397f74391d486598e248608f636d1ea219d8c0c9e288630bea9cf44be481bdc4fd223364927e7d884312826c3819a153bf77f196b967f67765dd8d1d333d480fec9f44240e5a18aa5d42974296498f8f84380101761598e01b409aa41f1dbb8095e5347e52af15e5fd90fa0e91dba95c1b0e97417ec3ed89abbdf7c082e0b4e92ef01a7570cd3e44335c548e734089d14f73dd6891f09529f8818761aaee2254c40ad4526b35705cd16edfd5ea0b84ed27a430cde9d2c123c9f57fa18f793cca0e55738d7383b94da9d0af8c2e1bbe9e1c351d0a62a63c40b2ca4e50cf218b184294ff7e797fd19b8d50bce7e0d4a5a60e65431fd7c6ceeae82ba9881ef1b41bec492471e353ada9f597a9488ee232e8005184b69f162c8d487ae2902dd6a895f82161fafd4b564a28191cb3488e511aef6036831d6c5e8013f7f0543b17339864dafa4da54f4709774fc46b64a5fe332b5d9d96752f27dc04b035ae58fc075115b8115e579e1b2707a6043c869d336aa85e8ad823ef9b9799740972abf8a0a087463c1792c997d4fb7b11861716692afcaa349f38c4a6c6a3184cad991fdc46db320fc20348cd2621bf51a67cf99b66b78fa627c52dca0d496c6018511ecebef83f915dfc858f257dfbeea7792a6e75956b1c4f62bcd8dd7a9681b64488762a120fbf0badabd4621296b93a913576bb093ecf8d8805ad1f6c6e18b1165e978781dfb761742216ebef2017c1eb304c2005b3aed458ba435e5365e57528981bd682b108262dee470fa78aab5b4091d32102c7395620ef1bb586fb237ff07a8fa62cd46534798382aa99dfd5094886ac8a52d8588a07012188c45f661a5cdf25baa6565b36102ba444ab867e1b46c40056e9d8ffb8dc9b22ed77bcf9c683c0faaf7e0e9dac8d9232933f925381fd94746e5870babf7ed9352b973dee2294541d4a36beb0a62919adf69d22ac3d8c79c68cb9a66a7b3277fbdfcad30e5f5bfc79a3c953b53d3b0fdf8f68be014358d3d43ee692a88015f4bb26db1457ae9516f91c39c206c87a385819cdac248fc98257722bc01ac941ca7e81809fb30e6efe0b2065320c21d100cd79b0d3fcf765b87fcd6de56970624934e84fb13f82a795deebff5c32a94ab80f30c58c4f918da36fbe14ee1328f55b512ece207b6b26ba52dd503762a53e448c50f136e9b171f5458ca3d4bfeb13e285a8d8169c03eb9eeb5b66093161f1c67042d6bd1607bef0d4d14dfea948153723203e1eb643e9e4f93ffcbc5fe8f45337adb063580865c399269b49cc4a9e085db1ec88d985265dc816d94c88fde1b663ebe736fd08c8fbf8d3b459916c50390be08cc0517538b8c280b92590a68959580d80f90c7c5783b21cc2d22148efa8ab78846f59951f1691ad4297c6f1266f305859dbb13fa8fd9ae7013b94fec1c7c91d6a7f64c445668fbb2abb0d1947769fd589a4e846c769d2c09930de359c56be45ccad7393ab5e0d4a8c341069a487fedcc20da32af6c5ca99eb3ab9b5c8173681feff7f12cbb395d64ed07f6216c4b7183848c38192cb7395f76b15b5002d0f7a3a20a0b731e9c3ecdc998ee1d6794f0eb1bc6ec30261678450b03ac8c0ec438cb529eb6ea17cea91fc19c80fc232dd980305a5a0bfdac43f9d959f67131ca1e51467264fa952714a17537c61b004fc944a46e3a46a297ed407c8d998f06a9a2440a519640ae3044de428fd1342fe8fc54b753fa7fdf4feec6a305991a1b4d9433bf49d694dd93b2933b2c03a215722c1cff1820bbc2d16558ef03bd433c2f0f8923e52152001bc61c9912528b0406694fb40a3f34ebff35191d20bdde38c67dbbfea9e87d1030013cdca407b6efbbd4617149a1f023cb0222d5a0809301852ec3b4e9e96c432f450c0cb682d081f716a0efdb895cd716c7134287f1d2e452126c00fc223bbf84c99656e65263f44f4f258ee7bace70a1fc805feea888673264768101814547fe0214002998207e59e5d3af48bb1b8dcb4acf00a31e0460b44465df9cd699be634cb98bfa1ddd6c5d1c70b0cb3814b218739b1bb7708a86227164df3fbca946f34c333c500b0dcd0a87e7c54fd9cc640e28b227600285f653a44b1d237a8a2b3de870934720c5a70a4189cc9f31edf3548ef1b2c8152c73e2d296c6e54d4e8761b1b1b731695bb183f407167c2d47643d81852e865ce9e57a4167c185e03b015002d5296ba69ca369cef6acce0937f7c11bd27a4456e884d841b1a4a5e2cd3a65d9c822e7b0e6e65cc834b11639095fd5b394b6da50e29e43430225effc68d8a931e9f97a28264eeeb14ead4c584674fdebbb556bb99c79a92c5a5cc5c711d2d1905ae4337377382d7f528aea40b4f40502e7bdf5d12cbba77e37f62e22829384cf94de9528a65f9a2c8297c72ce0dd7039822022e2f205d5bd4cd1ed2e95234f85e44e4c8693c13ee5bb16f2a9e908774d9bd1e5328b81abfc704e8f4eef279086a62f9cf9ae0c0eb1bf4f049c4ef626bd326c0f4a083235d9d986df974f9071110bb751674d546c553a0de76e668b172b1f784a3bdea1e893391314a9d7c434954f1c038eace386952d2f3fa78ff3d24993dc14a6bf2ba389f4a4a1ead9cfd25a8372bb0184ed31525027d06693016af65c1bde012b028896bcef649ae15559af5ca2221535d7e67e10aa30e20816f7604d5a8184638b286d7eb35d59058c4b9dfad83957e83ab1c659dd2d357ddda8d914b6f971de67a2547d35136273b8a53617477b3c6227cb0dc71b417d9acb2857de4b44fb41dc7b4623fb7130320b1760ffa627e9f165875d45dbc4589020ab4ee12b295f2ada69868727800f4099b6b7ee311f99893694538b8edf04cc8df02f0845cdc4e56434865d22f4a9e7e967f1e8bf599db4cda030b61d07aac8bf88c4a699ca554f8b7f71df1d632693dc4fb9895d306e7f37049912a57189eff56d2c15260f062fadd0e1e254a701c22be4571787d5f1694c37546e71619f9ba6fce63044debd72192d57257c3a67d05e1ff471315fd0e36f0262e6d3685e134b76b7172e28df60d17893e717c62f0f0160b4b6e54bbc91b84130a2d90d6ab301f1907be5adc0519da8a70ce4774b031a512ba0bf6c3963a491f6580bc8d7bbb11d713010d5019bc519501525e3e7cbf4a4f8e446d79ba0af276c91eef55edb28bf90ea7d7ce7c0812b2e53afb7d761b1fba550a5c27fe944fa8da41200692773f50a8d9aa77fcd1578bbf6d242574fc1770e78de88c32f1bf5205520547b2748c7b8fc468908dc54d636aa504ffabee07df11e1dde2733c8038c489842100aaa5961804d0277de972b4c62a086a9bef43d5ad3ef08690ba6f60f01cb61fe2370d3cd4b43e29179a75f407bdeb5ef416133b0e01728570ac926db07f5590b97ab330bfcf7a37c3cc7c49bdc3fa4076268822e30aa51d9a6134883d964adc99bf5ebb2a8776fda4317b4470b86446972cc161bad0204ef1b46263f0591a2458fa8ebbb7d9ff52f0eca20f4cd31be8d30f031376d697cd30d607b169cfed6d531abce7677e6897b6c0287a39161b76ba32875f38117aeb8991bb73638b3dab12518b9d08051aa22b1bb85df3d0f78a229d89dd49362616ed8b1c5330c271ad9693df5652d013bc1677cd12fc0f8e2b808f954a6fed3b33248530f2c3539346ff76c5b54ae339fed68bb7d0dd3445ed4fc1abe5a22b4f45e2cfa8f8ee36531a9fdeff348cbf44df829ef0a1be8a47810afc96e3a22275a6a91a564579dc4d06c7329e322f1fea2e9dc40935ae677b90b03dccc8d0eb1acd1df24bd268811cd1186f88d83b70474d9a7c767716f7bd98026b56f9d71a8a1cb91cbb67594b2fadc64cdd6790e09764b4b19eee41ff32a8e104a469a80ac227f5453f2909cc7fd91603754aecedd70270f49165fbaf0be05ae35fe46bdae5d3a4abbfe54214deef43cf9736f813c2aa0ccb71582365c17dd8913455aed3e9ffbf4df288e3650744da920b7208a272a73162d209c1621105d11c47ab9ca2d4da11ad246b90d966a28310938035dc520ffde55478f6e6808be80f3c2fa4b2ef02c44ba6f01cce00d05d25932f3faf0b7d731445dc66661fd5378b3d218b6c1e89a6fcc0eefe741dc56218699580c4efcc86eb8e2d64cdf2e51bc74fea130996f1d64b99373655ea17cd5087a588e8715d84f143620e4c0f6a6b359ee406da9c9ee7929ba13b54f0656c1628a2fd8d4c92f02c0821a76d55e7ed235d7fdc4356063e30f70db5dce22f852fbd8fccc445e3d180bebafa6ec58db89a1ed8e02c7529bbcf625e78e3b37873e37b83a8de453da44f1a811315e9b88f978917eb9e19bc7f2994e12f7dc6aefb523cf56077d587fe1d79e163708e8c17e3c741eab41ee2fa9797c97e082e3e4203af015385b5e14bd8320788682527ab4b59e02e1fc4ddacc4c367f8ccd9b23b310aa6447ee41036cd7ebb6d6c73502c14751316bd58476c9021c29f1a135b725d8f7aac19118e390e9f3d198e84fc5f680a8452cf5f644de7dc708bc167a49012980e5551e79499e0f55ed10b1c50e8532de1364a554df9508e26e8a408773821bfdc4628621acfb4df5d5f2f0df539a0a9b9a296ad14169e6899ae19ee03e71e3d7f088a29580f79390307e105315ce30fb2005e0f48902ede0f0c3e0c8c16d2bc373761d01cf20f8edc823232aa1600e9a5b1676203e452ab8bb409383795f5e1e6115cc6c273036337e6626dbcdf03f3d625b13c894cb7dbbf19eea0e19cff97a049874e30d9f9aacd6031eec5f9d48400f5f824b83b69d4b1a9989deddb4be3f6bc11f9edeb660ae29e95f4b25094e848d171502b8a214d73629aad2257bfa64323027a646da03552e0d8861c513ca00a8798920a250a1ae7724ff3a17be5b1c4d93c39f65075e350c77bd8958a5dfece33273d4b38f271c5efb7905a6a9277dc165887ca234e6dfb28f39674bf07224a04c8c841c1481e7ca93da3967ab464ea7f1278809c19bcbfb74ae02e33c820275795677564461e0182c4c3e923a4ec819fee624f916c9ed56978fb0d5b7214512386b12d0e5e504409765adda269666c02c3afaa4a016968610207e9afc0f8d7b53af289f6b461495314281c925d651ce72d60d0b4496e4281a0b246f9b63930fc82fba260e5b8172c919bb24351cc72b72c65ea3fbfec508ef4168ece25b27ddbae4c1b8569d6d8ca81bd604bc2598c6a72068fdc765b6f050ea4ab559f4d8a6e80b0bb45c4bcaab89b2289dad71fa8bfbf1b06275d094eb2230b3fd8aa5398e765b3e21221afa742a1e64aa35d34ebf08e4d0cec661ac3cb5c5a71975b54ff5bda317fec604b1f2a7d60aa65e4a202debebb2342a1a2912639b4953e411355d62a6da6c89bbdf42d19478a844986ceaa7ba24dc0274e33c7c7fcaecf587e0abe1a0cb1b42780249e73f5541e3415004b1fde49a432e842b04163a2817a8e1830711f073aaf7bb6b35063d4b8f1b526e66c90ee515fcf307e01aab44a441864ca91d061956fbca45f7bc8befccbc24fdec030e07e9ace26f35bc11544ce6e0c65dcbe69e037f2185cc95efe018b14dce4eecab552c2fec5c8b9f687fb6fc634cfacf29b4db66de3c8a2515e56555bf3cf57674bdec1fb9a0e29340577b0b6ea6fe0fdad7df0239f2bf6bc1f77ba9798a4e5aeb3dd619c4bce41b539b3decbbfc0999c565c93b86dcab92c2164fdc5fe08f0d6e2546c790258cc964e807f8c150f8405a7d442de7e7d94a09e4da942d5113686547cab8d4816e8e2f834a193a2fec827816d637864059795e2f4012ef64c9f63ea3e916116b8e4f518189c329b7bcda38b7a74798ec31d5d248b60ffcfaa63ebc8eb953bf9f18f444208277500c9801bb9f1e0415895b4768e6910ea2b01074b9f3fcbfdbe47cbdd5bde7cd36b51d780d4414dfb634a9093269a6b3d0be755827e113a50a67d5de56157ef3590cebbb8f66288a3112a343d1252abf04599c25db8c51983c113db9a25fa46a607a046dae8216d980bc3c712b7e40b709ab1cb2f6e28fed00946fa6853f18f97edd813f0b48843d37dfc8dcf7ed1ba52e1301578cde71a254b9506d6a4ba6aae52059f0d39836a7ebbd4bb5e3962532b272d61cda5ac02bcbdde16a14892728c1acc920287697272daa26288beea7506655fd07271f53fb3c9d8320ea3df34025fabaddf78dd086b012221975d5380a3b453160f5a13de7f68347096c6048dc77b18c7174fe0aa009ff1e21bf77aea5893e1df659ecebc0b1f154c6b8db8ba3b3baf68d8dd93300ead71aa51f264bc6e49ea72f3e31ae1c0acedf9b1e45289d6cdfa56fd2d0f604fa265531ff05913994dfbc34722842ab656425391ee72e70ae40c0f560b43b58c44a52b02799cf5bff007e7767f3eb9e159443e9c682a82acd383db631f7576cda1f546738c4dc64147f1a24eddabdcfff731a072eb3f485f6d0189ed1ee386169c5a908ba88589dd782556da8f825cb51f81c07ceadeb95550ea7bdfcb3caba60ec0c2e0900a51e43d2f563ea0250f4fc47ca804aa3c9f566dd5459891c8d2310ae4fc8b7b97c8356360868322aeb3d90c159b249b34e331d404634fb3ba8590a3b7ab58cd8a5e84f2821c6c789d7f1460a2e46c11ba2e708f7b8c6cb96e7f811880cbd0f23f24e44ee2ffa99e4ea2316f2167c9b9a1660c6a0f6249f5b6f6bebade3e4220ed63033f83d089a818105cf8d2273620dd8ac52999a8e86cd12e5309510dfc86847830efabd78f9b440787f4d214fe16ed8f67fe73d24f7aa9833c6553b203297d9de37aa9ca031b20fac77a5b50a41586905b2ec376529dbdcc1b248500a1d9aeb12de4c45373609527566644f7dce5750f7ad6851b689fc597efa5274c1b091111a1e0ed9c6efef561cbfda24253140a6600c1dd56b3c2cee8845483b661a04bbbceab736e7838bc35e45eaad0fb6e934647ec8406d1f1275e68f5e279d2689d693c08f7399bcf07f88d7eda57974c8284c3278fed1d76e2a7e9918f1540f22f50d2660203f2815937bd58a944c8d74171a7f21ea7ea0ae0171430fac1b784507bb0a554bd169f42be8c950416ca1267dfff137d2be2fc1918e108fe7f32fa0962920e816ef39b82c3c4c67067feaecb85307740b1a66d38c481f75cb1524fe227f345b4ec4a0d3ef216b9479c387f9de4335d368d0de93aa2084f0968786d4afcaa31672ba09f62086cead8de8272f0f6126a66f9054bbbc8ee4022e23dc12087d7ea8c55bdc834f4b87134b48f70d8a2d249dfef8688f30ec1b49f660e26d38920e7a6317bdfa68daf0f415f062daa58bb476f1693c8636763eb27d4243cdfd34c8cfbca3bf1118f1088a39c917c4766f8a7916fad0767d14749561e2a48e655d097c89c27cf6fcf852185bff04f09f2e881fc10a2288410ade2982fad77589e0bdb74e0f47416f34e61127cc0fc283c046a5eb05e760366a0f17a6950334e7d7d3b22655317ac39feeed4df1d4e5ce4f17c4b2f8c7ab51061222f8cb98e1d205ba5bcb34eb166240ea2879ff0060de91e6962ba43d75979c7bbe72b3694d30fe3ca361114e8b1153f5ec782f09e460970d773ffda1a6aa959221a6c2fe9c8012e6f601124649c6dfe8a676ed2dc728449a735cabd66718858893f62f4d98617b5842663f4d9b2bf49d829cecf6e566264dab8077b9b992d2b51281f95c70e61db5ac548264702116ae1d97816c8ea605657aae2083f65d0c721e5557d26a30e7c8c75323d71eecc0f8442e36d18ab4f8debff2bfcd8a555635abec672b79a97828de6ab796d3145a459795ec6ee59f9c6e74e91e699b772309cdb7b4f0f174f9b49755c81b9ba9ce8aee058c8ef66bfa851ee983d00a1c2d6eeeade9d9b3652cca204fb7f7dcf14977ff5816ce9fd8a7040e471a889c658de9cb832a1fb11294116970b190d7e7af5b46b065834a2caf201acb4c4b89e61a4fd1329a92208aac62ebd75ebaa6698b282843ac36547b35e4403b013afd926c1f358475253c638ea1360f9492cf34db28a0751d2b80f3a7a24214a30b3ff69d4350142c61fe5bf5ba93439b4590778c6fe526d704c91f9edd0172efab8e7c83b873bb47336080db115fe52186ac522b5d7af311a8201ab5cc36706e3e02319b5e878f784c37de70cfeecd8090914c246d49477067348d7db1c0b662fbac137164c52dafcaa65ab39b6c6b49cb29fc52c8a7b67a07963a9802abcecaed65d030082a405bea6f9bd98c9103b1270580c12a2fb897e41eae6f69d5d2fbfc2db40df86f9e6e83ed5d191a0ad42976b18c09631fe98e52d65255ad999242356313d56bcb87f564fb3bf244f71dc33517a4529f150f208add888aedf00cbfd857e298636565dac8d01e7126372c07480d67ff628bfc7697bf26db78e854eabd2d520f6217b16f8e942bce9300ae41dd160fdc53cd6e17183455ab9db2a9be3efceab79f6671ffe1db89eddd6bc8ee709ae0a28e683d61dbab9a3622c18b191388855ebed8b90a71b6b6797f774228082f0c6408bf113fbf41a220235334a9884e978d34a4ab1a383a4cf354c45a8b61e6d42a671c2bf1dcccb716b7d613f063bf4b644a81572a4872447ef12c917810e250833c5416fd15022b542df2853550ea7fbb15d255b8bc31f007dc40d294dd0c0c488694f96351128d6c5c4b387542fa8b15615e8c39c75ff1e240412ff37086c479ddb6014272deab41ff2221e5e3d1bcb6d0420770dbd90e4cda65828efef912a963a4eab321632bb14313a79b181bf4c959061bb75fe4ccfa5f614d290012f313dd2dbbe442bbef0128f2ca6ca68733c555af92cd120e8b59ce951991001648aa0397b86b1ea64508e3c27033fbea1eb007d4fa22e3528772664e9274b32d7c46c7153cf92d02398541420baab82b93d3f7ef9c43645c2aa54e3c8b61e261486fe225e2ca3e51bb6ca95329da1ff68c22c6c40b0808e4a608953b5294ef815c4494b95bef5627e1658d98b075ae70bedc7aec523e85415d9142b7181d074ccf9acebcc6661b47898ade2c1401a23db8e0c16b748c7cdf75dea5dba918b61edc2cd4f642a65e4844bc307d100e8f90933711c1445674a1942d41a3939dd09e22d3bb38212479b1c9cd55c39f99f5c9e6ea93bdeed0592b9bedc1a31db9fb2aea7a79f1d6057616394a0759d2243db1648b580eb7716510aa34742d71de9549279b0fafaa8c430fd8aa204710666c12c2ef706d6f0c587cfe2725e611ea802b835ebe519ca1fe1c30a5237bbd7e7600c8bc82b386a8f58c1d26801845e37d75d2566ee203dac5b216c09fc335515dce43d2e5f7754d915ceddc30d3c14f0b500f936e80fb89a204adc3182209d803384f51b7d79b0eb9121617bd6035e1e837393bc12b375442605558f398bbbe49592ff6b832a34480d21b2d2b88cdac5aad4b23708ae6e01d443c28784e4aa269385a9d93d657bac27aeab9c02074ca92e9baf2dc0b144377397bd0b43f145044205547e868413a393abbe215a2f1908e6323704a293d2ffc5b8ee142d4620d7b7ce37d3de1f4eac62f4e03d8ee595823bf7bff21be290630fe627bdbee21a9d0b47b6d3a6b4b2370a3cc276f5c0961ae52d574103f2a932a8b6c1ecf8abf4574317c9a270ebd29f9396832bcd11b21c979b63ac05efdfb562989bc7113e28ba9ba3bb08dae834598fe7a0c30430f98e1c3bf024f0a80e61854cd0f392e7682994e42649eb078735bcb7999fa531691feb3cbad99b38f29f5473e7ff45949757805047933d80200e68c07ecd469e39836cf02218261601d581952557f711580679ade99bfcda0a836ed58d9313c26061a2f12503db8b7982a8707b09e73c600daaacbfd0eebd3aafc72c3192b4214b9638f3f5b5429baac9ab17b8a8ebf19493e09386c45fcde6294af116d863daa72b01d4892009bc26875e5c3682ce0bdf9e40550bcdae57fb3e07d3fc27dc96d85d975b7e8eaf8d9f0dea8fda434773a6b500b1f9a5d185051239c2eba1d9c29c3ef5acb1676fcdde4bf27a7e8857f53b92744b1f7d82a5774a311eb62d732460ca6df631d62bc30434b16cb9521ad9dbf36f812a69d4176310c6ca1cf813a01da1d05f5b59e0fc539c6fd980a6ca58c3046ae48eb937d3da1190f80a5ebbe67826748c7d69506846dd1b60926198841d4386ca732ae29cceb30cccbfefb80caa0cb11df35fe20baece52011ecafcaeccc547ab48838d09a7423bd191809e965fbd9e91fc7f13284e1a31396b7b72e03bab7ef619fb1f21519090f4a7910dbf797232b48c19c84ca63c41ff625d53f2d7a548dea68047002503ea9bdbb34ad49c5f6db0f5f372cf1f7c2c037bf346d6a22397d77927f738cfc8cc9da32c4978829968f39f6bcadd9907de97acd8e28185abb0a3299a829cfbf4096265f5e3953a797846b438741733541e4483f858d0f42859bb4bf4221772afbd8f2ac0a340454847618d72bed0b80790efb24779bb0926dcca0ad86a8a1af2255e4236bf8f0ed3ff090f12638e60eb642aa2d94f431c6b22f645e9d5f0bca7761c59ebf56940a01e66ffe76a5fe03c152d38235e51a77fd632110e80ea7d4d67b838de669054e26beaaacb81778a42106ab05c8ef4068a2f20de604cc8a4fc4259cb575c60c8cc7b15b2261f97e0e44a486c2394bee4be18b977a78a4caf71156972eebfbaa3cce3ddbd81c11e1fb76489d6790bcfcf5948ce7aed2519b4b940a9c925ff8b9d9c7c5ae8df49ddd2f2f3b932fd4fbed56bdeff5c89a9ac0e44b8265bbdc6c8b6c9f8c8c714c9f526a02f086039b8f43e4f2cb7e55d6c9f27ac5fc278049f31ed98f8e3d5eb91e5196977eaa1eea65709f656c35a970a159bf0d321e245d8471de8fd161a27c6e5214d5cf45c954ae38afbf5eba9b72cb46f37698a085e8529bd79bdfd68cbaa0b92202863854b733c76628ab2467a60f9f5fedc11f279bc889500537044d28049e50159ee8fa90619d72322f722557245034a07d4bfe48bf16cb4a224e4559f59b49dc53453aef639e0efc629207d0f84ef424564f75c608d9db256e8c3d4054fd39bb05743c9cc8a56811ab1c16f164d017a355cd39d4d8ff3ca9e0d34e5e69ccf4b7dd9a4f44e1edd62639da0bf379dd730c6915bcb69fda886f09fbd7df5dd899a3c2903fff6a5c55c114f398c3d379026d10c364141a4ebc04a59a722a9d14c29837d83b2035a004b233cc307e3e875d007d423f95d1e7e8c9e7fae0c81a2f4fd0c04a1fdca897f2da2191962172ac2a36b350ff448d87e352f97bafd6bb813eaabe03592e19b7a6ba1db2bed477b35c6c12d7e2fc66d2499cf523ae8dc8db01a6b63f4580c40a826a15b83c93c1c9fbc90d78f81fec276aee2c3caebc6c5b579b7f6ac0b1e4857315da099f36b03ff2aea851a65f7721f6586b0b7533255d08c42304dd35955e436fbb44b83d669bd09ac83d7a5ff91551ddd6ffca3aa4fe836994b965e488e4392470492dc2a7a943d8149609e02c3e498bbacea5b52e52d928b97953b0044948e8c4871a0cad3fac08da6d3f2bd6d29d78db76eaa44cbf88406a1ad211d25c079fbbfc983226fdfdd805f34d39a2f169f822c74040ffebbefa82582f79d780327cf8ee7c693a897bc4b7e584edf143c40dcf040ee1bdef7d760a177175a78c72ed0602655a6d93200cdb7d30fabbdf483c3349d715e64f70dcc6b5420ba2613ced6b748d31c2a58ff25acbb435fe90d42257687e0e3cb9097e1a7eb094fa29758eee95fa65e5de431a7518557037482867ee4498789694deef63a924e01b67a69e1b5c91fb74cab5ae34dc6de51ce5faf55b2f988a2b8ab273cc0ab3de1018058789632a4c68a9c577d0909e996ea839aced230a4838c048e560aa20623c8ca7b3acb5b79d0f84f6412ee9074fc8641ddab0912b679474de4832b061ecba64da5da4f3881e2a293b060286cc88f168c63ee84fedc44dd4d821c04e58a9fe33229872c1f322b2ffaae931b7c8ff6e7ba22e8191f12d19f50e185dd742e70ad91317aceda84a55304ea4b617260e8e083d85aeef9c2cf21c31c5c2be4d725db21a63213225d9da69c0a6f45a3d385b3cedcbcd5077773d5e2a55662e68c11eb1b198a978b69c57a1bef7218a587cdd65fc68a0c1cb84c9b0e864c4587459b84ad4fb645519e2a901814cae46f7c9e67f31fb9a4f626880d4718d95f3071a47ab77ce7fdb21005d21ca7cce7e4c09d608f084c30a0edf8d7443062d1182aa99fea3466752115493d33738a5ba689a53bd453a6510619f79efdf05f33b8bf2ea4126a4feb4653c89a22bb771653bbe23f0350ae38f0bc25eee34d01cb5d72c99ed0e8db34e550c72400ece360b4d62a9ff673be50348a6f106a83955f2be3fd1c16f952702e3caf3603cc95839893c30f77752f87ee5661bb04bf0606e020bf4a3a4f51b9cf12c91fd9ff68aed2cfeecd71ca84c72f43ce3a4a8233525181f4f22479ec2e6bba73864a02ca05eb1c96a44e3163d4c52b472722a5712bf5ba22a7c5c5be972a72e10f7752cc1d288f18e428ef4b0f5694341e300daf60afff1304028b12d1199c74455eacce76c92514f6cfbaaae5abc510e67056eb37cac5ee8deba4e1e822b2ea7374497e5f1e6872029f7a5d8a712d1d6b950a41128aaf4efb76aa450c7b0c55cdeed99cbb1a549d9f7b6629192886b179d8c77c0f89c0c6803978fe7fd4580b60b8b4ac110b817ae837cfffc4513c8deb36122576729b82649d6e92afa50275e48cf2b329c64a315d40d977b9e7403dbeb2904e9197e75f3725213e80143909c05964c60d272117515666f86acc71e95a22db6c1cab0a71422a96d7ae6172837c08bffb58c21769f0f0dbc4d9172ae370b67cb8026635d9a4f93ec4f592cc812ca15e49d2b2d748cfedd0a9257d1421090f611360681dbe53645f2e71bcf43dc4119cbb93e74c4df47a006a8c3d4a4465f5efadd65d87f559a1d13c6f8bbb217b8a530935170353c70e56495d4e98acfa993831a1920a4699363beff9ddcc9216d5af729143a49aac57038348f828d0a273b8cfc337264a458fcb3dfb7d9864c72fe9671126439ec3bca98078c39f8ed3bb6567b75879d98b12fce1487e950a54d7fd4b2d96a1b80ce81f5e21adb8f0808c3cfe21511e644d17b7415691bef8e3e3cba8fd18da950d11b556fe11e678b8b0bb02f96840581758f406c5813c91d7ba51ec6b37827ed75b9d9499d620da76faac8e9122cd3b976940a90fb7323983538ba030c43d2d769ce728c545c8d08b44411a840baf9cc6bc291040eb25a9d5ddaddfc59f3bf0b0f6357d7440f2a955d45461fc57f4a5ee7f947e9e963fff1122dcb2fd2ec2c4ac816821d4fb047e2c7795c83495b4f47d984a59da032af645f0e5786b329595af8e1a1f025fbab44c6afb373bc8f1f7477f82450879a9da2b1fb3ec0caab093d134f59cc589cf9b55cd7d9f7a05752263ee058ef1ac163654f5cb63aecfdd7dfa8ea5ea30f493a98f23048d8d12b039415aee8efd05c4374472981b8781b563430c0c46f43c94b0df4b669ea15aeca499b6e732400ac9aa1f232710e4967dd41487b0e49900151e6a7dd92a8767301f4414add3e33b523adf2baa8083882f484a1f84c32b7a0c79b5760ad4b1bbd991678467280b9137dfb4f73e805cde2f4fe3994250e37fcd70c85e01110c987405d57482ba322cf37a71778dd9607de242ad9a3f653c03af657f2cefc68ede55e805992f72adf7234fe029ec375e139ce6fb9581d46ab8feb4b37a5cbb97cb76788e0e2d132695d67c9a98e54525d451d4800cd7687f5af3076952e210033aaaa12cc40e05452d122ee47861c32cfde5b118ea4830bf9bc26504ef073dbd1c4e6fcf08ec96511a9ec0893ae8a8058cfefc8bb44f0a1ee56664f5bf6a493c5e9c915a3aea2ce193ec1473b11a0ae62e60b5907b2dbf3e8a26ec684c5e618cf223ada0dd960266dee7ebfb0a4bd36d572279abffd401c68b2c94b0806d21075d23d77234bdf600405613654facec3442cbb7bfdeed4d3cd3e4027cb82cc8679374d19d07f744907c4c53d24b731dcb8a45e123d3aa027b7471b704af41463513d510e89ddd6f57eeb7a309f895ecf55c9a4f87b4dcf13bc141279907be78b34892a44f457b320e7bb331a3549df276db45d4e5a2ee9712bc24cd9210e14009e13675bba7c8c508d61923de62ced1093d4a12726c1cc5325a326e9f7112c053f380e27e0266aa4bbc6788ee895c42d957ada2fde1645cdc14873bd5cedfbba6cb5b86c40b2dd12bdf0140707bf9f12a5cc82ea5522cdaad4f9631f76a3a24f8b5c2f4e0d1d724abbcdccd53e1ca5135705b0632374680fae46baddb78464030c0fa722faaf5f22dc1f64b7adf524856cb1ecb7c88b9005052193962cbd3b9b824afee6a0bcb756c261fbd42e4e9c0659fe15867667f2951bf2da79fb657f6862694596c52b0846626f5001c3f597f7a5229d62889d04bc8c8ad38f17abdb6cd386b664976416d6437c1083bd914c2c95073851f14c751b49e890b5c21de171471d3e87b73e604948baef4867017587bffaae36b884849bb408c1ba15fb8d1276e510e5a3fa49431703a9fb6c272ef14b8520c4dd4cec5096a8e791f878c63f055ee292d51d19ec5e37dd357b7767f48d2e40fdcaea1099dd47a32785513c5549f6940342669e356189bc8813aca53fc731a06e33c835be89e076b9a63867d251ebddb48bc5356d6fac4dc4313531fe6d551f397693e1a753eea8400967ee87ac3bf00656b0c10f9ab557ec7163c1412fb8500c3a0bef39459781cce3506bdd2e6d34a9cf42a40f310b1e2b3397c1a589a1e34fac1d18166dee5fec1b4d0ccf63c34ec2809b1ad765feb77ea453d556fc46e5b9c1edf8c567bd4d0bc6e8b150b2f58198bd19f2b8a6f858475361130cdfd2cb1cec8a4440634571723999a0d203af98d259302c4ed8a8dcabddee01b7c9e42d3cc170599bce89c03d86562573226ac3edaa93755a3e32a85543de2e4c3fcf47687ae8bbfb80edb828bee7386b07e35fa6d876e2841a69fe78c2f5c6ec72a1762ce5867a13f7ecb8476bd41d04cb4c951434a8b2abbe249a9583be31258f7e383bf998ffa3be2a15051f3de91dbff0198c1842c54ef340c3bf5e2506eafe21c3b24e119552c819c3e88cda3858bcbcfdd0fe917560794322597e712a3e312bd44d1e0e4fee42fec809b4ecb825297557b9b941bd6b968edacda713dd22b3cdcc0e1b341b94c0e3118bfbbb0d648a9ba2c9ce7fca19baa72a907306563248cf19d65e1eaf2342c4a9b4253139ceb2edbc50c4c210aba82bf96a31a08a2a4ecc973e2167d694551495d07c44a7ee602bd6d37ce839b83c2b2a31f68c881507b041da1651eb7e6d2b549a234cd68fa9d45f03fe104296509fd099b7a909ba56cdedd75e5f199d7a9786bf1e9e1af46af2d831e92a102e9d7fb0c3f67de73f0993101fc54f9731a9ac769e6550fd809be44693e38a4ed33e889f5a7cd1ba900c1e471992c891e27a378d3347a70c55ebf9b11256eb50f87312ad6e7fa8c3ec1cff4044d62c136d08cef478621e949e4541b42326e886286a9140d9502247953b8ccea0a96209802080090b2fe5de307def33d6d7701da51e9252a98af879a0a4878d49c598da16731d7b175fd0581870992aa6679c0dd4d56bc3a423cec88d31131c1b30049d98893d33acbe94b4ca0267e9cad1c2b24cb6646da4ce6c9558a901153899b3e93edf636a8045770e68ef40f1c4a7ea7aef70af0061b8a682dbf966e8ef140652aa288924a13313236ea278e93f97eb7a21eaf8a61566cd355ad14b3d4118a5fa0a4ca833ecac9aded63f776809507fd8492aea30eb8ff61f3be3f7a0eb0a6c358415236a4b77a631e890c17eda2bffc5c6455549c273dc8ab796cdde1540c1c67509fa4f52a826757f6a794d7d27b78de8bd6f598c93fb949b085f4941fea57f34e86ef6ee1c3bd00ac2b325bed6e36c34fb9aa58b9954459d08363dca3942c836d015ec9ce8e2a912dd010d9638e0b6bfc107a13b26bea8a0835016382026f6bc3c5c190bcd0817707c34f9756336f5ff417013f8e59a15ba40c946267cb51ba87caa5dde96f95c0c7ee597d4aa801184ec3c239444be45ae586c92b0dc1df2ad45920ddc26f0a2e0a582a5977937724d01b344f7bfbe32dbdc7e1e194f6f66fca5432da1682412b004cd3d3d213a2f8e68bdb952d2a8f64dc1aea6ded67cfb2e8c7ebbad863056c97e2970970421e5e049f4edbaceb0fc0206fe993c99b35a2bf7d9fcd498e9bb3fd252017a5a991016de5f27ed743e8bdbe6d065704fc89f09a15296a8153cca461eef42260f0cebd0eb8dc4a0761d81729a981dd6a60ef6455e51298ed905d00b6cc2a3f108aabfae40217017d32dcad9136dbb30433050c516fdef0fb03d238569eeaf4ebb5edd2af7f4a5e4bfee3a7f582712efad640493501de465d7086b092f343eecbdfd1d6b0f2a6bdbc1c9c3f7381e2e55d27ded04c388424677c318271fd71d839c9f11d19f641a63c5d645a1b75ba716ce457c950c974f95e738985ae83203f3e5712b2c524d843f0eab323c8f5fe063ee0409e237ea643a14971a70a450fb01e0e1e5a5f56f8e11fc5ddd5e4ee3e04c891cef862bfa33bc94bcd51c0afaafe3e8b9eb6e73a9203c184decfb9efea1086504d8f04c5d1e38b52bbd991bb0463256e459dad75764771f8bcaf040d8c705d4d78d59df6989ed204be6626999d86ad89800521c000001b5d71ef5676c1667b6df6a75cdc9a5d58ec37a5e154f4304d4968fc5926031a21afcc348af6f85921e6104bc7b089af4a86a9f6840bd163ae2c3a8e5e52c597f938b031785402edf820cbde3de3be304a175bbefdb2147ce3a8d1d0d581b14a76d926ec3cd774fb63b4807b3c57dc06b4a86f8916111eb8ac94b24a3d82086f95af61ff08c15a4583a95082eeb717b3203f4a11ef3a3ed51c4b72c74c0619bb57381c4c70882cddf9887d89991adeef40a5da1d7cbd3bd57a3aa3284404700ab91d4f6bc0fff99c401524cce261a395780edede8d3b6cd7b0f2132ca47601ec10803afeed83ef3a0024de28fc041b1b3c355dddf1b0b363bf6f6a5ef58574cb57ab0a51b8a8b06abdd88333eed68ac4e0236a8f1727bf4f255743f685a153c1f23ce8d02516a2b84685434293e928ceec15bf89a2f836fa4a23c843416781511f35c55ff0a047a24d746c911a245259e9b6d1b5a0a8d885e0cb3f68f40eda0f14525241b00924b36cf29734bd15c68e94f723a5f9e6abbcb00a857d803b5af639c9d8e9af500bcc3a186f8163e1564e95c049aeae92a1c6527e42221efcd688fb43cfdced718a9ca324756b818bc3804c0222fc3a48b5a0e765501fe4a301e8aab6d518ee725f2b2fdf3bd5323aeabe481908861fbd4dd4b65391c194f72436ce0ea72f72f46c846a0fb6c59a2b8ed03719c44edc9e78d31defa46aa5c6008ff68ea5ac7a04d2fb71f9a07520b59b9c21c090cd65e4b2a3252f0c5ce852816046f39cd3a5210443178cfddd8777dc5bc191751ea9ac1583757f717255343a5f274e09114fa23667444d858e4a7ae7ec029021217f5008ad1bdfc3a5806746f97524531d5c1a5bfb9821024048958cd004088765f408bea12b813ade0f0609b5e0362ce2293a6becb57dfefabff7e4c5537d8ffe29a18d5b47841857f4904dd7bcf32ee8310972af01788502435dc796ce022c08ff6df61072203a7a9d4908ec9cc9660f98de51bb7402a38c2d9cb546c044ce1a07ed8961ec7e7a31ba2f580f77e70b40d9a7ad835ca37a63a834e6e3abb3e7dd8279eb595ec0616732b2138a129a227a8d569bcea341e26e578e33374496ea4d704e88b6c4897e7b20613e2f41bffacfd47ce7cb23aa43054c24800ea8f97ac28940b3d6fba8310e0027cbe96a3d73760ffb028ac842d4e6003afac059c731e3063ae083687f653bc1c299e6355f11b5a62a34a29d3066652442adb11a6c9a9d2cf234b86947e2a064cfa82ba4224395d6b66687d3eb19dece5264b4e9e7976f504e69a10940594d787d10a357cdda7827f8b9b373ee50a5acb62842bf447d515a9dbe77e11d67a56f3fc1921ef2657bd66c84dd05b83df292922656988d43ef1f112d73e098e887cd07fa09c28b5f424b8ea49f0d97ffdb44107f1a57f7628da18e05592f21229d46a145aee1731f0d9ce051f57c80e3e2160d47611945a2aec1582d95d5f1aa1ea10e036f8a80218d65e03e3c1b0b0a3b4a152ecb203dfbc80091a9374ebaf716de2bd1bbd4d3be5b570a8c2ebbefd636de5f97ab1a6ec181cda14df1b6c758dfc1afd7d217e5ffa7cc367e96cff43ace7b3d00187dd697b99b3706c33ab11f9b1c49386c62fbae11e039505ba13072541b37fd4bfae6cd79d72622cc09b8fdef6ee21129cf21529bc8ffbc206105ecc66edcb9a65bf40de50f3ec5824574a090dca910917cf2c7168eeeaa2649854c9ace225572ded3e695f41328ce4f76c1efb5182ce092fd0ef1ab025192d8c4e09abb5cccfe6ae31565248072c536bf8bda5f72cd1cd98838575b3cc3841b635c97ec5c6c78aec3aed2092c6942d96156435c17a77b6ec3e5da9b02e29833a7f146d05c4f9cbc2224daf651a69424b638ec660cc2806bf842bbb0902f1f9aef8d6bd21ed26c151929dc114ca04a6fed86e9575a891b794530a0e7aea9615171a15be9b50ae84290b4e6e656b2a6422c2ad0ee5cfcbef5e07564a443a60f405c493ac7fa71d13d9bd34e144f0fd2b060d3f4640fea7edd6a99a4e6a2443b8af5f45e1339d9bb9f5235c71050258b704eb25b46ecf6163c28673506afbd8a8928868d2354382eb2f9aae675407a668b0e6cb78c8e61917b981a11565c2985369c5399844c04fbb9967a6798e13e8dcf754d3c26dba991932e6d85562be54df0547e80c8098999e896d980ca1842a9b4b4e45abd6b6656fa6b6a5d97ab9ceaa086801759a7a8c2d8e7338368ebc84ff84658bbbf038f8c6764bd5baee377de0760d8df329eb5c7d7f373b6ef241570e4e051731faea3f9340e908a8c65cf61fb1cd7113c2343b28399f2a0b2e0f17bd4aa7eb8d7fc01701df50145f850ce75792e73a8b803dda452d24059f9a2c5e9363258d855876d52876f8f062eda0f65c03a0e5c68caadc14d69a16c5a7950bd81487097e6b9923bc3b915f2b14c7fbd3514064dcfaa0c1469ae2b4e1c289ac1c3ce4b5f69b28a1f650d9503ab5d118fddf1da0bb52dab7633369881ad7ca4a7a742f5f184c08b6677177df2d422ef7855bea7eeb4fbe779180c2498b2332aaa0a7cac77db9c828d202f2ba340ea6b848acfaa860aac04658add53614f53095eed03f5fde70a5f2296b69c52d26541b65adfce396079e358c67c8f47e57b74f1d6859d08b0a2665da5579d0eac9a1004b5396267ff4bc42a059f4172c6cafcd5e951b153363298bc074079f3be36a20fe9405974c8dc8215ce41e78f4ed826756b375a229bded07677f84228c0600412df46e6fde0d5cdd2437d52354f539d3f8ca536ec07b852121c8daee8e8aab1c8bbc3a0403ef80d27ec7891ca0c47575ffa857e8b786d1f5fce1082b93532d37902d9da542f527cdb299f78636c3633031a7330262996dfe215dab7b823d41a57411a1f956fbae3605c41e3484766e06ad17106402d5a19068956b8161c553bb9e458143722c01f673276cce6b8fa25133f0fac5f2fe691d3940427d261f4e5ffd6c343e540ccbb87ac418c2814acaf6e038458703b9f3d8bd16cacee2f4581123a4db9d4c673a029a6d0ab66a4a4828af57123705d4f4a19e1586609e0a901eff1d2da86c8f70684ad8986aff079030a620cc6eeb64dbc8579ccf665917eefa91b8faf08a3449549ec230a0fb651b43333ac12f1722fe5623793b01bbe7b1b4a79a89cb8c35463d6e78c163d202f8fe5ffbe010e74cf4c8951cf55ab6a024a53b2b40b4c2823d7fe3948ba35364fc0e3adab3a28790ea1a73b544066fdeee65eaff1f12cb7b3292f570e5a5a38d56eb3b0cb586ba2727f245e33ea105be38381f63f15767c5950e8eb20f4bd199f625c957955c348661166213176cc5a96bf75228d18439511bc6f5113e6dda8cf6ed67ee8a04fdfe9b8d49e7be334a61d3f92754f1a535e94cbf29b4d030bf6d5fbefe7c642e4553e2cad5d9a0551466dac55544707c4e91e08796505511f0be082f877acd84655291aba66e0247466c35a3282f597d8ef4c45a274dece8d0f360d90cc042e2b4360bc4abdd96bb42e9060fa1cf8cdec19d1ff87f62d92b33a32e91f557f55a5646055a1e6e20769e10e07a2bb07a41d6acb77de3f1c098c20cdb313e4bfc4d6ff4e88b315f35e108627fad5de032dbf082bad943697e5088e7ae68f95685933e0a10fcc2c9d6b864bb73aafac6c0dfef8d5cf17119d6a6e1fccebb8e03a1b4b5e99aaa922a4d5e7b3b9f3f5ad455c8bd10fd360adf351070187c079478317b1a83fe8027526a481e1e99041db8cff8e0bbd1f09c82089ea643082ca802938a4c32a05b0a8825b443764baee9170d9c464563f7152a0141e4c26b7e51ee8312e4912be348e5847da768a578a28db0af9d00a2125f169c668a631cef903f2d449c68dc0c4df5c58220861bbb511c932bcca92856e939adf8381df66b854f5821692c647a7e46b5b03f36e9ce826a14992b6f4bfbd6677d6aadb414f6cfd33d7e670205dd5c5032c4765b6db7129b4e31903791958af2bd1ae030b62de8fb13596eb844933b7c91adb80c356d9b06c4fed4abb712a817b3dd870e5c40694edc5cfa48ad76248be6f29f0955af9572eac180e545dcf7160787c80793dd6e960b9084dfc4e3039328fe04aeda5a9caa8ce24e493de5fb754d9b314285591ed9a621f152ffd9798bbf6a35575c0660f243fcc5a65b1f5dbaad0b2f1475d9de597ee9237ef6744b319cb292acc007553472e98649eb6e74b15f118054976c939d70dfaa62f2f453b75aabc928279e81406758f0ec936ac1d605df98b928216de9f95e591f02a15c405b6fe8fd41f0c454a02e3c68460d941566766d1efb2d32fdf84916088fc9253b363de57f0b5a8b833dea2ae8df821c17fc4e219165a6887747cb5abab8b90129e3777404e565c37396c75a31b9647b3a75395daba47b4252677742c38618d2665030cabb3e992e8ce2a2c817a85d9b21baef97548a698fd607592f1c812da8e4f1e9b44802f3b6efb168ba37920c96ab6af50c96125db34092b2271678ad30b96c98f9806dec92e08679384be380921dec2883b390bf3be1efaa1f3259137d81f9336e2c207190a01dce6777d8b1a746abe8471de3221eb8376bd4e86bda4ea02f6ea2b5da4bbe5d0102a6d124431544db0e05244d3c76c0a368c4338f728b70c8a61b6feb26541c21a01bf3213a7e49c21d83dd902437f4b077a49634300676d38028194fb399c4a3dd0061936adcbbbc735bb4e5ffeb0930f7989bbeb6806040d4e76ef359961773fd41f5ab63cf521500c09dffb82a13ae7d236b3c5ba49c154be27c7f81ba74c4519587d0e2ada6ff5d9c8aa0cb5f14186dbfaabf9ca672cb10de7d0cd261c128299855b0a389026abf0a312f538553b96eba77006a49e27c6ef7f9906b07b7b32080854683d414635962d6aa80ab4e7f53dbdf0a8bd2a7fcdb5f0f5cbc266b921943988cffcdb04903acea6ff64da12dc41b96380dcc1fa917735f281016dc7a2ec3d945686afc68e3eac4af83ce5667a603cdb8ffb5f42c09f54a4ae609b54c5a012eb673d0fe9bfe47232f6ce73aa5de7eb613c3292e16b82dfbb19e2acb18e463c5efdd4152ee94717927e299b51f4c5df583149c5ac2d190f170311222c8c0b17e6375ef35a29cd10612ae6bdb7be2a6ab8c678b865eb2bc95eaaa35c49b940302eb063d80becc8dd408f27376e14097d9b57056acf7a4297977b4452b865990e0d32084a57221d9ac129c575142f7e502055f7e220acfe566b23d1e2452ae3e302a51c436565a98ccba43a1c613e9f16fbf46734a03dfa7e267903ce6ce93e4d030fe3f11a893dfee220062c8ed570d67fce4c56a8096c1f21a008b9bc819766470ecaaef4f891667586786fca07aa4c4641bdf605180a22bd6a4b48317afd86575561ee4a056676289c72f931a8e61335ce48bce577ea15abc57356d9e166903b29876763ab797bca3961363053d7d7805f9d85d394ef065c36fa69c945429dd1997f5e5cbfa44f4fcbd35d85bd90f1420bcb33cb2f17f92355f8d5bd370f8c4c0f94d6873b1b66b6dabdec302b6accae5328e280f691c4300a557b4aa80cf7899bc40c92d3b2537bc31cf7aa32fd9f94b5b224c07d8a0a078fe619bbe071b48a03c14f02f60e1f9075bc039e190948cdb91688e32ecd9a4c2ffd152b253ee49e50c999cb04a29be21d3e326d5bc8caf5762d96b61d0e32b21cde400e59cf9b81bc397ddbc027e2e327b4888cfdc026afd2ab1c343d3df5f179aebf1349f7e7df1453b8327cdd769ee532f1d06a9101445b069b7e135fdefa08a60a5a5d288aa5794dbec615b9c4b0f1dea381a8b7b3c17e88d58e80e3c2f2a2c1c9a93151783587903f57a131d3c14be4b0e0aecf934eb43b0dfeaf2712103bacc55f908846a791f00247309795305902e7ce077c1f518b475236165857b1e500f3ce5db5514d10fcb0a69e3061b1423101f26ad15e87c9bf709387252123dcf4989849b5c3005b94efd29190e68ab59fa1a0afd8168e7a50d62c9cb68b67223cac5c285b086c92ab7aaf23b84ab026f4e72e43c43e465d081c35542ed52fac1f28b7a22741358e5d582e755cc28978b98730fbc449e6ec3e939a8bcb92e5a6c1e35d318f0d0e63051c5b1ab1415decd9705a5b23f6b3d27a1e1f6e9da5b47ae64be74ffa15bb15e8f5794190f8d77fc17ef61cef7f4130149d3658533ad01c10b120d1efc2e96acd88f3d5dde2f4724fbb474e5527c18e1df2839cfb3e96ff3a3b9ce75468ac0e5b9c344df762be19928bda1ca3242e6783e39f0aca458affd869d8fce90095a74703f88993d8eaac8417029fc9f9cdf89e225858fbe810bc0fa3c336c07c4194d7e8e23daf0cea52ff2241094d68cbb51d2e5760cfeddc3508076e899dafd43381eaa48140378499dc3f986e271648dc2c57e4e","isRememberEnabled":true,"rememberDurationInDays":0,"staticryptSaltUniqueVariableName":"302f04ab65624dcfc8b384e844909600"};

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
        