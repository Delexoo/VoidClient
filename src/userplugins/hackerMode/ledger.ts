/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { eventToMdLine, eventsFromMd, isVisualMedia } from "./md";
import { settings } from "./settings";
import type { LedgerEvent, LedgerMedia, Severity } from "./types";

const LIVE_CAP = 400;
const VISUAL_CAP = 400;

const events: LedgerEvent[] = [];
const visual: LedgerEvent[] = [];
const visualSeen = new Set<string>();
const listeners = new Set<() => void>();
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
let diskLines = 0;
let sessionFloor = 0;
let sessionDiskBase = 0;
let sessionId = 1;
const pendingMd: string[] = [];

function inSession(ev: LedgerEvent) {
    return ev.at >= sessionFloor;
}

function dayFile(ms = Date.now()) {
    const d = new Date(ms);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `audit-${d.getFullYear()}-${m}-${day}.md`;
}

function persistOn() {
    return settings.store.writeToDisk !== false;
}

function safeUrl(url: string) {
    const href = String(url || "").trim();
    if (!/^https?:\/\//i.test(href)) return "";
    return href.slice(0, 1200);
}

function sanitizeMedia(list?: LedgerMedia[]) {
    if (!list?.length) return undefined;
    const out: LedgerMedia[] = [];
    for (const item of list) {
        const url = safeUrl(item?.url || "");
        if (!url) continue;
        let kind: LedgerMedia["kind"] = item.kind === "video" || item.kind === "gif" || item.kind === "audio" || item.kind === "file"
            ? item.kind
            : "image";
        if ((kind === "file" || kind === "image") && isVisualMedia({ ...item, url, kind })) {
            if (/\.(gif|apng)(?:$|\?)/i.test(`${item.name || ""} ${url}`)) kind = "gif";
            else if (/\.(mp4|webm|mov|m4v|mkv)(?:$|\?)/i.test(`${item.name || ""} ${url}`)) kind = "video";
            else if (kind === "file") kind = "image";
        }
        if (kind === "file" && !isVisualMedia({ ...item, url, kind: "image" })) continue;
        const width = Number(item.width) || 0;
        const height = Number(item.height) || 0;
        out.push({
            id: item.id ? String(item.id).slice(0, 32) : undefined,
            url,
            poster: item.poster ? safeUrl(item.poster) || undefined : undefined,
            name: item.name ? String(item.name).slice(0, 120) : undefined,
            kind,
            spoiler: Boolean(item.spoiler),
            width: width > 0 ? width : undefined,
            height: height > 0 ? height : undefined
        });
        if (out.length >= 80) break;
    }
    return out.length ? out : undefined;
}

function nativeApi() {
    if (IS_WEB) return undefined;
    return VencordNative.pluginHelpers.StalkerMode as PluginNative<typeof import("./native")> | undefined;
}

function emit() {
    if (emitTimer != null) return;
    const run = () => {
        emitTimer = null;
        for (const fn of listeners) fn();
    };
    if (typeof requestAnimationFrame === "function") {
        emitTimer = requestAnimationFrame(run) as unknown as ReturnType<typeof setTimeout>;
        return;
    }
    emitTimer = setTimeout(run, 16);
}

function trimRam() {
    if (events.length > LIVE_CAP) events.splice(0, events.length - LIVE_CAP);
}

function mediaKey(item: LedgerMedia) {
    return item.id || String(item.url || "").split("?")[0];
}

function mergeMedia(prev: LedgerMedia[], next: LedgerMedia[]) {
    const out = prev.slice();
    const seen = new Set(prev.map(mediaKey));
    for (const item of next) {
        const key = mediaKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function noteVisual(ev: LedgerEvent) {
    if (!inSession(ev)) return;
    const media = (ev.media || []).filter(isVisualMedia);
    if (!media.length) return;
    const key = `${ev.channelId || ""}:${ev.messageId || ev.id}`;
    if (visualSeen.has(key)) {
        for (let i = 0; i < visual.length; i++) {
            const row = visual[i];
            if (`${row.channelId || ""}:${row.messageId || row.id}` !== key) continue;
            visual[i] = { ...row, media: mergeMedia(row.media || [], media) };
            return;
        }
        return;
    }
    const keyed = { ...ev, media };
    visualSeen.add(key);
    visual.push(keyed);
    if (visual.length > VISUAL_CAP) {
        const drop = visual.splice(0, visual.length - VISUAL_CAP);
        for (const row of drop) visualSeen.delete(`${row.channelId || ""}:${row.messageId || row.id}`);
    }
}

export function stashVisual(partial: {
    channelId?: string;
    messageId?: string;
    userId?: string;
    userName?: string;
    guildId?: string;
    media?: LedgerMedia[];
    at?: number;
}) {
    const media = sanitizeMedia(partial.media);
    if (!media?.length || !partial.channelId) return;
    noteVisual({
        id: `vis-${partial.channelId}-${partial.messageId || seq}`,
        at: Number(partial.at) || Date.now(),
        type: "send",
        severity: "info",
        summary: "",
        userId: partial.userId,
        userName: partial.userName,
        channelId: partial.channelId,
        guildId: partial.guildId,
        messageId: partial.messageId,
        media
    });
    emit();
}

export function recentVisualEvents(limit = 400) {
    const cap = Math.max(0, limit);
    const out: LedgerEvent[] = [];
    for (let i = visual.length - 1; i >= 0 && out.length < cap; i--)
        out.push(visual[i]);
    return out;
}

export function allVisualTiles() {
    const out: Array<{ ev: LedgerEvent; item: LedgerMedia; }> = [];
    for (let i = visual.length - 1; i >= 0; i--) {
        const ev = visual[i];
        for (const item of ev.media || []) {
            if (isVisualMedia(item)) out.push({ ev, item });
        }
    }
    return out;
}

export function ingestVisualBatch(list: LedgerEvent[]) {
    for (const ev of list) noteVisual(ev);
    emit();
}

export async function seekVisualEvents(newestStart: number, count: number) {
    const start = Math.max(0, newestStart);
    const want = Math.min(800, Math.max(1, count));
    const ram = recentVisualEvents(start + want);
    const slice = ram.slice(start, start + want);
    if (slice.length >= want) return slice;
    try {
        const res = await nativeApi()?.readMediaWindow?.(start, want);
        if (res?.ok && res.data) {
            const disk = eventsFromMd(res.data);
            const seen = new Set(slice.map(ev => `${ev.channelId || ""}:${ev.messageId || ev.id}`));
            const out = [...slice];
            for (const ev of disk) {
                if (!inSession(ev)) continue;
                const key = `${ev.channelId || ""}:${ev.messageId || ev.id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(ev);
            }
            return out;
        }
    } catch { /* ram */ }
    return slice;
}

function scheduleSave() {
    if (saveTimer != null) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        void flushLedger();
    }, 280);
}

export function subscribeLedger(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

export function getEvents() {
    return events;
}

export function ledgerSession() {
    return sessionId;
}

export async function startFreshSession() {
    await flushLedger();
    sessionFloor = Date.now();
    sessionDiskBase = diskLines;
    sessionId++;
    events.length = 0;
    visual.length = 0;
    visualSeen.clear();
    emit();
}

export function auditCount() {
    const sinceDisk = Math.max(0, diskLines - sessionDiskBase);
    return Math.max(sinceDisk + pendingMd.length, events.length);
}

export function hydrateEvent(ev: LedgerEvent): LedgerEvent {
    return ev;
}

export async function seekEvents(newestStart: number, count: number) {
    const start = Math.max(0, newestStart);
    const want = Math.min(80, Math.max(1, count));
    const ram = recentEvents(start + want + 8);
    if (start < ram.length) return ram.slice(start, start + want);
    const out: LedgerEvent[] = [];
    const seen = new Set<string>();
    const push = (ev: LedgerEvent) => {
        if (!inSession(ev)) return;
        const key = ev.messageId
            ? `${ev.channelId || ""}:${ev.messageId}:${ev.type}`
            : ev.id;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(hydrateEvent(ev));
    };
    if (start < ram.length) {
        for (let i = start; i < ram.length && out.length < want; i++) push(ram[i]);
    }
    if (out.length >= want) return out;
    const pending = eventsFromMd(pendingMd.join("\n")).reverse();
    let i = start;
    while (out.length < want && i < pending.length) push(pending[i++]);
    const still = want - out.length;
    if (still > 0) {
        const diskStart = Math.max(0, start);
        try {
            const res = await nativeApi()?.readAuditWindow?.(diskStart, still + 16);
            if (res?.ok && res.data) {
                for (const ev of eventsFromMd(res.data)) {
                    if (out.length >= want) break;
                    push(ev);
                }
            }
        } catch { /* RAM is enough */ }
    }
    return out;
}

export function searchEvents(query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return recentEvents(events.length);
    const out: LedgerEvent[] = [];
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (
            ev.summary.toLowerCase().includes(q)
            || ev.type.toLowerCase().includes(q)
            || (ev.userName || "").toLowerCase().includes(q)
            || (ev.preview || "").toLowerCase().includes(q)
            || (ev.previewAfter || "").toLowerCase().includes(q)
            || (ev.userId || "").includes(q)
            || (ev.channelId || "").includes(q)
            || (ev.guildId || "").includes(q)
            || (ev.messageId || "").includes(q)
        ) out.push(ev);
    }
    return out;
}

export function recentEvents(limit = 100) {
    const cap = Math.max(0, limit);
    const out: LedgerEvent[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < cap; i--)
        out.push(events[i]);
    return out;
}

export async function searchAuditEvents(query: string) {
    const q = query.trim();
    if (!q) return seekEvents(0, 80);
    const local = searchEvents(q);
    const res = await nativeApi()?.searchAudit?.(q, 20000);
    const disk = res?.ok && res.data ? eventsFromMd(res.data) : [];
    const seen = new Set<string>();
    const out: LedgerEvent[] = [];
    for (const ev of [...local, ...disk]) {
        if (!inSession(ev)) continue;
        const key = `${ev.at}|${ev.type}|${ev.messageId || ev.userId || ev.summary}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ev);
        if (out.length >= 20000) break;
    }
    return out;
}

export async function flushLedger() {
    if (saveTimer != null) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (!persistOn() || !pendingMd.length) return;
    const n = pendingMd.length;
    const chunk = pendingMd.splice(0).join("\n") + "\n";
    const res = await nativeApi()?.appendMd?.(dayFile(), chunk);
    if (res?.ok) diskLines += n;
    else pendingMd.unshift(...chunk.trim().split("\n").filter(Boolean));
}

export async function loadLedger() {
    if (loaded) return;
    loaded = true;
    try {
        const cat = await nativeApi()?.auditCatalog?.();
        if (cat?.ok && cat.data) {
            try {
                diskLines = Number(JSON.parse(cat.data).total) || 0;
            } catch {
                diskLines = 0;
            }
        }
        const tail = await nativeApi()?.readAuditWindow?.(0, 80);
        if (tail?.ok && tail.data) {
            events.length = 0;
            events.push(...eventsFromMd(tail.data).slice().reverse());
            trimRam();
            for (const ev of events) noteVisual(ev);
        }
        const mediaTail = await nativeApi()?.readMediaWindow?.(0, 800);
        if (mediaTail?.ok && mediaTail.data) {
            for (const ev of eventsFromMd(mediaTail.data).reverse()) noteVisual(ev);
        }
    } catch { /* ignore */ }
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) void flushLedger();
        });
    }
    emit();
}

