// Checks the snippets "0xWORD: Copy agent hook setup" copies (#114): the
// editor table, the links' validation, and that each snippet is valid JSON
// that only opens the two signal links. test/agentGuide.test.ts checks they
// match the guide word for word and print nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AgentSignal, readAgentSignal } from "../src/agentSignals.ts";
import {
  AgentTool,
  CURSOR,
  EXTENSION_ID,
  TOOL_ITEMS,
  VS_CODE,
  editorFor,
  hookSnippet,
  signalLink,
  type Editor,
} from "../src/hookSnippets.ts";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  publisher: string;
  name: string;
};

/** Every scheme VS Code-based editors are known to report, plus some that aren't in the table. */
const SCHEMES = ["vscode", "vscode-insiders", "vscodium", "cursor", "windsurf", "", "VSCODE"];

/** Every hook command in a parsed snippet: each string under a `command` key. */
function commands(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(commands);
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, field]) =>
    key === "command" && typeof field === "string" ? [field] : commands(field),
  );
}

describe("editorFor", () => {
  it("gives stable VS Code's code launcher and vscode scheme", () => {
    assert.deepEqual(editorFor("vscode"), { scheme: "vscode", launcher: "code" });
  });

  it("gives Cursor its own cursor launcher and scheme", () => {
    assert.deepEqual(editorFor("cursor"), { scheme: "cursor", launcher: "cursor" });
  });

  it("gives Insiders code-insiders with vscode-insiders, and VSCodium codium with vscodium", () => {
    assert.deepEqual(editorFor("vscode-insiders"), { scheme: "vscode-insiders", launcher: "code-insiders" });
    assert.deepEqual(editorFor("vscodium"), { scheme: "vscodium", launcher: "codium" });
  });

  it("falls back to stable VS Code for any other scheme, an empty one, another letter case or a non-string", () => {
    for (const scheme of ["windsurf", "", "VSCODE", "Cursor", "vscode://x", "code", undefined, null, 1]) {
      assert.equal(editorFor(scheme), VS_CODE, String(scheme));
    }
  });
});

describe("signalLink", () => {
  it("uses 0xWORD's extension ID from package.json", () => {
    assert.equal(EXTENSION_ID, `${manifest.publisher}.${manifest.name}`);
  });

  it("builds the two signal links, which the URI handler reads back as those signals", () => {
    for (const scheme of SCHEMES) {
      const editor = editorFor(scheme);
      for (const signal of [AgentSignal.Started, AgentSignal.Finished]) {
        const link = signalLink(editor, signal);
        assert.equal(link, `${editor.scheme}://dconyemerekwe.0xword/agent-${signal}`);
        const url = new URL(link);
        assert.equal(readAgentSignal({ path: url.pathname, query: url.search, fragment: url.hash }), signal);
      }
    }
  });

  it("refuses any editor that isn't one of the table's, even a copy of one", () => {
    const strangers: readonly Editor[] = [
      { scheme: "vscode", launcher: "code" },
      { scheme: "vscode", launcher: "echo" },
      { scheme: "javascript", launcher: "code" },
      { scheme: "vscode://evil/x?", launcher: "code" },
    ];
    for (const editor of strangers) {
      assert.throws(() => signalLink(editor, AgentSignal.Started), /not a signal link/, editor.scheme);
    }
  });

  it("refuses a signal that isn't one of the two", () => {
    assert.throws(() => signalLink(VS_CODE, "paused" as AgentSignal), /not a signal link/);
    assert.throws(() => signalLink(VS_CODE, "started?x=1" as AgentSignal), /not a signal link/);
  });
});

