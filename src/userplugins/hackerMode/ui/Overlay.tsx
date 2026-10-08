/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { copyWithToast, openImageModal } from "@utils/discord";
import { PluginNative } from "@utils/types";
import {
    ChannelStore,
    GuildStore,
    IconUtils,
    MessageStore,
    openMediaModal,
    UserStore,
    UserProfileStore,
    createRoot,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "@webpack/common";
import type { Root } from "react-dom/client";

import { jumpToMessage, joinVoice, openChannel, openDm, openProfile } from "../actions";
import { contentHashOf, fastSrcs, isAudioFile, isVideoFile, keptMime, keptSrc, pinKeptMedia, rememberGoodSrc, subscribeContentHash, warmMedia } from "../fastLoad";
import { isBotUser, mediaFromMessage, noteBotAuthor, resolveLiveMedia } from "../flux";
import { getDossier, listDossiers, subscribeDossiers } from "../dossier";
import {
    categoryTree,
    channelOverwrites,
    copyId,
    decodeFlags,
    emojiOrigins,
    fetchInvite,
    whoIs,
    connectedSocials,
    refreshUserProfile,
    guildExtra,
    inviteCodes,
    memberExtras,
    memberPermissions,
    messagePermalink,
    myChannelPermissions,
    roleDump,
    serverIntel,
    snowflakeAt,
    stickerOrigins,
    timestampsIn,
    voiceMeta
} from "../inspect";
import { isGalleryMedia, isVisualMedia } from "../md";
import { allVisualTiles, auditCount, exportEventsJson, getEvents, ingestVisualBatch, ledgerSession, recentEvents, searchAuditEvents, seekEvents, seekVisualEvents, startFreshSession, subscribeLedger } from "../ledger";
import { refreshCachedMedia } from "../wideCatch";
import { maskedLinks, scamHits, unicodeFlags } from "../safety";
import { TOOLS, setTool, toolOn } from "../tools";
import type { InspectTarget, LedgerEvent, LedgerMedia } from "../types";

const cl = classNameFactory("vc-hm-");
const HOST_ID = "vc-hm-host";

type Tab = "feed" | "media" | "people" | "inspect" | "safety" | "tools" | "export";
type FeedKind = "send" | "edit" | "delete" | "vc-join" | "vc-leave" | "vc-move" | "avatar" | "name" | "stream" | "camera" | "roles" | "timeout" | "call";

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let open = true;
let tab: Tab = "feed";
let target: InspectTarget | null = null;
let lastEvent: LedgerEvent | null = null;
let query = "";
const feedOn = new Set<FeedKind>();
let followLive = true;
let freezeAt = 0;
let pointerBusy = false;
let closeArmed = false;
let sessionCleared = false;
let mediaScrollBusy = false;
const MEDIA_DM = "dm";
const mediaGuildOff = new Set<string>();
const listeners = new Set<() => void>();

function holdPointer() {
    if (pointerBusy) return;
    pointerBusy = true;
    const done = () => {
        pointerBusy = false;
        window.removeEventListener("pointerup", done, true);
        window.removeEventListener("pointercancel", done, true);
    };
    window.addEventListener("pointerup", done, true);
    window.addEventListener("pointercancel", done, true);
}

function onAct(fn: () => void) {
    return (e: { button?: number; stopPropagation(): void; preventDefault(): void; }) => {
        if (e.button != null && e.button !== 0) return;
        holdPointer();
        e.stopPropagation();
        fn();
    };
}

function onPick(fn: () => void) {
    return (e: { button?: number; target?: EventTarget | null; stopPropagation(): void; }) => {
        if (e.button != null && e.button !== 0) return;
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("button")) return;
        e.stopPropagation();
        fn();
    };
}

function emit() {
    for (const fn of listeners) fn();
}

function nativeApi() {
    if (IS_WEB) return undefined;
    return VencordNative.pluginHelpers.StalkerMode as PluginNative<typeof import("../native")> | undefined;
}

export function subscribeOverlay(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

export function isOpen() {
    return open;
}

export function setInspectTarget(next: InspectTarget | null) {
    target = next;
    if (next) {
        open = true;
        tab = "inspect";
    }
    emit();
}

function inspectPerson(userId?: string, extra?: { guildId?: string; channelId?: string; messageId?: string; }) {
    if (!userId) return;
    setInspectTarget({
        kind: "user",
        id: userId,
        extra: extra?.guildId,
        channelId: extra?.channelId,
        messageId: extra?.messageId
    });
}

function latestMessageFor(userId: string) {
    const all = getEvents();
    for (let i = all.length - 1; i >= 0; i--) {
        const ev = all[i];
        if (ev.userId === userId && ev.channelId && ev.messageId) return ev;
    }
    return null;
}

function setLastEvent(ev: LedgerEvent | null) {
    lastEvent = ev;
    emit();
}

export function toggleOverlay() {
    open = !open;
    emit();
}

export function showOverlay() {
    open = true;
    emit();
}

function useOverlay() {
    const [, bump] = useState(0);
    useEffect(() => {
        let raf = 0;
        const fn = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                bump(n => n + 1);
            });
        };
        listeners.add(fn);
        return () => {
            listeners.delete(fn);
            if (raf) cancelAnimationFrame(raf);
        };
    }, []);
    return { open, tab, target, query, followLive };
}

function goLive() {
    followLive = true;
    freezeAt = 0;
    mediaScrollBusy = false;
    const box = host?.querySelectorAll(".vc-hm-window");
    box?.forEach(el => { (el as HTMLElement).scrollTop = 0; });
    emit();
}

function setTab(next: Tab) {
    tab = next;
    emit();
}

function ageLine(id: string) {
    const created = snowflakeAt(id);
    return created ? `${created.local} · ${created.age}` : "unknown snowflake";
}

function shortWhen(at: number) {
    const d = new Date(at);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function mediaSentAt(at?: number, messageId?: string) {
    const ms = Number(at) || snowflakeAt(String(messageId || ""))?.ms || 0;
    return ms > 1e11 ? ms : 0;
}

function mediaAge(at?: number, messageId?: string, now = Date.now()) {
    const ms = mediaSentAt(at, messageId);
    if (!ms) return "";
    const diff = Math.max(0, now - ms);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${sec % 60}s`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ${min % 60}m`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d`;
    if (day < 365) return `${Math.floor(day / 7)}w`;
    return `${Math.floor(day / 365)}y`;
}

function TileWhen({ at, messageId, now }: { at?: number; messageId?: string; now: number; }) {
    const label = mediaAge(at, messageId, now);
    if (!label) return null;
    const ms = mediaSentAt(at, messageId);
    return (
        <span className={cl("tile-when")} title={ms ? new Date(ms).toLocaleString() : ""}>
            {label}
        </span>
    );
}

function defaultAvatar(id?: string) {
    if (!id) return "https://cdn.discordapp.com/embed/avatars/0.png";
    try {
        return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) >> 22n) % 6}.png`;
    } catch {
        return "https://cdn.discordapp.com/embed/avatars/0.png";
    }
}

function actorOf(userId?: string, fallback?: string) {
    const user = userId ? UserStore.getUser(userId) as any : null;
    const display = String(user?.globalName || user?.global_name || fallback || user?.username || userId || "System");
    let username = user?.username ? `@${user.username}` : "";
    if (!username && fallback && !/\s/.test(fallback) && fallback.replace(/^@/, "") !== display)
        username = `@${String(fallback).replace(/^@/, "")}`;
    let src = "";
    try {
        if (user)
            src = IconUtils.getUserAvatarURL(user, false, 32) || user.getAvatarURL?.(undefined, 32, true) || "";
    } catch { /* ignore */ }
    if (!src) src = defaultAvatar(userId);
    return { display, username, src, userId };
}

function Actor({ userId, name, faceOnly, extra, channelId, messageId }: { userId?: string; name?: string; faceOnly?: boolean; extra?: string; channelId?: string; messageId?: string; }) {
    if (!userId && !name) return null;
    const a = actorOf(userId, name);
    return (
        <button
            type="button"
            className={cl("actor", { face: faceOnly })}
            onPointerDown={onAct(() => {
                if (userId) inspectPerson(userId, { guildId: extra, channelId, messageId });
            })}
        >
            <img className={cl("ava")} src={a.src} alt="" />
            {!faceOnly && (
                <span className={cl("actor-text")}>
                    <span className={cl("actor-name")}>{a.display}</span>
                    {a.username ? <span className={cl("actor-user")}>{a.username}</span> : null}
                </span>
            )}
        </button>
    );
}

function Section({ title, children }: { title: string; children?: any; }) {
    if (children == null || children === false) return null;
    return (
        <section className={cl("sec")}>
            <h3 className={cl("sec-title")}>{title}</h3>
            {children}
        </section>
    );
}

function Facts({ rows }: { rows: Array<{ k: string; v?: string | number | null; mono?: boolean; }>; }) {
    const shown = rows.filter(r => r.v != null && String(r.v).trim() !== "");
    if (!shown.length) return null;
    return (
        <div className={cl("facts")}>
            {shown.map(r => (
                <button
                    key={r.k}
                    type="button"
                    className={cl("fact")}
                    title="Click to copy"
                    onPointerDown={onAct(() => copyWithToast(String(r.v), `${r.k} copied`))}
                >
                    <span className={cl("fact-k")}>{r.k}</span>
                    <span className={cl("fact-v", { mono: r.mono })}>{String(r.v)}</span>
                </button>
            ))}
        </div>
    );
}

