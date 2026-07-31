'use strict';

const { bboxWithPadding, haversineMeters, planarPointToSegmentMeters } = require('./geo');

const defaultCache = new Map();

function trimCache(cache, cacheMax) {
  if (cache.size <= cacheMax) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
  while (sorted.length > cacheMax) {
    const k = sorted.shift()?.[0];
    if (k) cache.delete(k);
  }
}

function canonPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function buildUndirectedWaterwayEdges(elements) {
  const pos = new Map();
  const edges = new Map();

  for (const el of elements) {
    const e = el;
    if (e?.type === 'node' && typeof e.id === 'number' && typeof e.lat === 'number' && typeof e.lon === 'number') {
      pos.set(String(e.id), { lat: e.lat, lng: e.lon });
    }
  }

  for (const el of elements) {
    const w = el;
    if (w?.type !== 'way' || !Array.isArray(w.nodes) || w.nodes.length < 2) continue;
    const ww = w.tags?.waterway;
    if (!ww || !/^(river|canal|fairway|tidal_channel)$/i.test(ww)) continue;

    for (let i = 0; i < w.nodes.length - 1; i++) {
      const na = String(w.nodes[i]);
      const nb = String(w.nodes[i + 1]);
      const pa = pos.get(na);
      const pb = pos.get(nb);
      if (!pa || !pb) continue;
      const dist = haversineMeters(pa.lat, pa.lng, pb.lat, pb.lng);
      const [ca, cb] = canonPair(na, nb);
      const k = `${ca}|${cb}`;
      const cur = edges.get(k);
      if (!cur || dist < cur.w) edges.set(k, { a: ca, b: cb, w: dist });
    }
  }

  return { pos, edges };
}

function splitAtPoint(pos, edges, plat, plng, virtualId, snapMaxM) {
  let bestKey = null;
  let bestD = Infinity;
  let bestQ = { lat: 0, lng: 0 };
  let bestA = '';
  let bestB = '';

  for (const [k, e] of edges) {
    const pa = pos.get(e.a);
    const pb = pos.get(e.b);
    if (!pa || !pb) continue;
    const { d, qLat, qLng } = planarPointToSegmentMeters(plat, plng, pa.lat, pa.lng, pb.lat, pb.lng);
    if (d < bestD) {
      bestD = d;
      bestKey = k;
      bestQ = { lat: qLat, lng: qLng };
      bestA = e.a;
      bestB = e.b;
    }
  }

  if (!bestKey || bestD > snapMaxM) {
    return { ok: false, reason: bestD > snapMaxM ? 'snap_too_far' : 'no_edges' };
  }

  edges.delete(bestKey);
  pos.set(virtualId, bestQ);

  const pa = pos.get(bestA);
  const pb = pos.get(bestB);

  const wAv = haversineMeters(pa.lat, pa.lng, bestQ.lat, bestQ.lng);
  const wBv = haversineMeters(bestQ.lat, bestQ.lng, pb.lat, pb.lng);

  const [c1a, c1b] = canonPair(virtualId, bestA);
  edges.set(`${c1a}|${c1b}`, { a: c1a, b: c1b, w: wAv });

  const [c2a, c2b] = canonPair(virtualId, bestB);
  edges.set(`${c2a}|${c2b}`, { a: c2a, b: c2b, w: wBv });

  return { ok: true };
}

function buildAdjacency(edges) {
  const adjacency = new Map();
  for (const { a, b, w } of edges.values()) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push({ id: b, w });
    adjacency.get(b).push({ id: a, w });
  }
  return adjacency;
}

function shortestPath(edges, start, end) {
  const adjacency = buildAdjacency(edges);
  const dist = new Map();
  const prev = new Map();
  const unvisited = new Set(adjacency.keys());
  for (const id of unvisited) dist.set(id, Infinity);
  dist.set(start, 0);

  while (unvisited.size > 0) {
    let cur = null;
    let curDist = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id) ?? Infinity;
      if (d < curDist) {
        cur = id;
        curDist = d;
      }
    }
    if (!cur || curDist === Infinity) break;
    if (cur === end) break;
    unvisited.delete(cur);
    for (const next of adjacency.get(cur) ?? []) {
      if (!unvisited.has(next.id)) continue;
      const alt = curDist + next.w;
      if (alt < (dist.get(next.id) ?? Infinity)) {
        dist.set(next.id, alt);
        prev.set(next.id, cur);
      }
    }
  }

  if (start !== end && !prev.has(end)) return null;
  const path = [end];
  while (path[0] !== start) {
    const p = prev.get(path[0]);
    if (!p) return null;
    path.unshift(p);
  }
  return path;
}

