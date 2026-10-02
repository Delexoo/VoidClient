/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFileSync } from "child_process";
import { createDecipheriv } from "crypto";
import { session } from "electron";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Copies this PC's existing YouTube login into the embedded window.
 * Cookie values stay on the machine and are never returned to the page.
 * Chrome's newer app-bound cookies (v20) are left untouched.
 */

declare module "node:sqlite" {
    export class DatabaseSync {
        constructor(path: string, options?: { readOnly?: boolean; });
        prepare(sql: string): { all(): Array<Record<string, unknown>>; };
        close(): void;
    }
}

type SameSite = "unspecified" | "no_restriction" | "lax" | "strict";

type CookieSet = {
    url: string;
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    expirationDate?: number;
    sameSite?: SameSite;
};

type Attempt = {
    browser: string;
    score: number;
    locked: number;
    foundLogin: boolean;
    busy: boolean;
    cookies: CookieSet[];
};

const YOUTUBE_LOGIN = new Set(["LOGIN_INFO", "SAPISID", "SID", "__Secure-3PAPISID", "__Secure-1PSID", "__Secure-3PSID"]);

const GOOGLE_AUTH = new Set([
    "SID",
    "HSID",
    "SSID",
    "APISID",
    "SAPISID",
    "SIDCC",
    "__Secure-1PSID",
    "__Secure-3PSID",
    "__Secure-1PAPISID",
    "__Secure-3PAPISID",
    "__Secure-1PSIDTS",
    "__Secure-3PSIDTS",
    "__Secure-1PSIDCC",
    "__Secure-3PSIDCC",
    "__Host-1PLSID",
    "__Host-3PLSID",
    "__Host-GAPS",
    "ACCOUNT_CHOOSER",
    "LSID"
]);

const CHROME_SQL = `SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite
FROM cookies
WHERE host_key LIKE '%youtube.com' OR host_key LIKE '%google.com'`;

const FIREFOX_SQL = `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite
FROM moz_cookies
WHERE host LIKE '%youtube.com' OR host LIKE '%google.com'`;

function hostOf(raw: string) {
    return raw.toLowerCase().replace(/^\./, "");
}

function isYoutubeHost(host: string) {
    const h = hostOf(host);
    return h === "youtube.com" || h.endsWith(".youtube.com");
}

function isGoogleAuthHost(host: string) {
    const h = hostOf(host);
    return h === "google.com" || h === "accounts.google.com";
}

function wanted(host: string, cookieName: string) {
    if (isYoutubeHost(host)) return true;
    return isGoogleAuthHost(host) && GOOGLE_AUTH.has(cookieName);
}

function rank(cookieName: string) {
    if (cookieName === "LOGIN_INFO") return 0;
    if (
        cookieName === "SID" ||
        cookieName === "SAPISID" ||
        cookieName === "HSID" ||
        cookieName === "SSID" ||
        cookieName === "APISID" ||
        cookieName.includes("PSID")
    ) return 1;
    return 2;
}

function scoreOf(cookies: CookieSet[]) {
    let score = 0;
    for (const cookie of cookies) {
        const host = cookie.domain || "";
        if (!isYoutubeHost(host)) continue;
        if (cookie.name === "LOGIN_INFO") score += 100;
        if (cookie.name === "SAPISID" || cookie.name === "__Secure-3PAPISID") score += 30;
        if (cookie.name === "SID") score += 20;
    }
    return score;
}

function asBuffer(value: unknown) {
    if (Buffer.isBuffer(value)) return value;
    // Electron can hand back a blob from another realm, so instanceof Uint8Array is not enough.
    if (ArrayBuffer.isView(value))
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (typeof value === "string" && value.length >= 3) return Buffer.from(value, "latin1");
    return null;
}

function asText(value: unknown) {
    if (typeof value === "string") return value;
    const buf = asBuffer(value);
    return buf ? buf.toString("utf8") : "";
}