function Pills({ items }: { items: Array<{ text: string; color?: string; }>; }) {
    if (!items.length) return null;
    return (
        <div className={cl("pills")}>
            {items.map(item => (
                <span
                    key={item.text}
                    className={cl("pill")}
                    style={item.color ? { ["--hm-pill" as any]: item.color } : undefined}
                >
                    {item.color ? <i className={cl("pill-dot")} /> : null}
                    {item.text}
                </span>
            ))}
        </div>
    );
}

function Place({ channelId, guildId }: { channelId?: string; guildId?: string; }) {
    const channel = channelId ? ChannelStore.getChannel(channelId) as any : null;
    const guild = GuildStore.getGuild(guildId || channel?.guild_id);
    const label = channel?.name ? `#${channel.name}` : guild?.name || channelId || "";
    if (!label) return null;
    let icon = "";
    try {
        if (guild)
            icon = IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 32 }) || "";
    } catch { /* ignore */ }
    return (
        <button
            type="button"
            className={cl("place")}
            title={guild?.name ? `${guild.name}${channel?.name ? ` · #${channel.name}` : ""}` : label}
            onPointerDown={onAct(() => {
                if (channelId) openChannel(channelId);
            })}
        >
            {icon
                ? <img src={icon} alt="" />
                : <span className={cl("place-fallback")}>{(guild?.name || channel?.name || "#").slice(0, 1).toUpperCase()}</span>}
            <span>{label}</span>
        </button>
    );
}

