export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class AnalysisCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1_000,
    private readonly now = () => Date.now(),
  ) {}

  get(fingerprint: string): T | undefined {
    const entry = this.entries.get(fingerprint);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(fingerprint);
      return undefined;
    }
    return entry.value;
  }

  set(fingerprint: string, value: T): void {
    this.entries.set(fingerprint, { value, expiresAt: this.now() + this.ttlMs });
  }

  async getOrSet(fingerprint: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.get(fingerprint);
    if (cached !== undefined) return cached;
    const value = await factory();
    this.set(fingerprint, value);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
