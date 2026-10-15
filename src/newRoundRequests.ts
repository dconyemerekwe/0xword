// Tracks "0xWORD: New Round" requests until the webview can take them. Pure:
// no `vscode` import, so it can be unit-tested with `node --test`.
//
// The rule: every run of the command starts exactly one new round. If the
// webview is listening, the request is sent at once. If not (the panel is
// closed, never opened, hidden or still loading), it is counted, and all the
// counted requests are sent once the webview says `ready`.

export class NewRoundRequests {
  #ready = false;
  #pending = 0;

  /** Requests waiting for the webview to become ready. */
  get pending(): number {
    return this.#pending;
  }

  /** True between the webview's `ready` and the next `reset`. */
  get isReady(): boolean {
    return this.#ready;
  }

  /**
   * Records one run of the command. Returns true if the caller should post
   * `newRound` now, or false if the request was queued for the next `ready`.
   */
  request(): boolean {
    if (this.#ready) {
      return true;
    }
    this.#pending++;
    return false;
  }

  /**
   * The webview sent `ready`. Returns how many `newRound` messages to post
   * (after `init`), and clears the queue so none is sent twice.
   */
  ready(): number {
    this.#ready = true;
    const count = this.#pending;
    this.#pending = 0;
    return count;
  }

  /**
   * The webview stopped listening: it was hidden, disposed or is reloading.
   * Queued requests are kept for the next `ready`.
   */
  reset(): void {
    this.#ready = false;
  }

  /**
   * A `newRound` posted while ready didn't reach the webview. Queues it again
   * and waits for the next `ready`, so the request isn't lost.
   */
  undelivered(): void {
    this.#ready = false;
    this.#pending++;
  }
}
