// Decides when `open` mode opens the 0xWORD panel (#111): once the agent has
// been working for the delay set in Settings, so a quick prompt never
// interrupts the player. Pure: no `vscode` import, and the clock is passed in,
// so it can be unit-tested with `node --test` and a fake clock.
//
// The rules:
// - the wait starts on the run's first `agent-started`, in `open` mode only;
//   a repeated start while the agent works doesn't restart it or add another
// - `agent-finished`, leaving `open` mode and `dispose` each cancel it
// - the panel opens at most once per run; a delay of 0 opens it at once
// - switching to `open` mid-run waits for the next run, as the pop-up does
// - changing the delay mid-wait keeps the wait already running
import { AgentSignal } from "./agentSignals.ts";
import { AutoStartMode, type NoticeSettings } from "./noticeSettings.ts";

/** Cancels one scheduled callback. Calling it again, or after it ran, does nothing. */
export type Cancel = () => void;

/**
 * Runs `callback` once after `milliseconds`, like `setTimeout`, and returns
 * a function that cancels it, like `clearTimeout`.
 */
export type Schedule = (callback: () => void, milliseconds: number) => Cancel;

/** The settings the timer reads, checked by `readNoticeSettings`. */
export type OpenSettings = Pick<NoticeSettings, "mode" | "delaySeconds">;

export class OpenTimer {
  readonly #schedule: Schedule;
  readonly #open: () => void;
  /** True from a run's first `agent-started` until its `agent-finished`. */
  #working = false;
  /** The wait in progress, or null. Its identity tells a late callback it was cancelled. */
  #wait: { readonly cancel: Cancel } | null = null;
  #disposed = false;

  /** `open` opens the panel; it's called at most once per run, and never after `dispose`. */
  constructor(schedule: Schedule, open: () => void) {
    this.#schedule = schedule;
    this.#open = open;
  }

  /** True while a wait is in progress. */
  get waiting(): boolean {
    return this.#wait !== null;
  }

  /**
   * Records an agent link (null for one that isn't a signal) with the
   * settings as they are now: starts the wait on a run's first start in
   * `open` mode, and cancels it when the run finishes.
   */
  signal(signal: AgentSignal | null, settings: OpenSettings): void {
    if (this.#disposed) {
      return;
    }
    if (signal === AgentSignal.Started && !this.#working) {
      this.#working = true;
      if (settings.mode === AutoStartMode.Open) {
        this.#start(settings.delaySeconds);
      }
    } else if (signal === AgentSignal.Finished) {
      this.#working = false;
      this.#cancel();
    }
  }

  /**
   * The settings changed: leaving `open` mode cancels the wait. Entering it
   * mid-run starts nothing, and a new delay applies from the next run.
   */
  settingsChanged(settings: OpenSettings): void {
    if (settings.mode !== AutoStartMode.Open) {
      this.#cancel();
    }
  }

  /** Cancels the wait for good, as the extension stops. Later signals do nothing. */
  dispose(): void {
    this.#cancel();
    this.#disposed = true;
  }

  #start(delaySeconds: number): void {
    if (delaySeconds === 0) {
      this.#open();
      return;
    }
    let wait: { readonly cancel: Cancel } | null = null;
    const cancel = this.#schedule(() => {
      // A callback that fires after its wait was cancelled does nothing.
      if (wait !== null && this.#wait === wait) {
        this.#wait = null;
        this.#open();
      }
    }, delaySeconds * 1000);
    wait = { cancel };
    this.#wait = wait;
  }

  #cancel(): void {
    this.#wait?.cancel();
    this.#wait = null;
  }
}
