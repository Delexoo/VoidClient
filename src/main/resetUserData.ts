/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { beginSettingsReset, NativeSettings } from "./settings";
import { NATIVE_SETTINGS_FILE, QUICK_CSS_PATH, SETTINGS_DIR, SETTINGS_FILE } from "./utils/constants";

const SAVED_FOLDERS = [
    "StalkerMode",
    "HackerMode",
    "AdvancedRichPresence",
    "AdvancedNotes",
    "AdvancedNote",
    "MessageLogger"
];

function writeEmptySettings() {
    mkdirSync(SETTINGS_DIR, { recursive: true });
    writeFileSync(SETTINGS_FILE, "{}\n");
    writeFileSync(NATIVE_SETTINGS_FILE, "{\"plugins\":{},\"customCspRules\":{}}\n");
    writeFileSync(QUICK_CSS_PATH, "");
}

export function resetUserData() {
    beginSettingsReset();
    writeEmptySettings();
    NativeSettings.setData({ plugins: {}, customCspRules: {} });

    const documents = app.getPath("documents");
    for (const name of SAVED_FOLDERS) {
        rmSync(join(documents, name), { recursive: true, force: true });
    }

    const userData = app.getPath("userData");
    rmSync(join(userData, "Partitions", "vc-youtube-tab"), { recursive: true, force: true });
    rmSync(join(userData, "vc-youtube-window.json"), { force: true });

    app.once("will-quit", writeEmptySettings);
}
