// Checks the Marketplace README and the CHANGELOG: the opening the owner's
// mock-up sets (docs/design/icons/marketplace-9.1.pdf), How to play against
// the game's own rules, the images, and the trademark rule.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";
import { CHEATSHEET_LINE, RULES, cheatsheet, plainText } from "../src/ui/howToPlay.ts";

const root = new URL("../", import.meta.url);
const readme = readFileSync(new URL("README.md", root), "utf8");
const changelog = readFileSync(new URL("CHANGELOG.md", root), "utf8");

interface Manifest {
  icon?: string;
  repository?: { url?: string };
  scripts?: Record<string, string>;
  contributes?: { commands?: { command: string; title: string; category?: string }[] };
}

const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as Manifest;

/** The owner's opening line, word for word from the Marketplace mock-up. */
const INTRO =
  "A hex word game for VS Code. Guess the hex, decode the word: blue is right spot, orange is wrong spot, grey is not in the word.";

/** The README's blocks: runs of lines between blank lines, trimmed. */
const blocks = readme
  .split(/\n\s*\n/)
  .map((block) => block.trim())
  .filter((block) => block !== "");

/** The lines of a `## ` section, from its heading up to the next `## ` heading. */
function section(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading}`);
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** Markdown inline formatting removed: bold and code, as the game draws them in styles. */
function unformatted(text: string): string {
  return text.replaceAll("**", "").replaceAll("`", "");
}

/**
 * Every image the README shows: Markdown images, `<img src>` and
 * `<source srcset>`, as written.
 */
function imageLinks(markdown: string): string[] {
  return [
    ...[...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? ""),
    ...[...markdown.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1] ?? ""),
    ...[...markdown.matchAll(/<source\b[^>]*\bsrcset="([^"]+)"/g)].map((match) => match[1] ?? ""),
  ];
}

/**
 * Where `vsce package` points relative image links: `<repository>/raw/HEAD`,
 * since the package script passes no `--baseImagesUrl` or `--githubBranch`
 * (`guessBaseUrls` in node_modules/@vscode/vsce/out/package.js, vsce 4.0.0).
 * On GitHub, `HEAD` is the default branch, `develop`.
 */
const imagesBase = `${(manifest.repository?.url ?? "").replace(/\.git$/, "")}/raw/HEAD/`;

/** Ordinary English words that end in "dle" and aren't a game's name. */
const ORDINARY_DLE_WORDS: ReadonlySet<string> = new Set(["bundle", "handle", "idle", "middle"]);

/** Every use of "Wordle" or a "-dle" name in a text, in any letter case (CLAUDE.md trademark rule). */
function trademarkHits(text: string): string[] {
  return (text.match(/[a-z0-9]*dle/gi) ?? []).filter((word) => !ORDINARY_DLE_WORDS.has(word.toLowerCase()));
}

describe("README opening", () => {
  it("starts with a heading of the icon beside the 0xWORD wordmark", () => {
    const header = blocks[0] ?? "";
    assert.match(header, /^<h1>[\s\S]*<\/h1>$/);
    const icon = header.indexOf(`src="${manifest.icon}"`);
    const wordmark = header.indexOf('alt="0xWORD"');
    assert.notEqual(icon, -1, "the Marketplace icon is in the heading");
    assert.notEqual(wordmark, -1, "the wordmark's text alternative is 0xWORD");
    assert.ok(icon < wordmark, "the icon comes before the wordmark");
  });

  it("follows it with the owner's opening line, word for word", () => {
    assert.equal(blocks[1], INTRO);
  });

  it("then shows a screenshot of the side bar", () => {
    assert.match(blocks[2] ?? "", /^!\[[^\]]*side bar[^\]]*\]\(docs\/screenshots\/sidebar\.png\)$/);
  });

  it('then starts "How to play"', () => {
    assert.equal(blocks[3], "## How to play");
  });
});

