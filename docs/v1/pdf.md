# Pillar spec: superb PDFs

Key: `pdf`. Status: decided. Prototype and evidence: `scratchpad/v1/pdf-proto` (paths in section 20).
Everything below is a decision. Numbers marked **measured** were produced during this design. Numbers marked **target** are not proved yet and each one has a test or a stop rule.

## 0. The decisions in one page

1. **New look, one system.** Flat print inks, no gradients, a strict unit grid. One hero shape at 3 or 4 units, cropped by a tile field. That is the single art language for covers, chapter openers, end pages and the sales page.
2. **Real typography.** 4 type voices from 10 OFL families, embedded and subset by pdfkit, with ligatures and kerning. Helvetica leaves the product entirely.
3. **Fonts ship as unmodified `.woff`, unpacked in memory once per process.** This overrides the "TTF" in the brief, on purpose. Three families declare Reserved Font Names, so distributing a converted file in a public repo is a licence risk. Direct WOFF embedding is 5× slower (592 ms against 119 ms, **measured**). In-memory unpacking gives the same 230,876-byte PDF at TTF speed with no converted file ever written.
4. **A `Scene` display list replaces svg-to-pdfkit for all new work.** One drawing, two back-ends: pdfkit with real selectable text, SVG with glyph paths that need no font. Covers become portable everywhere, including `<img>`.
5. **A 340 pt text column and a 129 pt rail replace the 475 pt column.** This single change removes most of the "Word document" feel.
6. **Pagination becomes a pure function** over measured blocks, `paginate(blocks, params)`, so a designer can search layouts at no render cost. Floats replace the half-empty pages.
7. **Diagrams show what the content means.** A loop is drawn as a loop. New types are fed by data the writer already has, and no number is ever invented.
8. **The visual score is measured on the real artefact**, stored as `Product.visual`, and reaches the market through its own constants in `sim/visual.ts`. `balance.ts` stays frozen.
9. **Designer talent changes real output in four ways:** how many cover candidates are explored, how many layouts are tried, how well the designer judges, and how far pages are finished. No new RNG draw.
10. **No render cache.** 32 pages render in 114 to 119 ms (**measured**, simplified scenes), under the 300 ms budget. A cache would add state for a rare hit.
11. **Follow-ups get 6 chapters and a 2,300-word floor.** They are thin by structure, not by data: each of the 16 topics already has 25 to 30 tagged research items (**measured**).

## 1. Art director's verdict on today's guides

Read from four real guides, seed 7, 25 days, pages rasterised. The clearest example is `Le chiot fait ses besoins…` (23 pages).

| # | What I saw | Where | Why it reads as a template |
|---|---|---|---|
| 1 | Body column 475 pt at 10.6 pt Helvetica, about 95 characters per line | every page | Comfortable reading is 60 to 70. This is the main "Word export" signal |
| 2 | Helvetica and Helvetica-Bold everywhere | all | No typographic voice, a 39 € guide has one |
| 3 | The cover is a full sentence at 40 pt, plus clip art in a pale disc, sparkles and dot grids | p.1, all four guides | Decoration, not an image. Nothing stops a thumb |
| 4 | A "GUIDE PDF" pill, a subtitle and a "Pour :" pill saying the same audience twice within 200 pt | p.1 | The cover repeats itself and sells the file format |
| 5 | Identical opener band 8 times with the same paw, dark `01` on mid-green | p.5 onwards | No rhythm, weak contrast, and the opener says nothing about the chapter |
| 6 | Rounded card around everything, dashed borders, cards inside cards | p.2, 6, 14 | The clearest "Canva" tell |
| 7 | Continuation pages stopping at or before 60 % | p.6, 8, 12, 20; contents page a third empty | Paid-for pages with nothing on them |
| 8 | "La boucle à casser" drawn as four boxes in a straight line | p.6 | The diagram contradicts its own title |
| 9 | Icon grid chosen by keyword: three near-identical calendars in a row | p.20 | The icons add nothing the labels do not already say |
| 10 | 14-day plan with 6 of 14 rows duplicated, 7 of 14 on the baby guide (**measured**) | p.18 | "Continuer : …" four times in a row. The reader paid for a plan |
| 11 | "Fait : établir…" beside an empty box, "Je ne fais plus : gronder…" | p.12, 14 | Reads like a bug |
| 12 | Text walls: four paragraphs, then a heading, no run-in heads, no margin voice | p.5 | No entry points for a tired parent at 3 am |

**What the pages already do well and must keep:** the page-fill and overflow guarantees, whole-word cover titles, no fake testimonials, "Exemple type" honesty, printable sheets that never break badly.

## 2. Keep, rewrite, delete

| File | Decision |
|---|---|
| `deliverables/color.ts` | Keep as is |
| `deliverables/text.ts` | Keep. `sanitizePdfText` stays for the storyboard. Add `sanitizeFor(face, text)`, see 3.4 |
| `deliverables/design.ts` | Keep families, keywords, motifs, hints, `professionalFor`. Add `voice` and `inks` |
| `deliverables/cover.ts` | Rewrite the four layouts on `Scene`. Keep `capTitle` and the 140-character rule |
| `deliverables/motifs.ts` | Keep for `storyboard.ts` until the video pillar moves. No new use |
| `deliverables/pdf.ts` | Keep `finalWording`, `exampleParts`, `planTarget`, `keyOf`, wording regexes, `renderPdf` signature. Everything else moves to `layout/` and `pages/` |
| `deliverables/pdfVisuals.ts` | Keep `splitDoDont`, `gridWidths` and the `gridModel` row maths. Replace all drawing. Icon paths stay for small marks only. `iconGrid` keyword lottery goes |
| `deliverables/salesPage.ts` | Keep `safeSvg`, `atPriceOfTheDay`, FAQ logic, reviews, escaping, the test banner. Rewrite the layout and CSS |
| `svg-to-pdfkit` | Delete from `server/package.json` once `pdf.ts` no longer imports it |
| `fontkit` | Promote from transitive to a direct dependency of `server`, same installed version. Add a small local `fontkit.d.ts` |

`MIN_PAGE_FILL` stays exported at 0.25 as the hard floor. `planIntro` is removed only after `paginate` carries the same test.

## 3. Fonts

### 3.1 Files

Committed under `server/assets/fonts/`, unmodified from `@fontsource` (Google Fonts latin subset):

```
server/assets/fonts/<family>-<weight>-<style>.woff      28 files, 667 KB (measured)
server/assets/fonts/OFL/<family>.txt                    the LICENSE of each package, verbatim
server/assets/fonts/README.md                           package, version, why WOFF, how to refresh
```

| Family | Weights to commit | Reserved Font Name |
|---|---|---|
| Fraunces | 900, 600, 600i | none declared |
| Source Serif 4 | 400, 400i, 600 | none in package LICENSE. Verify the Adobe copyright line at commit |
| Inter | 400, 500, 600, 700 | none declared |
| Playfair Display | 900, 700, 500i | **"Playfair Display"** |
| Spectral | 400, 400i, 600 | none declared |
| DM Serif Display | 400, 400i | **"Source"** |
| Lora | 400, 400i, 600 | **"Lora"** |
| DM Sans | 500, 700 | none declared |
| Bricolage Grotesque | 800, 700, 500 | none declared |
| Archivo Narrow | 500, 700 | none declared |

**Measured on all 28:** every French glyph present (`éèêëàâäçîïôöûùüÿœæ`, capitals, `«»’‘“”…–—€·•°²`, U+00A0), GSUB and GPOS survive the subset, kerning active. Ligatures apply in the 8 families with a `liga` feature. Inter and Bricolage Grotesque have none, which is normal for them.
**U+202F is absent from all 28 (measured).** `sanitizeFor` maps it to U+00A0, exactly what `sanitizePdfText` already does.

