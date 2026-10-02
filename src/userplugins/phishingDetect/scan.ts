/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Level = "safe" | "suspicious" | "malicious";

export type Snapshot = {
    kind: "oauth" | "form" | "message" | "unknown";
    title: string;
    appName: string;
    text: string;
    redirect: string;
    scopes: string[];
    fields: string[];
    activeSince: string;
    urls: string[];
};

export type Verdict = {
    level: Level;
    score: number;
    reasons: string[];
    summary: string;
    source: "rules" | "ai";
};

const LEVEL_RANK: Record<Level, number> = { safe: 0, suspicious: 1, malicious: 2 };

export function worse(a: Level, b: Level): Level {
    return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

const SCOPE_LABELS: Array<[RegExp, string]> = [
    [/join servers for you/i, "guilds.join"],
    [/access your username, avatar, and banner/i, "identify"],
    [/access your email/i, "email"],
    [/know what servers you.?re in/i, "guilds"],
    [/add a bot/i, "bot"],
    [/create commands/i, "applications.commands"],
    [/send messages from this server/i, "webhook"],
    [/see your connections/i, "connections"]
];

const PHISH_HOST = /(?:restorecord|restore-cord|restorecordapp|verifycord|verify-discord|discord-verify|discords-verify|nitro|free-nitro|steamcommunity|steampowered|login-discord|oauth-verify)/i;
const SHADY_TLD = /\.(?:xyz|tk|ml|ga|cf|click|top|buzz|rest|loan|gq|work|zip|mov|country)(?:[:/]|$)/i;
const SENSITIVE_FIELD = /password|passwd|passcode|token|secret|backup\s*code|2fa|mfa|authenticator|recovery|email|phone|credit|ssn|login/i;
const AUTH_WORDS = /\b(authori[sz]e|oauth|connect|login|sign[\s-]?in|verify(?:ication)?|restore|link your account|access your discord)\b/i;
const FORM_HINT = /this form will be submitted to|do not share passwords/i;
const OAUTH_HINT = /wants to access your discord account|redirected outside of discord/i;

export const OAUTH_URL_RE = /https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/(?:api\/)?oauth2\/authorize\?[^\s<>\])"]+/gi;

export function isAuthScreenText(text: string) {
    const t = String(text || "");
    return OAUTH_HINT.test(t) || FORM_HINT.test(t) || (/\bauthorize\b/i.test(t) && /join servers for you|access your username/i.test(t));
}

function parseRedirect(text: string) {
    const m = String(text || "").match(/redirected outside of Discord to:\s*(\S+)/i);
    if (m?.[1]) return m[1].replace(/[.,;)]+$/, "");
    return "";
}

