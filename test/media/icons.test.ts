// Checks the two icons (#84): the Marketplace PNG and its SVG source, the
// activity-bar SVG, and that both icons ship in the .vsix.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path/posix";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";

const root = new URL("../../", import.meta.url);

const MARKETPLACE_ICON = "media/icon.png";
const MARKETPLACE_SOURCE = "docs/design/icons/marketplace-icon.svg";
const ACTIVITY_BAR_ICON = "media/icon.svg";
const ICON_SIZE = 128;

interface Manifest {
  icon?: string;
  contributes?: { viewsContainers?: { activitybar?: { icon?: string }[] } };
}

const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as Manifest;
const png = readFileSync(new URL(MARKETPLACE_ICON, root));
const source = readFileSync(new URL(MARKETPLACE_SOURCE, root), "utf8");
const activityBar = readFileSync(new URL(ACTIVITY_BAR_ICON, root), "utf8");
const design = readFileSync(new URL("docs/design/README.md", root), "utf8");

/** The design README's dark-theme colour table, where the icon's colours come from. */
const darkTable = design.slice(design.indexOf("### Dark theme"), design.indexOf("### Light theme"));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Chunk {
  type: string;
  data: Buffer;
}

/** The PNG's chunks in order, read from their length and type headers. */
function chunks(file: Buffer): Chunk[] {
  const found: Chunk[] = [];
  let at = PNG_SIGNATURE.length;
  while (at + 8 <= file.length) {
    const length = file.readUInt32BE(at);
    found.push({ type: file.toString("latin1", at + 4, at + 8), data: file.subarray(at + 8, at + 8 + length) });
    at += 12 + length; // length, type, data, CRC
  }
  return found;
}

/** The value of byte `x` of a row that has `x < 0` or no previous row as 0. */
function byteAt(row: Uint8Array | undefined, x: number): number {
  return (x >= 0 ? row?.[x] : 0) ?? 0;
}

/**
 * Decodes an 8-bit RGBA PNG (colour type 6, no interlace) into its pixels,
 * undoing each row's filter (PNG spec section 9).
 */
function rgbaPixels(file: Buffer): { width: number; height: number; at: (x: number, y: number) => string } {
  const header = chunks(file).find((chunk) => chunk.type === "IHDR")?.data;
  assert.ok(header);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  assert.deepEqual([header[8], header[9], header[12]], [8, 6, 0], "8-bit RGBA, not interlaced");
  const raw = inflateSync(Buffer.concat(chunks(file).filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = width * 4;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const previous = rows[y - 1];
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const left = byteAt(row, x - 4);
      const up = byteAt(previous, x);
      const upLeft = byteAt(previous, x - 4);
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
        predicted = a <= b && a <= c ? left : b <= c ? up : upLeft;
      }
      row[x] = (byteAt(line, x) + predicted) & 0xff;
    }
    rows.push(row);
  }
  const at = (x: number, y: number): string => {
    const pixel = rows[y]?.subarray(x * 4, x * 4 + 4) ?? [];
    return `#${[...pixel].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  };
  return { width, height, at };
}

/** Every colour literal in an SVG: hex, rgb()/hsl(), or a fill/stroke/color value other than currentColor and none. */
function hardCodedColours(svg: string): string[] {
  const literals = svg.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi) ?? [];
  const paints = [...svg.matchAll(/\b(?:fill|stroke|color|stop-color)\s*[=:]\s*["']?([^"';\s>]+)/gi)]
    .map((match) => match[1] ?? "")
    .filter((value) => value !== "currentColor" && value !== "none");
  return [...literals, ...paints];
}

/** The activity-bar SVG's tiles, as their attribute text, in drawing order. */
function tiles(svg: string): string[] {
  return [...svg.matchAll(/<rect\b([^>]*)\/>/g)].map((match) => match[1] ?? "");
}

describe("the Marketplace icon", () => {
  it("is what package.json's icon points to", () => {
    assert.equal(manifest.icon, MARKETPLACE_ICON);
  });

  it("is a PNG whose IHDR says exactly 128x128", () => {
    assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
    const header = chunks(png)[0];
    assert.equal(header?.type, "IHDR");
    assert.equal(header.data.readUInt32BE(0), ICON_SIZE);
    assert.equal(header.data.readUInt32BE(4), ICON_SIZE);
  });

  it("has transparent corners outside its rounded square", () => {
    const { at } = rgbaPixels(png);
    for (const [x, y] of [[0, 0], [127, 0], [0, 127], [127, 127]] as const) {
      assert.match(at(x, y), /00$/, `(${x}, ${y})`);
    }
  });

  it("draws the mock-up's square and tiles in the design colours: grey, blue, orange and an outlined empty tile", () => {
    const { width, height, at } = rgbaPixels(png);
    assert.deepEqual([width, height], [ICON_SIZE, ICON_SIZE]);
    assert.equal(at(64, 10), "#14161BFF", "the dark square (page)");
    assert.equal(at(40, 40), "#343944FF", "top left: not in word");
    assert.equal(at(88, 40), "#2F6FE4FF", "top right: right spot");
    assert.equal(at(40, 88), "#F0A04BFF", "bottom left: wrong spot");
    assert.equal(at(73, 88), "#7B8190FF", "bottom right: the empty tile's outline");
    assert.equal(at(88, 88), "#14161BFF", "bottom right: empty inside");
  });

  it("is drawn from an SVG source that uses only colours from the design README's dark table", () => {
    const colours = source.match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
    assert.deepEqual(
      [...new Set(colours)].sort(),
      ["#14161B", "#2F6FE4", "#343944", "#7B8190", "#F0A04B"],
    );
    for (const colour of colours) {
      assert.ok(darkTable.includes(`\`${colour}\``), `${colour} isn't in the design README's dark table`);
    }
  });

  it("has a 128x128 SVG source, the size the PNG is drawn at", () => {
    assert.match(source, /viewBox="0 0 128 128"/);
    assert.match(source, /width="128" height="128"/);
  });
});

