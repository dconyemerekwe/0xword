import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleWebviewMessage, type HostHandlers } from "../src/protocol.ts";
import { StatsStore } from "../src/stats.ts";
import {
  DEFAULT_THEME,
  LIGHT_BODY_CLASSES,
  THEMES,
  THEME_BUTTON_LABEL,
  THEME_ICON,
  THEME_KEY,
  ThemeStore,
  isTheme,
  nextTheme,
  parseTheme,
  shownPalette,
  type ThemeStorage,
} from "../src/theme.ts";

/** An in-memory `globalState` that counts writes and can be made to fail. */
class FakeStorage implements ThemeStorage {
  readonly values = new Map<string, unknown>();
  updates = 0;
  failUpdate: "reject" | "throw" | null = null;
  failGet = false;

  get(key: string): unknown {
    if (this.failGet) {
      throw new Error("storage unavailable");
    }
    return this.values.get(key);
  }

  update(key: string, value: unknown): PromiseLike<void> {
    this.updates++;
    if (this.failUpdate === "throw") {
      throw new Error("update threw");
    }
    if (this.failUpdate === "reject") {
      return Promise.reject(new Error("disk full"));
    }
    this.values.set(key, value);
    return Promise.resolve();
  }
}

/** The host's handlers wired to the stores, the same way `extension.ts` wires them. */
function handlersFor(themes: ThemeStore, storage: FakeStorage = new FakeStorage()): HostHandlers {
  const stats = new StatsStore(storage);
  return {
    roundFinished: (message) => void stats.record(message),
    stats: () => stats.current(),
    setTheme: (theme) => void themes.save(theme),
    theme: () => themes.current(),
  };
}

/** Lets pending promise callbacks run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Every stored value that isn't a valid choice. */
const CORRUPT: readonly (readonly [string, unknown])[] = [
  ["nothing stored", undefined],
  ["null", null],
  ["an unknown name", "sepia"],
  ["a name in the wrong case", "Dark"],
  ["a name with spaces", " dark "],
  ["an empty string", ""],
  ["a number", 1],
  ["a boolean", true],
  ["an object", { theme: "dark" }],
  ["an array", ["dark"]],
  ["a String object", new String("dark")],
];

describe("theme choices", () => {
  it("are system, light and dark, with system the default", () => {
    assert.deepEqual(THEMES, ["system", "light", "dark"]);
    assert.equal(DEFAULT_THEME, "system");
  });

  it("are stored under a versioned globalState key", () => {
    assert.equal(THEME_KEY, "0xword.theme.v1");
  });

  it("cycle system → light → dark → system", () => {
    assert.equal(nextTheme("system"), "light");
    assert.equal(nextTheme("light"), "dark");
    assert.equal(nextTheme("dark"), "system");
  });

  it("accept exactly the three names", () => {
    for (const theme of THEMES) {
      assert.equal(isTheme(theme), true, theme);
      assert.equal(parseTheme(theme), theme);
    }
    for (const [name, raw] of CORRUPT) {
      assert.equal(isTheme(raw), false, name);
    }
  });

  describe("read a corrupt value as system", () => {
    for (const [name, raw] of CORRUPT) {
      it(`parses ${name} as system`, () => {
        assert.equal(parseTheme(raw), "system");
      });
    }
  });
});

describe("shownPalette: with no saved choice, the panel follows VS Code", () => {
  const cases: readonly (readonly [string, readonly string[], "light" | "dark"])[] = [
    ["a dark theme", ["vscode-dark"], "dark"],
    ["a high-contrast dark theme", ["vscode-high-contrast"], "dark"],
    ["a light theme", ["vscode-light"], "light"],
    ["a high-contrast light theme", ["vscode-high-contrast-light"], "light"],
    // In case VS Code ever sets both high-contrast classes on a light theme.
    ["a high-contrast light theme with both classes", ["vscode-high-contrast", "vscode-high-contrast-light"], "light"],
    ["no theme class yet", [], "dark"],
  ];
  for (const [name, classes, palette] of cases) {
    it(`shows the ${palette} palette for ${name}`, () => {
      assert.equal(shownPalette("system", classes), palette);
    });
  }

  it("treats only VS Code's two light classes as light", () => {
    assert.deepEqual(LIGHT_BODY_CLASSES, ["vscode-light", "vscode-high-contrast-light"]);
  });

  it("lets a forced choice win over VS Code's theme either way", () => {
    for (const [, classes] of cases) {
      assert.equal(shownPalette("light", classes), "light");
      assert.equal(shownPalette("dark", classes), "dark");
    }
  });
});

