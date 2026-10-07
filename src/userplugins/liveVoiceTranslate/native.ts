/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 SpyT / Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, desktopCapturer, IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function historyRoot() {
    const base = join(app.getPath("documents"), "LiveVoiceTranslate");
    mkdirSync(base, { recursive: true });
    return base;
}

function historyPath() {
    return join(historyRoot(), "history.json");
}

function collectDiscordSourceIds() {
    const ids = new Set<string>();
    for (const win of BrowserWindow.getAllWindows()) {
        try {
            const fromWin = (win as { getMediaSourceId?: () => string; }).getMediaSourceId?.();
            if (fromWin) ids.add(fromWin);
        } catch { /* ignore */ }
        try {
            const fromWc = (win.webContents as { getMediaSourceId?: () => string; }).getMediaSourceId?.();
            if (fromWc) ids.add(fromWc);
        } catch { /* ignore */ }
    }
    return ids;
}

export async function listDesktopAudioSources(_: IpcMainInvokeEvent) {
    try {
        const discordIds = collectDiscordSourceIds();
        const sources = await desktopCapturer.getSources({
            types: ["screen", "window"],
            fetchWindowIcons: false
        });
        const mapped = sources.map(s => {
            const id = String(s.id || "");
            const name = String(s.name || "");
            const isScreen = id.startsWith("screen:") || /^(Entire screen|Screen \d+)/i.test(name);
            const isDiscord = (!isScreen && discordIds.has(id))
                || (/discord|vesktop|armcord|webcord/i.test(name) && !isScreen);
            return { id, name, isDiscord, isScreen };
        });
        mapped.sort((a, b) =>
            Number(b.isDiscord) - Number(a.isDiscord)
            || Number(b.isScreen) - Number(a.isScreen)
        );
        return { ok: true, data: JSON.stringify(mapped) };
    } catch (e) {
        return { ok: false, data: String(e) };
    }
}

export async function readHistory(_: IpcMainInvokeEvent) {
    try {
        const full = historyPath();
        if (existsSync(full)) return { ok: true, data: readFileSync(full, "utf8") };
        const legacy = join(app.getPath("documents"), "LiveVoiceTranslate2", "history.json");
        if (existsSync(legacy)) return { ok: true, data: readFileSync(legacy, "utf8") };
        return { ok: true, data: "" };
    } catch (e) {
        return { ok: false, data: String(e) };
    }
}

export async function writeHistory(_: IpcMainInvokeEvent, json: string) {
    try {
        const full = historyPath();
        writeFileSync(full, json ?? "", "utf8");
        return { ok: true, data: full };
    } catch (e) {
        return { ok: false, data: String(e) };
    }
}

export async function getHistoryDir(_: IpcMainInvokeEvent) {
    try {
        return { ok: true, data: historyRoot() };
    } catch (e) {
        return { ok: false, data: String(e) };
    }
}

function envValue(name: string) {
    const fromProc = String(process.env[name] ?? "").trim();
    if (fromProc) return fromProc;
    const localApp = process.env.LOCALAPPDATA ?? "";
    const candidates = [
        join(homedir(), "OneDrive", "Desktop", "Vencord", ".env"),
        join(homedir(), "Desktop", "Vencord", ".env"),
        join(process.cwd(), ".env"),
        localApp ? join(localApp, "DelexooVencord", ".env") : "",
    ];
    let dir = app.getAppPath();
    for (let i = 0; i < 6 && dir; i++) {
        candidates.push(join(dir, ".env"));
        const parent = join(dir, "..");
        if (parent === dir) break;
        dir = parent;
    }
    for (const path of candidates) {
        if (!path || !existsSync(path)) continue;
        try {
            for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
                const line = raw.trim();
                if (!line.toUpperCase().startsWith(name.toUpperCase())) continue;
                const eq = line.indexOf("=");
                if (eq < 0) continue;
                const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
                if (value) return value;
            }
        } catch { /* ignore unreadable env files */ }
    }
    return "";
}

export async function readOpenRouterKey(_: IpcMainInvokeEvent) {
    try {
        return { ok: true, data: envValue("OPENROUTER_API_KEY") };
    } catch (e) {
        return { ok: false, data: String(e) };
    }
}

