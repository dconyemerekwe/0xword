import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AgentSignal, AgentState, NoticeChange, RoundReadyNotice } from "../src/agentSignals.ts";
import {
  AutoStartMode,
  DEFAULT_NOTICE_SETTINGS,
  MAX_DELAY_SECONDS,
  SettingKey,
  agentStateFor,
  readNoticeSettings,
  showPopup,
  tellAgentFinished,
  tellAgentStarted,
  visibleNotices,
  type NoticeSettings,
  type VisibleNotices,
} from "../src/noticeSettings.ts";

/** A `get` that returns `values[key]`, and undefined for a setting not given. */
function getter(values: Partial<Record<SettingKey, unknown>>): (key: SettingKey) => unknown {
  return (key) => values[key];
}

/** The settings in `notify` mode, with the given notices changed. */
function notify(changes: Partial<NoticeSettings> = {}): NoticeSettings {
  return { ...DEFAULT_NOTICE_SETTINGS, mode: AutoStartMode.Notify, ...changes };
}

const NONE: VisibleNotices = { badge: false, statusBar: false };

describe("readNoticeSettings", () => {
  it("uses the defaults when nothing is set: off, badge on, status bar on, pop-up off, a 20-second delay", () => {
    assert.deepEqual(readNoticeSettings(getter({})), {
      mode: AutoStartMode.Off,
      badge: true,
      statusBar: true,
      popup: false,
      delaySeconds: 20,
    });
  });

  it("keeps every valid value", () => {
    const settings = readNoticeSettings(
      getter({
        [SettingKey.Mode]: "notify",
        [SettingKey.Badge]: false,
        [SettingKey.StatusBar]: false,
        [SettingKey.Popup]: true,
        [SettingKey.DelaySeconds]: 45,
      }),
    );
    assert.deepEqual(settings, { mode: "notify", badge: false, statusBar: false, popup: true, delaySeconds: 45 });
  });

  it("keeps the open mode (#111)", () => {
    assert.equal(readNoticeSettings(getter({ [SettingKey.Mode]: "open" })).mode, AutoStartMode.Open);
  });

  it("reads each setting under its own key", () => {
    const asked: string[] = [];
    readNoticeSettings((key) => {
      asked.push(key);
      return undefined;
    });
    assert.deepEqual(asked.sort(), [
      "autoStart.delaySeconds",
      "autoStart.mode",
      "notify.badge",
      "notify.popup",
      "notify.statusBar",
    ]);
  });

  describe("keeps a valid delay (#111)", () => {
    const valid: readonly (readonly [string, number])[] = [
      ["0, which opens the panel at once", 0],
      ["1 second", 1],
      ["the default, 20", 20],
      ["a fraction", 2.5],
      ["the maximum, an hour", MAX_DELAY_SECONDS],
    ];
    for (const [name, value] of valid) {
      it(name, () => {
        assert.equal(readNoticeSettings(getter({ [SettingKey.DelaySeconds]: value })).delaySeconds, value);
      });
    }

    it("with an hour as the maximum", () => {
      assert.equal(MAX_DELAY_SECONDS, 3600);
    });
  });

  describe("uses 20 for an invalid delay (#111)", () => {
    const invalid: readonly (readonly [string, unknown])[] = [
      ["a negative number", -1],
      ["a small negative fraction", -0.5],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["just over the maximum", MAX_DELAY_SECONDS + 1],
      ["a huge number", Number.MAX_VALUE],
      ['a numeric string, "30"', "30"],
      ["the empty string", ""],
      ["a boolean", true],
      ["null", null],
      ["an array", [30]],
      ["an object", { seconds: 30 }],
    ];
    for (const [name, value] of invalid) {
      it(name, () => {
        assert.equal(readNoticeSettings(getter({ [SettingKey.DelaySeconds]: value })).delaySeconds, 20);
      });
    }
  });

  describe("uses the default for an invalid mode", () => {
    const invalid: readonly (readonly [string, unknown])[] = [
      ["open in another letter case", "Open"],
      ["an unknown word", "loud"],
      ["__proto__", "__proto__"],
      ["constructor", "constructor"],
      ["toString", "toString"],
      ["another letter case", "Notify"],
      ["surrounding spaces", " notify "],
      ["the empty string", ""],
      ["a number", 1],
      ["a boolean", true],
      ["null", null],
      ["an array", ["notify"]],
      ["an object", { mode: "notify" }],
    ];
    for (const [name, value] of invalid) {
      it(name, () => {
        assert.equal(readNoticeSettings(getter({ [SettingKey.Mode]: value })).mode, AutoStartMode.Off);
      });
    }
  });

  describe("uses the default for an invalid on/off value", () => {
    const invalid: readonly (readonly [string, unknown])[] = [
      ['the string "true"', "true"],
      ['the string "false"', "false"],
      ["a number", 0],
      ["one", 1],
      ["null", null],
      ["an array", [false]],
      ["an object", {}],
    ];
    for (const [name, value] of invalid) {
      it(name, () => {
        const settings = readNoticeSettings(
          getter({ [SettingKey.Badge]: value, [SettingKey.StatusBar]: value, [SettingKey.Popup]: value }),
        );
        assert.equal(settings.badge, true);
        assert.equal(settings.statusBar, true);
        assert.equal(settings.popup, false);
      });
    }
  });

  it("replaces only the invalid setting and keeps the valid ones", () => {
    const settings = readNoticeSettings(
      getter({
        [SettingKey.Mode]: "notify",
        [SettingKey.Badge]: "no",
        [SettingKey.StatusBar]: false,
        [SettingKey.Popup]: true,
      }),
    );
    assert.deepEqual(settings, { mode: "notify", badge: true, statusBar: false, popup: true, delaySeconds: 20 });
  });

  it("never throws, even for a very long string", () => {
    const long = "x".repeat(100_000);
    assert.deepEqual(
      readNoticeSettings(getter({ [SettingKey.Mode]: long, [SettingKey.Badge]: long })),
      DEFAULT_NOTICE_SETTINGS,
    );
  });
});

