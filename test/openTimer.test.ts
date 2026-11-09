import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AgentSignal, readAgentSignal } from "../src/agentSignals.ts";
import { AutoStartMode, DEFAULT_NOTICE_SETTINGS, SettingKey, readNoticeSettings } from "../src/noticeSettings.ts";
import { OpenTimer, type OpenSettings, type Schedule } from "../src/openTimer.ts";

/** A clock that only moves when told to. */
class FakeClock {
  now = 0;
  /** Every callback scheduled, with when it's due and whether it was cancelled. */
  readonly timers: { due: number; milliseconds: number; callback: () => void; cancelled: boolean; fired: boolean }[] = [];

  readonly schedule: Schedule = (callback, milliseconds) => {
    const timer = { due: this.now + milliseconds, milliseconds, callback, cancelled: false, fired: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };

  /** Moves the clock on by `seconds`, running each callback that comes due and wasn't cancelled. */
  advance(seconds: number): void {
    this.now += seconds * 1000;
    for (const timer of this.timers) {
      if (!timer.cancelled && !timer.fired && timer.due <= this.now) {
        timer.fired = true;
        timer.callback();
      }
    }
  }

  /** Timers still due to run. */
  get live(): number {
    return this.timers.filter((timer) => !timer.cancelled && !timer.fired).length;
  }
}

/** A timer over a fake clock that counts how many times it opened the panel. */
function setUp(): { clock: FakeClock; timer: OpenTimer; opens: () => number } {
  const clock = new FakeClock();
  let opens = 0;
  const timer = new OpenTimer(clock.schedule, () => {
    opens++;
  });
  return { clock, timer, opens: () => opens };
}

function open(delaySeconds = 20): OpenSettings {
  return { mode: AutoStartMode.Open, delaySeconds };
}

const { Started, Finished } = AgentSignal;

describe("OpenTimer: the delay (#111)", () => {
  it("opens the panel when the agent is still working 20 seconds after it started", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open());
    clock.advance(19.999);
    assert.equal(opens(), 0, "not before 20 seconds");
    clock.advance(0.001);
    assert.equal(opens(), 1);
    assert.equal(timer.waiting, false);
  });

  it("schedules the wait in milliseconds", () => {
    const { clock, timer } = setUp();
    timer.signal(Started, open(20));
    assert.deepEqual(clock.timers.map((t) => t.milliseconds), [20_000]);
  });

  it("opens at once, without a timer, for a delay of 0", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open(0));
    assert.equal(opens(), 1);
    assert.equal(clock.timers.length, 0);
    assert.equal(timer.waiting, false);
  });

  it("uses the delay that was set when the agent started", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open(5));
    clock.advance(5);
    assert.equal(opens(), 1);
  });

  it("opens again on the next run", () => {
    const { clock, timer, opens } = setUp();
    for (let run = 1; run <= 3; run++) {
      timer.signal(Started, open());
      clock.advance(20);
      timer.signal(Finished, open());
      assert.equal(opens(), run);
    }
  });
});

describe("OpenTimer: a quick prompt never interrupts (#111)", () => {
  it("never opens when agent-finished arrives within the delay", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open());
    clock.advance(10);
    timer.signal(Finished, open());
    assert.equal(timer.waiting, false);
    clock.advance(3600);
    assert.equal(opens(), 0);
    assert.equal(clock.live, 0, "the timer was cancelled");
  });

  it("never opens when agent-finished arrives just before the delay ends", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open());
    clock.advance(19.999);
    timer.signal(Finished, open());
    clock.advance(1);
    assert.equal(opens(), 0);
  });

  it("does nothing on a finish with no run, or a link that isn't a signal", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Finished, open());
    timer.signal(null, open());
    clock.advance(60);
    assert.equal(opens(), 0);
    assert.equal(clock.timers.length, 0);
  });
});

describe("OpenTimer: repeated starts (#111)", () => {
  it("opens once, 20 seconds after the first of several agent-started links", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open());
    clock.advance(8);
    timer.signal(Started, open());
    clock.advance(8);
    timer.signal(Started, open());
    assert.equal(clock.timers.length, 1, "a repeated start adds no timer");
    clock.advance(4);
    assert.equal(opens(), 1, "20 seconds after the first, not restarted");
    clock.advance(60);
    assert.equal(opens(), 1);
  });

  it("opens at most once per run, even with more starts after it opened", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open());
    clock.advance(20);
    timer.signal(Started, open());
    clock.advance(60);
    assert.equal(opens(), 1);
    assert.equal(clock.timers.length, 1);
  });

  it("opens at most once per run with a delay of 0", () => {
    const { timer, opens } = setUp();
    timer.signal(Started, open(0));
    timer.signal(Started, open(0));
    assert.equal(opens(), 1);
  });
});