### 3.2 Loading: `deliverables/fonts.ts`

```ts
export type FaceName = string; // 'fraunces-900-normal'
export interface Face { name: FaceName; sfnt: Buffer; font: FontkitFont; unitsPerEm: number }

/** Reads the .woff once, unpacks it in memory to a plain sfnt, keeps it for the life of the process. */
export function faceOf(name: FaceName): Face;
/** pdfkit: doc.registerFont(name, face.sfnt) for each face of the voice. Lazy on pdfkit's side: unused faces are never embedded. */
export function registerVoice(doc: PDFKit.PDFDocument, v: Voice): void;
/** Advance in points, cached by (face, text). */
export function advance(face: FaceName, text: string, size: number, track?: number): number;
export function wrapFace(text: string, face: FaceName, size: number, width: number): string[];
/** The biggest size that fits, then the narrowest measure that keeps the line count. */
export function fitDisplay(text: string, face: FaceName, o: { width: number; max: number; min: number; maxLines: number; maxHeight?: number; leading?: number }): { size: number; lines: string[] };
```

`woffToSfnt(buf)` is about 20 lines and is already written and verified: `pdf-proto/src/woff2ttf.mjs` (`node:zlib` inflate per table, directory rebuilt). The result is never written to disk, so nothing converted is distributed.

**Traps found, all verified:**

- **Never pass a `family` argument to `doc.font()`.** pdfkit forwards it to fontkit as a variation name and static fonts throw "Variations require a font with the fvar…". Always `doc.registerFont(name, buffer)` then `doc.font(name)`.
- **pdfkit crashes on WOFF2** (`Offset is outside the bounds of the DataView`). WOFF only.
- **`@fontsource` has `<family>/files/<family>-latin-<w>-<style>.woff`.** Use the `latin` file: it holds `œ`, `€` and the punctuation block.
- **Direct WOFF: 592 ms. In-memory unpacked: 119 ms** on the same 32 pages (**measured**).
- **The ESM `pdfkit` resolves to `js/pdfkit.node.mjs`**, a separate instance from the CommonJS one. Do not monkeypatch across them in tests.
- **The `measurer` in `text.ts` must stay for `StdFont` only.** New code measures with `advance`.

### 3.3 No system dependency

Fonts are in the repo, so nothing depends on the machine.
If a file is missing or corrupt, `faceOf` throws once. `renderPdf` catches it, falls back to the standard Helvetica and Times set, and returns `audit.degraded = true`. The visual report then caps `interior` at 60 with the issue « Polices manquantes : rendu de secours ».
A test covers it by pointing `fonts.ts` at an empty folder.

### 3.4 Sanitising

```ts
export function sanitizeFor(face: FaceName, text: string): string; // sanitizePdfText rules, then drops what face lacks
```

It keeps `→` or `✓` only if the face has the glyph. Otherwise it applies the current replacements.

## 4. Design system per family

### 4.1 Types: `shared/types.ts`

All new fields are optional so old saves load.

```ts
export type TypeVoice = 'conte' | 'dossier' | 'atelier' | 'signal';
export interface InkSet { paper: string; ink: string; a: string; b: string; c: string }

export interface DesignSpec {
  // unchanged: palette, motif, coverLayout, titleFont, bodyFont, seed, family?
  voice?: TypeVoice;
  inks?: InkSet;
  artSeed?: number;     // the art candidate kept by the designer; absent = design.seed
}
```

`normalizeDesign` fills `voice` and `inks` from `family` (or from the palette name), so an old save re-renders in the new look. `palette` stays because `storyboard.ts`, `salesPage.ts` and the UI fallback use it.

### 4.2 Voices: `deliverables/voices.ts`

```ts
export interface Voice { id: TypeVoice; display: FaceName; displayIt: FaceName; deck: FaceName; text: FaceName; textIt: FaceName; textB: FaceName; label: FaceName; labelB: FaceName; body: number }

export const VOICES: Record<TypeVoice, Voice> = {
  conte:   { display: 'fraunces-900-normal', displayIt: 'fraunces-600-italic', deck: 'fraunces-600-normal', text: 'source-serif-4-400-normal', textIt: 'source-serif-4-400-italic', textB: 'source-serif-4-600-normal', label: 'inter-500-normal', labelB: 'inter-700-normal', body: 10.3 },
  dossier: { display: 'playfair-display-900-normal', displayIt: 'playfair-display-500-italic', deck: 'playfair-display-700-normal', text: 'spectral-400-normal', textIt: 'spectral-400-italic', textB: 'spectral-600-normal', label: 'inter-500-normal', labelB: 'inter-700-normal', body: 10.4 },
  atelier: { display: 'dm-serif-display-400-normal', displayIt: 'dm-serif-display-400-italic', deck: 'dm-serif-display-400-normal', text: 'lora-400-normal', textIt: 'lora-400-italic', textB: 'lora-600-normal', label: 'dm-sans-500-normal', labelB: 'dm-sans-700-normal', body: 10.1 },
  signal:  { display: 'bricolage-grotesque-800-normal', displayIt: 'bricolage-grotesque-500-normal', deck: 'bricolage-grotesque-700-normal', text: 'inter-400-normal', textIt: 'inter-500-normal', textB: 'inter-600-normal', label: 'archivo-narrow-500-normal', labelB: 'archivo-narrow-700-normal', body: 9.6 },
};
```

| Family | Voice | Why |
|---|---|---|
| parentalite, animaux, mental | conte | Warm, human, Fraunces at 900 has real character |
| argent, etudes, mariage | dossier | Authority, formal contrast |
| maison, cuisine | atelier | Craft, recipe book |
| sante, tech, voyage | signal | Energy, modern |
| none | conte | Default |

Hints override: `elegan|luxe|chic|classique` → dossier, `sobre|moderne|tech` → signal.

### 4.3 Type scale

All vertical metrics are multiples of 3.6 pt, baseline 14.4 pt.

| Role | Face | Size / leading |
|---|---|---|
| Cover title | display | 62 down to 30, leading 1.02 |
| Cover deck | displayIt | 25 down to 17 |
| Opener numeral | display | 128 |
| Opener title | deck | 29 down to 20, leading 1.1 |
| Section H2 | deck | 19 / 21.6 |
| Run-in head | textB | body |
| Lead | textIt | 12.2 / 17.4 |
| Body | text | `voice.body` / 14.4 |
| Margin note | textIt | 9.2 / 12.4 |
| Pull quote | displayIt | 14.5 / 18 |
| Label | labelB | 7.8 to 9, tracked 1.4 to 2.2 |
| Folio | deck | 10 |
| Drop cap | display | 53, sits on line 3 |

### 4.4 Inks

Each of the 15 `PALETTES` entries gains an `inks` set. Paper is never pure white. `a` must carry text on paper, `ink` is the text colour.

