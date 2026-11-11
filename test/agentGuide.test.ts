// Checks the agent setup guide (docs/agent-integration.md) and the README's
// short "Play while your agent works" section (#113): the guide's snippets
// parse, every link is one the URI handler accepts, nothing a hook runs prints,
// notices are said to be off by default, the settings screenshot is shown, and
// the README leaves the setup to the guide. Also checks the snippets the copy
// command copies (#114) are the guide's, and print nothing.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { readAgentSignal } from "../src/agentSignals.ts";
import { AgentTool, CURSOR, TOOL_ITEMS, VS_CODE, editorFor, hookSnippet } from "../src/hookSnippets.ts";
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

/** The README's "Play while your agent works" section, up to the next section. */
const readmeAgentSection = ((): string => {
  const start = readme.indexOf("## Play while your agent works");
  const end = readme.indexOf("## No telemetry");
  assert.ok(start >= 0, "the README has no ## Play while your agent works");
  assert.ok(end >= 0, "the README has no ## No telemetry");
  return readme.slice(start, end);
})();

/** The documents whose links and code blocks are checked: the guide and the maintainer's checklist. */
const LINKED_DOCUMENTS: readonly (readonly [string, string])[] = [
  ["the guide", guide],
  ["the maintainer's checklist", checks],
];

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

