// Markdown helpers shared by test/readme.test.ts and test/package.test.ts.

/**
 * Every image the README shows, Markdown images and `<img src>`, as written.
 * `vsce package` rewrites each relative one to `<repository>/raw/main/<path>`
 * (`--githubBranch main` in the package script; `guessBaseUrls` in
 * node_modules/@vscode/vsce/out/package.js, vsce 4.1.0).
 */
export function imageLinks(markdown: string): string[] {
  return [
    ...[...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? ""),
    ...[...markdown.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1] ?? ""),
  ];
}
