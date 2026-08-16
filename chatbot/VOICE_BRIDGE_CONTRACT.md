# Live Satellite Voice Bridge Contract

This contract defines how Live Satellite will use Votronix for voice without merging the two projects together.

## Goal

Live Satellite owns the public web experience, Cloudflare relay, Qwen chat, and mobile controls.
Votronix owns TTS, STT, voices, voice profiles, CUDA/audio settings, and local microphone/speaker features.

The phone should never call Votronix directly.

```text
Mobile browser
  -> Netlify Live Satellite page
  -> Cloudflare Worker relay
  -> Live Satellite local backend on laptop
  -> Votronix local web server on 127.0.0.1:8765
```

## Local Services

### Live Satellite backend

Default local URL:

```text
http://127.0.0.1:8091
```

Current role:

- Loads Qwen model.
- Serves `/api/chat`.
- Serves local admin/control panel.
- Updates Cloudflare relay tunnel state.
- Will proxy voice requests to Votronix.

### Votronix backend

Default local URL:

```text
http://127.0.0.1:8765
```

Current role:

- Owns voice providers and profiles.
- Provides TTS and STT endpoints.
- Should stay bound to localhost.

Existing Votronix endpoints:

```text
GET  /api/status
GET  /api/providers
POST /api/audio/upload
GET  /api/audio/source.wav
GET  /api/audio/processed.wav
POST /api/tts/synthesize
POST /api/stt/transcribe
```

## Live Satellite Voice API

These are the endpoints the frontend and Cloudflare relay should use.

### GET /api/voice/status

Returns whether Votronix is reachable and which voice defaults are selected.

Response:

```json
{
  "ok": true,
  "votronix_running": true,
  "votronix_url": "http://127.0.0.1:8765",
  "tts_ready": true,
  "stt_ready": true,
  "default_tts_provider": "system",
  "default_voice_id": "",
  "error": ""
}
```

If Votronix is not running:

```json
{
  "ok": true,
  "votronix_running": false,
  "tts_ready": false,
  "stt_ready": false,
  "error": "Votronix is not reachable on 127.0.0.1:8765."
}
```

### GET /api/voice/providers

Returns provider information from Votronix, normalized for the Live Satellite UI.

Response:

```json
{
  "ok": true,
  "tts": [
    { "id": "system", "name": "Windows System TTS" },
    { "id": "local_tone", "name": "Local Tone" },
    { "id": "custom_voice", "name": "Votronix Voice Model" },
    { "id": "coqui_xtts", "name": "Coqui XTTS v2" }
  ],
  "stt": [
    { "id": "system", "name": "System Placeholder" },
    { "id": "vosk", "name": "Vosk Offline" },
    { "id": "whisper", "name": "Whisper" }
  ]
}
```

### GET /api/voice/voices?provider_id=system

Returns voices/profiles for one TTS provider.

Votronix needs a small endpoint for this because its internal manager can list voices, but the current web API does not expose that list yet.

Response:

```json
{
  "ok": true,
  "provider_id": "system",
  "voices": [
    { "id": "default", "name": "Default" }
  ]
}
```

### POST /api/voice/tts

Generates speech from text.

Request:

```json
{
  "text": "Hello from Live Satellite.",
  "provider_id": "system",
  "voice_id": "",
  "rate": 1.0,
  "pitch": 0.0,
  "volume": 1.0
}
```

Response:

```json
{
  "ok": true,
  "provider_id": "system",
  "voice_id": "",
  "audio_url": "/api/voice/last.wav",
  "duration_seconds": null
}
```

Live Satellite should serve the audio URL itself. It should not expose Votronix file paths.

### GET /api/voice/last.wav

Returns the last generated speech audio as WAV.

Content type:

```text
audio/wav
```

### POST /api/voice/stt

Transcribes uploaded audio from the browser.

Request:

```text
multipart/form-data
field: audio
field: provider_id
```

Response:

```json
{
  "ok": true,
  "provider_id": "vosk",
  "text": "transcribed user speech"
}
```

Implementation note:

- Browser audio may arrive as WebM/Opus.
- Votronix currently works best with WAV.
- First version can accept WAV only.
- Later version can convert browser recordings before forwarding them to Votronix.

## Votronix Additions Needed

The smallest useful Votronix update is:

```text
GET /api/tts/voices?provider_id=<id>
```

Response:

```json
{
  "ok": true,
  "provider_id": "coqui_xtts",
  "voices": [
    { "id": "Michael", "name": "Michael" },
    { "id": "space_chamber", "name": "space_chamber" }
  ]
}
```

Optional later additions:

```text
GET  /api/voice/status
GET  /api/voice/profiles
POST /api/voice/tts
POST /api/voice/stt
```

Those optional endpoints would make Votronix cleaner for outside local projects, but Live Satellite can start by wrapping the existing API.

## Settings

Live Satellite backend config should eventually include:

```json
{
  "votronix_url": "http://127.0.0.1:8765",
  "voice_enabled": true,
  "voice_provider": "system",
  "voice_id": "",
  "voice_autoplay": false,
  "voice_timeout_seconds": 120
}
```

Recommended timeouts:

```text
status/providers: 3 seconds
tts: 120 seconds
stt: 60 seconds
```

## Launch Expectations

Quick launch should eventually do this in order:

1. Start or verify Votronix local web server on `127.0.0.1:8765`.
2. Start Live Satellite backend on `127.0.0.1:8091`.
3. Load Qwen.
4. Start Cloudflare tunnel or persistent Cloudflare Worker relay.
5. Publish/update the relay endpoint.
6. Open local control panel.

If Votronix is not running, Live Satellite should still work normally and show voice as offline.

## Frontend Behavior

First voice UI pass:

- Add a microphone button inside the chat widget.
- Add a speaker button beside assistant replies.
- Add voice settings inside the existing chat/settings panel.
- Keep chat text fully usable when voice is offline.
- Show voice status as `voice ready`, `voice offline`, or `voice busy`.

Default behavior:

- Do not autoplay Qwen replies unless enabled.
- Do not record until the user presses the microphone button.
- Do not expose Votronix URL to the browser.

## Step 3 Starting Point

Implement the Live Satellite backend wrapper first:

```text
GET  /api/voice/status
GET  /api/voice/providers
POST /api/voice/tts
GET  /api/voice/last.wav
```

Then test with PowerShell before touching the frontend.
