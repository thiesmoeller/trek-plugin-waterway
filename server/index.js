'use strict';

const { definePlugin } = require('trek-plugin-sdk');
const { routeWaterwayLeg } = require('./waterway/routing');
const { fetchLocksForRoute } = require('./waterway/context');
const { createOverpassClient, OVERPASS_CACHE_MIGRATION } = require('./overpass');

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

module.exports = definePlugin({
  async onLoad(pluginCtx) {
    ctx = pluginCtx;
    await pluginCtx.db.migrate('001_overpass_cache', OVERPASS_CACHE_MIGRATION);
    pluginCtx.log.info('waterway route provider loaded');
  },

  hooks: {
    routeProvider: {
      async getRoute(req) {
        if (!ctx) throw new Error('plugin_not_loaded');
        const profile = normalizedProfile(req.profile);
        if (!profile) throw new Error('unsupported_route_profile');
        if (!Array.isArray(req.waypoints) || req.waypoints.length < 2) {
          throw new Error('waterway_requires_two_waypoints');
        }

        const overpassUrl = typeof ctx.config.overpassUrl === 'string' ? ctx.config.overpassUrl : undefined;
        const overpassClient = createOverpassClient(ctx, { overpassUrl });

        const coordinates = [];
        const legs = [];
        const viaPoints = [];
        let distance = 0;
        let duration = 0;

        for (let i = 0; i < req.waypoints.length - 1; i++) {
          const from = req.waypoints[i];
          const to = req.waypoints[i + 1];
          const { coords, distanceM, warnings = [], viaPoints: routeViaPoints = [] } = await routeWaterwayLeg(from, to, {
            overpassClient,
            legKey: `${req.tripId}:${req.dayId ?? 'none'}:${profile}:${i}`,
            profile,
            cache: new Map(),
            cacheTtlMs: 0,
          });
          let locks = [];
          try {
            locks = await fetchLocksForRoute(
              { coords, distanceM },
              overpassClient,
              { defaultLockDelayMinutes: defaultLockDelayMinutes(ctx.config) },
            );
          } catch {
            locks = [];
          }
          const lockDelayS = locks.reduce((sum, lock) => sum + lock.delayS, 0);
          const legDuration = durationS(distanceM, { speedKmh: profileSpeedKmh(profile, ctx.config) }) + lockDelayS;
          appendCoords(coordinates, coords);
          const notes = [
            ...warnings,
            ...(locks.length ? [`${locks.length} lock${locks.length === 1 ? '' : 's'}; rough delay included`] : []),
          ];
          legs.push({
            distance: distanceM,
            duration: legDuration,
            ...(notes.length ? { note: notes.slice(0, 3).join('; ') } : {}),
          });
          for (const point of routeViaPoints) {
            if (viaPoints.length >= 40) break;
            viaPoints.push(point);
          }
          for (const lock of locks) {
            if (viaPoints.length >= 40) break;
            viaPoints.push({
              lat: lock.lat,
              lng: lock.lng,
              label: lock.name || lock.ref || 'Lock',
              dwellSeconds: lock.delayS,
            });
          }
          distance += distanceM;
          duration += legDuration;
        }

        return {
          coordinates,
          distance,
          duration,
          legs,
          ...(viaPoints.length ? { viaPoints } : {}),
        };
      },
    },
  },
});
