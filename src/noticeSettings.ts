// Reads the player's notice settings and decides which "round ready" notices
// show. Pure: no `vscode` import, so it can be unit-tested with `node --test`.
//
// The settings live in VS Code's own settings (contributed in package.json)
// and are never copied to `globalState`. VS Code merges the user and
// workspace values before they reach here, so a workspace value overrides the
// user's. A value typed into settings.json isn't checked by VS Code, so every
// value is checked here, and an invalid one gets that setting's default.

import { AgentSignal, AgentState, NoticeChange } from "./agentSignals.ts";

/** What happens when an agent starts working. */
export const AutoStartMode = {
  /** Show nothing. The default, so a fresh install stays quiet. */
  Off: "off",
  /** Show the notices the player has switched on. */
  Notify: "notify",
  /**
   * Open the panel once the agent has worked for `delaySeconds` (#111). The
   * notices show nothing: opening the panel is the signal.
   */
  Open: "open",
} as const;
export type AutoStartMode = (typeof AutoStartMode)[keyof typeof AutoStartMode];

/** The section every setting is under, as in `0xword.autoStart.mode`. */
export const SETTINGS_SECTION = "0xword";

/** Each setting's key inside the section. */
export const SettingKey = {
  Mode: "autoStart.mode",
  Badge: "notify.badge",
  StatusBar: "notify.statusBar",
  Popup: "notify.popup",
  DelaySeconds: "autoStart.delaySeconds",
} as const;
export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

/** The notice settings, checked. */
export interface NoticeSettings {
  readonly mode: AutoStartMode;
  readonly badge: boolean;
  readonly statusBar: boolean;
  readonly popup: boolean;
  /** In `open` mode, how long the agent works before the panel opens. 0 opens it at once. */
  readonly delaySeconds: number;
}

/**
 * The longest delay allowed, an hour: `minimum` and `maximum` in
 * package.json, so VS Code's settings editor shows the bounds. A longer one
 * typed into settings.json gets the default, like any invalid value.
 */
export const MAX_DELAY_SECONDS = 3600;

/** Each setting's default, the same as in package.json. */
export const DEFAULT_NOTICE_SETTINGS: NoticeSettings = {
  mode: AutoStartMode.Off,
  badge: true,
  statusBar: true,
  popup: false,
  delaySeconds: 20,
};

/** The modes a setting may hold. */
const MODES: ReadonlySet<unknown> = new Set(Object.values(AutoStartMode));

/** True if `value` is one of the modes. */
function isMode(value: unknown): value is AutoStartMode {
  return MODES.has(value);
}

/**
 * The settings from their raw values, as `get(key)` returns them. Each value
 * that isn't valid (a wrong type, null, missing, or a mode that doesn't
 * exist) is replaced by its default; the others are kept. Never throws.
 */
export function readNoticeSettings(get: (key: SettingKey) => unknown): NoticeSettings {
  const mode = get(SettingKey.Mode);
  return {
    mode: isMode(mode) ? mode : DEFAULT_NOTICE_SETTINGS.mode,
    badge: flag(get(SettingKey.Badge), DEFAULT_NOTICE_SETTINGS.badge),
    statusBar: flag(get(SettingKey.StatusBar), DEFAULT_NOTICE_SETTINGS.statusBar),
    popup: flag(get(SettingKey.Popup), DEFAULT_NOTICE_SETTINGS.popup),
    delaySeconds: delay(get(SettingKey.DelaySeconds)),
  };
}

/** `value` if it's a boolean, otherwise `fallback`. */
function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * `value` if it's a number from 0 to MAX_DELAY_SECONDS, otherwise the
 * default: a negative, `NaN`, infinite or too long delay, a numeric string
 * or any other type. A fraction is kept, as package.json allows one.
 */
function delay(value: unknown): number {
  return typeof value === "number" && value >= 0 && value <= MAX_DELAY_SECONDS
    ? value
    : DEFAULT_NOTICE_SETTINGS.delaySeconds;
}

/** The notices that stay up while the agent works. */
export interface VisibleNotices {
  readonly badge: boolean;
  readonly statusBar: boolean;
}

/**
 * Which lasting notices show: only while the agent is working, only in
 * `notify` mode (never in `off` or `open`), and only those switched on.
 * Called after every signal and every settings change, so a change applies
 * straight away.
 */
export function visibleNotices(working: boolean, settings: NoticeSettings): VisibleNotices {
  const on = working && settings.mode === AutoStartMode.Notify;
  return { badge: on && settings.badge, statusBar: on && settings.statusBar };
}

/**
 * Whether to show the pop-up after a signal: only when the agent has just
 * started (not on a repeated start while it's still working), in `notify`
 * mode (never in `off` or `open`), with the pop-up switched on. So it shows
 * at most once per run, and a settings change never shows it.
 */
export function showPopup(change: NoticeChange | null, settings: NoticeSettings): boolean {
  return change === NoticeChange.Show && settings.mode === AutoStartMode.Notify && settings.popup;
}

/**
 * Whether to tell the panel the agent has finished (#112): only when a
 * signal has just ended a run (not on a repeated finish with no run in
 * progress), in `notify` or `open` mode (never in `off`). The webview then
 * decides whether a round is in progress to show it on.
 */
export function tellAgentFinished(change: NoticeChange | null, settings: NoticeSettings): boolean {
  return change === NoticeChange.Hide && settings.mode !== AutoStartMode.Off;
}

/**
 * Whether to tell the panel the agent has started (#112), so it clears a
 * "finished" message left from the last run: only when a signal has just
 * started a run (not on a repeated start while it works), in `notify` or
 * `open` mode (never in `off`).
 */
export function tellAgentStarted(change: NoticeChange | null, settings: NoticeSettings): boolean {
  return change === NoticeChange.Show && settings.mode !== AutoStartMode.Off;
}

/**
 * What the line under the result card says (#121), from the last signal
 * since VS Code started (`RoundReadyNotice.lastSignal`) and the mode as it is
 * now: nothing in `off` mode or before any signal, otherwise "working" after
 * `started` and "finished" after `finished`. Worked out again after every
 * signal and every settings change, so a mode change applies straight away.
 */
export function agentStateFor(lastSignal: AgentSignal | null, settings: Pick<NoticeSettings, "mode">): AgentState {
  if (settings.mode === AutoStartMode.Off || lastSignal === null) {
    return AgentState.None;
  }
  return lastSignal === AgentSignal.Started ? AgentState.Working : AgentState.Finished;
}
