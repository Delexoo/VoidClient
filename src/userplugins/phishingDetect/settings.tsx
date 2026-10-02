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
        description: "OpenRouter model used to double-check authorize screens. Default is google/gemini-2.5-flash-lite.",
        placeholder: DEFAULT_MODEL,
        default: DEFAULT_MODEL
    },
    scanMessages: {
        type: OptionType.BOOLEAN,
        description: "Flag OAuth authorize links in chat",
        default: true
    },
    scanModals: {
        type: OptionType.BOOLEAN,
        description: "Warn on authorize / login / connect forms on screen",
        default: true
    }
});
