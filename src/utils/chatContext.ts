/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "@plugins/translate/settings";
import { MessageStore, SelectedChannelStore } from "@webpack/common";

export function contextLimits(): { before: number; after: number; } | null {
    if (settings.store.useMessageContext === false) return null;
    const total = Math.max(4, Math.min(40, Number(settings.store.contextMessages) || 12));
    const after = Math.min(6, Math.max(2, Math.round(total / 4)));
    return { before: Math.max(2, total - after), after };
}

function cmpId(a: string, b: string) {
    try {
        const x = BigInt(a);
        const y = BigInt(b);
        return x < y ? -1 : x > y ? 1 : 0;
    } catch {
        return a < b ? -1 : a > b ? 1 : 0;
    }
}

function authorName(raw: any) {
    const user = raw?.author;
    return String(
        raw?.member?.nick
        || user?.globalName
        || user?.global_name
        || user?.displayName
        || user?.username
        || "Someone"
    ).trim() || "Someone";
}

function lineText(raw: any) {
    let text = String(raw?.content || "").replace(/\s+/g, " ").trim();
    if (!text) {
        const file = raw?.attachments?.[0]?.filename || raw?.attachments?.[0]?.name;
        if (file) text = `[${file}]`;
    }
    return text.slice(0, 180);
}

function channelMessages(channelId: string) {
    try {
        const pack = MessageStore.getMessages(channelId) as { _array?: any[]; toArray?: () => any[]; } | undefined;
        const arr = pack?._array ?? pack?.toArray?.() ?? [];
        return arr.map(msg => {
            const text = lineText(msg);
            const id = String(msg?.id || "");
            if (!id || !text) return null;
            return { id, name: authorName(msg), text };
        }).filter((line): line is { id: string; name: string; text: string; } => Boolean(line));
    } catch {
        return [];
    }
}

export function chatContextBlock(channelId?: string, messageId?: string) {
    const channel = channelId || SelectedChannelStore.getChannelId?.() || "";
    if (!channel) return "";
    const lines = channelMessages(channel);
    if (!lines.length) return "";

    const limits = contextLimits();
    if (!limits) return "";

    let before = lines.slice(-limits.before);
    let after: typeof lines = [];
    if (messageId) {
        const idx = lines.findIndex(line => line.id === messageId);
        if (idx >= 0) {
            before = lines.slice(Math.max(0, idx - limits.before), idx);
            after = lines.slice(idx + 1, idx + 1 + limits.after);
        } else {
            before = lines.filter(line => cmpId(line.id, messageId) < 0).slice(-limits.before);
            after = lines.filter(line => cmpId(line.id, messageId) > 0).slice(0, limits.after);
        }
    }

    if (!before.length && !after.length) return "";
    const format = (rows: typeof lines) => rows.map(row => `${row.name}: ${row.text}`).join("\n");
    const parts = [
        "Nearby messages are context only. Do not translate them. Use them for names, slang, and what this or that refers to."
    ];
    if (before.length) parts.push(`Before:\n${format(before)}`);
    if (after.length) parts.push(`After:\n${format(after)}`);
    return parts.join("\n");
}
