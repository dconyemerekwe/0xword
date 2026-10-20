// Builds the webview's HTML and Content Security Policy. Pure: no `vscode`
// import, so it can be unit-tested with `node --test`.
import { THEME_ATTRIBUTE, isTheme, type Theme } from "../theme.ts";

/** The only folder the webview may load from (`localResourceRoots`). */
export const MEDIA_FOLDER = "media";

/** The bundled webview script, as path segments from the extension root. */
export const SCRIPT_PATH = [MEDIA_FOLDER, "dist", "main.js"] as const;

/** The webview's stylesheet, as path segments from the extension root. */
export const STYLE_PATH = [MEDIA_FOLDER, "styles.css"] as const;

/** Random bytes per nonce: 16 bytes = 128 bits. */
export const NONCE_BYTES = 16;

/** A nonce as `createNonce` makes it: lowercase hex, two digits per byte. */
const NONCE_PATTERN = new RegExp(`^[0-9a-f]{${NONCE_BYTES * 2}}$`);

/** Fills a new byte array with `length` cryptographically random bytes. */
export type RandomBytes = (length: number) => Uint8Array;

const cryptoRandomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** A fresh CSP nonce for one webview load, from a crypto random source. */
export function createNonce(randomBytes: RandomBytes = cryptoRandomBytes): string {
  const bytes = randomBytes(NONCE_BYTES);
  if (bytes.length !== NONCE_BYTES) {
    throw new RangeError(`Expected ${NONCE_BYTES} random bytes, got ${bytes.length}`);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface HtmlParts {
  /** `webview.cspSource`: the origin the webview loads its own files from. */
  readonly cspSource: string;
  /** A fresh value from `createNonce`. */
  readonly nonce: string;
  /** `webview.asWebviewUri` of `SCRIPT_PATH`. */
  readonly scriptUri: string;
  /** `webview.asWebviewUri` of `STYLE_PATH`. */
  readonly styleUri: string;
  /**
   * The stored theme choice. A forced one goes on `<body>` as
   * `THEME_ATTRIBUTE`, so the panel opens in it rather than flashing the
   * other palette until `init` arrives.
   */
  readonly theme: Theme;
}

/** The strict CSP: nothing from outside, and only the nonce-tagged script runs. */
export function buildCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `font-src ${cspSource}`,
    `img-src ${cspSource}`,
  ].join("; ");
}

/**
 * The webview's HTML. The body is empty on purpose: the bundled script fills
 * it in with `textContent`, which also proves the script ran. All styling
 * comes from the linked stylesheet (allowed by `style-src`): no inline styles.
 */
export function buildHtml({ cspSource, nonce, scriptUri, styleUri, theme }: HtmlParts): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new RangeError("The nonce must come from createNonce");
  }
  if (!isTheme(theme)) {
    throw new RangeError("The theme must be one of THEMES");
  }
  const csp = escapeAttribute(buildCsp(cspSource, nonce));
  const body = theme === "system" ? "<body>" : `<body ${THEME_ATTRIBUTE}="${theme}">`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>0xWORD</title>
  <link rel="stylesheet" href="${escapeAttribute(styleUri)}">
</head>
${body}
  <main id="app"></main>
  <script nonce="${nonce}" src="${escapeAttribute(scriptUri)}"></script>
</body>
</html>
`;
}

/** Escapes a value for a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
