/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { Button, createRoot } from "@webpack/common";
import type { Root } from "react-dom/client";

import { Delexo } from "../_delexo/author";
import { HeaderSlotButton, mountBeforeThreads } from "../_delexo/headerSlot";
import { scheduleOnce } from "../_delexo/idle";
import { closeYouTubePanel, openYouTubePanel, toggleYouTubePanel, useYouTubeOpen, YouTubeGlyph } from "./panel";
import managedStyle from "./style.css?managed";

function YouTubeSettings() {
    return (
        <div className="vc-yt-settings">
            <p>
                YouTube opens in its own window on top of Discord. Paste a link in the box at the top to watch it. Drag that bar to move the window.
            </p>
            <Button
                size={Button.Sizes.SMALL}
                color={Button.Colors.PRIMARY}
                onClick={() => openYouTubePanel()}
            >
                Open YouTube
            </Button>
        </div>
    );
}

const settings = definePluginSettings({
    about: {
        type: OptionType.COMPONENT,
        component: YouTubeSettings
    }
});

function YouTubeHeaderButton() {
    const open = useYouTubeOpen();
    return (
        <HeaderSlotButton
            tooltip={open ? "Close YouTube" : "YouTube"}
            selected={open}
            onClick={() => toggleYouTubePanel()}
            icon={props => <YouTubeGlyph {...props} active={open} />}
        />
    );
}

function YouTubeNav() {
    const open = useYouTubeOpen();
    return (
        <div className="vc-yt-nav" role="listitem">
            <button
                type="button"
                className={open ? "vc-yt-nav-btn vc-yt-nav-on" : "vc-yt-nav-btn"}
                onClick={() => toggleYouTubePanel()}
            >
                <YouTubeGlyph height={20} width={20} active={open} />
                <span className="vc-yt-nav-label">YouTube</span>
            </button>
        </div>
    );
}

const NAV_ID = "vc-youtube-nav";
let navHost: HTMLDivElement | null = null;
let navRoot: Root | null = null;
const placeNav = scheduleOnce(150);
let cachedQuests: HTMLElement | null = null;

function findQuestsRow(): HTMLElement | null {
    if (cachedQuests?.isConnected) return cachedQuests;
    cachedQuests = null;
    const nodes = document.querySelectorAll<HTMLElement>(
        '[class*="privateChannels"] [class*="link"], [class*="privateChannels"] [class*="channel"], nav [class*="interactive"]'
    );
    for (const el of nodes) {
        const label = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (/^quests$/i.test(label)) {
            cachedQuests = el.closest<HTMLElement>('[class*="channel"], [class*="link"], [role="listitem"], div') || el;
            return cachedQuests;
        }
    }
    const byAria = document.querySelector<HTMLElement>('[aria-label="Quests" i]');
    if (byAria) {
        cachedQuests = byAria.closest<HTMLElement>('[class*="channel"], [class*="link"], div') || byAria;
        return cachedQuests;
    }
    return null;
}

function findNavParent() {
    const quests = findQuestsRow();
    if (quests?.parentElement) return { parent: quests.parentElement, quests };
    const scroller = document.querySelector<HTMLElement>(
        '[class*="privateChannels"] [class*="scrollerInner"], [class*="privateChannels"] [class*="scroller"]'
    );
    return scroller ? { parent: scroller, quests: null } : null;
}

function removeNav() {
    navRoot?.unmount();
    navRoot = null;
    navHost?.remove();
    navHost = null;
    document.getElementById(NAV_ID)?.remove();
}

function placeNavRow() {
    const spot = findNavParent();
    if (!spot) {
        removeNav();
        return;
    }
    const inPlace = spot.quests
        ? navHost?.previousElementSibling === spot.quests
        : spot.parent.firstElementChild === navHost;
    if (
        navHost?.isConnected &&
        navHost.parentElement === spot.parent &&
        inPlace &&
        document.querySelectorAll(`#${NAV_ID}`).length === 1
    ) return;

    removeNav();
    navHost = document.createElement("div");
    navHost.id = NAV_ID;
    const before = spot.quests ? spot.quests.nextSibling : spot.parent.firstChild;
    spot.parent.insertBefore(navHost, before);
    navRoot = createRoot(navHost);
    navRoot.render(
        <ErrorBoundary noop>
            <YouTubeNav />
        </ErrorBoundary>
    );
}

function queueNav() {
    placeNav.run(() => {
        try { placeNavRow(); } catch { /* ignore */ }
    });
}

let running = false;
let panelOpened = false;
let panelTimer: number | undefined;
let removeHeaderSlot: (() => void) | null = null;

function showYouTubeWhenReady() {
    if (!running || panelOpened) return;
    panelOpened = true;
    if (panelTimer) window.clearTimeout(panelTimer);
    panelTimer = undefined;
    const close = VencordNative.pluginHelpers.YouTube?.close;
    if (close) void close().finally(() => openYouTubePanel());
    else openYouTubePanel();
}

export default definePlugin({
    name: "YouTube",
    description: "Opens YouTube inside Discord when the plugin is enabled. No account is required.",
    tags: ["Media", "Utility"],
    searchTerms: ["youtube", "video", "watch", "cookies", "delexo"],
    authors: [Delexo],
    enabledByDefault: true,
    requiresRestart: false,
    settings,
    managedStyle,

    flux: {
        CHANNEL_SELECT() {
            queueNav();
        },
        CONNECTION_OPEN() {
            queueNav();
            showYouTubeWhenReady();
        }
    },

    start() {
        running = true;
        removeNav();
        queueNav();
        removeHeaderSlot = mountBeforeThreads("vc-youtube-header-slot", <YouTubeHeaderButton />);
        panelTimer = window.setTimeout(showYouTubeWhenReady, 3000);
    },

    stop() {
        running = false;
        removeHeaderSlot?.();
        removeHeaderSlot = null;
        if (panelTimer) window.clearTimeout(panelTimer);
        panelTimer = undefined;
        panelOpened = false;
        placeNav.cancel();
        cachedQuests = null;
        removeNav();
        closeYouTubePanel();
    }
});
