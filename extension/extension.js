import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const STATUS_FILE = '/tmp/shotout-status';
const LIMIT_FILE  = '/tmp/shotout-limit';
const CANCEL_FILE = '/tmp/shotout-cancel';
const STATS_FILE  = GLib.get_home_dir() + '/.local/share/shotout/stats.json';
const WRAPPER_PATH = GLib.get_home_dir() + '/.local/bin/shotout-wrapper';
const POLL_INTERVAL_MS = 500;
const WARNING_SECS     = 10;   // start pulsing this many seconds before the limit

const LABEL_STYLE      = 'font-size: 13px; padding: 0 6px;';
const LABEL_STYLE_WARN = 'font-size: 13px; padding: 0 6px; color: #ff7700;';
const LABEL_STYLE_X    = 'font-size: 18px; padding: 0 6px; color: #cc4444;';
const LABEL_STYLE_ERR  = 'font-size: 13px; padding: 0 6px; color: #ff3333; font-weight: bold;';

const VoiceIndicator = GObject.registerClass(
class VoiceIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'ShotOUT', false);

        this._label = new St.Label({
            text: '🎤',
            y_align: Clutter.ActorAlign.CENTER,
            style: LABEL_STYLE,
        });
        this.add_child(this._label);

        this._buildMenu();

        // ── Cancel on click during recording ────────────────────────────────
        // In GNOME Shell 47+ PanelMenu.Button uses a Clutter.ClickGesture
        // (with set_recognize_on_press) whose 'recognize' handler calls
        // menu.toggle() directly. The gesture fires before any vfunc_event
        // or vfunc_button_press_event override on the subclass, and
        // set_enabled(false) on the new Clutter.ClickGesture class does not
        // reliably prevent event consumption in GNOME Shell 48/50.
        // Intercepting menu.toggle() is the single reliable choke point:
        // whatever mechanism triggers the click, it always ends up here.
        const origToggle = this.menu.toggle.bind(this.menu);
        this.menu.toggle = () => {
            if (this._status === 'recording') {
                this._cancelRecording();
            } else {
                origToggle();
            }
        };

        this._status = 'idle';
        this._recordingStartSec = 0;
        this._recordingLimitSec = 5 * 60;
        this._pulsing = false;
        this._cancelAnimating = false;
        this._cancelHoldId = null;
        this._timeoutId = null;

        this.show();
    }

    vfunc_event(event) {
        if (this._status === 'recording' &&
            event.type() === Clutter.EventType.TOUCH_BEGIN) {
            this._cancelRecording();
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_event(event);
    }

    _cancelRecording() {
        try {
            GLib.file_set_contents(CANCEL_FILE, '1');
        } catch (_e) {}
        this._stopWarningPulse();
        this._showCancelFeedback();
    }

    _showCancelFeedback() {
        this._cancelAnimating = true;
        this._label.remove_all_transitions();
        this._label.opacity = 0;
        this._label.set_text('✗');
        this._label.style = LABEL_STYLE_X;

        // Fade in
        this._label.ease({
            opacity: 255,
            duration: 350,
            mode: Clutter.AnimationMode.EASE_OUT_SINE,
            onComplete: () => {
                // Hold, then fade out
                this._cancelHoldId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                    this._cancelHoldId = null;
                    this._label.ease({
                        opacity: 0,
                        duration: 700,
                        mode: Clutter.AnimationMode.EASE_IN_SINE,
                        onComplete: () => {
                            this._cancelAnimating = false;
                            this._label.remove_all_transitions();
                            this._label.opacity = 255;
                            this._label.set_text('🎤');
                            this._label.style = LABEL_STYLE;
                        },
                    });
                    return GLib.SOURCE_REMOVE;
                });
            },
        });
    }

    _abortCancelAnimation() {
        if (!this._cancelAnimating) return;
        this._cancelAnimating = false;
        if (this._cancelHoldId !== null) {
            GLib.source_remove(this._cancelHoldId);
            this._cancelHoldId = null;
        }
        this._label.remove_all_transitions();
        this._label.opacity = 255;
        this._label.style = LABEL_STYLE;
    }

    // ── Menu ────────────────────────────────────────────────────────────────

    _makeStatRow(labelText) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.style = 'opacity: 1;';

        const nameLabel = new St.Label({text: labelText, x_expand: true, style_class: 'dim-label'});
        const valueLabel = new St.Label({text: '—', style: 'font-weight: bold;'});

        item.add_child(nameLabel);
        item.add_child(valueLabel);
        return {item, valueLabel};
    }

    _buildMenu() {
        // ── Error actions — only visible when a transcription has failed ──────
        this._retryItem = new PopupMenu.PopupMenuItem('🔁 Retry transcription');
        this._retryItem.connect('activate', () => this._runWrapper(['--retry']));
        this.menu.addMenuItem(this._retryItem);

        this._discardItem = new PopupMenu.PopupMenuItem('🗑 Discard recording');
        this._discardItem.connect('activate', () => this._runWrapper(['--discard']));
        this.menu.addMenuItem(this._discardItem);

        this._errorSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._errorSeparator);

        this._setErrorMenuVisible(false);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('ShotOUT'));

        const todayRow = this._makeStatRow('Today');
        this._todayValue = todayRow.valueLabel;
        this.menu.addMenuItem(todayRow.item);

        const monthRow = this._makeStatRow('This month');
        this._monthValue = monthRow.valueLabel;
        this.menu.addMenuItem(monthRow.item);

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) this._updateMenu();
        });
    }

    _setErrorMenuVisible(visible) {
        this._retryItem.visible = visible;
        this._discardItem.visible = visible;
        this._errorSeparator.visible = visible;
    }

    _runWrapper(args) {
        try {
            Gio.Subprocess.new([WRAPPER_PATH, ...args], Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, 'ShotOUT: failed to run wrapper');
        }
        this.menu.close();
    }

    _readStats() {
        try {
            const file = Gio.File.new_for_path(STATS_FILE);
            const [ok, contents] = file.load_contents(null);
            if (ok) return JSON.parse(new TextDecoder().decode(contents));
        } catch (_e) {}
        return {};
    }

    _formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    _updateMenu() {
        const stats = this._readStats();
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const monthPrefix = today.slice(0, 7);

        const td = stats[today] || {requests: 0, seconds: 0};
        this._todayValue.set_text(`${td.requests} req · ${this._formatDuration(td.seconds)}`);

        let mReq = 0, mSec = 0;
        for (const [d, v] of Object.entries(stats)) {
            if (d.startsWith(monthPrefix)) { mReq += v.requests; mSec += v.seconds; }
        }
        this._monthValue.set_text(`${mReq} req · ${this._formatDuration(mSec)}`);
    }

    // ── Warning pulse ────────────────────────────────────────────────────────

    _startWarningPulse() {
        if (this._pulsing) return;
        this._pulsing = true;
        this._label.style = LABEL_STYLE_WARN;
        this._pulseStep(true);
    }

    _pulseStep(fadingOut) {
        if (!this._pulsing) {
            this._label.remove_all_transitions();
            this._label.opacity = 255;
            this._label.style = LABEL_STYLE;
            return;
        }
        this._label.ease({
            opacity: fadingOut ? 55 : 255,
            duration: 800,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            onComplete: () => this._pulseStep(!fadingOut),
        });
    }

    _stopWarningPulse() {
        if (!this._pulsing) return;
        this._pulsing = false;
        this._label.remove_all_transitions();
        this._label.opacity = 255;
        this._label.style = LABEL_STYLE;
    }

    // ── Polling ──────────────────────────────────────────────────────────────

    startPolling() {
        if (this._timeoutId !== null) return;
        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, POLL_INTERVAL_MS,
            () => { this._poll(); return GLib.SOURCE_CONTINUE; }
        );
    }

    stopPolling() {
        if (this._timeoutId !== null) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _readStatus() {
        try {
            const file = Gio.File.new_for_path(STATUS_FILE);
            const [ok, contents] = file.load_contents(null);
            if (ok) return new TextDecoder().decode(contents).trim();
        } catch (_e) {}
        return 'idle';
    }

    _readLimit() {
        try {
            const file = Gio.File.new_for_path(LIMIT_FILE);
            const [ok, contents] = file.load_contents(null);
            if (ok) return parseInt(new TextDecoder().decode(contents).trim(), 10);
        } catch (_e) {}
        return 5 * 60;
    }

    _resetLabelStyle() {
        this._label.remove_all_transitions();
        this._label.opacity = 255;
        this._label.style = LABEL_STYLE;
    }

    _poll() {
        const status = this._readStatus();

        if (status !== this._status) {
            this._status = status;

            if (status === 'recording') {
                // Always start clean, even if cancel animation was playing
                this._abortCancelAnimation();
                this._stopWarningPulse();
                this._resetLabelStyle();
                this._setErrorMenuVisible(false);
                this._recordingStartSec = GLib.get_real_time() / 1_000_000;
                this._recordingLimitSec = this._readLimit();
            } else {
                this._stopWarningPulse();
                // Don't interrupt cancel animation — it will restore 🎤 on its own
                if (!this._cancelAnimating) {
                    this._resetLabelStyle();
                    if (status === 'recognizing') {
                        this._label.set_text('⏳ RECOGNIZING');
                        this._setErrorMenuVisible(false);
                    } else if (status === 'error') {
                        // Transcription failed — keep the recording, offer retry/discard
                        this._label.set_text('⚠ FAILED');
                        this._label.style = LABEL_STYLE_ERR;
                        this._setErrorMenuVisible(true);
                    } else {
                        this._label.set_text('🎤');
                        this._setErrorMenuVisible(false);
                    }
                }
            }
        }

        if (this._status === 'recording') {
            const elapsed = Math.floor(GLib.get_real_time() / 1_000_000 - this._recordingStartSec);
            const remaining = this._recordingLimitSec - elapsed;

            if (remaining <= WARNING_SECS && !this._pulsing)
                this._startWarningPulse();

            const m = Math.floor(elapsed / 60);
            const s = (elapsed % 60).toString().padStart(2, '0');
            this._label.set_text(`🎙 ${m}:${s}`);
        }
    }

    destroy() {
        this._abortCancelAnimation();
        this._stopWarningPulse();
        this.stopPolling();
        super.destroy();
    }
});

export default class VoiceInputExtension {
    constructor(metadata) {
        this._metadata = metadata;
        this._indicator = null;
    }

    enable() {
        this._indicator = new VoiceIndicator();
        Main.panel.addToStatusArea('shotout-indicator', this._indicator);
        this._indicator.startPolling();
    }

    disable() {
        if (this._indicator) {
            this._indicator.stopPolling();
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
