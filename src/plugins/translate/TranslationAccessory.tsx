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

import { Message } from "@vencord/discord-types";
import { Parser, useEffect, useState } from "@webpack/common";

import { TranslateIcon } from "./TranslateIcon";
import { cl, TranslationValue } from "./utils";

const TranslationSetters = new Map<string, (v: TranslationValue | undefined) => void>();
const pendingTranslations = new Map<string, TranslationValue | undefined>();
const epochs = new Map<string, number>();

export function translationEpoch(messageId: string) {
    return epochs.get(messageId) || 0;
}

export function handleTranslate(messageId: string, data: TranslationValue | undefined) {
    if (data === undefined) epochs.set(messageId, translationEpoch(messageId) + 1);
    pendingTranslations.set(messageId, data);
    TranslationSetters.get(messageId)?.(data);
}

export function clearTranslations() {
    for (const id of new Set([...pendingTranslations.keys(), ...TranslationSetters.keys()])) {
        epochs.set(id, translationEpoch(id) + 1);
        pendingTranslations.delete(id);
        TranslationSetters.get(id)?.(undefined);
    }
    document.querySelectorAll(".vc-trans-tinted").forEach(node => node.classList.remove("vc-trans-tinted"));
}

function Dismiss({ onDismiss }: { onDismiss: () => void; }) {
    return (
        <button
            onClick={onDismiss}
            className={cl("dismiss")}
        >
            Dismiss
        </button>
    );
}

export function TranslationAccessory({ message }: { message: Message; }) {
    const [translation, setTranslation] = useState<TranslationValue>();

    useEffect(() => {
        // Ignore MessageLinkEmbeds messages
        if ((message as any).vencordEmbeddedBy) return;

        TranslationSetters.set(message.id, setTranslation);
        if (pendingTranslations.has(message.id))
            setTranslation(pendingTranslations.get(message.id));

        return () => void TranslationSetters.delete(message.id);
    }, []);

    useEffect(() => {
        const row = document.getElementById(`chat-messages-${message.channel_id}-${message.id}`);
        if (!translation?.text) {
            row?.classList.remove("vc-trans-tinted");
            return;
        }
        row?.classList.add("vc-trans-tinted");
        return () => row?.classList.remove("vc-trans-tinted");
    }, [translation, message.channel_id, message.id]);

    if (!translation?.text) return null;

    const pending = translation.text === "Listening…" || translation.text === "Translating…";

    return (
        <span className={cl("accessory")}>
            <TranslateIcon width={16} height={16} className={cl("accessory-icon")} />
            {pending ? translation.text : Parser.parse(translation.text)}
            <br />
            {pending
                ? <>(only you - <Dismiss onDismiss={() => handleTranslate(message.id, undefined)} />)</>
                : <>(translated from {translation.sourceLanguage} [OpenRouter] - <Dismiss onDismiss={() => handleTranslate(message.id, undefined)} />)</>
            }
        </span>
    );
}
