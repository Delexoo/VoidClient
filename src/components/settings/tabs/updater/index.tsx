/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import { useSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { HeadingSecondary } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { useAwaiter } from "@utils/react";
import { CommitLogEntry, getCommitLog, getRepo, isNewer, onCommitLogRefresh, UpdateLogger } from "@utils/updater";
import { Forms, React, useEffect, useState } from "@webpack/common";

import gitHash from "~git-hash";

import { CommonProps, HashLink, Newer, Updatable } from "./Components";
import "./updaterLog.css";

function VesktopSection() {
    if (!IS_VESKTOP) return null;

    const [isVesktopOutdated] = useAwaiter<boolean>(VesktopNative.app.isOutdated, { fallbackValue: false });

    return (
        <Flex className={Margins.bottom20} flexDirection="column" gap="1em">
            <Card variant="info">
                <HeadingSecondary>Vesktop & Void Client</HeadingSecondary>
                <Paragraph>Vesktop and Void Client are two separate things. This updater is for Void Client.</Paragraph>
                <Paragraph className={Margins.top8}>
                    You receive separate popups for Vesktop updates. You can also manually update by installing the <Link href="https://vesktop.dev/install">latest version</Link>.
                </Paragraph>
            </Card>

            {isVesktopOutdated && (
                <Card variant="warning">
                    <HeadingSecondary>Vesktop Outdated</HeadingSecondary>
                    <Flex flexDirection="column" gap="0.5em">
                        <Paragraph>Your version of Vesktop is outdated!</Paragraph>
                        <Button variant="link" onClick={() => VesktopNative.app.openUpdater()}>Open Vesktop Updater</Button>
                    </Flex>
                </Card>
            )}
        </Flex>
    );
}

function sameBuild(hash: string) {
    const installed = gitHash.toLowerCase();
    const remote = hash.toLowerCase();
    return installed === remote || installed.startsWith(remote) || remote.startsWith(installed);
}

function CommitLog({ repo, repoPending }: CommonProps) {
    const [commits, setCommits] = useState<CommitLogEntry[]>([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    async function load(nextPage: number, replace: boolean) {
        setLoading(true);
        try {
            const result = await getCommitLog(nextPage);
            setCommits(prev => replace ? result.commits : [...prev, ...result.commits]);
            setPage(nextPage);
            setHasMore(result.hasMore);
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load(1, true);
        return onCommitLogRefresh(() => void load(1, true));
    }, []);

    return (
        <>
            <Forms.FormTitle tag="h5" className={Margins.top16}>Update log</Forms.FormTitle>
            {error ? <Forms.FormText>Couldn't load the GitHub history. {error}</Forms.FormText> : null}
            <div className="vc-updater-log">
                {commits.map(commit => (
                    <div key={`${commit.hash}-${commit.date}-${commit.message}`} style={{ margin: "0.45em 0" }}>
                        <code><HashLink hash={commit.hash} repo={repo} disabled={repoPending} /></code>
                        <span style={{ marginLeft: "0.5em", color: "var(--text-default)" }}>
                            {commit.date ? `${commit.date} ` : ""}{commit.message} — {commit.author}
                            {sameBuild(commit.hash) ? " (this build)" : ""}
                        </span>
                    </div>
                ))}
            </div>
            {hasMore ? (
                <Button
                    variant="secondary"
                    className={Margins.top8}
                    disabled={loading}
                    onClick={() => void load(page + 1, false)}
                >
                    {loading ? "Loading..." : "Load older commits"}
                </Button>
            ) : null}
        </>
    );
}

function Updater() {
    const settings = useSettings(["autoUpdate", "autoUpdateNotification"]);

    const [repo, err, repoPending] = useAwaiter(getRepo, {
        fallbackValue: "Loading...",
        onError: e => UpdateLogger.error("Failed to retrieve repo", err)
    });

    const commonProps: CommonProps = {
        repo,
        repoPending
    };

    return (
        <SettingsTab>
            <VesktopSection />

            <div className="vc-settings-switches">
                <FormSwitch
                    title="Automatically update"
                    description="Automatically update Void Client without confirmation prompt"
                    value={settings.autoUpdate}
                    onChange={(v: boolean) => settings.autoUpdate = v}
                    hideBorder
                />
                <FormSwitch
                    title="Get notified when an automatic update completes"
                    description="Show a notification when Void Client automatically updates"
                    value={settings.autoUpdateNotification}
                    onChange={(v: boolean) => settings.autoUpdateNotification = v}
                    disabled={!settings.autoUpdate}
                    hideBorder
                />
            </div>

            <Forms.FormTitle tag="h5" className={Margins.top20}>Repo</Forms.FormTitle>

            <Forms.FormText>
                {repoPending
                    ? repo
                    : err
                        ? "Failed to retrieve - check console"
                        : (
                            <Link href={repo}>
                                {repo.split("/").slice(-2).join("/")}
                            </Link>
                        )
                }
                {" "}
                (<HashLink hash={gitHash} repo={repo} disabled={repoPending} />)
            </Forms.FormText>

            <CommitLog {...commonProps} />

            <Divider className={classes(Margins.top16, Margins.bottom16)} />

            <Forms.FormTitle tag="h5">Updates</Forms.FormTitle>

            {isNewer
                ? <Newer {...commonProps} />
                : <Updatable {...commonProps} />
            }
        </SettingsTab>
    );
}

export default IS_UPDATER_DISABLED
    ? null
    : wrapTab(Updater, "Updater");