describe("README How to play", () => {
  const howToPlay = section(readme, "## How to play");

  it("lists the game's seven rules, in order and in the game's wording", () => {
    const rules = howToPlay.filter((line) => /^\d+\. /.test(line));
    assert.deepEqual(
      rules.map((line) => unformatted(line.replace(/^\d+\. /, ""))),
      RULES.map(plainText),
    );
    rules.forEach((line, i) => assert.ok(line.startsWith(`${i + 1}. `), line));
  });

  it("shows the cheatsheet line as the game does: 4_ is A–O, 5_ is P–Z", () => {
    assert.ok(howToPlay.some((line) => unformatted(line) === plainText(CHEATSHEET_LINE)));
  });

  it("lists all 26 cheatsheet cards from A 41 to Z 5A, matching the game's", () => {
    // Each table is a row of letters, a separator, then a row of hex in code.
    const rows = howToPlay.filter((line) => line.startsWith("|") && !line.startsWith("|---"));
    const cells = (line: string) => line.split("|").slice(1, -1).map((cell) => unformatted(cell.trim()));
    const cards: { letter: string; hex: string }[] = [];
    for (let i = 0; i + 1 < rows.length; i += 2) {
      const letters = cells(rows[i] ?? "");
      const hexes = cells(rows[i + 1] ?? "");
      assert.equal(letters.length, hexes.length);
      letters.forEach((letter, j) => cards.push({ letter, hex: hexes[j] ?? "" }));
    }
    assert.deepEqual(
      cards,
      cheatsheet().map(({ letter, hex }) => ({ letter, hex })),
    );
  });

  it("shows mid-game, Hints, the decode step and the result card, each in dark and light", () => {
    const shown = imageLinks(howToPlay.join("\n"));
    for (const name of ["mid-game", "hints", "decode-step", "result"]) {
      assert.ok(shown.includes(`docs/screenshots/${name}.png`), `missing ${name}`);
    }
  });
});

describe("README sections", () => {
  it('names the command as the Command Palette shows it, "0xWORD: New Round"', () => {
    const command = manifest.contributes?.commands?.find((c) => c.command === "0xword.newRound");
    assert.ok(command);
    assert.ok(readme.includes(`**${command.category}: ${command.title}**`));
    assert.ok(section(readme, "## Start a round").some((line) => line.includes("**0xWORD: New Round**")));
  });

  it("covers keyboard play: hex keys, Backspace, Enter, Tab and Esc", () => {
    const keyboard = section(readme, "## Keyboard play").join("\n");
    for (const key of ["Backspace", "Enter", "Tab", "Esc"]) {
      assert.ok(keyboard.includes(`<kbd>${key}</kbd>`), key);
    }
    assert.ok(keyboard.includes("`A`–`F`"));
  });

  it("covers screen readers, reduced motion (with VS Code's setting) and high contrast", () => {
    const accessibility = section(readme, "## Accessibility").join("\n");
    for (const topic of ["**Screen readers.**", "**Reduced motion.**", "**High contrast.**"]) {
      assert.ok(accessibility.includes(topic), topic);
    }
    assert.ok(accessibility.includes("`workbench.reduceMotion`"));
  });

  it("says there's no telemetry and links to SECURITY.md for privacy", () => {
    const privacy = section(readme, "## No telemetry").join("\n");
    assert.ok(privacy.includes("collects nothing and sends nothing"));
    assert.ok(privacy.includes("[SECURITY.md](SECURITY.md)"));
    assert.ok(existsSync(new URL("SECURITY.md", root)));
  });

  it("keeps the agent-integration note, development and licence below the player-facing sections", () => {
    const headings = readme.split("\n").filter((line) => line.startsWith("## "));
    assert.deepEqual(headings, [
      "## How to play",
      "## Start a round",
      "## Keyboard play",
      "## Accessibility",
      "## Play while your agent works",
      "## No telemetry",
      "## Development",
      "## Licence",
    ]);
    assert.ok(section(readme, "## Play while your agent works").some((line) => line.startsWith("Planned:")));
  });
});

describe("README images", () => {
  const links = imageLinks(readme);

  it("links to every image by a relative path, or by the URL vsce would give it", () => {
    assert.ok(links.length > 0);
    for (const link of links) {
      assert.ok(!link.startsWith("/") && !link.startsWith("http:"), link);
      assert.ok(!/^https:/.test(link) || link.startsWith(imagesBase), link);
    }
  });

  it("points every image link at a file in the repo", () => {
    for (const link of links) {
      const path = link.startsWith(imagesBase) ? link.slice(imagesBase.length) : link;
      assert.ok(existsSync(new URL(path, root)), `${link} doesn't exist`);
    }
  });

  it("uses PNG images only, since vsce rejects SVGs in a README", () => {
    for (const link of links) {
      assert.match(link, /\.png$/, link);
    }
  });

  it("keeps every image under 150 KB", () => {
    for (const link of links) {
      const path = link.startsWith(imagesBase) ? link.slice(imagesBase.length) : link;
      const size = statSync(new URL(path, root)).size;
      assert.ok(size <= 150_000, `${link} is ${size} bytes`);
    }
  });

  it("leaves vsce's rewrite to the repository's default branch: no base URL or branch in the package script", () => {
    assert.equal(imagesBase, "https://github.com/dconyemerekwe/0xword/raw/HEAD/");
    const script = manifest.scripts?.package ?? "";
    assert.doesNotMatch(script, /--base(Images|Content)Url|--githubBranch/);
  });
});

