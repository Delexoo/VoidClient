/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import type { IconComponent } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { createRoot } from "@webpack/common";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

const ORDER = ["vc-stalker-header-slot", "vc-youtube-header-slot"];

type Slot = {
    id: string;
    node: ReactNode;
    host: HTMLDivElement | null;
    root: Root | null;
};

const slots: Slot[] = [];
let poll = 0;

export function HeaderSlotButton({ tooltip, selected, onClick, icon }: {
    tooltip: string;
    selected?: boolean;
    onClick(): void;
    icon: IconComponent;
}) {
    return (
        <HeaderBarIcon
            tooltip={tooltip}
            icon={icon}
            onClick={onClick}
            selected={!!selected}
        />
    );
}

function findThreadsButton(): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestTop = Infinity;
    const nodes = document.querySelectorAll<HTMLElement>("[aria-label]");
    for (const el of nodes) {
        if (el.closest("#vc-stalker-header-slot, #vc-youtube-header-slot")) continue;
        const label = (el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        if (!/^threads\b/i.test(label)) continue;
        if (/create|notification|member/i.test(label)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8 || rect.top > 180 || rect.top < 0) continue;
        const toolbar = el.closest<HTMLElement>('[class*="toolbar"]');
        let item = el;
        if (toolbar) {
            while (item.parentElement && item.parentElement !== toolbar) item = item.parentElement;
        }
        if (rect.top < bestTop) {
            bestTop = rect.top;
            best = item;
        }
    }
    return best;
}

function placeAll() {
    const threads = findThreadsButton();
    const parent = threads?.parentElement;
    if (!threads || !parent) {
        for (const slot of slots) {
            if (slot.host?.isConnected) slot.host.remove();
        }
        return;
    }

    const ordered = slots.slice().sort((a, b) => {
        const ai = ORDER.indexOf(a.id);
        const bi = ORDER.indexOf(b.id);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    let anchor: HTMLElement = threads;
    for (const slot of ordered.slice().reverse()) {
        if (!slot.host) {
            slot.host = document.createElement("div");
            slot.host.id = slot.id;
            slot.host.style.display = "contents";
            slot.root = createRoot(slot.host);
            slot.root.render(
                <ErrorBoundary noop>
                    {slot.node}
                </ErrorBoundary>
            );
        }
        if (slot.host.parentElement !== parent || slot.host.nextElementSibling !== anchor)
            parent.insertBefore(slot.host, anchor);
        anchor = slot.host;
    }
}

function ensureWatch() {
    if (poll) return;
    placeAll();
    poll = window.setInterval(placeAll, 2000);
}

export function mountBeforeThreads(id: string, node: ReactNode) {
    let slot = slots.find(item => item.id === id);
    if (!slot) {
        slot = { id, node, host: null, root: null };
        slots.push(slot);
    } else {
        slot.node = node;
        slot.root?.render(
            <ErrorBoundary noop>
                {node}
            </ErrorBoundary>
        );
    }
    ensureWatch();
    return () => {
        const idx = slots.indexOf(slot!);
        if (idx >= 0) slots.splice(idx, 1);
        slot!.root?.unmount();
        slot!.host?.remove();
        slot!.root = null;
        slot!.host = null;
        if (!slots.length && poll) {
            window.clearInterval(poll);
            poll = 0;
        }
    };
}
