'use strict';

const { definePlugin } = require('trek-plugin-sdk');
const { routeWaterwayLeg } = require('./waterway/routing');
const { createOverpassClient, OVERPASS_CACHE_MIGRATION } = require('./overpass');

/** @type {import('trek-plugin-sdk').PluginContext | null} */
let ctx = null;

function durationS(distanceM, modeOptions) {
  const speedKmh = typeof modeOptions?.speedKmh === 'number' ? modeOptions.speedKmh : 6;
  return distanceM / ((speedKmh * 1000) / 3600);
}

module.exports = definePlugin({
  async onLoad(pluginCtx) {
    ctx = pluginCtx;
    await pluginCtx.db.migrate('001_overpass_cache', OVERPASS_CACHE_MIGRATION);
    pluginCtx.log.info('waterway route provider loaded');
  },

  hooks: {
    routeProvider: {
      modes() {
        return ['waterway'];
      },

      async routeLeg(req) {
        if (!ctx) throw new Error('plugin_not_loaded');
        const overpassUrl = typeof ctx.config.overpassUrl === 'string' ? ctx.config.overpassUrl : undefined;
        const overpassClient = createOverpassClient(ctx, { overpassUrl });
        const { coords, distanceM } = await routeWaterwayLeg(req.from, req.to, {
          overpassClient,
          legKey: req.legKey,
          cache: new Map(),
          cacheTtlMs: 0,
        });
        return {
          coords,
          distanceM,
          durationS: durationS(distanceM, req.modeOptions),
        };
      },
    },
  },
});
