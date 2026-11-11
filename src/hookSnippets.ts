// The hook setup the "0xWORD: Copy agent hook setup" command copies: one JSON
// snippet per agent tool, word for word as in the setup guide
// (docs/agent-integration.md). Pure: no `vscode` import, so it can be
// unit-tested with `node --test`.
//
// The editor's link scheme (`vscode.env.uriScheme`) is only a lookup key. The
// scheme and launcher in a snippet always come from the fixed `EDITORS` table,
// and every link is checked with `readAgentSignal`, so a snippet can only ever
// open one of the two signal links, with nothing else in it.

import { AgentSignal, readAgentSignal } from "./agentSignals.ts";

/** 0xWORD's extension ID, the host of every link: `<publisher>.<name>` in package.json. */
export const EXTENSION_ID = "dconyemerekwe.0xword";

/** An editor the hooks can signal: its link scheme and its command-line launcher. */
export interface Editor {
  readonly scheme: string;
  readonly launcher: string;
}

/** Stable VS Code, which the guide's snippets use. */
export const VS_CODE: Editor = { scheme: "vscode", launcher: "code" };

/** Cursor, as the guide's Cursor snippet assumes (not yet tested). */
export const CURSOR: Editor = { scheme: "cursor", launcher: "cursor" };

/**
 * The editors whose scheme and launcher are known, by their scheme. Insiders
 * and VSCodium are named in the guide's known limits, and not yet tested.
 */
const EDITORS: ReadonlyMap<string, Editor> = new Map([
  [VS_CODE.scheme, VS_CODE],
  ["vscode-insiders", { scheme: "vscode-insiders", launcher: "code-insiders" }],
  ["vscodium", { scheme: "vscodium", launcher: "codium" }],
  [CURSOR.scheme, CURSOR],
]);

/**
 * The editor the player runs, from its link scheme (`vscode.env.uriScheme`).
 * Any scheme not in the table gets stable VS Code, as the guide does.
 */
export function editorFor(uriScheme: unknown): Editor {
  return (typeof uriScheme === "string" ? EDITORS.get(uriScheme) : undefined) ?? VS_CODE;
}

/** The agent tools the guide covers, one per section. */
export const AgentTool = {
  ClaudeCode: "claude-code",
  CopilotVsCode: "copilot-vscode",
  CopilotCli: "copilot-cli",
  Cursor: "cursor",
  Codex: "codex",
} as const;
export type AgentTool = (typeof AgentTool)[keyof typeof AgentTool];

/** How the tool list shows a tool, and where its snippet goes. */
export interface ToolItem {
  readonly tool: AgentTool;
  /** The tool's name, as the guide's section heading. */
  readonly label: string;
  /** The file the snippet goes in, shown under the name. */
  readonly detail: string;
  /** Where to paste it, said after copying. */
  readonly paste: string;
}

/** Said for a file the player may already have, as the guide says (#120). */
const MERGE = 'If it already has a "hooks" section, add these entries to it instead of pasting a second object.';

/** Said for both Copilot setups, which share one new file. */
const COPILOT_PASTE = "Save it as a new .json file in ~/.copilot/hooks/, for example ~/.copilot/hooks/0xword.json.";

/** The tool list, in the guide's order. */
export const TOOL_ITEMS: readonly ToolItem[] = [
  {
    tool: AgentTool.ClaudeCode,
    label: "Claude Code",
    detail: "~/.claude/settings.json",
    paste: `Paste it into ~/.claude/settings.json. ${MERGE}`,
  },
  {
    tool: AgentTool.CopilotVsCode,
    label: "GitHub Copilot agent hooks in VS Code",
    detail: "~/.copilot/hooks/0xword.json",
    paste: COPILOT_PASTE,
  },
  {
    tool: AgentTool.CopilotCli,
    label: "Copilot CLI",
    detail: "~/.copilot/hooks/0xword.json",
    paste: COPILOT_PASTE,
  },
  {
    tool: AgentTool.Cursor,
    label: "Cursor",
    detail: "~/.cursor/hooks.json",
    paste: `Paste it into ~/.cursor/hooks.json. ${MERGE}`,
  },
  {
    tool: AgentTool.Codex,
    label: "Codex",
    detail: "~/.codex/hooks.json",
    paste: `Paste it into ~/.codex/hooks.json. ${MERGE}`,
  },
];

/**
 * The link for `signal` in `editor`'s scheme. Throws if it isn't exactly one
 * of the two signal links for 0xWORD, as the URI handler reads them: that
 * can't happen with the fixed table, and stops a snippet ever carrying more.
 */
export function signalLink(editor: Editor, signal: AgentSignal): string {
  const link = `${editor.scheme}://${EXTENSION_ID}/agent-${signal}`;
  const url = new URL(link);
  const valid =
    url.href === link &&
    url.protocol === `${editor.scheme}:` &&
    url.host === EXTENSION_ID &&
    EDITORS.get(editor.scheme) === editor &&
    readAgentSignal({ path: url.pathname, query: url.search, fragment: url.hash }) === signal;
  if (!valid) {
    throw new Error("0xWORD: not a signal link");
  }
  return link;
}

/** A hook command that opens the link for `signal`, as a JSON string's contents: it prints nothing. */
function command(editor: Editor, signal: AgentSignal): string {
  return `${editor.launcher} --open-url \\"${signalLink(editor, signal)}\\"`;
}

/** Claude Code's and Codex's format: `UserPromptSubmit` and `Stop`, each with an inner `hooks` list. */
function nestedHooks(editor: Editor): string {
  return `{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "${command(editor, AgentSignal.Started)}" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "${command(editor, AgentSignal.Finished)}" }
        ]
      }
    ]
  }
}`;
}

/** Copilot's format, shared by its agent hooks in VS Code and Copilot CLI. */
function copilotHooks(editor: Editor): string {
  return `{
  "version": 1,
  "hooks": {
    "userPromptSubmitted": [
      { "type": "command", "command": "${command(editor, AgentSignal.Started)}", "timeoutSec": 10 }
    ],
    "agentStop": [
      { "type": "command", "command": "${command(editor, AgentSignal.Finished)}", "timeoutSec": 10 }
    ]
  }
}`;
}

/** Cursor's format: `beforeSubmitPrompt` and `stop`. */
function cursorHooks(editor: Editor): string {
  return `{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      { "command": "${command(editor, AgentSignal.Started)}" }
    ],
    "stop": [
      { "command": "${command(editor, AgentSignal.Finished)}" }
    ]
  }
}`;
}

/**
 * The snippet for `tool`, for the player's `editor`. The Cursor tool always
 * signals Cursor, as the guide shows; the other tools signal the player's
 * editor. In stable VS Code, each is the guide's snippet word for word.
 */
export function hookSnippet(tool: AgentTool, editor: Editor): string {
  switch (tool) {
    case AgentTool.ClaudeCode:
    case AgentTool.Codex:
      return nestedHooks(editor);
    case AgentTool.CopilotVsCode:
    case AgentTool.CopilotCli:
      return copilotHooks(editor);
    case AgentTool.Cursor:
      return cursorHooks(CURSOR);
  }
}
