/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { getOpenRouterKey } from "@utils/openRouterKey";
import { Message } from "@vencord/discord-types";
import { Constants, MessageStore, RestAPI } from "@webpack/common";

import { languageName } from "../composeTranslate/languages";
import { DEFAULT_MODEL, settings } from "./settings";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_PAGES = 40;
const MAX_KEEP = 2500;
const PAGE_SIZE = 100;
const MAX_TOKENS = 1600;

export type ChatLine = {
    id: string;
    name: string;
    text: string;
    replyTo?: string;
};

function nativeApi() {
    if (IS_WEB) return undefined;
    return VencordNative.pluginHelpers.QuickSummary as PluginNative<typeof import("./native")> | undefined;
}

function cmpId(a: string, b: string) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
}

function authorName(raw: any) {
    const user = raw?.author;
    return String(
        raw?.member?.nick
        || user?.globalName
        || user?.global_name
        || user?.displayName
        || user?.display_name
        || user?.username
        || "Unknown"
    ).trim() || "Unknown";
}

function isChatMessage(raw: any) {
    const type = raw?.type ?? 0;
    return type === 0 || type === 19 || type === 20 || type === 21;
}

function lineFrom(raw: any): ChatLine | null {
    if (!raw?.id || !isChatMessage(raw)) return null;

    let text = String(raw.content || "").trim();
    const files = (raw.attachments || [])
        .map((a: any) => a?.filename || a?.name)
        .filter(Boolean);
    if (files.length)
        text = [text, files.map((f: string) => `[${f}]`).join(" ")].filter(Boolean).join(" ");

    const stickers = (raw.stickerItems || raw.sticker_items || raw.stickers || [])
        .map((s: any) => s?.name)
        .filter(Boolean);
    if (stickers.length)
        text = [text, stickers.map((s: string) => `[sticker: ${s}]`).join(" ")].filter(Boolean).join(" ");

    let replyTo: string | undefined;
    const ref = raw.referenced_message || raw.referencedMessage;
    if (ref) {
        const replyName = authorName(ref);
        const replyText = String(ref.content || "").replace(/\s+/g, " ").trim().slice(0, 90);
        replyTo = replyText ? `${replyName}: ${replyText}` : replyName;
    }

    if (!text) return null;
    return { id: String(raw.id), name: authorName(raw), text, replyTo };
}

export function nearbyContext(channelId: string, startId: string, count = 8): ChatLine[] {
    try {
        const channel = MessageStore.getMessages(channelId);
        const arr: Message[] = channel?._array ?? [];
        const before: Message[] = [];
        for (const msg of arr) {
            try {
                if (cmpId(msg.id, startId) < 0) before.push(msg);
            } catch { /* skip */ }
        }
        return before
            .slice(-Math.max(1, count))
            .map(lineFrom)
            .filter((line): line is ChatLine => Boolean(line));
    } catch {
        return [];
    }
}

function cachedFrom(channelId: string, startId: string) {
    try {
        const channel = MessageStore.getMessages(channelId);
        const arr: Message[] = channel?._array ?? [];
        return arr.filter(m => {
            try {
                return cmpId(m.id, startId) >= 0;
            } catch {
                return false;
            }
        });
    } catch {
        return [];
    }
}

function capMessages(list: ChatLine[], truncated: boolean) {
    if (list.length <= MAX_KEEP) return { lines: list, truncated };
    const keep = new Set<number>([0, list.length - 1]);
    const byAuthor = new Map<string, number[]>();
    list.forEach((line, i) => {
        const arr = byAuthor.get(line.name) ?? [];
        arr.push(i);
        byAuthor.set(line.name, arr);
    });
    const perPerson = Math.max(4, Math.floor(MAX_KEEP / Math.max(1, byAuthor.size)));
    for (const idxs of byAuthor.values()) {
        keep.add(idxs[0]);
        keep.add(idxs[idxs.length - 1]);
        const step = Math.max(1, Math.ceil(idxs.length / perPerson));
        for (let i = 0; i < idxs.length; i += step) keep.add(idxs[i]);
    }
    const picked = [...keep].sort((a, b) => a - b);
    const lines = picked.length <= MAX_KEEP
        ? picked.map(i => list[i])
        : picked.filter((_, i) => i === 0 || i === picked.length - 1 || i % Math.ceil(picked.length / MAX_KEEP) === 0)
            .slice(0, MAX_KEEP)
            .map(i => list[i]);
    return { lines, truncated: true };
}

