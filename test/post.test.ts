import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deliver, type PostMessage } from "../src/post.ts";
import type { HostMessage } from "../src/protocol.ts";
import { EMPTY_STATS, toStatsView } from "../src/stats.ts";

const INIT: HostMessage = { type: "init", stats: toStatsView(EMPTY_STATS), theme: "system" };

const rejecting: PostMessage = () => Promise.reject(new Error("postMessage failed"));
const throwing: PostMessage = () => {
  throw new Error("Webview is disposed");
};

describe("deliver", () => {
  it("resolves true when the webview got the message, and posts it once unchanged", async () => {
    const sent: HostMessage[] = [];
    const post: PostMessage = (message) => {
      sent.push(message);
      return Promise.resolve(true);
    };
    assert.equal(await deliver(post, INIT), true);
    assert.deepEqual(sent, [INIT]);
  });

  it("resolves false when postMessage returns false", async () => {
    assert.equal(await deliver(() => Promise.resolve(false), INIT), false);
  });

  it("catches a rejected init post and resolves false", async () => {
    assert.equal(await deliver(rejecting, INIT), false);
  });

  it("catches a post that throws before returning a promise and resolves false", async () => {
    assert.equal(await deliver(throwing, INIT), false);
  });

  it("leaves no unhandled rejection when the result is ignored, as the host does with init", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      void deliver(rejecting, INIT);
      // Node reports an unhandled rejection once the microtask queue drains.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    assert.deepEqual(unhandled, []);
  });

  it("logs nothing for any failure", async () => {
    const calls: unknown[] = [];
    const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
    const saved = methods.map((name) => console[name]);
    for (const name of methods) {
      console[name] = (...args: unknown[]) => {
        calls.push([name, ...args]);
      };
    }
    try {
      await deliver(() => Promise.resolve(false), INIT);
      await deliver(rejecting, INIT);
      await deliver(throwing, INIT);
    } finally {
      methods.forEach((name, i) => {
        const original = saved[i];
        if (original) {
          console[name] = original;
        }
      });
    }
    assert.deepEqual(calls, []);
  });
});
