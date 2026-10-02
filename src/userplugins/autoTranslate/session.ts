/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message } from "@vencord/discord-types";
import { MessageStore, SelectedChannelStore, UserStore, useEffect, useState } from "@webpack/common";

import { translateIfNotEnglish } from "./translate";

type Job = { id: string; channelId: string; text: string; generation: number; };

const overlays = new Map<string, string>();
const setters = new Map<string, (text: string | undefined) => void>();
const listeners = new Set<() => void>();
const seen = new Set<string>();
const queue: Job[] = [];

let armedChannel: string | null = null;
let floorId: string | null = null;
let armedAt = 0;
let generation = 0;
let pumping = false;

function emit() {
    for (const fn of listeners) fn();
}

export function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

export function getArmedChannel() {
    return armedChannel;
}

export function translationFor(id: string) {
    return overlays.get(id);
}

export function registerTranslation(id: string, set: (text: string | undefined) => void) {
    setters.set(id, set);
    set(overlays.get(id));
    return () => {
        if (setters.get(id) === set) setters.delete(id);
    };
}

export function dismissTranslation(id: string) {
    overlays.delete(id);
    setters.get(id)?.(undefined);
}

function remember(id: string) {
    seen.add(id);
    if (seen.size > 400) {
        const first = seen.values().next().value;
        if (first) seen.delete(first);
    }
}

function newestMessageId(channelId: string) {
    try {
        const pack = MessageStore.getMessages(channelId) as { _array?: Message[]; toArray?: () => Message[]; } | undefined;
        const list = pack?._array || pack?.toArray?.() || [];
        const last = list[list.length - 1];
        return last?.id ? String(last.id) : null;
    } catch {
        return null;
    }
}

function isUpcoming(id: string) {
    if (floorId) {
        try {
            return BigInt(id) > BigInt(floorId);
        } catch {
            return id > floorId;
        }
    }
    try {
        const sentAt = Number((BigInt(id) >> 22n) + 1420070400000n);
        return sentAt >= armedAt;
    } catch {
        return false;
    }
}

export function arm(channelId: string) {
    generation++;
    queue.length = 0;
    armedChannel = channelId;
    floorId = newestMessageId(channelId);
    armedAt = Date.now();
    emit();
}

export function disarm() {
    if (!armedChannel && !queue.length) return;
    generation++;
    queue.length = 0;
    armedChannel = null;
    floorId = null;
    armedAt = 0;
    emit();
}

function stillWatching(job: Job) {
    return job.generation === generation
        && armedChannel === job.channelId
        && SelectedChannelStore.getChannelId() === job.channelId;
}

function messageText(message: Message) {
    const text = String(message?.content || "").trim();
    if (!text) return "";
    const type = (message as { type?: number; }).type ?? 0;
    if (type !== 0 && type !== 19 && type !== 20 && type !== 21) return "";
    return text;
}

export function enqueueIncoming(message: Message, optimistic?: boolean) {
    if (!armedChannel) return;
    if (optimistic) return;
    if (!message?.id || message.channel_id !== armedChannel) return;
    if (SelectedChannelStore.getChannelId() !== armedChannel) {
        disarm();
        return;
    }
    if (!isUpcoming(String(message.id))) return;

    try {
        if (UserStore.getCurrentUser()?.id === message.author?.id) return;
    } catch { /* ignore */ }

    const text = messageText(message);
    if (!text || seen.has(message.id) || overlays.has(message.id)) return;

    remember(message.id);
    queue.push({
        id: message.id,
        channelId: message.channel_id,
        text,
        generation
    });
    void pump();
}

async function pump() {
    if (pumping) return;
    pumping = true;
    try {
        while (queue.length) {
            const job = queue.shift()!;
            if (!stillWatching(job)) continue;
            try {
                const translated = await translateIfNotEnglish(job.text);
                if (!translated || !stillWatching(job)) continue;
                overlays.set(job.id, translated);
                setters.get(job.id)?.(translated);
            } catch { /* skip this message */ }
        }
    } finally {
        pumping = false;
        if (queue.length) void pump();
    }
}

export function useArmedChannel() {
    const [, bump] = useState(0);
    useEffect(() => subscribe(() => bump(n => n + 1)), []);
    return armedChannel;
}
