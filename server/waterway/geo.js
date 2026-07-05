'use strict';

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function interpolateLngLat(lat1, lng1, lat2, lng2, t) {
  return {
    lat: lat1 + (lat2 - lat1) * t,
    lng: lng1 + (lng2 - lng1) * t,
  };
}

function toLocalM(xyRefLatDeg, lat, lng) {
  const mPerDegLat = 111320;
  const mPerDegLng = Math.cos((xyRefLatDeg * Math.PI) / 180) * 111320;
  return { x: lng * mPerDegLng, y: lat * mPerDegLat };
}

function planarPointToSegmentMeters(pLat, pLng, aLat, aLng, bLat, bLng) {
  const midLat = (pLat + aLat + bLat) / 3;
  const p = toLocalM(midLat, pLat, pLng);
  const a = toLocalM(midLat, aLat, aLng);
  const b = toLocalM(midLat, bLat, bLng);
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  let t = len2 <= 1e-12 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + t * vx;
  const qy = a.y + t * vy;
  const d = Math.hypot(p.x - qx, p.y - qy);
  const { lat: qLat, lng: qLng } = interpolateLngLat(aLat, aLng, bLat, bLng, t);
  return { d, t, qLat, qLng };
}

function bboxWithPadding(lat1, lng1, lat2, lng2, padMeters) {
  const midLat = (lat1 + lat2) / 2;
  const dLatPad = padMeters / 111320;
  const cos = Math.cos((midLat * Math.PI) / 180);
  const dLngPad = padMeters / (Math.max(1e-6, cos) * 111320);
  const minLat = Math.min(lat1, lat2);
  const maxLat = Math.max(lat1, lat2);
  const minLng = Math.min(lng1, lng2);
  const maxLng = Math.max(lng1, lng2);
  return {
    south: minLat - dLatPad,
    north: maxLat + dLatPad,
    west: minLng - dLngPad,
    east: maxLng + dLngPad,
  };
}

module.exports = {
  haversineMeters,
  interpolateLngLat,
  planarPointToSegmentMeters,
  bboxWithPadding,
};
