'use strict';

const { haversineMeters, planarPointToSegmentMeters } = require('./geo');

const ROADTRIP_CATEGORIES = Object.freeze([
  'fuel',
  'charging',
  'rest_area',
  'campsite',
  'restaurant',
  'sights',
  'hotel',
]);

const CATEGORY_QUERIES = Object.freeze({
  fuel: 'fuel station',
  charging: 'EV charging station',
  rest_area: 'rest area',
  campsite: 'campsite',
  restaurant: 'restaurant',
  sights: 'tourist attraction',
  hotel: 'hotel',
});

const WATERWAY_CORRIDOR_CATEGORIES = Object.freeze(['rest_area', 'campsite', 'sights']);

function tag(tags, key) {
  const v = tags?.[key];
  return typeof v === 'string' ? v.trim() : '';
}

function tagLower(tags, key) {
  return tag(tags, key).toLowerCase();
}

function elementCoord(el) {
  const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
  const lon = typeof el.lon === 'number' ? el.lon : el.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return { lat, lng: lon };
}

function isLock(tags) {
  return tagLower(tags, 'waterway') === 'lock_gate'
    || tagLower(tags, 'lock') === 'yes'
    || tagLower(tags, 'water') === 'lock'
    || tag(tags, 'lock_name') !== '';
}

function isLanding(tags) {
  return tagLower(tags, 'waterway') === 'access_point'
    || tagLower(tags, 'leisure') === 'slipway'
    || ['put_in', 'egress', 'yes', 'designated', 'permissive'].includes(tagLower(tags, 'canoe'));
}

function isCampsite(tags) {
  return ['camp_site', 'caravan_site'].includes(tagLower(tags, 'tourism'));
}

function sportValue(tags) {
  return tagLower(tags, 'sport');
}

function isClub(tags) {
  const sport = sportValue(tags);
  return /(^|[;,\s])(rowing|canoe|kayak)([;,\s]|$)/.test(sport)
    || (tagLower(tags, 'club') === 'sport' && /(rowing|canoe|kayak)/.test(sport));
}

function isSight(tags) {
  if (tagLower(tags, 'waterway') === 'weir' && tag(tags, 'name')) return true;
  if (tagLower(tags, 'historic') && isLock(tags)) return true;
  if (tagLower(tags, 'tourism') === 'attraction' && (isLock(tags) || tagLower(tags, 'waterway'))) return true;
  return false;
}

function placeKind(tags) {
  if (isCampsite(tags)) return 'campsite';
  if (isClub(tags)) return 'club';
  if (isLanding(tags)) return 'landing';
  if (isSight(tags)) return 'sight';
  if (isLock(tags)) return 'lock';
  return null;
}

function placeName(tags, kind) {
  const named = tag(tags, 'lock_name') || tag(tags, 'name') || tag(tags, 'ref');
  if (named) return named.slice(0, 200);
  if (kind === 'lock') return 'Lock';
  if (kind === 'landing') return 'Landing';
  if (kind === 'campsite') return 'Campsite';
  if (kind === 'club') return 'Rowing club';
  if (kind === 'sight') return 'Waterway landmark';
  return '';
}

function publicCategory(kind, requested) {
  if (requested) return requested;
  if (kind === 'campsite') return 'campsite';
  if (kind === 'lock' || kind === 'landing') return 'rest_area';
  if (kind === 'sight') return 'sights';
  if (kind === 'club') return 'rowing_club';
  return null;
}

function matchesCategory(kind, category) {
  if (!category) return true;
  if (category === 'rest_area') return kind === 'lock' || kind === 'landing';
  if (category === 'campsite') return kind === 'campsite';
  if (category === 'sights') return kind === 'sight' || kind === 'lock';
  return false;
}

function classifyOsmPlace(el) {
  if (!el || typeof el.id !== 'number') return null;
  const tags = el.tags || {};
  const kind = placeKind(tags);
  if (!kind) return null;
  const coord = elementCoord(el);
  if (!coord) return null;
  const name = placeName(tags, kind);
  if (!name) return null;
  return {
    id: `${kind}:${el.type || 'node'}:${el.id}`,
    osmType: el.type || 'node',
    osmId: el.id,
    kind,
    name,
    lat: coord.lat,
    lng: coord.lng,
    website: tag(tags, 'website') || tag(tags, 'contact:website') || null,
    phone: tag(tags, 'phone') || tag(tags, 'contact:phone') || null,
    openingHours: tag(tags, 'opening_hours') || null,
    description: [
      kind === 'lock' ? 'Mapped waterway lock' : null,
      kind === 'landing' ? 'Mapped put-in or take-out' : null,
      kind === 'campsite' ? 'Mapped campsite near the waterway' : null,
      kind === 'club' ? 'Mapped paddle or rowing club' : null,
      kind === 'sight' ? 'Mapped waterway landmark' : null,
      tag(tags, 'opening_hours') ? `Hours ${tag(tags, 'opening_hours')}` : null,
    ].filter(Boolean).join('. ').slice(0, 500),
  };
}

function extractPlaces(elements) {
  const seen = new Set();
  const places = [];
  for (const el of elements || []) {
    const place = classifyOsmPlace(el);
    if (!place || seen.has(place.id)) continue;
    seen.add(place.id);
    places.push(place);
  }
  return places;
}

function projectPlaceToRoute(place, coords, corridorM = 2500) {
  if (!Array.isArray(coords) || coords.length < 2) return { ...place, alongM: null, offRouteM: null };
  let best = null;
  let chain = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const segLen = haversineMeters(a[0], a[1], b[0], b[1]);
    const p = planarPointToSegmentMeters(place.lat, place.lng, a[0], a[1], b[0], b[1]);
    const candidate = {
      offRouteM: p.d,
      alongM: chain + segLen * p.t,
    };
    if (!best || candidate.offRouteM < best.offRouteM) best = candidate;
    chain += segLen;
  }
  if (!best || best.offRouteM > corridorM) return null;
  return { ...place, alongM: best.alongM, offRouteM: best.offRouteM };
}

function isCategoryQuery(query, category) {
  if (!category || !query) return false;
  const expected = CATEGORY_QUERIES[category];
  return expected ? query.trim().toLowerCase() === expected.toLowerCase() : false;
}

function matchesQuery(place, query) {
  if (!query) return true;
  const haystack = `${place.name} ${place.description || ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

module.exports = {
  ROADTRIP_CATEGORIES,
  CATEGORY_QUERIES,
  WATERWAY_CORRIDOR_CATEGORIES,
  classifyOsmPlace,
  extractPlaces,
  projectPlaceToRoute,
  matchesCategory,
  publicCategory,
  isCategoryQuery,
  matchesQuery,
  isLock,
  isLanding,
  isCampsite,
  isClub,
  elementCoord,
};
