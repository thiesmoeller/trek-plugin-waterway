import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostWithDb } from './mock-db.js';
import { merzigKoblenzTrip } from './fixtures/merzig-koblenz-trip.js';

const runLive = process.env.WATERWAY_LIVE_OVERPASS === '1';

describe.skipIf(!runLive)('live Merzig to Koblenz Overpass route', () => {
  let plugin;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../server/index.js');
    plugin = mod.default ?? mod;
  });

  it('routes all ten rowing days on current Saar and Mosel OSM data', async () => {
    const { ctx } = createHostWithDb({
      config: { rowingSpeedKmh: 8, defaultLockDelayMinutes: 15 },
    });
    await plugin.onLoad(ctx);

    for (const day of merzigKoblenzTrip.days) {
      let result;
      try {
        result = await plugin.hooks.routeProvider.getRoute({
          tripId: 9002,
          dayId: day.day,
          profile: 'rowing',
          waypoints: day.stops.map(({ name, lat, lng }) => ({ name, lat, lng })),
        }, ctx);
      } catch (error) {
        throw new Error(`Merzig–Koblenz day ${day.day} failed: ${error.message}`, { cause: error });
      }

      expect(result.coordinates.length, `day ${day.day} map geometry`).toBeGreaterThanOrEqual(2);
      expect(result.legs, `day ${day.day} route legs`).toHaveLength(day.stops.length - 1);
      expect(result.duration, `day ${day.day} duration`).toBeGreaterThan(0);
    }
  }, 300_000);
});
