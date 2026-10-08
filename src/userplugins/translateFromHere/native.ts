/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type ChatResult = { ok: true; data: string; } | { ok: false; data: string; };

function errorMessage(status: number, raw: string) {
    try {
        const err = JSON.parse(raw) as { error?: { message?: string; }; message?: string; };
        return err?.error?.message || err?.message || `OpenRouter ${status}`;
    } catch {
        return raw?.trim() || `OpenRouter ${status}`;
    }
}

function textFromBody(raw: string) {
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

export async function chatComplete(
    _: IpcMainInvokeEvent,
    apiKey: string,
    model: string,
    system: string,
    user: string
): Promise<ChatResult> {
    const key = String(apiKey || "").trim();
    if (!key) return { ok: false, data: "Paste an OpenRouter key at the top of the Plugins page." };

    try {
        const res = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/Delexoo/VoidClient",
                "X-OpenRouter-Title": "Translate From Here"
            },
            body: JSON.stringify({
                model: String(model || "").trim(),
                temperature: 0,
                max_tokens: 8192,
                reasoning: { effort: "none" },
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user }
                ]
            })
        });
        const raw = await res.text();
        if (!res.ok) return { ok: false, data: errorMessage(res.status, raw).slice(0, 180) };
        const text = textFromBody(raw).trim();
        if (!text) return { ok: false, data: "OpenRouter returned an empty translation." };
        return { ok: true, data: text };
    } catch (e) {
        const msg = String(e).replace(/^Error:\s*/, "");
        if (/failed to fetch|networkerror|enotfound|econnreset|etimedout/i.test(msg))
            return { ok: false, data: "Can't reach OpenRouter. Check your internet, then fully quit Discord from the tray and reopen." };
        return { ok: false, data: msg.slice(0, 180) };
    }
}
