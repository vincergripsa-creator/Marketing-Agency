// 2D camera over the world (world px at scale 1): pan, zoom around a point, clamped bounds,
// smooth fly-to and follow (exponential easing, frame-rate independent).

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  minZoom = 0.35;
  maxZoom = 5;
  /** css px of the viewport */
  w = 1;
  h = 1;
  private bounds: Bounds = { minX: -500, minY: -300, maxX: 500, maxY: 300 };
  private target: { x: number; y: number; zoom: number } | null = null;
  private follow: (() => { x: number; y: number } | null) | null = null;
  private followZoom = 3;

  setViewport(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.updateMinZoom();
    this.clamp();
  }

  setBounds(b: Bounds): void {
    this.bounds = b;
    this.updateMinZoom();
    this.clamp();
  }

  fitZoom(): number {
    const bw = Math.max(1, this.bounds.maxX - this.bounds.minX);
    const bh = Math.max(1, this.bounds.maxY - this.bounds.minY);
    return Math.min(this.w / bw, this.h / bh);
  }

  private updateMinZoom(): void {
    this.minZoom = Math.max(0.2, Math.min(1, this.fitZoom() * 0.75));
    if (this.zoom < this.minZoom) this.zoom = this.minZoom;
  }

  overview(): { x: number; y: number; zoom: number } {
    const b = this.bounds;
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 - 28, zoom: this.clampZoom(this.fitZoom() * 0.98) };
  }

  clampZoom(z: number): number {
    return Math.max(this.minZoom, Math.min(this.maxZoom, z));
  }

  clamp(): void {
    const b = this.bounds;
    this.x = Math.max(b.minX, Math.min(b.maxX, this.x));
    this.y = Math.max(b.minY - 80, Math.min(b.maxY, this.y));
  }

  snapTo(x: number, y: number, zoom: number): void {
    this.x = x;
    this.y = y;
    this.zoom = this.clampZoom(zoom);
    this.target = null;
    this.clamp();
  }

  flyTo(x: number, y: number, zoom: number): void {
    this.follow = null;
    this.target = { x, y, zoom: this.clampZoom(zoom) };
  }

  followTarget(fn: () => { x: number; y: number } | null, zoom: number): void {
    this.target = null;
    this.follow = fn;
    this.followZoom = this.clampZoom(zoom);
  }

  /** User took control (drag / wheel): stop automatic motion. */
  release(): void {
    this.target = null;
    this.follow = null;
  }

  get busy(): boolean {
    return !!this.target || !!this.follow;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 5.5);
    if (this.target) {
      const t = this.target;
      this.x += (t.x - this.x) * k;
      this.y += (t.y - this.y) * k;
      this.zoom *= Math.pow(t.zoom / this.zoom, k);
      if (Math.abs(t.x - this.x) < 0.3 && Math.abs(t.y - this.y) < 0.3 && Math.abs(t.zoom / this.zoom - 1) < 0.002) {
        this.x = t.x;
        this.y = t.y;
        this.zoom = t.zoom;
        this.target = null;
      }
    } else if (this.follow) {
      const p = this.follow();
      if (p) {
        this.x += (p.x - this.x) * k;
        this.y += (p.y - this.y) * k;
        this.zoom *= Math.pow(this.followZoom / this.zoom, k);
      }
    }
    this.clamp();
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.zoom + this.w / 2, (wy - this.y) * this.zoom + this.h / 2];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.zoom + this.x, (sy - this.h / 2) / this.zoom + this.y];
  }

  panBy(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = this.clampZoom(this.zoom * factor);
    const [nx, ny] = this.screenToWorld(sx, sy);
    this.x += wx - nx;
    this.y += wy - ny;
    this.clamp();
  }
}
