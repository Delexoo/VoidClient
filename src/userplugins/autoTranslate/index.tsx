/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { classNameFactory } from "@utils/css";
import definePlugin, { IconComponent } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { Parser, useEffect, useState } from "@webpack/common";

import { Delexo } from "../_delexo/author";
import { arm, disarm, enqueueIncoming, getArmedChannel, registerTranslation, translationFor, useArmedChannel } from "./session";
import { settings } from "./settings";
import managedStyle from "./style.css?managed";

const cl = classNameFactory("vc-at-");

const AutoTranslateIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg viewBox="0 0 24 24" height={height} width={width} className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 5h7M7.5 5v1.5c0 3.2 2.2 5.8 5.5 6.5M4 19l5-8M14 19l2.2-4.4M20 19l-2.2-4.4M14.2 14.6h3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const AutoTranslateButton: ChatBarButtonFactory = ({ isAnyChat, channel }) => {
    const armed = useArmedChannel();
    if (!isAnyChat || !channel?.id) return null;

    const on = armed === channel.id;

    return (
        <ChatBarButton
            tooltip={on
                ? "Auto-translate on · new messages in this channel only"
                : "Auto-translate off · turn on for this channel"}
            onClick={() => {
                if (on) disarm();
                else arm(channel.id);
            }}
            buttonProps={{
                role: "switch",
                "aria-checked": on
            }}
        >
            <span className={cl("switch", { on })}>
                <span className={cl("knob")} />
            </span>
        </ChatBarButton>
    );
};

function AutoTranslation({ message }: { message: Message; }) {
    const [text, setText] = useState(() => translationFor(message.id));

    useEffect(() => registerTranslation(message.id, setText), [message.id]);

    if (!text) return null;

    return (
        <div className={cl("card")}>
            <div>{Parser.parse(text)}</div>
            <div className={cl("note")}>Auto-translate · only you</div>
        </div>
    );
}

export default definePlugin({
    name: "AutoTranslate",
    description: "Translate new messages in the channel you are viewing. Turn it on there. It turns off when you open a different channel, and it leaves messages already on screen alone.",
    tags: ["Chat", "Utility", "API Required"],
    searchTerms: ["translate", "auto", "openrouter", "incoming", "delexo"],
    authors: [Delexo],
    enabledByDefault: true,
    settings,
    managedStyle,
    stop: disarm,
    chatBarButton: {
        icon: AutoTranslateIcon,
        render: AutoTranslateButton
    },
    renderMessageAccessory: props => <AutoTranslation message={props.message} />,
    flux: {
        CHANNEL_SELECT({ channelId }: { channelId?: string; }) {
            if (!channelId || channelId !== getArmedChannel()) disarm();
        },
        MESSAGE_CREATE({ message, optimistic }: { message: Message; optimistic?: boolean; }) {
            enqueueIncoming(message, optimistic);
        }
    }
});
