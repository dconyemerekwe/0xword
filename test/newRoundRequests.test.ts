import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NewRoundRequests, messagesAfter } from "../src/newRoundRequests.ts";
import type { HostHandlers, RoundFinishedMessage } from "../src/protocol.ts";

/** A tracker with one resolved view whose webview has said `ready`. */
function readyRequests(): { requests: NewRoundRequests; view: number } {
  const requests = new NewRoundRequests();
  const view = requests.attach();
  requests.ready(view);
  return { requests, view };
}

/** Handlers that record every call. */
function recordingHandlers(): HostHandlers & { calls: RoundFinishedMessage[] } {
  const calls: RoundFinishedMessage[] = [];
  return { calls, roundFinished: (message) => calls.push(message) };
}

describe("NewRoundRequests", () => {
  describe("panel open and ready", () => {
    it("sends a run straight away without queueing it", () => {
      const { requests } = readyRequests();
      assert.equal(requests.request(), requests.generation);
      assert.equal(requests.pending, 0);
    });

    it("sends each of two quick runs straight away, one each", () => {
      const { requests } = readyRequests();
      const generation = requests.generation;
      assert.deepEqual([requests.request(), requests.request()], [generation, generation]);
      assert.equal(requests.pending, 0);
    });
  });

  describe("panel closed or never opened", () => {
    it("starts not ready, with nothing queued", () => {
      const requests = new NewRoundRequests();
      assert.equal(requests.isReady, false);
      assert.equal(requests.pending, 0);
    });

    it("queues a run made before any view exists, and sends it once on ready", () => {
      const requests = new NewRoundRequests();
      assert.equal(requests.request(), null);
      const view = requests.attach();
      assert.equal(requests.pending, 1);
      assert.equal(requests.ready(view), 1);
      assert.equal(requests.pending, 0);
    });

    it("queues a run while the view loads, until it is ready", () => {
      const requests = new NewRoundRequests();
      const view = requests.attach();
      assert.equal(requests.request(), null);
      assert.equal(requests.ready(view), 1);
    });

    it("sends nothing on ready if the command never ran", () => {
      const requests = new NewRoundRequests();
      assert.equal(requests.ready(requests.attach()), 0);
    });

    it("queues two quick runs and sends exactly two on ready", () => {
      const requests = new NewRoundRequests();
      requests.request();
      requests.request();
      assert.equal(requests.ready(requests.attach()), 2);
    });

    it("doesn't send queued runs twice if ready arrives again", () => {
      const requests = new NewRoundRequests();
      requests.request();
      const view = requests.attach();
      assert.equal(requests.ready(view), 1);
      assert.equal(requests.ready(view), 0);
    });

    it("sends runs made after ready straight away, not on the next ready", () => {
      const requests = new NewRoundRequests();
      const view = requests.attach();
      requests.request();
      requests.ready(view);
      assert.notEqual(requests.request(), null);
      assert.equal(requests.ready(view), 0);
    });
  });

  describe("view hidden, disposed or reloaded", () => {
    it("stops sending straight away after a reset", () => {
      const { requests, view } = readyRequests();
      requests.reset(view);
      assert.equal(requests.isReady, false);
      assert.equal(requests.request(), null);
    });

    it("keeps queued runs across a reset and sends them on the next ready", () => {
      const requests = new NewRoundRequests();
      const view = requests.attach();
      requests.request();
      requests.reset(view);
      requests.request();
      assert.equal(requests.ready(view), 2);
    });

    it("sends nothing again when a re-resolved view says ready", () => {
      const { requests, view } = readyRequests();
      assert.notEqual(requests.request(), null);
      requests.reset(view);
      assert.equal(requests.ready(requests.attach()), 0);
    });

    it("queues a run the webview didn't receive and sends it on the next ready", () => {
      const { requests, view } = readyRequests();
      const generation = requests.request();
      assert.ok(generation !== null);
      assert.equal(requests.undelivered(generation), null);
      assert.equal(requests.isReady, false);
      assert.equal(requests.pending, 1);
      assert.equal(requests.ready(view), 1);
    });

    it("undelivered from an earlier load doesn't stop a ready webview", () => {
      const { requests, view } = readyRequests();
      const generation = requests.request();
      assert.ok(generation !== null);
      // Hidden and shown again before the post's result came back.
      requests.reset(view);
      requests.ready(view);
      // The old post failed: send it again to the live webview, once.
      assert.equal(requests.undelivered(generation), requests.generation);
      assert.equal(requests.isReady, true);
      assert.equal(requests.pending, 0);
      assert.equal(requests.request(), requests.generation);
    });

    it("undelivered from an earlier load queues it if nothing is listening yet", () => {
      const { requests, view } = readyRequests();
      const generation = requests.request();
      assert.ok(generation !== null);
      requests.reset(view);
      assert.equal(requests.undelivered(generation), null);
      assert.equal(requests.ready(view), 1);
    });

    it("an old view's dispose doesn't reset a newer view", () => {
      const requests = new NewRoundRequests();
      const oldView = requests.attach();
      requests.ready(oldView);
      const newView = requests.attach();
      requests.ready(newView);
      requests.reset(oldView);
      assert.equal(requests.isReady, true);
      assert.notEqual(requests.request(), null);
    });

    it("ignores ready before any view was attached", () => {
      const requests = new NewRoundRequests();
      requests.request();
      assert.equal(requests.ready(0), 0);
      assert.equal(requests.isReady, false);
      assert.equal(requests.pending, 1);
    });

    it("ignores ready from an old view", () => {
      const requests = new NewRoundRequests();
      const oldView = requests.attach();
      requests.request();
      requests.attach();
      assert.equal(requests.ready(oldView), 0);
      assert.equal(requests.isReady, false);
      assert.equal(requests.pending, 1);
    });

    it("never throws, whatever order the events come in", () => {
      const requests = new NewRoundRequests();
      let view = 0;
      assert.doesNotThrow(() => {
        requests.reset(view);
        requests.undelivered(requests.generation);
        requests.ready(view);
        view = requests.attach();
        requests.ready(view);
        requests.ready(view);
        requests.reset(view);
        requests.reset(view);
      });
      // Nothing is left over or lost: the next run is sent once on the next ready.
      assert.equal(requests.request(), null);
      assert.equal(requests.ready(view), 1);
    });
  });
});

