/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";
import {
    ChannelStore,
    DraftStore,
    DraftType,
    GuildStore,
    MessageStore,
    SelectedChannelStore,
    UserStore
} from "@webpack/common";

import { observeUser } from "./dossier";
import { notePresence } from "./lastOnline";
import { snowflakeAt } from "./inspect";
import { extKind, isBlockedFile, isVisualMedia, VIDEO_EXT } from "./md";
import { logEvent, refreshEventMedia, stashVisual } from "./ledger";
import { fastSrcs } from "./fastLoad";
import { maskedLinks, scamHits, secretKind, warnComposerLeak } from "./safety";
import type { LedgerMedia } from "./types";
import {
    bindIngest,
    harvestChannel,
    ingestLoadedMessages,
    onWideReconnect,
    startWideCatch,
    stopWideCatch,
    watchGuild,
    watchChannel
} from "./wideCatch";

const SessionsStore = findStoreLazy("SessionsStore") as {
    getSessions(): Record<string, { sessionId?: string; clientInfo?: { client?: string; os?: string; }; }>;
};

const LIVE = 8000;
const live = new Map<string, { channelId: string; messageId: string; authorId: string; authorName: string; content: string; mentionsMe: boolean; guildId?: string; webhook?: boolean; media?: LedgerMedia[]; at: number; }>();
const pings = new Map<string, { channelId: string; authorName: string; snippet: string; media?: LedgerMedia[]; }>();
const voiceWas = new Map<string, string>();
const streamWas = new Set<string>();
const knownSessions = new Set<string>();
const memberSnap = new Map<string, { roles: string; timeout: string; nick: string; }>();
const typingWait = new Map<string, ReturnType<typeof setTimeout>>();
const platforms = new Map<string, string>();
const statuses = new Map<string, string>();
let sessionsReady = false;
let leakTimer: ReturnType<typeof setInterval> | null = null;
let lastLeak = "";

function liveKey(channelId: string, id: string) {
    return `${channelId}:${id}`;
}

function mediaTime(msg: any) {
    const t = msg?.timestamp;
    if (t != null) {
        const n = typeof t === "number" ? t : Date.parse(String(t.valueOf?.() ?? t)) || Number(t);
        if (Number.isFinite(n) && n > 1e11) return n;
        if (Number.isFinite(n) && n > 1e9) return n * 1000;
    }
    const id = String(msg?.id || "");
    if (/^\d{17,}$/.test(id)) {
        try {
            return Number((BigInt(id) >> 22n) + 1420070400000n);
        } catch { /* ignore */ }
    }
    return Date.now();
}

const MEDIA_URL_RE = /https?:\/\/[^\s<>\])"]+/gi;
const loggedMedia = new Set<string>();
const botIds = new Set<string>();

export function noteBotAuthor(author: any) {
    const id = String(author?.id || "");
    if (!id) return;
    if (author?.bot) botIds.add(id);
}

export function isBotUser(userId?: string) {
    if (!userId) return false;
    if (botIds.has(userId)) return true;
    try {
        const user = UserStore.getUser(userId) as { bot?: boolean; } | undefined;
        if (user?.bot) {
            botIds.add(userId);
            return true;
        }
    } catch { /* ignore */ }
    return false;
}

function listOf(value: any): any[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "object") return Object.values(value);
    return [];
}

function bareUrl(url: string) {
    return String(url || "").split("?")[0];
}

function mediaKind(name: string, type: string, url = ""): LedgerMedia["kind"] {
    const blob = `${type} ${name} ${url}`;
    if (type === "image/gif" || type === "image/apng" || extKind(blob) === "gif") return "gif";
    if (type.startsWith("video/") || extKind(blob) === "video") return "video";
    if (type.startsWith("audio/") || extKind(blob) === "audio" || /waveform/i.test(blob)) return "audio";
    if (type.startsWith("image/") || extKind(blob) === "image") return "image";
    if (/tenor\.com|giphy\.com|gifv/i.test(blob)) return "gif";
    return "file";
}

function pickUrl(...urls: any[]) {
    return urls.map(u => String(u || "").trim()).find(Boolean) || "";
}