| Palette | paper | ink | a | b | c |
|---|---|---|---|---|---|
| Nuit douce | F4ECDF | 131A3B | 27357A | EE7A5B | F5C971 |
| Pêche tendre | FBF0E6 | 2E2236 | B5483A | 6F97BE | F3C65C |
| Forêt chaleureuse | F6EFE2 | 17352B | 2C6A4C | E25F36 | F3B846 |
| Prairie | F4F3E1 | 1F3019 | 44802F | D9572F | F2C14E |
| Marine & or | F2EEE3 | 0B1B36 | 12505C | C9962E | D9502F |
| Émeraude | F2F0E4 | 0C2B26 | 0F6B5A | E3B23C | E0634A |
| Corail vitalité | FAF0E8 | 24222C | C8402E | 14807E | FFB347 |
| Lagon | EFF5EE | 0F2F33 | 0E7C7B | F2643D | F9C74F |
| Indigo studieux | F5F2EA | 1B1D52 | 3D3FB0 | E4572E | FFC83D |
| Sauge & terracotta | F3EEE1 | 26342A | 5B8B65 | C75F3C | E9BE68 |
| Coucher de soleil | FBEEDD | 2D1E2F | 6A4C93 | E4572E | FFC857 |
| Blush & or | FBF3EE | 3B2A2E | A84E5E | C9A15B | E8C4C8 |
| Lavande | F5F1F8 | 2A2440 | 6C5AA8 | F0907E | F4CE7C |
| Électrique | EEF0F7 | 111827 | 4338CA | 06B6D4 | FACC15 |
| Cuisine gourmande | FBF1E0 | 3A2A1A | B84A16 | 6F9A3F | F1C40F |

Only sets 1, 3, 5 and 10 were rendered. The other 11 are proposed values, so the contrast test in section 16 is the gate: contrast(ink, paper) ≥ 9, contrast(a, paper) ≥ 3 for display sizes. Where `a` is too light for small text (Sauge, Prairie), derive `aText` with the existing `ensureContrast(a, paper, 4.5)`. Text set in `b` always goes through the same function.

## 5. `Scene`: one drawing, two back-ends

`deliverables/scene.ts`. Prototype: `pdf-proto/src/scene.mts`, working.

```ts
export type Op =
  | { k: 'path'; d: string; fill?: string; stroke?: string; sw?: number; op?: number; cap?: 'round' | 'butt'; dash?: [number, number] }
  | { k: 'clip'; d: string; ops: Op[] }
  | { k: 'text'; s: string; x: number; y: number; font: FaceName; size: number; fill: string; anchor?: 'start' | 'middle' | 'end'; track?: number; op?: number };

export class Scene { /* path, rect, circle, line, text, clip */ meta: SceneMeta | null }
export function toPdf(doc: PDFKit.PDFDocument, s: Scene, x?: number, y?: number, scale?: number): void;
export function toSvg(s: Scene, o?: { precision?: 1 | 2; greekBelow?: number }): string;
```

- **`y` of a text op is the alphabetic baseline.** PDF: `doc.text(s, x, y, { lineBreak: false, baseline: 'alphabetic', characterSpacing })`.
- **`toSvg` writes glyph paths from `font.layout()`, with `aria-label` on each line.** It needs no font and gives the same picture everywhere.
- **No gradients, no filters, no images.** That is what keeps it print-like and small.
- **Halftone uses diamonds, not circles.** A diamond is 4 line segments against 4 Bézier curves.
- **`greekBelow: 12`** replaces any text under 12 pt by a bar of its real width at 0.35 opacity. It exists for previews, see 11.3.

Why not keep svg-to-pdfkit: it needs a font callback, loses real text in covers, parses XML per drawing, and gives two renderers to keep in sync.

## 6. Art language

Files: `deliverables/art/tiles.ts`, `art/heroes.ts`, `art/field.ts`, `art/evaluate.ts`. Prototype: `pdf-proto/src/art.mts`.

### 6.1 Rules

1. Five inks only, flat. No opacity in art. Only the tint panels of diagrams use it.
2. Everything sits on a unit grid. The cover is 6 units wide with u = 100 on the 600 viewBox. Openers use u = W/6.
3. One hero spanning 3 or 4 units, on a single ground. The hero is the only large shape.
4. **No two neighbouring tiles share a ground.** This checker is what makes a field read as one printed block.
5. Tiles repeat the hero's vocabulary. A paw guide has small paws, never stars.
6. The hero is the same drawing on every page, so a guide reads as one object. On openers it takes one of eight poses of that drawing (portrait, closeup, array, trail, counter, target, stairs, arch), chosen from the chapter title, so no two openers of a guide look alike (D80).

### 6.2 Four grammars for the 14 motifs

| Grammar | Motifs | Tile bag (weights) | Hero |
|---|---|---|---|
| `ciel` | moon, sun, sparkle | crescent .26, concentric arcs .28, half disc .20, small disc .14, dots .12 | **moon** crescent, 6 orbit rings, 18 stars (rendered). **sun** full disc with 16 cut rays, two half-disc hills. **sparkle** 4-point star (`sparklePath`) with two offset echoes |
| `empreinte` | paw, heart | quarter disc .36, small motif .14, disc .18, arcs .18, dots .14 | **paw** pad plus 4 toes over a diamond halftone rising from the base (rendered). **heart** two half discs plus a rotated square, the classic constructed heart, over arcs |
| `herbier` | leaf, pot | vesica leaf .50, quarter disc .22, arcs .16, dots .12 | **leaf** curved stem, 4 pairs of leaves shrinking to the tip, plus a terminal leaf (rendered). **pot** trapezoid and rim, three stems of `leafAt` or three steam arcs |
| `module` | coin, chart, bolt, book, home, dumbbell, brush | ring disc .32, stripes .23, staircase .25, quarter disc .20 | **coin** stack of 6 (rendered). **chart** 5 rising bars under a quarter arc. **bolt** zigzag polygon inside a ring. **book** two parallelograms ruled with stripes. **home** square, triangle, arched door. **dumbbell** rotated bar with stacked plates. **brush** diagonal handle and ferrule over a halftone stroke |

`art/heroes.ts` exports one `Hero` per motif:

```ts
export type Hero = (s: Scene, box: { x: number; y: number; size: number }, inks: InkSet, seed: number, frame: HeroBox) => void; // `frame` crops it: the box, or less on a close-up
export const HEROES: Record<DesignSpec['motif'], { draw: Hero; ground: keyof InkSet }>;
```

**Honest limit.** Four grammars and four heroes are proved by render. Ten heroes are specified, not drawn. They must each be iterated by eye: `server/scripts/contact-sheet.ts` renders 14 motifs × 15 ink sets through the same PDF-to-PNG path, and no hero merges until the sheet looks intentional. The leaf took three passes, so budget for it.

### 6.3 Variation

- **Cover:** `field({ cols: 6, rows, hero })`. `rows = head.length > 40 ? 4 : 5`, so a long title gets more room.
- **Chapter openers:** `rows = 4`, seed `artSeed + n × 7`. Each takes its own pose (`art/poses.ts`, D133). Before D66: odd chapters a 4-unit hero, even chapters a 3-unit hero on the other side, which left eight openers alike.
- **What a frame cuts** (D139): on a close-up a shape shows a tenth of a unit or does not show, and a big shape clears the frame or leaves it by 2 pt at least, a tenth for the sun's disc. A star the frame would cut or touch (1,5 pt) is left out, every draw kept so the others do not move. The arch's two doors never wear the page's ink: they go down to the page, and nothing would say where they stop.
- **Bonus:** hero on ground `b`, label « CADEAU ».
- **Introduction and final page:** 2 rows.

## 7. Covers

`renderCoverSvg` keeps its contract: 600×848, self-contained. It adds `coverScene()`, returning `{ scene, meta }`.

### 7.1 Title handling

```ts
/** Every word stays: the head goes big, what follows « : » or « — » goes to the deck. */
export function splitTitle(t: string): { head: string; tail: string };
```

The cover is laid out bottom-up: audience line, deck, then the title gets what is left.
`fitDisplay` rejects any size where a single word exceeds the measure. That rule exists because "Micro-entrepreneur" overflowed in the prototype. It then narrows the measure, so no line is left with one short word ("dans" alone in the first render). A measure that strands one short word inside the block gives way to the next wider one that does not, unless that only sends a word alone to the last line; a size with no such measure is passed over, and only the smallest that fits may keep the stray (D138). This reads the layout the cover really prints, so it reaches `lineBalance` and the score: §12.

