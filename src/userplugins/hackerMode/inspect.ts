/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyWithToast } from "@utils/discord";
import {
    ChannelStore,
    EmojiStore,
    FluxDispatcher,
    GuildMemberStore,
    GuildRoleStore,
    GuildStore,
    PermissionStore,
    PermissionsBits,
    RelationshipStore,
    RestAPI,
    SnowflakeUtils,
    StickersStore,
    UserProfileStore,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

import { getDossier } from "./dossier";

export function snowflakeAt(id: string) {
    try {
        const ms = SnowflakeUtils.extractTimestamp(String(id));
        if (!ms || !Number.isFinite(ms)) return null;
        const date = new Date(ms);
        const ageMs = Date.now() - ms;
        const days = Math.floor(ageMs / 86400000);
        const age = days >= 365
            ? `${(days / 365).toFixed(1)} years`
            : days >= 1
                ? `${days} day${days === 1 ? "" : "s"}`
                : `${Math.max(0, Math.floor(ageMs / 3600000))} hours`;
        return { ms, iso: date.toISOString(), local: date.toLocaleString(), age, days };
    } catch {
        return null;
    }
}

export function copyId(label: string, value: string) {
    const text = String(value || "").trim();
    if (!text) return;
    copyWithToast(text, `${label} copied`);
}

export function messagePermalink(channelId: string, messageId: string, guildId?: string) {
    const guild = guildId || ChannelStore.getChannel(channelId)?.guild_id || "@me";
    return `https://discord.com/channels/${guild || "@me"}/${channelId}/${messageId}`;
}

function relationshipLabel(userId: string) {
    try {
        const type = Number(RelationshipStore.getRelationshipType?.(userId) ?? 0);
        switch (type) {
            case 1: return "friend";
            case 2: return "blocked";
            case 3: return "incoming request";
            case 4: return "outgoing request";
            case 5: return "implicit";
            default: return RelationshipStore.isBlocked?.(userId) ? "blocked" : "none";
        }
    } catch {
        return "unknown";
    }
}

export function mutualGuilds(userId: string) {
    const out: Array<{ id: string; name: string; nick?: string; }> = [];
    try {
        const guilds = GuildStore.getGuilds?.() || {};
        for (const guild of Object.values(guilds) as any[]) {
            if (!guild?.id) continue;
            if (!GuildMemberStore.isMember?.(guild.id, userId)) continue;
            const member = GuildMemberStore.getMember(guild.id, userId);
            out.push({
                id: guild.id,
                name: String(guild.name || guild.id),
                nick: member?.nick || undefined
            });
        }
    } catch { /* ignore */ }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

function bitsToNames(bits: bigint) {
    const names: string[] = [];
    for (const [name, bit] of Object.entries(PermissionsBits as Record<string, unknown>)) {
        if (typeof bit !== "bigint") continue;
        if ((bits & bit) === bit) names.push(name);
    }
    return names.sort();
}

function allPerms() {
    let bits = 0n;
    for (const bit of Object.values(PermissionsBits as Record<string, unknown>)) {
        if (typeof bit === "bigint") bits |= bit;
    }
    return bits;
}

export function memberPermissions(guildId: string, userId: string) {
    const guild = GuildStore.getGuild(guildId);
    if (!guild) return { names: [] as string[], owner: false, admin: false };
    if (guild.ownerId === userId)
        return { names: bitsToNames(allPerms()), owner: true, admin: true };

    const member = GuildMemberStore.getMember(guildId, userId);
    const everyone = GuildRoleStore.getRole(guildId, guildId);
    let bits = BigInt((everyone as any)?.permissions ?? 0);
    for (const roleId of member?.roles || []) {
        const role = GuildRoleStore.getRole(guildId, roleId);
        if (role) bits |= BigInt((role as any).permissions ?? 0);
    }
    const adminBit = (PermissionsBits as any).ADMINISTRATOR as bigint | undefined;
    const admin = Boolean(adminBit && (bits & adminBit) === adminBit);
    return { names: bitsToNames(admin ? allPerms() : bits), owner: false, admin };
}

export function myChannelPermissions(channelId: string) {
    try {
        const channel = ChannelStore.getChannel(channelId);
        if (!channel) return [] as string[];
        const bits = BigInt(PermissionStore.getChannelPermissions?.(channel) ?? 0);
        return bitsToNames(bits);
    } catch {
        return [];
    }
}

export function roleDump(guildId: string, userId?: string) {
    const member = userId ? GuildMemberStore.getMember(guildId, userId) : null;
    const ids = member?.roles?.length
        ? member.roles
        : Object.keys(GuildRoleStore.getRoles?.(guildId) || {});
    return ids.map(id => {
        const role = GuildRoleStore.getRole(guildId, id);
        return role
            ? { id: role.id, name: role.name, color: role.colorString || "", hoist: Boolean(role.hoist), managed: Boolean(role.managed) }
            : { id, name: id, color: "", hoist: false, managed: false };
    });
}

export function serverIntel(guildId: string) {
    const guild = GuildStore.getGuild(guildId) as any;
    if (!guild) return null;
    const owner = UserStore.getUser(guild.ownerId);
    const created = snowflakeAt(guild.id);
    return {
        id: guild.id,
        name: String(guild.name || guild.id),
        ownerId: String(guild.ownerId || ""),
        ownerName: owner ? String(owner.globalName || owner.username || owner.id) : guild.ownerId,
        features: [...(guild.features || [])].map(String).sort(),
        verificationLevel: guild.verificationLevel,
        nsfwLevel: guild.nsfwLevel,
        premiumTier: guild.premiumTier,
        premiumCount: guild.premiumSubscriberCount ?? guild.premiumSince,
        vanity: guild.vanityURLCode || "",
        description: guild.description || "",
        memberCount: guild.memberCount,
        created
    };
}

const EMOJI_RE = /<a?:(\w+):(\d+)>/g;

export function emojiOrigins(text: string) {
    const out: Array<{ name: string; id: string; guild?: string; } > = [];
    const seen = new Set<string>();
    for (const match of String(text || "").matchAll(EMOJI_RE)) {
        const id = match[2];
        if (seen.has(id)) continue;
        seen.add(id);
        const emoji = EmojiStore.getCustomEmojiById?.(id) as any;
        const guildId = emoji?.guildId || emoji?.guild_id;
        const guild = guildId ? GuildStore.getGuild(guildId) : null;
        out.push({
            name: emoji?.name || match[1],
            id,
            guild: guild ? `${guild.name} (${guild.id})` : guildId || "unknown guild"
        });
    }
    return out;
}

export function stickerOrigins(ids: string[]) {
    return ids.map(id => {
        const sticker = StickersStore.getStickerById?.(id) as any;
        const guildId = sticker?.guildId || sticker?.guild_id;
        const guild = guildId ? GuildStore.getGuild(guildId) : null;
        return {
            name: sticker?.name || id,
            id,
            guild: guild ? `${guild.name} (${guild.id})` : guildId || "unknown guild"
        };
    });
}

const INVITE_RE = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-zA-Z0-9-]+)/gi;

