import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NEW_ROUND_RETRIES,
  NewRoundRequests,
  messagesAfter,
  sendNewRound,
  viewVisibilityChanged,
} from "../src/newRoundRequests.ts";
import { deliver, type PostMessage } from "../src/post.ts";
import type { HostHandlers, HostMessage, RoundFinishedMessage } from "../src/protocol.ts";
import { EMPTY_STATS, toStatsView, type Stats } from "../src/stats.ts";

/** A tracker with one resolved view whose webview has said `ready`. */
function readyRequests(): { requests: NewRoundRequests; view: number } {
  const requests = new NewRoundRequests();
  const view = requests.attach();
  requests.ready(view);
  return { requests, view };
}

/** Handlers that record every call and report `stats`. */
function recordingHandlers(stats: Stats = EMPTY_STATS): HostHandlers & { calls: RoundFinishedMessage[] } {
  const calls: RoundFinishedMessage[] = [];
  return {
    calls,
    roundFinished: (message) => calls.push(message),
    stats: () => stats,
    setTheme: () => {},
    theme: () => "system",
  };
}

/** The `init` reply for `stats`, with no theme chosen. */
function init(stats: Stats = EMPTY_STATS) {
  return { type: "init", stats: toStatsView(stats), theme: "system" };
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
      init(),
      { type: "newRound" },
      { type: "newRound" },
    ]);
  });

  it("replies only init when nothing is queued", () => {
    const requests = new NewRoundRequests();
    const view = requests.attach();
    assert.deepEqual(messagesAfter({ type: "ready" }, recordingHandlers(), requests, view), [init()]);
  });

  it("puts the handlers' current stats in init, ahead of the queued newRound", () => {
    const stats: Stats = { played: 4, solved: 3, solvedRowsTotal: 9, hintsUsedCount: 1 };
    const requests = new NewRoundRequests();
    requests.request();
    const view = requests.attach();
    assert.deepEqual(messagesAfter({ type: "ready" }, recordingHandlers(stats), requests, view), [
      init(stats),
      { type: "newRound" },
    ]);
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
    assert.deepEqual(messagesAfter({ type: "ready" }, recordingHandlers(), requests, oldView), [init()]);
    assert.equal(requests.pending, 1);
  });

  it("passes roundFinished to its handler, sends nothing and keeps the queue", () => {
    const requests = new NewRoundRequests();
    const view = requests.attach();
    requests.request();
    const handlers = recordingHandlers();
    const message = { type: "roundFinished", solved: true, rowsUsed: 2, answerTries: 1, hintsUsed: 0 };
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

describe("viewVisibilityChanged", () => {
  it("rebuilds the HTML when the view is hidden, so the next show loads the current theme", () => {
    const { requests, view } = readyRequests();
    assert.equal(viewVisibilityChanged(requests, view, false), true);
  });

  it("never rebuilds the HTML when the view is shown: that would reload the panel mid-round", () => {
    const { requests, view } = readyRequests();
    assert.equal(viewVisibilityChanged(requests, view, true), false);
  });

  it("stops sending to a hidden view and queues runs until its reloaded webview says ready", () => {
    const { requests, view } = readyRequests();
    const before = requests.generation;
    viewVisibilityChanged(requests, view, false);
    assert.equal(requests.isReady, false);
    assert.notEqual(requests.generation, before, "a newRound posted before the hide counts as stale");
    assert.equal(requests.request(), null, "queued, not sent to the hidden view");
    assert.equal(requests.pending, 1);
  });

  it("delivers the queued runs once, after init, when the rebuilt view says ready", () => {
    const { requests, view } = readyRequests();
    viewVisibilityChanged(requests, view, false);
    requests.request();
    requests.request();
    // Shown again: nothing happens until the reloaded webview's `ready`.
    viewVisibilityChanged(requests, view, true);
    assert.equal(requests.isReady, false);
    assert.equal(requests.pending, 2);
    assert.deepEqual(messagesAfter({ type: "ready" }, recordingHandlers(), requests, view), [
      init(),
      { type: "newRound" },
      { type: "newRound" },
    ]);
    assert.equal(requests.pending, 0);
    assert.equal(requests.isReady, true);
  });

  it("leaves a shown view ready", () => {
    const { requests, view } = readyRequests();
    const generation = requests.generation;
    viewVisibilityChanged(requests, view, true);
    assert.equal(requests.isReady, true);
    assert.equal(requests.generation, generation);
    assert.equal(requests.request(), generation);
  });

  it("doesn't stop a newer view when an older view's hide arrives late", () => {
    const requests = new NewRoundRequests();
    const oldView = requests.attach();
    const newView = requests.attach();
    requests.ready(newView);
    const generation = requests.generation;
    viewVisibilityChanged(requests, oldView, false);
    assert.equal(requests.isReady, true);
    assert.equal(requests.generation, generation);
  });

  it("keeps queued runs across repeated hides", () => {
    const requests = new NewRoundRequests();
    const view = requests.attach();
    requests.request();
    viewVisibilityChanged(requests, view, false);
    viewVisibilityChanged(requests, view, false);
    assert.equal(requests.pending, 1);
  });
});

/** What a scripted post does on each call: deliver, return false, reject or throw. */
type Outcome = "delivered" | "false" | "reject" | "throw";

/**
 * A post that follows `outcomes` in order (the last one repeats) and records
 * every message. `before` runs at the start of each call, to simulate events
 * that arrive while a post is in flight.
 */
function scriptedPost(outcomes: Outcome[], before?: () => void): { post: PostMessage; sent: HostMessage[] } {
  const sent: HostMessage[] = [];
  const post: PostMessage = (message) => {
    sent.push(message);
    before?.();
    const outcome = outcomes[Math.min(sent.length, outcomes.length) - 1] ?? "delivered";
    switch (outcome) {
      case "delivered":
        return Promise.resolve(true);
      case "false":
        return Promise.resolve(false);
      case "reject":
        return Promise.reject(new Error("postMessage failed"));
      case "throw":
        throw new Error("Webview is disposed");
    }
  };
  return { post, sent };
}

/** How many `newRound` messages were posted. */
function newRounds(sent: HostMessage[]): number {
  return sent.filter((message) => message.type === "newRound").length;
}

/** Runs `body` with the console silenced, and returns every console call it made. */
async function consoleCallsDuring(body: () => Promise<void>): Promise<unknown[]> {
  const calls: unknown[] = [];
  const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
  const saved = methods.map((name) => console[name]);
  for (const name of methods) {
    console[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  }
  try {
    await body();
  } finally {
    methods.forEach((name, i) => {
      const original = saved[i];
      if (original) {
        console[name] = original;
      }
    });
  }
  return calls;
}

describe("NEW_ROUND_RETRIES", () => {
  it("is a small fixed number, so a failed newRound is never retried forever", () => {
    assert.ok(Number.isInteger(NEW_ROUND_RETRIES));
    assert.ok(NEW_ROUND_RETRIES >= 1 && NEW_ROUND_RETRIES <= 5);
  });
});

describe("NewRoundRequests.retryOrQueue", () => {
  it("asks to post again under the same generation while retries are left and the webview listens", () => {
    const { requests } = readyRequests();
    const generation = requests.request();
    assert.ok(generation !== null);
    for (let attempt = 1; attempt <= NEW_ROUND_RETRIES; attempt++) {
      assert.equal(requests.retryOrQueue(generation, attempt), generation);
    }
    assert.equal(requests.isReady, true);
    assert.equal(requests.pending, 0);
  });

  it("queues the run and stops sending to that load once the retries are used up", () => {
    const { requests, view } = readyRequests();
    const generation = requests.request();
    assert.ok(generation !== null);
    assert.equal(requests.retryOrQueue(generation, NEW_ROUND_RETRIES + 1), null);
    assert.equal(requests.isReady, false);
    assert.equal(requests.pending, 1);
    assert.equal(requests.request(), null, "later runs wait for the next ready too");
    assert.equal(requests.ready(view), 2);
  });

  it("queues the run on the first failure if nothing is listening", () => {
    const { requests, view } = readyRequests();
    const generation = requests.request();
    assert.ok(generation !== null);
    requests.reset(view);
    assert.equal(requests.retryOrQueue(generation, 1), null);
    assert.equal(requests.pending, 1);
  });

  it("retries an earlier load's failed post on the newer load that is listening", () => {
    const { requests, view } = readyRequests();
    const generation = requests.request();
    assert.ok(generation !== null);
    requests.reset(view);
    requests.ready(view);
    assert.equal(requests.retryOrQueue(generation, 1), requests.generation);
    assert.equal(requests.isReady, true);
  });

  it("gives up on an earlier load's post without stopping the newer load", () => {
    const { requests, view } = readyRequests();
    const generation = requests.request();
    assert.ok(generation !== null);
    requests.reset(view);
    requests.ready(view);
    const live = requests.generation;
    assert.equal(requests.retryOrQueue(generation, NEW_ROUND_RETRIES + 1), null);
    assert.equal(requests.isReady, true);
    assert.equal(requests.generation, live);
    assert.equal(requests.pending, 1);
  });
});

describe("sendNewRound", () => {
  it("posts newRound once when the webview gets it", async () => {
    const { requests } = readyRequests();
    const { post, sent } = scriptedPost(["delivered"]);
    await sendNewRound(requests, post, requests.request());
    assert.deepEqual(sent, [{ type: "newRound" }]);
    assert.equal(requests.isReady, true);
    assert.equal(requests.pending, 0);
  });

  it("posts nothing for a run that was queued", async () => {
    const requests = new NewRoundRequests();
    const { post, sent } = scriptedPost(["delivered"]);
    await sendNewRound(requests, post, requests.request());
    assert.deepEqual(sent, []);
    assert.equal(requests.pending, 1);
  });

  it("retries a false result for a listening panel a fixed number of times, then queues it", async () => {
    const { requests, view } = readyRequests();
    const { post, sent } = scriptedPost(["false"]);
    await sendNewRound(requests, post, requests.request());
    assert.equal(newRounds(sent), NEW_ROUND_RETRIES + 1);
    assert.equal(requests.isReady, false);
    assert.equal(requests.pending, 1);
    // The panel's next `ready` starts exactly that one round.
    assert.deepEqual(messagesAfter({ type: "ready" }, recordingHandlers(), requests, view), [
      init(),
      { type: "newRound" },
    ]);
  });

  it("retries a rejected newRound post a fixed number of times, then queues it", async () => {
    const { requests, view } = readyRequests();
    const { post, sent } = scriptedPost(["reject"]);
    await assert.doesNotReject(sendNewRound(requests, post, requests.request()));
    assert.equal(newRounds(sent), NEW_ROUND_RETRIES + 1);
    assert.equal(requests.pending, 1);
    assert.equal(requests.ready(view), 1);
  });

  it("retries a post that throws, then queues it", async () => {
    const { requests } = readyRequests();
    const { post, sent } = scriptedPost(["throw"]);
    await assert.doesNotReject(sendNewRound(requests, post, requests.request()));
    assert.equal(newRounds(sent), NEW_ROUND_RETRIES + 1);
    assert.equal(requests.pending, 1);
  });

  it("stops retrying once a retry is delivered, and starts only that one round", async () => {
    const { requests } = readyRequests();
    const { post, sent } = scriptedPost(["false", "reject", "delivered"]);
    await sendNewRound(requests, post, requests.request());
    assert.equal(newRounds(sent), 3);
    assert.equal(requests.isReady, true);
    assert.equal(requests.pending, 0);
  });

  it("queues without retrying when the panel stopped listening while the post was in flight", async () => {
    const { requests, view } = readyRequests();
    const { post, sent } = scriptedPost(["false"], () => requests.reset(view));
    await sendNewRound(requests, post, requests.request());
    assert.equal(newRounds(sent), 1);
    assert.equal(requests.pending, 1);
    assert.equal(requests.ready(view), 1);
  });

  it("starts exactly one round per run when two quick runs both fail", async () => {
    const { requests, view } = readyRequests();
    const { post, sent } = scriptedPost(["false"]);
    await Promise.all([
      sendNewRound(requests, post, requests.request()),
      sendNewRound(requests, post, requests.request()),
    ]);
    assert.ok(newRounds(sent) <= 2 * (NEW_ROUND_RETRIES + 1));
    assert.equal(requests.ready(view), 2);
    assert.equal(requests.pending, 0);
  });

  it("delivers the queued round once on ready even if init is rejected", async () => {
    const requests = new NewRoundRequests();
    requests.request();
    const view = requests.attach();
    const [reply, ...rounds] = messagesAfter({ type: "ready" }, recordingHandlers(), requests, view);
    assert.ok(reply);
    const { post, sent } = scriptedPost(["reject", "delivered"]);
    // As the host does: init first, then one sendNewRound per queued run.
    assert.equal(await deliver(post, reply), false);
    for (const _round of rounds) {
      await sendNewRound(requests, post, requests.generation);
    }
    assert.deepEqual(sent, [init(), { type: "newRound" }]);
    assert.equal(requests.pending, 0);
  });

  it("answers the panel's next ready with init again after a rejected init", async () => {
    const requests = new NewRoundRequests();
    const view = requests.attach();
    const [first] = messagesAfter({ type: "ready" }, recordingHandlers(), requests, view);
    assert.ok(first);
    assert.equal(await deliver(() => Promise.reject(new Error("rejected")), first), false);
    // Hidden and shown: the reloaded webview asks again.
    viewVisibilityChanged(requests, view, false);
    assert.deepEqual(messagesAfter({ type: "ready" }, recordingHandlers(), requests, view), [init()]);
    assert.equal(requests.isReady, true);
  });

  it("logs nothing when posts fail", async () => {
    const calls = await consoleCallsDuring(async () => {
      for (const outcome of ["false", "reject", "throw"] as const) {
        const { requests } = readyRequests();
        await sendNewRound(requests, scriptedPost([outcome]).post, requests.request());
      }
    });
    assert.deepEqual(calls, []);
  });
});
