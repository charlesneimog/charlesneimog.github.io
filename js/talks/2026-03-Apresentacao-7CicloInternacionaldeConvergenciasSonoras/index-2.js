
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
                staticryptConfig = {"staticryptEncryptedMsgUniqueVariableName":"3d34d9de16e40c958263121f133afd2e05586b5c43419942efe4919e86c6b51476b99bdec57e8063fc5084fc7ca767c25c8d0482777fda749a43ebdd4f51b68f6dfa93977ab563e04adf974cc2d9664d46337772c048023d1e332f7898d2127fdef44f93d6aeeb346d4583a78c04cd0cb89deb51da06e76b71d648367f0e4f8e2579b503bad3eeda22cd0e1feb8ff26c0de5f9d9b2b1ffa49e3103d591d4a52b13f19b07ffb1e2cc4e1d9bcd9ee2abb9e6678c45275a6c4dfd5b880c164f824741cb2bd3f008ba1fb94080c90f463fd8e37ea84735fe48d0b83293d15a75c31f04ad6c104504acfc9d77603189a68071214975f4e311d742f1ba307926e5070d1df84ec27eff683a4c238ce9e0ef20e6758cad1eb7301bd811a152449b30c13d227dc7c14d55c553c06dc7f034a9793c643c97a928ba4d585132d6342917d20f656c8e678f42e7f03e81c61fe2bcc26c214c5ca500ef2273a5f89200ffad8b6292f5292b2f2b2a9be9d713f4ed6d6f870eac85979da11366868e94ed1e5422d4b5712e8ba2c52ddd65292a39400b72fefe6f5b02e104f8a0fd91b19bb8a5e8571f84d16f24c6af5ec5fca2dabfad2b2b7daf986e3579c4b93c235e2c536a4b496266afe8fbe821307ea9ab8d146e6188d16925d47823e9f131729381d9975afce1d210cf5413e298ac8db68721ead8f2872ec011164e34ef1009bcb340096adbc48dae2ebfc61d34eaf5a1574b6c6b31ab0d93e97c800a0cfca707ab86882a29d534d2eb4a70b01e453d4eca50b8321610d04bac34da0664dc1cef6790c38d638c0732905b8e58ea9f6822483a4b14eabea51e8020c46063aa886e2b29f11407503473bf7f579cc49bf5f6eb9d5487a74c872ab9c258ab8757b0d447e27e5f8fe9d5850c2d78ce02ff67572d18318fe59e43d4ab3755a3ded2e4f0364f5135fa27a877f12b4ecd81b888a6648e9f72a2e31f8160144122fed44f7bce78649c4f53a94d2c21af3cf7dec2eb4ef82007fb9a69863ce2b2398ad9521cd76373ad3b94258341d12e6a92e9cba032bd9c959b22556c26decabe0a7329d87bdc83f771dad24fddaf7aaba0d53541f2ed60481b44c1a56affaa53f54d9e9cef0eb9f2ca4e90510cd256b731e83d64b21af68b0d4c81a3b6602c49bb0695e7524073d9b528794527308734eb6dbd849a0a6b39efabe48e945c4b755200459f34a4b9bc19394701bcef18bd5328b5537f5378c97d176294dcf727be1ce2633229eee78f98529ab4054e04bdcbdd76053c77822c772adc01d98882a10e0eb6bec9411f63f88e225a512300fc41e82b8448e0568d15d85c212c5249592182920736e083065a794da03dc0caa93e7f1b0f16bb33139f63ad326373954d2ea37ccb169ff732841d832242935706d878ff38696c5a035c2cefc89bef18f56ece2c7156c5f8d16cf2c3d3c286776b954b20a83fa64b20544c6fe08cb7dae9e3b28cf50d12865c7c92493b56493c563ef7fa77e40f712eaccb7dcf11c2d711a8d5be7a14ab313eeb37889fdc051dde691acf1c0cf386ac3840c71bd9709c47f04aab80a8077f5cad12cc6d93fa7816b058a746aef473577fb6d26844fdae45388761a44aa82c41358d1c30a85f0e7ee18254d6191f36a05e1d62121d180d05b669e4c4fc41c842dd825e9f9117b1317efdc83d6ddecccba6a990cc8d952f697dfbeb58fb4688ac0a995c1bba629012ed61d233f1f22e4807ef8687f177c39b71a5397c44cba40a62d5b5e35e442c0ff989f4f030757dc62051a9ade9c12afe3f364d56973c9ffe2612477ad192e64c4f1786298b7cc82affcda09256db9287cbad73e203017606eff0fd5040190e15ee8268df6e54f07cfbbeed55ab5b0266d62ead4c4b5ce7e09af5e8e345b95ae13995074c120a39a12ee09e93cc47a55e4f932e657a66ff34613eaaf4982ffc83c92cd18a957b2dc9ae70383d6e18e75a716635d367d42c62b845632006813e7d395218103dc6c738a3052684d9406f667cfec09702cb0b1c55fd3748b9af027e7ebfb1b22a9a7338673b629742eefb41498bd3ffdd3aaa823356a8f1f251dbefa89851a5d22ca0b810052e33f2c3df77efea2d5671ee632f69a368dada996cc39e31f5e9b50ad8c1f5a39d4ec9a53c2b1e8d8a1c9e0abf4e6e95d0411ed00c3fe67da7fe850a739770745a5a3805349428b56d4e508471dffd83d93d8e2fd58bc00e9a5356f30d156a8c881e5b71626c374ac315ebf3d63245838590b9ef373d8f629726341e7a3814b63d74128f1cd81c4029f947b30e2a23efdd8b3604ab0746aaeacc018cc4be2ff9c3f9bc535b1e758126abe9fc55a4a91646c449183b71abc74ed2af44435b4868b9ff378d9c7ef546332f97bb8c6bf8c1d1774bcc69e21a061e3b6b408640657f965eb7f71da04e2c93ed6aa6dcb110ef68dcb876ad3cadc313fc298c0ff740017c53a72d71ea1c8b8293e84542146d670b2ac76f4fd04cc6dc651c25cf641cc4619ba25c0b9173f81d95453a4a2f73b2803ab464fda5cf0bdb61decf5337146de904a75dd052186140fa19d71bfe6b83eb556406088ae7181ab78a3aae547b28a83e2957eea6628adad48f2f27285bd31b560bc89937e7c3fd970f54e6966f712ac0e809aee59f73625832ba73c27c7bcc9269167942f68dc363ab0b2fef54d9a30e6fc1b5c5098fadd1c44d12d104497e2cd114e8ba3279ada9dc37d337bc53d42e64f02d9a94e1900e86bf75630e1641559d1827fba95562716a4a4b3c88d63578aaf4ef2ae62d1f9aded7648ac312fee61755876c3ce021980d03da5a669f5703d61d527309cf873ccb9802184a2ee845a6945c0401b8595bb1972ed89efaa7e041e04c6723a52a5288532d08b816bfe70dde64e4c96979408dc8618e80830d3f1e247d845b71c6fb3ea444a9ea926e2b5e2b487fd2e6467599a26692dc9d25c76b2aee327416bedf9871add81463172617a926dba4d38f1eefa91073263ffdf64531604c46744fe9216d306073ac14b51c8eb5db4963a3dd70475770989eab184f8f236ec7e06dc6ee7c4ddede31a867b8c75bbd576ade226e5973d220887d0b6db9805b0327198c3cc40892803d13213db8ab8b04b9cf736c3d156b04498f3e489f8cd01bab0631dbf438f1616c14a01642e93c1dac30868e3d85bb64342f20159341f2495b3259257a871d92b98e45ec7ec88ee8265d1a85ba9378a12eb8323b78c0edfe631bcc534ecd439d700cb7e62a48766ff67fa97b7ae8b61b91dd384b17609ac170836718e346a281c60bba81b2e64b437d8a08cb1cd97aa879e9d89c97e7f027bf20b56acfc216b787dc762869c9f56479800b5d739a3b7841bbf3a38a2b199b2eea9add10fa01edb6cf5b458ca0c0efdc9886c04872b99de934f78ee4b9bece87fa45c7a9c3ff1261224e02a8229b47815367102a5065c835b2685449f275d3f40a71b99e4d6067acdd9290176d2606469578f9c95fc163695235f61ebad4e6d7295c6ca46ae1234789cac28965a8f5f76ec6d1125879579f69b2e332be19b1d47bdc259c23ead25a1d03651e0979575fee5108acaeb54c0a44ca4dee14883ea768f678173e95f9a19ed69adf69e744d35ffe636fdf8bfd12f2344db305363d75eec57ce3094ec713973b96f53545fe83abb4e0f3d33561cd95d80ec5dbfae481093f75ce63ed308938e16c55028e7c615b06f478e7b7c5dde53e69007ca9716e735e951a120068da623051f920ecf63c975519c16d9f49b399630628f926c2ced55f316ad7cdc7505714402e36ccb690859314db2ee7157c2b56ac2a9b72305aa834b916d4001dfaf215576c6e60aa04442f8d54a3c395da10b671abc165946be97b9da4b1a45f2b0149b6e9adbf17a88d57ff35e3c88b5949a92cd7bc178bd91c1874107d0f07675687dc0e02d05d289063c97c2e850405bbbcbbd83c317e423e3793f866eb1188c53b36a9e2de7ca1c29d0f3638f6d65001e4f57e33d240e1d0ededb8e7aad74b7471d3dc8c64d415b18598725e2ef9d069201247fbf6a56cf5c4de690b961e43bb38be198473723d886e74474cf19561754a6ef3b1cb458288e2e88f030e10df4bb16ffdac8b320b135b9854e75730a0386d490116819ef03e3d368d1a33e2bacb97342c2e4069281fe12285521c3aab7ee2df0bc5266d6ab625f4086252d1a2c4d5660dd3f64c7f278e08f5b5f15cb60090792ff6470fda75675d0970edc2a735adcc6d509e578a32d9d7802efc644410097402d9026642883f0d6b630dbb34c4ab3d21063312a25c186351f5d9352bd61aafbcfc6122c7a071607e0880b2bdfe868642543ebf0e4f4b42333d6d5586bf1133af0f828325d7fa142497701db7ebda003244c570c0fe8e54b2904faa46edd3eabdd9c7e64c9da2be9c36a22a7a0582772a6de542009ccc574cfb7ed853e174caa45861e08fd40d60ef8ffd0f97e8fa3ce16a1279fbca7db77ee5fccf5d1ed57aa14d68b2127d98cf036ba11b832cba75736d50a9ed7838edbdb969127f5ca3994189141fc840822de84fbd3c75c0aa73b59201a312b1df661d634024d0ed5fdccd8932a90fee954ebdba3dd1d24f2c3d65c8e0b14af8d5446f8068cb5a104fc91fb54b4dc3c9b665c5cfb4ae5e92c41f13220ba06c4c4be43c052291cfb2c00c632b0bd9f7442684a87fce7da073e3872d16d7cb53639e167a0d8afe12ac3a72884db4dc2f682739ca30075b4df9d808cdab0f235de6b2e13bc05d63fd9e2fb3fdd20cb10eb4053f9ec16982d2ff1b9ebae5a3d48a75ad56af4f3990bae8a4a65139219b6b214a7f3f15bbdce4eded5258729f0e7a9e76acb4337e566db63363569d0d02fc5fc2d6890b35f88cbc8db8eb25566bcc064550551b50bf14123f01be8cf46de1986144f9517f15605250f64b0bd0ae499cf9c3704abac0461eeb88b42e7d345e230db43fe4475976b3140f1635682379e26b58f71d3c9ef697691f11b7d4f58e0af01007d705df3b6f46440c86eefec52c40ee1b6603519f4bd15732e689cfe14f497fd46ba65ced87094f650489f5d4422f531a1e9843606aec6f594b5922e30f589a0777bde634b6115fe0da04651369898bc875154fe3450c5065e01f7e496ff1ce0fa8b4e931b3ddf95cba1c84d4edc41ee44deab977f86ba525ac6846fdae75b50d34fbc063800a9b0e863edb1c6525cbaba66d89a954a8bf355fed86c5272be300f30f7ebb4fcdbc5534693b1551bf30dad043578bd7229eb48471b9eaad60a6d4ee2be83430c65170d867766e98072832919a8912650a68f7b962dfe47dad0072c630a906703d63b6818793dee07f4d90f3c528063043911e670c6780779172c179351fa7bd4f3be23f8361a8fca05a7a20ffbf35431f4aed1ad7be4c361024485647baacd6ab911ca914966f8e2769eaad07a4acdb2fc3b6da502874c4fad6afccf2b110fbda4af36ffe23767a40ddb89c62abd669ce8db556eef3f0604e6edf1e6cbc6d451ed572a1b6abfc65ab76a61f1ce9d0fbe77ea5bc5f956f317ad5a30535b8eb1839ef2b53f68cc50e72ff7dd47576222ba43484a8d9431755beabe8bc75217435cf76b75ce3b6b9381127b24d65ff1f011e9bd98521677c7c15ac30b544595e2286c73a0d92f9bc4a7905ca702d588e1821561aa3fdaacf5a0c14af1fa680dd41e2d47de3b547cb0409bfcbf0bff300dcdae90411ea06c0176425c87758e944aaa8361bbc215536e7acd97734b52405c8a5111085d0149c3c5f953911d2c7a2e0df6f4e8b1521e8ae40d97a9f807f79b8c743b508afbc0f9b5647845b907ba8903c5e72425a4ecb5de0b30fb493b7858d9953480ad51b59703c545645a58e788992a289664e8732f3bc448576583bbf2e0284d76d4740e66d03fb90b9c47ee1fdacb60fd9370b0917d41b624aa0fd2d8e9f09b8a042c509a20019f8d78aacb464ad4a2e19f7bab4f9b68a446fb3bb48ad08a7d9f6412ed00cc2b6aa1889f5f886fc36aada161dd578f01606694a70bb671b8842deb4f74288b46e9b7ceded9a6d74e9ef167a96e53b96ffb3f584269d03ea70d129bdc6ab2dce562e1351e6c9600ae03c38e978053f3dc7c42b9d8b54e2c24c4530fb9990af58d12c193c2678a551708430ead36afbd2d34c49c28332f23af73f62ae20ac387a3a2782b5435f90d106496ad30485dc5f827797dd913e30607dd63647df6603739cf05d559f4e7f8006c48888a7d326f589d0b5bcf9d3d977ba2dc60da64903c8b26a1b081b966b0a01def384bc57b0b8cd5ce7e05ca7414667e69e7f18cbeb48581bc35be6b15788dce4484be9e2fa01632c6accce2e6ae270732bcfa420cf2d4e559d2314b8d69f614ded341df07fc8c6f6c8da9df6ff8d2e93d4c12800f5542f74337a4f5eeed53ed15eadfafb0cb9bf6d5e0a504a6559a7ca66ab7c44a7f2b3007049872bdabde442f1fa2eccfcdc3e5314f038967ba65525c2dfdbd9e6e5135c0e4ba7066d3716ce87e13e9b8091799677443d68a77f684506b4cdd114c8f851ba35d62812ee085eb260e3109baf3c8bf68a65731299be3b5d58ad61a7b6367be1a4c64cb40c0f44cc109f24e1c2784d7d17ef3f6cddcdf5cb6c823602bfffa533c5c13667690ac5b0efa54345506e088a639799a5520ba5c17d388158e2cafad5aad430359cd6354f987a123d3a1c892526b31cc5a76424301b815967bb564dd43684d054a4e63455385de90696b56b7067a9dd3aaf057e52ac85ef4c69aaa44a1e83c538cad23ca8b6149bd5529071db9a9aa4e3a8a53c48991cc7270d74ed01b7c32a003133e150f2f2b4a5b998ee5a73ad4dab2f15ce9892dd3c62ed64c2c861a8158195a76d25bcaaf486a84ca495da70f29972f5223478fff8a69dc6f24bb7b9c03202800dd280037c20202a1d2c0ea7a3c01e31f75042ebfca2b971ae270435624985f47bde146bd37c7196388c900c1dc7910244f883d4276814591b4841590623bb845a1aafc7968a659350ea0ae6f020384e232c7430c4c5c8b4c9bd0679a5833a35c3c2cf6ecd441a0182c1c2630d3793a9e20c79f066ff774340c46ade020c67c86b8a8f2d24375843be870ab9843f08740001382f425c2a2b57de8e685ca081ebe3f2070ad4f042811158ad55a08235a8df8c1063c1b6c3e6e91bbbad0a61e65f06dc2df30c4af3abf90615fc65a5296cd3bc5664d889ca759f849fe65700ffbd469f99352f044aac1eb7e608f3e2c5b5321debb1a3fd61443b2e1e98e6baccac888116860ceb45c8c396f74b8d3c391099f76a52cf4dd62bf8b2233e9f553855841310afb3aeb32cf8e840448c52c6c75b6549ffaef200d1dff59b340cc844e4583fe7f184024ebcffb126d4b2fa69517bb209c145629615c38d017f09ac6d72aacd65c2756b9af525b1da3ed1dc6092fb3e7dcf3ca1ab40ed2bdd52cffaf55449d9b9c3a72d08d2f3f73e0bef9dc010e19eb5b31f21074cf237c65ef3d445e45b41b037db34bd580cb25c6929ddeea7f10f4901d0f6ff5b9ee1fd8bba2b9275e9dcec68b4ed6b858dc27e41eb5ef235522c586625e45a4708d7ecacdae24d916737a12d5b517b43ef2079562d8fdded3b56164dfe302e05821f12cf5589f7ddcd72a5b8e45d7f56e94a0fcece1acddd10393e2b72df4eeeef3e04c0146ab64537c3b016e943be2b7afd893d3ad54ab4e1f69ca8d117279ccab9ee62106bad1238df876534915242f56c6e1f4b9a8dce3d47f5da01ab3257fe3bcc43849a215cfc0941424d6420d2efba96355b22395537529e867c7e674276e4d7baf3ee52461d2abb5a7ec75ec341cff3b1cc34bd8d33d5baf0d882aa61f6bd842c33fe340bcee890e5e6e97c4cf154647c67a28d00e11b8e29872b3094c687eff341aaf2d22381c973bd9e9d86c8cc84ee449bf1da81d2a5c793d76b408c7ee5118113688a5c2d4d8812c5f441067a5b21241d193948b40bc6d42727d1dc751576aa66b41f357f5e58e964b2d50205196b53e8336a637ecdfd6c3c400cc1ef58f465c3c21e4c676e969acc8b275c246e78374a3218ec6d62f44ac8144fba763bdca1f7ea3e3542d67fd29b64e955fbe238200bab99450360ee30753ba61777d1276a7a3e67f3da8a426d6495bbcbd4e6d9c0adbb3e166ab015667ec5b550d508f7d9df9d325cb18af656cbc9b445131e54afb605abb76e29bdacbf0cc7ab1b5675263bf14af7b1574f95f0ef46df2aae69b0053be257b845b77663d3487b3b38d7ce00f744282b290cde2629988389071f1560cfb91a5f0bf7169ef2796716447a79c083e3544f95eb5581fc3732aca8e92649f6bbdfe3566b6538439ba9f81e61e963128f972dba9ba307ea8472031199093b76b48e7b6500bb3a4800f0c59b9ed463a2c4742e5902f4e7cab3938a0f11db5bab4c5b94d92f4607413f3771ab31711e91448b5f176db5061bb6ea36ab4544c283c9e69c485fc584aa7322e3e486cfb8b319680a0480871f126dfe0f8ed8b0af0e5efdb3765e1068856633091c23c61d9acb20a4ff64b05e0b684fa08100d1e64695f7e2acbf1e9d8a9036a76264c8b650347723cd5c14783d113bc2114abd209699ee886bd3732c98e1187876aff19ac531d6f85579a54170517d4f1acfb6e71c068d1dbfc0fece51d9e6dd5f0868d83fdb7e20ed8c800e8cb0339d23f0ccda188f1ff376b3421e891b54dee062a3f99183b9b66b013dd8713191c01dde2983dc3495b40d5108278a7a1e2d4897b3e9ee6b7820e98c3b37899d7f23be381bc637ca0e8f5aedeb7ed24956318cf3126fbc4867154ba6a7d8022bce15f75008e73c6587125eb65151d4cb66aa4f0a12ff3a9477b94eaa34edb401e2d308b36d6dabb78d67b71896d8d6d7ed7e360c02aa48a430a6d57ac8b49c8d2aacdbf1b01138a1f100f71f646f904c80495b65bf62c0ae78fbae7db44bfb490ec19d10e250ca6884cd3fff1a55099f872f88c648973b324ed241409c28b69020e6b8df23db7f16689404e0af55dabd3c95163e9db50471f60b397c7a23caef5d49dd792fa880d350d90e9523e20a49bfb3f31f69aecb21e6e837362bee0bb07742dfac6729a2afa5d706c79217a65d0478da94d4ff6750d5f3de9d58f08ee5ba44e89c49736fc3e293e80c87aa8c8fe573b45f6204a2a82d61b138c2aa863ff26f80458c212911b7dd033eeb3cfbcb47cd9d336fbe883877cecf3dfe111ee7eee6817d6e2a9dc0ab2f0fd612814327b992d06ad3181850594a35ef2a519e51fc79f4e22284acabe7636b46f9bcfec61fca07668c0af4a8e0d1a0280c63f1ca67e8d7d2ddfb7b91d627b726e04a9e2718f2ff98395e973a120c8665a094b477257206caedc19b0afdfaa80b5b785f3b6c90409fd09059813f34536edda69648dd0226735b063af7c9224e7aced91dc34836659aeeb1e75c5566599a9e4ad464b616b6397e9fd671e4ff145ed00ac3030fb7c90342b79fda52428e0329b4801e631304f537d9af50f820a2a72c96f43f2f7bb693e984a674101d0e7d1b9cabe151e693220711d98ae4a517f41a0e36a7b3f77af1c79f7666726b098e1548f6a1a56274c1ef3511e8ae9a9a2208ea06d3674466ecae900a9cf26b4fcb3c6fd881767557559fcf5bb3e57c00bf4d1f003c9212f4f93337e5634fae3a9f5150132d76a646a9b27dc6a17c143de587eceec92195bc7d82354bf07006eff2db3c52300dd3ee53c8507ecc8a30ef54c3f38ef928db021f02fb36ff43d181910a855dd2b411f786611ce173384413cc3cf84da6852928ffab55fe51be08b31e1d4e66073df6a676ddabe7eb49f6628345e9f74d1b564b97a69581713bc17179cf04f0618669a35dfe737d5ef73aeb0522a57051a6cf37de2aaa1bea2c8d41040d551c26c5552c69aed1b1130251db7db5cbc9a3fc721e620f8a5abffc01c47ce46b196455cd255ad9fa4afc0b6bd0be907aa7650423218281cd00ea633fbaf2c58381eccf2cfd21a00bdd4836feeeb75793ffd0a7ac598bd96debb735da83bbf91e7a2d513c327a79b37dd4e385ec2b22e9324ee5865d79031af0d6286c304f6c010e7cee8d8b331da692bd3d6c54d8b6ab3ae68f820be15750405fedbc6693c699d5a7f31249c54f6dc3ee8f35ba41560e7d77e13ee292cf96b13a5269037139cd56a49578e651ef5d120ca6b75265041c5d80eb89b445afb221c3514602b55c4d727ca134995650fbd55a6b8ac00d27f8b2b906e74ea16b13ef6d007201669bf0bebc3d02cc69aca79eab8ea6a5b82509524a8635748c8509eea3e3ae4e7b9c355430a385425e4cc9e8203573a3713f633fe636ca9c2662674ca444ad4d3a061d4243985a0d8a2f7ae3dcd42c5657e7838bdde1b737ec0a5649ab27fbcbc14ad303d271fdae1353daa6cf7385ee151f70a7a28c39f79ea51e86e9acd222d41d4173e1b3b745364764d47652c06eee98b70e9f342ef6fdf99ece0f8ecb48e8068fc3870286a82d316f831c4a6e252e170fbd47f99c4a245ab70117abd6020cb6a293c20633ab781120ac489ce02f271a7a0f55efc7d241178eef77dcd67a6297a5188669aac4e11b7e2ceb51ba2d4045c06a318d876e60a968a71bb84cfe28d3b4439b567af70ff88e1e4a73e492c0ee797108d6d662626cc9e88eb0324a219afcc404f7f7ce054017b8f48f589a30fc147d582660c32473fe1001dfe076078f3683b33db7d0c857ddb705cc4ed307e82f35c7874a105c8ddce8c104ccc7130a94429c464d3ae0f2a8f4ad380acd0d230a6aac5593f7413c99df327b874dee1740bef583f49b5d1ee4ac5292e9110601bcbdc86b7b8decab037c925aa39913b412f7a1bd5fe34dad8abd35a1d02b048b84a572ecdc03169b3f4ac9e2275c17b974aa07e87b8bf8bb6872dd06c9f6c246d3cb2887702167b602a7a12ad0136b940734cc0653c7a996bc18d85f3fce41a9b7e5e71f380d4d2ad983f212a53395cf3a8da1dbb643ce10f9fa59fb99fa531f1c8ae343392bf03d37076453a36eba5570effeb10ec46122f74a3d9ef143900091bd85ddae09eceaa45b64023acafb08503f19ed17b00a40d9cb03fea04c43a4cc5e1173b2991c09c809017a23be3ff1f10da3de68e2e3b53fd80e95aa67fa1f443553c1111256a102002cd80b3d233ff4017167b3e3b900741e16de4cdf4a5aa208ed86df14c68f59a42c2cd9f9981d2fdcf0c3455e67fb4d8e1b2bcb9dd8889bbd3a812eb860f6105da4e66b828b1b9f4018a04888c65a4ba78b2cb304b4457a4911c1f4585ac7017ca9bf8c81817c3edcc156a25f0261034f2952619f27a38b069769f510acea38dfdf1ba0a69609e64d20e1c17270b2d9e7257892312acaddc992d92b09d8264c0919acff0438fefcd8084491d8cce99d4633b36274d896ce486534c344614cbec660fd8430ea16606552bc03318bd1d85eb09109ee74066ffc3301ac4fb17f8aa379b62a5930ff4917de07abb5796868d21a026fa98edb78ab58caa13ebb775079b7fd6ebb319f65f0fedc741a5a638e97ce90dcb1769cd7ff4a555b31c38f3109c8e0b5df2d0e59c8579269f4433e83d6117900bf1cc544fc95663777a86f1f22ff08b0a1d6f49cdea8427af1f6b674477180057067c496f5323a7b5158a5f96b3d4fe39dd951f110aa8a485b8a0c1be03b5dd711a5cfe5cb33f557d62781d7ccb1ec762db005bd15a65696db708808c04e65e794b38535475a931b00b696c27423e61669e72973b0d6dea02ce805c1c5a3d6e51dd259a8483f481f58e9a22c121eb65e6ce8c13c8a8a7d11c49eb4f3c2af46fa6f5d791a442a76f7fd328dfa44c126ce6a6bb04cb77bf8663f672728a729ccd70c21826de3175e284282f3d4af34ec6c56de2dec31fc1c95ac4a3ae77ac78fefd5e9da918c9d140c13e334b8496e84ddcf9fbac2cf5c7c10bb390aa584533f11620bce4801abdc05185aec37107bcec774050c51251dac32e1d536b7cfb00a6ba5d88e0123d0ba867b40980911adabd926c1dc29db20367c9985b011e68e8033572b3939f88ba394f832251ca76000c19e2bd1da2cf63d9515e063115d0e20b7555c6dbcb23aab734eb7a640a7cfa797ea62fabe5e5633ffe85317a82ee8a65811ee93ece957255ec565954258d5aadb7ab2c0527255147e70428dffca77a0e8382e6aa1edb78e17de226ce700581ce06c71e601629aa2b4024e249cc47e19f7ab81fcfd06da23e0cc308453503a32c61926f83ffb53dee861b0eec8c585c5bc85c87026bc6e4bb28d44fdb8ad69b02a65940f2024e9c618f1e9468f60d21c4402bcdb41fbbf2962d7a0cb2a9dd862bf1e4abae867a2994b7122d25ec7a6aa51c72a16e9285539b21eb91514b06f074f3a657a178052023bdacb0a6f8895a1056edf2923538f00e397a3e6c5311dbbcb9569887d37fbc290eb5278f664fe9abfa1a5a5c08f823e72944a528e4a18c3cc8a4e252b1de2a1c4a09c1d6e3a3c184ad5228135e3ae4d96471e60342bf48c17512b7cd949e2a11e2656130cc66815d7a3a970101b880c2063f77d4e369a4c632b7402fbafc40f73ea155f9173c061c0baf858f7cbda26e0949b677feda0892aa6f2f7f30538b2b1b18069939ad8905c6e3e5bdf99c298299ca6d0a52eb4d25af9b3f71c0075b552d3c851cb07cdd28c8f150689c441c8061819b53493ad093c03e18360050493f2d63a5f8e04fa7d7a139476614c7863981dd4d01431645f83fc49ab32f27fc351c2dfa84daff9af8c84eea05bd1c8a1d9aca387a0bd08aae705196b99db38b1431e82392974f6689953447be5d35a00fc7182927ea6a8def071cc7bf787ec52376a7120ecdde40f4c1c61e8b2759946856fa2b9982a3dc7b27f1ae9c0f2ade3937bcd8884da13249d944e3c7a08bbe1823e1f997492b51bcd1d8e1e95b6dccd6526c206cb4b84a892594eb5e57e250c39c79bf29967528cc6a886a6c0167d388ea232792ed1fd3e9aadf4d97aed19a9555785a12a6566802dfade58edc6fd68e51911f7450cb3f9988831003cca6b3724e3d63902a150e2a752152707f0bd26badfac99a089b2d49dfdd659f93dc002a5ac0ad1389b2214ba77022a4799f7afc105b54364ce4c3be3f784d6531742e9ccba7e89576bbd1a0e849395693ba0141059248e477e6c4e617ed1d2e28b4d3fc5208a0d4df15a194bf490bab75814da7d6de92f02c7c4c04d221980663f14d82c50c96cd328e94fdd412215aea265b0541a6fa2382f42074ea7588321562b2933c99680760bae6c505f38d7699103bcca53420d1e9f62d4c826eb6f2a6e7e33cb18060aaa063c704312877d416d8688bca76d6a4d698d277344032edb5c4ef9724fc84ece78bf4b08cea337549a603ce554dfd76c350b34102e332c1b640901e1fa3fad6ad8e56d300a54ec15d86660064ba74ad813bc68d2c72188f43d24ae92051abdba25b5b72d0c53a6d860e502978907ad3939ebf868d4f824fc1c0bed16be9626370d3fac6e3becd303acc0db75c5667f766c0e1610b37266e6931de2e35e7dc24b29391c3a269d9372121cf4d5fbb0e9e0c68f176e099b9d1a9ad8f7b3fa1e3e978f1cacd88e02d9b899b1fcd05822ce076eb1e34ba6febf8eff44c4eed6b7795370afa39324c4bd0d547cfce83769e012d076d9f412d4d86956be4b19291fb04a4c588b983a41686996e7917065f4bde17d319dcbf6f92afd2b91f1de89f54b7678b92c046328c825ecf77bad7ed53a30b6a473e8aa23207170bd77ee61676f2980f2411d7aed4624293414c6e07c12eef527d3404522eac40e746ca66a00275abfb0bae0251d633a3cf25b27c27ce63a28297b5705735ade981566469889f8e14b6284a68d93a45fcdb00b4404d1e88c28338d87eb7c01019792c6c1fc1eff20f1456b9b6178fdbe1bb7633656f1d5d3625d17358f018a46c4642c127c5edbcc393e715eacb4e251b2693032b0c3173992141aeaa84ac2dc10e8a36d84a2ec2ffa676ace57c87d1216e0d5d84221e4859699c7586fe070710681c2930938f325f7a18b8b79dc654f1956024b3ae83d8d3cf53b4460a204138cb683cbcdd40345829a279c632eac1fe83c44f394534a79c040bb0774faba2fff38e1c5c4f4999e06d28162b95f78ab3d0c502c04d98d111e9fd814029302938ccb29c4d6f3ef3b13fe65b2690edb6735c4cbc0661bc3eb5ae18712c58798ae92e322363ccd0a482a5a8d6c243d2209b389902c4bc9f697709cd0dd3dcac022c70fd90458ac24d1f0fed9dee5654c5b48fffb71e726fdf89a5e06e555e10cecaf762987fe262c70679b387e8feb0de0261cfc386827825308de0372af0a26aeee569a8b8d8f649b0e73daa630415a37d0f72f5413c039a289b290f64e7185457c8aed5cc0bfde368b18d5561f2f3dc509ea765d9de55621505027322f6552e639b3d6e4bb0fe99eea613b85ce2a4313ec6a42f2ade67d25e03b3e3c1ee8896656eb220bc212cd84e87c481057e27e3ae84eb3641bd574df22f1cddb454d45a870245131bbdd4ce0f897d8a09d280897ef21e1c39593313c6437b9e99968db7750ae51c319d07d71b5e927fb8a1e7bcad11bbf7404d3e41405c24954bc2835f764611bcdf07a72499247432e6ec0a9bef41e799b26239b41a193c8b8e2efdcae836ffd3d9639a33fac9563601b0d4f7a0eadca2da262824cc319ce212df70b7ade6ddb76b64b19d8ecefc3ec679a1e51e76a293ce809e7de8234ed041e6b38bf5d5856397d0db03c1e83297a99e5f2348f429a0c894580537108b7b1110b6390a871f4dd30b239ae8c7f7fd20c209d47207e53d9adf292f9cb4acb20b45bca4f4d7b19a4dce0430ad04cd493b9fc263aaf694c644e0ee9ddc2de790768f40d52e43419b7f8f84df24a145b4d499444dc5f306e43425dcea1eb2ba90dc7e76968f08404122fd2d1effb5bf49b73cefb8e0c02cea2400737171df0993684237e2baa7768af1150124e146b798767ab56f064fea327822f2a94594a7dab0ed0173384598222254777fa52a1d8571b7a03ed8e061603c65b09a3137bdf36cffeabcf81fe98aecd953228e746c255cebb1aa757c4afca7b18b82041d5d79c76fe12c2282ab6ad3f2277897612a05b8bfdc401f4faaeca74d43526651a140612cd2eb9a59fa86eccf500381e504d5f29e403aa8961f5934defc16f7ca9bf2fb72798bc65508e2e01bafb8d0cec297bf9408f7007289286a2727ae39e7def644d74dffc219daf5fb7268f5c8abd65fd92bdc794dcac7bfea49420cb6f19c0b785fc913c74590e2669b4322d8598e4c0658ea7d2b51432d24a3b68e548143d9463d91a72a074418f7f0a92785a7b216503d3222333ea8b73570fb0121683af523084cc24a34fa2bb8ff7dc8a970fe96ab1e51b8a94f2690d2e55235f22a17a8fc14e702c91ad226a9f884d5e382541d7357bb68d2417eb757d7d43e05f01d3cbfaf6888efa403a6d1023b8332b0533f4511b319fbc78884b0039193ca1787d6cbbfdf3550939cbc1839640add4fad41787ad977cc0559999ece1a4559e3ec4cee775089554f53bf49d86411f65abc921f98893a66228c32cef82942393574d8585fc1588dfcd8b108990c329a25a26e8dfcb50a7db8e4f6bfc7e2b4f2af416bcbcaf8953906d6b5aa9a075dfdf544558ef1da3c6a672f78c372493bf8dedaa13dd2c17b631829829f85c33ce99e81ba693e41f9d9eda541e5d5ed6cab41566f0cccc82ba2442418c578fca5fb0e36fca8fc9525874c947a394dce334e0fe2c757cf47acaed571e12c62db53de30d233a9dc04641eb5b643976d2e7b6e839140ba46844fac9f247b538fc765ee221008641ec37541677fe79d3967acd39f811a40c83e24f2019634cd4426f899897591f47175748b9e5a035255d3eb9f3657586e632548dad539981fb3b9820e998ba9711c78919a0c85b8af58a19c42e5fca860c70a5d9816a2bcfe0429bc8bd15b07a84877d6ed5cbb0df4ac7142aa24a8f3b21e8db737bfa73959b06f055bdd01a011600cbf723dca55c828de2f8e9fd8451d2dfdfe0a8eaf30c95e728dcc64b5be21b44a5d6a54ce9188c214c348c8131495b8cdf519f98446a10855c7d2575c8b1a2162f3f1a06c73d72a344ddc0ca9df3ceeadc407dcedaae5c1d99b18c0d469444ec2745bf77b3e58d7852e28a042febdceeb81606c21aeabc93cf14bcf7c884a3d9aec0cab9de5ea31a54d9ca86c023ac96d92c242b6a6a094d62df10270bac81bc2cb6fb60eae6eba16a0e0a316501762bf545621da05a1dd8d5a3c5a5469b1f140c0c754a38e0c3864a5db73b9b79d094aa1073e628f8d724ca0660d826fbfbba64d5bf4cafd7e701fabc88dc3903726dd0ab0c1cdfe06cc42e083bc71b8d87f910bcd1f2d620ab6e1344d1bed7428a42f62e9ade6c3888746819f9b18cc251bdc4057162836a20963558d2fdefae27d7921030dda4f4b5349fb8b6d0499b2f64a99dc55f2d9e39aa807993f056b85209b57d6a029dbe59151d784d0eb022ca3a170007e9d32f4ecc565e8fe7d9f5cc2c9439cf4279e0bc3637a2fb8fd0f4de4c63019e1b3d9e11f895e40ef27f947dbd6dd19f4f93e19cfb7fcae23c0113e3b38da6a2a1b31fdfd434061d3cfa8c4eb47aee84f292a9ac01e77cadb9c4f59cb28447a51feaa345848424eac2d4368956f6f57c63a382da66cebbb39c36d3298b5ddbce309abe76d234c35e90a2231f8f6fe8f4def2a836ac7f7900ccf0eaa5d41373926faa2582343803be4663cfe99b57d3bac195383397bc85e3fb2fdcd4829bb6b80cdfbd41401bde89976f8313c63902826edc12008f388108ba98da0805705ebf26ea0b0d974c027bd8128c9185b1cdf132147223e80b36e4147f9fe4426382fd33f1a73fc37ffbf4ef70ff4d3d585371768dbecee8496fe9bf4c29fa1011e0098a0937c3cc2f03d46275e5023b32239228d3173d53e8e34daaa302b5df721b4d1aa035c40693c31ce6a84fdb60d2e4e7b513e6f482991afcd8abd9fe0c10a48d398987e17feb92bec933c0a44533046f7e9f0fa07a0404ac16c413b9c8aa93e234d7982b6db9766cbb9162f388786462a74acdd6f8ee19550a9007111b26733abad0e1c3c1100d882f20d7b2acdcb0d67726ba0dea0bb43b8039dd376ceaffdd9838bd21dccc2901229fef2fefd5cfaf6da5b2503c7689e14bba3202a522fdb4f3a16a463ff817f4da48b484a470985ba1221a1a4e221e7a4a60e703dfffa5936c0bdc5ee64e09a6e5d2176b716445b823da0e6094e828288c132d1a132bf0ac43d61ece13c5d84d9b6f0e28a938c8ec4242d1ae8d7091460f636825c36889d7d2d0e4c7f4a9c43bc775dd3a7be4b19206b0dbc350338a4b4c63d102e84c87714772d52e76b268a5ee6719689e81a786b082fe7a0e9d1eb6d81e36b3260007cbbfb94e84ea56adaae6c4d468ccf0823a68b6beab4aa951d8c75c0b178ef3e9dded5f1a901dd8312e9f0331d22333b321d7ae83b0293f178cd8175a7f9fd53fc7a33d76aa873a294afd89d69986f3612a95371562d153339e778627efa5cfc770430872052f7120c07c3b9504dc17cec9b2c94163fd25002d2339b32288ca19860eb510711fdf0816fc3b2b93c0530099fbf13d77267d8a38bfb13d9cbc6723f4e3e04fba184428244c7868d6e2fe02e4e75f31177bad5acd12196dc5ded62965d508c2c247c322d67c396c6e48829035b4c1ce0f41bc5e226481d502cf1787295bbc2f4aee82a72442367bfcbedaf81a12097be404608f23b1969187992aa9c09a2e2402530b3a88207bbf099bc5d28c444eb74288cb45dadcd8a8269dadede45c9677d57a1fd7d4cf7f1f8d436e1431c9863a2cc2f031ccf0e0772bea0988b1ff6d3e51b2904819f73c57f21e30e8656ce7cd733821e59507d2575556be4b4398a6ceb8593de567d39efcf6efe7a95e0284a6c5c67a88e1771e7b4034821239804969bcb82236516e18196ae7e7dbbe67a579ef1a0d75b74a7bb1341b9cb47201701bc0e269d902d11fad79a604cc109f321b59cbb9115d4ad4b0f48e439c1cffb5d8c42a3cf3f65080d18f95a4b0f24efc9b4cbddeb8c257625b27655d7489035a6c7decb0088de06130f4b76cbd8e62b8d2176aa2c811d95f32766dbe11687a78e8b1f2b918779e13340a43a8aac9ae13a9be9b3faf1c59aa436c3868095e1a7cce8366ae81f62dae71927293658f20b59e0f6f4c2fad7657412916feb6008c5994b4ad5fe3a505ad71bef3de0c71e7e69a3c11396a96214a271af8cdce4d66b911bb091cc265f508510349af55bee232ca6dffdea322a98f1a08a96a3e68915d34cb78d21ff9b82dab4b8d4355cd1266da9d15c53fda3e4fc1891bf16ee7e06cef12a1414cceeb6dd5a2600a755e16f21a9bcf8487a1495c1e7f2ab36e8a2dd986a9ec0851a1c6fc4f51f16b8f0c0463cb6342093e20489f53a039cdc09b3cca2b2c238c40d720cbd468a386f0921093ed861181b29b5618154af617980422235e6eff326c5169b5f286055e9cf10d32bf58f022d0c7304144a00cff173dc4afe5bcb4e6c92cb96a41e54b66cd0d450b2e97e026aaedc3c4b9b71f4609d2184eba4775290ac18a1d5af530a1e1f9346b893771d316e6902d7d47ad99bfa6ef1af81f7343638d107475b34778edbaaa13c708eebce3abf0d313b9b07630edfb818e557819563c86fa1f8084ce600a4a61fa4179ed86695b2029ca1c1b4cc8eb1592193b5976612040394d1c4c93d9cd05b9506ec46d3bc9f20f2b5c60d93a33ddc00a2584c49f49de994bb6d161f2dd56a233c2c9a44af88e916569822e49e72da76b3958aba165e445fbe741c0836d0d343ad3cbbb5c7c666ad7d882d2e13f49f88f35ae0c95681878a0fb62c0a6f8d1e53a984575a4c7a01ef3f326ca4ae96e997a4f34d7c3ec92e307341dc41e7304155fbf89f20669170bb6c6a5b1e0aa3dcf49c815d4ceb8e8359f89779114f364a82fbfd65c51907531ea01dc5150e9e8fbf3a5368b3fb269a0215779ad4a02546d4dfe3f6d5bf54a7ed08cccabd269572f6360c5c664a25cde35cc6db9229c7a53ec9d02377ef12d164f158a6d72c29605f8e734a4d0801deedaa912e68515f624c850c706da5291acc594efc81a264be31de46d96aa32de053be6467e8ff8906f360f50cd85cde58aef24d13bc69f86b78fef01056ae577f498309bd099e0cb17b1c345f09859a7b551737ffea41012bafe587e382a3aa8aa4f8b0b2d10d59fc35dc2fab629d443305237af18e5c5ae8ad320af352d06b613f019ef5fdb03bbd28d845de3839ffdab416d1841268ac1b20faeede7a1b64ae74e96af24244f58bbb3b321fc75957949d06a2777ca4984d5c8ddae42ef8b2bb1e77a88964228f80af6ea5a1bb4950fb6a641788920ef2ff62970a302ec2440e1873a89a04d32c84b54f8bc0b808a7b5b168d3b09b669ccc18afd99a8c113087cadb1c3fac00a36ee0dbad3c83a92832e8a16c646b7c12f865ba0fd17522a368ebca5a442356142f8d3c89b1b34a384a5dd9248daee032c00141c3d9e71fb55afb2850c6d932311946b08a715de359f2cb8cb4f3818bd48ad80bd455ecce7601dabbfcb09cc85f08ebce224c337da8e49cd46e4b97390fa49b27fb032574db76f1827c3bc4c2ae3920f9e0e9ff8ce88ab753310c30e62f8e3b2cc851451195f3defd9a42206441d2ff3594e14f5d34190609b8eb34fdb5c8820fbe367153b777510d222f78ee3bbc1b28c20e028d6b64ad4272f086b8b6b2783439a8b4f354993a77f49081716f058aa3e292b6eddf8dd1bb5ed625a042caf883e510f1f4e9609a0acec8ae4d5ed408ec7ad5b128da0eb08f0391d3d402d1b1bce1869f9a1030fb05118f7150b46487743d4abe380679d4205e2c5a46d37d679f4f7d6c83e4216a50fa9bd60cca7163bf7fc1029ceabc3a2818526ef855138ac924debaa5001e04e31c0daa3244be078df195bcc271f4ecd6ef49d1d7aab5d44b7a82455051c552d46585f69ab5d850e92692b28546719dff33905d2903a491684ea4ffb1786bb5900b958fe692656902337ac371c9d58ee12d7488f18d819980a2f1afea9c22990521fae6e29ae2ac60934b1cae4f20c8e74c1d53f2e6eebcf341b24f7beb0da69110c22b54e474ede55b71370e25a19133aba4bfc2694c7deaf7200058641fa7a7f354f0411aca73a0df4ead9a4f37b1ab8b0f2aedd99392666914375a370396ea52dce419cc6ad7605cd87c6fb55a9a5165153a5daa190b48c834e695bd54c553544bbddfbacbbb9f9d06b8628acf1c1a00f2c340bd2131f138e3b419f9dc6bb9f77a47c80ebd1f2e112523c17fd0472f4e046101bfe04240e51849641598a03ccd456111e12e92e1d8ebf8bba61c2ab983ad0d608639a61ce2b09b39b75ff74d4d1575c59e9fd175bf9017be7e1ca8b372be4dcb500fe302ce393a2b7dd7a2a96f2fde674dca2ce99f736f83608eb12339e769ac7ddd44c356cfb31c16f98464554187555fad42b46020f395acb635bd85ae3c97c73ebe81b029e0a06c2b47c5c61166e459dfbcacfa174fba3344c54f96b55e0d479910b14797f31978eb8b164ebc315406547c4bc0be1038eaf2eadc74972885327b1fe4f8340acbdbaade01bee1b84987977661fcc960d3ef5d968984ffae967033eb45266f7f3b1761ee757f3432ff2e46c22b94ceadf26a645707ac14dd44dcf00cff41d85e54f24162378d20d0880c4b9e2d0a83d4b373b7dde7304636a34d1da17a7cd5175894ec96f0f8e19b72ae0cb9517398909c356a274a9a5d9880f4d8aeb4f95fb48bbaa6ebfd86f77b67aea1b9cab660ea6ecbd3909795830a7bdf713a17a4c5fdf280ab140d1174f599b19e1834a3415653c2e73ae4f3b397057dfc6c50f97c29a61de9aa369704ac02c283d206e3a70d29f76c43fa1a1a10f27e5d9fb1b008dae1b6b18d8e09eb46707beab3cad4b64179a36e59e755122fce3871dfdd729430ce7ec693e3146a023cae18fe0d9c5dd7c17d11a5eb9c32fa215138c2a3a1b9059b63d18d3d2a21e2878d74f21cb54c18973e6e0974eec07dee5880b18cd9f1b949421e639bd3a96ad947cc73837d65c7c5f7949276f6ed115ea8f5d4bb1847954b8c5e6f5943e6889cb6fc417286c0f05a75e7005642430d56f1debf2838eba57e7bd5083e77ec84d0b1875e55f9afad855c913e5790dce8190bddae170ded5d4942cc418a80f2ce4dfd203b6216533fb39d1b5d0c9d925a61a980da3ff74e67091ecd79ff5a9516d709bb06704bffb7eebc77d9dd7e3c752aa27bffb44ad15f1ff97f92b937df56bc0b208a20b561b5e603bfb20e5bc1b0df055973b5a26f25d232010b2ac079eb9cbee9f5a7274c4f9aee9ed4e12fda2bcdc3b9cb6b419f060cd56f8d4864d894dcb6e094fec819a222e8fe20a8a21f9940ce846b224c8aac54d61c20e8fcb6b939b2d4904f9c2b7a2f86c9b773845bb1366a54fcd158dfcd2ec30ccbedef0aacb71618ebd5e977e9494fa35c84ba446f7b7d3340fb7c96abd408985dd7403e368407a23855c4154724f46a4ff4f09d1d7796ebc9db8c9895c6104957722fc908d582e7d3777e1ac190e7ae2f011323b1064544e0a1e4743c1fc799f37b20ac9141f126ec983eaa61335cc5e0e002205db0e490f54c0651bf8058f82da78ce283e644881317c645879bba47adb3511fd48dbe5231bbf4a17fedc6c56453e1978e08a2f6a3b9c1ea9f7079ffee287cf9e41213a2450cff4cc74312950b799c40b06d35099ea3b66410e895c81173377a4bd9b4b1f6bce9eb7efad6e77bbd45cad08b627970a59cd4a95cced31d2ac3f8f0fdf98986b347f88bd2284dd2067686ab2c148d81131ff52aa4256383f4d46a24d4d4c3af321c68f3127a49353c2ff9876b8a623c3ad9ad13b43c5907bcbcc6d7d8955fc3458345c4e15707e5ed4c370a26d5c5ddbc92afab38551fdd043bfa16c0993fea32205bddac95403dfc39e208fdd100438328ae4d2164b0482057f0625ade67cc2b8e72f2c01d1e86ae0999f498ae288c01a96a96ecc04743cf927aa7074efb0bc52f0e5c07f11a06f663fdf86ec584c4e6672154e294eaacf9406be926c40ec97e2da8755b4431f0e15044c318c7f3c396eb34756fb638794b902a6d5905990a6f7a80b4cb053abd058067c3755e45bbd4e9f53f97961dfc237a9cc097783f98a975a52d1572e274833989663ad89541d7b842a8e53c0310f6687f50263fb4e45bcf87dbc86937075c95c9062752452f839ed49834f51b4044c66c0d05b43f5a464d7f5193596e3a7114b42a4de87c3cfc510eb87ff9cd7aa244a061cbe307847e3dfadb3e4390038fdd1c7f6dd707bbac203e49242b075771fff96dc7170a568e9b77c35037d3db2272b24a380131cfbc398e48e80c8f461550476f6336e33e3abbec171b7154168882d3d9df917d2ff4525d7e6a5a43ecfce194bd259140bf9c6845bfe20efacd7670a1249773e109ae15ce5c13c17bc7e2571c7df37981a1422871997a32b6e3d5fa819c59a0a1af66677384a96415905e8d250d585cd23114b1255572180d6b641fda495adda90763c858d42ca3d008555212d16a18475c0fa31394c064b4833dec645aa9b5a4bbd7268bd840d067935ef2cecfbc46457b1dba2adf1c02f2b236fa2192ba8d83101afbc5704114c705030a4fdb5cae7fb9da1aff22d052086c8c7bc1df6f8a79f3f1caa4eb364cc6cd0f94716fc584161218ab5c0b0ad62b3b56c27eb122f27d21629da760d626dcb93e426f8814ed2e4e0fc1ed85fb51ef899f5a7ddecd15ae1680a770b88fad5db9d5b31340b7b5aaaa0aa57aa26db1c3d2674351c5734937f171fcf98865428b1ce353b7d75772ca485bef32ee6b899538a791204141912723b23b6616eb204b0d5ebee82e976d37adc4023da6f162cb04760a41f26f71db792ab782ee78b2b9f306aa143243d5b280866b8657489c58c4af2d345a3f01af9eb39b66b6308edde3d3d45b5c0dc5ecc7d236ffd4e0061bed0f58dfc57b45a91f36d87df628ba7746874e7fb4436286d2dc7e09c9649c29977f8a27b7499fbf868a06dd5861455d2b58e23337f5587f1f8e1c75fd2775bdf39aaa3b4a65fe16637c30d43bcd9992035b6dbfe833c21a4fc8f77f1293d5914d4205b64bd45abf7f54ed9a24c1a88903a786b77a39d7f26fc11e84fa1c556df0e44fd50304d52987d651623b0303bbe6a5b1953138b22909fe248269c9b2b7854ab19e60fda5fd6997f0504e9e1db368a7b672f56ec64078f18522956803290efb365565a4b9ead24cf0d9e49bbbd33600cfb491c48e68d7556e5954408e368b5b9ee2bc47a04de2136cb684c8f58e4c2a8a32f594efdfebcf61bc703c0494bbfd3ec1ac3228c8b6e1d841412bb8063ff2dc9c0a40295a135170f763e93e1f936ca2abb9cb765ae22ecf2de490bab8ff435071f3b4772e9cd502eb9898502236399fbf9005d0801804c36a79703c084d6a255e8b23b6ae8e1f887b1d5ca9ebb45dabbf7a60ab0d5ddb21d8f937bc084ceb6e77a4f9c2194236abab6e4694efecb9d25e5385b094e1626efea3b7f8907676cc7586241180c997f242d80751ad3e458c6ecc3365e2c9e1d4d5482560c8e7f77bc912ce418d60c8ff0d96bdf9f2c7390bcdad58e88ad8e1b28f758d1a58afd4f850feea7f71dd1f633bb695cb8b5e308294a073bd2b395fb88dfb207548a3a2450364dad498a28459962fdd0859e29b966073c4843b67f580e600151ac30188df9df440de01107b794c6bfaa1164779bfdafad6fced331146831aae1b6c751a66aab580f0566f6973bd2d0d3edebbe6dfea275a338a0120761eb8e7d4a4dc9297eddf72d5eec8eb55a7ea9a45627c03929ed36b372cf3dada7f61df38796b0361ffa0502ae3005fd64dc73a7180d3f8eede3a612dfb4eb0cdf65ce864a1447dd55825efd6789aeeb42d6de238f50c171b3f02c9121a2e3b11c6f1daf4b391350e638212cf21cedcf33d9c736e765b48dab39fe8a33f73ff20c17211587dcfda3f42290f771a225381fb75796e3d367cf0138534ce0e615a38c2dc928420b748b3ce362aef800be3d3734beb8b18f42b8cf986043fce01f51b5c13ae92bd5f95f64323a77872f4b0e9e6a1bf29dbaf7584fd62757c4aa11fc8ea740b8de2f2c116eafad3a5d58783aba32056c7862e823b163f218c21f5023107db90048bc2d77a446f2a48d8268f3f6f4e0a4d12bb6ad5693d2e8d2041edf1a5b19e6c90aa0022cadbf5bdfaaab97f6a94dd045b183f0ef7eb1e55505999465610ef0be99905568792aa34d43c5499369ba6f756fc44aad6b92ad92cd2605bed75157e15a92910f88885a8d45eb2db99d5637847aa6785382dc74f4c26d37faf46b83e3f19294188a7ee00e1697fd83743ae612d486e7948f509a3e2d1cb5250cc356251a2dadc9de8d3cdd2d889b4d541000545f653dcafc02069f1cf325a108cd5d8dbb5dece732b168796530200f23b82ef2c100914ff0b349d50a5374d546ea41676be40a9d1f20101a48786d5473ecd8231a8f6bf314e4a9dec5c6372aec6c870334cb84063d02d89b52c6a57ee48fa01aa9e7e5fd4c70462fd9c442758ee9b15a040a7548c749b00e7948e3a0e8a1d83f2b98875f7220c2390f514563f162f4f6812ec341be8611a76d525bdc23c3f24737505c7b8a80d59fdfdea15a79969fe539055162ecdd2b7813921534dc313b445f3bfc9e256de0f86b493302d66a190bc185118985cdd518f3a48724086e9cde57b51d2c9eff6d8792a229b29ab0d50a4c1ade33698845ff03c9549e1bd744de11a446a46cc3b6d821987fb3bb14f9b225adac285be0ae8d5045986d66e9f8437ce04c6f7e66b96b50f71951ca2d37d1639c3b98e483d25a69bd3952b27eb8586087b0e2c39ad3ac55d80efc08f8a518c0f2ec96cbfb977680f9235d52b0869dfa2517f3d65c0853c7c0e4c680e490d41e62d894871b968f2356d9d34554ac2defddcb361feb5d23a02ddbd42192b0431023221ba2202fd485337d32681174ed335dd31d04f08e1365fd6f31f1de785d5beef9f424dfb78209ad5f60202b915b6b3a77011f5d12aa7dd955fca58bf84ab49f14bb7ab0a8da979756d60d2775128db475db08e4b627210d2008f537ad89b078051da1b4d40e5b7352ea617345ef0fe850259e8702099b0e8f8d73b269544cc3f26961d55455efd57c944ebfb20f99e560442147c719ec486b6d8fffd29f9117043b12ed68702ae159963853da8247eb90d43fc5f49f3bdad372a9b67129bce48002f5686506cd5ff7c989c3b3f8caa7902d2bed5def1344f3fc83e9f96113b790c116e2d13a7c4b6f62b8f20864c0fe473055c9456039f0f56139ee98aec854c991adeed7ddce3b255982f4fb2557260a1339ad2f5178872c03423da7b28c61c654a08c412ade84a6676c74fe3f626b71c5f6b0c068109eddc0f2252b732147c5df1b1a6b3632ba693aeceec3cd707edea147010dcbd71ea3c09be1b9de3c58419ace0c4211d482e7f0c81e10f979afad44fde10c752c0515c38e79d4245fbc8683e6cdc828d38a738c7b9b9f852e6f9a2cb6b8cf40de1e512823ab61a514041263c1cc63fa4e9ec6cd18c5a0b3865154cb35b4934477185d3b5725993f82b41061fac2c53b142e8307df33c02f5a6a2f5f51c88dcb0622af931379560c6e93ea2677a4c9c1f1f69673e0aba0a28e63c993a378520d9f8b825b6dadebea171dabfe005c42120d67adc6fb4679791e154916b01e75b8ac155b0ef49739b97a436c3842137ad2e628df5240295efd2a1d2eff0db187c54338ca968046fed41725e2f4946bb28021694c8dc2e64c4181a614ae6db96d97c18a47786d5b63a56c9db1fdc893b5ba5e58543766817c23164459061ddc44b84b9dabc89d7eccaf607855384e4101c454a963625649523999f5893cd8f95e4b059fc549d2e7a8891e5938d39e8eb3a1f382a2a3fa97822c90df751229b3a56a85fb010a30bb6895e4c18414b19ce1dba4e7c515210d8bfcdb2a8e77c7d41892477a683fca05b57e26fd373d1b41ff478a80f800171bf1021e74c2e295ddcd63753ba5a6446e6235de95dc38facfd5adbd969c406c887967d0171b47334b2cf2da9bcce0c9c64c9f593e84466c90e178a37811a0c11103eabf50b48b7a5f2d980fd32d162a3abcf9af6dea0ede5e1e3f26fe131e28ece4ebac4f513e184973a5a63c491318f605765e1a5df01228006a8446df21cf4bed624ccb60d42f1a121be16742109b263d2ccbf7f19e09afd61a022a476280ccf87688665319496f12274a829634f1663ee63a9ffce9bb768684cdc5902061ba67f2632447ed7a5677b223fcd53c5daed1ca68f4ef687da1716e7527d801a780d4b0b23ba6866080b660e70a151cd1c51295328364fafe8611e9500e1752075a4da1a85b3d3388799f7c6dc482b9a220b05570a50d2a9d8bd199b6c4e6b438955b490bcaeb22fcf0791e97a1a7059696addf2314d41b4036128d2081a9092034fd60984e4c7ac17490ee019c3da0d69f9eef70524cf2b8d83f7ae886f751773e96e571ba6bfee59f86f53dbef1f2f89039fdc17ce30214d35fe40d0597b265e08722082b4c37e2c117786b05bfa422047356f45d88ab1f38ca38bcfabf8df6464b6c45bf784293c1dff1af2e1bde27c35dbef92bc649507fc3fb10d00cdd39ad851eea899bced8fb3baebf262d463283529632de65f4937a01d1e7b00cd0c8e0102fd605cd4d4fdf7f7c17178c1046fecc4fa6ba0e4caaf52d25bad8488dfb67726959bade97decd014158c7c2f3e9fd236186f3df2983148d630c9247021eb93e28382b55530543ed90ece6f5c3cecccc2719dfd4ceece21d53fe2a5e0702127195e625d578845ad59a2ecf8031daee8ddfc7a37b276353c50baa3dbf0e0d00bd9f1f85c62af3e2da4caf9209dd09e3ab286cba98017d46db1554fba7c825cb8431e19db18785710e5d225faa26ac34df87daadb98eeb8aa4f839f4f6c75591ce8a792a35993f7e8d43b0d0776511754d5af65245d5392e274782ebb9c4f1e84a65fcca9cfa03b0a7656353a4c68a33a6dbe97214941121543c5d943e64316e5293724e8b2b8863e1ed8e15e012b0fb59730eb17175bf2b4344dafbd8adc0f76fa26ef36fab774bf603518291f15a974796ba0653ec6c8547c517ef161d8003c967312600a65affc3524182ca2b420aafddea8e30fdf6fd3d1d836dc979ee99f79fc1bf95f5206e0b82fdf1628910afd03250b7d6de10284f62ce5277fc7c0ec94e25b4d4fa490ae33862c595dea4f82a1bb38bd5d10a782a2137d6d0ba9aebeca30f5291c705788ba4993d9a1c196684c88568c97ceccc42f5a207b5a24194c3b5350053a9fc87e0b630a0e4670a27aca7c23662d62a90c981a452b2a28559c3ce39e56383d0cd8c0c40c48191f95bccb50e184c7bc82cd5be3d433958f302f7166de8924d9fad51ae1ff26428259655d05a441e9f1b3ea52316b91be371d5c14e8d41774f9c27d262be778132ee9129de818509d6d339f51a7bc92dd542aa60f2f1c66d9f26e8368bad1256cc2d6d06faac6def98512940eeddf5dc7d1795f259409ede178687ee2b82316ad25c5c3544a409a491c068c6dfcf2c96a2539da173a07376e2c4955b024a6ce57eefd2ff441f8e8b88214e2d72d3dcacd75ad37508de9db97a320c7332ca77dd5c224a6aa9317364d8fea4ab4d3bdd978666bc4da99819ded9337d974700a7831428dd671b0c993f8030841b8a4dd63ca1fb5c8a38fa5a25577e9efc6d7d120abc5ce6de334a9cbc56ffacadc1cf3f3a0b208438a4b7cd16a3d328ed3b56d75ee6d10b69a5903e9a0d2a265685a1dad7dd9218b0b6b6734db698ddd3b5c2f480df02aa9dbdfa1022b15a2257c1aa4256fa2e7f178537cd1468a57c8b920e0008b9e9035b2118bf996b24b21e8464740049d017da1452ac4652ffde8c35ba6a756e16d59858275d25e63c21f3f8be04f2ddea0c4ac5e58490531f77a1a44569eb921c78c3796db454c3dbaceabfb725e76dda7d3ef785825015d68e22f2679dd7b79a9f30aaa097ebfd80cbbde98f0b5c1146597c9e029ddd4aa0fd8caba3b733953e2f25968719aa8bd240a238aaf3d9a44b684297facfd79f65f8c1ca5ec01d7d535a3aaa4bbc1f06df1c717ae8e3b597219b0e10729e49c4bade74e9cb5b4b2587693a3967251df310c80db874c4372360fb345d9d1c2430219eddcc4e5e49ff6af4e208c277bda873c16722f30be3c95b4a2689063f133a175aace0e2c3133f6eb270f6b9ca76bad6b47a0655fb7d1c40330242c430c35f5a192ef9190467537edd9eb072c234377a87f87aaf4eab178799ea64da8ef4ccf970787ba99365b5f3369a0846972815f3eb03b7f36ce21d29f5bde42c4d4c6a43c15fdc012d73627f359ec42f207884b11b345abce970f7e0e17401db8357f990dfc3f1f7f7f49a2e103d6befebbc516e3fa17c60cba42c739f87fee087d9efcd1a534b38cc2e6edd2d964722aa1ddcc1628f0f9b7fd34c5e4d93a42746980d451328dfd6e17c0e111018876a972c13d0fba87a91d5cdd8bb83889ddb2e510c293831f8d720ef641ec6a3300105a55c483e6b059db0329338402784fd872245a80c0b6166241c2d54d9811cd4118a6c0cf61f6646c329f4eb667ef99d76a8dbfa994d12f15cc5da7b8c32aec43ec66c110ecd727f0f45f11e13566dbf1a507ce39389514ead335b2a12627b1252b5f5634f48fabaac5addd60fdda126a43a18871afdc05bc93d24fe72c9b64deba82e3eb25ae78e083e6cd0424ba5f8cec0bb1a9bcc192e84ea8fdf7323dff8bce93fdd401426f2abc9d1bdc410fba25a614b4806aa482765d1cbe49b4652943550e0388dfc4b55d7aca2678f77954c5b3e1b476ee985a945d506b4de7cced08879d82024a44ab878f9be3a3e3ee160ff433b3cbda3c510e59a426a99d8962a9cab435b0940b19255673a3ccbe6ad47e4f4d1fb1b576ba4f9e0bd096994bafbbfd0990dc1a14dfcacf7a359b3c767aaee90d66677c3f3eca269b46efe452aa4a551e1b6a31ad6d4e24aed4e1ce5aec9b13c05319041aa2c53ddb502826370b8bec685be5a2030e1a583ad6360d7c5a7e8cded2a0dbce28eea9de268b1d8c8573c8874ede4ec0616fa5a3342dbc268e6a907a3d87e6558bff05437c88e570291035ef396aff7db2ad615dd2cdc54220bf77f41314384d35fc46885980dfe868300e9adf59df76b56d65fb76a06b3110880b9f4742c1567f14aeaa2c85e3ac2ce13a9363dd36d31ff55ef52e003fd34d0c372a1d219a33b5eaba3dd667cd9433e649342f1d817899dd0a3b331cf777fad63ba95419ab9c78012f9345f8eb0fb25fd800d20a67f25c20b9ad80861d6ac16b6b2001ad40d7eb8beb6ba817dc7e042f82a16a856442d9490c0bfa02be21ffa642504895084d2a6aa798201323035ac16b5d8c3f5d037f115a0bb80acb78ae753665cea6a743e71c8cb085d0cbfdb4092f0e991feac8640a04965df07e44e2962fd7486807bac232d34ce8f104e6854865e296ad7a4730d6ac7cd20b2db47750a02e0c687d382250250133eb3386336483967918ce98ef1244bc8135b6015a7e352675a76bd57ab2a72c232a376baf5b0ecc2c3c408e4290defb3cb2b666a350fee86330045e8bd238913359a81656d7b6bf3789116bcdaed6406ba4a84957a76d54dc4cda5432beacb1b989d46a2175ee3661bf88598fe628eaf5b491c7c93307b554aad599a800b6616bbf8e7df1988cd4b9b53dd03dad54d865af832faa61eda178e6a76c0bf494559dc3124b6e20487720f9ada7ab8162f2aaba74de12406dc2dd158d375216b87bc8b5fd6b3a00044b434e9075ede5b0fb12d833adbebf61ac40888d8735bb3803da175471cfba1af5d68c89d249419c30b40c4469ccd680e7309b60977f55e379a7cd60d1bda43745d0be2fe0196b65f8cb10172df821e025e7a8dce20753166c6c30758ba08cfefc42ee791e5e46eb80260cb008ffd96c09e2ea61775c516956d1cfa1d645d59b57a99e5a4db19003a55f578102e679944d4e9c65859d47dc73d4a48e2bb78e8cbb7c4f54f03233f024e7f0d04275e026d58ad6c3532da0cf745ae8d830b7c61ceb683c96f13ab71173bd889509b6f407ed6b4c5312c96da93dbc7ef85f3d3c1d1531dae0cd02e5bf3700a542624cd472beedaaa3b3d4eeaad7eea37aea89fda96f65bdb1cec2e7383d4f47552263eb517a192498548dfd3947184b2bf31c562d5012264256c3eeb892f99aca860ef0aefa537695db9df47f6241412845980a3199a90fafdeb91764d58453297e347458200ed95f087ae7adb92a98633e246a3e1fbdddde3d29d3e33077b05d22bbc35cc09ff1f071b9d1d5dad98cc3040ab38d58a1d0a1f57d0031ddf0ffb91c5ff62058495e05f72dfaab7eef857c3aa7a08037c9b537dd14280c07e13e50cffa6fc9c4b61b664aaa18e27d4bc156c6a163fb74fbbbaadfe4780a7a172fc30baba3e0d5134c9ec45f9eeae07eaf0764e0ce3473fceda384a1a7735776d7b4744c3baf02d130fbd99b6f075ff571d755b6551aa9b05d666e43b5af528065b4e4971135ea78323d6cda864c8ff6ab0deeb8069fd6d11e5db822aa620e8282e9a1f710b6a3d6be5facf4d0a447fdca397a46142f6f45337d1c95581461f88dfd12ec24801f0a27adc375fd218a719450e677ee8379fa1613141fcafe94d19c5484b323e40f67acc4b311e803be516936d09d22b66af16a385cc12f3e412a80006e620aed5b9ac49f7050200abcf660b2a5a535b2b5aaf69bcc4e1d3764cb1bb78ddaa2a4a742e73e94bcefe5a632f437edac38320514793bb713de813af73e7e20c56e163ff86da4ff4f978f94582da1a52c731977a63e6aa9c6343d757bbb9e9a9ad375195e0c53f43ac95583f3254502b613c4c28cfc7a1d75ba8523e61bbc61c644ce29c6532f1eb90e93c2d8727da7228492e301334cdc8638860c926fea0b500fec2e915c688e87690f5b5a3a41dc94643e359c30f349b40ed4ebd254e546803e620b614514897fa21bde05d87f6ee0a771c7a1542ce221fed4359afffeaf21b13ec29901aba6c028407dfa42211b72d36c31af2f3891411d85ca4b2078863f59cfb9ef6b49c2b5918b67860aa844f2b1ac6b7ad90667515d99683eed02274515efa46b90895f4d8bf87fc5aad6aaecdb4f4a8f5de5b147a9860efe1cdd0c46007248accc50c70e38683c79e5a7cb24621a71932ecf1d4c8d92e14e7fc205c85a0706f4cffda002de6f8c9c29434e2667ca03b0c192697af1f47e2f7d4cafcfa68660473a2d0c2c084bb0a235c10f7233b78ff74c9017e0217120ba28330fdff988fcd46131a74a274a3f226b17a3fdfff3a3890c845693b0d769d1c9411aaa296956548b9c137c9d51a2cae01f7f73f3935a1c198cc39b3c962f4a6d8bead20c1ba2751bb203234989f761e81411d84053b02350d51de82cbc6f38cbf2d0a2ceb89bb1f17153946b53049eb0b6f67811560cb9004c378f14d9cd7344f178830d9b024ca61f50c8bb31f6a6d67de7c8910fdcafe6093fe9ca1c76dbc47ba61303af27254092d455cdda3c1df039862d8f010eac230005b33171fe624008f54ba7118c74f371965e06e52e2e151a93c1ffcf0cfc4f21b6221701be26aa9ab5619031b4e17345bb27b4865d3262c1fd6fe7945ff1932a0121648f8c5482aa4fd604d2c0f707680dd5f3e9d66e43cb5e352c8a3a12d1638da7e6b1c766d6aea92c72a66062059e3a801ae49bcffec62ac6f7d1955eb537ff9c24031bda4019e614b57c0090d70fe0a512672b4715c1f3b424a8cb5151cb785532bb8a2d148572dd4684d7ad58347b5a19daf97a01f91efb2a458ede4cf544f9f0a3751d7e723fefa92eb0b7002abfa26a9a6a96510cc7064c07c039478994fdb877d94ff8523d31c968a0b575ffdae0f0a0098010c921210de515a4c3dafd74a95d5740cae79d0b52ec8da1f050d0841e2275f749a9bfea218834005f3b46534bed7f39cba5ade2337595c44bccc5b07d4d866c2d2111629ec20d8d3dc0f946aea082ff61d834b259f16b0d8fcba30b7117b41b508f752a3329f964805f5a6634915ec031bdf70d5c45f524391d34d28204f93f4e56b558f1b820d67a9a2321fd6631c11cb0ad72033c33c06e3901aa6c7a4ccc872e2befa21099670a0fcd615fb5a3983fbaef8ca6b6c3d46de9ed1db46e55455754c1ef43caf45045c2b78c8b0c16127f31dab55dbd9214697c18f08c71c4b218fadad6c635e6d919cd8e5349495785ec54d59a9bbd94741fabe54c7903ca722b20b63e5b51de988ce5d8b14489a475070a930df9e3e55f57b124e629b9cfdcf0c7fb000f34db7d86e3807446bb1a082e7075f2e06b5a0435a0bff5262f3a61eeb340def06e283770321abca1a83840ec9438fb806100a9ab2dea1ff86a8b0a0c6e6f0ecf227e5c4c18b76ddc3281913c16e4c2939b9d0be30bb70ebc14010375fa1eac8a15a708be1a56b447a5d9408781e187feadd4a265f83c36532f540a93d77a211c6886ff74e6da39b9001b93c6aaa4cd782dd3456d3cd2329520635f7b66cd55479f4b4da8d45e677be68b5464bb3174d058336e31ff5e66fa3b7c223af293405bbfb18bec2daaf115c2f4148ff31920d51368f03c05cf91fbefd604b458feca4ebfe809d2931f817fcefb1630b18a6edea7b7204fa0803c1e276fb523d7959e3e0444ae918761a198bcffd6753ae67077edeb3f09219aa82c7b5bc43b23f68ee489081634dd10fffdf503009c51a7701d9374a381d37d59effac0212657417fa19553f4be26c1aef22b699188614fb51cb0eaaaed502678fbe0ec26fb24a3df216c18b62d476706b207f87e10ebac0ac60b80ec0b5c9ae500c55f2cf48e4fe505059f537c5c2008fb0f003df6f6d7a0ebd6b0bad27a8772df5fb431bcdef595113639bd6045b53c4eeadcadbba758e111e6557fdfad8ee9ab8e62bf7218dcc6e493801d1b83c011e121deda3e909f923c4fb17165c000ab515497dd4955e3994e4daef23ad4b16c1318240cf0cc9290c55c54956f55542b964ee854b83410d5100605fe6d78140b0f489ae91544a486c8757b01bde9ae2c96c66dbaf5669caa229422452b2a2aab4da6bdd755c860add6abf1726b0acc2147512186e3a4cad2ddd5c165e66a2abd921bdb73128b377e94c00ff9c29bb073ff7687331a10184281c990a07f02a9369d6095fc3b20070ab175c1ec194cb967298b523c3d723795cbd63d4633d876e92fbca0377e88a840a11123a94118e08ea0517d8d5a696db6b0b36de5692dacfb2e4227e6d35cd3f4179c0f93621ce09b9c459e9e960de6d64906fd9d5d5864c4d0c248ee17a46fe0954b31bfbac983aada74686f7d338569c55b92538fbe5906b59aadd54bce1a89fee5ef32f5341b57fb1b46a51e14bbc99b388b9290e05329e4dec42a4933a2081220c481b6cbfab688dc7ad03eceb953c5b8be4f63493a0e85d6b1d0dca38b9ef8148021270a5dd12c193b7e85339e61ee9f06f0d9b0792a7a5af94c8da7786c2f542acd44c42f543c64b4d5e47c458749403ac2ceb70b5ed5f2e81ed190e55830bbdd04f52299a8287e9724593e3d94e1beb7f3ccae5f692fb77f1b4ebaeb51b2b308dd068f4f9e321a0dd1756a38ca694264d8b0d4fff1f858b27e710ac6cdd6cf85cf45d4cd047c9bea9c7248cacb83ae4d71935fe2257a514f66d62883bd630dd828cca3aeb2e864200e99301263aff13952997055a735ac56c88075dd05f60c76bc893223809f4728a54fcb4c4449609ce23825bb3e9a9a6dcc629387dd759c31ba51d8849c8038c7890d77b7c22764d4efd9dd4321f54bb58927a27a027b7dae0b88d268f366aa7c9f4c1a33e9abb4b94573e2af7d679e0cf462b6cda038d989c144b3c223d722a951d2ed714b78753ff47ef99f7fc0f543f6c17760993ac3ce8bfd5ebdd3b29becc0e0eb1dc5006db73a7101084f846841002b8b4bef33331eaa37b5c9dd3daddca35310d25b3716cac6ffeb8b603b01d03d2eff137c17adb586f084efed4a81f29c3effd8d6e6a50e61dce9acffefe6df95594667678b39d5f91dec4051c9cd7602aae5303d70fc7e209184949a77d65a6bb29fbe4ae910fd3576aaabb7f00717413d9335ad56fe4fcbbdc47f5e44732362bb97c1c5369747b47af1bfec8fbd5ff3e59d9534cc16adbabf010f06e2b2a055044e6b45af9f555c385d036ff8f29c01724c3ef2b2846af4905645b05fe68ba72d4e70868a3336fac86da92db209f39fac80231b29ed72b132872b8955b4bd6598978d2ff0cdcf222a909016815f051842478af5782c3f836d4370052b081f428cec2a0bb941504d8a4e9700ed639ba10476e0823c068467b2a20135543e485dc8fb06c61395a8add02267a78c6723ad82f6baf1538c737131f80f0e7c0fbfaef071a5285ac64e759bcfca8c5f485f15680deba4bc8b80ee3b48ef0ceadd7ca43670886137528f25329057cf7f99303d645074e6a6a7d4dc34dd3fd95e9ba2d1f015b53261947f9ad3840baec77d71545e0319dcde88b736b4331db4e12a3523a41498b3f4b102efb9d76f87cced2ee9829399ffde9ab05c95c2ce127d949324507c67ebfdfe9fa7ad0483f6a1e11c7e0941837c28c9b6293340a392a4b6d0cb5dff3b76c999c0e52ecb2192e7ce84f89f1529a94b3f32c9d88414bcd2f45b266062dddd8f4d898ea81544c1aecc17398e5f67b1a1dde9f42e96cf8797738b3384754530dbfc2bdb6b70591a588ec7fb460d2eb0f9b59623cd05328f6cd4377204d30026919e2b2e1a9db91969b307d6c8e51e9e9c51695631dc05f4914717a2b230b6015e35ddd6467de0cb877380b0b0aaeb556a231c905d93018aac4ddaa15220c815a2aafd2797b5f7b3f91b2bbe6bfec75613043a8b033d3acc5307f59708c5a4594d7c9a70a69444cc3d7148bde771a0b74db2d62c55e926b2f9687bf803bb801d0b4d0ab4af145f43a3f5ffe4848dbf42b892253f77748fb3c226fbe4b4db221367cc315e47c28b0e55872b2c2f6e579dd6d4c4f6a987a80eba0883234e8e2bce660e1c731c7c8ccafc670c8b23d99d8d9487b460b2690d564914bb5ec2fcb0068312c5d6e56bbba5f1b39593ec0e6c4473fca28ce030ce240f96ff4aa5c538eca346078d54503c199d88cbe78aed962d68fbfe9b5c5977e5552588a2abbd777585caaf20f2b677e6ee7583e1e96feaa3848e13eb4843212584a7710421505df67c64d41a72f720b450867332080c0de580072101eec02834244242e0b1ad6b7dd299bdb46bda346b9b97882ca4a7d30fabc5ca378b7edd14b90d68df95702ae23d3db1e0b97e95edfb855e147799213b0db75b693ee8f266c1daedf2d6956893317c774a911ab5e43299e2636601e5bd9907d9b476ca9c881cd5bbc262437b355a62c452c1a8ce3d0c5d2af5b4f1983c79911d846b77651a420c381c9dda62b669c291b49747c1c1dca329cbfa10260f53dce16bc2337e967e0b2b26aa332df4fdc9dd44b16c77e9d03c7de1732ee50e4285ca560075f0b3acc70d58c25df4368400886366cd64f9c0ef6e2475ec674d55a98e72aaa43a091b6b9310f96d88a6d202267164b6e5047e9f243c58a2a9a87c37c380081b989b752539a90f3a0f158a16b661501abbd6492bd4dcab3b9e15d0ce5754b1a986f8fd138018d395e5101e6525e155c34a6ccc48747de8c9435fb5a5ba05a2e4bf0757a82683828e9933371dd968330a3ea7d901d98cf7412a5a9f9f0474f939e5f5c62ee1948ac1c08e90a7982b808d1a630de0a5486ffb67146b91504615cd52526e95d68d312c2dda4b1419d69fb20879e771101ad2a32bf6b604007dd6c487c4d9d551cbe1f10ec846f60c3b9733f99a8f59a758084e789044bd65404619d3d72095e225d1dbd07b093b20e046fd25ecfdebb1ca098df12deec3bfeac21bc0ca651337a3b8c065babf15b07fe4f88c0493d6aa6b3224eba83197267124bc9d11066b6cae43475a3de78f01ab39c40c1b29ea2b7b3fd84261c9b4d7c014e34504ded8eaeae5589cc08301b76436ab738394bf8d4167b31b6a62d8beb1b3d194c0312b9022eba7a5e9e66c2d682628af82916291fc5cc7940e239e761faec5744e7100f6c940480111e98c6eb65da32ea2ab080b48a47f12db1727b8606e25ae79f7d799c79d9772ad9c21a688e5b7cb63d75532e01de642da0a5bf9888b7846e3673c0043c8e84f5c7bc09b344ed69b5b2c99d0565f35af3d82248de9a83556f0408987acd7a26a84dedf50abdf8dcb6d76b2b3422b0bae1a4329cc9f1bd50c17652a7a7eda39df4a5ce95efd84954614f4e10509051e86f17c5c21d88348d1c86101c948f57558160e3ec70050a020fa346048c7476f215b7c6aa2efb17033778ea472b2d086a55597ddaeebeace4269c045da0d6c0a542fb7ab466ed08e3024aa476074d270f7fa62038614ccdeee2afb87d88955d8b6f0ccdaf88acd1bd56f7b82a2386e0ceba61dce59814848cbc994c4d06d61bcbc56233d11dcfca8b36262f4b4057efbd0976d3d3659d23cf757115bc00a89bf3d44a2effc707697e5e0571dee6970e4aceeb8edb3d9899b1d4a38622319d8adf390684efcafc85918c100c61","isRememberEnabled":true,"rememberDurationInDays":0,"staticryptSaltUniqueVariableName":"302f04ab65624dcfc8b384e844909600"};

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
        