function usable(value: string) {
    return value.length > 0 && value.length <= 8192 && !value.includes("\0");
}

function sameSiteFrom(raw: unknown, firefox: boolean): SameSite {
    const n = Number(raw);
    if (n === 2) return "strict";
    if (n === 0) return "no_restriction";
    if (n === 1) return "lax";
    return firefox ? "lax" : "unspecified";
}

function toCookie(opts: {
    host: string;
    cookieName: string;
    value: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    expiration?: number;
    sameSite: SameSite;
}): CookieSet | null {
    if (!wanted(opts.host, opts.cookieName) || !usable(opts.value)) return null;
    const host = hostOf(opts.host);
    const path = opts.path?.startsWith("/") ? opts.path : "/";
    const secure = opts.secure || opts.cookieName.startsWith("__Secure-") || opts.cookieName.startsWith("__Host-");
    const hostOnly = opts.cookieName.startsWith("__Host-");
    const urlHost = host === "youtube.com" ? "www.youtube.com" : host === "google.com" ? "accounts.google.com" : host;
    const cookie: CookieSet = {
        url: `${secure ? "https" : "http"}://${urlHost}${path}`,
        name: opts.cookieName,
        value: opts.value,
        path,
        secure,
        httpOnly: opts.httpOnly,
        sameSite: opts.sameSite
    };
    if (!hostOnly)
        cookie.domain = host === "youtube.com" || host === "google.com" || opts.host.startsWith(".") ? `.${host}` : host;
    if (opts.expiration) cookie.expirationDate = opts.expiration;
    return cookie;
}

function chromeExpiry(raw: unknown): { ok: true; expiration?: number; } | { ok: false; } {
    const n = typeof raw === "bigint" ? Number(raw) : Number(raw ?? 0);
    if (!Number.isFinite(n) || n <= 0) return { ok: true };
    const unix = n / 1_000_000 - 11_644_473_600;
    if (unix < Date.now() / 1000 + 30) return { ok: false };
    return { ok: true, expiration: unix };
}

