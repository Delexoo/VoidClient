/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast, Toasts } from "@webpack/common";

const MASKED = /\[([^\]]{1,80})\]\((https?:\/\/[^)\s]+)\)/g;
const WEBHOOK = /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i;
const BOT_TOKEN = /(?:^|[^A-Za-z0-9])([\w-]{24,}\.[\w-]{6}\.[\w-]{27,}|mfa\.[\w-]{60,})(?:[^A-Za-z0-9]|$)/;
const SCAM_RE = /\b(free\s+nitro|discord\s+nitro|steam\s*gift|airdrop|double\s+nitro|claim\s+your|verify\s+(your\s+)?account|login\s+to\s+continue|limited\s+nitro)\b/i;
const LOGIN_HOST = /(?:steampowered|steamcommunity|discordnitro|nitro-discord|discord-airdrop|free-nitro)/i;

export type MaskedLink = { label: string; href: string; mismatch: boolean; };

export function maskedLinks(text: string): MaskedLink[] {
    const out: MaskedLink[] = [];
    for (const match of String(text || "").matchAll(MASKED)) {
        const label = match[1];
        const href = match[2];
        let mismatch = false;
        try {
            const host = new URL(href).hostname.replace(/^www\./, "");
            const labelHost = label.replace(/^https?:\/\//i, "").replace(/^www\./, "").split("/")[0];
            if (/[./]/.test(label) && labelHost && !host.includes(labelHost) && !labelHost.includes(host))
                mismatch = true;
        } catch {
            mismatch = true;
        }
        out.push({ label, href, mismatch });
    }
    return out;
}

export function scamHits(text: string) {
    const hits: string[] = [];
    const raw = String(text || "");
    if (SCAM_RE.test(raw)) hits.push("nitro/login wording");
    if (LOGIN_HOST.test(raw)) hits.push("lookalike host");
    if (WEBHOOK.test(raw)) hits.push("webhook URL");
    if (/(bit\.ly|tinyurl\.com|discord\.gift)\//i.test(raw) && /nitro|steam|gift/i.test(raw))
        hits.push("short link + gift wording");
    return hits;
}

export function unicodeFlags(text: string) {
    const raw = String(text || "");
    const flags: string[] = [];
    if (/[\u202A-\u202E\u2066-\u2069]/.test(raw)) flags.push("bidi override");
    if (/[\u200B-\u200F\uFEFF\u2060]/.test(raw)) flags.push("invisible / zero-width");
    if ((raw.match(/\p{M}/gu) || []).length > 8) flags.push("zalgo / combining marks");
    const letters = raw.match(/\p{L}/gu) || [];
    const scripts = new Set(letters.map(ch => {
        if (/\p{Script=Latin}/u.test(ch)) return "latin";
        if (/\p{Script=Cyrillic}/u.test(ch)) return "cyrillic";
        if (/\p{Script=Greek}/u.test(ch)) return "greek";
        return "";
    }).filter(Boolean));
    if (scripts.has("latin") && (scripts.has("cyrillic") || scripts.has("greek")) && letters.length >= 3)
        flags.push("mixed scripts (possible homoglyph)");
    return flags;
}

export function secretKind(text: string): "token" | "webhook" | null {
    const raw = String(text || "");
    if (WEBHOOK.test(raw)) return "webhook";
    if (BOT_TOKEN.test(raw)) return "token";
    return null;
}

const leakOnce = new Set<string>();

export function warnComposerLeak(kind: "token" | "webhook") {
    const key = kind;
    if (leakOnce.has(key)) return false;
    leakOnce.add(key);
    setTimeout(() => leakOnce.delete(key), 30_000);
    showToast(
        kind === "token"
            ? "Stalker Mode: your draft looks like a bot token. It was not saved. Remove it."
            : "Stalker Mode: your draft looks like a webhook URL. It was not saved.",
        Toasts.Type.FAILURE
    );
    return true;
}
