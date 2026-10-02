/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { classNameFactory } from "@utils/css";
import { getOpenRouterKey } from "@utils/openRouterKey";
import { PluginNative } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

import { GoogleLanguages } from "./languages";
import { DEFAULT_MODEL, settings } from "./settings";

export const cl = classNameFactory("vc-trans-");

const Native = VencordNative.pluginHelpers.Translate as PluginNative<typeof import("./native")> | undefined;

export interface TranslationValue {
    sourceLanguage: string;
    text: string;
}

export const getLanguages = () => GoogleLanguages;

function languageName(code: string) {
    const table = GoogleLanguages as Record<string, string>;
    if (code === "auto" || !code) return "the detected language";
    return table[code] || table[code.toLowerCase()] || code;
}

export function prettySourceLanguage(raw: string) {
    const s = String(raw || "").trim();
    if (!s || /^auto$/i.test(s) || /^detected$/i.test(s) || /^the detected language$/i.test(s))
        return "detected language";
    const mapped = languageName(s);
    if (mapped && mapped !== s && mapped !== "the detected language") return mapped;
    return s.replace(/\b\w/g, ch => ch.toUpperCase());
}

function resolveOpenRouterKey() {
    return getOpenRouterKey();
}

export async function translate(kind: "received" | "sent", text: string): Promise<TranslationValue> {
    try {
        return await openRouterTranslate(
            text,
            settings.store[`${kind}Input`],
            settings.store[`${kind}Output`]
        );
    } catch (e) {
        const userMessage = typeof e === "string"
            ? e
            : "Something went wrong. If this issue persists, please check the console or ask for help in the support server.";

        showToast(userMessage, Toasts.Type.FAILURE);

        throw e instanceof Error
            ? e
            : new Error(userMessage);
    }
}

function parseApiError(status: number, raw: string) {
    try {
        const err = JSON.parse(raw) as { error?: { message?: string; }; message?: string; };
        return err?.error?.message || err?.message || `OpenRouter ${status}`;
    } catch {
        return raw?.trim() || `OpenRouter ${status}`;
    }
}

const VOICE_MODEL = "google/gemini-2.5-flash";

function audioFormat(blob: Blob, src: string) {
    const type = (blob.type || "").toLowerCase();
    if (type.includes("wav")) return "wav";
    if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
    if (type.includes("webm")) return "webm";
    if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "m4a";
    if (type.includes("flac")) return "flac";
    if (/\.mp3(\?|$)/i.test(src)) return "mp3";
    if (/\.wav(\?|$)/i.test(src)) return "wav";
    if (/\.webm(\?|$)/i.test(src)) return "webm";
    return "ogg";
}

function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step)
        binary += String.fromCharCode(...bytes.subarray(i, i + step));
    return btoa(binary);
}

async function callOpenRouterAudio(apiKey: string, model: string, prompt: string, audioBase64: string, format: string) {
    if (!IS_WEB && Native?.makeOpenRouterAudioRequest) {
        const res = await Native.makeOpenRouterAudioRequest(apiKey, model, prompt, audioBase64, format);
        if (res.status === -1) throw "Can't reach OpenRouter: " + res.data;
        if (res.status < 200 || res.status >= 300) throw parseApiError(res.status, res.data).slice(0, 180);
        return contentFromResponse(res.data);
    }

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/Delexoo/VoidClient",
            "X-OpenRouter-Title": "Translate"
        },
        body: JSON.stringify({
            model,
            temperature: 0.1,
            max_tokens: 2048,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "input_audio", input_audio: { data: audioBase64, format } }
                    ]
                }
            ]
        })
    });
    const body = await res.text();
    if (!res.ok) throw parseApiError(res.status, body).slice(0, 180);
    return contentFromResponse(body);
}

