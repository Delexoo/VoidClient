/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "@plugins/translate/styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { settings } from "@plugins/translate/settings";
import { setShouldShowTranslateEnabledTooltip, TranslateChatBarIcon, TranslateIcon } from "@plugins/translate/TranslateIcon";
import { clearTranslations, TranslationAccessory } from "@plugins/translate/TranslationAccessory";
import { findMessageMedia, getMessageContent, translate } from "@plugins/translate/utils";
import { renderVoiceHover, translateMessage } from "@plugins/translate/voiceHover";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, Menu, SelectedChannelStore } from "@webpack/common";

const messageCtxPatch: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    const content = getMessageContent(message);
    const media = findMessageMedia(message);
    if (!content && !media) return;

    const group = findGroupChildrenByChildId("copy-text", children) ?? findGroupChildrenByChildId("copy-link", children);
    if (!group) return;

    const anchorId = group.findIndex(c => c?.props?.id === "copy-text");
    const insertAt = anchorId >= 0 ? anchorId + 1 : group.length;
    group.splice(insertAt, 0, (
        <Menu.MenuItem
            id="vc-trans"
            label={media ? (media.kind === "video" ? "Translate video" : "Translate audio") : "Translate"}
            icon={TranslateIcon}
            leadingAccessory={{ type: "icon", icon: TranslateIcon }}
            action={() => void translateMessage(message)}
        />
    ));
};


let tooltipTimeout: any;
let openChannel: string | undefined;

export default definePlugin({
    name: "Translate",
    enabledByDefault: true,
    description: "Translate messages, voice notes, audio files, and videos with OpenRouter.",
    tags: ["Chat", "Utility", "API Required"],
    authors: [Devs.Ven, Devs.AshtonMemer, Devs.koish1],
    settings,
    patches: [
        {
            find: "#{intl::VOICE_MESSAGES_PLAYBACK_RATE_LABEL}",
            replacement: {
                match: /(?<=onVolumeHide:\i\}\))/,
                replace: ",$self.VoiceHover(arguments[0])"
            }
        }
    ],
    VoiceHover: renderVoiceHover,

    start() {
        openChannel = SelectedChannelStore.getChannelId() || undefined;
    },

    stop() {
        clearTranslations();
        openChannel = undefined;
    },

    flux: {
        CHANNEL_SELECT({ channelId }: { channelId?: string | null; }) {
            const next = channelId || undefined;
            if (openChannel && next !== openChannel) clearTranslations();
            openChannel = next;
        }
    },
    contextMenus: {
        "message": messageCtxPatch
    },
    // not used, just here in case some other plugin wants it or w/e
    translate,

    renderMessageAccessory: props => <TranslationAccessory message={props.message} />,

    chatBarButton: {
        icon: TranslateIcon,
        render: TranslateChatBarIcon
    },

    messagePopoverButton: {
        icon: TranslateIcon,
        render(message: Message) {
            const content = getMessageContent(message);
            const media = findMessageMedia(message);
            if (!content && !media) return null;

            return {
                label: media ? (media.kind === "video" ? "Translate video" : "Translate audio") : "Translate",
                icon: TranslateIcon,
                message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: () => void translateMessage(message)
            };
        }
    },

    async onBeforeMessageSend(_, message) {
        if (!settings.store.autoTranslate) return;
        if (!message.content) return;

        setShouldShowTranslateEnabledTooltip?.(true);
        clearTimeout(tooltipTimeout);
        tooltipTimeout = setTimeout(() => setShouldShowTranslateEnabledTooltip?.(false), 2000);

        const trans = await translate("sent", message.content);
        message.content = trans.text;
    }
});
