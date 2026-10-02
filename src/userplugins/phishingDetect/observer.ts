/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Root } from "react-dom/client";

import { aiVerdict } from "./ai";
import { mountBanner, updateBanner } from "./banner";
import { isAuthScreenText, mergeVerdict, scoreSnapshot, snapshotFromDialog, type Verdict } from "./scan";
import { settings } from "./settings";

const OVERLAY = "vc-pd-overlay";

type Tracked = {
    host: HTMLElement;
    root: Root;
    sig: string;
    base: Verdict;
    shown: Verdict;
};

const tracked = new Map<HTMLElement, Tracked>();
const aiBusy = new Set<string>();
let observer: MutationObserver | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let scanning = false;

function skipLayer(el: HTMLElement) {
    if (el.closest(`.${OVERLAY}`) || el.classList.contains(OVERLAY)) return true;
    if (el.closest("[data-vc-pd-ignore], .vc-plugins-settings, .vc-plugin-modal-header, .vc-settings-modal-content, .vc-settings-tab"))
        return true;
    if (el.querySelector("[data-vc-pd-ignore], .vc-plugins-settings, .vc-plugin-modal-header, [name='phishing-detect-openrouter-key']"))
        return true;
    return false;
}

function dialogs() {
    const nodes = document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]');
    const inner: HTMLElement[] = [];
    for (const el of nodes) {
        if (skipLayer(el)) continue;
        const text = el.innerText || "";
        if (!isAuthScreenText(text)) continue;
        let best = el;
        let bestLen = text.length;
        for (const child of el.querySelectorAll<HTMLElement>(":scope > div, :scope > div > div, :scope > div > div > div")) {
            if (skipLayer(child) || child.classList.contains(OVERLAY)) continue;
            const t = child.innerText || "";
            if (t.length < 80 || t.length >= bestLen) continue;
            if (isAuthScreenText(t)) {
                best = child;
                bestLen = t.length;
            }
        }
        if (!inner.includes(best)) inner.push(best);
    }
    return inner;
}

function signature(verdict: Verdict, el: HTMLElement) {
    const snap = snapshotFromDialog(el);
    return [
        snap?.kind,
        snap?.appName,
        snap?.redirect,
        snap?.scopes.join(","),
        snap?.fields.join("|").slice(0, 200),
        verdict.level,
        verdict.summary,
        verdict.reasons.join("\0")
    ].join("::");
}

function placeOverlay(host: HTMLElement, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const width = Math.max(240, Math.min(rect.width - 24, 560));
    host.style.left = `${Math.round(rect.left + (rect.width - width) / 2)}px`;
    host.style.top = `${Math.round(Math.max(8, rect.top + 10))}px`;
    host.style.width = `${Math.round(width)}px`;
}

function reposition() {
    for (const [el, rec] of tracked) {
        if (el.isConnected) placeOverlay(rec.host, el);
        else drop(el);
    }
}

function drop(el: HTMLElement) {
    const rec = tracked.get(el);
    if (!rec) return;
    try {
        rec.root.unmount();
    } catch { /* already gone */ }
    rec.host.remove();
    tracked.delete(el);
}

function attach(el: HTMLElement) {
    if (!settings.store.scanModals || skipLayer(el) || !el.isConnected) {
        drop(el);
        return;
    }
    const snap = snapshotFromDialog(el);
    if (!snap) {
        drop(el);
        return;
    }

    const base = scoreSnapshot(snap);
    const sig = signature(base, el);
    const existing = tracked.get(el);
    if (existing && existing.sig === sig) {
        placeOverlay(existing.host, el);
        return;
    }

    let rec = existing;
    if (!rec) {
        const host = document.createElement("div");
        host.className = OVERLAY;
        host.setAttribute("data-vc-pd-ignore", "1");
        document.body.appendChild(host);
        rec = {
            host,
            root: mountBanner(host, base),
            sig,
            base,
            shown: base
        };
        tracked.set(el, rec);
        placeOverlay(host, el);
        requestAnimationFrame(() => {
            if (tracked.get(el)) placeOverlay(host, el);
        });
    } else {
        rec.sig = sig;
        rec.base = base;
        rec.shown = base;
        updateBanner(rec.root, base, false);
        placeOverlay(rec.host, el);
    }

    const key = `${snap.appName}|${snap.redirect}|${snap.scopes.join(",")}|${snap.fields.join(",")}`;
    if (aiBusy.has(key)) return;
    aiBusy.add(key);
    void aiVerdict(snap).then(ai => {
        aiBusy.delete(key);
        const cur = tracked.get(el);
        if (!cur || !ai) return;
        const merged = mergeVerdict(cur.base, ai);
        const nextSig = signature(merged, el);
        if (nextSig === cur.sig && merged.level === cur.shown.level && merged.summary === cur.shown.summary)
            return;
        cur.sig = nextSig;
        cur.shown = merged;
        updateBanner(cur.root, merged, false);
    }).catch(() => {
        aiBusy.delete(key);
    });
}

function scanAll() {
    if (scanning) return;
    scanning = true;
    observer?.disconnect();
    try {
        const live = new Set(dialogs());
        for (const el of live) {
            try {
                attach(el);
            } catch { /* ignore */ }
        }
        for (const el of [...tracked.keys()]) {
            if (!live.has(el) || !el.isConnected) drop(el);
        }
    } finally {
        scanning = false;
        observer?.observe(document.body, { childList: true, subtree: true });
    }
}

function fromOwnUi(node: Node | null) {
    const el = node instanceof Element ? node : node?.parentElement;
    return !!el?.closest?.(`.${OVERLAY}, [data-vc-pd-ignore]`);
}

function schedule(records?: MutationRecord[]) {
    if (records?.length && records.every(r => fromOwnUi(r.target) && [...r.addedNodes].every(fromOwnUi) && [...r.removedNodes].every(fromOwnUi)))
        return;
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(scanAll, 120);
}

export function startObserver() {
    stopObserver();
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", reposition);
    schedule();
}

export function stopObserver() {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("resize", reposition);
    if (timer != null) clearTimeout(timer);
    timer = null;
    for (const el of [...tracked.keys()]) drop(el);
}
