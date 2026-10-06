/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 SpyT / Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { getOpenRouterKey } from "@utils/openRouterKey";
import { PluginNative } from "@utils/types";

import { isJunkTranscript, languageName, normalizeLangCode, sameSpokenText } from "../_delexo/langNames";
import { activeSpeakerName, localTalker, rankedSpeakers } from "../_delexo/ultraVoiceOverlay";
import { listenAndTranslate } from "./openrouter";

const Native = VencordNative.pluginHelpers.LiveVoiceTranslate as PluginNative<typeof import("./native")> | undefined;

const HISTORY_KEY = "LiveVoiceTranslate2History";
const MAX_HISTORY = 40;
const TARGET_SR = 16000;
const SPEECH_RMS = 0.0032;
const SYSTEM_SPEECH_RMS = 0.0032;
const SILENCE_MS = 2800;
const MIN_SPEECH_MS = 900;
const SYSTEM_MIN_SPEECH_MS = 900;
const MAX_UTTER_MS = 28000;
const PREROLL_CHUNKS = 14;
const MIN_UTTER_RMS = 0.0016;
const SYSTEM_MIN_UTTER_RMS = 0.0016;
const MIN_UTTER_SEC = 0.9;

export type HistoryRow = { original: string; translation: string; fromLang?: string; toLang?: string; speaker?: string; };

type PersistPayload = {
    history: HistoryRow[];
    original: string;
    translation: string;
};

export type EngineSnapshot = {
    ready: boolean;
    listening: boolean;
    status: string;
    level: number;
    original: string;
    translation: string;
    partial: boolean;
    detect: string;
    target: string;
    history: HistoryRow[];
};

export type AudioSource = "discord" | "system" | "mic";

let fromLang = "auto";
let toLang = "en";
let apiKey = "";
let audioSource: AudioSource = "system";
let listening = false;
let ready = false;
let status = "Ready";
let level = 0;
let history: HistoryRow[] = [];
let lastOriginal = "";
let lastTranslation = "";
let partial = false;

let audioCtx: AudioContext | null = null;
let tapAnalyser: AnalyserNode | null = null;
let tapBuf: Float32Array<ArrayBuffer> | null = null;
let graphSrc: MediaStreamAudioSourceNode | null = null;
let graphPreamp: GainNode | null = null;
let graphSink: MediaStreamAudioDestinationNode | null = null;
let scriptNode: ScriptProcessorNode | null = null;
let scriptMute: GainNode | null = null;
let hpState = { x: 0, y: 0 };
let activeStreams: MediaStream[] = [];
let pcmBuf: Float32Array[] = [];
let preroll: Float32Array[] = [];
let speechStartedAt = 0;
let lastLoudAt = 0;
let inSpeech = false;
let busyTranscribe = false;
let loopTimer: number | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let historyLoaded = false;
let noiseRms = 0.003;
let heardPeak = 0;
const speakerVotes = new Map<string, number>();
let lastSpeakerSample = 0;
let utteranceId = "";
let utteranceSpeaker = "";
let seenId = "";
let seenSince = 0;

const SYSTEM_LABEL = "System audio";
const SYSTEM_ID = "system";
let recapturing = false;

type UtterJob = { chunks: Float32Array[]; speaker: string; rate: number; force: boolean; };
const jobs: UtterJob[] = [];
let pumping = false;
let pumpTail: Promise<void> = Promise.resolve();
let listenStartedAt = 0;
let quietHinted = false;
let captureGen = 0;
let drainPromise: Promise<void> | null = null;

function setStatus(s: string) {
    status = s;
}

function persistPayload(): PersistPayload {
    return {
        history: history.slice(-MAX_HISTORY),
        original: lastOriginal,
        translation: lastTranslation
    };
}

async function flushPersist() {
    const payload = persistPayload();
    try {
        await DataStore.set(HISTORY_KEY, payload);
    } catch { /* ignore */ }
    try {
        if (Native?.writeHistory)
            await Native.writeHistory(JSON.stringify(payload, null, 2));
    } catch { /* ignore */ }
}

