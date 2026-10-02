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
import { resolveLang, startTranslateFromHere } from "./translate";
import { TranslationOverlay, mountBar, unmountBar } from "./ui";

const TranslateFromHereIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        viewBox="0 96 960 960"
        height={height}
        width={width}
        className={className}
        fill="currentColor"
    >
        <path d="m475 976 181-480h82l186 480h-87l-41-126H604l-47 126h-82Zm151-196h142l-70-194h-2l-70 194Zm-466 76-55-55 204-204q-38-44-67.5-88.5T190 416h87q17 33 37.5 62.5T361 539q45-47 75-97.5T487 336H40v-80h280v-80h80v80h280v80H567q-22 69-58.5 135.5T419 598l98 99-30 81-127-122-200 200Z" />
    </svg>
);

function openFromMessage(message: Message) {
    try {
        if (!message?.id || !message.channel_id) return;
        void startTranslateFromHere(message.channel_id, message.id, resolveLang());
    } catch (e) {
        showToast(String(e).replace(/^Error:\s*/, "") || "Couldn't start translating.", Toasts.Type.FAILURE);
    }
}

const messageCtxPatch: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    if (!message?.id || !message.channel_id) return;

    const group = findGroupChildrenByChildId("copy-text", children);
    if (!group) return;

    const idx = group.findIndex(c => c?.props?.id === "copy-text");
    group.splice(idx < 0 ? group.length : idx + 1, 0, (
        <Menu.MenuItem
            id="vc-tfh"
            label="Translate from here"
            icon={TranslateFromHereIcon}
            leadingAccessory={{ type: "icon", icon: TranslateFromHereIcon }}
            action={() => openFromMessage(message)}
        />
    ));
};

export default definePlugin({
    name: "TranslateFromHere",
    description: "Translate every message from a chosen point down to now. Only you can see it, and you can dismiss it.",
    tags: ["Chat", "Utility", "API Required"],
    searchTerms: ["translate", "from here", "openrouter", "delexo"],
    authors: [Delexo],
    enabledByDefault: true,
    settings,
    managedStyle,
    start: mountBar,
    stop: unmountBar,
    contextMenus: {
        message: messageCtxPatch
    },
    renderMessageAccessory: props => <TranslationOverlay message={props.message} />,
    messagePopoverButton: {
        icon: TranslateFromHereIcon,
        render(message) {
            if (!message?.id || !message.channel_id) return null;

            const channel = ChannelStore.getChannel(message.channel_id);
            if (!channel) return null;

            return {
                label: "Translate from here",
                icon: TranslateFromHereIcon,
                message,
                channel,
                onClick(event: MouseEvent<HTMLButtonElement>) {
                    event.preventDefault();
                    event.stopPropagation();
                    openFromMessage(message);
                }
            };
        }
    }
});
