'use strict';

const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_MS = 45 * 60 * 1000;

function cacheKeyForQuery(query) {
  return query.trim();
}

/**
 * Overpass client with plugin-db persistence. fetch() is injectable for tests.
 */
function createOverpassClient(ctx, { overpassUrl, fetchFn, cacheTtlMs = CACHE_TTL_MS } = {}) {
  const baseUrl = typeof overpassUrl === 'string' && overpassUrl ? overpassUrl : DEFAULT_OVERPASS_URL;
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

      const res = await doFetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: options.signal,
      });
      if (!res.ok) throw new Error(`overpass_http_${res.status}`);

      const data = await res.json();
      const elements = data.elements ?? [];
      await ctx.db.exec(
        'INSERT OR REPLACE INTO overpass_cache (cache_key, elements_json, fetched_at) VALUES (?, ?, ?)',
        [cacheKey, JSON.stringify(elements), now],
      );
      return { elements };
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
  CACHE_TTL_MS,
  OVERPASS_CACHE_MIGRATION,
  createOverpassClient,
};
