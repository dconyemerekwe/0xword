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
| Muted text: status line, legend, "1 try per row", "Tried:" | | `#9C9FA8` | |
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

**Contrast:** every text pair above meets 4.5:1, except the dark-theme placeholder `#757578` on `#14161B` (about 4.1:1). Placeholder text is a hint, not content; raise it with the owner before changing it.

## Shared layout (pages 1–4)

- **Header:**
  - On the left, the title: `0x` in blue JetBrains Mono, then `WORD` in DM Sans at weight 1000.
  - On the right, two icon buttons: `?` (How to play) and the theme toggle. The theme toggle shows a sun in the dark theme and a moon in the light theme.
- **Status line** below the header, in muted text:
  - mid-game: "4-letter word · row 4 of 6"
  - forced final answer: a lock icon and "Hex locked · all 6 rows used"
  - solved: "4-letter word · solved"
  - failed (no page; #24): "4-letter word · not solved"
- **Hints button** on the right of the status line: a light-bulb icon and "Hints", outlined. It's an on/off toggle (`aria-pressed`), off at the start of each round, and can be pressed any number of times while a round is in progress, including while a word attempt or the final answer is due. When on (page 2), it has a blue border and a tinted fill and the hint strip shows. There is no count or limit to show. It's hidden once the round is over (solved or out of rows).
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
  - underneath, "1 try per row" on the left and "Tried: BEAT" on the right, with each tried word struck through

## Page 2: Mid-game with hints on

The same as page 1 with Hints on: the Hints button is highlighted, and a **hint strip** sits between the grid and the legend. The strip has one dashed-outline cell per byte, each showing the byte's letter once both its digits have been in the right spot, or a muted `?` (here `B ? T E`).

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
  - the line "3 of 6 rows attempted · no hints" (or "· hints used"). The draft also shows "2 answer tries"; the game leaves it out, because answer tries always equal rows used (see [Differences from the rules](#differences-from-the-rules)).
  - four tiles, each with the hex in blue (`42`), a down arrow, and the letter (`B`)
  - a blue **New round** button. The draft also has an outlined **Copy result** button: **on hold** by the owner, as an extra for a later release, so it isn't built (#24).
- Under the card, in muted text: "Your agent is still working. Next round is ready when you are."
- **A failed round** gets the same card (#24): the outcome line "Unlucky!", the heading "The word was BYTE", the line "6 of 6 rows attempted · no hints", the byte tiles and New round. The status line reads "4-letter word · not solved".
- **Dark theme (#24):** the card is built in the dark palette first; the light theme comes with the theme story. The page 4 values map to existing dark tokens: the card is the decode panel colour `#1D2027` with a `#2F6FE4` outline, the byte tiles are `#1E2A45` (the Hints-on fill) with the hex in `#7EA8FF` (the dark theme's blue text) and the letter in `#E8EAF0`, and New round is `#2F6FE4` with white text. The owner should confirm these.

## Page 5: How to play

- **Header:** a back arrow `<` and the heading "How to play". The back arrow returns to the game.
- **RULES:** a numbered list:
  1. The hidden word has 4 letters, written as ASCII hex: 2 digits per letter.
  2. Guess 8 hex digits that spell a real 4-letter word.
  3. Each digit turns **blue** right spot, **orange** wrong spot, or **grey** not in the word. Each colour word is shown as a chip in that colour.
  4. You can decode the English word at any time. A wrong guess doesn't use up a row.
  5. After 6 rows, the hex keypad locks and you get one final try to decode the English word.
  6. Stuck? Turn on **Hints** to see the letters you have fully decoded so far.

  Rules 4 and 5 are the owner's revised wording (#25) and differ from the draft, which reads "After each row you get one try to type the English word. Fewer rows is a better score." and "After 6 rows the hex locks and you get one final answer." Rule 4 describes optional decoding, which #30 builds: until it lands, the game still asks for one try after each row.
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

The draft was drawn before the owner settled that **no answer try can be skipped**. In the built game, every scored hex row is followed by exactly one word attempt. So:

- **Tried lists and try counts:**
  - The "Tried:" list holds one word per finished row. Page 1 would show three words after three rows, not just BEAT; page 3 would show five before the final answer.
  - Answer tries always equal rows used, so page 4's result line leaves the count out: it reads "3 of 6 rows attempted · no hints", not the draft's "3 of 6 rows · 2 answer tries · no hints".
- **The keypad is locked while a word attempt is due.** Page 1 shows row 4 being typed while the decode box is open. In the game, the next hex row opens only after the word attempt for the previous row.
