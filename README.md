# 0xWORD

Puzzles between prompts. A short word game for VS Code's side panel that you can play while your AI agent works.

A hidden 4-letter word is shown as ASCII hex, two digits per letter (`BYTE` is `42 59 54 45`). Guess it in hex, one row at a time, and see which digits are in the right spot, in the wrong spot, or not in the word at all. After each row you get one try to name the word in plain English. Fewer rows means a better score.

> Status: early development. Not yet published.

## No telemetry

0xWORD collects nothing and sends nothing. It makes no network requests and never reads or writes your files. See [SECURITY.md](SECURITY.md) for the full list of rules it's built to.

## Development

Requires Node 24 or newer.

```sh
npm ci            # install the pinned dev tools (install scripts are disabled in .npmrc)
npm run build     # bundle the extension into dist/
npm run typecheck # type-check without emitting
npm test          # run unit tests with node:test
npm run package   # build a .vsix with vsce
```

To try it, open this folder in VS Code and press **F5**. That builds the extension and opens an Extension Development Host window with it loaded.

## Licence

[MIT](LICENSE)
