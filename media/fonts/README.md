# Bundled fonts

The webview loads these fonts with `@font-face` from `media/styles.css`, by relative URL, under the CSP's `font-src`. Nothing is fetched at runtime. Each file was downloaded once from Google Fonts' official source, the [`google/fonts`](https://github.com/google/fonts) repository, at commit `47d54ca1ebb14fd864695f1d39dc734f39017c33`, and committed unchanged (only renamed). `.gitattributes` keeps them byte for byte, so the checksums below hold on every checkout; `test/media/fonts.test.ts` checks them.

Only the upright variable files are bundled: they cover every weight the panel uses (DM Sans 400 to 1000, including 1000 for the title's `WORD`; JetBrains Mono 500 and 700). No italics are used, so the italic files are left out.

Both fonts are licensed under the SIL Open Font License 1.1; each licence file ships next to its font.

| File | Source file | Source URL | Repository commit | SHA-256 |
|---|---|---|---|---|
| `DMSans-Variable.ttf` | `ofl/dmsans/DMSans[opsz,wght].ttf` | https://github.com/google/fonts/blob/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/dmsans/DMSans%5Bopsz,wght%5D.ttf | `47d54ca1ebb14fd864695f1d39dc734f39017c33` | `8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d` |
| `DMSans-OFL.txt` | `ofl/dmsans/OFL.txt` | https://github.com/google/fonts/blob/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/dmsans/OFL.txt | `47d54ca1ebb14fd864695f1d39dc734f39017c33` | `9af36190332437f5ecd09974de43c1f7c77a310a996cdd8ceb25628b458840e1` |
| `JetBrainsMono-Variable.ttf` | `ofl/jetbrainsmono/JetBrainsMono[wght].ttf` | https://github.com/google/fonts/blob/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf | `47d54ca1ebb14fd864695f1d39dc734f39017c33` | `48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda` |
| `JetBrainsMono-OFL.txt` | `ofl/jetbrainsmono/OFL.txt` | https://github.com/google/fonts/blob/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/jetbrainsmono/OFL.txt | `47d54ca1ebb14fd864695f1d39dc734f39017c33` | `b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d` |

Axes: DM Sans has `wght` 100 to 1000 and `opsz` 9 to 40 (the browser picks the optical size from the font size); JetBrains Mono has `wght` 100 to 800.

To check a file by hand: `sha256sum media/fonts/*` (Git Bash) or `Get-FileHash media/fonts/* -Algorithm SHA256` (PowerShell).
