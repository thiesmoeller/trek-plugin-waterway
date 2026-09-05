import { describe, expect, it, vi } from 'vitest';
import { routeWaterwayLeg } from '../server/waterway/routing.js';
import {
  extractLocksFromOsmElements,
  fetchLocksForRoute,
  projectPointToPolyline,
  routeLengthM,
} from '../server/waterway/context.js';

describe('waterway routing engine', () => {
  it('routes a mocked Overpass waterway graph', async () => {
    const elements = [
      { type: 'node', id: 1, lat: 52.0, lon: 13.0 },
      { type: 'node', id: 2, lat: 52.0, lon: 13.1 },
      { type: 'node', id: 3, lat: 52.0, lon: 13.2 },
      { type: 'way', id: 10, nodes: [1, 2, 3], tags: { waterway: 'river' } },
    ];
    const result = await routeWaterwayLeg(
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0, lng: 13.2 },
      { overpassClient: { fetchInterpreter: async () => ({ elements }) }, legKey: 'test' },
    );
    expect(result.coords.length).toBeGreaterThanOrEqual(2);
    expect(result.distanceM).toBeGreaterThan(10_000);
  });

  it('returns overlay geometry along the valid waterway path instead of an invalid shortcut', async () => {
    const elements = [
      { type: 'node', id: 1, lat: 52.0, lon: 13.0 },
      { type: 'node', id: 2, lat: 52.0, lon: 13.05 },
      { type: 'node', id: 3, lat: 52.0, lon: 13.1 },
      { type: 'node', id: 4, lat: 52.0, lon: 13.15 },
      { type: 'node', id: 5, lat: 52.0, lon: 13.2 },
      { type: 'way', id: 10, nodes: [1, 2, 3], tags: { waterway: 'canal' } },
      { type: 'way', id: 11, nodes: [3, 4, 5], tags: { waterway: 'river' } },
      { type: 'way', id: 12, nodes: [1, 5], tags: { waterway: 'stream' } },
    ];

    const result = await routeWaterwayLeg(
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0, lng: 13.2 },
      { overpassClient: { fetchInterpreter: async () => ({ elements }) }, legKey: 'overlay-path' },
    );

    expect(result.coords).toEqual([
      [52.0, 13.0],
      [52.0, 13.05],
      [52.0, 13.1],
      [52.0, 13.15],
      [52.0, 13.2],
    ]);
    expect(result.distanceM).toBeCloseTo(13_693, -1);
  });

  it('passes AbortSignal to the Overpass client', async () => {
    const controller = new AbortController();
    const fetchInterpreter = vi.fn(async () => ({
      elements: [
        { type: 'node', id: 1, lat: 52.0, lon: 13.0 },
        { type: 'node', id: 2, lat: 52.0, lon: 13.1 },
        { type: 'way', id: 10, nodes: [1, 2], tags: { waterway: 'canal' } },
      ],
    }));

    await routeWaterwayLeg(
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0, lng: 13.1 },
      { overpassClient: { fetchInterpreter }, legKey: 'signal-test', signal: controller.signal },
    );

    expect(fetchInterpreter).toHaveBeenCalledWith(
      expect.any(String),
      12,
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(fetchInterpreter.mock.calls[0][0]).toContain('lock_gate');
  });

  it('trims caller-provided route caches to their configured maximum', async () => {
    const elements = [
      { type: 'node', id: 1, lat: 52, lon: 13 },
      { type: 'node', id: 2, lat: 52, lon: 13.1 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { waterway: 'river' } },
    ];
    const cache = new Map();
    const overpassClient = { fetchInterpreter: vi.fn(async () => ({ elements })) };

    await routeWaterwayLeg(
      { lat: 52, lng: 13 },
      { lat: 52, lng: 13.1 },
      { overpassClient, legKey: 'cache-a', cache, cacheMax: 1, cacheTtlMs: 60_000 },
    );
    await routeWaterwayLeg(
      { lat: 52, lng: 13 },
      { lat: 52, lng: 13.1 },
      { overpassClient, legKey: 'cache-b', cache, cacheMax: 1, cacheTtlMs: 60_000 },
    );

    expect(cache).toHaveLength(1);
    expect(overpassClient.fetchInterpreter).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized requests, empty responses, and points too far from mapped water', async () => {
    const fetchInterpreter = vi.fn(async () => ({ elements: [] }));
    await expect(routeWaterwayLeg(
      { lat: 0, lng: 0 },
      { lat: 3, lng: 0 },
      { overpassClient: { fetchInterpreter }, legKey: 'oversized' },
    )).rejects.toThrow('waterway_bbox_too_large');
    expect(fetchInterpreter).not.toHaveBeenCalled();

    await expect(routeWaterwayLeg(
      { lat: 52, lng: 13 },
      { lat: 52, lng: 13.1 },
      { overpassClient: { fetchInterpreter }, legKey: 'empty' },
    )).rejects.toThrow('waterway_no_data');

    const elements = [
      { type: 'node', id: 1, lat: 52, lon: 13 },
      { type: 'node', id: 2, lat: 52, lon: 13.1 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { waterway: 'river' } },
    ];
    await expect(routeWaterwayLeg(
      { lat: 53, lng: 14 },
      { lat: 52, lng: 13.1 },
      { overpassClient: { fetchInterpreter: async () => ({ elements }) }, legKey: 'far', snapMaxM: 50 },
    )).rejects.toThrow('waterway_snap_too_far_a');
  });

  it('builds edges only for navigable waterway tags', async () => {
    const { buildUndirectedWaterwayEdges } = await import('../server/waterway/routing.js');
    const elements = [
      { type: 'node', id: 1, lat: 52.0, lon: 13.0 },
      { type: 'node', id: 2, lat: 52.0, lon: 13.1 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { waterway: 'river' } },
      { type: 'way', id: 11, nodes: [1, 2], tags: { waterway: 'stream' } },
    ];
    const { edges } = buildUndirectedWaterwayEdges(elements);
    expect(edges.size).toBe(1);
  });

  it('blocks water segments explicitly closed to canoes', async () => {
    const elements = [
      { type: 'node', id: 1, lat: 52.0, lon: 13.0 },
      { type: 'node', id: 2, lat: 52.0, lon: 13.1 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { waterway: 'river', canoe: 'no' } },
    ];

    await expect(routeWaterwayLeg(
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0, lng: 13.1 },
      { overpassClient: { fetchInterpreter: async () => ({ elements }) }, legKey: 'canoe-no', profile: 'canoe' },
    )).rejects.toThrow(/waterway_/);
  });

  it('honors oneway:canoe direction', async () => {
    const elements = [
      { type: 'node', id: 1, lat: 52.0, lon: 13.0 },
      { type: 'node', id: 2, lat: 52.0, lon: 13.1 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { waterway: 'river', 'oneway:canoe': 'yes' } },
    ];

    await expect(routeWaterwayLeg(
      { lat: 52.0, lng: 13.1 },
      { lat: 52.0, lng: 13.0 },
      { overpassClient: { fetchInterpreter: async () => ({ elements }) }, legKey: 'oneway', profile: 'canoe' },
    )).rejects.toThrow(/waterway_/);
  });

  it('uses mapped portages for canoe routes but not rowing routes', async () => {
    const elements = [
      { type: 'node', id: 1, lat: 52.0, lon: 13.0 },
      { type: 'node', id: 2, lat: 52.0, lon: 13.01 },
      { type: 'node', id: 3, lat: 52.0, lon: 13.02 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { waterway: 'river' } },
      { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'path', portage: 'yes' } },
    ];

    const canoe = await routeWaterwayLeg(
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0, lng: 13.02 },
      { overpassClient: { fetchInterpreter: async () => ({ elements }) }, legKey: 'portage-canoe', profile: 'canoe' },
    );
    expect(canoe.warnings.join(' ')).toContain('portage');

    await expect(routeWaterwayLeg(
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0, lng: 13.02 },
      { overpassClient: { fetchInterpreter: async () => ({ elements }) }, legKey: 'portage-rowing', profile: 'rowing', snapMaxM: 100 },
    )).rejects.toThrow(/waterway_/);
  });

  it('fails through hard barriers unless a canoe pass is mapped', async () => {
    const blocked = [
      { type: 'node', id: 1, lat: 52.0, lon: 13.0 },
      { type: 'node', id: 2, lat: 52.0, lon: 13.05 },
      { type: 'node', id: 3, lat: 52.0, lon: 13.1 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { waterway: 'river' } },
      { type: 'way', id: 11, nodes: [2, 3], tags: { waterway: 'weir' } },
    ];
    const pass = [
      ...blocked,
      { type: 'way', id: 12, nodes: [2, 3], tags: { waterway: 'canoe_pass' } },
    ];

    await expect(routeWaterwayLeg(
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0, lng: 13.1 },
      { overpassClient: { fetchInterpreter: async () => ({ elements: blocked }) }, legKey: 'weir-blocked', profile: 'canoe' },
    )).rejects.toThrow(/waterway_/);

    const result = await routeWaterwayLeg(
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0, lng: 13.1 },
      { overpassClient: { fetchInterpreter: async () => ({ elements: pass }) }, legKey: 'canoe-pass', profile: 'canoe' },
    );
    expect(result.warnings.join(' ')).toContain('canoe pass');
  });

  it('rejects high whitewater for canoe routes and any whitewater for rowing routes', async () => {
    const elements = (grade) => [
      { type: 'node', id: 1, lat: 52.0, lon: 13.0 },
      { type: 'node', id: 2, lat: 52.0, lon: 13.1 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { waterway: 'river', 'whitewater:rapid_grade': String(grade) } },
    ];

    const mild = await routeWaterwayLeg(
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0, lng: 13.1 },
      { overpassClient: { fetchInterpreter: async () => ({ elements: elements(1) }) }, legKey: 'mild', profile: 'canoe' },
    );
    expect(mild.warnings.join(' ')).toContain('whitewater grade 1');

    await expect(routeWaterwayLeg(
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0, lng: 13.1 },
      { overpassClient: { fetchInterpreter: async () => ({ elements: elements(3) }) }, legKey: 'hard-whitewater', profile: 'canoe' },
    )).rejects.toThrow(/waterway_/);

    await expect(routeWaterwayLeg(
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0, lng: 13.1 },
      { overpassClient: { fetchInterpreter: async () => ({ elements: elements(1) }) }, legKey: 'rowing-whitewater', profile: 'rowing' },
    )).rejects.toThrow(/waterway_/);
  });

  it('extracts lock annotations near the routed polyline with average delay', () => {
    const locks = extractLocksFromOsmElements(
      [
        { type: 'node', id: 1, lat: 52.0, lon: 13.05, tags: { waterway: 'lock_gate', name: 'A Lock' } },
        { type: 'node', id: 2, lat: 52.2, lon: 13.05, tags: { waterway: 'lock_gate', name: 'Too Far' } },
      ],
      [[52.0, 13.0], [52.0, 13.1]],
      { defaultLockDelayMinutes: 10 },
    );

    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({
      name: 'A Lock',
      delayS: 600,
    });
  });

  it('deduplicates lock annotations and keeps the richer metadata', () => {
    const locks = extractLocksFromOsmElements(
      [
        { type: 'node', id: 1, lat: 52.0, lon: 13.05, tags: { waterway: 'lock_gate' } },
        {
          type: 'way',
          id: 2,
          center: { lat: 52.0, lon: 13.0505 },
          tags: {
            lock: 'yes',
            lock_name: 'Richer Lock',
            ref: 'R-1',
            opening_hours: 'Mo-Su 08:00-18:00',
            phone: '+49 30 123456',
          },
        },
      ],
      [[52.0, 13.0], [52.0, 13.1]],
      { defaultLockDelayMinutes: 15 },
    );

    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({
      osmType: 'way',
      osmId: 2,
      name: 'Richer Lock',
      ref: 'R-1',
      delayS: 900,
      tags: {
        opening_hours: 'Mo-Su 08:00-18:00',
        phone: '+49 30 123456',
      },
    });
  });

  it('projects lock positions onto route chainage and measures route length', () => {
    const coords = [[52.0, 13.0], [52.0, 13.1], [52.0, 13.2]];
    expect(routeLengthM(coords)).toBeGreaterThan(13_000);
    expect(routeLengthM([[52, 13]])).toBe(0);
    expect(projectPointToPolyline(52.0, 13.15, coords)).toMatchObject({
      distanceM: expect.any(Number),
      chainageM: expect.any(Number),
      lat: 52,
      lng: 13.15,
    });
    expect(projectPointToPolyline(52, 13, [[52, 13]])).toBeNull();
  });

  it('ignores malformed, unrelated, coordinate-less, duplicate, and distant lock elements', () => {
    const locks = extractLocksFromOsmElements([
      null,
      { type: 'node', tags: { lock: 'yes' } },
      { type: 'node', id: 1, lat: 52, lon: 13.01, tags: { amenity: 'cafe' } },
      { type: 'node', id: 2, tags: { lock: 'yes' } },
      { type: 'node', id: 3, lat: 53, lon: 13.05, tags: { water: 'lock' } },
      { type: 'node', id: 4, lat: 52, lon: 13.04, tags: { water: 'lock', ref: 'L-4' } },
      { type: 'node', id: 4, lat: 52, lon: 13.04, tags: { water: 'lock', ref: 'L-4 duplicate' } },
    ], [[52, 13], [52, 13.1]], { defaultLockDelayMinutes: -5 });

    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ ref: 'L-4', delayS: 0 });
  });

  it('fetches lock context with the route signal and rejects an excessive bbox', async () => {
    const signal = new AbortController().signal;
    const fetchInterpreter = vi.fn(async () => ({
      elements: [{
        type: 'node',
        id: 5,
        lat: 52,
        lon: 13.05,
        tags: {
          lock: 'yes',
          name: 'Context Lock',
          website: 'https://lock.example',
          vhf: '20',
        },
      }],
    }));
    const locks = await fetchLocksForRoute(
      { coords: [[52, 13], [52, 13.1]] },
      { fetchInterpreter },
      { signal, defaultLockDelayMinutes: 20, contextBboxPadM: 100 },
    );

    expect(fetchInterpreter).toHaveBeenCalledWith(
      expect.stringContaining('relation["lock"="yes"]'),
      25,
      { signal },
    );
    expect(locks).toMatchObject([{
      name: 'Context Lock',
      delayS: 1200,
      tags: { website: 'https://lock.example', vhf: '20' },
    }]);

    await expect(fetchLocksForRoute(
      { coords: [[0, 0], [3, 0]] },
      { fetchInterpreter },
    )).rejects.toThrow('lock_bbox_too_large');

    const empty = await fetchLocksForRoute(
      { coords: [] },
      { fetchInterpreter: async () => ({ elements: [] }) },
      { contextBboxPadM: 0 },
    );
    expect(empty).toEqual([]);
  });
});
