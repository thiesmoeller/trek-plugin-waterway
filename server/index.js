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

const LOCK_SCENARIOS = ['optimistic', 'planning', 'conservative'];

function boundedMinutes(value, fallback) {
  const minutes = Number(value);
  return Number.isFinite(minutes) ? Math.min(1440, Math.max(0, minutes)) : fallback;
}

function resolveLockMinutes(config, overrides) {
  const planning = boundedMinutes(overrides?.planning, boundedMinutes(config?.defaultLockDelayMinutes, 25));
  const optimistic = Math.min(
    planning,
    boundedMinutes(overrides?.optimistic, boundedMinutes(config?.optimisticLockDelayMinutes, 15)),
  );
  const conservative = Math.max(
    planning,
    boundedMinutes(overrides?.conservative, boundedMinutes(config?.conservativeLockDelayMinutes, 40)),
  );
  return { optimistic, planning, conservative };
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
  const lockMinutes = resolveLockMinutes(runtime.config, req?.lockMinutes);

  const overpassUrl = typeof runtime.config.overpassUrl === 'string' ? runtime.config.overpassUrl : undefined;
  const overpassClient = createOverpassClient(runtime, { overpassUrl });
  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), budgetMs);

  const coordinates = [];
  const legs = [];
  const planningLegs = [];
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
          defaultLockDelayMinutes: lockMinutes.planning,
        });
      } catch {
        locks = [];
      }
      const paddlingDuration = durationS(distanceM, { speedKmh: profileSpeedKmh(profile, runtime.config) });
      const scenarioDurations = Object.fromEntries(
        LOCK_SCENARIOS.map((scenario) => [
          scenario,
          paddlingDuration + (locks.length * lockMinutes[scenario] * 60),
        ]),
      );
      const legDuration = scenarioDurations.planning;
      appendCoords(coordinates, coords);
      const notes = [
        ...warnings,
        ...(locks.length ? [`${locks.length} lock${locks.length === 1 ? '' : 's'}; ${lockMinutes.planning} min planning time each`] : []),
      ];
      const note = capNote(notes);
      legs.push({
        distance: distanceM,
        duration: legDuration,
        ...(note ? { note } : {}),
      });
      planningLegs.push({
        paddlingDuration,
        scenarioDurations,
        locks,
      });
      pushVia(viaPoints, durationViaPoint(coords, legDuration, distanceM));
      for (const lock of locks) pushVia(viaPoints, lockViaPoint(lock, lockMinutes));
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
    planningLegs,
    lockMinutes,
    ...(viaPoints.length ? { viaPoints } : {}),
  };
}

function rounded(value, places = 0) {
  const scale = 10 ** places;
  return Math.round(Number(value) * scale) / scale;
}

function routeScenario(route, scenario) {
  const duration = route.planningLegs.reduce((sum, leg) => sum + leg.scenarioDurations[scenario], 0);
  const lockCount = route.planningLegs.reduce((sum, leg) => sum + leg.locks.length, 0);
  return {
    durationSeconds: rounded(duration),
    durationMinutes: rounded(duration / 60, 1),
    lockDelayMinutes: rounded(lockCount * route.lockMinutes[scenario], 1),
  };
}

function mcpRouteResult(route, includeGeometry, requestedScenario) {
  const selectedScenario = LOCK_SCENARIOS.includes(requestedScenario) ? requestedScenario : 'planning';
  const scenarios = Object.fromEntries(
    LOCK_SCENARIOS.map((scenario) => [scenario, routeScenario(route, scenario)]),
  );
  const locks = route.planningLegs.flatMap((leg, legIndex) => leg.locks.map((lock) => ({
    name: lock.name || lock.ref || 'Lock',
    lat: lock.lat,
    lng: lock.lng,
    leg: legIndex + 1,
    delayMinutes: route.lockMinutes[selectedScenario],
    delayScenariosMinutes: { ...route.lockMinutes },
    ...(lock.tags?.opening_hours ? { openingHours: lock.tags.opening_hours } : {}),
    ...(lock.tags?.phone ? { phone: lock.tags.phone } : {}),
    ...(lock.tags?.website ? { website: lock.tags.website } : {}),
    ...(lock.tags?.vhf ? { vhf: lock.tags.vhf } : {}),
  })));
  const paddlingDuration = route.planningLegs.reduce((sum, leg) => sum + leg.paddlingDuration, 0);
  const result = {
    profile: route.profile,
    lockModel: {
      selectedScenario,
      perLockMinutes: { ...route.lockMinutes },
      explanation: 'Optimistic assumes immediate entry; planning is used on the TREK map; conservative is for contingency checks.',
    },
    estimate: {
      scenario: selectedScenario,
      distanceMeters: rounded(route.distance),
      distanceKm: rounded(route.distance / 1000, 2),
      paddlingDurationSeconds: rounded(paddlingDuration),
      paddlingDurationMinutes: rounded(paddlingDuration / 60, 1),
      ...scenarios[selectedScenario],
    },
    scenarios,
    legs: route.legs.map((leg, index) => ({
      from: route.waypoints[index].name || `Waypoint ${index + 1}`,
      to: route.waypoints[index + 1].name || `Waypoint ${index + 2}`,
      distanceMeters: rounded(leg.distance),
      distanceKm: rounded(leg.distance / 1000, 2),
      paddlingDurationMinutes: rounded(route.planningLegs[index].paddlingDuration / 60, 1),
      lockCount: route.planningLegs[index].locks.length,
      durationSeconds: rounded(route.planningLegs[index].scenarioDurations[selectedScenario]),
      durationMinutes: rounded(route.planningLegs[index].scenarioDurations[selectedScenario] / 60, 1),
      scenarioDurationsMinutes: Object.fromEntries(
        LOCK_SCENARIOS.map((scenario) => [
          scenario,
          rounded(route.planningLegs[index].scenarioDurations[scenario] / 60, 1),
        ]),
      ),
      ...(leg.note ? { note: leg.note } : {}),
    })),
    locks,
    operationalWarnings: [
      'Lock opening hours, closures, queues, booking rules, and traffic can exceed the conservative estimate.',
      ...locks
        .filter((lock) => lock.openingHours)
        .map((lock) => `${lock.name}: mapped opening hours ${lock.openingHours}; verify with the operator.`),
    ],
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
        const {
          profile: _profile,
          waypoints: _waypoints,
          planningLegs: _planningLegs,
          lockMinutes: _lockMinutes,
          ...hostRoute
        } = route;
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
          lockMinutes: input.lockMinutes,
        }, runtime, MCP_ROUTE_BUDGET_MS);
        return mcpRouteResult(route, input.includeGeometry === true, input.lockScenario);
      },
    },
  },
});
