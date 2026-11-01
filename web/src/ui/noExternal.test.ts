// Opening the office asks nothing of the outside world, in the source and in what a real build writes (A25).
// Run: cd server && npx vitest run --root ../web/src
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, type Rolldown } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const web = fileURLToPath(new URL('../../', import.meta.url));

describe('no external request', () => {
  let output: (Rolldown.OutputAsset | Rolldown.OutputChunk)[] = [];

  beforeAll(async () => {
    // written nowhere: the bundle stays in memory, so a stale or missing web/dist decides nothing
    const built = await build({ root: web, configFile: `${web}vite.config.ts`, logLevel: 'silent', build: { write: false } });
    output = (Array.isArray(built) ? built[0]! : built as Rolldown.RolldownOutput).output;
  }, 120_000);

  const text = (fileName: string): string => {
    const file = output.find((o) => o.fileName === fileName);
    if (file?.type !== 'asset') throw new Error(`${fileName} not built`);
    return String(file.source);
  };

  it('web/index.html holds no http', () => {
    expect(readFileSync(`${web}index.html`, 'utf8')).not.toMatch(/http/i);
  });

  it('the built index.html holds no http', () => {
    expect(text('index.html')).not.toMatch(/http/i);
  });

  it('the bundle carries the latin faces itself and nothing points at Google', () => {
    const files = output.map((o) => o.fileName);
    for (const face of ['inter-latin-400', 'inter-latin-800', 'press-start-2p-latin-400', 'silkscreen-latin-400', 'silkscreen-latin-700']) {
      expect(files.some((f) => f.includes(face) && f.endsWith('.woff2'))).toBe(true);
    }
    expect(files.some((f) => /latin-ext|cyrillic/.test(f))).toBe(false);
    const css = output.filter((o) => o.fileName.endsWith('.css')).map((o) => (o.type === 'asset' ? String(o.source) : '')).join('\n');
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});