export function mediaFromMessage(msg: any): LedgerMedia[] {
    const out: LedgerMedia[] = [];
    const seen = new Set<string>();
    const add = (partial: Partial<LedgerMedia> & { url?: string; }) => {
        const href = String(partial.url || "").trim();
        if (!href || out.length >= 80) return;
        const key = bareUrl(href);
        if (seen.has(key)) return;
        seen.add(key);
        const width = Number(partial.width) || 0;
        const height = Number(partial.height) || 0;
        out.push({
            id: partial.id,
            url: href,
            poster: partial.poster,
            name: partial.name,
            kind: partial.kind || mediaKind(partial.name || "", "", href),
            spoiler: Boolean(partial.spoiler),
            width: width > 0 ? width : undefined,
            height: height > 0 ? height : undefined
        });
    };

    const collect = (node: any) => {
        if (!node) return;
        const attachments = [
            ...listOf(node.attachments),
            ...listOf(node.files),
            ...(node.attachment ? [node.attachment] : [])
        ];
        for (const a of attachments) {
            const name = String(a?.filename || a?.name || a?.filename_ || "file");
            const type = String(a?.content_type || a?.contentType || "");
            const original = pickUrl(a?.url, a?.href, a?.downloadUrl, a?.download_url);
            const proxy = pickUrl(a?.proxy_url, a?.proxyUrl, a?.proxyURL, a?.proxy_src);
            const raw = original || proxy;
            let kind = mediaKind(name, type, raw);
            if (kind === "file" && (a?.duration || a?.duration_secs) && !a?.waveform) kind = "video";
            if (kind === "file" && (a?.width || a?.height)) kind = "image";
            if (kind === "file" && /\/(?:ephemeral-)?attachments\//.test(raw) && !isBlockedFile(name)) {
                const guessed = extKind(name);
                kind = guessed === "video" || Number(a?.duration || a?.duration_secs) > 0
                    ? "video"
                    : guessed === "audio"
                        ? "audio"
                        : "image";
            }
            const href = original || proxy;
            add({
                id: a?.id ? String(a.id) : undefined,
                url: href,
                poster: kind === "video"
                    ? undefined
                    : (proxy && proxy !== href ? proxy : undefined),
                name,
                kind,
                spoiler: Boolean(a?.spoiler || name.startsWith("SPOILER_")),
                width: Number(a?.width) || undefined,
                height: Number(a?.height) || undefined
            });
        }

        for (const e of listOf(node.embeds)) {
            const type = String(e?.type || "").toLowerCase();
            const title = String(e?.title || e?.provider?.name || e?.author?.name || "");
            const source = `${type} ${e?.url || ""} ${e?.provider?.name || ""}`;
            const video = pickUrl(e?.video?.proxyURL, e?.video?.proxy_url, e?.video?.url);
            const image = pickUrl(e?.image?.proxyURL, e?.image?.proxy_url, e?.image?.url);
            const thumb = pickUrl(e?.thumbnail?.proxyURL, e?.thumbnail?.proxy_url, e?.thumbnail?.url);
            const picture = type === "image" || type === "gifv" || type === "gif" || type === "video";
            const gifv = type === "gifv" || type === "gif" || /tenor|giphy/i.test(source);
            const fileName = (raw: string, fallback: string) => {
                const leaf = decodeURIComponent(String(raw || "").split("?")[0].split("/").pop() || "");
                if (/\.[a-z0-9]{2,5}$/i.test(leaf)) return leaf.slice(0, 80);
                return fallback;
            };
            if (video) {
                add({
                    url: video,
                    poster: image || (picture ? thumb : undefined),
                    name: fileName(video, title || "video"),
                    kind: gifv ? "gif" : "video",
                    width: Number(e?.video?.width) || undefined,
                    height: Number(e?.video?.height) || undefined
                });
            } else if (image) {
                add({
                    url: image,
                    name: fileName(image, title || "image"),
                    kind: gifv ? "gif" : mediaKind(title, "image/", image),
                    width: Number(e?.image?.width) || undefined,
                    height: Number(e?.image?.height) || undefined
                });
            } else if (thumb && picture) {
                add({
                    url: thumb,
                    name: fileName(thumb, title || "image"),
                    kind: gifv ? "gif" : "image",
                    width: Number(e?.thumbnail?.width) || undefined,
                    height: Number(e?.thumbnail?.height) || undefined
                });
            }
        }

        for (const s of listOf(node.stickerItems || node.sticker_items || node.stickers)) {
            const id = String(s?.id || "");
            if (!id) continue;
            const format = Number(s?.format_type || s?.formatType || 1);
            add({
                id,
                url: `https://media.discordapp.net/stickers/${id}.${format === 4 ? "gif" : "png"}?size=160`,
                name: s?.name || "sticker",
                kind: format === 4 ? "gif" : "image"
            });
        }

        const walk = (nodes: any) => {
            for (const c of listOf(nodes)) {
                const media = c?.media || c?.file || c?.item?.media || c?.thumbnail?.media;
                const href = pickUrl(media?.proxy_url, media?.proxyUrl, media?.proxyURL, media?.url, c?.url);
                if (href) add({
                    url: href,
                    poster: pickUrl(media?.proxy_url, media?.proxyUrl),
                    name: media?.name || c?.name || "media",
                    kind: mediaKind(media?.name || "", media?.content_type || media?.contentType || "", href),
                    spoiler: Boolean(c?.spoiler || media?.spoiler)
                });
                for (const it of listOf(c?.items)) {
                    const m = it?.media || it?.file || it;
                    const u = pickUrl(m?.proxy_url, m?.proxyUrl, m?.proxyURL, m?.url, it?.url);
                    if (u) add({
                        url: u,
                        poster: pickUrl(m?.proxy_url, m?.proxyUrl),
                        name: m?.name || it?.description || "media",
                        kind: mediaKind(m?.name || "", m?.content_type || "", u),
                        spoiler: Boolean(it?.spoiler || m?.spoiler)
                    });
                }
                if (c?.items) walk(c.items);
                if (c?.components) walk(c.components);
                if (c?.accessory) walk([c.accessory]);
            }
        };
        walk(node.components);
        walk(node.attachments);

        const content = String(node.content || "");
        for (const match of content.matchAll(MEDIA_URL_RE)) {
            const href = match[0].replace(/[.,;)]+$/, "");
            const kind = mediaKind(href, "", href);
            const name = decodeURIComponent(href.split("/").pop() || "media");
            if (!isVisualMedia({ url: href, kind, name })) continue;
            add({ url: href, name, kind: kind === "file" ? "image" : kind });
        }
    };

    collect(msg);
    for (const snap of listOf(msg?.messageSnapshots || msg?.message_snapshots))
        collect(snap?.message || snap);
    return out;
}

