'use strict';

const { haversineMeters, interpolateLngLat } = require('./geo');
const { extractPlaces, projectPlaceToRoute } = require('./places');

const DEFAULT_MAX_DAY_KM = 25;
const MIN_DAY_KM = 5;
const MAX_DAY_KM = 80;
const MAX_PLAN_DAYS = 30;
const LANDING_CORRIDOR_M = 400;
const SHORT_DAY_RATIO = 0.55;

function boundedDayKm(value, fallback = DEFAULT_MAX_DAY_KM) {
  const km = Number(value);
  if (!Number.isFinite(km)) return fallback;
  return Math.min(MAX_DAY_KM, Math.max(MIN_DAY_KM, km));
}

function routeChainage(coords) {
  const nodes = [];
  let chain = 0;
  for (let i = 0; i < (coords || []).length; i++) {
    const [lat, lng] = coords[i];
    if (i > 0) chain += haversineMeters(coords[i - 1][0], coords[i - 1][1], lat, lng);
    nodes.push({ lat, lng, chainageM: chain });
  }
  return { nodes, totalM: chain };
}

function pointAtChainage(coords, targetM) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  let chain = 0;
  const last = coords[coords.length - 1];
  if (targetM <= 0) return { lat: coords[0][0], lng: coords[0][1], chainageM: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const seg = haversineMeters(a[0], a[1], b[0], b[1]);
    if (chain + seg >= targetM) {
      const t = seg <= 0 ? 0 : (targetM - chain) / seg;
      const point = interpolateLngLat(a[0], a[1], b[0], b[1], t);
      return { lat: point.lat, lng: point.lng, chainageM: targetM };
    }
    chain += seg;
  }
  return { lat: last[0], lng: last[1], chainageM: chain };
}

function globalLocks(route) {
  let offset = 0;
  const locks = [];
  for (let i = 0; i < (route.planningLegs || []).length; i++) {
    const leg = route.planningLegs[i];
    for (const lock of leg.locks || []) {
      locks.push({
        name: lock.name || lock.ref || 'Lock',
        lat: lock.lat,
        lng: lock.lng,
        chainageM: offset + (Number(lock.chainageM) || 0),
        openingHours: lock.tags?.opening_hours,
      });
    }
    offset += route.legs[i]?.distance || 0;
  }
  return locks;
}

function durationForSpan(startM, endM, { speedKmh, lockMinutes, locks }) {
  const distanceM = Math.max(0, endM - startM);
  const paddling = distanceM / ((speedKmh * 1000) / 3600);
  const lockCount = locks.filter((lock) => lock.chainageM > startM && lock.chainageM <= endM).length;
  return paddling + lockCount * lockMinutes * 60;
}

function landingCandidates(route) {
  const coords = route.coordinates;
  const { totalM } = routeChainage(coords);
  const candidates = new Map();

  const remember = (candidate) => {
    if (!candidate || candidate.chainageM < 0 || candidate.chainageM > totalM) return;
    const key = `${candidate.kind}:${Math.round(candidate.chainageM / 40)}`;
    const prev = candidates.get(key);
    if (!prev || (candidate.kind === 'landing' && prev.kind !== 'landing')) candidates.set(key, candidate);
  };

  remember({
    kind: 'waypoint',
    name: route.waypoints[0]?.name || 'Start',
    lat: coords[0][0],
    lng: coords[0][1],
    chainageM: 0,
  });
  remember({
    kind: 'waypoint',
    name: route.waypoints.at(-1)?.name || 'Finish',
    lat: coords[coords.length - 1][0],
    lng: coords[coords.length - 1][1],
    chainageM: totalM,
  });

  let offset = 0;
  for (let i = 0; i < route.waypoints.length; i++) {
    const waypoint = route.waypoints[i];
    remember({
      kind: 'waypoint',
      name: waypoint.name || `Waypoint ${i + 1}`,
      lat: waypoint.lat,
      lng: waypoint.lng,
      chainageM: offset,
    });
    if (i < route.legs.length) offset += route.legs[i].distance;
  }

  const elements = (route.planningLegs || []).flatMap((leg) => leg.elements || []);
  for (const place of extractPlaces(elements)) {
    if (place.kind !== 'landing' && place.kind !== 'club') continue;
    const projected = projectPlaceToRoute(place, coords, LANDING_CORRIDOR_M);
    if (!projected) continue;
    remember({
      kind: 'landing',
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      chainageM: projected.alongM,
    });
  }

  return [...candidates.values()].sort((a, b) => a.chainageM - b.chainageM);
}

function pickOvernight(candidates, startM, limitM, totalM) {
  const windowStart = startM + Math.min((limitM - startM) * SHORT_DAY_RATIO, limitM - startM - 500);
  const inWindow = candidates.filter((candidate) => (
    candidate.chainageM > startM + 250
    && candidate.chainageM <= limitM + 50
    && candidate.chainageM < totalM - 250
  ));
  const preferred = inWindow.filter((candidate) => candidate.chainageM >= windowStart);
  const pool = preferred.length ? preferred : inWindow;
  if (!pool.length) return null;
  return pool.reduce((best, candidate) => (candidate.chainageM > best.chainageM ? candidate : best));
}