describe("the activity-bar icon", () => {
  it("is what the view container points to", () => {
    assert.equal(manifest.contributes?.viewsContainers?.activitybar?.[0]?.icon, ACTIVITY_BAR_ICON);
  });

  it("has a 24x24 viewBox", () => {
    assert.match(activityBar, /viewBox="0 0 24 24"/);
    assert.match(activityBar, /width="24" height="24"/);
  });

  it("is single-colour: currentColor or none, no hard-coded colours, so VS Code can tint it", () => {
    assert.match(activityBar, /currentColor/);
    assert.deepEqual(hardCodedColours(activityBar), []);
    assert.doesNotMatch(activityBar, /\bstyle\s*=|<style|<image|href=/i);
  });

  it("would catch a hard-coded colour", () => {
    for (const svg of [
      '<rect fill="#2F6FE4"/>',
      '<rect fill="red"/>',
      '<rect stroke="rgb(0,0,0)"/>',
      '<svg fill="white">',
      '<rect style="fill: blue"/>',
    ]) {
      assert.notDeepEqual(hardCodedColours(svg), [], svg);
    }
    assert.deepEqual(hardCodedColours('<rect fill="currentColor" opacity="0.35"/><rect fill="none"/>'), []);
  });

  it("is the mock-up's 2x2 grid: top-left dimmed, top-right and bottom-left solid, bottom-right outlined", () => {
    const [topLeft, topRight, bottomLeft, bottomRight, ...rest] = tiles(activityBar);
    assert.deepEqual(rest, []);
    const opacity = Number(/opacity="([\d.]+)"/.exec(topLeft ?? "")?.[1]);
    assert.ok(opacity > 0 && opacity < 1, `top-left opacity ${opacity}`);
    for (const tile of [topRight, bottomLeft]) {
      assert.ok(tile);
      assert.doesNotMatch(tile, /opacity|fill="none"/);
    }
    assert.ok(bottomRight);
    assert.match(bottomRight, /fill="none"/);
    assert.match(bottomRight, /stroke="currentColor"/);
  });
});

describe("both icons ship in the .vsix", () => {
  const ignored = readFileSync(new URL(".vscodeignore", root), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const icons = [MARKETPLACE_ICON, ACTIVITY_BAR_ICON];

  it("isn't excluded by any .vscodeignore pattern", () => {
    for (const icon of icons) {
      // A pattern without a slash may match at any depth, so try the file name too.
      for (const path of [icon, icon.slice(icon.lastIndexOf("/") + 1)]) {
        for (const pattern of ignored) {
          assert.ok(!matchesGlob(path, pattern), `${pattern} excludes ${path}`);
        }
      }
    }
  });

  it("would catch a pattern that excludes them", () => {
    for (const pattern of ["media/**", "**/*.png", "*.svg", "media/icon.*"]) {
      assert.ok(
        icons.some((icon) => matchesGlob(icon, pattern) || matchesGlob(icon.slice(icon.lastIndexOf("/") + 1), pattern)),
        pattern,
      );
    }
  });

  it("keeps the PNG's SVG source out of the .vsix, in docs/", () => {
    assert.ok(ignored.some((pattern) => matchesGlob(MARKETPLACE_SOURCE, pattern)));
  });
});