export function inviteCodes(text: string) {
    const codes = new Set<string>();
    for (const match of String(text || "").matchAll(INVITE_RE))
        if (match[1]) codes.add(match[1]);
    return [...codes];
}

export async function fetchInvite(code: string) {
    const res = await RestAPI.get({
        url: `/invites/${code}`,
        query: { with_counts: true, with_expiration: true }
    });
    const body = res?.body as any;
    const guild = body?.guild;
    const channel = body?.channel;
    const inviter = body?.inviter;
    return {
        code: body?.code || code,
        guild: guild ? `${guild.name} (${guild.id})` : "unknown",
        channel: channel ? `${channel.name || channel.id}` : "",
        inviter: inviter ? `${inviter.username || inviter.id}` : "",
        members: body?.approximate_member_count,
        online: body?.approximate_presence_count,
        expires: body?.expires_at || ""
    };
}

export function whoIs(userId: string, guildId?: string) {
    const user = UserStore.getUser(userId) as any;
    const created = snowflakeAt(userId);
    const dossier = getDossier(userId);
    const member = guildId ? GuildMemberStore.getMember(guildId, userId) : null;
    const perms = guildId ? memberPermissions(guildId, userId) : null;
    return {
        id: userId,
        username: String(user?.username || dossier?.username || userId),
        globalName: String(user?.globalName || user?.global_name || dossier?.globalName || ""),
        bot: Boolean(user?.bot || dossier?.bot),
        system: Boolean(user?.system),
        flags: Number(user?.flags || user?.publicFlags || dossier?.flags || 0),
        created,
        relationship: relationshipLabel(userId),
        nick: member?.nick || "",
        roles: guildId ? roleDump(guildId, userId) : [],
        perms,
        mutuals: mutualGuilds(userId),
        dossier
    };
}

