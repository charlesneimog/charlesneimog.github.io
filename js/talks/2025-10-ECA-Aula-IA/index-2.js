
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
                staticryptConfig = {"staticryptEncryptedMsgUniqueVariableName":"dcdbcf3b616d601bc7c67d512202f5cac5fb3675fdf395b92876edac522c7b0129bacd3881dde0062f1c4a49d04e3cf20fbc123fa79adbe6a4d550622d2ff75377fa76c4de6ae1fb83f5ac665d9afda0900c20b3152f5ac3300fd170621508bae82828b418a138aa7a178cd0a04a2586c16f4bfdfe657c6063a6f3b6ac71d08802a4aa1deb2e5a90a7a41d679bd1325ce35b96f13745727b88ab7cdf033b0d1fa4dfc500a5a726150f9fe4017dd8a3fe1a437d63d370b43d3cdc9106b2b7bd68fd4788a9dde1da1c102e49048389434401525ae86519964f98c28bf5e3013e662899aef4d7886660e65dd9d4b6269650d76ce53c39c13c558ea2f72608e315361680a9c0d41dcd574750e1d1f96e0cfe97e19bc714a32360c91caa10fa601dca885241047eed18edb70297430e43fd8ffb63687ed920e4d507966c581637c4713402e39db338e3462d41b781cf1604170fd4618d904a2bd9be1835618cb5d8e733586dc9fddca3d95b1799b34113699d8048a1f109696884040fdb1d86eeab5f2c887e67dd25768c7153b8318bc04d6a01175cb5e56f711c1ada8bb758693604fecca7de751ed61b51a70c2a9be026b77a21bfcf99d8a0101ffeff36f78b17161228fd46874b7aa4db1d84cd168669783ecad947ea6cc4234d18307a478493cc2074205b4b5ee5ec8981b0c45ac18bd512ef4758a5bf0c533640b5f433079de47583a8c9b1355a5011a881693f819114555c155be573cdaba839fd8448e0067ed6c31d24d89992ee698b93fd46bd5e4e32d664776aee923b4c9bd3287ea7d4d932ff986c234f06d034125af1ae6b89ce7c8cec5f34fb12e16d96bcb1843127d9fd2f22379b2804d282ceb8ebe37f4a4c791503478431c2db647a8e8f0de5ccf130f4a1b30bad0535db43dd7cca17d308184cd699fbce85517fcde53fc46dedcd1c293cd55495831789f50d478466342ef234b79baf89d2a15cf5b97372c9b5f64b11f296702b7763e382581f545b1f3d1febacbe655d6439466b936749ee0d444b3b23462dd9c41ddb54e0b22674753cb8df3498d5f4f964cc556ab7bf3ed28b30ac8d2390d3541d34334dd3f940ce32d436b1c6ea41d800da13429b2e5724ddf0fafd975842b5989e3b8e736caadd5b724e404ff3fdb3588378a1e6b11e583f60ae9d60a90b4d9f7a9bb0008c504fe0b5d7dfdc7fb279d6ee36346dd5f840695a8ba96eba7f29152a5c537b50470a4af8c2aae25cdd4692720a653bfda15547232a861579eb8a4ffa495e7867d916f69e3f75edaa4d907a210d1fe38df1eb8b541f97e535ee761d4598a7ec4ec0157dcd5892d2192dd5448930eb7c11868aaa5a66d3ee431baee08f329a18584424802b8365a77101bb1544de7878e117033fcd09d4eb4c35b2e3bb0bd36f0a876209204134ce5c2e88d699d611622c097c12bbb193f0245975a6b179962c88132dd5a52e4a431f49bf85ecbf1249d07bd549528421e75a914cb507f1f45162af8bc5b74c0a0265352296ca71cdf6bf4f22035a496a1ac649a110e65b5473d0effad11d967c7dc0d81aa4d93df18def17e3abec043344f95e095afae77b105a0b4731dc2dfb5dcd1a15e2afc6c1ced230f876a5bead95a25152945c25f8acc8231b9dbad3e8d08455307725649d5804dfcafa0dfc10d7d33958d218d67882f92b3fb412178f094d881189cb69667b1a2b846744de9ad8f850d2bbd2eed1821c51507cc7f45b8ee968643b4753b521c9351f363a633f4d7d342438a90fb6eab6dc09269d012deca19a259c447faeb0cc82e02cbf4fc4a04ad4d53b59b4135fcded34d1eaeba8bd57b87691ed221c25ca594c48145ca9d2d6d7576528a34a370a5815790d4313b3505c53e21ca24932ef133916923643f38fcd706ba08792d0092f0a272d01ee5d014854612cf79337d0a7e852760661c626c5ad36619ae694005e91c1c39c179fcf18e5123a6b64240e16328c0ffb93d5766fde891d5145d9b80cf2c386935aa07dd54deabc968c0d3cdc0c5ace09d58f4b695db21dcd79ebc12f9a1e1cfc8ab3d6bdfb8dd82003ed607e8b7ca55321ccb26707bd21976966382b452e2606f93e41d6ac800b6093b86b62d2205170eb0ce6876f3ee36197a385a9ca2ed92a929b53d0c9194f51749384fab6548fb329b6568247d06212f35d1f06e821aa831435d73a72e83033a40b469f85522883cfa6219fa7ab6e93c721457f7fa4d46385d843b4e21c331b409f55370387087e8f30ea3f132be77937eb1a8bbc34aba0b0fbb8ec740aaf1c0b0d3a2676e013a9d775662ce3a6631277f9073a899c97782c9fdc8fbabe5feab76969ba04305dae931f8d60975f17b15e6edb319bc1ca103acadca54954d159ca40ab19ea9119b4c4c3f94cbcddf1180521758c48e0011b4e9122356db9bcf00bb23b6188eb491d22e27abf7ac9006fbfe3a509f5538b0f2c96b401f0c0494dc5293839ef83fef25af86c523a85fe0c7c762ae6d8ba12ec2063c3bb7dcd265e226b9431847a11fc3ed7f1cacabc0c1049e1492d456e7e102dc9844c9b51764660cce40ca02c49b96e51b36682d2a58528a1f41c5663d8afd1df9b915a4fe91e225fc9604958fc0f87c5743d91fa75a5e4677ba978d731b704d0444d511bb837a042b2bf6f51660d08b4781fd2945ad71acac0470d225356af863d248dbfda44412e010b837dd887d11031b31c10c3ca71aef2604dfe229811d741d2d135dad60866cbe1fa4c82de2532649ddef8e3423a6213c48f0f48da49b8a544172f251a9dcb1ce6be5856912c8f03bd21d632b2d4fc4631fdd7f97ec37a6e8630c7bebbcc9a58a937cfdbab582e4012ccef42d542d2b1ae13df3190e0d80c9e1a594288c2e6650d9cd73c04a74ad043307a4190b71c40c64d510426500bc60a9fa1cc4761a3c8b309d81e1fc8b23b50517cb4df2f20f0616eb4fc64d5ae788ab204ac2c1717cdb55cf43e2605e8f5e9041848887b80182d4884d5e52cf4e203209af1dd51bd40b1e1bf975bed4b66a75b320e7184553056ce6daab5b2f4bbcdba9ffe8f27ffd48f752133cc39d422ad1e4dff7a8708f12cc0fa70cd072989f67d3a9bebe6bb2c064253536949e8f955421ea610a5181d1f97c04105bbbd51aa1a221ec1801ba3667747430a3e73749f5fcdd668defcc3d301d3a63c25a1933a5e326819d80a4507b81202fac34bc404aa949080f2443632c881a720fae986c4bfa18d15ee5d80b67fcfd4b1a4b9e33dee669902bdb16729e54887ef476135892e755eb5a824c71e81e8420a54c5fbc4de51edd4e25aeb1e2c163c8ff53d3576d52f5e05d29cc05477b429cebc912cf3c6bf57c53faca9df260d00b6909fcbd7fe180cedea7a93ffdf5b2a40dfc0ee6f05d0d71bb548c3e4ad0af1e94cf1415174d228c35cf708b09b77d55218c18684cd34b2f4e5269b4076abd30a92431001fd5a1c19184483fbe41d7e967a4dd7d43fc3c232f8104c4e9f1c3c29cd61bddfeaa7c95783f10941550995983d56262ab8e802679ea0bd0910b6e65176138c799afb7adf10c0fcfcbc32348c34fe252e799d29367fe48c408add750bdf1ee3468a4643a6782ad0dd8e3f599a552cb645c6e00fa64dce8871058f56d94a4dbb6d572da1bc06fb037fe2f5bc3787793257172075b11346c758d196b44348e3c504d387df292c34b09af3fa31336f36946ee657fbe685a8656f8d6ef8d124d50d7305fda838c9a3fed60fc2f91f9a361621c525b0fb032a717522bb35fddb844979c0ce448e2e31dcc61161b74c06870b646695ded6adee5feecc9f50385ea20428a31f915b3ebcb37ef337e7dc89c822b8f022363a252d2179888d9de94fdaf931dd52f0ff1713e1e8569f1d25e96ab15a1b624bed251675d82cd51911bf2fd89931ed56e9280a148b992a6f7069717e9d0405021a8a1dfb25137e69c0a6f65ad2beee4b07f6156612a730c34e86d2edcf85e90d022cab29942713dadad01c8cb7ad02d299f4b4596c6e4208649bff6ada87e892cbe32d15be953bb365df9259fdd8ef9e6e7438ccfa134240646e814e1d5dfbf559dd08ebc5385f9aeff1920194721a088f3964c3e9735aa1e81baf8e842e3502ac7ab013e14d04e5874049db55e77532cc4f7ac54faf49db829657635acab79dfb8b11efa636222c773b80a18ecfb1af51a21dda544310b2eeb09dd5ffbe395555b81c8eeb0ef8402a14002bcd5ec74ff5211bf82e1f4de0a4d83e72f9dd1742c31d4130e21d3d7d366f2e1a5fc9c39e6b8c2238806f1bac3ef292ac879183abb22c85e65341589128394dc3911df3eb08e3be8d7ec50d9006443c5f1b526a67c03fa50e4f43ccbc8da4cee8f6f28ef7b276e2e34ad63ec747bf28b2f69d53ee99335c1d25b307a84d13b8c0394e78891a8c6fadd7a8fdc5a677c3d613b791caf55a15b2d3f203e8280918b7b32f1ec3d2ca8f7bd547338661e463fe3c91e52ccdc60f77ae75c41ee72f35568a6b82de360488135d9ef2814fa461ea97a37721e55ff9f1e889f8dd40f922d281a2fb29d51e509e5f9f8048f11d13d487e5a9813529270c9424ca1c06291fd0bd308f3b8c64998f59cbcd644de3016833c8dc2a3a0dbffeb411b6c89e1bde7b2efcfa16f0d03d53fbcb8b3d8a5cb0d273d161def124ea58141a04d9fb08d8ba70ba8b1b22906890acac755a4ed120463494d2a35b343a11c6dae719fb22fad2df0d544a9e5709e16f8e6b672f7e0099b643c5737f9419d3d30fc7cd2da9e94a54bea4ffb3e82ed547611beec70c57b6fcfd04ee0352fd2812aaffa79063f3e11aa0c55e1ba6d9454066f6ef89b46738c174ce7793f2fb751d51272e8fc2abc8b3606f42bf0b966be90d629faf4c7ce08e8ce8db0140e73b6933ba7c942057053efc6108afc970cea63b56da39e46c9663a76187e1c2773b1c8562e7bce900b960a2b0775b9da86b980efcd50117e3af7b400fb3e2f67099f6715c55e387e1cc7fd2b13624d38f5567fc8e080010ac7b48fa1b635b260c882859233679322e120c55aed460eef739acbbb60d9385571c0a9405ca908efed656f39d53a12415eb3b1c6022a2e4e1e1cb2d9ab41b8fa61b8d619cee801feacbad5f8131f1607dec219771758d9b6eda5ace59d3ccbdd72442eafcc128a99823028a9273a6436c374751dcfab612b418f3f7a98b2c49f9493fc1024674de5850175f72a5fae5dca855ea7362cd2a35a51bae2f65c8a36b62fbc85695b9e1ec0d0cad9108274675b08f3749b4604a574264fd29630bbb162715ca5f139f5ca4367e7533ad4a3e5c2e821b7c5fe83a478e4633d321936fd2b6c2f0790f3609d72553f827cefb19799fce1ed874b52d607539670d61b75bbabf78858385f2d9d89cde61da507042ca20f43735e29bdee0233425ea0ff6cf0cc0485c806e882261836a2a016c999496425e9085435356791011f680bfd591a49c2a82cfe3dd9787b5ca8d219e775b21e134ff9df1a4f03f612cf4f01160b5b559c34769cfccf4be2d292d3fc98f1e7fcb6dee55c610ec637478d578bf9691d4166101f661918bd89eaca18d727ad0d81fe798e9c6419a00f2550e01ed2b617508ed5e1c8dd5cead667d70cb2ae307ecf6234fc61c8174af90920e323c47e422bdbe3ec131be7b1be70d828ebb8d998bedbdf3230100c25ae00c5c71722c09d09e63ab4a92472be116150c5e37bae7c7ea31597fdca09a94b4df05a3cc356314f36e00508bccc2c0aadae56c0250adc93d445a5b5336a655aed3ef2db768d16124da188dd822a5651ea50dca11d9561a439cbf547f20f0a7ec5719251dc98ba1e8106a0693434309a19a7a05c4dd09ebcbe4bcfa01fe3e5448f8f519958bef7dfbe4b8d0e773c97e257f16eea85125f4007d627f4c39a2fd3d7459ff4f1b6d75343663d258084b11fc1a02d0e90b266b444f9bbc9f9cb70a4fe5c6ae8f1d9993e90364da3d165665f57df8190382b6a1561c49936ea2383b6981c780b395b79a95f09a90ecbe157c526c5c7880ec2a852e8549c3da34df29b141604a2c0bbc5a1eead5f3eb2bd2db9b777004855c42dd9f7bd2d52b9a5f32b0e04b3413b29397deba7f6db2b9c15f77747ecb64a5970f2b7885e0f37e96e877f456dfdd297d96d263684f6f116276e7feb3394b9d9e23ac1bbe4200a9b37c6963d676dc88d5a8ce65691d10a545a037d3ff91976e8252557404316b1e90cc87448d920a9e3762894b21bc0f12617ba03f2f26846214b480ef22d6dcf6672a235153def8a488f43564f7cfd5c7321eabcccc7fb4470f33e073236335aa7e2b59d833162c61204273e62f83202d1f7f02285b85e57b90ede2dcd160ded1df6f1ecadcf3bea6da4aa73904b7c4cca9dfcbfb3d947a21e9dfdf590af3f9f5a04bd049a10f34c4113835c2d191d95f0598f7bee3e9b0a377118ea5d605918b8126f9a00527b31c296604a44f3a32027dba4e9bd9c116c1b6553402eb3444aaa2383e2b88fc7ff7a9bd8304d5048954f06b34f17d61dd2edb35b36519d24f075f9c3daa63c8fbc6e6c84675a40731138f3107a9623c07a7d23e385ed08d465cf11422dee5817ee9bae52ad557c2cd527becd7b95842c5084cc3c77ec2daa04be57f143bfc5803c2336d079eb78158f87d453cd569439025bfa3362d2d81f0405419e8381790b174f0415999e4ae1948dc6990bccf89ee4a4a235c9f3de69c67f535ac1709cd4c6d49fa9fb830ea5dabfc6c9b093db9a926d67fb7905c17ff5d65dc687d0db56c7e6d183ee372da12fa9b7e25cefa50939ac1fd16a70202b62cff9cb248b579d1a2c347047ebc14216f679957141eb714f36acbadfe683142a4bd27e81c32ed113e241126a26ebc9218052bd5cf9bbd449a35ecf47db155061a26536d84cb50375419e5c649833e420864e4888c235081134c78d976662f819961918fbf1deb3018c4e70e0227fa843e2bf57e80bc8bd83bbdc42a50d19fdbcd0c60181d1c48ca9be9261c06663cb5c13b50f57d5fe0dd428f4304ba4cc7a8aea7d94a7b8519ec1267d1dbf3819d0a4ba988b1b6a2ea3693136e17a03121f21786c5b1f29bd6fc336e86d3f20aabbaaf9de520a18c5fc97fc98913eedc6e344d15b8002b3023b34059d5d38a4585f47ce9ddc40bd407c999b52b889ff0a7e1a8c66c327f55259322f78715a8cf20e3370f046e9db3124369b53c2b673b9babb2c964b1748990ff3c978661790c96bdf4972e251583a610ed6e34cd09a2bb6ebb838661aa9e30c77d70dc52a1049cedae1d3f68ec40e2db63c33034f1756b3e7cf63bc7c0076bc57750e42f6b71ae2c43581f25f0a3bdda69c9182cb0fb3928a385b2abf77ac1a8e3739287c470a73686f83f75fe375df880b0892a6a91b6276c8c5d5ba8b3b33f2fbea7ba4f4f4f92393bb5626091c5e2283b43d392945334bac2a22990727903c2b0983f3ed7dcce7a8bff17d212cc2de39513a56966627d75a16e5d1604632a59924c1dfcf79ebd33477766ac70beceeb3fc8ce12d1b4ceb48728c7a06060c3f789d8f843a4be2719885ef64e29e5aa37960d02610af099e2f9746dbe64d8625491fb71f86b685174ae5c5865d3dca02c387a7135b9266b2af905ec618064778b92e202acf27eed681d772fbdd7779ec72ec0102da18a4961f8efdaa6ea3dd6add9ded6fcdc5e97c4b1419675270908c7f4f75e0e8baecf471b72438b5c21a6c21470436351460e2a7452b4526c43a04b63ce45c4d22fe7c8533f13f68e59772ea64c841cacc74b76ae7f96e62555e25a40c237696b0f0cc6b2f87b227a8b3478b6e553395110c8f967d209195f6eaf9c490814ccea69fccb1dd51dd88eb1ccf2b78873443480afd135e38b35e2f204866a8428442e066684b53a92b189d8b1e589d95a948d87bab22246f5c22cf9cc970de98680228e827af2e07a433936f322542409365aecd1368c33d4e34f418e7ea67e120ab4c75e0dee9e2285ef1d37457f3a7ed5d848d802295f2755cbb5431967bb9c865ac0c775f184aea4fcf8fd4925c63478cf8815bbfbd6aa2486c0d20899223b4bc230978279cb008d86c045081b84c7e6e5baa4d57d235c55b43c79fbf00d62800784aa2b9e75d064696c16bcc5420909d81b36f35f5d15e8bfefd11e817107b6a03b11b0b335073741e2cdb57b3cc5d052e83be908cf3ff6a71bd70a18f792bee787524a4fad8187410d2f7715e7dac2e2f879d21f3cc4c033151f17644bdf8d3cdb007cfa89d94bac2fc4fb0fc86e3a374521466743b1106c936ec06d1d47314ba1133779e006733822fd9e7351d8c986f34ebca007b24b89535350c97c856cd6ff1ec1c4fe9c3fe388f9d857838a3325dda5235ec95b213532c1636923143a6c8cfea8118664eab88943bbd1fe597c383276ec0cd0219cc733a8f93d7dca02ee056470582f9a4ec06f8d414c011680fdb1a2a1d20b81081df776b9801988dc525e4b9661e139e3f84c982431e40bf8a91d1990151a3b023f07b93b217fd2a5a2384d61e954b7c7e710c219052d880f4a145e21a3e1917f906f70931369e9f3eca04d5195e8b8fe82f5758ca74cd2c6ebc372f97e1759dfa479c3e9f13082572f31323885e32ae3afd3b23263d29e31ba2f9f79ad5da0d874f5e8754e169e8438ada839654d9b3dc4d8c13ffe67eccb65dd0e8c19e19787c7566f7c6f642fc53c208734f2c1719af89368d21bcbbcc113165cafc1f9dbf291f0fa2392cc2d033cd87ed76a609b3ec74f85b9d4c8fb32486fe92b2db516569c618c7032634733aa38b51b2372038dd30b733c084d4d01c2eff2c85409ade929bd6d39e83ffbd099b41c6fc6904568eae8ac52e71c4d077ee9a9b25f992663af9c1d6b0fec22ea45a068be3950e09d62ef89d6843fbacdec2a6577a18dbb3ff665243741429c1187a75c729e4816e8b610ae774a647af1a9c33b59fecf3f1c726a9a3da59443b123fe241b1aefacdd189148e71144f0044d8f7b6d83fd8b1434a0e390c35c000d29a487ba1b06d111eb5d3e422289b398373df71abd10bffb73d1c2955897d365ea688509428a6c58caba53c13b936b31cf18b5bf6d4bea74d91086145264962c6d20a184c0767622b5f47dfd82dab29af6816f05c5c39bc99aa6a0833e8f759a5ed63ecd33ee139a2b4d4d106984a4cb8c54a74fa1c279cc9417b4b9e8285538bd0f96f657130eca2cf772f84ffbe64f096241873f08ada26b402716ca80eeacf86d4ef5069c2eecaa535378229162a8edecb47602d31413c923b6027b617e0d75da17289aba6e8fb9fe954ae49d48f4fb0697eb80a1caa5b56558faab8a7d086b73db40f4bd71973457af9e1c37ada803e0c4cdddae1ac678c1744bccc86cab534e9abb6b802844e70306b0fbe618869d5e8ec27030c68bf063d818fd71da90f345f5588294aac485b47d2370bf6f24319c88ca8c523e0bb19deaec15f45a8f77b08c08750265b56d61ece147503a7ca5cb60c06717341e29f8343d927ca3d9d954c75d2f3dadaa3c0eea9cad47236a41ed3385cd89d2feb45290d5407020b229866326955194435b1d7cce3a93fab717c9bc3c7d104993e57c07fc57160efe967a48017f752f9052a2ad8ef39f4453b952a70f5e59c8883494c5e9c22125760af9cf13dcb100e31ad9888c1898153620fdb712b7c9df27129b6fb45c1d4261a83fee0e6f8a5673796ef29c269c8b124645d78d1880f3e00ac469f79fe32a3e9b07a318d8aae2b76bef7f5db186ee4b004a54ae9c751aded681fef961381b1134bc60aeb276c548c8fcd4f8172be553c25a06faf9b6951792c74c51df574e3c4d2491a2bd5060cfa80936e75c044b154f93c1b98c510552fdf4b8d01c79d1217f434099fa2918534818a6d597afca2b1b494865e180acaa4a2b38155808820f7c07f7e2944d6525dee40f2480eb7a95a604e60e8bd458bf8ae8361ec57b1620dbe6bb254e72a486dd839941f26640521e330aba90a0e1c904502fcb03e59fd891b6da028acd4485a9d5c4dd18a78bfbc60ab7eed63c1579220dc5baa3491a044324b74b7d06d206d6af0b0550d02b2ac5c91c703d1caf4027690a1f06793f95e676b3aa7a5488cc84ae6edb02fc48de7fa659ecd30b15e48d4ec30ca0ed62ff99e1e1d3de22bd3c3041960720b8ce2a546c4f67b4ccad664c8d956ffa1f4ad981335ad2c8fd3a78e62b9f8a9cc0a82d9be09e361e819e850421afbe4130571980043be60c3d15c5e05967c002e96132aa98838044b3fc2b6f616108afee3873cda9a8e361d40715e8e720f8b65f48f24e8aa940fae9cb54dd0bfc94ef8ad87931a7da72f8c2d546a4b950fe1a36eb4b878ca7bc498bf0453c8f9b7c0da20f491c9a1bcc4c27f2b37a186dd0e7b0f2a07078f8e0b720526602daf436b848e45ba67408ed1648b02aa4b05e87b95248e3c18d29072f7e975694a66dd82cd6802ce34c88d9b13b44f0f8811d4f1a242dba5a2a2ce8d046b50c1ba59844034d2cdbc08400590591e3add3b3126c304f5c434b974d0b0aad2af4c97f651c2b108da78f5d16c87ba2b8413048c62b8e592b9f466400aeccb076aebc25e8b04f2033a5bd04783ae47682fff6aa5b5821faa52533b76c403c20a394f591c309b668352b32650ccdd2996f198f3c0559987cfac656ef9da03f5d06529eb10760f39ba4448ab8568f5eed07642b199a3c403c17b14015c006e1752188e21320a80a4491a49bfe1bfa71e508183c9df0f6177ec72eb785545d2d55adfe919eedb121246b7d5e86a72ad9db9c900de1fb814485106fbe66a68e8fc68eb0f21c2572e3a5969efc5cbf8cb856c873324a46f15de4cb4bc1fedbeecfbf554b9ced1971692af5456cb2c01c26f6d11777e9b54ac59baeb403430a6e2cb41e0b99508eef74822e11a97a52671081a9a1b9a4b4e482090d0b1c9f3383e16f364d661b199f6a38d1a551606d648a41e3e3b7a6726e29d3de66191f234ab7fe8753bf28d1337d3be4bdab64de8da37b8be92fcd29d69da879770ac8bc2f1f0237c481b1cb8ab2b3d93b0829a42f67a46b6141ad26d1c74b1336ba1e3c7c745fbd88a0b2e506ebc9ba0c9b07a651d2a3dce123cab43033b5ca0653e9514ad942f07955c809d76ebcf5e2504aa527bc721e669dbb88ed33c0a0f8e9919c16287ac9589653899171494fc1228eef0b5d49c444f3600d245dc62b6c11e0cdc242cf4999e66073c014655c265cd2a341c9ee6b27d7c29d3e774e67bfaa7d6b6473ae7aae4c4ef1a297a6d0408a1b329c7440360d3dfe8e9cb6fb3af454e900253ba62298b782980d7a69ba95541a55ce2e1146a7e4234ca0e5d814b68ed885c2d88c5c875e938df1c12f27812e58a7b93f1534a16fc0c1c1535158affc3dd830b4b73ee848a6db6bd94daed8c089a80fa35c71c1f82b27a4c346dc91c9ef83715933a1fc520c7bf63010ee822e3bd40a62c6a6a22b0746e5b1b5deb05a4cc754d260e26987d9ccb33a3110370c29858da13db2b2852c0075f93e78fbfeb42402c8252f53c309e5b98c602bb8bd38d25ba77f271ffda746bd9fe80193098a7f11b94a8405e31d509549292848d6e9c5e2af3338b2e889b0c55dc91362e8649b3659a9408f7aa0fd33cb3bf958d9167dbfb60d5e786b7b5df5929784f8e2f7daa8fbb9e4b3be44f6cd72f3d8ff06560c0f7286b9ba126cbc04023309bfbc8f30b0d2f1647b797872a736f448c31af9a18b600586d23dcdd51138e04fdfcf2aa54a29c256b65b27113dc06e33be202ac1583b0341d7d4fa794b0904c0115fdb34080195f1629e28e74750147be4a4336aa9b5e3ece994c0ea466c55ac3634fcf84c30fade695d72016720e50f42bea7128953ea81fa672164d76c57a00f1476d26467fde034cce097415fac40adf72d2eb3cb166498a1af152c7dd576511d4182580d374796a753f53a710a1fb061f1561c8de0acb18e983b56619a8ca23d38b3719175535429eb7bb4bd71a7d5328dbb33e880c97f0d098fd8d5deb589da046af3058159df937d46f6ec73243d779231e3e99122941b48bd1e111471a474c6f1dd13ecbb50e6cb9b2eeeac9ba72baa8602acd5a4e6ec6583f242d4bb807e710e1099045be90c1286ea0d343147831c57d84eb5fa9fc00526720417b36ad4d99f8734ab36066b6392fcd4d2298bcdc38a22956ec56acdbc8a3c9dc929a35ac6f923a10beb253d5e84edb9be581aabf4c33dcd0ccba5c8e47f0e69cd5ce3e8a14fc2ed1f72a68c7b27ebde58dfcc174e6b684b37a5301f9e36dbb89cd13b05ac7d23515a3f2fd854689ed2c3d0d9bdce373b975752ba156da2a1b6286a375901914e9cc2bd207bd79f383d77bc046ae8d3db32c54d7ab84261b1f8f8ed25ba5a43a32b619a80c651b6e960dcb1817e075184a1577cd1b82e79a54ebf7c78be1d1e238db0c0762961eee49c45784b26de7b7aa2f0376100b5d2b288cc551a85de9acfa08ad2099194f4235ec1a59c9d8442c6490fc2aff98d99d129b8ec33e4203d000f39b4d7eda24876dfce1873ea66b1428780b56fe0260ab13a0db72464a0977b1e215d6d421851a6e8583c6e9d58d94b2f56db8b27b3ddc0014ca9386cbed699201b0e07c3c58785d1e3fb8624f2f182dba11a1d889c1d6459b149799a4111a19f378cfd3353680f2a9c38d98b3c061fc697725bb4fe0b31fb7bbb2df8967fca9081f157d3284d17c7418569b2ad24379ba5834cc3de8b97282ef9f078f227754f9eac89bfb0bef6bd91b825ec77ec8e257ddb3fb13c340e1d66f2072431efc074de865bcee08eb0f79da98d2dea3419e2afdaac32c04c65187a26e24c6643dc7a2591df8903be14df9499cb0a9661d2ce81b237118e7b6135ed6945ef296f629413e3adfedfe4c23913492639aec20f3f545a21430b8377862d325d395f4a199b16fa4a593f10fd540b65325b1a83100a603f0a7353c187a4101a0a5cd6b0901fa0520c77eb80edffbf44ba29c6308598a6b9c92b0d60390facec9fa5c5579c186ba3c22843963af9d4a97a91b2cc27264fedd18182b7d07c77edf90bf2ebbd5908c8a71289aebcc02c04165bb681651c92f1d0a649fce3e0a8e3caa5cda459370acbeafef99c2bb8ed674de149af054af0daf3c6ba062da91fd363b82e4a892388bdb54778b5d06e63d08ef2011e0e4b5a8b9ff901bb19cca8758853151ee084e2ddc2c8a1b19180fe60a09d3fdaf8cc7005a957ef981cef9c37b47fd72fec869269bf34f7404793bc0dccbb59b7f60c74f64c38de7d88c24dad0b9d90ad9722a1e8be0a8de1ef659b30eb68f6f93bc9b3e3077d0ef12e3023bbb78c112816cae167ca6b338e3a587e669197f1961f1a6852edbbe056739275f4f3bb202ff315cee213f0c2cc7f1dcf49cfa1263d62be67431085c51ee8481d6b40e94464160014d1e01f1942bdfaebcf1b18ea408b4ecd834e1dd8619a55894d65c50ba93c90cb20db57521a96b8e0d28ed374b15f5b1a2a090dcfad22bcdc997f4108f1fa894c16ffcd748e8b90c8570cf971c00f29686203fc12870f2b138b6e7b67e82c1717ef7057f525536b7e3240ee05f2f07cdac6a0d9e99aa0bebe121fb44ec8267bfefa5f96fba0b103123137d04ea4c93d4bbdd2e6e109520add34e826213c703dd03215b80d8544ed785f223b61ef2682a7c05a4f50e7a3f876408ecea1ebcb9624678a7edd98b219867e8ecf5608dc9d7528f9f073e821ee9e6820c449a1f38ac3c9fe2322a031f210041061657409d12c2cc7bf9a559cd295573bd9a27d1bc74a54bb9c68346e39ef1a81f7fe699ea70177d00918d6457fa29118f9c911643874c017293b8c763d56f4fb4315a60d30b1b4f1f6439526a886d6b235b39ee0501e371fadd0bf1ff21d16d8e53145b1dda7e3004a68a61a570078c9e1574bdd44ac1c43db045aa4e6fcb68d9d429f36fc76d0dfb4e6428751caded5109883e6b9642aca28ccd642807841a14ed1d63c726db10db0327274e597d6135816ff1cb525d8a97d69934a54631ba21416e754f95739fbfb20e2fcb79e204230686bce75f7f7dbc7bf2f904a1d25e0b7b803784d19b88e83e3677195dac6224329625e4ad0eb0b9e466171fd963e44f4458b993fdb9f9accaf2ba2a1df0992a8c5ce96eafbaf90573308c8e61e53beb9561631e51bed73bbb5c222416505439b248276005d43761f66034f07c6968a9aaa17c1d03b51b4b4aba60747f3c39e0c134dc8ec4bcd11a5ccb3d237866d235f593b253b795220d1f6607fa0c787251f579363239e6b6271fe9889f0aaec9edcdf9f2dfeb6eaf2d2baae417f86ef2b352316ac23564f6e84cec70de12b042f6803fc9e633fb99e4f0536c2e104a680421839336ae9807e39380a96a979234fe8803a6fb4d8f861cec2bfd106f9c37a7bfbc838f63c3c0ecbba75ea766c9b422683bb69dea2fef8084ff6cc1a451206d64f1dcc60faab24b66c5d6787b10c906464a138c9488f2831c912e7d4c496cde5998f1c4ccd39a6842f61126d31090690da30d9332f369bdcc3d8472898f522b6b5574a247fc7bfd51e580d6da76be1bbd388e485f9d61fa6e7d34c0e637c532de3854044a685caa96db20ea2ed1526a1d7ee9817527d77253e367180c150c00896535fe9b9472473e918f02a9554e03426646a1ae3c1458b8b11de284b862eb41b4feebefc33fe2829a33ba6612fee53119ea8753b997d1ee1922a88dcc49dadac6be7fa41701b06c8b879b24b6f85a96888c3d7df7b4a984a0dcc1214dd62d830da18aab7c95525943a97d871aa2d975b88d3e780e9077e9cdf2f9b82541b4a8cc4d41e78be9932c69f123f126ba437aaaf72ffcdff11609c2988ed640ba22067e073329df58b398728e930d509f22f47827c5c65d1bdc7a5be45fe565aa9e9e20c40035960aca477189d9268335cc4f81f59a384926a7ae5562c6b763222fc5d462debd5dce01aaeceedbe12fb6a0a2dd7355d6ebc1078f3f5a90f9d4a1856d5d87a564fe82f30e2b7d9a5b130c4514cff54f9cbad34b6e0df7b59bea8c3e750c189c30e2a9675e23b63f6e5f17d0f488fb4a252924326ab237af62d1f468e5d23ae6729ab741c8384a24410d569d5f102f59cf577d6481f62c007b1190f987b1e76b9c432a912633090fc7744f48dd0c3403b2abe9f499ea5a5519a4d28a162eb08772a37668c1ad4a002d91435f371c953062823a46d6f73226d80409b0feaa9b228344cb54097c6f03880d22ab5f5547b3f0f6d8de8b56e67b61bd17adce706cee439c63988807abec289b684b051f7193f835035f7988be42e7bed8962b8b0b604548d4bf4a1a60b406794225f4e8949726e178f6e378cd36a414d6766c8b33177569341fd02071e718263237108cc6b99f82f67e42b2ab37d6efa3972686301f002cecd198a35ad7154257ff4cda980b91bc3f57927290bbf42ceb3a7000d242c835c1b582abf06914ecd80de6f501edf30aa6e15fb4bd7d63e551fa120bd27aaef7e8a7f9bd217d17cc525ec5d6cb3801bcf07590e20751957d8d76709a11fb6a31b201dffe89e391da9021e5d4c69416753d4754878ac410ebde8598c392b3bda0b48fe5953133f9f75c16589d62cb338f61aac6cd4082a64eec36d7bcffa3571c328f07baae26d31c3a9e1a1193f85e7289c09ccf7c7dafe3068b6def2d2dccff89b4193d53ddfefc6fbe69b5f2f9f075065c78f2c0047cdae5df341a7e62f3aedb3a06cf5315babe5e2fb9ff8bffa832058db1b0d4a8d9825603790b6b2ae3a91bb4afb497ded2be489be146679d2702d5ec3e769de73090484b5d761a13a38f87d3aa455e2e1bd917caa51daf6c9855c1fa135cb523ee21568f59b2cde57562809644cc59b7336b9d2d548790213e015bfbdd12be1696874f9bfd2655c9f5fe5f31149b19d0f832e0ffeb62695e4aceae7ffc8d78aecce6588e72fa1941688cdd00ee2eef4b1dc0be95ccc604ab10b3f1eb7cfe5d3892b52e2573ea3d269e73c93fa8c189002e443bef1d212cbf9c70bf6001b2ee38d12fedb3b7d472849007e7418d12ff4c9d5a09a4914622a598d85ea9d5a4e906facc22224af69d967053da37cde2838e36a66823e0476e3788a9afd9784d0fcf7d35157bf5c5f18a6b89a8b8031412606fe20ea5bcb7b6677cefd55e67d8e8132c09aad5c6d2bdac6680abc17ae67b210d96c029d6fa564ae5ad4cee0a1791c9e0221c5b487f9daf223ff0c57194e835dfe7b1d98bb322be8adad0209d54d5525f359552787283ac832eeaedbc5676da237976163e11626b46c9f2e1f7f797d54a34c1363e7103e4e6ef3af50e67bf4973f0cf8051f6929a2096b1b3b84fa2debf197f592db9d2b7c9efcf0d4edb3778d6f2f7c09730beb3e40c009028132064c68d0f557511b13ca5b5632771c73af844c2ef2c90bd35f1e3d4f5dafb541451ab3bf72074b3cec95d7fd7ea9bf30bf9fa84c2be0af1abe158b5cede8a2a4729fc288907214f50c0776f05708ac110426c2e7adb2fd042d4f6ee8878befff13f49912b416407f160558390957db9fdd4811cb017567ddf3dcaf15253334592b54cef29b92a74c2de858393aa055b310597180f7421f1838bebcd554290f2ce284dcfb6df145f4f5fe780487b47b98c3711697c89dda026db3d4cc8807beef7b314a7a1fa8661e6398831668ed6e191067f9a67bbcb040ccc566d8f73f56efde10879ac9a78399a6acfcc0455e64625880225001f4f1b18550acb0917c831f5420b11a684da6192cf6cf68a8b686174382117b3c476b856da87c2d0a3782376f9617b921c5fa2c0b47ea8fdbefef1d24eccebc5c80ae6019d1745048768a35f1853c1b02dd3dadc58dba36ed874f280db4e5e828a371e554709dbf69c30dff4888497f77b947781cf5b8025f18e4728286efebf3b3b7369ac052d3b3eada2c1cd628941e1c4e0ffc751cbc16309d90da6ada7f51e0dffd38cfd53ac75c9474990a2f40a6f8aef145d7a0c2d7ce0246beadc6b6eca387aec43259a1696373f4d8a660e63fba7cc45567741d578892060025ddc86563f2116589c8e88358293501b044720b7408808d6f89dd3026b5b18fb8e2e1a823aec32c41f1c0937680c5060901ceb70aa6bf16ce23c18cf17648f49073a98c3d1e41dff510cfbf4439ca7a25115709a9ce39b791cae459fcf4356983cd03443ae610df5d0f211120f285e6eec2f353fb5548867d420cfebc1d4692410cbf66dbf42d9bfc5e6bb7159601e0cb3a2ac83bceb0064d508fdec9f00ebab432ee9c121d5caa323c9a39905e2513dc1e896f66b7cd8692c5d4d0886462432d89846fb5bedf22efad8203e1d8b552a4c4a2ff5e905d3140d86d30eac606a05bce057082dda2e7591f40a4708939283f0741a27ea53ac4c08b9b758430cb18c1756a41d508afdeba757571bbbf0903d169d8807ba44a08ad3bd21592731492d478fb212130892475fd0fbc89d4263560c791e58e58d8a90b541f40197296f3c5c2aa49f5ae0b86e4ef9e5c54f5a3cad826627a5947c7e2f6238f6e74c5bccbd817e7ec89b97d5b690bbbdad0e59ab2ff2bc58cc08437fbe1013413b09bdeeaddee9757d139e616eda740936e4e26ae6edb2f1bfcd36342c6ce29c3009fd257d42758441f8a7196bca861db031fd070bc6b6429ffec04fa10d75b73cd3bfd2cdc6c13f6755114f23bc528c0410ab098df6243e1c534371d5437b24c8c06bc8ae6b24592d2e5cc036afd8f325a774347afbf919e70715e9267d15bd79a9c5671b77a2ed3665a478d5d39772adf3f97e63b1d8cccf56d2b5b6687adfe40e317eed1e0c7c0904cf98b6175b633f076d1ebde7ae074ef8ccdeefb6f96705f9c501ebfd47b27caad602972470ca9841005e4e25d4da7b76e20a316ea07b3ed5c379a0474ec6d7e95ea49274374310952aec723d06d7bbe143872c3439e152d921cf061b01a908c7c3246c02b5dba06b5610033ba4cd0701f95e53a6369d9c40872b3b65463ffda2ef8e225d3f977adf03522f78c17ceeb881d20ba1fc6beda4aa58b6e4bd1956797140366b777f88cfeef0572b6b008679d301b2759b97e16e5475233fa88f2f628c2961f83d0c60b71ba294e7a95e9adb4b6f13e3180a39aef9db30b8c950c8929562c39d6ba038f5f6d5b145c713f08418abd875c7ebf885f1dbeb78c0f93475bf7d967d89531f7740137ba539c9b67536cd46f7aa779750ea11eed47867e37811d07d23b28252c38a2a90730e4054c980a12302706c03f5ec5f59767d3e9a079281f04374bbfedb2b66802f6e5491ce5736e8ba56fe97e60d62070e844d9012bcf9d8d7396a309adfdd4d5d111923a259dc2e52d8b15014b042f4ab6e4618dbe262e088a7ffa7e9407e36a6eb689ccefec4a1895c7f4c39c65f96d1de031031860929dab1d28246c71a20ec54d259b7c56dd5f43ce5572587e88054cf9d703fa8e18be8c886621e6a9d0c8c1ffcfb0c2cc523a02ddda5da8b1f8a61571212103047c79d5ae92399f7b696b90a679100481385c7ba37cf025ffe79b2b512ecdff295f241306e73c67284a47c0338a0e5737c588bab0dea0c1003d7c423a54d21d31af652f19ead9be37d8af0b1bb6f64e2817b6b25828a0d29e05eac961ffa8c19c3ebcd40ac428124504241b68de53080bdb333f84c80967e4a767d0d7cc024895a41db5cc2ae4a8ba343e6814a0ad2ee4de10763bce30083e44513d41a3bc99021afdc67f6d1ccd72030eb4d1e306bd420e0816bbd0657a4b133be375997f81febb033ed5234913c9a8617fee7957cc3a7b34923918ae70ef2e56a8dedd7d9a5420593f2bdc46a573e1b6485da612bd9bca5f97119a80fd64087df93725a5d298409da1ba7360a7d30d7ef5aa3bc20cf8a66f164f5fa27b2f636f94696083da28ffb65d41872e1aa008421fdaf3cf4d96e8dfc3a4eb2155f463e724f9caebe3b8aba89e30f456b2cda052d0da46783be0f9c522cee7cb7ac5b2e65f2465fde85ba213b75674765c09ef9a6dd95d9efbed14ddd2159939090aa5fe2cb7d218ba3e026c76421397b1ae8c15d523956b2fa9906e91bae0472ef6d90642dab4b32c0209ca5b63bb4a2d224c61bd2cc3213aae1b09deb8b482ce03422a689a1f14a7d7d149483c1a3c60482337d885a809d6ad2ed0f1f4c7120b52f167b028e19929468ce44287a298f07a2a15e10fab22e4b924c8b2e8dfe2ee9cdad9dd3fcb5ce314c75edeb84da890babe706a6081ca950982d223eb3943481f88338ba2534c47a4f9d7a35008f5c9241cb50c92ab7e8273cca6f82dd98d448f40df3de47c8f853dbd71d232f818ff2c657acc362a1d2ec6f3a88674630650a4d3a5e750e7d44b88b0e4c36b94a588d4411d46ce8ae080b3b0cc5af6d33749cbea9a2e62c24a7a39446c3af603ea120329f44612d83624b9e79332b60a03a9219f988404e3505c7abf30be92765dea6b300a31def7e0ec2331ddc2090695a030e0fbe1d6acbfa700523a7e4ff7bcd4f2fec1dfc55dedc9e45cb53c6b5281add4064500cc1691d8a5887ca10f8c27d005ba8614fab82c61d34d8d6ea80c10a537c638949043cf7fe7c5e67a63a5ce0db1f42945f72a29f56064f84df47139002ed27171003b1dd73c7c43932953273f855c7f00571d0e457313bec4f5b7f61cfa0624739605183ee1a3f6b45d5d7f9c93a4ad48f288240220289f5179aa8952a638352427d2716604e599001e034b29c2c783060aa443fd9941cf2374f714e6455847878cf2564d3712dfc02a76d89b566383506c8daf8a5ee425237e1f4d0be1a1c9f44880028e50e3bcceffa610cef045bd039ba223265bf3c087ef4a1c1a906f9c449425ab65967e160bcdabb567e9de92b290199e0ff274d6d253d9d839d20b6499cdf037bbe357b6acf2de716826c9ad5918652f175fccb45045a3965f87c3ba01c8da9f894c47027f0a11f6cae53e90d19a9604a142dc724b8f12903bedc981b96cc8f6931b5e00e54a957af774e4df6a4f4dd141da179eef563fc74e99b4e25c19c9e07bbb4f8d052785749467ab7030374095fc641fcba483f5e4727c55245fbbaadbe814f03a89c0fccf2f9e9ad5066fc971e51611279b13b7a1fcc17d3b98857cdbd6d2582c6a024f6b1483302bfc2587a424385426c5cd5bce5543c41f5b5047940e88b43274673698e2dacc466b847e906b45ea48b330b60cf51a3bb2c2a8311d8c298632c82e950a01fc6b3f3f5d099278a5c89ba2d3abe5c7712ec173a4f23a48e0416709b69cb36cbd16adbda8788b33377a88a5e62cba87d6327e8a9f535c3f9dcb5cd14473cf9b324e62ac98dab7c25fe3564520c04d441fece74ea7ba97bce3ca68df882c1b368b25d565b768b6bbd8ac43adfdddc88432f50003e30ed808e367201c58ab64675383bb28f8b2e6d899371b84be1dc26d5ba30fd7d3de36bec35c9a943f496bcb2f04ac11614af221e8efb6a33478336ca3da658502b28fc93165d3856df2ad90d8adeee9ae54b98cdfe0828416510faee133254d946d2704e373a9390db9200ffe1e82d7b349209c738ce506d3847fa0798d92e5e232387f27fa9f37f8d53aa5cdf4897ac3b9c4607889518d55032b39156eedfac064d3025f4f6acb7e2a436e54b030af6398d54dc42255971c0f699ac9f8fae597dfe2d51905df323b0122aa6c9a7abe86ba286eb2c567aab5608805997caf6f43c6e9526f44c54aa8b5e617ca205f245f087a91b878c095d567af7fa1a52d10267b8db0793b5b1889ec7ccbe03e877b5c880c94fd5aa9590ad0847b4461d62aaf583e543be3c6ad88cf3ab635ee468d400a3e6c854cabac98129b8c863d7a97373a1877dbd4a5c65eaa02e5d21b73f3e3b8e914eb721588100645927371ac3486fae26663cf1ccc993403e3e300fe76c009721be267594f4f05b18f3955b958df5949f3e6302d15782ac6ed616e431f15c10b76cdc464dc05f13fe0ca174b7d94cb0e99cd212ff81f848abd12e16608d94d9a3395aa213a10042792a329dae31e60b73dc0d3b87ab78404ebeb65993cf87151e226450bcae9ba1b73e8d0147ea47dacd12c1d6bca6158a4099f103359c91eb3b9c64dd46a6b7a44db588fd3b00f564bc5f10a445e7bd693b4418b6f2d2d51f9c7ef5f3518ebb68b925a374e5f71023e82e65b1dc4accbabff4a54d50136fd930d8970136b136b56ce56e2036067048eafc815d44f1e9645132a7281409c96170772dcdc09f1d4023002748013effb9adce2a9c3446d39be24f2cc6b865b0b9c3351a0a08d9f0a947ec7fe90a7cd5c5e30b8188bae0013d9181977206108497d5c7b30eddf92847db6a3db9572ccf0df68ba8580360a76093c39ac1b3138bf5237e538ba53705f657e239f9b18c1b68cfd13be98e84ada065d545fc7facf97ae4cf3cffce7979dfc3c0665c86696d6b7379ca718f5105c3cb64771bb4177364db766dd5b7560bfc7eeb6a712e82c7cdccc6fbf78f153280f7370948ae297f4d47d4900891250559ecfd28280f3d9dd1994c363fc039248402a4628dfc5c966b8d43d557e90e84fc637bf05f65db688c7a9855326104ddf22d6a1c2fef53d1c4a6dcd2192b879f497c3f95daf77057dddc1092db0031391ac0ea3836b989db94d101d8a4e676c358e67f537e53318e0b10f33673e6bf380617fcc8cb2e5ae6c8d412b85093f2a0fd1ac6844e8307c7041a17ca13e173c82a2cce8929dd99aa13ce962e28f47120f39d85bf6f7fe1943f29de4606c7a21ec108037f099774c250b05a6db074e6469532acc5d2c61a7b458f2cbaad8db2eb39d32f37f0785228f97511036249fbdd4c3c5fde7ec2f7bfa1f202983145adf2d20d4e6be4c1c89342eee209359ca328068cae8fbb06466d3da5659a1045ce90df9a0194390b411df4ce0d04e0c3e96e923a959c5448951321e5459757a4dfc937967c88bc9f71111f2f8a84064f664bf7bce43fb0f9abc7a07e5a5115d2eecdeeace0f4889da15199efbd2e83cf012cb55c3512c12776dd7dd2f9719d8949a6090477d90ee0354cbefb5b9057f1d907d7ba65a1ce37491951c26c3dddcf671ec55f5b18bff4fb73af63c3816b67ddaa13e49dd24d325edcd0dc7fc819ba3fd454363604cae4cd950535ec3091503303321ed483400c528df14c02e0aad10a80268deb50da4fde7fdaea1a7a325b4ebc7b687ebf9df5dc1b43408e9e348310d84cc193b41efe026092580a4f1a1f776e4d245e2d1af3e36de444c128c17d25fd595bd08370f302f54bde4138e180242dd7caf90e24e809896e3f603df27a43180866cd6f008c197057d335f30cdfaa025834426eebe675a81c6a18bd692c33a02c868888370ae77a74ad9e0cab297f5d3670cfc43c90862f471a5b7dd1a0405c2822e3a103cd33fb4f36d20cd046bfd500368a9ed4493c90be1fae2bafb84e8b389e01ecdc594f61eeb2bd2347f0ccb4dbf1098a38650d010090a5667f10548855e8f5f668329e7719f20d248eebacc9b54d728ac8b683d0e9dbf105222e6c6c3ed5b0192e85e0d375ff917f99ff8eb0540a7f8cc6e0230d7a9aba870583b238d10231ed659b85905d2cc54fe3b39b8b26b7e5ffe81e29e7f452e177a43fe72072c344450d3db2ac2005af3e8e4d29d53fbf8d5897823d4f416b8294342d1d1c7b49d19894e7dec4c7efedf6cf513680279a1f23585cccc7bdf9425952b6c3fd5b617495f905e8dc7eadc4eb367cd4fbac019a823c7f35dbcd2d65e62d9c536f1a0fb1794775456b4af024d3c1a3fe0e8c22fbb3a693f33b4795569fbeaeef9f73eaead9d7d9c478ef93fd3014a8339f6d6f762e23e1b8e775c73b3b0394d59b702e3e29b8194ad0837670ecb296856ad5bcfc29324566cf962be36866baa2c96c70629dd6b56c69e20376c771495f1ee5fec487b98825a72e2b72484b3ca893d7264191b2eb49c4897ac79b99190a2c62ff57351587cc403599d6d465ad0bc2531af36e78ca0d61adc85f2ed69c7ec8236147319a6b850bdfefb9b371dff114547cc492cc686c5f92911486aec69da30a17791c197710fbad1dae3b4e6dfff6a2ce12a20e6d7581def07c51d317750bab7a40b81177d9cb25a135d922f9e73ecde3693aaac2d5e3241c8f434178e3b93099d1594da437c0acb92824ba21e0f47f8238856d4805bdfdb2b9fed905bc2469a4af332a0ecccc6ba2ca9f0f621ec890b022ba871618675954e7efbcc14ff6d2fe56bd0b953a9f23bb5b61cd0e8edd557ef231627cecf2bd37fef667310d9783eb5b77aa6f41800a0faa8c16595f9738444d98291b5e31501685951df7f01c7156dfcfb611e2d8d21becccacc57ce22e18ff0cb48ca87194553b5a91c2ebd40eb89f80bbe1f6c4337dddc4a76b295a7f6030f542440659e3af9d1805f97ca1abc44367971f954be69c4f324734747a740c4c3bebc081dd4656d804ee5f2464ee07ed76942c0f4e27e76de95887dd2f8159b339abe4dc9998f0b6004a227da2ee5623e1f1fe7507ad071d4393dfb59a53937d15f943156c69328dead0e1eb90c8bb3f0c7c29e384272b09302568fb6792d0614716a2dda21d1dc3a523a57bf832ae41cf06075c2343a63d5335020b613a43878d585bb2b7c32afa163b2761fe27b4a1b85c0428594f0efb5c45e8b5f49b6858ac4caa39155c9050f0333ea1c0604ad4ca5246332711e4a421d94b38337925f336ccc61f20a2f260f4ed1656b3a96c17b230d0c77f0afd155e210d574b9f33089e7d2e25ff8cd4742804da5acface9d546dfaaac6b4ac96d2c735d8d2a259f6ca8d274f7e3a46d5084b5663319e8be9125edc9ca71a354ad2907fecd1829d8938481043ae6acb42b8f7534de9aa104e89fd740cfa769244569bcb186d8c73f7055d7261ae239dd2980ca98a9559f18e1e53e5ca76adb94b6abb36ce1786806e021b7a0237212c76c867371b5bea488aaec98c22d809a4886f008e322e927fea3881202edd95568cd923ce7e325fe28d75d23901181b5d2be20bbc771a204a37b073a535d255f61e4a7bda7d495c327291bd09a017e12c3cb5cfd4fb2626bc9f9f004a491b85a0e8d84edec48347ca177f18a1aab56028e8ef93463d2f3a77dba58aa35eb8b151296443cd423d41c15365cc19dcfc5f094bd047cccd7e61946bd775983d99a3c3a355b535b933e5eae1fc652b0554d4747563d3f7b1ffd3c38b6045128bb4e60e99ecc97c8de4f605270a66e9c159950ba94df1fb3231b40e0ea206bc95ed64b6d47bdcac0e6430d0d3586b23038102f51bf53bfc25e29907a5f484338879db0a76c2a66be07b7417a09752dad3055f5edfd51e4528287fcfa08dc0061c715ddc91356589765df12831d90b2f2fbd352839d5f54a1810e000765a805f9b09044ef112beba930e4e1214268b5f2402fb7449f60fea1ba81b62aa60a1271e31ecb84b2686b9c2141b76756768e8d380989443fb5d3cc069a00bcccac2f3276a86af84512dccb7f2ed1735770d1c083e6c5bfb77616332b68b9e0e903357bfbd92f9ee54de3704cc5380ec192cee1f954f575ceef7549b118c006eeba9b6c7671ea01cd411aa5bee93a6699f1245b55c7ef3aab217cd84b5943e98845d3c15daf5d02741ebeeee3bbc557fbaf0ad099375feba1c6c4e77f98dfe8df638330f226b67de546e1ad048bfe9db9f0da8c68c24e1facc18c4076a246f6ee1976fe668b792aba598c93c54ce3e276f45e832254784e01fe4fe265aaa85443a2b3cfeb06258333fd4ebecfdcb96a8b725b675f3560ddd261a01c072616a39fd158aed2dbde3e9f0634968e7df2c8a517bc41e088195502503c87e59d5c7dfaa7f5ee68b968a56fac83204adf61252900c41fe9d2e274607bee643456b03cadecad2bb78102f06254290e9e58a6bdfbf99aef5f1876e38fc79dae22c51665b45f2091c99245c70e9da35f7edf2922cab288b9ff5ac2792a8adbdceaaa4078a842cdd0321d8684de7871c0604d1c602e7432b1e0322c892368cab40f9ca19b6f782ad4c7268ad2fc5f77ae5bf2962d111c89856cedb48c8cff10b0f822aa8c85048b54b6a9217b823c1a0c3c4e4595c1a242df947a70dbb37a2e4c09b810ce5f7d824319a0e93bbc314b7d5d28a2d1592fbbf101f0b4382f7540a65021ff145078a632616d36a753835a2bff4082c602734162ec4b251cbc0ad4b5d4a932be7765b1373c1373a290000a4fae35fe58f2b1aa458ebfdfc7b1c1845cf2217e1c06fcbe3326fa092d04c66e843cec6a21c19e9235d3c35586ff23b73f733a4c9a2978592c45e1f6e50d84ed9454147664ad1ebd7bbb9ccb32b01db096c72ddd089d959a3b960a1c31e2159ac2739b827dc288ae2d206bb5b598ea06e7ff47864ec8f342e1ab91b7e14e5dacbce87b91271d719c16d29a7797d34343eca24b0f689640a41311a56b249d70c6475311899dc748aa4c7521e0f4056a740e59a206101e74ebec8e81d5e48b7ed4379e94a9de5b30b20dd8f9def0a3350efdec4165ffa5595b17add5fa68e3e8a654227cadbdcb16717a4d1dd4d3150375c3c00860868ff200ec53f4815cd92316712a2703505473d9e28f5a806f7d48f0f807371363311db9e50c883c7dd266e3c9d15a3304f471513e287cea3fc7a2c4e551d88a6bdaf57cc1aab2280d222c307cd7ba9feb5e5b695029e58e9b7a03befd93cf9f383c2c7f229e8f77b70f4e06c7d6393203ce9db717a09b9798573c23d2349183dd7d5431bcff714f8aa83663f80da76af64ffcd2e8953e240c4c3faa747457019fdc168b40429fdab704913b218783f9968493290ee30dc12e4e313e192ee1aab593c82f2b0977e42b7238db2fc8bfa072cbf36d471e8913e3cf370d8172ef80436955ed6ea48bae92b2862abc13d07dc66fbd15e64d28fee285b2ece8ae01ac018d5736071ff375249a0f501a5da82250184675150c4e582bd340c3add77c550fe300dc3e04152a8a199b911baf72c01cdf79642c318d1674dfee4648425645bfa3be80485a737d8ff69eac4e8233ebcf7a46ea62ed0f7c01cab645ff2a94876aacb38b37c834dc9f39749aed4e1ac2210d023d5385314e0b30d01c3e88ac81ade6df6d4736deb2e215936b52fc18245f59a6ab959ba012e6ae8261e9db33b4a3a98ffaee278e48750d2b4915086c920992dd096f8583f4e3b31ea77877fa07edbb97618288e4fcd22f8576548382efeb00fbc01d09ad85aa841f0d9ea85819f65588a2f493409dd9b15c34cc77007ae557d045ffadb53118fc44034433837746d1079b36f1fbdf74872471d391b8dce9c0f949a79fc0a99d04a86a2076159007c009b4d7e0277bbaf209feae7fecee326afd66bac50815983f0594ac9f3d6e9d5e703b9b1ecd6888a73e2ad6ae3775c45af5de3e832e86ec16a3b0bbce5fdb917d677dbbe5e1cdcf4ff962bd57945111dd9efb4df4d0946b1faaa12e4b1ab39eec2c4ff9241de6cb06c6c1fb88e293176d9237620960d2cc26d703278d723d9b67f2bbeac9c39a0da38db179eca4b07cee538bea3421ff0fbd7a4fd26269d209e59a41f9862515eed8962239221fb550c7a488ba03331a15de380e0156d34b53a9fcc63738963ee52e157b8b23e79ef3abc8484fc8d004198daf34fce32a2eef005a15fddc80f736f902f1d9cabec478db9d6400a75e1e6a64139ed479606ff9c567ef8a619872250f34a36719d610d41811573726742ccd3f9fc2fc63038d381fd0ed6f8f31a70a6cc41ac0e21434005bae590ddc2c3dd4df827e9b30c68896c18a36f98a85fb66029d8ff4586d425ff9099b0ad1560279ed00efee2830e5d31dbeb811ad90a5b1407fd1cf67d3324ab7198092d1b3304788ef0a7a021ac896544216fa4ebd68a833abab792af3c3cbbc11aa053f36b431b246b26c7b272654597c99ed686c6c80c8b32e81848625e253316de7fca6a91ff780afe4691ef6f22260e7a220c089dd587c259131d41ad5ce4ed2d2762668999ec90c98ba29e11a8050cc84cfb130bf600ebeee5a209f1ec6e18261120bd9fcb7e1cf3bf908c3aab817fc3cc171d94a947549b5ab1c15fb7bfab69403a03a620e13abbb601ffe04f799a7a83c1d7957ba1f650f9c24c9e1816153b8f3269ac2440c599be2390d835c8de4a6e7aed97480890c487901361a6d110e92af91afd1257f13dcd08d89cf2636cbeb149445cd6678983b17e8ffea004b326c7339d3a1a1dbd794eb50602562d7cdcb65f6a1daec3f5025481d9751ce9234e0fc455194f139c677ea416084c684c5dc54cb7676f68a3160a8123d7fb8590f50638fc3a7712dd5bbccf6b4516c3e446c2a36b7054f97cf2e14fccfb52e39efba480e133f080213807c558be8f703d579f5eae20476b0b77584573a07e3f284db55807fc47b7c515b521836426f0cfac569513a4d95b549dfdab6ed0820c634ee5bcd6e6b961fcdc497876017dbbeacc0e74b326158b8603db9a47d8010de18d62fa60d018dbbdbc8409fa9f83b4881a21bfa224dc34feb87d341e0d53faaa354fa72982cb969259de3330f719e054c057e7595cc130607dd5a3827e43e75327345d9cfe27d3e7a1bb9b804200bec39e60c7a8f06bd0d1b2e6d03fd4e0bc58ec3c8af90ca9031c1a4339567195cd0078a976bfc583b39f4cdf551d34f78ebb488c929dc19f2d0c0c0938a3f5b08757034991d456e5e4bbd8865f4c4e179529d97e68aa8f62110d660b6e5ae81df40b423188d19c22e6aeea67905052f726dab1c2cf18f27682242479b8dce260a27e40727e58ea65648b911cde9514543ecf061fad49d899632d8814d8c22db373bc9cadc0c7c9e5ebbf4eadb71fdd0afdc7bb5043af8823a1b998e0fd1b7c89c713c05d2dc747a001a88a46411212a52a265fa2b95511bd56e35657b870c2783e549f8d8900df7fbd213d3002ca45bb608f76f77f3deff963771e740fefcd0803acbbdb135b693997ffabb1cbc03955cd47703d1676096c00e8e68eb4c09d272614b85ffc80df4a867009be0255cd72d1855cc32315d1df0bccfca2ce8983a1ee52de995e159a8cf7b005cce91a655785939f10a751d4d02b2012c5a63e687b75a516318e8cc47e8f398e21959f904e96a8a33e8a90040f4bbf212a7e5bdb214c9a8fababc08c692d27b62fb5d7fe00ee8039d6fef8de1c162307b4edb30d3360da60c1c79e957162de8854a5c51b0bbb5716c35a05a15b29602112fb77c79d79db348632d192b92a43957d916ec2f0dd5c6383e9ee418691c0b078e075fcd854e100233e599ca41b9f1fd532d23ba5b475cf7e5a338dd875739e17a04c2fb9dd7b6bdb6345f1e8dc44d30b15c1031d55dd50efcc84a97044a3b3904862ac679986dc565e72b9047d5973e42c8a9c9606d0c4c168cefdc2ed797ed4dfcc2f6876adf43f4c8a9e4339aecf009b59a3c1777081efadbba5dff5199d2000f987e22ddfd4ae5b7e7c9c50d65ea808f4f23c4f13d6af46743b8b9599c23c35822476bc2991a3510b5c0a3f475b21fe4327ebb545cab1e9edbbec4b4ee7aee5cc884ed6725d3308658640f7111f8d3d91aca457826a55d3b543f5bab0f5dcec7b784e605ae56b7d2bdb8e8d6ef30ce5f88abc12788b1a90d9935f6f40627cf164a3b550800fc6fd7728e62a4ea32037618a1648240b8691f55fd8d6f08b3ef28bb254ad60ef431ab04a28f3a99a09df4b901a879d3c3dc68cfdc649f4241018ad1cb40ab338423fc9a78c657f1f703fad7ef1f4243d89f57abb589a948148ad3e8df2fe3e09d02e2db62e2176ab29a91cb59919c3732baefb3a4b871aedec6fc1947e0d908e7f1ffd5a4b7f2f9c3cfec1b74caa59daf45a41ab1a7b2cc50f89c5b0589e777edc7125c81340a2dede1917a7086b7cbcb66b6d3d02049cd4d47f65c3a0d73357fc787beaad5d771565df690e2846ffe609e1bbe80987ef7cfe8b88491ae27f0398a62f81147e439c217ec87de36f6be38ed99e81af632aad9204aa56cc3839de25ff15ad68c77f8881c9bc1d731b65730d9d742d7c26e1c031bf07c00a83238570afd8a18ef296bbfd48cc8838ff14cd404eaea44fbcf423a4d4c875049605302ba1bebbcd7d7670a18c8f6e1a37729e5419de85e2c299ef1d02089b8b5877842d3c695279e8ca1faebcf82e95cee2c3524c5016fc9b666b0e1e2423bc9bcd1fde4adfcf999f9f4dddbbfd7c8f7e73f7b2837dfd715f0e67d8338d6c15aacc8b008e64a98e34ff3075b9bdf62d327a298ec7f23f616da68c4f8d02433cbdaf28c66d7f39363566b43865f6657aac0bbea8714a48b036d99dff4ecb65e64a0d0713753548cd3e6e69e6250ce5b9c35aa2dda7efbc4c0f50146c00ad3bd3d7e70c8650c8e4f951f7ace3f5226d994726cafb616938721da56e9a11116ab3d709e961f99e32b167958fa478515b8623b32840e94abf3b397e64e7f047773a6db7de1bb4f6ba1ac655dce869fc7a1607d1f29b73b7113e469da65018843953a88499aa9941d9b78e6b0f632c66c7e2b26db58b12c14b9bec1a067ccf6713c1ba6b67b398056607a0cfafa2a695b48385e775f0806582d4a44ab334f8bd75f4f5f60966270a1a421fd9328d43549267715b3979167712f774cd5f37f3d7b7a1eda86d7ff4b4db2a14fff3adfb4f93a677a28a4be56d6a73c0f2208275ba6ba27c38d84afadccd8d6a59888bb96e3b35cea9d4704d7ca91e72ad2f6e02793b74e1cbc4b4d17ffde84d358adb6e72f92e5228d0fcd60e8c2ae6a1f5a1a0f52808f819f89ed6877b7ad5581e4c53099024879c46137b04932a22d7048dccc2bd780daece733bec231f113ff33f24596b62cc31a45f8c4cacb42e3eb272955cbee98154d7c9395c392d95c49db6789116e2af400ae033961f7026023a9633a884f6710695ede857a0356070e56806449378fca45435f68766475884a9193662cc12e173e0f50d1891dea47de66fbe0b8d6c6e9756b6cdcc53d08fbf0a22701d19d5e500aa96d680efac061da909183d89819dc757ae8779b4a9f9da27ba3ba2c1685af22fbb7afa5e9b1e21e238acc52da5","isRememberEnabled":true,"rememberDurationInDays":0,"staticryptSaltUniqueVariableName":"302f04ab65624dcfc8b384e844909600"};

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
        