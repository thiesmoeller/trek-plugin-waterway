'use strict';

const DEFAULT_OVERPASS_URLS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]);
const DEFAULT_OVERPASS_URL = DEFAULT_OVERPASS_URLS[0];
const CACHE_TTL_MS = 45 * 60 * 1000;
const STALE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ATTEMPT_TIMEOUTS_MS = Object.freeze([7_000, 5_000, 5_000]);
const RETRYABLE_HTTP = new Set([406, 408, 425, 429, 500, 502, 503, 504]);

function cacheKeyForQuery(query) {
  return query.trim();
}

/**
 * Overpass client with plugin-db persistence. fetch() is injectable for tests.
 */
function createOverpassClient(ctx, {
  overpassUrl,
  fetchFn,
  cacheTtlMs = CACHE_TTL_MS,
  staleCacheMaxAgeMs = STALE_CACHE_MAX_AGE_MS,
  attemptTimeoutsMs = ATTEMPT_TIMEOUTS_MS,
} = {}) {
  const explicitUrl = typeof overpassUrl === 'string' && overpassUrl.trim() ? overpassUrl.trim() : null;
  const endpoints = explicitUrl ? [explicitUrl] : DEFAULT_OVERPASS_URLS;
  const doFetch = fetchFn ?? globalThis.fetch;

  return {
    async fetchInterpreter(query, timeoutSeconds = 35, options = {}) {
      const cacheKey = cacheKeyForQuery(query);
      const now = Date.now();

      const rows = await ctx.db.query(
        'SELECT elements_json, fetched_at FROM overpass_cache WHERE cache_key = ?',
        [cacheKey],
      );
      const hit = rows[0];
      if (hit && now - hit.fetched_at < cacheTtlMs) {
        return { elements: JSON.parse(hit.elements_json) };
      }

      let lastError = null;
      for (let index = 0; index < endpoints.length; index += 1) {
        if (options.signal?.aborted) throw new Error('overpass_aborted');
        const endpoint = endpoints[index];
        const timeoutMs = explicitUrl
          ? Math.max(1_000, (timeoutSeconds + 1) * 1_000)
          : attemptTimeoutsMs[Math.min(index, attemptTimeoutsMs.length - 1)];
        const attempt = attemptSignal(options.signal, timeoutMs);
        try {
          const res = await doFetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`,
            signal: attempt.signal,
          });
          if (!res.ok) {
            const error = new Error(`overpass_http_${res.status}`);
            if (!RETRYABLE_HTTP.has(res.status)) {
              error.nonRetryable = true;
              throw error;
            }
            lastError = error;
            continue;
          }

          const data = await res.json();
          const elements = data.elements ?? [];
          await ctx.db.exec(
            'INSERT OR REPLACE INTO overpass_cache (cache_key, elements_json, fetched_at) VALUES (?, ?, ?)',
            [cacheKey, JSON.stringify(elements), now],
          );
          return { elements, endpoint };
        } catch (error) {
          if (options.signal?.aborted) throw new Error('overpass_aborted');
          if (error?.nonRetryable) throw error;
          lastError = attempt.timedOut()
            ? new Error(`overpass_timeout_${index + 1}`)
            : error;
        } finally {
          attempt.cleanup();
        }
      }

      if (hit && now - hit.fetched_at <= staleCacheMaxAgeMs) {
        ctx.log?.warn?.(`Overpass unavailable; using cached waterway data from ${new Date(hit.fetched_at).toISOString()}`);
        return { elements: JSON.parse(hit.elements_json), stale: true };
      }
      throw lastError || new Error('overpass_unavailable');
    },
  };
}

function attemptSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

const OVERPASS_CACHE_MIGRATION = `
CREATE TABLE IF NOT EXISTS overpass_cache (
  cache_key TEXT PRIMARY KEY,
  elements_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`.trim();

module.exports = {
  DEFAULT_OVERPASS_URL,
  DEFAULT_OVERPASS_URLS,
  CACHE_TTL_MS,
  STALE_CACHE_MAX_AGE_MS,
  OVERPASS_CACHE_MIGRATION,
  createOverpassClient,
};
