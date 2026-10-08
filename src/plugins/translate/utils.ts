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

import { GoogleLanguages } from "@plugins/translate/languages";
import { settings, translationModel } from "@plugins/translate/settings";
import { chatContextBlock } from "@utils/chatContext";
import { classNameFactory } from "@utils/css";
import { getOpenRouterKey } from "@utils/openRouterKey";
import { PluginNative } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { showToast, Toasts } from "@webpack/common";

export const cl = classNameFactory("vc-trans-");

const Native = VencordNative.pluginHelpers.Translate as PluginNative<typeof import("./native")> | undefined;

export interface TranslationValue {
    sourceLanguage: string;
    text: string;
}

type MediaAttachment = {
    url?: string;
    proxy_url?: string;
    content_type?: string;
    filename?: string;
    width?: number;
    height?: number;
    waveform?: string;
};

export function getMessageContent(message: Message) {
    return message.content
        || message.messageSnapshots?.[0]?.message.content
        || message.embeds?.find(embed => embed.type === "auto_moderation_message")?.rawDescription || "";
}

function attachmentKind(att: MediaAttachment): "audio" | "video" | null {
    const type = (att.content_type || "").toLowerCase();
    const name = (att.filename || "").toLowerCase();
    if (att.waveform || type.startsWith("audio/") || /\.(ogg|opus|mp3|wav|m4a|aac|flac)$/.test(name))
        return "audio";
    if (type.startsWith("video/") || /\.(mp4|mov|mkv|m4v|webm)$/.test(name)) {
        if (name.endsWith(".webm") && !type.startsWith("video/") && !att.width && !att.height)
            return "audio";
        return "video";
    }
    return null;
}

function attachmentList(value: unknown): MediaAttachment[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        return [...(value as Iterable<MediaAttachment>)];
    } catch {
        return [];
    }
}

