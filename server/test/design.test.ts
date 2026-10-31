import { createWriteStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import PDFDocument from 'pdfkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { contrast, ensureContrast } from '../src/deliverables/color.js';
import { designFor, normalizeDesign, PALETTES } from '../src/deliverables/design.js';
import { advance, faceOf, fitDisplay, isStdFont, loadVoice, registerVoice, sanitizeFor, setFontDir, woffToSfnt, wrapFace } from '../src/deliverables/fonts.js';
import { Scene, toPdf, toSvg } from '../src/deliverables/scene.js';
import { sanitizePdfText } from '../src/deliverables/text.js';
import { facesOf, STD_VOICE, VOICES, voiceFor, type Voice } from '../src/deliverables/voices.js';
import { repoRoot } from '../src/core/paths.js';
import type { TypeVoice } from '../src/shared.js';
import { pdfPagesText, pdfPageStreams } from './pdfText.js';

const FONTS = join(repoRoot(), 'server', 'assets', 'fonts');
const VOICE_IDS = Object.keys(VOICES) as TypeVoice[];
const ALL_FACES = [...new Set(Object.values(VOICES).flatMap(facesOf))];
const FRENCH = 'éèêëàâäçîïôöûùüÿœæÉÈÊËÀÂÇÎÏÔÛÙŒÆ«»’‘“”…–—€·•°² ';
const LIGATURES = ['efficace', 'affiche', 'œuvre'];
const INK = '#131a3b';

let dir = '';
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'design-')); });
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
afterEach(() => setFontDir());

/** One A4 page drawn the way a layout draws it: the voice registered, a Scene through `toPdf`. */
async function page(name: string, v: Voice, draw: (s: Scene) => void): Promise<string> {
  const file = join(dir, `${name}.pdf`);
  const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
  const out = createWriteStream(file);
  doc.pipe(out);
  registerVoice(doc, v);
  doc.addPage();
  const s = new Scene(595.28, 841.89);
  draw(s);
  toPdf(doc, s);
  doc.end();
  await finished(out);
  return file;
}

/** Every face of the voice sets the words that break a naive extraction, a label among them. */
const voicePage = (name: string, v: Voice) => page(name, v, (s) => {
  facesOf(v).forEach((face, i) => s.text(sanitizeFor(face, `${LIGATURES.join(' ')} à 19 € « oui »`), 40, 60 + i * 30, face, 14, INK));
  s.text('GUIDE PRATIQUE', 555, 400, v.labelB, 9, INK, { anchor: 'end', track: 1.8 });
});

describe('the committed fonts', () => {
  it('holds the 28 faces of the voices, each .woff unmodified, each family with its licence', () => {
    expect(ALL_FACES).toHaveLength(28);
    const files = readdirSync(FONTS).filter((f) => f.endsWith('.woff') && !f.includes('-latin-')).sort();
    expect(files).toEqual(ALL_FACES.map((f) => `${f}.woff`).sort());
    for (const f of files) expect(readFileSync(join(FONTS, f)).toString('latin1', 0, 4), f).toBe('wOFF');
    const families = new Set(ALL_FACES.map((f) => f.replace(/-\d+-(normal|italic)$/, '')));
    expect(families.size).toBe(10);
    for (const family of [...families, 'anton', 'montserrat']) {
      expect(readFileSync(join(FONTS, 'OFL', `${family}.txt`), 'utf8'), family).toMatch(/SIL Open Font License/i);
    }
    expect(existsSync(join(FONTS, 'README.md'))).toBe(true);
  });

  it('every face of every voice loads, has GSUB and GPOS, and draws every French glyph', () => {
    for (const name of ALL_FACES) {
      const { font, unitsPerEm } = faceOf(name);
      expect(unitsPerEm, name).toBeGreaterThan(0);
      expect(Object.keys(font.directory.tables), name).toEqual(expect.arrayContaining(['GSUB', 'GPOS']));
      expect([...FRENCH].filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0)!)), name).toEqual([]);
    }
  });

  it('unpacks a WOFF to a plain sfnt and refuses anything else', () => {
    const woff = readFileSync(join(FONTS, 'fraunces-900-normal.woff'));
    const sfnt = woffToSfnt(woff);
    expect(sfnt.readUInt32BE(0)).toBe(woff.readUInt32BE(4));
    expect(sfnt.length).toBeGreaterThan(woff.length);
    expect(sfnt.readUInt16BE(4)).toBe(woff.readUInt16BE(12));
    expect(() => woffToSfnt(Buffer.from('pas une police'))).toThrow();
    expect(() => woffToSfnt(woff.subarray(0, 400))).toThrow();
  });
});