export async function transcribeOpenRouter(
    _: IpcMainInvokeEvent,
    apiKey: string,
    model: string,
    audioBase64: string,
    language: string
) {
    const key = String(apiKey || "").trim() || envValue("OPENROUTER_API_KEY");
    if (!key)
        return { ok: false, data: "Paste an OpenRouter key at the top of the Plugins page." };
    if (!audioBase64)
        return { ok: false, data: "No audio to transcribe." };

    const bytes = Buffer.from(audioBase64, "base64");
    const lang = String(language || "").trim();
    const modelId = model || "openai/gpt-4o-transcribe";
    const headers = {
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": "https://github.com/Delexoo/VoidClient",
        "X-OpenRouter-Title": "LiveVoiceTranslate"
    };

    async function parseBody(res: Response) {
        const raw = await res.text();
        if (!res.ok) {
            let detail = `OpenRouter ${res.status}`;
            try {
                const err = JSON.parse(raw) as { error?: { message?: string; }; message?: string; };
                detail = err?.error?.message || err?.message || detail;
            } catch { /* keep status */ }
            return { ok: false as const, data: String(detail).slice(0, 160) };
        }
        try {
            const data = JSON.parse(raw) as { text?: string; };
            return { ok: true as const, data: String(data.text || "").trim() };
        } catch {
            return { ok: false as const, data: "OpenRouter sent a bad response." };
        }
    }

    try {
        const form = new FormData();
        form.append("model", modelId);
        form.append("temperature", "0");
        form.append("response_format", "json");
        form.append("prompt", "Verbatim speech only. Do not invent words, filler, or captions from silence or noise.");
        if (lang && lang !== "auto") form.append("language", lang);
        form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/wav" }), "speech.wav");
        let parsed = await parseBody(await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
            method: "POST",
            headers,
            body: form
        }));
        if (!parsed.ok) {
            const payload: Record<string, unknown> = {
                model: modelId,
                temperature: 0,
                prompt: "Verbatim speech only. Do not invent words, filler, or captions from silence or noise.",
                input_audio: { data: audioBase64, format: "wav" }
            };
            if (lang && lang !== "auto") payload.language = lang;
            parsed = await parseBody(await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }));
        }
        return parsed;
    } catch (e) {
        const msg = String(e).replace(/^Error:\s*/, "");
        if (/failed to fetch|networkerror|enotfound|econnreset/i.test(msg))
            return { ok: false, data: "Can't reach OpenRouter. Check your internet, then fully quit Discord from the tray and reopen." };
        return { ok: false, data: msg.slice(0, 160) };
    }
}

const QUALITY_LISTEN_MODEL = "google/gemini-2.5-pro";
const QUALITY_STT_MODEL = "openai/gpt-4o-transcribe";

function chatHeaders(key: string) {
    return {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Delexoo/VoidClient",
        "X-OpenRouter-Title": "LiveVoiceTranslate"
    };
}

function apiDetail(status: number, raw: string) {
    try {
        const err = JSON.parse(raw) as { error?: { message?: string; }; message?: string; };
        return String(err?.error?.message || err?.message || `OpenRouter ${status}`).slice(0, 180);
    } catch {
        return `OpenRouter ${status}`;
    }
}

function contentFromChat(raw: string) {
    const data = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string; }>; }; }>;
        error?: { message?: string; };
    };
    if (data?.error?.message) throw new Error(data.error.message);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map(part => part?.text || "").join("");
    return "";
}

function languageCode(raw: string) {
    const value = raw.trim().toLowerCase();
    const names: Record<string, string> = {
        english: "en",
        tagalog: "tl",
        filipino: "tl",
        spanish: "es",
        french: "fr",
        german: "de",
        chinese: "zh",
        japanese: "ja",
        korean: "ko",
        indonesian: "id",
        portuguese: "pt",
        italian: "it",
        russian: "ru",
        vietnamese: "vi",
        thai: "th",
        arabic: "ar",
        hindi: "hi"
    };
    if (names[value]) return names[value];
    if (/^[a-z]{2,3}(-[a-z]{2})?$/.test(value)) return value.split("-")[0];
    return "";
}

