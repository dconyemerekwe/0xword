// Checks the package.json contributions and what the .vsix ships.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MEDIA_FOLDER, SCRIPT_PATH } from "../src/webview/html.ts";

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
  activationEvents?: string[];
  capabilities?: { untrustedWorkspaces?: { supported?: unknown } };
  contributes?: {
    commands?: Command[];
    viewsContainers?: { activitybar?: ViewContainer[] };
    views?: Record<string, View[]>;
  };
}

const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as Manifest;
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

  it("doesn't touch the workspace, so the command works in untrusted workspaces", () => {
    assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, true);
    assert.ok(!extensionSource.includes("vscode.workspace"));
    assert.ok(!/from "node:fs"|require\(/.test(extensionSource));
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

  it("leaves the webview's TypeScript source out", () => {
    assert.ok(existsSync(new URL("media/main.ts", root)));
    assert.ok(ignored.includes("**/*.ts"));
  });
});
