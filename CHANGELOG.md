# Changelog

All notable changes to 0xWORD are listed here, newest first.

## [Unreleased]

### Added
- A 0xWORD panel in the activity bar: guess a hidden 4-letter word from its ASCII hex, 8 digits per row, in up to 6 rows.
- Each digit turns blue (right spot), orange (wrong spot) or grey (not in the word), with repeated digits scored correctly. The hex keypad shows the best colour each digit has had, and strikes through digits that aren't in the word.
- Every hex row must spell a real 4-letter word. A row you've already tried is turned away without using up a row.
- The decode step: a row with every tile blue, or row 6, locks the hex and gives you one try at the English word, in any letter case.
- Hints: an on/off button that shows the letters you've fully decoded (`B ? T E`). It switches off after each hex row, and every use is counted in your result.
- A result card that decodes each byte to its letter (`42 → B`), with the rows you used, the hints you turned on and a **New round** button.
- How to play: the rules and an A–Z ASCII cheatsheet, under the **?** button until the decode step.
- The **0xWORD: New Round** command, which opens the panel and starts a fresh round.
- Light and dark themes that follow VS Code's, with a sun and moon button to choose one yourself.
- Keyboard play: type hex, <kbd>Backspace</kbd> and <kbd>Enter</kbd> from your keyboard, and <kbd>Tab</kbd> through every control.
- Screen-reader names for every control, tile marks and announcements; reduced motion when your system or VS Code's **Reduce Motion** setting asks for it; and readable contrast in VS Code's high-contrast themes.
- The round in progress is kept when you hide the panel or reload VS Code.
- Bundled DM Sans and JetBrains Mono fonts, so nothing is downloaded. No network access and no telemetry.
- The Marketplace and activity-bar icons.
- Play while your agent works: hooks you add to Claude Code, GitHub Copilot, Copilot CLI, Cursor (not yet tested) or Codex tell 0xWORD when your agent starts and finishes, with a setup guide for each tool. Notices are off by default: set **Auto Start: Mode** to `notify` or `open` in 0xWORD's settings to turn them on.
- `notify` mode: while your agent works, a badge on the 0xWORD icon, `0x Round ready` in the status bar, and an optional pop-up with **Play** and **Not now**, each switched on or off in the settings. They go away when the agent finishes.
- `open` mode: once your agent has worked for a while (20 seconds by default), the 0xWORD panel opens by itself, keeping a round in progress as it is.
- When your agent finishes mid-round, the panel says "Your agent has finished. Your round is still here."
