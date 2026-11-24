export interface RateLimiterOptions {
  windowMs: number;
  maxAttempts: number;
  maxEntries?: number;
}

export interface RateLimiter {
  isLimited(key: string): boolean;
  recordFailure(key: string): number;
  consume(key: string): boolean;
  clear(key: string): void;
  destroy(): void;
}

/**
 * Limitador de tasa en memoria con expiración TTL y cota máxima de entradas para prevenir OOM.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { windowMs, maxAttempts, maxEntries = 10_000 } = options;
  const entries = new Map<string, { count: number; resetAt: number }>();

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of entries.entries()) {
      if (now > v.resetAt) {
        entries.delete(k);
      }
    }
  }, Math.max(windowMs, 30_000));
  cleanupTimer.unref?.();

  function evictIfNeeded(now: number): void {
    if (entries.size < maxEntries) return;
    for (const [k, v] of entries.entries()) {
      if (now > v.resetAt) {
        entries.delete(k);
      }
    }
    while (entries.size >= maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
    }
  }

  function isLimited(key: string): boolean {
    const now = Date.now();
    const entry = entries.get(key);
    if (!entry) return false;
    if (now > entry.resetAt) {
      entries.delete(key);
      return false;
    }
    return entry.count >= maxAttempts;
  }

  function recordFailure(key: string): number {
    const now = Date.now();
    const entry = entries.get(key);
    if (!entry || now > entry.resetAt) {
      evictIfNeeded(now);
      entries.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  function consume(key: string): boolean {
    if (isLimited(key)) return false;
    recordFailure(key);
    return true;
  }

  function clear(key: string): void {
    entries.delete(key);
  }

  function destroy(): void {
    clearInterval(cleanupTimer);
    entries.clear();
  }

  return {
    isLimited,
    recordFailure,
    consume,
    clear,
    destroy,
  };
}