describe("OpenTimer: settings changes (#111)", () => {
  for (const mode of [AutoStartMode.Off, AutoStartMode.Notify]) {
    it(`cancels the wait when the mode changes to ${mode}`, () => {
      const { clock, timer, opens } = setUp();
      timer.signal(Started, open());
      clock.advance(10);
      timer.settingsChanged({ mode, delaySeconds: 20 });
      assert.equal(timer.waiting, false);
      clock.advance(60);
      assert.equal(opens(), 0);
      assert.equal(clock.live, 0);
    });
  }

  it("doesn't bring a cancelled wait back when the mode returns to open in the same run", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open());
    timer.settingsChanged({ mode: AutoStartMode.Off, delaySeconds: 20 });
    timer.settingsChanged(open());
    timer.signal(Started, open());
    clock.advance(60);
    assert.equal(opens(), 0);
  });

  it("waits for the next run after switching to open mid-run", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, DEFAULT_NOTICE_SETTINGS);
    timer.settingsChanged(open());
    clock.advance(60);
    assert.equal(opens(), 0, "nothing this run");
    timer.signal(Finished, open());
    timer.signal(Started, open());
    clock.advance(20);
    assert.equal(opens(), 1, "the next run opens");
  });

  it("keeps the running wait when the delay changes mid-wait, and uses the new delay next run", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open(20));
    timer.settingsChanged(open(5));
    clock.advance(5);
    assert.equal(opens(), 0, "the new delay doesn't apply to this wait");
    clock.advance(15);
    assert.equal(opens(), 1);
    timer.signal(Finished, open(5));
    timer.signal(Started, open(5));
    clock.advance(5);
    assert.equal(opens(), 2);
  });

  it("doesn't start a wait in off or notify mode", () => {
    for (const mode of [AutoStartMode.Off, AutoStartMode.Notify]) {
      const { clock, timer, opens } = setUp();
      timer.signal(Started, { mode, delaySeconds: 0 });
      clock.advance(60);
      assert.equal(opens(), 0, mode);
      assert.equal(clock.timers.length, 0, mode);
    }
  });
});

describe("OpenTimer: invalid delays, through the settings reader (#111)", () => {
  const invalid: readonly (readonly [string, unknown])[] = [
    ["a negative delay", -5],
    ["a non-numeric delay", "soon"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["more than an hour", 3601],
  ];
  for (const [name, value] of invalid) {
    it(`waits 20 seconds for ${name}`, () => {
      const settings = readNoticeSettings((key) =>
        key === SettingKey.Mode ? "open" : key === SettingKey.DelaySeconds ? value : undefined,
      );
      const { clock, timer, opens } = setUp();
      timer.signal(Started, settings);
      assert.deepEqual(clock.timers.map((t) => t.milliseconds), [20_000]);
      clock.advance(20);
      assert.equal(opens(), 1);
    });
  }

  it("opens at once for a delay of 0 set in Settings", () => {
    const settings = readNoticeSettings((key) =>
      key === SettingKey.Mode ? "open" : key === SettingKey.DelaySeconds ? 0 : undefined,
    );
    const { timer, opens } = setUp();
    timer.signal(Started, settings);
    assert.equal(opens(), 1);
  });

  it("reads only the two fixed links, so any other link starts nothing", () => {
    const { clock, timer, opens } = setUp();
    for (const path of ["/agent-started/", "/Agent-Started", "/agent-started?delay=0"]) {
      timer.signal(readAgentSignal({ path, query: "", fragment: "" }), open(0));
    }
    clock.advance(60);
    assert.equal(opens(), 0);
  });
});

describe("OpenTimer: dispose (#111)", () => {
  it("cancels the wait in progress", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open());
    timer.dispose();
    assert.equal(timer.waiting, false);
    assert.equal(clock.live, 0);
    clock.advance(60);
    assert.equal(opens(), 0);
  });

  it("ignores every signal afterwards", () => {
    const { clock, timer, opens } = setUp();
    timer.dispose();
    timer.signal(Started, open(0));
    timer.signal(Started, open());
    clock.advance(60);
    assert.equal(opens(), 0);
    assert.equal(clock.timers.length, 0);
  });

  it("does nothing if a cancelled callback runs anyway", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open());
    const [scheduled] = clock.timers;
    assert.ok(scheduled);
    timer.dispose();
    scheduled.callback();
    assert.equal(opens(), 0);
  });

  it("does nothing if a callback from a finished run runs during the next run", () => {
    const { clock, timer, opens } = setUp();
    timer.signal(Started, open());
    const [first] = clock.timers;
    assert.ok(first);
    timer.signal(Finished, open());
    timer.signal(Started, open());
    first.callback();
    assert.equal(opens(), 0, "the old run's callback is ignored");
    clock.advance(20);
    assert.equal(opens(), 1, "the new run's wait still opens");
  });
});

describe("OpenTimer is pure", () => {
  it("has no vscode import and no real clock: the clock is passed in", () => {
    const source = readFileSync(new URL("../src/openTimer.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s*["']vscode["']/);
    const code = source.replace(/^\s*(\/\/|\*).*$/gm, "");
    assert.doesNotMatch(code, /\bsetTimeout\(|\bclearTimeout\(|\bDate\b|\bperformance\b/);
    assert.deepEqual(source.match(/^import\b.*$/gm), [
      'import { AgentSignal } from "./agentSignals.ts";',
      'import { AutoStartMode, type NoticeSettings } from "./noticeSettings.ts";',
    ]);
  });
});
