# How to add an art style

Package F laid the ground (design plan D200): a registry of art directions, the shapes every style draws with, gradients in
`Scene`, the shared cover layout and the score's scale. Bauhaus is the V1 look behind an adapter; `typo` (« Typo XXL ») is the
reference style. A style not built yet draws as Bauhaus, so the rest of the system can already choose any of the eight ids.

## Files

| File | What it holds |
|---|---|
| `server/src/deliverables/art/styles/types.ts` | `ArtStyleDef`, `CoverKit`, `CoverCall`, `CoverArt`, `PlateSpec`, the cover's geometry (600 × 848, margins 40) |
| `server/src/deliverables/art/styles/index.ts` | the registry: `BUILT_STYLES`, `styleDef`, `styleOf`, `compositionOf`, `drawPlate` |
| `server/src/deliverables/art/styles/common.ts` | `capHeight`, `minTitleSize`, `posterBreak`, `bestOn`, `harmony`, `hueOf`, `BAUHAUS_ART`, `onBauhausScale` |
| `server/src/deliverables/art/styles/bauhaus.ts` | the V1 adapter: `split` and `minimal` moved verbatim from `cover.ts` |
| `server/src/deliverables/art/styles/typo.ts` | the reference style |
| `server/src/deliverables/art/shapes.ts` | the 14 motifs and 8 ornaments as unit-box silhouettes |
| `server/scripts/styleSheet.ts` | contact sheets and the score against Bauhaus's |
| `server/test/styles.test.ts` | the checks below, for Bauhaus and typo |

A style module imports `types.ts`, `common.ts`, `shapes.ts` and the deliverables' helpers. It never imports `index.ts` nor
`cover.ts`: the registry imports the styles, and the cover imports the registry.

## The interface

```ts
interface ArtStyleDef {
  id: ArtStyle;
  compositions: readonly { id: string; label: string }[];   // at least two, labels in French
  defaultComposition(d: DesignSpec): number;                   // a design that names none
  cover(c: CoverKit, call: CoverCall): CoverArt;               // draws the art, sets the text through the kit
  plate(s: Scene, p: PlateSpec): void;                         // the art in any rectangle
  candidate(d: DesignSpec, inks: InkSet, seed: number, composition: number): number; // art before the title is known
}
```

Register it in `art/styles/index.ts`: one import, one entry in `BUILT`. Styles A (grille, pop, trait) and styles B (collage,
aura, riso) each have a comment line there; replace yours and leave the other.

### The cover

`coverScene` builds the kit (the scene on `inks.paper`, the words cleaned), splits the title into `head` and `tail`, picks the
composition (`compositionOf`: the design's `composition` modulo the style's count, else `defaultComposition`) and calls
`cover(kit, { head, tail, seed, composition })`, `seed` being `artSeed ?? seed`. The style:

