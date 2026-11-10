// Checks the package.json contributions and what the .vsix ships.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { matchesGlob } from "node:path/posix";
import { describe, it } from "node:test";
import {
  DEFAULT_NOTICE_SETTINGS,
  MAX_DELAY_SECONDS,
  SETTINGS_SECTION,
  readNoticeSettings,
} from "../src/noticeSettings.ts";
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

interface Setting {
  type?: string;
  enum?: string[];
  enumDescriptions?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  order?: number;
  scope?: string;
  description?: string;
  markdownDescription?: string;
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
    configuration?: { title?: string; properties?: Record<string, Setting> };
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
 * node_modules/@vscode/vsce/out/package.js (vsce 4.1.0). None fits 0xWORD:
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

  it("checks the description against exactly the words in the installed vsce's TagsProcessor.Keywords", () => {
    const { TagsProcessor } = createRequire(import.meta.url)("@vscode/vsce/out/package.js") as {
      TagsProcessor: { Keywords: Record<string, string[]> };
    };
    assert.deepEqual(DESCRIPTION_TAG_WORDS, Object.keys(TagsProcessor.Keywords));
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

  it("relies on the implicit onCommand activation, with onUri as the only extra activation event", () => {
    // URI handlers have no contribution point, so VS Code can't add onUri itself.
    assert.deepEqual(manifest.activationEvents ?? [], ["onUri"]);
  });

  it("supports untrusted workspaces for the command", () => {
    assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, true);
  });
});