function dpapiUnprotect(data: Buffer) {
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$in = [Convert]::FromBase64String('${data.toString("base64")}')
$out = [System.Security.Cryptography.ProtectedData]::Unprotect($in, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($out)
`;
    const stdout = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        timeout: 20000,
        windowsHide: true
    });
    const line = stdout.trim().split(/\r?\n/).pop() || "";
    return Buffer.from(line, "base64");
}

function chromeKey(userData: string) {
    const localState = JSON.parse(readFileSync(join(userData, "Local State"), "utf8")) as {
        os_crypt?: { encrypted_key?: string; };
    };
    const encoded = localState.os_crypt?.encrypted_key;
    if (!encoded) return null;
    const blob = Buffer.from(encoded, "base64");
    if (blob.subarray(0, 5).toString() !== "DPAPI") return null;
    const key = dpapiUnprotect(blob.subarray(5));
    return key.length === 32 ? key : null;
}

function decryptChrome(enc: Buffer, key: Buffer | null, locked: { n: number; }) {
    const prefix = enc.subarray(0, 3).toString();
    if (prefix === "v20" || prefix === "v11") {
        locked.n++;
        return "";
    }
    if (prefix !== "v10") {
        try {
            return dpapiUnprotect(enc).toString("utf8");
        } catch {
            locked.n++;
            return "";
        }
    }
    if (!key || enc.length < 31) {
        locked.n++;
        return "";
    }
    try {
        const iv = enc.subarray(3, 15);
        const tag = enc.subarray(enc.length - 16);
        const data = enc.subarray(15, enc.length - 16);
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
        locked.n++;
        return "";
    }
}

async function openDb(file: string) {
    const { DatabaseSync } = await import("node:sqlite");
    // The copy may need a short write to apply the browser's WAL snapshot.
    return new DatabaseSync(file);
}

async function readCopied(file: string, run: (dbPath: string) => Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), "vc-yt-"));
    const dest = join(dir, "Cookies");
    try {
        copyFileSync(file, dest);
        for (const extra of ["-wal", "-shm", "-journal"]) {
            if (existsSync(file + extra)) copyFileSync(file + extra, dest + extra);
        }
        await run(dest);
    } finally {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

function chromiumProfiles(root: string) {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && (entry.name === "Default" || entry.name.startsWith("Profile ")))
        .map(entry => entry.name)
        .slice(0, 8);
}

function cookieFile(root: string, profile: string) {
    const modern = join(root, profile, "Network", "Cookies");
    if (existsSync(modern)) return modern;
    const legacy = join(root, profile, "Cookies");
    return existsSync(legacy) ? legacy : null;
}

async function readChromiumFile(file: string, key: Buffer | null) {
    const locked = { n: 0 };
    const cookies: CookieSet[] = [];
    let foundLogin = false;
    await readCopied(file, async copied => {
        const db = await openDb(copied);
        try {
            for (const row of db.prepare(CHROME_SQL).all()) {
                const host = asText(row.host_key);
                const cookieName = asText(row.name);
                if (!wanted(host, cookieName)) continue;
                const loginCookie = isYoutubeHost(host) && YOUTUBE_LOGIN.has(cookieName);
                if (loginCookie) foundLogin = true;
                const expiry = chromeExpiry(row.expires_utc);
                if (!expiry.ok) continue;
                const plain = asText(row.value);
                const enc = asBuffer(row.encrypted_value);
                const value = plain || (enc?.length ? decryptChrome(enc, key, locked) : "");
                if (loginCookie && !value) locked.n++;
                const cookie = toCookie({
                    host,
                    cookieName,
                    value,
                    path: asText(row.path) || "/",
                    secure: Number(row.is_secure) === 1,
                    httpOnly: Number(row.is_httponly) === 1,
                    expiration: expiry.expiration,
                    sameSite: sameSiteFrom(row.samesite, false)
                });
                if (cookie) cookies.push(cookie);
            }
        } finally {
            db.close();
        }
    });
    return { locked: locked.n, foundLogin, cookies };
}

async function readChromium(browser: string, root: string): Promise<Attempt | null> {
    const profiles = chromiumProfiles(root);
    if (!profiles.length) return null;

    let key: Buffer | null = null;
    try { key = chromeKey(root); } catch { key = null; }

    let best: Attempt | null = null;
    let busy = false;
    for (const profile of profiles) {
        const file = cookieFile(root, profile);
        if (!file) continue;
        try {
            const read = await readChromiumFile(file, key);
            const attempt = {
                browser,
                score: scoreOf(read.cookies),
                locked: read.locked,
                foundLogin: read.foundLogin,
                busy: false,
                cookies: read.cookies
            };
            if (!best || attempt.score > best.score || (attempt.foundLogin && !best.foundLogin)) best = attempt;
        } catch (err) {
            const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
            if (code === "EBUSY" || code === "EPERM" || code === "EACCES") busy = true;
        }
    }
    if (!best && busy)
        return { browser, score: 0, locked: 0, foundLogin: false, busy: true, cookies: [] };
    if (best) best.busy = busy;
    return best;
}

function firefoxDbs() {
    const root = join(process.env.APPDATA || "", "Mozilla", "Firefox", "Profiles");
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => join(root, entry.name, "cookies.sqlite"))
        .filter(file => existsSync(file))
        .slice(0, 8);
}

async function readFirefox(): Promise<Attempt | null> {
    let best: Attempt | null = null;
    for (const file of firefoxDbs()) {
        const cookies: CookieSet[] = [];
        try {
            await readCopied(file, async copied => {
                const db = await openDb(copied);
                try {
                    for (const row of db.prepare(FIREFOX_SQL).all()) {
                        const host = asText(row.host);
                        const cookieName = asText(row.name);
                        const expiry = Number(row.expiry);
                        if (Number.isFinite(expiry) && expiry > 0 && expiry < Date.now() / 1000 + 30) continue;
                        const cookie = toCookie({
                            host,
                            cookieName,
                            value: asText(row.value),
                            path: asText(row.path) || "/",
                            secure: Number(row.isSecure) === 1,
                            httpOnly: Number(row.isHttpOnly) === 1,
                            expiration: Number.isFinite(expiry) && expiry > 0 ? expiry : undefined,
                            sameSite: sameSiteFrom(row.sameSite, true)
                        });
                        if (cookie) cookies.push(cookie);
                    }
                } finally {
                    db.close();
                }
            });
        } catch {
            continue;
        }
        const attempt = { browser: "Firefox", score: scoreOf(cookies), locked: 0, foundLogin: scoreOf(cookies) >= 20, busy: false, cookies };
        if (!best || attempt.score > best.score) best = attempt;
    }
    return best;
}

export async function importBrowserLogin(partition: string): Promise<{ ok: boolean; message: string; reason?: "locked" | "busy" | "missing"; }> {
    if (process.platform !== "win32") {
        return { ok: false, message: "Browser login import works on Windows. Sign in inside the window and it stays saved." };
    }
    try {
        await import("node:sqlite");
    } catch {
        return { ok: false, message: "Couldn't read browser cookies from here. Sign in inside the window and it stays saved." };
    }

    const local = process.env.LOCALAPPDATA || "";
    const browsers = [
        { browser: "Chrome", root: join(local, "Google", "Chrome", "User Data") },
        { browser: "Edge", root: join(local, "Microsoft", "Edge", "User Data") },
        { browser: "Brave", root: join(local, "BraveSoftware", "Brave-Browser", "User Data") }
    ];

    const attempts: Attempt[] = [];
    for (const item of browsers) {
        try {
            const found = await readChromium(item.browser, item.root);
            if (found) attempts.push(found);
        } catch { /* try the next browser */ }
    }
    try {
        const firefox = await readFirefox();
        if (firefox) attempts.push(firefox);
    } catch { /* ignore */ }

    attempts.sort((a, b) => b.score - a.score || Number(b.foundLogin) - Number(a.foundLogin));
    const best = attempts[0];
    const installed = attempts.map(item => item.browser);
    if (!best || best.score < 20) {
        const locked = attempts.some(item => item.locked > 0 || item.foundLogin);
        const busy = attempts.some(item => item.busy);
        const names = installed.length ? installed.join(", ") : "Chrome, Edge, Brave, or Firefox";
        if (locked || busy) {
            const browser = attempts.find(item => item.foundLogin || item.locked > 0)?.browser || names;
            return {
                ok: false,
                reason: locked ? "locked" : "busy",
                message: `${browser} is signed in to YouTube, but the browser locked that login. Sign in once in this window and it stays connected.`
            };
        }
        if (!installed.length) {
            return { ok: false, reason: "missing", message: "Couldn't find Chrome, Edge, Brave, or Firefox on this PC. Sign in inside the window." };
        }
        return { ok: false, message: `${names} ${installed.length === 1 ? "is" : "are"} installed, but none of them is signed in to YouTube. Sign in inside the window.` };
    }

    const ses = session.fromPartition(partition);
    const cookies = [...best.cookies].sort((a, b) => rank(a.name) - rank(b.name)).slice(0, 80);
    let applied = 0;
    for (const cookie of cookies) {
        try {
            await ses.cookies.set(cookie);
            applied++;
        } catch { /* skip a cookie the session refused */ }
    }
    try { await ses.cookies.flushStore(); } catch { /* ignore */ }

    if (!applied) return { ok: false, message: "Couldn't apply that login. Sign in inside the window." };
    return { ok: true, message: `Connected using your ${best.browser} login.` };
}
