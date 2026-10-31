/** The speech model reaches the score: a drift here moves every cut of every run. Lines and times measured on Hortense, Rate 1 (video §3.2). */
import { describe, expect, it } from 'vitest';
import { estimateSpeechSec } from '../src/deliverables/speech.js';

const MEASURED: [string, number][] = [
  ['8 étapes, 8 mois de plan, et le calendrier du balcon, mois par mois.', 4.07],
  ['Si toi aussi tu te dis « balcon plein nord, ça vaut le coup ou pas », reste deux secondes.', 4.81],
  ['La méthode commence par un geste tout simple : mesurer l’ensoleillement du balcon heure par heure.', 4.71],
  ['Un repère à garder en tête : le terreau d’un pot s’épuise vite.', 3.26],
  ['Dans le guide : le plan de 8 mois et, en cadeau, le calendrier du balcon, mois par mois.', 4.91],
  ['Le guide complet est en lien dans ma bio.', 1.98],
];

describe('estimateSpeechSec', () => {
  it.each(MEASURED)('« %s » stays within 10 % of %d s', (line, seconds) => {
    expect(Math.abs(estimateSpeechSec(line) - seconds) / seconds).toBeLessThanOrEqual(0.1);
  });

  it('errs on the long side, the safe one for a budget', () => {
    for (const [line, seconds] of MEASURED) expect(estimateSpeechSec(line)).toBeGreaterThanOrEqual(seconds);
  });

  it('a pause costs time, the end of the text does not, and neither does the space around it', () => {
    const plain = estimateSpeechSec('Deux phrases sans pause ici');
    expect(estimateSpeechSec('Deux phrases, sans pause ici')).toBeGreaterThan(plain + 0.2);
    expect(estimateSpeechSec('Une phrase finie. Une autre encore')).toBeGreaterThan(estimateSpeechSec('Une phrase finie, une autre encore'));
    expect(estimateSpeechSec('  Une phrase finie.  ')).toBeCloseTo(estimateSpeechSec('Une phrase finie.'), 6);
  });
});
