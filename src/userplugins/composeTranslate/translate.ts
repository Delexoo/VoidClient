/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { translationModel } from "@plugins/translate/settings";
import { chatContextBlock } from "@utils/chatContext";
import { getOpenRouterKey } from "@utils/openRouterKey";
import { PluginNative } from "@utils/types";
import { ComponentDispatch, DraftStore, DraftType } from "@webpack/common";

import { languageName } from "./languages";
import { settings } from "./settings";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function nativeApi() {
    if (IS_WEB) return undefined;
    return VencordNative.pluginHelpers.ComposeTranslate as PluginNative<typeof import("./native")> | undefined;
}

function systemPrompt(targetLang: string) {
    const name = languageName(targetLang);
    return [
        `You are a professional translator. Translate the user's Discord message into ${name}. Accuracy matters more than speed.`,
        "Nearby messages are context only. Translate only the draft after \"Translate only this message\".",
        "Return only the translated message. No quotes, labels, romanization, or commentary.",
        "Preserve Discord markdown, mentions (<@id>, <#id>, <@&id>), custom emojis (<:name:id> and <a:name:id>), timestamps (<t:...>), and URLs exactly.",
        "Keep code blocks and inline code unchanged.",
        "Keep the original tone, punctuation, and line breaks.",
        `If the message is already in ${name}, return it unchanged.`
    ].join(" ");
}

function cleanTranslation(text: string) {
    let out = String(text || "").trim();
    if (out.startsWith("```") && out.endsWith("```"))
        out = out.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim();
    if (
        (out.startsWith('"') && out.endsWith('"'))
        || (out.startsWith("'") && out.endsWith("'"))
        || (out.startsWith("“") && out.endsWith("”"))
    ) out = out.slice(1, -1).trim();
    return out;
}

function parseApiError(status: number, raw: string) {
    try {
        const err = JSON.parse(raw) as { error?: { message?: string; }; message?: string; };
        return err?.error?.message || err?.message || `OpenRouter ${status}`;
    } catch {
        return raw?.trim() || `OpenRouter ${status}`;
    }
}

function contentFromResponse(raw: string) {
    const data = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string; }>; }; }>;
        error?: { message?: string; };
    };
    if (data?.error?.message) throw new Error(data.error.message);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content))
        return content.map(part => part?.text || "").join("");
    return "";
}

function resolveKey() {
    return getOpenRouterKey();
}

async function chatComplete(system: string, user: string) {
    const apiKey = resolveKey();
    if (!apiKey) throw new Error("Paste an OpenRouter key at the top of the Plugins page.");

    const model = translationModel(settings.store.model, value => {
        settings.store.model = value;
    });
    const Native = nativeApi();
    if (Native?.chatComplete) {
        const res = await Native.chatComplete(apiKey, model, system, user);
        if (!res?.ok) throw new Error(String(res?.data || "OpenRouter failed").slice(0, 180));
        return res.data;
    }

    const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/Delexoo/VoidClient",
            "X-OpenRouter-Title": "Compose Translate"
        },
        body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 4096,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user }
            ]
        })
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(parseApiError(res.status, raw).slice(0, 180));
    const text = contentFromResponse(raw).trim();
    if (!text) throw new Error("OpenRouter returned an empty translation.");
    return text;
}

export function getComposerText(channelId: string) {
    try {
        const draft = DraftStore.getDraft(channelId, DraftType.ChannelMessage);
        if (typeof draft === "string" && draft.trim()) return draft;
    } catch { /* ignore */ }

    const box = document.querySelector('div[role="textbox"]') as HTMLElement | null;
    return box?.innerText ?? box?.textContent ?? "";
}

export function setComposerText(text: string) {
    const box = document.querySelector('div[role="textbox"]') as HTMLElement | null;
    box?.focus();
    ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT");
    if (!text) return;
    window.setTimeout(() => {
        ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
            rawText: text,
            plainText: text
        });
    }, 25);
}

export async function translateComposer(channelId: string) {
    const source = getComposerText(channelId).trim();
    if (!source) throw new Error("Type a message first.");

    const targetLang = String(settings.store.targetLang || "tl").trim() || "tl";
    const context = chatContextBlock(channelId);
    const asked = context ? `${context}\n\nTranslate only this message:\n${source}` : source;
    const raw = await chatComplete(systemPrompt(targetLang), asked);
    const translated = cleanTranslation(raw);
    if (!translated) throw new Error("OpenRouter returned an empty translation.");
    setComposerText(translated);
    return translated;
}

export async function translateIfNotEnglish(text: string, _targetLang: string) {
    const raw = await chatComplete(
        [
            "You detect language and translate Discord messages into English.",
            "If the message is fully English (names, slang, emojis, markdown, mentions, and English loanwords still count as English), return {\"skip\":true}.",
            "If it is not English, translate it into natural English. Slang and abbreviations must become clear English — never copy the original.",
            "Preserve Discord markdown, mentions, custom emojis, timestamps, URLs, and code exactly.",
            "Return ONLY JSON: {\"skip\":false,\"text\":\"<English translation>\"}."
        ].join(" "),
        text
    );
    let out = String(raw || "").trim();
    if (out.startsWith("```"))
        out = out.replace(/^```(?:json|JSON)?\n?/, "").replace(/\n?```$/, "").trim();
    try {
        const parsed = JSON.parse(out) as { skip?: boolean; text?: string; };
        if (parsed?.skip) return null;
        const translated = cleanTranslation(String(parsed?.text || ""));
        return translated || null;
    } catch {
        return null;
    }
}
