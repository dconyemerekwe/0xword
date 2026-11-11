// Checks the steps of "0xWORD: Copy agent hook setup" (#114) with fake VS
// Code calls: pick a tool and its snippet is copied, then a message says
// where to paste it; Esc copies and shows nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COPY_FAILED, CURSOR_UNTESTED, OPEN_SETTINGS, copiedMessage, copyHookSetup, type CopyHookSetupDeps } from "../src/copyHookSetup.ts";
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
    assert.deepEqual(calls.messages, [{ message: copiedMessage(item(AgentTool.ClaudeCode), VS_CODE, false), offerSettings: false }]);
    const message = calls.messages[0]?.message ?? "";
    assert.ok(message.includes("Paste it into ~/.claude/settings.json."), message);
    assert.ok(message.includes("setup guide"), message);
    assert.ok(!message.includes("off by default"), message);
  });

  it("also says notices are off by default, and offers Open Settings, while they're off", async () => {
    const { deps, calls } = fake(AgentTool.Cursor, { noticesOff: true });
    await copyHookSetup(deps);
    assert.deepEqual(calls.messages, [{ message: copiedMessage(item(AgentTool.Cursor), VS_CODE, true), offerSettings: true }]);
    const message = calls.messages[0]?.message ?? "";
    assert.ok(message.includes("Notices are off by default"), message);
    assert.equal(OPEN_SETTINGS, "Open Settings");
  });

  it("reads the mode after the copy, once", async () => {
    const { deps, calls } = fake(AgentTool.Codex);
    await copyHookSetup(deps);
    assert.equal(calls.settingsReads, 1);
  });

  /** The guide's pointer, the end of every message while notices are on. */
  const GUIDE = "For details, see the setup guide linked from 0xWORD's README.";

  it("gives each tool its full message in VS Code, while notices are on", () => {
    const merge =
      "If the file already exists, don't paste a second object: merge these entries into its \"hooks\" section, adding to any list that's already there.";
    const copilot =
      "Save it as a new .json file in ~/.copilot/hooks/, for example ~/.copilot/hooks/0xword.json. If you already saved it for the other Copilot setup, you're done.";
    const expected: Record<AgentTool, string> = {
      [AgentTool.ClaudeCode]: `0xWORD: copied the Claude Code hook setup. Paste it into ~/.claude/settings.json. ${merge} ${GUIDE}`,
      [AgentTool.CopilotVsCode]: `0xWORD: copied the GitHub Copilot agent hooks in VS Code hook setup. ${copilot} ${GUIDE}`,
      [AgentTool.CopilotCli]: `0xWORD: copied the Copilot CLI hook setup. ${copilot} ${GUIDE}`,
      [AgentTool.Cursor]:
        "0xWORD: copied the Cursor hook setup. Paste it into ~/.cursor/hooks.json. If the file already exists, keep its one \"version\" and don't paste a second object: merge these entries into its \"hooks\" section, adding to any list that's already there. " +
        `Cursor support isn't tested yet: check it before relying on it. ${GUIDE}`,
      [AgentTool.Codex]: `0xWORD: copied the Codex hook setup. Paste it into ~/.codex/hooks.json. ${merge} ${GUIDE}`,
    };
    for (const { tool } of TOOL_ITEMS) {
      assert.equal(copiedMessage(item(tool), VS_CODE, false), expected[tool], tool);
    }
  });

  it("starts the merge advice from the file existing, never from a hooks section existing", () => {
    for (const tool of [AgentTool.ClaudeCode, AgentTool.Cursor, AgentTool.Codex]) {
      const message = copiedMessage(item(tool), VS_CODE, false);
      assert.ok(message.includes("If the file already exists, "), tool);
      assert.ok(message.includes("don't paste a second object"), tool);
      assert.ok(message.includes("adding to any list that's already there"), tool);
      assert.doesNotMatch(message, /If it already has|already has a "hooks"/, tool);
    }
  });

  it("tells Cursor players to keep the file's one version", () => {
    assert.ok(copiedMessage(item(AgentTool.Cursor), VS_CODE, false).includes('keep its one "version"'));
    assert.ok(!copiedMessage(item(AgentTool.Codex), VS_CODE, false).includes('"version"'));
  });

  it("tells Copilot players to save a new file in ~/.copilot/hooks/, once for both setups", () => {
    for (const tool of [AgentTool.CopilotVsCode, AgentTool.CopilotCli]) {
      const message = copiedMessage(item(tool), VS_CODE, false);
      assert.ok(message.includes("Save it as a new .json file in ~/.copilot/hooks/"), tool);
      assert.ok(message.includes("If you already saved it for the other Copilot setup, you're done."), tool);
    }
  });

  it("says Cursor isn't tested yet for the Cursor item in any editor, and for every item in Cursor", async () => {
    for (const { tool } of TOOL_ITEMS) {
      for (const scheme of ["vscode", "vscode-insiders", "cursor"]) {
        const { deps, calls } = fake(tool, { uriScheme: scheme });
        await copyHookSetup(deps);
        const message = calls.messages[0]?.message ?? "";
        const cursor = tool === AgentTool.Cursor || scheme === "cursor";
        assert.equal(message.includes(CURSOR_UNTESTED), cursor, `${tool} in ${scheme}`);
      }
    }
    assert.equal(CURSOR_UNTESTED, "Cursor support isn't tested yet: check it before relying on it.");
  });

  it("puts the notices note last, after the guide", () => {
    const message = copiedMessage(item(AgentTool.ClaudeCode), CURSOR, true);
    assert.ok(message.endsWith(`${CURSOR_UNTESTED} ${GUIDE} Notices are off by default: turn them on in 0xWORD's settings.`), message);
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
