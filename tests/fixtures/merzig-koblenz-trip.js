/**
 * Merzig → Koblenz downstream rowing plan.
 *
 * Distances use the DRV Gewässerkatalog river kilometre chainage, not straight
 * lines between coordinates. Clubs are route visits; public landings fill the
 * long gaps where club-to-club stages cannot stay near 25–30 km.
 */
export const merzigKoblenzTrip = {
  id: 'merzig-koblenz-rowing',
  name: 'Merzig to Koblenz via Saar and Mosel',
  profile: 'rowing',
  targetDailyKm: { min: 25, max: 30 },
  approximateDistanceKm: 241.3,
  sources: [
    'https://gewaesser.rudern.de/saar_bis_zur_muendung',
    'https://gewaesser.rudern.de/mosel_von_konz_bis_zur_muendung',
  ],
  days: [
    {
      day: 1,
      distanceKm: 32.5,
      note: 'Long opening day; no documented rowing club near the 25–30 km boundary.',
      stops: [
        stop('Kanuclub Merzig', 49.4447229, 6.633815, 'launch', 'Saar km 44.1'),
        club('Bootshaus Saarschleife · Ruderbund Saar', 49.4874888, 6.5643083, 'Saar km 36.7'),
        club('Saarburger Ruder-Club', 49.6083211, 6.5468165, 'Saar km 11.6'),
      ],
    },
    {
      day: 2,
      distanceKm: 18.4,
      note: 'Short club-to-club day covering the Saar–Mosel confluence.',
      stops: [
        club('Saarburger Ruder-Club', 49.6083211, 6.5468165, 'Saar km 11.6'),
        club('Ruder- und Kanuverein Konz', 49.7050189, 6.5786134, 'Mosel km 200.2'),
        club('Ruderverein Treviris Trier', 49.7446084, 6.6244256, 'Mosel km 194.0'),
      ],
    },
    {
      day: 3,
      distanceKm: 24.1,
      stops: [
        club('Ruderverein Treviris Trier', 49.7446084, 6.6244256, 'Mosel km 194.0'),
        stop('Mehring landing', 49.7964244, 6.8081962, 'public-landing', 'Mosel km 169.9'),
      ],
    },
    {
      day: 4,
      distanceKm: 23.1,
      stops: [
        stop('Mehring landing', 49.7964244, 6.8081962, 'public-landing', 'Mosel km 169.9'),
        stop('Piesport landing', 49.8728715, 6.9271802, 'public-landing', 'Mosel km 146.8'),
      ],
    },
    {
      day: 5,
      distanceKm: 24.2,
      stops: [
        stop('Piesport landing', 49.8728715, 6.9271802, 'public-landing', 'Mosel km 146.8'),
        club('Bernkasteler Ruderverein', 49.9247869, 7.0660393, 'Mosel km 128.3'),
        club('Rudergesellschaft Zeltingen', 49.9555384, 7.0077741, 'Mosel km 122.6'),
      ],
    },
    {
      day: 6,
      distanceKm: 20.7,
      stops: [
        club('Rudergesellschaft Zeltingen', 49.9555384, 7.0077741, 'Mosel km 122.6'),
        club('Ruder-Club Traben-Trarbach', 49.951553, 7.1293168, 'Mosel km 105.9'),
        stop('Enkirch landing', 49.9778715, 7.1235916, 'public-landing', 'Mosel km 101.9'),
      ],
    },
    {
      day: 7,
      distanceKm: 24.2,
      stops: [
        stop('Enkirch landing', 49.9778715, 7.1235916, 'public-landing', 'Mosel km 101.9'),
        club('Ruderverein Zell', 50.0150544, 7.1726753, 'Mosel km 88.9'),
        stop('Neef landing', 50.0891892, 7.1346866, 'public-landing', 'Mosel km 77.7'),
      ],
    },
    {
      day: 8,
      distanceKm: 25.3,
      stops: [
        stop('Neef landing', 50.0891892, 7.1346866, 'public-landing', 'Mosel km 77.7'),
        club('Cochemer Rudergesellschaft', 50.1382873, 7.1777225, 'Mosel km 52.4'),
      ],
    },
    {
      day: 9,
      distanceKm: 23.9,
      stops: [
        club('Cochemer Rudergesellschaft', 50.1382873, 7.1777225, 'Mosel km 52.4'),
        club('Rudergesellschaft Treis-Karden', 50.1740455, 7.2990163, 'Mosel km 40.2'),
        stop('Hatzenport landing', 50.2279913, 7.4176346, 'public-landing', 'Mosel km 28.5'),
      ],
    },
    {
      day: 10,
      distanceKm: 24.9,
      stops: [
        stop('Hatzenport landing', 50.2279913, 7.4176346, 'public-landing', 'Mosel km 28.5'),
        club('Koblenzer Ruderclub Rhenania', 50.3612821, 7.5671051, 'Mosel km 3.6'),
      ],
    },
  ],
};

function stop(name, lat, lng, kind, chainage) {
  return { name, lat, lng, kind, chainage };
}

function club(name, lat, lng, chainage) {
  return {
    ...stop(name, lat, lng, 'rowing-club', chainage),
    contactRequired: true,
  };
}
