// The player's theme choice: follow VS Code's theme ("system"), or force the
// light or dark palette. Pure: no `vscode` import, so it can be unit-tested
// with `node --test` and bundled into the webview too (which checks `init`
// with it).
//
// The palettes themselves are CSS custom properties in media/styles.css: the
// dark one is the default, and the light one applies when VS Code's `<body>`
// has a light class, or when the player forced it. The webview only sets
// `THEME_ATTRIBUTE` on `<body>`, so "system" follows VS Code's theme live,
// with no reload and no polling.

/** The `globalState` key. Versioned, so a later shape can migrate from it. */
export const THEME_KEY = "0xword.theme.v1";

/** Every choice, in the order the theme button cycles through them. */
export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

/** The choice before the player makes one, and in place of a corrupt stored value. */
export const DEFAULT_THEME: Theme = "system";

/** The two palettes media/styles.css defines. */
export type PaletteName = "light" | "dark";

/**
 * The `<body>` attribute that holds a forced choice ("light" or "dark"). It's
 * absent for "system". Not a `data-vscode-*` name, which VS Code owns.
 */
export const THEME_ATTRIBUTE = "data-ox-theme";

/**
 * VS Code's `<body>` classes for light themes, which get the light palette
 * under "system". Every other theme (`vscode-dark`, `vscode-high-contrast`)
 * gets the dark palette.
 */
export const LIGHT_BODY_CLASSES = ["vscode-light", "vscode-high-contrast-light"] as const;

/** The theme button's icon for each palette shown: a sun on dark (page 1), a moon on light (page 4). */
export const THEME_ICON = { dark: "sun", light: "moon" } as const satisfies Readonly<Record<PaletteName, string>>;

/** The theme button's accessible name for each current choice: what the next press does. */
export const THEME_BUTTON_LABEL: Readonly<Record<Theme, string>> = {
  system: "Switch to light theme",
  light: "Switch to dark theme",
  dark: "Follow VS Code's theme",
};

export function isTheme(raw: unknown): raw is Theme {
  return typeof raw === "string" && (THEMES as readonly string[]).includes(raw);
}

/** Reads a stored or sent choice. Anything that isn't one of `THEMES` gives "system". */
export function parseTheme(raw: unknown): Theme {
  return isTheme(raw) ? raw : DEFAULT_THEME;
}

/** The choice after one press of the theme button: system → light → dark → system. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? DEFAULT_THEME;
}

/**
 * The palette showing for `theme`, with VS Code's `<body>` classes. The same
 * rule as media/styles.css's selectors (a test checks they match): a forced
 * choice wins, and "system" is light only for a light VS Code theme.
 */
export function shownPalette(theme: Theme, bodyClasses: readonly string[]): PaletteName {
  if (theme !== "system") {
    return theme;
  }
  const light: readonly string[] = LIGHT_BODY_CLASSES;
  return bodyClasses.some((name) => light.includes(name)) ? "light" : "dark";
}

/**
 * Where the choice is kept. `vscode.Memento` (`context.globalState`) fits
 * this shape; tests pass a fake. `globalState` is shared by every workspace.
 */
export interface ThemeStorage {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/**
 * Reads and saves the choice in one storage key. Never throws or rejects:
 * the theme is a preference and must not break the message listener.
 */
export class ThemeStore {
  readonly #storage: ThemeStorage;

  constructor(storage: ThemeStorage) {
    this.#storage = storage;
  }

  /** The stored choice; "system" if nothing valid is stored or reading fails. */
  current(): Theme {
    try {
      return parseTheme(this.#storage.get(THEME_KEY));
    } catch {
      return DEFAULT_THEME;
    }
  }

  /**
   * Saves a validated choice (see `parseWebviewMessage`). Resolves once
   * saved, and also if saving failed (the previous choice then stays).
   */
  async save(theme: Theme): Promise<void> {
    try {
      await this.#storage.update(THEME_KEY, theme);
    } catch {
      // Nothing to recover: the stored choice is unchanged.
    }
  }
}
