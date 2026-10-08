/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { translationModel } from "@plugins/translate/settings";
import { chatContextBlock } from "@utils/chatContext";
import { getOpenRouterKey } from "@utils/openRouterKey";
import { PluginNative } from "@utils/types";

import { settings } from "./settings";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function nativeApi() {
    if (IS_WEB) return undefined;
    return VencordNative.pluginHelpers.AutoTranslate as PluginNative<typeof import("./native")> | undefined;
}

function resolveKey() {
    return getOpenRouterKey();
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
            "X-OpenRouter-Title": "Auto-Translate"
        },
        body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 1024,
            reasoning: { effort: "none" },
            messages: [
                { role: "system", content: system },
                { role: "user", content: user }
            ]
        })
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(raw.slice(0, 180) || "OpenRouter failed");
    const text = contentFromResponse(raw).trim();
    if (!text) throw new Error("OpenRouter returned an empty translation.");
    return text;
}

function clean(text: string) {
    let out = String(text || "").trim();
    if (out.startsWith("```") && out.endsWith("```"))
        out = out.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim();
    if (
        (out.startsWith("\"") && out.endsWith("\""))
        || (out.startsWith("'") && out.endsWith("'"))
    ) out = out.slice(1, -1).trim();
    return out;
}

export async function translateIfNotEnglish(text: string, channelId?: string, messageId?: string) {
    const context = chatContextBlock(channelId, messageId);
    const raw = await chatComplete(
        [
            "You detect language and translate Discord messages into English. Accuracy matters more than speed.",
            "Nearby messages are context only. Decide and translate only the message after \"Translate only this message\".",
            "If the message is fully English (names, slang, emojis, markdown, mentions, and English loanwords still count as English), return {\"skip\":true}.",
            "If it is not English, translate it into natural English. Slang and abbreviations must become clear English.",
            "Preserve Discord markdown, mentions, custom emojis, timestamps, URLs, and code exactly.",
            "Return ONLY JSON: {\"skip\":false,\"text\":\"<English translation>\"}."
        ].join(" "),
        context ? `${context}\n\nTranslate only this message:\n${text}` : text
    );
    let out = String(raw || "").trim();
    if (out.startsWith("```"))
        out = out.replace(/^```(?:json|JSON)?\n?/, "").replace(/\n?```$/, "").trim();
    try {
        const parsed = JSON.parse(out) as { skip?: boolean; text?: string; };
        if (parsed?.skip) return null;
        const translated = clean(String(parsed?.text || ""));
        return translated || null;
    } catch {
        return null;
    }
}
