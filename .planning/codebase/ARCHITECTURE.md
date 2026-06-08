<!-- refreshed: 2026-05-15 -->
# Architecture

**Analysis Date:** 2026-05-15

## System Overview

ShotOUT is a GNOME Shell extension + companion Python scripts that provide push-to-talk voice input for any application on a Wayland desktop. The user presses a hotkey to start recording audio, presses it again to stop, and the audio is transcribed via the Groq Whisper API and pasted at the cursor position. A visual indicator in the GNOME top bar shows recording state in real time.

```text
┌──────────────────────────────────────────────────────────────────┐
│                     GNOME Shell Process                          │
│                                                                  │
│   VoiceInputExtension (extension.js)                             │
│   └── VoiceIndicator (PanelMenu.Button)                          │
│        ├── St.Label  — emoji/timer display                       │
│        └── PopupMenu — usage stats                               │
│                            │                                     │
│                   polls /tmp/shotout-status every 500 ms         │
└───────────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │  /tmp/shotout-status      │  ← shared IPC via filesystem
              │  /tmp/shotout-limit       │
              │  /tmp/shotout-cancel      │
              │  /tmp/shotout.pid         │
              └─────────────┬─────────────┘
                            │
┌──────────────────────────────────────────────────────────────────┐
│  User space — invoked by GNOME keyboard shortcut                 │
│                                                                  │
│  shotout-wrapper  (scripts/shotout-wrapper)                      │
│  ├── main() — toggle: start or stop+transcribe                   │
│  └── run_watchdog() — detached subprocess                        │
│        ├── polls for CANCEL_FILE (user clicked icon)             │
│        └── auto-stops after MAX_RECORDING_SECS (5 min)           │
│                            │                                     │
│  shotout  (scripts/shotout)                                      │
│  ├── start_recording()  → sox subprocess → /tmp/shotout-audio.wav│
│  └── stop_and_transcribe()                                       │
│        ├── Groq(api_key).audio.transcriptions.create()           │
│        ├── wl-copy  — write text to Wayland clipboard            │
│        └── ydotool key 29:1 47:1 …  — simulate Ctrl+V            │
└──────────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │  External services        │
              │  Groq API (Whisper v3)    │
              └───────────────────────────┘
```

## Component Model

| Component | File | Responsibility |
|-----------|------|----------------|
| `VoiceInputExtension` | `extension/extension.js` | GNOME extension lifecycle (`enable`/`disable`); owns the indicator |
| `VoiceIndicator` | `extension/extension.js` | `PanelMenu.Button` subclass; reads tmp files every 500 ms; renders emoji/timer/menu |
| `shotout-wrapper` | `scripts/shotout-wrapper` | Hotkey handler; manages recording lifecycle, watchdog process, stats, IPC files |
| `shotout` | `scripts/shotout` | Core audio capture (sox) and Groq API transcription; also handles clipboard paste |
| Watchdog subprocess | `scripts/shotout-wrapper` (`run_watchdog`) | Detached process that enforces cancel and time-limit auto-stop without blocking the hotkey |

## Data Flow

### Recording start (hotkey press 1)

1. User presses hotkey → GNOME Keyboard Shortcuts launches `shotout-wrapper`.
2. `shotout-wrapper.main()` finds no `PIDFILE` → start branch.
3. Writes timestamp to `/tmp/shotout-start`, recording limit to `/tmp/shotout-limit`.
4. Writes `"recording"` to `/tmp/shotout-status`.
5. Spawns detached watchdog subprocess (`shotout-wrapper --watchdog`).
6. Calls `subprocess.run([shotout])` → `shotout.start_recording()` → sox records to `/tmp/shotout-audio.wav` and writes its PID to `/tmp/shotout.pid`.
7. `VoiceIndicator._poll()` (500 ms timer) reads `"recording"` from status file → switches label to `🎙 0:00` and starts elapsed-time counter.

### Recording stop (hotkey press 2)

1. User presses hotkey again → `shotout-wrapper.main()` finds `PIDFILE` → stop branch.
2. Waits `TAIL_DELAY` (1.5 s) so last words are captured.
3. Writes `"recognizing"` to status file.
4. Calls `subprocess.run([shotout])` → `shotout.stop_and_transcribe()`:
   - Sends SIGTERM to sox PID.
   - Calls Groq API with the WAV file.
   - Pipes transcribed text to `wl-copy`.
   - Simulates Ctrl+V via `ydotool key`.
5. Writes usage stats to `~/.local/share/shotout/stats.json`.
6. Writes `"idle"` to status file; cleans up tmp files.
7. `VoiceIndicator._poll()` reads `"idle"` → resets label to `🎤`.

