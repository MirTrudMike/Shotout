# Technical Concerns

## Critical Issues

### Race Conditions
- **Cancel race**: `cancelFile` flag written to `/tmp/shotout_cancel` may arrive after sox recording has already started
  and the Groq API call is in flight — no atomic cancel handshake exists between recorder and wrapper
- **Double-trigger race**: pressing the hotkey twice before the first recording starts can spawn two sox processes
  writing to the same `/tmp/shotout_recording.wav` file, corrupting the audio
- **sox silent failure**: `stderr=subprocess.DEVNULL` suppresses all sox errors; a failed recording looks like silence
  with no user feedback and no log entry

### IPC Contract
- Six `/tmp` files used as IPC primitives (`shotout_recording.wav`, `shotout_cancel`, `shotout_transcription`, etc.)
  with no documented contract, no locking, and no cleanup on crash

## Security Concerns

- **Hardcoded personal prompt** in Whisper API call inside `scripts/shotout` — leaks intent/persona to Groq logs
- **Raw ydotool scan codes** used to inject keyboard input without validation — depends on ydotoold running as root daemon
- **curl-pipe-bash installer** (`install.sh`) without checksum or signature verification — supply chain risk

## Technical Debt

- File paths duplicated in at least three files (`scripts/shotout`, `scripts/shotout-wrapper`, `extension/extension.js`);
  any rename requires coordinated edits in all three
- No structured logging — errors go to `logError()` in the extension (journalctl only) or are silently swallowed in scripts
- Watchdog loop in `shotout-wrapper` runs `time.sleep(1)` in a 300-iteration polling loop — blocks the process thread
  for up to 5 minutes with no early-exit signal handling

## Performance Concerns

- GNOME extension polls status file every 500 ms unconditionally, even when not recording — wastes cycles on idle
- Watchdog process busy-loops rather than using `inotify` or `asyncio` to react to file changes
- No streaming: Groq transcription waits for full WAV upload before returning — adds latency for long recordings

## Maintainability Concerns

- `extension/extension.js` mixes UI state, file I/O, and subprocess coordination in a single file with no clear separation
- Animation logic (fade-in/hold/fade-out) is implemented with chained GLib.timeout_add calls — hard to follow and modify
- No comments explaining the `/tmp` file lifecycle or the recording state machine

## Dependency Concerns

- `groq` Python package pinned loosely (no exact version in requirements) — breaking API changes will be silent until runtime
- `sox` assumed present with no version check or graceful fallback message
- `ydotoold` requires a running root daemon — no detection or helpful error if missing

## Missing Capabilities

- No error surfacing to the user: API errors, sox errors, and ydotool errors all result in silent failure
- No configurable output: transcription always types via ydotool; no clipboard-only mode
- No recording time limit enforcement in the recorder script (only in the wrapper watchdog, which can be bypassed)
- No support for multiple audio input devices or fallback device selection
- No tests of any kind

## Refactoring Opportunities

- Centralize `/tmp` file paths into a single shared constants module (or pass via environment)
- Replace polling loops with `inotify`-based file watching (`watchdog` library or `pyinotify`)
- Add a proper state machine for recording lifecycle: IDLE → RECORDING → TRANSCRIBING → TYPING → IDLE
- Surface errors via GNOME notification (`Gio.Notification`) instead of silent failure
- Replace the curl-pipe-bash installer with a packaged distro-compatible install method
