/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { migratePluginSettings } from "@api/Settings";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { copyWithToast } from "@utils/discord";
import definePlugin, { IconComponent } from "@utils/types";
import type { Channel, Guild, Message, Role, User } from "@vencord/discord-types";
import { ChannelStore, Menu, showToast, Toasts, useEffect, useState } from "@webpack/common";

import { Delexo } from "../_delexo/author";
import { HeaderSlotButton, mountBeforeThreads } from "../_delexo/headerSlot";
import { jumpToMessage, joinVoice } from "./actions";
import { flushDossiers, loadDossiers } from "./dossier";
import { fluxHandlers, startFluxExtras, stopFluxExtras } from "./flux";
import { copyId, formatWho, messagePermalink, snowflakeAt } from "./inspect";
import { LastOnlineLine, startLastOnline, stopLastOnline } from "./lastOnline";
import { flushLedger, loadLedger } from "./ledger";
import { settings } from "./settings";
import managedStyle from "./style.css?managed";
import { toolOn } from "./tools";
import { mountOverlay, setInspectTarget, showOverlay, subscribeOverlay, toggleOverlay, unmountOverlay, isOpen } from "./ui/Overlay";

migratePluginSettings("StalkerMode", "HackerMode");

const HackerIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg viewBox="0 0 24 24" height={height} width={width} className={className} fill="currentColor">
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9A1.5 1.5 0 0 1 18.5 16H13l-2.2 3.2a.75.75 0 0 1-1.3-.55V16H5.5A1.5 1.5 0 0 1 4 14.5v-9Zm3.2 3.05 1.1-.9 2.2 2.7 2.2-2.7 1.1.9L11.4 12l2.4 2.95-1.1.9-2.2-2.7-2.2 2.7-1.1-.9L9.6 12 7.2 8.55Z" />
    </svg>
);

function inspectUser(user?: User | null, guildId?: string) {
    if (!user?.id) return;
    setInspectTarget({ kind: "user", id: user.id, extra: guildId });
    showOverlay();
}

function inspectMessage(message?: Message | null) {
    if (!message?.id || !message.channel_id) return;
    setInspectTarget({ kind: "message", id: message.id, extra: message.channel_id });
    showOverlay();
}

function copyCreated(id: string) {
    const created = snowflakeAt(id);
    if (!created) {
        showToast("Not a valid snowflake", Toasts.Type.FAILURE);
        return;
    }
    copyWithToast(`${created.iso} (${created.age})`, "Created-at copied");
}

const messageCtx: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    if (!message?.id) return;
    const channel = ChannelStore.getChannel(message.channel_id);
    children.push(
        <Menu.MenuItem id="vc-hm-msg" label="Stalker Mode" icon={HackerIcon} leadingAccessory={{ type: "icon", icon: HackerIcon }}>
            <Menu.MenuItem id="vc-hm-msg-inspect" label="Inspect" action={() => inspectMessage(message)} />
            {toolOn("jumpMessage") && (
                <Menu.MenuItem
                    id="vc-hm-msg-jump"
                    label="Jump to message"
                    action={() => jumpToMessage(message.channel_id, message.id)}
                />
            )}
            {toolOn("copyKit") && <Menu.MenuItem id="vc-hm-msg-id" label="Copy message ID" action={() => copyId("Message ID", message.id)} />}
            {toolOn("copyKit") && (
                <Menu.MenuItem
                    id="vc-hm-msg-link"
                    label="Copy permalink"
                    action={() => copyWithToast(messagePermalink(message.channel_id, message.id, channel?.guild_id), "Permalink copied")}
                />
            )}
            {toolOn("snowflake") && <Menu.MenuItem id="vc-hm-msg-age" label="Copy created-at" action={() => copyCreated(message.id)} />}
            {message.author?.id && <Menu.MenuItem id="vc-hm-msg-who" label="Who is author" action={() => inspectUser(message.author, channel?.guild_id)} />}
        </Menu.MenuItem>
    );
};

const userCtx: NavContextMenuPatchCallback = (children, { user, guildId }: { user: User; guildId?: string; }) => {
    if (!user?.id) return;
    children.push(
        <Menu.MenuItem id="vc-hm-user" label="Stalker Mode" icon={HackerIcon} leadingAccessory={{ type: "icon", icon: HackerIcon }}>
            <Menu.MenuItem id="vc-hm-user-who" label="Who is this" action={() => inspectUser(user, guildId)} />
            {toolOn("copyKit") && <Menu.MenuItem id="vc-hm-user-id" label="Copy user ID" action={() => copyId("User ID", user.id)} />}
            {toolOn("snowflake") && <Menu.MenuItem id="vc-hm-user-age" label="Copy created-at" action={() => copyCreated(user.id)} />}
            {toolOn("whoIs") && (
                <Menu.MenuItem
                    id="vc-hm-user-copywho"
                    label="Copy who-is card"
                    action={() => copyWithToast(formatWho(user.id, guildId).text, "Who-is copied")}
                />
            )}
        </Menu.MenuItem>
    );
};

