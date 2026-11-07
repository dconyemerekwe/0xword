---
name: release
description: Prepares a 0xWORD release - bumps the version, writes the changelog and opens the release PR into main. Stops before tagging and publishing; the owner does those.
argument-hint: patch | minor | major
disable-model-invocation: true
---

Prepare a release of 0xWORD. The version bump is `$ARGUMENTS` (`patch`, `minor` or `major`). If it is missing or anything else, stop and ask which one. Use `gh` for GitHub.

Running `/release` is the owner's request to commit, push and open the release PR. You never create tags, merge PRs, publish to the Marketplace or Open VSX, or handle access tokens. Those are the owner's.

## 1. Check it's safe to release

Stop and report if any check fails:

1. The working tree is clean (`git status`).
2. `git fetch origin develop main --tags` succeeds, and you are on an up-to-date `develop`.
3. `npm run verify` passes.
4. `npm run package -- --out 0xword-check.vsix` passes. Delete `0xword-check.vsix` afterwards.
5. CI on the latest `develop` commit is green.
6. There are changes to release: `git log <last tag>..origin/develop` isn't empty. Find the last tag with `git describe --tags --abbrev=0 origin/main`; if there is none, this is the first release.

## 2. Pick the version

Read the current version from `package.json` and work out the new one. Show both, plus a one-line reason the bump type fits:

- `patch`: bug fixes only.
- `minor`: new features that don't break anything for existing players.
- `major`: breaks something for existing players (renamed settings, changed saved stats). Stay below 1.0.0 until the owner says the game is finished.

If the merged changes don't match the requested bump (e.g. `patch` but there's a new feature), say so and ask before continuing.

## 3. Create the release branch

```bash
git checkout -b release/v<new> origin/develop
npm version <bump> --no-git-tag-version
```

`npm version` updates both `package.json` and `package-lock.json`. Don't edit them by hand.

## 4. Update CHANGELOG.md

Create it if it doesn't exist. The Marketplace shows this file on the extension's Changelog tab.

If it has a `## [Unreleased]` section, rename that heading to `## [<new>] - <YYYY-MM-DD>`, check its entries against the PRs merged since the last tag (below), and add what's missing. Otherwise, add the new version at the top:

```markdown
## [<new>] - <YYYY-MM-DD>

### Added
- ...

### Changed
- ...

### Fixed
- ... (#<issue>)
```

Build the entries from the PRs merged since the last tag (`git log <last tag>..origin/develop --merges` and their PR titles). Write for players, not developers: "Hints reveal one letter per byte", not "add hintLetters()". Leave out sections with no entries, and leave out changes players can't see (CI, refactors, tests).

## 5. Commit and open the PR

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): v<new>"
git push -u origin release/v<new>
```

Never use `--no-verify`. Open a PR from `release/v<new>` into `main` titled `Release v<new>`, with the new changelog section as the body.

## 6. Tell the owner what happens next

End with these steps, filled in with the real version:

1. Wait for CI to pass, then review the PR and merge it into `main` with **Create a merge commit**.
2. Check the repo is public and the `production` environment still has your approval on it (without both, the tag publishes with nothing stopping it). Run the environment check in `docs/release-pipeline.md`, including `gh repo view dconyemerekwe/0xword --json visibility --jq .visibility`, and stop unless it prints `PUBLIC` and `dconyemerekwe`. Then tag the merge commit and push the tag:
   ```bash
   git checkout main && git pull
   git tag v<new>
   git push origin v<new>
   ```
3. Open the run in the repo's Actions tab, check `verify-tag` and `ci` passed, then approve the `publish` job: **Review deployments**, then **Approve and deploy**. It publishes the `.vsix` CI built with no token, then `github-release` creates the GitHub Release. **Reject** stops the release, and players see no change.
4. Open a PR from `main` into `develop` so `develop` gets the version bump and changelog.