function parseListen(raw: string) {
    let out = String(raw || "").trim();
    if (out.startsWith("```"))
        out = out.replace(/^```(?:json|JSON)?\s*/, "").replace(/\s*```$/, "").trim();
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
        const data = JSON.parse(out.slice(start, end + 1)) as {
            transcript?: string;
            translation?: string;
            text?: string;
            language?: string;
            from?: string;
        };
        const transcript = String(data.transcript ?? "").trim();
        const translation = String(data.translation ?? data.text ?? "").trim();
        const language = languageCode(String(data.language ?? data.from ?? ""));
        if (!transcript && !translation)
            return { transcript: "", translation: "", language };
        return {
            transcript: transcript || translation,
            translation: translation || transcript,
            language
        };
    } catch {
        return null;
    }
}

function listenPrompt(targetName: string, sourceName: string, context: string) {
    return [
        "Listen to the whole clip before you answer. Accuracy matters more than speed.",
        "Write every spoken word verbatim, including code-switching. Keep names as spoken.",
        "Ignore music, noise, and silence. Do not invent words, captions, or filler.",
        "If you cannot hear speech, return empty strings.",
        sourceName
            ? `The speech may be ${sourceName}, but trust only what you actually hear.`
            : "Detect the spoken language from the audio.",
        `Translate the full utterance into ${targetName}.`,
        `If the speech is already ${targetName}, set translation to the same words as transcript.`,
        "Reply with JSON only, with keys transcript, translation, and language.",
        "language is a short code such as en, tl, es, or ja.",
        context
            ? `Use this chat only to understand names and meaning. Do not translate it.\n${context}`
            : ""
    ].filter(Boolean).join(" ");
}

async function chatAudio(key: string, model: string, prompt: string, audioBase64: string) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: chatHeaders(key),
        signal: AbortSignal.timeout(90000),
        body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 2048,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "input_audio", input_audio: { data: audioBase64, format: "wav" } }
                    ]
                }
            ]
        })
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(apiDetail(res.status, raw));
    return contentFromChat(raw);
}

async function chatText(key: string, model: string, prompt: string) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: chatHeaders(key),
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 2048,
            messages: [{ role: "user", content: prompt }]
        })
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(apiDetail(res.status, raw));
    return contentFromChat(raw);
}

export async function listenQuality(
    event: IpcMainInvokeEvent,
    apiKey: string,
    audioBase64: string,
    targetName: string,
    sourceName: string,
    context?: string
) {
    const key = String(apiKey || "").trim() || envValue("OPENROUTER_API_KEY");
    if (!key)
        return { ok: false as const, data: "Paste an OpenRouter key at the top of the Plugins page." };
    if (!audioBase64)
        return { ok: false as const, data: "No audio to transcribe." };

    const target = String(targetName || "English").trim() || "English";
    const source = String(sourceName || "").trim();
    const prompt = listenPrompt(target, source, String(context || "").trim());

    try {
        const raw = await chatAudio(key, QUALITY_LISTEN_MODEL, prompt, audioBase64);
        const parsed = parseListen(raw);
        if (parsed)
            return { ok: true as const, data: parsed };
    } catch (e) {
        const message = String(e).replace(/^Error:\s*/, "");
        if (/failed to fetch|networkerror|enotfound|econnreset/i.test(message))
            return { ok: false as const, data: "Can't reach OpenRouter. Check your internet, then fully quit Discord from the tray and reopen." };
    }

    const heard = await transcribeOpenRouter(event, key, QUALITY_STT_MODEL, audioBase64, "");
    if (!heard.ok || !String(heard.data || "").trim())
        return { ok: false as const, data: heard.ok ? "Couldn't hear speech in that clip." : String(heard.data) };

    const transcript = String(heard.data).trim();
    try {
        const raw = await chatText(
            key,
            QUALITY_LISTEN_MODEL,
            [
                `Translate this transcript into ${target}. Keep names.`,
                `If it is already ${target}, copy it unchanged.`,
                "Do not add words that are not in the transcript.",
                "Reply with JSON only, with keys translation and language.",
                String(context || "").trim()
                    ? `Chat context, do not translate it:\n${String(context).trim()}`
                    : "",
                `Transcript: ${transcript}`
            ].filter(Boolean).join(" ")
        );
        const parsed = parseListen(raw);
        return {
            ok: true as const,
            data: {
                transcript,
                translation: parsed?.translation || transcript,
                language: parsed?.language || ""
            }
        };
    } catch {
        return {
            ok: true as const,
            data: { transcript, translation: transcript, language: "" }
        };
    }
}
