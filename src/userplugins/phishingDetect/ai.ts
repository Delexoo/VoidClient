/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { getOpenRouterKey } from "@utils/openRouterKey";

import { DEFAULT_MODEL, settings } from "./settings";
import type { Snapshot, Verdict } from "./scan";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function nativeApi() {
    if (IS_WEB) return undefined;
    return VencordNative.pluginHelpers.PhishingDetect as PluginNative<typeof import("./native")> | undefined;
}

export function resolveKey() {
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
    if (!apiKey) return "";
    const model = String(settings.store.model || "").trim() || DEFAULT_MODEL;
    const Native = nativeApi();
    if (Native?.chatComplete) {
        const res = await Native.chatComplete(apiKey, model, system, user);
        return res?.ok ? String(res.data || "") : "";
    }
    const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/Delexoo/VoidClient",
            "X-OpenRouter-Title": "Phishing Detect"
        },
        body: JSON.stringify({
            model,
            temperature: 0.1,
            max_tokens: 500,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user }
            ]
        })
    });
    const raw = await res.text();
    if (!res.ok) return "";
    return contentFromResponse(raw).trim();
}

const SYSTEM = [
    "You are a Discord phishing analyst. Judge ONLY authorize/login/connect/verify screens.",
    "Return ONLY JSON: {\"level\":\"safe\"|\"suspicious\"|\"malicious\",\"reasons\":[\"...\"],\"summary\":\"one sentence\"}",
    "malicious: steal account, raw IP redirect, HTTP redirect, password/token/2FA fields, guilds.join used as fake verify.",
    "suspicious: young app, restorecord-style verify, odd domain, extra permissions that are not needed.",
    "safe: known-looking app, HTTPS, identify-only or clearly documented scopes, no credential fields.",
    "Never ask for or echo secrets. You only see labels, scopes, and URLs."
].join(" ");

export async function aiVerdict(snap: Snapshot): Promise<Verdict | null> {
    if (!resolveKey()) return null;
    const payload = {
        kind: snap.kind,
        appName: snap.appName,
        title: snap.title,
        redirect: snap.redirect,
        scopes: snap.scopes,
        fields: snap.fields.map(f => f.slice(0, 80)),
        activeSince: snap.activeSince,
        urls: snap.urls.slice(0, 8),
        excerpt: snap.text.slice(0, 1200)
    };
    const raw = await chatComplete(SYSTEM, JSON.stringify(payload));
    if (!raw) return null;
    let json = raw.trim();
    if (json.startsWith("```"))
        json = json.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim();
    try {
        const parsed = JSON.parse(json) as { level?: string; reasons?: string[]; summary?: string; };
        const level = parsed.level === "malicious" || parsed.level === "suspicious" || parsed.level === "safe"
            ? parsed.level
            : null;
        if (!level) return null;
        const reasons = Array.isArray(parsed.reasons)
            ? parsed.reasons.map(r => String(r).slice(0, 200)).filter(Boolean).slice(0, 6)
            : [];
        return {
            level,
            score: level === "malicious" ? 90 : level === "suspicious" ? 40 : 0,
            reasons,
            summary: String(parsed.summary || "").slice(0, 240),
            source: "ai"
        };
    } catch {
        return null;
    }
}