function shortCaption(text?: string, max = 180) {
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function previewText(text?: string) {
    return String(text || "").replace(/\r\n/g, "\n").trim().slice(0, 500);
}

function bareMediaKey(url: string) {
    return String(url || "").split("?")[0];
}

const unshowable = new Set<string>();
const unshowListeners = new Set<() => void>();

function hideUnshowable(key: string) {
    if (!key || unshowable.has(key)) return;
    unshowable.add(key);
    for (const listener of unshowListeners) listener();
}

function subscribeUnshowable(listener: () => void) {
    unshowListeners.add(listener);
    return () => { unshowListeners.delete(listener); };
}

function isBotAuthor(ev: LedgerEvent) {
    if (isBotUser(ev.userId)) return true;
    if (ev.userId && getDossier(ev.userId)?.bot) return true;
    if (!ev.channelId || !ev.messageId) return false;
    try {
        const msg = MessageStore.getMessage(ev.channelId, ev.messageId) as { author?: { id?: string; bot?: boolean; }; } | undefined;
        if (msg?.author?.bot) {
            noteBotAuthor(msg.author);
            return true;
        }
    } catch { /* ignore */ }
    return false;
}

function galleryIdentity(item: LedgerMedia) {
    const sha = contentHashOf(item);
    if (sha) return `sha:${sha}`;
    const url = bareMediaKey(item.url).toLowerCase();
    const external = url.match(/\/external\/([^/]+)\//);
    if (external) return `ext:${external[1]}`;
    const sticker = url.match(/\/stickers\/(\d+)/);
    if (sticker) return `stk:${sticker[1]}`;
    return `url:${url}`;
}

function shortAction(ev: LedgerEvent, actorName: string) {
    const media = ev.media || [];
    if (ev.type === "send") return media.length ? `sent ${mediaNoun(media)}` : "sent a message";
    if (media.length && (ev.type === "mention" || ev.type === "reply" || ev.type === "everyone"))
        return `${mediaVerb(ev.type)} ${mediaNoun(media)}`;
    if (media.length && ev.type !== "edit" && ev.type !== "delete") return `${mediaVerb(ev.type)} ${mediaNoun(media)}`;
    if (ev.type === "delete") return "deleted a message";
    if (ev.type === "edit") return "edited a message";
    if (ev.type === "ghost-ping") return "ghost ping";
    if (ev.type === "mention") return "mentioned you";
    if (ev.type === "reply") return "replied to you";
    if (ev.type === "everyone") return "@everyone";
    if (ev.type === "voice") {
        const s = String(ev.summary || "");
        if (/\bjoined\b/.test(s)) return "joined VC";
        if (/\bleft\b/.test(s)) return "left VC";
        if (/\bmoved\b/.test(s)) return "moved VC";
        return "voice";
    }
    if (ev.type === "stream") return "started streaming";
    if (ev.type === "camera") return "turned on camera";
    if (ev.type === "reaction") return String(ev.summary || "").includes(" removed ")
        ? `removed ${ev.preview || "reaction"}`
        : `reacted ${ev.preview || ""}`.trim();
    if (ev.type === "roles") return "roles changed";
    if (ev.type === "timeout") return "timeout";
    if (ev.type === "pins") return "pins changed";
    if (ev.type === "call") return String(ev.summary || "").toLowerCase().includes("ended") ? "call ended" : "call started";
    const summary = String(ev.summary || "")
        .replace(actorName, "")
        .replace(/^[\s·:-]+/, "")
        .replace(/\s+/g, " ")
        .trim();
    return (summary || ev.type).slice(0, 64);
}

function mediaBadge(item: LedgerMedia) {
    const fromName = String(item.name || item.url || "").split("?")[0];
    const ext = fromName.match(/\.([a-z0-9]{2,5})$/i)?.[1];
    if (item.kind === "gif") return "GIF";
    if (item.kind === "video") return (ext || "MP4").toUpperCase();
    if (item.kind === "audio") return (ext || "AUDIO").toUpperCase();
    if (ext) return ext.toUpperCase();
    return item.kind === "image" ? "IMG" : "FILE";
}

function previewInDiscord(item: LedgerMedia, channelId?: string, messageId?: string) {
    const fresh = resolveLiveMedia(item, channelId, messageId);
    const local = keptSrc(fresh);
    const mime = keptMime(fresh);
    if (channelId && messageId) jumpToMessage(channelId, messageId);
    if (!isVisualMedia(fresh)) return;
    const liveMsg = channelId && messageId ? MessageStore.getMessage(channelId, messageId) : null;
    const url = local || (liveMsg ? fresh.url : "");
    if (!url) return;
    try {
        if (mime.startsWith("video/") || (!local && fresh.kind === "video")) {
            openMediaModal({
                items: [{ type: "VIDEO", url, original: url, width: 1280, height: 720 }],
                shouldHideMediaOptions: true
            });
            return;
        }
        if (mime.startsWith("audio/") || fresh.kind === "audio") return;
        openImageModal(
            {
                url,
                original: url,
                width: 1024,
                height: 1024,
                animated: fresh.kind === "gif"
            },
            { shouldHideMediaOptions: true }
        );
    } catch {
        /* jump is enough */
    }
}

function Shot({
    item,
    channelId,
    messageId,
    grid,
    eager,
    failKey
}: {
    item: LedgerMedia;
    channelId?: string;
    messageId?: string;
    large?: boolean;
    grid?: boolean;
    eager?: boolean;
    failKey?: string;
}) {
    const fresh = grid ? item : resolveLiveMedia(item, channelId, messageId);
    const px = grid ? 128 : 80;
    const [pin, setPin] = useState(() => keptSrc(fresh));
    const [pinSettled, setPinSettled] = useState(() => Boolean(keptSrc(fresh)));
    const [tryAt, setTryAt] = useState(0);
    const [imgDead, setImgDead] = useState(false);
    const [playDead, setPlayDead] = useState(false);
    const [audioDead, setAudioDead] = useState(false);

    useEffect(() => {
        let gone = false;
        setImgDead(false);
        setPlayDead(false);
        setAudioDead(false);
        setTryAt(0);
        const already = keptSrc(fresh);
        setPin(already);
        setPinSettled(Boolean(already));
        void pinKeptMedia(fresh).then(src => {
            if (gone) return;
            setPinSettled(true);
            if (!src) return;
            setPin(src);
            setImgDead(false);
            setPlayDead(false);
            setAudioDead(false);
            setTryAt(0);
        });
        return () => { gone = true; };
    }, [fresh.url, fresh.id, px]);

    const mime = keptMime(fresh);
    const candidates = fastSrcs(fresh, px);
    const local = pin || keptSrc(fresh);
    const audio = fresh.kind === "audio" || isAudioFile(fresh.url) || mime.startsWith("audio/");
    const videoFile = fresh.kind === "video" || isVideoFile(fresh.url) || mime.startsWith("video/");
    const src = imgDead ? (mime.startsWith("image/") ? local : "") : (candidates[tryAt] || local);
    const videoUrl = mime.startsWith("video/") && local
        ? local
        : videoFile
            ? (local || fresh.url)
            : imgDead && /\/(?:ephemeral-)?attachments\//i.test(fresh.url)
                ? (local || fresh.url)
                : "";
    const visual = isVisualMedia(fresh);
    const showAudio = audio && !audioDead;
    const showImg = !showAudio && Boolean(src) && !mime.startsWith("video/");
    const showVideo = !playDead && !showAudio && !showImg && Boolean(videoUrl);
    const broken = pinSettled && !showImg && !showVideo && !showAudio;

    useEffect(() => {
        if (!grid || !failKey || !broken) return;
        hideUnshowable(failKey);
    }, [grid, failKey, broken]);

    if (grid && broken) return null;

    return (
        <button
            type="button"
            className={cl("shot-wrap", { grid, local: !visual || (!showImg && !showVideo && !audio) })}
            title={fresh.name || fresh.kind}
            onPointerDown={onAct(() => {
                previewInDiscord(fresh, channelId, messageId);
            })}
        >
            {showAudio
                ? (
                    <audio
                        className={cl("shot")}
                        src={local || fresh.url}
                        controls
                        preload="metadata"
                        onPointerDown={e => e.stopPropagation()}
                        onError={() => setAudioDead(true)}
                    />
                )
                : showImg
                    ? (
                        <img
                            className={cl("shot")}
                            src={src}
                            alt=""
                            decoding="async"
                            loading="eager"
                            fetchPriority={grid ? "high" : "low"}
                            onLoad={() => {
                                if (src.startsWith("http")) rememberGoodSrc(fresh, src);
                            }}
                            onError={() => {
                                if (tryAt + 1 < candidates.length) setTryAt(n => n + 1);
                                else if (local && src !== local && !mime.startsWith("video/")) {
                                    const at = candidates.indexOf(local);
                                    if (at >= 0) setTryAt(at);
                                    else setImgDead(true);
                                } else setImgDead(true);
                            }}
                        />
                    )
                    : showVideo
                        ? (
                            <video
                                className={cl("shot")}
                                src={videoUrl}
                                muted
                                playsInline
                                preload="metadata"
                                onLoadedData={e => {
                                    try { e.currentTarget.currentTime = 0.05; } catch { /* ignore */ }
                                }}
                                onError={() => setPlayDead(true)}
                            />
                        )
                        : (
                            <>
                                <span className={cl("shot-kind")}>{fresh.spoiler ? "SPOILER" : mediaBadge(fresh)}</span>
                                <span className={cl("shot-name")}>{(fresh.name || fresh.kind).replace(/^SPOILER_/i, "").slice(0, 16)}</span>
                            </>
                        )}
            {visual && <span className={cl("badge")}>{fresh.spoiler ? "SPOILER" : mediaBadge(fresh)}</span>}
        </button>
    );
}

function MediaStrip({ items, channelId, messageId }: { items?: LedgerMedia[]; channelId?: string; messageId?: string; large?: boolean; }) {
    if (!items?.length) return null;
    return (
        <div className={cl("media")}>
            {items.filter(isVisualMedia).slice(0, 8).map((item, i) => (
                <Shot
                    key={`${item.id || item.url}-${i}`}
                    item={item}
                    channelId={channelId}
                    messageId={messageId}
                    eager={i < 2}
                />
            ))}
        </div>
    );
}

function mediaVerb(type: string) {
    if (type === "delete" || type === "ghost-ping" || type === "bulk-delete") return "deleted";
    if (type === "edit") return "edited";
    if (type === "spoiler") return "spoilered";
    if (type === "embed") return "embedded";
    return "sent";
}

function mediaNoun(items: LedgerMedia[]) {
    const count = (kind: LedgerMedia["kind"]) => items.filter(item => item.kind === kind).length;
    const bits: string[] = [];
    const push = (n: number, one: string, many: string) => {
        if (n === 1) bits.push(one);
        else if (n > 1) bits.push(`${n} ${many}`);
    };
    push(count("gif"), "a gif", "gifs");
    push(count("image"), "a photo", "photos");
    push(count("video"), "a video", "videos");
    push(count("audio"), "audio", "audio files");
    push(count("file"), "a file", "files");
    return bits.join(" + ") || "media";
}

function EventCard({ ev, warn }: { ev: LedgerEvent; warn?: boolean; }) {
    const media = ev.media || [];
    const actor = actorOf(ev.userId, ev.userName);
    const action = shortAction(ev, actor.display);
    const deleted = ev.type === "delete" || ev.type === "ghost-ping" || ev.type === "bulk-delete";
    const edited = ev.type === "edit";
    const before = previewText(ev.preview);
    const after = previewText(ev.previewAfter);
    const selected = lastEvent?.id === ev.id;
    const inspect = () => {
        inspectPerson(ev.userId, { guildId: ev.guildId, channelId: ev.channelId, messageId: ev.messageId });
    };
    return (
        <div
            className={cl("card", { warn: warn || ev.severity === "warn" || deleted, on: selected, deleted })}
            onPointerDown={onPick(() => setLastEvent(ev))}
        >
            <div className={cl("msg")}>
                <Actor userId={ev.userId} name={ev.userName} faceOnly extra={ev.guildId} channelId={ev.channelId} messageId={ev.messageId} />
                <div className={cl("msg-body")}>
                    <div className={cl("msg-head")}>
                        <button type="button" className={cl("who")} onPointerDown={onAct(inspect)}>
                            <span className={cl("from-name")}>{actor.display}</span>
                            {actor.username ? <span className={cl("from-user")}>{actor.username}</span> : null}
                        </button>
                        <span className={cl("when")}>{shortWhen(ev.at)}</span>
                    </div>
                    <div className={cl("did")}>{action}</div>
                    {edited ? (
                        <div className={cl("diff")}>
                            {before ? (
                                <div className={cl("diff-block")}>
                                    <div className={cl("diff-tag")}>Before</div>
                                    <div className={cl("diff-text", "before")}>{before}</div>
                                </div>
                            ) : null}
                            {after ? (
                                <div className={cl("diff-block")}>
                                    <div className={cl("diff-tag")}>After</div>
                                    <div className={cl("diff-text", "after")}>{after}</div>
                                </div>
                            ) : null}
                            {!before && !after ? <div className={cl("caption")}>Edited (no text)</div> : null}
                        </div>
                    ) : deleted ? (
                        <div className={cl("caption", "gone")}>{before || "(no text)"}</div>
                    ) : (
                        before ? <div className={cl("caption")}>{shortCaption(before)}</div> : null
                    )}
                    <MediaStrip items={media} channelId={ev.channelId} messageId={ev.messageId} />
                    <Place channelId={ev.channelId} guildId={ev.guildId} />
                    <SideActions ev={ev} />
                </div>
            </div>
        </div>
    );
}

function SideActions({ ev }: { ev: LedgerEvent; }) {
    const jump = Boolean(ev.messageId && ev.channelId);
    const join = Boolean(ev.voiceChannelId);
    const open = Boolean(ev.channelId && !jump && !join);
    if (!jump && !join && !open) return null;
    return (
        <div className={cl("side")}>
            {jump && <button type="button" onPointerDown={onAct(() => jumpToMessage(ev.channelId, ev.messageId))}>Jump</button>}
            {join && <button type="button" onPointerDown={onAct(() => joinVoice(ev.voiceChannelId))}>Join</button>}
            {open && <button type="button" onPointerDown={onAct(() => openChannel(ev.channelId))}>Open</button>}
        </div>
    );
}

type MediaTile = { ev: LedgerEvent; item: LedgerMedia; key: string; };

function tileGuildId(ev: LedgerEvent) {
    const fromEv = String(ev.guildId || "");
    if (fromEv) return fromEv;
    try {
        const gid = ChannelStore.getChannel(ev.channelId)?.guild_id;
        if (gid) return String(gid);
    } catch { /* dm */ }
    return MEDIA_DM;
}

function mediaGuildOn(id: string) {
    return !mediaGuildOff.has(id);
}

function toggleMediaGuild(id: string) {
    if (mediaGuildOff.has(id)) mediaGuildOff.delete(id);
    else mediaGuildOff.add(id);
    mediaScrollBusy = false;
    emit();
}

function mediaServerList() {
    const out: Array<{ id: string; name: string; icon: string; initials: string; }> = [
        { id: MEDIA_DM, name: "DMs", icon: "", initials: "DM" }
    ];
    let guilds: any[] = [];
    try {
        guilds = Object.values(GuildStore.getGuilds?.() || {});
    } catch { /* ignore */ }
    guilds.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" }));
    for (const g of guilds) {
        if (!g?.id) continue;
        let icon = "";
        try {
            icon = IconUtils.getGuildIconURL({ id: g.id, icon: g.icon, size: 32 }) || "";
        } catch { /* ignore */ }
        const initials = String(g.name || "?")
            .split(/\s+/)
            .map((w: string) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();
        out.push({ id: String(g.id), name: String(g.name || g.id), icon, initials });
    }
    return out;
}

function MediaServerBar() {
    const bar = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = bar.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (!e.deltaY || e.deltaX) return;
            el.scrollLeft += e.deltaY;
            e.preventDefault();
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);
    const servers = mediaServerList();
    return (
        <div ref={bar} className={cl("server-bar")} role="list">
            {servers.map(s => {
                const on = mediaGuildOn(s.id);
                return (
                    <button
                        key={s.id}
                        type="button"
                        role="listitem"
                        className={cl("server-chip", { on, off: !on })}
                        title={on ? `Hide ${s.name}` : `Show ${s.name}`}
                        onPointerDown={onAct(() => toggleMediaGuild(s.id))}
                    >
                        {s.icon
                            ? <img className={cl("server-icon")} src={s.icon} alt="" />
                            : <span className={cl("server-fallback")}>{s.initials}</span>}
                        <span className={cl("server-name")}>{s.name}</span>
                    </button>
                );
            })}
        </div>
    );
}

function MediaTab({ live }: { live: boolean; }) {
    const q = query.trim().toLowerCase();
    const [rev, bump] = useState(0);
    useEffect(() => {
        refreshCachedMedia();
        let gone = false;
        const more = () => {
            if (gone || !followLive || mediaScrollBusy) return;
            void seekVisualEvents(0, 400).then(list => {
                if (gone || !list.length) return;
                ingestVisualBatch(list);
            });
        };
        const pinRecent = () => {
            let n = 0;
            for (const row of allVisualTiles()) {
                if (!isGalleryMedia(row.item) || isBotAuthor(row.ev)) continue;
                void pinKeptMedia(row.item);
                if (++n >= 24) break;
            }
        };
        more();
        const unsub = subscribeLedger(() => {
            pinRecent();
            bump(n => n + 1);
        });
        const unsubHash = subscribeContentHash(() => bump(n => n + 1));
        const unsubHide = subscribeUnshowable(() => bump(n => n + 1));
        pinRecent();
        return () => {
            gone = true;
            unsub();
            unsubHash();
            unsubHide();
        };
    }, []);
    const tiles = useMemo(() => {
        const seen = new Set<string>();
        const next: MediaTile[] = [];
        const push = (ev: LedgerEvent, item: LedgerMedia) => {
            if (!isGalleryMedia(item) || isBotAuthor(ev)) return;
            const key = galleryIdentity(item);
            if (unshowable.has(key)) return;
            if (seen.has(key)) return;
            seen.add(key);
            if (q) {
                const hit = (ev.userName || "").toLowerCase().includes(q)
                    || (ev.userId || "").includes(q)
                    || (item.name || "").toLowerCase().includes(q)
                    || (ev.channelId || "").includes(q);
                if (!hit) return;
            }
            next.push({ ev, item, key });
        };
        for (const row of allVisualTiles()) push(row.ev, row.item);
        next.sort((a, b) => (b.ev.at || 0) - (a.ev.at || 0));
        return next;
    }, [q, rev]);
    const visible = tiles.filter(row => mediaGuildOn(tileGuildId(row.ev)));

    return (
        <div className={cl("media-pane")}>
            <MediaServerBar />
            <div className={cl("media-bar")}>{visible.length} photos, gifs, and videos — live at the top. Scroll to keep your place; new media still stacks above.</div>
            <MediaGrid
                items={visible}
                live={live}
                filterKey={[...mediaGuildOff].sort().join(",")}
                empty={<div className={cl("empty")}>{q ? "No matching media." : visible.length !== tiles.length ? "All media from these servers is hidden. Click a server above to show it." : "No photos, gifs, or videos in cached channels yet. Open servers or stay on Live — every image this client sees is added here."}</div>}
            />
        </div>
    );
}

function MediaGrid({ items, empty, filterKey, live }: { items: MediaTile[]; empty?: any; filterKey?: string; live: boolean; }) {
    const ref = useRef<HTMLDivElement>(null);
    const pinKey = useRef("");
    const raf = useRef(0);
    const [top, setTop] = useState(0);
    const [view, setView] = useState(400);
    const [width, setWidth] = useState(360);
    const [now] = useState(() => Date.now());
    useEffect(() => {
        pinKey.current = items[0]?.key || "";
        const el = ref.current;
        if (el) el.scrollTop = 0;
        setTop(0);
    }, [filterKey]);
    useEffect(() => {
        if (!live) return;
        pinKey.current = items[0]?.key || "";
        const el = ref.current;
        if (el) el.scrollTop = 0;
        setTop(0);
    }, [live]);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const measure = () => {
            setView(el.clientHeight || 400);
            setWidth(el.clientWidth || 360);
        };
        measure();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        return () => ro?.disconnect();
    }, []);
    useEffect(() => () => {
        if (raf.current) cancelAnimationFrame(raf.current);
        mediaScrollBusy = false;
    }, []);
    const cols = Math.max(2, Math.min(8, Math.floor(Math.max(160, width) / 108) || 2));
    const gap = 6;
    const cell = Math.max(80, Math.floor((Math.max(160, width) - 8 - gap * (cols - 1)) / cols));
    const rowH = cell + gap;
    const shown = items;
    const over = 3;
    const startRow = Math.max(0, Math.floor(top / rowH) - over);
    const visRows = Math.ceil(view / rowH) + over * 2;
    const start = startRow * cols;
    const end = Math.min(shown.length, (startRow + visRows) * cols);
    const slice = shown.slice(start, end);
    const rows = Math.ceil(shown.length / cols);
    const sliceKey = slice.map(row => row.key).join("\n");
    useLayoutEffect(() => {
        const first = items[0]?.key || "";
        if (live) {
            pinKey.current = first;
            return;
        }
        const prev = pinKey.current;
        const el = ref.current;
        if (prev && first && prev !== first && el) {
            const idx = items.findIndex(t => t.key === prev);
            if (idx > 0) {
                el.scrollTop += Math.ceil(idx / cols) * rowH;
                setTop(el.scrollTop);
            }
        }
        pinKey.current = first;
    }, [items, live, cols, rowH]);
    useLayoutEffect(() => {
        if (!slice.length) return;
        warmMedia(slice.map(row => row.item), 128);
    }, [sliceKey]);
    if (!shown.length) return empty || null;
    return (
        <div
            ref={ref}
            className={cl("window", "media-scroll")}
            onScroll={() => {
                const el = ref.current;
                if (!el) return;
                mediaScrollBusy = el.scrollTop > 24;
                if (!raf.current) {
                    raf.current = requestAnimationFrame(() => {
                        raf.current = 0;
                        const node = ref.current;
                        if (node) setTop(node.scrollTop);
                    });
                }
                if (el.scrollTop > 24 && followLive) {
                    followLive = false;
                    emit();
                }
            }}
        >
            <div className={cl("window-space")} style={{ height: rows * rowH }}>
                <div
                    className={cl("window-chunk", "gallery", "media-chunk")}
                    style={{
                        top: startRow * rowH,
                        ["--hm-cols" as any]: cols,
                        ["--hm-row" as any]: `${cell}px`,
                        ["--hm-gap" as any]: `${gap}px`
                    }}
                >
                    {slice.map(row => {
                        const actor = actorOf(row.ev.userId, row.ev.userName);
                        return (
                        <div
                            key={row.key}
                            className={cl("tile", { on: lastEvent?.id === row.ev.id })}
                            onPointerDown={onPick(() => setLastEvent(row.ev))}
                        >
                            <div className={cl("tile-frame")}>
                                <Shot
                                    item={row.item}
                                    channelId={row.ev.channelId}
                                    messageId={row.ev.messageId}
                                    grid
                                    eager
                                    failKey={row.key}
                                />
                                <TileWhen at={row.ev.at} messageId={row.ev.messageId} now={now} />
                                <button
                                    type="button"
                                    className={cl("tile-chip")}
                                    title={actor.username || actor.display}
                                    onPointerDown={onAct(() => {
                                        inspectPerson(row.ev.userId, { guildId: row.ev.guildId, channelId: row.ev.channelId, messageId: row.ev.messageId });
                                    })}
                                >
                                    <img className={cl("ava")} src={actor.src} alt="" />
                                    <span className={cl("tile-name")}>{actor.display}</span>
                                </button>
                                {row.ev.channelId && row.ev.messageId ? (
                                    <button
                                        type="button"
                                        className={cl("tile-jump")}
                                        onPointerDown={onAct(() => jumpToMessage(row.ev.channelId, row.ev.messageId))}
                                    >
                                        Jump
                                    </button>
                                ) : null}
                            </div>
                        </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function WindowList<T>({
    items,
    estimate,
    render,
    empty,
    cols = 1,
    stayLive = false
}: {
    items: T[];
    estimate: number;
    render: (item: T, index: number) => any;
    empty?: any;
    cols?: number;
    stayLive?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const chunkRef = useRef<HTMLDivElement>(null);
    const frozen = useRef<T[] | null>(null);
    const [top, setTop] = useState(0);
    const [view, setView] = useState(360);
    const [chunkH, setChunkH] = useState(0);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const measure = () => setView(el.clientHeight || 360);
        measure();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        return () => ro?.disconnect();
    }, []);
    const live = stayLive || followLive;
    if (live) frozen.current = null;
    else if (!frozen.current?.length && items.length) frozen.current = items;
    const shown = live ? items : (frozen.current?.length ? frozen.current : items);
    const over = 2;
    const startRow = Math.max(0, Math.floor(top / estimate) - over);
    const visRows = Math.ceil(view / estimate) + over * 2;
    const start = startRow * cols;
    const end = Math.min(shown.length, (startRow + visRows) * cols);
    const slice = shown.slice(start, end);
    const rows = Math.ceil(shown.length / cols);
    useLayoutEffect(() => {
        const el = chunkRef.current;
        if (!el) return;
        const measure = () => setChunkH(el.offsetHeight);
        measure();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        return () => ro?.disconnect();
    }, [slice.length, start, cols]);
    if (!shown.length) return empty || null;
    const spaceH = startRow * estimate + Math.max(chunkH, Math.ceil(slice.length / cols) * estimate) + Math.max(0, rows - startRow - Math.ceil(slice.length / cols)) * estimate;
    return (
        <div
            ref={ref}
            className={cl("window")}
            onScroll={e => {
                const el = e.currentTarget as HTMLDivElement;
                setTop(el.scrollTop);
                if (stayLive) return;
                const atTop = el.scrollTop <= 24;
                if (atTop) {
                    if (!followLive) {
                        followLive = true;
                        freezeAt = 0;
                        emit();
                    }
                } else if (followLive) {
                    followLive = false;
                    freezeAt = auditCount();
                    emit();
                }
            }}
        >
            <div className={cl("window-space")} style={{ height: spaceH }}>
                <div
                    ref={chunkRef}
                    className={cl("window-chunk", { gallery: cols > 1 })}
                    style={{ top: startRow * estimate, ["--hm-cols" as any]: cols }}
                >
                    {slice.map((item, i) => render(item, start + i))}
                </div>
            </div>
        </div>
    );
}

function eventHits(ev: LedgerEvent, id: FeedKind) {
    const summary = String(ev.summary || "");
    switch (id) {
        case "send":
            return ev.type === "send" || ev.type === "mention" || ev.type === "reply" || ev.type === "everyone" || ev.type === "media";
        case "edit":
            return ev.type === "edit";
        case "delete":
            return ev.type === "delete" || ev.type === "bulk-delete" || ev.type === "ghost-ping";
        case "vc-join":
            return ev.type === "voice" && /\bjoined\b/i.test(summary);
        case "vc-leave":
            return ev.type === "voice" && /\bleft\b/i.test(summary);
        case "vc-move":
            return ev.type === "voice" && /\bmoved\b/i.test(summary);
        case "avatar":
            return ev.type === "identity" && /avatar/i.test(summary);
        case "name":
            return ev.type === "identity" && /username |display |nick →/i.test(summary);
        case "stream":
            return ev.type === "stream";
        case "camera":
            return ev.type === "camera";
        case "roles":
            return ev.type === "roles";
        case "timeout":
            return ev.type === "timeout";
        case "call":
            return ev.type === "call";
        default:
            return false;
    }
}

function feedVisible(ev: LedgerEvent) {
    if (!feedOn.size) return true;
    for (const id of feedOn) {
        if (eventHits(ev, id)) return true;
    }
    return false;
}

function textHit(ev: LedgerEvent, q: string) {
    const n = q.toLowerCase();
    return String(ev.summary || "").toLowerCase().includes(n)
        || ev.type.toLowerCase().includes(n)
        || (ev.userName || "").toLowerCase().includes(n)
        || (ev.preview || "").toLowerCase().includes(n)
        || (ev.previewAfter || "").toLowerCase().includes(n)
        || (ev.userId || "").includes(q);
}

function FeedIcon({ id }: { id: FeedKind; }) {
    const common = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    if (id === "send") return <svg {...common}><path d="M5 6h14v9H8l-3 3V6z" /></svg>;
    if (id === "edit") return <svg {...common}><path d="M4 16.5V20h3.5L19 8.5 15.5 5 4 16.5z" /><path d="M13.5 7l3.5 3.5" /></svg>;
    if (id === "delete") return <svg {...common}><path d="M5 7h14M9 7V5h6v2M8 7l1 13h6l1-13" /></svg>;
    if (id === "vc-join") return <svg {...common}><path d="M10 5h9v14h-9" /><path d="M4 12h9M10 8l4 4-4 4" /></svg>;
    if (id === "vc-leave") return <svg {...common}><path d="M14 5h6v14h-6" /><path d="M13 12H4M8 8L4 12l4 4" /></svg>;
    if (id === "vc-move") return <svg {...common}><path d="M8 7L4 11l4 4M4 11h8M16 17l4-4-4-4M20 13H12" /></svg>;
    if (id === "avatar") return <svg {...common}><circle cx="12" cy="9" r="3.2" /><path d="M6.5 19c1.1-2.8 3-4.2 5.5-4.2s4.4 1.4 5.5 4.2" /></svg>;
    if (id === "name") return <svg {...common}><path d="M5 18L9.2 6h2.1L16 18M7.2 13.5h6.2" /></svg>;
    if (id === "stream") return <svg {...common}><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M10 9.2l5 2.8-5 2.8z" fill="currentColor" stroke="none" /></svg>;
    if (id === "camera") return <svg {...common}><rect x="3" y="7" width="12" height="10" rx="2" /><path d="M15 11l6-3v8l-6-3" /></svg>;
    if (id === "roles") return <svg {...common}><path d="M12 3l7 3v6c0 4.2-2.8 6.6-7 8.5C7.8 18.6 5 16.2 5 12V6l7-3z" /></svg>;
    if (id === "timeout") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>;
    return <svg {...common}><path d="M8 4h3l1.4 3.6-2 .9a9 9 0 004.1 4.1l.9-2L19 12v3c0 .8-.7 1.6-1.6 1.6C10.2 16.6 7.4 9.6 7.4 5.6 7.4 4.7 8 4 8 4z" /></svg>;
}

const FEED_FILTERS: Array<{ id: FeedKind; title: string; }> = [
    { id: "send", title: "Sent a message" },
    { id: "edit", title: "Edited" },
    { id: "delete", title: "Deleted" },
    { id: "vc-join", title: "Joined VC" },
    { id: "vc-leave", title: "Left VC" },
    { id: "vc-move", title: "Moved VC" },
    { id: "avatar", title: "Changed avatar" },
    { id: "name", title: "Changed name" },
    { id: "stream", title: "Started streaming" },
    { id: "camera", title: "Camera on" },
    { id: "roles", title: "Roles changed" },
    { id: "timeout", title: "Timeout" },
    { id: "call", title: "Call" }
];

function FeedFilters() {
    return (
        <div className={cl("filters")}>
            {FEED_FILTERS.map(item => (
                <button
                    key={item.id}
                    type="button"
                    className={cl("filter", { on: feedOn.has(item.id) })}
                    title={item.title}
                    aria-label={item.title}
                    onPointerDown={onAct(() => {
                        if (feedOn.has(item.id)) feedOn.delete(item.id);
                        else feedOn.add(item.id);
                        emit();
                    })}
                >
                    <FeedIcon id={item.id} />
                </button>
            ))}
        </div>
    );
}

function FeedTab() {
    return <FileFeed />;
}

function FileFeed() {
    const q = query.trim();
    const ref = useRef<HTMLDivElement>(null);
    const searchAll = useRef<LedgerEvent[]>([]);
    const searchReady = useRef(false);
    const scrollRaf = useRef(0);
    const scrollY = useRef(0);
    const rowLock = useRef(-1);
    const [top, setTop] = useState(0);
    const [view, setView] = useState(360);
    const [tick, setTick] = useState(0);
    const [disk, setDisk] = useState<{ index: number; list: LedgerEvent[]; } | null>(null);
    const estimate = 176;

    const session = ledgerSession();
    const filtering = feedOn.size > 0;
    const filterKey = filtering ? [...feedOn].sort().join("|") : "";
    useEffect(() => {
        let raf = 0;
        const off = subscribeLedger(() => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                setTick(n => n + 1);
            });
        });
        return () => {
            if (raf) cancelAnimationFrame(raf);
            off();
        };
    }, []);
    useEffect(() => {
        setDisk(null);
        setTop(0);
        const el = ref.current;
        if (el) el.scrollTop = 0;
    }, [session]);
    useEffect(() => {
        setTop(0);
        rowLock.current = -1;
        const el = ref.current;
        if (el) el.scrollTop = 0;
    }, [filterKey]);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const measure = () => setView(el.clientHeight || 360);
        measure();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        return () => ro?.disconnect();
    }, []);

    useEffect(() => {
        searchAll.current = [];
        searchReady.current = false;
        setDisk(null);
    }, [q]);

    const startRow = Math.max(0, Math.floor(top / estimate) - 4);
    const vis = Math.min(80, Math.ceil(view / estimate) + 10);
    const liveTotal = auditCount();
    const pinned = followLive ? liveTotal : (freezeAt || liveTotal);
    const drift = followLive ? 0 : Math.max(0, liveTotal - pinned);
    const index = startRow + drift;
    let total = q ? searchAll.current.length : pinned;
    let rows: LedgerEvent[] = [];
    if (q && searchReady.current) {
        rows = searchAll.current.slice(startRow, startRow + vis);
        total = searchAll.current.length;
    } else if (!q) {
        const ram = recentEvents(index + vis);
        if (index < ram.length) rows = ram.slice(index, index + vis);
        else if (disk && disk.index === index) rows = disk.list;
    }
    if (filtering) {
        const base = q && searchReady.current ? searchAll.current : recentEvents(2000);
        const matched = base.filter(ev => feedVisible(ev) && (!q || textHit(ev, q)));
        total = matched.length;
        rows = matched.slice(startRow, startRow + vis);
    }
    void tick;

    useEffect(() => {
        if (!q) return;
        let gone = false;
        const timer = setTimeout(() => {
            void (async () => {
                if (!searchReady.current) {
                    searchAll.current = await searchAuditEvents(q);
                    searchReady.current = true;
                }
                if (!gone) setTick(n => n + 1);
            })();
        }, 80);
        return () => {
            gone = true;
            clearTimeout(timer);
        };
    }, [q, startRow]);

    useEffect(() => {
        if (q) return;
        const ram = recentEvents(index + vis);
        if (filtering || index < ram.length) return;
        let gone = false;
        const timer = setTimeout(() => {
            void seekEvents(index, vis).then(list => {
                if (!gone) setDisk({ index, list });
            });
        }, 40);
        return () => {
            gone = true;
            clearTimeout(timer);
        };
    }, [q, index, vis, filtering]);

    if (filtering && !rows.length && !q) {
        return <div className={cl("empty")}>Nothing for these filters.</div>;
    }
    if (!rows.length && liveTotal === 0 && !q) {
        return <div className={cl("empty")}>{sessionCleared ? "Cache cleared for this session. New messages, voice, and profile changes will show up here." : "Waiting for messages from servers, DMs, and groups. Stay in Discord — every channel this client sees is logged."}</div>;
    }
    if (!rows.length && q && searchReady.current) {
        return <div className={cl("empty")}>No matching events.</div>;
    }

    const spaceH = Math.max(total, startRow + rows.length) * estimate;

    return (
        <div
            ref={ref}
            className={cl("window")}
            onScroll={e => {
                const el = e.currentTarget as HTMLDivElement;
                scrollY.current = el.scrollTop;
                if (scrollRaf.current) return;
                scrollRaf.current = requestAnimationFrame(() => {
                    scrollRaf.current = 0;
                    const y = scrollY.current;
                    const atTop = y <= 24;
                    if (atTop) {
                        if (!followLive) {
                            followLive = true;
                            freezeAt = 0;
                            emit();
                        }
                    } else if (followLive) {
                        followLive = false;
                        freezeAt = auditCount();
                        emit();
                    }
                    const row = Math.floor(y / estimate);
                    if (row === rowLock.current) return;
                    rowLock.current = row;
                    setTop(y);
                });
            }}
        >
            <div className={cl("window-space")} style={{ height: spaceH }}>
                <div className={cl("window-chunk")} style={{ top: startRow * estimate }}>
                    {rows.map(ev => <EventCard key={ev.messageId ? `${ev.channelId}-${ev.messageId}-${ev.type}` : ev.id} ev={ev} />)}
                </div>
            </div>
        </div>
    );
}