describe("agent links (#109)", () => {
  const agentCode = code(extensionSource);

  it("registers one URI handler and pushes it and the status-bar item into the subscriptions", () => {
    assert.equal(agentCode.match(/registerUriHandler\(/g)?.length, 1);
    // #110 passes the view provider in, for the badge, and adds the settings listener.
    assert.ok(agentCode.includes("...agentSignals(provider),"));
    // #111 adds the open-mode timer's disposable.
    assert.ok(agentCode.includes("return [item, handler, settingsListener, badge, openWait];"));
  });

  it("reads links only through the pure reader, passing plain strings", () => {
    assert.ok(
      agentCode.includes("readAgentSignal({ path: uri.path, query: uri.query, fragment: uri.fragment })"),
    );
  });

  it('shows "0x Round ready" with a tooltip and accessible name', () => {
    assert.ok(agentCode.includes('item.text = "0x Round ready";'));
    assert.ok(agentCode.includes('const ROUND_READY_LABEL = "0xWORD: a round is ready. Open the panel.";'));
    assert.ok(agentCode.includes("item.tooltip = ROUND_READY_LABEL;"));
    assert.ok(agentCode.includes("label: ROUND_READY_LABEL"));
  });

  it("opens the panel on click by focusing the view, never by starting a new round", () => {
    assert.ok(agentCode.includes("item.command = { command: `${VIEW_ID}.focus`"));
    assert.doesNotMatch(agentCode, /item\.command\s*=\s*NEW_ROUND_COMMAND/);
    assert.doesNotMatch(agentCode, /command:\s*NEW_ROUND_COMMAND/);
  });

  it("never focuses or touches the round from the link handler, and shows a message only as the pop-up, when showPopup allows it", () => {
    const handler = /handleUri: \(uri\) => \{[\s\S]*?\n {4}\},/.exec(agentCode)?.[0];
    assert.ok(handler);
    for (const call of ["showErrorMessage", "showWarningMessage", "showInformationMessage", "newRound", "focus"]) {
      assert.ok(!handler.includes(call), call);
    }
    // #110: the pop-up is the only message, and only inside the showPopup check.
    assert.equal(handler.match(/roundReadyPopup\(\)/g)?.length, 1);
    assert.match(handler, /\n {6}if \(showPopup\(change, settings\)\) \{\n {8}roundReadyPopup\(\);\n {6}\}\n/);
  });
});

describe("notice settings (#110)", () => {
  const configuration = manifest.contributes?.configuration;
  const properties = configuration?.properties ?? {};
  const agentCode = code(extensionSource);

  /** A setting's description, plain or markdown. */
  function describedAs(setting: Setting | undefined): string {
    return setting?.markdownDescription ?? setting?.description ?? "";
  }

  it("lists exactly the five settings under 0xWORD", () => {
    assert.equal(configuration?.title, "0xWORD");
    assert.deepEqual(Object.keys(properties).sort(), [
      "0xword.autoStart.delaySeconds",
      "0xword.autoStart.mode",
      "0xword.notify.badge",
      "0xword.notify.popup",
      "0xword.notify.statusBar",
    ]);
  });

  it("makes autoStart.mode a choice of off, notify or open, off by default, with a description for each", () => {
    const mode = properties["0xword.autoStart.mode"];
    assert.equal(mode?.type, "string");
    assert.deepEqual(mode?.enum, ["off", "notify", "open"]);
    assert.equal(mode?.default, "off");
    assert.equal(mode?.enumDescriptions?.length, 3);
    for (const text of mode?.enumDescriptions ?? []) {
      assert.ok(text.trim().length > 0);
    }
  });

  it("says in the mode's description that notices are off by default and to choose notify to turn them on", () => {
    const text = describedAs(properties["0xword.autoStart.mode"]);
    assert.match(text, /`off` by default/);
    assert.match(text, /Choose `notify` to turn them on/);
    assert.match(text, /`open` to open the panel/);
    assert.match(
      text,
      /`open` is agent-driven: when your agent's hooks report it has started, 0xWORD waits `delaySeconds`, then opens the panel and starts a new round if none is in progress\. A round in progress is kept as it is\.$/,
    );
  });

  it("makes autoStart.delaySeconds a number of seconds, 20 by default, from 0 to an hour, only for open mode (#111)", () => {
    const delay = properties["0xword.autoStart.delaySeconds"];
    assert.equal(delay?.type, "number");
    assert.equal(delay?.default, 20);
    assert.equal(delay?.minimum, 0);
    assert.equal(delay?.maximum, MAX_DELAY_SECONDS);
    assert.equal(delay?.scope, "window");
    assert.match(describedAs(delay), /^Only in `open` mode/);
  });

  it("describes open mode as agent-driven, opening the panel and showing none of the notices (#111, #112)", () => {
    const mode = properties["0xword.autoStart.mode"];
    const open = mode?.enumDescriptions?.[mode.enum?.indexOf("open") ?? -1] ?? "";
    assert.match(
      open,
      /^Agent-driven: when your agent's hooks report that it has started working, 0xWORD waits Delay Seconds, then opens its panel and starts a new round if none is in progress\. A round in progress is kept as it is\. If your agent finishes first, nothing opens\. Shows none of the notices\.$/,
    );
    assert.match(open, /none of the notices/);
    for (const key of ["0xword.notify.badge", "0xword.notify.statusBar", "0xword.notify.popup"]) {
      assert.match(describedAs(properties[key]), /^In `notify` mode/, key);
    }
  });

  it("orders the settings: mode, delay, then the notices", () => {
    const order = Object.entries(properties)
      .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0))
      .map(([key]) => key);
    assert.deepEqual(order, [
      "0xword.autoStart.mode",
      "0xword.autoStart.delaySeconds",
      "0xword.notify.badge",
      "0xword.notify.statusBar",
      "0xword.notify.popup",
    ]);
  });

  it("makes the badge and status bar on by default and the pop-up off, all on/off", () => {
    const defaults: readonly (readonly [string, boolean])[] = [
      ["0xword.notify.badge", true],
      ["0xword.notify.statusBar", true],
      ["0xword.notify.popup", false],
    ];
    for (const [key, value] of defaults) {
      assert.equal(properties[key]?.type, "boolean", key);
      assert.equal(properties[key]?.default, value, key);
    }
  });

  it("gives every setting a plain description", () => {
    for (const [key, setting] of Object.entries(properties)) {
      assert.ok(describedAs(setting).length > 20, key);
    }
  });

  it("lets a workspace value override the user's: no setting is application or machine scoped", () => {
    for (const [key, setting] of Object.entries(properties)) {
      assert.ok(setting.scope === undefined || ["window", "resource"].includes(setting.scope), key);
    }
  });

  it("gives the same defaults as the settings reader", () => {
    assert.equal(properties["0xword.autoStart.mode"]?.default, DEFAULT_NOTICE_SETTINGS.mode);
    assert.equal(properties["0xword.notify.badge"]?.default, DEFAULT_NOTICE_SETTINGS.badge);
    assert.equal(properties["0xword.notify.statusBar"]?.default, DEFAULT_NOTICE_SETTINGS.statusBar);
    assert.equal(properties["0xword.notify.popup"]?.default, DEFAULT_NOTICE_SETTINGS.popup);
    assert.equal(properties["0xword.autoStart.delaySeconds"]?.default, DEFAULT_NOTICE_SETTINGS.delaySeconds);
  });

  it("matches each setting the reader asks for to a contributed one", () => {
    const asked: string[] = [];
    readNoticeSettings((key) => {
      asked.push(`${SETTINGS_SECTION}.${key}`);
      return undefined;
    });
    assert.deepEqual(asked.sort(), Object.keys(properties).sort());
  });

  it("reads the settings with workspace.getConfiguration, through the pure reader", () => {
    assert.ok(agentCode.includes("vscode.workspace.getConfiguration(SETTINGS_SECTION)"));
    assert.ok(agentCode.includes("readNoticeSettings((key) => config.get<unknown>(key))"));
    assert.equal(agentCode.match(/getConfiguration\(/g)?.length, 1);
  });

  it("applies a change straight away with onDidChangeConfiguration, and disposes the listener", () => {
    assert.ok(agentCode.includes("const settingsListener = vscode.workspace.onDidChangeConfiguration("));
    assert.ok(agentCode.includes("event.affectsConfiguration(SETTINGS_SECTION)"));
    assert.ok(agentCode.includes("return [item, handler, settingsListener, badge, openWait];"));
  });

  it("keeps nothing about the settings in globalState", () => {
    const uses = agentCode.match(/globalState/g) ?? [];
    // Only the stats and theme stores, as before #110.
    assert.equal(uses.length, 2);
    assert.ok(agentCode.includes("new StatsStore(context.globalState), new ThemeStore(context.globalState)"));
  });

  it("gives the badge the number 1 and an accessible label, and clears it when the extension stops", () => {
    assert.ok(agentCode.includes('const BADGE_LABEL = "0xWORD: a round is ready";'));
    assert.ok(agentCode.includes("{ value: 1, tooltip: BADGE_LABEL }"));
    assert.ok(agentCode.includes("new vscode.Disposable(() => provider.setBadge(false))"));
  });

  it("sets the badge when the view resolves, in case the agent is already working", () => {
    const resolve = /resolveWebviewView\(view: vscode\.WebviewView\): void \{[\s\S]*?\n {2}\}/.exec(agentCode)?.[0];
    assert.ok(resolve);
    assert.ok(resolve.includes("this.#applyBadge();"));
  });

  it("shows the pop-up with Play and Not now, unawaited, and Play only focuses the view", () => {
    const popup = /function roundReadyPopup\(\): void \{[\s\S]*?\n\}/.exec(agentCode)?.[0];
    assert.ok(popup);
    assert.ok(agentCode.includes('const POPUP_PLAY = "Play";'));
    assert.ok(agentCode.includes('const POPUP_NOT_NOW = "Not now";'));
    assert.ok(popup.includes("showInformationMessage(POPUP_MESSAGE, POPUP_PLAY, POPUP_NOT_NOW)"));
    assert.ok(popup.includes("executeCommand(`${VIEW_ID}.focus`)"));
    assert.ok(!popup.includes("NEW_ROUND_COMMAND") && !popup.includes("newRound"));
    assert.ok(!popup.includes("await"));
    assert.ok(popup.includes(".then(undefined, () => undefined)"));
  });

  it("shows the pop-up only after a signal, never from a settings change", () => {
    assert.equal(agentCode.match(/roundReadyPopup\(\);/g)?.length, 1);
    assert.ok(agentCode.includes("if (showPopup(change, settings)) {"));
  });

  it("puts nothing from a link into a notice: every message is a fixed string", () => {
    assert.match(agentCode, /const POPUP_MESSAGE = "[^"`$]*";/);
    assert.equal(agentCode.match(/showInformationMessage\(/g)?.length, 1);
  });
});

describe("open mode (#111)", () => {
  const agentCode = code(extensionSource);
  /** The provider's `agentOpen` method, which the timer calls. */
  const agentOpen = /\n {2}agentOpen\(\): void \{[\s\S]*?\n {2}\}\n/.exec(agentCode)?.[0] ?? "";

  it("makes one OpenTimer with the real clock, which opens through the provider", () => {
    assert.equal(agentCode.match(/new OpenTimer\(/g)?.length, 1);
    assert.ok(agentCode.includes("const timer = new OpenTimer(schedule, () => provider.agentOpen());"));
    assert.match(agentCode, /const handle = setTimeout\(callback, milliseconds\);\n\s*return \(\) => clearTimeout\(handle\);/);
  });

  it("gives the timer every signal and every settings change", () => {
    const handler = /handleUri: \(uri\) => \{[\s\S]*?\n {4}\},/.exec(agentCode)?.[0] ?? "";
    assert.ok(handler.includes("timer.signal(signal, settings);"));
    assert.ok(handler.includes("readAgentSignal({ path: uri.path, query: uri.query, fragment: uri.fragment })"));
    const listener = /onDidChangeConfiguration\(\(event\) => \{[\s\S]*?\n {2}\}\);/.exec(agentCode)?.[0] ?? "";
    assert.ok(listener.includes("timer.settingsChanged(settings);"));
  });

  it("disposes the timer with the extension, so a wait in progress is cancelled", () => {
    assert.ok(agentCode.includes("const openWait = new vscode.Disposable(() => timer.dispose());"));
    assert.ok(agentCode.includes("return [item, handler, settingsListener, badge, openWait];"));
  });

  it("opens a resolved view without taking keyboard focus, and returns before any focus command", () => {
    assert.ok(agentOpen, "the provider has an agentOpen method");
    assert.match(
      agentOpen,
      /\n {4}if \(this\.#view\) \{\n {6}try \{\n {8}this\.#view\.show\(true\);\n {8}return;\n {6}\} catch \{\s*\}\n {4}\}\n/,
    );
    // Nothing else in the method shows or focuses the view.
    assert.equal(agentOpen.match(/\.show\(/g)?.length, 1);
    assert.doesNotMatch(agentOpen, /\.show\(\s*(false)?\s*\)/);
    assert.doesNotMatch(agentOpen, /preserveFocus:\s*false/);
  });

  it("uses the view's focus command only as the fallback for a view never resolved, after the show(true) path", () => {
    const focusCalls = agentOpen.match(/executeCommand\(`\$\{VIEW_ID\}\.focus`\)/g) ?? [];
    assert.equal(focusCalls.length, 1);
    assert.ok(agentOpen.indexOf("this.#view.show(true);") < agentOpen.indexOf("executeCommand(`${VIEW_ID}.focus`)"));
    // The fallback is the method's last statement, outside the `if (this.#view)` block.
    assert.match(agentOpen, /\n {4}vscode\.commands\.executeCommand\(`\$\{VIEW_ID\}\.focus`\)\.then\(undefined, \(\) => undefined\);\n {2}\}\n$/);
  });

  it("never starts a round with New Round when opening", () => {
    assert.ok(agentOpen, "the provider has an agentOpen method");
    for (const banned of ["NEW_ROUND_COMMAND", "newRound", "sendNewRound", "this.#requests.request()"]) {
      assert.ok(!agentOpen.includes(banned), banned);
    }
    assert.equal(agentCode.match(/provider\.agentOpen\(\)/g)?.length, 1, "only the timer calls it");
  });

  it("sends the webview only the fixed agentOpen message, now or once it's ready", () => {
    assert.ok(agentOpen.includes("void sendAgentOpen(this.#requests, this.#postToView, this.#requests.requestOpen());"));
    assert.ok(!agentOpen.includes("await"), "the timer never waits");
    assert.ok(agentOpen.includes(".then(undefined, () => undefined)"), "a failed focus is ignored");
  });
});

describe("the agent-finished message (#112)", () => {
  const agentCode = code(extensionSource);
  /** The provider's `agentFinished` method, which the link handler calls. */
  const agentFinished = /\n {2}agentFinished\(\): void \{[\s\S]*?\n {2}\}\n/.exec(agentCode)?.[0] ?? "";
  const handler = /handleUri: \(uri\) => \{[\s\S]*?\n {4}\},/.exec(agentCode)?.[0] ?? "";

  it("tells the provider only from the link handler, inside the tellAgentFinished check", () => {
    assert.match(handler, /\n {6}if \(tellAgentFinished\(change, settings\)\) \{\n {8}provider\.agentFinished\(\);\n {6}\}\n/);
    assert.equal(agentCode.match(/provider\.agentFinished\(\)/g)?.length, 1, "only the link handler calls it");
    const listener = /onDidChangeConfiguration\(\(event\) => \{[\s\S]*?\n {2}\}\);/.exec(agentCode)?.[0] ?? "";
    assert.ok(listener, "the settings listener");
    assert.ok(!listener.includes("agentFinished"), "a settings change never sends it");
  });

  it("only posts the fixed message, if the webview is listening now, and never waits", () => {
    assert.ok(agentFinished, "the provider has an agentFinished method");
    assert.match(agentFinished, /^\n {2}agentFinished\(\): void \{\n {4}void sendAgentFinished\(this\.#requests, this\.#postToView\);\n {2}\}\n$/);
  });

  it("never opens, focuses or starts a round, and keeps nothing for later", () => {
    for (const banned of ["focus", "show(", "newRound", "NEW_ROUND_COMMAND", "requestOpen", "request()", "await"]) {
      assert.ok(!agentFinished.includes(banned), banned);
    }
  });

  describe("agentStarted, which clears it when a new run starts", () => {
    const agentStarted = /\n {2}agentStarted\(\): void \{[\s\S]*?\n {2}\}\n/.exec(agentCode)?.[0] ?? "";

    it("tells the provider only from the link handler, inside the tellAgentStarted check", () => {
      assert.match(handler, /\n {6}if \(tellAgentStarted\(change, settings\)\) \{\n {8}provider\.agentStarted\(\);\n {6}\}\n/);
      assert.equal(agentCode.match(/provider\.agentStarted\(\)/g)?.length, 1, "only the link handler calls it");
      const listener = /onDidChangeConfiguration\(\(event\) => \{[\s\S]*?\n {2}\}\);/.exec(agentCode)?.[0] ?? "";
      assert.ok(!listener.includes("agentStarted"), "a settings change never sends it");
    });

    it("only posts the fixed message, if the webview is listening now, and never waits", () => {
      assert.match(agentStarted, /^\n {2}agentStarted\(\): void \{\n {4}void sendAgentStarted\(this\.#requests, this\.#postToView\);\n {2}\}\n$/);
    });

    it("never opens, focuses or starts a round, and keeps nothing for later", () => {
      assert.ok(agentStarted, "the provider has an agentStarted method");
      for (const banned of ["focus", "show(", "newRound", "NEW_ROUND_COMMAND", "requestOpen", "request()", "await"]) {
        assert.ok(!agentStarted.includes(banned), banned);
      }
    });
  });
});

describe("the result-card line follows the agent (#121)", () => {
  const agentCode = code(extensionSource);
  /** `update`, which both the link handler and the settings listener call. */
  const update = /const update = \(settings: NoticeSettings\): void => \{[\s\S]*?\n {2}\};/.exec(agentCode)?.[0] ?? "";
  const handler = /handleUri: \(uri\) => \{[\s\S]*?\n {4}\},/.exec(agentCode)?.[0] ?? "";
  const listener = /onDidChangeConfiguration\(\(event\) => \{[\s\S]*?\n {2}\}\);/.exec(agentCode)?.[0] ?? "";
  /** The provider's `setAgentState` method. */
  const setAgentState = /\n {2}setAgentState\(state: AgentState\): void \{[\s\S]*?\n {2}\}\n/.exec(agentCode)?.[0] ?? "";

  it("records the state from the last signal and the mode in update, after every signal and settings change", () => {
    assert.ok(update, "update");
    assert.ok(update.includes("provider.setAgentState(agentStateFor(notice.lastSignal, settings));"));
    assert.equal(agentCode.match(/provider\.setAgentState\(/g)?.length, 1, "only update calls it");
    assert.match(handler, /\n {6}update\(settings\);\n/, "the link handler runs update");
    assert.match(listener, /\n {6}update\(settings\);\n/, "the settings listener runs update");
  });

  it("keeps the state and posts it only if the webview is listening now, read at each post", () => {
    assert.ok(setAgentState, "the provider has a setAgentState method");
    assert.match(
      setAgentState,
      /^\n {2}setAgentState\(state: AgentState\): void \{\n {4}this\.#agentState = state;\n {4}void sendAgentState\(this\.#requests, this\.#postToView, this\.#currentAgentState\);\n {2}\}\n$/,
    );
    assert.ok(agentCode.includes("readonly #currentAgentState = (): AgentState => this.#agentState;"));
    assert.ok(agentCode.includes("#agentState: AgentState = AgentState.None;"), "no line until a signal arrives");
  });

  it("never opens, focuses or starts a round", () => {
    for (const banned of ["focus", "show(", "executeCommand", "newRound", "requestOpen", "request()", "await"]) {
      assert.ok(!setAgentState.includes(banned), banned);
    }
  });

  it("gives every load the current state: answerWebview reads #currentAgentState", () => {
    const answer = /void answerWebview\(([\s\S]*?)\);/.exec(agentCode)?.[1] ?? "";
    assert.ok(answer, "the message listener calls answerWebview");
    assert.match(answer, /this\.#postToView,\s*this\.#currentAgentState,\s*$/);
  });
});

/**
 * Code that would reach the user's workspace or files (CLAUDE.md security
 * rule 8): the `workspace` API however it's imported or reached, `fs` in any
 * form, and any `require` or dynamic `import`, which could load either. Also
 * any settings write: `ConfigurationTarget` and any `.update(` call, since a
 * workspace-level write creates `.vscode/settings.json` in the user's project.
 */
const FILE_ACCESS: readonly RegExp[] = [
  /\.\s*workspace\b/, // vscode.workspace
  /\{[^}]*\bworkspace\b[^}]*\}\s*from\s*["']vscode["']/, // import { workspace } from "vscode"
  /\{[^}]*\bworkspace\b[^}]*\}\s*=/, // const { workspace } = vscode
  /\[\s*["'`]workspace["'`]\s*\]/, // vscode["workspace"]
  /\bworkspace\b/, // the word anywhere else in code, outside comments
  /\bConfigurationTarget\b/,
  /\.\s*update\s*\(/, // a settings write, chained or through a variable
  /from\s*["'](node:)?fs(\/promises)?["']/,
  /\brequire\s*\(/,
  /\bimport\s*\(/,
];

/** The source without comments, so docs may mention the workspace. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The only `workspace` calls allowed (#110): reading 0xWORD's own settings
 * and hearing when they change. Neither reaches the user's files. Each must
 * be written out in full, so any other use of `workspace` is still caught.
 */
const SETTINGS_CALLS = /\bvscode\.workspace\.(?:getConfiguration\(SETTINGS_SECTION\)|onDidChangeConfiguration\()/g;

/**
 * The only `.update(` calls allowed: the stats and theme stores saving to
 * `globalState`, through their own `#storage` field. A test below keeps them
 * to src/stats.ts and src/theme.ts.
 */
const STORAGE_UPDATES = /\bthis\.#storage\.update\(/g;

/** The code the file-access scan reads: no comments, settings reads or store saves. */
function scanned(source: string): string {
  return code(source).replace(SETTINGS_CALLS, "").replace(STORAGE_UPDATES, "");
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
      const source = scanned(readFileSync(new URL(file, root), "utf8"));
      for (const pattern of FILE_ACCESS) {
        assert.doesNotMatch(source, pattern);
      }
    });
  }

  it("allows the settings calls only in src/extension.ts", () => {
    const users = sourceFiles().filter((file) =>
      code(readFileSync(new URL(file, root), "utf8")).match(SETTINGS_CALLS),
    );
    assert.deepEqual(users, ["src/extension.ts"]);
  });

  it("allows store saves only in src/stats.ts and src/theme.ts", () => {
    const users = sourceFiles().filter((file) =>
      code(readFileSync(new URL(file, root), "utf8")).match(STORAGE_UPDATES),
    );
    assert.deepEqual(users.sort(), ["src/stats.ts", "src/theme.ts"]);
  });

  describe("the scan catches", () => {
    const caught: readonly (readonly [string, string])[] = [
      ["vscode.workspace", "vscode.workspace.fs.readFile(uri);"],
      ["a named workspace import", 'import { window, workspace } from "vscode";'],
      ["node:fs", 'import { readFileSync } from "node:fs";'],
      ["fs", 'import * as fs from "fs";'],
      ["node:fs/promises", 'import { readFile } from "node:fs/promises";'],
      ["require", 'const fs = require("fs");'],
      ["a dynamic import", 'const fs = await import("node:fs");'],
      ["the workspace folders", "const folders = vscode.workspace.workspaceFolders;"],
      ["finding files", 'void vscode.workspace.findFiles("**/*");'],
      ["the workspace kept in a variable", "const ws = vscode.workspace;"],
      ["another settings section", 'vscode.workspace.getConfiguration("files");'],
      ["file access after a settings call", "vscode.workspace.getConfiguration(SETTINGS_SECTION); vscode.workspace.fs;"],
      ["a settings call not written out in full", "const c = vscode.workspace\n.getConfiguration(SETTINGS_SECTION);"],
      [
        "a workspace settings write chained after a settings read",
        'void vscode.workspace.getConfiguration(SETTINGS_SECTION).update("autoStart.mode", "notify", vscode.ConfigurationTarget.Workspace);',
      ],
      [
        "a settings write chained after a settings read, with no target",
        'void vscode.workspace.getConfiguration(SETTINGS_SECTION).update("autoStart.mode", "notify");',
      ],
      [
        "a settings write through a variable",
        'const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);\nvoid config.update("notify.popup", true);',
      ],
      ["a settings write with a space before the bracket", 'config.update ("notify.popup", true);'],
      ["a configuration target", "const target = vscode.ConfigurationTarget.Workspace;"],
      ["a configuration target imported by name", 'import { ConfigurationTarget } from "vscode";'],
      ["a destructured workspace", "const { workspace } = vscode;"],
      ["a destructured workspace among others", "const { window, workspace: ws } = vscode;"],
      ["the workspace by bracket", 'const ws = vscode["workspace"];'],
      ["the workspace by bracket in single quotes", "const ws = vscode['workspace'];"],
      ["a store save from another field", "void this.#other.update(KEY, value);"],
    ];
    for (const [name, line] of caught) {
      it(name, () => {
        assert.ok(FILE_ACCESS.some((pattern) => pattern.test(scanned(line))));
      });
    }

    it("but not the word workspace in a comment", () => {
      const source = "// Works in untrusted workspaces.\n/** Never reads the workspace. */\nconst a = 1;";
      assert.ok(!FILE_ACCESS.some((pattern) => pattern.test(scanned(source))));
    });

    it("nor reading 0xWORD's own settings and hearing when they change", () => {
      const source =
        "const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);\n" +
        "const listener = vscode.workspace.onDidChangeConfiguration((event) => {});";
      assert.ok(!FILE_ACCESS.some((pattern) => pattern.test(scanned(source))));
    });

    it("nor a stats or theme store saving through its own field", () => {
      const source = "await this.#storage.update(STATS_KEY, value);";
      assert.ok(!FILE_ACCESS.some((pattern) => pattern.test(scanned(source))));
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
