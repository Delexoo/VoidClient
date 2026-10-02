/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "crypto";
import { app, net, shell, IpcMainInvokeEvent } from "electron";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "fs";
import { join } from "path";

type FileIdx = { size: number; offs: number[]; };

const index = new Map<string, FileIdx>();

function rootDir() {
    const docs = app.getPath("documents");
    const next = join(docs, "StalkerMode");
    const prev = join(docs, "HackerMode");
    if (!existsSync(next) && existsSync(prev)) {
        try { renameSync(prev, next); } catch { /* folder is in use; keep the old path */ }
    }
    const dir = existsSync(next) ? next : (existsSync(prev) ? prev : next);
    mkdirSync(dir, { recursive: true });
    return dir;
}

function safeName(value: string) {
    return String(value || "").replace(/[^\w.-]/g, "_") || "note.md";
}

function auditNames() {
    return readdirSync(rootDir())
        .filter(name => name.endsWith(".md") && (name.startsWith("audit-") || name === "ledger.md"))
        .sort();
}

function lineOffs(full: string): number[] {
    if (!existsSync(full)) return [];
    const size = statSync(full).size;
    const hit = index.get(full);
    if (hit && hit.size === size) return hit.offs;
    const buf = readFileSync(full);
    const offs: number[] = [];
    let start = 0;
    for (let i = 0; i <= buf.length; i++) {
        if (i === buf.length || buf[i] === 10) {
            if (buf[start] === 45 && start + 1 < buf.length && buf[start + 1] === 32) offs.push(start);
            start = i + 1;
        }
    }
    index.set(full, { size, offs });
    return offs;
}

function noteAppend(full: string, text: string, before: number) {
    let hit = index.get(full);
    if (!hit || hit.size !== before) {
        index.delete(full);
        lineOffs(full);
        return;
    }
    let pos = before;
    const parts = String(text || "").split("\n");
    for (let i = 0; i < parts.length; i++) {
        const line = parts[i];
        const chunk = i < parts.length - 1 ? `${line}\n` : line;
        const bytes = Buffer.byteLength(chunk, "utf8");
        if (line.startsWith("- ")) hit.offs.push(pos);
        pos += bytes;
    }
    hit.size = existsSync(full) ? statSync(full).size : pos;
}

function readBytes(full: string, start: number, end: number) {
    const len = Math.max(0, end - start);
    if (!len) return "";
    const fd = openSync(full, "r");
    try {
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, start);
        return buf.toString("utf8");
    } finally {
        closeSync(fd);
    }
}

export async function rootPath(_: IpcMainInvokeEvent) {
    try {
        return { ok: true as const, data: rootDir() };
    } catch (e) {
        return { ok: false as const, data: String(e).replace(/^Error:\s*/, "") };
    }
}

export async function openFolder(_: IpcMainInvokeEvent) {
    try {
        await shell.openPath(rootDir());
        return { ok: true as const, data: rootDir() };
    } catch (e) {
        return { ok: false as const, data: String(e).replace(/^Error:\s*/, "") };
    }
}

export async function readMd(_: IpcMainInvokeEvent, name: string) {
    try {
        const full = join(rootDir(), safeName(name));
        if (!existsSync(full)) return { ok: true as const, data: "" };
        return { ok: true as const, data: readFileSync(full, "utf8") };
    } catch (e) {
        return { ok: false as const, data: String(e).replace(/^Error:\s*/, "") };
    }
}

export async function writeMd(_: IpcMainInvokeEvent, name: string, text: string) {
    try {
        const full = join(rootDir(), safeName(name));
        writeFileSync(full, String(text || ""), "utf8");
        index.delete(full);
        return { ok: true as const, data: "ok" };
    } catch (e) {
        return { ok: false as const, data: String(e).replace(/^Error:\s*/, "") };
    }
}