export async function translateVoice(src: string): Promise<TranslationValue> {
    const apiKey = resolveOpenRouterKey();
    if (!apiKey) throw "Paste an OpenRouter key at the top of the Plugins page.";

    const audio = await fetch(src);
    if (!audio.ok) throw "Couldn't load that voice message.";
    const blob = await audio.blob();
    if (!blob.size) throw "That voice message was empty.";
    if (blob.size > 12_000_000) throw "That voice message is too long to translate.";

    const format = audioFormat(blob, src);
    const audioBase64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    const targetCode = settings.store.receivedOutput || "en";
    const targetName = languageName(targetCode === "auto" ? "en" : targetCode);
    const prompt = [
        "Listen to this Discord voice message.",
        `Transcribe the speech, then translate it into ${targetName}.`,
        `If the speech is already ${targetName}, return the transcript.`,
        "Do the best you can with accents, noise, and unclear words.",
        "Return ONLY JSON: {\"from\":\"<source language name>\",\"text\":\"<translation>\"}."
    ].join(" ");

    let raw: string;
    try {
        raw = await callOpenRouterAudio(apiKey, VOICE_MODEL, prompt, audioBase64, format);
    } catch (first) {
        const message = String(first);
        if (!/audio|modality|unsupported|invalid/i.test(message)) throw first;
        raw = await callOpenRouterAudio(apiKey, DEFAULT_MODEL, prompt, audioBase64, format);
    }

    const translated = parseModelOutput(raw, "voice");
    if (!translated.text) throw "OpenRouter returned an empty translation.";
    translated.sourceLanguage = prettySourceLanguage(translated.sourceLanguage);
    return translated;
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

function parseModelOutput(raw: string, fallbackSource: string): TranslationValue {
    let out = String(raw || "").trim();
    if (out.startsWith("```") && out.endsWith("```"))
        out = out.replace(/^```(?:json|JSON)?\n?/, "").replace(/\n?```$/, "").trim();

    try {
        const parsed = JSON.parse(out) as { from?: string; text?: string; };
        if (typeof parsed?.text === "string" && parsed.text.trim()) {
            return {
                sourceLanguage: prettySourceLanguage(String(parsed.from || fallbackSource)),
                text: parsed.text.trim()
            };
        }
    } catch { /* plain text */ }

    if (
        (out.startsWith('"') && out.endsWith('"'))
        || (out.startsWith("'") && out.endsWith("'"))
        || (out.startsWith("“") && out.endsWith("”"))
    ) out = out.slice(1, -1).trim();

    return {
        sourceLanguage: fallbackSource,
        text: out
    };
}

function sameMessage(a: string, b: string) {
    return String(a || "").replace(/\s+/g, " ").trim().toLowerCase()
        === String(b || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function looksLikeTarget(sourceName: string, targetName: string) {
    const a = sourceName.trim().toLowerCase();
    const b = targetName.trim().toLowerCase();
    if (!a || a === "detected language" || a === "auto") return false;
    if (a === b) return true;
    if ((a === "tagalog" || a === "filipino") && (b === "tagalog" || b === "filipino")) return true;
    return false;
}

async function callOpenRouter(apiKey: string, model: string, system: string, text: string) {
    if (!IS_WEB && Native?.makeOpenRouterTranslateRequest) {
        const res = await Native.makeOpenRouterTranslateRequest(apiKey, model, system, text);
        if (res.status === -1) throw "Can't reach OpenRouter: " + res.data;
        if (res.status < 200 || res.status >= 300) throw parseApiError(res.status, res.data).slice(0, 180);
        return contentFromResponse(res.data);
    }

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/Delexoo/VoidClient",
            "X-OpenRouter-Title": "Translate"
        },
        body: JSON.stringify({
            model,
            temperature: 0.1,
            max_tokens: 4096,
            messages: [
                { role: "system", content: system },
                { role: "user", content: text }
            ]
        })
    });
    const body = await res.text();
    if (!res.ok) throw parseApiError(res.status, body).slice(0, 180);
    return contentFromResponse(body);
}

async function openRouterTranslate(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    const apiKey = resolveOpenRouterKey();
    if (!apiKey)
        throw "Paste an OpenRouter key at the top of the Plugins page.";

    const model = String(settings.store.openrouterModel || "").trim() || DEFAULT_MODEL;
    const targetName = languageName(targetLang === "auto" ? "en" : targetLang);
    const sourceName = languageName(sourceLang);
    const system = [
        `You are a professional translator for Discord chat.`,
        `Translate the user's message into ${targetName}.`,
        sourceLang && sourceLang !== "auto" ? `The source language is ${sourceName}.` : "Detect the source language.",
        `The "text" field MUST be ${targetName}, never a copy of the original unless the original is already ${targetName}.`,
        "Translate slang, abbreviations, swearing, and informal chat into natural wording in the target language.",
        "Preserve Discord markdown, mentions, custom emojis, timestamps, URLs, and code exactly.",
        "Keep tone and line breaks.",
        'Return ONLY JSON: {"from":"<English name of the source language, for example Tagalog>","text":"<the translation in the target language>"}'
    ].join(" ");

    let raw = await callOpenRouter(apiKey, model, system, text);
    let translated = parseModelOutput(raw, sourceLang === "auto" ? "detected language" : sourceName);
    if (!translated.text) throw "OpenRouter returned an empty translation.";

    if (sameMessage(translated.text, text) && !looksLikeTarget(translated.sourceLanguage, targetName)) {
        raw = await callOpenRouter(
            apiKey,
            model,
            [
                `The last reply copied the original. Translate it into ${targetName} now.`,
                "Do not repeat the source sentence.",
                "Slang and abbreviations must become clear natural wording.",
                'Return ONLY JSON: {"from":"<source language name>","text":"<translation>"}'
            ].join(" "),
            text
        );
        const retry = parseModelOutput(raw, translated.sourceLanguage);
        if (retry.text && !sameMessage(retry.text, text)) translated = retry;
        else if (retry.text) translated = retry;
    }

    translated.sourceLanguage = prettySourceLanguage(translated.sourceLanguage);
    return translated;
}
