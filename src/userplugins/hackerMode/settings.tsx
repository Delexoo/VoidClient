/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType, PluginNative } from "@utils/types";
import { Button, useEffect, useState } from "@webpack/common";

import { TOOLS } from "./tools";

function nativeApi() {
    if (IS_WEB) return undefined;
    return VencordNative.pluginHelpers.StalkerMode as PluginNative<typeof import("./native")> | undefined;
}

function FolderPanel() {
    const [dir, setDir] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        void nativeApi()?.rootPath?.().then(res => {
            if (res?.ok) setDir(res.data);
        });
    }, []);

    return (
        <div className="vc-hm-settings">
            <div className="vc-hm-settings-path" title={dir || undefined}>
                {dir || "Documents → StalkerMode (audit-*.md + people.md)"}
            </div>
            <Button
                size={Button.Sizes.SMALL}
                disabled={busy || !dir}
                onClick={async () => {
                    setBusy(true);
                    try {
                        await nativeApi()?.openFolder?.();
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                Open folder
            </Button>
        </div>
    );
}

const toolOptions = Object.fromEntries(
    TOOLS.map(tool => [
        tool.id,
        {
            type: OptionType.BOOLEAN,
            description: `${tool.label} — ${tool.description}`,
            default: (tool as { default?: boolean; }).default !== false
        }
    ])
);

export const settings = definePluginSettings({
    folder: {
        type: OptionType.COMPONENT,
        component: () => <FolderPanel />
    },
    writeToDisk: {
        type: OptionType.BOOLEAN,
        description: "Write every action to Documents/StalkerMode/audit-YYYY-MM-DD.md. The Stalker Mode window reads that file in slices so Discord stays light.",
        default: true
    },
    ...toolOptions
});
