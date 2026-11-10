// Checks the agent setup guide (docs/agent-integration.md) and the README's
// "Play while your agent works" section (#113): the snippets parse, every
// link is one the URI handler accepts, nothing a hook runs prints, notices are
// said to be off by default, and the settings screenshot is shown.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { readAgentSignal } from "../src/agentSignals.ts";
import { imageLinks } from "./markdown.ts";

const root = new URL("../", import.meta.url);
const GUIDE_PATH = "docs/agent-integration.md";
const guide = readFileSync(new URL(GUIDE_PATH, root), "utf8");
const readme = readFileSync(new URL("README.md", root), "utf8");
/** The maintainer's manual checks, moved out of the guide. */
const checks = readFileSync(new URL("docs/agent-checks.md", root), "utf8");
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as { publisher: string; name: string };

/** The extension's ID, as the links' host: `dconyemerekwe.0xword`. */
const EXTENSION_ID = `${manifest.publisher}.${manifest.name}`;

/** The only links the guide and README may hold: the two signals, in VS Code's scheme or Cursor's. */
const ALLOWED_LINKS: ReadonlySet<string> = new Set(
  ["vscode", "cursor"].flatMap((scheme) =>
    ["agent-started", "agent-finished"].map((path) => `${scheme}://${EXTENSION_ID}/${path}`),
  ),
);

/** The documents under test, by name. */
const DOCUMENTS: readonly (readonly [string, string])[] = [
  ["the guide", guide],
  ["the README", readme],
];

/** The documents whose links and code blocks are checked: the two above and the maintainer's checklist. */
const LINKED_DOCUMENTS: readonly (readonly [string, string])[] = [...DOCUMENTS, ["the maintainer's checklist", checks]];

interface CodeBlock {
  language: string;
  body: string;
}

/** Every fenced code block in a Markdown text, with its language tag ("" if none). */
function codeBlocks(markdown: string): CodeBlock[] {
  return [...markdown.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)].map((match) => ({
    language: match[1] ?? "",
    body: match[2] ?? "",
  }));
}

/**
 * Every `vscode://` or `cursor://` link in a text, as written. A link ends at
 * whitespace, a quote, a backslash (an escaped quote in JSON), a backtick or a
 * bracket. A bare scheme such as "`vscode://` link" names the scheme, not a link.
 */
function schemeLinks(text: string): string[] {
  return [...text.matchAll(/\b(?:vscode|cursor):\/\/[^\s"'`\\()<>[\]]+/g)].map((match) => match[0]);
}

/** Words that make a shell or PowerShell command print. */
const PRINTING = /\b(echo|printf|Write-Output|Write-Host)\b/i;

/** Every hook command in a parsed snippet: each string under a `command`, `bash` or `powershell` key. */
function hookCommands(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(hookCommands);
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, field]) =>
    ["command", "bash", "powershell"].includes(key) && typeof field === "string" ? [field] : hookCommands(field),
  );
}

/** The guide's snippets that set up a tool's hooks: JSON blocks with a `hooks` key. */
function hookSnippets(markdown: string): Record<string, unknown>[] {
  return codeBlocks(markdown)
    .filter((block) => block.language === "json")
    .map((block) => JSON.parse(block.body) as Record<string, unknown>)
    .filter((snippet) => "hooks" in snippet);
}

const OFF_BY_DEFAULT = "Notices are off by default.";
const TURN_ON_SETTING = '"0xword.autoStart.mode": "notify"';