describe("visibleNotices", () => {
  it("shows nothing on a fresh install, even while the agent works", () => {
    assert.deepEqual(visibleNotices(true, DEFAULT_NOTICE_SETTINGS), NONE);
  });

  it("shows nothing in off mode, whatever is switched on", () => {
    const all = { mode: AutoStartMode.Off, badge: true, statusBar: true, popup: true, delaySeconds: 20 };
    assert.deepEqual(visibleNotices(true, all), NONE);
  });

  it("shows nothing in open mode, whatever is switched on: opening the panel is the signal (#111)", () => {
    const all = { mode: AutoStartMode.Open, badge: true, statusBar: true, popup: true, delaySeconds: 20 };
    assert.deepEqual(visibleNotices(true, all), NONE);
    assert.deepEqual(visibleNotices(false, all), NONE);
  });

  it("shows the badge and status bar by default in notify mode while the agent works", () => {
    assert.deepEqual(visibleNotices(true, notify()), { badge: true, statusBar: true });
  });

  it("shows nothing in notify mode while the agent isn't working", () => {
    assert.deepEqual(visibleNotices(false, notify({ popup: true })), NONE);
  });

  it("shows only the badge when the status bar is off", () => {
    assert.deepEqual(visibleNotices(true, notify({ statusBar: false })), { badge: true, statusBar: false });
  });

  it("shows only the status bar when the badge is off", () => {
    assert.deepEqual(visibleNotices(true, notify({ badge: false })), { badge: false, statusBar: true });
  });

  it("shows nothing lasting when both are off", () => {
    assert.deepEqual(visibleNotices(true, notify({ badge: false, statusBar: false, popup: true })), NONE);
  });
});

describe("showPopup", () => {
  it("shows when the agent has just started, in notify mode, with the pop-up on", () => {
    assert.equal(showPopup(NoticeChange.Show, notify({ popup: true })), true);
  });

  it("doesn't show with the pop-up off, its default", () => {
    assert.equal(showPopup(NoticeChange.Show, notify()), false);
  });

  it("doesn't show in off mode, even with the pop-up on", () => {
    assert.equal(showPopup(NoticeChange.Show, { ...DEFAULT_NOTICE_SETTINGS, popup: true }), false);
  });

  it("doesn't show in open mode, even with the pop-up on (#111)", () => {
    assert.equal(showPopup(NoticeChange.Show, { ...DEFAULT_NOTICE_SETTINGS, mode: AutoStartMode.Open, popup: true }), false);
  });

  it("doesn't show on a repeated start, a finish or a link that isn't a signal", () => {
    for (const change of [null, NoticeChange.Hide]) {
      assert.equal(showPopup(change, notify({ popup: true })), false, String(change));
    }
  });
});