function parseActiveSince(text: string) {
    const m = String(text || "").match(/Active since\s+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
    return m?.[1] || "";
}

function parseAppName(text: string) {
    const m = String(text || "").match(/^\s*(.+?)\s+wants to access your Discord account/im);
    return m?.[1]?.trim() || "";
}

function parseScopes(text: string) {
    const t = String(text || "");
    const out: string[] = [];
    for (const [re, name] of SCOPE_LABELS)
        if (re.test(t)) out.push(name);
    const qs = t.match(/scope=([^&\s]+)/i);
    if (qs?.[1])
        for (const bit of decodeURIComponent(qs[1]).split(/[+\s]/))
            if (bit) out.push(bit);
    return [...new Set(out)];
}

function urlsIn(text: string) {
    const out = new Set<string>();
    for (const m of String(text || "").matchAll(/https?:\/\/[^\s<>\])"]+/gi))
        out.add(m[0].replace(/[.,;)]+$/, ""));
    for (const m of String(text || "").matchAll(OAUTH_URL_RE))
        out.add(m[0]);
    return [...out];
}

function hostOf(url: string) {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

function isIpHost(host: string) {
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":");
}

function daysSince(label: string) {
    const ms = Date.parse(label);
    if (!Number.isFinite(ms)) return null;
    return Math.floor((Date.now() - ms) / 86400000);
}

export function snapshotFromText(text: string, extra?: Partial<Snapshot>): Snapshot {
    const raw = String(text || "").slice(0, 8000);
    let kind: Snapshot["kind"] = "unknown";
    if (OAUTH_HINT.test(raw) || /oauth2\/authorize/i.test(raw)) kind = "oauth";
    else if (FORM_HINT.test(raw) || extra?.fields?.length) kind = "form";
    else if (extra?.kind) kind = extra.kind;
    return {
        kind,
        title: extra?.title || "",
        appName: extra?.appName || parseAppName(raw),
        text: raw,
        redirect: extra?.redirect || parseRedirect(raw),
        scopes: extra?.scopes?.length ? extra.scopes : parseScopes(raw),
        fields: extra?.fields || [],
        activeSince: extra?.activeSince || parseActiveSince(raw),
        urls: extra?.urls?.length ? extra.urls : urlsIn(raw)
    };
}

export function snapshotFromOauthUrl(href: string): Snapshot | null {
    try {
        const url = new URL(href);
        if (!/discord(?:app)?\.com$/i.test(url.hostname) || !/oauth2\/authorize/i.test(url.pathname))
            return null;
        const redirect = url.searchParams.get("redirect_uri") || "";
        const scopes = String(url.searchParams.get("scope") || "").split(/[+\s]/).filter(Boolean);
        return snapshotFromText(href, {
            kind: "oauth",
            title: "OAuth authorize link",
            redirect,
            scopes,
            urls: [href, redirect].filter(Boolean)
        });
    } catch {
        return null;
    }
}

export function snapshotFromDialog(root: HTMLElement): Snapshot | null {
    if (root.closest("[data-vc-pd-ignore], .vc-pd-overlay") || root.querySelector("[data-vc-pd-ignore]"))
        return null;
    const text = String(root.innerText || root.textContent || "");
    if (!isAuthScreenText(text))
        return null;

    const fields = [...root.querySelectorAll("input, textarea, select")].map(node => {
        const el = node as HTMLInputElement;
        return [el.type, el.name, el.getAttribute("aria-label"), el.placeholder, (node.previousElementSibling as HTMLElement)?.innerText]
            .filter(Boolean)
            .join(" ");
    }).filter(Boolean);

    const links = [...root.querySelectorAll("a[href]")].map(a => (a as HTMLAnchorElement).href);
    return snapshotFromText(text, {
        fields,
        urls: [...new Set([...urlsIn(text), ...links])]
    });
}

export function scoreSnapshot(snap: Snapshot): Verdict {
    const reasons: string[] = [];
    let score = 0;
    const scopes = snap.scopes.map(s => s.toLowerCase());
    const blob = `${snap.appName} ${snap.title} ${snap.text}`.slice(0, 4000);
    const redirect = snap.redirect || snap.urls.find(u => !/discord(?:app)?\.com/i.test(u)) || "";
    let host = hostOf(redirect);
    if (!host && redirect) host = redirect.replace(/^https?:\/\//, "").split("/")[0];

    if (snap.fields.some(f => /password|token|backup|2fa|mfa|secret/i.test(f))) {
        score += 100;
        reasons.push("This screen asks for a password, token, or 2FA/backup code. Discord login never happens inside a bot form.");
    } else if (snap.fields.some(f => SENSITIVE_FIELD.test(f))) {
        score += 55;
        reasons.push("This form asks for account-related details (email/login/phone).");
    }

    if (host && isIpHost(host)) {
        score += 100;
        reasons.push(`Redirect goes to a raw IP (${host}), not a normal website.`);
    }
    if (redirect.startsWith("http://")) {
        score += 80;
        reasons.push("Redirect is plain HTTP, not HTTPS.");
    }
    if (host && PHISH_HOST.test(host)) {
        score += 70;
        reasons.push(`Redirect host looks like a verification/phishing panel (${host}).`);
    }
    if (host && SHADY_TLD.test(host)) {
        score += 35;
        reasons.push(`Unusual website ending on ${host}.`);
    }
    if (redirect && /:\d{2,5}(?:\/|$)/.test(redirect) && !/discord(?:app)?\.com/i.test(redirect)) {
        score += 40;
        reasons.push("Redirect uses a custom port, common on throwaway phishing servers.");
    }

    if (scopes.includes("guilds.join") || /join servers for you/i.test(blob)) {
        score += 45;
        reasons.push('Permission "Join servers for you" lets the app add your account to servers it chooses.');
        if (/\bverify|restore|claim|connect|login\b/i.test(snap.appName || blob)) {
            score += 30;
            reasons.push("App name/look is a typical fake verification bot using that join-server permission.");
        }
    }

    const age = daysSince(snap.activeSince);
    if (age != null && age >= 0 && age < 45 && (scopes.includes("guilds.join") || score >= 40)) {
        score += 25;
        reasons.push(`Application is only ${age} day${age === 1 ? "" : "s"} old.`);
    }

    if (/\b(nitro|free steam|airdrop|claim reward)\b/i.test(blob)) {
        score += 50;
        reasons.push("Copy talks like a giveaway / nitro claim.");
    }

    if (AUTH_WORDS.test(blob) && snap.kind === "form" && score < 40)
        score += 20;

    if (snap.kind === "form" && /this form will be submitted to/i.test(blob) && /\b(verify|login|connect|restore|authorize)\b/i.test(blob)) {
        score += 30;
        reasons.push("A bot form is asking you to verify/login/connect. Discord will never ask for that in a modal.");
    }

    if (!reasons.length && (snap.kind === "oauth" || snap.kind === "form")) {
        reasons.push("Looks like a normal authorize/form screen. Still only approve apps you recognize.");
    }

    let level: Level = "safe";
    if (score >= 70) level = "malicious";
    else if (score >= 28) level = "suspicious";

    const summary = level === "malicious"
        ? "Do not authorize or submit. This matches common Discord phishing."
        : level === "suspicious"
            ? "Pause. Check the website and permissions before you continue."
            : "No strong phishing signals. Only continue if you trust this app.";

    return { level, score, reasons: reasons.slice(0, 6), summary, source: "rules" };
}

export function mergeVerdict(base: Verdict, ai?: Verdict | null): Verdict {
    if (!ai) return base;
    const level = worse(base.level, ai.level);
    const reasons = [...base.reasons];
    for (const r of ai.reasons) {
        if (!reasons.some(x => x.toLowerCase() === r.toLowerCase())) reasons.push(r);
    }
    return {
        level,
        score: Math.max(base.score, ai.score || 0),
        reasons: reasons.slice(0, 7),
        summary: LEVEL_RANK[ai.level] >= LEVEL_RANK[base.level] && ai.summary ? ai.summary : base.summary,
        source: "ai"
    };
}

export function oauthUrlsIn(text: string) {
    return [...String(text || "").matchAll(OAUTH_URL_RE)].map(m => m[0]);
}
