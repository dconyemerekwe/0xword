# 0xWORD draft design

[`0xword-draft-design.pdf`](0xword-draft-design.pdf) is the owner's draft design: five screens of the side panel at about 400px wide. Phase 3 stories link to the page they build. This file describes each page in words, so the design can be followed without opening the PDF. Where this file and the PDF disagree with [CLAUDE.md](../../CLAUDE.md) game rules, **the rules win**. See [Differences from the rules](#differences-from-the-rules).

| Page | Screen | Theme shown |
|---|---|---|
| 1 | Mid-game | dark |
| 2 | Mid-game with hints on | dark |
| 3 | Forced final answer (hex locked) | dark |
| 4 | Solved | light |
| 5 | How to play | dark |

## Shared layout (pages 1–4)

- **Header:**
  - On the left, the title: `0x` in blue JetBrains Mono, then `WORD` in DM Sans at weight 1000.
  - On the right, two icon buttons: `?` (How to play) and the theme toggle. The theme toggle shows a sun in the dark theme and a moon in the light theme.
- **Status line** below the header, in muted text:
  - mid-game: "4-letter word · row 4 of 6"
  - forced final answer: a lock icon and "Hex locked · all 6 rows used"
  - solved: "4-letter word · solved"
- **Hints button** on the right of the status line: a light-bulb icon and "Hints", outlined. When on (page 2), it has a blue border and a tinted fill. It's hidden on the solved screen.
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
  - "Decoded: BYTE" as a large heading
  - the line "3 of 6 rows · 2 answer tries · no hints"
  - four tiles, each with the hex in blue (`42`), a down arrow, and the letter (`B`)
  - a blue **New round** button and an outlined **Copy result** button
- Under the card, in muted text: "Your agent is still working. Next round is ready when you are."

## Page 5: How to play

- **Header:** a back arrow `<` and the heading "How to play". The back arrow returns to the game.
- **RULES:** a numbered list:
  1. The hidden word has 4 letters, written as ASCII hex: 2 digits per letter.
  2. Guess 8 hex digits that spell a real 4-letter word.
  3. Each digit turns **blue** right spot, **orange** wrong spot, or **grey** not in the word. Each colour word is shown as a chip in that colour.
  4. After each row you get one try to type the English word. Fewer rows is a better score.
  5. After 6 rows the hex locks and you get one final answer.
  6. Stuck? Turn on **Hints** to see the letters you have fully decoded so far.
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
  - Answer tries always equal rows used. Page 4's "3 of 6 rows · 2 answer tries" would read 3 and 3.
- **The keypad is locked while a word attempt is due.** Page 1 shows row 4 being typed while the decode box is open. In the game, the next hex row opens only after the word attempt for the previous row.
