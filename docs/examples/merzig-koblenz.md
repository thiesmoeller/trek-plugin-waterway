# Merzig to Koblenz: 10-day rowing test plan

This test plan follows the Saar downstream from Merzig, joins the Mosel at
Konz, and finishes at Koblenzer Ruderclub Rhenania. Distances are derived from
the river kilometres in the German Rowing Federation (DRV)
`Gewässerkatalog`; they are not straight-line map measurements.

The requested 25–30 km cannot be met exactly with club-only overnight stops.
Rowing clubs are unevenly spaced—some are less than 20 km apart and some are
more than 40 km apart. This plan therefore uses clubs as planned route visits
and documented public landings where they produce better daily distances.

Sources:

- [Saar bis zur Mündung](https://gewaesser.rudern.de/saar_bis_zur_muendung)
- [Mosel von Konz bis zur Mündung](https://gewaesser.rudern.de/mosel_von_konz_bis_zur_muendung)
- [Bootshaus Saarschleife](https://bootshaus-saarschleife.de/)
- [Ruder-Club Traben-Trarbach guest information](https://www.rctt.de/wp-content/uploads/2024/06/Hinweise_Fahrzeugfuehrer_Uebernachter.pdf)

## Stages

| Day | Start → overnight stop | Approx. km | Rowing-club visits |
|---:|---|---:|---|
| 1 | Kanuclub Merzig → Saarburger Ruder-Club | 32.5 | Bootshaus Saarschleife / Ruderbund Saar; Saarburger RC |
| 2 | Saarburger RC → Ruderverein Treviris Trier | 18.4 | Ruder- und Kanuverein Konz; Treviris Trier |
| 3 | Treviris Trier → Mehring landing | 24.1 | Treviris Trier at departure |
| 4 | Mehring → Piesport landing | 23.1 | — |
| 5 | Piesport → Rudergesellschaft Zeltingen | 24.2 | Bernkasteler RV; RG Zeltingen |
| 6 | RG Zeltingen → Enkirch landing | 20.7 | Ruder-Club Traben-Trarbach |
| 7 | Enkirch → Neef landing | 24.2 | Ruderverein Zell |
| 8 | Neef → Cochemer Rudergesellschaft | 25.3 | Cochemer RG |
| 9 | Cochem → Hatzenport landing | 23.9 | Rudergesellschaft Treis-Karden |
| 10 | Hatzenport → Koblenzer RC Rhenania | 24.9 | Koblenzer RC Rhenania |

Total chainage is approximately **241.3 km**. Days 1 and 2 deliberately trade
distance balance for club endpoints: combined they average 25.45 km/day.

## TREK test data

The machine-readable fixture is
[`tests/fixtures/merzig-koblenz-trip.js`](../../tests/fixtures/merzig-koblenz-trip.js).
It includes coordinates, chainage labels, stop type, and a `contactRequired`
flag for every club. The contract test:

1. checks all ten days connect without a gap;
2. checks the stage distances total 241.3 km;
3. verifies the eleven distinct rowing facilities along the route; and
4. invokes the plugin's `rowing` profile for every day against deterministic
   waterway geometry, asserting map coordinates, leg times, and time via points.

The deterministic geometry proves the TREK/plugin integration without making
CI depend on Overpass uptime. A real planner request will query current OSM
waterway data for the fixture coordinates.

## Operational checks before rowing

This is test/planning data, not navigation authorization. Contact every club
before arrival—guest landing, boat storage, showers, and overnight access are
not implied by inclusion in the fixture. In particular:

- the DRV catalogue marks several club facilities as requiring registration;
- Treviris references nearby camping, while RG Trier explicitly says no
  overnight stay or camping;
- Traben-Trarbach publishes separate guest/overnight instructions;
- Cochem and Koblenz require advance arrangements for overnight use;
- lock availability and maintenance closures must be checked in ELWIS;
- local navigation restrictions, protected areas, water level, current,
  weather, shipping, and safe landing suitability must be rechecked shortly
  before departure.