export async function appendMd(_: IpcMainInvokeEvent, name: string, text: string) {
    try {
        const full = join(rootDir(), safeName(name));
        if (!existsSync(full)) writeFileSync(full, "# Audit\n\n", "utf8");
        const before = statSync(full).size;
        appendFileSync(full, String(text || ""), "utf8");
        noteAppend(full, String(text || ""), before);
        return { ok: true as const, data: "ok" };
    } catch (e) {
        return { ok: false as const, data: String(e).replace(/^Error:\s*/, "") };
    }
}

export async function listMd(_: IpcMainInvokeEvent) {
    try {
        const names = readdirSync(rootDir()).filter(name => name.endsWith(".md"));
        return { ok: true as const, data: names.join(",") };
    } catch (e) {
        return { ok: false as const, data: String(e).replace(/^Error:\s*/, "") };
    }
}

export async function auditCatalog(_: IpcMainInvokeEvent) {
    try {
        const files: Array<{ name: string; lines: number; }> = [];
        let total = 0;
        for (const name of auditNames()) {
            const lines = lineOffs(join(rootDir(), name)).length;
            files.push({ name, lines });
            total += lines;
        }
        return { ok: true as const, data: JSON.stringify({ total, files }) };
    } catch (e) {
        return { ok: false as const, data: String(e).replace(/^Error:\s*/, "") };
    }
}

export async function readAuditWindow(_: IpcMainInvokeEvent, newestStart: number, count: number) {
    try {
        const start = Math.max(0, Number(newestStart) || 0);
        const want = Math.min(80, Math.max(1, Number(count) || 24));
        const files = auditNames();
        let skip = start;
        const collected: string[] = [];
        for (let f = files.length - 1; f >= 0 && collected.length < want; f--) {
            const full = join(rootDir(), files[f]);
            const offs = lineOffs(full);
            const n = offs.length;
            if (skip >= n) {
                skip -= n;
                continue;
            }
            const take = Math.min(want - collected.length, n - skip);
            const size = statSync(full).size;
            for (let k = 0; k < take; k++) {
                const li = n - 1 - skip - k;
                if (li < 0) break;
                const a = offs[li];
                const b = li + 1 < n ? offs[li + 1] : size;
                collected.push(readBytes(full, a, b).replace(/\r?\n$/, ""));
            }
            skip = 0;
        }
        return { ok: true as const, data: collected.join("\n") };
    } catch (e) {
        return { ok: false as const, data: String(e).replace(/^Error:\s*/, "") };
    }
}

export async function searchAudit(_: IpcMainInvokeEvent, query: string, limit: number) {
    try {
        const q = String(query || "").toLowerCase().trim();
        const cap = Math.min(20000, Math.max(1, Number(limit) || 80));
        if (!q) return readAuditWindow(_, 0, cap);
        const files = auditNames();
        const hits: string[] = [];
        for (let f = files.length - 1; f >= 0 && hits.length < cap; f--) {
            const full = join(rootDir(), files[f]);
            const offs = lineOffs(full);
            const size = existsSync(full) ? statSync(full).size : 0;
            for (let li = offs.length - 1; li >= 0 && hits.length < cap; li--) {
                const a = offs[li];
                const b = li + 1 < offs.length ? offs[li + 1] : size;
                const line = readBytes(full, a, b);
                if (line.toLowerCase().includes(q)) hits.push(line.replace(/\r?\n$/, ""));
            }
        }
        return { ok: true as const, data: hits.join("\n") };
    } catch (e) {
        return { ok: false as const, data: String(e).replace(/^Error:\s*/, "") };
    }
}

function isMediaLine(line: string) {
    const l = String(line || "").toLowerCase();
    return l.includes("image:http")
        || l.includes("gif:http")
        || l.includes("video:http")
        || l.includes("audio:http")
        || l.includes("file:http")
        || /\/(?:ephemeral-)?attachments\//.test(l)
        || /\.(png|jpe?g|gif|webp|avif|bmp|heic|tiff?|jxl|svg|mhr|mp4|webm|mov|m4v|mkv|avi|mp3|wav|ogg|flac|m4a)(?:\?|$| )/.test(l);
}