async function fetchPage(channelId: string, query: Record<string, string | number> = {}) {
    const endpoint = (Constants as any)?.Endpoints?.MESSAGES;
    const url = typeof endpoint === "function"
        ? endpoint(channelId)
        : `/channels/${channelId}/messages`;
    const res = await RestAPI.get({
        url,
        query: { limit: PAGE_SIZE, ...query },
        retries: 2
    });
    return (Array.isArray(res?.body) ? res.body : []) as any[];
}

function minId(msgs: any[]) {
    return msgs.reduce((best, msg) => {
        const id = String(msg?.id || "");
        if (!id) return best;
        if (!best || cmpId(id, best) < 0) return id;
        return best;
    }, "" as string);
}

function maxId(msgs: any[]) {
    return msgs.reduce((best, msg) => {
        const id = String(msg?.id || "");
        if (!id) return best;
        if (!best || cmpId(id, best) > 0) return id;
        return best;
    }, "" as string);
}

export async function collectMessages(
    channelId: string,
    startId: string,
    onStatus?: (text: string) => void
) {
    const map = new Map<string, any>();
    const add = (msg: any) => {
        const id = String(msg?.id || "");
        if (id) map.set(id, msg);
    };

    for (const msg of cachedFrom(channelId, startId))
        add(msg);

    try {
        const start = MessageStore.getMessage(channelId, startId);
        if (start) add(start);
    } catch { /* ignore */ }

    let pages = 0;
    let tailOldest = "";
    let complete = false;
    const status = () => onStatus?.(
        map.size > 1 ? `Collecting messages… ${map.size}` : "Collecting messages…"
    );

    try {
        status();
        const latest = await fetchPage(channelId);
        pages++;
        for (const msg of latest) add(msg);
        tailOldest = minId(latest);

        while (pages < MAX_PAGES && tailOldest && cmpId(tailOldest, startId) > 0) {
            status();
            const batch = await fetchPage(channelId, { before: tailOldest });
            pages++;
            if (!batch.length) break;
            for (const msg of batch) add(msg);
            tailOldest = minId(batch) || tailOldest;
            if (cmpId(tailOldest, startId) <= 0) break;
            if (batch.length < PAGE_SIZE) break;
        }

        complete = Boolean(tailOldest && cmpId(tailOldest, startId) <= 0);
        if (!complete && tailOldest) {
            let after = startId;
            while (pages < MAX_PAGES) {
                status();
                const batch = await fetchPage(channelId, { after });
                pages++;
                if (!batch.length) break;
                for (const msg of batch) add(msg);
                const newest = maxId(batch);
                if (!newest) break;
                if (cmpId(newest, tailOldest) >= 0) {
                    complete = true;
                    break;
                }
                after = newest;
                if (batch.length < PAGE_SIZE) break;
            }
        }
    } catch (e) {
        if (!map.size) throw e;
        complete = map.has(startId);
    }

    if (!map.has(startId)) {
        try {
            const around = await fetchPage(channelId, { around: startId });
            for (const msg of around) add(msg);
        } catch { /* ignore */ }
    }

    const lines = [...map.values()]
        .filter(msg => {
            try {
                return cmpId(String(msg.id), startId) >= 0;
            } catch {
                return false;
            }
        })
        .sort((a, b) => cmpId(String(a.id), String(b.id)))
        .map(lineFrom)
        .filter((line): line is ChatLine => Boolean(line));

    const hitStart = map.has(startId) || (lines[0] && cmpId(lines[0].id, startId) <= 0);
    return capMessages(lines, !complete || !hitStart);
}

