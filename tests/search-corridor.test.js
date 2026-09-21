import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { berlinCanalPlaceElements, overpassSequence } from './fixtures/waterway-fixtures.js';
import { createHostWithDb } from './mock-db.js';
import { extractPlaces, matchesCategory, publicCategory } from '../server/waterway/places.js';
import { searchWaterwayPlaces } from '../server/waterway/search.js';

const bounds = { south: 51.9, west: 12.9, north: 52.1, east: 13.3 };

describe('waterway place classification', () => {
  it('maps OSM locks, landings, camps and clubs onto Road trip corridor kinds', () => {
    const places = extractPlaces(berlinCanalPlaceElements);
    const kinds = Object.fromEntries(places.map((place) => [place.name, place.kind]));
    expect(kinds['Fixture Lock West']).toBe('lock');
    expect(kinds['Fixture Mid Landing']).toBe('landing');
    expect(kinds['Fixture Canal Camp']).toBe('campsite');
    expect(kinds['Fixture Rowing Club']).toBe('club');
    expect(kinds['Fixture Named Weir']).toBe('sight');

    expect(matchesCategory('lock', 'rest_area')).toBe(true);
    expect(matchesCategory('landing', 'rest_area')).toBe(true);
    expect(matchesCategory('campsite', 'campsite')).toBe(true);
    expect(matchesCategory('lock', 'sights')).toBe(true);
    expect(matchesCategory('club', 'hotel')).toBe(false);
    expect(publicCategory('landing')).toBe('rest_area');
    expect(publicCategory('club')).toBe('rowing_club');
  });

  it('reads way centres, historic locks, caravan sites, and sport clubs', () => {
    const places = extractPlaces([
      { type: 'way', id: 1, center: { lat: 52.1, lon: 13.1 }, tags: { lock: 'yes', historic: 'yes', name: 'Old Lock' } },
      { type: 'node', id: 2, lat: 52.1, lon: 13.2, tags: { tourism: 'caravan_site', name: 'Van park' } },
      { type: 'node', id: 3, lat: 52.1, lon: 13.3, tags: { club: 'sport', sport: 'canoe;rowing', name: 'Paddle Club' } },
      { type: 'node', id: 3, lat: 52.1, lon: 13.3, tags: { club: 'sport', sport: 'canoe;rowing', name: 'Paddle Club' } },
      { type: 'node', id: 4, lat: 91, lon: 13 },
      { type: 'way', id: 5, tags: { lock: 'yes' } },
    ]);
    expect(places.map((place) => place.kind)).toEqual(['sight', 'campsite', 'club']);
  });

  it('labels unnamed features and answers attraction weirs as sights', () => {
    const places = extractPlaces([
      { type: 'node', id: 10, lat: 52, lon: 13, tags: { waterway: 'lock_gate' } },
      { type: 'node', id: 11, lat: 52, lon: 13.01, tags: { leisure: 'slipway' } },
      { type: 'node', id: 12, lat: 52, lon: 13.02, tags: { tourism: 'camp_site' } },
      { type: 'node', id: 13, lat: 52, lon: 13.03, tags: { sport: 'kayak' } },
      { type: 'node', id: 14, lat: 52, lon: 13.04, tags: { waterway: 'canal', tourism: 'attraction', name: 'Big weir view' } },
      { type: 'node', id: 15, lat: 52, lon: 13.05, tags: { canoe: 'put_in' } },
    ]);
    expect(places.map((place) => [place.kind, place.name])).toEqual([
      ['lock', 'Lock'],
      ['landing', 'Landing'],
      ['campsite', 'Campsite'],
      ['club', 'Rowing club'],
      ['sight', 'Big weir view'],
      ['landing', 'Landing'],
    ]);
    expect(publicCategory('lock', 'sights')).toBe('sights');
    expect(matchesCategory('sight', 'sights')).toBe(true);
    expect(matchesCategory('lock', 'campsite')).toBe(false);
  });
});

