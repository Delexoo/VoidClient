/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { NativeSettings, RendererSettings } from "./settings";
import { NATIVE_SETTINGS_FILE, QUICK_CSS_PATH, SETTINGS_DIR, SETTINGS_FILE } from "./utils/constants";

const SAVED_FOLDERS = [
    "StalkerMode",
    "HackerMode",
    "AdvancedRichPresence",
    "AdvancedNotes",
    "AdvancedNote",
    "MessageLogger"
];

export function resetUserData() {
    mkdirSync(SETTINGS_DIR, { recursive: true });
    writeFileSync(SETTINGS_FILE, "{}\n");
    writeFileSync(NATIVE_SETTINGS_FILE, "{\"plugins\":{},\"customCspRules\":{}}\n");
    writeFileSync(QUICK_CSS_PATH, "");
    RendererSettings.setData({});
    NativeSettings.setData({ plugins: {}, customCspRules: {} });

    const documents = app.getPath("documents");
    for (const name of SAVED_FOLDERS) {
        rmSync(join(documents, name), { recursive: true, force: true });
    }

    rmSync(join(app.getPath("userData"), "Partitions", "vc-youtube-tab"), { recursive: true, force: true });

    app.relaunch();
    setTimeout(() => app.exit(0), 400);
}
