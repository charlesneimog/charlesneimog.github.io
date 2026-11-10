
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
                staticryptConfig = {"staticryptEncryptedMsgUniqueVariableName":"f569c7cbbff7943a65887ed8ace7a772e7a61f0077ff2b39abac3307dfde23d22079afe68418a0a723cbeaeb5fe3ab412694c5b0e90277ce82e996b0ee5e0f3e7926d931717f76b1b5e3c471809e82e0b2cb6078abadcffc8d931f4140f0d9005dc66eaf6b2ebd068dd6b48a246c5860c9d2969633cd6b2c09fe03316bedcaffe04b7ab9947b4ff3e2b3470988f7574ebad87971dc2e62bf71923894f802ee43435a2dffd8c8f8a013d7d1819bed961caec5fa9d20793cbee5a97fc97b22f0c855d84db617edc448f8df7aa2b94d61597bec77ef9903d6bbe8b8bbddfdac652114ab6623eebb3d6ef3f17044520c1f7cefabae42e5c21819b1599f0ef80d18a87eb86592f17b3638de028525b75ce79aba1edb94417076229014a81d99ecfb881ae5e938e3e9589b8eb79aba20bf8c25fc4ddbf4c0d67fbc92c13a2e4be6314970b6f4511e714c4031b0689c2e6b55ed3101c6b8a4a90d24159bd608cf085e109380784737d720da21581b4040818cc90bc2cedb206702c55d165edaf2f1b05d9be053b6cb30b80743dc805c9c18bb55c69d8b67903c820322f8d2fb67fb83236ff2185c009b362feaa0da21d909057e3757374ddc557a923be896b19db902a15f9e86e118d6446cfa5d2991628e385f350e4b0fdf9a44a4b8c04a6254a91c63463c465bc41b415cbac34cc949b84bddc37635c7aa7559a0212d099e6a0fb41f402eee5455035ccafedc4590c84fc4e581e4c10d5e64cddfbf44413824fbf129476977b24180e0aeb131b89dfce33b2521de10a22bb23d79d5521d33f009bca54fd1302609112fdbf17de5a4c4ffa480f68534084263403414845106621954f457116388bc71e5e8631f6572a7626b468fb396cd3c66214d31da54929a90e6074a9829473bd73ab178937e91753ead713812706550ba670be5e0f43cea2b3f3c203e24c7e11554cc505d9a3e802fe64be16299140cd2a11330da44ee8aa5be7b409bad3ba463823cbcaa1d3fa0f7ad677c01a230fb4fd4cd8695901c649e10c67bd8816c571ace943652166144d1f6bb4163649b54d58acc856763222eba075db2b0364c5355e35ad88e572733fda4377ba8ee5705df0cde256da02a5ff64283ccf801ae602cf60978d04c775f7293338d5950021ae51de41ab294e625a591260cb093086f50510ddf207d0cef83a298a9d941de1cbe4e2114ea617f0d17ae243a17bb8ae4457ab01dc6ca5468e6d7f501617c70f225cdcd1576fa8473844ecba32aa9320083e1f8c924595ec880e7731d952e342dac8daaff52ed8ffe1849fce6beb359a120536380a4ab6626585f8a8e878151818d4fd5d4402991fb3b4232d53302957d485a487822fbd2a9f59642e052ff20c8a64e81e5c5aa89e6acac778fa69cf740e2655f026598d17d0f7f50fc3673a7b7ef1e23134f198ee4ca4e3341d6159c073fe7f8a630c0668e726ddb3eedff8e74317117cd26fafbfbfd92f481fd1fbe383a76a6505b10317d2e9b57a5aea5d735673e35812442e771bdbd78712718160740202db6f92b76422d3531b3dca66d520f8ff06445ddb468484e2f26bb684cfa9e10064d1aa1002eee34ac47f015721d425336c491c9d4e533a91f6cb449d451cdac83203a7fca51da9fc8e9702d26a537f82be54fca343a183297ba28e94b87f8fc2ed2607d01ea101098e41ce1e91c6cf7ae8fa2964645ad34ebfc1b61b7d8c148df6efccf4623eed933bb38d69e92d0533c2af33db5fff1cad973758efd4f54a8bc76d8254a8218561fb6ea19dd0352c79e3dc2bcd65fe71b9c1492229f8cd7d583b4ae347b733558c681335e8158c261cc158d3bdff363826d89f22bf878fc20840ac34c3fb46ea3cd77dbe89d9183db6acf930e45f9b7ba074775548e32843d8520ee064ce04991c0b7c0ca2672fd4e1b6d860fde751948c750de726f62dc7b3b98518652eeafe532f4f70080c9521385bc9d3ccb90bd46daaae05dbfc38992815634f60951901047c0689fe808a194599330b1eb47b0f7fee4c8d0534dd2f9c75d722e22be2fd4a2a6cbc3cd908c72e4d0da7d2c2d8e26d436473b1f8b0733c7a3f6332208f0dcc3236788261036c5ef9096a8d14e3d33b4f0e7cf4d1ebfaa76ba8aa4f0e3ca4e422c0918d635046562514b2456839ae33efcf64516880e44aa2831261e570f92c4106c37a12d21d9792a441611451726cdf736e273f14d23f1c9c77618f43e12994ac4eba060ae3d84ec92deca9b3b4143b3045a4824d6441b759a96b91c8bf1e384d88cdcca6a848891bf5f2c893d3bc7eaea857a0a8d522c28785db329c6349dd317d25b655fc1aad8e0d01e9c509d62709cd4bed99d930ecfe9a2b89ad8574b42231c1d1eb137194edfac6e2bc5fbeb27b2f6042b01033b66bfa0a06d71f12c69f96f8ee5e4d7805c4b67ceb025ae16b3dc63a6d64c89e3eb968f1ef95a45f059eeedf591c726d55a5c13c00662d38a39a9512a99f0fa2ae74a584722f11cb08c65822bc668b4ff30aea1dc6cb24e3782de41d72eac75368dbf1b817e694c26edb672a7050cedc718fb4ac041c036475e858d59530ff55c83385a5dd43e009d19d0f655ffdd740de1b99a69915452cd962bc2fa34e5888e1a0af8c8f0259603f02b2982a97a0522276d55aa74d352df85fb0fec3f30ac62f4075ba63cf8e908174345d5cffb839acf95316adbc72601a12ace1a5af6f277cdfc8f5a6cf017fda22ca783cb62917142d2cad18b9fc4a239897d5f91fd19fba7f40fcd6ff5df19c6ec045686e13142bfeb3f51ff64e87c703a3eb55259e1ae70d6737d40b97722ba8a145bfc371786bcf8c41ead7d0c8580a0505e9411f951c9073b18c77556441e539b96679495c1fd4fab2b4ba053327496398844e007199dfa4f5b0ce44d9ac723cf2fdbe83cbdff6cc06a689ae389a7c9cfabc9c9490dc354ec9033830240f2d1a148e6468da6fa3fb247d01242c254bb03fd167cf3e81ed808a95ba26905228e5c6a2c06935ab77e7e6c6aa93e69c41f30c4992ec71029772ad2d12ec7a991a765869d015fe94d3d82e764f02239f728b52aca3d90a838afe1489fc7cba4b37e14fc063d8b5a894e41ef01e2a71097793067a9d4b2808162aeaff024f2d8ac72c95587b5decc94db197742ecfdbb52ccd65b4378645446c5b0fbf9efdf9bc1fb8bae2e10de0df7ac197a70cda26d55c04bca4145dd72da0efe3dfd15708d11f03ae1bb2311bffb4b03002ad75828bc82254fb4f034c986770ad2b7fecd893b5ac4abea68f09c162d60fcce8082681eb1776c25020320c9bf9d0529f241c79c1794564fb63f6224cfd6f704877d18f3c238e43046ef23d1201cce5b764cc8750033f8c28675452a77a353409828da419586ab99c480f631bebf9f52ea4a14116e0f3bf9e7dea7c0392c8965546b07ae86f354e7b78f723e37be3fa2a77ea11e40b77c9599c19c85f712cd7f037d1de5af325e805683fe547cc8c4d3e551d2dac596632d4d1595283de1a39b5f2def449c4ea26de41e56ffa9898ecc4534502f08b8c9cbdbaf819f27f8da49c8e1c9ba97e286ef33980cc9b10e2a551757e5bd29dcf623e459a859fcb54607f7b737a7cf437884f4baf6c0a70b2abe3d601b74ef6e286d524a1ffd48e7fec88e0c9f758cb3077d09f89ed6c8337e3a9fdf8c4c3534ea7b13191d4f0f55e3f44f52edd999aec3361b856a2f24c370924857022fcabe0cc1d72c043ab5a74e08421765c8609945ebd91de87a204ec9be1edd4cf1c95df1338c57a6c0c72450be5d949bf6483364b66e9f23d1567418e4424be03b808fbe96e9e1dde01cf35598d772ed0804be45c4824550d07f82fb581c2ad58d934b823086dd42916a6ed94cca2a0a80425eb52d25215427171e55b2137109b02e73e523b64657239cbb78e5b0d71fd21742d0ba1c300f0e77d9106687a782f224db467c55cd91770a81b98fe9d880c67696f54c2463413149577293cbaaf385d3161468fc4f1c9acec3aa00bc109822e6260482ed54d1844408865419b2a4e90ac10a05d7db363baf217d2a7f0e35e75f5086a93c21dc48a9ee996bced42ffff6765904a45a9d9711cb331c8e0d7c325663bbf821c82ca452bb55224624e5f6a471eec570793baad45d77604947d1d0efacb2e1c7f9c498d24ff0c28423b739e6d1419c22eeb5b08c1745ea106f28cb9b4aa1b516c82f2617bee11ba891556b2f44d0d765a62989284b184e90c62d1e2e91d6b74eb054943bd752520d484b2523dfd011a99ab999adcba076fade4cbc3479c6d31d0ef7e2cea95a926e275b7fb4e6d4b9d1bb7f002d239b1c8a4fdd4d49287053990ed52130491cfb7eb52d2f1f8c35d379cb0801ff3bdcc66d4b863551b6c3d99923eab51a9611f6ac025335e39162480c4f3a3a90c0634ed6e2815a9602caca0bc66ee65df1419519714bb700976a437fddd85378146446763fe885075aa04c8c1f7ce87b2d76588789c1030b5e69f3dbef38f8375bd5e6eedb7f819c718bf60b89a6695862f286db25b166f9fbc063982128032564fb3c624f500b3e39ee51f685363699ff1bc12058893ac42a2d6024bf221020a40ead27c012e7102b0f3a44afec7cec0bfb01dbef1a0092a24e3459740d35a137dbeaf66853a40e6b4954d8e7374590f37b0b40fb87085e3a78ad8a1fbe7515bf23a0784b5fb8e85867d22008956d375b739659839ee5ae93d5a8544a755d4512f6bd0d2cdf93d3e2b58bccba714c7f3626659f37dff725fb16a961589845b6860b46d1c4791bf89426925450b1aee5a6ebca6e8bad14bb686633aab10e36b72c3008f0c02a70fbfae8e314dd9df11edc64562b1bd3ec7efaacac60f823997a92629862ee7dc9d811cbaeb2908986aa5c969efd3992aced86b806b027d383706f38956b9dffcafc976b776a25adadea882445c9541d227fb482025fdfd72b43fa54141039b7b5796bbca4ca92757729190c7a549a82d5ef62a868b4eb16b1305a5a0b4ad2c51e4bed5ab1d52bd79de3f7e70792fa1b4132e38a4e546f4c95976908e3afc3dd23b0b0e3d2b1d747b9a834b585af7295601483965e8289593001459a345c201da1b317c02237f9d3cea5c7b66cf4e44735c0024a0166b0f553c099d8fb8645faaa79ff4dc37e7ec0036e826939e79cac6a82e824b0354a8695e8def78b5624f379e67bb8feab60c0f723ca5490ad0b9839d84d9f680dbee8d2eb9fae0dfab064ce429d71a5f51905ac8efec2c2a3b808843b7c0769e4789b00cdac046247ea416daad2faa5463414dcb89b4f9815c47cf7e637535066abdb67d98f4c940ebdb8a94b4a08b0790b67457ba9e50c3354ac8b0b69c3296b8dc46f9b33eb22f0a9725f56bd764c00d309aac3fdf343b78f45c7f85604baa09d4ad5b624b4a6767c65fd9f4cde38c3bbf0e2ca248c2f152823ab3e627dc3759103bc242d0023236bd17f05e3e1b913b51b128d3074389a564c3e50aa1ebb507109f81a6bf04192fe2bf31d75e178f2b37c032b13fa41ec36dfe64c506352ed0356aece7e6093535f3ac1607247cf5847b3ac73bfcf40eeeb85167bde3092dea42e90fbec8c51e85e73d572199ea8612e29771d2c560806d5c8d1e2b7ca243d00d5dd263cbe272f6ece4a698f3a8cf1c5121743bbbb76687203a00b2f82bbc7af1381d9e4bf0e09081275872c7704614f9f10108341c69b6d5d57fc96e383150cbe4219716a56a8e72c0b14438f216aa46faed2028a6e4bbb9e8a84384c4f2ca862b50355fc07a0ce209e2c49c6b724b231d282e92f27a278cb30c0c1a4cea9122219940c6a3e788370111ed3b09b908ac11b0c61cfed42556a2d6a61c124d847dd3a32fd5dea51bb05f33437e54758a541492c7b56d9d701b1539d8afade92bc057590ea9db2e2a55ed36b0f459e71dafa6d1d740b83613298bf6f6bd5ff3e5c4e34321db4dcbf5d2b6de17547d65555ff11518312c1d698cfa33774012c7de032a9c9173d05d239e87039191beb0e75c989e8f39491ab2edb5c5e43b8c13339d56f2b3f6877b1e4d0ebd64fd38fdd4eec99bc6eac7cac1b4b0427feb936520c5702704ca9c0532f8099319a7c9fe00b9df40de702d6132e0a9d6ff3e5627b9b12841e2c4ff449903ca70c5c29dd4ca33356d2207fdab25aaca16b1fc787e6543d33b8d557fd7f4cc9b32dfbd8c5afa6accac594ab379e0f2843233060dfd8ddad458686133962989c8b39d09f7b40323b9b7c85d0794e286d58ba3aee4b295bead796bd17c0814528bceef8f6d2414023f3662255e041defdc74289862ca5e39cd770724873e03a739035c3679b612584656f795aecd5ab227baa2604ed9fa9b00992661dfeade1cee732290d8acbe03567d40dfb0069177a720808d4cb1e8f3155a5a02cd7e759da2507283ff588afcef4f261918dab8df62ac3ba969bcdb2e74d57187f25cd99de0407fbb468d2630ce91f04657e389114767fbb5ed946c3bd706d3e2fac047a647a257330684bf19bedb86593e3aa5316fbfaadd0e84e6d2d31954534083feb741595d28d663ed1c49d47608e175a4b8085e16d32c2a2b53e7a3a3058b99972a8134809790962c42bfb2549ccf9a5f35a39608c65e5c569f1d65362955e494ab606dac9528c9b345b89698d54184d72f7aa39eb1844ef7327737bb680761a542e6b273949d1b225868361b3384ba6a83d70c9ccb3ce16ea4a773864de90a464aa68a890df6ac7cb06d67e225161cf092c7929bd55d6257d4592f76289d365584673de437ec013b55ce81b460f0c57989252dcc882b8ebdf0b17843e0ff82938583aca66495458b9435fa23e90bfeaca046335b372635221b73c1122f06addd4abb59d9b61bc8ccecf4d2c81a219c00fdc6a7f6338408e34f0ad38d313fbcd71fe5ecada53c374c439fcb731d00945fddbc3be8017208c39e0e882dd23a6e2f8de74646a89ecf91ca166dd092be790e4167be0bc1c612aee4650d894d6c65f576a1e5fe32d21bdf7bf3fedb93ce57d5d888266251970aa928764e373fcc0252cfa379ffac0ec036e462402b2ffac1a8951140a9035f21f9bed88bd3c34c7def4322bb21308e5b6701fe1940a1d7af0761cadda1d54d39ee701ef883b051f86e583123d0fd9074ae270eefefb9baf98b3b9acd2467c3f8366ed8a98e2d8a07fa42c011b9478c50756cbaf68cd4ae9b4f01fc9a56cf0bc2e04ec7ada77cb329982e7d3af40490a53ac15748da6d98a37bfc3732d3e15b4c7cc7c650542bf102107e56ec91b68e92c90eb1d61dd692412fc29604ef722591b615929276960a04e93448590fdf2483ce1e987a9eaec47798f8919e72fb5e33af05236dcb2f43c4b07fc204621a6e1f1d141e03ed161687b1c3d6512c60de25255fcb3d1ba2e5554b54d7c6451c813b147fed2a0cd586312ce4516340ba4b82c8c603b2832dd9279ff8615cad7e3d52d6f8dc0972eb5aadbf416a3bdd8cc675afc8c21b939ee2e83051eed0b424ade93efadf067792757d6bb21b4c7215ea950f0ca88738e32c7798e8f89ac98dc2423f28ed1e59db9d58940fb355c85c1af4bf3c897087d696ba17e21da47710af03b53416e4d269e7d6f1c13a7ce0d931ba04272e361191d6516b770a62765ee886b70cffafdd5220bba96bef871bf44732f6b2222306b21c491a7b117f43e1c3bd1205e218898f6451176eae25078dee856e429f2f9cc2081693f797efa07b98883515dab06b18f4c8e4ac6deed8c35e44fc2f74217de0aab4ef3818ac2ea60e964e07182af588f3b2ebfc8f061b7454558621b4551354599b117dc149370b88be5e8d6e94fa7d059c26c1a605cbfc1a41b9b0ec07eb9636982a9abb01c547a0f73c4b99a6f6a90497c749ed09e47f145c1a08010145f31a83ec780ab9612f098374cd355d1c0853c569c3c585dada83155f060125c3512a3b90982cbc1089ac455d860dbffeea81ec6c32b92203521875574b94e5ba991909c9ac0317c706db9f9c5144435df7ce4756a1688d04fa141bd7cdd7cfa054b7f01b33b611166400fb8b75ccfbe0b5cdeed7ce93af68667f01b60f23d2ebe678ee98dfa11d14cd1f7da635239c054ed3920e24bb1d6297a138635f47b6006ca60bab22d9d1146ff388942a5cda7c2fab2c40355dbff73b8a6b8629f55fe266827b1aa2f4bd544d45fbee8afe6cb7876e79be472580e438f6202159bb4099211ce1d7ec65b2350e9e8f2149d6ba6dfd13597c322c1d8cccb35a8c59796d4d8c419169d1d090226983631e7bc834af01ce378bc504d275372015c2cbd4d3948cdb882d3bfade75f7d1fd99a5d70c010b5e17573791d07079ce222092e514fd512f5840d7c5f563a4a20331d70714456d8128ce55c1fa29b578bbf316b5f24a577cf53773e3fad31ee64702ea7528ce1f8ab0f992f68b56fd0f32a079c7f78297a1b257b6428063a09679aeed00d86224c76b87b0f2b28c2dd62dbe3fff210a5689d7d1cabb9b15a75e65a67b96fd7288c4363566f36605708a2185d39998d9bf06075c46cf81bb5570db7a36263051219dba95b843f048cc4aa072499d119e62d18fe937d5d177998e125526896cd03b8ea8bc163ffaa4128895f9e40e6aaf7e15e9446ac2b250860081083e30c4550dcf38a8e583a8ce1c4e4ac77f62c2924826b254366737d1fb05f5789db693d91fbc23cf780ad35e7bd75d5d724b1761cb6b680648751aa418ab41d19c63417783116c8daed7ffee69c721c8c2673783c8df98e754da1c05db68e97bad236edd7b967f8114913b8cee881b5460eaeea8e024b320480a481ac9ee37f222d3742855c83d4d418e26f68b95b6aa5b80869853c4313b1e22725b2c96ad1b26d8ce790cffae749c06383038f29fc8c58963e55354eb08496817525d70e9d8df436ecafd7f065ef753a04c7509dcada8298421d3566e0dc52a85ae0b517ac14d0036ff5d5033f3b6e691658b1734bed802bf82d7769a25565cb49c0ca9c037e9e98015649c4411a7dc782de9228cce5f44bc2f3235d62e70793b955c7ce9cbdecfdeffe5787fd1db74b168b0103b60e019f180b37a0734b617d24d8e8c7324432f7b590bac2601aef54fee9d6036502e9d5d49c8eeaf4d489af7dc3093827c80e843d8c01fb145da73f8681285d0903e1b4cc147cdc40209d3edfa99ab9db70a8f8a0dc1b9079295e6b058434d92ba0d87fe10e0ba8652381f76fb6615b3c9ffe952451ad061d4adefab474870a18792af74515299e82613dbd57a4fa06a29a22b64b7f6e1d8955a3340c14cbc2a971734e8bae9850907d3018d986c0a4ecc83f0a9508bbaca9b81d7b542c3bb50e82ed435df63a0f2669518b00d6c7e6a8e559b498e1e528841ab4508786739919ea7d5d13e0a51bb09c569f751d1a8df5fcf2c3da0ca0286ec22ea7e913f25f56fdadb2b89f3e9bc067ce3f390cb18388fa2bcee44e608aaec7c0bff68197886d295196740f8324be9d14672eeaeb551fcaf4f3bb4735df19101fad726b13a8fd7a83c0ec614110c4a96d3f213c584c9e56de45cbf1426728d536389404a030a1a9a28492d21c676d7c73ab658cb38a35ba51d87f1e8d58d437cff536be741e17cdaa13087be7c739fc111af02a6f871a8b0848372a2fef961abf2242851a68abc90ff1e928fe41b0c9d1caeeb2c15a613cbf115b78b7974eb6603277f5f6606275563044e25bc555b8b1cf460e05f975bfeee5094cfdafc4ec56ff802ee3af14d39638c369b7f17c353bffa9d7727da92e2e4b353b9714e6e7ad68d8c174d64d2db561fd91f1578f838a89bc7218828dc9b2e84d07dca1a01afcb4300ef70567ac89663739ff14ae62b8a8604543917160a5cc4fe5981e489e73a20946d3f3b8ec107f033ce96c87ce40992f91ee24258d0d1c32edb7f1f0f1aac28c47811148047a198277ef87740789b55da4599cd8c7eaadb504183c39cc6ce246c5a085d432a7e4892262ce8acaae77f8f2e2cd9e726c811ed66e19e10eeaec8e0bcc46cccef9d2e9aecc5d66f64f7e4eb2dde1c97948902c2160c0c469d71640f4e144a173a711564a2632e50666d68e1fa6512a22db194b96eeaeba8d434eab2dc6ea3550ea7c368eebceb780478edbc2b6553e32c7432ce68946e6c230e2f2cebf4309d942f0c92e9ede70ae5547240840f5d41db7ccd9c54bef181ca92af934259359210288ea4e2a60c50eb94ab2cc81d9627c8dcd4a94ee2f32daf0d0fefe9cb5547b8bdbb76a02f7297801f3cefa0c547d451218e53ffa6821faed1eefb8a2f6f9f4df91d20f527cbfbe7a98d2230a23d290e49f32002a22ab4cfa51387ca7ccc0026e191a014784b26e7e55390c35aa8768c217d9f06a9110ec9e6c609f397a1e9f55400ad60f0654885bddb84ed0036af405c9230db08a9fe6519cf74a09cc0462fd9aa2d6798875aca9ce9f90be749899c752413da105d9f7ee2d0cf14f09ee19d8784737ca227172fa784925d08cd4f6eb6a71d070d38f19b3548903a172af3fadf9cbb3ad15991899ceb8c98a05cfa86edede53c2d4b0c0a879823ef6e9ac51b19897b738f57236f50dcb2a5077433abea7d73bcb3c65a1e14dd5b275ebb3e2d2f6cb8fe7deac069ddeeb2c66a72d381b34cd0d1c354a4a6e85052f0e5a62239227ce86774f5037005f15b1942c8a556a81042a2f4538de87fcfc381843bed133a4b4d71cc2d7d9f0b22149e591adc58fdf02687df6ff75b2b8aa33e50ac7b382472f010fd1014716b5138ad60512642bb6457b4e21176974a606e53567926d5b956331f5ffa3bc23e73f66a0818d2cdaecdf40930469b89a46f6e224dd9a6c8205b2c7b68aea93840ba3761b4d0fcd0035de9d9414b9e639e06a88ffd362cfe188a4cbb0ef0bbe1d70ba9f741bf2565fd17245561f7a58171fce36510d4e374d8c08815e7ec870f7d8537847c51bc6bdc7ef351b8286e0b94bd3ad20dbbbd4b31ec516cd65d4fb25f19cb2922d89b9198d4f75601a28aa868a9b897851db41eeddcc42b9f4fe0fe70666ce7f06060809907880c522134e0d","isRememberEnabled":true,"rememberDurationInDays":0,"staticryptSaltUniqueVariableName":"302f04ab65624dcfc8b384e844909600"};

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
        