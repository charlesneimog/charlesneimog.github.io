
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
                staticryptConfig = {"staticryptEncryptedMsgUniqueVariableName":"2d58deb436d676dc80ea40565e361b86de38a98deba3701aeebc89eade63cc87dfb646486484d91e74fa84662c9e2959d9b93f3b0380dbc54b311548130612ab8a7ce18d160e81b590dcf0f0468be85d597c3133d3fb3b39b9ca78e8e7e9e9f96ac858dba89b6ea22331210713d12d6e79afc6c4a9c776d0ef894acafae87d41c382e7c206a803acc7501c77caa6331e4c36716e3f9d1e53e78d69e4c9c34398d1906a0c2611894888c46c77b15abbbccb4462c09c8c7d0edfe6e934f2267af7d74bbda75fe5d60470c4a9352285d9d288a7ec9e81b99657ed27b265d1f6db2996fc7ac1265bb08b98bd3703802a9518a4055958ab5ebb233db7b5bfe9184cefc5ad28b01774f14747bb8017ff6379e9bc974572d81237e0312a3d8a498402d8c36432d5e791b6d87d5b544d05739993b3dc4a0e5e1f13f6a7136780c438f91aefc0c9b4f4b818012830aa20e7274ebf0e488e92a9322ed336364aae2503068c4a167385ea7b07b5db1f04cabfdcf3b5815edced4b4dd6422327b3443072d7b6d0e49c151439e60c417e3a9cde07fbfef3d744708d14743e1d5b28af9946a3d4a490a45d3cd34883ceaca80d6c4edd3881a4d4137eccaaa7390903ee70bc40538e5d150fa606db547d5af64803eb5e9768c276b9b03c1054206df1f268b6978699fdff7bd8f4f652952ddb92e94575bfcd02527e54d260902dd93ce3e396465fdec8698f136b8ed3e2628e6985a63c563eab146d8c22442236523f7374fe37c01b7735bab52fa2e0a991ea292779cb6cfc2bd916c483ba6323065d1ad2e3d9d9cb94026f9baea232e90c8f479c6773bb180081d9b1dbc6dccfc74c349885cf378bc13a1a9bad8a1546121cd57b5cba8f56c96366716df30567a387b7466d7087fbfbddd8cc708ecfe49ca739e1cffde35e443f31be5a456c20f88a65ee380761e00d04bf5db0743b820cfaa6d6d1daeb317d97690a1232104d6748a1d15fc346299ea78937ead55d6dc4eaa672474923047905b6a51a478ecda70542afdf679119209e99d08668e61886db2578b186d6033d900554510cb7a636e8e4c43186c93ad343df75fd372b3b9fb8ab691e5e49d105f6757c496efcd343c1652ff684d28698d2aaba3f27f44638132dded6b9b5a0c8318dcb9878dc593f10b4f3fa45175c34b2a03bf553de0467821ab95955ed56f454f58f7c676251032607e2a41bc5df006de5f634a977ce5c4aa5f1a3275cd6b74e7870f354beb5f7919a466ed3422967c47c87217cf2c9ffced60b6f8936b20bc4cd23df93fc58dcfc5edc0e836b3abd6b29e247ac408c8fff808a71ded5390b3d31b3b7d26eac18eb152ac763bbd2c9748ad1577ec728839664df1d5f427c23b6017c1adc20edf5dccd230cb1b1c1ddb3cc654d8bc6e8b945c5f6d5e733412d867668a19db825fc12c404c25c314572b7cb3ed6909009dbd01fdd573cc0c0a7a19e5224dddfea5d458ba9cc90aec3bb45c7889f2b01a80333626c05ffe2378054b90b83fa5993916fc80eeb8d5f47f21273ca961df98761a1fa8d1a6195f16245729a056dcee3d5b8789f97c4c4c308f933c8069095f6a79ba742ba67bb9b7807eadeedf3e19202b1d2784f5b786eefaafad86eec681103a3733a6037faf51f038b5f8edec1078da3818b44a0bc693d083e67f9c96f2012eff1387a002228321d3345e3d4378b0a2ffea361ccf91e614043da8f85d9663ada7747eb4ee42da84272ec096a175236b3dd13291960776554ed5485d490ef4db79423c2741fbc4ba87e1089f19d97dca1b11a738480b6181ab93425841adde80cbc7de3cab4f8c51f1d205a088db312df992e85729e5c3a3c01322ebb010224d5c76ace9b88ae2c3bbd8849d6afbdafab4eeeea8c309eb1b5ae9e5e9632d6a630edea82ce85d144c783e883ea883f6e90a53ff899656de767fc8bc63516d2a7376f106afa7d45c794555b3c889b98ca5eb4add8561890daa13a279b077c581a569a94e8c95c44255d8c52165d0e3e088fdc02e2927efbe50b374e54fef79236d3f324c0b818a169959baafacccdc672b5a3ff534fb0b1e440dff1b38a20ef90d2eb7c5f8ff42d24e1db4374d89082d3d476013c94b7b2d417118adf311ed700b218816d6c3e244c569da7bccdf35c99f5e3a3def1a256589d5711cf92278742591941c98498570ee0ff99caa9c4d99db63677e996c5d1892b5311713e71c04b8575b5cc8d2561ac9e8dc4310e9f2d6ca25de232ea82d87921d61ce4c8d6cc9f2d7720045ff1fdd95da254831d87094117cb0ceb92ab2f06eb86e48b2b568483cb6aa06ac931d56d326c3f6cba038112ab9007086a8a00dabf7745cd6e7138401caf29be0f867a1b642f6361b968542032886390425cf420977aea9b89e59d485f5739dab2d6fdcc51ebac60cba9b8d603f8f5b7ccc44baf82bfeecb7b49bdfbb4163c20b7afe0755524dd1edd9e80945e228b96ba2547965de1a9768b10b3f514222a357744ad9c734232734f1d23f42f8d839f3644b13bafcbb5fd065cc3e774c4b36dd4f21e1979911894ba8ea0579d0e74ccd3db6808043c3702f0c2efd77692ac63573fac5ef445a06dfaac4666515e1c833569600f31b7cb4a850d3de7163b3db0a29b671d615a2496d1c067cfd15a6950359d14ce6b4dd3388bbc6905a5be7d3b5a476c5e0ddb27d69989668d4701d80a45d5e93d28933992af73d17ab8a2d5a945cafdd22d3bb87a4b0fae8d124b37034bea4c9f0dde382ad0e91cee38e692166515202b4bf014e9bf37646fb8fafab3fe44aaf86f18935797db76903aa93db1119869e676da9079670fe238cc326196e6b9958caabb32b80bcba3117482ff84d6ff80168a05229a8ad780d758f96594e707776ea768efd3c26001c1e619088317407ecf4d4d4e504293804406e672854748624144215912c443f71715e917dfe22a427f6123b7ef999d11b65d730a18b2f933fd6289b864cbe915d0bd87f83b001d1266ef18474098feccf719ecc7d1983d764f649562d53fb1131c0de79cd648555bebcf910c5c23ea4d91fc684e55cea1fec6efbb8c3975720ac679d0e9a9a89567e596a7cffcb1e9eb3fd682b6bf8dede1aea49c2d86b0564260a23c558dbd8e17495ac0062b3f4f4869cbb6a87e61002f0633ab85dc1d646c12c87d790381c00b0a6bf55425bb8ae4f7dc0ef19751897df6888ccf3ef22c5886cd9c32b3910c161e53954ffc2120fe1fc807dfefa9249135f1cf588d9cfe21b1c98c0101c426e337622ff44b714e56e615256deaeb763a351fff2378729a1ff99e109fcdba7d4f4bb3ba8e0346264360dbf1a202cd90f824ec7fd3c18fddd178f46c96c2a6f644266a938cbb0484dab8f4ab49bec0de2bb5616318cc2b4a7f0b18ac9a8930c13904c62bdb1ea8c8bc631617062c3d12a45dad60c2ec18d1f97008d1009a27f0b71886028570dd7c2365c44f872d69b2160c73b57d61235b7d7f985d3d887694c5e2715488165e82b43a95bb606f05918719bf1a44af42379297013eebf8194f9617272b595a67d9d53a631fed61a246f29a9b765928fe6b8a4312daee193646ac6467a4b44c3a1cdd28e1e07c9466c39cb058860e617a6103523d22b9525ee87318e52a60f772659989f115339843bb86c39fa757cb4e9264c82e4ce67da7f375bf636710c54ca9d9fbac609d939b9ae4b99a7a40a1af0a8c7bc802b639f383d2a97b97acf6170e8c20d1186a6fd4249f89d0d35ef3040034a0e317974c3c20705db65221ed0a9c4602ccfa3845735303c158e731d2bb4a3907c7b66de136ee1da7af7d78f888af6cc3d4bc0e24f7414bbc45556b957d150f9ff1be8a66dce12036582148462d83f21df0817052fda8ff90dff2ac88985518f06a8ce963c5e8a28dc44d849a6e5ec03e21cf31dee106c118069393082facbd1c8cf2e1e619367712ab6dee113541d8a252829a2f338762ff18466c27fab215aa6804a68242403cd2a6e63f31742047b35c83a44a19adbdaead271323b6741825bc9e35ebf6674a3de405561f1a58d86492de43399dbba8670fc18ba3aba418875b82d32eb992b6825fe5e638b43ec041d1268c9fd2bdb65ef43a520501d0a7eb986557bd1db877608bb1c059d570819c4c4ac8fb309dc7cfc7246c8ed7c30d69f27dff385b7f5887039eec41c79c4a0fe3bfc1dbcbe3e5ec1637db1f146c15ed5555ba6a1ea308a491111efd2dfd6df0eb6e79083f656ae452b1e504ba9a65cbd6cabad62040139c4f56bcd366c0447f0cf56c18b9a52c6ffceb0c34d6ef7cb0bd4f2ae5eb9ad6f6901547c9d60b1e733922de8e669eb9517a5917421144cba6e057d7419618bc1d10fab2cf89b176bc4971b4bc2a711148a5c747f4883c778afbc8bf6934d7cc85132b03844c16ed85deb84f4559b264bd1c4caa04a31e7883f288e6e454dd2aeb7e2ff615218ffa3421a3cb6dd70eef3bbc7a84051f2d39c67737974de23efde385be4065f4eb6bad5a4fe50091a0c1417c48aa10dd9c0f4608db82fca32e4c00e30d9bd00fbbb4ed1cf39afa0b5aba3535fce8011979bb88d8c2115ab264720ee037cf2c724c7411d7a8e92f3f4bb1a39ebdd7570267163a540d404e3f1fb9a9e0c4b237f326ae8a2e5ca7559a62ab666049f33fe441229a9fbf8e6c94760a2c4b89a71461c9ba9229a18a7a14c6518fb20848164e21cf08b025f43b06a75d45a9e4096b790486fedb7f1657be7bfc79c9f2cf51452dae78ea4022ceb62609d43c525dc236beb2b40d3aabd6d3cb0e02b56adb6379e7cfd46ea019d984f35f15d5734f3d93ee36411c3770ca5cd755e1228dd8582158b482aea612346de39dc4166102e9d268855ab91d21e256061558006c74285810c78078b89dda6913eea9d9bbc643a427964d677a4bb80626f524adf6db5c7f0c3f9cf4716acbda233f728aaf51b6aaf87fd1126ea6a95a1ccf7ea05df93b3e5675e80008bb02894e2155e498670e30ff243cf8a8d9198bb92e4dd8f640f6888a7c2a3d8ee3495b532fc7e0de05231797dd05f52b246837c4e9efcd5221bfbca61c2acd535eea192c6e4ca758b9be2fd096105c8cab56293402c2fdb773f44c47c11d7b0bee12e9f19fdd0020f828b907a72383c480140dd9880ae33867c4c06599a117c0cd89bef1e7713f6238fce04db2cebef8cd692e14f035ee964ac8044ef9232c5db5365ea87c1a20fc03d95a0a3a65f8ff5963c0affc60a9dd815021803cfaa9afd505071737ca6f025acf43f2542a7f9e27579b90b3fa6447b4d60b03662ee63ffba73d5374111c5318b57afc30c7fff19f6c3dc517827fde5b5b58edee4d7dbc643195f701b620a9c9e7e4e99ec023eaaad5a54b9ddb212dc33aa02270a314326a78a626b1731ae3546a78929fbd2eb7e9aba4cf16d8c8ee3576c6e86f7bd205167180767668bd138f7acb0006a1266bd4fdd939b5958fbaae598c5b2fb021f3d0769cfabf5b49cf6331af91d3c3a456884cee8bde29b68abdead19ef34e31b73a1933b86363b4e77ff044f9fed7c95076639ed6c9826698944aaef89505df85f00ffb86f76b4dd338d6270599fe2b1cbd719072177806b162e8a0c476139faedfaca84009aa5044e8b691cecb441d469078e34c5b010dffe4820a0389c2929bd4b735d7fc27d98d6e08eec2a6c7630735256b570f762c8312ce9729478d274aeba6b30b95c50c0055d15ba636631696116d509344e263bafdd38c0c0054c82ded23f45cb08653c34d9f66a28e8026d453ae4141fb70f63ae3f3782e1ae1b87b112b771202fc736f1a792a53e79ccfc517f2cbd606714e4c778316448e5271f93b2b9dc92430d89c0f207a5ee1cb23acb7f3f212e4ba556986d620ce4b71988bf6682391b7094c8ba993d52d60e2a01c898893f2b510460359d9d767fac16da85d2ddd22d2c6318d858617cb569bf134eaadc1eef313e57daddef7d5e876b5a101fdd9a05d2e5d6f4ae8ffef15443b0c7334a958e646829db2c1ce7b5ae244b4b3fe8de0b771b53eb6202273d2dc6e4516554aaa526dd5e82a0b85a666131f93c02e77133723c90ff7ed3451ba70880eb174829ac4eaa900d9f4e79fd1452dfb1e27e10182d4d5870159adca7942125bfc740649bc9f9d86f7db189725b1a644cc3d50137a7ad24950b6e0d2364a81c7be15c2832380b26aaa0a259249192101133e122606301cc6b1d0002d63d535aaff25bb110c0ddc7722eaf38086fa350df5df24b5e240f5e6c0f43bbcc858cb02bed0ede219cda534d73fc1cef41e4306ff293eb2f7a6088626b48a779057c13bba9e6f8ed765c0666b4c41036e03e5af5dde958da6d5f3f85b316d2dc498d01c6cd1cd3b1c1c632de9ee6765d95d8d14fd7a901f8e90cfe07ce5530d27d5bb6673123b5a6fbc88abcfee5cec17db179961b2bdecb3378017c8d969217661a75157893cd99309fa74df15b77d53b582215bb55cd61ddeeb0c7d4d1692b30a5f7cb1dc5dddb0251b00d6b35a64c3fb65bea99b594f47c020e0363a8d1cb887d41b7f6484b50c82663b05fde2f671768e14e964c138210302a1dc52a06fd6777bf8b345784b997e2d4213ef8c46b4f09a71685f8ce9535f3ce0496d95ec7a1694f7f4ea9790e92be41aeefb15c0f4aeb5a445994392b8e731fd3640a495d4b6555743ecfadcd0b6749e558d5be4c94d510c9d4e08600796319d2e38878a74015cb600c8d02e1741b8fe196f757d8910951e1c20cd2366ea460cea3b98f95887a4c72032f53295b0a38c1305a91a477dad3dd7989907ec34ce32e64bf1882be96ac0d30b857ecd2f48587ba804dbd22cb2ab1257547799e7d07666003661287dd4f12975ed41ccc6396f7d2b0525ce9684fe01b4d1f46551e41f997b375fd6183252cb7c9d5e047ae20cee6da0f35c4fab4f75e4deb38e458af09cc59f0369edbccef24cb3266ade39ff066582d70e196e8424dcbe3a779587a229413c4ee540b38019e80ee3b007ac94c3ef895441704c70887495f2736318b36763d0d1f49ab854da0ad6dc0655bb3a99ca20111f7417f28a8f68f1365cd0649d966e983120eea4dc3efb765b2ee5e6632dfee8984c2ff18198d312decff39a04caaded323bd5d53a2c74b65fd056b34f2025aab35206b669d88e5036366c4eddeefa05c21ea9507fda2efc5cecb5a1b485e85111b259c6029ec7d52ab78f2a0e17004d14979a5072a7d85180b37ffdf368f8a0a9d4071f1151557d2aea9c369e61b6aea2467514a12e3be4b4f29ac11d19d1d1d41afe5f8109b68a385acdc43e73e76c34c4c068b30cd781e9c72c6dea9f5bb953c08cc08050aedfb2df3b3ba20cb52d4c72b5f25332d0678725435b80033d6938f81286b0640042ec077a297051117ab482e43804e6ca90e3875dc6ed0ef7c122cad781350df9835ff4e8c578e23591daa6d6aed41ee85471b22478a042c7d6b1fb905da4a66bc46616f67205cd14fb967275c31ed199ce08b41ddffc7a9df3b942bc392eeb67577daf15b23299cdaf2118bd3ceaceddac7afa56a1c2c80c4f127ada7794774ae43655d7e45cb1624dc1b9d1ceb27780db810bd484edf5f1a342880f775d4e8c8c165620f1419488c00e629aa69664867db33fc31bd5ab3387747d9b7d983d0393f56953afa8bab73321601f3bff32209a381c8721c82111da7c151ca7a3d453b72df2a14b50ebd0aabeb0c3a29fa1757ac1b7736418584854b726dfbbb57d4494035d042e0548e493b1e5fb71ea61571c49dae1afa7f3613e9364254afc287d594f0519e5ba7dcf9b1ffcf9cabe572b851805e9e46c5219f86521c65838afdc1af19a3c877901a9bf081b1a6f7ab0e4f19cb39028f6ba91695d11eb82c1504c84c93c21c9d954edd8b236b4e94ebdd0223cd5f9c4a361c298c773b800b3849396a15f73e953727831014bf78b8590bf60975a46752b583e989c3970642342d9d66f69b36fa1a45f3e4c4d73dc7a464999c145ffe60dd7109a9afa7cb7ef9f7be42d7a95e18ee53f40bc5b6a826f1d173fbe0c223753f3bb2924dafa1d033a6bb4b7d43821f65987f6152809905d41fde36374db3a1a2e25a687cd359075b541eb438caeba770378beed20b27733addcb1c3b98aede4def80cfad806ffc2066e90d3bec1b3468d7c716c58bae8e9600b613ce9e199f4e58804476959d967892b5b47e2e160d58279ce83db754dacc8aaf4542a985f74d26f68d2d027b31a4dd71e4ff2a7e266e3b59501ee31dddab5748b1bad75904f88843ae29dcc51c591f8e633b83adcba940f8ad4c395350560448701360d472100f3f8db921a0805a30e284a111ae459107a52a7340a38cefe3f43b280d424035de4cf5653f03ad6e3e12430b45880e477b6646f62375fefd0c1a8d7272b81d7baa17ac15457d1ec17440516399eaece0ba602d32f47abb3801627b8251cf651c47197dc9a4022160edae4c9ba04aed1caee278d41f613d648df9cd443546a2a3b6d16a3dc1081e54716623361975ea466b1ffd8640dd5ff7808e2f1e4f402bdd3d3a52873fe0c8e66915b60846646efd89638c9e32365e069ebdf830dbaaa94e41c6e69272681cefc3b51c301b580d0fe46f87cc1e096383000fcad9f994c416bda9b962e056516e0f00786ba4749399db26bf653ef7a689f6e589db17b49bec427f3c6d0ccf64d02e8ed2882a542c56db75260012d75192abcd4c04e4cbccbe4e7e3261aed1eb8dd56959d1190cc8fb9bbd7c28fd7d98165377dc4e846087135120c01f8086c5e4c6e6062124585424da8ad657c46ba302da8fa009b4ebdb0a0e12ea14ecda1fbcae4fbf3a1ed67960e5670b399f0b7ef0ed75afe1cce8247300436c408c9d41b0e7675badee558cb9f47b1933b411021fa833bf4999d555fbe8ffbedc19daa4890383a1cbfa9cb329ea7e5364b084df94e7ef3a899b85f425576ca42a39674667feb90f53dc231da3b4f5c6dd94217379480a4f42f730e7134eb9f869e83e41970aca0ac5cf865d6613786255c4d40e22a8906c65bcf35ee744b751b5491c368fe64a97043cf8093017f486110c1d5f8d256d43528852216ffa59ed5002e7bc98cca7ad378055c878e68b84649719e3eb725b59b950b5e784b4a480b6aba828da2ea239e2d8af7cd699fae330e62dde3bbf498568e09a97a7d176cd32b2257ae1fbadc6ef65ba4f9ef6c9b95c821f8f3332266ddfd1a82f3821008ad8bf7b022f0a929de8336961dd9277d39e8d89ee0d8fda303a0cbb7bd01521923841c7a40680ff442c750b6482ce8f147b2e02d84f4c5b941003c4447a18f44bab8fde27c2725fb53e23539b9952f14ca986fbcb01c27ce8f23ebb6d60e6c20cfbe6f5655c8475e5b475f5db10ba28a46b332f6b2842057dd248deff613aa35fb4a14c4e02a4f6effad869790e4dbebf2aa6907552afe311dbb255ac9047d76eb325fc7abef6ed2e64335f719da90c952ae561dc9d59eef0312191f720957f6669c7f7a9603c44ed5574fd5ab0668ec48fd5098334eb5a57235319a3ccc7dce1322030e2601e42d9babfb7111c7e9fc38f7bceb6ef58c35a40217e999f1f3344f258c458ebce1580b520f50b3dcda10c92fa21085576d910deb8f26d648bfe61eb431fb457efd4afa9bc549c8d104139a6bb7bf88c5a5fa5cbceff49bf146c27299a819f3183e396f193c802f9d8ffbbfaa832ed65b194df2c1696899b87f291bb36ad0d42b85926239e6a5f1697490e4ba95a94b55b81708635387a4bb73b8b781fcb34533c0e262d94836f8a23db9c60679232696dbe58d075deb1ada93e741ada2889a8c25e848a77f5068f2c395818bbd8c75247f347cb812ede946c5d518a3b1c9580dea60491393d7b884fc595ac006659efb2ce76ca838fbee026772f77e7a7e57249d299111c2f0a52533ef34eb6a375cace6c4e5482459bcaa9ebbb9e527d4ded2c5da035863b3af89654e36d797ba92916e57e0c9342549f81d4763b169595a89494166e9aed3d48bf9038ed62e255e9f6cbcebdb790d9bad155aa37e69712768f2b8ee2f2c7469629022388ecef912a29f418bd1ac2dc86795cd7d94987a7e18eba99b30cda6cf7ca7b0e0cd166174078861a8a639778ad21433661ff585600512f25d6bba724c183b7532a3fc5823777b27bb09166a5c45c3204d62e1ddf5f99b6b5b47341cdccfebe4f8a7351b5b2d0563436b79dc00a62ea349899770897a6149db9d34317885d234e4a11cfa77892488236706a2b2c0a896bd72c29613c5a79b43642faa856f4757e9df62a0ea2d237cd6feba209d1dae6b626946b60f5f782c1e9a2dc2aecda09756d0c43bb6f15e5fdcc4f8df985a94b180a79b694b7fc8dbd8ddabeb31d8f60e96c06d29033efa66a2bdb850779f96f3937dea95c905fd7559589c9002c2f2de5751e9ac0e6f5a5ebbd5bc0bd5043bf750b6bd9bb1e45194946fc51d3369221cc5e00d3c810aef794e0c5e7aa955fc5dc45b916b7301d24799970a0bfc99bd74741ea07fc11801c1a0de8d03b5253e994a931591f63d1ee1d65c4e0d76731d6a26df52a7e034e32cc59d6046dfad984268af4ccb4c9796bd46e06f6d0a2f21054871d4cb6a29aa18f5085d79163a0913955fe9c9736cdbb591eefe80b92f48fb0b32684c0c1674a9c18a239d579c98ac6406a7c70bac66678543c7389ced3058e642f70ea5eeb92024ca89f9d5d0a69fae3e25caad72b2d78790b2854fa18c601aaafc03d85363bcaeb80aed2c269b5af5274a51c4042b326c3bca0ee4b1edbe5308e259190437b2c83f2c542c333c48cb232cc4da5b234af83d62fda5994550bc15cf9e2afc32dc9f7dab5b68ff4bb45db854f1b961e779fefab2f074bd31d77a57d61da6e782b8c8363ec2237078c10d8833b7c54c204cd17bc246fda9cacf887562b789b2371f556c98e1f2f27d45d748769a581f50d94b120e2a7851fa5dc1537d196ab832c5f66414d45f536c2da09074bf3b6c9ca4d6f655c327d0b564deb207b164aeff712b9af14088f03d8e820cf31116a47c790ed31867d33bbb77c52072d3aa3bcc4639e6b934dded3194fbafaeefab3a2aec8cfbaf55adb34c32d33cf027d57d197590ea6f9e70abe552ee6db3ac35949c8a39484a85ed9d06613f6bd3a45ebbf264c8fad54b9ed79b9e903165efcc6a041321b3eb660c9f11f3e1e8140a9c894a49b625bbc4e21458a1268b0ac84f86d5120ea6e3eafc85aaf6867ad0bf7fd8c0e30f0fa6edb073b1ac731f08a02e6845571d782f2e492bb6ed4b12f798c50423295602a1e4350ee0c586c1821867fe14cbc82f32504499ac7253a015e58330fb458cb1713c25a21ba48a7129430aa9309c880593c83eb73dc50e38f68b94940fb826f4ac60a20d44019a65f3801dad929eb0bf2b1d67b04c5e6d36af105ab792056849f1f4323fb69378aca28511ea75183db1f7001ce06f6acfd2b919ec1a4359ba91f9eea44086260c2078b245eb013613520be473e63540fbb5935b1e6f4997b909e6dfa172218920458433480e3a3ce9e130d7e8e53fd8d066324a800b3c48dfcc00c874d99aca39ad3f5631476f196c0dbfc1599657e4e85501ed4c2dcfb3f9df8e84aa4197209fee5f8bdc59aedf6a211d1e4a2172b4b8a57d2ba43d089c3e492c085c59cdecf61dc8f8d7dfe18548facc398478942be3ca8f967048e7f42331c2d982034b5358c0db2a0acb0aad9d8a5552dacedff103bc1626f1afc6ff9bc11ac1b2c2a3aef245f1fdb0860f9bba1432c0dc3b201881c205e7efcff375b7f801d90f4d1af9075b20f03ee3313aafea89e57cedabbaad7029da0a0244e51f77e149fb708fa684972433a2c13d73e0fdc46f2507113736999a1c9bf6973ce6f988c4e985b29180d6ab4db2ee49eb39f18a6b696e9feadfe2565d782ae8359d8ba9cc4ea94379e0130ebabcb527ac6bdd319ca6853b34fdcf99133b1d1379ef1a1e71918b65b8379b98a4d0758bf982e64497ec73dc1ab4bd0c32a41debd153a17861e7983c1ca5961942a9c981415eb3a0b774d141d6d410ce2b11a1eda0482961da884a7923cbe2092ad0c3fbfb5a6044881178b82151a5241d16ecd4941628f4276b6a623431caf0c4e4a9120ad0f2cbdba7eba613fef2533b6ec1578ad2bef92d91d5325d20db6ee2746f2c1b0ef87daa3fc1e181118d048077e977742855e8e1529b3230b9e8c7acdc4c1be314ba1c72e9e51dfc3a4a88495375bf6f231f6710cdf38cd30172160fb726f234aa20ff768b85fa235d69b74211efdd28283e089914c193f553c19b4781260ecaef0b1f74b176d991fb2589eae11e27ec5159f80dbf50155b76e7d48d5837538866e4fadbb8b9c667f9d53b1b5e35ad6eae2519c777d3ee06b6a26044441d9c7b0ce76a679bf93b487032aef8ce8bba265b2fe599fb0a94f93f68dc2708cc3862942c467a56660271cfb6f17425ccbf7ccbc8052f12187029d53c0b39be74b024c69d11f7185349f9b6cccdfe7bf2566f6f0291506a40e0491ef5123e3465a5002a87dea4fb3df9b7f923bd557075b4d45ae1afb7fb17968d7df685686ecb79286fc85bd4f3c0c4aba2e4ba74cc63062d46c4b419be6cee4ddafb9d62cdf7320aaf7a1e72808b127c158c92cb08ed019551c9761259d3c4fa7bd072e01b31ff146d10b67cdaed01dc906701028f56e70dfa3f708beecb7eca4de0ce54a7c9c1b2aa58315f6a087e78466565270e469d314cc74a1927d1e37e1c659f94f7820a3165ece8cfc6072d8dadc29b4d531de2f9b731a85e4cf59b255f314fe4df69f21ac82bee6bce0ccff3df8e4b7fc1ccf33ba47b1c7b6af54d9d83cddbb31bcd175dfad111564ab2717d59fd445aee459070f744f80ebc765cabc87d383c18060ce6d62c291441541e1b090247a50186d0b9b54138d0edd1176880be672521e140f2012c68aac0c3465d23ee863be56e644c52d5f80575c53575d7d49125e6ebc9f8b24dea91afa3f9549b4f54fb3cf70532eea792ca63586d24923de7a45fa16e8375b52172a8280f996a980e1e5deb01fcd89bd38e1b7dee4745136989ebdb1dc6cf3f68e0d2b46f1541b5d6005e43f7ae3b3baaa3416fec7db5b035a528c9ef991c994e40ade1baa8eff43fecc66e806511c05c33b3e293383c059c086c1bceebc54e44f8ad9a22352b6b28319a579889d83e858c46b0adf1e300b2ee293bbd46ab4c2baed8d0c02255b88fc57a49cfa6457ff28c029410ddc4a5f0dd4d8b507b3ffe6e734d52111c8d51070fd55b963907d1fc1b9a8e9f161f756172523f3f1e67d6b025374e33df3b257f8cb74ecf606b92464ba4b483b5cf4a2fb7a507ee87485e3ae220ca4aeb57ec23acf0e7c76cec8e178263ea13ccc4985a4f99547d6a37649fae8dbfb6539d7f0c28b193b531861ceebfd702d0c5e1c73ddc654706f2d631799672e5c7695fe7c7a64bdbec75a6f1adf4a8b7259b2a6c769d9e32a1726b62664b2a4c15631f745d94a26bd75fa40f5b1e3653f9528e220c57b6c700e5c1c331c58718103d7db4b12aaf4a6e615d78b30fcfddaf881051cf28ad6d855ce84c672dc18dc185ccdcf34df054530da272d31d5b8e76c69c286cc12e9e984e2cf8329108b4a3bc1854cbaa59d39da5852ce364e363e081c76e78bd24e72946b2c88c123287b3d1c88448e0f8c86d8a1eab6c719edd6a7cc4b744a38e9ed2765cc5481320b470ffd4d290c548b6732067f05cda9d4106233106c7230e2182e691a79ff2d17130976880e6bc5fb4d88df032449ee2f48a8a35c6cc4d0c65e9dde4d2d60fae802ee135137f6cf6ca61248d70266b6d418853f1b9542127c3daface1709aad67b3b69384f3ddfcabaae38fd88dc7b888e3966adafe22e0fa98088a02ba817519ffbd42e640e1ad634c48149aea404d7c78bff91582ad89e5e1ffb9e71eef513b90812ba37517b70f8314519e8f5027818fbd97bf7f2d7197f0f769046fc4f12fcd246f75d68f3a2f626348f1e6a7f88f41d73bd20b3d148a6010cfc69c561cafd6f8140904a7eaf15f1be77a6bdaacffec2fb9cf18f6d1d9be6299ff4d2658159b1fcd87de1a088b0538944c459cb5fb3f14b6013321ac161dd0bd65334e7d153d265ab392a2986752b4839883f4e861c97d8a3e16922b05fca90efbb6d16acc4c095f58d422ee0bf32bb809289f03dc81a8c063141624f317b84791c9fbda358667b77332544effda36bd0de90ccb5223494bd2998d8686610bdef15f83f52c064a6492ffc263e738752a76a5a11b8b4a75708becfa004d33ebddd2a8f61394dd4c8a0ae60f05985e4216342962499b071147e791ee70315219704ba3826a4d7dbe76def5554f058fedc5b73feffcdf93f4a21591f9064e9e36259fe517425648d3d6dbbbedd5eea009a2c5d7beeea11a538d31bfa544680840c950ad8ef7ed3a18cf47832ba2b381abd803b0868c417631086bf25a8b40e04ffecdddff66d55ceb175e970493e36f3ce3756ab17a8746a3c4c4e9d6fa70ccc086d038476b0e316c73137c576bdf40b8470e8be185a72f987a23598b307e026e959f2a70473d6c11edf1177b7db3c80a52974f0be7f883ab919bcd0cee90199c541b1223c562578b2c904a27e56efa2fd4c6c6efc70054adddb76abaa99e4c3bbcbab2e9b26cc11fbc733323398585130388ea7a6ea23e102565e847da8fcb821bda68f2e0eee5927e20b774e8be270eced74170b51c86d4690fce9c2418180c82547cf797903814455114ef0196e45b109544d86058a1d77dadf5989c8def1e3deaebd649a794c3908b983a25bc6b780da426b1e8da708fa0703bf1e8d3fb5b2ddb43cd33de6b68991f7f69af73fbc134a7a45d083c42d60c2273676666aab57939ad24d7ddbe37123bf7dd4ae8d858256f4abf73af7d40e16de694c756ec7bee8e27ae975ec11c3feba4d6172163f1b6720df3c40887a10cf7763e6a3a0c5cd00d04fcc9c1b6f9dd336db589c54c2633a6abd19dc5d041c149345a6dbc90f3de8e29180a1c6405231c4c19040aa254a30c2e6be6fc3247c5737797af55658d9e345681b540f1496c88555b21a4a5600b774da129c923440465a59a5f9856196dbc47899f5b0eb6ffa78bcf7ec7b89100fa942dd47ef2e2f2997fd97a50fb936b893999c65811c1d76c2f57f2e0ba9313762e8460ed3d37a5333225cd82c89d981de6b53b6f9e48804b86849e895af8063beba8f4e841b17022b923217cb699102ef9e36e40b39c11b9b73f2c64db8a053bdf0b6619e9040bb8d3d360ba0792ddedc97ea4a75feebedcc162f57899c14b217874d90b2585d216b017329869deb21e871135ae5720d27c2655487d8057b3d29d76f711c1a1ed5a1e41b28ed327a913d87a33d8bbf45d2eabcc7bdae5fbaa9a36641513f0c8e00d8b4c4845e81b4189e938bfa39802c35afe86ea55da3302b854a4aa2df1733b16fc08aedb96892632fac9f572706178839976a27ddc2d20878feb050f68f4ca9a4f4433e72c9ecebaf911e9d0636c1738c6f0e06739f2cc4e9e9cc594c71c4b608da5dd0f7bab7bac90c62df22dd789a49a1e94e7388a3b835237e3a758de983750958ea9f2e2214ea6cea9ce389c18fe2f6ab35033e2c1f93465675ec5a49155cad91df8753aa64f9f4fd86d81bf374232871128f8c13d13a60e471c0d217f8ea3e40faab13f4a5a6ff95184364644b9502f1c40f646963fd0c6ec3bdbc3845d32719dbbc9dfd78bd7224e8d56583465b8453d5d1e272f1032b0554e96a7a94d711f2326296345a81963812d75c84c25f6d9dc771965707d48d426326e828ff970cdd58901ca12b60fc77f29d577343783f6ca879467140efbbf0d5225089b4c14b983dfc01dc88a8c6059a71de7ac4b5002525ae0a4a4299c029b2d1eac214930cdc61eab9bb358e0be345c826720add5e0d2a863f1288589e0036ad1ccf19a6cd61316a2e606a6f9ea564d1ee1e12b3c36da9bf7c80a903c75299e4ce8d6b9109fda0b51fe994e0d821d7aa149d063bf21931a1c99212c2bf630bc51575b29afdf669f32ac6f94f058f7f17846f7c5e2e2ad21e9345de57175d693de76c672f8ac28334256696ffc1103b5a93e3265ed907d29add3c4f41ba5618d378cbb3e9a3f1bd730476df11e09073e54e7a3609e8fa7c7ca2adb6eca2621f6a0c17c61c7443f9b66b2a335c4fb784e9073ebef545c2edee933e6c9044a5684afccf5b9db47d95d3da112ce32223328823934a04133db6d34ff210c737c045b4df551f345f4ec56470ea52f79cdfebe7fd684aa611f83f50605c2b5009b3761684b69cf04439f267d28e1b7e88bbdf166c235d7e8473a107bc156d26ada778a6fad9af5e7cf8db3d333103fceb832b43b5b01f5adde5254c23a117053be32b70b8ae45b9c652229686d2bce52bf34225ecd5c3fd9ac6b7e2f7b32a119c2edba1bc6c0345469079577b645b55f0adf7d80a7be531987d00316aec819c7381159303aba14bb867a1d1ecb662e020bac74e495a2ede43aa3d6130eeda54b99bad16fc1aeb924f260370d873bad8fd387b4de5c1b8547096cf9157dfc4c3b5051c9358096062e5dafc99ffbf5d838b8ab41efd69aa32375892964939fa44617adc8e4fce81c750bd7eb7ccf57807d7b82e38ac834814a18469f1a5a41c2e980a5e25e38fb27cb26024e8d85081e1530fb9b41a2945464f7bffda82c8385901152396ce3e1207c0e085118ea155a8490b3ea392f044ecd81a58edf399278cc3bce2d2b6d47113beb7a77dd2d29439c0e09cc25faa807b0b1ff6577655c4a1383091ac998febc87207d9f3025b98a7c157f8938542aea9b4b2e202ea91c845a5481cc640aa35aa8f66c1bf1a210f7789d21b512571c5a6010ac41c04a2d38b683a629250799a6e97aa11a81a423e2b2e61e60c1ab57b032e75d6c46a88cab51c675127404c7589548a487bde13fbbf5876ff9bdaadb91a8d2ad4dd0aeb2997de20d5995631424ccd352e682286c6f81c0f458d8ca192f40547468e0ccb17bcabbd1f302bd7b15cac29149e1374f2590badc6c87ebda7744ecd4515b3c784469c660f56a1e5996a49325a79f19f2a5956785bcb570d3823df75f960ddf6e6e5adcea55d99385e3c742626dc0cece62d229cf60a6b45ff4bfaba29fc6fd04db76b08d9ee741b88eb180e42ecd160a9342a9f23cb0086ce7893b711759f8c190ee33f4b19925938a9ff327558ce76ff0dfd796bbf31e5313a231859cd04cfef480f61a2d730d4346dadbba409da78e9dba9faf52836ee0ffd1329331708b5d01ec82bd0a158e30a3b89c7075cb08db415efa94bcbcfb79aeb6493fd0050c35af221af1a4055cbe62f056d45999e7ec09521b45d8caceeefe45cdfc42ba53652236125ec46cb79ae3ae8de899211fb8917532a2b8187731b6fa9195eace050a354210b8373ac9c3e577db3cfcd41bea758495cb20e5f181cca246fd030b04126666edebd8d21e80631ea8f21668833ed8fa9c4e6260df42cbfe819833c7680bdf9942dddcb3e63f75b4319e675e0879e922b5febbe9f63d48c36ba0e17a192a1b08ee4b51222df353b0d5398e677b4bdc12119e259280662a501f0bdd80b05ebee729e3092b99b69d0ee5a149cfcfd449cfd351ce499470bf2c14df352015d6c1599ac1352b751d42492b3a3c6cfbc48aff85af88b5097ad6d67e1a162f4c12c550cc41ae1d51713a59435d7d771ae75bf181df816f32ca50db1031956ed2e9ea43ae82db6dda5a6485bd88eea57900bcaf3faa1b2e185dd1e0d0a3cfc01e2fb90ee144f08b39006aa1a9feebf289800cbc5653f028716514a684e40a8a978db5ffc73201f91df24d659a30f24c64cab066214baf13f3b147fe08f59ecb3f0987e6d0bf4fbfab4edf3fe7e47b18f7b632f8efd59ec22a2fca8e17a8b9847fc88e7b1577f8aefe54ca686d48eb6f38a2306ea481dddf4897d9f963adb0e3c3873ef7dec457776c19865cf12ef7bd97217157d15977d0564ee5a923e0b5df964f4bf163d571adf6bb1817322765c430b5c117e5f3dee86b03918ccffdc74a47d3dd2890d9651b79f050d3ee60f638784a88456378b34e85ecf215ab35459ae8aca3de9499acd258942dbaf161653e0155edb1beda8c0b2629d507c13d156e2f2417014bac0c5521200dbf9cccf67b2b09a9bdd2e03bed151a67f897e10269228bdd580fef03923208931bcf7a3341fbd2dcf73317327f633a97f9d113923f02fd7075418ad785ea016ae48df98ac480a1568f595f776f4bd5a31a34395a5e02589bba9ec53cd9cf613b898119c48bfd5596400aac8a414e74a0b41ceee1ef6908f5c1ecf58058c50f9fb443609294cf74e9e55e7661e781148072468018c8b2899ccb54001e7a0ca3812779a84a9574a95cb54aaeb01249ac890b56d93b398072ec4a6c5f234fd485c66dbd669a4e13252471ae1c9b0adeeeac968220faec04a1c1ff90355e5089a10c8d1955745d6e907489d371babe213ccb5041ea5a1f4b6f20df811049a704511fefd524f5f4f1717eb95d51e0af5c022cc49b3e263fd6966c8c6d68386381e0499ffa22055d4013d6fa5c73a8a04d43bd793d9e902e30b351809de1009747510f7d9680ea074960ecda11988ef42991b5305d46d4dc0d4902086fdb450fa34145a1e2237c52d09576ca922b2413f9c5f282221b219edf57abd457d6568ab304c3598aa3cd94ba0a06efae06ef4cc8e7929eb7181db80291db9d5f32cb6f5f869b0cf759ef5971916e2cfb65ad1ea7be7cbe1b4a38ba60103dc2905dd90bbfff43376710461562e3d3f4f12669fc43072c3fad569b1017d10e0a5bdc9d759d7f70e344f2d7fb0411664e7741b85346095c0df1c8fa66d14ebb393aa44e3e9488f379d0cb49f6803d12034158b2ebc52bb334dc0593958752d38cf9ae9d1bb4b413b83c0c80d5039183c3ca3b3768f113f0eb8f5eee0de2d49dc82661cbf8d25fae6eda4cf61ca0316a725f7c7253668c4d69474176ab3f098c7ddd4d448b49c43e12d0fc5a6321429087d341231a96f290d13a0a0fa75a568f747c2b8cc34cdb96ae9b4c4b145c82d140e5c17dd316a0c97fa395fb366d753160f3f4f4962ba00d3f9839f09cdd1eca2a331ede90bf866b9ab35f1f6f70b7b5d23987e590dff538d02ddbdeef5119caec683b7afece6aec3f9dcdb34920e11fab805fb5110c7c81f0f837f491cff6774da89b81414cc5ccb63414e08991a4e07390457a2c98ba4bc7852bd0b6b1ae83680d0fe5e4ad45542ec751897df330ec6222365fe16c36331b442ebb5dc0671cbbfaec256233a262d5087a0865d3ce5886eb3e231cf1a9de38db1125ac079709decbccafd6f2c71678147cf6355198e01324a6d9b02a2e57ba8ba0717573de22aa1f3f8d22d9f1310385bcb6ce94788ff4570a6495f63e22b9774666c5f69d889d9e9578cc4c116d42d558a845b52f6d80b1c4c2df62809bde1f7be814b4f82ad49b35d29f91d7c86335ac05d91e8f1db6c9654a2729fc66eb30d30c309ff49a062a0e2cb88bf399c9c1f0ac52885002f43bd500aef0386d76e24574abdc12862d51be35914df478c563695a71c4b571d8afa9a592411438cb76d4073442f7277eb33c5c552627a1bc241ac4c9c6d26ef4d58d2e57e8b514156bd535c5ece5b038762dbbc2cd610b0714cc0b4546a1be7d81983bb46e5477c69c32ff1c02baf8e621c8c3a7fb1158e62bde6fd7f540183de00a814aa02113b295b9cd53109fd1afc42e3eecd5891bdb3d71653a8a9f062b83498642f8b0a446a734c0fb3fd4fa563c60e8f051f3b2a19a2c6bd833264af865ecb575f2c1ede639f6ac66451915cd3c998148866b27592c96cfb13b377d6e4acde53e621013b1b5b295c8e7d69a53c49ace3d11673564b50041370b9ec71ba8c0040766ccbf8cc693d8f317857db95886bfec13865d7cb775196fe407c37d791cc51a83733f2df25c18013a116e4f7a4dd9c3f940cae1721f7cbaf5cc8dc98624d45f8cf08b3a8fb1b2f0982cfae5a43e952943c7e5e9aa03824ccc550b8bdc6c0bd8b9044aab0d79fabfbb5c32cc1c0172248309c6ed7f6babbc1a25706a1e691390c8fa7c85922fcb9f5e105035b81449f2299d4195e33d6df0d8c6410e04f91582fdf70967675740dc20096315b1c3cb935c9dbf702e39c59ca0584612ec1c92e3fbce4a871d56849855a886913a0f1400839fc706f5dbd0f8d0203164ec1ed1383a6037debc948827e140ef309f496b4c29fc4addee2da9e9a833a1b429dcf9e797f1ee21b2d59979a6d448c4f251b6a785f116681fee7663a021e05bdce0cc8f105bee9c2b53ef376e285699d238d5f8959997855ae3e839aeed2fe48bab478f03ae3f45df02cff1f3910384774bc65811f0d1d425458aec09d8b37de7cb75f3c77014f1c3fe767f9ca5c919e1a0a32efefe7a91d539377a63d8c91ca9899660b7c97e451b8ad4aad2b20396481044d2dbc8386b410712f5d48f0a7317823916d7d2c740c14d94d249ab9c7f625c2720913e7f3e8bd6b2a491408afc8dd1348cd5d935721f3a1ad2088be66751cb4385a04459c57c642442f0506576343c731bb0917c3bc0cbea08fa226005fca596ab9350fbbcceff363eedb69de55cf33518cc77b7ff59f68726607363acfbe2fd3d50dd4b32e6760609fdf452193f3147d1c14d3d86cfdedd4d17e4fa7e31d141759f38fe6395fe19135f82195207bef6ca831ace4e486fbc087bbd7f92cb3e67aa679e49db775a71369545763ac1cb6a642cc61df30ef09a96812499ee3243565cea9946317ec5e558d0c7c3db60f9671a9c21432aecf980b958bd80317495d92dc82bbbe49654f70f9c1ca025f667e73e107ce5182924dfe4e2c7b989c388bb736f99641731059e7677d3546c711ac65233406121028f53cc0f3e976829e8966c814c80db3fbd190055aa67430a4902a44feb66141114da70e9e7d29b393043a3f8bcfb1b6efc3108c0e2e88f348cb94e41754c27500a0363fc02eda26736bf82d63c42756f282f5faf2ac5a9414777df2d328dbbd275b53c40d5ac386c72a31567dba55be8c10a965c684ef02624a8c31ffbdbc10dabf80ca732886ba6eecc89cfe99f8ff29ec4ae54d6e572ed92b240291d9610a71692ef5b35396b0040580b9c2bb2ec31eb78dcedad039a295c478ee60343d0900e24eac52c91d1a35c183feb326e40bddd3bf225ca26681b7d7930332c3f6c93eef2cb7b01e9f37485c8916b209a0188c0bb84260abe82df04ff0b7000c0e43251e64491ecb25e017aa573012cc9a6673d8d50af7e6eae68e07d38ab44c4c53dcc8d8cdc6c3fdef3abd10ce793210067f04cc7579cdf7baaecac678eaa8237509fbe457b9b3428c64fbacd26ea65eacf67fe21b3df45d1efec58765240340fd9f0850aed3d290da1fef46d51ebd602abb391d7e6eda1706532d591fc72e3f58457771cc2c79b9c22baa0c08b020164887d80f5ae406649fb5691e7be99977b52d35b462594b1fb3decef7e37df99104c7c53e7147ace1e32b10cb410af6ff2657a9230e39585b1617be2600ee17a8da1871462080a49ebe020a51ac3e080305a6c3a6accbba0fa2008bee3346e25683a682d66a580b437f2afbe470b62f29b8de5ef8111a9b166bdeb5d21d89e5e25450038348a5e9f911d4acb122ddbbb8faffd6e13030ca4afd460c2d5d441e95c2310c0f16fcc8c8c74348bc62ece27e21c6c8a3b0675451bd93801a23a08d768fa573f81e53463f071378f107b7bf618f02b15a21aa4a06ef2cb83b4ed1fdf21e19f20388c596c1c924e86cb7dc46eff0c0e08f31ae5c06f2ad291c27fdfbf948f91bd5c830cc799fc31c9b5a7fe937856843be352134ca306db9ef78327a5ba852d4992e9e147636bf740b72aa704990c62270a52f5811b5e62dfe4fcfb5e171b4978b7b9a82217d6982c151a34d0fea215768d95723dfc632777ec147c84560dd59fae38ed9c59e18e0394707534da07e21e70ce94a4459cd1f657ed0422cf8d9da143f36f0ccb4f98e8114e52a188e933d9fce8bb876ebda44e8c09cc8b5ae013c4174a2332979688d8cbe43eba1eaef57c9428f4ab70955b115318725c518393b1773a6d22447410fcdfff2c3b09afcb0b099d88edbc66f29cf5523bc58c30b252d5e17d9ad7104ffc55e2d01100cc83997fd1cc3be46a976aaa2c5ec05d46be82f4a95d44662fbdb118f5edc3b125df79dadbabfa0b30d65b499e65053b4c81f1760d7a7747baf8263ee0f953bb40b7277978502e01812847660ccdf808324b72220550958797dc311cd538979c8ba520177ccadca1b677f3e5ded604f338b3f00b07815dbaade7071134790278cfb8c2c36b6d87d7d1ff1fdd8c50bc6e0bc1a7f388cfa3eee2179bdfccc21e95acb799a26d1fce82d18aad810dc14000b326f82be7be2e66080b5403c7e36846d52d7b4aea9fffc1ece9d3a9f89f04246f52fdc2937da5332d96ac04c25998587abecea56e9b5093ecd6589ca8d79b6ce93e7b9e89a36cd32e32c9e3fd09bb0b076fdca658541ad6999068974eb04c61fe355dc023cf6028346adb9071246df89ca1335a0eeaada74575aecbbd79fd133a3bcecdc04f18a659d9cec65c3c9047003dd538e5cab61c526bc97d38d4f920cb7a6efcbf0aab526b8eae6a69eaf0b8923c9a0da3b193f56197fd9011e39698d7e30d0f1c265e0f1801b1def022c29b8689a8a4e62773f50461b921249a5e121dc19b535096fb49f027a8e1a0e7394bed38389bdee0d7cc0f52555fda86d370c09ab7861ac6ff71d5e7280ffbf9138d142c22fb4bf797674ebab54e7f906a713c8b16feff971bae2671daeb41735983d311cd979401117e3555631c93020595e13ff25b7556ef9cb64acdadc85a98467c9362a57c6ab6014730e6cf2aafb74ddd1b4ec59a5e277352b745eca051ff2a04cedee89a6c48fd879f00efc37eebfe855f15b8f42ff0a5d6d113b42a3a8f3451781232a246052d458277c953ee68839d018c8b55c7249938821a1bae762667004c1f4bf02e2234854286c55573c9fbef85da87f4c432494c7dc54247ea8051b36b512a6afc389af3cbbfc75210da3654303ddbaa9f1e20a241f719ba470e0eebe434a41922e58cdd848e0b59512eff354daf1b2a14736c05b57a78ee4039bfa48a323f7b8eac5d415378c83281f34171c6ef82b7d7032f5e0df8d09085e0c97724b5c4a661d1aeb2afa5e24263a8e89c0da9cee75aeb9447cce0bed93d2a9fcdb04de1e5ac6274883bf694d0dc8d2214c0b61b37f4df036020edea1ffc19c37bd05e2293e868477cd477cfeb1179521754f05b82b5883fb42546c0aec38e1aea9b947cef38f3d9cc0d469e9929acef0badb126eba0bf9707abbfac62ff818481fea6432c6e7a4bf3420eaba8898389c320d214ceff997b3652bc834b0b54c8ce355100ccdf1358d9c19508dcf62ae048bfda8c4ab227bfe6dc72ba8cc56c831f5dba852518e270fa5bb2152d32cddf4183e1b3f8e192b92b66a2ad8621c0eff4f44e99cf1b2ee8e9417205817916bb4ef37f82858dfbb7fc437c55b5f4f992c841059b663d7c7795c5294c2cddedea91452bb45ee2b6fd65255b62faf3a87b58c55fb0e2e6b4cac117fe9691024912693662f1e4e212f63d65cb76d74f53c4d269e4aafe075b3c55be3eae6b4e06ecff0203f17ba318e57c125f0871d9e909b8d8cf2d7d6","isRememberEnabled":true,"rememberDurationInDays":0,"staticryptSaltUniqueVariableName":"302f04ab65624dcfc8b384e844909600"};

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
        