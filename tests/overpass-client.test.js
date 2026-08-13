import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OVERPASS_URL,
  createOverpassClient,
} from '../server/overpass.js';
import { createHostWithDb } from './mock-db.js';

describe('Overpass client', () => {
  it('posts encoded interpreter queries to the default Overpass endpoint', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ elements: [{ type: 'node', id: 1, lat: 52, lon: 13 }] }),
    }));
    const { ctx } = createHostWithDb();
    const client = createOverpassClient(ctx, { fetchFn });

    const result = await client.fetchInterpreter('node["waterway"="lock_gate"]; out;', 25);

    expect(result.elements).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledWith(
      DEFAULT_OVERPASS_URL,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: expect.stringContaining('data=node%5B%22waterway%22%3D%22lock_gate%22%5D'),
      }),
    );
  });

  it('returns fresh plugin-db cache hits without contacting Overpass', async () => {
    const { ctx, cacheRows } = createHostWithDb();
    const query = 'way["waterway"="river"]; out;';
    cacheRows.set(query, {
      elements_json: JSON.stringify([{ type: 'node', id: 2, lat: 52, lon: 13 }]),
      fetched_at: Date.now(),
    });
    const fetchFn = vi.fn();
    const client = createOverpassClient(ctx, { fetchFn });

    const result = await client.fetchInterpreter(query);

    expect(result.elements).toEqual([{ type: 'node', id: 2, lat: 52, lon: 13 }]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refreshes stale plugin-db cache rows and stores the new response', async () => {
    const { ctx, cacheRows } = createHostWithDb();
    const query = 'way["waterway"="canal"]; out;';
    cacheRows.set(query, {
      elements_json: JSON.stringify([{ type: 'node', id: 1, lat: 52, lon: 13 }]),
      fetched_at: Date.now() - 10_000,
    });
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ elements: [{ type: 'node', id: 3, lat: 52.1, lon: 13.1 }] }),
    }));
    const client = createOverpassClient(ctx, { fetchFn, cacheTtlMs: 1 });

    const result = await client.fetchInterpreter(query);

    expect(result.elements).toEqual([{ type: 'node', id: 3, lat: 52.1, lon: 13.1 }]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(cacheRows.get(query).elements_json)).toEqual(result.elements);
  });

  it('throws a stable error code when Overpass returns a non-2xx response', async () => {
    const { ctx } = createHostWithDb();
    const client = createOverpassClient(ctx, {
      fetchFn: vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })),
    });

    await expect(client.fetchInterpreter('out;')).rejects.toThrow('overpass_http_429');
  });
});
