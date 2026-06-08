# Testing

**Analysis Date:** 2026-05-15

## Test Coverage

No automated tests exist anywhere in the project. The codebase has zero test files.

Every component — the GNOME Shell extension (`extension/extension.js`), the recording script (`scripts/shotout`), and the wrapper/watchdog (`scripts/shotout-wrapper`) — is entirely untested by automated means.

## Test Framework

No test framework is present or configured:
- No `jest.config.*`, `vitest.config.*`, `mocha.*`, or any JS test runner config
- No `pytest.ini`, `pyproject.toml`, `setup.cfg`, or `tox.ini`
- No `package.json` (no npm/Node project at all)
- No test runner scripts in `install.sh` or any other entry point
- No CI configuration (no `.github/workflows/`, no `.gitlab-ci.yml`)

## Test Types

**Unit tests:** None
**Integration tests:** None
**End-to-end tests:** None
**Manual testing only:** The project is designed to be exercised manually — install, assign a hotkey, press it, verify behavior visually.

## Test Files

No test files exist anywhere in the repository:

```
find /home/mirtrudmike/Projects/groq-voice -name "*.test.*" -o -name "*.spec.*"
# → (no output)
```

There is no `tests/` or `__tests__/` directory.

## Testing Gaps

Every part of the system lacks test coverage. Prioritized by risk:

**High priority:**

- **`scripts/shotout` — `stop_and_transcribe()`** (`scripts/shotout`): The core transcription path (file read, Groq API call, clipboard write via `wl-copy`, key injection via `ydotool`) is entirely untested. Failures here produce silent errors visible only in a desktop notification.

- **`scripts/shotout-wrapper` — `run_watchdog()`** (`scripts/shotout-wrapper`): The cancel detection loop and auto-stop logic poll filesystem state with `time.sleep(1)`. Race conditions between the watchdog and the main invocation are untested.

- **`scripts/shotout-wrapper` — `main()`** (`scripts/shotout-wrapper`): The toggle logic (start vs. stop path) depends on presence of `PIDFILE`. Edge cases (e.g., stale PID file, cancelled during tail delay) are untested.

- **`scripts/shotout-wrapper` — `write_stats()`** (`scripts/shotout-wrapper`): JSON stats persistence logic (date keying, accumulation, directory creation) has no assertions. A malformed stats file silently resets all history.

**Medium priority:**

- **`extension/extension.js` — `_poll()`**: State machine transitions (`idle → recording → recognizing → idle`) and the cancel animation abort path have no tests. GNOME Shell extensions cannot be unit-tested without a GObject mock environment, which would require significant setup (e.g., using `gjs` with mocked `GLib`, `St`, `Clutter`).

- **`extension/extension.js` — `_formatDuration()`**: Pure function with clear input/output contract — trivially testable with a JS unit test runner. Not tested.

- **`extension/extension.js` — `_updateMenu()`**: Stats aggregation logic (per-day totals, per-month rollup) is pure enough to test with mocked `_readStats()` return values.

- **`scripts/shotout` — `get_api_key()`** (`scripts/shotout`): Priority fallback (env var → key file → exception) is untested. Straightforward to unit test with `monkeypatch`/`tmp_path` in pytest.

**Low priority:**

- **`install.sh`**: Bash installer is not tested. Integration-testing installer scripts requires a disposable environment (container or VM). Risk is limited because failures are visible immediately during manual installation.

- **`scripts/shotout` — `start_recording()`** (`scripts/shotout`): Spawns `sox` subprocess; requires system audio device. Meaningful only with integration/mock subprocess testing.

---

*Testing analysis: 2026-05-15*
