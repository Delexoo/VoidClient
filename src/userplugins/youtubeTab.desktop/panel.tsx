/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";
import { useEffect, useState } from "@webpack/common";

type Native = PluginNative<typeof import("./native")>;

let openFlag = false;
const listeners = new Set<() => void>();

function emit() {
    for (const listener of listeners) listener();
}

function ytNative() {
    return VencordNative.pluginHelpers.YouTube as Native | undefined;
}

export function isYouTubeOpen() {
    return openFlag;
}

export function useYouTubeOpen() {
    const [open, setOpen] = useState(isYouTubeOpen);
    useEffect(() => {
        const listener = () => setOpen(isYouTubeOpen());
        listeners.add(listener);
        let dead = false;
        const tick = () => {
            const native = ytNative();
            if (!native || dead) return;
            void native.getState().then(state => {
                if (dead || state.opened === openFlag) return;
                openFlag = state.opened;
                emit();
            }).catch(() => 0);
        };
        const poll = window.setInterval(tick, 5000);
        return () => {
            dead = true;
            listeners.delete(listener);
            window.clearInterval(poll);
        };
    }, []);
    return open;
}

export function closeYouTubePanel() {
    openFlag = false;
    emit();
    void ytNative()?.close();
}

export function openYouTubePanel() {
    openFlag = true;
    emit();
    void ytNative()?.open();
}

export function toggleYouTubePanel() {
    if (isYouTubeOpen()) closeYouTubePanel();
    else openYouTubePanel();
}

export function YouTubeGlyph({ height = 20, width = 20, className, active }: {
    height?: number | string;
    width?: number | string;
    className?: string;
    active?: boolean;
}) {
    return (
        <svg viewBox="0 0 24 24" height={height} width={width} className={className} aria-hidden>
            <path
                fill={active ? "#ff4d4d" : "currentColor"}
                d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8zM9.75 15.5v-7l6.5 3.5-6.5 3.5z"
            />
        </svg>
    );
}