describe("README and CHANGELOG trademark", () => {
  it('never use the name "Wordle" or a "-dle" suffix', () => {
    assert.deepEqual(trademarkHits(readme), []);
    assert.deepEqual(trademarkHits(changelog), []);
  });

  it("the check catches Wordle, -dle names and plurals, but not bundle, handles, idle or middle", () => {
    for (const text of ["Like Wordle", "a WORDLES fan", "Hexdle", "0xdle mode"]) {
      assert.notDeepEqual(trademarkHits(text), [], text);
    }
    assert.deepEqual(trademarkHits("bundle the handles while idle in the middle"), []);
  });
});

/** A CHANGELOG version heading as /release writes it, or the Unreleased one. */
const VERSION_HEADING = /^## \[Unreleased\]$|^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/;
/** The only sections /release writes under a version. */
const SECTION_HEADINGS: ReadonlySet<string> = new Set(["### Added", "### Changed", "### Fixed"]);

/** Problems with a CHANGELOG's headings against /release's format; empty if none. */
function changelogProblems(text: string): string[] {
  const lines = text.split("\n");
  const problems: string[] = [];
  if (lines[0] !== "# Changelog") {
    problems.push("doesn't start with # Changelog");
  }
  const versions = lines.filter((line) => line.startsWith("## "));
  if (versions[0] !== "## [Unreleased]") {
    problems.push("the first version isn't ## [Unreleased]");
  }
  for (const line of versions) {
    if (!VERSION_HEADING.test(line)) {
      problems.push(`bad version heading: ${line}`);
    }
  }
  lines.forEach((line, i) => {
    if (!line.startsWith("### ")) {
      return;
    }
    if (!SECTION_HEADINGS.has(line)) {
      problems.push(`unknown section: ${line}`);
    }
    // A section has at least one entry: its next non-blank line is a list item.
    const next = lines.slice(i + 1).find((after) => after.trim() !== "");
    if (!next?.startsWith("- ")) {
      problems.push(`empty section: ${line}`);
    }
  });
  return problems;
}

describe("CHANGELOG", () => {
  it("has an Unreleased section first, in the heading format /release writes", () => {
    assert.deepEqual(changelogProblems(changelog), []);
  });

  it("lists what's been built so far under Unreleased", () => {
    const unreleased = section(changelog, "## [Unreleased]");
    assert.ok(unreleased.includes("### Added"));
    assert.ok(unreleased.filter((line) => line.startsWith("- ")).length > 0);
  });

  describe("the format check catches", () => {
    const caught: readonly string[] = [
      "# Changes\n\n## [Unreleased]\n\n### Added\n- x\n",
      "# Changelog\n\n## Unreleased\n\n### Added\n- x\n",
      "# Changelog\n\n## [0.1.0] - 2026-11-03\n\n### Added\n- x\n",
      "# Changelog\n\n## [Unreleased]\n\n### Added\n- x\n\n## [0.1.0]\n\n### Added\n- x\n",
      "# Changelog\n\n## [Unreleased]\n\n### New\n- x\n",
      "# Changelog\n\n## [Unreleased]\n\n### Added\n\n### Fixed\n- x\n",
    ];
    for (const text of caught) {
      it(JSON.stringify(text.split("\n").filter((line) => line.startsWith("#")).join(" / ")), () => {
        assert.notDeepEqual(changelogProblems(text), []);
      });
    }

    it("but accepts a released version below Unreleased", () => {
      const text = "# Changelog\n\n## [Unreleased]\n\n### Fixed\n- y (#9)\n\n## [0.1.0] - 2026-11-03\n\n### Added\n- x\n";
      assert.deepEqual(changelogProblems(text), []);
    });
  });
});
