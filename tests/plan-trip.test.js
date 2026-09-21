import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { berlinCanalLockElements, berlinCanalRouteElements, overpassSequence } from './fixtures/waterway-fixtures.js';
import { createHostWithDb } from './mock-db.js';
import { planWaterwayDays } from '../server/waterway/plan.js';
import { haversineMeters } from '../server/waterway/geo.js';

const waypoints = [
  { name: 'Fixture Put-in', lat: 52.0, lng: 13.0 },
  { name: 'Fixture Take-out', lat: 52.0, lng: 13.2 },
];

describe('planWaterwayDays', () => {
  it('keeps a short itinerary on one day and splits on the daily kilometre cap', () => {
    const coordinates = [
      [50, 6],
      [50.2, 6],
      [50.4, 6],
      [50.6, 6],
    ];
    const totalM = haversineMeters(50, 6, 50.6, 6);
    const route = {
      coordinates,
      waypoints: [
        { name: 'Start', lat: 50, lng: 6 },
        { name: 'Finish', lat: 50.6, lng: 6 },
      ],
      legs: [{ distance: totalM }],
      planningLegs: [{ locks: [], elements: [] }],
    };

    const oneDay = planWaterwayDays(route, { maxDayKm: 80, speedKmh: 8, lockMinutes: 25 });
    expect(oneDay.complete).toBe(true);
    expect(oneDay.days).toHaveLength(1);
    expect(oneDay.days[0].to.name).toBe('Finish');

    const split = planWaterwayDays(route, { maxDayKm: 15, speedKmh: 8, lockMinutes: 25 });
    expect(split.days.length).toBeGreaterThan(1);
    expect(split.days.every((day) => day.distanceMetres <= 15_500)).toBe(true);
    expect(split.warnings.some((warning) => warning.includes('no mapped landing'))).toBe(true);
  });

  it('prefers a mapped landing near the day cap over a mid-water split', () => {
    const coordinates = Array.from({ length: 21 }, (_, i) => [52, 13 + i * 0.01]);
    const landing = { lat: 52, lng: 13.12, name: 'Overnight slipway' };
    const route = {
      coordinates,
      waypoints: [
        { name: 'Put-in', lat: 52, lng: 13 },
        { name: 'Take-out', lat: 52, lng: 13.2 },
      ],
      legs: [{ distance: haversineMeters(52, 13, 52, 13.2) }],
      planningLegs: [{
        locks: [],
        elements: [{
          type: 'node',
          id: 1,
          lat: landing.lat,
          lon: landing.lng,
          tags: { waterway: 'access_point', canoe: 'yes', name: landing.name },
        }],
      }],
    };

    const plan = planWaterwayDays(route, { maxDayKm: 10, speedKmh: 8, lockMinutes: 25 });
    expect(plan.days.length).toBeGreaterThan(1);
    expect(plan.days[0].to.name).toBe('Overnight slipway');
    expect(plan.days[0].to.kind).toBe('landing');
  });

  it('shortens days when lock delays would exceed the time cap and stops after 30 days', () => {
    const coordinates = [[50, 6], [58, 6]];
    const route = {
      coordinates,
      waypoints: [
        { name: 'South', lat: 50, lng: 6 },
        { name: 'North', lat: 58, lng: 6 },
      ],
      legs: [{ distance: haversineMeters(50, 6, 58, 6) }],
      planningLegs: [{
        locks: [{ name: 'Lock A', lat: 50.2, lng: 6, chainageM: 20_000 }],
        elements: [],
      }],
    };

    const timed = planWaterwayDays(route, { maxDayKm: 80, maxDayMinutes: 90, speedKmh: 8, lockMinutes: 40 });
    expect(timed.days.length).toBeGreaterThan(1);
    expect(timed.days.every((day) => day.durationSeconds <= 90 * 60 + 5)).toBe(true);

    const capped = planWaterwayDays(route, { maxDayKm: 5, speedKmh: 8, lockMinutes: 25 });
    expect(capped.days).toHaveLength(30);
    expect(capped.complete).toBe(false);
    expect(capped.warnings.at(-1)).toContain('Stopped after 30 days');
  });

  it('returns a stable empty plan when the route has no geometry', () => {
    expect(planWaterwayDays({ coordinates: [], waypoints: [] })).toMatchObject({
      complete: false,
      days: [],
      warnings: ['no_route_geometry'],
    });
  });

  it('keeps lock opening hours on the day that contains the lock', () => {
    const coordinates = [[52, 13], [52, 13.2]];
    const route = {
      coordinates,
      waypoints: [{ name: 'A', lat: 52, lng: 13 }, { name: 'B', lat: 52, lng: 13.2 }],
      legs: [{ distance: haversineMeters(52, 13, 52, 13.2) }],
      planningLegs: [{
        locks: [{
          name: 'Hours lock',
          lat: 52,
          lng: 13.05,
          chainageM: 2000,
          tags: { opening_hours: 'Mo-Fr 08:00-16:00' },
        }],
        elements: [],
      }],
    };
    const plan = planWaterwayDays(route, { maxDayKm: 80, speedKmh: 8, lockMinutes: 25 });
    expect(plan.days[0].locks[0]).toMatchObject({
      name: 'Hours lock',
      openingHours: 'Mo-Fr 08:00-16:00',
    });
  });
});