function schedulePersist() {
    if (saveTimer != null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        void flushPersist();
    }, 400);
}

function applyPayload(payload: PersistPayload | null | undefined) {
    if (!payload || !Array.isArray(payload.history)) return false;
    history = payload.history
        .filter(r => r && (r.original || r.translation) && !isJunkTranscript(r.original) && !isJunkTranscript(r.translation))
        .map(r => ({
            original: String(r.original ?? ""),
            translation: String(r.translation ?? ""),
            fromLang: String(r.fromLang ?? "").trim() || undefined,
            toLang: String(r.toLang ?? "").trim() || undefined,
            speaker: String(r.speaker ?? "").trim() || undefined
        }))
        .slice(-MAX_HISTORY);
    lastOriginal = String(payload.original ?? "");
    lastTranslation = String(payload.translation ?? "");
    if (isJunkTranscript(lastOriginal)) lastOriginal = "";
    if (isJunkTranscript(lastTranslation)) lastTranslation = "";
    return true;
}

export async function loadPersistedHistory() {
    if (historyLoaded) return;
    historyLoaded = true;
    try {
        if (Native?.readHistory) {
            const res = await Native.readHistory();
            if (res?.ok && res.data) {
                try {
                    if (applyPayload(JSON.parse(res.data) as PersistPayload)) return;
                } catch { /* fall through */ }
            }
        }
    } catch { /* fall through */ }
    try {
        const fromDs = await DataStore.get<PersistPayload>(HISTORY_KEY);
        applyPayload(fromDs);
    } catch { /* ignore */ }
}

export async function savePersistedHistoryNow() {
    if (saveTimer != null) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    await flushPersist();
}

export function setLanguages(detect: string, target: string) {
    fromLang = detect || "auto";
    toLang = target || "en";
}

export function setApiKey(key: string) {
    apiKey = String(key || "").trim();
}

export function hasApiKey() {
    return Boolean(apiKey);
}

export async function loadApiKeyFromEnv() {
    if (apiKey) return apiKey;
    const shared = getOpenRouterKey();
    if (shared) {
        apiKey = shared;
        return apiKey;
    }
    try {
        const res = await Native?.readOpenRouterKey?.();
        if (res?.ok && res.data) apiKey = String(res.data).trim();
    } catch { /* ignore */ }
    return apiKey;
}

export function setModel() {
    // The listener chooses a quality model on its own.
}

export function parseAudioSource(value: string): AudioSource {
    switch (value) {
        case "discord":
        case "system":
        case "mic":
            return value;
        default:
            return "system";
    }
}

export function setAudioSource(source: AudioSource) {
    audioSource = source;
}

export function getAudioSource() {
    return audioSource;
}

export function getSnapshot(): EngineSnapshot {
    return {
        ready,
        listening,
        status,
        level,
        original: lastOriginal,
        translation: lastTranslation,
        partial,
        detect: fromLang,
        target: toLang,
        history: history.slice(-40)
    };
}

export function clearHistory() {
    history = [];
    lastOriginal = "";
    lastTranslation = "";
    partial = false;
    schedulePersist();
}

function stopCaptureGraph() {
    if (scriptNode) {
        scriptNode.onaudioprocess = null as unknown as ScriptProcessorNode["onaudioprocess"];
        try { scriptNode.disconnect(); } catch { /* ignore */ }
    }
    scriptNode = null;
    try { scriptMute?.disconnect(); } catch { /* ignore */ }
    scriptMute = null;
    for (const s of activeStreams) {
        for (const t of s.getTracks()) {
            try { t.stop(); } catch { /* ignore */ }
        }
    }
    activeStreams = [];
    try { graphSrc?.disconnect(); } catch { /* ignore */ }
    graphSrc = null;
    try { graphPreamp?.disconnect(); } catch { /* ignore */ }
    graphPreamp = null;
    try { tapAnalyser?.disconnect(); } catch { /* ignore */ }
    tapAnalyser = null;
    tapBuf = null;
    graphSink = null;
    try { void audioCtx?.close(); } catch { /* ignore */ }
    audioCtx = null;
    level = 0;
}