function PeopleTab() {
    const [, bump] = useState(0);
    useEffect(() => subscribeDossiers(() => {
        if (!pointerBusy) bump(n => n + 1);
    }), []);
    const people = listDossiers().filter(row => {
        if (!query.trim()) return true;
        const q = query.trim().toLowerCase();
        return row.id.includes(q)
            || (row.username || "").toLowerCase().includes(q)
            || (row.globalName || "").toLowerCase().includes(q);
    }).sort((a, b) => b.lastSeen - a.lastSeen);
    return (
        <WindowList
            items={people}
            estimate={64}
            empty={<div className={cl("empty")}>{query.trim() ? "No matching people." : "No people logged yet."}</div>}
            render={row => {
                const actor = actorOf(row.id, row.globalName || row.username);
                return (
                    <div
                        key={row.id}
                        className={cl("card")}
                        onPointerDown={onPick(() => inspectPerson(row.id))}
                    >
                        <div className={cl("msg")}>
                            <Actor userId={row.id} name={row.globalName || row.username} faceOnly />
                            <div className={cl("msg-body")}>
                                <div className={cl("msg-head")}>
                                    <button
                                        type="button"
                                        className={cl("who")}
                                        onPointerDown={onAct(() => inspectPerson(row.id))}
                                    >
                                        <span className={cl("from-name")}>{actor.display}</span>
                                        {actor.username ? <span className={cl("from-user")}>{actor.username}</span> : null}
                                    </button>
                                    <span className={cl("when")}>{shortWhen(row.lastSeen)}</span>
                                </div>
                                <div className={cl("caption")}>{row.bot ? "bot" : "user"}</div>
                            </div>
                        </div>
                    </div>
                );
            }}
        />
    );
}

