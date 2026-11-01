/**
 * A bounded cache of a pure reading, for work a year of play repeats every day. It lives in this process and never in the
 * world: a reload starts it empty and only reads again, a save cannot carry it, and a key is the whole of what the reading
 * depends on. Past `cap` the oldest entry goes, so what it holds stops growing with the run.
 */
export class BoundedMemo<V> {
  private readonly held = new Map<string, V>();

  constructor(private readonly cap: number) {}

  /** What `compute` gives for `key`. It must read nothing but what the key says, and its result is shared: nobody writes in it. */
  read(key: string, compute: () => V): V {
    const hit = this.held.get(key);
    if (hit !== undefined) return hit;
    const value = compute();
    if (this.held.size >= this.cap) this.held.delete(this.held.keys().next().value!);
    this.held.set(key, value);
    return value;
  }

  get size(): number {
    return this.held.size;
  }
}