function resetCaptureState() {
    pcmBuf = [];
    preroll = [];
    inSpeech = false;
    noiseRms = 0.003;
    heardPeak = 0;
    quietHinted = false;
    hpState = { x: 0, y: 0 };
    speakerVotes.clear();
    lastSpeakerSample = 0;
    utteranceId = "";
    utteranceSpeaker = "";
    seenId = "";
    seenSince = 0;
}

function currentSource(): { id: string; name: string; } {
    if (audioSource === "mic") {
        const name = activeSpeakerName(true).trim() || "You";
        return { id: "self", name };
    }
    const remote = rankedSpeakers(true)[0];
    if (remote) return { id: remote.id, name: remote.name };
    const self = localTalker();
    if (self) return self;
    return { id: SYSTEM_ID, name: SYSTEM_LABEL };
}

function winningSpeaker() {
    let best = "";
    let count = 0;
    let total = 0;
    let userBest = "";
    let userCount = 0;
    for (const [name, votes] of speakerVotes) {
        total += votes;
        if (votes > count) {
            count = votes;
            best = name;
        }
        if (name !== SYSTEM_LABEL && votes > userCount) {
            userCount = votes;
            userBest = name;
        }
    }
    speakerVotes.clear();
    lastSpeakerSample = 0;
    if (audioSource === "mic")
        return userBest || best || utteranceSpeaker.trim() || activeSpeakerName(true).trim() || "You";
    if (userBest && userCount >= Math.max(2, total * 0.25))
        return userBest;
    if (!best) return utteranceSpeaker.trim() || SYSTEM_LABEL;
    return best.trim();
}

function considerSpeaker(now: number): string | null {
    if (now - lastSpeakerSample < 160) return null;
    lastSpeakerSample = now;
    const hit = currentSource();
    speakerVotes.set(hit.name, (speakerVotes.get(hit.name) ?? 0) + 1);

    if (seenId !== hit.id) {
        seenId = hit.id;
        seenSince = now;
        return null;
    }

    const held = now - seenSince;
    if (!utteranceId) {
        const needed = hit.id === SYSTEM_ID ? 1100 : 250;
        if (held < needed) return null;
        utteranceId = hit.id;
        utteranceSpeaker = hit.name;
        return null;
    }
    if (hit.id === utteranceId) {
        utteranceSpeaker = hit.name;
        return null;
    }
    const needed = hit.id === SYSTEM_ID ? 1100 : 850;
    if (held < needed) return null;
    utteranceId = hit.id;
    utteranceSpeaker = hit.name;
    seenSince = now;
    return null;
}

function stopTracks() {
    stopCaptureGraph();
    resetCaptureState();
}

function idleStatus() {
    return listening ? listenStatus() : "Off";
}

function waitWhileBusy() {
    return new Promise<void>(resolve => {
        const tick = () => {
            if (!busyTranscribe) resolve();
            else window.setTimeout(tick, 40);
        };
        tick();
    });
}

function mergePcm(chunks: Float32Array[]) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const out = new Float32Array(n);
    let o = 0;
    for (const c of chunks) {
        out.set(c, o);
        o += c.length;
    }
    return out;
}

function downsampleTo16k(input: Float32Array, inputRate: number) {
    if (Math.abs(inputRate - TARGET_SR) < 1) return input;
    const ratio = inputRate / TARGET_SR;
    const outLen = Math.max(1, Math.floor(input.length / ratio));
    const out = new Float32Array(outLen);
    const last = input.length - 1;
    for (let i = 0; i < outLen; i++) {
        const src = i * ratio;
        const i0 = Math.min(last, Math.floor(src));
        const i1 = Math.min(last, i0 + 1);
        const t = src - i0;
        out[i] = (input[i0] ?? 0) * (1 - t) + (input[i1] ?? 0) * t;
    }
    return out;
}

function highpassFrame(input: Float32Array) {
    const out = new Float32Array(input.length);
    const a = 0.996;
    let x1 = hpState.x;
    let y1 = hpState.y;
    for (let i = 0; i < input.length; i++) {
        const x = input[i];
        const y = a * (y1 + x - x1);
        out[i] = y;
        x1 = x;
        y1 = y;
    }
    hpState = { x: x1, y: y1 };
    return out;
}

