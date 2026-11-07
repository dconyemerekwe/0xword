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