export function getCachedMessage(channelId?: string, messageId?: string) {
    if (!channelId || !messageId) return null;
    try {
        const direct = MessageStore.getMessage(channelId, messageId) as any;
        if (direct) return direct;
        const pack = MessageStore.getMessages(channelId) as any;
        return pack?.get?.(messageId) || pack?._map?.get?.(messageId) || null;
    } catch {
        return null;
    }
}

function attachmentIdFromUrl(url: string) {
    return String(url || "").match(/\/(?:attachments|ephemeral-attachments)\/(?:\d+\/)?(\d+)\//)?.[1] || "";
}

export function resolveLiveMedia(item: LedgerMedia, channelId?: string, messageId?: string): LedgerMedia {
    const msg = getCachedMessage(channelId, messageId);
    if (!msg) return item;
    const fresh = mediaFromMessage(msg);
    if (!fresh.length) return item;
    const idFromUrl = item.id || attachmentIdFromUrl(item.url);
    return fresh.find(row =>
        (item.id && row.id === item.id)
        || (idFromUrl && (row.id === idFromUrl || attachmentIdFromUrl(row.url) === idFromUrl))
        || (item.name && row.name === item.name)
        || bareUrl(row.url) === bareUrl(item.url)
        || (item.poster && row.poster && bareUrl(row.poster) === bareUrl(item.poster))
    ) || item;
}

export function mediaCandidates(item: LedgerMedia, large = false) {
    return fastSrcs(item, large ? 192 : 96);
}

export function mediaPlaysInline(item: LedgerMedia) {
    return item.kind === "video" || (item.kind === "gif" && VIDEO_EXT.test(item.url));
}

function markMediaLogged(channelId: string, messageId: string) {
    loggedMedia.add(liveKey(channelId, messageId));
    if (loggedMedia.size > 400) {
        const first = loggedMedia.keys().next().value;
        if (first) loggedMedia.delete(first);
    }
}

function alreadyLoggedMedia(channelId: string, messageId: string) {
    return loggedMedia.has(liveKey(channelId, messageId));
}

function queueMediaFill(channelId: string, messageId: string) {
    setTimeout(() => {
        const msg = getCachedMessage(channelId, messageId);
        if (msg) logLateMedia(msg);
    }, 120);
}

function rememberLive(msg: any) {
    const id = String(msg?.id || "");
    const channelId = String(msg?.channel_id || msg?.channelId || "");
    if (!id || !channelId) return;
    const media = mediaFromMessage(msg);
    noteBotAuthor(msg.author);
    const authorId = String(msg.author?.id || "");
    const authorNameLive = String(msg.author?.globalName || msg.author?.global_name || msg.author?.username || "unknown");
    const guildId = ChannelStore.getChannel(channelId)?.guild_id;
    const at = mediaTime(msg);
    live.set(liveKey(channelId, id), {
        channelId,
        messageId: id,
        authorId,
        authorName: authorNameLive,
        content: String(msg.content || "").slice(0, 800),
        mentionsMe: mentionsMe(msg),
        guildId,
        webhook: Boolean(msg.webhookId || msg.webhook_id),
        media,
        at
    });
    if (media.length) stashVisual({ channelId, messageId: id, userId: authorId, userName: authorNameLive, guildId, media, at });
    if (live.size > LIVE) {
        const first = live.keys().next().value;
        if (first) live.delete(first);
    }
}

function messageFromEvent(event: any) {
    return event?.message || event;
}

function authorName(raw: any) {
    return String(raw?.globalName || raw?.global_name || raw?.username || raw?.id || "unknown");
}

function mentionsMe(msg: any) {
    const me = UserStore.getCurrentUser()?.id;
    if (!me) return false;
    if (msg.mentionEveryone || msg.mention_everyone) return true;
    const mentions = msg.mentions || [];
    if (mentions.some((u: any) => String(u?.id || u) === me)) return true;
    const text = String(msg.content || "");
    return text.includes(`<@${me}>`) || text.includes(`<@!${me}>`);
}

function placeName(channelId?: string, guildId?: string) {
    const channel = channelId ? ChannelStore.getChannel(channelId) as any : null;
    const type = channel?.type ?? channel?.Type;
    if (type === 1) {
        const rec = (channel.rawRecipients || channel.recipients || [])[0];
        const who = rec?.globalName || rec?.global_name || rec?.username || rec?.id || "DM";
        return `DM · ${who}`;
    }
    if (type === 3) return `Group · ${channel.name || channel.id || "Group DM"}`;
    const guild = (guildId || channel?.guild_id) ? GuildStore.getGuild(guildId || channel?.guild_id) : null;
    const bits = [
        guild?.name,
        channel?.name ? `#${channel.name}` : channelId
    ].filter(Boolean);
    return bits.join(" · ") || channelId || "unknown";
}

const loggedSends = new Set<string>();

function alreadyLoggedSend(channelId: string, id: string) {
    const key = `${channelId}:${id}`;
    if (loggedSends.has(key)) return true;
    loggedSends.add(key);
    if (loggedSends.size > 30000) {
        const first = loggedSends.keys().next().value;
        if (first) loggedSends.delete(first);
    }
    return false;
}

function logIncomingMessage(raw: any) {
    const msg = messageFromEvent(raw);
    if (!msg?.id) return;
    const channelId = String(msg.channel_id || msg.channelId || raw?.channelId || raw?.channel_id || "");
    if (!channelId) return;
    rememberLive({ ...msg, channel_id: channelId, channelId });
    if (alreadyLoggedSend(channelId, String(msg.id))) return;
    noteBotAuthor(msg.author);
    observeUser(msg.author, { nick: msg.member?.nick, guildId: ChannelStore.getChannel(channelId)?.guild_id });

    const name = authorName(msg.author);
    const guildId = ChannelStore.getChannel(channelId)?.guild_id;
    const content = String(msg.content || "");

    if (mentionsMe(msg)) {
        pings.set(msg.id, { channelId, authorName: name, snippet: content.slice(0, 400), media: mediaFromMessage(msg) });
        if (pings.size > 200) {
            const first = pings.keys().next().value;
            if (first) pings.delete(first);
        }
    }

    const media = mediaFromMessage(msg);
    const pollQ = msg.poll?.question?.text || msg.poll?.question;
    const me = UserStore.getCurrentUser()?.id;
    const ref = msg.referenced_message || msg.referencedMessage;
    const replied = Boolean(ref && (ref.author?.id === me || mentionsMe(ref)));
    let kind = "send";
    let severity: "info" | "warn" = "info";
    if (msg.mentionEveryone || msg.mention_everyone) {
        kind = "everyone";
        severity = "warn";
    } else if (mentionsMe(msg)) kind = "mention";
    else if (replied) kind = "reply";
    else if (content.includes("](http") && maskedLinks(content).some(l => l.mismatch)) {
        kind = "masked-link";
        severity = "warn";
    } else if ((content.includes("http") || content.includes("discord.gg")) && scamHits(content).length) {
        kind = "scam";
        severity = "warn";
    }
    if (media.length) markMediaLogged(channelId, msg.id);
    logEvent({
        type: kind,
        severity,
        userId: msg.author?.id,
        userName: name,
        channelId,
        guildId,
        messageId: msg.id,
        summary: `${name} ${kind === "send" ? "sent a message" : kind} in ${placeName(channelId)}`,
        preview: content || (pollQ ? `poll: ${String(pollQ)}` : media.length ? media.map(m => m.name || m.kind).join(", ") : ""),
        media
    });
    if (!media.length) queueMediaFill(channelId, String(msg.id));
}

function ingestMessage(raw: any) {
    const msg = messageFromEvent(raw);
    if (!msg?.id) return;
    rememberLive(msg);
}

function onMessageCreate(event: any) {
    if (event?.optimistic || event?.isOptimistic) return;
    const msg = event?.message || event;
    const channelId = String(msg?.channel_id || msg?.channelId || event?.channelId || event?.channel_id || "");
    if (!msg?.id || !channelId) return;
    logIncomingMessage({ ...event, message: { ...msg, channel_id: channelId, channelId } });
}

export function liveVisualMedia() {
    const out: Array<{ channelId: string; messageId: string; userId: string; userName: string; guildId?: string; item: LedgerMedia; at: number; }> = [];
    for (const row of live.values()) {
        for (const item of row.media || []) {
            if (!isVisualMedia(item)) continue;
            out.push({
                channelId: row.channelId,
                messageId: row.messageId,
                userId: row.authorId,
                userName: row.authorName,
                guildId: row.guildId,
                item,
                at: row.at
            });
        }
    }
    return out;
}

function logLateMedia(message: any) {
    const channelId = String(message?.channel_id || message?.channelId || "");
    const id = String(message?.id || "");
    if (!channelId || !id) return;
    noteBotAuthor(message?.author);
    const media = mediaFromMessage(message);
    if (media.length) refreshEventMedia(channelId, id, media);
    if (!media.length || alreadyLoggedMedia(channelId, id)) return;
    markMediaLogged(channelId, id);
    const name = authorName(message.author);
    logEvent({
        type: "media",
        userId: message.author?.id,
        userName: name,
        channelId,
        guildId: ChannelStore.getChannel(channelId)?.guild_id,
        messageId: id,
        summary: `${name || "someone"} sent media in ${placeName(channelId)}`,
        preview: String(message.content || ""),
        media
    });
}

function onMessageUpdate(event: any) {
    if (event?.optimistic) return;
    const message = event?.message || event;
    if (!message?.id) return;
    const channelId = String(message.channel_id || message.channelId || event?.channelId || event?.channel_id || "");
    observeUser(message.author);
    const prev = live.get(liveKey(channelId || message.channel_id, message.id));
    rememberLive({ ...message, channel_id: channelId || message.channel_id, channelId: channelId || message.channelId });
    logLateMedia({ ...message, channel_id: channelId || message.channel_id });
    if (!message.edited_timestamp) return;
    const next = String(message.content || "");
    const nextMedia = mediaFromMessage(message);
    if (prev && prev.content === next && !nextMedia.length) return;
    logEvent({
        type: "edit",
        userId: message.author?.id || prev?.authorId,
        userName: authorName(message.author) || prev?.authorName,
        channelId: channelId || message.channel_id,
        guildId: ChannelStore.getChannel(channelId || message.channel_id)?.guild_id,
        messageId: message.id,
        summary: `${authorName(message.author) || prev?.authorName || "someone"} edited in ${placeName(channelId || message.channel_id)}`,
        detail: prev ? `${prev.content}\n→\n${next.slice(0, 400)}` : next.slice(0, 400),
        preview: prev ? prev.content : next,
        previewAfter: next,
        media: nextMedia.length ? nextMedia : prev?.media
    });
}

function onMessageDelete({ channelId, id }: { channelId: string; id: string; mlDeleted?: boolean; }) {
    if (!id) return;
    const ping = pings.get(id);
    if (ping) {
        logEvent({
            type: "ghost-ping",
            severity: "warn",
            channelId,
            messageId: id,
            userName: ping.authorName,
            summary: `Ghost ping from ${ping.authorName} in ${placeName(channelId)}`,
            detail: ping.snippet,
            preview: ping.snippet,
            media: ping.media
        });
        pings.delete(id);
    }
    const prev = live.get(liveKey(channelId, id));
    live.delete(liveKey(channelId, id));
    let stored = prev;
    if (!stored) {
        try {
            const msg = MessageStore.getMessage(channelId, id) as any;
            if (msg) stored = {
                channelId,
                messageId: id,
                authorId: msg.author?.id,
                authorName: authorName(msg.author),
                content: String(msg.content || "").slice(0, 400),
                mentionsMe: false,
                guildId: ChannelStore.getChannel(channelId)?.guild_id,
                media: mediaFromMessage(msg)
            };
        } catch { /* ignore */ }
    }
    logEvent({
        type: "delete",
        userId: stored?.authorId,
        userName: stored?.authorName,
        channelId,
        guildId: stored?.guildId || ChannelStore.getChannel(channelId)?.guild_id,
        messageId: id,
        summary: `${stored?.authorName || "someone"} deleted in ${placeName(channelId)}`,
        detail: stored?.content,
        preview: stored?.content,
        media: stored?.media
    });
}

function onMemberUpdate(event: any) {
    const user = event?.user;
    if (!user?.id) return;
    const guildId = event.guildId || event.guild_id;
    observeUser(user, { nick: event.nick, guildId });
    const key = `${guildId}:${user.id}`;
    const roles = (event.roles || []).slice().sort().join(",");
    const timeout = String(event.communicationDisabledUntil || event.communication_disabled_until || "");
    const nick = String(event.nick || "");
    const prev = memberSnap.get(key);
    memberSnap.set(key, { roles, timeout, nick });
    if (!prev) return;
    const name = authorName(user);
    if (prev.roles !== roles) {
        logEvent({
            type: "roles",
            userId: user.id,
            userName: name,
            guildId,
            summary: `${name} roles changed`
        });
    }
    if (prev.timeout !== timeout) {
        logEvent({
            type: "timeout",
            severity: timeout ? "warn" : "info",
            userId: user.id,
            userName: name,
            guildId,
            summary: timeout ? `${name} timed out until ${timeout}` : `${name} timeout cleared`
        });
    }
}

function onChannelUpdates(event: any) {
    const channels = event?.channels || (event?.channel ? [event.channel] : []);
    for (const ch of channels) {
        if (!ch?.id) continue;
        const before = ChannelStore.getChannel(ch.id) as any;
        const bits: string[] = [];
        if (before && ch.name && before.name !== ch.name) bits.push(`name ${before.name} → ${ch.name}`);
        if (ch.topic != null && before && before.topic !== ch.topic) bits.push("topic changed");
        if (ch.nsfw != null && before && Boolean(before.nsfw) !== Boolean(ch.nsfw)) bits.push(`nsfw → ${ch.nsfw}`);
        if (ch.rateLimitPerUser != null && before && before.rateLimitPerUser !== ch.rateLimitPerUser)
            bits.push(`slowmode ${before.rateLimitPerUser || 0}s → ${ch.rateLimitPerUser}s`);
        if (!bits.length) continue;
        logEvent({
            type: "channel",
            channelId: ch.id,
            guildId: ch.guild_id || ch.guildId,
            summary: `${placeName(ch.id, ch.guild_id || ch.guildId)}: ${bits.join(", ")}`
        });
    }
}

function onRelationship(kind: "add" | "remove" | "update", event: any) {
    const rel = event?.relationship || event;
    const id = String(rel?.id || rel?.user?.id || "");
    if (!id) return;
    const user = UserStore.getUser(id) as any;
    observeUser(user || { id });
    const name = authorName(user) || id;
    const type = Number(rel?.type ?? 0);
    const labels: Record<number, string> = { 1: "friend", 2: "blocked", 3: "incoming request", 4: "outgoing request" };
    const label = labels[type] || `type ${type}`;
    logEvent({
        type: "relationship",
        severity: kind === "remove" ? "warn" : "info",
        userId: id,
        userName: name,
        summary: `${name}: ${kind} ${label}`
    });
    if (kind === "add" && type === 3) {
        const created = snowflakeAt(id);
        if (created && created.days < 14) {
            logEvent({
                type: "new-account",
                severity: "warn",
                userId: id,
                userName: name,
                summary: `Incoming request from ${name} — account age ${created.age}`
            });
        }
    }
}

function capMap<K, V>(map: Map<K, V>, max: number) {
    while (map.size > max) {
        const first = map.keys().next().value;
        if (first === undefined) break;
        map.delete(first);
    }
}

function onVoice({ voiceStates }: { voiceStates?: any[]; }) {
    if (!voiceStates?.length) return;
    for (const vs of voiceStates) {
        const userId = String(vs.userId || vs.user_id || "");
        if (!userId) continue;
        const next = vs.channelId || vs.channel_id || "";
        const prev = voiceWas.get(userId) || "";
        if (next) voiceWas.set(userId, String(next));
        else voiceWas.delete(userId);
        const user = UserStore.getUser(userId) as any;
        observeUser(user || { id: userId });
        const name = authorName(user) || userId;
        if (String(next) !== prev) {
            if (!prev && next) {
                logEvent({
                    type: "voice",
                    userId,
                    userName: name,
                    channelId: String(next),
                    guildId: vs.guildId || vs.guild_id,
                    voiceChannelId: String(next),
                    summary: `${name} joined ${placeName(String(next))}`
                });
            } else if (prev && !next) {
                logEvent({
                    type: "voice",
                    userId,
                    userName: name,
                    channelId: prev,
                    voiceChannelId: prev,
                    summary: `${name} left ${placeName(prev)}`
                });
            } else {
                logEvent({
                    type: "voice",
                    userId,
                    userName: name,
                    channelId: String(next),
                    guildId: vs.guildId || vs.guild_id,
                    voiceChannelId: String(next),
                    summary: `${name} moved ${placeName(prev)} → ${placeName(String(next))}`
                });
            }
        }
        const streaming = Boolean(vs.selfStream || vs.self_stream);
        const sk = `${userId}:${next || prev}`;
        if (streaming && !streamWas.has(sk)) {
            streamWas.add(sk);
            logEvent({
                type: "stream",
                userId,
                userName: name,
                channelId: String(next || prev),
                voiceChannelId: String(next || prev),
                summary: `${name} started streaming in ${placeName(String(next || prev))}`
            });
        }
        if (!streaming) streamWas.delete(sk);
        const video = Boolean(vs.selfVideo || vs.self_video);
        const vk = `cam:${userId}:${next || prev}`;
        if (video && next && !streamWas.has(vk)) {
            streamWas.add(vk);
            logEvent({
                type: "camera",
                userId,
                userName: name,
                channelId: String(next),
                voiceChannelId: String(next),
                summary: `${name} turned on camera in ${placeName(String(next))}`
            });
        }
        if (!video) streamWas.delete(vk);
    }
    capMap(voiceWas, 200);
}

function snapshotSessions(announce: boolean) {
    try {
        const sessions = SessionsStore.getSessions?.() || {};
        const ids = new Set<string>();
        for (const [key, session] of Object.entries(sessions)) {
            const id = String(session?.sessionId || key);
            ids.add(id);
            if (announce && sessionsReady && !knownSessions.has(id)) {
                const client = session?.clientInfo?.client || "unknown";
                const os = session?.clientInfo?.os || "";
                logEvent({
                    type: "session",
                    severity: "warn",
                    summary: `New session on your account: ${client}${os ? ` · ${os}` : ""}`
                });
            }
        }
        knownSessions.clear();
        for (const id of ids) knownSessions.add(id);
        sessionsReady = true;
    } catch { /* ignore */ }
}

function pollComposer() {
    try {
        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) return;
        const draft = String(DraftStore.getDraft(channelId, DraftType.ChannelMessage) || "");
        if (!draft || draft === lastLeak) return;
        const kind = secretKind(draft);
        if (!kind) return;
        lastLeak = draft;
        if (warnComposerLeak(kind)) {
            logEvent({
                type: "composer-leak",
                severity: "warn",
                channelId,
                summary: kind === "token"
                    ? "Your draft looked like a bot token. Secret was not stored."
                    : "Your draft looked like a webhook URL. Secret was not stored."
            });
        }
    } catch { /* ignore */ }
}

