/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const YT_PARTITION = "persist:vc-youtube-tab";
export const YT_HOME = "https://www.youtube.com/";

export function isAllowedUrl(raw: string) {
    if (!raw || raw === "about:blank") return true;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const hostName = url.hostname.toLowerCase();
    if (hostName === "youtu.be" || hostName.endsWith(".youtu.be")) return true;
    if (hostName === "youtube.com" || hostName.endsWith(".youtube.com")) return true;
    if (hostName === "youtube-nocookie.com" || hostName.endsWith(".youtube-nocookie.com")) return true;
    if (hostName === "googlevideo.com" || hostName.endsWith(".googlevideo.com")) return true;
    if (hostName === "ytimg.com" || hostName.endsWith(".ytimg.com")) return true;
    if (hostName === "ggpht.com" || hostName.endsWith(".ggpht.com")) return true;
    if (hostName === "accounts.google.com" || hostName === "myaccount.google.com" || hostName === "consent.google.com") return true;
    if ((hostName === "www.google.com" || hostName === "google.com") && /^\/(accounts|signin|url|ServiceLogin|setprefs)/i.test(url.pathname))
        return true;
    return false;
}