export function formatWho(userId: string, guildId?: string) {
    const info = whoIs(userId, guildId);
    const user = UserStore.getUser(userId) as any;
    const tag = user?.discriminator && user.discriminator !== "0" ? `#${user.discriminator}` : "";
    const lines = [
        `${info.globalName || info.username}  @${info.username}${tag}`,
        `id  ${info.id}`,
        `created  ${info.created?.local || "unknown"}  (${info.created?.age || "?"})`,
        `relationship  ${info.relationship}`,
        info.bot ? "bot  yes" : "",
        info.system ? "system  yes" : "",
        info.nick ? `nick  ${info.nick}` : "",
        user?.avatar ? `avatar  ${user.avatar}` : "",
        `mutuals  ${info.mutuals.map(g => g.name).join(", ") || "none in cache"}`,
        info.perms ? `perms  ${info.perms.owner ? "owner" : info.perms.admin ? "admin" : info.perms.names.slice(0, 16).join(", ") || "none"}` : "",
        info.roles.length ? `roles  ${info.roles.map(r => r.name).join(", ")}` : ""
    ].filter(Boolean);
    return { info, text: lines.join("\n") };
}

export async function refreshUserProfile(userId: string, guildId?: string) {
    try {
        const { body } = await RestAPI.get({
            url: `/users/${userId}/profile`,
            query: {
                with_mutual_guilds: true,
                with_mutual_friends_count: true,
                ...(guildId ? { guild_id: guildId } : {})
            },
            oldFormErrors: true
        });
        if (body?.user) FluxDispatcher.dispatch({ type: "USER_UPDATE", user: body.user });
        await FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_SUCCESS", userProfile: body });
        if (guildId && body?.guild_member)
            FluxDispatcher.dispatch({ type: "GUILD_MEMBER_PROFILE_UPDATE", guildId, guildMember: body.guild_member });
        return UserProfileStore.getUserProfile(userId) || body;
    } catch {
        return UserProfileStore.getUserProfile(userId);
    }
}

export function connectedSocials(profile: any) {
    const acc = profile?.connectedAccounts || profile?.connected_accounts || [];
    if (!Array.isArray(acc)) return [] as Array<{ type: string; name: string; id: string; verified: boolean; }>;
    return acc.map((a: any) => ({
        type: String(a.type || "account"),
        name: String(a.name || a.id || ""),
        id: String(a.id || ""),
        verified: Boolean(a.verified)
    }));
}

export function profileLines(profile: any, userId: string) {
    if (!profile) return [] as string[];
    const user = UserStore.getUser(userId) as any;
    const nitro = Number(profile.premiumType ?? profile.premium_type ?? user?.premiumType ?? 0);
    const nitroLabel = nitro === 1 ? "classic" : nitro === 3 ? "basic" : nitro ? "nitro" : "";
    const bio = String(profile.bio || profile.guildMemberProfile?.bio || "").trim();
    const pronouns = String(profile.pronouns || profile.guildMemberProfile?.pronouns || user?.pronouns || "").trim();
    const premiumSince = profile.premiumSince || profile.premium_since;
    const clan = user?.primaryGuild || user?.clan;
    const mutualFriends = profile.mutualFriendsCount ?? profile.mutual_friends_count;
    return [
        pronouns ? `pronouns  ${pronouns}` : "",
        bio ? `bio  ${bio.slice(0, 400)}` : "",
        nitroLabel ? `nitro  ${nitroLabel}` : "",
        premiumSince ? `nitro since  ${new Date(premiumSince).toLocaleString()}` : "",
        clan?.tag ? `clan  ${clan.tag}${clan.identity_guild_id || clan.identityGuildId ? ` (${clan.identity_guild_id || clan.identityGuildId})` : ""}` : "",
        typeof mutualFriends === "number" ? `mutual friends  ${mutualFriends}` : "",
        profile.legacyUsername ? `legacy  ${profile.legacyUsername}` : "",
        profile.accentColor || profile.accent_color ? `accent  ${profile.accentColor || profile.accent_color}` : ""
    ].filter(Boolean);
}

