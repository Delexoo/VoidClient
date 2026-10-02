/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Dossier, LedgerEvent } from "./types";

function esc(value?: string, max = 140) {
    return String(value || "").replace(/\s+/g, " ").replace(/\|/g, "/").trim().slice(0, max);
}

const EXT = String.raw`(?:$|[?#])`;
export const IMAGE_EXT = new RegExp(String.raw`\.(png|jpe?g|jfif|pjpeg|pjp|webp|avif|bmp|svgz?|heic|heif|hif|tiff?|jxl|jp2|j2k|ico|cur|tga|exr|hdr|dds|qoi|ppm|pgm|pbm|pcx|mhr|psd|ai|eps|dng|cr2|nef|arw|orf|rw2|gif|apng)${EXT}`, "i");
export const GIF_EXT = new RegExp(String.raw`\.(gif|apng)${EXT}`, "i");
export const VIDEO_EXT = new RegExp(String.raw`\.(mp4|m4v|webm|mov|qt|mkv|avi|mpe?g|wmv|flv|f4v|3gp|3g2|ts|mts|m2ts|ogv|asf|vob|rmvb?|divx|mhr)${EXT}`, "i");
export const AUDIO_EXT = new RegExp(String.raw`\.(mp3|wav|wave|ogg|oga|opus|flac|m4a|aac|wma|aiff?|alac|caf|amr|mid|midi)${EXT}`, "i");
const DOC_EXT = new RegExp(String.raw`\.(pdf|zip|rar|7z|tar|gz|txt|docx?|xlsx?|pptx?|exe|json|csv|xml|html?|css|js|apk|dmg|iso)${EXT}`, "i");

export function extKind(name: string): import("./types").LedgerMedia["kind"] {
    const blob = String(name || "");
    if (GIF_EXT.test(blob) || /tenor\.com|giphy\.com/i.test(blob)) return "gif";
    if (/\.mhr(?:$|[?#])/i.test(blob)) return "image";
    if (VIDEO_EXT.test(blob)) return "video";
    if (AUDIO_EXT.test(blob)) return "audio";
    if (IMAGE_EXT.test(blob)) return "image";
    return "file";
}

export function isBlockedFile(name: string) {
    return DOC_EXT.test(String(name || ""));
}

function mediaKindFromUrl(url: string): import("./types").LedgerMedia["kind"] {
    const kind = extKind(url);
    return kind === "file" ? "image" : kind;
}

export function isVisualMedia(item?: { kind?: string; url?: string; name?: string; }) {
    if (!item?.url) return false;
    if (item.kind === "image" || item.kind === "gif" || item.kind === "video" || item.kind === "audio") return true;
    const blob = `${item.name || ""} ${item.url}`;
    if (extKind(blob) !== "file") return true;
    if (/tenor\.com|giphy\.com|imgur\.com/i.test(item.url)) return true;
    if (/\/(?:ephemeral-)?attachments\//i.test(item.url) && !isBlockedFile(blob)) return true;
    return false;
}

function hasPictureUrl(url: string) {
    if (extKind(url) !== "file") return true;
    return /\/(?:ephemeral-)?attachments\/|\/external\/|\/stickers\/|images-ext-|media\.discordapp\.net|cdn\.discordapp\.com|tenor\.com|giphy\.com|imgur\.com/i.test(url);
}

export function isGalleryMedia(item?: { kind?: string; url?: string; name?: string; }) {
    if (!isVisualMedia(item) || !item?.url) return false;
    const name = String(item.name || "").trim().toLowerCase();
    if ((name === "embed" || name === "embedded") && !hasPictureUrl(item.url)) return false;
    return true;
}

function mediaField(ev: LedgerEvent) {
    return (ev.media || [])
        .map(item => `${item.kind}:${String(item.url || "").replace(/\s+/g, "").replace(/\|/g, "%7C")}`)
        .filter(part => /https?:\/\//i.test(part))
        .join(" ")
        .slice(0, 6000);
}

function parseMedia(raw?: string) {
    const out: import("./types").LedgerMedia[] = [];
    for (const token of String(raw || "").split(" ").filter(Boolean)) {
        const split = token.indexOf(":");
        let kind: import("./types").LedgerMedia["kind"] = "image";
        let url = token;
        if (split > 0 && split < 8) {
            const k = token.slice(0, split);
            const rest = token.slice(split + 1);
            if (/^https?:\/\//i.test(rest) && (k === "image" || k === "gif" || k === "video" || k === "audio" || k === "file")) {
                kind = k;
                url = rest;
            }
        }
        if (!/^https?:\/\//i.test(url)) continue;
        const kindFinal = kind === "file" || kind === "image" ? mediaKindFromUrl(url) : kind;
        out.push({ url, kind: kindFinal === "audio" ? mediaKindFromUrl(url) : kindFinal });
        if (out.length >= 24) break;
    }
    return out.length ? out : undefined;
}

export function eventToMdLine(ev: LedgerEvent) {
    return `- ${ev.at}|${esc(ev.type, 24)}|${esc(ev.userName, 40)}|${esc(ev.userId, 24)}|${esc(ev.channelId, 24)}|${esc(ev.preview, 400)}|${esc(ev.previewAfter, 400)}|${esc(ev.messageId, 24)}|${esc(ev.guildId, 24)}|${esc(ev.severity, 8)}|${esc(ev.summary, 160)}|${mediaField(ev)}`;
}

export function eventsToMd(list: LedgerEvent[]) {
    const lines = ["# Audit", ""];
    for (const ev of list) lines.push(eventToMdLine(ev));
    lines.push("");
    return lines.join("\n");
}

export function eventsFromMd(text: string): LedgerEvent[] {
    const out: LedgerEvent[] = [];
    for (const raw of String(text || "").split("\n")) {
        const line = raw.trim();
        if (!line.startsWith("- ")) continue;
        const p = line.slice(2).split("|");
        const at = Number(p[0]);
        if (!Number.isFinite(at) || !p[1]) continue;
        out.push({
            id: `${at}-${p[7] || p[3] || out.length}`,
            at,
            type: p[1] || "send",
            userName: p[2] || undefined,
            userId: p[3] || undefined,
            channelId: p[4] || undefined,
            preview: p[5] || undefined,
            previewAfter: p[6] || undefined,
            messageId: p[7] || undefined,
            guildId: p[8] || undefined,
            severity: p[9] === "warn" ? "warn" : "info",
            summary: p[10] || `${p[2] || "someone"} ${p[1]}`,
            media: parseMedia(p[11])
        });
    }
    return out;
}

export function dossiersToMd(list: Dossier[]) {
    const lines = ["# People", ""];
    for (const d of list) {
        lines.push(
            `- ${d.id}|${esc(d.globalName, 40)}|${esc(d.username, 40)}|${d.bot ? "1" : "0"}|${d.firstSeen}|${d.lastSeen}`
        );
    }
    lines.push("");
    return lines.join("\n");
}

export function dossiersFromMd(text: string): Dossier[] {
    const out: Dossier[] = [];
    for (const raw of String(text || "").split("\n")) {
        const line = raw.trim();
        if (!line.startsWith("- ")) continue;
        const p = line.slice(2).split("|");
        if (!p[0]) continue;
        out.push({
            id: p[0],
            globalName: p[1] || undefined,
            username: p[2] || undefined,
            bot: p[3] === "1",
            usernames: [],
            nicks: [],
            avatars: [],
            firstSeen: Number(p[4]) || Date.now(),
            lastSeen: Number(p[5]) || Date.now()
        });
    }
    return out;
}
