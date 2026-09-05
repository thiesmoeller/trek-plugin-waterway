'use strict';

const { bboxWithPadding, haversineMeters, planarPointToSegmentMeters } = require('./geo');

const defaultCache = new Map();
const WATERWAY_RE = /^(river|canal|fairway|tidal_channel)$/i;
const HARD_BARRIER_RE = /^(dam|weir|waterfall|hazard)$/i;
const PROFILE_DEFAULT = 'canoe';
const PORTAGE_WEIGHT = 3.5;
const MAX_PORTAGE_M = 1500;
const ACCESS_POINT_RADIUS_M = 750;

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

function normalizeProfile(profile) {
  if (profile === 'waterway') return PROFILE_DEFAULT;
  return ['canoe', 'kayak', 'rowing'].includes(profile) ? profile : PROFILE_DEFAULT;
}

function tag(tags, key) {
  const v = tags?.[key];
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function isDenied(v) {
  return ['no', 'private', 'customers', 'discouraged'].includes(v);
}

function isAllowedPortage(v) {
  return ['yes', 'designated', 'permissive'].includes(v);
}

function rapidGrade(tags) {
  const raw = tag(tags, 'whitewater:rapid_grade') || tag(tags, 'whitewater');
  const m = raw.match(/\d+/);
  return m ? Number(m[0]) : null;
}

function waterwayKind(tags) {
  const ww = tag(tags, 'waterway');
  if (WATERWAY_RE.test(ww) || ww === 'canoe_pass') return ww;
  if (tag(tags, 'natural') === 'water' && /^(river|canal|tidal)$/i.test(tag(tags, 'water'))) return tag(tags, 'water');
  return '';
}

function isAccessPoint(el) {
  const tags = el?.tags || {};
  return tag(tags, 'waterway') === 'access_point'
    || tag(tags, 'leisure') === 'slipway'
    || ['put_in', 'egress', 'yes', 'designated', 'permissive'].includes(tag(tags, 'canoe'));
}

function edgePolicy(tags, profile) {
  const ww = tag(tags, 'waterway');
  const kind = waterwayKind(tags);
  const portage = tag(tags, 'portage');
  const isPortage = isAllowedPortage(portage) && profile !== 'rowing';
  if (isPortage) return { allowed: true, kind: 'portage', warning: 'mapped portage' };

  if (!kind) return { allowed: false };
  if (HARD_BARRIER_RE.test(ww)) return { allowed: false };

  const craftAccess = tag(tags, profile) || tag(tags, profile === 'kayak' ? 'canoe' : profile) || tag(tags, 'canoe') || tag(tags, 'boat') || tag(tags, 'access');
  if (isDenied(craftAccess)) return { allowed: false };

  const grade = rapidGrade(tags);
  if (grade != null) {
    if (profile === 'rowing' || grade > 1) return { allowed: false };
    return { allowed: true, kind: 'water', warning: `whitewater grade ${grade}` };
  }
  if (ww === 'rapids') return { allowed: profile !== 'rowing', kind: 'water', warning: 'rapids' };
  if (ww === 'canoe_pass') return { allowed: profile !== 'rowing', kind: 'water', warning: 'canoe pass' };

  return { allowed: true, kind: 'water' };
}

function addDirectedEdge(edges, from, to, weight, distanceM, kind, warning) {
  const k = `${from}->${to}`;
  const cur = edges.get(k);
  if (!cur || weight < cur.w) edges.set(k, { a: from, b: to, w: weight, distanceM, kind, warning });
}

function buildProfiledWaterwayEdges(elements, profile = PROFILE_DEFAULT) {
  profile = normalizeProfile(profile);
  const pos = new Map();
  const edges = new Map();
  const accessPoints = [];

  for (const el of elements) {
    const e = el;
    if (e?.type === 'node' && typeof e.id === 'number' && typeof e.lat === 'number' && typeof e.lon === 'number') {
      pos.set(String(e.id), { lat: e.lat, lng: e.lon });
      if (isAccessPoint(e)) accessPoints.push({ id: String(e.id), lat: e.lat, lng: e.lon, name: e.tags?.name });
    }
  }

  for (const el of elements) {
    const w = el;
    if (w?.type !== 'way' || !Array.isArray(w.nodes) || w.nodes.length < 2) continue;
    const policy = edgePolicy(w.tags || {}, profile);
    if (!policy.allowed) continue;
    const factor = policy.kind === 'portage' ? PORTAGE_WEIGHT : 1;
    const oneway = tag(w.tags, 'oneway:canoe') || tag(w.tags, 'oneway:boat') || tag(w.tags, 'oneway');

    for (let i = 0; i < w.nodes.length - 1; i++) {
      const na = String(w.nodes[i]);
      const nb = String(w.nodes[i + 1]);
      const pa = pos.get(na);
      const pb = pos.get(nb);
      if (!pa || !pb) continue;
      const dist = haversineMeters(pa.lat, pa.lng, pb.lat, pb.lng);
      if (oneway === 'yes' || oneway === '1' || oneway === 'true') {
        addDirectedEdge(edges, na, nb, dist * factor, dist, policy.kind, policy.warning);
      } else if (oneway === '-1' || oneway === 'reverse') {
        addDirectedEdge(edges, nb, na, dist * factor, dist, policy.kind, policy.warning);
      } else {
        addDirectedEdge(edges, na, nb, dist * factor, dist, policy.kind, policy.warning);
        addDirectedEdge(edges, nb, na, dist * factor, dist, policy.kind, policy.warning);
      }
    }
  }

  return { pos, edges, accessPoints };
}

function buildUndirectedWaterwayEdges(elements) {
  const profiled = buildProfiledWaterwayEdges(elements, PROFILE_DEFAULT);
  const edges = new Map();
  for (const e of profiled.edges.values()) {
    if (e.kind !== 'water') continue;
    const [a, b] = canonPair(e.a, e.b);
    const k = `${a}|${b}`;
    const cur = edges.get(k);
    if (!cur || e.distanceM < cur.w) edges.set(k, { a, b, w: e.distanceM });
  }
  return { pos: profiled.pos, edges };
}

function splitAtPoint(pos, edges, plat, plng, virtualId, snapMaxM) {
  let bestKey = null;
  let bestD = Infinity;
  let bestQ = { lat: 0, lng: 0 };
  let bestA = '';
  let bestB = '';

  const seenPairs = new Set();
  for (const [k, e] of edges) {
    const pairKey = canonPair(e.a, e.b).join('|');
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
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

  const forward = edges.get(`${bestA}->${bestB}`);
  const reverse = edges.get(`${bestB}->${bestA}`);
  edges.delete(`${bestA}->${bestB}`);
  edges.delete(`${bestB}->${bestA}`);
  edges.delete(bestKey);
  pos.set(virtualId, bestQ);

  const pa = pos.get(bestA);
  const pb = pos.get(bestB);

  const wAv = haversineMeters(pa.lat, pa.lng, bestQ.lat, bestQ.lng);
  const wBv = haversineMeters(bestQ.lat, bestQ.lng, pb.lat, pb.lng);

  if (forward) {
    const factor = forward.w / Math.max(forward.distanceM, 1);
    addDirectedEdge(edges, bestA, virtualId, wAv * factor, wAv, forward.kind, forward.warning);
    addDirectedEdge(edges, virtualId, bestB, wBv * factor, wBv, forward.kind, forward.warning);
  }
  if (reverse) {
    const factor = reverse.w / Math.max(reverse.distanceM, 1);
    addDirectedEdge(edges, bestB, virtualId, wBv * factor, wBv, reverse.kind, reverse.warning);
    addDirectedEdge(edges, virtualId, bestA, wAv * factor, wAv, reverse.kind, reverse.warning);
  }

  return { ok: true };
}

function buildAdjacency(edges) {
  const adjacency = new Map();
  for (const { a, b, w } of edges.values()) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a).push({ id: b, w });
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
    d += edges.get(`${path[i]}->${path[i + 1]}`)?.distanceM ?? 0;
  }
  return d;
}

