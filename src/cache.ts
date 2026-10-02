export class TtlCache<V> {
  #store = new Map<string, { value: V; expires: number }>();
  #inflight = new Map<string, Promise<V>>();
  readonly ttlMs: number;
  readonly maxEntries: number;

  constructor(ttlMs: number, maxEntries = 5000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string): V | undefined {
    const hit = this.#store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.#store.delete(key);
      return undefined;
    }
    // Refresh LRU position.
    this.#store.delete(key);
    this.#store.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    this.#store.delete(key);
    this.#store.set(key, { value, expires: Date.now() + ttlMs });
    while (this.#store.size > this.maxEntries) {
      const oldest = this.#store.keys().next().value;
      if (oldest === undefined) break;
      this.#store.delete(oldest);
    }
  }

  async wrap(key: string, fn: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const pending = this.#inflight.get(key);
    if (pending) return pending;
    const promise = fn()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, promise);
    return promise;
  }
}
