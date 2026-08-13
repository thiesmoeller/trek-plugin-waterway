import { describe, expect, it, vi } from 'vitest';
import { routeWaterwayLeg } from '../server/waterway/routing.js';
import { extractLocksFromOsmElements } from '../server/waterway/context.js';

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
      35,
      expect.objectContaining({ signal: controller.signal }),
    );
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
});
