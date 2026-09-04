# Screenshots

The registry store card reads **exactly** `docs/screenshot.png` at the pinned commit. That file is required for `trek-plugin validate`.

Recommended live capture (replace the schematic cover before a public registry release):

- Open a TREK 4.x instance with the Waterway plugin installed and enabled.
- Open a trip day with two or more places near a waterway.
- Select the `Rowing` (or Canoe/Kayak) route profile in the day-plan route picker.
- Capture the planner showing the waterway on the map, duration via points / lock dots, and sidebar connector times.
- Save it as `docs/screenshot.png` (16:9, 1600×900 is ideal).

Do not use live Overpass screenshots as a required test fixture. Deterministic fixture tests remain the release gate.
