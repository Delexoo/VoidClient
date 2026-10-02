/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { IconComponent } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, Menu, showToast, Toasts } from "@webpack/common";
import type { MouseEvent } from "react";

import { Delexo } from "../_delexo/author";
import { settings } from "./settings";
import managedStyle from "./style.css?managed";
import { closeSummaryWindow, openSummaryWindow } from "./window";

const SummaryIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        viewBox="0 0 24 24"
        height={height}
        width={width}
        className={className}
        fill="currentColor"
    >
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v1H5.5A1.5 1.5 0 0 1 4 5.5Z" opacity=".45" />
        <path d="M7 8.5A1.5 1.5 0 0 1 8.5 7h10A1.5 1.5 0 0 1 20 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 7 18.5v-10Zm2.25 2.25a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5h-7.5Zm0 3.5a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5h-7.5Zm0 3.5a.75.75 0 0 0 0 1.5H14a.75.75 0 0 0 0-1.5H9.25Z" />
    </svg>
);

function authorName(message: Message) {
    const user: any = message.author;
    return String(user?.globalName || user?.global_name || user?.username || "this message").trim() || "this message";
}

function openFromMessage(message: Message, anchor?: DOMRect | null) {
    try {
        if (!message?.id || !message.channel_id) return;
        openSummaryWindow({
            channelId: message.channel_id,
            startId: message.id,
            fromName: authorName(message),
            anchor
        });
    } catch (e) {
        showToast(String(e).replace(/^Error:\s*/, "") || "Couldn't start a summary.", Toasts.Type.FAILURE);
    }
}

const messageCtxPatch: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    if (!message?.id || !message.channel_id) return;

    const group = findGroupChildrenByChildId("copy-text", children);
    if (!group) return;

    const idx = group.findIndex(c => c?.props?.id === "copy-text");
    group.splice(idx < 0 ? group.length : idx + 1, 0, (
        <Menu.MenuItem
            id="vc-qsum"
            label="Summarize from here"
            icon={SummaryIcon}
            leadingAccessory={{ type: "icon", icon: SummaryIcon }}
            action={() => openFromMessage(message)}
        />
    ));
};

export default definePlugin({
    name: "QuickSummary",
    description: "Hover a message and summarize from that point down to now, using OpenRouter.",
    tags: ["Chat", "Utility", "API Required"],
    searchTerms: ["summary", "summarize", "tldr", "openrouter", "delexo"],
    authors: [Delexo],
    enabledByDefault: true,
    settings,
    managedStyle,
    stop: closeSummaryWindow,
    contextMenus: {
        message: messageCtxPatch
    },
    messagePopoverButton: {
        icon: SummaryIcon,
        render(message) {
            if (!message?.id || !message.channel_id) return null;

            const channel = ChannelStore.getChannel(message.channel_id);
            if (!channel) return null;

            return {
                label: "Summarize from here",
                icon: SummaryIcon,
                message,
                channel,
                onClick(event: MouseEvent<HTMLButtonElement>) {
                    event.preventDefault();
                    event.stopPropagation();
                    openFromMessage(message, event.currentTarget?.getBoundingClientRect?.() ?? null);
                }
            };
        }
    }
});
