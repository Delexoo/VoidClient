/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TranslateIcon } from "@plugins/translate/TranslateIcon";
import { handleTranslate, translationEpoch } from "@plugins/translate/TranslationAccessory";
import { findMessageMedia, getMessageContent, translate, translateMedia, TranslationValue } from "@plugins/translate/utils";
import { Message } from "@vencord/discord-types";
import { showToast, Toasts, useEffect, useRef } from "@webpack/common";

const busy = new Set<string>();
const cache = new Map<string, TranslationValue>();

function messagePlace(host: HTMLElement) {
    const row = host.closest("[id^='chat-messages-']");
    const rowMatch = row?.id.match(/^chat-messages-(\d+)-(\d+)$/);
    if (rowMatch) return { channelId: rowMatch[1], messageId: rowMatch[2] };

    const accessories = host.closest("[id^='message-accessories-']");
    const accessoryId = accessories?.id.slice("message-accessories-".length) || "";
    return { channelId: undefined, messageId: /^\d+$/.test(accessoryId) ? accessoryId : "" };
}

async function runMediaTranslation(
    messageId: string,
    src: string,
    kind: "audio" | "video",
    fallbackUrl?: string,
    alsoText?: string,
    channelId?: string
) {
    const saved = cache.get(messageId);
    if (saved) {
        handleTranslate(messageId, saved);
        return;
    }
    if (busy.has(messageId)) return;

    busy.add(messageId);
    const stamp = translationEpoch(messageId);
    handleTranslate(messageId, { sourceLanguage: kind, text: "Listening…" });
    try {
        const spoken = await translateMedia(src, kind, fallbackUrl, { channelId, messageId });
        if (translationEpoch(messageId) !== stamp) return;
        let { text } = spoken;
        let { sourceLanguage } = spoken;
        if (alsoText) {
            try {
                const written = await translate("received", alsoText, { channelId, messageId });
                if (written.text && written.text !== text)
                    text = text ? `${text}\n\n${written.text}` : written.text;
                if (!sourceLanguage) sourceLanguage = written.sourceLanguage;
            } catch { /* the text translator already reports its own error */ }
        }
        const translated = { sourceLanguage, text };
        cache.set(messageId, translated);
        handleTranslate(messageId, translated);
    } catch (e) {
        handleTranslate(messageId, undefined);
        const message = typeof e === "string" ? e : "Couldn't translate that clip.";
        showToast(message.replace(/^Error:\s*/, ""), Toasts.Type.FAILURE);
    } finally {
        busy.delete(messageId);
    }
}

export async function translateMessage(message: Message) {
    const media = findMessageMedia(message);
    const content = getMessageContent(message);
    if (media) {
        await runMediaTranslation(message.id, media.url, media.kind, media.fallbackUrl, content, message.channel_id);
        return;
    }
    if (!content) return;
    const saved = cache.get(message.id);
    if (saved) {
        handleTranslate(message.id, saved);
        return;
    }
    if (busy.has(message.id)) return;

    busy.add(message.id);
    const stamp = translationEpoch(message.id);
    handleTranslate(message.id, { sourceLanguage: "", text: "Translating…" });
    try {
        const trans = await translate("received", content, { channelId: message.channel_id, messageId: message.id });
        if (translationEpoch(message.id) !== stamp) return;
        cache.set(message.id, trans);
        handleTranslate(message.id, trans);
    } catch {
        if (translationEpoch(message.id) === stamp) handleTranslate(message.id, undefined);
    } finally {
        busy.delete(message.id);
    }
}

export async function onVoiceHover(src: string, host: HTMLElement) {
    const place = messagePlace(host);
    if (!place.messageId) return;
    await runMediaTranslation(place.messageId, src, "audio", undefined, undefined, place.channelId);
}

function VoiceHoverAnchor({ src }: { src?: string; }) {
    const ref = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const host = ref.current?.parentElement;
        if (!src || !host) return;

        const onEnter = () => void onVoiceHover(src, host);
        host.addEventListener("mouseenter", onEnter);
        return () => host.removeEventListener("mouseenter", onEnter);
    }, [src]);

    return (
        <button
            ref={ref}
            type="button"
            className="vc-trans-voice"
            aria-label="Translate voice message"
            title="Translate"
            onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                if (src) void onVoiceHover(src, e.currentTarget);
            }}
        >
            <TranslateIcon height={20} width={20} />
        </button>
    );
}

export function renderVoiceHover(props?: { src?: string; }) {
    if (!props?.src) return null;
    return <VoiceHoverAnchor src={props.src} />;
}
