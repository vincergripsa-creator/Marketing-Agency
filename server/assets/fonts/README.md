# Fonts

Every typeface of the guides and the ad videos. One folder serves both, nothing depends on the machine.

## What is here

| File | From | Used by |
|---|---|---|
| `<family>-<weight>-<style>.woff`, 28 files, 667 KB | `@fontsource/<family>`, `files/<family>-latin-<weight>-<style>.woff`, renamed without `-latin` | PDF, covers, sales page: `src/deliverables/fonts.ts` |
| `anton-latin-400-normal.woff`, `montserrat-latin-{600,800}-normal.woff` | `@fontsource/anton`, `@fontsource/montserrat`, file name kept | Ad videos: `src/video/fonts.ts` |
| `OFL/<family>.txt` | the `LICENSE` of each package, verbatim | 12 families, one file each |

The bytes of each `.woff` are those of the package. Only the file names changed.

| Family | Package version | Faces | Reserved Font Name | Copyright, as read in the font's own `name` table |
|---|---|---|---:|---|
| Fraunces | 5.3.0 | 900, 600, 600 italic | none | Copyright 2020 The Fraunces Project Authors |
| Source Serif 4 | 5.3.1 | 400, 400 italic, 600 | **Source** | © 2014 - 2021 Adobe Systems Incorporated |
| Inter | 5.3.0 | 400, 500, 600, 700 | none | Copyright 2016 The Inter Project Authors |
| Playfair Display | 5.3.0 | 900, 700, 500 italic | **Playfair Display** | Copyright 2017 The Playfair Display Project Authors |
| Spectral | 5.3.0 | 400, 400 italic, 600 | none | Copyright 2017 The Spectral Project Authors |
| DM Serif Display | 5.3.0 | 400, 400 italic | **Source** | Copyright 2014 - 2017 Adobe Systems Incorporated, 2019 Google |
| Lora | 5.3.0 | 400, 400 italic, 600 | **Lora** | Copyright 2011 The Lora Project Authors |
| DM Sans | 5.3.0 | 500, 700 | none | Copyright 2014 The DM Sans Project Authors |
| Bricolage Grotesque | 5.3.0 | 800, 700, 500 | none | Copyright 2022 The Bricolage Grotesque Project Authors |
| Archivo Narrow | 5.3.0 | 500, 700 | none | Copyright 2019 The Archivo Narrow Project Authors |
| Anton | 5.3.0 | 400 | none | Copyright 2020 The Anton Project Authors |
| Montserrat | 5.3.0 | 600, 800 | none | Copyright 2011 The Montserrat Project Authors |

All are under the SIL Open Font License 1.1. `OFL/source-serif-4.txt` opens on « Google Inc. » with no copyright line: that is how the package ships it. The Adobe line and its Reserved Font Name are in the font itself, which is why the table reads the font.

## Why WOFF, and why unmodified

Four of these families declare a Reserved Font Name. The OFL lets anyone redistribute a font under that name only as it is: a converted file is a modified version, and this repository is public. So what is committed is the published WOFF, untouched.

Embedding WOFF directly is 5× slower in pdfkit (592 ms against 119 ms on 32 pages). `woffToSfnt` in `fonts.ts` unpacks each file in memory, once per process, and the result is never written to disk. The PDFs embed subsets, which the OFL allows when a document embeds a font.

WOFF2 crashes pdfkit. The `latin` file is the one to take: it holds `œ`, `€` and the French punctuation. U+202F is in none of them, `sanitizeFor` maps it to U+00A0.

## How to refresh

```sh
npm pack @fontsource/fraunces@<version>
tar -xzf fontsource-fraunces-<version>.tgz
cp package/files/fraunces-latin-900-normal.woff server/assets/fonts/fraunces-900-normal.woff
cp package/LICENSE server/assets/fonts/OFL/fraunces.txt
```

Do that outside `server/`, one package at a time, and leave the bytes alone. Read the font's copyright line again, since a Reserved Font Name is declared there and not always in the package's `LICENSE`. Then `npx vitest run test/design.test.ts` from `server/`: it checks that every face of every voice loads, has its `GSUB` and `GPOS`, and draws every French glyph.

A new face goes into `VOICES` in `src/deliverables/voices.ts`, and into the table above.
