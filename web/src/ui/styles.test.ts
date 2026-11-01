// Guards on styles.css: panels open fast, never fade (the world would show through), and stack above the world.
// Run: cd server && npx vitest run --root ../web/src
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// read from disk: vitest does not serve CSS contents (even with ?raw) without a css config
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
// top-level rules only: they start at column 0 (rules nested in @media are indented)
const base = css;

function rule(sel: string): string {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(base);
  if (!m) throw new Error(`rule ${sel} not found`);
  return m[1]!;
}
function zIndex(sel: string): number {
  const m = /z-index:\s*(-?\d+)/.exec(rule(sel));
  if (!m) throw new Error(`no z-index on ${sel}`);
  return Number(m[1]);
}
function keyframes(name: string): string {
  const m = new RegExp(`@keyframes ${name}\\s*\\{(.*)\\}`).exec(css);
  if (!m) throw new Error(`keyframes ${name} not found`);
  return m[1]!;
}
function animation(sel: string): { name: string; ms: number } {
  const m = /animation:\s*([\w-]+)\s+([\d.]+)(m?s)/.exec(rule(sel));
  if (!m) throw new Error(`no animation on ${sel}`);
  return { name: m[1]!, ms: Number(m[2]) * (m[3] === 's' ? 1000 : 1) };
}

describe('focus stays visible on the text inputs that remove their own outline', () => {
  for (const sel of ['.search', '.mission', '.brain-search']) {
    it(`${sel} shows a ring while its input has focus`, () => {
      expect(rule(`${sel}:focus-within`)).toMatch(/(outline|box-shadow):\s*[^;]*#3b82f6/);
    });
  }
});

describe('dead rules', () => {
  it('no rule for a badge nothing renders', () => {
    expect(css).not.toContain('.badge-red');
  });
});

describe('panel opening', () => {
  for (const sel of ['.overlay', '.side-panel', '.modal']) {
    it(`${sel} opens in ≤ 150 ms without an opacity fade`, () => {
      const a = animation(sel);
      expect(a.ms).toBeLessThanOrEqual(150);
      expect(keyframes(a.name)).not.toMatch(/opacity/);
    });
  }
  it('tab overlays are (almost) opaque', () => {
    expect(rule('.overlay')).toMatch(/background:\s*var\(--glass-solid\)/);
  });
});

describe('stacking: panels above every world element', () => {
  it('world and UI layers are isolated stacking contexts, UI on top', () => {
    expect(rule('.world-layer')).toMatch(/isolation:\s*isolate/);
    expect(rule('.ui-layer')).toMatch(/isolation:\s*isolate/);
    expect(zIndex('.ui-layer')).toBeGreaterThan(zIndex('.world-layer'));
  });
  it('overlays and side panels cover the journal, mission bar, minimap, strip and HUD', () => {
    const chrome = ['.feed', '.mission', '.minimap-wrap', '.dept-strip', '.hud-row'].map(zIndex);
    expect(zIndex('.overlay')).toBeGreaterThan(Math.max(...chrome));
    expect(zIndex('.side-panel')).toBeGreaterThan(zIndex('.overlay'));
  });
  it('the top bar (search / mobile menu dropdowns) stays above the panels, toasts and modal above all', () => {
    expect(zIndex('.topbar')).toBeGreaterThan(zIndex('.side-panel'));
    expect(zIndex('.toasts')).toBeGreaterThan(zIndex('.topbar'));
    expect(zIndex('.modal-backdrop')).toBeGreaterThan(zIndex('.toasts'));
  });
});
