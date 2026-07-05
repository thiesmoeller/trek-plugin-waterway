import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateManifest } from 'trek-plugin-sdk';
import { createHostWithDb } from './mock-db.js';

const manifest = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '..', 'trek-plugin.json'), 'utf8'),
);

const MOCK_ELEMENTS = [
  { type: 'node', id: 1, lat: 52.0, lon: 13.0 },
  { type: 'node', id: 2, lat: 52.0, lon: 13.1 },
  { type: 'node', id: 3, lat: 52.0, lon: 13.2 },
  { type: 'way', id: 10, nodes: [1, 2, 3], tags: { waterway: 'river' } },
];

const legReq = {
  mode: 'waterway',
  from: { lat: 52.0, lng: 13.0 },
  to: { lat: 52.0, lng: 13.2 },
  legKey: 'test-leg',
  tripId: 1,
  modeOptions: { speedKmh: 6 },
};

describe('trek-plugin-waterway manifest', () => {
  it('validates against SDK rules including routeModes', () => {
    const result = validateManifest(manifest);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(manifest.capabilities.routeModes[0]).toMatchObject({
      mode: 'waterway',
      allowsOptimize: false,
    });
  });
});

describe('routeProvider hook', () => {
  let plugin;
  let fetchMock;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ elements: MOCK_ELEMENTS }),
    }));
    globalThis.fetch = fetchMock;
    const mod = await import('../server/index.js');
    plugin = mod.default ?? mod;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes waterway mode', () => {
    expect(plugin.hooks.routeProvider.modes()).toEqual(['waterway']);
  });

  it('returns coords, distanceM, and durationS from speedKmh', async () => {
    const { ctx } = createHostWithDb();
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.routeLeg(legReq);
    expect(result.coords.length).toBeGreaterThanOrEqual(2);
    expect(result.distanceM).toBeGreaterThan(10_000);
    expect(result.durationS).toBeCloseTo(result.distanceM / ((6 * 1000) / 3600), 1);
  });

  it('uses configurable overpassUrl from ctx.config', async () => {
    const mirror = 'https://overpass.internal/api/interpreter';
    const { ctx } = createHostWithDb({ config: { overpassUrl: mirror } });
    await plugin.onLoad(ctx);

    await plugin.hooks.routeProvider.routeLeg(legReq);
    expect(fetchMock).toHaveBeenCalledWith(mirror, expect.any(Object));
  });

  it('caches Overpass responses in plugin db and skips repeat fetches', async () => {
    const { ctx, cacheRows } = createHostWithDb();
    await plugin.onLoad(ctx);

    await plugin.hooks.routeProvider.routeLeg(legReq);
    await plugin.hooks.routeProvider.routeLeg({ ...legReq, legKey: 'other-leg' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cacheRows.size).toBe(1);
  });

  it('runs db migration on load', async () => {
    const { ctx, migrations } = createHostWithDb();
    await plugin.onLoad(ctx);
    expect(migrations.some((m) => m.id === '001_overpass_cache')).toBe(true);
  });
});