describe("tellAgentFinished (#112)", () => {
  const open: NoticeSettings = { ...DEFAULT_NOTICE_SETTINGS, mode: AutoStartMode.Open };

  it("tells the panel when a run has just finished, in notify mode", () => {
    assert.equal(tellAgentFinished(NoticeChange.Hide, notify()), true);
  });

  it("tells the panel when a run has just finished, in open mode", () => {
    assert.equal(tellAgentFinished(NoticeChange.Hide, open), true);
  });

  it("tells the panel in notify mode even with every notice switched off", () => {
    assert.equal(tellAgentFinished(NoticeChange.Hide, notify({ badge: false, statusBar: false, popup: false })), true);
  });

  it("never tells the panel in off mode, the default", () => {
    assert.equal(tellAgentFinished(NoticeChange.Hide, DEFAULT_NOTICE_SETTINGS), false);
  });

  it("doesn't tell the panel on a start, a finish with no run in progress, or a link that isn't a signal", () => {
    for (const settings of [notify(), open]) {
      for (const change of [NoticeChange.Show, null]) {
        assert.equal(tellAgentFinished(change, settings), false, `${settings.mode} ${String(change)}`);
      }
    }
  });

  it("tells the panel once per run: a repeated finish ends no run", () => {
    const notice = new RoundReadyNotice();
    const told = [AgentSignal.Started, AgentSignal.Finished, AgentSignal.Finished, AgentSignal.Finished].filter((signal) =>
      tellAgentFinished(notice.apply(signal), notify()),
    );
    assert.deepEqual(told, [AgentSignal.Finished]);
  });

  it("doesn't tell the panel on a finish before any start", () => {
    assert.equal(tellAgentFinished(new RoundReadyNotice().apply(AgentSignal.Finished), open), false);
  });
});

describe("tellAgentStarted (#112)", () => {
  const open: NoticeSettings = { ...DEFAULT_NOTICE_SETTINGS, mode: AutoStartMode.Open };

  it("tells the panel when a run has just started, in notify and open mode", () => {
    assert.equal(tellAgentStarted(NoticeChange.Show, notify()), true);
    assert.equal(tellAgentStarted(NoticeChange.Show, open), true);
  });

  it("tells the panel in notify mode even with every notice switched off", () => {
    assert.equal(tellAgentStarted(NoticeChange.Show, notify({ badge: false, statusBar: false, popup: false })), true);
  });

  it("never tells the panel in off mode, the default", () => {
    assert.equal(tellAgentStarted(NoticeChange.Show, DEFAULT_NOTICE_SETTINGS), false);
  });

  it("doesn't tell the panel on a finish, a repeated start or a link that isn't a signal", () => {
    for (const settings of [notify(), open]) {
      for (const change of [NoticeChange.Hide, null]) {
        assert.equal(tellAgentStarted(change, settings), false, `${settings.mode} ${String(change)}`);
      }
    }
  });

  it("tells the panel once per run: a repeated start starts no run", () => {
    const notice = new RoundReadyNotice();
    const signals = [AgentSignal.Started, AgentSignal.Started, AgentSignal.Finished, AgentSignal.Started, AgentSignal.Started];
    const told = signals.map((signal) => tellAgentStarted(notice.apply(signal), open));
    assert.deepEqual(told, [true, false, false, true, false]);
  });
});

/**
 * A run of signals and settings changes, as extension.ts applies them: after
 * each step, the lasting notices to show and whether a pop-up opened.
 */
class Run {
  readonly #notice = new RoundReadyNotice();
  #settings: NoticeSettings;
  popups = 0;

  constructor(settings: NoticeSettings) {
    this.#settings = settings;
  }

