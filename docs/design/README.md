# 0xWORD draft design

[`0xword-draft-design.pdf`](0xword-draft-design.pdf) is the owner's draft design: five screens of the side panel at about 400px wide. Phase 3 stories link to the page they build. This file describes each page in words, so the design can be followed without opening the PDF. Where this file and the PDF disagree with [CLAUDE.md](../../CLAUDE.md) game rules, **the rules win**. See [Differences from the rules](#differences-from-the-rules).

Each page is also saved as an image in [`pages/`](pages/) (1200 × 2700 px, a 3× scale of a 400 px wide panel). Agents can view these with the Read tool; the PDF itself can't be rendered here. **Build the styling from these images and the [colour tables](#colours) below. Don't invent values.**

| Page | Screen | Theme shown | Image |
|---|---|---|---|
| 1 | Mid-game | dark | [page-1.jpg](pages/page-1.jpg) |
| 2 | Mid-game with hints on | dark | [page-2.jpg](pages/page-2.jpg) |
| 3 | Forced final answer (hex locked) | dark | [page-3.jpg](pages/page-3.jpg) |
| 4 | Solved | light | [page-4.jpg](pages/page-4.jpg) |
| 5 | How to play | dark | [page-5.jpg](pages/page-5.jpg) |

A second draft, [`0xword-decode-lock-design.pdf`](0xword-decode-lock-design.pdf), shows the locked decode panel and Hints for #46. Its pages are saved the same way and described under [Decode lock draft (#46)](#decode-lock-draft-46).

| Page | Screen | Theme shown | Image |
|---|---|---|---|
| L1 | Mid-game, decode panel locked | dark | [lock-1.jpg](pages/lock-1.jpg) |
| L2 | Mid-game, decode panel locked, hints on | dark | [lock-2.jpg](pages/lock-2.jpg) |
| L3 | Hex solved: decode unlocked, Hints locked | dark | [lock-3.jpg](pages/lock-3.jpg) |

## Colours

These values were measured from the page images, which are JPEGs, so they're accurate to within a few units. Where CLAUDE.md names a value, that value is used. Treat them as the design tokens. Values marked * were matched by eye, not measured: check them against the page image.

### Dark theme (pages 1–3 and 5)