describe("the theme button", () => {
  it("shows a sun on the dark palette and a moon on the light one (pages 1 and 4)", () => {
    assert.deepEqual(THEME_ICON, { dark: "sun", light: "moon" });
  });

  it("is named after what the next press does", () => {
    assert.deepEqual(THEME_BUTTON_LABEL, {
      system: "Switch to light theme",
      light: "Switch to dark theme",
      dark: "Follow VS Code's theme",
    });
    // Each name describes `nextTheme`.
    for (const theme of THEMES) {
      const next = nextTheme(theme);
      const named = next === "system" ? /VS Code/ : new RegExp(`to ${next} theme`);
      assert.match(THEME_BUTTON_LABEL[theme], named, theme);
    }
  });
});

describe("ThemeStore", () => {
  it("reads system when nothing is stored", () => {
    assert.equal(new ThemeStore(new FakeStorage()).current(), "system");
  });

  for (const theme of THEMES) {
    it(`saves ${theme} under the versioned key and reads it back`, async () => {
      const storage = new FakeStorage();
      const store = new ThemeStore(storage);
      await store.save(theme);
      assert.equal(storage.values.get(THEME_KEY), theme);
      assert.equal(store.current(), theme);
      // A new store on the same storage, as after a reload or in another workspace.
      assert.equal(new ThemeStore(storage).current(), theme);
    });
  }

  describe("treats a corrupt stored value as system", () => {
    for (const [name, raw] of CORRUPT) {
      it(`reads system for ${name}`, () => {
        const storage = new FakeStorage();
        storage.values.set(THEME_KEY, raw);
        assert.equal(new ThemeStore(storage).current(), "system");
      });
    }
  });

  it("reads system when reading the storage throws", () => {
    const storage = new FakeStorage();
    storage.failGet = true;
    assert.equal(new ThemeStore(storage).current(), "system");
  });

  for (const failure of ["reject", "throw"] as const) {
    it(`resolves, keeping the old choice, when saving fails (${failure})`, async () => {
      const storage = new FakeStorage();
      storage.values.set(THEME_KEY, "dark");
      storage.failUpdate = failure;
      const store = new ThemeStore(storage);
      await assert.doesNotReject(store.save("light"));
      assert.equal(store.current(), "dark");
    });
  }

  it("doesn't touch the stats key", async () => {
    const storage = new FakeStorage();
    await new ThemeStore(storage).save("dark");
    assert.deepEqual([...storage.values.keys()], [THEME_KEY]);
  });
});

describe("the host's message handling with a theme store", () => {
  it("stores the choice from setTheme and sends it in the next init", async () => {
    const storage = new FakeStorage();
    const handlers = handlersFor(new ThemeStore(storage));
    assert.equal(handleWebviewMessage({ type: "setTheme", theme: "light" }, handlers), null);
    await settle();
    assert.equal(storage.values.get(THEME_KEY), "light");
    const reply = handleWebviewMessage({ type: "ready" }, handlers);
    assert.equal(reply?.type === "init" && reply.theme, "light");
  });

  it("sends system in init for a new player", () => {
    const reply = handleWebviewMessage({ type: "ready" }, handlersFor(new ThemeStore(new FakeStorage())));
    assert.equal(reply?.type === "init" && reply.theme, "system");
  });

  it("sends system in init when the stored choice is corrupt", () => {
    const storage = new FakeStorage();
    storage.values.set(THEME_KEY, "<script>");
    const reply = handleWebviewMessage({ type: "ready" }, handlersFor(new ThemeStore(storage)));
    assert.equal(reply?.type === "init" && reply.theme, "system");
  });

  describe("leaves the stored choice unchanged for a malformed setTheme", () => {
    const malformed: readonly (readonly [string, unknown])[] = [
      ["another value", { type: "setTheme", theme: "sepia" }],
      ["an extra field", { type: "setTheme", theme: "light", extra: 1 }],
      ["a wrong type", { type: "setTheme", theme: 1 }],
      ["a missing theme", { type: "setTheme" }],
    ];
    for (const [name, raw] of malformed) {
      it(`ignores ${name}`, async () => {
        const storage = new FakeStorage();
        storage.values.set(THEME_KEY, "dark");
        assert.equal(handleWebviewMessage(raw, handlersFor(new ThemeStore(storage))), null);
        await settle();
        assert.equal(storage.updates, 0);
        assert.equal(storage.values.get(THEME_KEY), "dark");
      });
    }
  });

  it("doesn't throw from the listener when the storage fails", () => {
    const storage = new FakeStorage();
    storage.failGet = true;
    storage.failUpdate = "throw";
    const handlers = handlersFor(new ThemeStore(storage), storage);
    assert.doesNotThrow(() => handleWebviewMessage({ type: "setTheme", theme: "dark" }, handlers));
    assert.doesNotThrow(() => handleWebviewMessage({ type: "ready" }, handlers));
  });
});
