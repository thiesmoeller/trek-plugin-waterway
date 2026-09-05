import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OVERPASS_URL,
  DEFAULT_OVERPASS_URLS,
  createOverpassClient,
} from '../server/overpass.js';
import { createHostWithDb } from './mock-db.js';

describe('Overpass client', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('fails over to the next declared endpoint after a retryable response', async () => {
    const { ctx } = createHostWithDb();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ elements: [{ type: 'node', id: 7 }] }),
      });
    const client = createOverpassClient(ctx, { fetchFn });

    const result = await client.fetchInterpreter('out;');

    expect(result).toMatchObject({ elements: [{ type: 'node', id: 7 }], endpoint: DEFAULT_OVERPASS_URLS[1] });
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual(DEFAULT_OVERPASS_URLS.slice(0, 2));
  });

  it('moves on when one endpoint exceeds its attempt budget', async () => {
    vi.useFakeTimers();
    const { ctx } = createHostWithDb();
    const fetchFn = vi.fn()
      .mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ elements: [{ type: 'node', id: 8 }] }),
      });
    const client = createOverpassClient(ctx, { fetchFn, attemptTimeoutsMs: [10, 10, 10] });

    const pending = client.fetchInterpreter('out;');
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toMatchObject({
      elements: [{ type: 'node', id: 8 }],
      endpoint: DEFAULT_OVERPASS_URLS[1],
    });
  });

  it('serves a recent stale cache entry with a visible warning when all endpoints fail', async () => {
    const { ctx, logs, cacheRows } = createHostWithDb();
    const query = 'way["waterway"="river"]; out;';
    cacheRows.set(query, {
      elements_json: JSON.stringify([{ type: 'way', id: 9 }]),
      fetched_at: Date.now() - 60_000,
    });
    const client = createOverpassClient(ctx, {
      cacheTtlMs: 1,
      fetchFn: vi.fn(async () => ({ ok: false, status: 503 })),
    });

    const result = await client.fetchInterpreter(query);

    expect(result).toEqual({ elements: [{ type: 'way', id: 9 }], stale: true });
    expect(logs).toContainEqual(expect.objectContaining({
      level: 'warn',
      msg: expect.stringContaining('using cached waterway data'),
    }));
  });

  it('does not use cache data beyond the stale safety window', async () => {
    const { ctx, cacheRows } = createHostWithDb();
    const query = 'way["waterway"="river"]; out;';
    cacheRows.set(query, {
      elements_json: JSON.stringify([{ type: 'way', id: 10 }]),
      fetched_at: Date.now() - 10_000,
    });
    const client = createOverpassClient(ctx, {
      cacheTtlMs: 1,
      staleCacheMaxAgeMs: 100,
      fetchFn: vi.fn(async () => ({ ok: false, status: 503 })),
    });

    await expect(client.fetchInterpreter(query)).rejects.toThrow('overpass_http_503');
  });

  it('uses only an explicitly configured endpoint', async () => {
    const { ctx } = createHostWithDb();
    const fetchFn = vi.fn(async () => ({ ok: false, status: 429 }));
    const client = createOverpassClient(ctx, {
      overpassUrl: 'https://overpass.example/api/interpreter',
      fetchFn,
    });

    await expect(client.fetchInterpreter('out;', 1)).rejects.toThrow('overpass_http_429');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe('https://overpass.example/api/interpreter');
  });
});
