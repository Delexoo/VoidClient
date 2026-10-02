/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openPrivateChannel, openUserProfile } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import { ChannelRouter, MessageActions, showToast, Toasts } from "@webpack/common";

const VoiceSelect = findByPropsLazy("selectVoiceChannel", "selectChannel") as {
    selectVoiceChannel(id: string | null): void;
};

export function jumpToMessage(channelId?: string, messageId?: string) {
    if (!channelId || !messageId) return;
    try {
        ChannelRouter.transitionToChannel(channelId);
    } catch { /* still try jump */ }
    const go = () => {
        try {
            MessageActions.jumpToMessage({
                channelId,
                messageId,
                flash: true,
                jumpType: "ANIMATED"
            });
        } catch {
            showToast("Couldn't jump to that message.", Toasts.Type.FAILURE);
        }
    };
    window.setTimeout(go, 350);
}

export function openChannel(channelId?: string) {
    if (!channelId) return;
    try {
        ChannelRouter.transitionToChannel(channelId);
    } catch {
        showToast("Couldn't open that channel.", Toasts.Type.FAILURE);
    }
}

export function joinVoice(channelId?: string) {
    if (!channelId) return;
    try {
        VoiceSelect.selectVoiceChannel(channelId);
    } catch {
        showToast("Couldn't join that voice channel.", Toasts.Type.FAILURE);
    }
}

export function openProfile(userId?: string) {
    if (!userId) return;
    void openUserProfile(userId).catch(() => {
        showToast("Couldn't open that profile.", Toasts.Type.FAILURE);
    });
}

export function openDm(userId?: string) {
    if (!userId) return;
    try {
        openPrivateChannel(userId);
    } catch {
        showToast("Couldn't open that DM.", Toasts.Type.FAILURE);
    }
}
