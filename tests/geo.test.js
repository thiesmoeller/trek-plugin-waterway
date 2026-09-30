import { describe, expect, it } from 'vitest';
import { bboxWithPadding, haversineMeters, interpolateLngLat, planarPointToSegmentMeters } from '../server/waterway/geo.js';

describe('waterway geometry helpers', () => {
  it('interpolates, pads a bbox, and projects onto a segment including a degenerate one', () => {
    expect(interpolateLngLat(50, 6, 51, 7, 0.5)).toEqual({ lat: 50.5, lng: 6.5 });
    expect(haversineMeters(50, 6, 50, 6)).toBe(0);

    const box = bboxWithPadding(50, 6, 50.1, 6.2, 1000);
    expect(box.south).toBeLessThan(50);
    expect(box.north).toBeGreaterThan(50.1);
    expect(box.west).toBeLessThan(6);
    expect(box.east).toBeGreaterThan(6.2);

    const polar = bboxWithPadding(89.9, 10, 89.95, 10.1, 500);
    expect(polar.east).toBeGreaterThan(polar.west);

    const onLine = planarPointToSegmentMeters(50.05, 6.05, 50, 6, 50.1, 6.1);
    expect(onLine.d).toBeLessThan(50);
    expect(onLine.t).toBeGreaterThan(0);
    expect(onLine.t).toBeLessThan(1);

    const pastEnd = planarPointToSegmentMeters(52, 8, 50, 6, 50.1, 6.1);
    expect(pastEnd.t).toBe(1);

    const collapsed = planarPointToSegmentMeters(50, 6, 50, 6, 50, 6);
    expect(collapsed.t).toBe(0);
    expect(collapsed.d).toBe(0);
  });
});
