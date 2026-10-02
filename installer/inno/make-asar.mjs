/*
 * Build the tiny Discord injector asar. It loads Void Client from
 * %LOCALAPPDATA%\DelexooVencord\Vencord\dist on whatever PC it is installed on.
 */
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const indexJs = `const path = require("path");
const root = process.env.LOCALAPPDATA || process.env.APPDATA;
require(path.join(root, "DelexooVencord", "Vencord", "dist", "patcher.js"));
`;

const packageJson = `{"name":"discord","main":"index.js"}`;

function pad4(buf) {
    const extra = (4 - (buf.length % 4)) % 4;
    return extra ? Buffer.concat([buf, Buffer.alloc(extra)]) : buf;
}

function pickleString(value) {
    const bytes = Buffer.from(value, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length, 0);
    const payload = pad4(Buffer.concat([length, bytes]));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    return Buffer.concat([header, payload]);
}

function pack(files) {
    let offset = 0;
    const listing = {};
    const blobs = [];
    for (const file of files) {
        listing[file.name] = { size: file.data.length, offset: String(offset) };
        blobs.push(file.data);
        offset += file.data.length;
    }
    const headerJson = JSON.stringify({ files: listing });
    const headerPickle = pickleString(headerJson);
    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeUInt32LE(4, 0);
    sizeBuf.writeUInt32LE(headerPickle.length, 4);
    return Buffer.concat([sizeBuf, headerPickle, ...blobs]);
}

const asar = pack([
    { name: "index.js", data: Buffer.from(indexJs) },
    { name: "package.json", data: Buffer.from(packageJson) }
]);

const out = join(dirname(fileURLToPath(import.meta.url)), "app.asar");
writeFileSync(out, asar);
console.log(`Wrote ${out} (${asar.length} bytes)`);
