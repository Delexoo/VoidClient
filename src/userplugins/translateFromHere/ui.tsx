/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import {
    Parser,
    ReactDOM,
    createRoot,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "@webpack/common";
import type { Root } from "react-dom/client";
import type { Message } from "@vencord/discord-types";

import {
    LANGUAGES,
    Language,
    QUICK_LANGUAGES,
    languageName,
    languageShortCode,
    matchesLanguage
} from "../composeTranslate/languages";
import { settings } from "./settings";
import {
    dismissAll,
    dismissOne,
    overlayCount,
    overlayFor,
    registerOverlay,
    useBar
} from "./session";
import { retranslateCached } from "./translate";

const cl = classNameFactory("vc-tfh-");
const HOST_ID = "vc-tfh-host";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

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
        const height = 360;
        let left = anchor.left;
        let top = anchor.top - height - 8;
        if (top < 12) top = anchor.bottom + 8;
        left = Math.min(Math.max(12, left), Math.max(12, window.innerWidth - width - 12));
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
            <div className={cl("picker-title")}>Translate to</div>
            {!searching && (
                <div className={cl("quick")}>
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

function Bar() {
    const bar = useBar();
    const [showLang, setShowLang] = useState(false);
    const [anchor, setAnchor] = useState<DOMRect | null>(null);
    const langRef = useRef<HTMLButtonElement>(null);

    useLayoutEffect(() => {
        if (!showLang) return;
        const node = langRef.current;
        if (node) setAnchor(node.getBoundingClientRect());
    }, [showLang]);

    useEffect(() => {
        if (!bar.active) setShowLang(false);
    }, [bar.active]);

    if (!bar.active) return null;

    const count = overlayCount();
    const label = bar.busy
        ? bar.status
        : bar.error || `${count} message${count === 1 ? "" : "s"} · only you can see this`;

    return (
        <>
            <div className={cl("bar")} role="status">
                <div className={cl("bar-text")}>
                    <div className={cl("bar-title")}>{bar.mode === "auto" ? "Auto-translate" : "Translate from here"}</div>
                    <div className={cl("bar-meta")}>{label}</div>
                </div>
                <button
                    ref={langRef}
                    type="button"
                    className={cl("langbtn")}
                    title={languageName(bar.lang)}
                    aria-label={`Language: ${languageName(bar.lang)}`}
                    aria-expanded={showLang}
                    disabled={bar.busy}
                    onClick={() => !bar.busy && setShowLang(open => !open)}
                >
                    {languageShortCode(bar.lang)}
                </button>
                <button
                    type="button"
                    className={cl("dismiss-all")}
                    onClick={() => dismissAll()}
                >
                    Dismiss
                </button>
            </div>
            {showLang && anchor && (
                <LanguagePicker
                    current={bar.lang}
                    anchor={anchor}
                    ignoreRef={langRef}
                    onSelect={code => {
                        settings.store.targetLang = code;
                        setShowLang(false);
                        void retranslateCached(code);
                    }}
                    onClose={() => setShowLang(false)}
                />
            )}
        </>
    );
}

export function TranslationOverlay({ message }: { message: Message; }) {
    const [text, setText] = useState(() => overlayFor(message.id));
    const { targetLang } = settings.use(["targetLang"]);

    useEffect(() => registerOverlay(message.id, setText), [message.id]);

    useEffect(() => {
        const node = document.getElementById("message-content-" + message.id);
        if (text) node?.classList.add("vc-tfh-hidden");
        else node?.classList.remove("vc-tfh-hidden");
        return () => node?.classList.remove("vc-tfh-hidden");
    }, [text, message.id]);

    if (!text) return null;

    return (
        <div className={cl("card")}>
            <div className={cl("body")}>{Parser.parse(text)}</div>
            <div className={cl("foot")}>
                (only you · {languageName(targetLang || "en")} ·{" "}
                <button
                    type="button"
                    className={cl("dismiss")}
                    onClick={() => dismissOne(message.id)}
                >
                    Dismiss
                </button>
                )
            </div>
        </div>
    );
}

export function mountBar() {
    try {
        unmountBar();
        host = document.createElement("div");
        host.id = HOST_ID;
        document.body.appendChild(host);
        root = createRoot(host);
        root.render(<Bar />);
    } catch {
        unmountBar();
    }
}

export function unmountBar() {
    dismissAll();
    try {
        root?.unmount();
    } catch { /* already gone */ }
    root = null;
    try {
        host?.remove();
    } catch { /* already gone */ }
    host = null;
}
