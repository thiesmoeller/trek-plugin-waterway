import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createHostWithDb } from './mock-db.js';

const runLive = process.env.WATERWAY_LIVE_OVERPASS === '1';

describe.skipIf(!runLive)('live Overpass smoke test', () => {
  let plugin;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../server/index.js');
    plugin = mod.default ?? mod;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes a short real-world Berlin Spree waterway leg', async () => {
    const { ctx } = createHostWithDb({
      config: { speedKmh: 6, defaultLockDelayMinutes: 15 },
    });
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute({
      profile: 'waterway',
      tripId: 9001,
      dayId: 1,
      waypoints: [
        { lat: 52.5197, lng: 13.3993 },
        { lat: 52.5221, lng: 13.4114 },
      ],
    });

    expect(result.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(result.distance).toBeGreaterThan(500);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.legs).toHaveLength(1);
  }, 30_000);
});
