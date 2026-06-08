// Server-side in-memory cache for serialised vault context strings.
// A Map at module scope survives across requests within the same serverless
// instance. On a cold start the cache is empty and the first query rebuilds
// it. TTL is 1 hour — invalidateContext() also clears it immediately when
// new data is added via the extract Inngest job.

interface CacheEntry {
  context: string;
  builtAt: number; // Date.now()
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000; // 1 hour

export function getCachedContext(userId: string): string | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.builtAt > TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return entry.context;
}

export function setCachedContext(userId: string, context: string): void {
  cache.set(userId, { context, builtAt: Date.now() });
}

// Called by the extract Inngest job after a successful extraction so the
// next query sees the newly added person and facts.
export function invalidateContext(userId: string): void {
  cache.delete(userId);
}
