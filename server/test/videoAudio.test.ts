import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { estimateSpeechSec } from '../src/deliverables/speech.js';
import { SR, add, mixDown, readWavMono, stereo, writeWav, writeWavMono, type Stereo } from '../src/video/mix.js';
import { makeMusic, musicFor } from '../src/video/music.js';
import { ding, impact, pop, sfxCues, whoosh, type CueBeat } from '../src/video/sfx.js';
import { alignWords, audibleSpan, estimatedWords, findVoice, synthesize, type TtsEvent } from '../src/video/speech.js';

const rmsDb = (s: Float32Array, from: number, to: number): number => {
  let sum = 0;
  const a = Math.round(from * SR);
  const b = Math.round(to * SR);
  for (let i = a; i < b; i++) sum += s[i] * s[i];
  return 10 * Math.log10(sum / (b - a) + 1e-12);
};
const peakOf = (buf: Stereo): number => {
  let p = 0;
  for (let i = 0; i < buf.L.length; i++) p = Math.max(p, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  return p;
};
const hasNaN = (buf: Stereo): boolean => buf.L.some(Number.isNaN) || buf.R.some(Number.isNaN);
/** Steady tone: its level only moves if the mix moves it. */
function tone(sec: number, gain = 0.3): Stereo {
  const buf = stereo(Math.ceil(sec * SR));
  for (let i = 0; i < buf.L.length; i++) buf.L[i] = buf.R[i] = gain * Math.sin(2 * Math.PI * 220 * i / SR);
  return buf;
}
const silence = (sec: number): Float32Array => new Float32Array(Math.round(sec * SR));

describe('makeMusic', () => {
  const options = musicFor('8 étapes, 8 mois de plan', 'jardin', 'standard');

  it('is deterministic to the sample', () => {
    const a = makeMusic(6, options);
    const b = makeMusic(6, options);
    expect(Buffer.from(a.L.buffer).equals(Buffer.from(b.L.buffer))).toBe(true);
    expect(Buffer.from(a.R.buffer).equals(Buffer.from(b.R.buffer))).toBe(true);
    const other = makeMusic(6, musicFor('Un tout autre hook', 'jardin', 'standard'));
    expect(Buffer.from(a.L.buffer).equals(Buffer.from(other.L.buffer))).toBe(false);
  });

  it('holds no NaN, peaks at 1 at most, and is really music', () => {
    for (const hook of ['Tes tomates ont grillé', 'Ton budget fuit', 'Dors enfin', 'Excel sans larmes']) {
      for (const tempo of ['calm', 'standard', 'fast'] as const) {
        const m = makeMusic(9, musicFor(hook, 'argent', tempo));
        expect(hasNaN(m)).toBe(false);
        expect(peakOf(m)).toBeLessThanOrEqual(1);
        expect(peakOf(m)).toBeGreaterThan(0.2);
        expect(m.L.length).toBe(Math.ceil(10 * SR));
      }
    }
  });

  it('reads tempo, hook and family as the spec sets them', () => {
    expect((['calm', 'standard', 'fast'] as const).map((t) => musicFor('a', 'jardin', t).bpm)).toEqual([88, 112, 128]);
    for (const family of ['mental', 'argent', 'tech']) expect(musicFor('a', family, 'standard').mode).toBe('minor');
    for (const family of ['maison', 'cuisine', undefined]) expect(musicFor('a', family, 'standard').mode).toBe('major');
    const roots = new Set(Array.from({ length: 200 }, (_, i) => musicFor(`hook ${i}`, 'jardin', 'standard').root));
    expect(Math.min(...roots)).toBe(52);
    expect(Math.max(...roots)).toBe(60);
    expect(roots.size).toBe(9);
  });

  it('changes key with the mode', () => {
    const major = makeMusic(4, { ...options, mode: 'major' });
    const minor = makeMusic(4, { ...options, mode: 'minor' });
    expect(Buffer.from(major.L.buffer).equals(Buffer.from(minor.L.buffer))).toBe(false);
  });
});

describe('mixDown', () => {
  const voices = [{ at: 2, dur: 2, pcm: silence(2) }, { at: 8, dur: 2, pcm: silence(2) }]; // silent takes: only the music is measured

  it('ducks the real music at least 8 dB under speech', () => {
    const music = makeMusic(12, musicFor('Tes tomates ont grillé', 'jardin', 'standard'));
    const out = mixDown({ totalSec: 12, music, voices, sfx: [] });
    const under = (rmsDb(out.L, 2.1, 3.9) + rmsDb(out.L, 8.1, 9.9)) / 2;
    const gaps = rmsDb(out.L, 5.2, 7.6);
    expect(gaps - under).toBeGreaterThanOrEqual(8);
  });

  it('ducks by 11 dB, ahead of the voice, and lets go after it', () => {
    const out = mixDown({ totalSec: 12, music: tone(13), voices, sfx: [] });
    const open = rmsDb(out.L, 5.5, 7);
    expect(open - rmsDb(out.L, 2.5, 3.5)).toBeCloseTo(11, 0);
    expect(open - rmsDb(out.L, 1.96, 1.99)).toBeGreaterThan(3);    // already falling before the first word
    expect(open - rmsDb(out.L, 1.4, 1.5)).toBeLessThan(0.5);       // not much earlier
    expect(open - rmsDb(out.L, 4.05, 4.1)).toBeGreaterThan(3);     // still low just after the last word
    expect(open - rmsDb(out.L, 5.2, 5.3)).toBeLessThan(0.5);       // back within a second
  });

  it('leaves the music alone without a voice', () => {
    const out = mixDown({ totalSec: 12, music: tone(13), voices: [], sfx: [] });
    expect(Math.abs(rmsDb(out.L, 5.5, 7) - rmsDb(out.L, 2.5, 3.5))).toBeLessThan(0.1);
  });

  it('adds voice and SFX, soft clips, peaks at 0.92, fades out', () => {
    const pcm = new Float32Array(SR).fill(2); // far too loud
    const out = mixDown({ totalSec: 4, music: tone(5), voices: [{ at: 1, dur: 1, pcm }], sfx: [{ at: 3, sig: impact(), gain: 0.5 }] });
    expect(out.L.length).toBe(4 * SR);
    expect(hasNaN(out)).toBe(false);
    expect(peakOf(out)).toBeCloseTo(0.92, 5);
    expect(Math.abs(out.L[1.5 * SR])).toBeGreaterThan(0.5);
    expect(Math.abs(out.L[out.L.length - 1])).toBeLessThan(0.01);
  });

  it('survives a bed shorter than the cut', () => {
    const out = mixDown({ totalSec: 3, music: tone(1), voices: [], sfx: [] });
    expect(hasNaN(out)).toBe(false);
    expect(out.L[Math.round(2 * SR)]).toBe(0);
  });

  it('pans with equal power and drops what falls outside', () => {
    const buf = stereo(100);
    add(buf, 0, new Float32Array(50).fill(1), 1, 1);
    expect(buf.L[10]).toBeCloseTo(0, 6);
    expect(buf.R[10]).toBeCloseTo(1, 6);
    add(buf, 1, new Float32Array(10).fill(1)); // starts past the end
    add(buf, -1, new Float32Array(10).fill(1)); // ends before the start
    expect(hasNaN(buf)).toBe(false);
  });
});

describe('WAV', () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-audio-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips a stereo mix and a 16 kHz mono take', () => {
    const buf = stereo(SR / 10);
    for (let i = 0; i < buf.L.length; i++) { buf.L[i] = Math.sin(i / 20) * 0.5; buf.R[i] = -0.25; }
    writeWav(join(dir, 'mix.wav'), buf);
    const left = readWavMono(join(dir, 'mix.wav'));
    expect(left.rate).toBe(SR);
    expect(left.s.length).toBe(buf.L.length);
    expect(left.s[100]).toBeCloseTo(buf.L[100], 3);

    const pcm = new Float32Array(1600).fill(0.5);
    writeWavMono(join(dir, 'take.wav'), pcm, 16000);
    const take = readWavMono(join(dir, 'take.wav'));
    expect(take.rate).toBe(16000);
    expect(take.s.length).toBe(1600);
  });

  it('walks past the LIST chunk ffmpeg writes before the data', () => {
    writeWavMono(join(dir, 'plain.wav'), new Float32Array(10).fill(0.5), 44100);
    const plain = readWavMono(join(dir, 'plain.wav'));
    const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([3, 0, 0, 0]), Buffer.from('abc'), Buffer.alloc(1)]); // odd size, one pad byte
    const bytes = readFileSync(join(dir, 'plain.wav'));
    writeFileSync(join(dir, 'list.wav'), Buffer.concat([bytes.subarray(0, 36), list, bytes.subarray(36)]));
    const parsed = readWavMono(join(dir, 'list.wav'));
    expect(parsed.rate).toBe(44100);
    expect([...parsed.s]).toEqual([...plain.s]);
  });

  it('refuses a file that is not a WAV', () => {
    writeFileSync(join(dir, 'nope.wav'), Buffer.alloc(40));
    expect(() => readWavMono(join(dir, 'nope.wav'))).toThrow(/WAV/);
  });
});

