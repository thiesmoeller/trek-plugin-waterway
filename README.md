# trek-plugin-waterway

> Route day-plan legs along OpenStreetMap rivers, canals, and fairways.

Integration plugin for TREK 4.x that registers **canoe**, **kayak**, and **rowing** route profiles via `hook:route-provider`. Day-plan waypoints are snapped to the nearest profile-compatible OSM waterway segment, pathfound on a directed graph, and timed using profile-specific average speeds plus rough lock delays.

On the TREK planner this is the native day route: waterway geometry is the map line, per-leg times show on the sidebar connectors, lock dots sit on the line with dwell-time tooltips, and each leg also gets a midpoint via labelled with paddle/row time and distance so those times are available on the map itself.

## What it does

- Registers `canoe`, `kayak`, and `rowing` as day-plan route profiles next to Driving/Walking
- Fetches waterway geometry and locks from [Overpass API](https://overpass-api.de/) in one query so the host's 20 s `getRoute` budget is enough for a typical day
- Filters obvious non-navigable or unsuitable segments by OSM access, oneway, barrier, portage, canoe-pass, and whitewater tags
- Warns when no mapped put-in or take-out is found near a routed leg
- Detects nearby OSM locks and adds an average lock delay to rough duration estimates
- Caches Overpass responses in the plugin's own SQLite database (`db:own`)
- Returns the TREK 4.2 route shape: coordinates, distance in metres, duration in seconds, per-leg totals, routing notes (≤120 chars), and via points (duration markers + locks, ≤40)

This provider is a route-estimation aid, not an authoritative navigation product. It deliberately does not yet do tidal context, current modelling, official notices, water levels, portage instructions, or multi-section trip-template creation.

## Screenshots

![Waterway route provider profile overview](./docs/screenshot.png)

The store cover is `docs/screenshot.png`. It shows the planner surface this plugin changes: a Rowing profile, the waterway drawn on the map, and travel times both on the route and in the day-plan connectors.

## Permissions

| Permission | Why |
|---|---|
| `hook:route-provider` | Implements `hooks.routeProvider.getRoute` |
| `db:own` | Persists Overpass cache between requests and restarts |
| `http:outbound:overpass-api.de` | Fetches waterway data from Overpass |

## Setup

Set optional instance config in Admin -> Plugins -> Waterway. Manifest `default` values are used until you change them:

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

Admins can clear the Overpass cache with **Purge Overpass cache** on the plugin's instance settings dialog.

## Local development

Requires Node ≥ 18 and a built [trek-plugin-sdk](https://github.com/liketrek/TREK/tree/dev/plugin-sdk) (sibling under `trek/plugin-sdk`, currently 1.7.x).

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

TREK calls `getRoute({ tripId, dayId, profile, waypoints }, ctx)` with a 20 s timeout. A throw or timeout falls back to straight lines, the same as an OSRM outage. The plugin aborts its own Overpass work at 18 s and asks Overpass to finish each query within 12 s.

See the [Merzig to Koblenz 10-day test plan](docs/examples/merzig-koblenz.md)
for a machine-tested, DRV Gewässerkatalog-based route along the Saar and
Mosel. It targets roughly 25 km/day, visits eleven rowing facilities, and uses
public landings where club spacing makes 25–30 km club-to-club stages
impossible. The earlier
[Mettlach planning sketch](docs/examples/mettlach-koblenz.md) remains as a
shorter human-readable example. The plugin validates and estimates the day
routes; it does not yet create the TREK trip automatically.

## Project layout

```
trek-plugin.json          Manifest (id: waterway, routeProfiles capability)
server/index.js           Plugin entry — onLoad, instance action, hooks.routeProvider
server/overpass.js        Overpass client with db-backed cache
server/waterway/          Graph/snap/pathfind engine (pure JS)
tests/fixtures/           Deterministic OSM-like route and lock fixtures
tests/                    Vitest suite with mocked fetch
docs/examples/            Human-readable trip planning examples
```

## Testing

Required tests run standalone without TREK core and without live Overpass:

- `tests/waterway-routing.test.js` — graph engine behaviour, including access denial, directed segments, portages, canoe passes, whitewater policy, and lock extraction
- `tests/plugin.test.js` — manifest validation, `getRoute` contract, map via times, profile speeds, lock delay, db cache behaviour, invalid host requests
- `tests/overpass-client.test.js` — encoded Overpass requests, db cache hits, stale refresh, HTTP failures
- `tests/trek-host-contract.test.js` — TREK-style discovery/enabling/invocation against deterministic OSM fixtures
- `tests/trek-route.test.js` — duration labels and TREK vertex/note budgets
- `tests/merzig-koblenz-trip.test.js` — ten connected rowing days from Merzig to Koblenz, club visits, stage chainage, and map/time output
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

GitHub Actions runs `npm ci` and `npm run ci`. Because the plugin uses the local SDK dependency `file:../trek/plugin-sdk`, the workflow checks out [liketrek/TREK](https://github.com/liketrek/TREK) `dev` as a sibling directory before installing dependencies.

## Building a release artifact

```bash
npm run pack
```

Produces `plugin.zip` suitable for the TREK plugin registry.

The registry store card reads `docs/screenshot.png` at the pinned commit. After a live capture from a TREK 4.x planner (Rowing profile selected, waterway and times visible), replace that file, upload `plugin.zip` to a GitHub release, and run:

```bash
npx trek-plugin-sdk entry
npx trek-plugin-sdk preflight --repo OWNER/REPO --tag v1.1.0
```

## License

MIT