describe("the guide and README snippets", () => {
  for (const [name, text] of DOCUMENTS) {
    it(`every JSON block in ${name} parses`, () => {
      const json = codeBlocks(text).filter((block) => block.language === "json");
      assert.ok(json.length > 0, `${name} has no JSON block`);
      for (const block of json) {
        assert.doesNotThrow(() => JSON.parse(block.body), block.body);
      }
    });
  }

  for (const [name, text] of LINKED_DOCUMENTS) {
    it(`no code block in ${name} prints: no echo, printf, Write-Output or Write-Host`, () => {
      for (const block of codeBlocks(text)) {
        assert.doesNotMatch(block.body, PRINTING, block.body);
      }
    });
  }

  it("the guide has a hook snippet for each of the five tool setups", () => {
    assert.equal(hookSnippets(guide).length, 5);
  });

  it("every hook command just opens one of the two links, with VS Code's or Cursor's launcher", () => {
    const commands = [...hookSnippets(guide), ...hookSnippets(readme)].flatMap(hookCommands);
    assert.ok(commands.length > 0);
    for (const command of commands) {
      assert.match(command, /^(code --open-url "vscode|cursor --open-url "cursor):\/\/[^"]+"$/, command);
      assert.doesNotMatch(command, PRINTING, command);
    }
  });

  it("the README shows the Claude Code setup, the same as the guide's", () => {
    const [readmeSnippet] = hookSnippets(readme);
    const [guideSnippet] = hookSnippets(guide);
    assert.ok(readmeSnippet);
    assert.deepEqual(readmeSnippet, guideSnippet);
    assert.deepEqual(Object.keys(readmeSnippet.hooks as object), ["UserPromptSubmit", "Stop"]);
  });

  describe("the print check catches", () => {
    for (const command of ['echo "hi"', "printf x", "Write-Output x", "write-host x", "code --open-url x && echo done"]) {
      it(command, () => {
        assert.match(command, PRINTING);
      });
    }
    it("but not the plain link commands", () => {
      assert.doesNotMatch('code --open-url "vscode://dconyemerekwe.0xword/agent-started"', PRINTING);
    });
  });
});

describe("the guide and README links", () => {
  for (const [name, text] of LINKED_DOCUMENTS) {
    it(`every vscode:// or cursor:// link in ${name} is one of the two the handler accepts`, () => {
      const links = schemeLinks(text);
      assert.ok(links.length > 0, `${name} has no link`);
      for (const link of links) {
        assert.ok(ALLOWED_LINKS.has(link), link);
        const url = new URL(link);
        assert.equal(url.host, EXTENSION_ID, link);
        assert.notEqual(readAgentSignal({ path: url.pathname, query: url.search, fragment: url.hash }), null, link);
      }
    });

    it(`${name} has no placeholder ID left`, () => {
      assert.doesNotMatch(text, /<publisher>|<extension-id>/);
    });
  }

  it("the guide uses both links in both schemes", () => {
    assert.deepEqual(new Set(schemeLinks(guide)), ALLOWED_LINKS);
  });

  describe("the link check finds", () => {
    const found: readonly (readonly [string, readonly string[]])[] = [
      ['"vscode://dconyemerekwe.0xword/agent-started"', ["vscode://dconyemerekwe.0xword/agent-started"]],
      ['\\"cursor://dconyemerekwe.0xword/agent-finished\\"', ["cursor://dconyemerekwe.0xword/agent-finished"]],
      ["vscode://dconyemerekwe.0xword/agent-started?x=1", ["vscode://dconyemerekwe.0xword/agent-started?x=1"]],
      // A placeholder ID isn't read as a link; the placeholder test catches it.
      ["vscode://<publisher>.<extension-id>/agent-started", []],
      ["a bare scheme, as in a `vscode://` link", []],
    ];
    for (const [text, links] of found) {
      it(text, () => {
        assert.deepEqual(schemeLinks(text), links);
      });
    }
    it("and rejects a link with a query, another path or another ID", () => {
      for (const link of [
        "vscode://dconyemerekwe.0xword/agent-started?x=1",
        "vscode://dconyemerekwe.0xword/agent-paused",
        "vscode://someone.else/agent-started",
      ]) {
        assert.ok(!ALLOWED_LINKS.has(link), link);
      }
    });
  });
});

describe("notices are off by default", () => {
  it("the guide says so in its opening note, with how to turn them on", () => {
    const opening = guide.split("\n").find((line) => line.startsWith("> ")) ?? "";
    assert.ok(opening.includes(OFF_BY_DEFAULT));
    assert.ok(opening.includes("**Settings → Extensions → 0xWORD**"));
    assert.ok(opening.includes("**Auto Start: Mode**"));
    assert.ok(opening.includes("`notify` or `open`"));
    assert.ok(opening.includes(TURN_ON_SETTING));
    assert.ok(guide.indexOf(opening) < guide.indexOf("\n## "), "the note comes before the first section");
  });

  it("the README says so first in its agent section, with how to turn them on", () => {
    const lines = readme.split("\n");
    const start = lines.indexOf("## Play while your agent works");
    const first = lines.slice(start + 1).find((line) => line.trim() !== "") ?? "";
    assert.ok(first.includes(OFF_BY_DEFAULT));
    assert.ok(first.includes("**Settings → Extensions → 0xWORD**"));
    assert.ok(first.includes("**Auto Start: Mode**"));
    assert.ok(first.includes("`notify` or `open`"));
    assert.ok(first.includes(TURN_ON_SETTING));
  });

  it("the guide tells players to tick Don't ask again once", () => {
    assert.ok(guide.includes("**Allow an extension to open this URI?**"));
    assert.ok(guide.includes("**Don't ask again**"));
    assert.ok(readme.includes("**Don't ask again**"));
  });
});

/** A tool's `### ` section of the guide, up to the next heading of any level. */
function toolSection(tool: string): string {
  const start = guide.indexOf(`\n### ${tool}\n`);
  assert.notEqual(start, -1, `missing ### ${tool}`);
  return guide.slice(start + 1).split(/\n#{2,3} /)[0] ?? "";
}

describe("the guide as a setup guide", () => {
  it('no longer says "Planned for Phase 7"', () => {
    assert.doesNotMatch(guide, /Planned for Phase 7/);
  });

  it("says when each tool's section was checked, against which docs", () => {
    const sections = ["Claude Code", "GitHub Copilot agent hooks in VS Code", "Copilot CLI", "Cursor", "Codex"];
    const headings = guide.split("\n").filter((line) => line.startsWith("### "));
    for (const tool of sections) {
      assert.ok(headings.includes(`### ${tool}`), `missing ${tool}`);
      assert.match(toolSection(tool), /Checked \d{4}-\d{2}-\d{2} against \[[^\]]+\]\(https:\/\/[^)]+\)/, tool);
    }
  });

  it("marks Cursor's snippet as not yet tested", () => {
    assert.ok(toolSection("Cursor").includes("Not yet tested; check before relying on it."));
  });

  it("states the known limits: Copilot CLI's agentStop and sessionEnd, Codex's notify, Cursor and other editors", () => {
    const start = guide.indexOf("\n## Known limits\n");
    assert.notEqual(start, -1, "missing ## Known limits");
    const limits = guide.slice(start + 1).split(/\n## /)[0] ?? "";
    const copilot = limits.split("\n").find((line) => line.startsWith("- **Copilot CLI**")) ?? "";
    assert.ok(copilot.includes("`agentStop`") && copilot.includes("`sessionEnd`"), copilot);
    const codex = limits.split("\n").find((line) => line.startsWith("- **Codex**")) ?? "";
    assert.ok(codex.includes("`notify`") && codex.includes("`agent-finished`"), codex);
    assert.ok(limits.includes("**Cursor's**"));
    assert.ok(limits.includes("`code-insiders`") && limits.includes("`codium`"));
  });

  it("keeps the maintainer's test steps out of the guide, in agent-checks.md", () => {
    assert.doesNotMatch(guide, /0xword-vsix|this PR|Install from VSIX/);
    assert.ok(guide.includes("[agent-checks.md](agent-checks.md)"));
    assert.ok(guide.includes("\n## What's been checked\n"));
    assert.match(checks.split("\n").find((line) => line.startsWith("> ")) ?? "", /For the maintainer, not for players/);
    for (const heading of ["## The owner's checks on Windows (#109)", "## The owner's check for `open` mode (#111)", "## Still open"]) {
      assert.ok(checks.split("\n").includes(heading), heading);
    }
  });
});

describe("the settings screenshot", () => {
  const SCREENSHOT = "docs/screenshots/notice-settings.png";

  it("is in the repo", () => {
    assert.ok(existsSync(new URL(SCREENSHOT, root)));
  });

  for (const [name, text, link] of [
    ["the guide", guide, "screenshots/notice-settings.png"],
    ["the README", readme, SCREENSHOT],
  ] as const) {
    it(`${name} shows it by a relative path, with plain alt text`, () => {
      assert.ok(imageLinks(text).includes(link));
      const alt = [...text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].find((match) => match[2] === link)?.[1] ?? "";
      assert.ok(alt.trim().length > 0, "alt text is empty");
      assert.doesNotMatch(alt, /[*`_<>]/, "alt text is plain");
    });
  }
});

describe("copying a snippet into a config file that already exists (#120)", () => {
  it("each setup that adds to an existing file says how to merge into its hooks", () => {
    for (const [name, text] of [
      ["README", readme.slice(readme.indexOf("## Play while your agent works"), readme.indexOf("## No telemetry"))],
      ["Cursor", toolSection("Cursor")],
      ["Codex", toolSection("Codex")],
    ] as const) {
      assert.match(text, /already (has|have|exists)/, `${name} doesn't say what to do if the file already exists`);
    }
  });

  it("the Claude Code note adds to an existing UserPromptSubmit or Stop list instead of a second key", () => {
    assert.match(toolSection("Claude Code"), /already has a `(UserPromptSubmit|Stop)`|existing `(UserPromptSubmit|Stop)`/);
  });
});
