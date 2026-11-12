// Runs "0xWORD: Copy agent hook setup": the player picks an agent tool, its
// hook snippet goes on the clipboard, and a message says where to paste it.
// Pure: VS Code's calls come in as functions, so the steps can be
// unit-tested with `node --test`. src/extension.ts passes the real ones.
//
// It never reads or writes a file: the hooks stay the player's to add.

import { AgentTool, CURSOR, editorFor, hookSnippet, TOOL_ITEMS, type Editor, type ToolItem } from "./hookSnippets.ts";

/** The button that opens 0xWORD's settings, offered while notices are off. */
export const OPEN_SETTINGS = "Open Settings";

/** Where the message points for more help. */
const GUIDE = "For details, see the setup guide linked from 0xWORD's README.";

/** Added for the Cursor item, or in Cursor, whose scheme and launcher aren't tested yet. */
export const CURSOR_UNTESTED = "Cursor support isn't tested yet: check it before relying on it.";

/** Added to the message while notices are off. */
const NOTICES_OFF = "Notices are off by default: turn them on in 0xWORD's settings.";

/** Shown if the clipboard refused the snippet. */
export const COPY_FAILED = "0xWORD: couldn't copy the hook setup. The setup guide linked from 0xWORD's README has every snippet.";

/** What the command needs from VS Code. */
export interface CopyHookSetupDeps {
  /** The editor's link scheme, `vscode.env.uriScheme`. */
  readonly uriScheme: string;
  /** Shows the tool list; resolves to the picked item, or undefined on Esc. */
  readonly pick: (items: readonly ToolItem[]) => PromiseLike<ToolItem | undefined>;
  /** Puts the text on the clipboard. */
  readonly copy: (text: string) => PromiseLike<void>;
  /** True if `0xword.autoStart.mode` is `off`, read through the settings reader. */
  readonly noticesOff: () => boolean;
  /** Shows a non-modal message, with an Open Settings button if `offerSettings`. */
  readonly copied: (message: string, offerSettings: boolean) => void;
  /** Shows a non-modal message that the copy failed. */
  readonly failed: (message: string) => void;
}

/**
 * The message after copying `item`'s snippet for `editor`: where to paste
 * it, that Cursor isn't tested yet if the snippet signals Cursor, where to
 * read more and, while notices are off, that they're off by default.
 */
export function copiedMessage(item: ToolItem, editor: Editor, noticesOff: boolean): string {
  const parts = [`0xWORD: copied the ${item.label} hook setup.`, item.paste];
  if (item.tool === AgentTool.Cursor || editor === CURSOR) {
    parts.push(CURSOR_UNTESTED);
  }
  parts.push(GUIDE);
  if (noticesOff) {
    parts.push(NOTICES_OFF);
  }
  return parts.join(" ");
}

/**
 * Shows the tool list and copies the picked tool's snippet. Esc copies
 * nothing and shows nothing. Resolves true once the snippet is copied. A
 * clipboard failure shows a message instead of rejecting.
 */
export async function copyHookSetup(deps: CopyHookSetupDeps): Promise<boolean> {
  const item = await deps.pick(TOOL_ITEMS);
  if (item === undefined) {
    return false;
  }
  const editor = editorFor(deps.uriScheme);
  try {
    await deps.copy(hookSnippet(item.tool, editor));
  } catch {
    deps.failed(COPY_FAILED);
    return false;
  }
  const off = deps.noticesOff();
  deps.copied(copiedMessage(item, editor, off), off);
  return true;
}