function systemPrompt(lang: string) {
    const code = String(lang || "auto").trim() || "auto";
    const languageLine = code === "auto"
        ? "Write in the dominant language of the chat."
        : `Write the entire summary in ${languageName(code)}. Translate names of events into that language when natural. Do not mix languages.`;

    return [
        "You recap a Discord channel for someone who missed the stretch from a chosen message through now.",
        "The log includes everybody who spoke. Your job is to make the reader understand what people said.",
        "Cover every person who made a point, request, question, joke that others reacted to, disagreement, or decision.",
        "Name people when you say what they said. Do not collapse the chat into one generic topic if several people spoke.",
        "Keep it plain and easy to read. No filler.",
        "Output exactly this shape, nothing else:",
        "One or two sentences that say what happened from the start of this log until the latest message, then the message numbers like [1] or [2, 9].",
        "Then bullets starting with '- ', as many as needed (up to 16).",
        "Each bullet is one clear sentence about who said or decided what, then the message numbers it comes from, like [8] or [4, 5].",
        "Use only the [n] numbers from the log. Put them at the end of the gist and each bullet, nowhere else.",
        "Group a short back-and-forth into one bullet when it is the same point.",
        "If the chat is tiny, one sentence and 1–2 bullets is enough.",
        "If nothing was said, one sentence only.",
        languageLine,
        "No title, no preamble, no markdown headings, no numbered lists."
    ].join(" ");
}

function transcript(lines: ChatLine[], truncated: boolean) {
    const people = [...new Set(lines.map(line => line.name))];
    const header = [
        `${lines.length} messages from ${people.length} people, oldest to newest.`,
        "Each line is [n] Name: text. Cite those [n] numbers at the end of the gist and each bullet.",
        "Summarize what everyone said from the first message through the most recent (now)."
    ].join(" ");
    const body = lines.map((line, i) => {
        const reply = line.replyTo ? ` (reply to ${line.replyTo})` : "";
        return `[${i + 1}] ${line.name}${reply}: ${line.text}`;
    }).join("\n");
    const note = truncated
        ? "\n\n[Note: this stretch was very long, so some messages in the middle were thinned. The selected starting point, every person who spoke in the kept messages, and the latest messages through now are included.]"
        : "";
    return `${header}\n\n${body}${note}`;
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

async function chatCompleteFetch(apiKey: string, model: string, system: string, user: string) {
    const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/Delexoo/VoidClient",
            "X-OpenRouter-Title": "Quick Summary"
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: MAX_TOKENS,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user }
            ]
        })
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(parseApiError(res.status, raw).slice(0, 180));
    const text = contentFromResponse(raw).trim();
    if (!text) throw new Error("OpenRouter returned an empty summary.");
    return text;
}

function cleanSummary(text: string) {
    let out = String(text || "").trim();
    if (out.startsWith("```") && out.endsWith("```"))
        out = out.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim();
    return out.replace(/^(here(?:'s| is) (?:a |the )?summary:?\s*)/i, "").trim();
}

export async function summarizeLines(lines: ChatLine[], truncated: boolean, lang = "auto") {
    if (!lines.length) throw new Error("No messages to summarize from here to now.");

    const apiKey = getOpenRouterKey();
    if (!apiKey) throw new Error("Paste an OpenRouter key at the top of the Plugins page.");

    const model = String(settings.store.model || "").trim() || DEFAULT_MODEL;
    const system = systemPrompt(lang);
    const user = transcript(lines, truncated);

    const Native = nativeApi();
    let raw: string;
    if (Native?.chatComplete) {
        const res = await Native.chatComplete(apiKey, model, system, user);
        if (!res?.ok) throw new Error(String(res?.data || "OpenRouter failed").slice(0, 180));
        raw = res.data;
    } else {
        raw = await chatCompleteFetch(apiKey, model, system, user);
    }

    const summary = cleanSummary(raw);
    if (!summary) throw new Error("OpenRouter returned an empty summary.");
    return summary;
}
