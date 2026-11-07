import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  AgentSignal,
  NoticeChange,
  RoundReadyNotice,
  readAgentSignal,
  type AgentLink,
} from "../src/agentSignals.ts";

/** A link with `path` and no query or fragment, as VS Code hands it over. */
function link(path: string, query = "", fragment = ""): AgentLink {
  return { path, query, fragment };
}

describe("readAgentSignal", () => {
  it("reads /agent-started as started", () => {
    assert.equal(readAgentSignal(link("/agent-started")), AgentSignal.Started);
  });

  it("reads /agent-finished as finished", () => {
    assert.equal(readAgentSignal(link("/agent-finished")), AgentSignal.Finished);
  });

  describe("ignores any other link", () => {
    const ignored: readonly (readonly [string, AgentLink])[] = [
      ["another path", link("/agent-paused")],
      ["the empty path", link("")],
      ["the root path", link("/")],
      ["a path without the leading slash", link("agent-started")],
      ["a query", link("/agent-started", "x=1")],
      ["a query with no value", link("/agent-finished", "debug")],
      ["a fragment", link("/agent-started", "", "top")],
      ["a query and a fragment", link("/agent-finished", "a=b", "c")],
      ["a trailing slash", link("/agent-started/")],
      ["a different letter case", link("/Agent-Started")],
      ["an all-capitals path", link("/AGENT-FINISHED")],
      ["an extra segment after", link("/agent-started/extra")],
      ["an extra segment before", link("/x/agent-finished")],
      ["a doubled slash", link("//agent-started")],
      ["surrounding spaces", link(" /agent-started ")],
      ["a dot segment", link("/./agent-started")],
      ["a path with a newline", link("/agent-started\n")],
      ["the webview's newRound message type", link("/newRound")],
      ["the New Round command id", link("/0xword.newRound")],
    ];
    for (const [name, value] of ignored) {
      it(name, () => {
        assert.equal(readAgentSignal(value), null);
      });
    }
  });

  it("never throws, even for a very long path", () => {
    assert.equal(readAgentSignal(link(`/${"a".repeat(100_000)}`)), null);
  });
});

describe("RoundReadyNotice", () => {
  it("starts hidden", () => {
    assert.equal(new RoundReadyNotice().showing, false);
  });

  it("shows the notice on started", () => {
    const notice = new RoundReadyNotice();
    assert.equal(notice.apply(AgentSignal.Started), NoticeChange.Show);
    assert.equal(notice.showing, true);
  });

  it("hides a showing notice on finished", () => {
    const notice = new RoundReadyNotice();
    notice.apply(AgentSignal.Started);
    assert.equal(notice.apply(AgentSignal.Finished), NoticeChange.Hide);
    assert.equal(notice.showing, false);
  });

  it("changes nothing on finished when no notice is showing", () => {
    const notice = new RoundReadyNotice();
    assert.equal(notice.apply(AgentSignal.Finished), null);
    assert.equal(notice.showing, false);
  });

  it("keeps exactly one notice when started opens again", () => {
    const notice = new RoundReadyNotice();
    const changes = [notice.apply(AgentSignal.Started), notice.apply(AgentSignal.Started)];
    assert.deepEqual(changes, [NoticeChange.Show, null]);
    assert.equal(notice.showing, true);
  });

  it("changes nothing for a link that isn't a signal, whether showing or not", () => {
    const notice = new RoundReadyNotice();
    assert.equal(notice.apply(null), null);
    assert.equal(notice.showing, false);
    notice.apply(AgentSignal.Started);
    assert.equal(notice.apply(null), null);
    assert.equal(notice.showing, true);
  });

  it("shows again on the next started after a finished", () => {
    const notice = new RoundReadyNotice();
    const changes = [AgentSignal.Started, AgentSignal.Finished, AgentSignal.Started].map((s) => notice.apply(s));
    assert.deepEqual(changes, [NoticeChange.Show, NoticeChange.Hide, NoticeChange.Show]);
    assert.equal(notice.showing, true);
  });

  it("goes from link to notice end to end, ignoring a stray link in between", () => {
    const notice = new RoundReadyNotice();
    const paths = ["/agent-started", "/agent-finished/", "/agent-finished"];
    assert.deepEqual(
      paths.map((path) => notice.apply(readAgentSignal(link(path)))),
      [NoticeChange.Show, null, NoticeChange.Hide],
    );
  });
});

describe("the link reader is pure", () => {
  it("has no vscode import", () => {
    const source = readFileSync(new URL("../src/agentSignals.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s*["']vscode["']/);
    assert.doesNotMatch(source, /^import\b/m);
  });
});
