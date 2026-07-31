'use strict';

const { bboxWithPadding, haversineMeters, planarPointToSegmentMeters } = require('./geo');

const LOCK_COMPLEX_DEDUPE_CHAINAGE_M = 500;
const LOCK_COMPLEX_DEDUPE_DISTANCE_M = 400;

function routeLengthM(coords) {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineMeters(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
  }
  return total;
}

function routeBBox(coords, padM = 1000) {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lat, lng] of coords) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  if (!Number.isFinite(south)) return bboxWithPadding(0, 0, 0, 0, 0);
  return bboxWithPadding(south, west, north, east, padM);
}

function projectPointToPolyline(lat, lng, coords) {
  if (coords.length < 2) return null;
  let best = null;
  let chain = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const segLen = haversineMeters(a[0], a[1], b[0], b[1]);
    const p = planarPointToSegmentMeters(lat, lng, a[0], a[1], b[0], b[1]);
    const candidate = {
      distanceM: p.d,
      chainageM: chain + segLen * p.t,
      lat: p.qLat,
      lng: p.qLng,
    };
    if (!best || candidate.distanceM < best.distanceM) best = candidate;
    chain += segLen;
  }
  return best;
}

function tagValue(tags, keys) {
  if (!tags) return undefined;
  for (const key of keys) {
    const v = tags[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function normalizedLockLabel(name, ref) {
  const label = (name || ref || '').trim().toLowerCase();
  return label || null;
}

function lockDetailScore(lock) {
  return [
    lock.name,
    lock.ref,
    lock.tags.opening_hours,
    lock.tags.phone,
    lock.tags.website,
    lock.tags.vhf,
  ].filter(Boolean).length;
}

function elementCoord(el) {
  const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
  const lon = typeof el.lon === 'number' ? el.lon : el.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return { lat, lng: lon };
}

function extractLocksFromOsmElements(elements, coords, options = {}) {
  const locks = [];
  const seen = new Set();
  const lockCorridorM = options.lockCorridorM ?? 180;
  const defaultLockDelayMinutes = options.defaultLockDelayMinutes ?? 15;

  for (const raw of elements) {
    const el = raw;
    if (!el || typeof el.id !== 'number' || !el.type) continue;
    const tags = el.tags || {};
    const isLock = tags.waterway === 'lock_gate' || tags.lock === 'yes' || tags.water === 'lock' || tags.lock_name != null;
    if (!isLock) continue;

    const coord = elementCoord(el);
    if (!coord) continue;
    const projected = projectPointToPolyline(coord.lat, coord.lng, coords);
    if (!projected || projected.distanceM > lockCorridorM) continue;

    const dedupeKey = `${el.type}:${el.id}`;
    if (seen.has(dedupeKey)) continue;

    const name = tagValue(tags, ['lock_name', 'seamark:name', 'name']) ?? null;
    const ref = tagValue(tags, ['ref']) ?? null;
    const annotation = {
      id: dedupeKey,
      osmType: el.type,
      osmId: el.id,
      name,
      ref,
      lat: coord.lat,
      lng: coord.lng,
      chainageM: Math.round(projected.chainageM),
      delayS: Math.max(0, defaultLockDelayMinutes) * 60,
      tags: {
        opening_hours: tagValue(tags, ['opening_hours']),
        phone: tagValue(tags, ['phone', 'contact:phone']),
        website: tagValue(tags, ['website', 'contact:website']),
        vhf: tagValue(tags, ['vhf', 'contact:vhf', 'seamark:radio_station:channel']),
      },
    };

    const duplicateIndex = locks.findIndex((lock) => {
      const chainageDeltaM = Math.abs(lock.chainageM - projected.chainageM);
      if (chainageDeltaM >= LOCK_COMPLEX_DEDUPE_CHAINAGE_M) return false;
      const sameName = normalizedLockLabel(name, ref) != null
        && normalizedLockLabel(name, ref) === normalizedLockLabel(lock.name, lock.ref);
      if (sameName) return true;
      const physicalDistanceM = haversineMeters(coord.lat, coord.lng, lock.lat, lock.lng);
      const currentHasDetails = !!(name || ref || annotation.tags.opening_hours || annotation.tags.phone || annotation.tags.website || annotation.tags.vhf);
      const existingHasDetails = !!(lock.name || lock.ref || lock.tags.opening_hours || lock.tags.phone || lock.tags.website || lock.tags.vhf);
      return physicalDistanceM < LOCK_COMPLEX_DEDUPE_DISTANCE_M && (currentHasDetails || existingHasDetails);
    });

    if (duplicateIndex >= 0) {
      if (lockDetailScore(annotation) > lockDetailScore(locks[duplicateIndex])) {
        locks[duplicateIndex] = annotation;
      }
      continue;
    }

    seen.add(dedupeKey);
    locks.push(annotation);
  }

  locks.sort((a, b) => a.chainageM - b.chainageM);
  return locks;
}

async function fetchLocksForRoute(route, overpassClient, options = {}) {
  const bbox = routeBBox(route.coords, options.contextBboxPadM ?? 1000);
  const spanLat = Math.abs(bbox.north - bbox.south);
  const spanLng = Math.abs(bbox.east - bbox.west);
  if (spanLat > 2.8 || spanLng > 2.8) throw new Error('lock_bbox_too_large');

  const query = `
(
  node["waterway"="lock_gate"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["waterway"="lock_gate"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  relation["waterway"="lock_gate"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["lock"="yes"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["lock"="yes"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  relation["lock"="yes"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["water"="lock"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["water"="lock"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  relation["water"="lock"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out center tags;
`;
  const data = await overpassClient.fetchInterpreter(query.trim(), 25, { signal: options.signal });
  return extractLocksFromOsmElements(data?.elements || [], route.coords, options);
}

module.exports = {
  extractLocksFromOsmElements,
  fetchLocksForRoute,
  projectPointToPolyline,
  routeLengthM,
};
