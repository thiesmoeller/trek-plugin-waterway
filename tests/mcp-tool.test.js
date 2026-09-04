import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { berlinCanalLockElements, berlinCanalRouteElements, overpassSequence } from './fixtures/waterway-fixtures.js';
import { createHostWithDb } from './mock-db.js';

const waypoints = [
  { name: 'Fixture Put-in', lat: 52.0, lng: 13.0 },
  { name: 'Fixture Take-out', lat: 52.0, lng: 13.2 },
];

describe('waterway MCP route tool', () => {
  let plugin;
  let ctx;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.fetch = vi.fn(overpassSequence(berlinCanalRouteElements, berlinCanalLockElements));
    const mod = await import('../server/index.js');
    plugin = mod.default ?? mod;
    ({ ctx } = createHostWithDb({
      config: { rowingSpeedKmh: 8, defaultLockDelayMinutes: 10 },
    }));
    await plugin.onLoad(ctx);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await plugin.onUnload();
    vi.unstubAllGlobals();
  });

  it('publishes the declared estimate tool and returns agent-friendly route details', async () => {
    expect(plugin.hooks.mcpToolProvider.tools).toEqual(['estimate_route']);

    const result = await plugin.hooks.mcpToolProvider.callTool({
      name: 'estimate_route',
      args: { profile: 'rowing', waypoints, includeGeometry: true },
    }, ctx);

    expect(result).toMatchObject({
      profile: 'rowing',
      estimate: {
        distanceMeters: expect.any(Number),
        distanceKm: expect.any(Number),
        durationSeconds: expect.any(Number),
        durationMinutes: expect.any(Number),
      },
      legs: [{
        from: 'Fixture Put-in',
        to: 'Fixture Take-out',
        distanceMeters: expect.any(Number),
        distanceKm: expect.any(Number),
        durationSeconds: expect.any(Number),
        durationMinutes: expect.any(Number),
        note: expect.stringContaining('2 locks'),
      }],
      locks: [
        { name: 'Fixture Lock West', lat: 52, lng: 13.05, delayMinutes: 10 },
        { name: 'Fixture Lock East', lat: 52, lng: 13.15, delayMinutes: 10 },
      ],
      geometry: {
        coordinates: expect.any(Array),
        originalCoordinateCount: expect.any(Number),
        simplified: false,
      },
      caveat: expect.stringContaining('Planning estimate only'),
    });
    expect(result.estimate.distanceMeters).toBe(result.legs[0].distanceMeters);
    expect(result.estimate.durationMinutes).toBeGreaterThan(20);
  });

  it('runs through the SDK host driver only when mcp:tools is granted', async () => {
    const allowedHost = createHostWithDb({
      grants: ['db:own', 'mcp:tools', 'http:outbound:overpass-api.de'],
      config: { canoeSpeedKmh: 5 },
    });
    const allowed = allowedHost.run(plugin);
    await allowed.load();
    const result = await allowed.hook('mcpToolProvider', 'callTool', {
      name: 'estimate_route',
      args: { profile: 'canoe', waypoints },
    });
    expect(result).toMatchObject({ profile: 'canoe', legs: [expect.any(Object)] });
    await allowed.unload();

    const denied = createHostWithDb({ grants: ['db:own'] }).run(plugin);
    await denied.load();
    await expect(denied.hook('mcpToolProvider', 'callTool', {
      name: 'estimate_route',
      args: { profile: 'canoe', waypoints },
    })).rejects.toThrow(/PERMISSION_DENIED|mcp:tools/);
    await denied.unload();
  });

  it('omits geometry by default to keep the MCP result compact', async () => {
    const result = await plugin.hooks.mcpToolProvider.callTool({
      name: 'estimate_route',
      args: { profile: 'canoe', waypoints },
    }, ctx);

    expect(result).not.toHaveProperty('geometry');
    expect(result.legs).toHaveLength(1);
  });

  it('rejects unsupported tools and invalid route inputs with stable errors', async () => {
    await expect(plugin.hooks.mcpToolProvider.callTool({
      name: 'delete_everything',
      args: {},
    }, ctx)).rejects.toThrow('unsupported_mcp_tool');

    await expect(plugin.hooks.mcpToolProvider.callTool({
      name: 'estimate_route',
      args: { profile: 'driving', waypoints },
    }, ctx)).rejects.toThrow('unsupported_route_profile');

    await expect(plugin.hooks.mcpToolProvider.callTool({
      name: 'estimate_route',
      args: { profile: 'rowing', waypoints: [{ lat: 91, lng: 13 }, waypoints[1]] },
    }, ctx)).rejects.toThrow('invalid_waypoint_1');
  });

  it('aborts before TREK MCP reaches its 15 second host timeout', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));

    const pending = expect(plugin.hooks.mcpToolProvider.callTool({
      name: 'estimate_route',
      args: { profile: 'rowing', waypoints },
    }, ctx)).rejects.toThrow('waterway_route_timed_out');
    await vi.advanceTimersByTimeAsync(13_000);
    await pending;
  });
});
