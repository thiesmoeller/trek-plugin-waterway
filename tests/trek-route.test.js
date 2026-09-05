import { describe, expect, it } from 'vitest';
import {
  MAX_COORDINATES,
  MCP_MAX_COORDINATES,
  MAX_NOTE_CHARS,
  capCoordinates,
  capNote,
  durationViaPoint,
  formatDuration,
  formatKm,
  sampleCoordinates,
} from '../server/waterway/trek-route.js';

describe('TREK 4.2 route result shaping', () => {
  it('formats duration the same way TREK map via tooltips do', () => {
    expect(formatDuration(1500)).toBe('25 min');
    expect(formatDuration(5400)).toBe('1 h 30 min');
    expect(formatKm(18_400)).toBe('18.4 km');
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
  });
});
