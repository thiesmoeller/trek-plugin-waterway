'use strict';

/** TREK plugin-routes.controller whole-result budgets. Exceeding vertices rejects the route. */
const MAX_COORDINATES = 10_000;
const MAX_VIAS = 40;
const MAX_NOTE_CHARS = 120;
const MAX_LABEL_CHARS = 80;

/** Host invoke timeout is 20 s; leave a little headroom for JSON/RPC. */
const ROUTE_BUDGET_MS = 18_000;
const OVERPASS_TIMEOUT_S = 12;

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function formatKm(distanceM) {
  const km = Math.max(0, Number(distanceM) || 0) / 1000;
  if (km >= 100) return `${Math.round(km)} km`;
  if (km >= 10) return `${km.toFixed(1)} km`;
  return `${km.toFixed(1)} km`;
}

function capText(value, max) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length <= max ? text : text.slice(0, max);
}

function capNote(parts) {
  return capText(parts.filter(Boolean).join('; '), MAX_NOTE_CHARS);
}

function waterwayMidpoint(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  return coords[Math.floor((coords.length - 1) / 2)] || coords[0];
}

/**
 * Keep the first and last vertex and evenly sample the rest so TREK does not
 * discard the whole route for exceeding the 10000-vertex budget.
 */
function capCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length <= MAX_COORDINATES) return coords || [];
  const lastIndex = coords.length - 1;
  const out = [];
  const inner = MAX_COORDINATES - 2;
  out.push(coords[0]);
  for (let i = 0; i < inner; i++) {
    const src = 1 + Math.round((i * (lastIndex - 2)) / Math.max(inner - 1, 1));
    out.push(coords[src]);
  }
  out.push(coords[lastIndex]);
  return out;
}

function durationViaPoint(coords, durationS, distanceM) {
  const mid = waterwayMidpoint(coords);
  if (!mid) return null;
  const label = capText(`${formatDuration(durationS)} · ${formatKm(distanceM)}`, MAX_LABEL_CHARS);
  return {
    lat: mid[0],
    lng: mid[1],
    label,
    tone: 'success',
  };
}

function lockViaPoint(lock) {
  return {
    lat: lock.lat,
    lng: lock.lng,
    label: capText(lock.name || lock.ref || 'Lock', MAX_LABEL_CHARS),
    tone: 'warn',
    dwellSeconds: lock.delayS,
  };
}

function pushVia(viaPoints, point) {
  if (!point || viaPoints.length >= MAX_VIAS) return;
  viaPoints.push(point);
}

module.exports = {
  MAX_COORDINATES,
  MAX_VIAS,
  MAX_NOTE_CHARS,
  MAX_LABEL_CHARS,
  ROUTE_BUDGET_MS,
  OVERPASS_TIMEOUT_S,
  formatDuration,
  formatKm,
  capText,
  capNote,
  waterwayMidpoint,
  capCoordinates,
  durationViaPoint,
  lockViaPoint,
  pushVia,
};
