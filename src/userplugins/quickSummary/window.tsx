/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import {
    createRoot,
    MessageActions,
    ReactDOM,
    showToast,
    Toasts,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "@webpack/common";
import type { Root } from "react-dom/client";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import {
    LANGUAGES,
    Language,
    QUICK_LANGUAGES,
    languageName,
    languageShortCode,
    matchesLanguage
} from "../composeTranslate/languages";
import { settings } from "./settings";
import { ChatLine, collectMessages, summarizeLines } from "./summarize";

const cl = classNameFactory("vc-qsum-");
const HOST_ID = "vc-qsum-host";
const CARD_W = 372;
const CARD_H = 340;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function clamp(left: number, top: number) {
    const maxLeft = Math.max(12, window.innerWidth - CARD_W - 12);
    const maxTop = Math.max(12, window.innerHeight - CARD_H - 12);
    return {
        left: Math.min(Math.max(12, left), maxLeft),
        top: Math.min(Math.max(12, top), maxTop)
    };
}

function placeFromAnchor(anchor?: DOMRect | null) {
    if (!anchor) {
        return clamp(window.innerWidth - CARD_W - 24, 88);
    }
    let left = anchor.right - CARD_W;
    let top = anchor.bottom + 10;
    if (top + CARD_H > window.innerHeight - 12)
        top = anchor.top - CARD_H - 10;
    return clamp(left, top);
}

function cleanSummaryText(text: string) {
    let out = String(text || "").trim();
    if (out.startsWith("```") && out.endsWith("```"))
        out = out.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim();
    return out
        .replace(/^(here(?:'s| is) (?:a |the )?summary:?\s*)/i, "")
        .replace(/^\*\*(.+?)\*\*$/gm, "$1")
        .trim();
}

function stripCiteMarks(text: string, collapse = true) {
    let out = String(text || "").replace(/\s*\[(\d+(?:\s*[,&]\s*\d+)*)\]/g, "");
    out = collapse
        ? out.replace(/\s+/g, " ")
        : out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
    return out.trim();
}

function parseSummary(text: string) {
    const cleaned = cleanSummaryText(text);
    const gist: string[] = [];
    const bullets: string[] = [];

    for (const raw of cleaned.split(/\n+/)) {
        const line = raw.trim();
        if (!line) continue;
        const bullet = line.match(/^(?:[-*•]|[\u2022]|\d+[.)])\s+(.*)$/);
        if (bullet) bullets.push(bullet[1].trim());
        else gist.push(line.replace(/^#{1,6}\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1"));
    }

    return {
        gist: gist.join(" ").trim(),
        bullets
    };
}

function idsFromCite(text: string, lines: ChatLine[]) {
    const nums: number[] = [];
    const cited = String(text || "").replace(/\[(\d+(?:\s*[,&]\s*\d+)*)\]/g, (_, inner: string) => {
        for (const bit of inner.split(/[,&]/)) {
            const n = Number(bit.trim());
            if (Number.isInteger(n) && n >= 1 && n <= lines.length) nums.push(n);
        }
        return "";
    });
    return {
        display: stripCiteMarks(cited) || stripCiteMarks(text),
        ids: [...new Set(nums.map(n => lines[n - 1]?.id).filter((id): id is string => Boolean(id)))]
    };
}

function fallbackIds(display: string, lines: ChatLine[], gist: boolean) {
    if (!lines.length) return [] as string[];
    if (gist) {
        const first = lines[0]?.id;
        const last = lines[lines.length - 1]?.id;
        return [...new Set([first, last].filter((id): id is string => Boolean(id)))];
    }
    const names = [...new Set(lines.map(line => line.name))]
        .filter(name => name.length > 1)
        .sort((a, b) => b.length - a.length);
    const hit = names.find(name => display.toLowerCase().includes(name.toLowerCase()));
    if (!hit) return [];
    const first = lines.find(line => line.name === hit);
    return first?.id ? [first.id] : [];
}

function jumpToMessage(channelId: string, messageId: string) {
    try {
        MessageActions.jumpToMessage({
            channelId,
            messageId,
            flash: true,
            jumpType: "ANIMATED"
        });
    } catch {
        showToast("Couldn't jump to that message.", Toasts.Type.FAILURE);
    }
}

function JumpText({
    className,
    text,
    ids,
    channelId
}: {
    className: string;
    text: string;
    ids: string[];
    channelId: string;
}) {
    const [step, setStep] = useState(0);
    if (!ids.length) return <span className={className}>{renderInline(text)}</span>;

    const n = ids.length;
    const label = n > 1
        ? `Jump to messages (${(step % n) + 1} of ${n})`
        : "Jump to this message";

    return (
        <button
            type="button"
            className={cl(className, "jump")}
            title={label}
            aria-label={label}
            onClick={() => {
                const id = ids[step % n];
                setStep(s => s + 1);
                jumpToMessage(channelId, id);
            }}
        >
            {renderInline(text)}
        </button>
    );
}

function SummaryBody({
    text,
    lines,
    channelId
}: {
    text: string;
    lines: ChatLine[];
    channelId: string;
}) {
    const { gist, bullets } = parseSummary(text);
    if (!gist && !bullets.length) return <p className={cl("gist")}>{text}</p>;

    const gistParsed = idsFromCite(gist, lines);
    const gistIds = gistParsed.ids.length ? gistParsed.ids : fallbackIds(gistParsed.display, lines, true);

    return (
        <div className={cl("content")}>
            {gist && (
                <JumpText
                    className={cl("gist")}
                    text={gistParsed.display || gist}
                    ids={gistIds}
                    channelId={channelId}
                />
            )}
            {bullets.length > 0 && (
                <ul className={cl("points")}>
                    {bullets.map((item, i) => {
                        const parsed = idsFromCite(item, lines);
                        const ids = parsed.ids.length ? parsed.ids : fallbackIds(parsed.display, lines, false);
                        return (
                            <li key={i}>
                                <span className={cl("dot")} aria-hidden="true" />
                                <JumpText
                                    className={cl("point")}
                                    text={parsed.display || item}
                                    ids={ids}
                                    channelId={channelId}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

function renderInline(text: string): ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    if (parts.length === 1) return text;
    return parts.map((part, i) => {
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i}>{bold[1]}</strong>;
        return part;
    });
}

function SummaryMark() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M4 6h2.2v2H4V6zm0 5h2.2v2H4v-2zm0 5h2.2v2H4v-2zM9 6h11v2H9V6zm0 5h11v2H9v-2zm0 5h11v2H9v-2z" />
        </svg>
    );
}

function CopyIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.81l6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.29z" />
        </svg>
    );
}

function summaryLangCode(code: string) {
    const raw = String(code || "auto").trim() || "auto";
    if (raw === "auto") return "AUTO";
    return languageShortCode(raw);
}

function summaryLangLabel(code: string) {
    const raw = String(code || "auto").trim() || "auto";
    if (raw === "auto") return "Chat language";
    return languageName(raw);
}

function LanguagePicker({
    current,
    anchor,
    onSelect,
    onClose,
    ignoreRef
}: {
    current: string;
    anchor: DOMRect;
    onSelect(code: string): void;
    onClose(): void;
    ignoreRef: { current: HTMLElement | null };
}) {
    const [query, setQuery] = useState("");
    const boxRef = useRef<HTMLDivElement>(null);
    const searching = query.trim().length > 0;

    const results = useMemo(() => {
        const filtered = LANGUAGES.filter(lang => matchesLanguage(lang, query));
        if (searching) return filtered;
        const quick = new Set(QUICK_LANGUAGES.map(lang => lang.code));
        return filtered.filter(lang => !quick.has(lang.code));
    }, [query, searching]);

    const pos = useMemo(() => {
        const width = 280;
        const height = 380;
        let left = anchor.right - width;
        let top = anchor.bottom + 8;
        if (top + height > window.innerHeight - 12)
            top = anchor.top - height - 8;
        left = Math.min(Math.max(12, left), Math.max(12, window.innerWidth - width - 12));
        top = Math.min(Math.max(12, top), Math.max(12, window.innerHeight - 80));
        return { left, top };
    }, [anchor]);

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (boxRef.current?.contains(target)) return;
            if (ignoreRef.current?.contains(target)) return;
            onClose();
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [onClose, ignoreRef]);

    function Option({ lang }: { lang: Language; }) {
        const selected = lang.code === current;
        return (
            <button
                type="button"
                className={cl("option", { selected })}
                onClick={() => onSelect(lang.code)}
            >
                <span>{lang.name}</span>
                <span className={cl("option-code")}>{languageShortCode(lang.code)}</span>
            </button>
        );
    }

    return ReactDOM.createPortal(
        <div
            ref={boxRef}
            className={cl("picker")}
            style={{ left: pos.left, top: pos.top }}
            onMouseDown={e => e.stopPropagation()}
        >
            <div className={cl("picker-title")}>Summary language</div>
            {!searching && (
                <div className={cl("quick")}>
                    <button
                        type="button"
                        className={cl("chip", "chip-auto", { selected: current === "auto" })}
                        onClick={() => onSelect("auto")}
                    >
                        Chat language
                    </button>
                    {QUICK_LANGUAGES.map(lang => (
                        <button
                            key={lang.code}
                            type="button"
                            className={cl("chip", { selected: lang.code === current })}
                            onClick={() => onSelect(lang.code)}
                        >
                            {lang.name}
                        </button>
                    ))}
                </div>
            )}
            <input
                className={cl("search")}
                value={query}
                onChange={e => setQuery(e.currentTarget.value)}
                placeholder="Search languages"
                spellCheck={false}
            />
            <div className={cl("list")}>
                {results.length
                    ? results.map(lang => <Option key={lang.code} lang={lang} />)
                    : <div className={cl("empty")}>No languages match that search</div>}
            </div>
        </div>,
        document.body
    );
}

function SummaryCard({
    channelId,
    startId,
    fromName,
    left,
    top,
    onClose
}: {
    channelId: string;
    startId: string;
    fromName: string;
    left: number;
    top: number;
    onClose(): void;
}) {
    const [pos, setPos] = useState(() => ({ left, top }));
    const [status, setStatus] = useState("Collecting messages…");
    const [summary, setSummary] = useState("");
    const [error, setError] = useState("");
    const [count, setCount] = useState(0);
    const [people, setPeople] = useState(0);
    const [truncated, setTruncated] = useState(false);
    const [lines, setLines] = useState<ChatLine[]>([]);
    const [targetLang, setTargetLang] = useState(() => String(settings.store.summaryLang || "auto"));
    const [showLang, setShowLang] = useState(false);
    const [langAnchor, setLangAnchor] = useState<DOMRect | null>(null);
    const [busy, setBusy] = useState(true);
    const drag = useRef<{ dx: number; dy: number; } | null>(null);
    const langBtnRef = useRef<HTMLButtonElement>(null);
    const collected = useRef<{ lines: ChatLine[]; truncated: boolean; } | null>(null);
    const runId = useRef(0);
    const langRef = useRef(targetLang);
    langRef.current = targetLang;

    async function runSummary(lines: ChatLine[], cut: boolean, lang: string) {
        const id = ++runId.current;
        setBusy(true);
        setError("");
        setStatus(lang === "auto" ? "Summarizing…" : `Summarizing in ${summaryLangLabel(lang)}…`);
        try {
            const text = await summarizeLines(lines, cut, lang);
            if (id !== runId.current) return;
            setSummary(text);
            setBusy(false);
        } catch (e) {
            if (id !== runId.current) return;
            setError(String(e).replace(/^Error:\s*/, ""));
            setBusy(false);
        }
    }

    useEffect(() => {
        let gone = false;
        collected.current = null;
        runId.current++;
        setBusy(true);
        setSummary("");
        setError("");
        setLines([]);
        (async () => {
            try {
                setStatus("Collecting messages…");
                const { lines, truncated: cut } = await collectMessages(channelId, startId, text => {
                    if (!gone) setStatus(text);
                });
                if (gone) return;
                collected.current = { lines, truncated: cut };
                setLines(lines);
                setCount(lines.length);
                setPeople(new Set(lines.map(line => line.name)).size);
                setTruncated(cut);
                await runSummary(lines, cut, langRef.current);
            } catch (e) {
                if (!gone) {
                    setError(String(e).replace(/^Error:\s*/, ""));
                    setBusy(false);
                }
            }
        })();
        return () => {
            gone = true;
            runId.current++;
        };
    }, [channelId, startId]);

    useLayoutEffect(() => {
        if (!showLang) return;
        const node = langBtnRef.current;
        if (node) setLangAnchor(node.getBoundingClientRect());
    }, [showLang]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (showLang) {
                setShowLang(false);
                return;
            }
            onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose, showLang]);

    function pickLanguage(code: string) {
        settings.store.summaryLang = code;
        langRef.current = code;
        setTargetLang(code);
        setShowLang(false);
        const stash = collected.current;
        if (stash) void runSummary(stash.lines, stash.truncated, code);
    }

    function onDragStart(event: ReactMouseEvent) {
        if ((event.target as HTMLElement).closest("button")) return;
        event.preventDefault();
        drag.current = { dx: event.clientX - pos.left, dy: event.clientY - pos.top };
        const move = (e: MouseEvent) => {
            if (!drag.current) return;
            setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
        };
        const up = () => {
            drag.current = null;
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    }

    const meta = error
        ? "Couldn't summarize"
        : summary
            ? `${count} message${count === 1 ? "" : "s"} · ${people} ${people === 1 ? "person" : "people"}${truncated ? " · trimmed" : ""} · from ${fromName} to now`
            : status;

    return (
        <div className={cl("root")} style={{ left: pos.left, top: pos.top }}>
            <div className={cl("card")} role="dialog" aria-label="Message summary">
                <div className={cl("head")} onMouseDown={onDragStart}>
                    <div className={cl("mark")}><SummaryMark /></div>
                    <div className={cl("titles")}>
                        <div className={cl("title")}>Summary</div>
                        <div className={cl("meta")}>{meta}</div>
                    </div>
                    <div className={cl("actions")}>
                        <button
                            ref={langBtnRef}
                            className={cl("langbtn")}
                            type="button"
                            aria-label={`Summary language: ${summaryLangLabel(targetLang)}`}
                            aria-haspopup="listbox"
                            aria-expanded={showLang}
                            title={summaryLangLabel(targetLang)}
                            onClick={() => setShowLang(open => !open)}
                        >
                            {summaryLangCode(targetLang)}
                        </button>
                        {summary && !busy && (
                            <button
                                className={cl("iconbtn")}
                                type="button"
                                aria-label="Copy summary"
                                onClick={() => copyWithToast(stripCiteMarks(summary, false) || summary, "Copied summary")}
                            >
                                <CopyIcon />
                            </button>
                        )}
                        <button
                            className={cl("iconbtn")}
                            type="button"
                            aria-label="Close summary"
                            onClick={onClose}
                        >
                            <CloseIcon />
                        </button>
                    </div>
                </div>
                <div className={cl("body")}>
                    {error
                        ? <div className={cl("error")}>{error}</div>
                        : busy
                            ? (
                                <div className={cl("status")}>
                                    <span className={cl("spin")} aria-hidden="true" />
                                    {status}
                                </div>
                            )
                            : summary
                                ? (
                                    <div className={cl("scroll")}>
                                        <SummaryBody text={summary} lines={lines} channelId={channelId} />
                                    </div>
                                )
                                : (
                                    <div className={cl("status")}>
                                        <span className={cl("spin")} aria-hidden="true" />
                                        {status}
                                    </div>
                                )}
                </div>
            </div>
            {showLang && langAnchor && (
                <LanguagePicker
                    current={targetLang}
                    anchor={langAnchor}
                    ignoreRef={langBtnRef}
                    onSelect={pickLanguage}
                    onClose={() => setShowLang(false)}
                />
            )}
        </div>
    );
}

export function closeSummaryWindow() {
    try {
        root?.unmount();
    } catch { /* already gone */ }
    root = null;
    try {
        host?.remove();
    } catch { /* already gone */ }
    host = null;
}

export function openSummaryWindow(options: {
    channelId: string;
    startId: string;
    fromName: string;
    anchor?: DOMRect | null;
}) {
    try {
        closeSummaryWindow();
        host = document.createElement("div");
        host.id = HOST_ID;
        document.body.appendChild(host);
        root = createRoot(host);
        const pos = placeFromAnchor(options.anchor);
        root.render(
            <SummaryCard
                channelId={options.channelId}
                startId={options.startId}
                fromName={options.fromName}
                left={pos.left}
                top={pos.top}
                onClose={closeSummaryWindow}
            />
        );
    } catch {
        closeSummaryWindow();
        showToast("Couldn't open the summary window.", Toasts.Type.FAILURE);
    }
}
