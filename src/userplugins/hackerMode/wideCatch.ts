/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByPropsLazy } from "@webpack";
import { ChannelStore, GuildChannelStore, GuildStore, MessageStore, SelectedChannelStore } from "@webpack/common";

const Gateway = findByPropsLazy("getSocket") as {
    getSocket?: () => { send?: (op: number, data?: unknown) => unknown; } | null;
};

const TEXT_TYPES = new Set([0, 5, 10, 11, 12, 15, 16]);
const BATCH = 4;
const SUB_GAP = 120;

let cacheLive: (msg: any) => void = () => { /* bound from flux */ };
let running = false;
let subTimer: ReturnType<typeof setTimeout> | null = null;
let dmTimer: ReturnType<typeof setTimeout> | null = null;
let refillTimer: ReturnType<typeof setInterval> | null = null;
let lastFull = 0;
const queue: Array<{ guildId: string; channels: Record<string, number[][]>; }> = [];

export function bindIngest(fn: (msg: any) => void) {
    cacheLive = fn;
}

function cachedMessages(channelId: string) {
    try {
        const pack = MessageStore.getMessages(channelId) as any;
        return (pack?._array || pack?.toArray?.() || []) as any[];
    } catch {
        return [];
    }
}

export function harvestChannel(channelId?: string) {
    if (!channelId || !running) return;
    const rows = cachedMessages(channelId);
    for (let i = 0; i < rows.length; i++) {
        const msg = rows[i];
        if (msg?.id) cacheLive(msg);
    }
}

export function ingestLoadedMessages(event: any) {
    if (!running) return;
    const rows = event?.messages || event?.ok?.messages || [];
    if (!Array.isArray(rows) || !rows.length) return;
    const channelId = String(event?.channelId || event?.channel_id || "");
    for (let i = 0; i < rows.length; i++) {
        const msg = rows[i];
        if (!msg) continue;
        cacheLive({ ...msg, channel_id: msg.channel_id || msg.channelId || channelId });
    }
}

function sendOp14(guildId: string, channels?: Record<string, number[][]>) {
    try {
        const socket = Gateway.getSocket?.();
        if (!socket?.send) return;
        socket.send(14, {
            guild_id: guildId,
            typing: false,
            activities: false,
            threads: true,
            members: [],
            ...(channels && Object.keys(channels).length ? { channels } : {})
        });
    } catch { /* ignore */ }
}

function textChannelIds(guildId: string) {
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (ch: any) => {
        const id = String(ch?.id || ch?.channel?.id || "");
        const type = ch?.type ?? ch?.Type ?? ch?.channel?.type ?? ch?.channel?.Type;
        if (!id || seen.has(id) || !TEXT_TYPES.has(Number(type))) return;
        seen.add(id);
        ids.push(id);
    };
    try {
        const map = ChannelStore.getMutableGuildChannelsForGuild?.(guildId) || {};
        for (const ch of Object.values(map)) add(ch);
    } catch { /* ignore */ }
    try {
        const pack = GuildChannelStore.getChannels?.(guildId);
        for (const row of pack?.SELECTABLE || []) add(row);
    } catch { /* ignore */ }
    return ids;
}

function enqueueGuild(guildId: string, first?: string) {
    const ids = textChannelIds(guildId);
    if (first && !ids.includes(first)) ids.unshift(first);
    else if (first) {
        const at = ids.indexOf(first);
        if (at > 0) {
            ids.splice(at, 1);
            ids.unshift(first);
        }
    }
    for (let i = 0; i < ids.length; i += BATCH) {
        const slice = ids.slice(i, i + BATCH);
        const channels: Record<string, number[][]> = {};
        for (const id of slice) channels[id] = [[0, 0]];
        queue.push({ guildId, channels });
    }
}

function fillQueue() {
    queue.length = 0;
    let guilds: any[] = [];
    try {
        guilds = Object.values(GuildStore.getGuilds?.() || {});
    } catch { /* ignore */ }
    let selected = "";
    try {
        const ch = SelectedChannelStore.getChannelId?.();
        selected = String(ChannelStore.getChannel(ch)?.guild_id || "");
    } catch { /* ignore */ }
    if (selected) {
        guilds.sort((a, b) => Number(b?.id === selected) - Number(a?.id === selected));
    }
    for (const g of guilds) {
        if (g?.id) enqueueGuild(g.id);
    }
    lastFull = Date.now();
}

function pump() {
    if (subTimer != null) clearTimeout(subTimer);
    subTimer = null;
    if (!running) return;
    const next = queue.shift();
    if (next) sendOp14(next.guildId, next.channels);
    subTimer = setTimeout(pump, queue.length ? SUB_GAP : 400);
}

export function subscribeAllGuilds() {
    fillQueue();
    pump();
}

export function watchGuild(guildId?: string) {
    if (!guildId || !running) return;
    enqueueGuild(guildId);
    if (subTimer == null) pump();
}

export function watchChannel(channelId?: string) {
    if (!channelId || !running) return;
    let guildId = "";
    try {
        guildId = String(ChannelStore.getChannel(channelId)?.guild_id || "");
    } catch { /* dm */ }
    if (!guildId) return;
    queue.unshift({ guildId, channels: { [channelId]: [[0, 0]] } });
    if (subTimer == null) pump();
}

function harvestAllCached() {
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (id?: string) => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    };
    try {
        for (const ch of ChannelStore.getSortedPrivateChannels?.() || []) add(ch?.id);
    } catch { /* ignore */ }
    try {
        const raw = (MessageStore as any)._channelMessages || (MessageStore as any).channelMessages;
        const keys = raw?.keys ? [...raw.keys()] : raw ? Object.keys(raw) : [];
        for (const id of keys) add(String(id));
    } catch { /* ignore */ }
    try {
        for (const g of Object.values(GuildStore.getGuilds?.() || {}) as any[]) {
            if (!g?.id) continue;
            for (const id of textChannelIds(g.id)) add(id);
        }
    } catch { /* ignore */ }
    let i = 0;
    const tick = () => {
        if (!running || i >= ids.length) return;
        harvestChannel(ids[i++]);
        if (i < ids.length) dmTimer = setTimeout(tick, 40);
    };
    if (dmTimer != null) clearTimeout(dmTimer);
    tick();
}

export function refreshCachedMedia() {
    if (running) harvestAllCached();
}

export function startWideCatch() {
    running = true;
    subscribeAllGuilds();
    harvestAllCached();
    if (refillTimer != null) clearInterval(refillTimer);
    refillTimer = setInterval(() => {
        if (!running || queue.length > 12) return;
        fillQueue();
    }, 75000);
}

export function stopWideCatch() {
    running = false;
    queue.length = 0;
    if (subTimer != null) clearTimeout(subTimer);
    subTimer = null;
    if (dmTimer != null) clearTimeout(dmTimer);
    dmTimer = null;
    if (refillTimer != null) clearInterval(refillTimer);
    refillTimer = null;
}

export function onWideReconnect() {
    if (!running) return;
    if (Date.now() - lastFull < 25000) return;
    subscribeAllGuilds();
}
