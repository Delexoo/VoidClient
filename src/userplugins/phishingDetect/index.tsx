/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, showToast, Toasts, useEffect, useState } from "@webpack/common";

import { Delexo } from "../_delexo/author";
import { aiVerdict, resolveKey } from "./ai";
import { MessageFlag } from "./banner";
import { startObserver, stopObserver } from "./observer";
import {
    mergeVerdict,
    oauthUrlsIn,
    scoreSnapshot,
    snapshotFromOauthUrl,
    snapshotFromText,
    type Verdict
} from "./scan";
import { settings } from "./settings";
import managedStyle from "./style.css?managed";

function toastFor(verdict: Verdict) {
    if (verdict.level === "malicious")
        showToast(`Phishing Detect: Malicious — ${verdict.summary}`, Toasts.Type.FAILURE);
    else if (verdict.level === "suspicious")
        showToast(`Phishing Detect: Suspicious — ${verdict.summary}`, Toasts.Type.MESSAGE);
}

function verdictFromMessage(message: Message): { snapOk: boolean; base: Verdict; } | null {
    const content = String(message?.content || "");
    const urls = oauthUrlsIn(content);
    if (urls.length) {
        const snap = snapshotFromOauthUrl(urls[0]);
        if (!snap) return null;
        return { snapOk: true, base: scoreSnapshot(snap) };
    }
    const lower = content.toLowerCase();
    if (!/(authori[sz]e|oauth|verify your|login to discord|connect your account|restorecord)/i.test(content))
        return null;
    if (!/https?:\/\//i.test(content) && !/join servers|access your username/i.test(content))
        return null;
    const snap = snapshotFromText(content, { kind: "message", title: "chat" });
    const base = scoreSnapshot(snap);
    if (base.level === "safe" && !/(restorecord|oauth2\/authorize|raw ip)/i.test(lower))
        return null;
    return { snapOk: true, base };
}

function Flag({ message }: { message: Message; }) {
    const first = verdictFromMessage(message);
    const [verdict, setVerdict] = useState<Verdict | null>(first?.base || null);

    useEffect(() => {
        const next = verdictFromMessage(message);
        if (!next) {
            setVerdict(null);
            return;
        }
        setVerdict(cur => {
            if (cur && cur.level === next.base.level && cur.summary === next.base.summary)
                return cur;
            return next.base;
        });
        if (!resolveKey()) return;
        const urls = oauthUrlsIn(String(message.content || ""));
        const snap = urls[0]
            ? snapshotFromOauthUrl(urls[0])
            : snapshotFromText(String(message.content || ""), { kind: "message" });
        if (!snap) return;
        let gone = false;
        void aiVerdict(snap).then(ai => {
            if (gone || !ai) return;
            setVerdict(cur => mergeVerdict(cur || next.base, ai));
        });
        return () => { gone = true; };
    }, [message.id, message.content]);

    if (!settings.store.scanMessages || !verdict) return null;
    return <MessageFlag verdict={verdict} />;
}

export default definePlugin({
    name: "PhishingDetect",
    description: "Warns Safe / Suspicious / Malicious on authorize, login, and connect screens. Works offline with rules; optional OpenRouter makes it stricter.",
    tags: ["Chat", "Utility", "API Required"],
    searchTerms: ["phishing", "oauth", "authorize", "verify", "restorecord", "scam", "delexo"],
    authors: [Delexo],
    enabledByDefault: true,
    requiresRestart: true,
    settings,
    managedStyle,
    renderMessageAccessory: props => <Flag message={props.message} />,
    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message?: Message; optimistic?: boolean; }) {
            if (optimistic || !settings.store.scanMessages || !message?.content) return;
            const hit = verdictFromMessage(message);
            if (!hit) return;
            const dm = ChannelStore.getChannel(message.channel_id)?.isPrivate?.();
            if (hit.base.level === "malicious" || (dm && hit.base.level !== "safe"))
                toastFor(hit.base);
        }
    },
    start: startObserver,
    stop: stopObserver
});
