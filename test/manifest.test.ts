// Checks the package.json contributions and what the .vsix ships.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { matchesGlob } from "node:path/posix";
import { describe, it } from "node:test";
import { MEDIA_FOLDER, SCRIPT_PATH, STYLE_PATH } from "../src/webview/html.ts";

const root = new URL("../", import.meta.url);

interface ViewContainer {
  id: string;
  title: string;
  icon: string;
}

interface View {
  type?: string;
  id: string;
  name: string;
}

interface Command {
  command: string;
  title: string;
  category?: string;
}

interface Manifest {
  name?: string;
  publisher?: string;
  description?: string;
  categories?: string[];
  keywords?: string[];
  homepage?: string;
  bugs?: { url?: string };
  galleryBanner?: { color?: string; theme?: string };
  activationEvents?: string[];
  capabilities?: { untrustedWorkspaces?: { supported?: unknown } };
  contributes?: {
    commands?: Command[];
    viewsContainers?: { activitybar?: ViewContainer[] };
    views?: Record<string, View[]>;
  };
}

const manifestText = readFileSync(new URL("package.json", root), "utf8");
const manifest = JSON.parse(manifestText) as Manifest;
const container = manifest.contributes?.viewsContainers?.activitybar?.[0];
const extensionSource = readFileSync(new URL("src/extension.ts", root), "utf8");

/** How the Command Palette shows a command: "Category: Title". */
function paletteLabel(command: Command): string {
  return command.category ? `${command.category}: ${command.title}` : command.title;
}

describe("package.json", () => {
  it("contributes an activity-bar view container titled 0xWORD", () => {
    assert.ok(container);
    assert.equal(container.title, "0xWORD");
  });

  it("gives the view container a monochrome SVG icon from media/", () => {
    assert.ok(container);
    assert.ok(container.icon.startsWith(`${MEDIA_FOLDER}/`), container.icon);
    assert.ok(container.icon.endsWith(".svg"), container.icon);
    const svg = readFileSync(new URL(container.icon, root), "utf8");
    assert.match(svg, /currentColor/);
  });

  it("puts a webview view inside the view container", () => {
    assert.ok(container);
    const views = manifest.contributes?.views?.[container.id];
    assert.equal(views?.length, 1);
    assert.equal(views?.[0]?.type, "webview");
    assert.equal(views?.[0]?.name, "0xWORD");
  });

  it("registers the webview view under the id it contributes", () => {
    assert.ok(container);
    const id = manifest.contributes?.views?.[container.id]?.[0]?.id;
    assert.ok(id);
    const extension = readFileSync(new URL("src/extension.ts", root), "utf8");
    assert.ok(extension.includes(`const VIEW_ID = "${id}";`));
  });

  it("supports untrusted workspaces", () => {
    assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, true);
  });
});

/**
 * Words that make `vsce package` add a Marketplace tag when they appear in
 * the description, copied from `TagsProcessor.Keywords` in
 * node_modules/@vscode/vsce/out/package.js (vsce 4.0.0). None fits 0xWORD:
 * "spell", for example, adds the tag `markdown`.
 */
const DESCRIPTION_TAG_WORDS: readonly string[] = [
  "git", "npm", "spell", "bootstrap", "lint", "linting", "react", "js", "node", "c++",
  "Cplusplus", "xml", "angular", "jquery", "php", "python", "latex", "ruby", "java",
  "erlang", "sql", "nodejs", "c#", "css", "javascript", "ftp", "haskell", "unity",
  "terminal", "powershell", "laravel", "meteor", "emmet", "eslint", "tfs", "rust",
];

