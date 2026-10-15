# Build plan

Each phase is split into story issues with `/plan-phase <n>`. Each story is built on a `feature/<issue>-<name>` branch and merged into `develop` through a PR, using `/story #<issue>` (see [Agent workflow](#agent-workflow)). Bug fixes use `fix/<issue>-<name>`. Update the status column as phases finish.

| Phase | What | Status |
|---|---|---|
| 0 | Repo setup and packages | Done |
| 1 | Game engine (pure TypeScript and tests) | Done |
| 2 | Extension shell | **In progress** |
| 3 | Game UI, screen by screen | Not started |
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
- **The round:** 6 rows, one answer try per row, a forced final answer after row 6, the hints letters (a byte shows its letter once both of its digits are in the right spot), and the result (rows used, answer tries, hints used).
- **Round rules (agreed):**
  1. After each scored row the player gets one answer try, which they may skip, except for the forced final answer.
  2. An all-right hex row doesn't win on its own; the player still types the word.
  3. A malformed or unlisted answer is rejected without using up the try.
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
- **Message protocol** (`src/protocol.ts`): typed messages between the game and the extension host. The host accepts only an allowlist (`ready`, `roundFinished`; `setTheme` arrives in Phase 3) and validates every field against the engine's limits. It replies `init` to `ready`.
- **New Round command** (`0xword.newRound`, "0xWORD: New Round"): opens the panel and posts `newRound` (host → webview, no fields). If the webview isn't listening yet (closed, hidden or loading), each run is counted (`src/newRoundRequests.ts`) and sent after `ready` → `init`, so every run starts exactly one new round. The round lives in the webview: a `Session` (`src/game/session.ts`) starts a fresh engine `Round` for every `newRound`, and for `init` only if no round was restored. The placeholder shows "Round N".
- **Round persistence (owner's decision on PR #16):** the webview saves the session (version, round number and the whole round, answer included) with `vscode.setState` after every change, and restores it with `vscode.getState()` before it sends `ready`. So hiding, collapsing or reloading the panel keeps the round. No `retainContextWhenHidden` and no host-side store: VS Code keeps a webview view's state while it's hidden and across restarts. Saved state is untrusted: `Session.fromState` / `Round.fromState` check it strictly (exact keys, known version, the answer in the word list) and replay every saved guess and answer through the engine. Anything that doesn't match is dropped and a fresh session starts. The answer stays in that webview-only storage; it's never put in the DOM or in a message to the host.
- **Stats** saved in `context.globalState`: played, solved, average rows, and the hints-used rate.
- **Check:** pressing F5 opens the panel.

## Phase 3: Game UI

Build each screen from the design mock, in this order:

1. Grid of 6 rows × 4 byte pairs, plus the hex keypad (0–F, DEL, ENTER) with key states and physical keyboard input
2. The answer box (one try per row) and the forced final answer state (grid and keypad locked)
3. The Hints toggle and the `B ? T E` strip
4. The solved card: the byte → letter breakdown, rows and tries, New round and Copy result
5. How to play: the rules plus the A–Z cheatsheet (`4_` is A–O, `5_` is P–Z)
6. Theme: follow VS Code's theme (`body.vscode-dark` / `vscode-light`), with the sun/moon toggle as an override
7. Bundle the DM Sans and JetBrains Mono font files with their OFL licences, loaded with `@font-face` from `media/fonts/`

## Phase 4: Hardening and accessibility

- Unit tests that the extension host rejects unknown or malformed messages.
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

- A Claude Code `UserPromptSubmit` hook opens `vscode://<publisher>.<id>/start` to start a round. A `Stop` hook shows an "agent finished" notice in the panel.
- The URI handler accepts only fixed paths with no arguments, following the untrusted-input rule.
