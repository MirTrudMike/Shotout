---
slug: cancel-click-broken
status: resolved
trigger: manual
goal: find_and_fix
tdd_mode: false
specialist_dispatch_enabled: false
created: 2026-05-15
resolved: 2026-05-15
---

# Debug Session: Cancel-on-click broken after Fedora update

## Symptoms

- GNOME Shell extension `shotout@local` on Fedora (GNOME Shell 47+, confirmed 50.1)
- During recording, clicking the panel icon should cancel the recording
- After system update: click opens popup menu with stats instead of canceling
- Two fixes already attempted and failed:
  1. `vfunc_button_press_event` override — never fires in GNOME 47+
  2. `vfunc_event` with `BUTTON_PRESS` check — menu still opens, cancel still doesn't fire

## Current Focus

### Hypothesis (CONFIRMED)
GNOME Shell 47+ (confirmed in 50.1) replaced the event-based click handling in
`PanelMenu.Button` with a `Clutter.ClickGesture` added via `add_action()`.

Key code from gnome-shell main branch (`js/ui/panelMenu.js`, class `PanelMenuButton`):
```js
this._clickGesture = new Clutter.ClickGesture();
this._clickGesture.set_recognize_on_press(true);
this._clickGesture.connect('recognize', () => {
    this.menu?.toggle();
});
this._clickGesture.set_enabled(!dontCreateMenu);
this.add_action(this._clickGesture);
```

Clutter gesture-actions are evaluated **before** `vfunc_event` and
`vfunc_button_press_event` in the event dispatch chain. This means:
- Any subclass override of those virtual functions receives the event only AFTER
  the gesture has already recognized and fired `menu.toggle()`.
- For a `BUTTON_PRESS` event: the gesture fires `recognize` → `menu.toggle()`
  → menu opens. Then the event propagates, but it's too late.

### Why both previous fixes failed
1. `vfunc_button_press_event`: gesture-actions are resolved before C-level vfuncs
2. `vfunc_event`: same reason — gesture-action fires first, menu opens, then
   `vfunc_event` is called, but the menu is already open

## Evidence

- GNOME Shell version: 50.1 (Fedora 44)
- Source confirmed via: https://gitlab.gnome.org/GNOME/gnome-shell/-/raw/main/js/ui/panelMenu.js
- `PanelMenuButton._init()` uses `Clutter.ClickGesture` + `add_action()`
- `set_recognize_on_press(true)` means the gesture fires on BUTTON_PRESS, not BUTTON_RELEASE

## Investigation Log

### Attempt 1 — vfunc_button_press_event
- Result: Never fires in GNOME Shell 47+
- Conclusion: PanelMenu.Button handles clicks via gesture-action at lower level

### Attempt 2 — vfunc_event with BUTTON_PRESS + TOUCH_BEGIN check
- Code added before super.vfunc_event() call
- Result: Menu still opens, cancel still doesn't fire
- Conclusion: Gesture-action fires BEFORE vfunc_event — vfunc_event is reached
  only after menu.toggle() has already executed

### Attempt 3 — Connect to _clickGesture 'recognize' signal (APPLIED)
- Strategy: After `super._init()`, connect to `this._clickGesture.connect('recognize', ...)`
- When recording: call `_cancelRecording()`, then temporarily disable the gesture
  via `set_enabled(false)` so the built-in handler (menu.toggle) is skipped
- Re-enable gesture on next idle tick via `GLib.idle_add()`
- This intercepts the click at the gesture level — before menu.toggle() fires

## Resolution

root_cause: >
  GNOME Shell 47+ replaced vfunc_event-based click handling in PanelMenu.Button
  with a Clutter.ClickGesture added via add_action(). Gesture-actions are
  evaluated before virtual function dispatch, so vfunc_button_press_event and
  vfunc_event receive the event only after menu.toggle() has already executed.

fix: >
  Connect to this._clickGesture 'recognize' signal in VoiceIndicator._init().
  When _status === 'recording', call _cancelRecording() and temporarily disable
  the gesture (set_enabled(false)) so menu.toggle() is skipped. Re-enable on
  next GLib idle tick to restore normal behavior for non-recording clicks.
  File: /home/mirtrudmike/Projects/groq-voice/extension/extension.js
