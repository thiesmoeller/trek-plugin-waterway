import { describe, expect, it, vi } from 'vitest';
import { routeWaterwayLeg } from '../server/waterway/routing.js';

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
});
