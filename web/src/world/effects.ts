// Short-lived pixel effects of the world: dust, confetti, sparks, floating text. Decor only, drawn
// over the tint pass with the status icons. The noise is seeded: nothing here touches the simulation.
import { drawPixelText, textWidth } from './font';
import { seeded } from './pixel';

export const MAX_PARTICLES = 240;
const DUST_N = 10;
const DUST_LIFE = 0.6;
const CONFETTI_LIFE = 2.2;
const CONFETTI_COLORS = ['#ff6b8a', '#ffd166', '#7dd3fc', '#a78bfa', '#4ade80', '#ffffff'];
const SPARK_COLORS = ['#ffffff', '#ffe08a', '#ff9d3c'];
const SPARK_LOOP = 0.7;
const SPARK_RAYS = 6;
const FLOATER_LIFE = 1.6;
const FLOATER_RISE = 14;

interface Particle { x: number; y: number; vx: number; vy: number; gravity: number; age: number; life: number; color: string }
interface Spark { x: number; y: number; age: number; life: number }
interface Floater { x: number; y: number; text: string; color: string; age: number }

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export class Effects {
  private particles: Particle[] = [];
  private sparks: Spark[] = [];
  private floaters: Floater[] = [];
  private noise = seeded(7321);
  private share: number;

  constructor(reduced = prefersReducedMotion()) {
    this.share = reduced ? 0.25 : 1;
  }

  get particleCount(): number {
    return this.particles.length;
  }

  private count(n: number): number {
    return Math.max(1, Math.round(n * this.share));
  }

  private push(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  dust(x: number, y: number): void {
    for (let i = this.count(DUST_N); i > 0; i--) {
      const a = this.noise() * Math.PI * 2;
      const v = 8 + this.noise() * 12;
      this.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5 - 4, gravity: 0, age: 0, life: DUST_LIFE, color: i % 2 ? '#e6dccb' : '#c9bda8' });
    }
  }

  confetti(x: number, y: number, n: number): void {
    for (let i = this.count(n); i > 0; i--) {
      const color = CONFETTI_COLORS[Math.floor(this.noise() * CONFETTI_COLORS.length)] ?? '#ffffff';
      this.push({ x: x + (this.noise() - 0.5) * 30, y, vx: (this.noise() - 0.5) * 34, vy: -30 - this.noise() * 34, gravity: 46, age: 0, life: CONFETTI_LIFE, color });
    }
  }

  spark(x: number, y: number, seconds: number): void {
    this.sparks.push({ x, y, age: 0, life: seconds });
  }

  floater(x: number, y: number, text: string, color: string): void {
    this.floaters.push({ x, y, text, color, age: 0 });
  }

  update(dt: number): void {
    for (const p of this.particles) {
      p.age += dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const s of this.sparks) s.age += dt;
    this.sparks = this.sparks.filter((s) => s.age < s.life);
    for (const f of this.floaters) f.age += dt;
    this.floaters = this.floaters.filter((f) => f.age < FLOATER_LIFE);
  }

  draw(g: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      g.globalAlpha = Math.max(0, 1 - p.age / p.life);
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    for (const s of this.sparks) {
      const t = (s.age % SPARK_LOOP) / SPARK_LOOP;
      g.globalAlpha = 1 - t * 0.6;
      for (let i = 0; i < SPARK_RAYS; i++) {
        const a = (i / SPARK_RAYS) * Math.PI * 2 + 0.26;
        g.fillStyle = SPARK_COLORS[i % SPARK_COLORS.length] ?? '#ffffff';
        for (let r = 2 + t * 4; r < 5 + t * 5; r++) g.fillRect(Math.round(s.x + Math.cos(a) * r), Math.round(s.y + Math.sin(a) * r * 0.7), 1, 1);
      }
    }
    for (const f of this.floaters) {
      const t = f.age / FLOATER_LIFE;
      g.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      const x = Math.round(f.x - textWidth(f.text) / 2);
      const y = Math.round(f.y - FLOATER_RISE * t);
      drawPixelText(g, f.text, x + 1, y + 1, '#2a1f3d');
      drawPixelText(g, f.text, x, y, f.color);
    }
    g.globalAlpha = 1;
  }
}
