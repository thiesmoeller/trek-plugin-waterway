import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostWithDb } from './mock-db.js';
import { merzigKoblenzTrip } from './fixtures/merzig-koblenz-trip.js';

function syntheticWaterway(stops) {
  return [
    ...stops.map((stop, index) => ({
      type: 'node',
      id: index + 1,
      lat: stop.lat,
      lon: stop.lng,
      tags: { waterway: 'access_point', rowing: 'yes', name: stop.name },
    })),
    {
      type: 'way',
      id: 10_000,
      nodes: stops.map((_, index) => index + 1),
      tags: { waterway: 'river', rowing: 'yes', name: 'Saar–Mosel fixture waterway' },
    },
  ];
}

describe('Merzig to Koblenz rowing-plan fixture', () => {
  let plugin;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../server/index.js');
    plugin = mod.default ?? mod;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('covers the complete downstream chainage in ten approximately 25 km days', () => {
    const total = merzigKoblenzTrip.days.reduce((sum, day) => sum + day.distanceKm, 0);
    expect(total).toBeCloseTo(merzigKoblenzTrip.approximateDistanceKm, 5);
    expect(merzigKoblenzTrip.days).toHaveLength(10);

    // 25–30 km cannot be exact when useful landings and rowing clubs are the
    // constraints. All days stay within 20–33 km except the explicitly documented
    // short Saarburg→Trier club hop.
    for (const day of merzigKoblenzTrip.days) {
      if (day.day === 2) {
        expect(day.distanceKm).toBeCloseTo(18.4, 5);
        expect(day.note).toContain('Short club-to-club');
      } else {
        expect(day.distanceKm).toBeGreaterThanOrEqual(20);
        expect(day.distanceKm).toBeLessThanOrEqual(33);
      }
    }
  });

  it('links every overnight stop and visits documented rowing clubs along the route', () => {
    for (let i = 1; i < merzigKoblenzTrip.days.length; i++) {
      expect(merzigKoblenzTrip.days[i].stops[0].name)
        .toBe(merzigKoblenzTrip.days[i - 1].stops.at(-1).name);
    }

    const clubs = merzigKoblenzTrip.days
      .flatMap((day) => day.stops)
      .filter((stop) => stop.kind === 'rowing-club');
    expect(new Set(clubs.map((stop) => stop.name))).toEqual(new Set([
      'Bootshaus Saarschleife · Ruderbund Saar',
      'Saarburger Ruder-Club',
      'Ruder- und Kanuverein Konz',
      'Ruderverein Treviris Trier',
      'Bernkasteler Ruderverein',
      'Rudergesellschaft Zeltingen',
      'Ruder-Club Traben-Trarbach',
      'Ruderverein Zell',
      'Cochemer Rudergesellschaft',
      'Rudergesellschaft Treis-Karden',
      'Koblenzer Ruderclub Rhenania',
    ]));
    expect(clubs.every((stop) => stop.contactRequired)).toBe(true);
  });

  it('routes every day through the TREK 4.2 rowing profile contract', async () => {
    for (const day of merzigKoblenzTrip.days) {
      const elements = syntheticWaterway(day.stops);
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ elements }),
      }));
      const { ctx } = createHostWithDb({ config: { rowingSpeedKmh: 8 } });
      await plugin.onLoad(ctx);

      const result = await plugin.hooks.routeProvider.getRoute({
        tripId: 9002,
        dayId: day.day,
        profile: merzigKoblenzTrip.profile,
        waypoints: day.stops.map(({ name, lat, lng }) => ({ name, lat, lng })),
      }, ctx);

      expect(result.coordinates.length).toBeGreaterThanOrEqual(2);
      expect(result.distance).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.legs).toHaveLength(day.stops.length - 1);
      expect(result.viaPoints.filter((point) => point.tone === 'success'))
        .toHaveLength(day.stops.length - 1);
    }
  });
});