describe('sfx', () => {
  const rnd = (): number => 0.5;

  it('lasts what the spec says', () => {
    expect(whoosh(rnd).length).toBe(Math.floor(0.26 * SR));
    expect(pop().length).toBe(Math.floor(0.09 * SR));
    expect(ding().length).toBe(Math.floor(0.7 * SR));
    expect(impact().length).toBe(Math.floor(0.42 * SR));
  });

  const beats: CueBeat[] = [
    { kind: 'hook', t0: 0, dur: 4 },
    { kind: 'pain_bubble', t0: 4, dur: 5 },
    { kind: 'page_proof', t0: 9, dur: 5 },
    { kind: 'bonus_stack', t0: 14, dur: 5, words: [{ text: 'en', at: 2.1 }, { text: 'cadeau,', at: 2.3 }] },
    { kind: 'end_card', t0: 19, dur: 4 },
  ];

  it('puts a whoosh on every beat change, a ding on the gift, gains from 0.22 to 0.5', () => {
    const cues = sfxCues(beats, 7);
    const at = (sig: number): number[] => cues.filter((c) => c.sig.length === Math.floor(sig * SR)).map((c) => c.at);
    expect(at(0.26)).toEqual([3.87, 8.87, 13.87, 18.87]);
    expect(at(0.7)).toEqual([16.3]);
    expect(at(0.42)).toEqual([0, 19.05]);
    expect(at(0.09).sort((a, b) => a - b)).toEqual([4.55, 10, 19.25]);
    for (const c of cues) {
      expect(c.gain).toBeGreaterThanOrEqual(0.22);
      expect(c.gain).toBeLessThanOrEqual(0.5);
      expect(c.sig.some(Number.isNaN)).toBe(false);
    }
  });

  it('is deterministic, and survives a stack that never says « cadeau »', () => {
    const a = sfxCues(beats, 7);
    const b = sfxCues(beats, 7);
    expect(a.map((c) => [...c.sig.slice(0, 500)])).toEqual(b.map((c) => [...c.sig.slice(0, 500)]));
    const plain = sfxCues([{ kind: 'bonus_stack', t0: 1, dur: 4 }], 7);
    expect(plain.map((c) => c.at)).toEqual([0, 3]);
    expect(sfxCues([], 7)).toEqual([]);
  });
});

