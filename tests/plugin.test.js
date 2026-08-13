import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateManifest } from 'trek-plugin-sdk';
import { createHostWithDb } from './mock-db.js';
import {
  berlinCanalLockElements,
  berlinCanalRouteElements,
  overpassSequence,
  routeRequest,
} from './fixtures/waterway-fixtures.js';

const manifest = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '..', 'trek-plugin.json'), 'utf8'),
);

function mockOverpass(routeElements = MOCK_ELEMENTS, lockElements = []) {
  return vi.fn(overpassSequence(routeElements, lockElements));
}

const MOCK_ELEMENTS = berlinCanalRouteElements;
const LOCK_ELEMENTS = berlinCanalLockElements.slice(0, 1);
const routeReq = routeRequest({
  tripId: 1,
  dayId: 2,
  waypoints: [
    { lat: 52.0, lng: 13.0 },
    { lat: 52.0, lng: 13.2 },
  ],
});

describe('trek-plugin-waterway manifest', () => {
  it('validates against SDK rules including routeProfiles', () => {
    const result = validateManifest(manifest);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(manifest.trek).toBe('>=4.0.0 <5.0.0');
    expect(manifest.capabilities.routeProfiles).toEqual([
      { id: 'canoe', label: 'Canoe' },
      { id: 'kayak', label: 'Kayak' },
      { id: 'rowing', label: 'Rowing' },
    ]);
  });

  it('targets TREK 4.x hosts and does not claim compatibility with old stable or TREK 5', () => {
    expect(manifest.trek).toMatch(/^>=4\.0\.0\s+<5\.0\.0$/);
    expect(manifest.trek).not.toContain('3.');
    expect(manifest.trek).not.toContain('>=5');
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
    expect(result.duration).toBeCloseTo(result.distance / ((5 * 1000) / 3600), 1);
    expect(result.legs).toHaveLength(routeReq.waypoints.length - 1);
    expect(result.legs[0].distance).toBe(result.distance);
  });

  it('returns the TREK route shape used by the map overlay and sidebar', async () => {
    fetchMock = mockOverpass(MOCK_ELEMENTS, LOCK_ELEMENTS);
    globalThis.fetch = fetchMock;
    const { ctx } = createHostWithDb({ config: { canoeSpeedKmh: 6, defaultLockDelayMinutes: 12 } });
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute(routeReq);

    expect(result).toEqual({
      coordinates: expect.any(Array),
      distance: expect.any(Number),
      duration: expect.any(Number),
      legs: [
        {
          distance: expect.any(Number),
          duration: expect.any(Number),
          note: expect.any(String),
        },
      ],
      viaPoints: [
        {
          lat: expect.any(Number),
          lng: expect.any(Number),
          label: expect.any(String),
          dwellSeconds: expect.any(Number),
        },
      ],
    });
    for (const coord of result.coordinates) {
      expect(coord).toHaveLength(2);
      expect(coord[0]).toBeGreaterThanOrEqual(-90);
      expect(coord[0]).toBeLessThanOrEqual(90);
      expect(coord[1]).toBeGreaterThanOrEqual(-180);
      expect(coord[1]).toBeLessThanOrEqual(180);
    }
  });

  it('aggregates a multi-stop day into one route without duplicating connector coordinates', async () => {
    const { ctx } = createHostWithDb();
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute({
      ...routeReq,
      waypoints: [
        { lat: 52.0, lng: 13.0 },
        { lat: 52.0, lng: 13.1 },
        { lat: 52.0, lng: 13.2 },
      ],
    });

    expect(result.legs).toHaveLength(2);
    expect(result.distance).toBeCloseTo(result.legs[0].distance + result.legs[1].distance, 1);
    expect(result.duration).toBeCloseTo(result.legs[0].duration + result.legs[1].duration, 1);
    for (let i = 1; i < result.coordinates.length; i++) {
      expect(result.coordinates[i]).not.toEqual(result.coordinates[i - 1]);
    }
  });

  it('adds detected lock delay and exposes locks as route via points', async () => {
    fetchMock = mockOverpass(MOCK_ELEMENTS, LOCK_ELEMENTS);
    globalThis.fetch = fetchMock;
    const { ctx } = createHostWithDb({ config: { canoeSpeedKmh: 6, defaultLockDelayMinutes: 12 } });
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute(routeReq);
    const baseDuration = result.distance / ((6 * 1000) / 3600);
    expect(result.duration).toBeCloseTo(baseDuration + 12 * 60, 1);
    expect(result.legs[0].note).toContain('1 lock');
    expect(result.viaPoints[0]).toMatchObject({
      lat: 52.0,
      lng: 13.05,
      label: 'Fixture Lock West',
      dwellSeconds: 12 * 60,
    });
  });

  it('adds multiple lock delays and exposes each lock as a route via point', async () => {
    fetchMock = mockOverpass(MOCK_ELEMENTS, berlinCanalLockElements);
    globalThis.fetch = fetchMock;
    const { ctx } = createHostWithDb({ config: { canoeSpeedKmh: 6, defaultLockDelayMinutes: 10 } });
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute(routeReq);
    const baseDuration = result.distance / ((6 * 1000) / 3600);

    expect(result.duration).toBeCloseTo(baseDuration + 2 * 10 * 60, 1);
    expect(result.legs[0].note).toContain('2 locks');
    expect(result.viaPoints).toHaveLength(2);
    expect(result.viaPoints.map((point) => point.label)).toEqual([
      'Fixture Lock West',
      'Fixture Lock East',
    ]);
    expect(result.viaPoints.map((point) => point.dwellSeconds)).toEqual([600, 600]);
  });

  it('uses profile-specific speeds', async () => {
    const { ctx } = createHostWithDb({ config: { canoeSpeedKmh: 4, kayakSpeedKmh: 7, rowingSpeedKmh: 9 } });
    await plugin.onLoad(ctx);

    const kayak = await plugin.hooks.routeProvider.getRoute({ ...routeReq, profile: 'kayak' });
    const rowing = await plugin.hooks.routeProvider.getRoute({ ...routeReq, profile: 'rowing' });

    expect(kayak.duration).toBeCloseTo(kayak.distance / ((7 * 1000) / 3600), 1);
    expect(rowing.duration).toBeCloseTo(rowing.distance / ((9 * 1000) / 3600), 1);
  });

  it('keeps legacy waterway profile requests working as canoe routes', async () => {
    const { ctx } = createHostWithDb({ config: { canoeSpeedKmh: 4, kayakSpeedKmh: 9 } });
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute({ ...routeReq, profile: 'waterway' });

    expect(result.distance).toBeGreaterThan(10_000);
    expect(result.duration).toBeCloseTo(result.distance / ((4 * 1000) / 3600), 1);
  });

  it('surfaces route access warnings in leg notes', async () => {
    const routeWithoutAccessPoints = MOCK_ELEMENTS.filter((el) => ![20, 21].includes(el.id));
    fetchMock = mockOverpass(routeWithoutAccessPoints, []);
    globalThis.fetch = fetchMock;
    const { ctx } = createHostWithDb();
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute(routeReq);

    expect(result.legs[0].note).toContain('No mapped put-in nearby');
    expect(result.legs[0].note).toContain('No mapped take-out nearby');
  });

  it('uses configurable overpassUrl from ctx.config', async () => {
    const mirror = 'https://overpass.internal/api/interpreter';
    const { ctx } = createHostWithDb({ config: { overpassUrl: mirror } });
    await plugin.onLoad(ctx);

    await plugin.hooks.routeProvider.getRoute(routeReq);
    expect(fetchMock).toHaveBeenCalledWith(mirror, expect.any(Object));
  });

  it('keeps the route usable when lock context lookup fails', async () => {
    let calls = 0;
    fetchMock = vi.fn(async () => {
      if (calls++ === 0) {
        return { ok: true, json: async () => ({ elements: MOCK_ELEMENTS }) };
      }
      return { ok: false, status: 500, json: async () => ({ elements: [] }) };
    });
    globalThis.fetch = fetchMock;
    const { ctx } = createHostWithDb();
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute(routeReq);

    expect(result.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(result.viaPoints).toBeUndefined();
    expect(result.legs[0].note).toBeUndefined();
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

  it('rejects unsupported route profiles before contacting Overpass', async () => {
    const { ctx } = createHostWithDb();
    await plugin.onLoad(ctx);

    await expect(plugin.hooks.routeProvider.getRoute({ ...routeReq, profile: 'driving' }))
      .rejects.toThrow('unsupported_route_profile');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects single-point requests before contacting Overpass', async () => {
    const { ctx } = createHostWithDb();
    await plugin.onLoad(ctx);

    await expect(plugin.hooks.routeProvider.getRoute({ ...routeReq, waypoints: [routeReq.waypoints[0]] }))
      .rejects.toThrow('waterway_requires_two_waypoints');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails clearly when TREK calls the hook before onLoad', async () => {
    await expect(plugin.hooks.routeProvider.getRoute(routeReq)).rejects.toThrow('plugin_not_loaded');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
