
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
                staticryptConfig = {"staticryptEncryptedMsgUniqueVariableName":"718946fc884e2dcd7080521ab17121ffca67c849a8988e4a2bc15ebb8ec418f72f259b5bbc04384ab3fe97e15c46ff7bc3a67dc3585131502be2356c69702335668152ad3dfd93285bccbbf8ea81c6139881763c71d5777b6d9ae88a75e6619efb746ebf2001e2da2ec59d9e197e47c4d1a074b72efdb6386d449925d5b7d6f6979863d4e05a502dd771530ac6e303afd9ad335e71ac725d26c8ba99ff76c2cbe9f530e29bf345077a585ad7f117995e2ab0ea72b96bbb948b0b1f3cc7afafc3c2fdf439e4002a5eef36ee7d1400b3b19b14eca8c4c87dde76550930e3387b04d36a2ab97125df92f2d65cc6156259b64a114d1212745696e310587f5cba1204e1137c6606045cfaa0330da087e565cb9c60a8b478ecc592c69d1e2787a743ef6e7af6b2ae3e07bc8e4629507edfd43d04d0a4ce46897b791e59af77c08ae7aee16f5c1d807e310ca0002049cc7a4733c643543b05526c022f3fd0d2b008827d8bd63a7355d0569e17ac4e93aac250ccba9daac1d00cce17ffef5a6577e15c74e99e7bf26b28475b5e9a4b0001eeb96a8f442f0c89abcef31770daaaa21ba02faf35ab96d1dba0ebe976d34d18d9ab42127a148a6354f8523d4bec2c284ae7eecf2d55a887392218f9f01ec0d711516e56fb411ab507e9761dcf924e2ee61394798ea8c5096f7df9334338ba702a671d9a927fb4e5505057a674c2c10b4d67300bb5a57438341240223c4cfef0c25f788b30a7158c89803299b6e2ac5acc1a21a44fe5ed98882012b6e3111e51b16064b22165b3f14f2d17be56711b66cec4fab6c88bd581d2a0623caf8bff7ebb3838fd0543c0360aa4f1d292e83b896c177bb90f565bec417afd6f3b00c2535f4342ca815f194cae3a7c6b90deb1a342c1ba73b7aea5159e4fa6927f5b630be98d244fc61a786f0205f04d04d3d72613f18d50e79a214da543414a1e4a0481ac9de49496235b13f4d10ad11a6fe8044186cbb33c612b83bafe7e6d9d303d1279017521d5d83d5133179e821acf72556b49a25fe06e722801a6c9d291022ed1b972542c77abe424366e4722a24b1f00d7606240baf388df407b9ec4320dd5ac682bb57113d1dffa523674d822b996aea58f1ec884249aefd432507dddb32989c8a2c455c041c5f6f0bbf7341e2512feaf4c8bf9aa8f5b4299c55404eea1f4bbed52962281768804439b33cba863cf3a39065da944a6cb1e3f38472264211ae3e2e5d7f669f4625512bbee74e813e8866df5ae57e4e8d3cf8355e0862c85cfab6a2c86b806f8d2a1bbcfab326c1045fc699c1589b95f915b418683e645978b791beac6488d6c57c9d8e14c17c72728bc6351b8fba21b36e8b6b8620ab7a2865ec53a514c0cda98384ecce75157dddbeb260051841b771e00b1021bc714b37fc9824706aaa64aae51aaeafa434fd6948a9fbb3dc27df3851990e54e57e8e70df81cef197bb322b8ecc4b42dadb1d5e3ac38c52b0fc7bba5d861bd19b35b607864c3d8c58cc145d2e0329babea8c1973bb337d261e806ed6da190057b7ca49abeb263ab35c765c3903eb63c0f120c04ba2c279eff14b10affc09bc57b5c2f89fdb75f2599ef490c23d2700e71760ce4c2ac0d394cbc9ab501bf115de3b6cac81e34ef61e16116b8a54f7b4075a529e219cfca3b79bd19399bd54ba84c6612ea8ca358b8fbdc0313593dc9a041bf9d5863ca39f94a0c56db9408fa6bad92fae35624ff4defbd3bd96181475c97bd41ee0a42e9e0830fffd6a331a033ca6edefb054d50fe47bf16e50e7fb6a076ca51eba15daa884ab883fca69c7e94fcc11e09e407e13ca152e195abfeb06a838b6349a6ddb2d1c155403cc786a2dc7eae3d1d77b7df228276ff2a643034897272dda0a2c4c7676297feeea733f1340643fd978cfa40f2407bd7ea81d3ea396aa39948f27c7220a2b7d01420b2dd03ae97ca5c1ab39d1da3ffb9da466d804132187563d0799b441a3458bafa0955035d929e68c06866ac90e51d3d5203a938bccf788f1f57ab03dfacc25edef5ed30e555bf4b65459e415a5eed1817dae31b20f3b142efbf1e214c0b47c34d70408d602e3e8ff38addb9327bf63770bf7f872bebbde7d0a493f839ab90840c72d1f16a25743439d0dcd298038b7bccf35b0b6a5e0d33d91ce72a10f6b161698910e54b61db1a89962581203bd0b5fa4e9bcaee57de1300cdaa9d3d28fe573c965abcd97963efc06fb3fc31f7f6e22c5707e2d18e671e647a085f54389ded0999c5aed28a90729f223c22c65aedb65802347dfabf4d9887fe19b55e3ecca6580c8c6ddaf3b1c05bf66fd124eac992bdfc49cc0aa2dd1b820494f0183eebb02838e31dc37495a2aafd020359aaff345265a5977c174d62e85f835da775fd70a271f10523d652b32a03718961d38d13bb53401d84697b2fd80b8dd237e4f394a6b31b1cb0cc6233978215696d8602db5fff31b8ce23aacc7a17345208a8fc34fac900b46adf06ed1a36b7fe59a0c5ba8aaefdaf296b23c85398692516633de2f262f632f3a91b084d1ac4560ec3761637d6b168d9c70f4728ef5669a4a20d376375d7e656bb64705a31abdcb2b06ea6306c0472f6d4b1c68d5d8599cdb2ef9c7929c1641cd5374a01726dfe0f8762117841a4a9a134e2a6feadc84ce9dae95f419fcefc53ff71c7eedaeb92f01995d3f6f223d5c4c018c79553a69ee04f3cd14de7fc504d971335337bcf5e95d4fa7782b0fcc95ee1668708958430c139dc94f4684841538700320138af2a8c680609f189eed0c17b17a96a23fde831cf292369ef40ffa687e03e22983f4484017b2c8bc37dadc4267774ca188dbe011c042c844ff9b57ff0c36923a2256c0aa8f213360148f33122bcf12069258625a9fc2862b37f3255592ef87b402c91689b2aec9a8864f9b95e50ba436f289d1b3eec0a21fc5d9d9f4368880a92b8857f5e7afc80b11af41a75420a7b1b7557ea59cc8bca7ae314b60e435f44a42ee5a7b23e3cd4695e00773feafdcd0015346cd5f0436ce97e511bed39d0f25b2d81d88fbe113b20afeaad81eee82c3d04f00d33e54d127612a1e359ae8251039a1ffe9630a810b15f8dd4a488cdb588fa1accf9ab1a62cf48a38b018cc2cfdc0fce8a70f88f5b34a32d32ce39befb4046f9ed4ecb8df4f2531fd32757f61ca0727663a8feba1f7ab360b706876d8de46d2200187efe736d6940c789a8d5ac44ff5f1f06890b610998eff0b813c9d59b032adf40f412e15e0556b053fe194ac3c1a6b465f97c9fcd39428bef85e0ee6e1f006fdeb4efa0b9f04baef2847ac744c2e41e15032ed9e9c9d143b127f48a186fa9e45c46da25734503a4ac8999663c4520b909f1aee62248d3148e4851d71b00c05034b8744466d487ef4f1b4ca3d35f0cf5c6aca38b5445098ebd5aedbd2ee5de2de1dc06ec58e119dde49324d6c3fb470f2e638244a1e067c8b4929419aa4e74082eec07cbb00c612248b5d308d6558307e50ee4c3baba594c348b243a051f09f5db34c76cab630be9fbab5e57272795eab3e077e1e7b2ddc33d5928c97da640d081437f179e07fc51ef97693540b7c06601966d159787e9837483753d3247966b61d65b91bb4ff3d73b0ecc6cb8447fc5e9240aedb8ec3888191da3d8c4c85a1476fd4788f545f1b6c9f490b8cc73f3e65619ed160fe8d06a7b5075e949d8d84a5cdf4180e07179ba1e5721a33e7a07bc5156ffc1e947b08b2841cf3a414e0ca2da79f44fde9608d76f16df156ddd726bb5f20edb20e0a47ccbe0fee7450feec3b9511f78de0f849c76fb0f7299ad67c18d4d21b089e5f021d3b577828acb89864450e101041e40985f312418e1787d2ef950c34ab614afa8ae9e268e822b0747d7099521f3f1f84341e0876bb683f0ee4a2bf046af562e759d4bb46781b01da783d910f9aa2ee8192eccb429f3c68b3735cb42d59e679cc6e8edb7419802dad20be1944b626622a66ad3ac14bd40cee8c305abb9e1075e365629c78eef3a3b7ecf1dae78c880cb6374d360816abff1220fa53f64fb224b3c6733d85d952f61ed9409e90e3bbb6066df49c74af6c3b6a4fd2ccb60f1df62798252fefe495a56d7a2c8fef48c547da1e626c089bedc7b4fc8ddec333493ab8b0d50343b25a2b737dc5b2c3b81b3f01fef90828d2ffc439c18b6db2bf78174e24dcd71d6876fa2656fde93cfe18d691ab7d7a85cb5a9faacb865808c4d6403fcae1d5d2beb70bff38d3b65fb91ea9b10132c0c90ff8a0e9bc200f6ac200f93fc2134bb2296c2b351a9ecb21520cd81af73db13ba58f090cb88ddf2566dbbadd3c3e7373c1de5768f2ca0dd0a0870a8af7b1b6a44e9745d95563fbd4df3501b3409bb47697fe398c14c27c00c64ca8af6d77891a5632cfdf6c2bb74bd73c3c2ab5daa0d1fd6438ddd50bb86aac813ffb2b5e56a2750226970fd3aab5f8e12b7b31c8b012a24f7581c41af4d3d8e2d8d85bf7ed3cc6c9acbd334d8b9a76b2e7c91478e4b759ee4a31a0c8bdc5eb51090bc9090b6cad754c6461cdb22294afd230b7078871c8db21c1bca9ecf0416f113887007431cdbb0232d9d30d5df2e7a2ff512456e47db134baad3111f0165ad407d5c8902e1927ccfd6e9659ff1c2e017cc1caa761aeeb7343183f98785dc7bb68c95c41337789dfb157e7924a02465cf57b7d217f946cd4d35c76ece66c3d489923f7f87e21668330825cf3b2860c850e4deda0870a5b351207f5ab22a2bb15d51b4381b04982e6e92c2cec3dbe064d330bccdc4c275ba94607229603316bbfcfdcb804663869b0e38c54b1e54b223d364f7842e076b6d6efd4f2a3d6c2986ffe786be2fade41067bef689400f687db236cf0dcce56a84cbbeae75499ccc533ad91f62a3bcad6ab7c8ba376f2314a27b048d7f4a3d71e324d8bf6cf36fa9fbbd312e57c0f3397d2389ce0b6907ae765693a48ca301619d3c965fd6a3f0171f865ee64793df2e9f48d3124db0606d7670512490c35f2567f0370dd858052dc169f2940bf0b6efe2f70a6a0eafdd76e5102d3ae58d3af9811e45ea767b2006361222d04d1e0299ec24a115932b350a2c313c2c85e112d61b6da361adc8798b53b520f251d7f626e66aefbd2be9fb78a7f043f44b95197c8023cdde319954b4cde431c052b889d462e9ec934a39e88ec7afb4fe162a3c906f265d27280a624c41f4a806384506ebfc672e258dd54ecadab68078092c2fbeb2f25a2351b3cdfc8fce68ba8ae38ca51f2c09428dd4c6c95d1e2bed5a8ffaee6a95e5c7c006c1c17a939b64aac0f2674de4c9c18607b8797648dc53730e0769d755d867c9e420de7cd55003b5e87b67d23db5c6b8d7923199b2fec5e5521182e4e65abe90a6a4e461d80c90284dd82b900012f91fca28a2f323942a33f93668a827b170022f9fb779e3cb923227288f74e623db6882626e9302e162e9e055185a3ceaf2d13f320f59f69a2dca416db64c3d1542dfc1cb526f8e5c702b746d8dad9f0ce6ddc3c5792fffe9b28c4195eaee39aa9196e8d06758e6b646f964878ef18226131c0084dee91810d010fdb6b57bfa34f69529c662e64720032f93a50603257e58a6f8eecd85918d4ffdc8226a1567b0f205cdb999e113f462069e89a0aaefac90b9930f6d94ecde9f3104af67eaaed25f2ab7874c1bebb40764a5f0df0a51d31794b17a22dec5ae2ffcc79d11406fab5dd9210d232e2ac1e380dceaa687095cb0f308dbff40585d5daae2fd665fbaed1fc3dacf5530fe7760e56482a930e6284ebe47e5ef8c14b82daa8659bcd18882643bc877ca8ed733b9c282a28db37191a7c6972fbe0618c65190da223a062b6f2dd45659f9f247797444cd9a5f1be448bae4188ddabc11501e0a10ed69aa7a17b314705469c5c45416e1abb5b3a01aca8f4bcb6908de513243d206671816248bacf5451ab5926a6c96d7b02c466a09b897b40210e0c8c5bd9911f7453cdf832e997338d9988a247ab31ab909bb734e923569dec6a28a277133e3c9aeb528d8eccfefd9fe5198f895d12e7a5206fd95b15b97e344307be23cc4ae4a47730e5fd875e00af661edfafc27725b3c1a346c644e7b0fd761d8e972f90c9edda5dcf7ddaabeed47f7c599810f7f4f4c75ab268ef424dc914f62c608d536c4fda43c83fc94518503155242a813298653d27ab11cf5353a3209444fc1d185cafe528e90ce028114bd0fd26bd034a8ab2f99a51ec3b1036b54d09de08ec2caecd4804f805789dd4043232c4a1cd8950e498b523e594efcd7eb14283734aef4031fa59afa10efb2d750e8c99798adbac2fdd49187e3c5a737053f014972d408fe4a5e0a348224aa85eede786ac7fc6641b292110faafb85c41da5192d3e9f0a9acd5e41ae68b038d50970ebf9ed38ba7be473db23c8aa79de65b928eceac427f24fbcb096fe71abdd9c191cccbb95e76c6c4cd69d76871a6a34ab4ce0cfe9c3dd0df53d8a947a147b63fcdbbb7eedfe6de401c689aaa2786848d9e5c2ac478d1be02a625067c21cb60cd9a33ce9bd1749ba0586edcf8fdf6eae06e4b86e6978980cb982ff06c2577ab70a7395f6931232a1f74fd923df38915fd7b767ce34fe77787d217d85a5934ada8507ac55e252b3aa629ef712d4793d84b0c9f1699e878a2616ca580711d7bdb84a71334ef3fa4b6a449457e6daa6ca6c8fee6252343024a53e13af31ce459e7778ac42451d9c9541ce1bb3126b0012210fec45e88ee3c4068ea00e7e4f834ca219055644452d2a13236d59d275776994aecbd2830c62139692fb5a46a7bd6f86d50d0862ae83e9f0adc4e5c86a136ee5126cef37834c010929a6915bd2b40c39fafee45ded7b63c76ddbbdc6634b951870ba4f76f7b4cee00a7bf5cea144edf0a4f4425e4f6174acfc631ada3e7e13872a50b2247b69b76362018fc90d6b7f7918b1e9a522ce3dc9bcc4d02cba9210937672ac4735a84125f8037aad7b2084cc6fa43fc9886f2ed899d8c71671c449ac1bbed3125062cee71616b5ad120531703b1c72f60906539fce79409f91366104dccbbc4b3d5760f40e61cf8565dea82b1b17b924a37066c1afe4fe9fa5e9b7d96c5d38d1f98d007f8ff6a251302324ce84b2d12b03c0e8b80d382a64051db48375a9ea213271a5baaabcca2074faacef8690b0157efdddcbe0b48f73491f223d8dbb95198060119fcbbb0e5a35daeb6f2ed6fc15af11426960d153745fd375528cccd6fb91d9a434bdedc5e2204b663a9ba9df50d0c81ad81c5c66f8f776b0ddabc44bf6d824ae725f7848b130cd6b01c1cd84558444b1e4d398e17b8c66929e1f1d0f7143ffb5a35ebf2adb71dc2eae6e890a2ae1854fc66a94db190468e1a2c349db1bc9f737b734b5eb1c880144a207882f961447694a65835b8e2aba7b6cf2a0607367a05db3b26a1a3d9a884801af89dccc5e632f5ccf08a04ae8690e2a0a3e3b8f62afc74d32a8c9910752c6a3a172eb237849087446f9f783620e4d47d8726d3fc9c150f2700341ee09410c18f98837118970c5dfc59c437a042b2837b604711ea237e045f6f8c7a80640b8ae8abb9e007260364d65a0780167e2c485f149944f3bc536ea32e97134c44c81f277b5fcf68eadd25cb7ef31fa520fed6aee3a81ef9a6c403ea4667fe6e89cbf4ca9e38d52ae076dca2768560c4b9864af120769f3b8ea77181c66005ea7ad87dacf3ce795a7fe35d3d0cdf14016950cd218270cd3e846cec1de153798234cccaae4abc6bba6e3a585251ebe385edbcc96f2ddd8387c5268578396d3146732d1cecc2e2361179428dcd4719a0b40312f2d66affda0be986748515d94184e866f22dea537b1967bcf40c4e83d7cd16c74ed106bd24f9fa42fd62df13638cfbb7c94f646b749f8d92f09dc6ac08f49e12cd4cd682d3661c67feaecbb1782d8d9aeeb4a9357d9c725f74a2b96d4f6d403415097c6b10157342bd8123643c670ddd001276a0a24f9c18844e958209886f60bd88d8207577dadcf24928fd3b9b9b4ecbc03609979cc195f3233cfbdeb08672fc0662fd1abd2914679c947e0ffe1a45b74356ae3a0c7056a5a74fde22a513f08e008c46fa688527348ef353f4ef3d275d8159babae0cdf0aec27e5e1a6596e9389de18b6a14017a6cb27c7424e20d1246fb138206866e8dc70ed9b1cd106978cddfebd20457cd3ebff85c55a47a17726590322169116beedef810ebd3521ff506f05b445e74a7af9c8ef14ba15b2e5bea1d320ab55952654322970d7f50ccfee9a6c9d6a45de63259e61bcce380908ff27ac1d911d6569140175bbd3687e7d32fbbdb8cae48b513df3f6ca68b88b7ae2bf0230628b3333d5402f835cd078125d1331043f60419927880ee8bb32066629a412f569b519df506bd98348b4e393cb61cda4736797468a4f82a74136fb69c668c5948e74c77b17d44c34ef8172dd91b4a10e0e969a492eb86606877fa963d3494c45c3b56f3de7a8fe6d37069681ca484705ea2fd5ecf49f0e38c681b4cd16cb11c306cb6f6a811500883c63ac71d9a72132dfb3207cbe5c7d9748955ec048b67f3c0281a12d150d5ca81e83d78c14c6dc8520afbddc0c7fd5aa2982937b481ae59841b07c79fbab65d882daada34817956cf9c330043fa297aafc71f9b30de94da0745f66baa0727925df040004a38319eba826abf4e1387eb4bdf898b07d6b3de1edda1299f8ff174c52d518564955e78af8206955116161cd0733c4fc285c1b76c61ec1f19140dc9e215129c6d6eedeacb79860ec10bfada2076035c9d2dcd4619e9469fbdd48623369d0bd37ec76cb135da3d5b2311c474b85707e3511420698def2cba0e3f2de1d077362325d04ccc2350255e6487df9a9b3e48295c4302f4f6aa4223a5bd7c926d6dd0feae32881aaecc840708b8f13ce651b8f1534b83d37787bee07dd33ceb8fa0fe7e726f9af141421da23f58738fcec17f39114171491df0e40460e26c1faf646946e5703dc2ab1fd6750e4a804ca3329400ef433d4b72902322cdb91c0cb66e1339758ec1f81623e8236e23a12fc6f70947a594a62c24a1210afe2789a971ba64b9efca2ef89fb9c8862913ef52d0cd4fdc3e90b24001d5350d724c3d27cfd93f45906f9f49dff29c0e95bf2fab713e3e59a58489bafb951fab98f084ef8101d551ccb815a102d0d56569b798ab55e801034509e1762d2feb384384e2540e5ab456310391051ffa264cb791e9304567e2612745ba092fa5704985930e704f813ccb3f879b761dbc6ec7631b6b796f2af93f27c46bb11be843690e7472b6daf5b27419b545c1aae5cc5b4f2cbe39458b425e8c958848096b3162808a64c67b3742278fb0cd39c160d2260fbee8d30b6b9d4b4b358116de685eb690ca07b178486d40ae2033a9c517c4ed388498529fc3ace025c740ec3ed7e0e2ce92faf0ae9b0ea60076dbda5182bee691788a7bd4a8f8682169c7c5e55b543ce7ba38140610d1c33b3e90cf38a752c5cd88c2d48f6c57b0b5d72b339c4d10cb49c1395f28bdb888d85517cb74dea2ff877389a8d2e5df0790b077e1a4b7b3eb288eed696dbacc8c28982ae722fdff316c00b695c939747684091715fafbd936a7b6db4ee8cb21a4b15c600439c044a31aa303fd6b5c44ffaea4bc78cd84c2aba6d8389da12ab5602ce71cb5b4a81f0caef35db8844ae8577d219d4c76d934e9b9312e83131a776ca6c43b971463494d2d071b0418d0d71a465ddb2e568b44d7e52f3ddbef95ef4c07b8cca86025c3ef43267e6f577eeeda9ecd23b61ba015b6a6ee3b70e920ab17f4d0344c157433dd528ea98dab1cf16423a8d50ac14ac0e730a79d3866c5f2a636862bb061fb8118fb7eaa36df5c963752f306477820b0fbdfd385d9d2b87d978fb304acc312c387a6b78094b4e507adffeb33fa4298b2eeac95e7e36c9110f568d714c6c44a8c4ce95bd06799123a4214e831dd72a5c0dc5a1f7fb92417a7337773af9fb3ea401e112324f825c87b3dd492bd59c397a74394a412d7a4d07b00500835719458b0f16c5c355c32d65f6d78a7886c3196836f2a5dc9d9b97963152bef5e4ff5af596c64957643ff4c19a12a46fc351d1590aabc382803b7a6d24bbccabbee0fb7bb94e34fb7f9d0ea2bdb36b6dfd7459b9ce5309076ca1fc5584aded75525e4ad035c3660a39914cb9c5e5436b7e1e9a3aba4fc02b734baab2e18b5f6f7498aa918b03959e86246c05aeffae88c635304ec43ae6dc343b9fac14ec3432e5d3fcfd09c829bcf64fd01a7676f1272e1257eb842d0f4310e3ff1fe73d026e61c5fb99b37d562fea359cc9977e36dc1aa934ec3a409d93e80c5f5e258f6d6a56e70452de26ccf542c066245d321637e26064e5eb510d4890679c2a5b203edb050532b514532eee4482ee68b15af7677299d7c7d13594bc41dfe7c79e0eb451631330f211a7e6e15d888cf0cf9db7b0f09de999f9f4b23c0d23b60ed7fdfb2d60cfaa06e0be9903ee6d03a3928f1a32da058fe62ff690b38e5ccb18b8dc91458fbd3407e917b8d9f40c8a4cb52a0b30a0a0f8b7a8480c60c0034a2193ca3ffa5f9155406be4b5ca45263aaeb3f999ab26c9a473fe8c85edfea7b9134633a91b9c74c6956f65ec852f3cfeb063f5e1089f1735efa7383456664b15031945e5878f4bab1dc0219a42cdc083ad5033d55d8488e7acc87fd35fc1004ccb02972fef03997bc303a161fe9301d918de96ab84287ba10975e12f896a7bc0169bfe309283cd7f8d6bec294592c3986ac076ce1a62c16e88079bf60d8e51d3b2d7066931c9c78c6e76c4b0351415b82a8090f7f797f2a858cf28858ed1172e9bbd6abba3cd87fc487dfdf3fab5a6cf4f10fd4c267ba6935c16329c1695865e4c7ba2e21258332fb21145623ccf3f3d3ab3bd0c6fa9e77a8510aa6ff9c34681d5de4c4929aafab3648d8065575f148d1141675710d2b5d20eb4752b0aff54cc39f5e1250bb2fb020c14f9898d6833870b663fa0e6859d27265674e4b46f118e666709a4955d0e68f15344348481379cae485c214001289a2f1d7071b3f7be44015348c3f37705454b39404358745c8f964f0a870bbd6f2eba9e0ab3b02e3f6d5c0eac47e329a28bd2d30e1bb5f35f952d29747edd3952d6542c70583467be1ed6243cfed1022e6ce2653b070a7b9730b1a15ca14ba46862c3fa3ec603d2ee70d12a5db14720fc0a5d4b4b37c874fa55b9a50032c53db5469925c95e007d005785190bc24fddb6a788561702ce418ed757e487fbc087a730a7c6f26bfbef934e212e233f17e25a2c5631a88b16c0142a1723aeeee691d22d57bc935561f82757fee4f404c0eb477c71b31e92f4b9e58a795239ae15dd2b03aad6d03810238f9042655d3f0e7fadbdb77b01353ed06e4bdc0f5b4ad256b630e1abf0bc01a9025c780891374e90d7742c8ca31e77aff0b9606669f2ca72f9a6ae5951e25025699e247a868b7dccf9ba0a46911586ef8a80da3098c67b7673caa30c3077bc210743c0de3dc713efbafab2b812f75a142d65bc3ff375125d67ddad9682b361518f7e595c76aefe9e224d0165bf8c911f0b3e0669784fabbf2265f563fca8a9f752b5133dc3d461f349f79c8172bb18c7e808fd181a3b08319fa7f65a40d92d912838a450839d57bb8615dfd65759b0e4931e1e64abc9405a31f0395f9bdbfd266f02fe361c377b051827e344b7e0978f9196022065bf7569187ed6dc3fd0fc59d937d250ba2d4780a8145433fffb3fcf8bff41a884fe493d67e5d6c6addfa13d7fffbf5a66772e4d9c73fa25c2c666377f5842c03af88653397804e3a2c59b3c3fadfddf5c5cce084edd4a1ea977795349a00ec90d636c7ba901c87ffe0ffc8a812761465d5a747e763756fc6a0ae12ddba2dff98d7ac3d72ef39a3e81a60a46ba5aa79905e3ab4d86e4fd643d62b0612a9db0cb25b9a602dec36ff0691d6c0c2e41761ebd8eb44da0eb9218f6c43dde1b35758b7bc02c06752138ed055a2077ae2914912abe2e53e828bd34d13d42a61518b74eecbf9fb66e572e5abbfd387f339322705251f2aa79a32db6ad10f7c3a163a1b1532c5744afabd94effcbb9818ad9673ef3c7e82f3982f2ae6e60cd54c0af00c97aaf594561087c78e2e06c4ca9ee2998841849f0c1ebe9f351f9676cae828391fe495df665527498e225e9247c21edaea7c9df0a8daa15c18dc79bdeb472b6c89d8d43e6a6def422d746a237277157d5218f22242d46376c040cfbd93adbcc70142ac48ea169b4b23e9c157d525040fde4c395c18c874a8908ef27ea84f0f66fa4b516777be3f2199f93ab893e04f45f7df2f2cb55f59d554dc047c19e5d9f12c154d23586f86a713b5d745bda89cc4f0e948df694870c37ee944f4f34221200d11ca78f49afc6937d22e7775f42217a8e28618778a3f23f81dfdae5cfefa37de724da33c0e86a915ca148794a3090bea8a9fd1ed46848bcc29dc03e3e4451cfbab9443680566f916c7de9ee2a8427dd16e999cb08edd933af9663b902de55d9c31002bcc80ae7cd8b6c7e1143f9dc5b8222baaee33fb23a84480d7e8fc7d54c45e2c5fff0dc1399096b5d87ba8aef7453be72994226cc82c90569bd430d5c9bf9bc31c230a5afc8ab260ae25fc9d65f841ddf8f240d368f3ee3c3d2299e84b43bf213454f70b4b8c09dfbf514a6ab212b4fab08a0825d5615330bd831bfdb70bf1b236eb6690ab57365c11f36bad2df3e345eed027ce741572af3c68088ef95c636477c02b64dc7be5fd189ef764d3fbe726a0d32451b60cadad92fcb3032bedd4d4192cb35cec541efbb629067d97eae512a4aeb41ffd7625ca363e9e6d280c7e473cf165d574f53bcacb159405e32ebf725b41d18a0c356632be41914f09af16c06a0a08ec5117a9a2164b59dd07b2575555a473cc6e2101716d093c745308ea7e55bbedd8382d517b41006ffa8ff67a4625eea63e5be4f790b7ec6911d0658d79dfb12c0ee7e6ead8ca5c9f84c7395aee21ec5657319a4dc6eb9ddc94c980955b9144704ebd4fce6c3dea23143baba420162b13244ea216458e59d1e07b1d81977af8fa31f37cea3f621d1301e8adb5fadc59d9ce5d7e84b6d302921b04cf7a5592d759d2da2b14294fe38048f89fe40611a73e8bc5ef6e4f0c6c83c66724c35e127019577a48cf12d44d11a3ee40e79bc2aa04c7baa7434f2a9c3dde5f3175cb67a501a70b30cadbb59eb0649747786ed3766014e5d4f6eeff680d1030820ec42e5aedd3655991a7adf53d147af880ded1ce5ddb5ed0147573d929a6e287f00277128682fd921803481b8828824bb3d689b8ce213a63926b4acd59aa2a913720ca7f6f35a2efada9861275dbba4b5e79698b7055bd9088bcc31d4c0c23eb945fc8aeceaa68e4a32df35603f61784d2cc87342fd673347fc3eabf54300ea66cecfd8b2c709c564d4f02d90831079ef0e34f48404ce7bf7c6d9a5546d356595d851f978e62f4e46066d026920611c4480cdf7b74e871fdb332fd58903f98892144356f9940d233140da4f6dbcbcc968459db7ee089ac019c77ff0e2d8f57994a17aca787240dc9511017b956f3c36c12f976f36e7fc9588a2c6fa78addc9d962c0aa388145e540f3e775f87a3adab21a80e9b157d93e4f581ec2a7537ecc98ddd992412a8f4361bc70483af4f65827164a4ef0e13f46e5276104a137b2bce93d6b85a80565cfca6715ed55f6e546f2260b93acb62784e5be037eee011aae4dae30a919468ff1eaabf7cf3226e01c72eded35a1043be8f51205c4a424aead2ca0ecb8985c12e04aeee06508dcafb3bfdcab79c179aa4e99547a4208b176281e7d8c37ff01fd1233af76f2b38fe3e5d7391eeb64dc1764edd501273f89c4462ab6c3d3f9489cc0424b781e4acfdba7fc980d3f55254afd55c6eb4368cc460d683ab93d0ed8de2de4d70c8dc86599b5130097f6a0f63efd8e98e9157044369936d1d6b19c585150adda34b160cc04c35a5a54eac294ccfd6c81fe1ef0bd233df02f1a2afd3c763a325c926e705f6f3729aa93aa6e6582f9c145d0218411602d8eecd38c0c0452a597c09c8fcbf078eb9b066c5b438d3bfef3dd6f8500a2cbe4d46f0b2284a76af4244c0fbf998fa99471e8eb3f3658095f93580ff8d3f12e3f70370234caf2531cc5890960e6e880379b2d158e94dfd694e1096e5533d8effd06d4f657b971b8ff66e23526e14feda9875c29146758e0d81e3a030696bc6ae30c0089704814bb64a34db8b3290a35089343cb72fb9290230fbf25f26e548e18c1aba77163a58df579397496bd0648a5eac3c3d110941c34e6a5f7a4512a989bea8066664349b3cbe84e3627a55e58fb53f0f4e554e54dd0dc5ce839c21b29a8ed1005fae22d80261dce772bfd9cf4c74bf956ddf5d35931b5325f080f8b7aa109c7f4f92646c21be013898d45022b943f4e6f72f490c39f1757fad39f3271b9a06ae3b7388a76f3559ce6fa3deebfa9c8824ea0b231bf9e825d1810f58f66895ead89676a054fd793b2198bd570fc929beb85072ffcfef0ccea2d75546f0f55e43ce81009ddb29658ed0728856a0d9d947206f129e0e0c3281e907fd7c4eaf5b73a8583e87fbf4e769b2c44e81587f0fa05b1955ad86df9e6a318013a94360a1024e1fb7f7b893a6b49577c67dc5d192212f1623a2bd83805c134ff429d0c88556101b926ba70e1577c716c955bc1426167b226337b6b3bb02ca20bbaa180a6a1fab15b108023be0f07b7a858d4f79b9ac0ba3cd676bdd2f2f762b8d4d0795c8ade4bbbea2dd0300d5adf390450d27dca8fed8a75cced7c599767c4cdf6a3099813e1ee2f18c331fe3642f17f86ed92683fcb9dd6c788757b9c1d45b40ca78d82bf5af002deb45f72cf45ff232c433c38f59f987da042d423e2b563c5a7e938da131621398eac47f659120a4efe1ec662fcac1d0907f83a051ff84cd7f0e997ed3b518f40e2b703e72305fdc48d8fd897734e7045a0f8747dd51bbf2b71a32fbd7cf01523ad22cd1399f0d9286d5320fd3c610f3fe926e65a2d7e696c61438f5f899418d2f468eebedab82bbaac9a8c2baed5768eab767ba9d5fc7120105618fd313f90d971498f7c14c3cbf3e741ac11fc48b2bd67f086e4a5e2c89eca487f67e83b407a0fa0b228d5aaf0a4b85148a1f1223b4bf4d8992aecf3c15f2f808ccba1a4c9eea6cbd4d481576e580aa04d7ebf82ca9a7b637ff2a2bf5d8937203e2fdde6c994d445fd391d0ad6b3e42023df1dc5cf64f088370184a2174be976d73492332259dec9dec90722f7726c7a40769a9efad67df76cb853868da112f033ce6354329243255f35e38b8150b267bfcea8ee3a95ffdb7ca18b9d9893bd23dd1c21816f5e093ec82884bc68539c9d30a81d374e101b3958e55b2e9b96af355af19ad21c9d8ed0f17a8c2e05a237f976e20178feb2e76caee1e79ed6ab4d40293b6138f768cbb39a06ebc0976d23ed53f640fa310eb39ee03f216dba4c97947e8794d283787f3c5534815d246f8c52cddf4a3b3d6ddaabbb21770af193f2531ad6a62994f9e2cde335dcece5cafa215b8ebc84522f552fce57bd08933807906a7bc8651cebb90a5809933f913fd869ca8b27dd3d556ed46b1eb47798f8a7d30fa79146be620fc07be58965a686f2030e8f2d4d9efdac6553d536ead34fbac210a2aae9e124734bd40894a66103f906e6e4f6c5e197847773fe5b333070a71153f2d2e2f3f05b4788a582f7e182d9b37de72e3ce3d7942233349bb9b40362e8fd5ed8a78d61de54fce36ae3059f5cd69d683b9c8ce6faf18dc58d98a2ecba91f95a11f53cd40575bc472f7540ed77ca30cc188f7d488574e67dc1dbc7f32b8cef28b3dd446db7361904e8910c8f87262af078f16611dbaa76237e0f760cddb69367ead29f87492a48f34ba285c4ef841a54c0eddef07d9e01d6979f4aa63d06bc1743e77c47bcd1d994873aa2670900da368fefbebfa06a3b72cc42d555d99dfed2685392432bc585e1986d714adcb8c70bfb1e95ba971d6daf350cb67181e7954cdc55acc13449654b16ed71a938cac7b3c8365500b98e6cf554c9e6e7613184ef667f0a638eed383de8bcbab1957beadfcf81830dc5e07d3f6cbeaa49d974af0863837886f952708f3bbb65fa2559253b9518ecd7dcf07e5ba90f3208074828e7796bf6d13d7a176f1b54be6f20ca9de3a0bb68e5013561063ac504b78e898eff5c965de864caacc0363bc3fc07a8929e6561ce9397c6f3cfe8e6c63b6bc92b55f5f443b09c5827e3d7e421bf08c4ecbf5c8b9209fe4e84f6fc30ccdbf0a809e3aeff97dc1f0c777cb5a0e924654986dda139adf1a927ed267c12619f0b3a980010201a6aad1a91bf05cc7e47416603924c0dfec6df0c82dbd7b6bc63c35890e5ca62e7906bf9e0d547ac28a674e00b127aef86e2605a26e3717d710fa8ec77fe33a9600a901205d72205e5fb8a19b48f9122efb7ec3d03e9576bb1efb54be21580fcff3c11371a6f5b372f6144cadc2b9bc9689df6091b7c4c15a8f445445d3f1987b63199565128d9b6cc49b70e4c5a8d2807f63079abdf065de5b9359e9b5f88e4cd85e1612b60196a2b9aba9c48a63afead0ab92834d67b659703dc3fcfb49b960598a7b89396ffcce7adb8d9c6d202eff64b2d134852170d857d26f1dc3756fde72807148bd7e8098ee4b0bee24f9732d60c557e3eb3f09efb91f20e2d96ffa5b8e82e5964ab076d2e3d55936ad91a429e1ed9f2dc79ceeadd0f3d123a275e76ace1e1dacb2215f9a2720ef4eaa7b6144a68c0032a640acde53a30d24e064e5951c38b75f1dacf89a80773c4acc92237c1afea89a7b975e47b7297fee7054f85adaba2c2e2124349040a9fdf78384e0172c0a941d035784918c9979359686cbd28f6dc796ee81b6e73d3394ca3e10e9a66952798feecae301fca8cf9ed40b7035c8217fa103f28f035cd73df7fc47e54bba4bf086d995f2dbdf15e8ed30e91364c19fc31282eb65fda562c324ae1e5f9c4dfc805f464550bca653f93de3f56d120da790e9d0aa47236c7b202d5371722e020632ec1a776050fdf22f781941bb1372d676f126ac8b788cd81dbdd8e13d3ab994c3f89ea4444f85f00e3916c8d9387170742b7d1b28a977817970ab2cd8435af75ae18390e5dd6bda48892b0d4fd74d432fc7b9bd477fc5f1eb1b10550d8ee5aab28a921f473dc476794cbc4e2231809e7b0b3f7c99b55a6ed99a4a7501200ee4147aa4014819565c8924768feb1b914394476663e60eeb24089d1f5f7a3580fe5f72180e421a81a5b0ee06f1ef3d3a54af7e9383f5e7041f7ef1d3c5d2db46c0573a40eb52a5b4ae2f63bd1d806d0e8696e30a2931c0a8d995497e32f083742e03ded1571ea6bf4027e21a25011e959802dfc382723e676d876560731dc24baebd032ba955f4327b1fcf8ef3f3b3aee00f41acd15345e19f4018c4f902991681decc872015c2068affaf040e60ca60b3060671369ddeb25e5446be87ef160c7510b48a96cede6bf36e59c842f3e06eaeb773fdde6a03bbec1fd47fdb5da3d5342210303dcc38f729083509618abed2a575b62f97cab76f945253ed978261c4744435f802913941132500736aed0e2ff7878d7515c5757d4f0508b4bccce5b5c6b1314e89f3dad13cbf766245c259fba1144fd27e68a0c070a2101dd19ba3c1e8cf1a8ffe77fc7bf71a1c38f4484ef8e39855c55c5e467aebc1d71584e4284088dcb2abfd9e76b81e64f1cb286d49ff3d39a4af2698909e682ce78ede184fcd6486ed448f17297779e4ff3f9b0a98feec4128beb62a604dff670bde8cc66cbed6a2fcacb1ddac92efc98d3117c3b7aeb6650b3e0544d01e67de5da19ee317d3ad45d9b5a30526a70df0d384e3b29d951b4be63cb8c55483d3b92ee7535a7f02dab6080c7f8e3e15e3283ab5a93dfd3cf5ecc57b0118db9344fa896d3a17b7e47a03ad50eb5ea1e18a3f91fa3f50b1cbf8ce9e68be935509221f2d4fe38b7c480529a959f60e67541f7fbd22ac761ca4ba4da2fc905fe01116d17abf1eb0f372cf4a10eec83ae69f7a4d1bee98724fb56cb322ee06de81c9364a08febfc960dce4d83e2e438c4f89583ba2b200be338e50ecc0506591ca500ab4f76c68dbbcfa5a60d0187f9f43d5c6554f972a92a638fdeaa6896f3d0054e4e8e9a806bbf805141eca665b0b79e0df180f71f5ffc14e996235fae826980e4f1c361b1db767363c762281bcc29ddbd52786c79e403544c70715e7bc36a01eca6b848da829d49953c3146fc50c300f1f92a9451ecaac02c2786bd2b5e35fc147cc22fe42a90bd894e5d30a6754c5dc7f6276411c42e9ded5bcb89bfafb3313f386df58922f9faee439a3bde6bc3d3e79c53412209814ab5c9ac023625aa4006b146c32ee46324f421ef5745a5c77cd89da35ea684757480c72cea380adb0ec590d84414a36228601bb326ae13efe3bfe99ead6a02b1c2aefc5a0e576888dd92e4d9f13c70d4ad04eb0ef6909e7e61321339c25efb9799e6db67a4b9254c1832ba1719bfa0e49fe69043d9720518a6853a2e572bcba0b465f63cd6cd498f31ae12e30d1c9254ff1e9af408bd79b48ffdfd338e54294fa8d1dce96a1ac11368e00ab4450279b5fda30a901985369f8f97f567ca550c048b8572f840f022e04494514098ee77bb835aafbc2c4a0c5d379d8475628a898e9f71dd0c57f5ed47b99eff7a1cd26e183bbee0f21d25884bbe435967030dccc4e2db87c5e250a0499a6375cf08080e7ce3d7cfef1213454ac903fa472f262a7bf59bf450a4207ed4eee056469cbc93de7842371470bc8c5a9dbc1c64c3efa03cc1793333d88d66fc1313b545cad0be756cc7c5931bbac14748f35fc56c603e29112a092597b0949280c49197fed0b0d636a40db0310e389a7d95a7923403b24082fb254afeecfcd80eb0453731d456c51d91db1cad5f00af1f1bc097fd5210b2cdc56bf07cd83f0f79ef9bddaab94b9de2419bc433663f571315f3b6b706fdb08338e7c9adff45c18aacdfc0fda081a8090d2318d5f001fa30ad01e3e3975ad69f3094c52e024ec5ef3abdf40dc76f77e8e2c5510a115dff0c83ccbf8e51734e2385923e3f3619d29c545d4b67bdbacdddf519cc37f604f4d39948c0361a118e749193ef1e26a69584309c9da33a0b184803c81a41b3a4ac7874e07d633cfece0a926b1ed161ded43d1d8d9bc72d81534716bf1873bf1f401b919610fcf9506d942b3dd2be01e43000adf39f87bb74349d3a8cb1fe9a7b563a46e746bd1a415f46602af18c34ff5d7f589ddf83e4135d3b646e3c167f709957fa35f7a153b9d93a9db8993088ce45811b815c94f5f6ff8a0b6fa9fb8380c8e0921a4948f4ffd266deae1a2648a24eb04b900565fd22b213c24444c1689a00d130305dfc55fa9e4b8ed39597638d8ddf724c974ea3111316a15badb3190775e1b770284231e188ffdbba8f4a700cf3e7c8d20c2d625f07c3a6986a2f0cb7f912771d1c834febc2256b026e0bd520127002e53bf97e31df1a6a7b6f2ff142ff7c7cfdeb5062a4c1694213e8bebfd9a4cc1b323f94cec57382160cf777e45f5bee80c63b92d1a9969ec14093814450bc39db3d38c631dd9ac6668ef403f1774de54515a6f31bb3faf128fb80f89ee58f7ac6ebe467dd8554f487c416fe72a30ad949a00de5a256beb38f08b25e7a1d3c1112ff30e99f1b7af02c5e2e0cb4ed0b31eba5595e39f5a8f3353270062a1c11075eb50a1f69d3eaa319b3be6c8db7c24da78493b3fd5388af30f8128413fe40ae4d3a7e15839a4216eae6b1fcb2ee06659ec1b8f51e89b370dab05ca22ed3d2063f0a791a49b2d4623bab10ccf38ee223fad0b50f49fbfac8110bca379a494bec4a28baea0145a8f466ae7e8ab020af0d88e2c052aa4ccb357f97e377c5b2241d986cea498a56b370193f9066a151c6fad03a51d83aefcc1534da499d18beef93b4ad236271924a5f71e23f22ec19671e020acf0182ab0bd007d32a45faffa5bc74d8197b64e6725a9de971833743a1891ccf930eea9ab8195dab247a0f42b42a4b56931872af367557297b3e20147b7bf21d4dbb80ad78e47abe3ddf7b277bb4a68ca5f8753ba3b0aa841cbebb3da21f959268a074ad2d3916236386620808a4b0eed2b33b956bdd5d0056847fa41724e549c6a75a991db9c5c7ad066200bb0245c9b47cf2c84ee356ddf586015f46a5cd31a9948e24dc35e8ef29577f74cd305bbca827e59568b4a5d159f15f6adbd9c48f171dacbaba1f69c3481f5274d81a1b5dd4686db0b3774864b99cdfbbf2645bc842bc05fb058d7775464d0fcb181c17aabc09712b3572498e8b3eb0cea7ed4c12b7e172304a87ef848d66c53d55c97d6d5388f66a01c35be63f80c79227c754da8ef827ff3ece4085cc19a9c3bf13ad95f69acf3351829d487ad527fa3aa6556304fe10ec69ac3c643c1ab3be53a5bd49a5559126fe88a7fe043586a31ef19ca8bb12eed40ed8d36a52283db5de08e71a0e817943e059e9cfd02795adcacfccd440d1d6950648779e8c6aeaea0a8b3ebc73d77e332eb45b4273f3ed4d072af843098dda516b07799cba731157ae70be477ae9b6210850b2c8d8de0abc7f211a1d0c7365d90a45d49dc8ad9e999fe2734865fd51993650a98a25288df703fe124ae0657adb68afa0c7e67a96ada2a6e8ba62496fd4a3781660f3e3a8b81fdb861265a69d53364af51f5558634f065ec3d26fcd4a6663ad3feec92bff906f3fc54d9e764f3ba724f114545bf587b2ef45fa55d0bbf64165352467dcb47a13ac39a007f26ad39db6ef29d04b1ab6916566db2c6a7d740a04c336311315fe418c5fd9e2bb39791dd73fe3249c8e88671f79d1474e5d407c5f43f854bfcc88d5bb98a4a04f5dc8370a65c6d4640824f060d2c07b1f81fda4799accf8678a06c5c9f0b058b26cadc89f3678073072f5b4919b1b5c7d3a674bbc23e237e07b859a1b4d0ea84505f8ef4232f4240f5de549797aeed5ac50906133631e8b968d59be92f0e214b49519566101d4d1ef59ac52a5a724597a411a06e07037c04df5663102d55b8e41b6d5d4589e5959dda7771ab0510a67cfaa5db2f82f019977bc5ca73059a44ac809216c86266eb82aa9e18680da5bc54236ddf43d3ee98d92195e42a87098e549b7e7b8dfa6abdbee86b5018e3f4444d2958d7d89e7a468688a2280bb7f9f0142281281d3fbf3698c0cedade1781f09b8b7c49f8e6ff2dd917d76cbcd154dffe4396a6c156aee6763a97f350d0b6b0f3ef8f1a3f594cddba98bc9cac693e52b4d42b697e798115d6eb79fa4786312fe665552e7066e563def1dbf22efef2f285f38fc941eb2a07b6e528d7cca7deb617737339bb5c85e6343ba2f2e6148fe3d0bfb912e58ddd3a4b7731abc3d79ffaed566a48ef87ac9c04b518ed267d9963458fca10fd8d7dd406e0e24caa29a9d51c64899c6efaebb1741c62ab0dbfdce7b78b19550acbb02efaed4ded429e90b9bca8bc9923d79e3ddb4787e520046898e7f3db83bd1b23760cc1c4f6f352df9433a0d7ed1ff704a6e2ca72081017a7947329e6c7ac3857e2e82c3da9cadca5b36809f97960e40f7784e6e86994713d1cae960e8f6ae252a2602fe8d8e6a45bb16d5adf9f88b3128f672e32d861f44c2e9993d6ff330d72de77356cc02896afb380d25a3f45bcbd146bf69cae9897a8d81c0821de7928958cd70d487826404014e978859ae00dfa9af66bccbcdbbeb609816b47f7a6618d5ef4b786405eab71e66bb34423546ff3933f73b16e51b73e16920524f36cefd25bc6b778468ce2026e7ed5639446ee94df9b0e6841ffd11bf88566cba4ce1de918cb3e7bcb8200fde592963f1e4756658b2167c307fb1c24563c1b2994858e360bbd61c4772ea35802db4e70c847d0165054f95c8fad064763fd9ba7c57f4c084893d3bbd2bba3d5c05fe9855c5accd98f6786cc10b2eb620ecb10b7a4db5302619588f6df4a7e44b1819e174018d08ab0f8e90f4d3538a85fe37875262fe4de59826a6193b06736654bc44b4e312e9eb7c037541b893afd418ff976bf15270949ac2908b9bbb774d288c0b63ee449a78b4aedd481b3136eec6d66202f521efc04ccbbedf45e795f80234777f4e4b5ac605cfeaf114fc6af69d05a55d3ad2f4b9fb3a2ba88a8dd23cd1a7db60c0d51d5bedf56b8bb2a0608d78c3fe6270d2894d380199ca08a2602f05d1ab231eac08f97c243c1c72964b87e4cc88c4d619e52b1f0165435400944cd2fb170d7b0cc8b2fe6633efa5d7c9dbc7b01172b9b711e437b2824e0a7c71f494dfda14d6f3cd998c09a59762885b05f009016b41b9575fbac85e8b262353bf2de4fe17422cc08b8f3ebcdebd51cd6521efc3149c503531aff47253233991ad17b3d62a3087773c210f9b66a69140aed46057999e1e5da92069ffee6c3d4d4a74574e59c659c3c75536f985a13faf2f459e874d76b4a83bafa46c6a0c18bb26f681d32c1ffb777b4eefba7e0906dd3c5abeee7180df47977d1dae13e9aae5fbd79c873321722e360939b61633c8b912189799e86b50cdbbd7a6d2f1000596b78f427c1f466e8cbec0ef10cfa6c819933989c1d506747cc4c6afc6a1afb437496fd014b7f33265bbd62b304cdac655556cd8be1d41686b5b027b78288ea80a42548e585e12ae79321135eb200df60ef6a581e4afe6827f022fb69620fba3ecbefb5fedca9adbd2713cd73a3ad309f53a10a623766ca4b8d76b2ef0fc4d1b5fb20af28260d3e4d7342c73b69553079070695c38264717b1475f27d58b51f696a6f852378ba1f1f02d6d2bef4591c908536b1e8f02da94b4781e3c99ae4c51036bf1eff319dc5245c22792b36029ed130d6eb04e58f71f5766045036c728a6e582689d091282a4dee93415e526e11781c4249063ec21ec6015875d775359a1368f429b53c9e21e904529a812eecdd89f3033b0aca61e0768122818537964e6977eb45130dbfbb9359504a3cf86ae93b9e360727da1c98463fa0a415b335211266b93abf6325ed2f6e23f72d6a8bcd667ed9aa5b53f5bfc404b8404db3d4aa61b71edcced3682f98d675de5e160f9908f6712d785c3bfda713b1d9c0e13a83727cc1982a8d69d16df6ea343f7dd3dfd0efe4144823b05511d87566f6287a91349d12acdff64ab6f18ef005e61451470986c02214832d3c82fa2514554084401c8078b5dd27c8ad242c5d6933a737bb0636b30173c0b3d1969b39cbc311ec4a79ffc84f9b8a43307a9a44e4338392608878e5314e6ac0a7f875f548866bdeb7950721fc7db8bcdefc9f366ad77c10eb45613be229331bb503fe871bb9404e23e7ee2d11fea30476df787c7fe499136f092cc6e730afd979372f72640a40e3f0d167959def4fb41511e0b572a89c7ed6dea2489e797ef207e312a676bc3a576f5956cc4329fafa3dc2df0fd13db0006e7bfbcebbe962efa9fd09cac057dd37a0a78f15e768346f5ef5f4a93b785f454813e05cb5d5e30fa21d165207300181819465681cb90c740be372ea6c6fb153ca50d729d5eecd9564cbd500d874678d2e93fc42d6d0f14548072dfd0f7df0de367dce274fbaa5065eabf885b68733433e7043ab667bfcc8cb54443f1d44bf2a9aa38b230ed8493920e2d467561579e4dde584992e56a2c3be7ce716a0cf6c9585d7ebf997438efd27e4cc4d41d86816e86774b7d","isRememberEnabled":true,"rememberDurationInDays":0,"staticryptSaltUniqueVariableName":"7236f277506f7e5b7b5d0e5ca2c229a4"};

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
        