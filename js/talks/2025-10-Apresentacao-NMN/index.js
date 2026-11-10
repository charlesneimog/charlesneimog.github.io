
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
                staticryptConfig = {"staticryptEncryptedMsgUniqueVariableName":"dfa8843ed8c5a9c31e62b6000b9639cf81fe9e7734a2a546fa3972117755ce1b0dfe0531b6262a227e17458484c9f53c91d22e7dc8de00b4a281b5c4ff4472d012958a26fe4c1edede7f8f8141ae72ebeb1e493d9c133c29821d97d1a8ba37d99398cada2b3af99a53c36690a461dc626c96cbd797833a04e659bbfa502057181b21ee86633b94c13b8873be05bd4fc8ecec6d6d4878a13918f93022aa07fa719aa951081a3f050afe41946373220eeda035a9b51f43f8bb5c9677dcaff998c35da2d88117351ccf862aca6e09c50334ac7cd4f99e585221fa8166cf014c74bf68b9680905b6e9180d5ad6c5b9207963ecbcf2f4209cfeb848999e1b44d2948e5e7a556189c13eaae20e98edb747e00a7b941f6ce78ccddd6724d2bcd1bcb95c2b3c7679ca771c18d197e25942eaec2d575695852d9b0c9c2a5555cbe2177f1c93dfbe94e6178c120fddf45ada162db765a6145c5fbb40c99291c112abf418f30772de15f84f36dd2c7adc0b44d855872d7a70aadbb329b462ad572ffaaf8dfc76dec70f3433fcec56215bc291e7da24ce6e286e95a0216d1ea545e6f6454703bfbad2eda93bd6a140715af6eeeed05c891ba18b1f0f78a7a994f878005a5741238ac4b1bdac4f8b6fe5baa3c6e64b1390164c6d3fe95522257134e92ecf811aeb323e8a8f4299a94302ed2f82966ed7825fee9757f076a2547942aaa318efccfb25b8d9553fbf5d4d932f2ab789953a0f2327225a6583e582f9155db7e9aecb73bbc903b9db3b63a9256058c0d1c125374404f7b08c4e40215842fb84bc116590f59072860a08a840eb45df4402494813598f6cc8b014c0d5bee240fa1c1cc059bb5855f8934d7fa745b8c018b31b10cb59b0782a20b9cffed6286a81fec24b2fbe7ab84ba1583619a8369c5b2a17f681b90b0c2237da59cb6119e30d4a2b3ce3de232480abde72ff59a600b211b3c925c54aaf2e5cff0f4ccaf92f468336722f4fc9dcddb92eea657d342945d7259809c0795fc15af1d1f94f86b3e770b2547a41cfe42c0881f868ea19d0c5d2419ab6ca4ba82020dcf08d85026313b7f71ee251ae5dc5eceef03fd26a92d903ea2b448a49a44afb51137895af2850e5eeeec112628281ebb2bcc0b36be4b8b3975c0fd8180e3e084e04754edc4e9749995e51cb8ffe6f456d53ce640e75ad5e19c247309b5722c8bf9b2c4bc234fd5899b4715d71d9c5374eeb62476d2263a342edb863b7111f9aaa51219e9b17bf47a73c7b157818f34ebe5c4f21c20d6a069e16d295b676772cdeb2a28b1656080ea54dfc48febbba95f5d5321547c437ef6b90778fbe36dd0f0f437f50246f42ca5c3bde023601aa6c019edfaf90154e46b96d39cf4d99193d5ba11ce58468e789da0208df64875df9fc56013041bed528dbdbcc7513f202d7a8a7eab5c594a7061cb7970609051cd1dbf830590bfef5c3a295f2a09fccc6e1b16434b7c769a39e26d002459652f574935c802a4b39205524012f11ad8461055cd5e5f63ed23938e29cfe5d3c45b9f430dee3dd0ec2aa391039c86a0085f24762206036cea4b1e149e77df0c4210135cf4082e7b2d7d58c411d4257a4535e7902c36c607bf5337f9c86627b514a747da3f05d172d737c9d07d69000793ed28a62a1971d48dc00ec5809e4705d31c09d498d1407ee901e524bf4aebbd771e95d19cfea7e788e7f0371558506ad0930bbbace7d9f877c5917dd82779737efca04993f4e5bfa46d6eb51da48ee0dfb4c6ac9b86f43c503583c6a01feaf1f5edb0c400aaab35cc73ba1422c3c038de5531e4b54d52dda64a5ac16f01a855b80aec8a7f7ddbda1dea8b42d3ad8f7539d5c281fcacf6ad2fc90f2ba1069d349f2aa51db6d568ed5e850d9abd41709b7ee442101e9450766fa92eba62121e229f02a55f60fea87409efcea06f1c07e64cf0e9e6789d32e888444524b7775e1f25ef7ef1edbb27a5c54d87dbfbbc74f7bada385b388e6900b26e681d8cc8a8049fadb62883c87b97f57fc6619e7cc9ec886bf49ee9010d314fd562ae8e5d25e8c0975f255dc8ed56a85790d7d8053245942ccb3a250a5c891afe9849e7f7724d1bdf2a2fa575217ef2dccff7bd64ccd04cdb1f4f285d791f56432a6c60be94fb4ea7bca16b61d3597f647225e17afb082d81642093f80a8c186c623c9b5e607309e0a5dd10b9185566262d25b02ddce1864935877d83b31db1ad9531eda1097a0f9d5b2a9bd4028f037243ec88f1b29cb085029ad407fa29b3d940c8b74b426043d2bdd8034657b67478e5edca5b0bc182d85ebd5a49d6b172489bc7492ae7201c8b88155a56da0b9a44244c499ffe883cd89b0dba540723b44eb4c109f829f4a36c7dfc84c82c5cf1cb8023b20f01552bbe822a0e5acab2d9b17308139ef25b8d170932f0f94b3c867dd13c2037a2d4c7cd2ccfa02b6ec9c80bb7835031f01cd3e25023eee24f1462eaa1c76cef0ae1d65c13543ffeb3592fed4c9e5881d98095fbfa224125d63b09e01e22244f8a89a46832959663b077feea70d634d8701f782fdbd76ab41d8eab62559075527813601a43604801a7642248b0d1eb14fec7e90a0fb0a71450cfacf26a12c03819eb6bc6b3eb678e9a4a706ba2e49f9bd5d6839934b28f8a3fbde9468572624828ffe1efd9e019fcbc2d896c81d198b0bf657ac42c5387e965f33e01d10bac4d1a8a208c562b1ca8a15dd521e1e310edad7eb5baf0733fda2df5613bf44c94d4240c86da8936c8b0db0d0477ef70d70efbf2c207583014b2a39b0bee0472e431bccf9759734997ef17984cf6e7409bf090d91e4023e8e9312b2030d53d7e9bccd653eae195caf1d27e7c5480c14ec1528c5198a9fab71c0f0c1a2017d54dcec7a7231839573a614ce678e1f6dc46bf658bfb279db88bcc4ba15af6d7d7a945a7e7e21ff0cf8bd9c4a778d42feda617d928454549351fa22d946e00288265363af61062dd4e9a4976ae77910f11af6ba942871bfa8c6bfceea69d7bbac36bdd1be6db845f5e24b54614611132b1322c58f6338a6ed27563df9d21aed299f5942c62048ad7500c1c3d739b6a95726b3ded9b54d26cc0a3fa815961808797cd47e2107b4d59d2cf62053bdcdac9ab948839c4984ff257f42b4204f06e8aca91bf7e2dee4d0608621262dd3c3f1f7ea08431e7a55be760012ca2d1aa935fc493d8c6e42bb080a928f0eaeb80ab18c62bc80f969f328490b659934bf5ba240bf091dd0219b64de2bc64a826cfd55e87612945ba18dd5897e5659b855c64fc3bf5701cf2b62bc15b7d1e26f6c86b5355a4e5891369f8f57aa124279a58e881a4839c2b3e5e6953155984090077aa833e91189f3622a2bb93e9e58772b6b8c757cf9fffeb9ec116d9f688da5ceb4896be2b410ff11e4e61bee1cef9241876ac97847f72b6e655ea0b9cec3679765a9743cc47e6eaba61e191f89584022bd469a1d9e989e3d996ea2241b8de2410b55bb2755e8203a7a79aa5b1ca670609a27f7b0be340d4f0329211bdd07039d87c67ece81d96c7067ceac9b52f08dfdc6f8cc6b6f674f11b5701b9eee3b41c57abd68d1357983cee0fed78481c26428e9324929bea08ebfb806c1938025bdfd044fdef7225a5c1e336debea720a4a81a48be8cd838da92a29a4bfc61451d5e8529308c5050f84e9388c2f8b920d46bcab1e310390358507b281b49cca9b7ca58ae3c46e1eda80c3bcac566fe51b6773dea9e619977a01a2530c1695212470f06e5518ef8835dcafc5468c06e45987ab4d78d9a2fb01fedd323aca08063e61fa3c14edb2cb4d23ddd96e2c587298fb300bf923290ce7c06ac8b7ad20e82f2f7622a0a38b58283df97df4d20ffc0dfcbe922538e22d83e5ddc94dada101dfda4f8b2f12eefe9a3fee9ddde5fc0a32c7c18103ea95048b2a34467d929ef67d06731057d28c6f32fbfcbba5518ffa58e5f08e4a3fe22b4a0d3e2fe2a9d1114bf52201e9fac309be06602869aeee182c4bece2b432a8f1c673221213f891aab89aa231e0d4f1aacc997d49d582cc8921720002bd43df4ba3be9660ee11c0376c8dbdda8b2c6fd1b9d7006d4eeaf8ddc62b7049ef160e24933bfa8aad0521d3f67dd91771b0f70e6f1c4844121f825904716e3dacbf28ba80993b5990ae226c2228473a3fd1f699953f42b589246f586ea2e13b876c1e6e2bfa0561c5d790ee8c2915d19cefc3dc745283680e5e050d428219ed01cbe7c1be7c588e3b4014976158a4c4ac11dda08ca23ea154317a985c470186d0ae63bb8b1c314a0f8a145dde1daab3b41954449760bb38a22171ea312d31970a718532581fd7a0b64dbe580b70789ccf613d63f9cdf9a619720fae4013c5c72e05279a5415aed61ef4d7267687b7ee747dca89bae8e53f49337ffe9693d6e13d595696f816d1173182efcece8ebb19b1ea7a88bb803505e43f95005bb668567357f7a5f6b6eaec8214bc719cdc193cef8f4f0c707c67233420614718a0d40bf760587381f97f62071155115f5fcbcb0ddc05a0290517444c92ea7c8831d6a90c9e1560078fbb3b06fc71cc29740002a4ca2cae7e44498bdf848f22e77f9f4847abcf40cb9ee68d81cfad57af814a3e7c30f29ae9bd1374bfba27d17826c565b0d2eb314a88342738145dc364316be33d69cf142482be4ea79c0b1db2fd9a2340c55494daa1d4065d6d6ea5a591452f58b4f03d47537c77b8c9302cc7eb7577707554365a8ed5ed9e53af51acb50301fabde84dbfeae7dc89c43ca328ca480571fff53990ec9bcbc2e0ae89720c877ef69d0f874e029b1249ca8e528513cb1344361ea7894694b58faf6dc2579e1361099d3737f978eadcb1dc46165b14abbc3688a2db8a1e9b05ab65a55615e46201bb1f66606ea4e9b36679ed32b3a243e0a2a801300696580d1486625be08d14c15cc512f99990b5d3a8e6676d3ac1c2d0da40a789b0d13f4b109e6d4c92f9bb03bbd7f650099cd5af4a518db6f6703da9f8a8728ba7380a64e3a59b0c8ecf3428bb005b6d5ef8a68ec288117dcce022701729e3a23e30769325325fa012e07f73d6dbea6531fd222251b082ce979cf7e9c9697f3f01930fca7d845103ad3798cd0c1dd22a81c25e91c44dbc5a373c32fdc8ac5c302f5caabbeebeea185e09868538ec81894426e9eee594916ed746528056e5a86f52a9df71d0bce70025d4da8c53d36e099fd3742d5b7178f0fbbfc3d5fd1fe9cc6af1885b772c4180c6948bede614d79b678c9221ca712f792e6f8f433cf86e6fc4a80e6dfcf8964bc4a431aa40a9f2888688d409dde178c8ad552bee1c5f595223f2688f59a3bf09e66a4e104a94e496a25c8214a30f186769b0bc4d795f13ca57735c5dfa4f4f2e7df36ccc355473a1f9c4ede9541c2cdd341b7fb569bca8eab5e55747298b7ae293197811d11b8d7bd2049a02cc48bc226ddda7773a2bca0dce107eb0e7d8ba730b183a46c3a6834311302c2babf84d6bf06157c53407cfb1450aa239f9e7afd820bb324adb6162903b5fa8b4be7f44cb21b761b5718316455255851c4edb98c4bd4b1057c6f45bc55798260565c0afbcf7d110f8fe9afafe75d849ddc4a95a2d1a48a387de1b872340c9ff2117e9f698e1e0b2e3075b4c8b170a3973995784ab6ff1d089107afcbeeb62f70f62c17c356c70dc3a3037c9b4da08ab56441d8e861d8d0ccf8582ee318c606bf85a5eb6c040bb9c18a490e6f187473c7355816931e811809d36fd6c51ccb8f337ae7143bb51f3a5f39fde2eb8cac40450071845afc03f70c7467686b1583ed27516acebcdf2769f3d7165af683be32b3bca018d45e4f6e4b85ca14fa04c88701bed1ad6ecc10cbf128a0787b72ad486d6d3ea1941507d23bac7b64ca3aef4ecfb9119164314bdcfbd2749950cf7867271bd603d53d30f7a85b4f75003d27a1e4af1f1c61503ce122d9ea4e2925d8e3918795c7adba3e0030556d76517656f85fc7bf9aa4fa359516fa87fa2a25270b2893cea1001442cf2c9223bda36692866081e659d298019ca6d8c737b493f85def319e39d067811750c70f7ee8a34210edaf9e007ca0518005394c02576d6818a04a3884722ff164775cd843200e3a1dafb1c4cc87985bfe7316e0c139fe4cbe7271a4d86e6a098a0271aa7dd91abe7be0a0b9b606a98d1f53d15b29b3ee7b8d05e3058872ec6c1d3b0068f01476a3e304af941e8b5adbbf7aa038b7a7612168323e0fbb75d341d9a3ae9e90efd202e1dbbb35924e9ac43be0daafdddba5bd482bba78ed8720059d4dd81f04a4e75a238ac8b97bbe0d01fdc9bd5466dec18294f2a12dfce110377bc18cac540bb771a94d258375e8ec9db7d0110d5ede72a83577b5fa101c0b2f74e91e354fe2978e1a28c9277a36a271dbdd99af53e83566f4bfc27f1f8d16b6e36e322e535595137db150143e129c0db11a2fd8525fff739342663d5c1b26d2e49fe738eb66d3ace361929f84793dc95b5af26c0f902c30a957fcbeb67fbfd065743c4d12ab5a1825ad0009794ab338c77f8fb1676bbae44c8f868b5e4e3aae30346067d5f31bc21e60bb58039a45484c3c68124458baca508c04e57d34983aeb27e33cbee87544536c89a5fab2c5eb1e1045004f098dab46d90f4fcaaa5f95db9b2edbe874777aca438e82ceff887aa7dea076eab0502b661c171724364d1ae46e79b6ce2fddb9aa4b66eca398063371db209b179fd13c6fc87ff6917d5afe6b414867b2011b96558c009636758071052a04bd2d466f66e94dc708585cb19639bb92bf2107a913e29b9493dcdbd7b42cfca97207b1438c805614db7a1ad575228faa3ac96f8a425aa484aa85d42b166d16dc963dabfb1bdadf7043cb6528e063c7c7ff0d2edac07dea468fd5d6b45e99a7cb1473c412e1e5ee21957ce2305472c67e598bd3d30dc988a5c98a42ebd049cb825348d511ed3ddcd851b074b219030a40aea2b71b0600782ef497bf8d51401a2c2f19022aa7333f5716f5eb9e39928f0e7f5258ff32529578eb29f9cce0130ccd7c4404b79df0e25da74dc6b4263486dde1c4cdb1b5bd8f795a459f1366ba5cbeb6ba581b03ea8031ba1543b75b50df6d4178a53180471b818cf82422d32d407f3bba2eaf6827e695b237ed287f78442669cba4aad3e7c15c06dfc6352825a393fa95893d6be881ac63b1fd17f4d4d0a2cbfbd6fddd05a06c1b01cbed1c3d723e237a536694ed37341a818e70a52fc838f133287717bd9779017ccf1efc7eb42838a3b0b05af1db370315b20f816cb17ab2d99360b45b86e7c2b05ee366421a7db3c41f211f20b48f228f103fda2510d724368a7a7838addd9d2ba30ff72854c43f113e93ccbdf4902d5f98d1905b81facad0e78a65099c74260703af2400ce6c5cc07f8995337d70bd57536ca8f11cda6cb98349bf0f9baf31a98bbc0ad02b10982ea49bf13429bbab2ef16bb4cdaad4838843930f18de4f3d87a0de4a16711356bcdc17ccfb65ef48de517b844e1510100a71f5d47d71326b399829669adc48baab1bbb8d6f597b4a662a20c7cef56b6144a4861772fa1c1f4b94749c964aeb28d2526c2501c579698ef4f5be3c9b7d2b67d55c4789a710a44c2a37a6f5d75ead7c29a6f024fea1721f80b298feca8b1ecf2ce40b44c6ca0319b9bb8f4c13b6fc27db7b9c5a542e5a07981349ec1b2f8e69f17faf1d55537ae99961e92ce5e8c86692ba779e2a4817bd701c2236af418bd7acc4d199963662ac7d4e93769d63a72a9e10a9c79f4f23153bd36dd0c20abf385b99dcd21955c2f64dafbe2bfeda82f58107fc81f43041910300422a4e631e9b3092b57fe01eafbe7a48d91c7af2121213bf94e27a5b80d4d99acf2739a724acc96456b87dfc3e6eef826ab4409ed4b36b52ada7ba3255795e92c26e47e43d77e0039ae22b934882f5870956a809dd831ef2c8f26608d617869f3b6ba4c4ce17e97e8d0b8496b97c0da19735f7311a7711a0b20e8be5731cb25656ee4704474e57d0176a49057227cc44d37dfa42eb5fb4e9fad4642683f68d9085f0ce779ca2febe1c40945f761d2c068190669bb3970228abec3c68863f9c667a2037d9faccac3463bb17a504f0297cb1580c1e2f4eeacf20f681c0caba1b43056664761c7565147de81fdae926c2690e957403928f3df56f36fba4a656061aace9530657fa0df21214d63ee5a53309892d7ade2c1452fd26de0b3d307729ff94295f9bfbdf8ddcbcead9e0e3a8c5fe2264ab4faf2ce26e3050b7045c3071b13d987359a103953450010fb4e75167f59579664d3027122a655afe0f5da4ea926770f3a5738b7e7a0c50f6ec082082649c46c7b38c7a2df653e9801ad69063a6e4bb03e1bc849772d48dab5c0fb6a6605cc886c6ddcb000a95fb23e9c64470b07e19c7643c00699df4f75761d43295eff96a4216aaed694489b3ef76c3ff1b3619194f64c0ecee9c8ec289613de6e51dbf82c32427b3891cb0549346781ae7cca5f5375dd5609fafcb603e7bb43cd34eaf373358cac13c6c4fcb2a9075a0789141dafa2d1a6548b06d5b794ee01cbcaaa440704d4cb63db6298b201499ea1c9c9408d05410a4516ec866d2b98c829ed219167615e88a878d01bc5ac4aef7cf803735794527741fec8df403f77e65bd8dd2f7cf278a8e77e5d72bf8307565e50af2908a69e051ae0e196aca23757b3b1a5a599adbe6684b77013f33eb293f37703a9a478ff7cb275a2a96062d9bc925869288c7fd03d8255fc846ae7e05903f3f52d8bec7ea0c0a7a1cddd0387d50d54b8cbc54e39309967e2646b0db55f5730feb434e19d8f12f5c63c4aa521c6c9591aa42c5f429f4f40c68850c01bd73b2202d7d6dbec397f5cc992199617664dea8638675f2302580e56f74ea1e4ce4143b558a9200e89ced8ef64e14abeb2e4b45ac0dcb8474706d15dd0e02e150663dbe6c31c9c74729cec21bf83a4de238570de92dc2f93bf110e383ff6279bff9a72deddf81149b5f763385efe08b99714e147ad76536c79d6141f0e9d34cb761939aa68d5632259e0eb2698ef49438294f351f6cf6796d6d56277b5a5bdeff60865f0e58dce7dfeae10c00895d4254360e2f3da854d08d6a1d862853ff8f5610fa55c678b6b89a72b85756e13eb1a7d0f507d0bf24a20ab699d1e886248a5cf0df63e3c155b2884c1376fc95bea2b2d0683451e23354d79c821f61f45b4c702b83d78f37f2ce6be2acc8fa348794adffc4a2425181068f8c3b14ad285be2bc4905d66504ae1e575828d8c5ed0f1233e1a7ce41896fccdbec610176d74b5fb0080eae56dcae2a2ee733aff2d06784045503102a6c395a22ff82c8d809db11630a06c210c8cb0fd9383158da174510e6573f8503e661bd17c49e4651055545d69e22956afca095c729278f58cdbe1e7791f5627af880008c271e5f0caad820c16a02ccb77b045ba0c60977a7c0cd9454e594d1e21566dafd16861f3ef82aa831109739992d49c4709390bf96c0883c7189769e6b3a32b17f706e8ca41ea2e9bdacc6fae420cd01ac188f97d4114d17f4cd4b415306b67cbe7f2b68f7eee2d593db60a532ec53ada22e9b0246ee9a8c9b45f9b1cdf684e030765892b4a3e128fab5891e11b9037be63f6799e292b934ca0aabf2917c346776c3f4d4fca53bfd1496b6f26e8efb3d0763ad17e21caf4b4ce73bbe45378c41e133a580a08d398cf7c47579f4f08b9e1f56366e1b453bcce972be564d019d428208bf6783b242cf58c237d064c1c2a1cdeaabe42de3ddc6eb15d1df6ab6ed4e98879d1e4c0fb04e05b69bd7dd145ed827f01c9d8fb221fd03f751a142dea6dbaa3f54eae94058b017ae28ed17b215a087b95a7c9b27fbfb6e8a2c0831f8ddad63258f586139944eb99168af21a4764559d068437345e8466df7bbd522aa43089b6656b2cba8ffa1a9228e77d5f1b12d92fda68225adf582bbb8bc05025678cd43386bf195f188f9637abc3677526f36dfb794ad835b5d88f701bcec6e85d063776fa43a2b6972b78e68a162d7e267f1f63b445662dd51f2ad99f25330c0df305598c378bd0b67e3bdf46bd61cf6a3112f2f62b6794dd648380f0181d0a081634b0f5d310a7276138c41cedb1af9125e8fdcd83d7e583c92334eaf793518f69c88d2d94f6b58a5c37f427e0c4dbebe7aba2581e3f7b9ffa57454b27427f62ed0205731e017cb414a4391227bc85a3dadb6cb1329c1696d3cee12a831de65a81061293c1edd93d96aef8701355d23ae53f2b11e3702f41f1c093eb56834fb454929929b2d0b806277bc483d461d7b512b55038c6c5e5b549f4709b51d67c0a984dafc124191c292eb8f040c3f713cb4a39228b03897b062463176c3686f0178376fbe419280685e4840dc0648e47d5682589c6c46901349e8e0803938ddeb202b5906d0cc1d41f491d6bdfc6fad567f004b4fd0d1d2697a0f51eadcaa45443f8c715aedd4f591669fe150524915882b925e244ea9d892a1425a3bd3dd209f406389f221cf4f7db5a1fa08f3d7de0066b9fad46ba5c8dda2c5ff4e226bb01092c02e144c20d52e8dfb52babb1f538adf29462a0d795eeac8569236be6c44dbc9ed27b0615eff394aae50e45665de80cf5dc9c73b1cf8f4c35f480ff62759c796b9e58c6bed871078de07033a9ccef101217ba3a7616f79ab39faa0d82343a8ebb81a41307eaf6bf9cdbae1e57185a71b2adff824a37895dfe79e63858a6d73dd0753d712f96e21db0f05ed0b5d4ce4b78ea1d63ae403a31af829a9ef133485a70cd51a01ab230af899061e360c136ab31d8a1b503fae0eb33b7d5ec0effd6933a5254656cada1f823cca2ef7c43f7eb0a6cdc3d6a99447d023cd65a3a22ca3eb5539a0d1b04b07990ee8264bccd152e112ef143c9ff28e61a3724749ccf965e2949835b29145e573592b9c968aacb4973ff5ba7678e653088890aa4a3388a58b3a53acf75802c7d71ee57b5615c5bd5f03cb32b3ce753d50c5ec1630227cad03d19961d230b2987224962821b988a09fb423d3b1c2c32797fd318bc053b09a9e689f4f37bb46ce072f11d9c316ed355153b84acb4e83311967dc303007b063f21fefce03f47257859844f9262e9a54cd2c43c75da2543e1b587dd85fef93fec6c505201959b9d5cf2e1591cdacb2e24e521621dc7fa07e28df3e77b69396cfbc9e1fb5063c2a623d1eb4e95e2a8832627a7f2dfdcf27d705e11e24464a92846eaa90876543ead8d0de0c2b999318ee2e65053f52f35bbeacf21292fdff6b6e79038d4ebb118a2bc339b9030459a0ad229ccd5a245afcf3629500183faca7d359924f0964c4387f73aa5aa8f847833ff078b0813084a2d5a64bfe6b24565801e186e688b6120d02e2306cd167327c1a54f42a096556cc745976d172fd8209b2bcd7dfe6979c5b924ce4b5b16eb7cbf117a0af916841298c0e479f2f19e424cd649b796a5cda91ec0c696f9c2ff8fab00d5732dcf9b094aa570c07694a4a3cfd572496e651975fc83e8b7a1c499c80392e088ce1712f3d2462d3cd8136bddf6d9e546b2308b8d6d805d296faf19b5344d241eaba691c9d92ca3d49b6a2ee3e99d6435249ac19c926d94e64c810b4ce2ee00161d0e35f0f1d332d4f206bcf06ec832e9ce84cfd4c1b01ac86855c251533c71ff58cfd85227825a937d680d35cafb3d5ff860bf5144e5c6ef7461d2ad97f0e19fa57b27f94962f6e460b7967c9d0267be570d6cc02d60a8431e35826179e38a1229440102395ac3e6927dd8a4b315f3d246dc62e5eaebc96de2350c685064288664fd73f6bd764a05694a43c64ecd46c7c15bf96e33a9ae9b47135d6ff49da8a08ea53c8a9a52bca3aa8f576580398a97be6926100fa5eb5aeaf8c48a2347e2ffc4d98bd890d2ff5ff125d8d2e42fb30007a9ede6305526a26ce46d1a0d8f42e7842c9675428450a2adacdf2be29ce689d1961be66d9d07d8dd662ce68b27e972c18b21129b920a204f138de785228e04b18850e9671d7014240375cd0fa5e47eef460dfc38b5b04a46fe5f4b6b94a5402a0499f823e2cc37249301ccf69813385b6a4e1e53740c1966b87e8d4ce4fe3f6dd10b2de22920232eb15f0377c00814a250c259e7e4be61e951b44b23becdfbcf5f932f0b20c67d2eccc704db188232056a21c09ad411ea32a2b4c68e4b14e0b66090082ee65caeb427795bd5227ea0add33cb7d1c0cf8315677869b809c9d59dcaee364cad0d304b3e183d196de5cee986a1f11af0510e09f924842bb4a2be859860eec07ae7fd6747f68285f9606ca65588524166f3fdf53bc5e6aeb98a64d619a0f5daeb56eca3755edb993a71e3f412499bf836594335bd30294dc0253eb6f53dd5ec3cc2bf75c14eacdeebecfc85debd97401eeb6fc9ed65e723461173ccca87a7b326ebb5524f466a27061c00ebd78f5108f31aedb315e75d83b220f83b0cecdfda0b42df2d497e66e4b930706336c8ccb71e27ac0d6f22c5ed2aac055a3ed685de06dfab7865240a4e5c10b302b047c92c3d0fe8409f45b465faf81455a87054d664da170fb2ea07f3eafd46d5c9e9d61a3345a6365e5ae93914b627daf76092bb2e43aa545652fddf6d43359c2ba712854d5ed710fe5283571183b645a6ba46da01f683ed0cd8a874f45735312900b64491910d89c9847f2cab1e34140ed91ad5dcde1f576b85904191f35c8875c188507f4ce0f4474b0a2e9a788aa28db19d59785131b9d21c9a9707946f24f3e41e8aa2eead0b684ad73a56bb017b43671e3625f9cce928978a7d069e01791288c96c0fa8fa4cc6fb79e0ce9a38a58149eafe85b406d620e9d4db74664b74dd9a06bdec3bc3462458dd1f322dbc288cff08933da0b2606437b76a61123657a2a97f4e2e07d0cbecc9f52d233b001c3c62d301bf3b9fbee2f1d9abbe230681f2a90bde16a83252b1f3050f7c92e575d0a7222bad80b0f80a43bfa0e1ca1034743f56ef5d04a6023bf69febd05428557c50bf739bed42f6823fe68a140cd7bee653a69a4c3aa5f4e1c15402e5d7454fa78b3327c785352a9d2464893a7f9f2a335a0be0c28ed45d0a6f4ef30dcee42c1c294e78349296b6e901c6e7532e8272ee4c3dba48439c319b529f847dfa15f2b7360382b78404010e9f96b33293014924fabf698c41ad09171b4186987ea24e145a93274b09198e61534571f3a5aba5171167b9f59df253c4fd1acf909a20e21bd3b176b3c445646d1c0a866510d9145580d7fe9e92cfbbfa7ad854cb11a00317565014d5825e14f03ecae47d93ee80425def6201634bc23fd9eec677dabccf2fe3919097fb86f2dd5d0b70379cab62e919cc141281c176cf84c3df8c4321e1eb294987381c4dd7df2ead90d76531ca8c76f61f24b440e6315921c7a75f0a8f33dad7a8b828e6c57986e310f5132d79a3547e1ee428dcb6dc2836f30f3ef6eff2a400a5fc081ed76d5c2b83504537f50aa68809ee2fe094011e0b657bcdb16621f37786e45ac5a5b7638f0262aa70d2248312e245664faf9cb29594e2edc9ed85bab9293e17d43a9853e76f78d1279fde85e53db2d8cf8aaaf4a0bea80760ae1e06ccc4b3689263d82a6af9afd3086721166c00ff8a1f7e06355d98b4e8b2bce32b0ebb7fc5efbfc3101fc86f15b2ddde934bb1a689ab8bdab34c094b55732256cab09a5aebc7f112c9e3435b05b05a8b26d3143b95964cad653406f568f63bfe435113d851109a9a0d162d1c4cc0c47d70d091bd8fbbc966defec748482f1ec172b8b3e9d5ad33f0192006b395e3b9b41f98b1c39886683ea81b27efd7dee43debf50935bb7c63e4587cdf19e1d64690ceeef0407a6d1dda19f23595adbb99f0d394c696e3638f8d544551c944eb546b27e9f9582d6271835a085efab82e75f1b5924f4f211294934ea06d12ca62765d8e3961e911287db66cf9c4ef7b13c30d82ed4710ff78f9689b3290e802ca8ea473358af4e9eb75a976af1cedd808362c75976fe2b31a4cdf4a83070128523269adab5478d14f24b990065926ea2ec9e490b7cda4ee402573c4789cdb18bbe1428f3549a43e4a613656bb4b17a7447a86027f9755bc781fb18b78afecff9e45fc32610bcc5d4da4eeb868c6901cfdb16110e0194d3f058545207c46468e8b69cc5a0d5a7e75759fae3e8b56efddc7dd244d301cbae3f3546517b4b6895dfc5b14aba69a0c59926a7a2b934487669e6a007ab231f386ef38e27117619c9b469f0a59fb2f7ec44ed1838355e4c1c3537eb8ef0d06bbb8bd2cf52fcce79ed8661567a2d594cb7f606e0c2691976c6397276dad4be473fc310eff81dd28d4b1208fbbcf829d02d7061c50f0b5b32a9f7a2ad6cb4740848a578645ab4b5ec0756fe71b21bb2ba13cc035628cdef9bd08a1768be05501b52be8ff7fcaa7bb4b895467ebc805fcafb7eb548611a049acc739710b20770b59c460c824a271049347119084ef7d1a4ed49d23ce3376bd4528c0386a728d68951cd39be202405b72205dd525b65aebafd6881cba61a3475d9ebf32e4337378d50471b28b4f5c7b1b317df37c14df17c46ab0d7a183c21f1a0d8a9f00e5f0e1fbb8ca6bf318953401ed10e411713dbdbf2ecf7947378fa61e6790dc7c7843961cafff54db405ade0941661e0f8b4da8a9a826c9e9a06e32ac3be4475f74f0f6edec2bd2643bdcb802c294f60399b1e45bd1b797f8515fa41ab20651ee0b4d4ecaab510e2102e5e7f83b1b38f6bd75415787f8866fd66c0fcebfed0e3f2c3380ec9ed368cd6e0aadb95440ec1cd316571ddc36c16a67f98d9bb1d301bbd6b5686a77dda3f1ca15215fa22cd7150fe7850c13be3936a31560fabd71411f409af7ba26507c82b20750b9ad0ae852e79097b42f0bd5a48ec9d79fceeb3c68cd169d7bd55c007b16aeb69058d4ecb09df0033854af47f1b677645961a1a41a94a6226fb1af9ce52693d8a5098f00c9e07b92988ccf967cbb40775c29a66749e897c7a7f7590d04ee3ab9e804e2400a9a77fab6305aebbb8a2661bfeb85ed25c995244deb41ea8a8420b674588ed0b884fbc684f74202e87a341df52545c9ab254858fd3eb80f7882308ffbf8c0d67edf56a57434ccd5d76f5bd5b79ec50f20308474b1519df61aa113cdd644f4efb19661014d4fdb00a1e0d92f82ff291c5190f6084bc6cbca39397aa34879fb153fedc03f3af4c8fe545ec587250c2d20508f7fe90ced316872e15d13132a7751f564c7055c6ddee8fb4df56d841e70645aecd1fc46070ab1eb71e096fa5001dddeea7afc948cadc2bfa845c1bd7f4ff5e0e334d122489370918368bb890c4555a43cde0d56cf4b4983e1516e8126873a4b4c71028d1890bf36b8e7b6baee719fc3046d0caf366cf41595d6e258359411606c58418e4f96f8374149c28ed6f7cff17cef956a3ebbe07221faec0c65c406e11d9604eaa6de95dd16f83b7a693cf7e557a2fa871abb4e612f60e6115c9243e9f87e8b348083374fa217fecf96fb011332c0082e17e06d81ddbc4ab492ac9acf869d8484969d2a87ce13b13d04e9f7e9bed8b2bbb4fde5645b52e1275e8d14cb44cd60f8b214fe6f5ec6b97ae9f9448cb7b9c38495e8cf41229f940dd15bb9e14866b20a1d9d4c2f5dc1e0176a3df5f2193ccd0d0097db9b6c3c509321dd7ddcb0eba6ab7fce17f04fb336f2f8c7559246d7c7d23df18c8450597397dc0134ee746c7cbf6adabd5738d0c37d1105dbccc1e156d1179d1b0106764de28c65fe620f41ba430a79a84457377ef233248841effcf3292b90834dd00f0d997d8b5d36643985a2daefa32d70d13f1e379f07e339aca5a809a3fb948e4aa0b6117dd3abde96db345b88df5a13196de3415c14ccf2b142639afcee42dbaac424e4b3270d17f594459f2f8a6f33f627985c7d443e07fa3132343c9ca92d1950c4058c57be83ca8291b484eb5cd5d744601b89c775281013e64820e9e7bec5c11db02ec6f506d9076c963d8757a8c8536b7290ef7ca405d40e9e49a1715d225abd573bd2dfd1158da33d1d91d04efcbfd711aba6358ce10d0afcd2999fda7d34d80ce55bec5766d26d438b7ac8707f4bcb611e53177cda5873b5351b44d5ab267771cad5ca03330393d2ac9f00ecd85d2335d7a49b92d5c2719b19d1c6b3b6a573c7d41efa2d059f0ec42fa87c8f10e152f726e870df1f280970af7fe9ccf996bfc10bfc255e00ad270edd49a56957a56b2d0d7de8886930ff17c079d1a562f02973ffad4570e2fc0621c65fed4d0ec38ba8cc49fe056128c14f7c268dbeb576b5374af25a26e8585ec660c89071b21e88784b79136d3b7a9a62893ffebc76db0034757dc12800a179f11996d8924c6d8477bb684fdf761df6f5ef571be5fdb8c6b4700bcdc1594ba48649dfb8b5d1c55fe3dab11119311c38b94ec0cd1c934877f2090278b98eadee9eff0a4c68b03e4974815512c5487ab79874c0b43b953f7f2417fbf744d949ffc819226819096efc42acdfda39e67477206f45b6332c2b1ed8b424fe29af59cc053d2e357cca8068f9fdd9910adc919e536f5704b9c5a177c1859099a166becab1489fbe8f2923cea2b94d49db1a8ce6934a0956d71ee0bef0e4f6b0e499936502ad97b5c4023d5cf37c2e71f26d26a4e1bf70643b3af23eebaa90999021ae964941ca839304298aca3fae8cac065e61156aac3072a045a0907f2b57e8885c7eef48982707562103800ef3af157be3bbdffd7bcff77f5abcbc149557de8227a664701b0c584cd4ca94165c6355f66621e3d49691d916e996f8d553b5f239823675e79545c835b1e289865e714a21d7a6408f308feecc12182a34ab95b3b0e587791d0d1dafd050f3574f3a27f4c40161e32e299115ff8f0ccbecdc28d7a8af61bcc91ab1cf1d6df8911df218e5f7d99d507d811fb3608fbc528be1628fc5e2cfdf4f6dcc61e68bdee2c8d77fbacf33108b198e815588bb3ef1059dfe9bcf78b79842c646c4360cc1742a5c8a16b5172cad69694a37992efd03a065b0c25a861b6e2693ec7f8d63375a03cb8cc7b44ec8f829f2c29c1cfb0ca7acfe7413fbdc8f8ba975b37354fe0b5d05c426230cd588a6a2581369b37160b67c69242191fcb0e17389d9b4cd21f988d84300f8188800443ad50a95d17ea539ac820cb68bd1765299708c312291ccbf804a1b7edd18418af040842a4a6d748248249946ab8f228ae46a362bb14ba6555a0ccadda42606ccd850e15c4aa45fd3225efceedd987ba506b03d21272dd15cf1700a6150beb11832d6e39565910006e5b6dc0c55cccd8b908d2fc6b2732beece4349ef347919de67bff614ba59dfb132f5c234da4806f4e21f76dead8f6d22df483ce8b2406147118ba4feddf20a0bf4ae418a0b597c3bba832c4d550224f1ce5b7cb5839fd3a62616c0f121037ce7e4d9031d459ed5919206169858574756dc85977c0d6b1a67345204e08a08c24609f32002eff80c8a6450a88065d0ffbf57e7bb485cf37185d5898333c9210db31d7e27e6fee7baebfc4728e04e6536ed2f4dff05284754502432621fe001a176fc41223d3df58bfa3c4f2c829491a594ea36aab12cb647c2c4355790a727b37c182eafdc2c4b30081bb9a7e3a7e29dc07d5d4c96cf7c95e94eb563bb7974502fb2be2fa9d7c3846a86f6e6b3ebcba34207eb4669ccc8a707ae008f4a880ab704804a8ff564e22e132d74cf55cf6ad56c93c7ed09041325b8e2d80f942115a7872dfbe08346d91a58154417c29a756bde0b2604f4afecfc2690c252cae2d35126d5ac8a1ab8b5c538dd287cae0318a98dc3cf3ce112bfca8035c59b4c71cb4b681bfa2b1e7a9c85ea200f5eca41385ed5e4870b8c3a4a73f1f27e405c5ca1b2bff82ccbeeecf40dd3f40e026839a15d575bed91a6e38f59404135df03cd24d592d967c2d45dc2ec8b0764ef08abf5c1f4cb60ddc8862f67199ed2acffa45a4724ed472a8b442b328162b1f83183107682f71d8eab01dd91c5910f38a0a15b2cc5e30e8ce49af688cb61b125a328e86a2c5cc9e697a1ff27d6d5ba7a2ed0edb23bc5ad32e454204dd639970a9c357850c3fd394aa38e0e10337dbb28b35910304901114a0945e5f82cf521f0ef3996885ab865ea10f8ad9e950c554769486853f4e1c24565a7ad09ade0d3a2e29c8506397f852ec4b7d8830daa1a661673aa8d1b2d01dda22cec1d6f9a9b6537bb4e3e28e57464f65e46e6d7872c9eb20cb44f478063620c1461ae1102b9c4262673f8033a99144418726cb677f96a061360fd6ebd165f4efb6a303a643f35479c5fd7f4e499764646edafd9cd3c7449020a7edd8a47c6a61b122ca3dd4245fccd372fc7e34664bbe3e7ece6df7e6e6fdd366e206c4a0d12bd39e2d623723eec68cbd904041f31f533cac26499891b377c9e4817928cd428c2d5d7f7e4aca10d6164d3fdc75649e446d07a0c77918d243c6d55cea27d232ba6641c16136606625d67c2a142a707198cb6740769f68ac32d2eabed68bf389724eb70208afa8cfae1149c93d558e75c1fe5400c342a8a7952067cb3d7da49d96ec2292e481f4522e781f294fc45e9e64daf3ecddc70b70e605f6ed9878e1eb2d17389c9c511d160f852f973c18fb0e4882205ecd7da58924b75bd07f1fe9441ce5e9ed444e56c0f01b419806736b2121850ee7c0a1a5773478741eb2b3560db744e9353d353df8767483dd8dcec090ee6c48681ff9bb28307a85fc7ea45349b03290555dde75ac470a3d853921117e917489ec61d6b94b6758e8dff0a6107a415f9f7251c3331dcb83896a34c4c0fe3104bcb84dea196dc6a7587f9579b7faacedcebbaee95f53c23722bdef9ae0dc591df9edb8b28ea40c0fa4a5fc244dde64554cf13c12e8312c59a6b4630152556ae9b374be296ee1a1897db4e55351c58c831cab40fb1b05669caf137d83f1d248b86c46d5d32570ffb6a1f583d128ba71b9cb26da0a40f6ac92df9408afca46c571fc26a1b4a1500d7a85821af8553e457e4aa61d8810269e43d41e576bd7e807cf5947a2ca18868d1986ec882c624df1e7416a886bb5f470755caa9ab75f9bf28c5b8c1bab8edc10a96c00f2d1b145d23a0407a4405718ca30a70314a1361dd7604c922b6cf57efb993627318f636bdb460143db46b6de800a4ea47af02ac1db82d0c1a2bba9b2bee9bbfa3385d5a5c1fb231afd936fd8d082802997708a8000cc5c686831d9da252141c11c7dd1278a917d2d4e8c985e8856acd9cd7dbd0616a96599536db1f3016f238c66a96cd2e6df12a0659e7f15e76500153dc1e41d10bfd7d44b082e6c6168c9e06c11ffb57a1","isRememberEnabled":true,"rememberDurationInDays":0,"staticryptSaltUniqueVariableName":"302f04ab65624dcfc8b384e844909600"};

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
        