// Recorded from Hortense at Rate 1, 16 kHz, in the arrival order: [token, character offset, ms].
const RECORDED: { text: string; events: [string, number, number][] }[] = [
  {
    text: '8 étapes, 8 mois de plan, et le calendrier du balcon, mois par mois.',
    events: [['8 mois', 10, 1166.1], ['de', 17, 1356.2], ['plan', 20, 1460.1], ['8 mois', 10, 986.4], ['et', 26, 1955.3], ['le', 29, 2022.1], ['8 étapes', 0, 83.2], ['8 étapes', 0, 271.1], ['calendrier', 32, 2130.2], ['du', 43, 2711.1], ['balcon', 46, 2823.4], ['mois', 54, 3456.3], ['mois', 63, 3868.1], ['par', 59, 3655.2]],
  },
  {
    text: 'Si toi aussi tu te dis « balcon plein nord, ça vaut le coup ou pas », reste deux secondes.',
    events: [['Si', 0, 82], ['toi', 3, 283], ['aussi', 7, 487], ['tu', 13, 809], ['dis', 19, 1096], ['te', 16, 962], ['balcon', 25, 1510], ['plein', 32, 1901], ['nord', 38, 2103], ['ça', 44, 2590], ['vaut', 47, 2780], ['le', 52, 2933], ['ou', 60, 3280], ['coup', 55, 3037], ['pas', 63, 3370], ['reste', 70, 3798], ['secondes', 81, 4323], ['deux', 76, 4143]],
  },
  {
    text: 'La méthode commence par un geste tout simple : mesurer l’ensoleillement du balcon heure par heure.',
    events: [['La', 0, 79], ['méthode', 3, 242], ['commence', 11, 619], ['par', 20, 1059], ['geste', 27, 1324], ['un', 24, 1221], ['tout', 33, 1648], ['simple', 38, 1779], ['mesurer', 47, 2444], ['l’ensoleillement', 55, 2930], ['du', 72, 3546], ['balcon', 75, 3654], ['heure', 82, 4106], ['par', 88, 4311], ['heure', 92, 4520]],
  },
  {
    text: 'Un repère à garder en tête : le terreau d’un pot s’épuise vite.',
    events: [['Un', 0, 82], ['repère', 3, 220], ['à', 10, 600], ['garder', 12, 672], ['en', 19, 1023], ['tête', 22, 1138], ['le', 29, 1699], ['terreau', 32, 1839], ['d’un', 40, 2173], ['s’épuise', 49, 2498], ['pot', 45, 2331], ['vite', 58, 2990]],
  },
  {
    text: 'Dans le guide : le plan de 8 mois et, en cadeau, le calendrier du balcon, mois par mois.',
    events: [['Dans', 0, 79], ['le', 5, 238], ['guide', 8, 351], ['le', 16, 875], ['plan', 19, 1019], ['de', 24, 1257], ['8 mois', 27, 1360], ['8 mois', 27, 1534], ['et', 34, 1726], ['cadeau', 41, 2271], ['en', 38, 2166], ['le', 49, 2805], ['calendrier', 52, 2950], ['du', 63, 3533], ['balcon', 66, 3644], ['par', 79, 4475], ['mois', 74, 4276], ['mois', 83, 4686]],
  },
  {
    text: 'Le guide complet est en lien dans ma bio.',
    events: [['Le', 0, 83], ['guide', 3, 271], ['complet', 9, 494], ['est', 17, 992], ['en', 21, 1105], ['lien', 24, 1278], ['dans', 29, 1494], ['ma', 34, 1609], ['bio', 37, 1751]],
  },
];
const eventsOf = (row: { events: [string, number, number][] }): TtsEvent[] => row.events.map(([t, c, ms]) => ({ t, c, ms }));

