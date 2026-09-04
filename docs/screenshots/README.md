# Screenshots

The registry store card reads **exactly** `docs/screenshot.png` at the pinned
commit. The committed image is a real 1600×900 browser capture of TREK 4.2
with this repository loaded through TREK's plugin dev-link.

Capture checklist:

- Run TREK with `TREK_PLUGINS_ENABLED=true` and
  `TREK_PLUGINS_DEV_LINK=1`.
- Link this repository in **Admin → Plugins**, grant its permissions, and
  confirm **Waterway Route Provider** is active.
- Load the Merzig–Koblenz test trip and select Day 5,
  **Piesport → Zeltingen**.
- Select **Rowing**, enable **Route**, and wait until both plugin-provided
  duration connectors and the curved Mosel overlay render.
- Use a 1600×900 desktop viewport, collapse the places panel, and capture the
  browser viewport without browser or operating-system chrome.

The map in the committed capture comes from OpenStreetMap data returned to the
running plugin; its line, time/distance connectors, and lock markers are
rendered by TREK itself. Do not replace it with a composited or generated UI.
Live Overpass remains unsuitable as a required test fixture, so deterministic
fixture tests remain the release gate.