export function refreshEventMedia(channelId: string, messageId: string, media?: LedgerMedia[]) {
    const next = sanitizeMedia(media);
    if (!channelId || !messageId || !next) return;
    let changed = false;
    for (const ev of events) {
        if (ev.channelId === channelId && ev.messageId === messageId) {
            ev.media = next;
            changed = true;
            noteVisual(ev);
        }
    }
    if (changed) emit();
}

export function logEvent(partial: {
    type: string;
    summary: string;
    severity?: Severity;
    userId?: string;
    userName?: string;
    channelId?: string;
    guildId?: string;
    messageId?: string;
    detail?: string;
    preview?: string;
    previewAfter?: string;
    voiceChannelId?: string;
    media?: LedgerMedia[];
}) {
    const event: LedgerEvent = {
        id: `${Date.now().toString(36)}-${++seq}`,
        at: Date.now(),
        severity: partial.severity || "info",
        type: partial.type,
        summary: String(partial.summary || "").slice(0, 280),
        userId: partial.userId,
        userName: partial.userName ? String(partial.userName).slice(0, 80) : undefined,
        channelId: partial.channelId,
        guildId: partial.guildId,
        messageId: partial.messageId,
        detail: partial.detail ? String(partial.detail).slice(0, 800) : undefined,
        preview: partial.preview ? String(partial.preview).slice(0, 800) : undefined,
        previewAfter: partial.previewAfter ? String(partial.previewAfter).slice(0, 800) : undefined,
        voiceChannelId: partial.voiceChannelId,
        media: sanitizeMedia(partial.media)
    };
    events.push(event);
    trimRam();
    noteVisual(event);
    emit();
    if (persistOn()) {
        pendingMd.push(eventToMdLine(event));
        scheduleSave();
    }
    return event;
}

export function exportEventsJson(query = "") {
    return JSON.stringify(searchEvents(query));
}