describe("the guide's snippets", () => {
  it("every JSON block in the guide parses", () => {
    const json = codeBlocks(guide).filter((block) => block.language === "json");
    assert.ok(json.length > 0, "the guide has no JSON block");
    for (const block of json) {
      assert.doesNotThrow(() => JSON.parse(block.body), block.body);
    }
  });

  for (const [name, text] of [...LINKED_DOCUMENTS, ["the README", readme]]) {
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
    const commands = hookSnippets(guide).flatMap(hookCommands);
    assert.ok(commands.length > 0);
    for (const command of commands) {
      assert.match(command, /^(code --open-url "vscode|cursor --open-url "cursor):\/\/[^"]+"$/, command);
      assert.doesNotMatch(command, PRINTING, command);
    }
  });

  it("the README keeps setup in the guide: its agent section has no snippet, screenshot or hook link, and links to the guide", () => {
    assert.deepEqual(codeBlocks(readmeAgentSection), []);
    assert.deepEqual(imageLinks(readmeAgentSection), []);
    assert.deepEqual(schemeLinks(readme), []);
    assert.doesNotMatch(readme, /<publisher>|<extension-id>/);
    assert.doesNotMatch(readmeAgentSection, /Don't ask again/);
    assert.ok(readmeAgentSection.includes("[docs/agent-integration.md](docs/agent-integration.md)"));
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

describe("the guide's links", () => {
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
    assert.match(checks.split("\n").find((line) => line.startsWith("> ")) ?? "", /For the maintainer, not for players/);
    for (const heading of ["## The owner's checks on Windows (#109)", "## The owner's check for `open` mode (#111)", "## Still open"]) {
      assert.ok(checks.split("\n").includes(heading), heading);
    }
  });
});

describe("the guide is for players only", () => {
  /** What only the maintainer needs: owner check numbers, the checklist, issue numbers and roadmap. */
  const MAINTAINER_ONLY = [
    /\bcheck \d/i,
    /\(expected;/,
    /agent-checks/,
    /What's been checked/,
    /#\d+/,
    /\bplanned\b|\bPhase \d/i,
    /\bthe owner\b/i,
  ];

  it("mentions no owner checks, maintainer checklist, issue numbers or roadmap", () => {
    for (const pattern of MAINTAINER_ONLY) {
      assert.doesNotMatch(guide, pattern);
    }
  });

  it("the check catches check 5, agent-checks.md, #114 and a planned command", () => {
    for (const text of [
      "(expected; see check 5)",
      "see [agent-checks.md](agent-checks.md)",
      "planned for a later update (#114)",
      "A **0xWORD: Copy agent hook setup** command is planned",
    ]) {
      assert.ok(MAINTAINER_ONLY.some((pattern) => pattern.test(text)), text);
    }
  });

  it("still says plainly what hasn't been tested", () => {
    assert.match(guide, /This hasn't been tested yet\./);
    const limits = guide.slice(guide.indexOf("\n## Known limits\n")).split(/\n## /)[1] ?? "";
    assert.match(limits, /Several VS Code windows/);
  });

  it("states as a known limit that the links were only tried on Windows, and background hooks not at all", () => {
    const limits = guide.slice(guide.indexOf("\n## Known limits\n")).split(/\n## /)[1] ?? "";
    const windows = limits.split("\n").find((line) => line.startsWith("- **Only tried on Windows.**")) ?? "";
    assert.match(windows, /has only been tried on Windows/);
    assert.match(windows, /in the background haven't been tested yet/);
  });
});

describe("the settings screenshot", () => {
  const SCREENSHOT = "docs/screenshots/notice-settings.png";

  it("is in the repo", () => {
    assert.ok(existsSync(new URL(SCREENSHOT, root)));
  });

  it("the guide shows it by a relative path, with plain alt text describing open mode", () => {
    const link = "screenshots/notice-settings.png";
    assert.ok(imageLinks(guide).includes(link));
    const alt = [...guide.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].find((match) => match[2] === link)?.[1] ?? "";
    assert.ok(alt.trim().length > 0, "alt text is empty");
    assert.doesNotMatch(alt, /[*`_<>]/, "alt text is plain");
    assert.match(alt, /Auto Start: Mode set to open/);
  });
});

describe("the copy hook setup screenshot", () => {
  const SCREENSHOT = "docs/screenshots/copy-hook-setup.png";
  const link = "screenshots/copy-hook-setup.png";

  it("is in the repo", () => {
    assert.ok(existsSync(new URL(SCREENSHOT, root)));
  });

  it("the guide shows it once, right after the line naming the command, with plain alt text naming every tool", () => {
    assert.equal(imageLinks(guide).filter((shown) => shown === link).length, 1);
    const lines = guide.split("\n");
    const at = lines.findIndex((line) => line.includes(`(${link})`));
    assert.match(lines[at - 2] ?? "", /^You can also copy your tool's setup with /);
    const alt = [...guide.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].find((match) => match[2] === link)?.[1] ?? "";
    assert.doesNotMatch(alt, /[*`_<>]/, "alt text is plain");
    for (const tool of ["Claude Code", "GitHub Copilot agent hooks in VS Code", "Copilot CLI", "Cursor", "Codex"]) {
      assert.ok(alt.includes(tool), `alt text doesn't name ${tool}`);
    }
  });
});

describe("copying a snippet into a config file that already exists (#120)", () => {
  it("each setup that adds to an existing file says how to merge into its hooks", () => {
    for (const [name, text] of [
      ["Claude Code", toolSection("Claude Code")],
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

describe("the snippets 0xWORD: Copy agent hook setup copies (#114)", () => {
  /** The guide's JSON block in a tool's section: its only one with a `hooks` key. */
  function guideSnippet(tool: string): string {
    const blocks = codeBlocks(toolSection(tool)).filter((block) => block.language === "json" && /"hooks"/.test(block.body));
    assert.equal(blocks.length, 1, tool);
    return blocks[0]?.body ?? "";
  }

  /** Every editor scheme the command knows, plus one it doesn't. */
  const SCHEMES = ["vscode", "vscode-insiders", "vscodium", "cursor", "windsurf"];

  it("lists the tools by the guide's section headings, each naming a file the section names", () => {
    for (const item of TOOL_ITEMS) {
      const section = toolSection(item.label);
      const folder = item.detail.slice(0, item.detail.lastIndexOf("/") + 1);
      assert.ok(section.includes(`\`${item.detail}\``) || section.includes(`\`${folder}\``), item.label);
    }
  });

  it("in VS Code, are the guide's snippets word for word", () => {
    for (const item of TOOL_ITEMS) {
      assert.equal(`${hookSnippet(item.tool, editorFor("vscode"))}\n`, guideSnippet(item.label), item.label);
    }
  });

  it("in Cursor, are the guide's Cursor snippet for Cursor, using Cursor's own scheme", () => {
    assert.equal(`${hookSnippet(AgentTool.Cursor, editorFor("cursor"))}\n`, guideSnippet("Cursor"));
    assert.equal(hookSnippet(AgentTool.Cursor, VS_CODE), hookSnippet(AgentTool.Cursor, CURSOR));
  });

  it("in an editor the command doesn't know, are the guide's snippets", () => {
    for (const item of TOOL_ITEMS) {
      assert.equal(`${hookSnippet(item.tool, editorFor("windsurf"))}\n`, guideSnippet(item.label), item.label);
    }
  });

  it("print nothing, in every editor: every command just opens a signal link", () => {
    for (const scheme of SCHEMES) {
      for (const { tool } of TOOL_ITEMS) {
        const snippet = hookSnippet(tool, editorFor(scheme));
        assert.doesNotMatch(snippet, PRINTING, `${tool} in ${scheme}`);
        const commands = hookCommands(JSON.parse(snippet));
        assert.equal(commands.length, 2, `${tool} in ${scheme}`);
        for (const command of commands) {
          assert.match(command, /^[a-z-]+ --open-url "[a-z-]+:\/\/dconyemerekwe\.0xword\/agent-(started|finished)"$/, command);
          assert.doesNotMatch(command, PRINTING, command);
        }
      }
    }
  });

  it("the guide points players to the command in one line", () => {
    const line = "You can also copy your tool's setup with **0xWORD: Copy agent hook setup**.";
    assert.equal(guide.split("\n").filter((text) => text.includes("Copy agent hook setup")).length, 1);
    assert.ok(guide.split("\n").includes(line));
  });
});
