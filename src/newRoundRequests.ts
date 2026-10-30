// Tracks "0xWORD: New Round" requests until the webview can take them. Pure:
// no `vscode` import, so it can be unit-tested with `node --test`.
//
// The rule: every run of the command starts exactly one new round. If the
// webview is listening, the request is sent at once. If not (the panel is
// closed, never opened, hidden or still loading), it is counted, and all the
// counted requests are sent once the webview says `ready`.
//
// Events can arrive late: a post's result or a view's dispose may come in
// after a newer view, or a newer load of the same view, is already listening.
// Two numbers keep those from touching the live webview:
// - a view id, one per `attach` (one per `resolveWebviewView`)
// - a generation, bumped whenever the webview starts or stops listening
//
// A `newRound` the webview didn't get (the post resolved false, rejected or
// threw) is posted again up to NEW_ROUND_RETRIES times, then queued for the
// next `ready`. It's never retried forever, and never sent twice.
import { deliver, type PostMessage } from "./post.ts";
import { handleWebviewMessage, type HostHandlers, type HostMessage } from "./protocol.ts";

/**
 * How many times one run's `newRound` is posted again after a failed post,
 * before it's queued for the next `ready`: 2 retries, 3 posts in all.
 */
export const NEW_ROUND_RETRIES = 2;

export class NewRoundRequests {
  #view = 0;
  #generation = 0;
  #ready = false;
  #pending = 0;

  /** Requests waiting for the webview to become ready. */
  get pending(): number {
    return this.#pending;
  }

  /** True between the current view's `ready` and its next `reset`. */
  get isReady(): boolean {
    return this.#ready;
  }

  /** Changes every time the webview starts or stops listening. */
  get generation(): number {
    return this.#generation;
  }

  /**
   * A view was resolved. It isn't listening until it sends `ready`. Returns
   * its id; events from earlier views are ignored from now on.
   */
  attach(): number {
    this.#view++;
    this.#stopListening();
    return this.#view;
  }

  /**
   * Records one run of the command. Returns the generation to post `newRound`
   * under now, or null if the request was queued for the next `ready`.
   */
  request(): number | null {
    if (this.#ready) {
      return this.#generation;
    }
    this.#pending++;
    return null;
  }

  /**
   * View `view` sent `ready`. Returns how many `newRound` messages to post
   * (after `init`), and clears the queue so none is sent twice. Returns 0 and
   * changes nothing if `view` is no longer the current view.
   */
  ready(view: number): number {
    // 0 is never a view id: `attach` hands out 1, 2, ...
    if (view === 0 || view !== this.#view) {
      return 0;
    }
    this.#generation++;
    this.#ready = true;
    const count = this.#pending;
    this.#pending = 0;
    return count;
  }

  /**
   * View `view` stopped listening: it was hidden, disposed or is reloading.
   * Queued requests are kept. Ignored if `view` is no longer the current view.
   */
  reset(view: number): void {
    if (view === this.#view) {
      this.#stopListening();
    }
  }

  /**
   * A `newRound` posted under `generation` didn't reach the webview. If that
   * is still the current load, it isn't listening: stop sending to it. Then
   * the request is made again, so it's neither lost nor sent twice. Returns
   * the generation to post it again under now, or null if it was queued.
   */
  undelivered(generation: number): number | null {
    if (generation === this.#generation) {
      this.#stopListening();
    }
    return this.request();
  }

  /**
   * Post number `attempt` (1 for the first) of one run's `newRound`, made
   * under `generation`, didn't reach the webview. Until NEW_ROUND_RETRIES
   * retries are used up, returns the generation to post it again under if a
   * webview is listening. After that, or if none is, the run is queued for the
   * next `ready` and this returns null. Giving up also stops sending to the
   * load it was posted to, if that's still the current one, so later runs wait
   * for its next `ready` too; a newer load that is listening is left alone.
   */
  retryOrQueue(generation: number, attempt: number): number | null {
    if (attempt <= NEW_ROUND_RETRIES) {
      return this.request();
    }
    if (generation === this.#generation) {
      this.#stopListening();
    }
    this.#pending++;
    return null;
  }

  #stopListening(): void {
    this.#generation++;
    this.#ready = false;
  }
}

/**
 * View `view`'s visibility changed. Returns true if its HTML should be built
 * again now.
 *
 * Hidden: its webview is unloaded, so it stops listening (`reset`; queued
 * requests are kept for its next `ready`). VS Code loads the same HTML string
 * again when the view is shown, so the HTML is rebuilt while it's hidden: the
 * next show then opens in the current theme choice, with a fresh nonce. It's
 * never rebuilt while shown, since that would reload the panel mid-round.
 *
 * Shown: nothing changes until the reloaded webview sends `ready`.
 */
export function viewVisibilityChanged(requests: NewRoundRequests, view: number, visible: boolean): boolean {
  if (visible) {
    return false;
  }
  requests.reset(view);
  return true;
}

/**
 * Sends one run's `newRound`: posts it under `generation` (null means the run
 * was queued, so nothing is posted), and after each failed post either posts
 * it again or leaves it queued, as `retryOrQueue` decides. `post` posts to the
 * current view's webview, or resolves false if there's none. Resolves once the
 * run is delivered or queued; never rejects, and logs nothing.
 */
export async function sendNewRound(
  requests: NewRoundRequests,
  post: PostMessage,
  generation: number | null,
): Promise<void> {
  let current = generation;
  for (let attempt = 1; current !== null; attempt++) {
    if (await deliver(post, { type: "newRound" })) {
      return;
    }
    current = requests.retryOrQueue(current, attempt);
  }
}

/**
 * The host's full answer to a message from view `view`: the protocol's reply,
 * and after an `init`, one `newRound` per request queued while the webview
 * wasn't listening. `init` must come first, so the webview's first round
 * doesn't swallow a requested one.
 */
export function messagesAfter(
  raw: unknown,
  handlers: HostHandlers,
  requests: NewRoundRequests,
  view: number,
): HostMessage[] {
  const reply = handleWebviewMessage(raw, handlers);
  if (!reply) {
    return [];
  }
  const messages: HostMessage[] = [reply];
  if (reply.type === "init") {
    for (let i = requests.ready(view); i > 0; i--) {
      messages.push({ type: "newRound" });
    }
  }
  return messages;
}