function pathToCoords(pos, path) {
  const out = [];
  for (const id of path) {
    const attrs = pos.get(id);
    if (!attrs) continue;
    const lat = attrs.lat;
    const lng = attrs.lng;
    const last = out[out.length - 1];
    if (!last || last[0] !== lat || last[1] !== lng) out.push([lat, lng]);
  }
  return out;
}

function pathDistanceM(edges, path) {
  let d = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [a, b] = canonPair(path[i], path[i + 1]);
    d += edges.get(`${a}|${b}`)?.w ?? 0;
  }
  return d;
}

async function routeWaterwayLeg(from, to, options) {
  const snapMaxM = options.snapMaxM ?? 2500;
  const bboxPadM = options.bboxPadM ?? 4000;
  const cacheTtlMs = options.cacheTtlMs ?? 1000 * 60 * 45;
  const cacheMax = options.cacheMax ?? 64;
  const cache = options.cache ?? defaultCache;
  const legKey = options.legKey ?? `${from.lat},${from.lng}:${to.lat},${to.lng}`;

  const bbox = bboxWithPadding(from.lat, from.lng, to.lat, to.lng, bboxPadM);
  const spanLat = Math.abs(bbox.north - bbox.south);
  const spanLng = Math.abs(bbox.east - bbox.west);
  if (spanLat > 2.5 || spanLng > 2.5) {
    throw new Error('waterway_bbox_too_large');
  }

  const cacheKey = `${legKey}|${bbox.south.toFixed(3)}|${bbox.west.toFixed(3)}|${bbox.north.toFixed(3)}|${bbox.east.toFixed(3)}`;
  let elements = null;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < cacheTtlMs) {
    hit.at = now;
    cache.set(cacheKey, hit);
    elements = hit.elements;
  } else {
    const queryFixed = `
(
  way["waterway"~"^(river|canal|fairway|tidal_channel)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["natural"="water"]["water"~"^(river|canal|tidal)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
(._;>;);
out body;
`;
    const data = await options.overpassClient.fetchInterpreter(queryFixed.trim(), 35, { signal: options.signal });
    if (!data?.elements?.length) throw new Error('waterway_no_data');
    elements = data.elements;
    cache.set(cacheKey, { at: now, elements });
    trimCache(cache, cacheMax);
  }

  if (!elements?.length) throw new Error('waterway_no_data');

  const base = buildUndirectedWaterwayEdges(elements);
  const pos = new Map(base.pos);
  const edges = new Map(base.edges);

  const vStart = `__snap_${legKey}_s`;
  const vEnd = `__snap_${legKey}_e`;

  const s1 = splitAtPoint(pos, edges, from.lat, from.lng, vStart, snapMaxM);
  if (s1.ok === false) throw new Error(s1.reason === 'snap_too_far' ? 'waterway_snap_too_far_a' : 'waterway_snap_fail_a');

  const s2 = splitAtPoint(pos, edges, to.lat, to.lng, vEnd, snapMaxM);
  if (s2.ok === false) throw new Error(s2.reason === 'snap_too_far' ? 'waterway_snap_too_far_b' : 'waterway_snap_fail_b');

  let path;
  try {
    const pth = shortestPath(edges, vStart, vEnd);
    if (!pth?.length || pth.length < 2) throw new Error('no_path');
    path = pth;
  } catch {
    throw new Error('waterway_no_path');
  }

  const coords = pathToCoords(pos, path);
  const distanceM = pathDistanceM(edges, path);

  if (coords.length < 2) throw new Error('waterway_short_path');

  return { coords, distanceM };
}

module.exports = {
  buildUndirectedWaterwayEdges,
  routeWaterwayLeg,
};
