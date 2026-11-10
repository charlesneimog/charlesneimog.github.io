
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
                staticryptConfig = {"staticryptEncryptedMsgUniqueVariableName":"d0da4e50cc21a11c9fb0a532014e9f0c086d573a34a5f4b390328250eac39b75678e7cf5723728d8dbc5b829ead6074eb31a267333258fb8b9cb3232e9c1c1b297ddc0c0b5a210a8591368ec105c8827dfe4dbef2c51f9476601e10b8736907741186087e0c6528d024672fdea3e004efc3fafcee8242807985fc64bfec40788ff2cabcf4f5d7538c6003533b65b19586451c9afe585d9a2ee49fc776cd6e269fb40043ac0dd57591fd05153d5c7ba53ea1129c977cb30eb8f96b4fdf098040fd0363ff5ae3672b81e5341fc4b1bcde20c21fc65c0cd48fd864280b7d1c4659b6d1dac005882f8bdb1545d3acc6facd97a4591a37ded6cd93852bfb4097582760bf755d2ae1bf70df1d58c0c4e34c043a1407df0cc0b5e9d883fd1714150fff0c9bf280f4c4f903ff59f33a18623459807beb816f0f2e1d9760d2660e363ab2a128248d6326c054db0ddcb7c62092ba197605df88d648652b2eb9175280158839700cce608f42f5e59f6a97a32de604f91a36b56fc8d35bf7610584b3940c23887a360fb996c2d30cd33bbd5637c38e3220b12d27a8be7d3b36840946ae9379bfa340e25614119826a27960c4540a85ae85fcfa6277874d47bd3a6a6883ad36d75dafb644305a15c3980a184d141db78d43c46614d578e7969bbcea3f4bee24b673c2fb43327935690c86e452bdf6d1ec1714199c4436d8bee28502b11bc009657afa245b54c1763832045ef98cdf7895c155894b2832d012aa798498f32ef3e8f2ea37f55c57b4ef7ceffdf6c4e40130c390756a5bf875465ebee6ae7c914e249fe23fb3377df0e67d03df5aab1c61e42fd9f98edf38732e6f90faa84c38a5c3dd23fafed3f09bc493a42362c6cff4a4db8e8dbecbd3e0d9435fd24eb101c018cbb56094a8e939ecb355de04d1d870fe80e0bb04c8496886d7b64661b89e36169482993cd8159781dc42f0a7895fe444a2d58b363467e8ab803e6e85a895746ec1e36b681eb85e4c2f2789239d94b9b995805017b14e721cb198ca00a6372b9d6d9601318a85449458f02b4e20acdec8c798e019a1f57c2d3a4545ade784fac3f51639c60da60cfa96061b645a2a855140721c9b58175c262216ea2a14bc3ca9a23fde186b46e6a712c39ec1c9c08705354ef5796c2d369a845ce3564a7bcf67a0237c18e4a808d9255acb7b430104b0164c76738afedd17ff641fec06c579c9a73d0bf1c9312d8e919ee695779449bbc156f2f8e9746cae23702ff1fcbe490a811829e4bc5707842aac46ebb7a54b6338d51130b3f9e267ec4e7756fb62e789af21c3c6f01f0d1ec43363fdc26fb332146de36aba9a803a5189dd7e407874fa12bac1a6ae48faa51b70b5951a51a2b3c3fcc5cfd01c850e907656bb97c73d732f81e00c14ae0bccb7761c5dce3b02ea90e5843ce74534fad65bf599e2e89edd12a01273e638bb4a7cb27cf0c76fcb98a8dd890a4e6a86cab86dc78dd230d0b5870ed4c32d998e94f35e8406c7e7f247308877a4660428c8233d7085b1da9ad3789ce050a1cee9f61280eeb605063991b2949eb8e42539daef5608f3833a43d81cef8d949e9087e0ccc9e56511672fb0c82d64804abe66715bfcfd6a7f20e4e43579af873fc4c030bd4fbbef960471ae3fee5142a963f31476be359e9b0b41dcdec229228475cdcae0bd64b759c84969f39a0a9ba03933100e99ab7574fe576c4acabe3f48dc1a6db8a77ef5455ad1315a605fe4c99375ea3a988ddd7339698e146c77a269ec5272eda6556d44b930254829b3cba80f9589e87993b93c5b390002c96f766d7ead0ec455d8f34b41ec5c392fee2b8475e57d4f1fa87bc7c48a67ce088aa06c02cd57e6a8277a27dc757c9fdf7fbadb39a55da3929ab333ff63a074657b26fd2db3b429d3034b5d64f0c3b317327a43b209d6fefa15f7c19bc4471d84d67032d7f0cf77b822db5a8f61c20f887009d7b33a2f50d7c561ce6976459d2a067eb8d2107c51d9a15c3197593f9a13ce8979ee21b3674064969dd91a4f772b50f1303e31fd6d356218d4d2f125f4db6e8f48858f3a132af2a63b4559c97e03454fa5cf2f7b64a14f5ba0f955f8c2b92f50387a3543a50bbc73549543136dc50746605ba665b5867dcc4aa70c4123122af64d1850f373fdeed5f6ec2725a53df46d9d963f703ead25fdd372d44326eaf75b0a1b35efe7333ca3ed4c178cf5e4f1fd94e50adb90375ccaa0ec770226809eb995c1c82aaa1bd3856b8d93fc50093e8d75f502af126c0c90d3a9df56b6f0349a79114353ae9d70035c5d999a16c3d4bbc189358c25aef08e0d3ad0053adc18f3b042f483af51deefddb64654c65492b0c952e4932b297a16a55156bb680fd8726e21aba3d5e90a4fe55c28ff12851c3a9671ee4f6022cd6a205a52af2fcdc1227a9e5769a2ca9ff8c9b2c950479d5ee6301e28ec18fd5f64a90231ef4ec2ee83f381467db7072f9906977174fa9e9436d9056f029f843332d0efb67a2e35acf334d97b5dfff33b7d2962c7504b983ee2e0da92a64b7531e9888f8d8b4df055084cb7c2954bbd15a1068bce9bd12bfe0b93a8d394aaeba17d0d198e6b05de62ec5b8b869a452fff40829457ae7fe8e4816eef7aad884f9a51f519c1a324bde44dbb71e3d57cd6e7409b2f9deda8eeb2f0a37d5945702221168e1a940fd44fa120507bd7a98a7e5fcd00a7b670990f77efe08c700809f91d0aadc0a2d790ab5e220f020b755bb1658ffe3000b37001279261e1f8d3361e24a1381fde2e301b10b127651a3b60b9c6723a9ec25a9130b0cab36a4beac2e6fda3f4868a8047585301f263dc479b06459d972daa496a205e1c0e777c93639658e272902ccf501934cc475771578c6042b37a0ca01720bac0c6876f27fde49c0df5eb98377fc1485c56f79e57ff068e25ef4409cd00d5ae8f9b6c889bdf2e7de217fa4b6853483ef8a69db76f19c6141988bb00ea794f37c1ad379a1e80a82cf50cfb9c741f2d2515ce12f42e74a8b087d93c9c5db0cbe655ebaf623ac84c6ee013cba3e92a8d2bed1d8addac286fd861ae9099900203ec7ad587dbead4644b9d436cd803033ffde3acaf47dd9802570e0df1ec13be79a08e4a311f6756887e5a22c05f880c73728bc0bbfa7960db12fcfed9044caf8b50e217cee995f0006f4279987ee459f2d28ab250f5a6dee21f6749af3ccae7d15ab12457182a3d1b8eedd7769b0705b04f2e352017a3f21a6d96a7aa04a38d63507bc192470a74b1abfe5d5aed0df1d36887efe9700b8e7b1328293d5a8a6e7c6fdfeac3f00b393f0a936a7ce55d28951e9054f796c41216f1c7666024b6749266087dc82ba4fc3fa23ecfe7cf3a73039de15d9baf641d279e548758420f112719925eb697d15a759f6113de28340df66683fd35666fbad9af617b1a222b8c094bc71f8ac8bc4b5023a0e9e79ae167030e37cb9ae2d073b6df7650f8699a2027050210692eefb5e3a2debb37b281630aafb410889082422dad3f1c04ed0d85d06f522ccb3740b0483f5ceed6ca052aabca797d5b55b63b9ad991a4d65b2a52c056620b44e598dc507ca7be8058326517c64b3377f3693e227dab39822ce3515c7ac1527b0ad374bfef803d2bb32f9e1f4f3710d4a7377bceaf1c300820159f880fb40f02858800f2ae30e448c1f7a564dd2288f5df0ffad5f3b2bc80c8ed6dd8f95ba56aa3787435a97b2313be1286a07d3b216b010e90fd95e47c27cf92573bc341d552bbd3760995f79e45d97f6af0141d3a25549ec084f3c43a91a2d80158f7a3690f896a217e94448c3da47276d46ac9e9bf237766f7ca57fad6ca06de7c2148d3eeb0a1d35f389e97e6a2fe66c48beee3840d45b6f53201162e4258d1c2b5375ccaade25cf88722019ea7afced23148a0f3ead990c2bc1931f409d75f76fbfe9430e6c9e3d6151ea648f7c4bf2036e987f126ada59b22bfdc42f1e38cdfcc2540d8718204ccfb3a64442ee4bc1732eedf5dd2f482274f24db77e54aea4c857c22c557fea79adb05bbded6b49c40a26b41db5497fb9d205006a7479673439a7509416bfa5a4876f45078c44514af75feb8c06f8b44d37ad2f9f6f88f2ed127e88317b2ec3928a12594c351cf821de304746ec9fa51f740fd342d03e47ac914276324a93ae9953679e4e4ce7daa48f236dd68a1232dbd75f9465b5a778e88508f4982c4e01782fff3ece1b0b87439ca32ed3ef9f7640e5813bae97028bd8050d90d157635a5c709d492a8674886f5a3f24d32d098ad31e80f0b842559979562b12393e6bb23255e980e9ccb39421b31d4da127d4cd83eaea6e792895662c60d5f8a0570d6c14336b3edeae757e56b00e2a53552566b7e08aeb013f0ff0b179dfb800021cd05662c0c152a8e932104e5455424897f468292837ad191a128b2097ec7838b13887452fc5a485d8a3e59186a11d98bf12ee604b4d5c8523a50069cad1b848f6943c94780237d8dcd0b5f31ce305b738d2f32c996b8d4b16f75771585c116c4e7ea6a10accc6fa2ae3825ac175fa3478bfad1c702cdb9fef0586f1801ceeb9cfe3948477c0df4b1ed13707396f01982a21edbe718481a1acdb7b7f1ae5d2d47d82b3344de2e738d4207c334fbb2458a5dd26e0b2d1178f87cd8e90983774e727da0cced64c4ffa735977db9d5cf7a02c2082404cf4195ea0aea8bf5ed4ce586ea61819dbfda13277c63f493d4d36a74b5971c627c79055ab94f9118f0942906ce3575d945cdd74b896bd721be5345723d740bf20cd14b75283d2c28e167cb16a25f94c1ad64992cff8a5e14824d1a33230e17a7cbc2e4a5899cecf9f19e1e9f040f05bebda084b124d4a88452a74b90a9be2deae657ea9b581d1a03ccbbb125373ab96008922b526d47496bf24c93f1d1a714f11eef1eee21e4da31bcb03bc17563eeafa6e0010d826459d88ed08590ebf4145b57a3866e8ffca9a6ffb55a133a427a3fa1353feed08e9929b585f9c27f81b6408658fe93307337c26991686f456c32e407c9fdceb022726ea8170ecc246bb8407f41e8ceeeaf178058d4de76cd7669a1030e9748d90647a31321cc3ed403a43d3cfbc3b3d832a2c450718228c9d1ba2ef7c2d760705eebd57d0f0af9f52e9822ae298a2ea14e72bedc8a49402ecdbca1cef2b8abe6692d6ac3b905635aeeccbae313219e67f3086810be6c499c3a39580b4b4c4366203447db558f20e90c92910a5c89bed3d165bb812b56451f6f71464f1155c7a1075eb000e47bbed477aab0fdc8a2eceae49a47efb53394c2729e4cc465658d7ef99e06502c5b1d3f66c5a7a8f39aac97e288377fb3e9b01a40420d745179c3355790461c7ab7819ad423adca1ee7bf476dece873f475f456cb3855285bd8829092c2b81648f88f068244c67c6672bf2929b057115aa54a96d3329e76d48cb5a1870037d2e57ea8e02361d533bcb95bd6f8ce3db53988c5576ae8909da7ae54baf12c232fab2a24c7bb4c4f134245c59b8f7b89c1ed51f153f67e7ae620c8290c92ed7a742bc05f484a743be07a2c3f2a63e2c85984c0e66618d275f509b67275e2268c901a33b9dfb10d778a77c7e46558b731d36dd9f3d0623231d11b315b8df38e10a24fe5041263bc3d77ef5b0dba121ea6f2d31f2e6b3a779c7340c06012d76b14c78549891889916eafd4a60c41a7f41da76390f624e154d05736726f583468962aa2701c3a5742b8764f8403494ebfff2158c4ae5a88e3bf8308a9cb36ef13c418ac36a9dcb70c5dd33e48ea88a5007a34ffe2ff0c3b9430a1f68c7066cebf632be0d1a1f7acb78b9744c32bbcb9cf8f2ffe05fa2c58e2a1a4c3e7b4d83d5271e9f10df2062960599f434ed4827478dbf70435a2b3732305c5bfe4971fcac5a370dc3937ea5e761f1ccfee61f9ddea15e721f8a08bdd5c504a5aaa9c798de6b30f334783447385098e258b2c68408b007655a3ccf9a5c2a86b7b51212190413b55db9df7d5b8ef5a3445a13b1a21a8ab3bcc2f284716be6f8cb53a42692ba020317c7adc26f1d82954fdfcc8c8b087ca06830e3b4a43eb6f23f961ba4d78671eb59e06acf4e524699d1122ccbc0bb58ebbc4fea62f870c984e74af48bb316f5a4023d95cf49fc6ee55213241d3e31f50a41330bffbc5b3fbe6c60870304729b5d71a4dd256d546dc7678bf16cd30da122b9482573e3522fdaf51d84601b3ca0ffbc759c338cfcfcb9d1e1e5601affec88dc79f4517f984a3f3eb349977b3ba28a6d94c132c3ce639866de4c01064866c6b221a244cc7ac440f86e3865b5bb61bf50af6888526278c9b19cf6f1246c558bd8a51d880d2c5bddec343e621e02d60f7cdce671394308b04986625a6bfe815cf8ca8e4f01b28a23e940f644354af8fdf0f4d058b61b5cb43586c11582eda357a90808de78c5c6bdd21c267822aacf4d772a54e55a22bd25badf44852c36229377d44a859cad1971b66a15bd28829eba3609f72e2c6beaa2ce30720a35e356dbd162bb1560dd322759e24abb19198a3d9bce2c3a7fbc03ec35f80d8f719a1934dc8659e8bd5044a582a54b760404c9dc6215b26ccb77620d42b3f3fb799789890bed02ddfb252ce3178f09aa38b428cd13fbdd4c0b548cfad67bea256013dbc3afe6a1b3039aea0048843e3098a8b762af610a72d331211d3f6750ba33e1ff552fdc6efbccc2e92d7a0c95364cd7824aab03bd0346e3a29f6b25760662e3a83147f2350f948cc0b3f0aa1aa7349a9f098352d26abb92d750927dcbf314e4057fc62001a772cc3e2f8f96b5ffd889b0596c236702e47975e65686999afba36a5958162bad67256c7e1dababd12e14bae79ab6ce812b6d493c303c23809d42c01682811625e6b6f1961f3fffc6dfbdfe0fefb53a5d7dfdc77b412f592d8cde576fd24893cda97c2e8be532bbe498adb985d3b977f8fdf7407e7fcc75893f7be5083d27772832677026190e8add0c1ef5e7b1d5bd22e8e19bc9366d0b07242aa2182614b32cd4a7edb37215823ddd20b4339e06b8bd1831fdf316cd35842da1a2e8b3c11c5271891045fc29903676fa13cef1e1f2faa24683fb5740f415713b2057a5f780bd1d78872914baddbbd1bc3b777043abfdbeadb1b6e99dfec57bde19814c9769bd4d791bdb6507f45632559e31814cb959618e0ce76bf173f06b331fe9851d4d29d86a2632cd295fab7b5711036dec049924c2fa6aec49ee0891ef61852d5a2d3a421cdfb45455fe5030b651c0920acd29bd75a705746182ff298d867ed01b1ecfdc506a27c059d528cdcd7ac4975cf11f9520f65b941c4adaa5338a0d4b9a74bb0154a1c95f918ffda285e253c526db6df6e4577bf7f4fbe74dbc377c52d7b9f5b24a19e68cb5eef62d1a4184cd359cc971943b06c2fa97e88ce77479fe2a2f54bb705fa6900309c9d6f153fa560c39fa6ec381846976a45de296a675eda1977ff62efac4488b4eb26357a6d6f5e6ac4bebd650560605feaf8f132f01a89e414c911a76d9d2786d6e4ee8cdf511f116dcfe00e4397256f46b479a1c891882a366927b67d3e11c405146dd55663929d8fdbe65143b855ad3eab71d19142e5022568e0384354ad54e966f7fd1e3472904554ba3293928d0bf0791d5ff027b2ed82e87f1a31c2a02e2d4ad428a2f1c77e2c29836b94d356677b88b","isRememberEnabled":true,"rememberDurationInDays":0,"staticryptSaltUniqueVariableName":"302f04ab65624dcfc8b384e844909600"};

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
        