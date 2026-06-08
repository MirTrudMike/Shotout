# File Structure

**Analysis Date:** 2026-05-15

## Directory Layout

```
groq-voice/                          # Repository root
├── extension/                       # GNOME Shell extension package
│   ├── extension.js                 # Extension + indicator implementation (319 lines)
│   └── metadata.json                # Extension manifest (UUID, name, shell versions)
├── scripts/                         # User-space executables
│   ├── shotout                      # Core: audio capture + Groq API transcription
│   └── shotout-wrapper              # Hotkey handler: IPC files, watchdog, stats
├── install.sh                       # Interactive installer script
├── .gitignore                       # (standard ignores)
└── README.md                        # User-facing documentation
```

Runtime paths (not in repo — created by installer / scripts at runtime):

```
~/.local/share/gnome-shell/extensions/shotout@local/   # Installed extension
~/.local/bin/shotout                                    # Installed core script
~/.local/bin/shotout-wrapper                           # Installed wrapper script
~/.local/lib/shotout-shims/                            # notify-send shim dir
~/.config/shotout/key                                  # Groq API key (mode 600)
~/.local/share/shotout/stats.json                      # Per-day usage stats
/tmp/shotout-status                                    # IPC: current state
/tmp/shotout.pid                                       # IPC: sox process PID
/tmp/shotout-audio.wav                                 # IPC: recorded audio
/tmp/shotout-start                                     # IPC: recording start timestamp
/tmp/shotout-limit                                     # IPC: max duration (seconds)
/tmp/shotout-cancel                                    # IPC: cancel signal
```

## Key Files

| File | Purpose | Why it matters |
|------|---------|----------------|
| `extension/extension.js` | GNOME Shell extension — defines `VoiceInputExtension` (lifecycle) and `VoiceIndicator` (UI) | Only file that runs inside the GNOME Shell process; drives all visual feedback |
| `extension/metadata.json` | Extension manifest with UUID `shotout@local` and supported shell versions (45–50) | Required by GNOME to load the extension; UUID must match install path |
| `scripts/shotout` | Python script: starts sox recording or stops it and calls Groq Whisper API, then pastes via wl-copy + ydotool | Core business logic — audio capture and transcription |
| `scripts/shotout-wrapper` | Python script: wraps `shotout` with IPC file management, watchdog subprocess, usage stats | Must be set as the hotkey command; produces all files that the extension reads |
| `install.sh` | Bash installer: checks deps, copies files to system paths, prompts for API key, enables extension | Single-command setup — also documents all install locations |

## Entry Points

**GNOME Extension lifecycle** — `extension/extension.js`, class `VoiceInputExtension`:
- `enable()`: creates `VoiceIndicator`, adds it to `Main.panel.statusArea`, starts the 500 ms poll timer.
- `disable()`: stops the poll timer, destroys the indicator. Called by GNOME when the extension is toggled off or the session ends.

**Keyboard shortcut** — `scripts/shotout-wrapper`, function `main()`:
- Assigned by the user as a GNOME custom shortcut command.
- Toggle semantics: if `/tmp/shotout.pid` exists → stop branch; otherwise → start branch.
- On start: writes IPC files, launches watchdog, delegates to `shotout`.
- On stop: waits `TAIL_DELAY`, delegates to `shotout`, writes stats, cleans up.

**Watchdog subprocess** — `scripts/shotout-wrapper`, function `run_watchdog()`:
- Launched automatically by `main()` on recording start via `subprocess.Popen(..., start_new_session=True)`.
- Invoked as `shotout-wrapper --watchdog`; never called directly by the user.

**Core audio/API worker** — `scripts/shotout`, `__main__` block:
- Called by `shotout-wrapper` via `subprocess.run([ORIGINAL])`.
- Not meant to be assigned as the hotkey directly (no IPC file management).

**Installer** — `install.sh`:
- Run once by the user: `bash install.sh` or `bash <(curl -fsSL ...)`.
- Copies files, prompts for API key, enables the GNOME extension.

## Module Boundaries

The project has three distinct layers with a strict one-way dependency:

```
┌─────────────────────────────────────────────────┐
│  Layer 1: GNOME Shell (JavaScript / GJS)        │
│  extension/extension.js                         │
│  • Runs inside gnome-shell process              │
│  • NO subprocess, NO network, NO blocking I/O   │
│  • Reads /tmp files only (Gio.File)             │
│  • Drives Clutter animations and St widgets     │
└───────────────────────┬─────────────────────────┘
                        │  reads /tmp/shotout-*
                        │  writes /tmp/shotout-cancel
                        ▼
┌─────────────────────────────────────────────────┐
│  Layer 2: Hotkey Orchestration (Python)         │
│  scripts/shotout-wrapper                        │
│  • Invoked by GNOME keyboard shortcut           │
│  • Manages all IPC files                        │
│  • Spawns watchdog, calls shotout               │
│  • Writes stats.json                           │
└───────────────────────┬─────────────────────────┘
                        │  subprocess.run([shotout])
                        ▼
┌─────────────────────────────────────────────────┐
│  Layer 3: Audio + API (Python)                  │
│  scripts/shotout                                │
│  • Records audio via sox                        │
│  • Calls Groq API                               │
│  • Pastes text via wl-copy + ydotool            │
│  • Can be used standalone without the extension │
└─────────────────────────────────────────────────┘
```

**Cross-layer contracts:**
- Layer 1 → Layer 2/3: reads `/tmp/shotout-status` (`idle` | `recording` | `recognizing`), `/tmp/shotout-limit`; writes `/tmp/shotout-cancel`.
- Layer 2 → Layer 3: calls `shotout` as a subprocess; both share `/tmp/shotout.pid` and `/tmp/shotout-audio.wav`.
- Layer 2 reads `~/.local/share/shotout/stats.json` (writes it); Layer 1 reads it (never writes it).

**Adding new code:**
- New UI states or indicator animations → `extension/extension.js`, inside `VoiceIndicator`.
- New IPC signals from extension to scripts → write a new `/tmp/shotout-*` file in `_cancelRecording()` or a new vfunc; poll it in `shotout-wrapper` watchdog.
- New transcription providers → `scripts/shotout`, `stop_and_transcribe()`.
- New stats fields → `scripts/shotout-wrapper`, `write_stats()`; read in `VoiceIndicator._updateMenu()`.
- New dependencies or install steps → `install.sh`.
