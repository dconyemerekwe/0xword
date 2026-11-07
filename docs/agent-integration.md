# Play while your agent works

> **Planned for Phase 7.** None of this is built yet. This is the design, and the setup guide that will ship with it (see [PLAN.md](PLAN.md#phase-7-agent-integration-later)). Each tool's hook details below were checked in October 2026 and get checked again against the tool's own docs when Phase 7 starts. Several of these hook systems are still in preview and change between versions.

0xWORD can tell you a round is ready while your AI agent is working, and get out of the way when it's done. It works with any agent tool that can run a command when you send a prompt and when the agent finishes. This guide covers **Claude Code, GitHub Copilot, Cursor and Codex**.

## How it works

```
you send a prompt ──► the tool's hook runs ──► code --open-url "vscode://…/agent-started"
                                                        │
                                                        ▼
                                          0xWORD shows "Round ready"
                                                        │
the agent finishes ──► the tool's hook runs ──► code --open-url "vscode://…/agent-finished"
                                                        │
                                                        ▼
                                  the notice goes away; a round in progress stays
```

- **Two signals, and nothing else.** The hooks open one of two fixed links: `vscode://<publisher>.<extension-id>/agent-started` or `…/agent-finished`. 0xWORD ignores any other link, and any link with extra parts or arguments.
- **No data is passed.** Hooks are given your prompt by the agent tool, but these hook commands never read it, and the links carry nothing from it. 0xWORD never sees what you asked or what the agent did.
- **You set up the hooks.** 0xWORD never edits your agent tool's config files. You add the hook yourself, using the snippets below. The **0xWORD: Copy agent hook setup** command copies the right one for your tool.
- **Without hooks, nothing changes.** You can always start a round yourself from the panel or with **0xWORD: New Round**.

`<publisher>.<extension-id>` is 0xWORD's ID on the Marketplace. It's set when the extension is first published (Phase 6), and these snippets get the real value then.

## Settings

Find these under **Settings → Extensions → 0xWORD**. VS Code saves them for you, so a choice lasts until you change it, across rounds, restarts and updates. You can also set them per workspace, for example off in one project and on in another.

| Setting | Values | Default | What it does |
|---|---|---|---|
| `0xword.autoStart.mode` | `off`, `notify`, `open` | `notify` | What happens when your agent starts working. `off` ignores the signal, so you can pause this without removing your hooks. `notify` shows a notice. `open` opens the 0xWORD panel. |
| `0xword.notify.badge` | on / off | on | In `notify` mode, a badge on the 0xWORD icon in the activity bar. |
| `0xword.notify.statusBar` | on / off | on | In `notify` mode, `0x Round ready` in the status bar. Click it to open the panel. |
| `0xword.notify.popup` | on / off | off | In `notify` mode, a notification in the corner with **Play** and **Not now**. |
| `0xword.autoStart.delaySeconds` | a number of seconds | 20 | In `open` mode only: how long the agent must still be working before the panel opens. Short prompts that finish sooner never open it. |

### What you'll see

- **In `notify` mode,** the notices you've turned on appear as soon as you send a prompt, and disappear when the agent finishes. They never take focus or cover your code, so a prompt that finishes in seconds costs you nothing. Click one to open the panel.
- **In `open` mode,** the panel opens once the agent has been working for `delaySeconds`.
- **A round in progress is never interrupted.** If the agent finishes mid-round, the panel just says so, and you can finish or leave the round.
- **An unfinished round carries over.** Play a row or two while one prompt runs and pick it up again on the next.

## Setting up your agent tool

Each hook runs one command:

```sh
code --open-url "vscode://<publisher>.<extension-id>/agent-started"
```

and the same with `/agent-finished`. `code` is VS Code's command-line launcher. The Windows and Linux installers usually add it to your PATH. On macOS, open VS Code's Command Palette and run **Shell Command: Install 'code' command in PATH**.

The commands print nothing. Keep it that way: some tools add a hook's output to the conversation or read it as an answer.

### Claude Code

Add this to `~/.claude/settings.json` to use it in every project, or `.claude/settings.json` in a project to use it there only. If the file already has a `hooks` section, add these two entries to it.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "code --open-url \"vscode://<publisher>.<extension-id>/agent-started\"" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "code --open-url \"vscode://<publisher>.<extension-id>/agent-finished\"" }
        ]
      }
    ]
  }
}
```

- `UserPromptSubmit` runs when you send a prompt, and `Stop` runs when Claude finishes its reply.
- Run `/hooks` in Claude Code to check they're loaded.

### GitHub Copilot

Copilot has two hook systems. Both are newer and may change.

- **Copilot agent in VS Code** (agent hooks, in preview): it has `UserPromptSubmit` and `Stop` events, configured in JSON hook files. To be written up from [VS Code's hooks guide](https://code.visualstudio.com/docs/copilot/customization/hooks) and [hooks reference](https://code.visualstudio.com/docs/agents/reference/hooks-reference) when Phase 7 starts. Organisations can turn hooks off.
- **Copilot CLI:** hooks live in a `hooks.json` with `"version": 1`, and each entry gives both a `bash` and a `powershell` command so it runs on every OS. It has a `userPromptSubmitted` event, but its closest "finished" event is `sessionEnd`, which fires when the whole session ends, not after each reply. Without a per-reply event, the notice would stay up until the session closes. See [GitHub's hooks reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference).

### Cursor

Cursor's hooks live in a `hooks.json`, in your home folder or in a project. It has a `beforeSubmitPrompt` event (when you send a prompt) and a `stop` event (when the agent finishes). See [Cursor's hooks docs](https://cursor.com/docs/agent/hooks).

- `beforeSubmitPrompt` can block a prompt, so check what the hook has to print for the prompt to go through.
- Cursor uses its own link scheme, `cursor://`, and its own launcher. Check both before writing the snippet.

### Codex

Codex CLI has two ways to run a command:

- **Hooks** (experimental, off by default): turned on with a feature flag in `~/.codex/config.toml`. It has `UserPromptSubmit` and `Stop` events, so it can send both signals.
- **`notify`:** an older setting in `config.toml` that runs a command when the agent finishes a turn. It can only send `agent-finished`, so on its own it can't show a notice when you send a prompt.

The hooks format has changed between versions, so this section is written against the current Codex docs when Phase 7 starts.

## Privacy and security

- **No telemetry.** 0xWORD still collects nothing and sends nothing. The hooks only open a link on your own machine.
- **Your prompts stay with your agent tool.** The hook commands never read them, and the links never carry them.
- **Only two fixed links do anything.** Any other `vscode://` link to 0xWORD is ignored. Because any program or web page on your machine can open a `vscode://` link, the worst a stray link can do is show or clear a "Round ready" notice.
- **Your config files stay yours.** 0xWORD never writes to your agent tool's settings. You add and remove the hooks.

## Still to check before Phase 7 ships

- Whether `code --open-url` brings the VS Code window to the front. If it does, it would undo the point of `notify` mode, and a different way to deliver the signal is needed.
- Which window gets the signal when several VS Code windows are open.
- Each tool's current hook format, events and output rules, as listed in its section above.