"GUIDE PDF" becomes `GUIDE PRATIQUE`. The audience appears once, as « Pour … » at the foot, never again as a pill. The sparkles, dot grids and features list are gone.

### 7.2 The four `coverLayout` values, type unchanged

| Value | Name | Composition |
|---|---|---|
| `split` | Affiche | Art on top (4 or 5 rows), title on paper. Rendered |
| `centered` | Plein cadre | Full-bleed field, title on a paper plate covering the lower 42 % |
| `badge` | Colonne | 2-unit tile column on the left the full height, title on paper at right |
| `minimal` | Typo | Paper, huge title, one hero bottom right, no tile field |

The `split` layout is the only one prototyped. The other three are specified.

## 8. Layout engine

Files: `deliverables/layout/grid.ts`, `layout/blocks.ts`, `layout/paginate.ts`, `pages/*.ts`.

### 8.1 Grid

```ts
export const GRID = { W: 595.28, H: 841.89, left: 54, right: 54, top: 66, bottom: 64, column: 340, gutter: 18, rail: 129, full: 487, baseline: 14.4, head: 40, folio: 811.89 } as const;
```

Single-sided: these guides are read on a screen and printed page by page, so the rail stays right and the section tab stays on the outer right edge.

### 8.2 Measure, then paginate, then draw

```ts
export type Block =
  | { t: 'para'; lines: string[]; style: 'lead' | 'body'; head?: string }
  | { t: 'h2'; text: string; h: number }
  | { t: 'steps'; items: { lines: string[]; h: number }[] }
  | { t: 'example'; label: string; lines: string[]; h: number }
  | { t: 'figure'; kind: VisualSpec['type']; h: number; draw: FigureDraw; float: true }
  | { t: 'checklist'; items: string[]; h: number; cols: 1 | 2 }
  | { t: 'sheet'; visual: VisualSpec }                 // always a tinted page of its own
  | { t: 'note'; text: string; h: number; rail: true } // anchored to the previous block
  | { t: 'quote'; text: string; h: number; rail: true };

export interface LayoutParams { space: number; figureSlot: 'early' | 'late'; railFirst: boolean; notesFill: boolean }
export interface PagePlan { kind: 'text' | 'opener' | 'sheet' | 'figure' | 'memo' | 'final' | 'toc' | 'promise'; chapter: number | null; items: Placed[]; fill: number }
/** Pure: no pdfkit, no clock, no RNG. */
export function paginate(blocks: Block[], params: LayoutParams): PagePlan[];
```

**Rules, in order:**

1. Paragraphs split at line level, at least 2 lines on each side (no widow, no orphan).
2. `h2` keeps with at least 3 lines or the first step of what follows.
3. A `figure` floats: if it does not fit, text behind it moves up and the figure opens the next page. This is what removes today's half-empty pages.
4. Rail blocks sit on the baseline of their anchor. A rail block that does not fit moves to the next page's top.
5. A `steps` item is never split.
6. A `sheet` block ends the chapter on its own full-bleed tinted page.
7. No body page stops under `PAGE_FLOOR` (0.6, D133): lines move from the pages before it (`PAGE_AIM`, trims of at most 6 lines), a short page breathes up to `PAGE_BREATH`, then its section closes on a band of the guide's tiles or on ruled « Vos notes ». Sheets get the same notes under a short table, and a plan to tick grows its rows until the table reaches 45 % of the body, its boxes staying beside their words. `fill` means ink, a close counts at half weight, so it cannot game the score. It was: under `fill < 0.45`, try the next params, then ruled notes.

Because block heights are known, one `paginate` call is pure arithmetic. That is why a designer can try 24 layouts for free.

**Not measured:** how much best-of-N moves page fill. See section 18.

### 8.3 Pages in order

| Page | Content |
|---|---|
| Cover | Section 7 |
| Promise | The promise in display italic at 20 pt, 4 measured figures in deck numerals (chapitres, actions, fiches, pages), who it is for, how to use it. No cards |
| Contents | Number in display, title in deck, dotted leader to the page. Real `goTo` links |
| Introduction | 2-row art, drop cap, pull quote of the problem, « À la fin de ce guide » rule box |
| Chapter opener | 4-row art, numeral, title, lead, « Dans ce chapitre » with reading time, step count, and first 3 steps |
| Chapter body | Column plus rail, run-in heads, numerals without boxes, hairlines not cards |
| Figures | Section 9, floated |
| Sheets | Tinted paper, ink header band « À IMPRIMER », « Fiche 2 sur 3 » |
| Memo | « Votre plan sur une page », printable summary. Finish level 2 |
| Bonus | Opener on ground `b` |
| ~~Si ça coince~~ | Annex dropped at every level (D152): its answers stay in the decision tree |
| Final page | `finalWording` kept word for word, 2-row art, CTA, recap, disclaimer |

The reading time is `max(3, round(words / 220))` min, computed. Never a promise.

### 8.4 Navigation and metadata

- **Bookmarks:** `doc.outline.addItem()` per intro, chapter, bonus, annex, final. **Measured:** `/Outlines` is present in the bench PDF.
- **Contents links:** `doc.goTo` to named destinations, already done.
- **Section tabs:** chapter number on the right edge, `y = 110 + (n-1) × tabH`, `tabH = min(54, (H - 220) / tabs)`.
- **Running heads:** chapter title left at y = 40, on text pages only. Never truncated with an ellipsis mid-word.
- **Metadata:** Title, Author, Subject, Keywords, `displayTitle`, `lang: 'fr-FR'` (**measured:** `/Lang` and `DisplayDocTitle` present).
- **`info.CreationDate = new Date(Date.UTC(2026, 0, 1))`, fixed.** Same content gives the same bytes, which gives a real determinism test.

## 9. Diagrams from content

File: `deliverables/diagrams.ts`. Each returns a `Scene` and a height. `cycle`, `plan_path` and `decision_tree` are rendered in the prototype.

### 9.1 Types

```ts
export interface VisualSpec {
  type: 'timeline' | 'bar_chart' | 'checklist_card' | 'quote' | 'steps_diagram' | 'icon_grid' | 'do_dont' | 'grid'
    | 'cycle' | 'plan_path' | 'decision_tree' | 'before_after' | 'matrix' | 'gauge' | 'step_path';
  title: string; labels: string[]; values: number[]; grid?: GridSpec;
  cycle?: { nodes: string[]; breakAt: number; center: string };
  plan?: { days: number; unit: string; tracks: { from: number; to: number; label: string }[] };
  tree?: { question: string; cases: { when: string; then: string }[] };
  pairs?: { before: string; after: string }[];
  matrix?: { heads: [string, string, string, string]; cells: [string[], string[], string[], string[]] };
  gauge?: { rows: string[]; low: string; high: string };
  path?: { stations: { label: string; when: string | null; duration: string | null }[] };
}

export interface ChapterContent {
  // existing fields unchanged
  figure?: VisualSpec | null;      // a second visual: `visual` stays the chapter's tool (often a sheet)
  margin?: { note: string | null; quote: string | null };
}
```

`labels` stays filled with a plain version of the same data, so a renderer without support and `scorePdf` keep working.

### 9.2 Where each one comes from: `visualFor` in `minds/heuristic/studio.ts`

