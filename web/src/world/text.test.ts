// The canvas waits for its fonts, and never for ever.
// Run: cd server && npx vitest run --root ../web/src
import { describe, expect, it } from 'vitest';
import { canvasFontsReady } from './text';

describe('canvasFontsReady', () => {
  it('asks for the pixel face and every weight of Inter the canvas draws with', async () => {
    const asked: string[] = [];
    await canvasFontsReady({ load: async (face: string) => { asked.push(face); return []; } });
    expect(asked).toEqual(expect.arrayContaining(['10px "Silkscreen"', '500 11px "Inter"', '600 13px "Inter"', '700 12px "Inter"']));
  });

  it('waits for the loads before it resolves', async () => {
    let release = (): void => undefined;
    const gate = new Promise<never[]>((resolve) => { release = () => resolve([]); });
    let done = false;
    const ready = canvasFontsReady({ load: () => gate }).then(() => { done = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(done).toBe(false);
    release();
    await ready;
    expect(done).toBe(true);
  });

  it('a font that fails or never answers does not stop the world', async () => {
    await expect(canvasFontsReady({ load: () => Promise.reject(new Error('404')) })).resolves.toBeUndefined();
    await expect(canvasFontsReady({ load: () => new Promise(() => undefined) }, 10)).resolves.toBeUndefined();
  });

  it('no font API, nothing to wait for', async () => {
    await expect(canvasFontsReady(undefined)).resolves.toBeUndefined();
  });
});
