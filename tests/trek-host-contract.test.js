import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
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

function activePluginFeedEntry(manifest) {
  return {
    id: manifest.id,
    name: manifest.name,
    type: manifest.type,
    routeProfiles: manifest.capabilities.routeProfiles,
  };
}

describe('TREK host route-provider contract', () => {
  let plugin;
  let fetchMock;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock = vi.fn(overpassSequence(berlinCanalRouteElements, berlinCanalLockElements));
    globalThis.fetch = fetchMock;
    const mod = await import('../server/index.js');
    plugin = mod.default ?? mod;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('can be discovered, enabled, and invoked as a TREK 4 route provider without live network', async () => {
    const validation = validateManifest(manifest);
    expect(validation.ok).toBe(true);

    const feedEntry = activePluginFeedEntry(manifest);
    expect(feedEntry).toMatchObject({
      id: 'waterway',
      type: 'integration',
      routeProfiles: [
        { id: 'canoe', label: 'Canoe' },
        { id: 'kayak', label: 'Kayak' },
        { id: 'rowing', label: 'Rowing' },
      ],
    });

    const { ctx } = createHostWithDb({
      config: { speedKmh: 5, defaultLockDelayMinutes: 10 },
    });
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute(routeRequest({ profile: 'canoe' }));

    expect(fetchMock).toHaveBeenCalled();
    expect(result).toMatchObject({
      coordinates: expect.any(Array),
      distance: expect.any(Number),
      duration: expect.any(Number),
      legs: expect.any(Array),
      viaPoints: expect.any(Array),
    });
    expect(result.legs).toHaveLength(2);
    expect(result.viaPoints).toHaveLength(2);
    expect(result.viaPoints.map((point) => point.label)).toEqual([
      'Fixture Lock West',
      'Fixture Lock East',
    ]);
    expect(result.duration).toBeGreaterThan(result.distance / ((5 * 1000) / 3600));
    for (const coord of result.coordinates) {
      expect(coord).toEqual([expect.any(Number), expect.any(Number)]);
    }
    for (const leg of result.legs) {
      expect(leg.distance).toBeGreaterThan(0);
      expect(leg.duration).toBeGreaterThan(0);
    }
  });

  it.each(['canoe', 'kayak', 'rowing'])('routes the advertised %s profile', async (profile) => {
    const { ctx } = createHostWithDb();
    await plugin.onLoad(ctx);

    const result = await plugin.hooks.routeProvider.getRoute(routeRequest({ profile }));

    expect(result.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(result.legs).toHaveLength(2);
  });
});
