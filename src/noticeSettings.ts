// Reads the player's notice settings and decides which "round ready" notices
// show. Pure: no `vscode` import, so it can be unit-tested with `node --test`.
//
// The settings live in VS Code's own settings (contributed in package.json)
// and are never copied to `globalState`. VS Code merges the user and
// workspace values before they reach here, so a workspace value overrides the
// user's. A value typed into settings.json isn't checked by VS Code, so every
// value is checked here, and an invalid one gets that setting's default.

import { NoticeChange } from "./agentSignals.ts";

/** What happens when an agent starts working. */
export const AutoStartMode = {
  /** Show nothing. The default, so a fresh install stays quiet. */
  Off: "off",
  /** Show the notices the player has switched on. */
  Notify: "notify",
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
} as const;
export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

/** The notice settings, checked. */
export interface NoticeSettings {
  readonly mode: AutoStartMode;
  readonly badge: boolean;
  readonly statusBar: boolean;
  readonly popup: boolean;
}

/** Each setting's default, the same as in package.json. */
export const DEFAULT_NOTICE_SETTINGS: NoticeSettings = {
  mode: AutoStartMode.Off,
  badge: true,
  statusBar: true,
  popup: false,
};

/** The modes a setting may hold. `open` comes later (#111). */
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
  };
}

/** `value` if it's a boolean, otherwise `fallback`. */
function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** The notices that stay up while the agent works. */
export interface VisibleNotices {
  readonly badge: boolean;
  readonly statusBar: boolean;
}

/**
 * Which lasting notices show: only while the agent is working, only in
 * `notify` mode, and only those switched on. Called after every signal and
 * every settings change, so a change applies straight away.
 */
export function visibleNotices(working: boolean, settings: NoticeSettings): VisibleNotices {
  const on = working && settings.mode === AutoStartMode.Notify;
  return { badge: on && settings.badge, statusBar: on && settings.statusBar };
}

/**
 * Whether to show the pop-up after a signal: only when the agent has just
 * started (not on a repeated start while it's still working), in `notify`
 * mode, with the pop-up switched on. So it shows at most once per run, and a
 * settings change never shows it.
 */
export function showPopup(change: NoticeChange | null, settings: NoticeSettings): boolean {
  return change === NoticeChange.Show && settings.mode === AutoStartMode.Notify && settings.popup;
}
