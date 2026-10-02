/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import type { ChatLine } from "../quickSummary/summarize";

export type BarState = {
    active: boolean;
    busy: boolean;
    mode: "session" | "auto";
    status: string;
    done: number;
    total: number;
    lang: string;
    channelId: string;
    error: string;
};

const overlays = new Map<string, string>();
const setters = new Map<string, (text: string | undefined) => void>();
const barListeners = new Set<() => void>();

let cachedLines: ChatLine[] = [];
let cachedPrior: ChatLine[] = [];
let runId = 0;

let bar: BarState = {
    active: false,
    busy: false,
    mode: "session",
    status: "",
    done: 0,
    total: 0,
    lang: "en",
    channelId: "",
    error: ""
};

function emitBar() {
    for (const fn of barListeners) fn();
}

export function nextRun() {
    return ++runId;
}

export function currentRun() {
    return runId;
}

export function getBar() {
    return bar;
}

export function getCachedLines() {
    return cachedLines;
}

export function getCachedPrior() {
    return cachedPrior;
}

export function overlayFor(id: string) {
    return overlays.get(id);
}

export function setCachedLines(lines: ChatLine[], prior: ChatLine[] = []) {
    cachedLines = lines;
    cachedPrior = prior;
}

export function patchBar(partial: Partial<BarState>) {
    bar = { ...bar, ...partial };
    emitBar();
}

export function setOverlay(id: string, text: string) {
    overlays.set(id, text);
    setters.get(id)?.(text);
}

export function setOverlays(entries: Array<[string, string]>) {
    for (const [id, text] of entries) setOverlay(id, text);
    emitBar();
}

export function registerOverlay(id: string, set: (text: string | undefined) => void) {
    setters.set(id, set);
    set(overlays.get(id));
    return () => {
        if (setters.get(id) === set) setters.delete(id);
    };
}

export function dismissOne(id: string) {
    overlays.delete(id);
    setters.get(id)?.(undefined);
    if (!overlays.size && !bar.busy) {
        dismissAll();
        return;
    }
    emitBar();
}

export function dismissAll() {
    runId++;
    overlays.clear();
    cachedLines = [];
    cachedPrior = [];
    for (const set of setters.values()) set(undefined);
    bar = {
        active: false,
        busy: false,
        mode: "session",
        status: "",
        done: 0,
        total: 0,
        lang: bar.lang,
        channelId: "",
        error: ""
    };
    emitBar();
}

export function subscribeBar(fn: () => void) {
    barListeners.add(fn);
    return () => { barListeners.delete(fn); };
}

export function useBar() {
    const [, bump] = useState(0);
    useEffect(() => subscribeBar(() => bump(n => n + 1)), []);
    return bar;
}

export function overlayCount() {
    return overlays.size;
}

export function clearOverlays() {
    overlays.clear();
    for (const set of setters.values()) set(undefined);
    emitBar();
}
