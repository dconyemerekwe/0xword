import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NewRoundRequests } from "../src/newRoundRequests.ts";

/** A requests tracker whose webview has loaded and said `ready`. */
function readyRequests(): NewRoundRequests {
  const requests = new NewRoundRequests();
  requests.ready();
  return requests;
}

describe("NewRoundRequests", () => {
  describe("panel open and ready", () => {
    it("sends a run straight away without queueing it", () => {
      const requests = readyRequests();
      assert.equal(requests.request(), true);
      assert.equal(requests.pending, 0);
    });

    it("sends each of two quick runs straight away, one each", () => {
      const requests = readyRequests();
      assert.deepEqual([requests.request(), requests.request()], [true, true]);
      assert.equal(requests.pending, 0);
    });
  });

  describe("panel closed or never opened", () => {
    it("starts not ready, with nothing queued", () => {
      const requests = new NewRoundRequests();
      assert.equal(requests.isReady, false);
      assert.equal(requests.pending, 0);
    });

    it("queues a run until the webview is ready, then sends it once", () => {
      const requests = new NewRoundRequests();
      assert.equal(requests.request(), false);
      assert.equal(requests.pending, 1);
      assert.equal(requests.ready(), 1);
      assert.equal(requests.pending, 0);
    });

    it("sends nothing on ready if the command never ran", () => {
      assert.equal(new NewRoundRequests().ready(), 0);
    });

    it("queues two quick runs and sends exactly two on ready", () => {
      const requests = new NewRoundRequests();
      requests.request();
      requests.request();
      assert.equal(requests.ready(), 2);
    });

    it("doesn't send queued runs twice if ready arrives again", () => {
      const requests = new NewRoundRequests();
      requests.request();
      assert.equal(requests.ready(), 1);
      assert.equal(requests.ready(), 0);
    });

    it("sends runs made after ready straight away, not on the next ready", () => {
      const requests = new NewRoundRequests();
      requests.request();
      requests.ready();
      assert.equal(requests.request(), true);
      assert.equal(requests.ready(), 0);
    });
  });

  describe("view hidden, disposed or reloaded", () => {
    it("stops sending straight away after a reset", () => {
      const requests = readyRequests();
      requests.reset();
      assert.equal(requests.isReady, false);
      assert.equal(requests.request(), false);
    });

    it("keeps queued runs across a reset and sends them on the next ready", () => {
      const requests = new NewRoundRequests();
      requests.request();
      requests.reset();
      requests.request();
      assert.equal(requests.ready(), 2);
    });

    it("sends nothing again when a re-resolved view says ready", () => {
      const requests = readyRequests();
      assert.equal(requests.request(), true);
      requests.reset();
      assert.equal(requests.ready(), 0);
    });

    it("queues a run the webview didn't receive and sends it on the next ready", () => {
      const requests = readyRequests();
      assert.equal(requests.request(), true);
      requests.undelivered();
      assert.equal(requests.isReady, false);
      assert.equal(requests.pending, 1);
      assert.equal(requests.ready(), 1);
    });

    it("never throws, whatever order the events come in", () => {
      const requests = new NewRoundRequests();
      assert.doesNotThrow(() => {
        requests.reset();
        requests.undelivered();
        requests.ready();
        requests.ready();
        requests.reset();
        requests.reset();
        requests.request();
      });
      assert.equal(requests.ready(), 1);
    });
  });
});
