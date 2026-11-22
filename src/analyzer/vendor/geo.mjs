// web/src/lib/geo.ts-ийн хуулбар (төрөл хассан) — гараар засахгүй: npm run sync-validator
// T3 WP-F (G-T3-13/14/15) — ерөнхий гео функц. cgi/src/expr/Geo.h ба schema/postgresql/99q-geo-tracking.sql (bj_geo_*)-тэй ЯГ ИЖИЛ
// дүрэм: cgi/tests/expr/vectors.json-ийн «geo:» мөрүүдийг гурвуулаа давна. Энэ файл import-гүй (Node шууд ажиллуулна — expr_vectors.mjs).
//   Цэг: «өргөрөг,уртраг» текст (widget: gps). Полигон: GeoJSON (Polygon | MultiPolygon | Feature), координат [уртраг, өргөрөг].
//   distance — WGS84 Vincenty, метр, 0.01 м (half-up); буруу цэг → null. inside — even-odd; буруу утга → false.
                                                    

const POINT_RE = /^\s*(-?[0-9]{1,2}(?:\.[0-9]+)?)\s*[,;]\s*(-?[0-9]{1,3}(?:\.[0-9]+)?)\s*$/;

export function parsePoint(v         )                {
  if (typeof v !== 'string') return null;
  const m = v.match(POINT_RE);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// Бүхэлтгэлгүй геодезийн зай (метр)
export function distanceRaw(p1        , p2        )         {
  const a = 6378137.0, f = 1 / 298.257223563, b = (1 - f) * a;
  const rad = Math.PI / 180.0;
  const L = (p2.lng - p1.lng) * rad;
  const U1 = Math.atan((1 - f) * Math.tan(p1.lat * rad)), U2 = Math.atan((1 - f) * Math.tan(p2.lat * rad));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let lambda = L, lambdaP        , sinSigma = 0, cosSigma = 0, sigma = 0, cosSqAlpha = 0, cos2SigmaM = 0;
  let iter = 0;
  do {
    const sinLambda = Math.sin(lambda), cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt((cosU2 * sinLambda) * (cosU2 * sinLambda) + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda));
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha !== 0 ? cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha : 0;
    const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    lambdaP = lambda;
    lambda = L + (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - lambdaP) > 1e-12 && ++iter < 200);
  if (iter >= 200) {
    const dLat = (p2.lat - p1.lat) * rad, dLng = (p2.lng - p1.lng) * rad;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(p1.lat * rad) * Math.cos(p2.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * 6371008.8 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
  const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) - B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  return b * A * (sigma - deltaSigma);
}

export const roundCm = (m        ) => Math.floor(m * 100 + 0.5) / 100;

export function geoDistance(a         , b         )                {
  const p = parsePoint(a), q = parsePoint(b);
  if (!p || !q) return null;
  return roundCm(distanceRaw(p, q));
}

                                            // [уртраг, өргөрөг]
                             

const readRing = (r         )              => {
  if (!Array.isArray(r)) return null;
  const out       = [];
  for (const c of r) {
    if (!Array.isArray(c) || c.length < 2 || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
    out.push([c[0], c[1]]);
  }
  return out.length >= 3 ? out : null;
};
const readPolygon = (coords         )                 => {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const out          = [];
  for (const r of coords) { const ring = readRing(r); if (!ring) return null; out.push(ring); }
  return out;
};

// GeoJSON текст → полигонууд; буруу бол []
export function parsePolygons(text         )            {
  if (typeof text !== 'string') return [];
  let j         ;
  try { j = JSON.parse(text); } catch { return []; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return [];
  let g = j                                                                 ;
  if (g.type === 'Feature' && g.geometry && typeof g.geometry === 'object') g = g.geometry            ;
  if (!('coordinates' in g)) return [];
  if (g.type === 'Polygon') { const p = readPolygon(g.coordinates); return p ? [p] : []; }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    const out            = [];
    for (const pc of g.coordinates) { const p = readPolygon(pc); if (!p) return []; out.push(p); }
    return out;
  }
  return [];
}

const inRing = (x        , y        , r      ) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
};

export function insidePolygons(p        , polys           )          {
  for (const poly of polys) {
    if (!inRing(p.lng, p.lat, poly[0])) continue;
    if (!poly.slice(1).some((h) => inRing(p.lng, p.lat, h))) return true;
  }
  return false;
}

export function geoInside(point         , polygon         )          {
  const p = parsePoint(point);
  if (!p) return false;
  return insidePolygons(p, parsePolygons(polygon));
}

// Полигоны GeoJSON (нэг гадна цагираг, хаалттай) — widget: polygon хадгалах хэлбэр
export function polygonGeoJson(points          )         {
  const ring = points.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
  if (ring.length) ring.push([...ring[0]]);
  return JSON.stringify({ type: 'Polygon', coordinates: [ring] });
}