describe('alignWords', () => {
  const [hook, pain] = RECORDED;

  it('gives the hook its 14 words, « 8 » and « étapes » each with its own event', () => {
    const words = alignWords(hook.text, eventsOf(hook));
    expect(words).toHaveLength(14);
    expect(words.map((w) => w.text).slice(0, 4)).toEqual(['8', 'étapes,', '8', 'mois']);
    expect(words[0].at).toBeCloseTo(0.0832, 4);
    expect(words[1].at).toBeCloseTo(0.2711, 4);
    expect(words[2].at).toBeCloseTo(0.9864, 4);
    expect(words[3].at).toBeCloseTo(1.1661, 4);
  });

  it('is monotonic on every recorded line, words from the source text', () => {
    for (const row of RECORDED) {
      const words = alignWords(row.text, eventsOf(row));
      expect(words.map((w) => w.text)).toEqual(row.text.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)));
      for (let i = 0; i < words.length; i++) {
        expect(words[i].end).toBeGreaterThanOrEqual(words[i].at);
        if (i) expect(words[i].at).toBeGreaterThanOrEqual(words[i - 1].at);
        if (i) expect(words[i - 1].end).toBe(words[i].at);
      }
    }
  });

  it('does not care in what order the events arrived', () => {
    const sorted = [...eventsOf(pain)].sort((a, b) => a.ms - b.ms);
    expect(alignWords(pain.text, eventsOf(pain))).toEqual(alignWords(pain.text, sorted));
    const words = alignWords(pain.text, eventsOf(pain));
    expect(words[1]).toMatchObject({ text: 'toi', at: 0.283 });
    expect(words[4]).toMatchObject({ text: 'te', at: 0.962 });
  });

  it('skips guillemets and a lone colon, which never get a word of their own', () => {
    const words = alignWords(pain.text, eventsOf(pain)).map((w) => w.text);
    expect(words).not.toContain('«');
    expect(words).not.toContain('»,');
    expect(alignWords(RECORDED[2].text, eventsOf(RECORDED[2])).map((w) => w.text)).not.toContain(':');
  });

  it('interpolates on characters where an event is missing', () => {
    const lost = eventsOf(hook).filter((e) => e.t !== 'calendrier');
    const words = alignWords(hook.text, lost);
    const i = words.findIndex((w) => w.text === 'calendrier');
    expect(words).toHaveLength(14);
    expect(words[i].at).toBeGreaterThan(words[i - 1].at);
    expect(words[i].at).toBeLessThan(words[i + 1].at);
    // « le » at char 29, 2,022 s; « du » at char 43, 2,711 s; « calendrier » at char 32
    expect(words[i].at).toBeCloseTo(2.0221 + (2.7111 - 2.0221) * (3 / 14), 3);
  });

  it('times every word at the speech pace with no event at all, and ignores a stray one', () => {
    const none = alignWords(hook.text, []);
    expect(none).toHaveLength(14);
    expect(none[0].at).toBe(0);
    expect(none.at(-1)!.at).toBeCloseTo(63 / 20.5, 2);
    expect(alignWords('Deux mots.', [{ t: 'x', c: 400, ms: 90 }]).map((w) => w.text)).toEqual(['Deux', 'mots.']);
    expect(alignWords('', [])).toEqual([]);
  });

  it('keeps the symbols a caption cannot lose', () => {
    expect(alignWords('Gagne 39 € en 3 mois, soit 33 % de plus — enfin.', []).map((w) => w.text))
      .toEqual(['Gagne', '39', '€', 'en', '3', 'mois,', 'soit', '33', '%', 'de', 'plus', 'enfin.']);
    expect(estimatedWords('Moins 20 %').map((w) => w.text)).toEqual(['Moins', '20', '%']);
  });

  it('splits words on the non-breaking spaces of French typography', () => {
    const words = alignWords('Vraiment\u00a0? Oui\u202f!', [{ t: 'Vraiment', c: 0, ms: 80 }, { t: 'Oui', c: 11, ms: 700 }]);
    expect(words.map((w) => w.text)).toEqual(['Vraiment', 'Oui']);
    expect(words[1].at).toBe(0.7);
  });
});