function onPresence({ updates }: { updates?: any[]; }) {
    if (!updates?.length) return;
    for (const u of updates) {
        const id = u?.user?.id;
        if (!id) continue;
        const custom = (u.activities || []).find((a: any) => a?.type === 4);
        statuses.set(id, String(custom?.state || custom?.name || ""));
        notePresence(id, u.status, u.clientStatus);
    }
    capMap(statuses, 120);
    capMap(platforms, 120);
}

function onTyping(_event: { channelId?: string; userId?: string; }) {
    /* skip — timers and ghost rows cost more than they are worth */
}

export function startFluxExtras() {
    bindIngest(ingestMessage);
    snapshotSessions(false);
    if (leakTimer != null) clearInterval(leakTimer);
    leakTimer = setInterval(() => {
        pollComposer();
        snapshotSessions(true);
    }, 10000);
    startWideCatch();
}

export function stopFluxExtras() {
    stopWideCatch();
    if (leakTimer != null) clearInterval(leakTimer);
    leakTimer = null;
    for (const t of typingWait.values()) clearTimeout(t);
    typingWait.clear();
}

function guardHandlers<T extends Record<string, (...args: any[]) => unknown>>(handlers: T): T {
    const out = {} as T;
    for (const key of Object.keys(handlers) as Array<keyof T>) {
        const fn = handlers[key];
        out[key] = ((...args: any[]) => {
            try {
                return fn(...args);
            } catch { /* keep Discord flux alive */ }
        }) as T[keyof T];
    }
    return out;
}

