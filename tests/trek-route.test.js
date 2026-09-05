import { describe, expect, it } from 'vitest';
import {
  MAX_COORDINATES,
  MAX_VIAS,
  MCP_MAX_COORDINATES,
  MAX_NOTE_CHARS,
  capCoordinates,
  capNote,
  capText,
  durationViaPoint,
  formatDuration,
  formatKm,
  lockViaPoint,
  pushVia,
  sampleCoordinates,
  waterwayMidpoint,
} from '../server/waterway/trek-route.js';

describe('TREK 4.2 route result shaping', () => {
  it('formats duration the same way TREK map via tooltips do', () => {
    expect(formatDuration(1500)).toBe('25 min');
    expect(formatDuration(5400)).toBe('1 h 30 min');
    expect(formatDuration(-1)).toBe('0 min');
    expect(formatKm(18_400)).toBe('18.4 km');
    expect(formatKm(150_000)).toBe('150 km');
    expect(formatKm(-1)).toBe('0.0 km');
    expect(capText('  abc  ', 2)).toBe('ab');
    expect(capText('', 2)).toBe('');
  });

  it('builds a success via point on the waterway midpoint with time and distance', () => {
    const via = durationViaPoint(
      [[52, 13], [52, 13.1], [52, 13.2]],
      5400,
      18_400,
    );
    expect(via).toEqual({
      lat: 52,
      lng: 13.1,
      label: '1 h 30 min · 18.4 km',
      tone: 'success',
    });
  });

  it('caps notes at the sidebar connector limit and coordinates at the host vertex budget', () => {
    expect(capNote(['a', 'b'.repeat(200)]).length).toBe(MAX_NOTE_CHARS);
    const coords = Array.from({ length: MAX_COORDINATES + 50 }, (_, i) => [0, i / 1000]);
    const capped = capCoordinates(coords);
    expect(capped).toHaveLength(MAX_COORDINATES);
    expect(capped[0]).toEqual(coords[0]);
    expect(capped.at(-1)).toEqual(coords.at(-1));
  });

  it('preserves route endpoints while bounding geometry for MCP results', () => {
    const coords = Array.from({ length: MCP_MAX_COORDINATES + 50 }, (_, i) => [1, i / 1000]);
    const sampled = sampleCoordinates(coords);
    expect(sampled).toHaveLength(MCP_MAX_COORDINATES);
    expect(sampled[0]).toEqual(coords[0]);
    expect(sampled.at(-1)).toEqual(coords.at(-1));
    expect(sampleCoordinates(coords, 1)).toEqual([coords[0]]);
    expect(sampleCoordinates(null)).toEqual([]);
  });

  it('handles empty midpoints and lock markers with or without scenarios', () => {
    expect(waterwayMidpoint([])).toBeNull();
    expect(waterwayMidpoint(null)).toBeNull();
    expect(durationViaPoint([], 10, 20)).toBeNull();

    const lock = { lat: 52, lng: 13, name: 'A'.repeat(100), delayS: 900 };
    expect(lockViaPoint(lock)).toMatchObject({
      label: 'A'.repeat(80),
      dwellSeconds: 900,
      tone: 'warn',
    });
    const scenarioMarker = lockViaPoint(lock, {
      optimistic: 12.5,
      planning: 25,
      conservative: 40,
    });
    expect(scenarioMarker.label).toHaveLength(80);
    expect(scenarioMarker.label).toContain('12.5–40 min (plan 25)');
    expect(scenarioMarker.dwellSeconds).toBe(1500);
  });

  it('drops missing and excess via points at the host budget', () => {
    const vias = [];
    pushVia(vias, null);
    for (let i = 0; i < MAX_VIAS + 5; i++) {
      pushVia(vias, { lat: 1, lng: i });
    }
    expect(vias).toHaveLength(MAX_VIAS);
    expect(vias.at(-1)).toEqual({ lat: 1, lng: MAX_VIAS - 1 });
  });
});