describe('searchWaterwayPlaces', () => {
  it('returns nothing for Road trip kinds this plugin does not answer', async () => {
    const runtime = createHostWithDb().ctx;
    globalThis.fetch = vi.fn(overpassSequence(berlinCanalPlaceElements));
    await expect(searchWaterwayPlaces({ category: 'fuel', bounds }, runtime)).resolves.toEqual([]);
    await expect(searchWaterwayPlaces({ category: 'charging', bounds }, runtime)).resolves.toEqual([]);
    await expect(searchWaterwayPlaces({ category: 'hotel', bounds }, runtime)).resolves.toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('needs a location and ignores an oversized rectangle', async () => {
    const runtime = createHostWithDb().ctx;
    globalThis.fetch = vi.fn(overpassSequence(berlinCanalPlaceElements));
    await expect(searchWaterwayPlaces({ query: 'lock' }, runtime)).resolves.toEqual([]);
    await expect(searchWaterwayPlaces({
      bounds: { south: 40, west: 0, north: 55, east: 20 },
    }, runtime)).resolves.toEqual([]);
    await expect(searchWaterwayPlaces({
      bounds: { south: 52.2, west: 13, north: 52.1, east: 13.2 },
    }, runtime)).resolves.toEqual([]);
    await expect(searchWaterwayPlaces({
      near: { lat: 100, lng: 13 },
    }, runtime)).resolves.toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('projects corridor hits onto a route and drops places far from the line', async () => {
    const runtime = createHostWithDb().ctx;
    const farCamp = {
      type: 'node',
      id: 99,
      lat: 53.5,
      lon: 13.1,
      tags: { tourism: 'camp_site', name: 'Far Camp' },
    };
    const places = await searchWaterwayPlaces(
      { bounds, limit: 20 },
      runtime,
      {
        overpassClient: {
          fetchInterpreter: async () => ({ elements: [...berlinCanalPlaceElements, farCamp] }),
        },
        routeCoordinates: [[52, 13.0], [52, 13.2]],
        corridorM: 800,
      },
    );
    expect(places.map((place) => place.name)).not.toContain('Far Camp');
    expect(places.some((place) => place.alongKm != null && place.distanceKm != null)).toBe(true);
  });
});

describe('waterway MCP search_corridor tool', () => {
  let plugin;
  let ctx;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.fetch = vi.fn(overpassSequence(berlinCanalPlaceElements));
    const mod = await import('../server/index.js');
    plugin = mod.default ?? mod;
    ({ ctx } = createHostWithDb());
    await plugin.onLoad(ctx);
  });

  afterEach(async () => {
    await plugin.onUnload();
    vi.unstubAllGlobals();
  });

  it('answers rest_area as locks and landings for a TREK 4.3 corridor search', async () => {
    const result = await plugin.hooks.mcpToolProvider.callTool({
      name: 'search_corridor',
      args: { category: 'rest_area', query: 'rest area', bounds },
    }, ctx);

    const names = result.places.map((place) => place.name);
    expect(names).toEqual(expect.arrayContaining([
      'Fixture Lock West',
      'Fixture Lock East',
      'Fixture Put-in',
      'Fixture Mid Landing',
      'Fixture Take-out',
    ]));
    expect(names).not.toContain('Fixture Canal Camp');
    expect(result.places.every((place) => place.category === 'rest_area')).toBe(true);
  });

  it('filters campsites and drops unsafe websites', async () => {
    const result = await plugin.hooks.mcpToolProvider.callTool({
      name: 'search_corridor',
      args: { category: 'campsite', near: { lat: 52, lng: 13.1 } },
    }, ctx);

    expect(result.places.map((place) => place.name)).toEqual([
      'Fixture Canal Camp',
      'Unsafe Camp',
    ]);
    expect(result.places[0].website).toBe('https://example.test/camp');
    expect(result.places[1].website).toBeUndefined();
  });

  it('returns named weirs and locks as sights and honours a name query', async () => {
    const sights = await plugin.hooks.mcpToolProvider.callTool({
      name: 'search_corridor',
      args: { category: 'sights', bounds },
    }, ctx);
    expect(sights.places.map((place) => place.name)).toEqual(expect.arrayContaining([
      'Fixture Named Weir',
      'Fixture Lock West',
    ]));

    const named = await plugin.hooks.mcpToolProvider.callTool({
      name: 'search_corridor',
      args: { query: 'weir', near: { lat: 52, lng: 13.18 }, limit: 5 },
    }, ctx);
    expect(named.places.map((place) => place.name)).toEqual(['Fixture Named Weir']);
  });

  it('caps the result list and refuses calls before onLoad', async () => {
    const result = await plugin.hooks.mcpToolProvider.callTool({
      name: 'search_corridor',
      args: { bounds, limit: 2 },
    }, ctx);
    expect(result.places).toHaveLength(2);

    await plugin.onUnload();
    await expect(plugin.hooks.mcpToolProvider.callTool({
      name: 'search_corridor',
      args: { bounds },
    })).rejects.toThrow('plugin_not_loaded');
  });
});