describe('a test page in each voice', () => {
  it.each(VOICE_IDS)('%s embeds its fonts: ≥ 3 /FontFile2, nothing standard', async (id) => {
    const raw = readFileSync(await voicePage(`embed-${id}`, VOICES[id])).toString('latin1');
    expect((raw.match(/\/FontFile2/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(raw).not.toMatch(/\/BaseFont \/(Helvetica|Times|Courier)/);
  });

  it.each(VOICE_IDS)('%s: ligatures extract intact in every face', async (id) => {
    const v = VOICES[id];
    const [text] = pdfPagesText(await voicePage(`liga-${id}`, v));
    for (const face of facesOf(v)) {
      const { font } = faceOf(face);
      // the words really are shaped: a face with `liga` merges « ffi », which a byte-level read would lose
      if (font.availableFeatures.includes('liga')) expect(font.layout('efficace').glyphs.length, face).toBeLessThan('efficace'.length);
    }
    for (const word of LIGATURES) expect(text!.split(word).length - 1, word).toBe(facesOf(v).length);
    expect(text).toContain('à 19 € « oui »');
    expect(text).toContain('GUIDE PRATIQUE');
  });

  it('never embeds a face the page does not use', async () => {
    const raw = readFileSync(await page('one-face', VOICES.conte, (s) => { s.text('efficace', 40, 60, VOICES.conte.text, 12, INK); })).toString('latin1');
    expect((raw.match(/\/FontFile2/g) ?? []).length).toBe(1);
  });
});

describe('without fonts', () => {
  const fallback = async (name: string) => {
    const { voice, degraded } = loadVoice('conte');
    expect(degraded).toBe(true);
    expect(voice).toBe(STD_VOICE);
    const raw = readFileSync(await voicePage(name, voice)).toString('latin1');
    expect(raw).not.toContain('/FontFile2');
    expect(raw).toMatch(/\/BaseFont \/Times-Roman/);
    expect(raw).toMatch(/\/BaseFont \/Helvetica/);
    const [text] = pdfPagesText(join(dir, `${name}.pdf`));
    for (const word of LIGATURES) expect(text).toContain(word);
    expect(text).toContain('à 19 € « oui »');
  };

  it('an empty font folder degrades cleanly: faceOf throws, the page still renders in the standard set', async () => {
    const empty = await mkdtemp(join(dir, 'empty-'));
    setFontDir(empty);
    expect(() => faceOf(VOICES.conte.display)).toThrow();
    expect(() => advance(VOICES.conte.text, 'mot', 10)).toThrow();
    await fallback('degraded-empty');
    setFontDir();
    expect(loadVoice('conte')).toEqual({ voice: VOICES.conte, degraded: false });
  });

  it('a corrupt or truncated file degrades the same way', async () => {
    const bad = await mkdtemp(join(dir, 'corrupt-'));
    setFontDir(bad);
    await writeFile(join(bad, `${VOICES.conte.display}.woff`), 'pas une police');
    expect(() => faceOf(VOICES.conte.display)).toThrow();
    await fallback('degraded-corrupt');
    await writeFile(join(bad, `${VOICES.conte.display}.woff`), readFileSync(join(FONTS, `${VOICES.conte.display}.woff`)).subarray(0, 900));
    expect(() => faceOf(VOICES.conte.display)).toThrow();
    expect(loadVoice('conte').degraded).toBe(true);
  });

  it('the standard set still measures, wraps, fits and draws to SVG', async () => {
    setFontDir(await mkdtemp(join(dir, 'empty-')));
    const v = STD_VOICE;
    expect(facesOf(v).every(isStdFont)).toBe(true);
    expect(advance(v.text, 'mot', 10)).toBeGreaterThan(0);
    expect(wrapFace('Un titre sur plusieurs lignes', v.text, 14, 80).length).toBeGreaterThan(1);
    expect(fitDisplay('Un chiot propre', v.display, { width: 300, max: 62, min: 30, maxLines: 3 }).size).toBeGreaterThan(30);
    expect(sanitizeFor(v.text, 'Sortir → jouer')).toBe(sanitizePdfText('Sortir → jouer'));
    const svg = toSvg(new Scene(100, 100).text('Sauvé & net', 10, 20, v.display, 14, INK));
    expect(svg).toContain('aria-label="Sauvé &amp; net"');
    expect(svg).toContain('<text');
    expect(svg).toContain('font-weight="bold"');
  });
});

describe('measuring', () => {
  const FACE = VOICES.conte.display; // Fraunces has `liga`
  const { font, unitsPerEm } = faceOf(FACE);

  it('advance is the shaped width, tracking sits between glyphs, so a ligature counts for one', () => {
    expect(advance(FACE, 'efficace', 20)).toBeCloseTo((font.layout('efficace').advanceWidth / unitsPerEm) * 20, 6);
    expect(advance(FACE, 'efficace', 40)).toBeCloseTo(advance(FACE, 'efficace', 20) * 2, 6);
    const glyphs = font.layout('efficace').glyphs.length;
    expect(advance(FACE, 'efficace', 20, 1.5) - advance(FACE, 'efficace', 20)).toBeCloseTo((glyphs - 1) * 1.5, 6);
    expect(advance(FACE, '', 20, 3)).toBe(0);
  });

  it('wrapFace keeps every line in the box, no-break spaces glued, an impossible word split rather than overflowing', () => {
    const text = 'Votre chiot apprend en 21 jours pour 19 € : le plan « zéro pipi » tient sur une page imprimée.';
    const lines = wrapFace(text, FACE, 14, 150);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(advance(FACE, l, 14)).toBeLessThanOrEqual(150);
    expect(lines.join(' ').replace(/ /g, ' ')).toBe(text);
    expect(lines.some((l) => l.startsWith('€') || l.startsWith(':') || l.startsWith('»'))).toBe(false);
    const glued = wrapFace('Un guide vendu 19 € seulement', FACE, 14, 90);
    expect(glued.some((l) => l.includes('19 €'))).toBe(true);
    const long = 'a'.repeat(60);
    const split = wrapFace(long, FACE, 14, 100);
    expect(split.join('')).toBe(long);
    for (const l of split) expect(advance(FACE, l, 14)).toBeLessThanOrEqual(100);
    expect(wrapFace('', FACE, 14, 100)).toEqual([]);
  });

  it('fitDisplay never cuts a word in two: « Micro-entrepreneur » forces a smaller size', () => {
    const title = 'Micro-entrepreneur sans erreur';
    expect(wrapFace(title, FACE, 62, 300)).not.toContain('Micro-entrepreneur'); // at 62 the word would come out in two pieces
    const fit = fitDisplay(title, FACE, { width: 300, max: 62, min: 20, maxLines: 5 });
    expect(fit.lines[0]).toBe('Micro-entrepreneur');
    expect(advance(FACE, 'Micro-entrepreneur', fit.size)).toBeLessThanOrEqual(300);
    expect(advance(FACE, 'Micro-entrepreneur', fit.size + 1)).toBeGreaterThan(300);
    expect(fit.lines.join(' ').replace(/ /g, ' ')).toBe(title);
  });

  it('fitDisplay takes the biggest size, then the narrowest measure that keeps the line count', () => {
    const title = 'Un chiot propre en quelques semaines dans';
    const width = 420;
    const fit = fitDisplay(title, FACE, { width, max: 40, min: 20, maxLines: 3 });
    const greedy = wrapFace(title, FACE, fit.size, width);
    const worst = (lines: string[]) => Math.min(...lines.map((l) => advance(FACE, l, fit.size)));
    expect(fit.lines).toHaveLength(greedy.length);
    expect(worst(fit.lines)).toBeGreaterThan(worst(greedy)); // no line left with one short word
    expect(fit.lines.join(' ').replace(/ /g, ' ')).toBe(title);
    expect(fitDisplay('Chiot', FACE, { width: 500, max: 62, min: 30, maxLines: 2 }).size).toBe(62);
  });

  it('fitDisplay honours the height, and at the minimum keeps every word', () => {
    const title = 'Un chiot propre en quelques semaines, même en appartement, la méthode simple';
    const free = fitDisplay(title, FACE, { width: 400, max: 62, min: 20, maxLines: 6 });
    const low = fitDisplay(title, FACE, { width: 400, max: 62, min: 20, maxLines: 6, maxHeight: 120, leading: 1.1 });
    expect(low.size).toBeLessThan(free.size);
    expect(low.lines.length * low.size * 1.1).toBeLessThanOrEqual(120);
    const stuck = fitDisplay(title, FACE, { width: 300, max: 40, min: 30, maxLines: 2 });
    expect(stuck.size).toBe(30);
    expect(stuck.lines.length).toBeGreaterThan(2);
    expect(stuck.lines.join(' ').replace(/ /g, ' ')).toBe(title);
    // a box too narrow for a word even at the minimum: the letters all stay, nothing overflows
    const narrow = fitDisplay('Micro-entrepreneur', FACE, { width: 120, max: 40, min: 30, maxLines: 2 });
    expect(narrow.lines.join('')).toBe('Micro-entrepreneur');
    for (const l of narrow.lines) expect(advance(FACE, l, narrow.size)).toBeLessThanOrEqual(120);
  });
});

describe('sanitizeFor', () => {
  const SERIF = VOICES.conte.text;
  const SANS = VOICES.signal.text;

  it('follows sanitizePdfText: U+202F becomes U+00A0, emoji go, French stays', () => {
    expect(faceOf(SERIF).font.hasGlyphForCodePoint(0x202f)).toBe(false);
    const s = sanitizeFor(SERIF, 'Bébé : œuf à 12 € 🐶');
    expect(s).toBe('Bébé : œuf à 12 €');
    expect(sanitizeFor(SERIF, 'Sortir → jouer')).toBe(sanitizePdfText('Sortir → jouer'));
  });

  it('keeps a mark the face has, spells it out otherwise', () => {
    const up = '↑'.codePointAt(0)!;
    const has = ALL_FACES.find((f) => faceOf(f).font.hasGlyphForCodePoint(up))!;
    const lacks = ALL_FACES.find((f) => !faceOf(f).font.hasGlyphForCodePoint(up))!;
    expect(sanitizeFor(has, 'Prix ↑ net')).toBe('Prix ↑ net');
    expect(sanitizeFor(lacks, 'Prix ↑ net')).toBe(sanitizePdfText('Prix ↑ net'));
  });

  it('folds or drops what the face lacks, so no blank box ever prints', () => {
    const lacking = 'Š'.codePointAt(0)!;
    const face = ALL_FACES.find((f) => !faceOf(f).font.hasGlyphForCodePoint(lacking));
    expect(face).toBeTruthy();
    expect(sanitizeFor(face!, 'Škoda')).toBe('Skoda');
    for (const ch of sanitizeFor(SANS, 'ƒ ‰ † ™ ok\nsuite')) if (ch !== '\n') expect(faceOf(SANS).font.hasGlyphForCodePoint(ch.codePointAt(0)!), ch).toBe(true);
    expect(sanitizeFor(SANS, 'ok\nsuite')).toBe('ok\nsuite');
  });
});

describe('Scene', () => {
  const v = VOICES.conte;

  it('y is the alphabetic baseline, anchors use the real width, in the PDF', async () => {
    const [content] = pdfPageStreams(await page('baseline', v, (s) => {
      s.text('Pied', 40, 100, v.display, 20, INK);
      s.text('Pied', 300, 200, v.display, 20, INK, { anchor: 'middle' });
      s.text('Pied', 500, 300, v.display, 20, INK, { anchor: 'end' });
    }));
    const w = advance(v.display, 'Pied', 20);
    const at = [...content!.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(at).toHaveLength(3);
    expect(at[0]![0]).toBeCloseTo(40, 2);
    expect(at[0]![1]).toBeCloseTo(841.89 - 100, 2);
    expect(at[1]![0]).toBeCloseTo(300 - w / 2, 2);
    expect(at[1]![1]).toBeCloseTo(841.89 - 200, 2);
    expect(at[2]![0]).toBeCloseTo(500 - w, 2);
  });

  it('draws paths, strokes, dashes, opacity and clips in the PDF, then leaves the state as it found it', async () => {
    const [content] = pdfPageStreams(await page('ops', v, (s) => {
      s.rect(10, 10, 100, 50, '#ee7a5b');
      s.circle(200, 100, 30, undefined, { stroke: '#27357a', sw: 2 });
      s.line(10, 300, 200, 300, '#27357a', 1.5, { dash: [4, 3], cap: 'round' });
      s.path('M0 0L10 0L10 10Z', '#f5c971', { op: 0.5 });
      s.clip('M300 300h100v100h-100Z', (c) => c.circle(350, 350, 80, '#131a3b'));
    }));
    expect(content).toMatch(/\[4 3\] 0 d/);
    expect(content).toMatch(/\bW n\b/);
    expect(content).toMatch(/\/Gs\d+ gs/);
    expect(content).toMatch(/1\.5 w/);
    expect((content!.match(/\bq\b/g) ?? []).length).toBe((content!.match(/\bQ\b/g) ?? []).length);
  });

  it('toSvg writes glyph paths with an aria-label, no <text>, no font, no gradient, no image', () => {
    const s = new Scene(600, 848);
    s.rect(0, 0, 600, 848, '#f4ecdf');
    s.text('Propre & « heureux » <21 j>', 300, 200, v.display, 40, INK, { anchor: 'middle', op: 0.9 });
    s.text('Sous-titre', 20, 300, v.deck, 18, INK, { track: 1 });
    const svg = toSvg(s);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 600 848"');
    expect(svg).toContain('aria-label="Propre &amp; « heureux » &lt;21 j&gt;"');
    expect(svg).toContain('aria-label="Sous-titre"');
    expect(svg).not.toMatch(/<text|font-family|Gradient|<image|<filter|href=/);
    const glyphs = /aria-label="Sous-titre" fill="[^"]+" d="([^"]+)"/.exec(svg)![1]!;
    expect(glyphs.length).toBeGreaterThan(200);
    expect(glyphs).toMatch(/^M[\d.-]+ [\d.-]+/);
    expect(toSvg(s)).toBe(svg);
  });

  it('the anchor and the tracking move the outlines in the SVG too', () => {
    const left = (o: Parameters<Scene['text']>[6]) => Number(/ d="M([\d.-]+)/.exec(toSvg(new Scene(600, 100).text('Pied', 300, 50, v.display, 20, INK, o)))![1]);
    const w = advance(v.display, 'Pied', 20);
    expect(left({ anchor: 'end' })).toBeCloseTo(left({}) - w, 1);
    expect(left({ anchor: 'middle' })).toBeCloseTo(left({}) - w / 2, 1);
    const tail = (track: number) => Math.max(...[...toSvg(new Scene(600, 100).text('Pied', 10, 50, v.display, 20, INK, { track })).matchAll(/[ML]([\d.]+) [\d.-]+/g)].map((m) => Number(m[1])));
    expect(tail(5)).toBeCloseTo(tail(0) + 15, 0);
  });

  it('greekBelow replaces small text by a bar of its real width, and gives no word away', () => {
    const s = new Scene(400, 200);
    s.text('Le corps du guide, en petit', 20, 50, v.text, 10.3, INK);
    s.text('Un grand titre', 20, 100, v.display, 24, INK);
    const svg = toSvg(s, { greekBelow: 12, precision: 1 });
    expect(svg).not.toContain('Le corps du guide');
    expect(svg).toContain('aria-label="Un grand titre"');
    const w = Math.round(advance(v.text, 'Le corps du guide, en petit', 10.3) * 10) / 10;
    expect(svg).toContain(`h${w}v`);
    expect(svg).toContain('opacity="0.35"');
    expect(toSvg(s)).toContain('aria-label="Le corps du guide, en petit"');
  });

  it('precision shortens the numbers and the file', () => {
    const s = new Scene(400, 200).text('Une ligne de titre assez longue', 20, 50, v.display, 18, INK);
    const fine = toSvg(s);
    const coarse = toSvg(s, { precision: 1 });
    expect(coarse.length).toBeLessThan(fine.length);
    expect(coarse).not.toMatch(/\d\.\d\d/);
  });

  it('clips are named after their shape: two scenes inlined in one page never collide', () => {
    const clipped = (d: string) => new Scene(100, 100).clip(d, (c) => c.circle(50, 50, 40, '#27357a'));
    const a = toSvg(clipped('M0 0h100v50h-100Z'));
    const b = toSvg(clipped('M0 50h100v50h-100Z'));
    const id = (svg: string) => /clipPath id="([^"]+)"/.exec(svg)![1]!;
    expect(id(a)).not.toBe(id(b));
    expect(a).toContain(`clip-path="url(#${id(a)})"`);
    expect(toSvg(new Scene(10, 10).rect(0, 0, 10, 10, INK))).not.toContain('<defs>');
  });
});

describe('voices', () => {
  it('follow the family, the default is conte', () => {
    const table: Record<string, TypeVoice> = {
      parentalite: 'conte', animaux: 'conte', mental: 'conte', argent: 'dossier', etudes: 'dossier', mariage: 'dossier',
      maison: 'atelier', cuisine: 'atelier', sante: 'signal', tech: 'signal', voyage: 'signal',
    };
    for (const [family, voice] of Object.entries(table)) expect(voiceFor(family), family).toBe(voice);
    expect(voiceFor(null)).toBe('conte');
    expect(voiceFor('inconnue')).toBe('conte');
  });

  it('a hint outranks the family', () => {
    expect(voiceFor('animaux', 'une couverture elegante')).toBe('dossier');
    expect(voiceFor('animaux', 'look luxe')).toBe('dossier');
    expect(voiceFor('cuisine', 'tres sobre')).toBe('signal');
    expect(voiceFor('cuisine', 'moderne')).toBe('signal');
  });

  it('designFor gives each product its voice and the inks of its palette', () => {
    const d = designFor({ nicheName: 'Sommeil de bébé', category: 'parentalité', seed: 1 });
    expect(d.voice).toBe('conte');
    expect(d.inks).toEqual(PALETTES.find((p) => p.palette.bg === d.palette.bg)!.inks);
    expect(designFor({ nicheName: 'Budget du freelance', category: 'business/argent', seed: 2 }).voice).toBe('dossier');
    expect(designFor({ nicheName: 'Potager de balcon', category: 'maison/jardin', seed: 2 }).voice).toBe('atelier');
    expect(designFor({ nicheName: 'Yoga', category: 'santé/forme', seed: 2 }).voice).toBe('signal');
    expect(designFor({ nicheName: 'Budget du freelance', category: 'business/argent', seed: 2, hint: 'très sobre' }).voice).toBe('signal');
    expect(designFor({ nicheName: 'Sommeil de bébé', category: 'parentalité', seed: 1, hint: 'élégant' }).voice).toBe('dossier');
  });
});

describe('inks', () => {
  it('every set is valid, on a paper that is never pure white', () => {
    expect(PALETTES).toHaveLength(15);
    expect(new Set(PALETTES.map((p) => p.inks.paper + p.inks.a)).size).toBe(15);
    for (const { name, inks } of PALETTES) {
      for (const c of Object.values(inks)) expect(c, name).toMatch(/^#[0-9a-f]{6}$/);
      expect(inks.paper, name).not.toBe('#ffffff');
    }
  });

  it('every set reads: contrast(ink, paper) ≥ 9, contrast(a, paper) ≥ 3', () => {
    for (const { name, inks } of PALETTES) {
      expect(contrast(inks.ink, inks.paper), `${name} : ink`).toBeGreaterThanOrEqual(9);
      expect(contrast(inks.a, inks.paper), `${name} : a`).toBeGreaterThanOrEqual(3);
    }
  });

  it('small text set in a or b reaches 4.5 through ensureContrast', () => {
    for (const { name, inks } of PALETTES) {
      expect(contrast(ensureContrast(inks.a, inks.paper, 4.5), inks.paper), `${name} : a`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ensureContrast(inks.b, inks.paper, 4.5), inks.paper), `${name} : b`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('normalizeDesign', () => {
  const fresh = designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed: 3 });
  const { voice: _voice, inks: _inks, ...oldSave } = fresh;

  it('gives an old save its voice and inks, from the family', () => {
    expect(oldSave).not.toHaveProperty('inks');
    const d = normalizeDesign(oldSave);
    expect(d.voice).toBe('conte');
    expect(d.inks).toEqual(fresh.inks);
  });

  it('or from the palette it wears, when the save predates `family` too', () => {
    for (const { palette, family, inks } of PALETTES) {
      const d = normalizeDesign({ ...oldSave, family: undefined, palette });
      expect(d.inks, family).toEqual(inks);
      expect(d.voice, family).toBe(voiceFor(family));
    }
  });

  it('keeps what is valid and repairs what is not', () => {
    const kept = normalizeDesign({ ...fresh, voice: 'signal', artSeed: 77 });
    expect(kept.voice).toBe('signal');
    expect(kept.artSeed).toBe(77);
    expect(kept.inks).toEqual(fresh.inks);
    expect(normalizeDesign(fresh)).not.toHaveProperty('artSeed');
    const broken = normalizeDesign({ ...fresh, voice: 'gothique' as never, inks: { ...fresh.inks!, a: 'pas-une-couleur' }, artSeed: Number.NaN });
    expect(broken.voice).toBe('conte');
    expect(broken.inks).toEqual(fresh.inks);
    expect(broken).not.toHaveProperty('artSeed');
    expect(normalizeDesign({ ...fresh, inks: { paper: '#FFF', ink: '#000', a: '#123', b: '#456', c: '#789' } }).inks).toEqual({ paper: '#ffffff', ink: '#000000', a: '#112233', b: '#445566', c: '#778899' });
  });

  it('a palette from elsewhere takes its family’s inks, and with no family the default set', () => {
    const palette = { ...fresh.palette, bg: '#123456', primary: '#654321' };
    expect(normalizeDesign({ ...fresh, inks: undefined, palette }).inks).toEqual(PALETTES.find((p) => p.family === 'animaux')!.inks);
    const lost = normalizeDesign({ palette });
    expect(lost.inks).toEqual(PALETTES[0]!.inks);
    expect(lost.voice).toBe('conte');
    expect(normalizeDesign(null).inks).toEqual(PALETTES[0]!.inks);
  });
});
