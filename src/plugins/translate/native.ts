/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

export async function makeDeeplTranslateRequest(_: IpcMainInvokeEvent, pro: boolean, apiKey: string, payload: string) {
    const url = pro
        ? "https://api.deepl.com/v2/translate"
        : "https://api-free.deepl.com/v2/translate";

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `DeepL-Auth-Key ${apiKey}`
            },
            body: payload
        });

        const data = await res.text();
        return { status: res.status, data };
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}

export async function makeKagiTranslateRequest(_: IpcMainInvokeEvent, token: string, text: string, sourceLang: string, targetLang: string) {
    const url = "https://translate.kagi.com/api/translate";

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cookie": `kagi_session=${token}`
            },
            body: JSON.stringify({
                text,
                from: sourceLang,
                to: targetLang,
                model: "standard"
            }),
        });

        const data = await res.json();
        return { status: res.status, data };
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}

export async function makeOpenRouterAudioRequest(
    _: IpcMainInvokeEvent,
    apiKey: string,
    model: string,
    prompt: string,
    audioBase64: string,
    format: string
) {
    try {
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
                            {
                                type: "input_audio",
                                input_audio: {
                                    data: audioBase64,
                                    format
                                }
                            }
                        ]
                    }
                ]
            })
        });
        const data = await res.text();
        return { status: res.status, data };
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}

export async function makeOpenRouterTranslateRequest(
    _: IpcMainInvokeEvent,
    apiKey: string,
    model: string,
    system: string,
    user: string
) {
    try {
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
                temperature: 0.2,
                max_tokens: 4096,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user }
                ]
            })
        });
        const data = await res.text();
        return { status: res.status, data };
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}
