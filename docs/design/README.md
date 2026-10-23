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

## Colours

These values were measured from the page images, which are JPEGs, so they're accurate to within a few units. Where CLAUDE.md names a value, that value is used. Treat them as the design tokens. Values marked * were matched by eye, not measured: check them against the page image.

### Dark theme (pages 1–3 and 5)

| Element | Background | Text / foreground | Border |
|---|---|---|---|
| Page | `#14161B` | `#E8EAF0` | |
| Title `0x` | | `#2F6FE4` (owner's choice; the mock-up draws `#7EA8FF`) | |
| Title `WORD`, headings | | `#E8EAF0` | |
| Muted text: status line, legend, "Tried:" | | `#9C9FA8` | |
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

Pages 1–3 and 5 exist only in dark, so their light values are derived from the page 4 values above. Each is another page 4 value, or a mix of two of them ("50% A over B", per sRGB channel), never a new hue. A unit test (`test/ui/palette.test.ts`) recomputes every one. **The owner should confirm them.**

| Token (`src/ui/palette.ts`) | Used for | Light value | Derived as |
|---|---|---|---|
| `panel` | decode panel, cheatsheet cards | `#FFFFFF` | the result card's white |
| `accent` | keyboard focus ring | `#2463EA` | `right` |
| `wrongText` | "Last try", error messages | `#875C15` | 50% `onWrong` `#1A1206` over `wrong` `#F3A524`. The orange itself is 1.9:1 on the page, too light for text. In the dark theme this is `wrong`. |
| `key` | neutral key, DEL, ENTER | `#E3E4E9` | 50% outline `#CFD2D8` over the page |
| `keyAbsent` | absent key (struck through), disabled Decode | `#F6F6F9` | the page: like the dark theme's, the key sinks into the page |
| `finalCard` | final-answer card (page 3) | `#FEF6E9` | 10% `wrong` over white |
| `finalNote` | "Type with your keyboard", Tried on the card | `#5D636C` | `muted` |
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

Three tokens were added so the light theme can differ where the dark theme reuses a colour. Their dark values are the existing ones, so the dark theme is unchanged: `wrongText` (`#F0A04B`, `wrong`), `emptyBorder` (`#343944`, `absent`) and `cardBorder` (`#2A2E37`, `key`).

#### Which palette shows (#26)

- **System** (the default): VS Code's dark and high-contrast dark themes (`body.vscode-dark`, `vscode-high-contrast`) get the dark palette; its light and high-contrast light themes (`vscode-light`, `vscode-high-contrast-light`) get the light one. VS Code changes these classes live, so the panel follows a theme change at once.
- **Light** or **Dark**: forced with the theme button in the header, next to `?`. It cycles System → Light → Dark → System. It shows a sun while the dark palette is showing and a moon while the light one is, and its accessible name says what the next press does ("Switch to light theme", "Switch to dark theme", "Follow VS Code's theme"). The choice is kept in VS Code's `globalState`, so it applies in every workspace.

**Contrast:** every text pair above meets 4.5:1, except the dark-theme placeholder `#757578` on `#14161B` (about 4.1:1). Placeholder text is a hint, not content; raise it with the owner before changing it.

The palette unit test checks every text pair the game draws in both palettes (`TEXT_PAIRS` and `DIMMED_KEY_PAIRS` in `src/ui/palette.ts`). All of them meet 4.5:1 except page 3's dimmed keys in the dark theme, which are listed for the owner rather than changed (#26): the locked digit `#6B7180` is 3.42:1 on a neutral key `#1B1E24`, 2.45:1 on a right-spot key `#1E3660` and 3.80:1 on an absent key `#111318`. The keys are `disabled`, so WCAG sets them no minimum. The light theme's dimmed keys all meet 4.5:1.

## Shared layout (pages 1–4)

- **Header:**
  - On the left, the title: `0x` in blue JetBrains Mono, then `WORD` in DM Sans at weight 1000.
  - On the right, two icon buttons: `?` (How to play) and the theme toggle. The theme toggle shows a sun in the dark theme and a moon in the light theme.
- **Status line** below the header, in muted text:
  - mid-game: "4-letter word · row 4 of 6"
  - forced final answer: a lock icon and "Hex locked · all 6 rows used"
  - solved: "4-letter word · solved"
  - failed (no page; #24): "4-letter word · not solved"
- **Hints button** on the right of the status line: a light-bulb icon and "Hints", outlined. It's an on/off toggle (`aria-pressed`), off at the start of each round, and can be pressed any number of times while a round is in progress, including at the final answer. When on (page 2), it has a blue border and a tinted fill and the hint strip shows. **It switches off by itself when ENTER scores a hex row or the decode box takes a wrong listed word (#38)**, so the player turns it on again when they want help; a rejected row (invalid, not a listed word, or a repeat) or a rejected word (malformed, not listed, or a repeat) leaves it on. Each use is counted for the result card (page 4): one hint for each row Hints was on at any point while it was typed, however often it was pressed, plus one if it's turned on after the last scored row (the final answer, or a decode that solves the round), so at most 7. A wrong word doesn't count again: turning Hints back on before the next row is part of the same row. Nothing shows the count or a limit while the round is in progress. It's hidden once the round is over (solved or out of rows).
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
  - underneath, "Tried: BEAT" on the right, with each tried word struck through. The draft's "1 try per row" on the left is left out: word tries are optional and unlimited, though each word can be tried only once (#30).
- The keypad stays usable while the decode box is open: the player keeps guessing hex and decodes whenever they like, once a row is scored.

## Page 2: Mid-game with hints on

The same as page 1 with Hints on: the Hints button is highlighted, and a **hint strip** sits between the grid and the legend. The strip has one dashed-outline cell per byte, each showing the byte's letter once both its digits have been in the right spot, or a muted `?` (here `B ? T E`). Once ENTER scores the row being typed, or the decode box takes a wrong word, the button goes back to off and the strip is hidden (#38).

## Page 3: Forced final answer

- All 6 rows are scored, and the status line says the hex is locked.
- The decode panel becomes an **orange-outlined "Final answer" card**:
  - "Last try" in orange at the top right
  - a text box with the placeholder "Decode the bytes above"
  - an orange **Submit** button
  - underneath, "Type with your keyboard" on the left and "Tried: BUSY · BEST" (struck through) on the right
- The **keypad, DEL and ENTER are dimmed and disabled**. Key colours stay visible.

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
- **A failed round** gets the same card (#24): the outcome line "Unlucky!", the heading "The word was BYTE", the line "6 of 6 rows attempted · 0 hints used" (with the round's own hint count), the byte tiles and New round. The status line reads "4-letter word · not solved".
- **Dark theme (#24):** the card is built in the dark palette first; the light theme (#26) draws it with the page 4 values above. The page 4 values map to existing dark tokens: the card is the decode panel colour `#1D2027` with a `#2F6FE4` outline, the byte tiles are `#1E2A45` (the Hints-on fill) with the hex in `#7EA8FF` (the dark theme's blue text) and the letter in `#E8EAF0`, and New round is `#2F6FE4` with white text. The owner should confirm these.

## Page 5: How to play

- **Header:** a back arrow `<` and the heading "How to play". The back arrow returns to the game.
- **RULES:** a numbered list:
  1. The hidden word has 4 letters, written as ASCII hex: 2 digits per letter.
  2. Guess 8 hex digits that spell a real 4-letter word.
  3. Each digit turns **blue** right spot, **orange** wrong spot, or **grey** not in the word. Each colour word is shown as a chip in that colour.
  4. You can decode the English word at any time. A wrong guess doesn't use up a row.
  5. You can't repeat a hex guess or an English word in the same round. A repeat doesn't use up a row or a try.
  6. After 6 rows, the hex keypad locks and you get one final try to decode the English word.
  7. Stuck? Turn on **Hints** to see the letters you've fully decoded. It switches off after each hex row, and every use is counted in your result.

  Rules 4 and 6 are the owner's revised wording (#25) and differ from the draft, which reads "After each row you get one try to type the English word. Fewer rows is a better score." and "After 6 rows the hex locks and you get one final answer." The game matches them since #30: decoding is optional once a row is scored, and forced after row 6. Rule 5 isn't in the draft: the owner added it with the repeat rule (#34). Rule 7 is the owner's wording for the hint count (#38); the draft reads "Stuck? Turn on **Hints** to see the letters you have fully decoded so far."
- **ASCII CHEATSHEET:**
  - The line "`4_` is A–O, `5_` is P–Z. The second digit counts up from there."
  - A 5-column grid of cards from `A 41` to `Z 5A`: the letter in bold, the hex in blue JetBrains Mono.

## Accessibility

These apply to every screen and come from CLAUDE.md's Design section:
- Touch targets are at least 44px, and text contrast is at least 4.5:1 in both themes.
- Use real `<button>` and `<label>` elements. The icon buttons need accessible names ("How to play", "Switch to light theme").
- Absent keys and tried words are struck through, so colour is never the only cue.
- Disabled controls on page 3 use `disabled`, not only dimming.
- Respect `prefers-reduced-motion`.

## Differences from the rules

Since #30 the game plays as the draft does: the player guesses hex rows freely and decodes the word when they feel ready. The remaining differences:

- **No "1 try per row" note.** Word tries are unlimited and optional until all 6 rows are used, so page 1's note is left out.
- **Decoding opens after the first scored row.** Before row 1 is scored, the decode box and its button are disabled (owner's decision on #30).
- **The "Tried:" list** holds every wrong listed word, in order, however many there are. Rejected words (malformed, not in the list, or already tried in this round in any letter case, which shows "You've already tried BEAT") are never added and don't count as tries. A hex guess already scored is rejected too ("You've already tried 42 41 52 4E", the guess in uppercase byte pairs) and uses no row (owner's decision on #30).
- **Messages survive a hide and show.** Whatever error message was showing (a repeat, an invalid row, an invalid word) is still there, in the error style, after the panel is hidden and shown, along with the typed hex digits (owner's decision on #34). Text typed in the decode box isn't kept. Screen-reader-only announcements aren't brought back.
- **After a wrong word, focus goes back to the page**, where the physical keyboard drives the hex grid, so the player carries on guessing hex. A rejected word keeps its text and focus in the box.
- **Scored rows show no message.** The tile colours show the result; screen readers hear the row's marks ("Row 2: 4 Right spot, …") from a visually hidden live region (owner's decision on #30).
