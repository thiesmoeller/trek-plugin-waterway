# trek-plugin-waterway

> Route day-plan legs along OpenStreetMap rivers, canals, and fairways.

Integration plugin for TREK that registers **canoe**, **kayak**, and **rowing** route profiles via `hook:route-provider`. Day-plan waypoints are snapped to the nearest profile-compatible OSM waterway segment, pathfound on a directed graph, and timed using profile-specific average speeds plus rough lock delays.

## What it does

- Registers `canoe`, `kayak`, and `rowing` as day-plan route profiles
- Fetches waterway geometry from [Overpass API](https://overpass-api.de/)
- Filters obvious non-navigable or unsuitable segments by OSM access, oneway, barrier, portage, canoe-pass, and whitewater tags
- Warns when no mapped put-in or take-out is found near a routed leg
- Detects nearby OSM locks and adds an average lock delay to rough duration estimates
- Caches Overpass responses in the plugin's own SQLite database (`db:own`)
- Returns whole-route coordinates, distance in metres, duration, per-leg totals, routing notes, access warnings, lock notes, and lock via points

This provider is a route-estimation aid, not an authoritative navigation product. It deliberately does not yet do tidal context, current modelling, official notices, water levels, portage instructions, or multi-section trip-template creation.

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
  "canoeSpeedKmh": 5,
  "kayakSpeedKmh": 6,
  "rowingSpeedKmh": 8,
  "defaultLockDelayMinutes": 15
}
```

When `overpassUrl` is omitted, the default is `https://overpass-api.de/api/interpreter`. The mirror hostname must be listed in the plugin manifest `egress` array if you fork this plugin for a custom host.

Profile speed defaults are 5 km/h for canoe, 6 km/h for kayak, and 8 km/h for rowing. The legacy `speedKmh` config key is still accepted as a fallback for older local instances, but new installs should use the profile-specific keys. `defaultLockDelayMinutes` is added once per detected lock and defaults to 15.

## Local development

Requires Node ≥ 18 and a built [trek-plugin-sdk](../trek/plugin-sdk) (sibling under `trek/plugin-sdk`).

```bash
cd trek-plugin-waterway
npm install

# Build the SDK once (from the TREK repo)
cd ../trek/plugin-sdk && npm install && npm run build && cd ../../trek-plugin-waterway

npm test
npm run validate
npm run ci
npm run dev
```

`npm run dev` starts the SDK dev server with a real plugin database and injected `trek-plugin-sdk`. The plugin does not require a running TREK instance for unit tests — use `createMockHost` from `trek-plugin-sdk/testing` (see `tests/`).

## Routing scope

The profiles share the same route-provider contract but apply different suitability rules:

- `canoe` and `kayak` can use mapped canoe passes and short mapped portages, reject access-denied segments, and reject whitewater above grade 1.
- `rowing` avoids mapped portages, canoe passes, rapids, and any whitewater grade because those are not appropriate assumptions for rowing shells.
- `waterway` is kept as a legacy request alias for `canoe`; it is no longer advertised in the manifest.

See [docs/examples/mettlach-koblenz.md](docs/examples/mettlach-koblenz.md) for a DRV Gewaesserkatalog-based planning sketch. That document demonstrates how official rowing-waterway data can guide trip planning, but the current plugin does not import predefined trips or create TREK day plans automatically.

## Project layout

```
trek-plugin.json          Manifest (id: waterway, routeProfiles capability)
server/index.js           Plugin entry — onLoad + hooks.routeProvider
server/overpass.js        Overpass client with db-backed cache
server/waterway/          Graph/snap/pathfind engine (pure JS)
tests/fixtures/           Deterministic OSM-like route and lock fixtures
tests/                    Vitest suite with mocked fetch
docs/examples/            Human-readable trip planning examples
```

## Testing

Required tests run standalone without TREK core and without live Overpass:

- `tests/waterway-routing.test.js` — graph engine behaviour, including access denial, directed segments, portages, canoe passes, whitewater policy, and lock extraction
- `tests/plugin.test.js` — manifest validation, `getRoute` contract, profile speeds, lock delay, db cache behaviour, invalid host requests
- `tests/overpass-client.test.js` — encoded Overpass requests, db cache hits, stale refresh, HTTP failures
- `tests/trek-host-contract.test.js` — TREK-style discovery/enabling/invocation against deterministic OSM fixtures
- `tests/sdk-cli.test.js` — SDK validator CLI exit contract
- `tests/intent.test.js` — scoped check against the original rowing-planner intent for this first provider slice

```bash
npm test
npm run validate
npm run pack
```

`npm run ci` runs the required release checks in order: tests, SDK validation, and packaging.

A live Overpass smoke test is available for pre-release confidence, but it is intentionally not part of required CI because OSM data, rate limits, and network availability are outside the plugin's control:

```bash
npm run test:live
```

GitHub Actions runs `npm ci` and `npm run ci`. Because the plugin uses the local SDK dependency `file:../trek/plugin-sdk`, the workflow checks out TREK as a sibling directory before installing dependencies.

## Building a release artifact

```bash
npm run pack
```

Produces `plugin.zip` suitable for the TREK plugin registry.

Before registry publication, add a real TREK planner screenshot under `docs/screenshots/`
showing the Waterway route profile selected and a rendered route. Then upload `plugin.zip`
to a GitHub release and run:

```bash
npx trek-plugin-sdk entry
npx trek-plugin-sdk preflight --repo OWNER/REPO --tag v1.0.0
```

## License

MIT
