'use strict';

const { definePlugin } = require('trek-plugin-sdk');
const { routeWaterwayLeg } = require('./waterway/routing');
const { extractLocksFromOsmElements } = require('./waterway/context');
const { createOverpassClient, OVERPASS_CACHE_MIGRATION } = require('./overpass');
const {
  ROUTE_BUDGET_MS,
  OVERPASS_TIMEOUT_S,
  capNote,
  capCoordinates,
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
        const profile = normalizedProfile(req.profile);
        if (!profile) throw new Error('unsupported_route_profile');
        if (!Array.isArray(req.waypoints) || req.waypoints.length < 2) {
          throw new Error('waterway_requires_two_waypoints');
        }

        const overpassUrl = typeof runtime.config.overpassUrl === 'string' ? runtime.config.overpassUrl : undefined;
        const overpassClient = createOverpassClient(runtime, { overpassUrl });
        const controller = new AbortController();
        const budget = setTimeout(() => controller.abort(), ROUTE_BUDGET_MS);

        const coordinates = [];
        const legs = [];
        const viaPoints = [];
        let distance = 0;
        let duration = 0;

        try {
          for (let i = 0; i < req.waypoints.length - 1; i++) {
            const from = req.waypoints[i];
            const to = req.waypoints[i + 1];
            const routed = await routeWaterwayLeg(from, to, {
              overpassClient,
              legKey: `${req.tripId}:${req.dayId ?? 'none'}:${profile}:${i}`,
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
        } finally {
          clearTimeout(budget);
        }

        return {
          coordinates: capCoordinates(coordinates),
          distance,
          duration,
          legs,
          ...(viaPoints.length ? { viaPoints } : {}),
        };
      },
    },
  },
});