### Cancel flow (click on panel icon during recording)

1. User clicks the `VoiceIndicator` while `_status === 'recording'`.
2. `VoiceIndicator._cancelRecording()` writes `"1"` to `/tmp/shotout-cancel`.
3. Watchdog polls every 1 s, detects `CANCEL_FILE` → kills sox, writes `"idle"`, cleans up tmp files. No transcription occurs.
4. Extension shows animated ✗ feedback, then restores 🎤.

### Warning pulse

When elapsed recording time reaches `recordingLimitSec - WARNING_SECS` (last 10 s before the 5-minute limit), `VoiceIndicator._startWarningPulse()` begins an orange opacity-cycling animation on the label using Clutter easing.

### Auto-stop (watchdog time limit)

If the user never presses the hotkey a second time, the watchdog counts 300 seconds, then calls `subprocess.run([ORIGINAL])` itself to trigger transcription, writes stats, resets status to `"idle"`.

## Communication Patterns

**Filesystem-based IPC (primary):** All state is exchanged via files in `/tmp/`. This is the only channel between the GNOME Shell process (sandboxed, no direct subprocess execution in the main thread) and the user-space Python scripts.

| File | Written by | Read by | Meaning |
|------|-----------|---------|---------|
| `/tmp/shotout-status` | `shotout-wrapper` | `VoiceIndicator` (poll) | `idle` / `recording` / `recognizing` |
| `/tmp/shotout.pid` | `shotout` (sox PID) | `shotout-wrapper`, watchdog | Indicates active recording |
| `/tmp/shotout-limit` | `shotout-wrapper` | `VoiceIndicator` | Recording duration limit in seconds |
| `/tmp/shotout-cancel` | `VoiceIndicator` | Watchdog | Cancel signal from UI |
| `/tmp/shotout-start` | `shotout-wrapper` | `shotout-wrapper` (stop branch) | Unix timestamp of recording start |
| `/tmp/shotout-audio.wav` | sox (via `shotout`) | `shotout` (transcription) | Raw audio capture |
| `~/.local/share/shotout/stats.json` | `shotout-wrapper` | `VoiceIndicator` (menu open) | Per-day request/duration counters |

**Polling (extension side):** `VoiceIndicator` uses `GLib.timeout_add` at 500 ms intervals to read the status file. There is no push notification; the extension is purely reactive to file state.

**Subprocess execution:**
- `shotout-wrapper` calls `subprocess.run([shotout])` synchronously for the core audio/API work.
- The watchdog is started with `subprocess.Popen(..., start_new_session=True)` to fully detach it.
- `shotout` calls `subprocess.Popen(["sox", ...])` to capture audio, and `subprocess.run(["ydotool", ...])` / `subprocess.Popen(["wl-copy"], stdin=PIPE)` for output.

**Shims directory:** `shotout-wrapper` prepends `~/.local/lib/shotout-shims` to `PATH` before calling `shotout`, allowing fake implementations of commands like `notify-send` to intercept calls without modifying the original script.

## Key Design Decisions

**Separation of extension and scripts:** GNOME Shell extensions run inside the shell process with restricted capabilities. All blocking I/O (microphone, network) is delegated to external Python processes. The extension only reads files and drives animations.

**Wrapper + original script pattern:** `shotout` is a standalone, independently useful script. `shotout-wrapper` adds GNOME indicator support non-invasively by wrapping it, writing IPC files before/after delegating the actual work. The original script is never modified.

**Watchdog subprocess for cancel/timeout:** Because the main `shotout-wrapper` process blocks during recording (sitting inside `subprocess.run([shotout])`), a separate detached watchdog process handles the cancel file and the time limit. This avoids threading and keeps both scripts single-threaded.

**TAIL_DELAY (1.5 s):** When the user presses the stop hotkey, the wrapper waits 1.5 seconds before stopping sox. This captures the trailing words of the utterance that would otherwise be cut off.

**Polling interval tradeoff:** 500 ms polling in the extension is a balance between UI responsiveness and GNOME Shell CPU impact. The timer label increments in whole seconds so the visible update lag is imperceptible.

**Stats persistence:** Usage data is accumulated in a JSON file keyed by ISO date (`~/.local/share/shotout/stats.json`). The extension reads this file only when the user opens the popup menu, avoiding continuous disk I/O.

**API key storage:** The Groq API key is read from the `GROQ_API_KEY` environment variable first, then from `~/.config/shotout/key` (mode 600). No key is ever stored in the extension or committed to the repository.
