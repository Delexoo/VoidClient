/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 SpyT / Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { encodeWav } from "./wav";

export const STT_MODEL = "openai/gpt-4o-mini-transcribe";
export type OpenRouterSttModel = typeof STT_MODEL;

const Native = VencordNative.pluginHelpers.LiveVoiceTranslate as PluginNative<typeof import("./native")> | undefined;

function openaiLang(code: string | undefined) {
    if (!code || code === "auto") return "";
    return code;
}

function toBase64(bytes: Uint8Array) {
    const chunk = 0x8000;
    let bin = "";
    for (let i = 0; i < bytes.length; i += chunk)
        bin += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
    return btoa(bin);
}

export async function transcribeOpenRouter(
    samples: Float32Array,
    sampleRate: number,
    apiKey: string,
    model: OpenRouterSttModel,
    language?: string
): Promise<{ text: string; }> {
    const key = apiKey.trim();
    if (!key) throw new Error("Paste an OpenRouter key at the top of the Plugins page.");
    if (samples.length < sampleRate * 0.7) return { text: "" };
    if (!Native?.transcribeOpenRouter)
        throw new Error("Restart Discord from the tray so OpenRouter can run.");

    const wav = encodeWav(samples, sampleRate);
    const res = await Native.transcribeOpenRouter(key, model, toBase64(wav), openaiLang(language));
    if (!res?.ok) throw new Error(String(res?.data || "OpenRouter failed").slice(0, 140));
    return { text: String(res.data || "").trim() };
}