export function findMessageMedia(message: Message) {
    const lists = [
        attachmentList(message.attachments),
        attachmentList(message.messageSnapshots?.[0]?.message.attachments)
    ];
    const found: { kind: "audio" | "video"; url: string; fallbackUrl?: string; }[] = [];
    for (const list of lists) {
        for (const att of list) {
            const kind = attachmentKind(att);
            const url = att.url || att.proxy_url || "";
            const fallbackUrl = att.proxy_url && att.proxy_url !== url ? att.proxy_url : undefined;
            if (kind && url) found.push({ kind, url, fallbackUrl });
        }
    }
    return found.find(item => item.kind === "video") || found.find(item => item.kind === "audio") || null;
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

function accurateModel() {
    return translationModel(settings.store.openrouterModel, value => {
        settings.store.openrouterModel = value;
    });
}

function withChatContext(body: string, channelId?: string, messageId?: string) {
    const context = chatContextBlock(channelId, messageId);
    if (!context) return body;
    return `${context}\n\nTranslate only this message:\n${body}`;
}

export async function translate(
    kind: "received" | "sent",
    text: string,
    where?: { channelId?: string; messageId?: string; }
): Promise<TranslationValue> {
    try {
        return await openRouterTranslate(
            text,
            settings.store[`${kind}Input`],
            settings.store[`${kind}Output`],
            where
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

const MEDIA_MODEL = "google/gemini-2.5-pro";
const LAST_RESORT_MODEL = "google/gemini-2.5-flash";
const AUDIO_BYTE_LIMIT = 15_000_000;
const VIDEO_BYTE_LIMIT = 20_000_000;

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

function encodeWav(pcm: Float32Array, sampleRate: number) {
    const samples = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
        const s = Math.max(-1, Math.min(1, pcm[i]));
        samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const write = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    write(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let idx = 44;
    for (let i = 0; i < samples.length; i++, idx += 2)
        view.setInt16(idx, samples[i], true);
    return new Uint8Array(buffer);
}

function mixTo16k(buffer: AudioBuffer) {
    const { length } = buffer;
    const channels = buffer.numberOfChannels;
    const mono = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }
    const target = 16000;
    if (buffer.sampleRate === target) return mono;
    const outLen = Math.max(1, Math.floor(mono.length * target / buffer.sampleRate));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
        const src = i * buffer.sampleRate / target;
        const i0 = Math.floor(src);
        const i1 = Math.min(mono.length - 1, i0 + 1);
        const t = src - i0;
        out[i] = mono[i0] * (1 - t) + mono[i1] * t;
    }
    return out;
}

async function audioToWav(blob: Blob) {
    const ctx = new AudioContext();
    try {
        const copy = (await blob.arrayBuffer()).slice(0);
        const decoded = await ctx.decodeAudioData(copy);
        return encodeWav(mixTo16k(decoded), 16000);
    } finally {
        void ctx.close();
    }
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
            temperature: 0,
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

async function loadBlob(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw "Couldn't load that file.";
    const blob = await res.blob();
    if (!blob.size) throw "That file was empty.";
    return blob;
}

async function hear(call: (model: string) => Promise<string>) {
    try {
        return await call(MEDIA_MODEL);
    } catch (first) {
        const message = String(first);
        if (!/audio|video|modality|unsupported|invalid|format|file/i.test(message)) throw first;
        return await call(LAST_RESORT_MODEL);
    }
}

function mediaPrompt(kind: "audio" | "video", targetName: string) {
    return [
        kind === "video"
            ? "Watch this video and listen to the speech. Accuracy matters more than speed."
            : "Listen to this audio clip. Accuracy matters more than speed.",
        `Transcribe the spoken words, then translate them into ${targetName}.`,
        `If the speech is already ${targetName}, return that transcript.`,
        "Ignore music and noise. Do not invent words.",
        kind === "video" ? "If nobody speaks, translate readable on-screen text instead." : "",
        "Return ONLY JSON: {\"from\":\"<source language name>\",\"text\":\"<translation>\"}."
    ].filter(Boolean).join(" ");
}

async function callOpenRouterVideo(apiKey: string, model: string, prompt: string, mime: string, videoBase64: string) {
    if (!IS_WEB && Native?.makeOpenRouterVideoRequest) {
        const res = await Native.makeOpenRouterVideoRequest(apiKey, model, prompt, mime, videoBase64);
        if (res.status === -1) throw "Can't reach OpenRouter: " + res.data;
        if (res.status < 200 || res.status >= 300) throw parseApiError(res.status, res.data).slice(0, 180);
        return contentFromResponse(res.data);
    }

    const type = mime || "video/mp4";
    const dataUrl = `data:${type};base64,${videoBase64}`;
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
            temperature: 0,
            max_tokens: 2048,
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    { type: "video_url", video_url: { url: dataUrl } }
                ]
            }]
        })
    });
    const body = await res.text();
    if (!res.ok) throw parseApiError(res.status, body).slice(0, 180);
    return contentFromResponse(body);
}

export async function translateVoice(src: string): Promise<TranslationValue> {
    return translateMedia(src, "audio");
}

