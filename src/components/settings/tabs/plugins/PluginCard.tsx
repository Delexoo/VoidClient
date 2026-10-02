/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotice } from "@api/Notices";
import { hasAnyVisibleSettings, isPluginEnabled, pluginRequiresRestart, startDependenciesRecursive, startPlugin, stopPlugin } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { CogWheel, InfoIcon } from "@components/Icons";
import { AddonCard } from "@components/settings/AddonCard";
import { Plugin } from "@utils/types";
import { React, showToast, Toasts } from "@webpack/common";

import { cl, logger } from ".";
import { openPluginModal } from "./PluginModal";

function PinIcon({ filled }: { filled: boolean; }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill={filled ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                d="M9 4h6v5.2l2.2 2.3H6.8L9 9.2V4zM12 11.5V20"
            />
        </svg>
    );
}

interface PluginCardProps extends React.HTMLProps<HTMLDivElement> {
    plugin: Plugin;
    disabled: boolean;
    onRestartNeeded(name: string, key: string): void;
}

export function PluginCard({ plugin, disabled, onRestartNeeded, onMouseEnter, onMouseLeave }: PluginCardProps) {
    const settings = Settings.plugins[plugin.name];
    const pinned = settings?.isFavorite === true;

    const isEnabled = () => isPluginEnabled(plugin.name);

    function togglePinned(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (!settings) return;
        settings.isFavorite = !settings.isFavorite;
    }

    function toggleEnabled() {
        if (!settings) return;
        const wasEnabled = isEnabled();

        // If we're enabling a plugin, make sure all deps are enabled recursively.
        if (!wasEnabled) {
            const { restartNeeded, failures } = startDependenciesRecursive(plugin);

            if (failures.length) {
                logger.error(`Failed to start dependencies for ${plugin.name}: ${failures.join(", ")}`);
                showNotice("Failed to start dependencies: " + failures.join(", "), "Close", () => null);
                return;
            }

            if (restartNeeded) {
                // If any dependencies have patches, don't start the plugin yet.
                settings.enabled = true;
                onRestartNeeded(plugin.name, "enabled");
                return;
            }
        }

        // Patches still need a restart. Everything the plugin is running stops now.
        if (pluginRequiresRestart(plugin)) {
            if (wasEnabled && plugin.started) stopPlugin(plugin);
            settings.enabled = !wasEnabled;
            onRestartNeeded(plugin.name, "enabled");
            return;
        }

        // If the plugin is enabled, but hasn't been started, then we can just toggle it off.
        if (wasEnabled && !plugin.started) {
            settings.enabled = !wasEnabled;
            return;
        }

        const result = wasEnabled ? stopPlugin(plugin) : startPlugin(plugin);

        if (!result) {
            settings.enabled = false;

            const msg = `Error while ${wasEnabled ? "stopping" : "starting"} plugin ${plugin.name}`;
            showToast(msg, Toasts.Type.FAILURE, {
                position: Toasts.Position.BOTTOM,
            });

            return;
        }

        settings.enabled = !wasEnabled;
    }

    return (
        <AddonCard
            name={plugin.name}
            description={plugin.description}
            badge={plugin.tags?.includes("API Required") ? { text: "API Required", color: "#5865F2" } : undefined}
            className={pinned ? "vc-plugin-pinned" : "vc-plugin-unpinned"}
            enabled={isEnabled()}
            setEnabled={toggleEnabled}
            disabled={disabled}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            infoButton={
                <>
                    <button
                        type="button"
                        className="vc-plugin-pin"
                        aria-label={pinned ? "Unpin plugin" : "Pin plugin"}
                        aria-pressed={pinned}
                        onClick={togglePinned}
                    >
                        <PinIcon filled={pinned} />
                    </button>
                    <button
                        type="button"
                        onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            openPluginModal(plugin, onRestartNeeded);
                        }}
                        className={cl("info-button")}
                        aria-label={hasAnyVisibleSettings(plugin) ? "Open plugin settings" : "Plugin info"}
                    >
                        {hasAnyVisibleSettings(plugin)
                            ? <CogWheel className={cl("info-icon")} />
                            : <InfoIcon className={cl("info-icon")} />
                        }
                    </button>
                </>
            } />
    );
}
