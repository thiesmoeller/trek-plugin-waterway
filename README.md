# trek-plugin-waterway

> Route day-plan legs along OpenStreetMap rivers, canals, and fairways.

Integration plugin for TREK that registers the **waterway** route profile via `hook:route-provider`. Day-plan waypoints are snapped to the nearest navigable OSM waterway segment, pathfound on an undirected graph, and timed using an average rowing speed plus rough lock delays.

## What it does

- Registers `waterway` as a day-plan route profile
- Fetches waterway geometry from [Overpass API](https://overpass-api.de/)
- Detects nearby OSM locks and adds an average lock delay to rough duration estimates
- Caches Overpass responses in the plugin's own SQLite database (`db:own`)
- Returns whole-route coordinates, distance in metres, duration, per-leg totals, lock notes, and lock via points

This first slice deliberately does not do tidal context, rough tide windows, current modelling, or multi-section event planning.

## Permissions

| Permission | Why |
|---|---|
| `hook:route-provider` | Implements `hooks.routeProvider.getRoute` |
| `db:own` | Persists Overpass cache between requests and restarts |
| `http:outbound:overpass-api.de` | Fetches waterway data from Overpass |

## Instance configuration

Set optional instance config in Admin -> Plugins -> Waterway:

```json
{
  "overpassUrl": "https://overpass.kumi.systems/api/interpreter",
  "speedKmh": 6,
  "defaultLockDelayMinutes": 15
}
```

When `overpassUrl` is omitted, the default is `https://overpass-api.de/api/interpreter`. The mirror hostname must be listed in the plugin manifest `egress` array if you fork this plugin for a custom host. `speedKmh` controls average rowing duration and defaults to 6. `defaultLockDelayMinutes` is added once per detected lock and defaults to 15.

## Local development

Requires Node ≥ 18 and a built [trek-plugin-sdk](../trek/plugin-sdk) (sibling under `trek/plugin-sdk`).

```bash
cd trek-plugin-waterway
npm install

# Build the SDK once (from the TREK repo)
cd ../trek/plugin-sdk && npm install && npm run build && cd ../../trek-plugin-waterway

npm test
npm run validate
npm run dev
```

`npm run dev` starts the SDK dev server with a real plugin database and injected `trek-plugin-sdk`. The plugin does not require a running TREK instance for unit tests — use `createMockHost` from `trek-plugin-sdk/testing` (see `tests/`).

## Project layout

```
trek-plugin.json          Manifest (id: waterway, routeProfiles capability)
server/index.js           Plugin entry — onLoad + hooks.routeProvider
server/overpass.js        Overpass client with db-backed cache
server/waterway/          Vendored graph/snap/pathfind engine (pure JS)
tests/                    Vitest suite with mocked fetch
```

## Testing

Tests run standalone without TREK core:

- `tests/waterway-routing.test.js` — graph engine (ported from `@trek/waterway-routing`)
- `tests/plugin.test.js` — manifest validation, `getRoute` contract, lock delay, db cache behaviour
- `tests/intent.test.js` — scoped check against the original rowing-planner intent for this first provider slice

```bash
npm test
```

## Building a release artifact

```bash
npm run pack
```

Produces `plugin.zip` suitable for the TREK plugin registry.

## License

MIT
