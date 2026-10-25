# 0xWORD

A "puzzles between prompts" VS Code extension: a short hex-decoding word game to play in a side panel while an AI agent works, instead of doomscrolling. It grew out of the owner's private `wordle` repo (a browser Wordle remake), but shares no code history with it.

The build plan and current phase are in [docs/PLAN.md](docs/PLAN.md). Read it before starting work and keep its status up to date.

## Security rules (mandatory)

These protect the developers who install the extension. Check every change against them. If a change would need an exception (a new dependency, a network call, file access), stop and ask first.

1. **Servers bind to localhost only.** Any dev or static server uses `server.listen(PORT, "127.0.0.1")`, never all interfaces. (The extension itself needs no server.)
2. **Plain text, never HTML.** User input (typed answers, guesses) is rendered with `textContent` or text nodes. Never `innerHTML`, `insertAdjacentHTML` or string-built HTML for anything user-controlled.
3. **Minimal, trusted dependencies.** Zero runtime dependencies. Dev dependencies only from well-known publishers (`typescript`, `esbuild`, `@types/vscode`, `@types/node`, `@vscode/vsce`). Pin exact versions and commit `package-lock.json`. Tests use Node's built-in `node:test`.
4. **Fonts are bundled.** DM Sans and JetBrains Mono ship inside the extension with their OFL licence files. No Google Fonts or any CDN.
5. **Strict webview Content Security Policy.** No outside network access (`default-src 'none'`). Scripts only from the extension's own bundle, loaded with a per-load nonce. No inline scripts and no inline event handlers (`onclick=` etc.); use `addEventListener`.
6. **Webview loads only from `media/`.** `localResourceRoots` is limited to the extension's `media/` folder.
7. **Webview messages are untrusted.** The extension host accepts only an allowlist of message types, validates every field, and never acts on paths, commands or code sent from the webview.
8. **Never touch the user's files.** No workspace or file-system access. The extension reads only its own bundled assets and stores stats in VS Code `globalState`. The webview saves the round in progress in its own VS Code state (`setState`) and treats that saved state as untrusted when it reads it back. Declare support for untrusted workspaces.
9. **No telemetry.** Collect nothing and send nothing, and say so in the README.

## Game rules

- The hidden answer is a 4-letter English word shown as ASCII hex: 2 uppercase digits per letter, 8 digits in total (A–Z = `41`–`5A`).
- Six hex rows. Each digit is scored Wordle-style, with repeated digits handled correctly: right spot, wrong spot, or not in the word.
- **Every hex guess must decode to a real 4-letter word.**
- The player keeps guessing hex and can try the plain-English word only at the decode step: once a scored hex row has all 8 tiles in the right spot (at any row), or once row 6 is scored. The hex then locks and the player gets one try: the right word (in any letter case) solves the round, and a wrong listed word ends it as failed, even if the hex grid was solved. Only listed words are accepted: a malformed or unlisted word is rejected with a plain-text message and doesn't count as the try. Fewer rows used means a better score.
- A hex row the player has already tried in the round is rejected with a plain-text message and doesn't use a row.
- After 6 rows without a fully solved row, the hex grid locks and the player gets the same one try, as a forced final answer.
- **No modes or difficulty levels.** An optional **Hints** button is an on/off toggle, off at the start of each round, that shows, under the grid, the letter of each byte the player has got fully right in one row (both of its tiles in the right spot in the same row), and `?` for the others (e.g. `B ? T E`). A byte whose two tiles were each right only in different rows still shows `?`. Until the decode step the player can turn it on and off any number of times: hints are used purely by choice, with no counter and no "hints left" anywhere. Scoring a hex row turns it off. At the decode step Hints switches off and locks for the rest of the round. The result records how many hints were used: one for each hex row that Hints was turned on for before it was scored, so at most the number of rows used. The result card shows it as "N of 6 rows attempted · M hints used" ("1 hint used", "0 hints used").
- **How to play** (the `?` icon) shows the rules plus an A–Z ASCII cheatsheet, available to everyone.

