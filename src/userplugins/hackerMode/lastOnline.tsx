/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import ErrorBoundary from "@components/ErrorBoundary";
import { PresenceStore, useEffect, useState, useStateFromStores } from "@webpack/common";

const STORE_KEY = "LastOnlineTimestamps";
const SEEN_KEY = "LastOnlineSeenOnline";

/** userId -> ms when they last went fully offline */
let offlineAt: Record<string, number> = {};
/** users we have observed online */
let seenOnline = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
    if (saveTimer != null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const ids = Object.keys(offlineAt);
        if (ids.length > 400) {
            ids.sort((a, b) => (offlineAt[a] ?? 0) - (offlineAt[b] ?? 0));
            for (const id of ids.slice(0, ids.length - 400)) delete offlineAt[id];
        }
        if (seenOnline.size > 800) seenOnline = new Set([...seenOnline].slice(-800));
        void DataStore.set(STORE_KEY, offlineAt);
        void DataStore.set(SEEN_KEY, [...seenOnline]);
    }, 2500);
}

function isActiveStatus(status: string | undefined | null) {
    return status === "online" || status === "idle" || status === "dnd";
}

function formatAgo(ms: number) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    if (sec < 5) return "just now";
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) {
        const remMin = min % 60;
        return remMin > 0 ? `${hr}h ${remMin}m ago` : `${hr}h ago`;
    }
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    const week = Math.floor(day / 7);
    if (week < 5) return `${week}w ago`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month}mo ago`;
    return `${Math.floor(day / 365)}y ago`;
}

function tickDelayForAge(ms: number) {
    if (ms < 60_000) return 1_000;
    if (ms < 3_600_000) return 15_000;
    if (ms < 86_400_000) return 60_000;
    return 5 * 60_000;
}

export function notePresence(
    userId: string,
    status: string | undefined,
    clientStatus?: Record<string, string> | null
) {
    if (!userId) return;
    const fullyOffline =
        (status === "offline" || status === "invisible" || !status) &&
        (!clientStatus || Object.keys(clientStatus).length === 0);

    if (!fullyOffline && isActiveStatus(status)) {
        seenOnline.add(userId);
        if (offlineAt[userId] != null) {
            delete offlineAt[userId];
            scheduleSave();
        }
        return;
    }

    if (fullyOffline && seenOnline.has(userId) && offlineAt[userId] == null) {
        offlineAt[userId] = Date.now();
        seenOnline.delete(userId);
        scheduleSave();
    }
}

function reconcileUser(userId: string | null | undefined) {
    if (!userId) return;
    try {
        const status = PresenceStore.getStatus(userId) as string | undefined;
        const clientStatus = PresenceStore.getClientStatus?.(userId) as Record<string, string> | null | undefined;
        notePresence(userId, status, clientStatus ?? null);
    } catch { /* ignore */ }
}

function tipForUser(userId: string | undefined | null) {
    if (!userId) return null;
    const status = (PresenceStore.getStatus(userId) as string | undefined) || "offline";
    if (isActiveStatus(status)) return null;
    const ts = offlineAt[userId];
    if (ts != null) return `Last online ${formatAgo(Date.now() - ts)}`;
    return "TBD...";
}

function LastOnlineLineInner({ user }: { user?: { id?: string; }; }) {
    const id = user?.id;
    useStateFromStores([PresenceStore], () => (id ? PresenceStore.getStatus(id) : null));
    const [, bump] = useState(0);
    const text = tipForUser(id);

    useEffect(() => {
        if (!id || offlineAt[id] == null) return;
        const delay = tickDelayForAge(Date.now() - offlineAt[id]);
        const timer = setTimeout(() => bump(n => n + 1), delay);
        return () => clearTimeout(timer);
    }, [id, text]);

    if (!text) return null;
    return (
        <div className="vc-stalker-last-online" role="status">
            <span className="vc-stalker-last-online-dot" aria-hidden />
            <span>{text}</span>
        </div>
    );
}

export const LastOnlineLine = ErrorBoundary.wrap(LastOnlineLineInner, { noop: true });

export async function startLastOnline() {
    const saved = (await DataStore.get<Record<string, number>>(STORE_KEY)) ?? {};
    for (const [id, ts] of Object.entries(saved)) {
        if (offlineAt[id] == null) offlineAt[id] = ts;
    }
    const seen = (await DataStore.get<string[]>(SEEN_KEY)) ?? [];
    for (const id of seen) seenOnline.add(id);
    try {
        for (const id of PresenceStore.getUserIds?.() ?? []) reconcileUser(id);
        for (const id of [...seenOnline]) {
            const status = PresenceStore.getStatus(id) as string | undefined;
            if (!isActiveStatus(status) && offlineAt[id] == null) {
                offlineAt[id] = Date.now();
                seenOnline.delete(id);
            }
        }
        scheduleSave();
    } catch { /* ignore */ }
}

export function stopLastOnline() {
    if (saveTimer != null) clearTimeout(saveTimer);
    saveTimer = null;
    void DataStore.set(STORE_KEY, offlineAt);
    void DataStore.set(SEEN_KEY, [...seenOnline]);
}
