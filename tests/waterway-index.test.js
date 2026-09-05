import { describe, expect, it } from 'vitest';
import waterway from '../server/waterway/index.js';

describe('waterway public module', () => {
  it('exports routing, context, geometry, and TREK result helpers', () => {
    expect(waterway).toMatchObject({
      haversineMeters: expect.any(Function),
      extractLocksFromOsmElements: expect.any(Function),
      routeWaterwayLeg: expect.any(Function),
      capCoordinates: expect.any(Function),
    });
  });
});