| Role | Visual | Source, already in the code | Note |
|---|---|---|---|
| comprendre (habitude) | `cycle` | `c.profile.loop` | `breakAt` = the node whose step the method addresses first, else 1. Only 4 profiles have a loop (**measured**), others keep `icon_grid` fed by whole labels |
| diagnostic | `gauge` plus grid | the mistakes, Jamais to Souvent (D152) | Blank rulers for the reader to circle. It holds no value at all |
| methode | `step_path` | `c.method`: `text`, `when`, `duration` | Stations with their real moment and duration |
| erreurs | `before_after` | `rendered(c)`, `fixFor` | Replaces `do_dont`: each mistake stays beside its fix. At finish 2 it is not printed when its mistakes stand in the chapter's text, and a box « À arrêter » prints only what that text has not said (D152, D156) |
| situations | `decision_tree` | `situationsOf`: `when`, `what` | « Si … alors … » ladder |
| programme | `plan_path` as `figure`, plan grid as `visual` | `PlanModel`, needs `from` and `to` kept in `rows` | One bar per track |
| durer | `matrix` | `c.keep`, `c.tips`, `pairs`, `observe` | Heads: À garder, À arrêter, À tester, À surveiller. Words, no axis |

**Never invent a number.** `bar_chart` remains "measured values only". A test asserts that every digit in a diagram exists in the content.

