/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { UserStore } from "@webpack/common";

import { logEvent } from "./ledger";
import { dossiersFromMd, dossiersToMd } from "./md";
import { settings } from "./settings";
import { toolOn } from "./tools";
import type { Dossier, NameHit } from "./types";

const CAP = 5000;
const HIST = 6;

const dossiers = new Map<string, Dossier>();
const listeners = new Set<() => void>();
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let emitTimer: ReturnType<typeof setTimeout> | null = null;
const diskSoon = new Set<string>();

function nativeApi() {
    if (IS_WEB) return undefined;
    return VencordNative.pluginHelpers.StalkerMode as PluginNative<typeof import("./native")> | undefined;
}

function emit() {
    if (emitTimer != null) return;
    emitTimer = setTimeout(() => {
        emitTimer = null;
        for (const fn of listeners) fn();
    }, 200);
}

function scheduleSave() {
    if (saveTimer != null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        void flushDossiers();
    }, 2500);
}

export async function flushDossiers() {
    if (saveTimer != null) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (settings.store.writeToDisk === false) return;
    diskSoon.clear();
    await nativeApi()?.writeMd?.("people.md", dossiersToMd([...dossiers.values()]));
}

function pushHit(list: NameHit[], value: string, at: number) {
    const next = String(value || "").trim();
    if (!next) return false;
    if (list.length && list[list.length - 1].value === next) return false;
    list.push({ value: next.slice(0, 120), at });
    if (list.length > HIST) list.splice(0, list.length - HIST);
    return true;
}

function trimMap() {
    if (dossiers.size <= CAP) return;
    const ranked = [...dossiers.values()].sort((a, b) => a.lastSeen - b.lastSeen);
    while (dossiers.size > CAP && ranked.length) {
        const drop = ranked.shift();
        if (drop) dossiers.delete(drop.id);
    }
}

export function subscribeDossiers(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

export function getDossier(id: string) {
    return dossiers.get(id);
}

export function listDossiers() {
    return [...dossiers.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

export async function loadDossiers() {
    if (loaded) return;
    loaded = true;
    try {
        const res = await nativeApi()?.readMd?.("people.md");
        const text = res?.ok ? res.data : "";
        const parsed = dossiersFromMd(text);
        if (parsed.length) {
            dossiers.clear();
            for (const row of parsed) {
                if (row?.id) dossiers.set(row.id, row);
            }
            emit();
        }
    } catch { /* ignore */ }
}

function userBits(raw: any) {
    const username = String(raw?.username || "").trim();
    const globalName = String(raw?.globalName || raw?.global_name || "").trim();
    const avatar = String(raw?.avatar || "").trim();
    const nick = String(raw?.nick || raw?.member?.nick || "").trim();
    return {
        id: String(raw?.id || raw?.user?.id || ""),
        username,
        globalName,
        avatar,
        nick,
        bot: Boolean(raw?.bot),
        flags: Number(raw?.flags || raw?.publicFlags || raw?.public_flags || 0)
    };
}

export function observeUser(raw: any, extra?: { nick?: string; guildId?: string; }) {
    if (!toolOn("dossiers") && !toolOn("identityLog")) return;
    const bits = userBits(raw);
    if (!bits.id) return;
    const me = UserStore.getCurrentUser()?.id;
    const at = Date.now();
    let row = dossiers.get(bits.id);
    const created = !row;
    if (!row) {
        row = {
            id: bits.id,
            usernames: [],
            nicks: [],
            avatars: [],
            firstSeen: at,
            lastSeen: at
        };
        dossiers.set(bits.id, row);
    }
    row.lastSeen = at;
    row.bot = bits.bot;
    if (bits.flags) row.flags = bits.flags;

    const nick = extra?.nick || bits.nick;
    const changed: string[] = [];
    if (bits.username && bits.username !== row.username) {
        if (row.username && !created) changed.push(`username ${row.username} → ${bits.username}`);
        row.username = bits.username;
        pushHit(row.usernames, bits.username, at);
    }
    if (bits.globalName && bits.globalName !== row.globalName) {
        if (row.globalName && !created) changed.push(`display ${row.globalName} → ${bits.globalName}`);
        row.globalName = bits.globalName;
    }
    if (nick && pushHit(row.nicks, nick, at) && !created) changed.push(`nick → ${nick}`);
    if (bits.avatar && pushHit(row.avatars, bits.avatar, at) && !created) changed.push("avatar changed");

    trimMap();
    if (!created && !changed.length) return;
    diskSoon.add(bits.id);
    scheduleSave();
    emit();

    if (!created && changed.length && toolOn("identityLog") && bits.id !== me) {
        logEvent({
            type: "identity",
            severity: "info",
            userId: bits.id,
            userName: bits.globalName || bits.username || bits.id,
            guildId: extra?.guildId,
            summary: `${bits.globalName || bits.username || bits.id}: ${changed.join(", ")}`
        });
    }
}
