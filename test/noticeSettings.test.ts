import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AgentSignal, NoticeChange, RoundReadyNotice } from "../src/agentSignals.ts";
import {
  AutoStartMode,
  DEFAULT_NOTICE_SETTINGS,
  SettingKey,
  readNoticeSettings,
  showPopup,
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
  it("uses the defaults when nothing is set: off, badge on, status bar on, pop-up off", () => {
    assert.deepEqual(readNoticeSettings(getter({})), {
      mode: AutoStartMode.Off,
      badge: true,
      statusBar: true,
      popup: false,
    });
  });

  it("keeps every valid value", () => {
    const settings = readNoticeSettings(
      getter({
        [SettingKey.Mode]: "notify",
        [SettingKey.Badge]: false,
        [SettingKey.StatusBar]: false,
        [SettingKey.Popup]: true,
      }),
    );
    assert.deepEqual(settings, { mode: "notify", badge: false, statusBar: false, popup: true });
  });

  it("reads each setting under its own key", () => {
    const asked: string[] = [];
    readNoticeSettings((key) => {
      asked.push(key);
      return undefined;
    });
    assert.deepEqual(asked.sort(), ["autoStart.mode", "notify.badge", "notify.popup", "notify.statusBar"]);
  });

  describe("uses the default for an invalid mode", () => {
    const invalid: readonly (readonly [string, unknown])[] = [
      ["open, which isn't built yet", "open"],
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
    assert.deepEqual(settings, { mode: "notify", badge: true, statusBar: false, popup: true });
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
    const all = { mode: AutoStartMode.Off, badge: true, statusBar: true, popup: true };
    assert.deepEqual(visibleNotices(true, all), NONE);
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

  it("doesn't show on a repeated start, a finish or a link that isn't a signal", () => {
    for (const change of [null, NoticeChange.Hide]) {
      assert.equal(showPopup(change, notify({ popup: true })), false, String(change));
    }
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

describe("the settings reader is pure", () => {
  it("has no vscode import and imports only the pure link reader", () => {
    const source = readFileSync(new URL("../src/noticeSettings.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s*["']vscode["']/);
    assert.deepEqual(source.match(/^import\b.*$/gm), ['import { NoticeChange } from "./agentSignals.ts";']);
  });

  it("keeps nothing in globalState", () => {
    const source = readFileSync(new URL("../src/noticeSettings.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source.replace(/^\s*(\/\/|\*).*$/gm, ""), /globalState/);
  });
});
