/*
 * Plugins Void Client pins on first run, and the ones that start enabled.
 */

export const VOID_CLIENT_DEFAULTS_VERSION = 3;

export const VOID_CLIENT_PINNED = [
    "AdvancedNotes",
    "AdvancedRichPresence",
    "AudioCapture",
    "AutoTranslate",
    "Badges",
    "ComposeTranslate",
    "Fake Defean",
    "ImageZoom",
    "Internet Protocol Assessment",
    "LiveVoiceTranslate",
    "Mentions",
    "MessageLogger",
    "Nickname",
    "NoTypingAnimation",
    "PhishingDetect",
    "QuickSummary",
    "ReverseImageSearch",
    "Spoof Join",
    "StalkerMode",
    "TranslateFromHere",
    "Translate",
    "TypingIndicator",
    "WhoReacted",
    "YouTube",
    "VoiceDownload",
    "UnlockedAvatarZoom"
] as const;

export const VOID_CLIENT_ENABLED = new Set<string>([
    "AutoTranslate",
    "ComposeTranslate",
    "ImageZoom",
    "LiveVoiceTranslate",
    "MessageLogger",
    "ReverseImageSearch",
    "TranslateFromHere",
    "Translate",
    "TypingIndicator",
    "WhoReacted",
    "VoiceDownload",
    "UnlockedAvatarZoom"
]);

export const VOID_CLIENT_PINNED_SET = new Set<string>(VOID_CLIENT_PINNED);

export function applyVoidClientPluginDefaults(settings: {
    plugins?: Record<string, { enabled: boolean; isFavorite?: boolean; }>;
    voidClientPluginDefaults?: number;
}) {
    const previous = settings.voidClientPluginDefaults ?? 0;
    if (previous === VOID_CLIENT_DEFAULTS_VERSION) return false;

    settings.plugins ??= {};
    for (const name of VOID_CLIENT_PINNED) {
        const entry = settings.plugins[name] ??= { enabled: VOID_CLIENT_ENABLED.has(name) };
        if (entry.isFavorite == null) entry.isFavorite = true;
    }
    for (const name of VOID_CLIENT_ENABLED) {
        const entry = settings.plugins[name] ??= { enabled: true, isFavorite: true };
        const newlyAdded = name === "LiveVoiceTranslate" && previous < 3;
        if (previous === 0 || newlyAdded) entry.enabled = true;
        if (entry.isFavorite == null) entry.isFavorite = true;
    }
    settings.voidClientPluginDefaults = VOID_CLIENT_DEFAULTS_VERSION;
    return true;
}