function planWaterwayDays(route, options = {}) {
  const coords = route?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || !Array.isArray(route.waypoints) || route.waypoints.length < 2) {
    return {
      maxDayKm: boundedDayKm(options.maxDayKm, DEFAULT_MAX_DAY_KM),
      maxDayMinutes: Number(options.maxDayMinutes) > 0 ? Number(options.maxDayMinutes) : null,
      complete: false,
      totalDistanceMetres: 0,
      totalDurationSeconds: 0,
      days: [],
      warnings: ['no_route_geometry'],
    };
  }
  const maxDayKm = boundedDayKm(options.maxDayKm, DEFAULT_MAX_DAY_KM);
  const maxDayM = maxDayKm * 1000;
  const maxDaySeconds = Number(options.maxDayMinutes) > 0 ? Number(options.maxDayMinutes) * 60 : Infinity;
  const speedKmh = options.speedKmh || 5;
  const lockMinutes = options.lockMinutes || 25;
  const { totalM } = routeChainage(coords);
  const locks = globalLocks(route);
  const candidates = landingCandidates(route);
  const days = [];
  const warnings = [];
  let startM = 0;
  let incomplete = false;

  while (startM < totalM - 50 && days.length < MAX_PLAN_DAYS) {
    const remainingM = totalM - startM;
    let limitM = Math.min(totalM, startM + maxDayM);
    while (
      limitM > startM + 500
      && durationForSpan(startM, limitM, { speedKmh, lockMinutes, locks }) > maxDaySeconds
    ) {
      limitM -= Math.max(400, (limitM - startM) * 0.08);
    }

    const isLast = remainingM <= maxDayM + 50
      && durationForSpan(startM, totalM, { speedKmh, lockMinutes, locks }) <= maxDaySeconds;
    let overnight;
    if (isLast) {
      overnight = {
        kind: 'waypoint',
        name: route.waypoints.at(-1)?.name || 'Finish',
        lat: coords[coords.length - 1][0],
        lng: coords[coords.length - 1][1],
        chainageM: totalM,
      };
    } else {
      overnight = pickOvernight(candidates, startM, limitM, totalM);
      if (!overnight) {
        const forced = pointAtChainage(coords, limitM);
        overnight = {
          kind: 'split',
          name: `Km ${(limitM / 1000).toFixed(1)} split`,
          lat: forced.lat,
          lng: forced.lng,
          chainageM: limitM,
        };
        warnings.push(`Day ${days.length + 1}: no mapped landing near the ${maxDayKm} km cap; split on the waterway.`);
      }
    }

    const startPoint = pointAtChainage(coords, startM);
    const distanceM = overnight.chainageM - startM;
    const durationSeconds = durationForSpan(startM, overnight.chainageM, { speedKmh, lockMinutes, locks });
    const dayLocks = locks.filter((lock) => lock.chainageM > startM && lock.chainageM <= overnight.chainageM);
    days.push({
      dayNumber: days.length + 1,
      distanceMetres: Math.round(distanceM),
      durationSeconds: Math.round(durationSeconds),
      lockCount: dayLocks.length,
      from: {
        name: days.length ? days[days.length - 1].to.name : (route.waypoints[0]?.name || 'Start'),
        lat: startPoint.lat,
        lng: startPoint.lng,
      },
      to: {
        name: overnight.name,
        lat: overnight.lat,
        lng: overnight.lng,
        kind: overnight.kind,
      },
      locks: dayLocks.map((lock) => ({
        name: lock.name,
        lat: lock.lat,
        lng: lock.lng,
        ...(lock.openingHours ? { openingHours: lock.openingHours } : {}),
      })),
    });
    startM = overnight.chainageM;
  }

  if (startM < totalM - 50) {
    incomplete = true;
    warnings.push(`Stopped after ${MAX_PLAN_DAYS} days; raise maxDayKm or split the remaining ${((totalM - startM) / 1000).toFixed(1)} km by hand.`);
  }

  return {
    maxDayKm,
    maxDayMinutes: Number.isFinite(maxDaySeconds) && maxDaySeconds < Infinity ? maxDaySeconds / 60 : null,
    complete: !incomplete,
    totalDistanceMetres: Math.round(totalM),
    totalDurationSeconds: Math.round(durationForSpan(0, Math.min(startM, totalM), { speedKmh, lockMinutes, locks })),
    days,
    warnings,
  };
}

module.exports = {
  DEFAULT_MAX_DAY_KM,
  MIN_DAY_KM,
  MAX_DAY_KM,
  MAX_PLAN_DAYS,
  boundedDayKm,
  routeChainage,
  pointAtChainage,
  planWaterwayDays,
};
