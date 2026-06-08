# External Integrations

**Analysis Date:** 2026-05-15

## APIs & Services

**Groq Whisper API:**
- Purpose: Speech-to-text transcription of recorded audio
- Protocol: HTTPS REST (abstracted via the `groq` Python SDK)
- Call site: `scripts/shotout`, function `stop_and_transcribe()`
- SDK usage:
  ```python
  from groq import Groq
  client = Groq(api_key=get_api_key())
  result = client.audio.transcriptions.create(
      file=("audio.wav", af.read()),
      model="whisper-large-v3",
      response_format="text",
      prompt="...",   # multilingual hint prompt
  )
  ```
- Model: `whisper-large-v3` (hardcoded in `scripts/shotout`)
- Response: plain text string (via `response_format="text"`)
- Error handling: exceptions caught, forwarded to `notify-send`
- No retry logic; single attempt per recording

## Authentication

**Groq API key:**
- Loaded by `get_api_key()` in `scripts/shotout`
- Resolution order:
  1. Environment variable `GROQ_API_KEY` (checked first via `os.environ.get`)
  2. File `~/.config/shotout/key` (plaintext, `chmod 600`)
- If neither is present, raises `RuntimeError` with the expected file path
- Key is saved interactively by `install.sh` during setup
- No OAuth, no tokens, no session management — static API key only

## Data Storage

**Usage statistics (`~/.local/share/shotout/stats.json`):**
- Format: JSON, keyed by ISO date string (`"YYYY-MM-DD"`)
- Schema per day: `{"requests": int, "seconds": int}`
- Written by: `scripts/shotout-wrapper`, function `write_stats(duration_secs)`
- Read by: `extension/extension.js`, method `_readStats()` via `Gio.File`
- Directory created automatically: `STATS_FILE.parent.mkdir(parents=True, exist_ok=True)`

**Temporary audio file (`/tmp/shotout-audio.wav`):**
- Created by: `sox` subprocess in `scripts/shotout`, function `start_recording()`
- Consumed by: Groq API call in `stop_and_transcribe()`
- Deleted: always in `finally` block after transcription attempt
- Format: 16 kHz, mono, WAV

**IPC files in `/tmp/` (file-based inter-process communication):**

| File | Writer | Reader | Purpose |
|------|--------|--------|---------|
| `/tmp/shotout-status` | `scripts/shotout-wrapper` | `extension/extension.js` | Current state string |
| `/tmp/shotout-limit` | `scripts/shotout-wrapper` | `extension/extension.js` | Max recording seconds |
| `/tmp/shotout-cancel` | `extension/extension.js` (via `GLib.file_set_contents`) | `scripts/shotout-wrapper` watchdog | Cancel signal |
| `/tmp/shotout.pid` | `scripts/shotout` | `scripts/shotout-wrapper`, watchdog | sox process PID |
| `/tmp/shotout-start` | `scripts/shotout-wrapper` | `scripts/shotout-wrapper` | Recording start timestamp |
| `/tmp/shotout-audio.wav` | sox (via `scripts/shotout`) | `scripts/shotout` (Groq upload) | Raw audio |

No database, no remote storage, no cloud sync beyond the Groq transcription call.

## Browser / Platform APIs

**GNOME Shell extension APIs (used in `extension/extension.js`):**

| API | How used |
|-----|---------|
| `GObject.registerClass` | Registers `VoiceIndicator` as a GObject subclass |
| `PanelMenu.Button` | Base class for the top-bar indicator widget |
| `PopupMenu.PopupBaseMenuItem`, `PopupMenu.PopupSeparatorMenuItem` | Dropdown stats menu items |
| `St.Label` | Text label rendered in the panel |
| `Clutter.ActorAlign`, `Clutter.AnimationMode`, `Clutter.EventType` | Widget alignment, easing animations, input event types |
| `GLib.timeout_add` / `GLib.source_remove` | 500ms polling loop; cancel animation hold timer |
| `GLib.get_real_time()` | High-resolution timestamp for elapsed recording time |
| `GLib.file_set_contents` | Writes `/tmp/shotout-cancel` atomically |
| `GLib.PRIORITY_DEFAULT`, `GLib.SOURCE_CONTINUE`, `GLib.SOURCE_REMOVE` | GLib main loop constants |
| `Gio.File.new_for_path` / `.load_contents` | Reads status, limit, and stats files |
| `Main.panel.addToStatusArea` | Inserts indicator into GNOME top bar |
| `TextDecoder` | Decodes `Uint8Array` file contents to string |

**Wayland clipboard (`wl-clipboard`):**
- Tool: `wl-copy` (external process, spawned via `subprocess.Popen`)
- Usage: transcribed text piped to stdin of `wl-copy`
- Call site: `scripts/shotout`, `stop_and_transcribe()`

**Keyboard input simulation (`ydotool`):**
- Tool: `ydotool key 29:1 47:1 47:0 29:0` — simulates Ctrl+V (key codes for Left Ctrl + V)
- Requires `ydotoold` daemon running as a systemd service
- Call site: `scripts/shotout`, `stop_and_transcribe()`

**Audio capture (`sox`):**
- Tool: `sox -d -r 16000 -c 1 /tmp/shotout-audio.wav`
- Flags: `-d` = default microphone input, `-r 16000` = 16 kHz sample rate, `-c 1` = mono
- Managed as a subprocess; PID tracked in `/tmp/shotout.pid`
- Terminated with `SIGTERM` by `scripts/shotout` / watchdog

**Desktop notifications (`notify-send`):**
- Used for error reporting in `scripts/shotout`
- Call: `notify-send -u critical -t 8000 "ShotOUT error" <message>`
- A shim directory `~/.local/lib/shotout-shims/` is prepended to `PATH` by `shotout-wrapper` to intercept `notify-send` calls from the original script

**GNOME extension management:**
- `gnome-extensions enable shotout@local` called by `install.sh`
- Extension UUID: `shotout@local` (defined in `extension/metadata.json`)
- Supported GNOME Shell versions: 45, 46, 47, 48, 49, 50

**systemd:**
- `ydotoold` must run as a systemd service for `ydotool` to function
- Installer instructs: `sudo systemctl enable --now ydotoold`

## Environment Variables

| Variable | Required | Purpose | Fallback |
|----------|----------|---------|---------|
| `GROQ_API_KEY` | Optional | Groq API key passed via environment | Falls back to `~/.config/shotout/key` file |
| `PATH` | System | Prepended with `~/.local/lib/shotout-shims/` by `shotout-wrapper` to intercept `notify-send` | N/A |

No `.env` file is used. No other environment variables are read or required.

---

*Integration audit: 2026-05-15*
