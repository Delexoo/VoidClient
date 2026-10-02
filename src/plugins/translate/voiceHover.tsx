/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast, Toasts, useEffect, useRef } from "@webpack/common";

import { handleTranslate, translationEpoch } from "./TranslationAccessory";
import { TranslationValue, translateVoice } from "./utils";

const busy = new Set<string>();
const cache = new Map<string, TranslationValue>();

function messageIdFrom(host: HTMLElement) {
    const row = host.closest("[id^='chat-messages-']");
    const rowId = row?.id.match(/^chat-messages-\d+-(\d+)$/)?.[1];
    if (rowId) return rowId;

    const accessories = host.closest("[id^='message-accessories-']");
    const accessoryId = accessories?.id.slice("message-accessories-".length) || "";
    return /^\d+$/.test(accessoryId) ? accessoryId : "";
}

export async function onVoiceHover(src: string, host: HTMLElement) {
    const messageId = messageIdFrom(host);
    if (!messageId) return;

    const saved = cache.get(messageId);
    if (saved) {
        handleTranslate(messageId, saved);
        return;
    }
    if (busy.has(messageId)) return;

    busy.add(messageId);
    const stamp = translationEpoch(messageId);
    handleTranslate(messageId, { sourceLanguage: "voice", text: "Listening…" });
    try {
        const translated = await translateVoice(src);
        if (translationEpoch(messageId) !== stamp) return;
        cache.set(messageId, translated);
        handleTranslate(messageId, translated);
    } catch (e) {
        handleTranslate(messageId, undefined);
        const message = typeof e === "string" ? e : "Couldn't translate that voice message.";
        showToast(message.replace(/^Error:\s*/, ""), Toasts.Type.FAILURE);
    } finally {
        busy.delete(messageId);
    }
}

function VoiceHoverAnchor({ src }: { src?: string; }) {
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const host = ref.current?.parentElement;
        if (!src || !host) return;

        const onEnter = () => void onVoiceHover(src, host);
        host.addEventListener("mouseenter", onEnter);
        return () => host.removeEventListener("mouseenter", onEnter);
    }, [src]);

    return <span ref={ref} style={{ display: "none" }} />;
}

export function renderVoiceHover(props?: { src?: string; }) {
    if (!props?.src) return null;
    return <VoiceHoverAnchor src={props.src} />;
}