describe('estimatedWords', () => {
  const line = RECORDED[4].text;

  it('gives a clean estimate: every word, monotonic, ends on the speech model', () => {
    const words = estimatedWords(line);
    expect(words).toHaveLength(18);
    expect(words[0].at).toBe(0);
    expect(words.at(-1)!.end).toBeCloseTo(estimateSpeechSec(line), 6);
    for (let i = 0; i < words.length; i++) {
      expect(Number.isFinite(words[i].at)).toBe(true);
      expect(words[i].end).toBeGreaterThanOrEqual(words[i].at);
      if (i) expect(words[i].at).toBe(words[i - 1].end);
    }
  });

  it('leaves the pause of a colon', () => {
    const paused = estimatedWords('Dans le guide : le plan');
    const flat = estimatedWords('Dans le guide   le plan');
    expect(paused[3].at).toBeGreaterThan(flat[3].at);
  });

  it('stays close to what Hortense really does', () => {
    for (const row of RECORDED) {
      const real = alignWords(row.text, eventsOf(row));
      const est = estimatedWords(row.text);
      expect(est).toHaveLength(real.length);
      expect(Math.abs(est.at(-1)!.at - real.at(-1)!.at) / real.at(-1)!.at).toBeLessThan(0.15);
    }
  });

  it('has nothing to say on an empty line or bare punctuation', () => {
    expect(estimatedWords('')).toEqual([]);
    expect(estimatedWords(' « … » ')).toEqual([]);
  });
});

describe('audibleSpan', () => {
  it('cuts the silence around the speech at -40 dB', () => {
    const s = new Float32Array(1000).fill(0.005);
    s.fill(0.3, 120, 700);
    expect(audibleSpan(s)).toEqual({ start: 120, end: 699 });
  });

  it('does not run away on a silent take', () => {
    expect(audibleSpan(new Float32Array(100))).toEqual({ start: 0, end: 0 });
    expect(audibleSpan(new Float32Array(0))).toEqual({ start: 0, end: 0 });
  });
});

