# Screenshots

The registry store card reads **exactly** `docs/screenshot.png` at the pinned
commit. The committed cover is generated from the Merzig–Koblenz test plan:

```bash
python3 -m pip install Pillow
python3 scripts/render-screenshot.py
```

The renderer uses the fixture's real route coordinates over OpenStreetMap and
adds the same concepts TREK renders: selected Rowing profile, waterway
geometry, numbered days, rowing-club stops, a per-leg duration, and a lock
delay. It writes a deterministic 1600×900 marketing image after map tiles are
cached locally.

A real TREK planner capture may still be added separately for release notes.
Do not make live Overpass screenshots a required test fixture; deterministic
fixture tests remain the release gate.