describe('waterway MCP plan_trip tool', () => {
  let plugin;
  let ctx;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.fetch = vi.fn(overpassSequence(berlinCanalRouteElements, berlinCanalLockElements));
    const mod = await import('../server/index.js');
    plugin = mod.default ?? mod;
    ({ ctx } = createHostWithDb({
      config: { rowingSpeedKmh: 8, maxDayKm: 25 },
    }));
    await plugin.onLoad(ctx);
  });

  afterEach(async () => {
    await plugin.onUnload();
    vi.unstubAllGlobals();
  });

  it('returns a TREK 4.3-style whole-trip day layout without writing the trip', async () => {
    const result = await plugin.hooks.mcpToolProvider.callTool({
      name: 'plan_trip',
      args: { profile: 'rowing', waypoints, includeGeometry: true },
    }, ctx);

    expect(result).toMatchObject({
      profile: 'rowing',
      complete: true,
      settings: { maxDayKm: 25 },
      estimate: { dayCount: 1, distanceKm: expect.any(Number) },
      days: [{
        dayNumber: 1,
        from: expect.objectContaining({ name: 'Fixture Put-in' }),
        to: expect.objectContaining({ name: 'Fixture Take-out' }),
        lockCount: 2,
      }],
      howToSave: expect.stringContaining('plugin:waterway/'),
    });
    expect(result.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(result.days[0].locks.map((lock) => lock.name)).toEqual([
      'Fixture Lock West',
      'Fixture Lock East',
    ]);
  });

  it('uses a per-call day cap and the instance default when the cap is omitted', async () => {
    const tight = await plugin.hooks.mcpToolProvider.callTool({
      name: 'plan_trip',
      args: { profile: 'rowing', waypoints, maxDayKm: 8 },
    }, ctx);
    expect(tight.days.length).toBeGreaterThan(1);
    expect(tight.settings.maxDayKm).toBe(8);
    expect(tight.days[0].to.name).toBe('Fixture Mid Landing');

    const fromConfig = await plugin.hooks.mcpToolProvider.callTool({
      name: 'plan_trip',
      args: { profile: 'rowing', waypoints },
    }, ctx);
    expect(fromConfig.settings.maxDayKm).toBe(25);
    expect(fromConfig.days).toHaveLength(1);
  });

  it('refuses plan_trip before onLoad', async () => {
    await plugin.onUnload();
    await expect(plugin.hooks.mcpToolProvider.callTool({
      name: 'plan_trip',
      args: { profile: 'rowing', waypoints },
    })).rejects.toThrow('plugin_not_loaded');
  });
});