describe("messagesAfter", () => {
  it("replies init first, then one newRound per queued run", () => {
    const requests = new NewRoundRequests();
    requests.request();
    requests.request();
    const view = requests.attach();
    assert.deepEqual(messagesAfter({ type: "ready" }, recordingHandlers(), requests, view), [
      { type: "init" },
      { type: "newRound" },
      { type: "newRound" },
    ]);
  });

  it("replies only init when nothing is queued", () => {
    const requests = new NewRoundRequests();
    const view = requests.attach();
    assert.deepEqual(messagesAfter({ type: "ready" }, recordingHandlers(), requests, view), [{ type: "init" }]);
  });

  it("marks the view ready, so later runs are sent straight away", () => {
    const requests = new NewRoundRequests();
    const view = requests.attach();
    messagesAfter({ type: "ready" }, recordingHandlers(), requests, view);
    assert.equal(requests.request(), requests.generation);
  });

  it("doesn't flush the queue for an old view's ready", () => {
    const requests = new NewRoundRequests();
    const oldView = requests.attach();
    requests.request();
    requests.attach();
    assert.deepEqual(messagesAfter({ type: "ready" }, recordingHandlers(), requests, oldView), [{ type: "init" }]);
    assert.equal(requests.pending, 1);
  });

  it("passes roundFinished to its handler, sends nothing and keeps the queue", () => {
    const requests = new NewRoundRequests();
    const view = requests.attach();
    requests.request();
    const handlers = recordingHandlers();
    const message = { type: "roundFinished", solved: true, rowsUsed: 2, answerTries: 1, hintsUsed: false };
    assert.deepEqual(messagesAfter(message, handlers, requests, view), []);
    assert.equal(handlers.calls.length, 1);
    assert.equal(requests.pending, 1);
  });

  it("ignores an invalid message without flushing the queue", () => {
    const requests = new NewRoundRequests();
    const view = requests.attach();
    requests.request();
    assert.deepEqual(messagesAfter({ type: "newRound" }, recordingHandlers(), requests, view), []);
    assert.deepEqual(messagesAfter({ type: "ready", extra: 1 }, recordingHandlers(), requests, view), []);
    assert.equal(requests.pending, 1);
    assert.equal(requests.isReady, false);
  });
});
