# Play while your agent works

> **Planned for Phase 7, partly built.** Built so far: the two links, `…/agent-started` and `…/agent-finished` (#109), and the settings with the three notices they show and hide: the badge, the `0x Round ready` status-bar item and the pop-up (#110), and `open` mode with `delaySeconds` (#111). Nothing shows until you choose `notify` or `open`. Everything else below (the message in the panel when the agent finishes, the **Copy agent hook setup** command and the per-tool snippets) isn't built yet. This is the design, and the setup guide that will ship with it (see [PLAN.md](PLAN.md#phase-7-agent-integration-later)). Each tool's hook details below were checked in October 2026 and get checked again against the tool's own docs when Phase 7 starts. Several of these hook systems are still in preview and change between versions.

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
| `0xword.autoStart.mode` | `off`, `notify`, `open` | `off` | What happens when your agent starts working. `off` shows nothing, so a fresh install stays quiet, and you can pause notices without removing your hooks. Choose `notify` to turn them on. `notify` shows the notices switched on below. `open` opens the 0xWORD panel once your agent has worked for `delaySeconds`, and shows none of the notices. |
| `0xword.notify.badge` | on / off | on | In `notify` mode, a badge on the 0xWORD icon in the activity bar. It shows once you've opened the 0xWORD panel since VS Code started. |
| `0xword.notify.statusBar` | on / off | on | In `notify` mode, `0x Round ready` in the status bar. Click it to open the panel. |
| `0xword.notify.popup` | on / off | off | In `notify` mode, a notification in the corner with **Play** and **Not now**, once each time your agent starts. **Play** opens the panel without touching your round. |
| `0xword.autoStart.delaySeconds` | 0 to 3600 seconds | 20 | In `open` mode only: how long the agent must still be working before the panel opens. Short prompts that finish sooner never open it. `0` opens it as soon as you send a prompt. |

A change applies straight away, even while a notice is showing: turning the status bar off hides it, and choosing `off` clears every notice. Leaving `open` mode while 0xWORD is waiting to open the panel cancels the wait. Choosing `open` while your agent is already working starts nothing until your next prompt, and a new `delaySeconds` applies from your next prompt too. A value in a workspace's settings overrides your user setting. A value that isn't valid, for example a word other than `off`, `notify` or `open` typed into `settings.json`, or a delay that's negative, over 3600 or not a number, counts as that setting's default.

### What you'll see

- **In `off` mode, the default,** nothing shows.
- **In `notify` mode,** the notices you've turned on appear as soon as you send a prompt, and disappear when the agent finishes. Click one to open the panel. Whether VS Code comes forward depends on where your agent runs: a link opened from VS Code's own terminal, with VS Code in front, didn't move keyboard focus, but from a terminal outside VS Code, VS Code comes to the front. The pop-up itself is a normal VS Code notification and doesn't take keyboard focus. VS Code can't close a pop-up for 0xWORD, so a pop-up still showing when the agent finishes stays until you close it.
- **In `open` mode,** the panel opens once the agent has been working for `delaySeconds`, at most once per prompt. If the agent finishes sooner, nothing happens. A round in progress is shown as you left it. If the last round is over (the result card is showing), or you haven't played one yet, a new round starts. The panel opens without taking keyboard focus, so typing elsewhere keeps going there (expected; not yet checked, see check 5 below). The one exception is the first time it opens since VS Code started, if you haven't opened the 0xWORD panel yourself yet: VS Code has no way for an extension to open a view it hasn't loaded without focusing it, so that first time the panel takes keyboard focus. A link from a terminal outside VS Code also brings VS Code to the front as soon as you send the prompt, before the delay. No badge, status-bar item or pop-up shows in this mode.
- **If you interrupt the agent,** some tools may not run their "finished" hook. For example, our understanding (not tested here) is that Claude Code's `Stop` hook doesn't run when you interrupt Claude. 0xWORD then still counts the agent as working, so your next prompt counts as the same run: in `open` mode the panel won't open for that prompt (and in `notify` mode no new pop-up shows). That prompt's own finish resets it, and the prompt after works as usual.
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
- **Only two fixed links do anything.** Any other `vscode://` link to 0xWORD is ignored. Because any program or web page on your machine can open a `vscode://` link, the worst a stray link can do is show or clear a "Round ready" notice, open the 0xWORD panel in `open` mode (never replacing a round in progress, and without taking keyboard focus, except the first time it opens since VS Code started if you haven't opened it yourself), and bring VS Code to the front.
- **Your config files stay yours.** 0xWORD never writes to your agent tool's settings. You add and remove the hooks.

## Still to check before Phase 7 ships

### The owner's checks on Windows (#109)

Checks 1 and 2, and the extra focus check 4, are done; their results are below. Check 3 is still open.

**Setup:** get the `.vsix` for #109: download the `0xword-vsix` artifact from this PR's CI run (Actions tab), or run `npm run package`. Install it (Extensions view → `...` → **Install from VSIX...**) and reload the window. Run the commands below in a PowerShell window outside VS Code, not in VS Code's own terminal, so VS Code isn't already the focused app. Don't open the 0xWORD panel first.

```powershell
code --open-url "vscode://dconyemerekwe.0xword/agent-started"
code --open-url "vscode://dconyemerekwe.0xword/agent-finished"
```

Do the checks in this order. A confirmation dialog may bring VS Code to the front by itself, so the focus check runs only once links go through with no dialog.

1. **Does VS Code ask for confirmation before passing the link on?**
   - Open one VS Code window, then put another app (for example Notepad) in front of it. Click back into the PowerShell window and run the `agent-started` command.
   - Note whether VS Code shows a dialog asking to allow 0xWORD to open the link, and its exact wording and options (for example a "don't ask again" box). **Don't tick "don't ask again" on this first run.**
   - If a dialog showed, note separately whether the dialog itself brought VS Code to the front.
   - If it asks, note whether it asks again for the next link (run `agent-finished`), and again after a restart of VS Code. Once you've answered those, tick "don't ask again" before the focus check.
   - To undo "don't ask again" later, search the Command Palette for "Authorized Extension URIs".
   - **Result:** VS Code shows "Allow an extension to open this URI?" for every link, even after allowing it, until **Don't ask again** is ticked. After that, it stops asking and links go straight through. Players will need to tick it once, and the setup guide (#113) must say so.
2. **Does `code --open-url` bring VS Code to the front?** Only once links go through with no dialog (check 1).
   - Put another app (for example Notepad) in front of VS Code, so VS Code is behind it but not minimised. Click back into the PowerShell window.
   - Run the `agent-started` command. Note whether VS Code comes to the front, its taskbar button flashes, or nothing visible happens, and whether `0x Round ready` shows in VS Code's status bar (bottom right) when you switch back to it.
   - Run `agent-finished` and check the notice goes away.
   - Minimise VS Code and repeat both commands, noting the same things.
   - **Result:** with VS Code behind another app, `code --open-url` from an outside PowerShell window brings VS Code to the front.
3. **Which window gets the link when several are open?**
   - Open two VS Code windows on different folders, A and B. Click into A last, then into the PowerShell window.
   - Run `agent-started` and note which window shows `0x Round ready`: A (the last focused), B, both, neither, a new window opened, or something else (describe it).
   - Click into B, then the PowerShell window, and run `agent-finished`. Note whether the notice in A goes away, stays because B got the link, or something else happens (describe it).
   - Result: not tried yet (see "Still open" below).
4. **Does a link from VS Code's own terminal move keyboard focus?** Added by the owner after check 2.
   - With VS Code already in front and the cursor in the Claude Code prompt box, run `agent-started` from VS Code's own terminal.
   - **Result:** keyboard focus didn't move. Typing stayed in the prompt box, and `0x Round ready` appeared in the status bar.

**What this means:** a link opened from VS Code's own terminal, with VS Code in front, didn't move keyboard focus. From an outside terminal, VS Code comes to the front. Agent hooks run as background processes, which weren't tested.

### The owner's check for `open` mode (#111)

5. **Does the panel open without taking keyboard focus?**
   - Set `0xword.autoStart.mode` to `open`, with `0xword.autoStart.delaySeconds` at 20. Play a row or two, so a round is in progress.
   - Put the cursor in the Claude Code prompt box. Run `agent-started` from VS Code's own terminal, click back into the prompt box, and keep typing, including digits, Backspace and Enter, until well after the 20 seconds are up.
   - Note whether the keys stay in the prompt box when the panel opens, and whether the round is unchanged: the same rows, no new digits, nothing submitted.
   - Try it twice: once with the 0xWORD panel opened earlier in the session (expected: focus stays in the prompt box), and once after a restart of VS Code without opening the panel first (expected: this first open takes keyboard focus, as VS Code has no way to avoid it).
   - Result: not tried yet.

### Still open

- Which window gets the link when several are open (check 3).
- Whether `open` mode opens the panel without taking keyboard focus (check 5).
- Each tool's current hook format, events and output rules, as listed in its section above.
