/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const DEFAULT_MODEL = "google/gemini-2.5-pro";

export const settings = definePluginSettings({
    model: {
        type: OptionType.STRING,
        description: "OpenRouter model ID. Default is google/gemini-2.5-pro, chosen for accuracy.",
        placeholder: DEFAULT_MODEL,
        default: DEFAULT_MODEL
    },
    targetLang: {
        type: OptionType.STRING,
        description: "Language typed messages are translated into",
        default: "tl",
        hidden: true
    }
});