function sniffMime(buf: Buffer, ext: string) {
    if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
    if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
    if (buf.length >= 3 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
    if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
    if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
    if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
    if (buf.length >= 3 && buf.toString("ascii", 0, 3) === "ID3") return "audio/mpeg";
    const map: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
        avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm",
        mov: "video/quicktime", mkv: "video/x-matroska", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
        flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac", mhr: "application/octet-stream"
    };
    return map[ext] || "application/octet-stream";
}

const MAX_INLINE = 5_000_000;
const MAX_SAVE = 24_000_000;

export async function keepMedia(_: IpcMainInvokeEvent, url: string, id: string) {
    try {
        const href = String(url || "");
        const key = String(id || "");
        if (!/^https?:\/\//i.test(href) || !key) return { ok: false as const, data: "", mime: "", sha: "" };
        const ext = (href.split("?")[0].match(/\.([a-z0-9]{1,8})$/i)?.[1] || "bin").toLowerCase();
        const hash = createHash("sha1").update(key).digest("hex").slice(0, 24);
        const dir = join(rootDir(), "media");
        mkdirSync(dir, { recursive: true });
        const full = join(dir, `${hash}.${ext.replace(/[^a-z0-9]/g, "") || "bin"}`);
        let buf: Buffer | null = null;
        if (existsSync(full) && statSync(full).size >= 32) {
            if (statSync(full).size > MAX_INLINE) {
                const head = Buffer.alloc(16);
                const fd = openSync(full, "r");
                try { readSync(fd, head, 0, 16, 0); } finally { closeSync(fd); }
                return { ok: true as const, data: "", mime: sniffMime(head, ext), sha: createHash("sha1").update(readFileSync(full)).digest("hex") };
            }
            buf = readFileSync(full);
        } else {
            const res = await net.fetch(href);
            if (!res.ok) return { ok: false as const, data: "", mime: "", sha: "" };
            const raw = Buffer.from(await res.arrayBuffer());
            if (raw.length < 32) return { ok: false as const, data: "", mime: "", sha: "" };
            if (raw.length <= MAX_SAVE) writeFileSync(full, raw);
            if (raw.length > MAX_INLINE) return { ok: true as const, data: "", mime: sniffMime(raw.subarray(0, 16), ext), sha: createHash("sha1").update(raw).digest("hex") };
            buf = raw;
        }
        return { ok: true as const, data: buf.toString("base64"), mime: sniffMime(buf, ext), sha: createHash("sha1").update(buf).digest("hex") };
    } catch {
        return { ok: false as const, data: "", mime: "", sha: "" };
    }
}

export async function readMediaWindow(_: IpcMainInvokeEvent, newestStart: number, count: number) {
    try {
        const start = Math.max(0, Number(newestStart) || 0);
        const want = Math.min(800, Math.max(1, Number(count) || 40));
        const files = auditNames();
        let skip = start;
        const collected: string[] = [];
        for (let f = files.length - 1; f >= 0 && collected.length < want; f--) {
            const full = join(rootDir(), files[f]);
            const offs = lineOffs(full);
            const n = offs.length;
            const size = existsSync(full) ? statSync(full).size : 0;
            for (let k = n - 1; k >= 0 && collected.length < want; k--) {
                const a = offs[k];
                const b = k + 1 < n ? offs[k + 1] : size;
                const line = readBytes(full, a, b).replace(/\r?\n$/, "");
                if (!isMediaLine(line)) continue;
                if (skip > 0) {
                    skip--;
                    continue;
                }
                collected.push(line);
            }
        }
        return { ok: true as const, data: collected.join("\n") };
    } catch (e) {
        return { ok: false as const, data: String(e).replace(/^Error:\s*/, "") };
    }
}
