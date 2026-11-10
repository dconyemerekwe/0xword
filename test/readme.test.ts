// Checks the Marketplace README and the CHANGELOG: the opening the owner's
// mock-up sets (docs/design/icons/marketplace-9.1.pdf), How to play against
// the game's own rules, the images, and the trademark rule.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";
import { CHEATSHEET_LINE, RULES, cheatsheet, plainText } from "../src/ui/howToPlay.ts";
import { imageLinks } from "./markdown.ts";

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
    // One wordmark image, on its own dark panel so it reads on light and dark pages.
    const wordmark = header.indexOf('<img src="docs/images/wordmark.png" height="64" align="middle" alt="0xWORD">');
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
      "## Play while your agent works",
      "## No telemetry",
      "## Accessibility",
      "## Development",
      "## Licence",
    ]);
    // The feature is built (#113): no "Planned" note, and the guide is linked.
    const agent = section(readme, "## Play while your agent works");
    assert.ok(!agent.some((line) => line.startsWith("Planned")));
    assert.ok(agent.some((line) => line.includes("[docs/agent-integration.md](docs/agent-integration.md)")));
  });
});

describe("README images", () => {
  const links = imageLinks(readme);

  it("links to every image by a relative path, for vsce to rewrite", () => {
    assert.ok(links.length > 0);
    for (const link of links) {
      assert.doesNotMatch(link, /^(\/|\w+:)/, link);
    }
  });

  it("points every image link at a file in the repo", () => {
    for (const link of links) {
      assert.ok(existsSync(new URL(link, root)), `${link} doesn't exist`);
    }
  });

  it("uses PNG images only, since vsce rejects SVGs in a README", () => {
    for (const link of links) {
      assert.match(link, /\.png$/, link);
    }
  });

  it("keeps every image under 150 KB", () => {
    for (const link of links) {
      const size = statSync(new URL(link, root)).size;
      assert.ok(size <= 150_000, `${link} is ${size} bytes`);
    }
  });

  it("has vsce rewrite images and links to the main branch: --githubBranch main, and no base URL", () => {
    const script = manifest.scripts?.package ?? "";
    assert.match(script, /(^| )--githubBranch main( |$)/);
    assert.doesNotMatch(script, /--base(Images|Content)Url/);
    assert.equal(manifest.repository?.url, "https://github.com/dconyemerekwe/0xword.git");
  });
});

/**
 * The HTML tags the README may use, and each one's attributes. VS Code's
 * Extensions view renders the README through a sanitiser that keeps only
 * simple tags and attributes: it strips `<picture>`, `<source>`, `srcset` and
 * `media`, so a light/dark image swap falls back to one image there (owner's
 * decision on #85: one wordmark on a dark panel, readable on any page). Keep
 * to this small set, which GitHub and the Marketplace render too.
 */
const ALLOWED_HTML: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["h1", new Set<string>()],
  ["img", new Set(["src", "alt", "width", "height", "align"])],
  ["a", new Set(["href", "title"])],
  ["kbd", new Set<string>()],
  ["br", new Set<string>()],
]);

/** Every HTML tag outside code blocks and code spans that isn't allowed, or has an attribute that isn't. */
function htmlProblems(markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const problems: string[] = [];
  for (const match of prose.matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const tag = (match[1] ?? "").toLowerCase();
    const allowed = ALLOWED_HTML.get(tag);
    if (!allowed) {
      problems.push(`<${tag}>`);
      continue;
    }
    for (const attribute of (match[2] ?? "").matchAll(/([a-zA-Z][\w-]*)\s*=/g)) {
      const name = (attribute[1] ?? "").toLowerCase();
      if (!allowed.has(name)) {
        problems.push(`<${tag} ${name}>`);
      }
    }
  }
  return problems;
}

describe("README HTML", () => {
  it("uses only tags and attributes VS Code's README view keeps: no <picture>, <source> or srcset", () => {
    assert.deepEqual(htmlProblems(readme), []);
    assert.doesNotMatch(readme, /<picture|<source|srcset/i);
  });

  it("the check catches <picture>, <source>, srcset, media and inline styles", () => {
    const caught: readonly string[] = [
      '<picture><img src="a.png" alt=""></picture>',
      '<source media="(prefers-color-scheme: dark)" srcset="b.png">',
      '<img src="a.png" srcset="b.png 2x" alt="">',
      '<img src="a.png" style="width: 10px" alt="">',
      '<p align="center">x</p>',
    ];
    for (const html of caught) {
      assert.notDeepEqual(htmlProblems(html), [], html);
    }
    assert.deepEqual(htmlProblems('<h1><img src="a.png" width="64" height="64" align="middle" alt="x"></h1> <kbd>Tab</kbd>'), []);
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
  // The first version is `## [Unreleased]` while changes wait for a release,
  // or the newest release once /release has renamed it.
  const versions = lines.filter((line) => line.startsWith("## "));
  if (versions.length === 0) {
    problems.push("no version");
  }
  versions.forEach((line, i) => {
    if (!VERSION_HEADING.test(line)) {
      problems.push(`bad version heading: ${line}`);
    }
    if (line === "## [Unreleased]" && i > 0) {
      problems.push("## [Unreleased] isn't first");
    }
  });
  // Every version, Unreleased included, lists at least one section.
  lines.forEach((line, i) => {
    if (!line.startsWith("## ")) {
      return;
    }
    const next = lines.slice(i + 1).find((after) => after.trim() !== "");
    if (!next?.startsWith("### ")) {
      problems.push(`no entries: ${line}`);
    }
  });
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
  it("follows the heading format /release writes, with entries in every version", () => {
    assert.deepEqual(changelogProblems(changelog), []);
  });

  describe("the format check catches", () => {
    const caught: readonly string[] = [
      "# Changes\n\n## [Unreleased]\n\n### Added\n- x\n",
      "# Changelog\n",
      "# Changelog\n\n## Unreleased\n\n### Added\n- x\n",
      "# Changelog\n\n## [Unreleased]\n",
      "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-11-03\n\n### Added\n- x\n",
      "# Changelog\n\n## [0.2.0] - 2026-12-01\n\n### Added\n- y\n\n## [Unreleased]\n\n### Added\n- x\n",
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

    it("and a release first with no Unreleased, as /release leaves it", () => {
      const text = "# Changelog\n\n## [0.1.0] - 2026-11-03\n\n### Added\n- x\n";
      assert.deepEqual(changelogProblems(text), []);
    });
  });
});
