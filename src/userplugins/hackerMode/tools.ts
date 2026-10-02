/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "./settings";

export const TOOLS = [
    { id: "feed", label: "Incident feed", description: "Log every action this client sees: send, edit, delete, VC, and more", group: "memory" },
    { id: "dossiers", label: "Dossiers", description: "Per-user file of facts this client has seen", group: "memory" },
    { id: "identityLog", label: "Name / nick / avatar log", description: "Record observed username, nick, and avatar changes", group: "memory" },
    { id: "deleteEdit", label: "Delete + edit watch", description: "Log deletes and edits this client already received", group: "memory" },
    { id: "ghostPing", label: "Ghost ping", description: "You were mentioned, then the message vanished", group: "memory" },
    { id: "voiceLog", label: "Voice join / leave", description: "Joins and leaves in voice channels you are in", group: "memory" },
    { id: "relationships", label: "Friend / block events", description: "Friend, request, and block changes on your account", group: "memory" },
    { id: "channelLog", label: "Channel changes", description: "Name, topic, and NSFW flag updates you receive", group: "memory" },
    { id: "attachments", label: "Attachment catalog", description: "Log files people send. Preview opens in Discord; nothing is downloaded", group: "memory" },
    { id: "sessions", label: "Your sessions", description: "New gateway session on your account", group: "memory" },
    { id: "snowflake", label: "Snowflake clock", description: "Created-at from any Discord snowflake ID", group: "intel" },
    { id: "copyKit", label: "Copy kit", description: "Copy user, message, channel, guild, role IDs and permalinks", group: "intel" },
    { id: "whoIs", label: "Who-is-this", description: "Age, flags, relationship, and mutuals from client stores", group: "intel" },
    { id: "mutuals", label: "Mutual server map", description: "Guilds you share with a user", group: "intel" },
    { id: "perms", label: "Role + permission dump", description: "Permissions Discord already computed for you or a member", group: "intel" },
    { id: "serverIntel", label: "Server intel", description: "Owner, features, verification, boosts, vanity if visible", group: "intel" },
    { id: "emojiOrigin", label: "Emoji / sticker origin", description: "Which guild an emoji or sticker came from, if known", group: "intel" },
    { id: "invites", label: "Invite inspector", description: "Decode invite codes in messages you can see", group: "intel" },
    { id: "maskedLinks", label: "Masked-link reveal", description: "Show the real URL behind markdown labels", group: "safety" },
    { id: "scam", label: "Scam heuristic", description: "Flag nitro / login / webhook-looking text you see", group: "safety" },
    { id: "unicode", label: "Homoglyph / RTL / invisible unicode", description: "Suspicious characters in names and messages", group: "safety" },
    { id: "newAccount", label: "New-account friend warning", description: "Warn on incoming requests from very new accounts", group: "safety" },
    { id: "composerLeak", label: "Composer leak warning", description: "Warn if you paste a bot token or webhook URL (secret is not stored)", group: "safety" },
    { id: "exportSearch", label: "Export / search", description: "Filter the ledger, copy JSON, open the StalkerMode folder", group: "safety" },

    { id: "jumpMessage", label: "Jump to message", description: "Open the logged message in chat", group: "action" },
    { id: "joinVoice", label: "Join voice", description: "Join the voice channel from a voice event", group: "action" },
    { id: "messagePreview", label: "Message previews", description: "Show text and media labels. Open the file inside Discord — nothing is downloaded", group: "action" },
    { id: "pinWatch", label: "Pin watch", description: "Log when a channel's pins change", group: "memory" },
    { id: "reactionBurst", label: "Reaction burst", description: "Log when a cached message suddenly gets many reactions", group: "memory", default: false },
    { id: "threadWatch", label: "Thread watch", description: "Log threads created in channels you can see", group: "memory" },
    { id: "timeoutWatch", label: "Timeout watch", description: "Log member timeouts this client is told about", group: "memory" },
    { id: "roleDelta", label: "Role delta", description: "Log role add/remove on members you already see", group: "memory" },
    { id: "typingGhost", label: "Typing ghost", description: "Someone typed in a channel you are in and never sent", group: "memory", default: false },
    { id: "dmCreate", label: "New DM / group", description: "Log DMs and group chats opened on this account", group: "memory" },
    { id: "callWatch", label: "Call watch", description: "Log call start/stop events this client receives", group: "memory" },
    { id: "streamWatch", label: "Stream watch", description: "Log Go Live / camera in voice channels you are in", group: "memory" },
    { id: "everyonePing", label: "@everyone / @here", description: "Log mass mentions you can see", group: "memory" },
    { id: "replyWatch", label: "Replies to you", description: "Log messages that reply to you", group: "memory" },
    { id: "slowmodeWatch", label: "Slowmode watch", description: "Log slowmode changes", group: "memory" },
    { id: "voiceRoster", label: "Voice roster", description: "List who is in the VC on voice events", group: "intel" },
    { id: "platformWatch", label: "Platform watch", description: "Desktop / mobile / web from presence you already get", group: "intel", default: false },
    { id: "customStatus", label: "Custom status", description: "Log custom status changes you observe", group: "intel", default: false },
    { id: "joinDate", label: "Server join date", description: "Show joined-at on who-is when Discord sent it", group: "intel" },
    { id: "userFlags", label: "Public flags", description: "Decode staff/partner/hypesquad bits Discord already sent", group: "intel" },
    { id: "nitroBadge", label: "Nitro badge", description: "Show premium type if the client has it", group: "intel" },
    { id: "overwriteDump", label: "Overwrite dump", description: "Channel permission overwrites on inspect", group: "intel" },
    { id: "categoryTree", label: "Category tree", description: "Show parent category and sibling channels", group: "intel" },
    { id: "voiceBitrate", label: "Voice bitrate / limit", description: "Bitrate and user limit on voice channels", group: "intel" },
    { id: "stickerWatch", label: "Sticker watch", description: "Log stickers on messages you see", group: "memory", default: false },
    { id: "pollWatch", label: "Poll watch", description: "Log polls you can see", group: "memory" },
    { id: "embedWatch", label: "Embed titles", description: "Log embed titles on messages you see", group: "memory", default: false },
    { id: "mentionMe", label: "Mentions of you", description: "Log every visible mention of you, even if not deleted", group: "memory", default: false },
    { id: "burstDelete", label: "Bulk delete", description: "Log purge / bulk delete counts", group: "memory" },
    { id: "reconnectWatch", label: "Reconnect", description: "Log when this client reconnects to the gateway", group: "memory" },
    { id: "guildJoinWatch", label: "Server join / leave", description: "Log guilds this account joins or leaves", group: "memory" },
    { id: "emojiMarkdown", label: "Emoji markdown", description: "Copy custom emoji markdown from inspect", group: "intel" },
    { id: "timestampDecode", label: "Timestamp decode", description: "Decode Discord <t:unix> timestamps in a message", group: "intel" },
    { id: "roleColors", label: "Role colors", description: "Show role colors on who-is", group: "intel" },
    { id: "pendingMember", label: "Pending member", description: "Flag membership-screening pending users", group: "intel" },
    { id: "webhookTag", label: "Webhook / system tag", description: "Mark webhook and system messages in the feed", group: "intel" },
    { id: "spoilerWatch", label: "Spoiler files", description: "Log spoiler-tagged attachments you see", group: "memory", default: false },
    { id: "afkChannel", label: "AFK channel", description: "Show the server AFK channel on inspect", group: "intel" },
    { id: "rulesChannel", label: "Rules channel", description: "Show the rules channel on inspect", group: "intel" },
    { id: "systemChannel", label: "System channel", description: "Show the system messages channel on inspect", group: "intel" }
] as const;

export type ToolId = typeof TOOLS[number]["id"];

export function toolOn(id: ToolId) {
    const v = (settings.store as Record<string, unknown>)[id];
    if (v === undefined) {
        const tool = TOOLS.find(t => t.id === id) as { default?: boolean; } | undefined;
        return tool?.default !== false;
    }
    return Boolean(v);
}

export function setTool(id: ToolId, on: boolean) {
    (settings.store as Record<string, unknown>)[id] = on;
}