/** How vsce matches one of those words: whole word, any letter case. */
function descriptionTagPattern(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:${escaped})(?!\\w)`, "i");
}

describe("package.json Marketplace listing", () => {
  const repo = "https://github.com/dconyemerekwe/0xword";

  it("uses the owner's Marketplace line as the description", () => {
    assert.equal(
      manifest.description,
      "Guess 8 hex digits that make a real 4-letter word, then decode it. In your side bar while your agent works.",
    );
  });

  it("has no word in the description that makes vsce add an unrelated tag", () => {
    const description = manifest.description ?? "";
    const hits = DESCRIPTION_TAG_WORDS.filter((word) => descriptionTagPattern(word).test(description));
    assert.deepEqual(hits, []);
  });

  it("would catch a description that makes vsce add a tag, like spell adding markdown", () => {
    for (const text of ["Guess digits that spell a word.", "Spell it out", "A node and npm game"]) {
      assert.ok(
        DESCRIPTION_TAG_WORDS.some((word) => descriptionTagPattern(word).test(text)),
        text,
      );
    }
    assert.ok(!descriptionTagPattern("spell").test("Guess digits that make a word, spelling aside."));
  });

  it('has keywords that a search for "hex word game" matches', () => {
    const keywords = manifest.keywords ?? [];
    for (const keyword of ["hex", "word game", "game", "puzzle", "ascii"]) {
      assert.ok(keywords.includes(keyword), `missing keyword ${keyword}`);
    }
  });

  it("stays within the Marketplace's limit of 30 keywords, with no duplicates", () => {
    const keywords = manifest.keywords ?? [];
    assert.ok(keywords.length <= 30, String(keywords.length));
    assert.equal(new Set(keywords).size, keywords.length);
  });

  it("links the homepage and bug reports to the GitHub repository", () => {
    assert.equal(manifest.homepage, `${repo}#readme`);
    assert.equal(manifest.bugs?.url, `${repo}/issues`);
  });

  it("gives the gallery banner the dark page background from the design palette", () => {
    const design = readFileSync(new URL("docs/design/README.md", root), "utf8");
    // The dark-theme colour table's page row: "| Page | `#14161B` | `#E8EAF0` | |".
    const darkPage = /^\| Page \| `(#[0-9A-F]{6})` \|/m.exec(design)?.[1];
    assert.ok(darkPage);
    assert.equal(manifest.galleryBanner?.color, darkPage);
    assert.equal(manifest.galleryBanner?.theme, "dark");
  });

  it("keeps the identifier <publisher>.0xword", () => {
    // The Marketplace identifier is "<publisher>.<name>".
    assert.ok(manifest.publisher);
    assert.equal(manifest.name, "0xword");
  });

  it("keeps the single category Other", () => {
    assert.deepEqual(manifest.categories, ["Other"]);
  });
});

/** Ordinary English words that end in "dle" and aren't a game's name. */
const ORDINARY_DLE_WORDS: ReadonlySet<string> = new Set(["bundle", "handle", "idle", "middle"]);

/**
 * Every use of "Wordle" or a "-dle" name (CLAUDE.md trademark rule) in a
 * JSON document, in any letter case, apart from the ordinary words above.
 * The match stops at "dle", so "Wordles" is caught as "Wordle" and
 * "handles" passes as "handle". The document is scanned as written and
 * again decoded, so a name with a letter written as a JSON unicode escape
 * is caught too.
 */
function trademarkHits(json: string): string[] {
  const decoded = JSON.stringify(JSON.parse(json));
  return [json, decoded]
    .flatMap((text) => text.match(/[a-z0-9]*dle/gi) ?? [])
    .filter((word) => !ORDINARY_DLE_WORDS.has(word.toLowerCase()));
}

describe("package.json trademark", () => {
  it('never uses the name "Wordle" or a "-dle" suffix', () => {
    assert.deepEqual(trademarkHits(manifestText), []);
  });

  describe("the check catches", () => {
    const caught: readonly string[] = [
      '{"displayName": "Wordle"}',
      '{"description": "A WORDLE clone"}',
      '{"displayName": "Hexdle"}',
      '{"name": "0xdle"}',
      '{"keywords": ["hex-dle"]}',
      '{"description": "Like Wordles"}',
      '{"displayName": "WordleGame"}',
      '{"name": "0xdleMode"}',
      '{"displayName": "Word\\u006ce"}',
    ];
    for (const json of caught) {
      it(json, () => {
        assert.notDeepEqual(trademarkHits(json), []);
      });
    }

    it("but not ordinary words like bundle, handles, idle or middleware", () => {
      assert.deepEqual(
        trademarkHits('{"description": "bundle the handles while idle in the middleware"}'),
        [],
      );
    });
  });
});

describe("package.json commands", () => {
  const commands = manifest.contributes?.commands ?? [];

  it('contributes 0xword.newRound, shown in the palette as "0xWORD: New Round"', () => {
    const newRound = commands.find((c) => c.command === "0xword.newRound");
    assert.ok(newRound);
    assert.equal(paletteLabel(newRound), "0xWORD: New Round");
  });

  it("registers the newRound command under the id it contributes", () => {
    assert.ok(extensionSource.includes('const NEW_ROUND_COMMAND = "0xword.newRound";'));
    assert.ok(extensionSource.includes("registerCommand(NEW_ROUND_COMMAND,"));
  });

  it("registers exactly as many commands as it contributes", () => {
    const registered = extensionSource.match(/registerCommand\(/g) ?? [];
    assert.equal(registered.length, commands.length);
  });

  it("relies on the implicit onCommand activation, with no extra activation events", () => {
    assert.deepEqual(manifest.activationEvents ?? [], []);
  });

  it("supports untrusted workspaces for the command", () => {
    assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, true);
  });
});

