
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
                staticryptConfig = {"staticryptEncryptedMsgUniqueVariableName":"cff4d92df495a31bdaa726b6e980322e3d605bb7944e1d5efb6c2495880cf06b9ecf7382c54f6579075f1db87c392a51b74403958a9f65286b26ff3012840d5af6fa9c5e7138065dca15c71850d2a819dd2408319c7fdedab363d7a223120fcc79cc2705d29149ffd661b2f0f33ab415991a7b40cda752c89895f63fb2fe640c2de28e6a654d5ae751d4b93c1cf998d704a912ea470692470183a6417fdeaeb5e7308ab8d6f0d9942dce92df417489be3cfdeac041d95d8d70d45e0a8d12a8cb43e031896a6952b2db6172e0c8373d82873c9bd610c9c7fe6caf1bd1559a7e28d2ecbf14a4a9114b9ff43dee932fe017d07eb3550e16d39c9bf2c683ef61eddd1f14b69234d16a58b1615c3cc5e0eeafd2b5e4e737acaf05c2613e75edc137068950a18bcd9884527ea048bdbd037962b4cfc73ce9776b5de7bc7f7716f030251c1bd6d86e0463adce27b3fb453ceebc6a483ea24265cd6241bddadb049bc14c4c1c53d3c8ea93472d660f9dfaae91d2af8d8e2b7fb097d49e0ce36900e59d0daf795c8e2b6d48a9e7c24fe3cce8e19456464895a959b19c3eb0b332e7dc4d254e72c7f472a3a9d3c3d962d1fd9098818e4a224e1d2272428453abd44af83d5d912fed4faafe724b87bc7476d9f62ef6c97dc99b5e0bbc7b258a9dab8ecf928eabe892a6225653337ae2146f5a34972b9de65f8a458cd7d2db3d6021603d0c16865811961f64c1a7a37065193a500f750e5909bf2f88e9b136cc40874d633e6a54451c4deb386ec6e5e3c0c4515608e69a26511f471543bd503e5723d4598fb4ca8dcc7f6f618f949518075657eb3bd862b66193db0669dae45c198476527e767ca8846d994d85a841fcf90e47cc0c5619d9dab68ef5b72e9a9e1842ef589335e78405b9f82852b2a50f72c7dc0fd94d25d8eb6d0a4d3969d23976c110cca93e856dc57d6cf03ddc9fb9e5554331b78a12ef324c44ef69a5728434c3faa52246d64bc1b9f91c82d643d4d3f3c769e097633dcfc52523dce0ad645ca33cfef73d81bea757274cd0ea28f9c8ce6b41fe95eb51a5bd26b99f6e883dc4028bfdbddfb0e66449b5263b7c52ed5b2e6b7d34f11efaaa39f6f3886b53ab3f3a48353a8fb030bb3bf91461706a06802a1d7c89fb0bef5520d93e1aa3fc86b6049a45434c4ca13b7da49ab03c306257a8bfd281e2ecbe7d2f3d5e01a0238329474b179b813e99c6c5304c763bb6747c709ee2bea30bf646fac9dcb5a3e37c90d1a4e346de49f4290eafd570c2f7569256193ec4743c92d9ffedf1443d315da7df1d531c9ba38eb4817af719bf7cbe909ef3e2706267dda3fbe543231e0eea57bfe21412dd9752a32aa1278c31df2e2828b9cd01a6a763455fbad2ea918cfe24891b204085e215d7ee012c28681d7348c1f5c6f0e531c09198823f4352246cb33956b2ff1434088d1abc6742492f6dde440400164dbc4c3f4f7164d7fe9ccf394424b3a94341204cf997242b3c81ad4f35c4cdc17540046d4fce7395f238ff6e3cecbb522e5b4640f60ba18dd03e69765ab6035375b20533e018da098d1771b0de5110667a1b3445b8779bd5c5d00dcebb605cf697625496f453b509f9ae5a4bdac7b6a43b286999bff20bf8ccc64660d10f455a79a9c1800ee1695abf1175424f988979e7ec06c74faf3629c50ef7da872b9783c1ab681e9e2e2b48fe970855af77371ae02f2ded7748b63e6d58e8953b6ab30a7eb00eca1aee30661e5066d9e2b11c799c138f36e70fa67b35c2e835133419460f8c912330410d825d9eb8863cb7e9fcf70f8bbb448803cc9a81817ad247ae89fca7e863cfebf6efc614e35928bc4f2b9512c82b451f7e5a2a0b85a198974beafa3d8edd17948519020439d4a35db818b1f838df163e0967c3540e6983ce56e66106acc45f35e742e0304c0b3582baa4a9a8ad1f9cfd2562d366739234ddb984092c9c3a3806753863680d42a076149f8128ac6d3281c56392d858ef2279d02cc79a1c9214bc46617784a6380c746950ce149221c68dd45f9f2dc800133376f5aeb46fc3583a852baa0675ef38dec5fd5162409b105a322ba00b99976a75163b7edc0c6fae387277622ea02dcda1058dfe0f524c22c4f6bfa2f7e9fa42e56d70a86b9a4b376dc94542d4dfe716f9d28f8bf26fad1f12507dcbada09867729ec8eccc4822483dd0b6a3e415231641a91b7fd6405bbba3266711cf42e093f7acaa1b9085e3fb24103112ec7776c532d9bbcf20b8bf9d622aecc1336d3e63fd5e67d6230492ae3f17443303c2f8544e37fe3c8b555412c492214643f7d8cda56e8c48d1ff1bb5bac0695ca915d38fa7fca695ac2e20d336e88e5372278fd3c4d319f1b241b520229299fd726ff489b2488c54f1cb1abad491c6cc0c31a8800719ac643b5dc5952c9e666df2f47726a4e3a1a0dbcf0013753ead48e47008d7e52eaee93d792e6a5763b17f847db4ae672ce9f5eb475a4f8c8f2e574dab79297c9b67315231d0b4828e361efc3899840816253ef4ed78afc921ac3cdbe481e999100a45ab6eafe5357f0a90c58f517a1a07bd9869f75d8d75f0f5fc48281fc188e029393fe9f421864724bc55efc3f5b2dce4bf6982bdc472a8ef80d7e93e32a88fe1aba54a004092714f3e070cd9e79d53d6bd3208ddadf071d044d4a80bdf1a1d7279b33492fc965f6ad6fba33ad19ae943a165368e623e3eb81d891e1235f646074890f2556df9712f312802fc979d7ae4df785197b76544406f94922a8650db98c257d6bfe41cb8e25aaeb6e19b69928341985bf4e0a90ae38d9943b6f03d3b1f8dcad428831f9a8bb3ee5917689cd5b7d15aaf8187a1d374259fc2fc4190c7dd141bc1341ff616fc8439b21e7d09b4543bd9a48decb43dfcf6c5fc600cbaac7c80e8c4d3f17b8e3d8061c774b15db5f152cac9337666fa7981d62048b873566cde6ec8f49277242a3839bec64d1045b4f9c61a10d90c0e0c1e16e2534afff5bf724eff1acec9b39ef764a34b4ea95bb4765c97d699da6607e21b44445ebb3033473296e3f5c50c8777339fbf0138d843b44b6363e125f6570c4a6c7919eadf05dc82070e3df86e5010598bf0eace8a07196ea99fc49024d14f26aab7278fa7d13a1c9e24e76cfe9479e8e957972a8c655f52ebfdc93e66478db214bea4a177aed0d8de5c0d3263532e3ecde2638b52d1d333d0e39845a17a6c6a5079c0e551cf4357b45cf8b2218c287be8f105ffd446c0e24f73607f532abbaceeffba98ac568a497ac5ab0233528c54f9017c3b6e245e5615ab2d1cec98583d24448b44df1f73719b34a17da3c7e740964dcd84bb78db49583ec53b429df69cf907cce77e1419d2017b11a35f36a94e1e2419abce66e900d3c9812053098dcedc2874c0bd6950285982e57640afbed38d53082ed8e9e9b2144d8baa5a979d5262fc602e42ee2ceb5c92930f1d39c8831f5cc9850ae7ba898d8ccfb3fa171cf800ef43ae4a0cf64cd5267994bac1f2d784cde70572ba5667abbb40db4dfc420642496c381cfe48a732421b3cb069a08c68ed3a015b55ebb990f754bdf89d7aeccef3e7c0225c38fab1c1b9062f3b47184e55ef1e0c156ccfbfb511f37029468728b472f672ecc8890a6da1f8081518efc67931f8f3a9524c13f2dd74ca5ffaaad4d40f4fc690a0af38244c495b1cba55f6b1d8dae60c5c34fe7934e69c1b46823c971144d545a628f94d76367402ebbfb15f34694d64dfde181b921fe93a545934742a9b3665019bc5391e6d2ad7178b7866e5536b1db11e9e548589a0c1ea9cdce6e0e731f93d9e76a821b149e21b2099292c81611b774137f9f571ec8d60ff846f4d198075d1bf5cfd8a3dc1c9afe1b3ab1908341428cbb42a7fe94446a6266bf388f068b9bb24d841c705d553da35bc3c76c05daa58d8b0145c3cc90a0e78ccdb5ddcbe37cb4e173e8d21f27abe8fd24524f20e60fb0a6749a71f83937a5fc8fe15fedffd5f05f6cbe2f7e2cac4d02b4dcb3d1cf920086e9ecce38489b88b5fc85dbe4825485e0dd55c4af0142963910fce06513c63070623e3dd1fd5bdd65d599e8f1b8cfb4490b19e9f3f27b1af99da2d6fa5b9efdc514d0aa0315c24f6ab5abf05c45f2089b3237e9db72ac4a7e9165b41e767affb729b7cc44ffc378178d428e0f9c36ef5b4836965742b867eace4149efd74478f4dcf6356074a25625ffb4d3492137a9d3155851d14d43c86907a988417d833912de3c4b32e66b504c7f690117ff2e52ca3eeee1a850142c346c9584aeeb65f2a42f82c092743429a7de4fbb597fcc739fdeac9a99fa0467915f57bdf88eacb88d5e6803894535aef47a77de6f553f44cb14929043cf4036a7b2a64ce6e3dc4e36b410cd17f1cc96077dd31db77964141e8877f299b1eb545aca776f7604af1eae36f76bd722ae7eaea4b90e5f0c4edc6e8ba7cd6c229eb43a13251481b508d7ca953b951cd25ef78b7ead3014a1f786b70e21fd1fd80a774a8dee3df5fcada6afcd37a9930660e038c2a763b9e83633f980f2dcf1dccea9a94932a5656bc0eb982a68c3e31646d4fbc76f2debaf31aca44be8a01b8431d184b9d6d779ae0875089e36eaa17d31a1ee714c5e099adae2faeb02337cab88300d58304ad84ac6503d8672029be447912cabb252456612f0811afde5506500379a914069ec5fd06d685ab889838b1b7adedd1c12e96701f781d314cb5ef74fdfd864bb6c10854c72287639b6eb0c9dcc6959be96c4f850ef3bb035c4e1f0f931e5af9295f51b9c6914f30635d24c6c1f6444c476e840013ea0ece0335f73cf5f3b47707e3c672a4fec5acd1b4561471f6839865d5a04070c9663815ec010b5a9661acc132b18b20ab89a71326815f483304dacd3f4bb3c48bcbe71450cba414ddd829244bcf02e63293c97ad1f4bb1b43bc90e12abf279adf5dd71d90924ddaf5cbbcd4f96feaa2bf7bee534f6535f5a2353097cc09322445d509429d2d60940f0fdbe58329d821e7047bf9edf751d8dd0277fdfb062213a1cf4311bdeb6367ff1a4386ee1595ae37b43b712b4ff38688ef454e26b39609db2ca891c82baaac2b057463182b3413e56fdc91185c03b82deb4311c80973093bfd48615ef3d21d2b0456bc573231bf4932a548c01bb5c379fe14144791205fd27bfb84d8fdcb7207b1acfbed16ef078290c626efbdd7bf6135b929dcee4727ef87fffe82ea5aa98eb8dbf758ee597844d695b159a5dc163d24b34aceb0dcf5beab1ff8668a69897d68b289b42286f4bb24990114a3be9a91082c206abc564521ba7b7672d75da974aedd35d340e7138a57b331b1c66fbf4224677fa839d961214b5ba4a0c4f79938068a944b9d70f72934a06f4cf943ba3b0a28af07ef0974daf5aa4c47fb5ca36c82341e9686b1036b8272bdb89a93dc93ebef115bef815ffcce59cd9a242c84dca038a341f0170ffb3b07b2715e4f6b80a5eb0e6cce37606832fa460612a234c042ce214bfbc5d7e73f00a7c5d4cd732d32e9f17404d8d57b1a2ead0f02095f376a283064cfb798265752c0a7462675f7147f94e93aa6364c8a6e210e1b746be9128563c04fdadad7ea52770f568a4c33262d350ceff9470050c5fff5ce84ecfb87c54d6a9a10411e6fcd6b7da275e9df6c14d751e23758d3b9c7a36819ba746d6396e24eee045fe4f4634e0e76b3c751c25571b3a7bbed99c8a211c9c25384033c6563794f96052a18ea717a788fb6a84f7bb0a12473452d2100386630e4c2472ef56629e27f0267383bdd893f010a613a0a5fff5159e79f63ae721d294e06b8eb919367dc29aa6688036482c9a445610555a2ec5121d98072fb60ba74e7e5e67b68a7737a645ee51177e84adee83678e3f533739dadd3d4966ab3f8d3fa510fd792203e8ecbfa432400585da3cb38dda73d4ec59572032afb7a5f5dbaa391e8452ff94278f94048d3625204b676b202cafca7b2d749df2880f7c071bf0e77509211fae1fc4fea2eff65e979ee93f8545193d82fc5f4145da8c79db60bf4acfd7818bca55401afaaa4bb183f1b759f178ae02452c4e8383d222c53a2f443e2dfa0aa9751f5ec2e284a7595d330ecc63de1c54871ff534b4902927011ac0086817f2282ddfe67a07674d3d130a033585149cbc7844120bd6a5a4996aa8592f0a894d639a3ddd23c5ff770079ff021d3a6124f33f0aae759f759919758aa1accf035b2c5850dfe62d4b0bf9c09048ea9b8370e21e98ecb118d525013d625d435108c7a41420df54e4f65841c93c5c66effe9b759fb505c858a214a22c551286c2db4ad03b81145cbb5c85e89cda3761f4de1d57f1bad156d60260f39c173eaa8d8954a20d3436d64c879f8e314e013cc27bebcc8b42b999d70d5b2e82661e950590ba88314033eb8eed7916a003bd4e160caf6e293cd631568d8733d244a2db3ce76859602a634adb7aa1692c523a0587bad0f4528f359ed6eb212ad80d39d166b901cd1da700bd3c120b0f931d3697eb2dbfeabf126c1b8553a943321c33c3e72a74d7e062b5ea61b7519c122e25ce1563b76c874f2df43b1920759d6a4cb98bcae69628c47295df6948020497b609328a489fedc8e9f50aff40435290d156cad1641ae3e3bb5c0f98de7f9dcbebba2dd4db108a7cbaeac483d83fa2f56279e050ed45746a090cb55a86de3455c9f84901182918f9f80f47fdde762b909281fe4b0e305e4e1a42576c533cef86c9ea2deec339d96ea361ae900a6be0366557d877a14b597887f5223ba3d45e5ac79ff48e53b71c343b4821ed439f47906c8eb8c02f6d3f6e70478f8548c4abea2f7a1c02ffaeffb15b4df778302819d36920e6c863ebfb9a41d9b4018604711011129151e287300c4bc2233117bc66ff5b56b534bb9b37cb91f32e7fc35826891f74a17fa3de1910d0863918592de790afacbc558161f500bd051728f9d8bcb8cfa15cb9909f491afede35116e9422289078707d973a1f546947179812bb9566a3769c92ed024a977ee1edd974b6144f11b80dfb23b607b2a24df212bf680a5616ba9c81838edea3e23fb0cbc4f6e4e47f58a0c337f608be05b8419520ebf723c0bb7705262d6ba3f79d0fadc666975021c130cf1b4c1385cf74fe814fbeabffb3ee62f75d0477030526822a955877f65144c481ad3df3bf8824642380710cc9f8a74e175d79c88b6fca8cd1fc50b440b505ec499fcfb6409acc206961cde05d780d2c5cc5109a18fa1f9f88199798f6c81480a65d2f5b76357551b5088c6fc141ac56d7a52ec66b1b1f99a599738dcee6a92e624e4824b5e40336b2573e5511a738c13a09f1e47c44b97591b885c72fd7deb9230aefa4502a0009e49b0090e8ad5b6be16f77ec33873ee2678e84936997986aee067c26299cc5fe476db64e2010ca3ef414a05f36c58cd5c764e7fa6835b56428a73620e554e8bf1f0d43303267d88af7fabef330654d16864544a6f316cf33ba8ae7336dc7906a928231c516eb50887e724c6a4e4edae3d77ae5d05edb29811c54f8cec83148e41ca5855edcc9b702f0a44e1758a8d83cca60862954096ef81f4d1713689ecb48a351d5bf62e4efe28f4467a10ca0f41b0245c3606489deda5d5ce014a2aec7fc17ee122cac5a2ac3adfd8079d41bbb940f4599e1cca4ed59d6028a2053e3838c169250e7f323a51cad805a9f2cc426079cb36bfd0fd35c143eefc466d0d02502f91a1fb1ae0a7e2da44b9752373337dcf16862f814e6c4550f5db17f33ba87507c88469eb6d1d2296677d15a63f05d95dd5dfdff1c1ee6891af352eff2625e1b15d8be453a95d7e85fb98979a0aeb5a4cfec6f8a5428a918eed2eec299069ca9056c558095ff22b8615086ea199eb6168ee050a90e523b57514111f79d7d75870c5ad079c73433eed1106f738e4bb603b72324d30cd56c1ea0d0d8964f657374af71fee53159c6e5b55ccb3b373fb408a8bedf2743455ce3d4e0f5ca6779fee852d901e6128a8c3913b946a0fe0790c7f0dc9f2ea2eaf87f1457501499ac6a0b7390fa757e9dbabdf7c23253afc1c4e71c9b66bf6be042318c159c4340349ac1786466e07834dfd3cd300935a0cbb7caad90771eb8dfc51e1c92d767ade3679592e6730bf59adfa800d7ce0db61068069c466c43e956ec74d3edbcc716886bee93c82b12ee42b7772f4ae33f6251f64aa7afd554720b1e73e7e8320c37a010e5dac70a3b94cdf2eab7a776cf28a5d2f17e2d6c894d2f99d425683d1be60d2b3cd29d0b3e45d6d77103cb4087fcaec37bd6a1c51f7bb7807a3ddccd28c3af93b1618b3fc5a81d02d5ccea516b0bf12c8ac385f98af310f4d12882117987d95f7dad523ac91431ad295aad8388534db1d8c47b65f9a1c13ce81f6e827781d20cf5226f600548bc88bae7eac71888e89614492811b048658443abdacbe62e854f364b28fe7d4042509a9b91f9b95c0b7aeb74543e52817a465019154e432fc4e19b2d0c60007dfcc297b04f37ecbec9db6d2c50063249e42e5faeda04f969c3f66e506640ad2b1173b42eefba750960dfe8fc23f4e2a85b4519045101eacfea79dc7675c95c86adc68cc2ee689c7d62bbc19f8cc884d0bfadb476e04dd3071c4e99189ab80a4708da07c36702a8a67d84674caedde1d10a8258546829ac044b3cc04697ffc98ddbbb8d683ad511ac4519d96c6ead0c9254988dfd405c93c5e61a7fd23f3911ea86ccb220d4def1ec4fd9d888f6834ca40242985fccea5400113d03a90173931bf7f876cc089a7bcb3611a34ffb2b01adbc3d708dae1654e783c6e704f0a2df4b2e7aa760d04f7ab3239393f85e8d56b371070c89ebc4ebef38669f781bb457fa5b322b1d5bca7bdbc4fec3159020c8627a43e4fbf3bfef22739284649b36449bf20296aab8cf94625329d62ba35739573b09b92e7a4d1c3a193cc365522374f986e084b64ae0937eca9438ae1371ca0c3c5b2facf3ae56c23ba0a3af09dcc125d63a944414702e4504d0c34c0932e82e651d6a9012c576df563eca2d15d3d9a6bebea0ba241bd8909cef2e22f65274d4ba6f107d63303ec59877c96023789518a7a3afb6a7a617de15fd20d492b5a583f57ac8080a049b68075fa64af138178bddcad11b74a01665ad1601ae3d93d71d3a68d41b6011829c16d634b30e1c7a576e762ac6add2a429f8098ad2e9205b4f131ffe17612d8495987243d21ffc8a358220461907ac68c51dc0d3f93add65352352335d6a6f4a90a45c56f7607102519595b9e90d5fd5e892775f5dcc4e54434833c8e0a9ca1eb0127ca1954c637b5ed3fdb2372aa6dd21e0ed92f7c420af5bbee7b79bb98653013f22183cc7b92f39d48b78f91ca8f38b76f2b17da3999d80d74e81a56b2d1b60e3a943cf67b24e57be7af7171d15f78bda40544446f1f02d27a2512b1ae9071583481c88059be6816eb63966e33729ca72270bd3efd81cbfd5ced8ace7acef87fda4a4633cdf88baaa8db5399bfa6cf0cdef63a64cac015049fa94047b716ec711220d4c0822aadb14f7e1db913a036fae3bcc644bb9aeb241cd734894660666cbbd8f61108c82c76634f3f527bda6e72caa3cafdbc3599b2036ca085b22be6105447173d771c31f57f7f6384aed32cea8eba90c4d09d94f1a8b770070398ce2e563ba659b9fa50b0353be637759fbc93a7328164fbcc40960e369f166de1d9dd5653376f47d635d6213f1e040ee426a907457b84e4986b0d0911f35c64ea7b7754300db55d5e31bf94c06b0a33e3fcc7c8944a7ee715ccc0f549820df9b3ce9e6186b04c6c2c58e8d9750cc62ed55bd87a0d2e5197a1fe6dd9dfd1bbb1ea0d29b094fc584bed627b52010f865fd952749a4067a436ed92ce16f8372802a7d09e001580a3014093c0b39eed2c754621941b3eb6aee46608c8b0aa3ab3cb2f90fbb9b34f407bf777314e2cf5dc7d6914143d2fbda939459219b8ebb5e5a3997124f0209f46f44dc796f86eff45a26932a07956cdd6ebf0a94113bc366e42ad2790b28947badb8ca655919acc20200708a1769549fd8af8bea8ffc2ffda0f5cdf2feb18307c32016f13dfd3079f81b415246b4595ce969dd4aad60af29ddf076f4c014b40a73e87754afdd5743da5960bab0fed363e10f2aab97d33a5142422a12043fdabf3530416cd7d39fbc224138c0eecc13c09d9bcd1dad6996f44bb04275b8116a26fb1161d2f0504a040d300aba9a89d43a72e6affcdb94ce2c6a89396d22062bc71912b37d141d983f60837acb3386a7ac889ce6bd8b093a53e4122a8d25af8b6b69c160a3e6a08ad4352fbf37656dd95c578b91d947407eda15c88db1384e892f5955407494cd025dba839ce80a27b75cabe1c7c8f3ba43923a64e7e11559d1093f4d6944668576ec8fbc8d1d9fb4ae2f9c46a444a11326caaf28fb4423485661e16da987444b4192dc87f62ba518374c408045a6a52abdc494a119affecb4acfacc67108105260190655d3d52485c1f43647937eb954cb07bba4f09eee995df5323d04c9b85ff421a045b4bdb5a1dbd83e118d5ec6c07b0bccb5996c6cacfa3e9b8fec6e1ee5b52ef56cad5ee5c6e19a443db939eeb2decab56a094e4c708e5d644be0ee25c4604c0c27e341ea558345b90f4758bf35d6c092a3a751df54dda8f4efbedc4b88260cec41645efedae3cd6d891c10e76bffbdb83bb9573110aa0b73e57c0f16ac48fa63193f3c78566122077f194f594954a28f773efaa3e56267dc750d6e92698486d90904bbf2cff2bdd1bcc0c7339d912907de486fb39d344a187d0fd7e1543939f666969f24c1dbbd9b3a10927e870318e6aada98365a30433ca759c9a6a2185cea1891309927229b2e9eb109d71c4f81a002b73be0617db5954c8770e964934f86c5a524e823b09af7772c5faea163871a87de16c881bfb4b04ba2aafb87ff04321a25ac17d1c5b2a92778482e9833831830dc129c6f20c396e70d15e077ae85bebf1b26139c1cdd2024d34d5a4beebd81ee62cdbd3debe68e3e377ac24d26a10ef8b92cc29d8c38fd556744905427dd8a770445fb3acc56de92c9cda3b87878ef77e39a9150f6b5ec362d1879bf48ea093ef032e11f09888d53472317e7fb29cb45332b97a9232dd18fbf1fcae3a035042e34bd9f0c2bc634070a99cd4fbf3c8a060f174721d4ceb7b38529ceaf74c7a2f5e32a58066d0a503dae5aa161340e2b663dbca4ec6052c6bd6d99cf6eacc014e0c433908fa6bb9dae78c55b591d282ba4aee35f027b776cd36eec2391352e797bbcc797f3160b508feda091cf9bdcd6b6e0c9fcf9e3aac1f550165c1448f5c43b0f41ae20a9b0c64fe27942feb86c345c115c0791f48f28b1833e0985baa747c13652ed016ebb323355488ff06799f11fadfd88c4ea4e85aab64280a0b55b7ae987d1f6383db45a0ffaa63abd741ddf30c8ba1d2d19d5f69987a29b10321cd72f15694e7f000f0892ad51815edc79e16d7b7f848afbbbb8292d366ab11057cc733a377602c60a012ab5a7218cc97e29a93fa42b0a2f7c7ddf7f5a90dc919b48b7004fd7aef982a542938621bb9cff7829d8800658c4550d630d357c371b6a17937338edb8dd37a11bc56960237891931dcb179c211683d4230642a11ec5cc0bba3f878e44412185517f4c87507965943ca5e2b9a1ffbf6a4b8f69a8f14492b855ccc4326d3a286f40033904efe8b2f555c7a6dff922ccc88b3d55ec533329ffa7f4a5397b6c81b43f16fd1a5b9b36102536062ed6aa0cbd5aa8842aa945f59652de6ae941d81b161e824d6cb2286aa69d910ca49c71d9a76c678ab808f530157dff9350e92cf9ce0bdd798cf5e7d74fa31a19883633bc59db7429b6f652f5a9a857a02eba0df46d758d9259bb8c4453664194f3fbc64adf0625bef1466eb9bc06fd76d6d45aeced4e08271a0a456d083238ea04901f2c9adf8719dc2aa6c87489d1d33a3daab275c00fb663b464d91bd0c8fbe872799323208631b7c6c0d1b10e7e0e80b5104faec7be3affd73827c8bdfd4f42cc4f872686b2d3cf330b0da7048f870f3a373cf4ce56856926a60887b0f9112813acd8ebaf401382dc379d997bc3c9465e219a57f2c54f4b21f83d7aa6e2048e314e18c839cd021f86446fed366ef814a1f0e10ae1fe1fd2af4db0be2834033d439e76cd1ba9aae2dceeca1f9c2fea87666bdeb5e8cefd5261a165403aff12f52dc1669ae3cc622102c2fd04017aadb0be029a152b98c83b15e434bc948ab2416a468d0beed44e438bc19ce89d0992fcb6c768213ea279ad7b125c032b28ab5368f93cda598e49ea6ece1fdde3df5380d73eda9ff6cfcabfc3d631deb733e67a36cc9d6dcf12fb590d937b3078a6b2a8b2790802fc7e5cda051e81891c4f09f4bf13e0336e798e11c83c2bba25379626344dd90a2329c9e888d2eece1dfa7908be086874ab1d97d2df0455b2c761d791d5bce71faafc0c9f5e3491dc0d776f333ddf3d4ebc69d383af11d2e7798a01eee77bf619640cf4d5c26c54007eaf74988ecf0ef6c8cecee501031a39339853398a4127e61ee535f1f95d32f5ac03c0c1ab9c6667a197a26431b77eb023e1bac8ccc102ce50966e394baa662c8047da029481a88cec2784f240485349dc9f013492a1fb0cd6ca6ec5374dbf20dc6c0a0e504a9d4ad83fac9697f8a4acd4bc0dd81bfea370a64a3d4c1d89c0363fff92e671f4f31be10f61ac040e03aff325483c009d822a2ecd6864f8463ca6c2b3587bd1a03a852c1c2a250af126ab073685871efc07f26c11366d68f8798c2406e6fed387d6d6c24ee76b6b7dae0bf9a5f4ce5abcdddad818747a272526fe0b08ea41aba5de5ca6f1e697abe9a62be947fdc630e01d64df91b1ec96358f10d1844a051f8b92f1e40941f9101c7d7d1a1287a758975a4e413ce23b06197dae7522cc1632b4c11cd48c54a5f185d77ff7ba6414c638f736b46dd47c68f83d1290c9fc57b2ea1e6d1085f1d878ad2ba9e106954cecb3e109b711579635a12d2b1716c3f8628a03d50049fd39cfc1e4147511e9a914605e2d58aa4e06ecbff68fe8001eac4de947a12e6fcbf3260127b86f51b1f10869f4edfa87f6e1ce114692782a20be3242b4cab72cd5c646b05ab0d2e6a92c7e73e471ef5d51e6c89cc11869ff8420566c7794ffa43b3860e944e2dc7df76cda8e5eb2509c8726cfd5d60a031a09240ef","isRememberEnabled":true,"rememberDurationInDays":0,"staticryptSaltUniqueVariableName":"265514c26e99550ca65ff790ff972563"};

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
        