function mixFrame(buf: AudioBuffer) {
    const n = buf.length;
    const ch0 = buf.getChannelData(0);
    if (buf.numberOfChannels < 2) return highpassFrame(Float32Array.from(ch0));
    const ch1 = buf.getChannelData(1);
    let e0 = 0;
    let e1 = 0;
    for (let i = 0; i < n; i++) {
        e0 += ch0[i] * ch0[i];
        e1 += ch1[i] * ch1[i];
    }
    const use0 = e0 >= e1 * 4;
    const use1 = e1 >= e0 * 4;
    const mixed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        if (use0) mixed[i] = ch0[i];
        else if (use1) mixed[i] = ch1[i];
        else mixed[i] = (ch0[i] + ch1[i]) * 0.5;
    }
    return highpassFrame(mixed);
}

function normalizePcm(samples: Float32Array) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
        const a = Math.abs(samples[i]);
        if (a > peak) peak = a;
    }
    if (peak < 0.00035) return samples;
    const gain = Math.min(16, 0.92 / peak);
    if (gain < 1.04) return samples;
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++)
        out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
    return out;
}

function attachCaptureGraph(stream: MediaStream) {
    if (!audioCtx) throw new Error("Audio is not ready");
    if (scriptNode) {
        scriptNode.onaudioprocess = null as unknown as ScriptProcessorNode["onaudioprocess"];
        try { scriptNode.disconnect(); } catch { /* ignore */ }
        scriptNode = null;
    }
    try { scriptMute?.disconnect(); } catch { /* ignore */ }
    scriptMute = null;
    try { graphSrc?.disconnect(); } catch { /* ignore */ }
    try { graphPreamp?.disconnect(); } catch { /* ignore */ }
    try { tapAnalyser?.disconnect(); } catch { /* ignore */ }

    for (const s of activeStreams) {
        if (s === stream) continue;
        for (const t of s.getTracks()) {
            try { t.stop(); } catch { /* ignore */ }
        }
    }
    activeStreams = [stream];
    hpState = { x: 0, y: 0 };

    graphSrc = audioCtx.createMediaStreamSource(stream);
    graphPreamp = audioCtx.createGain();
    graphPreamp.gain.value = audioSource === "mic" ? 2.4 : 5;
    tapAnalyser = audioCtx.createAnalyser();
    tapAnalyser.fftSize = 2048;
    tapAnalyser.smoothingTimeConstant = 0;
    tapBuf = new Float32Array(tapAnalyser.fftSize);
    graphSink = audioCtx.createMediaStreamDestination();
    scriptNode = audioCtx.createScriptProcessor(4096, 2, 1);
    scriptMute = audioCtx.createGain();
    scriptMute.gain.value = 0;
    graphSrc.connect(graphPreamp);
    graphPreamp.connect(tapAnalyser);
    graphPreamp.connect(graphSink);
    graphPreamp.connect(scriptNode);
    scriptNode.connect(scriptMute);
    scriptMute.connect(audioCtx.destination);
    scriptNode.onaudioprocess = ev => {
        if (!listening) return;
        onPcmFrame(mixFrame(ev.inputBuffer));
    };
}

type DesktopSource = {
    id: string;
    name: string;
    isDiscord?: boolean;
    isScreen?: boolean;
};

async function getMicStream() {
    return await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        },
        video: false
    });
}

async function listDesktopSources() {
    if (!Native) throw new Error("Native helper unavailable. Fully quit Discord from the tray, then reopen.");
    const res = await Native.listDesktopAudioSources();
    if (!res.ok) throw new Error(res.data);
    const sources = JSON.parse(res.data) as DesktopSource[];
    if (!Array.isArray(sources) || !sources.length) throw new Error("No desktop audio sources found");
    return sources;
}

function screenFirst(sources: DesktopSource[]) {
    return [
        ...sources.filter(s => s.isScreen),
        ...sources.filter(s => s.isDiscord && !s.isScreen),
        ...sources.filter(s => !s.isScreen && !s.isDiscord)
    ];
}

