import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MEDIA_FOLDER,
  NONCE_BYTES,
  SCRIPT_PATH,
  STYLE_PATH,
  buildCsp,
  buildHtml,
  createNonce,
} from "../../src/webview/html.ts";

// Realistic values, shaped like what VS Code passes in.
const CSP_SOURCE = "https://*.vscode-cdn.net";
const SCRIPT_URI = "https://file%2B.vscode-resource.vscode-cdn.net/ext/media/dist/main.js";
const STYLE_URI = "https://file%2B.vscode-resource.vscode-cdn.net/ext/media/styles.css";

function build(nonce = createNonce()): string {
  return buildHtml({ cspSource: CSP_SOURCE, nonce, scriptUri: SCRIPT_URI, styleUri: STYLE_URI });
}

function linkTags(html: string): string[] {
  return html.match(/<link\b[^>]*>/g) ?? [];
}

/** The CSP meta tag's content. */
function cspOf(html: string): string | undefined {
  return /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1];
}

function scriptTags(html: string): string[] {
  return html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
}

describe("createNonce", () => {
  it("gives a different nonce on each load", () => {
    const nonces = new Set(Array.from({ length: 100 }, () => createNonce()));
    assert.equal(nonces.size, 100);
  });

  it("encodes at least 128 random bits as hex", () => {
    assert.ok(NONCE_BYTES * 8 >= 128);
    assert.match(createNonce(), new RegExp(`^[0-9a-f]{${NONCE_BYTES * 2}}$`));
  });

  it("asks its random source for 16 bytes and uses all of them", () => {
    const requested: number[] = [];
    const nonce = createNonce((length) => {
      requested.push(length);
      return Uint8Array.from({ length }, (_, i) => i * 17);
    });
    assert.deepEqual(requested, [16]);
    assert.equal(nonce, "00112233445566778899aabbccddeeff");
  });

  it("rejects a random source that returns too few bytes", () => {
    assert.throws(() => createNonce(() => new Uint8Array(8)), RangeError);
  });

  it("uses the Web Crypto random source by default", (t) => {
    const spy = t.mock.method(crypto, "getRandomValues");
    createNonce();
    assert.equal(spy.mock.callCount(), 1);
  });
});

describe("buildCsp", () => {
  it("is exactly the strict policy", () => {
    assert.equal(
      buildCsp(CSP_SOURCE, "abc"),
      `default-src 'none'; script-src 'nonce-abc'; style-src ${CSP_SOURCE}; font-src ${CSP_SOURCE}; img-src ${CSP_SOURCE}`,
    );
  });
});

describe("buildHtml", () => {
  it("puts the exact CSP in a meta tag", () => {
    const nonce = createNonce();
    assert.equal(cspOf(build(nonce)), buildCsp(CSP_SOURCE, nonce));
  });

  it("has one script tag, carrying the nonce and the media/ script URI", () => {
    const nonce = createNonce();
    const scripts = scriptTags(build(nonce));
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0], `<script nonce="${nonce}" src="${SCRIPT_URI}"></script>`);
  });

  it("loads its script from inside media/", () => {
    assert.equal(SCRIPT_PATH[0], MEDIA_FOLDER);
    assert.equal(MEDIA_FOLDER, "media");
  });

  it("uses a different nonce on each load", () => {
    const first = cspOf(build());
    const second = cspOf(build());
    assert.ok(first && second);
    assert.notEqual(first, second);
  });

  it("contains no inline script", () => {
    for (const tag of scriptTags(build())) {
      assert.match(tag, /^<script [^>]*\bsrc="[^"]+"[^>]*><\/script>$/, "every script has a src and an empty body");
    }
  });

  it("contains no on* event handler attributes", () => {
    assert.doesNotMatch(build(), /\son[a-z]+\s*=/i);
  });

  it("contains no http: or https: URLs apart from the webview's own sources", () => {
    const html = build().replaceAll(CSP_SOURCE, "").replaceAll(SCRIPT_URI, "").replaceAll(STYLE_URI, "");
    assert.doesNotMatch(html, /https?:/i);
  });

  it("links exactly one stylesheet: the media/ stylesheet URI", () => {
    assert.deepEqual(linkTags(build()), [`<link rel="stylesheet" href="${STYLE_URI}">`]);
  });

  it("loads its stylesheet from inside media/", () => {
    assert.deepEqual(STYLE_PATH, [MEDIA_FOLDER, "styles.css"]);
  });

  it("has no inline <style> element and no style= attribute", () => {
    const html = build();
    assert.doesNotMatch(html, /<style\b/i);
    assert.doesNotMatch(html, /\sstyle\s*=/i);
  });

  it("keeps the CSP unchanged: the stylesheet is allowed by style-src, with no 'unsafe-inline'", () => {
    const csp = cspOf(build()) ?? "";
    assert.match(csp, new RegExp(`style-src ${CSP_SOURCE.replaceAll("*", "\\*")};`));
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  });

  it("escapes the stylesheet URI so it can't break out of its attribute", () => {
    const html = buildHtml({
      cspSource: CSP_SOURCE,
      nonce: createNonce(),
      scriptUri: SCRIPT_URI,
      styleUri: '"><style>*{}</style>',
    });
    assert.doesNotMatch(html, /<style\b/i);
    assert.equal(linkTags(html).length, 1);
  });

  it("leaves the body empty for the script to fill in", () => {
    assert.match(build(), /<main id="app"><\/main>/);
  });

  it("rejects a nonce that createNonce didn't make", () => {
    for (const bad of ["", "abc", "x".repeat(32), `${"a".repeat(32)}' 'unsafe-inline`]) {
      assert.throws(() => build(bad), RangeError, bad);
    }
  });

  it("escapes the script URI so it can't break out of its attribute", () => {
    const html = buildHtml({
      cspSource: CSP_SOURCE,
      nonce: createNonce(),
      scriptUri: 'x"><script>alert(1)</script>',
      styleUri: STYLE_URI,
    });
    assert.equal(scriptTags(html).length, 1);
    assert.match(html, /src="x&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  });
});
