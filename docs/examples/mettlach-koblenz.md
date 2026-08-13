# Mettlach to Koblenz Rowing Trip Sketch

This is a planning example based on the DRV Gewaesserkatalog, not an automatically importable TREK trip. The current plugin surface is `hook:route-provider`, so it can validate and estimate route legs between waypoints, but it cannot create day plans or import predefined tours by itself.

Sources:

- [Saar bis zur Muendung](https://gewaesser.rudern.de/saar_bis_zur_muendung)
- [Mosel von Konz bis zur Muendung](https://gewaesser.rudern.de/mosel_von_konz_bis_zur_muendung)
- [Vorwort zur Saar](https://gewaesser.rudern.de/vorwort_zur_saar)

## Route Shape

Start around Mettlach on the Saar, follow the Saar downstream to the Saar/Mosel confluence near Konz, then follow the Mosel downstream to Koblenz and the Rhine confluence.

The DRV pages place Mettlach around Saar km 30-31 and Koblenz near Mosel km 0-4. That makes the complete route roughly 230 km before local club approaches, landing choices, detours, weather, current, lock waiting time, and safety decisions.

## Example Stages

| Stage | Section | Approx. distance | Planning notes |
|---|---:|---:|---|
| 1 | Mettlach / Kanu-Freunde Mettlach to Saarburg | 18-19 km | Saar start around km 30; pass Mettlach and Serrig lock areas. |
| 2 | Saarburg to Konz / Trier area | 20-22 km | Finish the Saar section and transition to the Mosel near Konz. |
| 3 | Trier to Trittenheim / Neumagen | 35-39 km | Long Mosel stage with lock planning around Trier and Detzem. |
| 4 | Trittenheim / Neumagen to Bernkastel-Kues | 25-30 km | Middle Mosel stage; check local club and landing options. |
| 5 | Bernkastel-Kues to Zell / Bullay | 38-42 km | Longer downstream day; plan around the Wintrich, Zeltingen, Enkirch, and St. Aldegund lock sequence. |
| 6 | Zell / Bullay to Cochem | 34-38 km | Continue through the lower Mosel; include Fankel lock timing. |
| 7 | Cochem to Alken / Brodenbach | 25-27 km | Lower Mosel stage with Mueden and Lehmen lock planning. |
| 8 | Alken / Brodenbach to Koblenz | 25-27 km | Finish near Koblenz; plan the final lock and landing around the Koblenz rowing clubs. |

## Validation Use

For CI and plugin validation, this should remain a documentation fixture until TREK exposes a trip-template or importer hook. The route provider can still be tested against deterministic OSM-like fixtures that model the important rowing/canoeing constraints: legal access, locks, barriers, portages, canoe passes, whitewater, and missing access points.

Before using the route on water, a human trip leader should verify current DRV notes, local club access, lock operating conditions, water levels, notices to skippers, weather, and crew capability.
