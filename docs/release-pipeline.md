# Release pipeline

How a version of 0xWORD gets from `develop` to the VS Code Marketplace. This is the design. It's built in two parts: Phase 5 adds everything that needs no secrets, and Phase 6 adds publishing (see [PLAN.md](PLAN.md)). Until then, nothing in `.github/workflows/` publishes.

## In short

- **Nothing publishes on a merge.** Merging into `develop` or `main` only runs CI.
- **A release starts when the owner pushes a version tag** (`v0.1.0`, `v0.2.1`, …) on `main`.
- **Publishing waits for the owner's approval** in the Actions run.
- **Players get the exact `.vsix` that CI built and tested** from the tagged commit. Nothing is rebuilt between testing and publishing.

## Workflows

| File | Runs on | Does |
|---|---|---|
| `.github/workflows/ci.yml` (exists) | every PR and push to `develop` or `main`, by hand, and when `release.yml` calls it | typecheck, unit tests, build, package, upload the `.vsix` as the `0xword-vsix` artifact |
| `.github/workflows/release.yml` (Phases 5 and 6) | a pushed `v*` tag | checks the tag, runs all of `ci.yml`, publishes, creates the GitHub Release |

`release.yml` doesn't copy any of CI's checks. It calls `ci.yml` through `workflow_call`, so a release goes through exactly the same checks as every PR, and the two can't drift apart.

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
4. **Approve it:** open the run in the Actions tab and approve the `publish` job. Rejecting it stops the release, and players see no change.
5. **Sync `develop`:** open a PR from `main` into `develop` so it gets the version bump and changelog.

### When something fails

- **`verify-tag` fails:** the tag doesn't match `package.json`, or isn't on `main`. Delete the tag (`git push origin :refs/tags/v<x>` and `git tag -d v<x>`), fix the version through a PR, and tag again.
- **`ci` fails:** the same as a red PR. Fix it through a PR into `develop`, release again, and use a new tag.
- **`publish` fails after approval:** read the job log. The Marketplace never accepts the same version twice, so if the version did go out, the next release needs a new version number.

## The design

These are the files as they'll be added. Actions marked `<full-sha>` get pinned to a full commit SHA, as `ci.yml` already does.

### Change to `ci.yml` (Phase 5)

Add `workflow_call` to its triggers so `release.yml` can run it:

```yaml
on:
  pull_request:
    branches: [develop, main]
  push:
    branches: [develop, main]
  workflow_dispatch:
  workflow_call:   # lets release.yml run this exact workflow first
```

### `release.yml`

```yaml
name: Release

on:
  push:
    tags: ['v*']   # only a pushed tag starting with "v" starts this

permissions:
  contents: read   # jobs below widen this only where needed

# Never cancel a release halfway; queue the next one instead.
concurrency:
  group: release
  cancel-in-progress: false

jobs:
  verify-tag:
    name: Tag matches package.json and is on main
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
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
        run: git merge-base --is-ancestor "$GITHUB_SHA" origin/main

  ci:
    name: CI
    needs: verify-tag
    uses: ./.github/workflows/ci.yml   # the same checks as every PR

  # Phase 6
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
      - uses: actions/download-artifact@<full-sha> # vN
        with:
          name: 0xword-vsix
          path: ${{ runner.temp }}
      # Publishes the exact file CI built and tested; nothing is rebuilt.
      - run: npx vsce publish --packagePath "$RUNNER_TEMP/0xword.vsix"
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}

  github-release:
    name: GitHub Release
    needs: publish   # in Phase 5, before publish exists: needs: ci
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: write   # only this job can create a release
    steps:
      - uses: actions/download-artifact@<full-sha> # vN
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