async function captureDesktop(order: (sources: DesktopSource[]) => DesktopSource[], emptyMsg: string) {
    const sources = order(await listDesktopSources());
    if (!sources.length) throw new Error(emptyMsg);

    let lastError: unknown;
    for (const preferred of sources) {
        try {
            const stream = await (navigator.mediaDevices as any).getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: "desktop",
                        chromeMediaSourceId: preferred.id
                    }
                },
                video: {
                    mandatory: {
                        chromeMediaSource: "desktop",
                        chromeMediaSourceId: preferred.id,
                        maxWidth: 2,
                        maxHeight: 2
                    }
                }
            });
            for (const t of stream.getVideoTracks()) {
                t.stop();
                stream.removeTrack(t);
            }
            const audioTracks = stream.getAudioTracks().filter(t => t.readyState === "live" && t.enabled);
            if (audioTracks.length)
                return stream as MediaStream;
            for (const t of stream.getTracks()) t.stop();
            lastError = new Error(`No audio on ${preferred.name}`);
        } catch (e) {
            lastError = e;
        }
    }

    throw lastError instanceof Error ? lastError : new Error(emptyMsg);
}

async function getCaptureStream(source: AudioSource): Promise<{ stream: MediaStream; label: string; }> {
    switch (source) {
        case "mic":
            return { stream: await getMicStream(), label: "Microphone" };
        case "discord":
            return {
                stream: await captureDesktop(
                    screenFirst,
                    "No Discord or system audio source found."
                ),
                label: "Discord"
            };
        case "system":
            return {
                stream: await captureDesktop(
                    sources => sources.filter(s => s.isScreen),
                    "No system audio source found."
                ),
                label: "System audio"
            };
        default: {
            const _: never = source;
            return _;
        }
    }
}

function listenStatus() {
    switch (audioSource) {
        case "discord":
            return "OpenRouter listening to Discord";
        case "system":
            return "Listening to system audio";
        case "mic":
            return "OpenRouter listening to microphone";
        default: {
            const _: never = audioSource;
            return _;
        }
    }
}

function enqueueChunks(chunks: Float32Array[], speaker: string, rate: number, force: boolean) {
    if (!chunks.length) return;
    jobs.push({ chunks, speaker, rate, force });
    void pumpJobs();
}

function enqueueCurrent(force = false, speaker = "") {
    if (!pcmBuf.length) return;
    const chunks = pcmBuf;
    const who = (speaker.trim() || winningSpeaker() || utteranceSpeaker).trim();
    const rate = audioCtx?.sampleRate || TARGET_SR;
    pcmBuf = [];
    inSpeech = false;
    enqueueChunks(chunks, who, rate, force);
}

