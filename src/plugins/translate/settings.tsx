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

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { openTranslateModal } from "@plugins/translate/TranslateModal";
import { OptionType } from "@utils/types";

export const DEFAULT_MODEL = "google/gemini-2.5-flash";
const REPLACED_MODELS = new Set([
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash-lite",
    "google/gemini-flash-1.5"
]);

export function translationModel(stored: string | undefined, persist?: (model: string) => void) {
    const model = String(stored || "").trim();
    if (!model || REPLACED_MODELS.has(model)) {
        persist?.(DEFAULT_MODEL);
        return DEFAULT_MODEL;
    }
    return model;
}

export const settings = definePluginSettings({
    receivedInput: {
        type: OptionType.STRING,
        description: "Language incoming messages are translated from",
        default: "auto",
        hidden: true
    },
    receivedOutput: {
        type: OptionType.STRING,
        description: "Language incoming messages are translated to",
        default: "en",
        hidden: true
    },
    sentInput: {
        type: OptionType.STRING,
        description: "Language your messages are translated from",
        default: "auto",
        hidden: true
    },
    sentOutput: {
        type: OptionType.STRING,
        description: "Language your messages are translated to",
        default: "en",
        hidden: true
    },
    openrouterModel: {
        type: OptionType.STRING,
        displayName: "OpenRouter model",
        description: "Used when you click Translate on a message. Default is Gemini 2.5 Flash so the result shows quickly. Voice, audio, and video stay on Gemini 2.5 Pro.",
        placeholder: DEFAULT_MODEL,
        default: DEFAULT_MODEL
    },
    useMessageContext: {
        type: OptionType.BOOLEAN,
        displayName: "Gather nearby messages",
        description: "Read nearby messages before translating, so names, slang, and what this or that means come out right",
        default: true
    },
    contextMessages: {
        type: OptionType.NUMBER,
        displayName: "Messages to gather",
        description: "How many nearby messages to read when context is on. Use 4 to 40.",
        default: 12,
        disabled() { return this.store.useMessageContext === false; },
        isValid(value) {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 4 || n > 40) return "Use a number from 4 to 40.";
            return true;
        }
    },
    autoTranslate: {
        type: OptionType.BOOLEAN,
        description: "Automatically translate your messages before sending. You can also Shift+click or right-click the translate button to toggle this",
        default: false
    },
    showAutoTranslateTooltip: {
        type: OptionType.BOOLEAN,
        description: "Show a tooltip on the chat bar button when a message is auto-translated",
        default: true
    },
    manageTranslateSettings: {
        type: OptionType.COMPONENT,
        component: () => (
            <Button onClick={openTranslateModal}>
                Customize translation languages & Auto-Translate
            </Button>
        )
    }
}).withPrivateSettings<{
    dismissedAutoTranslateAlert?: boolean;
    service?: string;
}>();

export function resetLanguageDefaults() {
    settings.store.receivedInput = "auto";
    settings.store.receivedOutput = "en";
    settings.store.sentInput = "auto";
    settings.store.sentOutput = "en";
}