/**
 * Code that would reach the user's workspace or files (CLAUDE.md security
 * rule 8): the `workspace` API however it's imported, `fs` in any form, and
 * any `require` or dynamic `import`, which could load either.
 */
const FILE_ACCESS: readonly RegExp[] = [
  /\.\s*workspace\b/, // vscode.workspace
  /\{[^}]*\bworkspace\b[^}]*\}\s*from\s*["']vscode["']/, // import { workspace } from "vscode"
  /from\s*["'](node:)?fs(\/promises)?["']/,
  /\brequire\s*\(/,
  /\bimport\s*\(/,
];

/** The source without comments, so docs may mention the workspace. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every TypeScript file in src/ and the webview's media/, without the built bundle. */
function sourceFiles(): string[] {
  return ["src", MEDIA_FOLDER].flatMap((folder) =>
    readdirSync(new URL(`${folder}/`, root), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .map((file) => `${folder}/${file.replaceAll("\\", "/")}`),
  );
}

describe("no workspace or file access (untrusted workspaces)", () => {
  it("finds the source files to scan, including the extension and the command's queue", () => {
    const files = sourceFiles();
    assert.ok(files.includes("src/extension.ts"), files.join());
    assert.ok(files.includes("src/newRoundRequests.ts"), files.join());
    assert.ok(files.includes("media/main.ts"), files.join());
  });

  for (const file of sourceFiles()) {
    it(`${file} doesn't touch the workspace or the file system`, () => {
      const source = code(readFileSync(new URL(file, root), "utf8"));
      for (const pattern of FILE_ACCESS) {
        assert.doesNotMatch(source, pattern);
      }
    });
  }

  describe("the scan catches", () => {
    const caught: readonly (readonly [string, string])[] = [
      ["vscode.workspace", "vscode.workspace.fs.readFile(uri);"],
      ["a named workspace import", 'import { window, workspace } from "vscode";'],
      ["node:fs", 'import { readFileSync } from "node:fs";'],
      ["fs", 'import * as fs from "fs";'],
      ["node:fs/promises", 'import { readFile } from "node:fs/promises";'],
      ["require", 'const fs = require("fs");'],
      ["a dynamic import", 'const fs = await import("node:fs");'],
    ];
    for (const [name, line] of caught) {
      it(name, () => {
        assert.ok(FILE_ACCESS.some((pattern) => pattern.test(code(line))));
      });
    }

    it("but not the word workspace in a comment", () => {
      const source = "// Works in untrusted workspaces.\n/** Never reads the workspace. */\nconst a = 1;";
      assert.ok(!FILE_ACCESS.some((pattern) => pattern.test(code(source))));
    });
  });
});

describe(".vscodeignore", () => {
  const ignored = readFileSync(new URL(".vscodeignore", root), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  it("doesn't exclude media/, its dist/ folder or .js files, so the webview bundle ships", () => {
    for (const pattern of ignored) {
      assert.ok(!pattern.startsWith(MEDIA_FOLDER), pattern);
      assert.ok(!pattern.includes("dist") && !pattern.endsWith(".js"), pattern);
    }
    assert.equal(SCRIPT_PATH.at(-1), "main.js");
  });

  it("doesn't exclude the webview's stylesheet, so it ships", () => {
    const stylesheet = STYLE_PATH.join("/");
    assert.ok(existsSync(new URL(stylesheet, root)));
    // A pattern without a slash may match at any depth, so try the file name too.
    for (const path of [stylesheet, STYLE_PATH.at(-1) ?? ""]) {
      for (const pattern of ignored) {
        assert.ok(!matchesGlob(path, pattern), `${pattern} excludes ${path}`);
      }
    }
  });

  it("would catch a pattern that excludes the stylesheet", () => {
    for (const pattern of ["media/**", "**/*.css", "media/styles.css", "*.css"]) {
      assert.ok(
        matchesGlob(STYLE_PATH.join("/"), pattern) || matchesGlob(STYLE_PATH.at(-1) ?? "", pattern),
        pattern,
      );
    }
  });

  it("leaves the webview's TypeScript source out", () => {
    assert.ok(existsSync(new URL("media/main.ts", root)));
    assert.ok(ignored.includes("**/*.ts"));
  });
});