async function transcribeJob(job: UtterJob) {
    let merged = mergePcm(job.chunks);
    const durationSec = merged.length / Math.max(1, job.rate);
    const minSec = job.force ? 0.4 : MIN_UTTER_SEC;
    if (durationSec < minSec) {
        if (listening) setStatus(idleStatus());
        return;
    }
    busyTranscribe = true;
    partial = true;
    setStatus("Transcribing the full sentence…");
    try {
        if (!apiKey) await loadApiKeyFromEnv();
        if (!apiKey) throw new Error("Paste an OpenRouter key at the top of the Plugins page.");
        merged = normalizePcm(merged);
        let energy = 0;
        for (let i = 0; i < merged.length; i++) energy += merged[i] * merged[i];
        const utterRms = Math.sqrt(energy / Math.max(1, merged.length));
        const minRms = audioSource === "system" ? SYSTEM_MIN_UTTER_RMS : MIN_UTTER_RMS;
        if (!job.force && utterRms < minRms) {
            if (listening) setStatus(idleStatus());
            return;
        }
        if (job.force && utterRms < 0.002) {
            if (listening) setStatus(idleStatus());
            return;
        }
        const pcm16 = downsampleTo16k(merged, job.rate);
        const targetName = languageName(toLang) || "English";
        const sourceName = fromLang && fromLang !== "auto" ? languageName(fromLang) : "";
        const heard = await listenAndTranslate(pcm16, TARGET_SR, apiKey, targetName, sourceName);
        const text = heard.transcript.trim();
        if (!text || isJunkTranscript(text) || sameSpokenText(text, lastOriginal) || sameSpokenText(text, lastTranslation)) {
            if (listening) setStatus(idleStatus());
            return;
        }
        lastOriginal = text;
        lastTranslation = (heard.translation || text).trim() || text;
        let spokenLang = normalizeLangCode(heard.language);
        if (sameSpokenText(text, lastTranslation))
            spokenLang = normalizeLangCode(toLang) || spokenLang;
        if (isJunkTranscript(lastTranslation)) {
            if (listening) setStatus(idleStatus());
            return;
        }
        history.push({
            original: text,
            translation: lastTranslation,
            fromLang: spokenLang,
            toLang,
            speaker: job.speaker || undefined
        });
        if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
        schedulePersist();
        if (listening) setStatus(idleStatus());
    } catch (e) {
        const msg = String(e).replace(/^Error:\s*/, "");
        setStatus((/failed to fetch|networkerror/i.test(msg)
            ? "Can't reach OpenRouter. Fully quit Discord from the tray and reopen."
            : msg).slice(0, 120));
    } finally {
        partial = false;
        busyTranscribe = false;
    }
}

async function pumpJobs() {
    if (pumping) return pumpTail;
    pumping = true;
    pumpTail = (async () => {
        try {
            while (jobs.length) {
                const job = jobs.shift()!;
                await transcribeJob(job);
            }
        } finally {
            pumping = false;
        }
    })();
    await pumpTail;
    if (jobs.length) return pumpJobs();
}

function shouldFlush(now: number) {
    if (!inSpeech) return false;
    const elapsed = now - speechStartedAt;
    const silentFor = now - lastLoudAt;
    const minSpeech = audioSource === "system" ? SYSTEM_MIN_SPEECH_MS : MIN_SPEECH_MS;
    if (elapsed >= MAX_UTTER_MS && silentFor >= 280) return true;
    return silentFor >= SILENCE_MS && elapsed >= minSpeech;
}

let voiceHint = false;
let voiceHintAt = 0;

function voiceHintActive(now: number) {
    if (now - voiceHintAt < 120) return voiceHint;
    voiceHintAt = now;
    try {
        voiceHint = audioSource === "mic"
            ? Boolean(localTalker())
            : Boolean(rankedSpeakers(false).length || localTalker());
    } catch {
        voiceHint = false;
    }
    return voiceHint;
}

function onPcmFrame(input: Float32Array) {
    if (!listening) return;
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / Math.max(1, input.length));
    level = rms;
    heardPeak = Math.max(heardPeak, rms);

    const now = Date.now();
    const hinted = voiceHintActive(now);
    if (!inSpeech) {
        if (rms < Math.max(SPEECH_RMS, noiseRms * 1.6))
            noiseRms = noiseRms * 0.992 + rms * 0.008;
        preroll.push(new Float32Array(input));
        if (preroll.length > PREROLL_CHUNKS) preroll.shift();
    }

    const speechFloor = (audioSource === "system" ? SYSTEM_SPEECH_RMS : SPEECH_RMS) * (hinted ? 0.55 : 1);
    const gate = Math.max(speechFloor, noiseRms * (hinted ? 1.2 : 1.65));
    const loud = rms >= gate || (hinted && rms >= 0.0014);

    if (loud) {
        lastLoudAt = now;
        considerSpeaker(now);
        const frame = new Float32Array(input);
        if (!inSpeech) {
            inSpeech = true;
            speechStartedAt = now;
            pcmBuf = preroll.slice();
            preroll = [];
            pcmBuf.push(frame);
            setStatus("Waiting for the sentence to finish…");
        } else {
            pcmBuf.push(frame);
        }
    } else if (inSpeech) {
        pcmBuf.push(new Float32Array(input));
    }

    if (shouldFlush(now)) enqueueCurrent(false);
}

