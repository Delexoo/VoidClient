/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Severity = "info" | "warn";

export type LedgerMedia = {
    id?: string;
    url: string;
    poster?: string;
    name?: string;
    kind: "image" | "gif" | "video" | "audio" | "file";
    spoiler?: boolean;
    width?: number;
    height?: number;
};

export type LedgerEvent = {
    id: string;
    at: number;
    type: string;
    severity: Severity;
    userId?: string;
    userName?: string;
    channelId?: string;
    guildId?: string;
    messageId?: string;
    summary: string;
    detail?: string;
    preview?: string;
    previewAfter?: string;
    voiceChannelId?: string;
    media?: LedgerMedia[];
};

export type NameHit = {
    value: string;
    at: number;
};

export type Dossier = {
    id: string;
    username?: string;
    globalName?: string;
    bot?: boolean;
    flags?: number;
    usernames: NameHit[];
    nicks: NameHit[];
    avatars: NameHit[];
    firstSeen: number;
    lastSeen: number;
};

export type InspectTarget = {
    kind: "user" | "message" | "channel" | "guild" | "role";
    id: string;
    extra?: string;
    channelId?: string;
    messageId?: string;
};
