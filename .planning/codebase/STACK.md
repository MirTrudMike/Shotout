# Technology Stack

**Analysis Date:** 2026-05-15

## Runtime & Language

**Python 3 (primary — backend/scripting):**
- Runtime: CPython 3.x (system Python 3, required by install.sh via `python3`)
- Used in: `scripts/shotout` (main recording + transcription script), `scripts/shotout-wrapper` (orchestration wrapper + watchdog)
- No version pin; install.sh checks for `python3` presence via `command -v python3`

**JavaScript / GJS (GNOME extension):**
- Runtime: GJS (GNOME JavaScript, SpiderMonkey-based), embedded in GNOME Shell
- ES module syntax (`import`, `export default`) — requires GNOME Shell 45+
- Used in: `extension/extension.js`

**Bash:**
- Used in: `install.sh` (installer script)
- Shebang: `#!/usr/bin/env bash`, requires `set -euo pipefail`

## Core Dependencies

**Python — third-party:**

| Package | Source | Purpose |
|---------|--------|---------|
| `groq` | PyPI | Official Groq Python SDK; used to call Whisper transcription API |

Installed via `pip install --user --quiet groq` (install.sh step 2).
No `requirements.txt` or `pyproject.toml` — dependency is managed entirely by the installer.

**Python — stdlib only (no extras needed):**
- `os`, `sys`, `time`, `signal`, `subprocess` — `scripts/shotout`
- `json`, `os`, `signal`, `subprocess`, `sys`, `time`, `datetime.date`, `pathlib.Path` — `scripts/shotout-wrapper`

**JavaScript / GNOME platform libraries (imported via GI repository):**

| Import | Module | Purpose |
|--------|--------|---------|
| `gi://GObject` | GObject | Object system / class registration |
| `gi://St` | St (Shell Toolkit) | GNOME Shell UI widgets (`St.Label`) |
| `gi://Clutter` | Clutter | Animations, input events, actor layout |
| `gi://GLib` | GLib | Timers (`timeout_add`), file I/O (`file_set_contents`), timestamps |
| `gi://Gio` | Gio | File reading (`Gio.File`) |
| `resource:///org/gnome/shell/ui/main.js` | GNOME Shell | Panel access (`Main.panel`) |
| `resource:///org/gnome/shell/ui/panelMenu.js` | GNOME Shell | `PanelMenu.Button` base class |
| `resource:///org/gnome/shell/ui/popupMenu.js` | GNOME Shell | Dropdown menu items |

All GI libraries are provided by the GNOME Shell runtime — no npm or pip installs needed.

## Build System

**No build step.** This is a purely interpreted project:
- Python scripts run directly (`#!/usr/bin/env python3`)
- The GNOME extension is loaded as raw JS by GNOME Shell
- No bundler, transpiler, or compiler is used
- No `package.json`, `Makefile`, `pyproject.toml`, or `Cargo.toml`

**Installation is handled by `install.sh`:**
- Copies files to their runtime locations manually
- Installs the `groq` pip package
- Enables the GNOME extension via `gnome-extensions enable`

## Dev Dependencies

**No formal dev tooling is configured.** No test framework, linter, or formatter config files are present:
- No `pytest`, `unittest`, or any test files
- No `.eslintrc`, `.prettierrc`, `biome.json`
- No `mypy`, `ruff`, `black`, or `flake8` config
- No `jest.config.*` or `vitest.config.*`

**System tools required at runtime (checked by install.sh):**

| Tool | Package | Purpose |
|------|---------|---------|
| `sox` | `sox` | Records audio from microphone to WAV |
| `wl-copy` | `wl-clipboard` | Writes transcribed text to Wayland clipboard |
| `wl-paste` | `wl-clipboard` | (Checked by installer, not directly used in scripts) |
| `ydotool` | `ydotool` | Simulates Ctrl+V keypress to paste text |
| `ydotoold` | `ydotool` | Daemon required by ydotool (systemd service) |
| `gnome-extensions` | `gnome-shell` | Enables/disables the extension |
| `git` | `git` | Used by install.sh when cloning from remote |

Install hint in `install.sh`: `sudo dnf install sox wl-clipboard ydotool python3` (Fedora/RPM-based).

## Configuration Files

| File | Location | Controls |
|------|----------|---------|
| `extension/metadata.json` | repo root | GNOME extension identity: UUID (`shotout@local`), name, supported shell versions (45–50) |
| `~/.config/shotout/key` | user config dir | Groq API key (plaintext, `chmod 600`) — created by installer or manually |
| `~/.local/share/shotout/stats.json` | user data dir | Per-day usage stats: request count and total recorded seconds |
| `/tmp/shotout-status` | tmpfs | IPC: current state (`recording` / `recognizing` / `idle`) read by extension every 500ms |
| `/tmp/shotout-limit` | tmpfs | IPC: recording limit in seconds, written on start, read by extension for warning pulse |
| `/tmp/shotout-cancel` | tmpfs | IPC: cancel signal written by extension, read by watchdog |
| `/tmp/shotout.pid` | tmpfs | PID of the sox process, used for SIGTERM on stop/cancel |
| `/tmp/shotout-start` | tmpfs | Unix timestamp of recording start, used to compute duration |
| `/tmp/shotout-audio.wav` | tmpfs | Temporary audio file recorded by sox, sent to Groq, then deleted |

---

*Stack analysis: 2026-05-15*
