# Live translation — what to use

Your current plugin already translates text. The broken part is speech-to-text (`whisper-tiny` inside Discord). That model invents words from noise.

## Pick

**Best for this plugin: without a local AI model.**

Use a real streaming speech service (or Windows Live Captions) for text, then keep Google Translate. That is how Zoom / Meet / caption apps stay accurate and light. No Whisper in the Discord process.

| Path | Quality | Weight in Discord | Tagalog | Verdict |
| --- | --- | --- | --- | --- |
| **No local AI** — cloud STT or Windows Live Captions → Google Translate | High | Lowest | Good | **Use this** |
| **Paid AI** — OpenAI Realtime or Gemini Live | Highest | Low (API) | Best | Best “perfect” if you add an API key |
| **Local AI** — faster-whisper / WhisperLive / Moonshine in a helper | Medium | High CPU/RAM | Weak on tiny/base | Only if you need offline |
| **Current** — `whisper-tiny` in the renderer | Poor | Medium | Hallucinates | Do not keep |

Do not put Argos, LibreTranslate, WhisperX, or a Python server inside Discord. Those are desktop/server stacks.

## Keep (relevant)

### No local AI (recommended)

- https://github.com/SakiRinn/LiveCaptions-Translator
- https://github.com/wotschofsky/discord-live-translator
- https://github.com/botbahlul/js-live-audio-video-translate
- https://github.com/botbahlul/crx-live-translate
- https://github.com/botbahlul/VOSK-Powered-Live-Subtitle-V3
- https://github.com/aws-samples/amazon-transcribe-live-meeting-assistant

### Paid AI (best quality)

- https://github.com/twilio-samples/live-translation-openai-realtime-api
- https://github.com/livekit-examples/live-translated-captioning
- https://github.com/google-gemini/gemini-live-translate-livekit

### Local AI (offline only)

- https://github.com/openai/whisper
- https://github.com/collabora/WhisperLive
- https://github.com/QuentinFuxa/WhisperLiveKit
- https://github.com/KoljaB/RealtimeSTT
- https://github.com/JonathanFly/faster-whisper-livestream-translator
- https://github.com/moonshine-ai/moonshine
- https://github.com/argosopentech/argos-translate
- https://github.com/LibreTranslate/LibreTranslate