describe("the tool list", () => {
  it("has one item per tool, in the guide's order, each with a target file", () => {
    assert.deepEqual(
      TOOL_ITEMS.map((item) => item.tool),
      [AgentTool.ClaudeCode, AgentTool.CopilotVsCode, AgentTool.CopilotCli, AgentTool.Cursor, AgentTool.Codex],
    );
    assert.deepEqual(
      TOOL_ITEMS.map((item) => item.detail),
      [
        "~/.claude/settings.json",
        "~/.copilot/hooks/0xword.json",
        "~/.copilot/hooks/0xword.json",
        "~/.cursor/hooks.json",
        "~/.codex/hooks.json",
      ],
    );
  });

  it("says where to paste each, naming its target file", () => {
    for (const item of TOOL_ITEMS) {
      assert.ok(item.paste.includes(item.detail), item.label);
    }
  });

  it("tells players to merge into an existing hooks section for the files they may already have", () => {
    for (const item of TOOL_ITEMS) {
      const shared = item.tool === AgentTool.ClaudeCode || item.tool === AgentTool.Cursor || item.tool === AgentTool.Codex;
      assert.equal(item.paste.includes('If it already has a "hooks" section'), shared, item.label);
      assert.equal(item.paste.includes("instead of pasting a second object"), shared, item.label);
    }
  });
});

describe("hookSnippet", () => {
  it("parses as JSON with a hooks object, for every tool in every editor", () => {
    for (const scheme of SCHEMES) {
      for (const { tool } of TOOL_ITEMS) {
        const snippet = JSON.parse(hookSnippet(tool, editorFor(scheme))) as Record<string, unknown>;
        assert.equal(typeof snippet.hooks, "object", `${tool} in ${scheme}`);
      }
    }
  });

  it("has exactly two commands, started then finished, that only open a signal link with the matching launcher", () => {
    for (const scheme of SCHEMES) {
      for (const { tool } of TOOL_ITEMS) {
        const editor = tool === AgentTool.Cursor ? CURSOR : editorFor(scheme);
        const found = commands(JSON.parse(hookSnippet(tool, editorFor(scheme))));
        assert.deepEqual(
          found,
          [AgentSignal.Started, AgentSignal.Finished].map((signal) => `${editor.launcher} --open-url "${signalLink(editor, signal)}"`),
          `${tool} in ${scheme}`,
        );
      }
    }
  });

  it("gives the Cursor tool cursor:// and the cursor launcher in every editor", () => {
    for (const scheme of SCHEMES) {
      assert.equal(hookSnippet(AgentTool.Cursor, editorFor(scheme)), hookSnippet(AgentTool.Cursor, CURSOR), scheme);
    }
    assert.match(hookSnippet(AgentTool.Cursor, VS_CODE), /cursor --open-url \\"cursor:\/\//);
  });

  it("in Cursor, links every tool to Cursor's own scheme", () => {
    for (const { tool } of TOOL_ITEMS) {
      const snippet = hookSnippet(tool, editorFor("cursor"));
      assert.doesNotMatch(snippet, /vscode:|\bcode --open-url/, tool);
      assert.match(snippet, /cursor --open-url \\"cursor:\/\/dconyemerekwe\.0xword\/agent-started\\"/, tool);
    }
  });

  it("in Insiders and VSCodium, links the other tools to that editor", () => {
    assert.match(hookSnippet(AgentTool.ClaudeCode, editorFor("vscode-insiders")), /code-insiders --open-url \\"vscode-insiders:\/\//);
    assert.match(hookSnippet(AgentTool.Codex, editorFor("vscodium")), /codium --open-url \\"vscodium:\/\//);
  });

  it("gives both Copilot setups the same snippet, as the guide does", () => {
    for (const scheme of SCHEMES) {
      const editor = editorFor(scheme);
      assert.equal(hookSnippet(AgentTool.CopilotVsCode, editor), hookSnippet(AgentTool.CopilotCli, editor));
    }
  });

  it("gives Claude Code and Codex the same snippet, as the guide does", () => {
    assert.equal(hookSnippet(AgentTool.ClaudeCode, VS_CODE), hookSnippet(AgentTool.Codex, VS_CODE));
  });
});
