# Agent integration: the owner's manual checks

> **For the maintainer, not for players.** These are the step-by-step manual checks of how VS Code passes 0xWORD's links on, run by the owner on Windows. Players should read the setup guide, [agent-integration.md](agent-integration.md), which sums up the results under [What's been checked](agent-integration.md#whats-been-checked).

Checks 1, 2 and 4 are done; their results are below. Check 3 (several windows) and check 5 (`open` mode and keyboard focus, with its decode-step cases 5a and 5b) are still open.

## The owner's checks on Windows (#109)

**Setup:** get the `.vsix` for #109: download the `0xword-vsix` artifact from #109's PR's CI run (Actions tab), or run `npm run package`. Install it (Extensions view → `...` → **Install from VSIX...**) and reload the window. Run the commands below in a PowerShell window outside VS Code, not in VS Code's own terminal, so VS Code isn't already the focused app. Don't open the 0xWORD panel first.

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
   - **Result:** VS Code shows "Allow an extension to open this URI?" for every link, even after allowing it, until **Don't ask again** is ticked. After that, it stops asking and links go straight through. Players need to tick it once, which the setup guide says.
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
   - Result: not tried yet (see [Still open](#still-open)).
4. **Does a link from VS Code's own terminal move keyboard focus?** Added by the owner after check 2.
   - With VS Code already in front and the cursor in the Claude Code prompt box, run `agent-started` from VS Code's own terminal.
   - **Result:** keyboard focus didn't move. Typing stayed in the prompt box, and `0x Round ready` appeared in the status bar.

**What this means:** a link opened from VS Code's own terminal, with VS Code in front, didn't move keyboard focus. From an outside terminal, VS Code comes to the front. Agent hooks run as background processes, which weren't tested.

## The owner's check for `open` mode (#111)

5. **Does the panel open without taking keyboard focus?**
   - Set `0xword.autoStart.mode` to `open`, with `0xword.autoStart.delaySeconds` at 20. Play a row or two, so a round is in progress.
   - Put the cursor in the Claude Code prompt box. Run `agent-started` from VS Code's own terminal, click back into the prompt box, and keep typing, including digits, Backspace and Enter, until well after the 20 seconds are up.
   - Note whether the keys stay in the prompt box when the panel opens, and whether the round is unchanged: the same rows, no new digits, nothing submitted.
   - Try it twice: once with the 0xWORD panel opened earlier in the session (expected: focus stays in the prompt box), and once after a restart of VS Code without opening the panel first (expected: VS Code hasn't loaded the panel yet, so this open takes keyboard focus, as VS Code has no way to avoid it).
   - **At the decode step:** play until a row is fully right (or six rows are used), so the panel shows the one-try word box, and don't type in it. Then repeat the steps above, typing letters and Enter in the prompt box, in two ways:
     - **(a) Hidden:** open another view in the same side bar (for example the Explorer), so the 0xWORD panel is hidden behind it before `agent-started`.
     - **(b) Visible:** keep the 0xWORD panel showing, then click into the editor and type there instead of the prompt box.
   - Expected for both (not yet checked): when the panel shows or reloads, it doesn't move focus to its word box, because the panel doesn't have keyboard focus. Your keys stay where you're typing, and nothing is submitted as the word try. When you then click into the panel, the word box takes focus. On a result card, **New round** takes focus at that point instead.
   - Result: not tried yet.

## Still open

- Which window gets the link when several are open (check 3).
- Whether `open` mode opens the panel without taking keyboard focus (check 5), in a round in progress and at the decode step.
- At the decode step, with the panel hidden behind another view in the same side bar (check 5a).
- At the decode step, with the panel visible after clicking into the editor (check 5b).
- Cursor's link scheme and launcher (see the guide's [Cursor](agent-integration.md#cursor) section).
- The output rules the tools' docs leave open: whether Cursor lets a prompt through when `beforeSubmitPrompt` prints nothing, whether Codex's `Stop` is fine with no output, and Copilot's agent hooks in VS Code's exit codes and `agentStop` output.
