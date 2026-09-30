'use strict';

const { bboxWithPadding } = require('./geo');
const { createOverpassClient } = require('../overpass');
const {
  extractPlaces,
  matchesCategory,
  matchesQuery,
  isCategoryQuery,
  publicCategory,
  projectPlaceToRoute,
  WATERWAY_CORRIDOR_CATEGORIES,
} = require('./places');

const SEARCH_TIMEOUT_S = 8;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const NEAR_RADIUS_M = 12_000;
const MAX_BBOX_SPAN_DEG = 2.5;

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readBounds(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const south = finiteNumber(raw.south);
  const west = finiteNumber(raw.west);
  const north = finiteNumber(raw.north);
  const east = finiteNumber(raw.east);
  if (south == null || west == null || north == null || east == null) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  if (south >= north || west >= east) return null;
  return { south, west, north, east };
}

function readNear(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = finiteNumber(raw.lat);
  const lng = finiteNumber(raw.lng);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function searchBounds(request) {
  const bounds = readBounds(request?.bounds);
  if (bounds) return bounds;
  const near = readNear(request?.near);
  if (!near) return null;
  return bboxWithPadding(near.lat, near.lng, near.lat, near.lng, NEAR_RADIUS_M);
}

function bboxTooLarge(bounds) {
  return Math.abs(bounds.north - bounds.south) > MAX_BBOX_SPAN_DEG
    || Math.abs(bounds.east - bounds.west) > MAX_BBOX_SPAN_DEG;
}

function waterwayPlaceQuery(bounds) {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `
(
  node["waterway"="lock_gate"](${box});
  way["waterway"="lock_gate"](${box});
  node["lock"="yes"](${box});
  way["lock"="yes"](${box});
  node["water"="lock"](${box});
  node["waterway"="access_point"](${box});
  node["leisure"="slipway"](${box});
  node["canoe"~"^(put_in|egress|yes|designated|permissive)$"](${box});
  node["tourism"="camp_site"](${box});
  way["tourism"="camp_site"](${box});
  node["tourism"="caravan_site"](${box});
  node["waterway"="weir"]["name"](${box});
  node["sport"~"rowing|canoe|kayak"](${box});
  node["club"="sport"]["sport"~"rowing|canoe|kayak"](${box});
);
out center tags;
`.trim();
}

function limitFrom(raw) {
  const asked = Number(raw);
  return Number.isFinite(asked) && asked > 0 ? Math.min(MAX_LIMIT, Math.trunc(asked)) : DEFAULT_LIMIT;
}

/** Same cap TREK 4.3.2 puts on a place website before it can be saved. */
const PLACE_WEBSITE_MAX_LENGTH = 500;
const HTTP_URL = /^https?:\/\//i;
const HOST_AND_PORT = /^([^:/?#@\s]+)(?::\d{1,5})?$/;
const LABEL = /^[\p{L}\p{N}\p{M}_-]+$/u;
const OCTET = /^\d{1,3}$/;
const LETTER = /\p{L}/u;

function authorityOf(rest) {
  const end = rest.search(/[/?#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

function isHostName(host) {
  const labels = host.split('.');
  if (labels.length < 2) return false;
  if (labels.every((label) => OCTET.test(label))) {
    return labels.length === 4 && labels.every((label) => Number(label) <= 255);
  }
  const valid = labels.every((label) => LABEL.test(label) && !label.startsWith('-') && !label.endsWith('-'));
  return valid && LETTER.test(labels[labels.length - 1] ?? '');
}

function hasHost(authority) {
  const host = HOST_AND_PORT.exec(authority)?.[1];
  return host !== undefined && isHostName(host);
}

/**
 * Match TREK's normalizePlaceWebsite: keep http(s), give a bare host or
 * protocol-relative address https, and drop every other scheme.
 */
function normalizePlaceWebsite(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  let url;
  if (HTTP_URL.test(text)) {
    url = text;
  } else if (text.startsWith('//')) {
    if (!hasHost(authorityOf(text.slice(2)))) return null;
    url = `https:${text}`;
  } else {
    if (!hasHost(authorityOf(text))) return null;
    url = `https://${text}`;
  }

  if (url.length > PLACE_WEBSITE_MAX_LENGTH) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function toSearchHit(place, requestedCategory) {
  const category = publicCategory(place.kind, requestedCategory);
  const website = normalizePlaceWebsite(place.website);
  return {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    ...(category ? { category } : {}),
    description: place.description,
    ...(website ? { website } : {}),
    ...(place.phone ? { phone: place.phone.slice(0, 60) } : {}),
    ...(place.alongM != null ? { alongKm: Math.round((place.alongM / 1000) * 100) / 100 } : {}),
    ...(place.offRouteM != null ? { distanceKm: Math.round((place.offRouteM / 1000) * 1000) / 1000 } : {}),
  };
}

async function searchWaterwayPlaces(request, runtime, options = {}) {
  const category = typeof request?.category === 'string' ? request.category : undefined;
  if (category && !WATERWAY_CORRIDOR_CATEGORIES.includes(category)) return [];

  const bounds = searchBounds(request);
  if (!bounds || bboxTooLarge(bounds)) return [];

  const queryText = typeof request?.query === 'string' ? request.query.trim().slice(0, 200) : '';
  const nameQuery = isCategoryQuery(queryText, category) ? '' : queryText;
  const limit = limitFrom(request?.limit);
  const overpassUrl = typeof runtime.config?.overpassUrl === 'string' ? runtime.config.overpassUrl : undefined;
  const overpassClient = options.overpassClient || createOverpassClient(runtime, { overpassUrl });
  const data = await overpassClient.fetchInterpreter(
    waterwayPlaceQuery(bounds),
    options.timeoutS ?? SEARCH_TIMEOUT_S,
    { signal: options.signal },
  );
  let places = extractPlaces(data?.elements || [])
    .filter((place) => matchesCategory(place.kind, category))
    .filter((place) => matchesQuery(place, nameQuery));

  if (Array.isArray(options.routeCoordinates)) {
    places = places
      .map((place) => projectPlaceToRoute(place, options.routeCoordinates, options.corridorM ?? 2500))
      .filter(Boolean)
      .sort((a, b) => a.alongM - b.alongM);
  }

  return places.slice(0, limit).map((place) => toSearchHit(place, category));
}

module.exports = {
  SEARCH_TIMEOUT_S,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  searchBounds,
  waterwayPlaceQuery,
  normalizePlaceWebsite,
  searchWaterwayPlaces,
};
