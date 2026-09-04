'use strict';

const { definePlugin } = require('trek-plugin-sdk');
const { routeWaterwayLeg } = require('./waterway/routing');
const { extractLocksFromOsmElements } = require('./waterway/context');
const { createOverpassClient, OVERPASS_CACHE_MIGRATION } = require('./overpass');
const {
  ROUTE_BUDGET_MS,
  MCP_ROUTE_BUDGET_MS,
  MCP_MAX_COORDINATES,
  OVERPASS_TIMEOUT_S,
  capNote,
  capCoordinates,
  sampleCoordinates,
  durationViaPoint,
  lockViaPoint,
  pushVia,
} = require('./waterway/trek-route');

/** @type {import('trek-plugin-sdk').PluginContext | null} */
let ctx = null;

function durationS(distanceM, config) {
  const speedKmh = typeof config?.speedKmh === 'number' ? config.speedKmh : 5;
  return distanceM / ((speedKmh * 1000) / 3600);
}

function profileSpeedKmh(profile, config) {
  const key = profile === 'rowing' ? 'rowingSpeedKmh' : profile === 'kayak' ? 'kayakSpeedKmh' : 'canoeSpeedKmh';
  if (typeof config?.[key] === 'number') return config[key];
  if (typeof config?.speedKmh === 'number') return config.speedKmh;
  return profile === 'rowing' ? 8 : profile === 'kayak' ? 6 : 5;
}

function normalizedProfile(profile) {
  if (profile === 'waterway') return 'canoe';
  return ['canoe', 'kayak', 'rowing'].includes(profile) ? profile : null;
}

function defaultLockDelayMinutes(config) {
  return typeof config?.defaultLockDelayMinutes === 'number' ? config.defaultLockDelayMinutes : 15;
}

function appendCoords(target, coords) {
  for (const coord of coords) {
    const last = target[target.length - 1];
    if (!last || last[0] !== coord[0] || last[1] !== coord[1]) target.push(coord);
  }
}

function runtimeCtx(hookCtx) {
  return hookCtx || ctx;
}

function readWaypoints(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 30) {
    throw new Error('waterway_requires_2_to_30_waypoints');
  }
  return value.map((waypoint, index) => {
    const lat = Number(waypoint?.lat);
    const lng = Number(waypoint?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error(`invalid_waypoint_${index + 1}`);
    }
    const name = typeof waypoint.name === 'string' ? waypoint.name.trim().slice(0, 120) : '';
    return { lat, lng, ...(name ? { name } : {}) };
  });
}

async function calculateRoute(req, runtime, budgetMs) {
  const profile = normalizedProfile(req?.profile);
  if (!profile) throw new Error('unsupported_route_profile');
  const waypoints = readWaypoints(req?.waypoints);

  const overpassUrl = typeof runtime.config.overpassUrl === 'string' ? runtime.config.overpassUrl : undefined;
  const overpassClient = createOverpassClient(runtime, { overpassUrl });
  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), budgetMs);

  const coordinates = [];
  const legs = [];
  const viaPoints = [];
  let distance = 0;
  let duration = 0;

  try {
    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = waypoints[i];
      const to = waypoints[i + 1];
      const routed = await routeWaterwayLeg(from, to, {
        overpassClient,
        legKey: `${req.tripId ?? 'mcp'}:${req.dayId ?? 'none'}:${profile}:${i}`,
        profile,
        cache: new Map(),
        cacheTtlMs: 0,
        signal: controller.signal,
        overpassTimeoutS: OVERPASS_TIMEOUT_S,
      });
      const { coords, distanceM, warnings = [] } = routed;
      let locks = [];
      try {
        locks = extractLocksFromOsmElements(routed.elements || [], coords, {
          defaultLockDelayMinutes: defaultLockDelayMinutes(runtime.config),
        });
      } catch {
        locks = [];
      }
      const lockDelayS = locks.reduce((sum, lock) => sum + lock.delayS, 0);
      const legDuration = durationS(distanceM, { speedKmh: profileSpeedKmh(profile, runtime.config) }) + lockDelayS;
      appendCoords(coordinates, coords);
      const notes = [
        ...warnings,
        ...(locks.length ? [`${locks.length} lock${locks.length === 1 ? '' : 's'}; rough delay included`] : []),
      ];
      const note = capNote(notes);
      legs.push({
        distance: distanceM,
        duration: legDuration,
        ...(note ? { note } : {}),
      });
      pushVia(viaPoints, durationViaPoint(coords, legDuration, distanceM));
      for (const lock of locks) pushVia(viaPoints, lockViaPoint(lock));
      distance += distanceM;
      duration += legDuration;
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('waterway_route_timed_out');
    throw error;
  } finally {
    clearTimeout(budget);
  }

  return {
    profile,
    waypoints,
    coordinates: capCoordinates(coordinates),
    distance,
    duration,
    legs,
    ...(viaPoints.length ? { viaPoints } : {}),
  };
}

