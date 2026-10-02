/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Fast-path for Stalker Mode thumbs:
 * Prefer the original URL Discord already cached, then one small proxy still.
 */

import { PluginNative } from "@utils/types";

import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "./md";
import type { LedgerMedia } from "./types";

const Native = VencordNative.pluginHelpers.StalkerMode as PluginNative<typeof import("./native")>;

const good = new Map<string, string>();
const warming = new Set<string>();
const kept = new Map<string, { url: string; mime: string; }>();
const hashes = new Map<string, string>();
const hashListeners = new Set<() => void>();
let hashNotify = 0;
const inflight = new Map<string, Promise<string>>();
let pinActive = 0;
const pinWait: Array<() => void> = [];

function itemKey(item: LedgerMedia) {
    return item.id || String(item.url || "").split("?")[0];
}

function toProxy(url: string) {
    return String(url || "").replace(/^https?:\/\/cdn\.discordapp\.com\//i, "https://media.discordapp.net/");
}

function canSize(url: string) {
    return /^https?:\/\/(?:media\.discordapp\.net|images-ext-\d+\.discordapp\.net)\//i.test(url);
}

function joinQuery(url: string, extra: string) {
    return `${url}${url.includes("?") ? "&" : "?"}${extra}`;
}

export function isVideoFile(url: string) {
    return VIDEO_EXT.test(url) && !/\.mhr(?:$|[?#])/i.test(url);
}

function isImageFile(url: string) {
    return IMAGE_EXT.test(url) || /[?&]format=(webp|jpe?g|png|gif)/i.test(url);
}

export function isAudioFile(url: string) {
    return AUDIO_EXT.test(url);
}

function appendSize(url: string, px: number) {
    if (!url || /[?&](?:width|height)=/i.test(url) || !canSize(url)) return url;
    return joinQuery(url, `width=${px}&height=${px}`);
}

function videoStill(url: string, px: number) {
    const href = toProxy(String(url || "").trim());
    if (!href || !/^https?:\/\//i.test(href)) return "";
    if (!/\/(?:ephemeral-)?attachments\//i.test(href) && !isVideoFile(href)) return "";
    return joinQuery(href, `format=webp&width=${px}&height=${px}`);
}

function formatFallbacks(url: string, px: number) {
    const proxy = toProxy(url);
    if (!/discordapp\.(?:com|net)/i.test(proxy)) return [];
    if (!/\/(?:ephemeral-)?attachments\//i.test(proxy) && !/\/external\//i.test(proxy)) return [];
    return [
        joinQuery(proxy, `format=webp&width=${px}&height=${px}`),
        joinQuery(proxy, `format=png&width=${px}&height=${px}`),
        joinQuery(proxy, `format=jpeg&width=${px}&height=${px}`)
    ];
}

function runPin(job: () => Promise<void>) {
    if (pinActive >= 2) {
        pinWait.push(() => runPin(job));
        return;
    }
    pinActive++;
    void job().finally(() => {
        pinActive--;
        const next = pinWait.shift();
        if (next) next();
    });
}

export function keptSrc(item: LedgerMedia) {
    return kept.get(itemKey(item))?.url || "";
}

export function keptMime(item: LedgerMedia) {
    return kept.get(itemKey(item))?.mime || "";
}

function noteHash(key: string, sha?: string) {
    if (!key || !sha || hashes.get(key) === sha) return;
    hashes.set(key, sha);
    if (hashNotify) return;
    hashNotify = requestAnimationFrame(() => {
        hashNotify = 0;
        for (const listener of hashListeners) listener();
    });
}

export function contentHashOf(item: LedgerMedia) {
    return hashes.get(itemKey(item)) || "";
}

export function subscribeContentHash(listener: () => void) {
    hashListeners.add(listener);
    return () => { hashListeners.delete(listener); };
}

export function pinKeptMedia(item: LedgerMedia): Promise<string> {
    const key = itemKey(item);
    const url = String(item.url || "");
    if (!key || !/^https?:\/\//i.test(url)) return Promise.resolve("");
    const hit = kept.get(key);
    if (hit) return Promise.resolve(hit.url);
    if (hashes.has(key)) return Promise.resolve("");
    const pending = inflight.get(key);
    if (pending) return pending;
    const job = new Promise<string>(resolve => {
        runPin(async () => {
            try {
                const res = await Native.keepMedia(url, key);
                if (res?.sha) noteHash(key, res.sha);
                if (!res?.ok || !res.data) {
                    resolve("");
                    return;
                }
                const bin = Uint8Array.from(atob(res.data), c => c.charCodeAt(0));
                const blob = new Blob([bin], { type: res.mime || "application/octet-stream" });
                const objectUrl = URL.createObjectURL(blob);
                kept.set(key, { url: objectUrl, mime: res.mime || "" });
                if (kept.size > 800) {
                    const first = kept.keys().next().value;
                    if (first) {
                        const old = kept.get(first);
                        if (old) URL.revokeObjectURL(old.url);
                        kept.delete(first);
                    }
                }
                resolve(objectUrl);
            } catch {
                resolve("");
            } finally {
                inflight.delete(key);
            }
        });
    });
    inflight.set(key, job);
    return job;
}

export function rememberGoodSrc(item: LedgerMedia, src: string) {
    if (!src || isVideoFile(src) && !isImageFile(src)) return;
    good.set(itemKey(item), src);
    if (good.size > 4000) {
        const first = good.keys().next().value;
        if (first) good.delete(first);
    }
}

export function knownGoodSrc(item: LedgerMedia) {
    return good.get(itemKey(item));
}

export function fastSrcs(item: LedgerMedia, px: number) {
    const out: string[] = [];
    const push = (raw?: string) => {
        const href = String(raw || "").trim();
        if (!href) return;
        if (!/^https?:\/\//i.test(href) && !href.startsWith("blob:")) return;
        if (!href.startsWith("blob:") && isVideoFile(href) && !isImageFile(href)) return;
        if (!out.includes(href)) out.push(href);
    };
    const local = kept.get(itemKey(item));
    if (local?.url && !local.mime.startsWith("video/") && !local.mime.startsWith("audio/")) push(local.url);
    push(knownGoodSrc(item));
    const url = item.url;
    const video = item.kind === "video" || isVideoFile(url);
    if (video) {
        if (item.poster && !isVideoFile(item.poster)) push(item.poster);
        push(videoStill(url, px));
        return out;
    }
    push(url);
    const proxy = toProxy(url);
    if (proxy !== url) push(proxy);
    push(appendSize(proxy, px));
    for (const fallback of formatFallbacks(url, px)) push(fallback);
    return out;
}

export function warmMedia(items?: LedgerMedia[], px = 128) {
    if (!items?.length) return;
    for (const item of items.slice(0, 24)) {
        void pinKeptMedia(item);
        const src = knownGoodSrc(item) || fastSrcs(item, px)[0];
        if (!src || warming.has(src)) continue;
        warming.add(src);
        const img = new Image();
        img.decoding = "async";
        img.onload = () => rememberGoodSrc(item, src);
        img.onerror = () => warming.delete(src);
        img.src = src;
        if (warming.size > 80) {
            const first = warming.values().next().value;
            if (first) warming.delete(first);
        }
    }
}
