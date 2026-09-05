# Release-candidate testing

The beta channel exercises the same packed bytes that can later be proposed to
the TREK community registry. Do not rebuild or replace an artifact after people
have installed it; advance the version instead.

## Create a candidate

1. Merge only with green CI. The CI run retains `plugin.zip` and its coverage
   report for 30 days.
2. Optionally add the PEM contents of the backed-up Ed25519 author key as the
   repository secret `TREK_PLUGIN_SIGNING_KEY`. The candidate workflow attaches
   the public key and signature output when this secret exists.
3. Keep `package.json`, `package-lock.json`, and `trek-plugin.json` on the same
   version. Push a tag named exactly `v<manifest version>`.
4. The **Release candidate** workflow repeats tests, coverage, validation, and
   packing before creating a GitHub prerelease with `plugin.zip`, its SHA-256
   file, and the optional signature information.

## Install without an upstream registry entry

Download `plugin.zip` from the prerelease and upload it in
**Admin → Plugins → Upload plugin**. TREK registers a sideloaded plugin inactive;
review and grant its permissions, configure its instance settings, then enable
it. Sideloaded builds have no automatic updates, which is appropriate for a
small controlled pilot.

For a registry-equivalent rehearsal, use a fork of `liketrek/TREK-Plugins`,
generate an entry for the candidate release, let that fork build
`dist/index.json`, and point only the staging TREK instance at it:

```env
TREK_PLUGIN_REGISTRY_URL=https://raw.githubusercontent.com/OWNER/TREK-Plugins/main/dist/index.json
```

This tests Discover, checksum/signature verification, compatibility selection,
installation, and updates without submitting anything upstream.

## Acceptance checklist

- Start with an empty plugin database and verify a real route through the
  primary Overpass endpoint and each fallback.
- Prime the cache, block all endpoints, and verify the route remains available
  with the stale-data warning; data older than seven days must be refused.
- Compare map and MCP planning durations for zero, one, and several locks.
- Check optimistic, planning, and conservative totals and per-call MCP
  overrides.
- Confirm mapped opening hours are warnings, not treated as a guarantee.
- Exercise canoe, kayak, and rowing access rules on the Merzig–Koblenz plan.
- Reconnect an MCP client with `plugins:use`, call
  `plugin_waterway_estimate_route`, and verify its planning result matches the
  TREK map.
- Install the next candidate through the staging registry and verify the
  permission/update flow.

After the exact candidate bytes pass this checklist, promote the GitHub
prerelease metadata and propose that same immutable release to the upstream
registry.