function rounded(value, places = 0) {
  const scale = 10 ** places;
  return Math.round(Number(value) * scale) / scale;
}

function mcpRouteResult(route, includeGeometry) {
  const locks = (route.viaPoints || [])
    .filter((point) => Number.isFinite(point.dwellSeconds))
    .map((point) => ({
      name: point.label || 'Lock',
      lat: point.lat,
      lng: point.lng,
      delayMinutes: rounded(point.dwellSeconds / 60, 1),
    }));
  const result = {
    profile: route.profile,
    estimate: {
      distanceMeters: rounded(route.distance),
      distanceKm: rounded(route.distance / 1000, 2),
      durationSeconds: rounded(route.duration),
      durationMinutes: rounded(route.duration / 60, 1),
    },
    legs: route.legs.map((leg, index) => ({
      from: route.waypoints[index].name || `Waypoint ${index + 1}`,
      to: route.waypoints[index + 1].name || `Waypoint ${index + 2}`,
      distanceMeters: rounded(leg.distance),
      distanceKm: rounded(leg.distance / 1000, 2),
      durationSeconds: rounded(leg.duration),
      durationMinutes: rounded(leg.duration / 60, 1),
      ...(leg.note ? { note: leg.note } : {}),
    })),
    locks,
    caveat: 'Planning estimate only; verify access, conditions, notices, water levels, and landing rights.',
  };
  if (includeGeometry) {
    const geometry = sampleCoordinates(route.coordinates, MCP_MAX_COORDINATES);
    result.geometry = {
      coordinates: geometry,
      originalCoordinateCount: route.coordinates.length,
      simplified: geometry.length < route.coordinates.length,
    };
  }
  return result;
}

module.exports = definePlugin({
  async onLoad(pluginCtx) {
    ctx = pluginCtx;
    await pluginCtx.db.migrate('001_overpass_cache', OVERPASS_CACHE_MIGRATION);
    pluginCtx.log.info('waterway route provider loaded');
  },

  async onUnload() {
    ctx = null;
  },

  actions: {
    async purgeCache(actionCtx) {
      const runtime = runtimeCtx(actionCtx);
      if (!runtime) throw new Error('plugin_not_loaded');
      await runtime.db.exec('DELETE FROM overpass_cache');
      runtime.log?.info?.('overpass cache purged');
      return { ok: true, message: 'Overpass cache cleared' };
    },
  },

  hooks: {
    routeProvider: {
      async getRoute(req, hookCtx) {
        const runtime = runtimeCtx(hookCtx);
        if (!runtime) throw new Error('plugin_not_loaded');
        const route = await calculateRoute(req, runtime, ROUTE_BUDGET_MS);
        const { profile: _profile, waypoints: _waypoints, ...hostRoute } = route;
        return hostRoute;
      },
    },
    mcpToolProvider: {
      tools: ['estimate_route'],
      async callTool({ name, args }, hookCtx) {
        if (name !== 'estimate_route') throw new Error('unsupported_mcp_tool');
        const runtime = runtimeCtx(hookCtx);
        if (!runtime) throw new Error('plugin_not_loaded');
        const input = args && typeof args === 'object' ? args : {};
        const route = await calculateRoute({
          profile: input.profile,
          waypoints: input.waypoints,
        }, runtime, MCP_ROUTE_BUDGET_MS);
        return mcpRouteResult(route, input.includeGeometry === true);
      },
    },
  },
});