export const fluxHandlers = guardHandlers({
    MESSAGE_CREATE: onMessageCreate,
    MESSAGE_UPDATE: onMessageUpdate,
    MESSAGE_DELETE: onMessageDelete,
    MESSAGE_DELETE_BULK({ channelId, ids }: { channelId: string; ids?: string[]; }) {
        if ((ids?.length || 0) > 1) {
            logEvent({
                type: "bulk-delete",
                severity: "warn",
                channelId,
                summary: `Bulk delete ${ids!.length} messages in ${placeName(channelId)}`
            });
        }
        for (const id of ids ?? []) onMessageDelete({ channelId, id });
    },
    GUILD_MEMBER_UPDATE: onMemberUpdate,
    CHANNEL_UPDATES: onChannelUpdates,
    CHANNEL_UPDATE: onChannelUpdates,
    RELATIONSHIP_ADD: (e: any) => onRelationship("add", e),
    RELATIONSHIP_REMOVE: (e: any) => onRelationship("remove", e),
    RELATIONSHIP_UPDATE: (e: any) => onRelationship("update", e),
    VOICE_STATE_UPDATES: onVoice,
    PRESENCE_UPDATES: onPresence,
    TYPING_START: onTyping,
    CHANNEL_SELECT({ channelId }: { channelId?: string; }) {
        harvestChannel(channelId);
        watchChannel(channelId);
    },
    LOAD_MESSAGES_SUCCESS: ingestLoadedMessages,
    LOAD_MESSAGES_AROUND_SUCCESS: ingestLoadedMessages,
    LOAD_RECENT_MENTIONS_SUCCESS: ingestLoadedMessages,
    THREAD_LIST_SYNC(event: any) {
        ingestLoadedMessages(event);
    },
    CHANNEL_PINS_UPDATE({ channelId }: { channelId?: string; }) {
        if (!channelId) return;
        logEvent({ type: "pins", channelId, summary: `Pins changed in ${placeName(channelId)}` });
    },
    THREAD_CREATE({ channel, thread }: { channel?: any; thread?: any; }) {
        const ch = thread || channel;
        if (!ch?.id) return;
        harvestChannel(ch.id);
        logEvent({
            type: "thread",
            channelId: ch.id,
            guildId: ch.guild_id,
            summary: `Thread ${ch.name || ch.id} in ${placeName(ch.parent_id || ch.id)}`
        });
    },
    CHANNEL_CREATE({ channel }: { channel?: any; }) {
        if (!channel?.id) return;
        const type = channel.type ?? channel.Type;
        if (type === 1 || type === 3) {
            logEvent({
                type: "dm",
                channelId: channel.id,
                summary: type === 3 ? `Group DM ${channel.name || channel.id}` : `DM opened ${channel.id}`
            });
            harvestChannel(channel.id);
            return;
        }
        logEvent({
            type: "channel",
            channelId: channel.id,
            guildId: channel.guild_id,
            summary: `Channel created ${channel.name || channel.id}`
        });
        watchChannel(channel.id);
    },
    CHANNEL_DELETE({ channel }: { channel?: any; }) {
        if (!channel?.id) return;
        logEvent({
            type: "channel",
            channelId: channel.id,
            guildId: channel.guild_id,
            summary: `Channel deleted ${channel.name || channel.id}`
        });
    },
    CALL_CREATE({ channelId }: { channelId?: string; }) {
        if (!channelId) return;
        logEvent({ type: "call", channelId, summary: `Call started in ${placeName(channelId)}` });
    },
    CALL_DELETE({ channelId }: { channelId?: string; }) {
        if (!channelId) return;
        logEvent({ type: "call", channelId, summary: `Call ended in ${placeName(channelId)}` });
    },
    MESSAGE_REACTION_ADD() { /* skip — too chatty */ },
    MESSAGE_REACTION_REMOVE() { /* skip — too chatty */ },
    GUILD_CREATE({ guild }: { guild?: any; }) {
        if (!guild?.id) return;
        logEvent({ type: "guild-join", guildId: guild.id, summary: `Joined server ${guild.name || guild.id}` });
        watchGuild(guild.id);
    },
    GUILD_DELETE({ guild }: { guild?: any; }) {
        const id = guild?.id;
        if (!id) return;
        const name = GuildStore.getGuild(id)?.name || id;
        logEvent({ type: "guild-leave", severity: "warn", guildId: id, summary: `Left / removed from ${name}` });
    },
    CONNECTION_OPEN() {
        snapshotSessions(true);
        onWideReconnect();
    }
});