function watchStream(stream: MediaStream, gen: number) {
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    let lastRecover = 0;
    const recover = () => {
        if (gen !== captureGen || !listening) return;
        const now = Date.now();
        if (now - lastRecover < 2000) return;
        lastRecover = now;
        void recapture(gen);
    };
    track.addEventListener("ended", recover);
    track.addEventListener("mute", () => {
        window.setTimeout(() => {
            if (gen === captureGen && listening && track.muted) recover();
        }, 1200);
    });
}

async function recapture(gen: number) {
    if (recapturing || gen !== captureGen || !listening) return;
    recapturing = true;
    try {
        setStatus("Reconnecting audio…");
        const next = await getCaptureStream(audioSource);
        if (gen !== captureGen || !listening) {
            dropStream(next.stream);
            return;
        }
        attachCaptureGraph(next.stream);
        watchStream(next.stream, gen);
        setStatus(listenStatus());
    } catch {
        if (gen === captureGen && listening)
            setStatus("Audio dropped — press Listen again");
    } finally {
        recapturing = false;
    }
}

function dropStream(stream: MediaStream | null | undefined) {
    if (!stream) return;
    for (const t of stream.getTracks()) {
        try { t.stop(); } catch { /* ignore */ }
    }
}

export async function startListening() {
    if (drainPromise) await drainPromise;
    if (listening) return;
    if (!apiKey) await loadApiKeyFromEnv();
    if (!apiKey) throw new Error("Paste an OpenRouter key at the top of the Plugins page.");

    const gen = ++captureGen;
    setStatus("Starting capture…");
    listening = true;
    heardPeak = 0;
    quietHinted = false;
    listenStartedAt = Date.now();
    try {
        audioCtx = new AudioContext();
        try { await audioCtx.resume(); } catch { /* ignore */ }
        ready = true;
        const captured = await getCaptureStream(audioSource);
        if (gen !== captureGen || !listening) {
            dropStream(captured.stream);
            stopTracks();
            ready = false;
            return;
        }
        attachCaptureGraph(captured.stream);
        watchStream(captured.stream, gen);
        setStatus(listenStatus());
        if (loopTimer != null) window.clearInterval(loopTimer);
        loopTimer = window.setInterval(() => {
            if (gen !== captureGen || !listening) return;
            if (audioCtx?.state === "suspended")
                void audioCtx.resume();
            if (!quietHinted && Date.now() - listenStartedAt > 4000 && heardPeak < 0.001) {
                quietHinted = true;
                setStatus("No speech heard — try another source in Advanced");
            }
            if (shouldFlush(Date.now())) enqueueCurrent(false);
        }, 200);
    } catch (e) {
        if (gen !== captureGen) return;
        listening = false;
        stopTracks();
        ready = false;
        setStatus(String(e).replace(/^Error:\s*/, "").slice(0, 120));
        throw e;
    }
}

export async function stopListening(_keepModel = false) {
    captureGen++;
    listening = false;
    if (loopTimer != null) {
        window.clearInterval(loopTimer);
        loopTimer = null;
    }
    if (drainPromise) return drainPromise;

    const rate = audioCtx?.sampleRate || TARGET_SR;
    if (pcmBuf.length)
        enqueueChunks(pcmBuf, (winningSpeaker() || utteranceSpeaker).trim(), rate, true);
    pcmBuf = [];
    preroll = [];
    inSpeech = false;
    stopCaptureGraph();

    if (!busyTranscribe && !jobs.length && !pumping) {
        resetCaptureState();
        partial = false;
        ready = false;
        setStatus("Off");
        return;
    }

    drainPromise = (async () => {
        try {
            if (!/^(Transcribing|Translating)/.test(status))
                setStatus("Finishing…");
            await pumpJobs();
        } finally {
            resetCaptureState();
            partial = false;
            ready = false;
            drainPromise = null;
            if (/^(Off|Ready|Finishing|Transcribing|Translating|Waiting|OpenRouter listening)/.test(status))
                setStatus("Off");
        }
    })();
    return drainPromise;
}

export function isListening() {
    return listening;
}
