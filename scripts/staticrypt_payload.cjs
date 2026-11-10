// Use StatiCrypt's installed codec for encrypted Markdown and extracted HTML payloads.
const fs = require("node:fs");
const path = require("node:path");

async function main() {
    const request = JSON.parse(fs.readFileSync(0, "utf8"));
    const packageRoot = path.resolve(path.dirname(fs.realpathSync(request.staticrypt)), "..");
    const engine = require(path.join(packageRoot, "lib/cryptoEngine.js"));
    const codec = require(path.join(packageRoot, "lib/codec.js")).init(engine);
    const salt = request.payload?.staticryptSaltUniqueVariableName || request.salt || engine.generateRandomSalt();
    const hashedPassword = await engine.hashPassword(request.password, salt);

    if (request.action === "decrypt") {
        const result = await codec.decode(request.payload.staticryptEncryptedMsgUniqueVariableName, hashedPassword, salt);
        if (!result.success) throw new Error("Could not decrypt the presentation with the supplied password.");
        process.stdout.write(JSON.stringify(result.decoded));
    } else if (request.action === "encrypt") {
        process.stdout.write(JSON.stringify({
            format: "staticrypt-markdown",
            version: 1,
            staticryptSaltUniqueVariableName: salt,
            staticryptEncryptedMsgUniqueVariableName: await codec.encodeWithHashedPassword(request.source, hashedPassword),
        }));
    } else {
        throw new Error("Unknown StatiCrypt payload action.");
    }
}

main().catch((error) => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
});
