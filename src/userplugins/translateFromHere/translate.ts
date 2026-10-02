/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { PluginNative } from "@utils/types";
import { getOpenRouterKey } from "@utils/openRouterKey";
import { showToast, Toasts } from "@webpack/common";

import { languageName } from "../composeTranslate/languages";
import { ChatLine, collectMessages, nearbyContext } from "../quickSummary/summarize";
import { DEFAULT_MODEL, settings } from "./settings";
import {
    currentRun,
    dismissAll,
    getCachedLines,
    getCachedPrior,
    nextRun,
    patchBar,
    clearOverlays,
    setCachedLines,
    setOverlays
} from "./session";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const BATCH = 28;

function nativeApi() {
    if (IS_WEB) return undefined;
    return VencordNative.pluginHelpers.TranslateFromHere as PluginNative<typeof import("./native")> | undefined;
}

function resolveKey() {
    return getOpenRouterKey();
}

function resolveLang() {
    const own = String(settings.store.targetLang || "").trim();
    if (own) return own;
    try {
        const plugins = Settings.plugins as Record<string, { targetLang?: string; }>;
        return String(plugins.ComposeTranslate?.targetLang || "en").trim() || "en";
    } catch {
        return "en";
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

    const model = String(settings.store.model || "").trim() || DEFAULT_MODEL;
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
            "X-OpenRouter-Title": "Translate From Here"
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 8192,
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

function cleanJson(raw: string) {
    let out = String(raw || "").trim();
    if (out.startsWith("```"))
        out = out.replace(/^```(?:json|JSON)?\n?/, "").replace(/\n?```$/, "").trim();
    return out;
}

const CONTEXT = 8;

function spokenOnly(text: string) {
    return String(text || "").replace(/^\(re:\s*[^)]*\)\s*/i, "").trim();
}

function parseBatch(raw: string, slice: ChatLine[]) {
    const map = new Map<string, string>();
    try {
        const parsed = JSON.parse(cleanJson(raw)) as Array<{ n?: number; id?: number | string; text?: string; }>;
        if (!Array.isArray(parsed)) return map;
        for (const row of parsed) {
            const n = Number(row.n ?? row.id);
            const text = spokenOnly(String(row.text || ""));
            if (!text || !Number.isInteger(n) || n < 1 || n > slice.length) continue;
            map.set(slice[n - 1].id, text);
        }
    } catch { /* ignore */ }
    return map;
}

function brief(line: ChatLine) {
    const reply = line.replyTo ? ` (replying to ${line.replyTo})` : "";
    return `${line.name}${reply}: ${line.text}`;
}

function batchUser(all: ChatLine[], start: number, slice: ChatLine[]) {
    const ctx = all.slice(Math.max(0, start - CONTEXT), start);
    const parts: string[] = [];
    if (ctx.length) {
        parts.push("Channel context (read only — do not translate these):");
        parts.push(ctx.map(brief).join("\n"));
        parts.push("");
    }
    parts.push("Translate ONLY the Message field of each numbered item. Do not include quoted replies or parent messages.");
    parts.push(slice.map((line, i) => {
        const bits = [`[${i + 1}] ${line.name}`];
        if (line.replyTo) bits.push(`This message is a reply to: ${line.replyTo}`);
        bits.push(`Message: ${line.text}`);
        return bits.join("\n");
    }).join("\n\n"));
    return parts.join("\n");
}

function batchPrompt(lang: string) {
    const name = languageName(lang);
    return [
        `Translate Discord chat into ${name}.`,
        "Use channel context and reply notes only to understand slang, pronouns, and what this/that refers to.",
        "Translate ONLY the spoken Message of each numbered item.",
        "Never copy, quote, or translate the parent/replied-to message into the output.",
        "Never prefix with (re: ...) or a quote block.",
        'Return ONLY a JSON array: [{"n":1,"text":"<translation of the Message field only>"}, ...]',
        "One object per input item, same n values.",
        "Preserve Discord markdown, mentions, custom emojis, timestamps, URLs, and code exactly.",
        "Keep tone and line breaks. If a message is already in the target language, copy the Message unchanged."
    ].join(" ");
}

async function translateOne(line: ChatLine, all: ChatLine[], lang: string) {
    const name = languageName(lang);
    const idx = all.findIndex(item => item.id === line.id);
    const ctx = idx > 0 ? all.slice(Math.max(0, idx - CONTEXT), idx) : [];
    const parts: string[] = [];
    if (ctx.length) {
        parts.push("Channel context (do not translate):");
        parts.push(ctx.map(brief).join("\n"));
        parts.push("");
    }
    if (line.replyTo) parts.push(`This message is a reply to: ${line.replyTo}`);
    parts.push("Translate only this message:");
    parts.push(line.text);
    const one = await chatComplete(
        `Translate into ${name}. Use context only to understand the message. Return only the translated spoken message — never the quoted reply. Preserve markdown, mentions, emojis, URLs, and code.`,
        parts.join("\n")
    );
    return spokenOnly(one);
}

async function translateBatch(all: ChatLine[], start: number, slice: ChatLine[], lang: string) {
    const raw = await chatComplete(batchPrompt(lang), batchUser(all, start, slice));
    const parsed = parseBatch(raw, slice);
    if (parsed.size >= Math.ceil(slice.length * 0.6)) return parsed;

    const fallback = new Map<string, string>();
    for (const line of slice) {
        try {
            const text = await translateOne(line, all, lang);
            if (text) fallback.set(line.id, text);
        } catch { /* skip this line */ }
    }
    return fallback;
}

async function translateLines(lines: ChatLine[], lang: string, run: number, prior: ChatLine[] = []) {
    const world = [...prior, ...lines];
    const offset = prior.length;
    const all = new Map<string, string>();
    for (let i = 0; i < lines.length; i += BATCH) {
        if (run !== currentRun()) return;
        const slice = lines.slice(i, i + BATCH);
        patchBar({
            status: `Translating ${Math.min(i + slice.length, lines.length)} / ${lines.length}…`,
            done: i,
            total: lines.length
        });
        const batch = await translateBatch(world, offset + i, slice, lang);
        if (run !== currentRun()) return;
        for (const [id, text] of batch) all.set(id, text);
        setOverlays([...all.entries()]);
        patchBar({ done: Math.min(i + slice.length, lines.length), total: lines.length });
    }
}

export async function startTranslateFromHere(channelId: string, startId: string, lang = resolveLang()) {
    const run = nextRun();
    const code = String(lang || "en").trim() || "en";
    settings.store.targetLang = code;
    clearOverlays();

    patchBar({
        active: true,
        busy: true,
        mode: "session",
        status: "Collecting messages…",
        done: 0,
        total: 0,
        lang: code,
        channelId,
        error: ""
    });

    try {
        const { lines } = await collectMessages(channelId, startId, text => {
            if (run === currentRun()) patchBar({ status: text });
        });
        if (run !== currentRun()) return;
        if (!lines.length) throw new Error("No messages to translate from here to now.");

        const prior = nearbyContext(channelId, startId);
        setCachedLines(lines, prior);
        patchBar({ total: lines.length, done: 0, status: `Translating 0 / ${lines.length}…` });
        await translateLines(lines, code, run, prior);
        if (run !== currentRun()) return;
        patchBar({
            busy: false,
            status: `${lines.length} message${lines.length === 1 ? "" : "s"} · only you can see this`,
            done: lines.length,
            total: lines.length
        });
    } catch (e) {
        if (run !== currentRun()) return;
        const msg = String(e).replace(/^Error:\s*/, "");
        patchBar({ busy: false, error: msg, status: msg });
        showToast(msg, Toasts.Type.FAILURE);
        if (!getCachedLines().length) dismissAll();
    }
}

export async function retranslateCached(lang: string) {
    const lines = getCachedLines();
    if (!lines.length) return;
    const run = nextRun();
    const code = String(lang || "en").trim() || "en";
    settings.store.targetLang = code;
    patchBar({
        active: true,
        busy: true,
        mode: "session",
        lang: code,
        error: "",
        status: `Translating 0 / ${lines.length}…`,
        done: 0,
        total: lines.length
    });
    try {
        await translateLines(lines, code, run, getCachedPrior());
        if (run !== currentRun()) return;
        patchBar({
            busy: false,
            status: `${lines.length} message${lines.length === 1 ? "" : "s"} · only you can see this`,
            done: lines.length
        });
    } catch (e) {
        if (run !== currentRun()) return;
        const msg = String(e).replace(/^Error:\s*/, "");
        patchBar({ busy: false, error: msg, status: msg });
        showToast(msg, Toasts.Type.FAILURE);
    }
}

export { resolveLang };
