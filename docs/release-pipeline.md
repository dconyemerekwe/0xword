# Release pipeline

How a version of 0xWORD gets from `develop` to the VS Code Marketplace. It's built in two parts: Phase 5 adds everything that needs no secrets, and Phase 6 adds publishing (see [PLAN.md](PLAN.md)). Until then, nothing in `.github/workflows/` publishes.

## What's built

| Part | Phase | Status |
|---|---|---|
| `ci.yml` runs on `workflow_call` | 5 | Built (#87) |
| `release.yml` with `verify-tag`, `ci` and `github-release` | 5 | Built (#87). The owner runs the [test-tag checks](#test-tag-checks) once. |
| `publish` job and the Marketplace token | 6 | **Not built.** Today `github-release` follows `ci` directly, a tag creates a GitHub Release only, and no secrets are used. |
| Open VSX | 6 | Not built |

The sections below describe the whole pipeline. Anything about `publish` or approving a release applies from Phase 6.

## In short

- **Nothing publishes on a merge.** Merging into `develop` or `main` only runs CI.
- **A release starts when the owner pushes a version tag** (`v0.1.0`, `v0.2.1`, …) on `main`.
- **Publishing waits for the owner's approval** in the Actions run.
- **Players get the exact `.vsix` that CI built and tested** from the tagged commit. Nothing is rebuilt between testing and publishing.
- **README images come from `main`.** `npm run package` passes `--githubBranch main`, so the Marketplace README loads its images from `https://github.com/dconyemerekwe/0xword/raw/main/…`: they resolve once the release is merged into `main` and the repo is public.

## Workflows

| File | Runs on | Does |
|---|---|---|
| `.github/workflows/ci.yml` (exists) | every PR and push to `develop` or `main`, by hand, and when `release.yml` calls it | typecheck, unit tests, build, package, upload the `.vsix` as the `0xword-vsix` artifact |
| `.github/workflows/release.yml` (exists; Phase 6 adds publishing) | a pushed `v*` tag | checks the tag, runs all of `ci.yml`, creates the GitHub Release; from Phase 6 it publishes first |

`release.yml` doesn't copy any of CI's checks. It calls `ci.yml` through `workflow_call`, so a release goes through exactly the same checks as every PR, and the two can't drift apart.

**How the two behave together:**

- **Permissions:** a called workflow can only keep or lower what its caller gives it, never raise it. Both are `contents: read` here, so the `ci` job can't write.
- **Concurrency:** a called workflow's `github.ref` is the tag, so `ci.yml`'s `cancel-in-progress` group is `ci-refs/tags/v<x>`. Branch and PR runs use other groups and can't cancel it. The one way to hit it is running CI by hand from the Actions tab on that same tag during a release, which can cancel the release's `ci` job. That stops the release safely: `github-release` is skipped and nothing is created, so re-run the failed jobs.
- **Queueing:** a release already running is never cancelled. GitHub keeps only one waiting run per concurrency group, though: if a third tag arrives while one release runs and another waits, the waiting one is cancelled and the new one takes its place. Push release tags one at a time.

## The release jobs

```
push tag v0.2.0
      │
      ▼
 verify-tag ──► ci (calls ci.yml) ──► publish ──► github-release
 tag matches     typecheck, tests,     waits for     release notes
 package.json,   build, package,       the owner's   + the .vsix
 tag is on main  upload the .vsix      approval
```

Each arrow is a `needs:` link: a job runs only if the one before it passed. If any job fails, nothing after it runs and nothing is published.

| Job | What it checks or does | Permissions | Phase |
|---|---|---|---|
| `verify-tag` | The tag equals `v` + the `version` in `package.json`, and the tagged commit is on `main`. Stops a typo'd tag, or a tag on an unmerged branch, before anything is built. | `contents: read` | 5 |
| `ci` | Runs all of `ci.yml` and uploads the `.vsix` inside this same run, where the later jobs can download it. | `contents: read` | 5 |
| `publish` | Waits for the owner's approval, then publishes the downloaded `.vsix` with `vsce publish --packagePath`. The only job that uses the Marketplace token. | `contents: read` | 6 |
| `github-release` | Creates the GitHub Release for the tag, with generated notes and the `.vsix` attached. The only job that can write to the repo. | `contents: write` | 5 (6 adds `publish` before it) |

**Why the token and write access are in separate jobs:** each job gets only what it needs. The job that holds the Marketplace token can't change the repo, and the job that can change the repo never sees the token.

**Why `github-release` runs after `publish`:** a GitHub Release then only appears once the Marketplace has accepted the version, so the repo never shows a release players can't install. In Phase 5, before `publish` exists, `github-release` follows `ci` directly.

The `.vsix` travels inside the run: `ci.yml` uploads the single file `0xword.vsix` as the artifact `0xword-vsix`, and `github-release` downloads that artifact by name into `$RUNNER_TEMP`, which gives `$RUNNER_TEMP/0xword.vsix`. `github-release` has no checkout: `--repo` tells `gh` which repo to use, and `--verify-tag` checks through the GitHub API that the tag exists.

## Why it's split across two phases

- **Phase 5 (Packaging)** adds `verify-tag`, `ci` (plus `on: workflow_call` in `ci.yml`) and `github-release`. Packaging is what these test, and they need no account or token. They can be tried with a test tag before anything is published.
- **Phase 6 (Publish)** adds `publish` between `ci` and `github-release`. It depends on the Marketplace publisher and access token that Phase 6 creates, which the owner provides to the workflow.

## Making a release

1. **Prepare it:** run `/release <patch|minor|major>`. It bumps the version, updates `CHANGELOG.md` and opens a `release/v<x>` PR into `main`.
2. **Merge it:** once CI passes, review and merge the PR into `main`.
3. **Tag it:**
   ```bash
   git checkout main && git pull
   git tag v<x>
   git push origin v<x>
   ```
   This starts `release.yml`.
4. **Approve it (from Phase 6):** open the run in the Actions tab and approve the `publish` job. Rejecting it stops the release, and players see no change.
5. **Sync `develop`:** open a PR from `main` into `develop` so it gets the version bump and changelog.

### When something fails

- **`verify-tag` fails:** the tag doesn't match `package.json`, or isn't on `main`. Delete the tag (`git push origin :refs/tags/v<x>` and `git tag -d v<x>`), fix the version through a PR, and tag again.
- **`ci` fails:** the same as a red PR. Fix it through a PR into `develop`, release again, and use a new tag.
- **`github-release` fails:** read the job log. The tag and the checks are fine, so **Re-run failed jobs** on the same run. If a release for the tag already exists, `gh` refuses to create another; delete it first.
- **`publish` fails after approval (from Phase 6):** read the job log. The Marketplace never accepts the same version twice, so if the version did go out, the next release needs a new version number.

## Test-tag checks

The owner runs these once, to check `release.yml` for real. **Agents never push tags.** GitHub runs the `release.yml` in the tagged commit, so each tag must be on a commit that has it. None of these checks touches the Marketplace, and a deleted tag can be used again.

**When:** checks 1 and 2 work as soon as #87 is merged into `develop`. Check 3 needs `release.yml` and the rest of the code on `main`, which today holds only its initial commit, so it can't run before the first merge from `develop` into `main` (the first `/release` PR, or a `develop` to `main` PR). Run it on that merge, before Phase 6 adds `publish`.

**Check 1: a tag that doesn't match `package.json`.**

```bash
git fetch origin
git tag v9.9.9 origin/develop
git push origin v9.9.9
```

In the Actions tab, the **Release** run must fail at `verify-tag`, on the step *Tag equals package.json version*. `ci` and `github-release` must show as skipped, and no release must appear. Then delete the tag:

```bash
git push origin :refs/tags/v9.9.9
git tag -d v9.9.9
```

**Check 2: a matching tag on a commit not on `main`.** Use the version now in `package.json` on `develop` (`v<x>` below), while `develop` has commits `main` doesn't:

```bash
git tag v<x> origin/develop
git push origin v<x>
```

The run must fail at `verify-tag`, this time on *Tagged commit is on main*, with the later jobs skipped and no release. Delete the tag the same way, with `git push origin :refs/tags/v<x>` and `git tag -d v<x>`.

**Check 3: a matching tag on `main`.** Here `v<x>` is the version in `package.json` on `main`:

```bash
git checkout main && git pull
git tag v<x>
git push origin v<x>
```

All three jobs must pass. The repo's Releases page must then show `v<x>` with generated notes and `0xword.vsix` attached. Download that file, and optionally install it with the [install check](#install-check). Then delete the release and the tag:

```bash
gh release delete v<x> --cleanup-tag --yes
git tag -d v<x>
```

## What the `.vsix` ships

`.vscodeignore` keeps the package to what the extension needs at runtime, plus the files the Marketplace page shows (#86):

| File | Why |
|---|---|
| `dist/extension.cjs` | The built extension host (`main` in `package.json`). Its source map stays out. |
| `media/dist/main.js` | The built webview script. |
| `media/styles.css` | The webview's stylesheet. |
| `media/fonts/DMSans-Variable.ttf`, `media/fonts/JetBrainsMono-Variable.ttf` | The bundled fonts. |
| `media/fonts/DMSans-OFL.txt`, `media/fonts/JetBrainsMono-OFL.txt` | Their OFL licences, which must ship with them. |
| `media/icon.png`, `media/icon.svg` | The Marketplace icon and the activity-bar icon. |
| `README.md`, `CHANGELOG.md` | The Marketplace page and its Changelog tab. |
| `LICENSE`, `package.json` | The licence and the manifest. |

Nothing else ships: no `src/`, tests, `scripts/`, `docs/`, source maps, TypeScript sources or configs (including `media/main.ts`, `media/text.d.ts` and `media/tsconfig.json`), `SECURITY.md`, `media/fonts/README.md`, or dotfiles. The README's images live in `docs/` and still show on the Marketplace, because `vsce` rewrites every relative README link to the repo on `main`.

`test/package.test.ts` checks this in every CI run. It copies the files git tracks to a temporary folder, builds into it with the same esbuild options as `npm run build` (`scripts/builds.ts`), and has `vsce` itself list and pack it. It fails if:

- the package holds a file that isn't on its allowlist, or misses one that is;
- the `.vsix` is larger than **400 KB**. It was **245.52 KB** when the limit was set (#86); the two fonts are most of it. Raise the limit in the test only on purpose, saying why in the PR;
- the packaged README still has a relative link, or an image that doesn't point at `https://github.com/dconyemerekwe/0xword/raw/main/`.

## Install check

Run this once by hand on a `.vsix` before the first release (#86), and again after a change to packaging. It uses a new, empty VS Code profile, so no other extension or setting affects it.

1. Build the package: `npm run package -- --out 0xword-check.vsix` (or download the `0xword-vsix` artifact from a CI run).
2. Open an empty folder in a clean profile: `code --profile 0xword-check <empty folder>`. The first time, this creates the profile. If VS Code asks whether you trust the folder, choose **Trust** (the untrusted check comes last).
3. Run **Extensions: Install from VSIX…** from the Command Palette and choose the `.vsix`.
4. Check each of these:

- [ ] **The panel opens from the activity bar.** The 0xWORD icon is in the activity bar; clicking it opens the panel with a new round, in the bundled fonts (JetBrains Mono for hex, DM Sans for the rest).
- [ ] **A round plays through to the result card.** Guess hex rows until the decode step, type the word, and the result card shows each byte decoding to its letter, "N of 6 rows attempted · M hints used" and a New round button.
- [ ] **The theme follows VS Code.** Switch between a dark and a light colour theme (**Preferences: Color Theme**); the panel follows.
- [ ] **The sun/moon toggle works.** It switches the panel between light and dark, whatever VS Code's theme is.
- [ ] **"0xWORD: New Round" works.** Run it from the Command Palette; a new round starts in the panel.
- [ ] **The panel works in an untrusted workspace.** Run **Workspaces: Manage Workspace Trust**, choose **Don't Trust** (Restricted Mode), reload the window, and check the panel still opens and a round still plays.

Then clean up: uninstall the extension, delete the profile (**Profiles: Delete Profile**), and delete `0xword-check.vsix`.

## `"private": true` in `package.json`

`package.json` keeps `"private": true`. It's an npm setting, not a Marketplace one:

- **npm:** `npm publish` refuses to publish the package, so 0xWORD can't be pushed to the npm registry by mistake.
- **`vsce package` and `vsce publish`:** no effect. `@vscode/vsce` (the version pinned in `package-lock.json`) never reads the field: it isn't checked when packaging or publishing and isn't written into the `.vsix`'s `extension.vsixmanifest`. Checked by searching vsce's code in `node_modules/@vscode/vsce/out/` (#83).
- **The Marketplace:** the extension is public once published. `private` doesn't hide it. The shipped `package.json` still contains the field, which VS Code ignores.

## The design

The workflows as designed, with every action pinned to a full commit SHA. `.github/workflows/` holds what's built: everything below except the `publish` job and the `needs: publish` line, which are Phase 6's.

### Change to `ci.yml` (Phase 5)

Built (#87). `workflow_call` is in its triggers so `release.yml` can run it:

```yaml
on:
  pull_request:
    branches: [develop, main]
  push:
    branches: [develop, main]
  workflow_dispatch:
  # Lets release.yml run these exact checks first.
  workflow_call:
```

### `release.yml`

`publish` is the part still to come, in Phase 6.

```yaml
name: Release

on:
  push:
    tags: ['v*']   # only a pushed tag starting with "v" starts this

permissions:
  contents: read   # jobs below widen this only where needed

# Never cancel a release halfway; a later tag waits for this one to finish.
concurrency:
  group: release
  cancel-in-progress: false

jobs:
  verify-tag:
    name: Tag matches package.json and is on main
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      # fetch-depth 0 also fetches every branch, so origin/main exists below.
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: Tag equals package.json version
        run: |
          expected="v$(node -p "require('./package.json').version")"
          if [ "$GITHUB_REF_NAME" != "$expected" ]; then
            echo "::error::Tag $GITHUB_REF_NAME does not match package.json ($expected)"
            exit 1
          fi
      - name: Tagged commit is on main
        run: |
          if ! git merge-base --is-ancestor "$GITHUB_SHA" origin/main; then
            echo "::error::Tag $GITHUB_REF_NAME is on a commit that isn't on main"
            exit 1
          fi

  ci:
    name: CI
    needs: verify-tag
    uses: ./.github/workflows/ci.yml   # the same checks as every PR

  # Phase 6: not built yet
  publish:
    name: Publish to the VS Code Marketplace
    needs: ci
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: production   # waits for the owner's approval
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
          cache: npm
      - run: npm ci   # installs the vsce version locked in package-lock.json
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: 0xword-vsix
          path: ${{ runner.temp }}
      # Publishes the exact file CI built and tested; nothing is rebuilt.
      - run: npx vsce publish --packagePath "$RUNNER_TEMP/0xword.vsix"
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}

  github-release:
    name: GitHub Release
    needs: publish   # in Phase 5, before publish exists: needs: ci (as built)
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: write   # only this job can create a release
    steps:
      # No checkout: this job needs only the .vsix from ci, and --repo names the repo.
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: 0xword-vsix
          path: ${{ runner.temp }}
      - name: Create the release with the .vsix attached
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "$GITHUB_REF_NAME" "$RUNNER_TEMP/0xword.vsix" \
            --repo "$GITHUB_REPOSITORY" --verify-tag --generate-notes
```

## Rules the pipeline keeps

- **Pinned actions only**, from GitHub itself, each pinned to a full commit SHA.
- **Read-only by default.** Only `github-release` gets `contents: write`.
- **No install scripts.** `npm ci` runs with `.npmrc`'s `ignore-scripts=true`, and `ci.yml` checks every package's registry signature.
- **A small publish job.** The fewer steps run while the token is loaded, the fewer places it could leak from.
- **Nothing about secrets is stored in this repo** beyond the name the publish job reads. The owner provides the token.

## Not included yet

- **Open VSX** (for Cursor, Windsurf and VSCodium). A second publish job, after the `ovsx` decision in Phase 6: either a pinned dev dependency or `npx ovsx@<exact version>`.
- **Pre-releases.** Every approved tag goes to all players. A pre-release channel can be added later with `vsce`'s `--pre-release` flag and a version-number convention.
