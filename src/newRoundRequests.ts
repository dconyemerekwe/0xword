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
// A message the webview didn't get (the post resolved false, rejected or
// threw) is posted again up to POST_RETRIES times per load. A `newRound`
// is then queued for the next `ready`, and an `init` is dropped. Neither is
// ever retried forever, and a `newRound` is never sent twice.
//
// `open` mode's `agentOpen` (#111) is delivered the same way, with one
// difference: it isn't counted. However many are asked for while the webview
// isn't listening, it gets one, after `init` and any queued `newRound`.
//
// `agentFinished` (#112) is never kept: it goes only to a webview listening
// when the agent finishes (`sendAgentFinished`), and a hidden or closed panel
// never gets it.
import { deliver, type PostMessage } from "./post.ts";
import {
  handleWebviewMessage,
  type AgentOpenMessage,
  type HostHandlers,
  type HostMessage,
  type InitMessage,
  type NewRoundMessage,
} from "./protocol.ts";

/**
 * How many times a failed `newRound` or `init` is posted again to the same
 * load of the webview: 2 retries, 3 posts in all. A `newRound` is then queued
 * for the next `ready`; an `init` is dropped.
 */
export const POST_RETRIES = 2;

export class NewRoundRequests {
  #view = 0;
  #generation = 0;
  #ready = false;
  #pending = 0;
  #openPending = false;

  /** Requests waiting for the webview to become ready. */
  get pending(): number {
    return this.#pending;
  }

