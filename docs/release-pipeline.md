# Release pipeline

How a version of 0xWORD gets from `develop` to the VS Code Marketplace. It was built in two parts: Phase 5 added everything that needs no Marketplace access, and Phase 6 adds publishing (see [PLAN.md](PLAN.md)). **A version tag on `main` can now publish a real version:** read [The `production` environment](#the-production-environment) before pushing any tag.

## What's built

| Part | Phase | Status |
|---|---|---|
| `ci.yml` runs on `workflow_call` | 5 | Built (#87) |
| `release.yml` with `verify-tag`, `ci` and `github-release` | 5 | Built (#87). The owner runs the [test-tag checks](#test-tag-checks) once. |
| `publish` job with Trusted Publishing | 6 | Built (#97), not yet run. **Needs [the `production` environment](#the-production-environment) before any tag is pushed.** `github-release` now follows `publish`. |
| Open VSX | 6 | Not built |

The owner still has to make the repo public, create the environment and recreate the Trusted Publishing policy. None of that is in the workflows.

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
| `.github/workflows/release.yml` (exists) | a pushed `v*` tag | checks the tag, runs all of `ci.yml`, waits for the owner's approval, publishes the `.vsix`, creates the GitHub Release |

`release.yml` doesn't copy any of CI's checks. It calls `ci.yml` through `workflow_call`, so a release goes through exactly the same checks as every PR, and the two can't drift apart.

**How the two behave together:**

- **Permissions:** a called workflow can only keep or lower what its caller gives it, never raise it. Both are `contents: read` here, so the `ci` job can't write.
- **Concurrency:** a called workflow's `github.ref` is the tag, so `ci.yml`'s `cancel-in-progress` group is `ci-refs/tags/v<x>`. Branch and PR runs use other groups and can't cancel it. The one way to hit it is running CI by hand from the Actions tab on that same tag during a release, which can cancel the release's `ci` job. That stops the release safely: `publish` and `github-release` are skipped and nothing is published or created, so re-run the failed jobs.
- **Queueing:** a release already running is never cancelled, and that includes one waiting for the owner's approval, so a later tag waits until it's approved or rejected. GitHub keeps only one waiting run per concurrency group, though: if a third tag arrives while one release runs and another waits, the waiting one is cancelled and the new one takes its place. Push release tags one at a time.

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
| `publish` | Waits for the owner's approval, then publishes the downloaded `.vsix` with `vsce publish --oidc --packagePath`. The only job that can request a Marketplace credential. | `contents: read`, `id-token: write` | 6 |
| `github-release` | Creates the GitHub Release for the tag, with generated notes and the `.vsix` attached. The only job that can write to the repo. | `contents: write` | 5 (6 adds `publish` before it) |

**Why publishing and write access are in separate jobs:** each job gets only what it needs. The job that can publish can't change the repo, and the job that can change the repo can't request a Marketplace credential.

**Why `github-release` runs after `publish`:** a GitHub Release then only appears once the Marketplace has accepted the version, so the repo never shows a release players can't install. A failed or rejected `publish` skips `github-release`.

The `.vsix` travels inside the run: `ci.yml` uploads the single file `0xword.vsix` as the artifact `0xword-vsix`, and `publish` and `github-release` each download that artifact by name into `$RUNNER_TEMP`, which gives `$RUNNER_TEMP/0xword.vsix`. `publish` checks out the tagged commit only for `package-lock.json` and `.npmrc`, so `npm ci` installs the locked `vsce` with install scripts off. `github-release` has no checkout: `--repo` tells `gh` which repo to use, and `--verify-tag` checks through the GitHub API that the tag exists.

## Why it's split across two phases

- **Phase 5 (Packaging)** added `verify-tag`, `ci` (plus `on: workflow_call` in `ci.yml`) and `github-release`. Packaging is what these test, and they need no Marketplace account.
- **Phase 6 (Publish)** adds `publish` between `ci` and `github-release`. It depends on the Marketplace publisher and Trusted Publishing policy, which the owner sets up (see [Trusted Publishing](#trusted-publishing)).

## Making a release

1. **Prepare it:** run `/release <patch|minor|major>`. It bumps the version, updates `CHANGELOG.md` and opens a `release/v<x>` PR into `main`.
2. **Merge it:** once CI passes, review the PR and merge it into `main` with **Create a merge commit**. A squash or rebase would leave `develop`'s commits off `main`.
3. **Tag it:** first run [the environment check](#the-production-environment), and stop unless it prints `PUBLIC` and `dconyemerekwe`. Then:
   ```bash
   git checkout main && git pull
   git tag v<x>
   git push origin v<x>
   ```
   This starts `release.yml`.
4. **Approve it:** open the run in the Actions tab and approve the `publish` job (**Review deployments**, then **Approve and deploy**). Rejecting it stops the release, and players see no change.
5. **Sync `develop`:** open a PR from `main` into `develop` so it gets the version bump and changelog.

### When something fails

- **`verify-tag` fails:** the tag doesn't match `package.json`, or isn't on `main`. Delete the tag (`git push origin :refs/tags/v<x>` and `git tag -d v<x>`), fix the version through a PR, and tag again.
- **`ci` fails:** the same as a red PR. Fix it through a PR into `develop`, release again, and use a new tag.
- **`publish` is rejected:** `github-release` is skipped, no release is created and players see no change. Delete the tag (as for `verify-tag`). The version number is still free.
- **`publish` fails after approval:** `github-release` is skipped and no release is created. Read the job log. The Marketplace never accepts the same version twice, so if the version did go out, the next release needs a new version number. If it says the artifact is missing, the approval came after CI's 14-day retention, and nothing went out. Delete the tag and push the same tag again, with `git push origin :refs/tags/v<x>` and `git push origin v<x>`, which starts a new run that builds a new `.vsix`. A new tag name with the same version would fail `verify-tag`.
- **`github-release` fails:** read the job log. By then the version is on the Marketplace, so don't release it again: choose **Re-run failed jobs** on the same run, which leaves `publish` alone. **Re-run all jobs** would try to publish again, and the Marketplace would refuse the version. If a release for the tag already exists, `gh` refuses to create another; delete it first.

## Test-tag checks

The owner runs these once, to check `release.yml` for real. **Agents never push tags.** A deleted tag can be used again, as long as nothing reached the Marketplace.

**The commit you tag decides what can happen,** because GitHub runs the `release.yml` in the tagged commit:

- **A commit from before the `publish` job:** `3037813`, the last `develop` commit before #97, or anything older. Its `release.yml` has no `publish` job, so nothing in that run can reach the Marketplace. It needs no environment and works while the repo is private. Its `package.json` says `0.0.1`, so its `v<x>` is `v0.0.1`.
- **Any later commit, including the tip of `develop` or `main`:** the run has a `publish` job. **Don't tag one until [the `production` environment](#the-production-environment) is in place,** even for a check you expect to stop at `verify-tag`. These checks test that very guard: if it wrongly let a tag through and there were no approval rule, the tag would publish a real version.

| Check | Tag | What must happen | Can it publish? |
|---|---|---|---|
| 1. Tag doesn't match `package.json` | `v9.9.9` on `3037813` | Fails at `verify-tag`. | No: no `publish` job. |
| 2. Tag not on `main` | `v<x>` on `3037813`, while that commit isn't on `main` | Fails at `verify-tag`. | No: no `publish` job. |
| 3A. Matching tag on `main`, no `publish` job | `v<x>` on `3037813`, once that commit is on `main` | All three jobs pass and a GitHub Release appears. | No: no `publish` job. |
| 3B. Matching tag on `main`, rejected | `v<x>` on `origin/main` | `publish` waits; the owner rejects it. `github-release` is skipped and no release appears. | **Yes, if it's approved or the approval rule is missing.** |

**Check 3 is 3A or 3B.** Tagging `main` can no longer show `github-release` succeeding without publishing, so:

- **3A** shows `github-release` working, on a commit with no `publish` job. It doesn't test the approval.
- **3B** shows the approval stops a release. It can't show `github-release` working: that first happens on the first real release, where a failure is safe to re-run ([When something fails](#when-something-fails)).

Run both if you can, and at least one before the first real release. Always tag the exact commit written in the check: a plain `git tag v<x>` on `main` tags a commit with the `publish` job.

**Check 1: a tag that doesn't match `package.json`.**

```bash
git fetch origin
git tag v9.9.9 3037813
git push origin v9.9.9
```

In the Actions tab, the **Release** run must fail at `verify-tag`, on the step *Tag equals package.json version*. `ci` and `github-release` must show as skipped, and no release must appear. Then delete the tag:

```bash
git push origin :refs/tags/v9.9.9
git tag -d v9.9.9
```

**Check 2: a matching tag on a commit not on `main`.** Run this only while `3037813` isn't on `main`. Check first, by counting that commit's history that `main` doesn't have:

```bash
git fetch origin
git rev-list --count origin/main..3037813
```

Go on only if it prints a number above `0`. `0` means it's on `main`, so don't tag it: it would pass `verify-tag` and reach `github-release`, which creates a release. Skip this check, or use the [repeat on a later commit](#repeating-checks-1-and-2-on-a-later-commit) below. A `fatal:` line means stop too. Then:

```bash
git tag v<x> 3037813
git push origin v<x>
```

The run must fail at `verify-tag`, this time on *Tagged commit is on main*, with the later jobs skipped and no release. Delete the tag the same way, with `git push origin :refs/tags/v<x>` and `git tag -d v<x>`.

**Check 3A: a matching tag on `main`, on a commit with no `publish` job.** `3037813` reaches `main` with the first merge from `develop` into `main` (the first `/release` PR, or a `develop` to `main` PR), as long as that PR is merged with **Create a merge commit**. A squash or rebase leaves it off `main` for good, and then this check can't run: use 3B. Check first, by counting that commit's history that `main` doesn't have:

```bash
git fetch origin
git rev-list --count origin/main..3037813
```

Go on only if it prints `0`. A number above `0` means it isn't on `main` yet, and a `fatal:` line means stop. Then:

```bash
git tag v<x> 3037813
git push origin v<x>
```

`verify-tag`, `ci` and `github-release` must pass, and the run must have no `publish` job. The repo's Releases page must then show `v<x>` with generated notes and `0xword.vsix` attached. If the repo is public, anyone can see that release until it's deleted. Download the file, and optionally install it with the [install check](#install-check). Then delete the release and the tag:

```bash
gh release delete v<x> --cleanup-tag --yes
git tag -d v<x>
```

**Check 3B: a matching tag on `main`, rejected at the approval step.** Here `v<x>` is the version in `package.json` on `main`, the version a real release would publish, so this run can really publish it. First run the [environment check](#the-production-environment), and stop unless it prints `PUBLIC` and `dconyemerekwe`. Then:

```bash
git fetch origin
git tag v<x> origin/main
git push origin v<x>
```

`verify-tag` and `ci` must pass, and `publish` must then wait for review. Open the run, choose **Review deployments**, select `production` and choose **Reject**. **Don't choose Approve and deploy or Start all waiting jobs:** either one publishes a real version, and the Marketplace never accepts that version number again.

`github-release` must stay skipped, and no release must appear. GitHub's docs say a rejected job makes the workflow fail, but not how the job itself displays, so go by those two. Nothing reached the Marketplace, so the same tag can be used for the real release later. Delete the tag:

```bash
git push origin :refs/tags/v<x>
git tag -d v<x>
```

**If `publish` starts without waiting,** the approval rule isn't working. Cancel the run straight away, delete the tag, check the publisher's [manage page](https://marketplace.visualstudio.com/manage) to see whether the version went out, and fix the environment before pushing any other tag.

### Repeating checks 1 and 2 on a later commit

This is optional: it shows `publish` being skipped in a run that has the job. It's only for after [the `production` environment](#the-production-environment) is in place. Follow check 1 or 2, tagging `origin/develop` in place of `3037813`, with `v<x>` from `package.json` on `develop`. For check 2, first make sure `develop` has commits `main` doesn't, because a tag on a commit already on `main` passes `verify-tag` and reaches `publish`:

```bash
git fetch origin
git rev-list --count origin/main..origin/develop
```

Go on only if it prints a number above `0`. `0` or a `fatal:` line means stop.

The run must fail at `verify-tag`, with `ci`, `publish` and `github-release` all skipped. If `publish` ever waits for review in one of these runs, the guard is broken: reject it, delete the tag and report it.

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

## Making the repo public

The owner does these once, in order:

1. Act on the findings listed on #95: keep or remove each one.
2. Make the repo public: **Settings → General → Danger Zone → Change visibility**.
3. Enable private vulnerability reporting in the repo's security settings. `SECURITY.md` sends reporters there.
4. Turn on secret scanning with push protection in the same settings.

## The `production` environment

**`production` must exist, with the owner's approval on it, before any tag is pushed.** `environment: production` in `release.yml` only names an environment; the approval comes from a rule set on it in GitHub. GitHub creates a missing environment automatically, with no approval rule, so the `publish` job wouldn't wait and the tag would publish with nothing stopping it. The only exception is a test tag on a commit with no `publish` job ([Test-tag checks](#test-tag-checks)).

**The repo has to be public first.** From GitHub's docs, read on 2026-11-06:

- [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#required-reviewers): "If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, required reviewers are only available for public repositories." So a paid Pro or Team plan wouldn't help a private repo either.
- [Managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments): on GitHub Free, environments can be configured only for public repositories, and if a repo goes from public back to private, its protection rules "will be ignored". **So the repo has to stay public for as long as tags can publish.**

The docs don't say how a job naming an environment behaves in a private repo on the free plan, so treat that as no approval at all. The owner should confirm this on the real repo: after going public, the environment's settings page must offer **Required reviewers**.

The owner does these once, in order:

1. [Make the repo public](#making-the-repo-public).
2. Create the environment: **Settings → Environments → New environment**, named exactly `production`.
3. Select **Required reviewers**, add `dconyemerekwe`, and choose **Save protection rules**.
4. Leave **Prevent self-review** off. The owner both pushes the tag and approves it, so with it on nobody could approve.
5. Leave **Deployment branches and tags** at **No restriction**. `release.yml` only runs on `v*` tags, and a wrong rule would block the job.
6. Decide whether to deselect **Allow administrators to bypass configured protection rules**; that's the owner's choice. It's on by default, and it gives the run page a **Start all waiting jobs** button that skips the approval. **Choosing that button, in check 3B or any other run, would publish.**
7. Recreate the [Trusted Publishing](#trusted-publishing) policy if it has lapsed.

**The environment check.** Run this before pushing any tag on a commit with the `publish` job:

```bash
gh repo view dconyemerekwe/0xword --json visibility --jq .visibility
gh api repos/dconyemerekwe/0xword/environments/production --jq '.protection_rules[] | select(.type == "required_reviewers") | .reviewers[].reviewer.login'
```

The first must print `PUBLIC`, and the second `dconyemerekwe`. If either prints anything else, or nothing, or `404`, **don't push the tag**: the repo isn't public, so GitHub ignores the rules, or the environment is missing or has no approval rule. Run these in PowerShell 7 or Git Bash: Windows PowerShell 5.1 mangles the quotes, so the second command stops with an error even on a correct setup.

## Trusted Publishing

The `publish` job proves its identity to the Marketplace through GitHub's OpenID Connect, so no Marketplace token is created or stored. The credential lasts 15 minutes, and each GitHub token can be exchanged only once. The Marketplace accepts it only from a run matching the policy on the publisher's [manage page](https://marketplace.visualstudio.com/manage), under **Trusted Publishing**:

| Field | Value |
|---|---|
| Policy name | A descriptive name, such as `Release workflow` |
| Repository owner | `dconyemerekwe` |
| Repository | `0xword` |
| Workflow | `release.yml` |
| Environment | `production` |

While the repo is private, a new policy has to be used within 48 hours, or it stays inactive. The owner recreates it just before the first release tag.

**What `vsce` 4.1.0 does with `--oidc`,** from its source (`out/oidc.js`, `out/publish.js`, `out/main.js`, `out/ciProvider.js`, `out/util.js`, #96). Microsoft's docs don't cover this, and none of it has run against the real Marketplace yet:

- **Where it works:** only on GitHub Actions. It needs `GITHUB_ACTIONS=true` plus `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, which GitHub sets only for a job with `id-token: write`. Anywhere else it stops with an error before it requests or sends any credential.
- **With `--packagePath`:** supported. The publisher comes from the `package.json` inside the `.vsix`, not the checkout, nothing is rebuilt (`vscode:prepublish` doesn't run), and the upload takes the same code path as without the option.
- **On a first publish:** vsce doesn't need the extension to exist. The token exchange sends only the publisher's name, and if looking up the extension returns 404, vsce creates it. Any other error from that lookup stops the publish. **Still unproven:** whether the Marketplace answers that lookup with 404 and accepts the create with this credential, which only a real first publish can show.
- **Other settings:** `--oidc` ignores `VSCE_PAT`, and refuses `--pat` and `--azure-credential`. `VSCE_MARKETPLACE_URL` changes where the GitHub token is sent, so the `publish` job must never set it. vsce also sends an `X-Market-CI-Provider: github-actions` header on its Marketplace calls, for Microsoft's statistics. That happens only at publish, not in the extension.

**If the Marketplace refuses `--oidc`:** download the `.vsix` from the run and upload it by hand on the manage page. `github-release` won't have run for that tag, so create the GitHub Release by hand too if it's wanted.

## The design

The workflows, with every action pinned to a full commit SHA. `test/workflows.test.ts` fails if this `release.yml` differs from the real one, apart from comments on their own line and the pins.

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

  publish:
    name: Publish to the VS Code Marketplace
    needs: ci
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: production   # waits for the owner's approval
    permissions:
      contents: read
      id-token: write   # only this job can request a Marketplace credential
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
      # .npmrc, from the checkout, keeps install scripts off.
      - run: npm ci   # installs the vsce version locked in package-lock.json
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: 0xword-vsix
          path: ${{ runner.temp }}
      # Publishes the exact file CI built and tested; nothing is rebuilt.
      - run: npx vsce publish --oidc --packagePath "$RUNNER_TEMP/0xword.vsix"

  github-release:
    name: GitHub Release
    needs: publish   # no release unless the Marketplace took the version
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
- **Read-only by default.** Only `github-release` gets `contents: write`, and only `publish` gets `id-token: write`.
- **No install scripts.** `npm ci` runs with `.npmrc`'s `ignore-scripts=true`, and `ci.yml` checks every package's registry signature.
- **A small publish job.** It installs the locked `vsce` and publishes the `.vsix` CI built. The fewer steps run while it can request a credential, the better.
- **No Marketplace secret.** Nothing is stored in this repo or in GitHub's secrets for publishing.

## Not included yet

- **Open VSX** (for Cursor, Windsurf and VSCodium). A second publish job, after the `ovsx` decision in Phase 6: either a pinned dev dependency or `npx ovsx@<exact version>`.
- **Pre-releases.** Every approved tag goes to all players. A pre-release channel can be added later with `vsce`'s `--pre-release` flag and a version-number convention.