1. draws its grounds and art on `kit.s`;
2. sets the text where it wants it, in the inks it wants: `kit.labels(y, { ink, left, right })` (« GUIDE PRATIQUE » or « KIT À
   IMPRIMER », the brand right), `kit.audience(bottom, width, maxLines, { x, ink })` (returns the top of its first line, lay out
   bottom-up), `kit.deck(tail, width, { max, min, lines })` (the tail, or the subtitle as a whole clause), `kit.headline(...)`
   (title then deck, V1's setting), or `kit.put(...)` line by line for its own setting;
3. returns `CoverArt`: `art` (its score, below), `titleSize`, `titleLines`, and for the audit `titleFace`, `titleInk`,
   `titleGround` (the ink the whole title stands on), `titleWidths` (each line as drawn, a sign closing it counted), and
   `sticker` (where a price sticker may land, in shares of the cover, on art and never on the title).

Every line goes through `put` with the width of the box it was fitted to; the kit inks the lines last, over the art, top-down,
so a PDF reader meets the title first. Text that is art (a giant figure, a letter) is drawn as a path with `outlineD` from
`scene.ts`: it never reaches the PDF's text.

Only the voice's faces exist in the PDF (`pdf.ts` registers the voice): a style sets its type in `kit.v.display`,
`displayIt`, `deck`, `label`, `labelB`. Without fonts `loadVoice` gives the standard set; `capHeight` knows those too and
`outlineD` gives '' for them.

### Shapes

`motifShape(motif)` and `ornament(kind, seed)` return a `Silhouette` in a unit box: `body` (filled, nonzero), `holes` (sit on
the body in another ink), `lines` (strokes over the body, another ink), `marks` (strokes that belong to the shape, in its own
ink: the pot's steam, the chart's arrow), `weight` (stroke width in box units). Ornaments: star, sparkle, burst, blob (its
outline from `seed`), squiggle, arrow, check, tape. `drawShape(s, shape, box, ink, place)` draws them: give `body` and `holes`
for a flat cut-out, only `outline` for a line drawing, a gradient as `body` for a lit one; clip a halftone to `pathD(body, box)`
for a screen. `pathD` and `placer` fit the unit box whole and centred in any box, turned (`rot`) or mirrored (`flip`);
`boundsOf` gives where the ink really is, to set a motif on a baseline.

### Inks

Draw with the product's `InkSet` (`paper`, `ink`, `a`, `b`, `c`) and tints of them (`mix` from `color.ts`); nothing else.
Text reads at 4.5:1 at least on what it stands on (`bestOn(ground, [inks.paper, inks.ink])`, `ensureContrast`); an accent
shows from 1.6:1. A tint that text crosses must keep that 4.5 for every ink set on it (typo's `toneOf`).

### Gradients

A path's fill may be `linear(x1, y1, x2, y2, stops)` or `radial(cx, cy, r, stops, { fx, fy })`, stops `{ offset, color,
opacity? }`, in the coordinates of the scene that draws it. pdfkit and the SVG agree to the pixel (stops are pinned to 0 and 1
by `stopsOf`); the SVG names each gradient after its content, so two covers inlined in one page never clash; Skia's
`loadImage` (the films) paints them. Existing ops write the bytes they always wrote.

### The plate

`plate(s, { x, y, u, cols, rows, inks, motif, seed, hero, role })` draws the guide's art in the rectangle of `cols × rows` units
of `u` from (x, y). `role` is `opener` (a chapter's band, with its `hero`), `band` (first and last page), `close` (the end of a
section, at the width of the text), `kit` or `film` (the frame's background, taller than the frame). `hero` is where the page
wants its figure, in units, with its pose and `pick` (the chapter number): a style may read it as a wish, and two chapters
should not look alike. Nothing leaves the rectangle: clip to it. Bauhaus draws `field` with these exact options, so a V1 page
is byte for byte V1's.

### The score

`art` must have Bauhaus's distribution (D200): the choice of style moves money only through the market's taste. Score what you
drew from the choices the seed made (inks, placement, proportions), not from the title, so that `candidate` (what `pickArt`
compares, before the title is known) and the cover's `art` agree. Then put the raw score on Bauhaus's scale with
`onBauhausScale(raw, MEASURED[k], lift)`, `MEASURED[k]` being the raw mean and spread of composition `k` on the sample.

Calibrate with the script: run it once with any `MEASURED`, read « art m ± s » for each composition, and set
`MEASURED[k] = { mean: old.mean + (m − 60.3) · old.sd / 8.7, sd: s · old.sd / 8.7 }`; run it again until it prints « calibré »
(art mean within 1 point of Bauhaus's, sd within 1.5, cover mean within 1). If your title setting reads differently on the
cover's other terms (typo's bigger and more ragged type does), `lift` may move the art mean by up to a point to keep the
cover score neutral too.

```sh
cd server && npx tsx scripts/styleSheet.ts --style <id> --sample 2100 --sheets none        # numbers only
cd server && npx tsx scripts/styleSheet.ts --style <id> --out <dir> --width 300            # and the contact sheets
```

The sheets: per composition, the 15 ink sets × 4 titles in three pages, the 14 motifs, the thumbnails at 150 px, and the plates
in their five roles. Look at them at 600 px and at 150 px before you calibrate.

## Acceptance row E6, and what to test

Copy `server/test/styles.test.ts`'s typo block for your style:

- capitals of the title at least 7 px on a 150 px thumbnail: `size × capHeight(face) × 150 / 600 ≥ 7` (`minTitleSize(face)`
  is the smallest size that holds it);
- the title at least 4.5:1 on its ground, every line of it (a number set in a second ink too);
- the cover SVG at most 150 kB, rendered in under 200 ms;
- every word of the title drawn, no line wider than its box, inside the margins;
- every motif and ink set, every composition; the same design twice gives the same bytes; `Math.random` never called;
- plates inside their rectangle on every role;
- the score on Bauhaus's scale on the sample.

Determinism: no world draw, no clock. Variety comes from `decoRng(hashString(\`<style>|${seed}|…\`))`, with a fixed count of
draws per plan so that a pool that grows moves no other choice. A cover draws exactly one company-stream number per design,
in `designFor`'s seed (`visual.test.ts` pins it).

## Measured (2 100 covers of the sample, `--sample 2100`)

| | art mean ± sd | art min–max | cover mean ± sd | thumbnail, balance | capitals at 150 px | title contrast | SVG max | render mean, p99 |
|---|---|---|---|---|---|---|---|---|
| Bauhaus (V1) | 60.3 ± 8.7 | 18.0–84.9 | 76.4 ± 5.1 | 99.6, 76.3 | min 8.6 px, median 10.8 | min 11.3 | 180 kB | 2.7 ms, 6.2 ms |
| typo, all | 61.0 ± 8.7 | 32.2–77.1 | 75.8 ± 4.9 | 98.8, 71.2 | min 7.5 px, median 15.1 | min 4.5 | 145 kB | 2.2 ms, 4.3 ms |

Each typo composition lands on 61.0 ± 8.7 (the 0.7 lift); render times measured on an idle machine. Bauhaus is V1 and does not move: its largest covers (the moon's field of stars) pass 150 kB, and its titles may go down to 30
(capitals 5 to 5.3 px at 150 px on a title long enough). The sample's titles never get there; a longer one would.

## Typo, the reference

- « Affiche »: one flat ground to the edges (`a`, `ink`, `b` or `c`, the title in whichever of paper and ink reads best), the
  title broken for a poster by `posterBreak` and set as big as the cover allows (up to 168, never under the size that reads at
  150 px), under the rule, on the optical centre or on the audience; its number and unit in a second ink; the motif standing on
  its last baseline as tall as its capitals, or signing the foot as a colophon.
- « Éditorial »: the title on paper, a block of colour under it that holds the deck and the audience, the motif in a disc on
  the cut; the title set as a block.
- « Chiffre »: the title's number, else its first letter, set huge and whole in a tone of the ground at the foot, the title
  over it.
- Plates: one ground, the motif very big and cut by the edge in a tone of that ground, and once more small and sharp where the
  page wants its figure.
