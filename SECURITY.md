# Security

VS Code extensions run with your user account's full permissions, so you should be able to see exactly what an extension can and can't do before you install it. These are the rules 0xWORD is built to.

## What 0xWORD does not do

- **No network access.** The game panel blocks every outside connection: no analytics, no ads, no CDNs and no web fonts. Fonts and word lists ship inside the extension.
- **No telemetry.** 0xWORD collects nothing and sends nothing.
- **No access to your files.** It never reads or writes your workspace or anything else on your disk. It only loads its own bundled files, and it stores your game stats in VS Code's built-in extension storage.
- **No runtime dependencies.** The published extension contains only its own code. The build tools (TypeScript, esbuild, Microsoft's `vsce`) are pinned to exact versions and are not shipped.

## How this is enforced

- **Strict Content Security Policy.** The game panel can only run the extension's own bundled script, using a fresh nonce on every load. There are no inline scripts, no inline event handlers and no external sources.
- **Restricted loading.** The panel can load files only from the extension's `media/` folder.
- **Untrusted messages.** The extension treats every message from the game panel as untrusted. It accepts only a short list of message types and checks every field.
- **Plain-text rendering.** Anything you type is displayed as plain text, never interpreted as HTML.
- **Safe in untrusted workspaces.** The game never touches workspace files, so it runs safely even in workspaces you haven't marked as trusted.

## Reporting a vulnerability

Please don't open a public issue for security problems. Report them privately through GitHub's **Security → Report a vulnerability** on this repository, including steps to reproduce if you can. You'll get a reply within 7 days.