export async function translateMedia(
    src: string,
    kind: "audio" | "video",
    fallbackUrl?: string,
    where?: { channelId?: string; messageId?: string; }
): Promise<TranslationValue> {
    const apiKey = resolveOpenRouterKey();
    if (!apiKey) throw "Paste an OpenRouter key at the top of the Plugins page.";

    let blob: Blob;
    try {
        blob = await loadBlob(src);
    } catch (e) {
        if (!fallbackUrl || fallbackUrl === src) throw e;
        blob = await loadBlob(fallbackUrl);
    }

    const limit = kind === "video" ? VIDEO_BYTE_LIMIT : AUDIO_BYTE_LIMIT;
    if (blob.size > limit)
        throw kind === "video"
            ? "That video is too long to translate. Try a shorter clip."
            : "That audio is too long to translate.";

    const targetCode = settings.store.receivedOutput || "en";
    const targetName = languageName(targetCode === "auto" ? "en" : targetCode);
    const context = chatContextBlock(where?.channelId, where?.messageId);
    const prompt = context ? `${mediaPrompt(kind, targetName)}\n\n${context}` : mediaPrompt(kind, targetName);

    let raw = "";
    if (kind === "audio") {
        let wav = new Uint8Array();
        let format = "wav";
        try {
            wav = await audioToWav(blob);
        } catch {
            format = audioFormat(blob, src);
            wav = new Uint8Array(await blob.arrayBuffer());
        }
        const audioBase64 = bytesToBase64(wav);
        raw = await hear(model => callOpenRouterAudio(apiKey, model, prompt, audioBase64, format));
    } else {
        const mime = blob.type || "video/mp4";
        const videoBase64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
        try {
            raw = await hear(model => callOpenRouterVideo(apiKey, model, prompt, mime, videoBase64));
        } catch (first) {
            const wav = await audioToWav(blob).catch(() => null);
            if (!wav) throw first;
            raw = await hear(model => callOpenRouterAudio(apiKey, model, prompt, bytesToBase64(wav), "wav"));
        }
    }

    const translated = parseModelOutput(raw, kind);
    if (!translated.text) throw "Couldn't hear any speech in that clip.";
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

    const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Delexoo/VoidClient",
        "X-OpenRouter-Title": "Translate"
    };
    const messages = [
        { role: "system", content: system },
        { role: "user", content: text }
    ];
    const send = (skipThinking: boolean) => fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 1024,
            ...(skipThinking ? { reasoning: { effort: "none" } } : {}),
            messages
        })
    });

    let res = await send(true);
    let body = await res.text();
    if (res.status === 400 && /reasoning/i.test(body)) {
        res = await send(false);
        body = await res.text();
    }
    if (!res.ok) throw parseApiError(res.status, body).slice(0, 180);
    return contentFromResponse(body);
}

async function openRouterTranslate(
    text: string,
    sourceLang: string,
    targetLang: string,
    where?: { channelId?: string; messageId?: string; }
): Promise<TranslationValue> {
    const apiKey = resolveOpenRouterKey();
    if (!apiKey)
        throw "Paste an OpenRouter key at the top of the Plugins page.";

    const model = accurateModel();
    const targetName = languageName(targetLang === "auto" ? "en" : targetLang);
    const sourceName = languageName(sourceLang);
    const asked = withChatContext(text, where?.channelId, where?.messageId);
    const system = [
        "You are a professional translator for Discord chat. Reply immediately.",
        `Translate the user's message into ${targetName}.`,
        sourceLang && sourceLang !== "auto" ? `The source language is ${sourceName}.` : "Detect the source language.",
        "If nearby messages are included, use them only to resolve names, slang, and what this or that refers to.",
        "Translate only the message after \"Translate only this message\".",
        `The "text" field MUST be ${targetName}, never a copy of the original unless the original is already ${targetName}.`,
        "Translate slang, abbreviations, swearing, and informal chat into natural wording in the target language.",
        "Preserve Discord markdown, mentions, custom emojis, timestamps, URLs, and code exactly.",
        "Keep tone and line breaks.",
        'Return ONLY JSON: {"from":"<English name of the source language, for example Tagalog>","text":"<the translation in the target language>"}'
    ].join(" ");

    let raw = await callOpenRouter(apiKey, model, system, asked);
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
            withChatContext(text, where?.channelId, where?.messageId)
        );
        const retry = parseModelOutput(raw, translated.sourceLanguage);
        if (retry.text && !sameMessage(retry.text, text)) translated = retry;
        else if (retry.text) translated = retry;
    }

    translated.sourceLanguage = prettySourceLanguage(translated.sourceLanguage);
    return translated;
}
