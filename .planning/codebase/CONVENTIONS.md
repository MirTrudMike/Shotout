# Code Conventions

**Analysis Date:** 2026-05-15

## Naming Conventions

**Files:**
- Lowercase kebab-case for scripts: `shotout`, `shotout-wrapper`
- Lowercase for GNOME extension entry point: `extension.js`
- No file extensions on Python scripts (they use shebangs)

**JavaScript (extension.js):**
- Private instance fields: underscore prefix (`_label`, `_status`, `_pulsing`, `_cancelAnimating`, `_timeoutId`, `_cancelHoldId`)
- Public methods: camelCase (`startPolling`, `stopPolling`)
- Private methods: camelCase with underscore prefix (`_poll`, `_readStatus`, `_readLimit`, `_buildMenu`, `_cancelRecording`, `_showCancelFeedback`, `_abortCancelAnimation`)
- GObject class registered via `GObject.registerClass` with a class name matching the variable: `VoiceIndicator`
- Constants: SCREAMING_SNAKE_CASE at module level (`STATUS_FILE`, `POLL_INTERVAL_MS`, `WARNING_SECS`, `LABEL_STYLE`)
- Export class: default export for the GNOME extension class (`VoiceInputExtension`)

**Python (shotout, shotout-wrapper):**
- Module-level constants: SCREAMING_SNAKE_CASE (`PIDFILE`, `AUDIOFILE`, `KEYFILE`, `STATUS_FILE`, `TAIL_DELAY`, `MAX_RECORDING_SECS`)
- Functions: snake_case (`get_api_key`, `start_recording`, `stop_and_transcribe`, `write_status`, `cleanup_temp_files`, `kill_sox`, `write_stats`, `run_watchdog`, `main`)
- Type annotations on function parameters in `shotout-wrapper` (e.g., `def write_status(status: str) -> None`)
- Local variables: snake_case (`duration_secs`, `today`, `api_key`)

**Bash (install.sh):**
- Local variables and loop variables: lowercase snake_case (`cmd`, `pkg`, `ans`, `api_key`, `replace_key`)
- Constants/paths: SCREAMING_SNAKE_CASE (`REPO_URL`, `EXT_UUID`, `EXT_DIR`, `BIN_DIR`, `RED`, `GREEN`)
- Helper functions: lowercase (`info`, `success`, `warn`, `die`, `check_cmd`)

## Code Style

**JavaScript:**
- 4-space indentation throughout `extension.js`
- Single quotes for strings
- No trailing semicolons are absent — semicolons ARE used consistently
- Arrow functions used for callbacks (`() => { ... }`)
- Template literals used for string interpolation (`` `${m}:${s}` ``)
- Object properties without quotes where valid (`{reactive: false, can_focus: false}`)
- Opening braces on same line as block statements
- Method chaining on new lines where multiple calls follow (`.ease({ ... })`)

**Python:**
- 4-space indentation throughout
- Type annotations on function signatures in `shotout-wrapper` but not in `shotout` (inconsistent between files)
- `pathlib.Path` used in `shotout-wrapper`, but raw `os.path` used in `shotout` (inconsistent)
- Module docstrings at top of each Python file (triple-quoted)
- f-strings for string interpolation (`f"API key not found. Put it in {KEYFILE}"`)
- Bare `except Exception:` used sparingly (in stats read and duration calculation)

**Bash:**
- 4-space indentation
- `set -euo pipefail` for strict error handling
- Local variables declared with `local` inside functions
- `[[ ... ]]` double brackets for conditionals
- ANSI color constants for terminal output formatting

## Module Organization

**JavaScript (extension.js):**
- All `import` statements at top of file (`gi://GObject`, `gi://St`, etc.)
- `gi://` URI scheme for GNOME introspection imports
- `resource:///` URI scheme for GNOME Shell UI module imports
- Single file: no module splitting; the `VoiceIndicator` class and `VoiceInputExtension` class both live in `extension.js`
- No default exports for `VoiceIndicator` — it is used internally only
- `VoiceInputExtension` exported as the default export (required by GNOME Shell)

