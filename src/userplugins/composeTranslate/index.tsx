/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import definePlugin, { IconComponent } from "@utils/types";
import {
    ReactDOM,
    showToast,
    Toasts,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "@webpack/common";

import { Delexo } from "../_delexo/author";
import {
    LANGUAGES,
    Language,
    QUICK_LANGUAGES,
    languageName,
    languageShortCode,
    matchesLanguage
} from "./languages";
import { settings } from "./settings";
import managedStyle from "./style.css?managed";
import { translateComposer } from "./translate";

const cl = classNameFactory("vc-ctr-");

const TranslateIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        viewBox="0 96 960 960"
        height={height}
        width={width}
        className={className}
    >
        <path
            fill="currentColor"
            d="m475 976 181-480h82l186 480h-87l-41-126H604l-47 126h-82Zm151-196h142l-70-194h-2l-70 194Zm-466 76-55-55 204-204q-38-44-67.5-88.5T190 416h87q17 33 37.5 62.5T361 539q45-47 75-97.5T487 336H40v-80h280v-80h80v80h280v80H567q-22 69-58.5 135.5T419 598l98 99-30 81-127-122-200 200Z"
        />
    </svg>
);

function hideStockTranslateModalButton() {
    try {
        const buttons = Settings.uiElements.chatBarButtons;
        buttons.Translate ??= {} as any;
        buttons.Translate.enabled = false;
    } catch { /* ignore */ }
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
        const height = 360;
        let left = anchor.right - width;
        let top = anchor.top - height - 8;
        if (top < 12) top = anchor.bottom + 8;
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
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("mousedown", onDown);
        window.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            window.removeEventListener("keydown", onKey);
        };
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
            <div className={cl("title")}>Translate to</div>
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

const ComposeTranslateButtons: ChatBarButtonFactory = ({ isAnyChat, channel }) => {
    const { targetLang } = settings.use(["targetLang"]);
    const [busy, setBusy] = useState(false);
    const [showLang, setShowLang] = useState(false);
    const [anchor, setAnchor] = useState<DOMRect | null>(null);
    const splitRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (!showLang) return;
        const node = splitRef.current;
        if (node) setAnchor(node.getBoundingClientRect());
    }, [showLang]);

    if (!isAnyChat) return null;

    const langName = languageName(targetLang);
    const short = languageShortCode(targetLang);

    async function translateNow() {
        if (busy) return;
        setShowLang(false);
        setBusy(true);
        try {
            await translateComposer(channel.id);
        } catch (e) {
            showToast(String(e).replace(/^Error:\s*/, ""), Toasts.Type.FAILURE);
        } finally {
            setBusy(false);
        }
    }

    return (
        <ErrorBoundary noop>
            <div className={cl("bar")}>
                <div ref={splitRef} className={cl("split")}>
                    <ChatBarButton
                        tooltip={busy ? "Translating…" : `Translate to ${langName}`}
                        onClick={() => void translateNow()}
                    >
                        <TranslateIcon className={cl("icon", { busy })} />
                    </ChatBarButton>
                    <ChatBarButton
                        tooltip={`Language: ${langName}`}
                        onClick={() => setShowLang(open => !open)}
                        buttonProps={{
                            "aria-haspopup": "listbox",
                            "aria-expanded": showLang
                        }}
                    >
                        <span className={cl("lang")}>{short}</span>
                    </ChatBarButton>
                </div>
            </div>
            {showLang && anchor && (
                <LanguagePicker
                    current={targetLang}
                    anchor={anchor}
                    ignoreRef={splitRef}
                    onSelect={code => {
                        settings.store.targetLang = code;
                        setShowLang(false);
                    }}
                    onClose={() => setShowLang(false)}
                />
            )}
        </ErrorBoundary>
    );
};

export default definePlugin({
    name: "ComposeTranslate",
    description: "Translate your draft before you send it.",
    tags: ["Chat", "Utility", "API Required"],
    searchTerms: ["translate", "openrouter", "language", "tagalog", "spanish", "delexo"],
    authors: [Delexo],
    enabledByDefault: true,
    settings,
    managedStyle,
    start: hideStockTranslateModalButton,
    chatBarButton: {
        icon: TranslateIcon,
        render: ComposeTranslateButtons
    }
});