describe('synthesize', () => {
  it('without a voice, estimates every line and touches no file', () => {
    const dir = join(tmpdir(), `no-voice-${process.pid}`);
    const lines = synthesize([RECORDED[0].text, ''], null, { cacheDir: dir });
    expect(lines[0]).toMatchObject({ text: RECORDED[0].text, voice: null, wav: null });
    expect(lines[0].speechSec).toBeCloseTo(estimateSpeechSec(RECORDED[0].text), 6);
    expect(lines[0].words).toHaveLength(14);
    expect(lines[1]).toEqual({ text: '', voice: null, wav: null, speechSec: 0, words: [] });
    expect(existsSync(dir)).toBe(false);
  });
});

const voice = findVoice();
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const hasFfmpeg = spawnSync(ffmpeg, ['-version'], { windowsHide: true }).status === 0;

describe.skipIf(!voice || !hasFfmpeg)('the real voice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-voice-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const line = 'Le terreau d’un pot s’épuise vite, il n’a pas la réserve d’un sol de jardin.';

  it('speaks a French line with word times that land on the audio', { timeout: 30_000 }, () => {
    const [spoken, empty] = synthesize([line, ''], voice, { cacheDir: dir, ffmpeg });
    expect(spoken.voice).toBe(voice);
    expect(empty.wav).toBeNull();
    expect(spoken.words).toHaveLength(line.split(' ').length);
    expect(spoken.words.at(-1)!.end).toBe(spoken.speechSec);
    expect(spoken.words.at(-1)!.at).toBeLessThan(spoken.speechSec - 0.1);
    expect(Math.abs(spoken.speechSec - estimateSpeechSec(line)) / spoken.speechSec).toBeLessThan(0.15);

    const wav = readWavMono(spoken.wav!);
    expect(wav.rate).toBe(44100);
    expect(wav.s.length / wav.rate).toBeCloseTo(spoken.speechSec, 1);
    expect(Math.max(...wav.s.slice(-4410).map(Math.abs))).toBeGreaterThan(0.002); // the engine's tail is gone

    // The trap of 22 kHz: every time 1.378 × too late. « il » must start where the comma's pause ends.
    const il = spoken.words.find((w) => w.text === 'il')!;
    expect(Math.abs(pauseEnd(wav.s, wav.rate) - il.at)).toBeLessThan(0.12);
  });

  it('caches by text, voice and rate: the second call needs neither engine nor ffmpeg', { timeout: 30_000 }, () => {
    const first = synthesize([line], voice, { cacheDir: dir, ffmpeg })[0];
    const again = synthesize([line], voice, { cacheDir: dir, ffmpeg: 'no-such-ffmpeg' })[0];
    expect(again).toEqual(first);
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^[0-9a-f]{40}\.json$/);
    expect(files[1]).toMatch(/^[0-9a-f]{40}\.wav$/);
    const faster = synthesize([line], voice, { cacheDir: dir, ffmpeg, rate: 3 })[0];
    expect(faster.speechSec).toBeLessThan(first.speechSec * 0.9); // another rate is another take, never the cached one
    expect(readdirSync(dir)).toHaveLength(4);
  });

  it('falls back to the estimate, whole, when the chain fails', { timeout: 30_000 }, () => {
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const lines = synthesize([line, 'Une ligne de plus.'], voice, { cacheDir: dir, ffmpeg: 'no-such-ffmpeg' });
      expect(lines.map((l) => l.voice)).toEqual([null, null]);
      expect(lines.every((l) => l.wav === null && l.words.length > 0)).toBe(true);
    } finally {
      console.warn = warn;
    }
  });
});

/** End of the longest pause inside the speech, seconds. Comma pause of this line. */
function pauseEnd(s: Float32Array, rate: number): number {
  const hop = Math.round(rate / 100);
  let best = 0; let end = 0; let run = 0;
  for (let i = 0; i + hop < s.length; i += hop) {
    let e = 0;
    for (let k = i; k < i + hop; k++) e = Math.max(e, Math.abs(s[k]));
    run = e < 0.02 ? run + 1 : 0;
    if (run > best) { best = run; end = (i + hop) / rate; }
  }
  return end;
}