## Design

- The owner's draft design is [docs/design/0xword-draft-design.pdf](docs/design/0xword-draft-design.pdf), described screen by screen in [docs/design/README.md](docs/design/README.md). Where the draft disagrees with the game rules above, the rules win.
- **Styling follows the mock-ups.** Colours, sizes, spacing and layout come from the mock-ups. Don't substitute a colour or style that differs from them. If an accessibility rule seems to conflict, raise it with the owner instead of changing the design.
  - **Look at the screens:** each page is also a JPEG in [docs/design/pages/](docs/design/pages/) (`page-1.jpg` to `page-5.jpg`), which agents can view with the Read tool. The PDF itself can't be rendered here.
  - **Exact colours:** take them from the colour tables in [docs/design/README.md](docs/design/README.md#colours), which were measured from those images. Don't pick new values.
- Side-panel layout about 400px wide. Screens: mid-game, mid-game with hints on, forced final answer, solved, and How to play.
- Title: `0x` in blue (`#2F6FE4` dark theme, `#2463EA` light theme) JetBrains Mono, followed by `WORD` in DM Sans at weight 1000.
- Fonts: DM Sans for the interface, JetBrains Mono for hex.
- Colours, our own and not Wordle's (dark theme values):
  - right spot: blue `#2F6FE4` with white text
  - wrong spot: orange `#F0A04B` with dark text `#1A1206`
  - not in word: grey `#343944`
  - background `#14161B`, panels `#1D2027`, text `#E8EAF0`
  - wrongly guessed keypad keys are also struck through, so colour isn't the only cue
- Light and dark themes: follow VS Code's theme by default, with a sun/moon toggle to override.
- Tiles are grouped in byte pairs. Below the grid: an answer box, a 16-key hex keypad, then DEL and ENTER.
- The solved screen shows each byte decoding to its letter (`42 → B`), with a New round button.
- Accessibility: touch targets at least 44px, text contrast at least 4.5:1, real `<button>` and `<label>` elements, and reduced motion respected.
- Trademark: never use the name "Wordle" or a "-dle" suffix anywhere in the product.

## Tech stack

- **Extension host:** TypeScript (`src/extension.ts`). It registers an activity-bar view container, a webview view and commands, and stores stats in `globalState`.
- **Webview:** plain HTML, CSS and TypeScript in `media/`, with no framework, bundled by esbuild. It talks to the extension host with `postMessage`.
- **Round state lives in the webview** and is saved with `vscode.setState` and restored with `vscode.getState()`. **Every game action** (new round, guess, answer, hints) **must go through the `changed()` save helper** in `media/main.ts`, or the move is lost when the panel is hidden.
- **Game engine:** pure TypeScript with no VS Code dependency, including the hard-coded word list, so it can be unit-tested with `node --test` (Node 24 runs `.ts` files directly).
- **Distribution:** VS Code Marketplace (`vsce`) and Open VSX (`ovsx`) for Cursor, Windsurf and VSCodium.
- **Later:** Claude Code hooks that open a `vscode://` link to start a round when a prompt is sent.

## Workflow

- Branches: `main` holds releases, `develop` is for integration, and work happens on `feature/<name>` branches with PRs into `develop`. Never commit directly to `main`.
- Commit messages use Conventional Commits, e.g. `feat:`, `fix:`, `docs(readme):`, `style(docs):`, `chore:`.
- Pull before starting work on a shared branch. To reword pushed commits, rebase only over commits that contain no merges, and push with `--force-with-lease`.
- Only commit or push when the owner asks.
- The owner runs the Marketplace and Open VSX logins and handles their access tokens.
- Windows machine: PowerShell is the main shell and Git Bash is also available. `.gitattributes` should force LF line endings.