**Python:**
- Standard library imports only (no third-party at the top); `groq` import is deferred inside a function (`from groq import Groq` inside `stop_and_transcribe`)
- `shotout-wrapper` uses `from pathlib import Path` and `from datetime import date`
- `if __name__ == "__main__":` guard in both Python scripts

## Error Handling

**JavaScript:**
- `try { ... } catch (_e) {}` — errors silently swallowed with underscore-prefixed ignored variable
- Pattern used consistently for all file I/O in `_readStatus`, `_readLimit`, `_readStats`, `_cancelRecording`
- No user-facing error display from the extension; errors degrade silently

**Python (shotout):**
- Bare `except Exception as e:` in `stop_and_transcribe` — catches all errors, logs to stderr with `print(f"Error: {e}", file=sys.stderr)`, and shows a desktop notification via `notify-send`
- `try / except ProcessLookupError` for `os.kill` (specific exception, correct)
- `finally` block ensures `AUDIOFILE` cleanup even on errors

**Python (shotout-wrapper):**
- `except (OSError, ValueError, ProcessLookupError):` with `pass` — silent failure for process management
- `except Exception: pass` for JSON stats parse errors (silent, safe default)
- `try / except OSError: pass` pattern repeated for all file writes
- `finally` block in `main()` ensures `write_status("idle")` and `cleanup_temp_files()` always run

**Bash (install.sh):**
- `die()` function exits with code 1 on critical failure
- `warn()` for non-fatal issues
- `check_cmd` accumulates missing packages into `MISSING` array, continues execution
- `2>/dev/null` used to suppress stderr from optional commands

## Comments and Documentation

**Python:**
- Module-level docstring in triple quotes at the top of each file describing purpose and behavior
- Inline comments with `#` for non-obvious logic (e.g., `# wl-copy writes to the native Wayland clipboard`)
- Docstring on `kill_sox` and `run_watchdog` functions in `shotout-wrapper`
- No docstrings on other functions

**JavaScript:**
- Section-divider comments with box-drawing characters to group methods:
  ```
  // ── Cancel on click during recording ────────────────────────────────────
  // ── Menu ────────────────────────────────────────────────────────────────
  // ── Warning pulse ────────────────────────────────────────────────────────
  // ── Polling ──────────────────────────────────────────────────────────────
  ```
- Inline comments for non-obvious choices (e.g., `// Status intentionally stays "recording" until next invocation`)
- No JSDoc annotations anywhere

**Bash:**
- Section-divider comments with box-drawing characters and step numbers:
  ```
  # ── 1. Check dependencies ─────────────────────────────────────────────────────
  # ── 2. Install groq Python package ───────────────────────────────────────────
  ```
- Inline comments on non-obvious commands

## Notable Patterns

**File-based IPC:** The extension and Python scripts communicate exclusively through `/tmp/` sentinel files:
- `/tmp/shotout.pid` — presence indicates active recording
- `/tmp/shotout-status` — polled every 500ms by extension
- `/tmp/shotout-limit` — passes recording limit to extension for warning pulse
- `/tmp/shotout-cancel` — written by extension to signal user cancellation

**Polling over events:** The GNOME extension polls `/tmp/shotout-status` every 500ms (`POLL_INTERVAL_MS`) rather than using signals or D-Bus, making the architecture stateless and decoupled.

**State machine in extension:** `_status` field tracks one of `'idle'`, `'recording'`, `'recognizing'`. Transitions are detected by comparing polled value to `this._status`.

**Deferred import pattern:** `from groq import Groq` is imported inside the function body in `shotout` to avoid a hard import error when the package is not installed (allows the script to run the `start_recording` path without needing the SDK).

**Watchdog subprocess:** `shotout-wrapper` spawns itself with `--watchdog` flag as a detached background process (`start_new_session=True`, `close_fds=True`) to handle auto-cancel and time-limit enforcement independently of the main invocation.

**Graceful animation abort:** The `_abortCancelAnimation` method in the extension guards against state corruption when a new recording starts while the cancel feedback animation is still playing.

---

*Convention analysis: 2026-05-15*