| Element | Background | Text / foreground | Border |
|---|---|---|---|
| Page | `#14161B` | `#E8EAF0` | |
| Title `0x` | | `#2F6FE4` (owner's choice; the mock-up draws `#7EA8FF`) | |
| Title `WORD`, headings | | `#E8EAF0` | |
| Muted text: status line, legend | | `#9C9FA8` | |
| Icon buttons (`?`, theme) | | `#CCCFD8` | |
| Hints button, off | page background | `#CCCFD8` | `#3C3F48` |
| Hints button, on (page 2) | `#1E2A45` | `#7EA8FF`* | `#2F6FE4`* |
| Hint strip cell (page 2) | page background | letter `#E8EAF0`, `?` `#7B808B`† | dashed `#4A4D55`† |
| Tile: right spot | `#2F6FE4` | `#FFFFFF` | |
| Tile: wrong spot | `#F0A04B` | `#1A1206` | |
| Tile: not in word | `#343944` | `#C9CFD8` | |
| Tile: typed, not yet scored | page background | `#E8EAF0` | `#7B8190` |
| Tile: empty | page background | | `#36393F` |
| Decode panel | `#1D2027` | heading `#E8EAF0` | `#2A2D36`* |
| Decode text box | `#14161B` | placeholder `#757578` | `#3C3F48`* |
| Decode button | `#2F6FE4` | `#FFFFFF` | |
| Key: neutral, DEL, ENTER | `#2A2D36` | `#E8EAF0` | |
| Key: right spot | `#2F6FE4` | `#FFFFFF` | |
| Key: not in word (struck through) | `#1B1E27` | `#8A909C` | |
| Final-answer card (page 3) | `#241B12` | heading `#E8EAF0`, "Last try" `#F0A04B` | `#F0A04B` |
| Final-answer Submit button (page 3) | `#F0A04B` | `#1A1206` | |
| Locked keypad (page 3): neutral, right | `#1B1E24`, `#1E3660` | dimmed | |
| How to play cheatsheet card (page 5) | `#1D2027` | letter `#E8EAF0`, hex `#7EA8FF` | |
| Locked decode panel (L1, L2) | `#1D2027` | its usual contents at 10% opacity‡ | `#1D2027` |
| Lock badge (L1, L2) | `#2A2E37`‡ | lock icon `#E8EAF0`‡ | `#3C3F48`‡ (1px) |
| Lock title "Locked until you crack the hex row" (L1, L2) | | `#E8EAF0`‡ | |
| Lock message "Get every tile blue to unlock Decode." (L1, L2) | | `#CCCFD8`‡ | |
| Hints button, locked (L3) | page background | text and lock icon `#8A909C`‡ | `#303239`‡ |
| Icon button `?`, locked at the decode step (#53) | | `#8A909C` (`hintsLockedText`, owner's choice) | |

‡ Measured for #46 from `lock-1.jpg` (the panel, badge, title, message and faded contents) and `lock-3.jpg` (the locked Hints button), with a small JPEG decoder run on the images. Its readings match the existing tokens where the draft reuses them (page `#14161B`, panel `#1D2027`, final card `#241B12` exactly; the Hints-off outline `#3C3F48` reads `#3D3F49`). Anti-aliased text reads about 5 units brighter than its colour in every channel (the Hints-off text `#CCCFD8` reads `#D1D4DD`), so text readings are corrected by that amount. Where a reading lands within that error of an existing token, the token is used:
- **Badge fill** reads `#2A2E37`, which is `key`. **Badge outline** reads `#3C404A`: the Hints-off outline `#3C3F48`.
- **Lock icon** reads `#EDF0F7` and **title** `#EEF0F6`: page text `#E8EAF0`. **Message** reads `#D0D3DC`: the Hints-off text and icon colour `#CCCFD8`.
- **Locked Hints text and icon** read `#9096A3` and `#9096A2`, so `#8B919E` corrected. That's within 3 units of the absent-key text in the table above, `#8A909C`, which the owner chose to use instead of a new colour. **Locked Hints outline** reads `#2F3239` (top) and `#31323A` (left): `#303239`, a new token, fainter than the Hints-off outline.
- **Faded contents:** the heading reads up to `#32343C`, the placeholder `#26282F`, the box `#1C1F26`, the Decode button `#1E2128` with its text `#2A2D34`. Drawing the usual contents (page 1's heading and box, and the disabled Decode button) at 10% opacity over the panel gives `#30343B`, `#2A2F37`, `#1C1F26`, `#1C1F26` and `#2A2F37`, within a few units of each, so the panel's body is faded with `opacity: 0.1` rather than new colours.

**Approved by the owner (#46, 2026-10-24)**, with `#8A909C` for the locked Hints text.

On page 3 the scored tiles are also drawn dimmed (right spot about `#2754A8`, wrong spot about `#AE783F`) while the hex is locked.

† Added with the Hints story (#23), estimated from pixels of page 2 rather than taken from the original table: the dashed outline measures about `#4A4D55`. The `?` measures about `#797E89`, which is 4.45:1 on the page background; it's used 2 units lighter, as `#7B808B` (about 4.57:1), to meet 4.5:1. The owner should confirm both.

### Light theme (page 4)

| Element | Background | Text / foreground | Border |
|---|---|---|---|
| Page | `#F6F6F9` | `#15181B` | |
| Title `0x` | | `#2463EA` | |
| Muted text | | `#5D636C` | |
| Tile: right spot | `#2463EA` | `#FFFFFF` | |
| Tile: wrong spot | `#F3A524` | `#1A1206` | |
| Tile: not in word | `#6C7281` | `#FFFFFF` | |
| Tile: empty | page background | | `#CFD2D8` |
| Result card | `#FFFFFF` | `#15181B` | `#2463EA` |
| Byte tiles on the card | `#EDF3FC` | hex `#2463EA`, letter `#15181B`* | |
| New round button | `#2463EA` | `#FFFFFF` | |
| Copy result button (on hold, not built) | `#FFFFFF` | `#15181B` | `#CFD2D8`* |

#### Light values derived for screens drawn only in dark (#26)

Pages 1–3 and 5 exist only in dark, so their light values are derived from the page 4 values above. Each is another page 4 value, or a mix of two of them ("50% A over B", per sRGB channel), never a new hue. A unit test (`test/ui/palette.test.ts`) recomputes every one. **Confirmed by the owner (2026-10-30, #64):** every row in this table.

| Token (`src/ui/palette.ts`) | Used for | Light value | Derived as |
|---|---|---|---|
| `panel` | decode panel, cheatsheet cards | `#FFFFFF` | the result card's white |
| `accent` | keyboard focus ring | `#2463EA` | `right` |
| `wrongText` | "Last try", error messages | `#875C15` | 50% `onWrong` `#1A1206` over `wrong` `#F3A524`. The orange itself is 1.9:1 on the page, too light for text. In the dark theme this is `wrong`. |
| `key` | neutral key, DEL, ENTER | `#E3E4E9` | 50% outline `#CFD2D8` over the page |
| `keyAbsent` | absent key (struck through), disabled Decode | `#F6F6F9` | the page: like the dark theme's, the key sinks into the page |
| `finalCard` | final-answer card (page 3) | `#FEF6E9` | 10% `wrong` over white |
| `finalNote` | "Type with your keyboard" on the card | `#5D636C` | `muted` |
| `lockedRight` | dimmed right-spot tiles | `#4169C0` | 40% `absent` over `right`: greyed rather than lightened, so white digits stay readable |
| `lockedWrong` | dimmed wrong-spot tiles and keys | `#BD9149` | 40% `absent` over `wrong` |
| `lockedKey` | locked neutral key, DEL, ENTER | `#ECEDF1` | 25% outline over the page: fainter than `key` |
| `lockedKeyRight` | locked right-spot key | `#D7E0F7` | 15% `right` over the page |
| `lockedKeyText` | locked keys' digits | `#5D636C` | `muted` |
| `hintsBorder` | Hints button outline, off | `#CFD2D8` | the outline, as on Copy result |
| `hintsText` | Hints button, off | `#15181B` | `text`, as on Copy result |
| `hintsOn` / `hintsOnText` | Hints button, on | `#EDF3FC` / `#2463EA` | the byte tiles' fill and hex, as the dark theme pairs them |
| `stripBorder` | hint strip's dashed cells | `#969BA2` | 50% `muted` over the outline: a little stronger than empty tiles, as in dark |
| `stripUnknown` | hint strip's `?` | `#5D636C` | `muted` |
| `cardBorder` | cheatsheet card outline | `#CFD2D8` | the outline. In the dark theme this is `key`. |
| `icon` | `?`, theme and back arrow buttons | `#15181B` | `text`: page 4 draws `?` and the moon dark |
| `cheatHex` | cheatsheet hex, `4_` / `5_` | `#2463EA` | the byte tiles' hex |
| `chipOnAbsent` | the "grey" chip in How to play | `#FFFFFF` | the not-in-word tile text |
| `lockBadge` | the decode lock's badge fill (#46) | `#E3E4E9` | `key`, as in the dark theme |
| `lockBadgeBorder` | the decode lock's badge outline (#46) | `#CFD2D8` | the outline, as `hintsBorder` |
| `lockMessage` | "Get every tile blue to unlock Decode." (#46) | `#5D636C` | `muted`: lighter than the `text` title, as in the dark theme |
| `hintsLockedText` | locked Hints text and lock icon (#46), and the locked `?` (#53) | `#5D636C` | `muted`, as the locked keys' digits |
| `hintsLockedBorder` | locked Hints outline (#46) | `#E3E4E9` | 50% outline over the page (as `key`): fainter than `hintsBorder`, as in dark |

The decode lock's title and icon are `text` in both themes, and the faded panel body is 10% opacity in both. The five #46 rows above are **approved by the owner** (2026-10-24).

Three tokens were added so the light theme can differ where the dark theme reuses a colour. Their dark values are the existing ones, so the dark theme is unchanged: `wrongText` (`#F0A04B`, `wrong`), `emptyBorder` (`#343944`, `absent`) and `cardBorder` (`#2A2E37`, `key`).

#### Which palette shows (#26)

- **System** (the default): VS Code's dark and high-contrast dark themes (`body.vscode-dark`, `vscode-high-contrast`) get the dark palette; its light and high-contrast light themes (`vscode-light`, `vscode-high-contrast-light`) get the light one. VS Code changes these classes live, so the panel follows a theme change at once.
- **Light** or **Dark**: forced with the theme button in the header, next to `?`. It cycles System → Light → Dark → System. It shows a sun while the dark palette is showing and a moon while the light one is, and its accessible name says what the next press does ("Switch to light theme", "Switch to dark theme", "Follow VS Code's theme"). The choice is kept in VS Code's `globalState`, so it applies in every workspace.

**Contrast:** every text pair above meets 4.5:1, except the dark-theme placeholder `#757578` on `#14161B` (3.94:1 by the WCAG formula the tests use; noted earlier as about 4.1:1). **Owner's decision (2026-10-30, #64): keep it as is, an accepted exception.** Placeholder text is a hint, not content, and the mock-up draws it. The game itself draws no `#757578`: since #21 the placeholder is `muted` (`#A3A9B6`), 6.92:1 on the decode panel `#1D2027` and 7.68:1 on the page colour `#14161B` inside the final-answer card. See [Contrast in all four themes (#64)](#contrast-in-all-four-themes-64).

The decode lock's text (#46) meets 4.5:1 in both themes: the title `text` on the panel is 13.55:1 (dark) and 17.82:1 (light), the message 10.47:1 and 6.06:1, and the locked Hints text, though `disabled`, 5.64:1 (`#8A909C`) and 5.62:1 on the page.

The palette unit test checks every text pair the game draws in both palettes (`TEXT_PAIRS` and `DIMMED_KEY_PAIRS` in `src/ui/palette.ts`), and text faded with `opacity` at the colour the player sees (`FADED_TEXT`, below). At full strength, all of them meet 4.5:1 except page 3's dimmed keys in the dark theme (#26): the locked digit `#6B7180` is 3.42:1 on a neutral key `#1B1E24`, 2.45:1 on a right-spot key `#1E3660` and 3.80:1 on an absent key `#111318`. **Owner's decision (2026-10-30, #64): keep them as is, an accepted exception.** The keys are `disabled`, which WCAG exempts, and the dimming shows they're locked. The light theme's dimmed keys all meet 4.5:1.

#### Contrast in all four themes (#64)

VS Code's high-contrast dark theme shows the dark palette and its high-contrast light theme the light one (see [Which palette shows](#which-palette-shows-26)), so the four themes use two palettes. `test/ui/palette.test.ts` checks every pair in each of the four themes through that mapping, and lists by name and ratio any pair under 4.5:1 that isn't one of the owner's accepted exceptions (`CONTRAST_EXCEPTIONS` in `src/ui/palette.ts`, each with the decision). `test/media/styles.test.ts` ties every stylesheet rule that draws text or an icon to its checked pair, so a new text colour or pair fails until it's checked. The audit added two icon pairs, both well over 4.5:1: the decode lock's padlock (`text` on `lockBadge`, 11.30:1 dark, 14.04:1 light) and the result card's down arrows (`muted` on `byteTile`, 6.05:1 and 5.43:1).

**Faded text (#76).** The audit first missed text faded with `opacity`. The only such fade is the locked decode panel's body (`.decode-locked .decode-body { opacity: 0.1 }`, #46): its heading, its disabled box with the placeholder, its disabled Decode button and its note, drawn before the decode step under the lock. Each is now checked at the colour the player sees, the text and its fill composited at 10% over the panel (`FADED_TEXT` and `fadedColour` in `src/ui/palette.ts`), and the stylesheet test fails if anything else is faded with `opacity`, or by any other means (`filter`, blend modes, `color-mix`). The faded body is 1.31:1 (`text`), 1.20:1 (`muted`) and 1.21:1 (`muted` on the disabled button) in the dark theme, and 1.23, 1.15 and 1.14:1 in the light theme. Page 3's dimmed grid and keypad use their own colours, not `opacity`, so their figures above are unchanged.

The owner's decisions on the three known gaps, and the faded text found in QA (#76), all on 2026-10-30, with no colour changed:

| Gap | Numbers | Decision |
|---|---|---|
| Dark placeholder `#757578` on `#14161B` | 3.94:1 | Keep as is, an accepted exception: placeholder text is a hint, not content, and the mock-up draws it. The game draws `muted` instead (above). |
| Page 3's dimmed dark keys (`disabled`) | 3.42, 2.45 and 3.80:1 | Keep as is, an accepted exception: disabled controls are exempt, and the dimming shows they're locked. |
| Light values derived for screens drawn only in dark (#26) | all meet 4.5:1 | Confirmed: see [the derived table](#light-values-derived-for-screens-drawn-only-in-dark-26). |
| The locked decode panel's body, faded to 10% (#76, design from #46) | dark 1.31, 1.20 and 1.21:1; light 1.23, 1.15 and 1.14:1 | Keep the 10% fade, an accepted exception: the body is inactive (its box and button are disabled), and the lock's title and message on top are the readable content, at full contrast. |

**Colour is never the only cue.** Not-in-word keys are struck through, in the locked keypad too. Every marked key and scored tile names its mark in its accessible name ("4, Right spot"), in the dimmed grid too. The legend names each swatch in words. The hint strip shows `?` for a byte not yet decoded. The locked states say so in words or with an icon: the decode panel's lock badge and two lines, "Hex locked · all 6 rows used" with a padlock, and the locked Hints button's padlock and description. The disabled decode box has a dashed outline. Tests in `test/media/styles.test.ts` and `test/media/main.test.ts` check these.

**Accepted by the owner (2026-10-30, #64), with no design or colour change:** two places show their meaning on screen by colour alone.

- **Right-spot and wrong-spot tiles and keypad keys** are blue or orange, with no other visual mark. The blue and orange differ in lightness as well as hue, though not by much: relative luminance 0.176 for `#2F6FE4` against 0.442 for `#F0A04B` in the dark theme (2.18:1), and 0.152 for `#2463EA` against 0.461 for `#F3A524` in the light theme (2.52:1). The legend names each colour in words, and screen readers say each tile's and key's mark ("4, Right spot").
- **The disabled `?` at the decode step** is only greyed out (#53's design). It is `disabled`, which is exposed to assistive technology.

## Shared layout (pages 1–4)

- **Header:**
  - On the left, the title: `0x` in blue JetBrains Mono, then `WORD` in DM Sans at weight 1000.
  - On the right, two icon buttons: `?` (How to play) and the theme toggle. The theme toggle shows a sun in the dark theme and a moon in the light theme.
  - **`?` locks at the decode step (#53, owner's decisions, 2026-10-25):** from the moment a fully right row or row 6 is scored until the round is solved or failed, `?` is `disabled`, so How to play and its cheatsheet can't be opened. It's only greyed out, in the locked Hints text colour (`hintsLockedText`: `#8A909C` dark, `#5D636C` light), in the same place and size, with no lock or "not allowed" icon. Its accessible name stays "How to play", with no description (no `aria-describedby`). It's the only way into How to play, so there's no shortcut or command to lock as well. It works again on the result card and in the next round. The theme toggle never locks.
- **Status line** below the header, in muted text:
  - mid-game: "4-letter word · row 4 of 6"
  - forced final answer: a lock icon and "Hex locked · all 6 rows used"
  - decode step after a solved grid (page L3, #46): "4-letter word · hex solved", with no lock icon
  - solved: "4-letter word · solved"
  - failed (no page; #24, owner's wording on #46): "4-letter word · out of rows" after row 6, or "4-letter word · not decoded" after a wrong word on a solved grid
- **Hints button** on the right of the status line: a light-bulb icon and "Hints", outlined. It's an on/off toggle (`aria-pressed`), off at the start of each round, and can be pressed any number of times until the hex locks. When on (page 2), it has a blue border and a tinted fill and the hint strip shows. **It switches off by itself when ENTER scores a hex row (#38)**, so the player turns it on again when they want help; a rejected row (invalid, not a listed word, or a repeat) leaves it on. **It locks with the hex at the decode step (#46, page L3):** it switches off, the strip hides, and the button is dimmed and `disabled` for the rest of the round, with a lock icon in place of the bulb and the accessible description "Locked for the rest of the round". Each use is counted for the result card (page 4): one hint for each row Hints was on at any point while it was typed, however often it was pressed, so at most one per row used (6). Nothing shows the count or a limit while the round is in progress. It's hidden once the round is over (solved or not).
- **Grid:** 6 rows × 4 byte pairs.
  - Each pair is two square tiles, with a wider gap between pairs than within a pair.
  - Digits are in JetBrains Mono, bold.
  - Tile states:
    - right spot: blue `#2F6FE4`, white digit
    - wrong spot: orange `#F0A04B`, dark digit `#1A1206`
    - not in word: grey `#343944`, muted light digit
    - typed but not yet scored: dark fill with a light outline (page 1, row 4)
    - empty: a faint outline only
- **Legend** under the grid: small squares in the three colours with "right spot", "wrong spot" and "not in word".
- **Keypad:**
  - Four rows of four keys (`0 1 2 3` / `4 5 6 7` / `8 9 A B` / `C D E F`), then a wide **DEL** and a wide **ENTER**.
  - Key states:
    - a digit seen in the right spot: blue
    - a digit seen absent: darker, with the digit struck through (so colour isn't the only cue)
    - otherwise: neutral
  - Keys are at least 44px tall.

## Page 1: Mid-game

- Rows 1–3 are scored. Row 4 shows the digits being typed (`42 59`), and rows 5–6 are empty.
- **Decode panel** between the legend and the keypad:
  - the heading "Decode the word"
  - a text box with the placeholder "Type the English word"
  - a blue **Decode** button
  - the draft's "1 try per row" and "Tried: BEAT" underneath are left out: there's one try per round, and no Tried list (#46).
- **Since #46 the panel is locked on this screen** (pages L1 and L2, below): a word can be tried only at the decode step, once a row is fully right or row 6 is scored. The keypad stays usable while it's locked.

## Page 2: Mid-game with hints on

The same as page 1 with Hints on: the Hints button is highlighted, and a **hint strip** sits between the grid and the legend. The strip has one dashed-outline cell per byte, each showing the byte's letter once both of its tiles have been in the right spot **in the same row**, or a muted `?` (here `B ? T E`). A byte whose two tiles were each right only in different rows still shows `?` (owner's decision on #50). Once ENTER scores the row being typed, the button goes back to off and the strip is hidden (#38).

## Page 3: Forced final answer

- All 6 rows are scored, and the status line says the hex is locked.
- The decode panel becomes an **orange-outlined "Final answer" card**:
  - "Last try" in orange at the top right
  - a text box with the placeholder "Decode the bytes above"
  - an orange **Submit** button
  - underneath, "Type with your keyboard" on the left. The draft's "Tried: BUSY · BEST" on the right is left out: there's one try and no Tried list (#46).
- The **keypad, DEL and ENTER are dimmed and disabled**. Key colours stay visible.
- **Hints is locked (#46)**, and so is the header's `?` (#53), as on page L3. The same card is the decode step after a solved grid (page L3), where the status line and grid differ.

## Page 4: Solved (light theme)

- **Light palette:**
  - light background, white card, dark text
  - the same blue and orange marks; a mid-grey for "not in word"
  - empty tiles with light-grey outlines
- The grid shows the rows played.
- A **result card** with a blue outline, in place of the decode panel and keypad:
  - above the heading, an outcome line that page 4 doesn't draw (owner's wording, #24): "Congrats! You cracked it", in muted text (`#A3A9B6` in the dark theme) at 14px bold, smaller than the heading. Screen readers hear it first: it starts the card's accessible name, followed by the heading.
  - "Decoded: BYTE" as a large heading
  - the line "3 of 6 rows attempted · 2 hints used" (owner's wording, #38): the rows used and the hint count. One hint reads "1 hint used"; any other count is plural, "0 hints used" included. This differs from the draft's "3 of 6 rows · 2 answer tries · no hints": answer tries are still counted and sent to the host, but no longer shown.
  - four tiles, each with the hex in blue (`42`), a down arrow, and the letter (`B`)
  - a blue **New round** button. The draft also has an outlined **Copy result** button: **on hold** by the owner, as an extra for a later release, so it isn't built (#24).
- Under the card, in muted text: "Your agent is still working. Next round is ready when you are."
- **A failed round** gets the same card (#24): the outcome line "Unlucky!", the heading "The word was BYTE", the line "6 of 6 rows attempted · 0 hints used" (with the round's own hint count), the byte tiles and New round. The status line reads "4-letter word · out of rows" after row 6, or "4-letter word · not decoded" after a wrong word on a solved grid, which may leave rows unused (#46). Screen readers hear the same, "Out of rows" or "Not decoded", from the message line behind the card.
- **Dark theme (#24):** the card is built in the dark palette first; the light theme (#26) draws it with the page 4 values above. The page 4 values map to existing dark tokens: the card is the decode panel colour `#1D2027` with a `#2F6FE4` outline, the byte tiles are `#1E2A45` (the Hints-on fill) with the hex in `#7EA8FF` (the dark theme's blue text) and the letter in `#E8EAF0`, and New round is `#2F6FE4` with white text. The owner should confirm these.

## Page 5: How to play

- **Header:** a back arrow `<` and the heading "How to play". The back arrow returns to the game.
- **RULES:** a numbered list:
  1. The hidden word has 4 letters, written as ASCII hex: 2 digits per letter.
  2. Guess 8 hex digits that spell a real 4-letter word.
  3. Each digit turns **blue** right spot, **orange** wrong spot, or **grey** not in the word. Each colour word is shown as a chip in that colour.
  4. Get a row with every tile blue to unlock Decode. Then you get one try at the English word: a wrong word ends the round.
  5. You can't repeat a hex guess in the same round. A repeat doesn't use up a row.
  6. After 6 rows, the hex keypad locks and Decode unlocks for your one try, even if no row is all blue.
  7. Stuck? Turn on **Hints** to see the letters you've fully decoded. It switches off after each hex row and locks once Decode unlocks. Every use is counted in your result.

  Rules 4 to 7 differ from the draft, which reads "After each row you get one try to type the English word. Fewer rows is a better score." and "After 6 rows the hex locks and you get one final answer." They were rewritten for the decode step (#46): rule 4 replaces #30's "decode at any time", rule 5 keeps only the hex half of #34's repeat rule, and rule 7 adds the Hints lock to the owner's hint-count wording (#38). The draft's Hints rule reads "Stuck? Turn on **Hints** to see the letters you have fully decoded so far."
- **ASCII CHEATSHEET:**
  - The line "`4_` is A–O, `5_` is P–Z. The second digit counts up from there."
  - A 5-column grid of cards from `A 41` to `Z 5A`: the letter in bold, the hex in blue JetBrains Mono.

## Decode lock draft (#46)

The owner's draft for #46, which allows a word attempt only once the hex grid is solved (a scored row with all 8 tiles in the right spot) or all 6 rows are used. It's drawn on the same game as pages 1–3, in the dark theme, at the same scale. Where it disagrees with #46's acceptance criteria, **the criteria win** (see the differences at the end of this section).

### Page L1: Mid-game, decode panel locked

- **Same as page 1, except for the decode panel.** Rows 1–3 are scored, row 4 shows `42 59` being typed, rows 5–6 are empty, and the keypad is fully usable. The status line reads "4-letter word · row 4 of 6", and Hints is off.
- **The decode panel is locked.** It keeps its size and place between the legend and the keypad.
  - Its normal contents (the "Decode the word" heading, the text box with "Type the English word", and the Decode button) are drawn faded, almost invisible against the panel.
  - **Centred over them:**
    - a **lock icon** in a small circle, with a thin outline and a slightly lighter fill than the panel;
    - a bold, page-text-coloured title, **"Locked until you crack the hex row"**;
    - under it, in lighter text, **"Get every tile blue to unlock Decode."** The draft says "every digit". The owner changed it to "tile", because a hex row holds letters (A–F) as well as digits, and the player sees tiles turn blue.
- **No other changes.** The Hints button, grid, legend and keypad look the same as on page 1.

### Page L2: Mid-game, decode panel locked, hints on

- **Same as L1, but with Hints on, as on page 2.** The Hints button is highlighted, and the hint strip (`B ? T E`) sits between the grid and the legend.
- **The locked panel is unchanged.** Hints is usable while the decode panel is locked.

### Page L3: Hex solved, decode unlocked, Hints locked

- **Row 4 is fully right.** It's `42 59 54 45`, all 8 tiles in the right spot. Rows 5–6 stay empty.
- **The status line reads "4-letter word · hex solved".**
- **The Hints button is locked.**
  - Its light-bulb icon is replaced by a **lock icon**, and the button is drawn dimmed: muted text and outline, no highlight.
  - The hint strip isn't shown.
- **The header's `?` is locked (#53, not in the draft):** greyed out and `disabled`, with no lock icon, as described under [Shared layout](#shared-layout-pages-14). The draft draws it as usual.
- **The decode panel unlocks** as the orange-outlined **"Final answer" card** from page 3, which is the "highlight" that prompts the player:
  - "Last try" in orange at the top right;
  - a text box with the placeholder "Decode the bytes above";
  - an orange **Submit** button;
  - "Type with your keyboard" underneath on the left.
- **The keypad, DEL and ENTER are dimmed and disabled**, as on page 3, with the key colours still visible.

### Colours for the decode lock draft

These reuse the existing tokens where the draft visibly does: the panel, the page 3 card and the dimmed keypad. The new elements were **measured for #46** and are recorded, with how, in the [dark theme table](#dark-theme-pages-13-and-5); their light values are derived the #26 way and listed in [Light values derived for screens drawn only in dark](#light-values-derived-for-screens-drawn-only-in-dark-26). All are **approved by the owner** (2026-10-24).

| Element | Background | Text / foreground | Border |
|---|---|---|---|
| Locked decode panel (L1, L2) | as the decode panel `#1D2027` | its usual contents at 10% opacity | as the decode panel |
| Lock badge (L1, L2) | `#2A2E37` (`key`) | lock icon `#E8EAF0` | `#3C3F48` (1px) |
| Lock title "Locked until you crack the hex row" | | page text `#E8EAF0` | |
| Lock message "Get every tile blue to unlock Decode." | | `#CCCFD8` | |
| Hints button, locked (L3) | page background | icon and text `#8A909C` | `#303239` |
| `?` button, locked (L3 and page 3, #53) | | `#8A909C`, as the locked Hints text | |
| Status line "hex solved" (L3) | | the muted status text, as built | |
| Final-answer card, Submit, locked keypad (L3) | as page 3 | as page 3 | as page 3 |

**Sizes**, estimated from L1 at a 400px panel: a 38px round badge with a 20px lock icon, then the 14px bold title and the 14px message, centred in the panel with 4px gaps. The panel keeps its size and place: the lock sits in the same grid cell as the panel's body, so the decode row's width, and with it the #33 placeholder cut-offs, is unchanged in every state.

**On page L3 the grid isn't dimmed** and the status line has no lock icon: both are kept for page 3, the decode step after row 6 without a solved row.

### Accessibility notes for the locked states

- **The locked Decode button and text box** use `disabled`, not only dimming, as on page 3.
- **The lock title and message are real text**, read by screen readers, and the lock icon is decorative (`aria-hidden`).
- **The locked Hints button** uses `disabled`, and its accessible name or description says it's locked for the rest of the round.
- **The locked `?` button (#53)** uses `disabled`, so it can't be clicked or reached with Tab. Its name stays "How to play" and it has no description (owner's decision). The decode box already takes focus at the decode step, so focus never stays on the disabled `?`.
- **Both icons** are inline SVG bundled with the extension, like the header icons. No CDN.

### Differences from #46's rules

- **The lock message says "tile", not "digit" (L1, L2).** The shipped wording is "Get every tile blue to unlock Decode." (owner's correction: hex rows hold letters as well as digits).
- **No "1 try per row" or "Tried: BEAT" under the lock (L1, L2).** The draft shows them faded behind the lock. #46 removes the Tried list and allows one try per round, so leave both out.
- **No "Tried: BUSY · BEST" on the unlocked card (L3).** With one try per round there's never anything to list. Leave the right-hand side of the card's footer empty.
- **The same lock applies before row 1 and after row 6.** The draft shows the lock mid-game. #46 locks the decode panel from the start of the round until the hex is solved or row 6 is scored. After row 6 without a solved row, the panel unlocks as the page 3 card, and the Hints lock applies there too. The status line then reads as it does on page 3, not "hex solved".
- **`?` locks at the decode step (#53).** The draft keeps it usable on L3 and page 3; the owner locked it so the cheatsheet can't be read while decoding.
- **The highlight on unlock is the page 3 card.** The draft shows no extra animation. Any transition must respect `prefers-reduced-motion`.

## Accessibility

These apply to every screen and come from CLAUDE.md's Design section:
- Touch targets are at least 44px, and text contrast is at least 4.5:1 in both themes.
- Use real `<button>` and `<label>` elements. The icon buttons need accessible names ("How to play", "Switch to light theme").
- Absent keys are struck through, so colour is never the only cue.
- Disabled controls on page 3 use `disabled`, not only dimming.
- Respect `prefers-reduced-motion`.

## Differences from the rules

Since #46 the player decodes the word only at the decode step: once a scored row has every tile blue, or after row 6. The differences from the draft:

- **No "1 try per row" note and no "Tried:" list** (pages 1, 3, L1 to L3). There's one try per round (#46).
- **The decode panel is locked until the decode step** (pages L1 and L2), from the very start of the round.
- **A rejected word doesn't count as the try.** A malformed or unlisted word gets a plain-text reason and leaves the round at the decode step. A hex guess already scored is rejected too ("You've already tried 42 41 52 4E", the guess in uppercase byte pairs) and uses no row (owner's decision on #30).
- **Messages survive a hide and show.** Whatever error message was showing (a repeated or invalid row, an invalid word) is still there, in the error style, after the panel is hidden and shown, along with the typed hex digits (owner's decision on #34). Text typed in the decode box isn't kept. Screen-reader-only announcements aren't brought back.
- **A rejected word keeps its text and focus in the box.**
- **Scored rows show no message.** The tile colours show the result; screen readers hear the row's marks ("Row 2: 4 Right spot, …") from a visually hidden live region (owner's decision on #30), followed by the unlock when that row opens the decode step.
