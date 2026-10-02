/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { createRoot } from "@webpack/common";
import type { Root } from "react-dom/client";

import type { Level, Verdict } from "./scan";

const cl = classNameFactory("vc-pd-");

const LABEL: Record<Level, string> = {
    safe: "Safe",
    suspicious: "Suspicious",
    malicious: "Malicious"
};

export function Banner({
    verdict,
    thinking
}: {
    verdict: Verdict;
    thinking?: boolean;
}) {
    return (
        <div className={cl("banner", verdict.level)} role="alert">
            <div className={cl("top")}>
                <span className={cl("pill")}>{LABEL[verdict.level]}</span>
                <span className={cl("src")}>
                    {thinking ? "checking with AI…" : verdict.source === "ai" ? "rules + AI" : "built-in rules"}
                </span>
            </div>
            <div className={cl("summary")}>{verdict.summary}</div>
            <ul className={cl("reasons")}>
                {verdict.reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                ))}
            </ul>
        </div>
    );
}

export function mountBanner(host: HTMLElement, verdict: Verdict, thinking = false): Root {
    const root = createRoot(host);
    root.render(<Banner verdict={verdict} thinking={thinking} />);
    return root;
}

export function updateBanner(root: Root | null, verdict: Verdict, thinking = false) {
    root?.render(<Banner verdict={verdict} thinking={thinking} />);
}

export function MessageFlag({ verdict }: { verdict: Verdict; }) {
    return (
        <div className={cl("msg", verdict.level)}>
            <span className={cl("pill")}>{LABEL[verdict.level]}</span>
            <span>{verdict.summary}</span>
        </div>
    );
}