  signal(signal: AgentSignal): VisibleNotices {
    const change = this.#notice.apply(signal);
    if (showPopup(change, this.#settings)) {
      this.popups += 1;
    }
    return visibleNotices(this.#notice.showing, this.#settings);
  }

  change(settings: NoticeSettings): VisibleNotices {
    this.#settings = settings;
    return visibleNotices(this.#notice.showing, this.#settings);
  }
}

describe("a run with live settings changes", () => {
  it("shows the notices on start and removes them on finish", () => {
    const run = new Run(notify({ popup: true }));
    assert.deepEqual(run.signal(AgentSignal.Started), { badge: true, statusBar: true });
    assert.deepEqual(run.signal(AgentSignal.Finished), NONE);
    assert.equal(run.popups, 1);
  });

  it("shows nothing for a whole run in off mode", () => {
    const run = new Run(DEFAULT_NOTICE_SETTINGS);
    assert.deepEqual(run.signal(AgentSignal.Started), NONE);
    assert.deepEqual(run.signal(AgentSignal.Finished), NONE);
    assert.equal(run.popups, 0);
  });

  it("shows the pop-up once per run, not again on a repeated start", () => {
    const run = new Run(notify({ popup: true }));
    run.signal(AgentSignal.Started);
    run.signal(AgentSignal.Started);
    assert.equal(run.popups, 1);
  });

  it("shows the pop-up again on the next run", () => {
    const run = new Run(notify({ popup: true }));
    for (const signal of [AgentSignal.Started, AgentSignal.Finished, AgentSignal.Started]) {
      run.signal(signal);
    }
    assert.equal(run.popups, 2);
  });

  it("shows the notices straight away on switching from off to notify mid-run, and hides them on switching back", () => {
    const run = new Run(DEFAULT_NOTICE_SETTINGS);
    assert.deepEqual(run.signal(AgentSignal.Started), NONE);
    assert.deepEqual(run.change(notify()), { badge: true, statusBar: true });
    assert.deepEqual(run.change(DEFAULT_NOTICE_SETTINGS), NONE);
  });

  it("hides the status bar straight away when it's turned off mid-run", () => {
    const run = new Run(notify());
    run.signal(AgentSignal.Started);
    assert.deepEqual(run.change(notify({ statusBar: false })), { badge: true, statusBar: false });
    assert.deepEqual(run.change(notify()), { badge: true, statusBar: true });
  });

  it("hides the badge straight away when it's turned off mid-run", () => {
    const run = new Run(notify());
    run.signal(AgentSignal.Started);
    assert.deepEqual(run.change(notify({ badge: false })), { badge: false, statusBar: true });
  });

  it("clears every notice when off is chosen mid-run", () => {
    const run = new Run(notify({ popup: true }));
    run.signal(AgentSignal.Started);
    assert.deepEqual(run.change({ ...notify({ popup: true }), mode: AutoStartMode.Off }), NONE);
  });

  it("never shows the pop-up from a settings change, even turning it on mid-run", () => {
    const run = new Run(DEFAULT_NOTICE_SETTINGS);
    run.signal(AgentSignal.Started);
    run.change(notify({ popup: true }));
    run.signal(AgentSignal.Started);
    assert.equal(run.popups, 0);
  });

  it("shows nothing after a settings change while the agent isn't working", () => {
    const run = new Run(DEFAULT_NOTICE_SETTINGS);
    assert.deepEqual(run.change(notify({ popup: true })), NONE);
    assert.equal(run.popups, 0);
  });

  it("changes nothing on a finish with nothing showing", () => {
    const run = new Run(notify({ popup: true }));
    assert.deepEqual(run.signal(AgentSignal.Finished), NONE);
    assert.equal(run.popups, 0);
  });
});

describe("agentStateFor: the line under the result card (#121)", () => {
  const open: NoticeSettings = { ...DEFAULT_NOTICE_SETTINGS, mode: AutoStartMode.Open };
  const off: NoticeSettings = DEFAULT_NOTICE_SETTINGS;

  it("says working after a start, in notify and open mode", () => {
    for (const settings of [notify(), open]) {
      assert.equal(agentStateFor(AgentSignal.Started, settings), AgentState.Working, settings.mode);
    }
  });

  it("says finished after a finish, in notify and open mode", () => {
    for (const settings of [notify(), open]) {
      assert.equal(agentStateFor(AgentSignal.Finished, settings), AgentState.Finished, settings.mode);
    }
  });

  it("shows no line in off mode, the default, whatever the last signal", () => {
    for (const signal of [AgentSignal.Started, AgentSignal.Finished, null]) {
      assert.equal(agentStateFor(signal, off), AgentState.None, String(signal));
    }
  });

  it("shows no line before any signal since VS Code started, in every mode", () => {
    for (const settings of [notify(), open, off]) {
      assert.equal(agentStateFor(null, settings), AgentState.None, settings.mode);
    }
  });

  it("follows the notices' switches not at all: notify with every notice off still shows the line", () => {
    assert.equal(agentStateFor(AgentSignal.Started, notify({ badge: false, statusBar: false, popup: false })), AgentState.Working);
  });

  it("follows a mode change mid-run: notify to off hides the line, and back to notify or open shows it again", () => {
    const notice = new RoundReadyNotice();
    notice.apply(AgentSignal.Started);
    const states = [notify(), off, notify(), open].map((settings) => agentStateFor(notice.lastSignal, settings));
    assert.deepEqual(states, [AgentState.Working, AgentState.None, AgentState.Working, AgentState.Working]);
  });

  it("goes from link to line end to end: start, finish, start again", () => {
    const notice = new RoundReadyNotice();
    const states = [AgentSignal.Started, AgentSignal.Finished, AgentSignal.Started].map((signal) => {
      notice.apply(signal);
      return agentStateFor(notice.lastSignal, notify());
    });
    assert.deepEqual(states, [AgentState.Working, AgentState.Finished, AgentState.Working]);
  });
});

describe("the settings reader is pure", () => {
  it("has no vscode import and imports only the pure link reader", () => {
    const source = readFileSync(new URL("../src/noticeSettings.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s*["']vscode["']/);
    assert.deepEqual(source.match(/^import\b.*$/gm), ['import { AgentSignal, AgentState, NoticeChange } from "./agentSignals.ts";']);
  });

  it("keeps nothing in globalState", () => {
    const source = readFileSync(new URL("../src/noticeSettings.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source.replace(/^\s*(\/\/|\*).*$/gm, ""), /globalState/);
  });
});