  /** True while an `agentOpen` is waiting for the webview to become ready. */
  get openPending(): boolean {
    return this.#openPending;
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
   * Records one `agentOpen`. Returns the generation to post it under now, or
   * null if it was kept for the next `ready`. One kept already stays one.
   */
  requestOpen(): number | null {
    if (this.#ready) {
      return this.#generation;
    }
    this.#openPending = true;
    return null;
  }

  /**
   * After view `view`'s `ready`: true, once, if an `agentOpen` was kept for
   * it, and clears it so it's never sent twice. False and changes nothing if
   * `view` isn't listening (its `ready` was ignored as stale).
   */
  takeOpen(view: number): boolean {
    if (!this.#openPending || this.listeningGeneration(view) === null) {
      return false;
    }
    this.#openPending = false;
    return true;
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
   * The generation of view `view`'s current load if it's listening, or null
   * if it isn't (not ready yet, stopped, or no longer the current view).
   */
  listeningGeneration(view: number): number | null {
    return this.#ready && view === this.#view ? this.#generation : null;
  }

  /** True while the load that `generation` came from is listening. */
  isListening(generation: number): boolean {
    return this.#ready && generation === this.#generation;
  }

  /**
   * Post number `attempt` (1 for the first, counted per load) of one run's
   * `newRound`, made under `generation`, didn't reach the webview. Returns the
   * generation to post it again under, or null if the run was queued for the
   * next `ready`:
   * - same load, retries left: post again to it;
   * - same load, POST_RETRIES retries used up: queue the run and stop
   *   sending to that load, so later runs wait for its next `ready` too;
   * - an earlier load: post to the newer load if it's listening, which starts
   *   a new count of attempts (a new load comes only from a hide and show or a
   *   reload, so this can't go on forever), or queue the run if it isn't.
   */
  retryOrQueue(generation: number, attempt: number): number | null {
    if (generation === this.#generation && attempt > POST_RETRIES) {
      this.#stopListening();
      this.#pending++;
      return null;
    }
    return this.request();
  }

  /**
   * Like `retryOrQueue`, for a failed `agentOpen` post: posts it again, or
   * keeps it for the next `ready` once POST_RETRIES retries are used up.
   */
  retryOrQueueOpen(generation: number, attempt: number): number | null {
    if (generation === this.#generation && attempt > POST_RETRIES) {
      this.#stopListening();
      this.#openPending = true;
      return null;
    }
    return this.requestOpen();
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
export function sendNewRound(
  requests: NewRoundRequests,
  post: PostMessage,
  generation: number | null,
): Promise<void> {
  return sendOrKeep(post, { type: "newRound" }, generation, (current, attempt) =>
    requests.retryOrQueue(current, attempt),
  );
}

/**
 * Sends one `agentOpen`, as `sendNewRound` sends a `newRound`: posted under
 * `generation` (null means it was kept for the next `ready`), then posted
 * again or kept, as `retryOrQueueOpen` decides. Never rejects.
 */
export function sendAgentOpen(
  requests: NewRoundRequests,
  post: PostMessage,
  generation: number | null,
): Promise<void> {
  return sendOrKeep(post, { type: "agentOpen" }, generation, (current, attempt) =>
    requests.retryOrQueueOpen(current, attempt),
  );
}

/**
 * Sends `agentFinished` (#112), only if the webview is listening now: posted
 * under the current generation, and posted again up to POST_RETRIES times
 * while it fails and that same load is still listening. It's never queued or
 * kept, so a webview that isn't listening now (hidden, closed or still
 * loading) never gets it, not even on its next `ready`. Resolves true if it
 * was delivered; never rejects, and logs nothing.
 */
export async function sendAgentFinished(requests: NewRoundRequests, post: PostMessage): Promise<boolean> {
  const generation = requests.isReady ? requests.generation : null;
  if (generation === null) {
    return false;
  }
  for (let attempt = 1; attempt <= POST_RETRIES + 1 && requests.isListening(generation); attempt++) {
    if (await deliver(post, { type: "agentFinished" })) {
      return true;
    }
  }
  return false;
}

/**
 * Posts `message` under `generation` until it's delivered or `retryOrKeep`
 * keeps it for the next `ready` (returns null). Never rejects.
 */
async function sendOrKeep(
  post: PostMessage,
  message: NewRoundMessage | AgentOpenMessage,
  generation: number | null,
  retryOrKeep: (generation: number, attempt: number) => number | null,
): Promise<void> {
  let current = generation;
  let attempt = 1;
  while (current !== null) {
    if (await deliver(post, message)) {
      return;
    }
    const next = retryOrKeep(current, attempt);
    // Attempts are counted per load: a newer load starts again from 1.
    attempt = next === current ? attempt + 1 : 1;
    current = next;
  }
}

/**
 * Posts `init` to the webview that sent `ready`, and posts it again up to
 * POST_RETRIES times while it fails and that load, `generation`, is
 * still listening. With `generation` null (that view's `ready` was ignored as
 * stale) it's posted once. Resolves true if it was delivered; never rejects,
 * and logs nothing. An `init` that still fails is dropped: the next load's
 * `ready` asks again.
 *
 * Posting `init` twice is harmless: the webview starts a round on `init` only
 * if it has none, and applies the theme only if the player hasn't chosen one
 * since that load.
 */
export async function sendInit(
  requests: NewRoundRequests,
  post: PostMessage,
  message: InitMessage,
  generation: number | null,
): Promise<boolean> {
  for (let attempt = 1; attempt <= POST_RETRIES + 1; attempt++) {
    if (await deliver(post, message)) {
      return true;
    }
    if (generation === null || !requests.isListening(generation)) {
      return false;
    }
  }
  return false;
}

/**
 * Answers a message from view `view`, as `messagesAfter` decides: `init`
 * posted to that view's webview with `sendInit`, then, once it has been
 * delivered or given up, one `sendNewRound` per round queued while the webview
 * wasn't listening, then `sendAgentOpen` for a kept `agentOpen`. Each queued
 * round is recorded again as a run (`request`, or `requestOpen`),
 * so it's posted if the webview is still listening, or queued again if it
 * stopped while `init` was being retried. `toSender` posts to the webview that
 * sent the message, `toView` to the current view's. Never rejects.
 */
export async function answerWebview(
  raw: unknown,
  handlers: HostHandlers,
  requests: NewRoundRequests,
  view: number,
  toSender: PostMessage,
  toView: PostMessage,
): Promise<void> {
  const [reply, ...queued] = messagesAfter(raw, handlers, requests, view);
  if (!reply) {
    return;
  }
  if (reply.type !== "init") {
    // Only `init` is a reply today; anything else is posted once.
    await deliver(toSender, reply);
    return;
  }
  await sendInit(requests, toSender, reply, requests.listeningGeneration(view));
  for (const message of queued) {
    if (message.type === "agentOpen") {
      await sendAgentOpen(requests, toView, requests.requestOpen());
    } else {
      await sendNewRound(requests, toView, requests.request());
    }
  }
}

/**
 * The host's full answer to a message from view `view`: the protocol's reply,
 * and after an `init`, one `newRound` per request queued while the webview
 * wasn't listening, then the kept `agentOpen`, if there is one. `init` must
 * come first, so the webview's first round doesn't swallow a requested one.
 * `agentOpen` comes last: after a requested new round it leaves that round
 * alone, so it never starts a second one.
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
    if (requests.takeOpen(view)) {
      messages.push({ type: "agentOpen" });
    }
  }
  return messages;
}
