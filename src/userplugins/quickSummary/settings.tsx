/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

export const settings = definePluginSettings({
    model: {
        type: OptionType.STRING,
        description: "OpenRouter model ID. Default is google/gemini-2.5-flash-lite (cheap and reliable for summaries).",
        placeholder: DEFAULT_MODEL,
        default: DEFAULT_MODEL
    },
    summaryLang: {
        type: OptionType.STRING,
        description: "Language used for channel summaries. Auto follows the chat.",
        default: "auto",
        hidden: true
    }
});
