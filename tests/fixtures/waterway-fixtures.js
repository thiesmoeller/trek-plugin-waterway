export const berlinCanalTrip = {
  profile: 'waterway',
  tripId: 42,
  dayId: 7,
  waypoints: [
    { lat: 52.0, lng: 13.0 },
    { lat: 52.0, lng: 13.1 },
    { lat: 52.0, lng: 13.2 },
  ],
};

export const berlinCanalRouteElements = [
  { type: 'node', id: 1, lat: 52.0, lon: 13.0 },
  { type: 'node', id: 2, lat: 52.0, lon: 13.05 },
  { type: 'node', id: 3, lat: 52.0, lon: 13.1 },
  { type: 'node', id: 4, lat: 52.0, lon: 13.15 },
  { type: 'node', id: 5, lat: 52.0, lon: 13.2 },
  { type: 'way', id: 10, nodes: [1, 2, 3], tags: { waterway: 'canal', name: 'Fixture Canal West' } },
  { type: 'way', id: 11, nodes: [3, 4, 5], tags: { waterway: 'river', name: 'Fixture River East' } },
  { type: 'way', id: 12, nodes: [1, 5], tags: { waterway: 'stream', name: 'Ignored Stream Shortcut' } },
];

export const berlinCanalLockElements = [
  {
    type: 'node',
    id: 99,
    lat: 52.0,
    lon: 13.05,
    tags: {
      waterway: 'lock_gate',
      name: 'Fixture Lock West',
      opening_hours: 'Mo-Su 08:00-18:00',
      phone: '+49 30 123456',
    },
  },
  {
    type: 'node',
    id: 100,
    lat: 52.0,
    lon: 13.15,
    tags: {
      lock: 'yes',
      lock_name: 'Fixture Lock East',
      ref: 'E-1',
    },
  },
];

export function routeRequest(overrides = {}) {
  return {
    ...berlinCanalTrip,
    ...overrides,
    waypoints: overrides.waypoints ?? berlinCanalTrip.waypoints.map((point) => ({ ...point })),
  };
}

export function overpassSequence(routeElements = berlinCanalRouteElements, lockElements = []) {
  let calls = 0;
  return async () => ({
    ok: true,
    json: async () => ({ elements: calls++ % 2 === 0 ? routeElements : lockElements }),
  });
}