function pathMeta(edges, path) {
  const warnings = new Set();
  const viaPoints = [];
  let portageM = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const edge = edges.get(`${path[i]}->${path[i + 1]}`);
    if (!edge) continue;
    if (edge.kind === 'portage') portageM += edge.distanceM;
    if (edge.warning) warnings.add(edge.warning);
  }
  return { warnings: [...warnings], viaPoints, portageM };
}

function nearAccessPoint(accessPoints, point) {
  let best = null;
  for (const access of accessPoints) {
    const d = haversineMeters(point.lat, point.lng, access.lat, access.lng);
    if (d <= ACCESS_POINT_RADIUS_M && (!best || d < best.distanceM)) best = { ...access, distanceM: d };
  }
  return best;
}

async function routeWaterwayLeg(from, to, options) {
  const profile = normalizeProfile(options.profile);
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
  let usedStaleData = false;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < cacheTtlMs) {
    hit.at = now;
    cache.set(cacheKey, hit);
    elements = hit.elements;
    usedStaleData = hit.stale === true;
  } else {
    const overpassTimeoutS = options.overpassTimeoutS ?? 12;
    const queryFixed = `
(
  way["waterway"~"^(river|canal|fairway|tidal_channel)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["waterway"~"^(canoe_pass|dam|weir|waterfall|rapids|hazard)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["natural"="water"]["water"~"^(river|canal|tidal)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["portage"~"^(yes|designated|permissive)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["waterway"="access_point"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["leisure"="slipway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["canoe"~"^(put_in|egress|yes|designated|permissive)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["waterway"="lock_gate"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["waterway"="lock_gate"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["lock"="yes"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["lock"="yes"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["water"="lock"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["water"="lock"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
(._;>;);
out body center;
`;
    const data = await options.overpassClient.fetchInterpreter(queryFixed.trim(), overpassTimeoutS, { signal: options.signal });
    if (!data?.elements?.length) throw new Error('waterway_no_data');
    elements = data.elements;
    usedStaleData = data.stale === true;
    cache.set(cacheKey, { at: now, elements, stale: usedStaleData });
    trimCache(cache, cacheMax);
  }

  if (!elements?.length) throw new Error('waterway_no_data');

  const base = buildProfiledWaterwayEdges(elements, profile);
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
  const meta = pathMeta(edges, path);
  if (meta.portageM > MAX_PORTAGE_M) throw new Error('waterway_portage_too_long');

  if (coords.length < 2) throw new Error('waterway_short_path');

  if (!nearAccessPoint(base.accessPoints, from)) meta.warnings.push('No mapped put-in nearby');
  if (!nearAccessPoint(base.accessPoints, to)) meta.warnings.push('No mapped take-out nearby');
  if (usedStaleData) meta.warnings.push('Using cached OSM data; live Overpass unavailable');

  return { coords, distanceM, warnings: meta.warnings, viaPoints: meta.viaPoints, elements, stale: usedStaleData };
}

module.exports = {
  buildProfiledWaterwayEdges,
  buildUndirectedWaterwayEdges,
  routeWaterwayLeg,
};
