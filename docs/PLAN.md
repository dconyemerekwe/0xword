# Build plan

Each phase is split into story issues with `/plan-phase <n>`. Each story is built on a `feature/<issue>-<name>` branch and merged into `develop` through a PR, using `/story #<issue>` (see [Agent workflow](#agent-workflow)). Bug fixes use `fix/<issue>-<name>`. Update the status column as phases finish.

| Phase | What | Status |
|---|---|---|
| 0 | Repo setup and packages | Done |
| 1 | Game engine (pure TypeScript and tests) | Done |
| 2 | Extension shell | Done (#5; stories #6–#9) |
| 3 | Game UI, screen by screen | **Next** |
| 4 | Hardening and accessibility | Not started |
| 5 | Packaging | Not started |
| 6 | Publish | Not started |
| 7 | Agent integration (later) | Not started |

## CI (GitHub Actions)

Built on its own `feature/ci` branch and merged into `develop` before the Phase 1 PR, so that PR is the first one CI checks. One workflow, `.github/workflows/ci.yml`, runs on every pull request into `develop` or `main` and on pushes to both.

- **Steps:** `npm ci` (clean install from `package-lock.json`, install scripts off via `.npmrc`), `npm audit signatures` (checks every package was signed by the npm registry), `npm run typecheck`, `npm test`, `npm run build`, then `npx vsce package`, which catches manifest mistakes such as `@types/vscode` being newer than `engines.vscode`. The `.vsix` is uploaded as the `0xword-vsix` artifact (kept 14 days) so the owner can playtest each PR with "Install from VSIX…". The workflow can also be run by hand from the Actions tab.
- **Runner:** `ubuntu-latest` with Node 24 (`actions/setup-node`, `cache: npm`).
- **Locked down:** only GitHub's own actions (`actions/checkout`, `actions/setup-node`, `actions/upload-artifact`), each pinned to a full commit SHA rather than a tag. `permissions: contents: read`. No secrets in the workflow.
- **Secret scanning:** the repo is private for now, so rely on the local gitleaks pre-commit hook plus vsce's own secret check when packaging. Before publishing, make the repo public (SECURITY.md's private vulnerability reporting needs that) and turn on GitHub secret scanning with push protection, which is free for public repos. A gitleaks step in CI would add a new tool and needs the owner's approval first.
- **Dependabot (security updates only):** `.github/dependabot.yml` watches npm and the pinned GitHub Actions. When a known vulnerability affects one, Dependabot opens a PR into `develop` that bumps it to the lowest fixed version. Routine version-bump PRs are off (`open-pull-requests-limit: 0`). Dependabot never merges: CI runs on its PR and the owner reviews and merges. Alerts are under Security → Dependabot. `develop` is the default branch, so these PRs target it.
- **No publishing from CI.** The owner publishes by hand (Phase 6), so no Marketplace or Open VSX tokens are stored in GitHub.
- **Branch protection** on `develop` and `main`: changes go in only through a PR, the CI check *Typecheck, test, build and package* must pass, and one approving review is required. Nobody pushes directly to either branch, agents included. GitHub doesn't let the owner approve their own PRs (including those agents open under the owner's account), so the owner reviews them and merges with the admin bypass. Dependabot's PRs can be approved normally.

## Agent workflow

Claude Code agents in `.claude/agents/` and skills in `.claude/skills/` do the building; the owner approves stories, playtests, and merges.

- **Agents:** `developer` builds stories and fixes bugs with unit tests, then pushes its branch. `reviewer` (read-only) checks each branch against the acceptance criteria and the security rules. `qa-engineer` tests each PR and files bugs as issues with a failing test.
- **`/plan-phase <n>`:** proposes the phase's stories with acceptance criteria. After the owner approves, it creates a phase issue with one story sub-issue per slice. Safe to re-run; it never duplicates a story.
- **`/story #<issue>`:** takes one story or bug to ready-to-merge: build → review → PR into `develop` → CI → QA → fix `blocks-pr` bugs → hand over. Progress is tracked in a status comment on the issue, so it resumes instead of starting twice.
- **`/release <patch|minor|major>`:** bumps the version, updates `CHANGELOG.md`, and opens the release PR into `main`. The owner tags and publishes (Phase 6).
- **Labels:** `phase` (phase issue), `phase-<n>`, `story`, `bug`, `in-progress`, `in-review`, `blocks-pr` (bug blocking an open PR), `agent-found` (filed by `qa-engineer`).
- **Owner's checkpoints:** approve the stories, merge each PR after playtesting the CI-built `.vsix`, and tag and publish releases.

## Phase 0: Repo setup and packages

Already done: the GitHub repo `dconyemerekwe/0xword` exists with an MIT `LICENSE`, the Node `.gitignore`, and `main` as its default branch. (Later changed: `develop` is now the default branch, so Dependabot PRs target it.) Local `develop` and `feature/repo-setup` branches exist but aren't pushed yet.

1. **Branches.** Push `develop` and make it the base for work. Replace the loose `feature` branch with properly named `feature/<name>` branches, starting with `feature/repo-setup`.
2. **`.gitignore`.** Add `*.vsix` and `.vscode-test/`, and make sure `dist/` is ignored.
3. **`.gitattributes`.** Force LF line endings with `* text=auto eol=lf`.
4. **`package.json`.** Write it by hand instead of using Microsoft's `yo code` template, which pulls in ESLint, Mocha and other dependencies. Include:
   - `name`, `displayName` "0xWORD", `publisher`, `version` 0.0.1, `license` MIT, and `engines.vscode`
   - zero `dependencies`
   - `devDependencies` pinned to exact versions: `typescript`, `esbuild`, `@types/vscode`, `@types/node`, `@vscode/vsce`
   - scripts: `build` (esbuild), `watch`, `typecheck` (`tsc --noEmit`), `test` (`node --test`), `package` (`vsce package`)
   - commit `package-lock.json`
5. **`tsconfig.json`.** Strict mode, targeting the Node version that VS Code ships.
6. **`.vscode/launch.json` and `tasks.json`.** So F5 builds the extension and opens an Extension Development Host window. Commit them.
7. **`README.md`.** A short description, how to run it in development, and "No telemetry". Link to `SECURITY.md`.
8. **Word list.** `src/game/words.txt`: one hand-written list of about 1,400 common 4-letter words, one per line, uppercase A–Z, sorted, no duplicates. It serves as both the valid guesses and the answer pool, and each round picks its answer at random from it. Only words are stored; hex is derived with `wordToHex`. Simple plurals and offensive or crude words are left out. The extension bundle inlines the file with esbuild's text loader (`--loader:.txt=text`), so the extension never reads it from disk. (The old repo's `words.txt` couldn't be used because it holds only 5-letter words.)
9. **`.npmrc`.** `ignore-scripts=true` (no dependency install scripts run, locally or in CI) and `save-exact=true`.

**Not migrating:** the Java game, `server.js` (no server is needed), and the compiled `.class` files. The old browser version had no npm packages, so there are no dependencies to migrate. What carries over is code and assets: the scoring logic in Phase 1, and the theme and colour approach in Phase 3.

## Phase 1: Game engine

`src/game/` contains pure TypeScript with no VS Code imports.

- **Hex conversion:** `wordToHex("BYTE")` returns `"42595445"`, and `hexToWord` converts back, rejecting anything that isn't a capital letter (`41`–`5A`).
- **Scoring:** `score(guessHex, answerHex)` gives a right spot / wrong spot / not in word result for each of the 8 digits, handling repeated digits correctly. Port the logic from the old `wordle/web/wordle.js`.
- **Guess checking:** exactly 8 hex digits, every pair a letter, and the decoded word must be in the word list.
- **Answer pick:** a random word from the word list at the start of each round.
- **The round:** 6 rows, optional answer tries once a row is scored, a forced final answer after row 6, the hints letters (a byte shows its letter once both of its digits are in the right spot), and the result (solved, rows used, answer tries, hints used). **Changed in #30:** answer tries are counted apart from rows again.
- **Round rules (agreed):**
  1. The player can keep guessing hex rows and may try the word, any number of times, whenever they like once a row is scored; a wrong listed word uses no row. Once all 6 rows are scored the hex locks and one final answer is forced. **Changed in Phase 3 (owner's decision on #30):** #20 had made one try compulsory after every row; that came from a misreading and is reversed. There is still no skip action: the player just submits the next hex row.
  2. An all-right hex row doesn't win on its own; the player still types the word.
  3. A malformed or unlisted answer is rejected without using up the try. So is a word already tried in the round, in any letter case, and a hex row already scored (#30).
  4. A byte's hint letter shows once each of its two digits has been in the right spot, in any rows.
  5. Once hints are enabled the result records them as used.
- **Tests** with `node --test`:
  - scoring cases with repeated digits (e.g. answer BYTE `42595445` against guess TEAM `5445414D` gives wrong spot ×4, not in word ×2, right spot, not in word)
  - the forced final answer
  - hint letters
  - rejection of invalid guesses

## Phase 2: Extension shell

- **`package.json` contributions:** an activity-bar view container with the 0xWORD icon, a webview view, the command `0xword.newRound`, and `capabilities.untrustedWorkspaces.supported: true`.
- **`src/extension.ts`:**
  - registers a `WebviewViewProvider`
  - sets `enableScripts: true` and limits `localResourceRoots` to `media/`
  - generates a fresh nonce on every load for the strict CSP: `default-src 'none'; script-src 'nonce-…'; style-src ${cspSource}; font-src ${cspSource}; img-src ${cspSource}`
- **Message protocol** (`src/protocol.ts`): typed messages between the game and the extension host. The host accepts only an allowlist (`ready`, `roundFinished`; `setTheme` was added in Phase 3, #26) and validates every field against the engine's limits. Host → webview messages are `init` (carrying the stats), sent in reply to `ready`, and `newRound`; the webview checks them just as strictly. Both sides use the same untrusted-data readers in `src/game/plain.ts`.
- **New Round command** (`0xword.newRound`, "0xWORD: New Round"): opens the panel and posts `newRound` (host → webview, no fields). If the webview isn't listening yet (closed, hidden or loading), each run is counted (`src/newRoundRequests.ts`) and sent after `ready` → `init`, so every run starts exactly one new round. The round lives in the webview: a `Session` (`src/game/session.ts`) starts a fresh engine `Round` for every `newRound`, and for `init` only if no round was restored. The placeholder shows "Round N".
- **Round persistence (owner's decision on PR #16):** the webview saves the session (version, round number and the whole round, answer included) with `vscode.setState` after every change, and restores it with `vscode.getState()` before it sends `ready`. So hiding, collapsing or reloading the panel keeps the round. No `retainContextWhenHidden` and no host-side store: VS Code keeps a webview view's state while it's hidden and across restarts. Saved state is untrusted: `Session.fromState` / `Round.fromState` check it strictly (exact keys, known version, the answer in the word list) and replay every saved guess and answer through the engine. Anything that doesn't match is dropped and a fresh session starts. The answer stays in that webview-only storage; it's never put in a message to the host, and goes in the DOM only on the result card once the round is over (#24).
- **Stats** (`src/stats.ts`) saved in `context.globalState` under the one key `0xword.stats.v1`: played, solved, the solved-rows total and the hints-used count. Average rows and the hints-used rate are derived (null before there's anything to divide by). Each valid `roundFinished` adds to them; corrupted stored stats reset to zeros, and a failed write never throws. `init` carries the counts and derived values for Phase 3 to show.
- **Check:** pressing F5 opens the panel.

## Phase 3: Game UI

Rules carried over from Phase 2:

- **Every game action goes through `changed()`** (owner's decision). New round, guess, answer and turning hints on must each end with the `changed()` helper in `media/main.ts`, which saves the session with `setState` and redraws. A move that skips it is lost when the panel is hidden. Route all actions through one function, with a test that every action saves.
- **Send `roundFinished` once, when a round ends** (solved or failed). Never send it when New round replaces an unfinished round, or the stats would count rounds nobody finished.
- **Show the stats** that `init` carries (played, solved, average rows, hints-used rate). **Deferred to a later phase (owner's decision on #24):** the host keeps counting them, but Phase 3 doesn't show them.
- **Manual check:** hide the panel and run New Round straight away. The round must still start; VS Code's behaviour for a message sent to a hidden webview couldn't be tested automatically.

- **No skipping (owner's decision), replaced by optional decoding (#30):** #20 removed `skipAnswer()` and made one word attempt compulsory after every row, and PR #28 dropped `answerTries` because it always equalled rows used. That rule came from a misreading. Since #30 the player guesses hex rows freely and decodes when ready; there is still no skip action.

- **Optional decoding (#30):** a scored row before row 6 no longer blocks the next `submitGuess`: the `answer` phase is gone, so the round is `guess` until row 6 and then `final`. `Round.canDecode` is true once a row is scored and until the round is over: the decode box and its button are enabled then (owner's decision: not before row 1). Word tries are unlimited (owner's decision); a wrong listed word joins the Tried list and uses no row, and a malformed or unlisted word is rejected with a plain-text reason and isn't counted. **Repeats are rejected (owner's decision):** a word already tried in the round (compared in any letter case) gets "You've already tried BEAT", isn't counted and leaves the phase alone, even as the forced final answer; a hex guess already scored gets "You've already tried 42 41 52 4E" (the guess in uppercase byte pairs, as the grid groups them; owner's wording from the PR #42 playtest), keeps its digits and uses no row (the engine's `"repeat"` errors). The keypad, DEL and ENTER stay enabled until row 6, and nothing moves focus to the decode box before the hex locks; after an accepted wrong word, focus goes back to the page, where physical keys drive the hex grid, while a rejected word keeps its text and focus in the box. Wrong-word feedback ("BEAT isn't the word") is for screen readers only. A scored row shows no message: the tile colours show it, and its marks ("Row 2: 4 Right spot, …") are read out from a visually hidden live region (owner's decision). The "1 try per row" note is gone. `answerTries` is back in the result, `roundFinished` and the result card's line, which reads "N of 6 rows · M answer tries · no hints" as page 4 draws it ("1 answer try" in the singular). The host accepts `answerTries` from 1 (every round ends with a word attempt: the right word, or the wrong final answer) up to the word list's size for a solved round (every other word wrong, then the answer) or one less for a failed one (every wrong word), since each listed word counts once. The host doesn't load the list, so `WORD_LIST_SIZE` in `src/game/words.ts` holds the count, and a test keeps it equal to `words.txt`. Saved state is now version 6: the round's `answers` are recorded apart from its rows (any number, including none, but no repeats) and replayed strictly on restore, so a repeated row or word is rejected; version-5 state is dropped, so the panel starts fresh.

- **Grid and decode (#21):** the game screen's logic lives in a pure UI controller, `src/ui/game.ts` (no DOM, no `vscode`): the actions (`init`, `newRound`, `digit`, `delete`, `enter`, `decode`), the messages, the key states and a render model. Its `dispatch` is the one action function, and it always ends with `changed()`; a unit test checks every action type saves. `media/main.ts` is a thin DOM layer that draws the model with `createElement` and `textContent`. All styling is in `media/styles.css`, loaded with a `<link>` under the unchanged CSP. The dark palette and its contrast check are in `src/ui/palette.ts`. Saved state is now version 3: it adds the half-typed hex row (`draft`: up to 8 uppercase hex digits, empty whenever a word attempt is due or the round is over). Version-2 state is dropped, so the panel starts fresh. On purpose, only the hex draft is saved: a word half-typed in the decode box is lost when the panel is hidden, and the box is simply empty again.

- **Final answer (#22):** once all 6 rows are scored and the round isn't over, the view's `hexLocked` is set: the status line shows a lock icon and "Hex locked · all 6 rows used", the grid and keypad are dimmed (keys stay `disabled`), and the decode panel becomes page 3's orange "Final answer" card. It's keyed off the rows, not the phase name, so it doesn't depend on the per-row decode rule. `roundFinished` is sent exactly once per finished round: `dispatch` asks `Session.takeResult()`, which hands out the result once and sets the session's `reported` flag, and passes it to `changed()`, which saves first and then posts. New Round on an unfinished round sends nothing. Saved state is now version 4: it adds `reported` (a boolean, true only for a finished round), so a finished round restored after a hide or reload is never sent again. Version-3 state is dropped.

- **Hints (#23):** the Hints button on the right of the status line is an on/off toggle (`aria-pressed`), off at the start of every round. It can be pressed any number of times while a round is in progress, including at the final answer, and is hidden once the round is over. While it's on, a strip between the grid and the legend shows one dashed cell per byte with its letter or a muted `?` (page 2), read out as one line ("Hints: B, unknown, T, E"). Hints are unlimited: there is no counter anywhere. The engine keeps two flags: the toggle (`hintsShown`, `enableHints()` / `disableHints()`) and the one-way `hintsUsed`, which is set the first time hints are turned on and goes into the result and `roundFinished`. Each toggle is a `toggleHints` action through `dispatch` → `changed()`. Saved state is now version 5: the round adds `hintsShown` (a boolean, true only if `hintsUsed` is). Version-4 state is dropped.

- **Result card (#24):** once a round is over, the view's `result` holds page 4's card, which replaces the legend, the decode panel and the keypad: an outcome line ("Congrats! You cracked it" or "Unlucky!", the owner's wording; not on page 4) above the heading, "Decoded: BYTE" for a solved round or "The word was BYTE" for a failed one, the line "N of 6 rows · M answer tries · no hints" (or "· hints used"; the answer-tries count came back in #30), one tile per byte (`42`, a down arrow, `B`), a **New round** button and, under the card, "Your agent is still working. Next round is ready when you are." The status line reads "4-letter word · solved" or "4-letter word · not solved". `result` is the only part of the view that holds the answer, and it's null while the round is in progress, so the answer goes in the DOM only once the round is over. New round is the existing `newRound` action through `dispatch` → `changed()`, so it posts no `roundFinished`; a finished round restored after a hide or reload brings the card back, and `reported` stops it being posted again. Built in the dark palette from existing dark tokens; the light theme comes with the theme story. No saved-state change.

- **How to play (#25):** the `?` button on the right of the header opens page 5's How to play in place of the game, from any screen; its back arrow or Escape closes it, with focus back on `?`. The rule wording, the cheatsheet line and the 26 cards (`A 41` to `Z 5A`, from the engine's `letterToHex`, which `wordToHex` also uses) are data in `src/ui/howToPlay.ts`, so a later rule change touches only that file. Opening and closing are `openHowToPlay` / `closeHowToPlay` actions through `dispatch` → `changed()`; while it's open the controller ignores every game move (`APPLIES_WHILE_HOW_TO_PLAY_OPEN`, which every action type must be listed in) and the keydown handler passes no key on but Escape, so the game comes back unchanged. Its open state isn't saved: a reload shows the game. No saved-state change. On close, focus goes back to `?` only if How to play was opened from the keyboard; opened with the mouse, focus goes back to the page (or the decode box, if the final answer is due; before #30, whenever a word attempt was due), so a physical Enter or Space can't reopen it. A standing message isn't read out again on close: the view's `noticeId` changes only when an action sets a new message. **Deliberate:** the New Round command keeps How to play open and starts the round behind it.

- **Theme (#26):** the panel follows VS Code's theme by default: `vscode-dark` and `vscode-high-contrast` get the dark palette, `vscode-light` and `vscode-high-contrast-light` the light one from page 4. A sun/moon button next to `?` cycles System → Light → Dark → System; it shows a sun while the dark palette shows and a moon while the light one does, and its accessible name says what the next press does. Both palettes are CSS custom properties in `media/styles.css` (dark in `:root`, light in one rule on `<body>`), matching `DARK_PALETTE` and `LIGHT_PALETTE` in `src/ui/palette.ts`; the webview only sets `data-ox-theme` on `<body>` for a forced choice, so "System" follows a VS Code theme change live with no script. The light values for screens drawn only in dark are derived from page 4's values and listed in [docs/design/README.md](design/README.md#light-values-derived-for-screens-drawn-only-in-dark-26). The webview sends `setTheme {theme}` (`"system"`, `"light"` or `"dark"`; anything else, an extra field or a wrong type is ignored), and the host keeps it in `globalState` under `0xword.theme.v1` (`src/theme.ts`, like the stats store; a corrupt value reads as "system"). `init` carries it, and the host also puts a forced choice on `<body>` in the HTML so the panel doesn't flash the other palette before `init`. VS Code loads the same HTML again when a hidden view is shown, so the host rebuilds it whenever the view is hidden (`viewVisibilityChanged`), never while it's shown. Changing the theme isn't a game action: it doesn't go through `changed()` and isn't in the saved round. No saved-state change. The contrast test covers every text pair in both palettes; page 3's dimmed dark keys (3.42, 2.45 and 3.80:1, `disabled`) are listed for the owner rather than changed.

- **Fonts (#27):** DM Sans and JetBrains Mono are bundled in `media/fonts/` with their OFL licences, downloaded once from `github.com/google/fonts` (`ofl/dmsans`, `ofl/jetbrainsmono`) at a pinned commit and committed unchanged apart from the file names. Only the upright variable files ship: DM Sans covers weights 100 to 1000 (the title's `WORD` is 1000) and JetBrains Mono 100 to 800; no italics are used. `media/fonts/README.md` records each file's source URL, commit and SHA-256, and a test checks every checksum; `.gitattributes` keeps the files byte for byte so the checksums hold on every checkout. `media/styles.css` loads them with `@font-face` by relative URL under the existing `font-src ${cspSource}`, with `font-display: swap`; `--ox-sans` and `--ox-mono` name the bundled family first and keep the system fallbacks after it, so the panel still renders if a font fails to load. No build step fetches anything.

- **No repeats (#34):** built. The repeat rule itself shipped in #30 (PR #42), with its wording; this story added what was left. How to play has a new rule 5, "You can't repeat a hex guess or an English word in the same round. A repeat doesn't use up a row or a try.", so the final-answer rule is now 6 and Hints 7. The engine gained `Round.rowError` and `Round.answerError`, which say why a row or word would be rejected without changing anything (the invalid checks first, then the repeat check); `submitGuess` and `submitAnswer` use them. **Messages survive a hide and show (owner's decision):** the session saves the last rejected move as data, `rejection` (`{kind: "row", error, hex}` or `{kind: "word", error, word}`, with `word` "" for a format error), never as text, and the controller rebuilds the message from it. Every action sets it through `dispatch` → `changed()`, so it's saved with the move, and any other change to the session clears it. On restore it's untrusted. `readRejection` checks its form: exactly those keys, a known error code, a row's `hex` equal to the saved draft while the round waits for a hex row, and a word that's four letters A–Z (or "" exactly for a format error) while the round can take one; a malformed rejection drops the saved state. `stillApplies` then asks the round to work the error out again for that input: if it no longer matches (a later release added the rejected word to the list, say), the round is kept with no message, so adding words never loses a round in progress. A restored message is drawn in the first render, as page content, and `init` keeps it without counting a new notice, so it isn't read out again as new; the same error entered again is. Screen-reader-only announcements and the decode box's text aren't saved. Saved state is now version 7; version-6 state, which can't hold anything version 7 rejects, is still restored with no message, and older state is dropped.

- **Panel fit (#33):** built, CSS only. Every grid row and the hint strip use the same columns, `repeat(4, minmax(--ox-pair-min, 1fr))`, and each pair splits into two equal columns, so an empty tile is exactly the size of a typed or scored one in every state. A tile never gets smaller than a scored tile's content (29.2px: one 18px digit line plus its border); in a narrower panel the grid overflows, as before. Tiles are limited by the panel's height as well as its width: a row's `max-width` leaves room for everything outside the grid (`--ox-around-grid`, 573px, plus 40px while the hint strip shows), with the grid's narrowest width as a floor, so a panel too short still scrolls. The message line keeps its one line but its margins take back 8px of each 12px gap. At 400 × 850 the whole game fits with 41px tiles, as before; with hints on, tiles shrink to fit. The decode box's placeholder ends in an ellipsis when it doesn't fit, while the box isn't focused (Chromium clips a focused box's placeholder).

Build each screen from the owner's draft design, [docs/design/0xword-draft-design.pdf](design/0xword-draft-design.pdf), described page by page in [docs/design/README.md](design/README.md), in this order:

1. Grid of 6 rows × 4 byte pairs, plus the hex keypad (0–F, DEL, ENTER) with key states and physical keyboard input
2. The answer box (optional, unlimited tries once a row is scored, no repeats; #30) and the forced final answer state (grid and keypad locked)
3. The Hints toggle and the `B ? T E` strip
4. The result card, solved or failed: the byte → letter breakdown, rows used and hints, and New round (#24). **Copy result** (a spoiler-free result to share) moves to a later release, like the agent integration, and is on hold pending the owner's decision whether to add it at all.
5. How to play: the rules plus the A–Z cheatsheet (`4_` is A–O, `5_` is P–Z)
6. Theme: follow VS Code's theme (`body.vscode-dark` / `vscode-light`), with the sun/moon toggle as an override
7. Bundle the DM Sans and JetBrains Mono font files with their OFL licences, loaded with `@font-face` from `media/fonts/`

## Phase 4: Hardening and accessibility

- Message validation: Phase 2 already tests that both sides reject unknown or malformed messages and saved state. Re-audit it once Phase 3 adds `setTheme` and any other messages.
- Error handling found by QA in Phase 2: catch a rejected `postMessage` for `init` (it's sent with `void` today), and decide what to do if `postMessage` returns false for a webview that's actually listening (later New Round runs would queue until the next reload).
- Audit the CSP: no inline script, no inline event handlers, nothing loaded from outside.
- Keyboard-only play and focus order, screen-reader labels (`aria-pressed`, `aria-live` status messages), `prefers-reduced-motion`, and contrast checks in both themes.

## Phase 5: Packaging

- A 128×128 PNG icon, a README with screenshots, and a CHANGELOG.
- A `.vscodeignore` that leaves out `src/`, tests, `scripts/`, source maps and `.git`.
- Run `vsce package`, install the `.vsix` locally ("Extensions: Install from VSIX…"), and test it.

## Phase 6: Publish

The owner handles accounts and access tokens.

- Create a VS Code Marketplace publisher and an Azure DevOps access token with the Marketplace (Manage) scope, then run `vsce login` and `vsce publish`.
- For Open VSX: create an Eclipse account, sign the publisher agreement, then publish with `ovsx`. **Open issue:** `ovsx` isn't on the dev-dependency allowlist (security rule 3), and a bare `npx ovsx` runs an unpinned version. Decide before publishing: add it as a pinned dev dependency, or run `npx ovsx@<exact version>`.
- Before publishing, check that the extension ID (lowercase and permanent, e.g. `oxword` or `hexword`) is free in both registries.

## Phase 7: Agent integration (later)

- A Claude Code `UserPromptSubmit` hook opens `vscode://<publisher>.<id>/start` to start a round, reusing the `0xword.newRound` command and its queue. A `Stop` hook shows an "agent finished" notice in the panel.
- The URI handler accepts only fixed paths with no arguments, following the untrusted-input rule.

## Later releases: on hold

- **Copy result** (moved from Phase 3 on #24): page 4's outlined button that copies a spoiler-free result. On hold: the owner will decide whether to add it at all.
- **Show the stats** (deferred from Phase 3 on #24): played, solved, average rows and hints-used rate, from `init`.
