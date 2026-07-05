'use strict';

const { createMockHost } = require('trek-plugin-sdk/testing');

/** In-memory db backing for plugin cache tests (createMockHost alone does not persist). */
function createHostWithDb(opts = {}) {
  const cacheRows = new Map();
  const migrations = [];
  const { ctx, logs } = createMockHost({
    grants: ['db:own'],
    config: opts.config ?? {},
  });

  ctx.db.migrate = async (id, sql) => {
    migrations.push({ id, sql });
    return { applied: true };
  };
  ctx.db.query = async (sql, ...args) => {
    const params = Array.isArray(args[0]) ? args[0] : args;
    if (sql.includes('overpass_cache') && sql.includes('SELECT')) {
      const key = params[0];
      const row = cacheRows.get(key);
      return row ? [{ elements_json: row.elements_json, fetched_at: row.fetched_at }] : [];
    }
    return [];
  };
  ctx.db.exec = async (sql, ...args) => {
    const params = Array.isArray(args[0]) ? args[0] : args;
    if (sql.includes('INSERT OR REPLACE INTO overpass_cache')) {
      cacheRows.set(params[0], { elements_json: params[1], fetched_at: params[2] });
      return { changes: 1 };
    }
    return { changes: 0 };
  };

  return { ctx, logs, cacheRows, migrations };
}

module.exports = { createHostWithDb };