const channelCtx: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!channel?.id) return;
    children.push(
        <Menu.MenuItem id="vc-hm-ch" label="Stalker Mode" icon={HackerIcon} leadingAccessory={{ type: "icon", icon: HackerIcon }}>
            <Menu.MenuItem
                id="vc-hm-ch-inspect"
                label="Inspect channel"
                action={() => { setInspectTarget({ kind: "channel", id: channel.id }); showOverlay(); }}
            />
            {toolOn("copyKit") && <Menu.MenuItem id="vc-hm-ch-id" label="Copy channel ID" action={() => copyId("Channel ID", channel.id)} />}
            {toolOn("snowflake") && <Menu.MenuItem id="vc-hm-ch-age" label="Copy created-at" action={() => copyCreated(channel.id)} />}
            {channel.guild_id && (
                <Menu.MenuItem
                    id="vc-hm-ch-guild"
                    label="Server intel"
                    action={() => { setInspectTarget({ kind: "guild", id: channel.guild_id }); showOverlay(); }}
                />
            )}
            {(channel.type === 2 || channel.type === 13) && toolOn("joinVoice") && (
                <Menu.MenuItem id="vc-hm-ch-join" label="Join VC" action={() => joinVoice(channel.id)} />
            )}
        </Menu.MenuItem>
    );
};

const guildCtx: NavContextMenuPatchCallback = (children, { guild }: { guild: Guild; }) => {
    if (!guild?.id) return;
    const group = findGroupChildrenByChildId("privacy", children);
    const item = (
        <Menu.MenuItem id="vc-hm-guild" label="Stalker Mode" icon={HackerIcon} leadingAccessory={{ type: "icon", icon: HackerIcon }}>
            <Menu.MenuItem
                id="vc-hm-guild-intel"
                label="Server intel"
                action={() => { setInspectTarget({ kind: "guild", id: guild.id }); showOverlay(); }}
            />
            {toolOn("copyKit") && <Menu.MenuItem id="vc-hm-guild-id" label="Copy server ID" action={() => copyId("Guild ID", guild.id)} />}
            {toolOn("snowflake") && <Menu.MenuItem id="vc-hm-guild-age" label="Copy created-at" action={() => copyCreated(guild.id)} />}
            {guild.ownerId && <Menu.MenuItem id="vc-hm-guild-owner" label="Who is owner" action={() => inspectUser({ id: guild.ownerId } as User, guild.id)} />}
        </Menu.MenuItem>
    );
    if (group) group.push(item);
    else children.push(item);
};

const roleCtx: NavContextMenuPatchCallback = (children, { role }: { role?: Role; }) => {
    if (!role?.id) return;
    children.push(
        <Menu.MenuItem id="vc-hm-role" label="Stalker Mode">
            {toolOn("copyKit") && <Menu.MenuItem id="vc-hm-role-id" label="Copy role ID" action={() => copyId("Role ID", role.id)} />}
            <Menu.MenuItem
                id="vc-hm-role-inspect"
                label="Inspect role"
                action={() => { setInspectTarget({ kind: "role", id: role.id, extra: (role as any).guildId || (role as any).guild_id }); showOverlay(); }}
            />
        </Menu.MenuItem>
    );
};

function StalkerHeaderButton() {
    const [, bump] = useState(0);
    useEffect(() => subscribeOverlay(() => bump(n => n + 1)), []);
    const open = isOpen();
    return (
        <HeaderSlotButton
            tooltip={open ? "Hide Stalker Mode" : "Stalker Mode"}
            selected={open}
            onClick={() => {
                mountOverlay();
                toggleOverlay();
            }}
            icon={HackerIcon}
        />
    );
}

let removeHeaderSlot: (() => void) | null = null;

export default definePlugin({
    name: "StalkerMode",
    description: "Local ops console: log what this client already sees, inspect IDs and people, and flag sketchy links. Last online appears on a profile you open and on the profile shown when you start a DM.",
    tags: ["Chat", "Utility"],
    searchTerms: ["stalker", "hacker", "last online", "offline", "ops", "ledger", "inspect", "whois", "snowflake", "ghost ping", "delexo"],
    authors: [Delexo],
    enabledByDefault: true,
    requiresRestart: true,
    settings,
    managedStyle,
    patches: [
        {
            find: '"UserProfilePopout");',
            replacement: {
                match: /user:(\i),widgets:.{0,100}?\}\),/,
                replace: "$&$self.LastOnlineLine({user:$1}),"
            }
        },
        {
            find: ".SIDEBAR,disableToolbar:",
            replacement: {
                match: /user:(\i),widgets:.{0,100}?\}\),(?=.{0,100}unownedWishlistItems:\i,wishlistId:\i)/,
                replace: "$&$self.LastOnlineLine({user:$1}),"
            }
        }
    ],
    flux: fluxHandlers,
    contextMenus: {
        message: messageCtx,
        "user-context": userCtx,
        "channel-context": channelCtx,
        "thread-context": channelCtx,
        "gdm-context": channelCtx,
        "guild-context": guildCtx,
        "guild-header-popout": guildCtx,
        "guild-settings-role-context": roleCtx
    },
    async start() {
        mountOverlay();
        showOverlay();
        try { startFluxExtras(); } catch { /* keep the window up */ }
        void loadLedger();
        void loadDossiers();
        void startLastOnline();
        removeHeaderSlot = mountBeforeThreads("vc-stalker-header-slot", <StalkerHeaderButton />);
    },
    stop() {
        removeHeaderSlot?.();
        removeHeaderSlot = null;
        stopLastOnline();
        void flushLedger();
        void flushDossiers();
        stopFluxExtras();
        unmountOverlay();
    },
    LastOnlineLine
});