**The heuristic decides `margin`.** `quote` comes from `d.pullQuote()` (a customer's words or nothing, existing rule). `note` comes from a research item the draft has not used yet, so it adds substance rather than repeating a sentence on the same page.

### 9.3 Drawing rules

- Figures are flat, in ink, with a tint panel of `c` at 0.22 opacity where needed.
- Decision trees are ladders: one stem, one rung per case. Nothing crosses. The first version crossed through boxes.
- Cycle labels stay outside the ring, on the side their node is on.
- Plan: day numbers on top, one bar per track, dashed week rules behind the bars.

## 10. Content worth 39 € in heuristic mode

The market already prices substance through `guideSubstance`, so these are real results and not decoration.

### 10.1 Why follow-ups are thin

Each of the 16 topics already has 25 to 30 tagged research items (**measured**). The limits are structural:

- `chapterCount()` returns 5 for any `upsellOf`.
- `MIN_WORDS_SUITE = 1500`.
- `suiteOf` has no diagnostic chapter and no keep-it-going chapter.
- `genericFillers` are filtered out, and nothing replaces them.

**Decisions:**

| Change | File | Effect |
|---|---|---|
| `chapterCount`: 6 for a suite with a `topic`, 5 only for a free pain | `studio.ts` | One more chapter |
| Add `{ kind: 'point-de-depart', role: 'diagnostic' }` to `suiteOf`, with the topic's own sheet from `TopicSpec.bonus.sheet` or a new `TopicSpec.sheet` | `archetypes.ts` | Uses `observe` items of the topic |
| `short` maps gain 6 chapters: `angle, point-de-depart, reglages, ecueils, resistances, mini-plan` | `archetypes.ts` | Full structure |
| `MIN_WORDS_SUITE = 2300`, same floor logic | `studio.ts` | Target ≥ 0.8 × parent |
| `methodParas`, `errorParas`, `situationParas` use all tagged items of the topic | `studio.ts` | The 25 to 30 items reach the page |
| `Draft.fact()` also serves `margin.note` | `studio.ts` | Rail filled with new material |

**Target:** follow-ups ≥ 2,300 words and `freshWords` ≥ 0.8 × parent, on all 16 topics. A sweep test enforces it. If a topic cannot reach it from its own items, the test names the topic and that topic gets authored items. The floor is never met by repeating text.

### 10.2 The plan stops repeating itself

`parallelPlan` in `plan.ts`: a day without a start used to print `Continuer : <last active step>`.

```ts
// new: rotate through what is active, never the same line on two days in a row
const focus = active[(d - 1) % active.length]!;
text = `Focus : ${act(focus.s)}${checkOf(focus.s, d)}`;
```

`checkOf` appends what to look at, taken from `s.detail` first sentence when it fits within 60 characters. The weekly and final bilans stay.
**Target:** 0 identical adjacent rows on every catalogue plan. Today 6 to 7 of 14 rows are duplicates.

### 10.3 Value blocks, all derived

| Block | Source | Finish level |
|---|---|---|
| « Pourquoi ça marche » after each method step | `MethodStep.detail`, printed today only as run-in prose | 1 |
| « Votre plan sur une page » | Plan tracks, first step of each chapter | 2 |
| ~~« Si ça coince » annex~~ | Dropped, D152 | |
| One worked example per chapter | `Draft.example()`, `situationExample` | content |
| Ready-to-copy models | `c.models`, as a tinted block | 1 |

### 10.4 Small wording fixes

- The renderer strips `^Fait : ` and `^Je ne fais plus : ` from printed checklist lines. The box says it already. `Je ne fais plus` becomes a column head « À arrêter ».
- Methode and situations checklists repeat the steps above them, so they render compact, in 2 columns, in the rail-width block. The items still count for `ITEMS_PER_CHAPTER`.
- `bare()` keeps a quote mark answered inside the text (« “Bio” ne veut rien dire », « fasse “cheap” ») and strips only the spare closing marks. A cliché of the writer's flaw goes to the end of a paragraph that opens on a run-in head: the flaw stays, the ladder of steps keeps its bold, and the `chance(0.35)` draw stays too. The sheet's first column is measured in the face that prints its labels, so a weekday is never broken. The travel guide says « réserver » where the wedding guide says « contacter » (`v(c, wedding, travel)`).

## 11. Sales page

Prototype: `pdf-proto/out/sales.html`, screenshot `pdf-proto/out/sales.png`.

### 11.1 Structure

1. Test banner, kept word for word. It is a guardrail.
2. Header, sticky CTA.
3. **Hero:** audience eyebrow, title and deck from `splitTitle`, a strip of 4 measured figures (chapitres, actions, fiches, pages), CTA with the price of the day, reassurance line.
4. **Product stage:** the cover as a real book in CSS 3D (`rotateY(-24deg)`, a spine shade over the front, stacked page edge), plus tablet and phone frames showing real pages.
5. Pains, in the customers' words, with hairlines and not cards.
6. **« Feuilletez-le avant de décider »:** 4 to 6 real pages. « Ce que vous voyez est ce que vous téléchargez » must stay true, which is why previews come from the render and are never mocked.
7. **One figure at full size** (the plan or the cycle). It proves value at a glance.
8. Chapters, bonus, real reviews only, FAQ, guarantee, final CTA, mobile sticky bar.

### 11.2 Fixes from the prototype

The tablet and phone hid the title on the book. Rule: devices may only overlap the art zone of the cover and at most 15 % of its width. The book's title stays readable.

### 11.3 Weight

**Measured** as raw SVG with text as paths: cover 153 KB, opener 462 KB, figure page 522 KB, body page 948 KB, sheet 114 KB, for a 3.6 MB page. That is too heavy.

**Decision:** `toSvg(scene, { greekBelow: 12, precision: 1 })` for previews. Body text under 12 pt becomes grey bars of the real line width. At 250 px wide it is unreadable anyway, and the page stops giving the content away.

**Target:** ≤ 700 KB per page. Not yet measured, a test holds it.

### 11.4 Fonts on the page

The same WOFF files, as `@font-face` data URIs for 2 faces (display and text), about 60 KB. The Google Fonts `<link>` goes, so the page becomes fully self-contained.

### 11.5 Inputs

```ts
renderSalesPageHtml(input: { product; salesPage; coverSvg; design; brand; previews?: { label: string; svg: string }[]; figureSvg?: string | null }): string;
```

`render_pdf` writes `previews/*.svg` next to the guide and sets `product.files.previews?: string[]`. The boutique handler reads them. Without previews the section is skipped, for old saves.

## 12. Visual score

### 12.1 What is measured

```ts
export interface PdfAudit {
  pages: number; bytes: number; degraded: boolean;
  textPages: number; shortPages: number;     // text pages with fill < 0.45
  fillMean: number;                          // notes count at half weight
  widows: number; strandedHeadings: number;  // both must be 0, paginate guarantees it, the audit proves it
  railShare: number;                         // share of text pages with a rail element
  figureKinds: number; figuresPerChapter: number; sheets: number;
  overflow: number;                          // text ops wider than their box
}

export interface CoverAudit { art: number; thumbPx: number; lineBalance: number; contrast: number; titleLines: number }

export interface VisualReport {
  version: 1;
  cover: number;      // 0..100
  interior: number;   // 0..100
  overall: number;    // 0.55 cover + 0.45 interior
  effort: DesignEffort;
  explored: number;   // real count of candidates
  issues: string[];   // French, actionable
}
```

`Product` gains `visual?: VisualReport | null`.

### 12.2 Formulas

**Art** (`art/evaluate.ts`, from geometry only, prototype in `pdf-proto/src/evalcover.mts`):

```
art = 0.4 balance + 0.3 rhythm + 0.3 focus
balance = 100 × max(0, 1 - Σ|share_i - target_i| / 0.9), target (a, ink, b, c, paper) = .24 .24 .20 .20 .12
rhythm  = 100 × (1 - weakPairs / pairs), weak = neighbouring grounds with contrast < 1.6
focus   = 100 × mean over tiles touching the hero of min(1, contrast(tile ground, hero ground) / 7)
```

**Measured** over 1,600 fields on 4 ink sets: mean 67.5, sd 6.1, p10 59, p90 75. Mean best of 2 = 71.0, of 4 = 73.6, of 8 = 75.8, at 0.14 ms per candidate.

**Cover:**

```
thumb = 100 × clamp((titleSize × 150/600 - 7) / 6, 0, 1)   // px on a 150 px wide thumbnail, 13 px and above is full marks
balance = 100 × shortestLine / longestLine
cover = 0.5 art + 0.35 thumb + 0.15 balance
```

A long SEO title now has a measured cost. The note in `review.ts` that today just says "vérifier la lisibilité" becomes a real consequence.

**Interior:**

```
fillS  = 100 × clamp((fillMean - 0.5) / 0.3, 0, 1)
shortS = 100 × (1 - shortPages / max(1, textPages))
figS   = 100 × (0.5 clamp(figureKinds / 4, 0, 1) + 0.5 clamp(figuresPerChapter / 1, 0, 1))
railS  = 100 × clamp(railShare / 0.6, 0, 1)
sheetS = 100 × clamp(sheets / 2, 0, 1)
interior = 0.3 fillS + 0.2 shortS + 0.25 figS + 0.15 railS + 0.1 sheetS - 5 × (widows + strandedHeadings + overflow)
```

**Target by finish level:** 0 ≈ 55, 1 ≈ 72, 2 ≈ 88. Not measured. A test fixes the order, the values are read once from the fixture and written in the code comment.

### 12.3 How it reaches the existing quality report

- `scorePdf(content, ctx)` gains `visual?: VisualReport | null`. With it, `design = ctx.visual.interior`, otherwise today's formula.
- The weight stays 0.04: `overall` is the quality of the writing. Visual has its own channels, so raising the weight would count it twice.
- `issues.section('design')`: `interior < 50` is a **block** « Mise en page creuse : N pages à moitié vides ».
- Pass `visual: p.visual` at all 5 call sites: `tick.ts:85`, `tools.ts:299`, `creation.ts:85`, `studio.ts:15`, `review.ts:95`.
- `scoreSalesPage`: `design = 0.7 × visual.cover + 30 × blurbShare`, replacing the constant `+30` for a design spec that always exists.

The `design` score was close to 100 on every product (**measured:** 100 on all four guides). It was a label. Now it varies.

### 12.4 How it reaches the market: `sim/visual.ts`

New file. `balance.ts` stays frozen.

```ts
export const VISUAL = {
  ref: 70, span: 30,
  cvr:    { slope: 0.15, min: 0.85, max: 1.15 },
  wtp:    { slope: 0.10, min: 0.92, max: 1.10 },
  rating: { slope: 0.30, max: 0.30 },
  refund: { slope: 0.02, max: 0.02 },
  thumb:  { slope: 0.08, min: 0.92, max: 1.08 },
} as const;

export function visualCvr(v?: VisualReport | null): number;    // on overall, 1 without a report
export function visualWtp(w: Wtp, v?: VisualReport | null): Wtp; // scales sweet and max
export function visualRating(v?: VisualReport | null): number; // on interior
export function visualRefund(v?: VisualReport | null): number; // on interior
export function thumbFactor(v?: VisualReport | null): number;  // on cover, for the channels pillar
```

| Effect | Where in `tick.ts` | Why it is real |
|---|---|---|
| Conversion | `baseCvr`: `× visualCvr(p.visual)` | The page shows the book and its pages |
| Willingness to pay | `baseCvr` and `overprice`: `visualWtp(n.wtp, p.visual)` | A superb object carries a higher price, and the price bandit discovers it alone |
| Reviews | `runReviews`: `+ visualRating(p.visual)` | Buyers judge what they received |
| Refunds | `refundProbability`: `- visualRefund(p.visual)` | "Looks cheap" is a refund reason |

**Guarantees:** no new RNG draw, `null` is exactly neutral, the market reads only a public report on a public artefact, so the hidden-truth separation is untouched.
`ref = 70` sits at a starting agency's level, so the mechanism does not shift the economy on day 1.

### 12.5 Proof

Paired control per seed, 30 seeds, `normal`, 60 days, at the single final calibration only.
`ScenarioConfig.designTalentOverride?: number` is read by `scripts/balance.ts`, never exposed in the UI. Arm A freezes designers at 0.25, arm B at 1.0.

**Stop rule, fixed now:**

- Accepted if the median paired gain is positive and at least 19 of 30 seeds are positive.
- One retry allowed: `cvr.slope` to 0.25.
- If it still fails, keep the look and record the effect as not proven. Never a third pass.

## 13. Designer talent

`deliverables/effort.ts`:

```ts
export interface DesignEffort { covers: number; layouts: number; taste: number; finish: 0 | 1 | 2 }

export function effortFor(talent: number, attempt = 0): DesignEffort {
  const t = clamp(talent, 0, 1);
  return { covers: 1 + Math.round(7 * t) + 2 * attempt, layouts: 2 + Math.round(22 * t), taste: 0.4 + 0.6 * t, finish: t < 0.2 ? 0 : t < 0.6 ? 1 : 2 };
}
```

| Lever | Real effect |
|---|---|
| `covers` | Art candidates explored, best-of-N, +8.3 points of `art` at 8 with perfect judgement (**measured**) |
| `layouts` | `LayoutParams` tried in `paginate` |
| `taste` | Perceived score = true + (1 - taste) × 8 × noise. A weak eye sometimes keeps the worse candidate |
| `finish` | What is drawn. **0:** column, no rail, no drop cap, 3-row openers, chapter visuals only. **1:** adds drop cap, rail notes, pull quotes, models, 4-row openers with « Dans ce chapitre ». **2:** adds `figure` diagrams, memo page, and leaves out the error table and the stop box lines that only repeat the chapter (D152, D156) |

Even at finish 0 the new type and art apply. The floor is far above today's product.

```ts
/** In deliverables, uses no world RNG: candidates are keyed on design.seed and the index. */
export function pickArt(design: DesignSpec, effort: DesignEffort): { seed: number; score: number; explored: number };
```

Noise comes from `decoRng(hashString(`${design.seed}|${i}`))`. This keeps the rules: no new stream needed, nothing shifts, text stays keyed on titles.

**Hook points:**

- `design_cover`: same `designFor` call and the same `ctx.rng.int` as today, then `artSeed = pickArt(...).seed`. `coverSvgFor` only draws, so the repeated calls stay idempotent when the title changes.
- `render_pdf`: `renderPdf({ ..., effort })`, then `product.visual = visualReport(audit, coverAudit, effort)`.
- `review.ts design_cover`: replace `d < 50` with `visual.cover < 60` → `changes`. A rework gets `attempt + 1`, so 2 more candidates and a truly better chance. `review.closeLoop` bounds it at 2.
- `review.ts render_pdf`: `blockers(q)` now carries the `interior < 50` block.
- Default without a talent module: `talent = (level - 1) / (MAX_LEVEL - 1)`.

**Why `finish` exists.** Search alone is too weak to measure. Best of 8 adds 8.3 `art` points, which is about +2.3 on `overall` (× 0.5 × 0.55), or about 1 % conversion, far under the noise floor. `finish` is what opens the real gap: junior about 58, senior about 87 on `overall` (**target**), so about 14 % conversion plus the price, review and refund effects.

### 13.1 Contract and type changes

```ts
// server/src/contracts.ts: DeliverablesModule
renderPdf(input: { product: Product; content: PdfContent; design: DesignSpec; brand: string; outFile: string; upsell?: { title: string; url: string } | null; effort?: DesignEffort }):
  Promise<{ pages: number; bytes: number; audit: PdfAudit; previews: { label: string; svg: string }[] }>;
pickArt(design: DesignSpec, effort: DesignEffort): { seed: number; score: number; explored: number };
coverAudit(input: { title: string; subtitle: string; audience: string; design: DesignSpec; brand: string }): CoverAudit;
visualReport(pdf: PdfAudit, cover: CoverAudit, effort: DesignEffort, explored: number): VisualReport;

// server/src/contracts.ts: SimModule
scorePdf(content: PdfContent, ctx: { audience: string; problem: string; voc?: VoiceOfCustomer; design?: DesignSpec | null; visual?: VisualReport | null }): QualityReport;

// shared/types.ts
// Product: visual?: VisualReport | null;  files: { ...; previews?: string[] }
// Deliverable kind: add 'page_preview'
// ScenarioConfig: designTalentOverride?: number   (read by scripts/balance.ts only)
```

`effort` is optional in `renderPdf` and defaults to `effortFor(0.3)`, so `demo.ts` and existing tests keep working.

## 14. Performance

| What | Result |
|---|---|
| Today, standard fonts, 23 pages | 76 ms, 110 to 161 KB (**measured**) |
| Today's layout with embedded TTF | 128 ms, 141 KB (**measured**) |
| Scene pipeline, 32 pages, 8 openers, 4 figure pages, 3 sheets, cover, outline | 114 to 119 ms median, 140 ms max, 231 KB (**measured**) |
| Same, WOFF direct | 592 ms (**measured**), rejected |
| Art candidate | 0.14 ms (**measured**) |
| Target with real pagination and search | ≤ 200 ms median, ≤ 300 ms max |

The bench scenes are simplified: real paragraphs, wrapping and search add cost. 30 ms of `paginate` over 24 tries is the working estimate, not a measurement.

**What this costs a run.** A run renders about 8 guides per 25 days (**measured**), so about 20 per 60-day run:

| Render time | 60-day total | Against today's 1.5 s, on a 20 s run |
|---|---|---|
| 120 ms | 2.4 s | +0.9 s |
| 300 ms, the ceiling | 6 s | +4.5 s, about 22 % slower |

That is acceptable at V1 volume, but it is not negligible, and a `scale` pillar that multiplies products multiplies it too. If benches hurt, measure first, then pool renders.

**No cache.** Rejected: a cache only hits when content, design, effort and the upsell link are all identical, which is exactly when `render_pdf` does not normally run. It would add invalidation state for a rare hit.

## 15. Determinism, reload, guardrails

- `renderPdf` and `paginate` are pure functions of content, design, effort and the upsell link. `audit` contains no time.
- `Product.visual` is world state: it is saved and reloaded like the rest. Nothing recomputes it at load.
- No `ctx.rng` draw is added anywhere.
- `pdfFingerprint` (`redteam.ts`) hashes `content` and `design`, so `artSeed` counts as a new print, which is correct: new art is a new file.
- `pages` and `bytes` enter the task summary and `output`, so they are world state. This is why they must be byte-stable: fixed `CreationDate`, committed fonts, no system dependency.
- The ledger is untouched. Compliance, founder approval, stop-loss and the CFO cap are untouched.
- The sales page keeps « Boutique virtuelle » and the fake checkout. No real publishing, no paid generation service, no key.

## 16. Tests that fail without the feature

`server/test/pdfText.ts` carries the helper from `pdf-proto/src/pdftext.mts`, which reads text through each font's ToUnicode CMap and is **verified exact, ligatures included**. Trap: pdfkit writes ligature entries with a space, `<0066 0069>`.

The existing `pdfPagesText` reads WinAnsi hex and will return garbage on every test after the font switch. **Port the helper first.**

| File | Test | Fails today because |
|---|---|---|
| `design.test.ts` | Every face in `VOICES` loads, has GSUB and GPOS, has every French glyph | No such fonts |
| | The PDF has ≥ 3 `/FontFile2`, and no `/BaseFont /Helvetica` | Standard fonts |
| | `efficace`, `affiche`, `œuvre` extract intact | Ligature check |
| | Empty font dir: `renderPdf` resolves, `degraded = true`, `interior ≤ 60` | No fallback |
| | Every ink set: contrast(ink, paper) ≥ 9, contrast(a, paper) ≥ 3 | No inks |
| | No two neighbouring tiles share a ground, across 200 seeds | No field |
| | Mean best-of-8 ≥ mean best-of-1 + 5, 100 seeds | No search |
| | Every layout, 140-character title, and "Micro-entrepreneur": all words in `aria-label`, no text op wider than its box | Overflow rule |
| | Cover SVG has no `<text>`, no gradient, no external reference | Today has all three |
| | Two renders of one guide give identical bytes | CreationDate |
| `layout.test.ts` | `paginate`: no stranded heading, no widow or orphan, on 7 variants of text length (ports the existing test) | No `paginate` |
| | A figure that does not fit floats, the previous page stays ≥ 0.75 full | Blocks leave a gap |
| | No text page under `MIN_PAGE_FILL` on all fixtures | Ported guarantee |
| | `paginate` called twice gives deep-equal plans | Purity |
| | Outline has one item per contents entry, every link has a destination | No outline |
| `diagrams.test.ts` | Each new type renders, no overflow, every label present | No such types |
| | Every digit of a figure exists in the guide's text | Honesty |
| | `cycle` has one closed ring and the labels are outside it | Today a row of boxes |
| | A `steps_diagram` titled « boucle » in an old save still renders | Compatibility |
| `content.test.ts` | Every topic of every niche: `wordCount ≥ 2300`, `freshWords ≥ 0.8 × parent`, ≥ 6 chapters | 1,400 words, 5 chapters |
| | No catalogue plan has two identical adjacent rows | 6 to 7 duplicates |
| | No printed line starts with « Fait : » | Prefix |
| `visual.test.ts` | `effortFor` monotone, and on the fixture `cover` and `interior` rise with talent | Level has no effect today |
| | `visualCvr(null) === 1`, all four effects neutral at `overall = 70`, monotone, clamped | No file |
| | `scorePdf` with `visual.interior = 40` has a design block and `design === 40` | `design` is constant |
| | Rendering at any effort leaves `world.rngState` unchanged | Stream rule |
| | Two seeded days differing only in `visual` diverge in revenue, same day-1 draws | Market channel |
| `sales.test.ts` | No `fonts.googleapis`, no external URL, banner still there | Google Fonts link |
| | ≥ 3 previews, no body sentence of the guide inside a preview, ≤ 700 KB | No previews |

The existing replay and reload tests in `runtime.test.ts` must pass unchanged. They are the real guarantee.

**Tests to edit, not delete:**

- The `titleBlock` and `svgText` tests read `<text>` and become `aria-label` reads.
- `gridWidths` gets a new `PdfTheme`.
- `bodyOf` keeps working if the footer keeps `PIXEL AGENCY`. Footers stay.
- The lone-heading test matches `Étape par étape` and `Votre checklist`. The new label is uppercase, so its regex must match `ÉTAPE PAR ÉTAPE` too. The assertion itself does not weaken.

## 17. UI

For the `ui` pillar. Data is on `Product`, so `snapshot.ts` needs `visual` and `files.previews`.

- **Products tab:** two bars « Couverture » and « Mise en page » with `visual.cover` and `visual.interior`, `visual.issues`, and credit « Kenji a exploré 6 pistes ». `Cover` stays an `<img>`: it now renders exactly, with no fonts needed.
- **Products tab:** strip of `files.previews`, click to enlarge.
- **Gallery tab:** add the `page_preview` deliverable kind to `IMAGE_KINDS`.
- **Agent panel:** the designer's mean `cover` and `interior`, last 5 products.
- **Feed:** « Kenji : 6 pistes, couverture 78/100 », real numbers from `pickArt`.
- **Apprentissage tab:** chart of `visual.overall` by product over time, the visible proof that designers improve.

## 18. What I do not know yet, and how each is settled

| Unknown | Settled by |
|---|---|
| How much `layouts` moves `fillMean`. Not prototyped | Measure on the fixture in phase 3. **Stop rule:** if best of 24 moves `interior` by under 3 points, remove the `layouts` lever and let talent act through `covers`, `taste`, `finish` |
| Interior per finish level (55, 72, 88) | Read once on the fixture |
| Real render time with pagination | Bench in phase 3, against the 300 ms budget |
| Page count grows from 23 to about 30+. Checked: `pages` and `bytes` feed labels, the task summary and `output` only, in `creation.ts` and `demo.ts`. Nothing in `sim/`, `learning/` or `web/` reads them | Closed |
| 10 heroes, 3 cover layouts, 11 ink sets not drawn | Contact sheet, by eye, before merge |
| Greeked preview weight | `sales.test.ts` |
| Market effect | Paired control, section 12.5 |
| Source Serif 4 RFN status | Read the upstream copyright at commit. If it declares « Source », the unmodified WOFF plan already covers it |

## 19. What I need from the other pillars

| Pillar | Need |
|---|---|
| talent | `talentOf(world, agentId): number` in 0..1, stable across a reload, growing with real work. I provide `effortFor`. Name for the designers' skill: `design` |
| org | `design_cover` and `render_pdf` task kinds stay, and whichever designer roles survive keep them. Zoé's art-direction review stays a gate. A designer's salary line, so that higher talent has a real cost |
| channels | Call `thumbFactor(product.visual)` on feeds that show the cover. Formats that use the cover use `coverScene` |
| video | Reuse `coverScene`, `HEROES`, `field`, `VOICES`, `toSvg`, so ads and guide are one brand. Move `storyboard.ts` off `motifs.ts`, then I delete `motifs.ts` |
| scale | `renderPdf` stays async and pure, so it can run in batches. Each render costs ≤ 300 ms |
| ui | Section 17 |
| calibration | One final pass only, paired control, section 12.5 |

## 20. Rejected

| Rejected | Why |
|---|---|
| Committing converted TTF | Three fonts declare Reserved Font Names, and the repo is public |
| Committing WOFF and embedding directly | 5× slower, 592 ms |
| WOFF2 | Crashes pdfkit |
| Render cache by content hash | 114 ms already, invalidation is a bug source |
| Rasterising covers with resvg | Native dependency, bigger files, loses vector print quality, nothing in the art needs filters |
| Gradients, shadows, grain | Filters are what made it look like a template |
| Paper grain as a PNG tile | Adds weight per page for a detail invisible at reading size |
| PDF blend modes for overprint | pdfkit has no API, and flat inks already look printed |
| Knuth-Plass justification and French hyphenation | Flush-left without hyphens reads fine at 68 characters, and it avoids a dictionary |
| Thin spaces via a patched `cmap` | Requires modifying the fonts, which the licence choice forbids |
| Tagged PDF and PDF/A | Weight and time for no market effect in V1. Real-world phase |
| Mirrored margins | Guides are read on screens and printed page by page |
| Handwriting font (Caveat) | 113 KB per weight, and it reads as cute, not premium |
| A "sales page" visual score | It is one template, so it would be a constant. The page gets its score through the cover |
| Niche-level hidden design taste | No learning signal with about 10 products per run |
| Cover-style bandit | Same sample-size problem. It would be a label |
| Raising the `design` weight in `scorePdf` | Double counts with `sim/visual.ts` |
| AI-generated images | Forbidden: no paid generation service in this project |

## 21. Order of work

Each phase ends green.

1. **Fonts and tests first:** assets, `fonts.ts`, `pdfText.ts` helper, port the existing byte-level tests to it.
2. **Scene, art, cover:** `scene.ts`, `art/*`, new `cover.ts`, inks and voices, `pickArt`, contact sheet. Gate: all 14 motifs by eye.
3. **Layout:** `blocks`, `paginate`, pages. Bench and measure the `layouts` stop rule.
4. **Diagrams and content:** new visuals, follow-ups, plan rotation.
5. **Score and market:** `audit`, `VisualReport`, `sim/visual.ts`, review gates, talent hook.
6. **Sales page:** previews, greeking, stage.
7. **UI, docs:** then the single calibration.

Phases 1 and 2 are safe alone: they change the look and nothing economic. Phase 5 is the only one that touches results. If time runs out, ship through phase 3 with `visual` null, and the market stays exactly neutral.

## 22. Evidence

All under `scratchpad/v1/pdf-proto/` of the build session, local and not in this repo:

| File | What it shows |
|---|---|
| `today/chiot/page-*.png`, `today/sheet-chiot.png` | Today's pages, the basis of section 1 |
| `out/chiot/page-1.png` | New cover |
| `out/chiot/page-2.png` | New chapter opener |
| `out/chiot/page-3.png` | Body page: column, rail, drop cap, pull quote |
| `out/chiot/page-4.png` | Diagram page: cycle, plan path, decision ladder |
| `out/chiot/page-5.png` | Tinted worksheet |
| `out/bebe/`, `out/voices/` | Moon, coin and leaf art in the four voices |
| `out/sheet2.png`, `out/sheet3.png` | Contact sheets |
| `out/sales.png`, `out/sales.html` | Sales page |
| `src/scene.mts`, `src/art.mts`, `src/proto.mts` | Working code to port |
| `src/woff2ttf.mjs` | Verified in-memory WOFF unpacking |
| `src/pdftext.mts` | Verified test helper for embedded-font text |
| `src/evalcover.mts` | Art evaluator and best-of-N measure |
| `fixture-products.json` | The four guides, for benches and tests. `runs/dsg-pdf` was deleted |
