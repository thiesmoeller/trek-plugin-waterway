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

const LOCK_ELEMENTS = [
  {
    type: 'node',
    id: 99,
    lat: 52.0,
    lon: 13.1,
    tags: { waterway: 'lock_gate', name: 'Test Lock' },
  },
];

const routeReq = {
  profile: 'waterway',
  tripId: 1,
  dayId: 2,
  waypoints: [
    { lat: 52.0, lng: 13.0 },
    { lat: 52.0, lng: 13.2 },
  ],
};

function mockOverpass(routeElements = MOCK_ELEMENTS, lockElements = []) {
  let calls = 0;
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ elements: calls++ % 2 === 0 ? routeElements : lockElements }),
  }));
}

describe('trek-plugin-waterway manifest', () => {
  it('validates against SDK rules including routeProfiles', () => {
    const result = validateManifest(manifest);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(manifest.capabilities.routeProfiles[0]).toMatchObject({
      id: 'waterway',
      label: 'Waterway',
    });
  });
});

describe('routeProvider hook', () => {
  let plugin;
  let fetchMock;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock = mockOverpass();
    globalThis.fetch = fetchMock;
    const mod = await import('../server/index.js');
    plugin = mod.default ?? mod;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a whole route with coordinates, distance, duration, and legs', async () => {
    const { ctx } = createHostWithDb();
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute(routeReq);
    expect(result.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(result.distance).toBeGreaterThan(10_000);
    expect(result.duration).toBeCloseTo(result.distance / ((6 * 1000) / 3600), 1);
    expect(result.legs).toHaveLength(routeReq.waypoints.length - 1);
    expect(result.legs[0].distance).toBe(result.distance);
  });

  it('adds detected lock delay and exposes locks as route via points', async () => {
    fetchMock = mockOverpass(MOCK_ELEMENTS, LOCK_ELEMENTS);
    globalThis.fetch = fetchMock;
    const { ctx } = createHostWithDb({ config: { speedKmh: 6, defaultLockDelayMinutes: 12 } });
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute(routeReq);
    const baseDuration = result.distance / ((6 * 1000) / 3600);
    expect(result.duration).toBeCloseTo(baseDuration + 12 * 60, 1);
    expect(result.legs[0].note).toContain('1 lock');
    expect(result.viaPoints[0]).toMatchObject({
      lat: 52.0,
      lng: 13.1,
      label: 'Test Lock',
      dwellSeconds: 12 * 60,
    });
  });

  it('uses configurable overpassUrl from ctx.config', async () => {
    const mirror = 'https://overpass.internal/api/interpreter';
    const { ctx } = createHostWithDb({ config: { overpassUrl: mirror } });
    await plugin.onLoad(ctx);

    await plugin.hooks.routeProvider.getRoute(routeReq);
    expect(fetchMock).toHaveBeenCalledWith(mirror, expect.any(Object));
  });

  it('caches Overpass responses in plugin db and skips repeat fetches', async () => {
    const { ctx, cacheRows } = createHostWithDb();
    await plugin.onLoad(ctx);

    await plugin.hooks.routeProvider.getRoute(routeReq);
    await plugin.hooks.routeProvider.getRoute({ ...routeReq, dayId: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cacheRows.size).toBe(2);
  });

  it('runs db migration on load', async () => {
    const { ctx, migrations } = createHostWithDb();
    await plugin.onLoad(ctx);
    expect(migrations.some((m) => m.id === '001_overpass_cache')).toBe(true);
  });
});