function InspectBody({ current }: { current: InspectTarget; }) {
    const [inviteText, setInviteText] = useState("");
    const [profile, setProfile] = useState<any>(null);

    useEffect(() => {
        setInviteText("");
        if (current.kind !== "message" || !toolOn("invites")) return;
        const msg = MessageStore.getMessage(current.extra || "", current.id) as any;
        const codes = inviteCodes(msg?.content || "");
        if (!codes.length) return;
        let gone = false;
        void Promise.all(codes.map(code => fetchInvite(code).catch(() => ({ code, guild: "lookup failed" }))))
            .then(rows => {
                if (!gone) setInviteText(rows.map(r => `${r.code}: ${r.guild}${r.channel ? ` #${r.channel}` : ""}`).join("\n"));
            });
        return () => { gone = true; };
    }, [current.kind, current.id, current.extra]);

    useEffect(() => {
        if (current.kind !== "user") {
            setProfile(null);
            return;
        }
        setProfile(UserProfileStore.getUserProfile(current.id) || null);
        let gone = false;
        void refreshUserProfile(current.id, current.extra).then(p => {
            if (!gone && p) setProfile(p);
        });
        return () => { gone = true; };
    }, [current.kind, current.id, current.extra]);

    if (current.kind === "user") {
        const info = whoIs(current.id, current.extra);
        const dossier = getDossier(current.id);
        const uni = unicodeFlags(`${info.username} ${info.globalName}`);
        const user = UserStore.getUser(current.id) as any;
        const more = current.extra ? memberExtras(current.extra, current.id) : null;
        const flags = decodeFlags(info.flags);
        const nitro = Number(profile?.premiumType ?? profile?.premium_type ?? user?.premiumType ?? 0);
        const bio = String(profile?.bio || profile?.guildMemberProfile?.bio || "").trim();
        const pronouns = String(profile?.pronouns || profile?.guildMemberProfile?.pronouns || user?.pronouns || "").trim();
        const clan = user?.primaryGuild || user?.clan;
        const socials = connectedSocials(profile);
        const latest = latestMessageFor(current.id);
        const channelId = current.channelId || latest?.channelId;
        const messageId = current.messageId || latest?.messageId;
        const jumpChannel = channelId ? ChannelStore.getChannel(channelId) as any : null;
        const roles = (info.roles || []).filter(r => r.name !== "@everyone");
        return (
            <div className={cl("inspect")}>
                <div className={cl("iprofile")}>
                    <Actor userId={current.id} name={info.globalName || info.username} extra={current.extra} channelId={channelId} messageId={messageId} />
                    <div className={cl("actions")}>
                        <button type="button" className={cl("btn-pri")} onPointerDown={onAct(() => openProfile(current.id))}>Profile</button>
                        <button type="button" onPointerDown={onAct(() => openDm(current.id))}>Message</button>
                    </div>
                </div>
                {bio ? <Section title="About Me"><div className={cl("about")}>{bio}</div></Section> : null}
                <Section title="User Info">
                    <Facts rows={[
                        { k: "Display name", v: info.globalName || info.username },
                        { k: "Username", v: `@${info.username}` },
                        { k: "User ID", v: info.id, mono: true },
                        { k: "Created", v: info.created ? `${info.created.local} · ${info.created.age}` : "" },
                        { k: "Pronouns", v: pronouns },
                        { k: "Nickname", v: info.nick },
                        { k: "Relationship", v: info.relationship !== "none" ? info.relationship : "" },
                        { k: "Nitro", v: nitro === 1 ? "Nitro Classic" : nitro === 3 ? "Nitro Basic" : nitro ? "Nitro" : "" },
                        { k: "Clan", v: clan?.tag || "" },
                        { k: "Mutual servers", v: info.mutuals.length ? info.mutuals.map(g => g.name).join(", ") : "" },
                        { k: "Joined server", v: more?.joined || "" },
                        { k: "Timeout", v: more?.timeout || "" },
                        { k: "Permissions", v: info.perms ? (info.perms.owner ? "Owner" : info.perms.admin ? "Administrator" : info.perms.names.slice(0, 10).join(", ")) : "" }
                    ]} />
                </Section>
                {flags.length ? <Section title="Badges"><Pills items={flags.map(text => ({ text }))} /></Section> : null}
                {roles.length ? (
                    <Section title="Roles">
                        <Pills items={roles.map(r => ({ text: r.name, color: r.color || undefined }))} />
                    </Section>
                ) : null}
                <Section title="Connections">
                    {socials.length ? (
                        <div className={cl("socials")}>
                            {socials.map(acc => (
                                <button
                                    key={`${acc.type}-${acc.id}`}
                                    type="button"
                                    className={cl("social")}
                                    title={acc.id}
                                    onPointerDown={onAct(() => copyWithToast(acc.name || acc.id, `${acc.type} copied`))}
                                >
                                    <span className={cl("social-type")}>{acc.type}</span>
                                    <span className={cl("social-name")}>{acc.name || acc.id}</span>
                                    {acc.verified ? <span className={cl("social-ok")}>✓</span> : null}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className={cl("muted")}>No connected accounts on this profile.</div>
                    )}
                </Section>
                {uni.length ? <div className={cl("notice")}>Hidden unicode in name: {uni.join(", ")}</div> : null}
                {dossier ? (
                    <Section title="Seen">
                        <Facts rows={[
                            { k: "First seen", v: new Date(dossier.firstSeen).toLocaleString() },
                            { k: "Last seen", v: new Date(dossier.lastSeen).toLocaleString() },
                            { k: "Usernames", v: dossier.usernames.length ? dossier.usernames.map(h => h.value).join(" → ") : "" },
                            { k: "Nicks", v: dossier.nicks.length ? dossier.nicks.map(h => h.value).join(" → ") : "" }
                        ]} />
                    </Section>
                ) : null}
                <div className={cl("actions")}>
                    {channelId && messageId && (
                        <button type="button" className={cl("btn-pri")} onPointerDown={onAct(() => jumpToMessage(channelId, messageId))}>
                            Jump to message{jumpChannel?.name ? ` #${jumpChannel.name}` : ""}
                        </button>
                    )}
                    {channelId && <button type="button" onPointerDown={onAct(() => openChannel(channelId))}>Open channel</button>}
                    {toolOn("copyKit") && <button type="button" onPointerDown={onAct(() => copyId("User ID", current.id))}>Copy ID</button>}
                    <button type="button" onPointerDown={onAct(() => copyWithToast(`<@${current.id}>`, "Mention copied"))}>Copy mention</button>
                    {channelId && messageId && (
                        <button type="button" onPointerDown={onAct(() => copyWithToast(messagePermalink(channelId, messageId, current.extra), "Permalink copied"))}>Copy link</button>
                    )}
                </div>
            </div>
        );
    }

    if (current.kind === "message") {
        const channelId = current.extra || "";
        const msg = MessageStore.getMessage(channelId, current.id) as any;
        const content = String(msg?.content || "");
        const author = msg?.author;
        const channel = channelId ? ChannelStore.getChannel(channelId) as any : null;
        const links = maskedLinks(content);
        const scam = scamHits(content);
        const emoji = emojiOrigins(content);
        const stickers = stickerOrigins((msg?.stickerItems || msg?.sticker_items || []).map((s: any) => s?.id).filter(Boolean));
        return (
            <div className={cl("inspect")}>
                {author?.id && (
                    <div className={cl("iprofile")}>
                        <Actor userId={author.id} name={author.globalName || author.username} extra={msg?.guild_id || msg?.guildId} channelId={channelId} messageId={current.id} />
                        <div className={cl("actions")}>
                            <button type="button" className={cl("btn-pri")} onPointerDown={onAct(() => openProfile(author.id))}>Profile</button>
                            <button type="button" onPointerDown={onAct(() => openDm(author.id))}>Message</button>
                        </div>
                    </div>
                )}
                {content ? <Section title="Message"><div className={cl("about")}>{content.slice(0, 800)}</div></Section> : (
                    <div className={cl("muted")}>Message is not in cache.</div>
                )}
                <MediaStrip items={mediaFromMessage(msg)} channelId={channelId} messageId={current.id} />
                <Section title="Details">
                    <Facts rows={[
                        { k: "Message ID", v: current.id, mono: true },
                        { k: "Sent", v: ageLine(current.id) },
                        { k: "Channel", v: channel?.name ? `#${channel.name}` : channelId, mono: !channel?.name },
                        { k: "Author", v: author ? `${author.globalName || author.username}` : "" }
                    ]} />
                </Section>
                {links.length ? (
                    <Section title="Links">
                        <Facts rows={links.map((l, i) => ({ k: l.mismatch ? `Masked ${i + 1}` : `Link ${i + 1}`, v: `${l.label} → ${l.href}` }))} />
                    </Section>
                ) : null}
                {scam.length ? <div className={cl("notice")}>Possible scam: {scam.join(", ")}</div> : null}
                {emoji.length ? <Section title="Emoji"><Facts rows={emoji.map(e => ({ k: `:${e.name}:`, v: e.guild }))} /></Section> : null}
                {stickers.length ? <Section title="Stickers"><Facts rows={stickers.map(s => ({ k: s.name, v: s.guild }))} /></Section> : null}
                {inviteText ? <Section title="Invites"><div className={cl("about")}>{inviteText}</div></Section> : null}
                {toolOn("timestampDecode") && timestampsIn(content).length
                    ? <Section title="Timestamps"><Facts rows={timestampsIn(content).map((t, i) => ({ k: `Time ${i + 1}`, v: t }))} /></Section>
                    : null}
                <div className={cl("actions")}>
                    {channelId && (
                        <button type="button" className={cl("btn-pri")} onPointerDown={onAct(() => jumpToMessage(channelId, current.id))}>Jump to message</button>
                    )}
                    {toolOn("copyKit") && <button type="button" onPointerDown={onAct(() => copyId("Message ID", current.id))}>Copy ID</button>}
                    {toolOn("copyKit") && channelId && (
                        <button type="button" onPointerDown={onAct(() => copyWithToast(messagePermalink(channelId, current.id), "Permalink copied"))}>Copy link</button>
                    )}
                    {author?.id && (
                        <button
                            type="button"
                            onPointerDown={onAct(() => inspectPerson(author.id, { guildId: msg?.guild_id || msg?.guildId, channelId, messageId: current.id }))}
                        >
                            Inspect author
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (current.kind === "channel") {
        const channel = ChannelStore.getChannel(current.id) as any;
        const perms = myChannelPermissions(current.id);
        const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
        return (
            <div className={cl("inspect")}>
                <div className={cl("iprofile")}>
                    <div className={cl("iname")}>
                        <div className={cl("iname-title")}>{channel?.name ? `#${channel.name}` : "Channel"}</div>
                        <div className={cl("iname-sub")}>{guild?.name || (channel?.guild_id ? "Server" : "Direct message")}</div>
                    </div>
                    <div className={cl("actions")}>
                        <button type="button" className={cl("btn-pri")} onPointerDown={onAct(() => openChannel(current.id))}>Open</button>
                    </div>
                </div>
                {channel?.topic ? <Section title="Topic"><div className={cl("about")}>{channel.topic}</div></Section> : null}
                <Section title="Channel Info">
                    <Facts rows={[
                        { k: "Channel ID", v: current.id, mono: true },
                        { k: "Created", v: ageLine(current.id) },
                        { k: "NSFW", v: channel?.nsfw ? "Yes" : "No" },
                        { k: "Category", v: toolOn("categoryTree") ? categoryTree(current.id).replace(/^category\s+/, "") : "" },
                        { k: "Voice", v: toolOn("voiceBitrate") ? voiceMeta(current.id) : "" },
                        { k: "Your permissions", v: perms.slice(0, 12).join(", ") }
                    ]} />
                </Section>
                {toolOn("overwriteDump") ? (
                    <Section title="Overwrites">
                        <Facts rows={channelOverwrites(current.id).slice(0, 12).map((line, i) => ({ k: `Rule ${i + 1}`, v: line, mono: true }))} />
                    </Section>
                ) : null}
                <div className={cl("actions")}>
                    {toolOn("copyKit") && <button type="button" onPointerDown={onAct(() => copyId("Channel ID", current.id))}>Copy ID</button>}
                    {channel?.guild_id && <button type="button" onPointerDown={onAct(() => setInspectTarget({ kind: "guild", id: channel.guild_id }))}>Inspect server</button>}
                    {(channel?.type === 2 || channel?.type === 13) && toolOn("joinVoice") && (
                        <button type="button" onPointerDown={onAct(() => joinVoice(current.id))}>Join voice</button>
                    )}
                </div>
            </div>
        );
    }

    if (current.kind === "role") {
        const guildId = current.extra || "";
        const roles = roleDump(guildId).filter(r => r.id === current.id);
        const role = roles[0];
        return (
            <div className={cl("inspect")}>
                <div className={cl("iprofile")}>
                    <div className={cl("iname")}>
                        <div className={cl("iname-title")}>{role?.name || "Role"}</div>
                        <div className={cl("iname-sub")}>Role</div>
                    </div>
                </div>
                <Section title="Role Info">
                    <Facts rows={[
                        { k: "Role ID", v: current.id, mono: true },
                        { k: "Color", v: role?.color || "Default" },
                        { k: "Hoisted", v: role ? (role.hoist ? "Yes" : "No") : "" },
                        { k: "Managed", v: role ? (role.managed ? "Yes" : "No") : "" }
                    ]} />
                </Section>
                {role?.color ? <Pills items={[{ text: role.name, color: role.color }]} /> : null}
                <div className={cl("actions")}>
                    {toolOn("copyKit") && <button type="button" onPointerDown={onAct(() => copyId("Role ID", current.id))}>Copy ID</button>}
                </div>
            </div>
        );
    }

    const intel = serverIntel(current.id);
    const guild = GuildStore.getGuild(current.id);
    const me = UserStore.getCurrentUser()?.id;
    const perms = me ? memberPermissions(current.id, me) : null;
    let icon = "";
    try {
        if (guild) icon = IconUtils.getGuildIconURL({ id: guild.id, icon: (guild as any).icon, size: 64 }) || "";
    } catch { /* ignore */ }
    return (
        <div className={cl("inspect")}>
            <div className={cl("iprofile")}>
                {icon ? <img className={cl("ava", "square")} src={icon} alt="" /> : null}
                <div className={cl("iname")}>
                    <div className={cl("iname-title")}>{intel?.name || guild?.name || "Server"}</div>
                    <div className={cl("iname-sub")}>{intel?.memberCount ? `${intel.memberCount} members` : "Server"}</div>
                </div>
            </div>
            <Section title="Server Info">
                <Facts rows={[
                    { k: "Server ID", v: intel?.id || current.id, mono: true },
                    { k: "Created", v: intel?.created ? `${intel.created.local} · ${intel.created.age}` : "" },
                    { k: "Owner", v: intel ? `${intel.ownerName}` : "" },
                    { k: "Verification", v: intel?.verificationLevel != null ? String(intel.verificationLevel) : "" },
                    { k: "Boosts", v: intel ? `Tier ${intel.premiumTier ?? "?"} · ${intel.premiumCount ?? "?"}` : "" },
                    { k: "Vanity", v: intel?.vanity || "" },
                    { k: "Your permissions", v: perms ? (perms.owner ? "Owner" : perms.names.slice(0, 12).join(", ")) : "" }
                ]} />
            </Section>
            {intel?.features?.length ? <Section title="Features"><Pills items={intel.features.slice(0, 18).map(text => ({ text }))} /></Section> : null}
            {(toolOn("afkChannel") || toolOn("rulesChannel") || toolOn("systemChannel")) && guildExtra(current.id)
                ? <Section title="Channels"><div className={cl("about")}>{guildExtra(current.id)}</div></Section>
                : null}
            <div className={cl("actions")}>
                {toolOn("copyKit") && <button type="button" onPointerDown={onAct(() => copyId("Guild ID", current.id))}>Copy ID</button>}
                {intel?.ownerId && <button type="button" onPointerDown={onAct(() => setInspectTarget({ kind: "user", id: intel.ownerId, extra: current.id }))}>Inspect owner</button>}
            </div>
        </div>
    );
}

const SAFETY_TYPES = new Set([
    "scam",
    "masked-link",
    "unicode",
    "new-account",
    "ghost-ping",
    "composer-leak",
    "session",
    "everyone",
    "timeout",
    "bulk-delete",
    "delete",
    "edit"
]);

function SafetyTab() {
    const [disk, setDisk] = useState<LedgerEvent[]>([]);
    useEffect(() => {
        let gone = false;
        let t: ReturnType<typeof setTimeout> | null = null;
        const run = () => {
            if (pointerBusy) return;
            if (t) clearTimeout(t);
            t = setTimeout(() => {
                void seekEvents(0, 80).then(list => {
                    if (!gone && !pointerBusy) setDisk(list);
                });
            }, 240);
        };
        run();
        const off = subscribeLedger(run);
        return () => {
            gone = true;
            if (t) clearTimeout(t);
            off();
        };
    }, []);
    const rows: LedgerEvent[] = [];
    const seen = new Set<string>();
    for (const ev of [...recentEvents(2000), ...disk]) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        if (ev.severity === "warn" || SAFETY_TYPES.has(ev.type)) rows.push(ev);
    }
    return (
        <WindowList
            items={rows}
            estimate={168}
            empty={<div className={cl("empty")}>No deletes, edits, or warnings yet. Stay in channels; Changes logs what this client already sees.</div>}
            render={ev => (
                <EventCard
                    key={ev.id}
                    ev={ev}
                    warn={ev.severity === "warn" && ev.type !== "delete" && ev.type !== "edit"}
                />
            )}
        />
    );
}

function ToolsTab() {
    const q = query.trim().toLowerCase();
    const list = TOOLS.filter(tool =>
        !q
        || tool.label.toLowerCase().includes(q)
        || tool.id.toLowerCase().includes(q)
        || tool.description.toLowerCase().includes(q)
    );
    return (
        <div className={cl("tools")}>
            {list.map(tool => (
                <label key={tool.id} className={cl("tool")}>
                    <input
                        type="checkbox"
                        checked={toolOn(tool.id)}
                        onChange={e => { setTool(tool.id, e.currentTarget.checked); emit(); }}
                    />
                    <span>
                        <span className={cl("tool-name")}>{tool.label}</span>
                        <span className={cl("tool-desc")}>{tool.description}</span>
                    </span>
                </label>
            ))}
        </div>
    );
}

function ExportTab() {
    const json = useMemo(() => exportEventsJson(query), [query, getEvents().length]);
    return (
        <div className={cl("export")}>
            {!toolOn("exportSearch") && <div className={cl("empty")}>Export / search is off in settings.</div>}
            {toolOn("exportSearch") && (
                <>
                    <textarea className={cl("json")} readOnly value={json} spellCheck={false} />
                    <div className={cl("actions")}>
                        <button type="button" onPointerDown={onAct(() => copyWithToast(json, "Ledger JSON copied"))}>Copy JSON</button>
                        <button
                            type="button"
                            onPointerDown={onAct(() => { void nativeApi()?.openFolder?.(); })}
                        >
                            Open folder
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

type OverlayBox = { left: number; top: number; width: number; height: number; };

function clampOverlayBox(left: number, top: number, width: number, height: number): OverlayBox {
    const maxW = Math.max(300, window.innerWidth - 16);
    const maxH = Math.max(260, window.innerHeight - 16);
    const w = Math.min(maxW, Math.max(300, width));
    const h = Math.min(maxH, Math.max(280, height));
    const l = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - w - 8));
    const t = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - h - 8));
    return { left: l, top: t, width: w, height: h };
}

function defaultOverlayBox(): OverlayBox {
    const width = Math.min(440, Math.max(320, Math.round(window.innerWidth * 0.32)));
    const height = Math.min(620, Math.max(380, Math.round(window.innerHeight * 0.62)));
    return clampOverlayBox(window.innerWidth - width - 16, window.innerHeight - height - 72, width, height);
}

let rememberedOverlay: OverlayBox | null = null;

function Overlay() {
    const state = useOverlay();
    const boxRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ x: number; y: number; left: number; top: number; } | null>(null);
    const [box, setBox] = useState<OverlayBox>(() => rememberedOverlay ? clampOverlayBox(rememberedOverlay.left, rememberedOverlay.top, rememberedOverlay.width, rememberedOverlay.height) : defaultOverlayBox());

    function clampBox(left: number, top: number, width: number, height: number) {
        return clampOverlayBox(left, top, width, height);
    }

    function commitBox(next: OverlayBox) {
        rememberedOverlay = next;
        setBox(next);
    }

    useEffect(() => {
        const onResize = () => {
            const el = boxRef.current;
            const w = el?.offsetWidth || box.width;
            const h = el?.offsetHeight || box.height;
            const r = el?.getBoundingClientRect();
            commitBox(clampBox(r?.left ?? box.left, r?.top ?? box.top, w, h));
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [box.left, box.top, box.width, box.height]);

    function startResize(e: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number; }, dir: "se" | "e" | "s") {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = box.width;
        const startH = box.height;
        const startL = box.left;
        const startT = box.top;
        const move = (ev: MouseEvent) => {
            const nextW = dir === "s" ? startW : startW + ev.clientX - startX;
            const nextH = dir === "e" ? startH : startH + ev.clientY - startY;
            commitBox(clampBox(startL, startT, nextW, nextH));
        };
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    }

    if (!state.open) return null;

    const tabs: Array<{ id: Tab; label: string; }> = [
        { id: "feed", label: "Feed" },
        { id: "media", label: "Media" },
        { id: "people", label: "People" },
        { id: "inspect", label: "Inspect" },
        { id: "safety", label: "Changes" },
        { id: "tools", label: "Tools" },
        { id: "export", label: "Export" }
    ];

    return (
        <div
            ref={boxRef}
            className={cl("overlay")}
            style={{
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                ["--hm-w" as any]: `${box.width}px`,
                ["--hm-h" as any]: `${box.height}px`
            }}
            onMouseDown={e => e.stopPropagation()}
            onPointerDownCapture={() => holdPointer()}
        >
            <div
                className={cl("head")}
                onMouseDown={e => {
                    const node = e.target instanceof Element ? e.target : null;
                    if (node?.closest("button, .vc-hm-head-actions")) return;
                    const rect = boxRef.current?.getBoundingClientRect();
                    drag.current = { x: e.clientX, y: e.clientY, left: rect?.left ?? box.left, top: rect?.top ?? box.top };
                    const move = (ev: MouseEvent) => {
                        if (!drag.current) return;
                        const next = clampBox(
                            drag.current.left + ev.clientX - drag.current.x,
                            drag.current.top + ev.clientY - drag.current.y,
                            box.width,
                            box.height
                        );
                        commitBox(next);
                    };
                    const up = () => {
                        drag.current = null;
                        window.removeEventListener("mousemove", move);
                        window.removeEventListener("mouseup", up);
                    };
                    window.addEventListener("mousemove", move);
                    window.addEventListener("mouseup", up);
                }}
            >
                <div>
                    <div className={cl("title")}>Stalker Mode</div>
                    <div className={cl("sub")}>{TOOLS.length} tools · local</div>
                </div>
                <div className={cl("head-actions")}>
                    <button
                        type="button"
                        className={cl("clear")}
                        onPointerDown={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            closeArmed = false;
                            sessionCleared = true;
                            open = true;
                            followLive = true;
                            freezeAt = 0;
                            query = "";
                            void startFreshSession().finally(() => {
                                open = true;
                                emit();
                            });
                            emit();
                        }}
                        onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                    >
                        Clear cache
                    </button>
                    <button
                        type="button"
                        className={cl("x")}
                        onPointerDown={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            closeArmed = true;
                        }}
                        onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!closeArmed) return;
                            closeArmed = false;
                            open = false;
                            emit();
                        }}
                    >×</button>
                </div>
            </div>
            <div className={cl("tabs")}>
                {tabs.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        className={cl("tab", { on: state.tab === item.id })}
                        onPointerDown={onAct(() => setTab(item.id))}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
            {(state.tab === "feed" || state.tab === "media" || state.tab === "people" || state.tab === "export" || state.tab === "tools") && (
                <input
                    className={cl("search")}
                    value={query}
                    placeholder={state.tab === "people" ? "Filter people" : state.tab === "media" ? "Filter media" : state.tab === "tools" ? "Filter tools" : "Filter ledger"}
                    onChange={e => { query = e.currentTarget.value; emit(); }}
                    spellCheck={false}
                />
            )}
            {state.tab === "feed" && <FeedFilters />}
            <div className={cl("body")}>
                <ErrorBoundary key={ledgerSession()}>
                {state.tab === "feed" && <FeedTab />}
                {state.tab === "media" && <MediaTab live={state.followLive} />}
                {state.tab === "people" && <PeopleTab />}
                {state.tab === "inspect" && (state.target
                    ? <InspectBody current={state.target} />
                    : <div className={cl("empty")}>Right-click a user, message, channel, or server → Stalker Mode → Inspect.</div>)}
                {state.tab === "safety" && <SafetyTab />}
                {state.tab === "tools" && <ToolsTab />}
                {state.tab === "export" && <ExportTab />}
                </ErrorBoundary>
            </div>
            <button
                type="button"
                className={cl("live", { on: state.followLive })}
                title={state.followLive ? "Live — newest events at the top" : "Jump to top and resume live"}
                onPointerDown={onAct(goLive)}
            >
                Live
            </button>
            <div className={cl("resize", "se")} onMouseDown={e => startResize(e, "se")} />
            <div className={cl("resize", "e")} onMouseDown={e => startResize(e, "e")} />
            <div className={cl("resize", "s")} onMouseDown={e => startResize(e, "s")} />
        </div>
    );
}

export function mountOverlay() {
    if (host && !document.body.contains(host)) {
        try { root?.unmount(); } catch { /* ignore */ }
        root = null;
        host = null;
    }
    if (host && root) {
        open = true;
        emit();
        return;
    }
    host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);
    root = createRoot(host);
    open = true;
    root.render(
        <ErrorBoundary>
            <Overlay />
        </ErrorBoundary>
    );
}

export function unmountOverlay() {
    open = false;
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
}
