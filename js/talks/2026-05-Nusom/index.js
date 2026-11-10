
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
                staticryptConfig = {"staticryptEncryptedMsgUniqueVariableName":"a47765eb64836da7f14a8bf5029d2051c5bb33b3cedf575de9fa2dc32aeb2bbcea38877579539d8b1283671f40eeeb7930224d720f84b103a2b1239503043d9f1848ebe877e34a81b95348794e0f2ca4031354c972bfc225c53ce2f63f187b7f435a58dc7877084a1844f7eca2f9721249492ba7ac3fdb9b76e01167b7b64a818b2ba19c4ee582ed80f094494c2a7a1691aea96ace407f02227ebc1bef697bdc4c09b87a4e2760582a0096b7ef62d5f10c92a744ad034fa734fffbace314c7d2c5519185633dc3cf9a93ccc77370adfc63f6c58e5b651ee67e71d8a266829be27c00f3fbe35e17aab18d8e6ae76df43a8230aa24e20884e4285191e601ac36f9bc2844c463d3dc926e7a44a6b9f94be54656063125d00445d7fece020efc07a568050fd38cc758d8edac42d731373ee5ed70ee7b4ee8f9f652a17372708ca9ac6185b093f58f98d12a96915360f93b62d6f3dcf5b23d8e971b832c5571e2fdb844d7e3a690f06e1480faa5771d8c2273b468e82d44563b73a48f9801317e00d073fd269ae86888209f730cf9338b7bbd929123be81f44f75687886c83e4ef555e8f83e2faf42a3c00b70a1d193837af854ec1d95b8334f573097d377c0f27ba29d59dc9b07bf5a5397b77b57cd4f076ff11c0464fd01a5db46564eb912865cd1ddefc4a01f5c058378e04ef047ad895c0f6b2ccdb822edcbffd6e6924f0df773f8e45219b2aa91a07e865378bea759c564f45ed9819fb2f212af1be323a997c9f8f1d29b83031c44b307958dad5d4c407a96514c661412df0a6f20f785e1036efe4da7c59381fecba43ec1a905a9ae790bacd36b7cb83ed8c5f9f5c1437a75918fcc46803b36d6fce16ef3af8256020f4bd8b6d0782c1ca34a4bb6f8dcf21b7dc8e031f5c70f7d4e584f17e71bd9383351823ab5093a20ee676e65c467cbd2385e1398465cc89da32351a73d0c622d5d894c12a0605731c8428d410a1f6deac87342f4b0f72b55f2bb7b0b1333002615c670207be4c97dc0d02a20b0af1a83003d680963654416b6f5e23f54d0647646edd7ba5fad042b62ddd8c8d23ed947793d71853f56fe266605e97896237150ea28a283a9417a1f9e603b283a9a99776e409fe5bea887d18d482d7f7d06c65e577fac01fc5b6c3f802675e26996da3f3e578de39d443d9e54df6e20150439bd3c4822d13a866472e0d519af20cd90ac98625a77bfbb31ee7b11d022c0502800b706154417c332a30394a4a422bd234b164c4b552c90e0f5b3747ddf1a793672743e59d054869f8beaa640ddd0d23a8c6ba7d747c805e47820f9c1142845025ebed567fb085161084287f80dca2ad33a9538dd04071a6cbf16129249fc33c0cc79b4c052704452ebc9372bab033a2d7060f4d66dc45423094bc07649e13a10e865dfaf6da8b899fc3e7be64c422505800348f75cda26b9d0d91b08216311ced4b94f2e29b713416f4972c633be3f9ce621c22e53efb0b28e672405694ad6845587bb89cac0ef3971ddb052c370d7803e2de6fc09cb9418c0e2dec6e12a7fd5e9cd234db335b1ec957e7e7cfa1c339bc2205131a7a9562a1bf39750d341220eb11b719127c0741a5be2c44d59dbe2872fd4ca8f1a69719249fa4c72f43cc750fc98b20b6c7f5a732f3996217e3dd45ecfe1cd663dd01b59c8c7f06375667c2df6c51be4741d411ef524a5c8530d829af87eaa001ede104de77a6cfa9005ad2ffecda76c5893697b02dc26a7e944a508df886661fe4361bfdc86cb5fc06768fed67eaf2b78c66719a48c56b756db6060b1150d95ab4359f5151863ce39abdb8d66079c6c6731d8d1761a26349e3d8003c089227d6f7d60ffb389af0d94353ebe8b64c550327b0661eb7e506a1027f094ed203591b7c890955d116bf014f0a877a71e1a647b510a9df2b9970699640e8bd7dcfe5fc8c9b094fd7ecdf77cf733079dbd230fa37a86b63881acb9bc25cab5c48b2cc5c48ca43dbb1dae4e4a29a0cdea53f8ac084fb1da33cf9a9e90c4db0cf075042003d9d80897ded4760906212ea8b24e1a207479c36b808cf915333a8e9e3529506fe936e25dedd2b4ac41c3bf6b360eea5c8f41ad7dccc8cd81d49812a893d3e570fa88b46769a3a095c5a0ba10d3f304f5daa0cbb9b5a20c5a99b9617d4e96f8ea5f11cf291718d59f2012262d86683dcced4d4075ffd9f09486fbdb1de685bbbb0454d0300c492f2cbe7f7bdb04142c73b7cd04a7d6737d75493e95252a5c3dc4835716ff82846376ceabaa621bf750989c80fbeeb31a1f53c3e8367034640cd34755a17f3a9a9cf66904f29824067b4f1b632a9e70a24eaf02d184e5dfb30601d2370c254098fce14b3e75e6388bbe58c83b219cd3d0a1cab0de13a01dc99f983bb147ebe6084130622b17e5172c31e37d5c5f557fd8bfc31727011954fac0a318af878014875c2f16b98e58623207e1fb58c5791786a4c04f0e92f8316883dd74a0b8345046015e6d1e26ae2a7a81089c53d555368b7f99973fb81f8d7b0f10f6b5e3e11b4c1851d8c5e7845308e3bc0d03ea67cf3d3639ebbf4de9e41f4b1a8f8f8184baecf116108d4f66452f0d5026a336ba63df4a54acfa884ad69be6c93841fe919e3a89e4977aefc8822c250772625750529cdb712671cb548c90eb8e1353c895d1cc5eb0110ceadb9513788df6955b10052ff7493c1ccbc637ae6f79ca399530ad46a0d4e2737e5da36b897e86747717d1aafa887f07fa995c66cac997cbe4fc8d13bc8dd3be654dabbb3f87fe484eb8c12498bf2189bbafcfef6675774710c3632b01b10eed760c43b8b4144130a3c639339fc4408a3459c0522c7c569fc75290e4c7e9f5641809abd7462d3b44447762c2bf9e80e5cd4b1af582ee62d2291f3f131f4f6c4ed3f59eb44e016061dd55b87cd235ef0ce204f629aa994a4560807710e6d1254cd0a17d8bbdb5ec16189213e57470b5bc1bf378cb4cc1f0b6cba93e3a8945b6654a3211c761b3bddcfd55e961bbd8e3bf9c3a02db6738afb6366f3d3a6f1c4a705c20e147a6be855812be2f47d3ffb564cd2f474d26dabc206a3a8fd751fa5d6cb18a4715e5be05718ab13472be48ca2ede413d429de2b843c622cd48b098b0df216ab53d279b302ff63b6c4a9fffb8da1f2415924c48ce2bc3a3fb9a1f1ef972507f5b46177bce1c39ea890e23bc70d800247eb16e674020de922f3e9f1b4df6a434bc70849fa38571e25cfe91a681e94e5afb1ada9a499daead00f86934db9b835e2380d62f648e2c35fc9fea833984a6dd5f175e938a98ebde7a5a65194139e4c7bb896c3c7e19fb4e21b95abae06339f5e07962d34ce35d92eb845a9d644e85e31e6aafd09e5dc5dd3594ef1910361091dcad67d7ea619e080174936f08b89778819d139a33bed53736fcb60a8aa0abb6afc8ab1839aaae33f14d84030c0b9e0ab76af385af23a6c6f79ece1d1496b5bf44a964dc8887b9fbc818d9ae80944eb86a076fe01196d11833dc3d5fed82433b98cdf3c4a81fa7f04b57cd487ca7f1a9f207047b1cd17d0d9cad272b7dedd55461d4d5836995638fa852fe84d5d79515a00173a7ee16383817f003068978f3094b557b99bfb92a29071772f14193e5b8352dd983562be30624bd43ad1272327af61b903063d2a589faf515860010240c366506395853872802daf4cdc0bcbb1d02295a75a0fedb0a600e12b98181cb53d994a2ac925600a9c92fe76aaef6434d1dce54f10a27733320395c3476cd51ebe41452b4c8f4b3278a9cf2ac73f5a267c6d1629c51bd4cd3aa1b0cd8e13e0fafce5f7ee647f9d61986491e52485495ac568147f92cad969b449853c5aa1b851760213bf8df6812a372ef597d1db62c6fcf0ecc8e3f3d2a037f1717eb2cd3be3b6783ecb8a5939db645234d867918257b8419eab393600769bd1642bef20b40cc205eb86408d5af6caebd57964e29936e1c1d72924a39e5f1ebdfeddc253579268f73824780f47f2bc91431ad5b16b1432b9d38005eb486398cab991865070fcf1790a578c8a003e01522eba2cb50596c392091067a4c8b12633cc0b23a4525a13948cd872195e920396dcc34116043274b8c71fe6f68b9425cbdaccad07c8aa810f1e344ed368897fa44699b07b9556cfcb745c570cea2b2d75ff05fb12d2acb01f2878c8c51235b0dc54e9f2659dbafcb430ebba00e5e793cd1a62470f7907a3f5eee5b8e32b8f2721a005119c18b396719e3929c236261a8f1c94e69a14d082d2250a658383f36fb9136eb76b34e2af3a64ce27f3ee19021858893201774bd39300d360a8b8d97c335d8bd408209b917fc672853fd027c486a062dadd80442596202b8bbaca17a90e5757708af873218c33c9f3f615405b9d993a3e09009711e4ba2088a9a5c331e03d5d2769d03ba9d1152b5dabfe823df09a4d51d028c78f022c4f25fa4dca6920791646973b7c840d286b1ebcd487e4935e280c5466b6c79d266f693b93bb159e64b294079ffca09e9f78a77a4e10b88be9bacabdd8ec0c639f09e99fc8db1ff486be344dcc4b9f4b0c7715718cbb8d717cabd4feeacd73f5a587957d237174d03f5aa8be29ebe1558c72693aa4e7786ca2749622841dd5ca5c86115322ba4283f625975780a36753b2101a5ede0744772ea2cc16ee6f6550eef8265067676b4ca6af8a5eee4c99de4a12929710ad0337e724221d3a90335afef3590aaba68f7ce257f15f8ced431cef9ab4002455371208f63e8bc76c571c31d75ce86eea5a4dc02fe21bfdec86912b398e1e80ebd67a71733a7784a7d0ef478a03109c9e605e213deee2bdb844aa3a064ee3ae98ed76997e2bef5f647c6c497d53a181aca00b0de57e7dbb3c48dda118eb18d61d93d79150899c97cefad5a0b9c6c762097c5c74ba08ffffeb9d643c930f173bdee9020e4666b07b7c17c07b92e3598aa8d666875f509a1afdc490d1de3058a7ac2d8e18918f542ecf1f24e6b482ee8aec36b0233626df5be84ae723821a0c936eaaea917d649cb4c73d224e0c2b1bd6ef54f991a2a58d500c7b28a97ecb2aef85c1a762e67ccc4190334033ec96250c8e7d6527f374b0f36c2d1605b47db9ef78fabe346c4f45f9cb95293ddf6d0b8219a220c90f5c3c90e083dd3d796797bc24134bd7377753aaa858ff71bb7d934977dc9d40d0a66dc4e0d599e6c3ed4aae5c5423ebbb238171190027f7f8b005662f5022ee05269238966134b1e662d010fd35e377d610f4b50bd53e31039de79452b3dcc906f0adf5ec0e5024c8eba4990a9c4f70df5b97e1c1fc5a711982b7ce8419f9d7df78344ac378421934a6eb02591ae50fc03dfbe27273d37f8571beb114fa7429ff012b983b84d089b81c1706299f4b54e19d8e7c7e2ac78866d9f2865d0e5a5a26180655cd06133ef5b66e6f55cc3b8105cc2487d4a14bd60a1b97dcede500aee926f205d7fb8580307e5672f22b9def43df0fa7949192d153a6c1837c9a720f80ca9993df0b56192560b1879ba02fb7eae573d574ebee2f6d807196e22c857629ecbf06fde8faac81787244801720ddd3e4cafcf8900a7f234a1b9535dc5795e46c24225421df567fc364c54d133e6a1dcf1d5c1c6c10dc32aa42f028fefeaafd3f35826b1ad1a8c8cbabc0c5a79f7aef1259c946903333906c31c18e89edcfd1a9b90d8189c7772cbd81085f5209dda90d02846fca10f170f43e0310d51ef40a3718a4240c443ff08e18179890f8a29b2fae377c576c47f3fee1b826d4455fdfbd4d6d2b69897c5a413c01718dd70fb8a21ad65c823e356398a271c0cde83c71c93ab896b08885a42e972102c26c145303aa16d49f407c9f10c2f78496c0237222550baa169549e82489f157788724854ade50d43887e82871c37a58ae73d442eedb215348e5448575145b73fbf999508e0d066a2f0b26b494c8247fb301297b14cf380efc12da2306c54d0fbfeebb3cfd7cbc829743148e9fc174c0f394ddfd2502e2ab3cb8e95be12032c9cdd5027f8c745077f85ab2a54915095c84d1d43b0c0fc5a2a700b58657be56afe30987cfa51c76a7ca33f46c4c692d8b2d3085949337d81bde6695aca3c01ff93fba3c407197dd6483bbd2f37b3ae58ab55cb0a2a461cb50e2250fcb89008a2a03f99983ef0f8c3916f914f849377c3ca44a4b0a35b22955e68c4f40980328e1d855892a2b0b846647307a3ace04b6a57a94195a408fbd6489e8b8c1aa4c678a5edf37cd5f07783134ff1e1f5147bfc503ad01835168b354082944f8a3f048e9edf18ae38c9dc13285aa33c92120cdf6e6314793e3971b3ed33830c361096baeeb2d8ee6a73f40940177ed541bed564eacf2c487b302531582be11a5f914ebe81928030e34324c4918e854d3ea55fe45beda99fd1dc7e7d7387a57601b92a004a2689162bf379b37bce67c5a71314144c99b8acc6fc8a554e0e583431567ca8bc494cd15a8dffe380de0c5cf4777d5452ce6044272179d78f78a51985e4e52bebf9cc04b21c0e315a5c09a534596f84073bdd228cc545e6ce63b2e3eb0c329fc1f107692805e76dcd49a8a5ed45632d265110099c38894ca495ed3dc30a246947083df9675ce79c43298ded8bbd64b2ba23bbd4690033ad7af1376d93c14401e874acf7e7a750c440a6450728fe68a3314195dcdd8c7200f7d8d108905d92afcfa8ba0cf13f9def9e3d3d70084e17150ecdde35c1812210e79d7e7101f123e721af064eaf1ab9ac76ab065919923da93e141ff48b8b6bde8fb0bb2c99e061719e03d2d169fafc79597cbedb99e00ceebe97fb6888690d8b93d98a86c7e85b501a81cdd76a3d4d8d679cbfedeb89221da7946a6413a828a345964cc1deb740859d5a96d9adcb721038ef02defcfab4860b380e0c95bad3c8435977af2d5f0500517fee5a709290e7513c7141a3c73888cde928a5c489a857adf0bb3dfb40d9e6391cd55e873472236a619cd3aebf6334ef8268c704865f1e57b1365a74febdf65f4e6f2ca3c61ee0335dbcdd07e0a336db3c779d1f37246131f293f1fcc46c273adc364485f1409578a5aa36e3afd85e47e41c1c6583f1b721ccbe40e0bb11f94437e953230e15427220f70f8570a0b2268640438b8a8c18f0df70ce00380760db514b136a00497705ce2d5f96be03ae4c0c2a7563d46e6e8b0aea218126a06088bc96938fbe490df0cd516a2f6b647f26c68dc7678c4923d8a357138e761a0b473164e06a40e0245eb70aa9d0598246e4ddfe5580f29f1fad52f6d6ac88ea45a0eb073c9a4fff4d1df8003c83fd4ec016059cba78d34e7dad0845d793221697c793453457e4d8732ebc2ffeba169f9ae4a9cf324398bd353ed4caaa5b47f18132e094c23bfaf1e96939cdf3ce3d9597050a9287f5f172de023ecafb29f4b39d907171390c08b033728c0d2b5e49edeb99a4462dc8e444ff88e15d4dee90599b0f7fdb36d798443c2142c9c6d6ef807d6f208645082ea08939826bc8251181894b42ad7840f55fd7b2aab31968802db01c13825a6defb532cf82a60863cce9adb30829a4495e5e58ba6b5df8c7eddc9b24e2a7a50e52ff77b8c83942e014d2afd541c58e0217ea5b9aeb64aef8baee898960f155a6df778d4c00f5319d4daf571db2d0efa50a4cd53a03997d9856da12aa1e7454d5459f62f4c7bf31390803c4b92921926548acdb3555df2ec26aa14aefe0a08ef76e082334414c5e59339fc62fb623254de42f5f1d4db0241baa20ddb5edeeecf3206e5663e8a9af0e765b83053b5405daf7bf46d0f04a67cefe01d9e1c0cd73b0fc89091243bb8da8ae01b1e3abff5b62f7e0a3c60dd3e82e632ad2374136f193bae4225f980203c6c82acc70fcf08ce614b1db5172077f15b58f5986671eb0f8f0b3a9006048024d9b80a21c550fd847acc05ad84f111c66cab2aa495e452c7112a88eb76e17f72e2d9b2973a4f28e448707f572f214a9f3583d315a159d9c196750bfb02a2831b349f9a3ade6ca866f78c972447379db8f2c6b18ec3ef77777b630acf50e3030bf88f8407ed6e030285d0e03c3e8d1f6bba07bce6e9c456c768ecd50a7cf50035da1562b3c3af568b7bc343795842a434833a40fb6e4952334025603427bbac1107c8054c175ff336688cc4fb4676eaa43531220cf4dbb86a2535c5077bc20eab56adbe6a0534bcc08b6e90bd8fb9bcad98413851f1465093578348fb70485783c245c097b6a1bfc88f9a9d2d6985fc5d008caefb76195dcee8dc94baceeb3671863f6e8beced88444690be15e66c2b99d089592a8e0faf20a7a62242418a373db28b62ecd3fea33ce7f050a211dc2d3cd04a2402717890e93d5ec783f28516e733ae018014f736afc5349e6db9912eb3014198fc78003594abf86a5f388fcce43008e8bb03e90c857d8fbcf236ad37122901fe17f53a346e1480300995479a4c5517fd1a57c0e4dd7ca36742af3bcf5a55dfc2cc86260a3bfccd8897d40c1a457869509dc45b199db3be7618fdf9f0c0828799c1416c2ac5d048ad7064e0e40aff6e6ecd39b5af846d4ca894a4474c310d42600caae1e9d5a9f2aac2e176ce53c9a383d637a5292dcf356732a140d38bb4c22319b76b02f67dbfde47209072e2471693ac078cd2efaf9d7eee4848e8611be6068bfc9428595cda3bd1bc33c4676ae41ebd1095ae01d5532d822ac2160f21bcc34fe67958ac94367d7055f0923f30cc36de44ebd33946b9b178891f0ecc599517e945aee445c3f5da5f6a36bc230abc403a1d69c664622d9b7793e4137c20b5c220985cdbff8278653f3e4a4cf9821c898f577d7f487a4473a281ffbcace9a7c71cfb136abdf27cabd0c2c749e6b534254bf84ab618b51fa94ea6acc65d7b4a88433a095430ba586f1d0f125f5907439e40951f0236bb774389e6fa7963602418683f8f65941fd90d05d245e3d1b4454df1689781fcfc18d2daa390d1be355a84e5eea220ac2470ad0b285e011bb552464de7ac66b3a98afb282d6df38b19410e3b6e23fce6ec06c4b0d1e10cbebfb886a24531e85234f5257df39661c29e990b08c8b9c208c15f2108b6e7d1b6a55f780396f2f4214c7b4e443b9f488a3c22f7067608d3c770f3df79c5dd4f2378bc4b7349e521a67b66d012da74dea47a594b12e23446e76976f772a256587702492b6dea7d746bd766063b45132fc8535f71a4c959610df8b1e57721293437fcf5c775fb00c9322387ca03f94cc36d035d51567b05bcd2cade6bf43e4fac65984405fced67b352a0e000ace9b0a68ee99beb08739d3392343ed3ded088a95c55a81a33cc1f9d6e23fdada18f89895344f9751fbbcad68fcd2be9c8429cf0887313065134a46ef3c82e3036914c4709ffc46a1930d6fd9693c0faf80e29ba77591c9dce8a6a6ba4d00e328decda5958e7e188d44030d8ac2fe7df1d910f78524ebf1718705a484c33fb5afac619010c0e12b403fb46e9bdca3b632905f4a698a65e36b631068d000cae982d7eb6d5141da44b40d87e868b57ff5d71ef96360a417cc32f7e3ae323c03347a04d981b103cb725d5acc6a8ff62987f0a10646fcc6d488327362cf86ff054467631d82a167ce2644fb42063c5a1253f55256b9ecaaf57503695b8ca76ff4e60f3a40a0d1060c62645240dabbc86e799bd2f5873cdc82ded666a2a22d3dddb1d89eab33c6c3fbb951353b9121bb8a82354b90c52350992dbe15a7f9be577d52a80a2e47ce48024d53f651aa290efe0b73e1e24da5df19ef13cc1a3ce67c02bd4161b80d5819dc7fdf7a4880f0b4d6d6e913c6e2e5d72a24828d106899ad322d89162c3c603733eda5ce0da56f027dda17f286cf17a5314b448813ca293975a0a7c8ad7db8acddc8a711049591b6b6479a0dd25a4cf83495e78a525fdb35839f5f23f80a3061840d9c966cbc201b8f0207189fbaf7b94f7297422f5085ce3515446c072aa6ef5e80aa71b93e0d66aac926701cfce4e90257d27e9b8cdab7b9b8c80b85ee9863bd542dd6358feb75581c93b55034e0013e82deb8df58c9eaf0eaf89e2cb69715f577f8d57c0ebe0bb98866ef48352ba3cdf22a123c8394e15f522aaba8026cc41390f363d05564732c0c9aeb648f7e3ebf4ac7fc9b8a87bdb97e551bbc8dc5446a45aec157a433307e963fe339a322ede1e6a61a17c16d6fe2357c96b7cd0690b98bac9206d533339fde34395d82f1a33288e1ce435b257dc6798b10eeeccb675976b51e45c8cd0c2abbedb89db27da97baec0ce4a094782e380d59ffa894511e38605f8c61e9d714549726c4af22c965493d9eb9755df352d1f8d3fdcd5a89df71bc0369dcf5bfbad3f08aeeec8800801a75bdb52bc0c0a90ffed85548eeed05fa4b680c2f7a138a30ac53f5b8d6c65f3a722ba88d03dd3c13175dd9b2fc393990d58f168a48290a63ec19cdb1c59fc9686bdc584eb22da931fb3e8d71fda8db5afa196890af42853daf7daff8cf99a402bb1b9ae4a2d1d65c97be1894f6609c44c16b17837ae4e5ff050fa021047f52a202e7d809359fbdb7892aeb3cc993ad56185d000b61eaed28657a432086fafc0f7d174490a23affd34afb880081166d99ab0373a440d3b901fd0b523dab4cf12c6529ed2360c151f851eb9d8ca28cfbf0cdbdf788c1ade646f5dd6f15514d05028cd7452da01d192b2cb8eb9226acc40c4a8fa18c812880ef49c0aab3516c5dac50acbd23244469279a18cc6367e24d9a80eea177c2423cec2c1a0379851db10a6afbc54714618fc4af19af97e4ad6ead26231ba03a2cf40149074ea40842f4b59bbf164c4c527f77cfb549a4dbf5a8da7a90f73c67210453c05a5543bb26bdc0852ce1b44deaf22424007e3a10af7d726e8bf791130c3cac3057b3aec2141743a4ce1f42282ce1aaa07abde5610f4b24844a25e2d77368df9a6a79240ca323f64f5a417b62a55115149827d0df0edb7b75961b012bca88b22e9fe1056e3a7c3ac7b72aa9a8c2726a03492fcee149fadec2937c565d3f2ec8184acf73bb9d6abb99980f2b9f50485a2fc04e093374a664f0de9de5434752f763017562d84921a22a98a0c9dc897945835c1c28c77dbb97cfac5eed4cce726350583df20620f613e6a427267aa7844df23ff826c9bef91dfc4ec01e244209b9e717d74e71bf54ab8c4094e1ffbfd91953d9cb21a9cc83ff407448e5c9a2052d8d0c9769b6624d7f4f96d48de33af14aa340e25af90a1eb137cbf7eb8e0378426bae0c178bc46ac7b8257b59cb8460b5fd45afb7cfb8ad62b83024628fc0ffeb73aefb3ed003b8cd32d1a7610c3f1df00a03774707eff199f3673c876db25e17970acac47adacb176793ebd66fd158d5f72bd2249bb3db03a7f1e49ddb42e16da59e8da9a4bdb5812734d32885019eb29c66ea29bede53cc0b2a9ea29af755f5cc1b72931a28e5d62db30c6b091bb6f1c6a0ac780e1c82db0f94c2d0ddde8fccb479d351ba016e96f2147d5ac41a1cc11a9d0c18cb6f98b809e4abba933b7326484359561e5c3c34d1ab3c8a0ba1ba54eac6243facf41bd91ae7ecce6556c9513a3c7945c7733eecb251a24c5e00392426e07c4bb04fa4df5fc1e1c02dd8c8f3d3345e1787a2213c6a209665a04069b17f4e9a423da47df98f73981c1b58b9d7583f4fff03cb8f408827ef189b5e0457ebbbf8a52e9f27bc35b3b1ab70167355049555a07d1a3a8b04143e4b2061d9d8cec5b5e3604ed9812a94d4ac30423bbf738f3a48bc76697f101c0e0757da8490e04ff25f1e9fa0685553c6d5c115e58085624a498b7fbef6413dac54f946e56ba495103a4c8162eb203d2f59a932386fb5d8712a4cd84906f13b559688abd88ef905a55d4c797c49613b3627ae2f194ac1da4183219588df69f2314271cf1af3dd7860588045cff5b1ad391d8ab3b11036201677824af3f5d36532f7e6787535131781c295a12a3c2d265d8ce0a0cf1679bf295a2b174edfa4d2699ce41c08b6772cf194bf58f1427f8749f0a517a652addd139ff5457584f977e10bcd08bb4eaf9147d57b45ca8a940c28a4c11711bb5aa7c929a96db98c859dabafd275f25413d1f7ef5f00489a19984ad348797c8d5d724c44ba2c0797681b8a44a9d3ff000ee3c71891b687f94c98744fcc0afa3b6c6dc190821f99083ce4ea6db3419da2c5f73de8756a13186c283742dc0ccb7065f796f67c50c1ca0b3bb2c5510dbd8a870b8f8eb66a87d615db881f3eef0fffee7cd03a4c7f0c1918671c47190d1a86e77baca57508fb33c82685f28e9a5c97ef166a35f4de7068366e2fce9946bcf1dbf902a83bb3fc11ea5af8aa8f244ba72857b00e054c428fb473bdad19be95d4806abb7aaaa587db88b7763954779d87436bc9592ca90d2d81ff8d3c01a2a9be76091e686a307cacb07b98f87fc04ad1aba3fe8f9a2ef3cf58736bdcd2174dd6e850f76bfd8d842455f593cbde397943fb21e9460ef9614c47cb6c054c192ce05a5c26d63a10c645859274fb3b5854da36b25488185deaa81f1c8ea84cc7ec0434a83d18ad6e9e3e459c020c0b2db7180c552fa5fa382af31322490b81448026eaf45bbc0fffc34f2ebf6a36aafdca9f18013136a3297e0b101ffd02c6d3195dbf7bde7a48251d1c265906d1e5fecdddcb758d92d868fd7ca156d9d42cfee36cc06204f7cb4ef2509615dfb48c80d514b95f43ee85aa973a8ca8fc7b5fde4d842c5c3ec87be6f543ecf58147f455e9d3076168407914d6f03b75c7439f90aec40839e78e71e78196afc8d4db6faea1a7bc7e53233a298836beed51f0d9a82ad1f31f2165cf4a6966aee6e72a01279ddaea1a3c4ad4fd8a20cd720676d09eb2e31e4f2ce7c2f3c535b071f50af7d5e4c73cd8b3a9691119697f3daf472e95dffa72ff8ba189c4f6116917265749f766002fd848b95ea7cbcc6363ea0187fd4cf43c718daf7dd56f7eaf8e6e15ecf9bf9541f4a752f3033bfc6a891d29ab4dec9b9b31f6cfb84bfa067b9dd836f655203472b69a03384a7beed8467e3827ba0a7e9e7a5a481208be10aa58b580cbcdea0bb5399ec026843a772b4bba40bf2fba3b2bbf85035f1b2cc69ddb28e0d9a67ad647f37821c2d4c393fd0aa80c3289042b2b2c1bed1da9cc03f544894c27a1002d5f18ddbda7219d0f1b46b66c6dad86a310df22781ddb2f59b2d1a5c939e6771d91819711b5bf72dab723623b166ceda85643c6d04f031feaccd24ec0ddb51c3602bbb57f858d99695600b5fa95cd1aae9b858516e6d800b07cda2667f7c7b0a9b5a6b2b8c6286a1123f4d139c4169480cd3ffabf776534cd2476bb714d5d208dbd8808158269fc0d1193cbaf881f8e924f25774962d4488d625b639221127df09f2c7e74af4c244553ba7a0404c8cf7055f335297867aacc593430a330256e0311c51ab42c92319297f01675e81fff5905e0d9317d447d04fa6771644f92f6ed2bc039a403d3c83d3df001ec013efd66516a7fa0b035a7351c0600aee971138ebbd6a834cb7544df18c0966e477f7e2a0a84c1c3a49bd331ca266b0ceea50edbfcb67b1a84d4375e77d4f576338089a38b8216888420718d113ef006d29dc6b7bf9634c17ede82772bea5badd1acefb01494e014b47fab57c948ccb3b923109b20669a8e521a98bffa9c22cf12ca6e3e028dd89b3a0654a2adb76966e8d12d877f9e37e16019256bef0fec639e5a59e4af1d18e848aa87883e91be782825fb6e75bdbdb2380c4f317ce1f1a934d993470e0cf06e149546e2a3477637d03e15cfd5a9f729f3ff72279ee33919767db6ce5e3f02b14124f875223961ebbff1a863adda361bf18d7df16695535c2499f759b73f8503aa8397481ba453e9d00a939f2a73f04646bab226baedc4bae5be627f71ad74a795fd0ddbfdb7b60b160129bbac8b8b995670e434702a7f3383e1e1a23a92ec6ffdd926f8a8f3ed75432208bd1fc7c299c9b2374cd4a7e6903c8276805ac7442f9dcfe99857c41e45e1920e0400ea4653f9f2ce168a7deee03726b3f5ec523282695e9312e28a7b144e6c2df9ccd09416a0e604b5d2babb1d606f1a706e06d1d6d999d18859f834ea5c2c5631e41c7af4ac0d5348f6a721ecd944fa6ca8ea6dafaeaca0dccf9291b79bed381aad0790af82770ee1879fe6b81776e8aab250378df937c41d109f88810d0830e5c4810f81f2d1910721744da30c7ad7a4a4ba3219b37f2d620decb3357df355f6d89b72fccce19bc22a223e5af55e5f709ae51b80f2492c912547c759e8d282267004e363a3dc078ea12a7e11f8843ca6c05e0378142340f273b91564026071a74c872c3fd13084e78fb83d4dc1a481a65f3a643d3e3bf43e02e71d5ff2da57b63f06c4f5dbea0cd88a94c9be11972bc49b6bd1bf194c0f056aa534ad43f8b34d27a9bcf3922ecc72c1169482f410c4ab6fd7e0038ec670925613e119bcc28359a17516860c0b6d89d1e52a16a1a28c7da3236e8342188a897672eff1dc7f4990051c6945e334d0099c95bebb1c5d5f6dc24982b1b8a2f8902e14cd73704a95b61d3402053513fb5e61fa3c41d0b6eae59a5afe8e64f1e5e40b9b3a7597b6f87f5e8916b3f78d8e6d17c3440348be1a4dd9361c4ee8cb4e4d3f75493f9b83484555691a0afe1aea983b3b0679fe2c9f6e800e33491245a2c9915933b48fe0ed182b803bf60f96490d247da1936e258738a22474341de6cad8727cb33db935972c8988a606310ffc38e8589f809bd754b520a0cf3b0499648b4fd3e2038adae2ca98e21e7c712166a2144cc307758a55ddd7fc487decc3ca759a1f7b2b608df9e0e8dbe2164b75b274d7d99b907a50da0e261a8a205dfc3c79b13052d8fd641f10a729f5db9cf92aa2c3702f36a027b8057f6ee807e6e526ffb31fdca231a7c2de641db9143799b5aedac350b53a68b353fc88e7e6fe2b1d54e56334dffab46528c4b574a407d401cdc3735882de5c2667c483ea8bdbeb56aa52ea07382b8598897f3a5914402bf2081afad38eb6c443f8000529636c5c09c0a86ecb0ec380a912cce4d7ea69afa8bfb61ae4101f65b0598f3227680692cf00384face45d973b2a70cc1b335c802d9f6ce94da0097fe8522d5ab4478a70ac9888d036dd725041930d71bb19b6dc89fc8550e7eebe5bebf6e0ebb6a1eb68fc01a83b226314292ff8e2ce99ef71ba414e15b2ae816b80623e6422b871ecd85592507d239496622d90796cc8fa6715cfef23f98ba2b35e59df8330a394d72ad3770d331fa73d11e336683b9e1e8c60dc443b68bae01d64086e196a64868d8d21662229a2bfbcdeb7eb5ca5b99b27ba50f926e26f8856ca5fb30e97d0ec7504143aca8b2db661fcaa1ff62015e03a8e5a7c73ebb2bbcb2efb9e49eb4fd6cdb08f302e05f74bfcfd0ea8ad6a44dc41f42b545eabb1f3413e7c91ba6fe5420f4b0a7fb8b16337ba4582caeeea9bc3217bfb7ccf0a83fff59ed624e94acecd754bac05de85f1ae36b1fdb853806f9258452351db159b7b72d6da96c4ce06ce1df97841b301d2c85c67b526656f95b6c424cf7ad63895de67cc17a6e70919136832dce37327f52700b5dca65290ce390f2dd2353ef736880e77ee41ccc5cb0","isRememberEnabled":true,"rememberDurationInDays":0,"staticryptSaltUniqueVariableName":"302f04ab65624dcfc8b384e844909600"};

            const templateConfig = {
                rememberExpirationKey: "staticrypt_expiration",
                rememberPassphraseKey: "staticrypt_passphrase",
                replaceHtmlCallback: null,
                clearLocalStorageCallback: null,
            };

            const staticrypt = staticryptInitiator.init(staticryptConfig, templateConfig);

            window.onload = async function () {
                const { isSuccessful } = await staticrypt.handleDecryptOnLoad();

                if (!isSuccessful) {
                    document.getElementById("staticrypt_loading").classList.add("hidden");
                    document.getElementById("staticrypt_content").classList.remove("hidden");
                    document.getElementById("staticrypt-password").focus();

                    if (isRememberEnabled) {
                        document.getElementById("staticrypt-remember-label").classList.remove("hidden");
                    }
                }
            };

            const toggleIcon = document.querySelector(".staticrypt-toggle-password-visibility");
            const imgSrcEyeClosed =
                "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1NzYgNTEyIj48cGF0aCBkPSJNMjg4IDMyYy04MC44IDAtMTQ1LjUgMzYuOC0xOTIuNiA4MC42LTQ2LjggNDMuNS03OC4xIDk1LjQtOTMgMTMxLjEtMy4zIDcuOS0zLjMgMTYuNyAwIDI0LjYgMTQuOSAzNS43IDQ2LjIgODcuNyA5MyAxMzEuMSA0Ny4xIDQzLjcgMTExLjggODAuNiAxOTIuNiA4MC42czE0NS41LTM2LjggMTkyLjYtODAuNmM0Ni44LTQzLjUgNzguMS05NS40IDkzLTEzMS4xIDMuMy03LjkgMy4zLTE2LjcgMC0yNC42LTE0LjktMzUuNy00Ni4yLTg3LjctOTMtMTMxLjEtNDcuMS00My43LTExMS44LTgwLjYtMTkyLjYtODAuNnpNMTQ0IDI1NmExNDQgMTQ0IDAgMSAxIDI4OCAwIDE0NCAxNDQgMCAxIDEgLTI4OCAwem0xNDQtNjRjMCAzNS4zLTI4LjcgNjQtNjQgNjQtMTEuNSAwLTIyLjMtMy0zMS43LTguNC0xIDEwLjktLjEgMjIuMSAyLjkgMzMuMiAxMy43IDUxLjIgNjYuNCA4MS42IDExNy42IDY3LjlzODEuNi02Ni40IDY3LjktMTE3LjZjLTEyLjItNDUuNy01NS41LTc0LjgtMTAxLjEtNzAuOCA1LjMgOS4zIDguNCAyMC4xIDguNCAzMS43eiIvPjwvc3ZnPg==";
            const imgSrcEyeOpened =
                "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1NzYgNTEyIj48cGF0aCBkPSJNNDEtMjQuOWMtOS40LTkuNC0yNC42LTkuNC0zMy45IDBTLTIuMy0uMyA3IDkuMWw1MjggNTI4YzkuNCA5LjQgMjQuNiA5LjQgMzMuOSAwczkuNC0yNC42IDAtMzMuOWwtOTYuNC05Ni40YzIuNy0yLjQgNS40LTQuOCA4LTcuMiA0Ni44LTQzLjUgNzguMS05NS40IDkzLTEzMS4xIDMuMy03LjkgMy4zLTE2LjcgMC0yNC42LTE0LjktMzUuNy00Ni4yLTg3LjctOTMtMTMxLjEtNDcuMS00My43LTExMS44LTgwLjYtMTkyLjYtODAuNi01Ni44IDAtMTA1LjYgMTguMi0xNDYgNDQuMkw0MS0yNC45ek0yMDQuNSAxMzguN2MyMy41LTE2LjggNTIuNC0yNi43IDgzLjUtMjYuNyA3OS41IDAgMTQ0IDY0LjUgMTQ0IDE0NCAwIDMxLjEtOS45IDU5LjktMjYuNyA4My41bC0zNC43LTM0LjdjMTIuNy0yMS40IDE3LTQ3LjcgMTAuMS03My43LTEzLjctNTEuMi02Ni40LTgxLjYtMTE3LjYtNjcuOS04LjYgMi4zLTE2LjcgNS43LTI0IDEwbC0zNC43LTM0Ljd6TTMyNS4zIDM5NS4xYy0xMS45IDMuMi0yNC40IDQuOS0zNy4zIDQuOS03OS41IDAtMTQ0LTY0LjUtMTQ0LTE0NCAwLTEyLjkgMS43LTI1LjQgNC45LTM3LjNMNjkuNCAxMzkuMmMtMzIuNiAzNi44LTU1IDc1LjgtNjYuOSAxMDQuNS0zLjMgNy45LTMuMyAxNi43IDAgMjQuNiAxNC45IDM1LjcgNDYuMiA4Ny43IDkzIDEzMS4xIDQ3LjEgNDMuNyAxMTEuOCA4MC42IDE5Mi42IDgwLjYgMzcuMyAwIDcxLjItNy45IDEwMS41LTIwLjZsLTY0LjItNjQuMnoiLz48L3N2Zz4=";

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

            document.getElementById("staticrypt-form").addEventListener("submit", async function (e) {
                e.preventDefault();
                const password = document.getElementById("staticrypt-password").value,
                    isRememberChecked = document.getElementById("staticrypt-remember").checked;

                const { isSuccessful } = await staticrypt.handleDecryptionOfPage(password, isRememberChecked);

                if (!isSuccessful) {
                    alert(templateError);
                }
            });
        