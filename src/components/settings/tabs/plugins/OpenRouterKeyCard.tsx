/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Card } from "@components/Card";
import { copyToClipboard } from "@utils/clipboard";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { getOpenRouterKey, setOpenRouterKey } from "@utils/openRouterKey";
import { showToast, Toasts, useState } from "@webpack/common";

function EyeIcon({ hidden }: { hidden: boolean; }) {
    if (hidden) {
        return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
        );
    }
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function CopyIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    );
}

export function OpenRouterKeyCard() {
    const [value, setValue] = useState(getOpenRouterKey);
    const [shown, setShown] = useState(false);

    const save = () => {
        const key = setOpenRouterKey(value);
        showToast(
            key ? "OpenRouter key saved. AI plugins will use it." : "OpenRouter key cleared.",
            key ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE
        );
    };

    const copy = () => {
        const key = value.trim();
        if (!key) {
            showToast("Nothing to copy.", Toasts.Type.MESSAGE);
            return;
        }
        void copyToClipboard(key);
        showToast("OpenRouter key copied.", Toasts.Type.SUCCESS);
    };

    return (
        <Card className={classes("vc-ork", Margins.bottom16)}>
            <div>
                <div className="vc-ork-title">OpenRouter key</div>
                <p className="vc-ork-desc">This powers the plugins that require an API.</p>
                <ol className="vc-ork-steps">
                    <li>
                        Create an account at{" "}
                        <button type="button" className="vc-ork-link" onClick={() => VencordNative.native.openExternal("https://openrouter.ai")}>
                            openrouter.ai
                        </button>
                        .
                    </li>
                    <li>
                        Create an API key at{" "}
                        <button type="button" className="vc-ork-link" onClick={() => VencordNative.native.openExternal("https://openrouter.ai/keys")}>
                            openrouter.ai/keys
                        </button>
                        .
                    </li>
                    <li>
                        Add credits at{" "}
                        <button type="button" className="vc-ork-link" onClick={() => VencordNative.native.openExternal("https://openrouter.ai/settings/credits")}>
                            openrouter.ai/credits
                        </button>
                        .
                    </li>
                    <li>Paste the key below and press Save.</li>
                </ol>
            </div>
            <div className="vc-ork-row">
                <input
                    className="vc-ork-input"
                    value={value}
                    onChange={event => setValue(event.currentTarget.value)}
                    onKeyDown={event => {
                        if (event.key === "Enter") save();
                    }}
                    placeholder="sk-or-v1-..."
                    type={shown ? "text" : "password"}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    name="void-openrouter-key"
                />
                <button
                    type="button"
                    className="vc-ork-icon"
                    aria-label={shown ? "Hide key" : "Show key"}
                    aria-pressed={shown}
                    onClick={() => setShown(open => !open)}
                >
                    <EyeIcon hidden={!shown} />
                </button>
                <button
                    type="button"
                    className="vc-ork-icon"
                    aria-label="Copy key"
                    onClick={copy}
                >
                    <CopyIcon />
                </button>
                <button type="button" className="vc-ork-save" onClick={save}>
                    Save
                </button>
            </div>
        </Card>
    );
}
