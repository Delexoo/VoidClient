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

import { fetchBuffer, fetchJson } from "@main/utils/http";
import { IpcEvents } from "@shared/IpcEvents";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { ipcMain } from "electron";
import { writeFile } from "fs/promises";
import { join } from "path";

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

import { serializeErrors, VENCORD_FILES } from "./common";

const API_BASE = `https://api.github.com/repos/${gitRemote}`;
let PendingUpdates = [] as [string, string][];

async function githubGet<T = any>(endpoint: string) {
    return fetchJson<T>(API_BASE + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            // "All API requests MUST include a valid User-Agent header.
            // Requests with no User-Agent header will be rejected."
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

function mapCommit(commit: any) {
    return {
        hash: String(commit.sha || commit.hash || "").slice(0, 7),
        author: commit.author?.login ?? commit.commit?.author?.name ?? "Unknown Author",
        message: String(commit.commit?.message || commit.message || "").split("\n")[0],
        date: String(commit.commit?.author?.date || "").slice(0, 10)
    };
}

function hashesMatch(installed: string, remote: string) {
    const left = String(installed || "").toLowerCase();
    const right = String(remote || "").toLowerCase();
    if (!left || !right || left === "local" || right === "local") return false;
    return left === right || left.startsWith(right) || right.startsWith(left);
}

async function commitsSinceInstall() {
    try {
        const data = await githubGet(`/compare/${gitHash}...HEAD`);
        const commits = (data.commits || []).map(mapCommit).filter(commit => commit.hash);
        if (commits.length) return commits;
    } catch {
        // The installed hash may not be on this repo yet.
    }

    const found = [] as ReturnType<typeof mapCommit>[];
    for (let page = 1; page <= 10; page++) {
        const batch = await githubGet(`/commits?per_page=100&page=${page}`);
        if (!Array.isArray(batch) || !batch.length) break;
        let reachedInstall = false;
        for (const commit of batch) {
            if (hashesMatch(gitHash, commit.sha)) {
                reachedInstall = true;
                break;
            }
            found.push(mapCommit(commit));
        }
        if (reachedInstall || batch.length < 100) break;
    }
    return found;
}

async function calculateGitChanges() {
    let headSha = "";
    try {
        headSha = String((await githubGet("/commits/HEAD"))?.sha || "");
    } catch {
        headSha = "";
    }

    const behindRepo = !!headSha && !hashesMatch(gitHash, headSha);
    const releaseOutdated = await fetchUpdates();
    if (!behindRepo && !releaseOutdated) return [];

    const commits = await commitsSinceInstall();
    if (commits.length) return commits;

    return [{
        hash: headSha.slice(0, 7) || "update",
        author: "Void Client",
        message: "A newer build is on GitHub",
        date: ""
    }];
}

async function listCommits(_event: unknown, page = 1) {
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const batch = await githubGet(`/commits?per_page=100&page=${safePage}`);
    const commits = (Array.isArray(batch) ? batch : []).map(mapCommit).filter(commit => commit.hash);
    return { commits, hasMore: commits.length === 100 };
}

async function latestRelease() {
    try {
        return await githubGet("/releases/tags/void-client");
    } catch {
        return await githubGet("/releases/latest");
    }
}

async function fetchUpdates() {
    let data: any;
    try {
        data = await latestRelease();
    } catch {
        return false;
    }

    const name = String(data?.name || "");
    const hash = name.slice(name.lastIndexOf(" ") + 1);
    if (!hash || hashesMatch(gitHash, hash))
        return false;

    try {
        const compared = await githubGet(`/compare/${gitHash}...${hash}`);
        if (compared?.status === "behind" || compared?.status === "identical")
            return false;
    } catch {
        // A release hash that is not on the repo can still be downloaded.
    }

    PendingUpdates = [];
    for (const asset of data?.assets || []) {
        if (VENCORD_FILES.some(file => String(asset.name).startsWith(file)))
            PendingUpdates.push([asset.name, asset.browser_download_url]);
    }

    return PendingUpdates.length > 0;
}

async function applyUpdates() {
    const fileContents = await Promise.all(PendingUpdates.map(async ([name, url]) => {
        const contents = await fetchBuffer(url);
        return [join(__dirname, name), contents] as const;
    }));

    await Promise.all(fileContents.map(async ([filename, contents]) =>
        writeFile(filename, contents))
    );

    PendingUpdates = [];
    return true;
}

ipcMain.handle(IpcEvents.GET_COMMIT_LOG, serializeErrors(listCommits));
ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${gitRemote}`));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(fetchUpdates));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(applyUpdates));
