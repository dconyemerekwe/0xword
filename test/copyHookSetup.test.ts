// Checks the steps of "0xWORD: Copy agent hook setup" (#114) with fake VS
// Code calls: pick a tool and its snippet is copied, then a message says
// where to paste it; Esc copies and shows nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COPY_FAILED, OPEN_SETTINGS, copiedMessage, copyHookSetup, type CopyHookSetupDeps } from "../src/copyHookSetup.ts";
import { AgentTool, CURSOR, TOOL_ITEMS, VS_CODE, editorFor, hookSnippet, type ToolItem } from "../src/hookSnippets.ts";

/** What the fake VS Code saw. */
interface Calls {
  picked: (readonly ToolItem[])[];
  copied: string[];
  messages: { message: string; offerSettings: boolean }[];
  failures: string[];
  settingsReads: number;
}

/** Fake VS Code calls: the list resolves to `choice`, the clipboard works unless `copyFails`. */
function fake(
  choice: AgentTool | undefined,
  options: { uriScheme?: string; noticesOff?: boolean; copyFails?: boolean } = {},
): { deps: CopyHookSetupDeps; calls: Calls } {
  const calls: Calls = { picked: [], copied: [], messages: [], failures: [], settingsReads: 0 };
  const deps: CopyHookSetupDeps = {
    uriScheme: options.uriScheme ?? "vscode",
    pick: (items) => {
      calls.picked.push(items);
      return Promise.resolve(items.find((item) => item.tool === choice));
    },
    copy: (text) => {
      if (options.copyFails) {
        return Promise.reject(new Error("clipboard"));
      }
      calls.copied.push(text);
      return Promise.resolve();
    },
    noticesOff: () => {
      calls.settingsReads += 1;
      return options.noticesOff ?? false;
    },
    copied: (message, offerSettings) => calls.messages.push({ message, offerSettings }),
    failed: (message) => calls.failures.push(message),
  };
  return { deps, calls };
}

/** The item for `tool`. */
function item(tool: AgentTool): ToolItem {
  const found = TOOL_ITEMS.find((candidate) => candidate.tool === tool);
  assert.ok(found);
  return found;
}

describe("copying a tool's snippet", () => {
  it("shows the five tools, each with its target file", async () => {
    const { deps, calls } = fake(undefined);
    await copyHookSetup(deps);
    assert.deepEqual(calls.picked, [TOOL_ITEMS]);
  });

  for (const { tool, label } of TOOL_ITEMS) {
    it(`copies ${label}'s snippet when it's picked`, async () => {
      const { deps, calls } = fake(tool);
      assert.equal(await copyHookSetup(deps), true);
      assert.deepEqual(calls.copied, [hookSnippet(tool, VS_CODE)]);
    });
  }

  it("copies the snippet for the running editor's scheme", async () => {
    const { deps, calls } = fake(AgentTool.ClaudeCode, { uriScheme: "cursor" });
    await copyHookSetup(deps);
    assert.deepEqual(calls.copied, [hookSnippet(AgentTool.ClaudeCode, CURSOR)]);
  });

  it("copies the guide's snippet in an editor it doesn't know", async () => {
    const { deps, calls } = fake(AgentTool.Codex, { uriScheme: "windsurf" });
    await copyHookSetup(deps);
    assert.deepEqual(calls.copied, [hookSnippet(AgentTool.Codex, editorFor("vscode"))]);
  });
});

describe("the message after copying", () => {
  it("shows once, saying where to paste the snippet, with no button while notices are on", async () => {
    const { deps, calls } = fake(AgentTool.ClaudeCode, { noticesOff: false });
    await copyHookSetup(deps);
    assert.deepEqual(calls.messages, [{ message: copiedMessage(item(AgentTool.ClaudeCode), false), offerSettings: false }]);
    const message = calls.messages[0]?.message ?? "";
    assert.ok(message.includes("Paste it into ~/.claude/settings.json."), message);
    assert.ok(message.includes("setup guide"), message);
    assert.ok(!message.includes("off by default"), message);
  });

  it("also says notices are off by default, and offers Open Settings, while they're off", async () => {
    const { deps, calls } = fake(AgentTool.Cursor, { noticesOff: true });
    await copyHookSetup(deps);
    assert.deepEqual(calls.messages, [{ message: copiedMessage(item(AgentTool.Cursor), true), offerSettings: true }]);
    const message = calls.messages[0]?.message ?? "";
    assert.ok(message.includes("Notices are off by default"), message);
    assert.equal(OPEN_SETTINGS, "Open Settings");
  });

  it("reads the mode after the copy, once", async () => {
    const { deps, calls } = fake(AgentTool.Codex);
    await copyHookSetup(deps);
    assert.equal(calls.settingsReads, 1);
  });

  it("names the tool and tells players to merge into an existing hooks section", () => {
    const message = copiedMessage(item(AgentTool.Codex), false);
    assert.equal(
      message,
      '0xWORD: copied the Codex hook setup. Paste it into ~/.codex/hooks.json. If it already has a "hooks" section, add these entries to it instead of pasting a second object. For details, see the setup guide linked from 0xWORD\'s README.',
    );
  });

  it("tells Copilot players to save a new file in ~/.copilot/hooks/", () => {
    for (const tool of [AgentTool.CopilotVsCode, AgentTool.CopilotCli]) {
      assert.ok(copiedMessage(item(tool), false).includes("Save it as a new .json file in ~/.copilot/hooks/"), tool);
    }
  });

  it("shows a failure instead, and no success message, if the clipboard refuses", async () => {
    const { deps, calls } = fake(AgentTool.ClaudeCode, { copyFails: true, noticesOff: true });
    assert.equal(await copyHookSetup(deps), false);
    assert.deepEqual(calls.messages, []);
    assert.deepEqual(calls.failures, [COPY_FAILED]);
  });
});

describe("pressing Esc in the tool list", () => {
  it("copies nothing, shows no message and doesn't read the settings", async () => {
    const { deps, calls } = fake(undefined, { noticesOff: true });
    assert.equal(await copyHookSetup(deps), false);
    assert.deepEqual(calls.copied, []);
    assert.deepEqual(calls.messages, []);
    assert.deepEqual(calls.failures, []);
    assert.equal(calls.settingsReads, 0);
  });
});
