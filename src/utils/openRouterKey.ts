/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";

const LEGACY = [
    ["Translate", "openrouterApiKey"],
    ["ComposeTranslate", "apiKey"],
    ["QuickSummary", "apiKey"],
    ["TranslateFromHere", "apiKey"],
    ["PhishingDetect", "apiKey"],
    ["AutoTranslate", "apiKey"]
] as const;

type PluginSettings = Record<string, Record<string, string>>;

function plugins() {
    return Settings.plugins as PluginSettings;
}

export function getOpenRouterKey() {
    const all = plugins();
    const shared = String(all.DelexoPlugins?.openRouterKey || "").trim();
    if (shared) return shared;

    for (const [name, field] of LEGACY) {
        const value = String(all[name]?.[field] || "").trim();
        if (!value) continue;
        setOpenRouterKey(value);
        return value;
    }
    return "";
}

export function setOpenRouterKey(raw: string) {
    const key = raw.trim();
    const all = plugins();
    const shared = all.DelexoPlugins ??= {} as Record<string, string>;
    shared.openRouterKey = key;
    for (const [name, field] of LEGACY) {
        const plugin = all[name];
        if (plugin && field in plugin) plugin[field] = "";
    }
    return key;
}