const FLAG_BITS: Array<[number, string]> = [
    [1, "staff"],
    [2, "partner"],
    [4, "hypesquad"],
    [8, "bug hunter"],
    [64, "hypesquad bravery"],
    [128, "hypesquad brilliance"],
    [256, "hypesquad balance"],
    [512, "early supporter"],
    [16384, "bug hunter 2"],
    [65536, "verified bot"],
    [131072, "early verified bot dev"],
    [262144, "certified moderator"],
    [4194304, "active developer"]
];

export function decodeFlags(flags: number) {
    return FLAG_BITS.filter(([bit]) => (flags & bit) === bit).map(([, name]) => name);
}

export function voiceRoster(channelId: string) {
    const names: string[] = [];
    try {
        const states = VoiceStateStore.getVoiceStatesForChannel?.(channelId) as Record<string, any> | any[] | undefined;
        const list = Array.isArray(states) ? states : Object.values(states || {});
        for (const vs of list) {
            const id = vs?.userId || vs?.user_id;
            if (!id) continue;
            const user = UserStore.getUser(id) as any;
            names.push(String(user?.globalName || user?.username || id));
        }
    } catch { /* ignore */ }
    return names;
}

export function channelOverwrites(channelId: string) {
    const channel = ChannelStore.getChannel(channelId) as any;
    const raw = channel?.permissionOverwrites || {};
    return Object.values(raw).slice(0, 24).map((ow: any) => {
        const role = channel?.guild_id ? GuildRoleStore.getRole(channel.guild_id, ow.id) : null;
        const user = UserStore.getUser(ow.id);
        const name = role?.name || (user as any)?.username || ow.id;
        return `${ow.type === 1 ? "member" : "role"} ${name} allow=${ow.allow} deny=${ow.deny}`;
    });
}

export function categoryTree(channelId: string) {
    const channel = ChannelStore.getChannel(channelId) as any;
    if (!channel) return "";
    const parent = channel.parent_id ? ChannelStore.getChannel(channel.parent_id) : null;
    return parent ? `category  #${parent.name}` : "no category";
}

export function voiceMeta(channelId: string) {
    const channel = ChannelStore.getChannel(channelId) as any;
    if (!channel) return "";
    const bits = [
        channel.bitrate ? `bitrate  ${Math.round(channel.bitrate / 1000)} kbps` : "",
        channel.userLimit != null ? `user limit  ${channel.userLimit || "none"}` : "",
        channel.rtcRegion ? `region  ${channel.rtcRegion}` : ""
    ].filter(Boolean);
    return bits.join("\n");
}

export function timestampsIn(text: string) {
    const out: string[] = [];
    for (const m of String(text || "").matchAll(/<t:(\d+)(?::(\w))?>/g)) {
        const date = new Date(Number(m[1]) * 1000);
        out.push(`${m[0]} → ${date.toLocaleString()}`);
    }
    return out;
}

export function guildExtra(guildId: string) {
    const guild = GuildStore.getGuild(guildId) as any;
    if (!guild) return "";
    const afk = guild.afkChannelId ? ChannelStore.getChannel(guild.afkChannelId) : null;
    const rules = guild.rulesChannelId ? ChannelStore.getChannel(guild.rulesChannelId) : null;
    const sys = guild.systemChannelId ? ChannelStore.getChannel(guild.systemChannelId) : null;
    return [
        afk ? `afk  #${afk.name}` : "",
        rules ? `rules  #${rules.name}` : "",
        sys ? `system  #${sys.name}` : "",
        guild.afkTimeout ? `afk timeout  ${guild.afkTimeout}s` : ""
    ].filter(Boolean).join("\n");
}

export function memberExtras(guildId: string, userId: string) {
    const member = GuildMemberStore.getMember(guildId, userId) as any;
    if (!member) return { joined: "", pending: false, timeout: "", premium: "" };
    return {
        joined: member.joinedAt ? new Date(member.joinedAt).toLocaleString() : "",
        pending: Boolean(member.isPending || member.pending),
        timeout: member.communicationDisabledUntil ? String(member.communicationDisabledUntil) : "",
        premium: member.premiumSince ? `boosting since ${new Date(member.premiumSince).toLocaleString()}` : ""
    };
}
