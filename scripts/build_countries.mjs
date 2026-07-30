#!/usr/bin/env node
/**
 * Rebuilds assets/data/countries.geojson (and iso3to2.json) for CartoGuesser
 * from Natural Earth 1:50m via the `world-atlas` package.
 *
 *   cd scripts && npm install && node build_countries.mjs
 *
 * The previous dataset was Natural Earth 1:110m, which drops ~30 sovereign
 * states outright — every Caribbean micro-state, all of Micronesia and
 * Polynesia, Singapore, Malta, Andorra, Bahrain, Maldives and friends. 1:50m
 * carries them, at the cost of ~10x the raw size, so this script simplifies.
 *
 * Simplification is split by feature size on purpose: a single global
 * percentage ranks vertices across the whole world, so Vatican City and
 * Singapore get flattened into quadrilaterals long before Russia loses any
 * meaningful shape. Anything smaller than SMALL_SPAN_DEG keeps its full
 * geometry (it costs almost nothing) and only the big countries are thinned.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import mapshaper from 'mapshaper';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'assets', 'data');

const SIMPLIFY_PCT   = '20%';    // vertex budget kept for large countries
const PRECISION      = 0.0005;   // ~55 m, enough for a clickable Vatican City
const SMALL_SPAN_DEG = 3;        // below this bbox span, keep full detail

/* Natural Earth entities with no ISO 3166-1 code. Kosovo gets the widely used
   user-assigned XKX; the rest are disputed or uninhabited and stay unplayable. */
const BY_NAME = {
  'Kosovo':             { id: 'XKX', name: 'Kosovo' },
  'Somaliland':         { id: 'SOMALILAND', name: 'Somaliland' },
  'N. Cyprus':          { id: 'NCYPRUS', name: 'Northern Cyprus' },
  'Indian Ocean Ter.':  { id: 'IOT-AU', name: 'Indian Ocean Territories' },
  'Siachen Glacier':    { id: 'SIACHEN', name: 'Siachen Glacier' }
};

/* Countries missing from 1:50m that the region lists actually need. */
const GRAFT_FROM_10M = new Set(['TUV']);
const MAX_EAST_CENTRE = 200;   // beyond this the country has left the map, not the seam

/**
 * Leaflet draws vector layers at their literal longitude and (with world copies
 * off) never repeats them, so a country that straddles the 180° seam gets torn
 * in half: Russia's Chukotka lands on the far LEFT of the map, 360° away from
 * the rest of the country. Fixing it means picking the dominant landmass and
 * shifting the stragglers to sit next to it — Chukotka moves to lng 180..191,
 * the Aleutian tips move to -188, and every country becomes contiguous.
 *
 * Shifting whichever side is smaller matters: blanket-normalising to [0,360)
 * would teleport the whole continental US to the right-hand edge.
 */
const polygons = (geom) => geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
const shiftLngs = (coords, delta) => {
  (function walk(c){
    if(typeof c[0] === 'number'){ c[0] += delta; return; }
    for(const x of c) walk(x);
  })(coords);
};
const lngStats = (coords) => {
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  (function walk(c){
    if(typeof c[0] === 'number'){
      if(c[0] < min) min = c[0];
      if(c[0] > max) max = c[0];
      sum += c[0]; n++;
      return;
    }
    for(const x of c) walk(x);
  })(coords);
  return { min, max, mean: sum / n, span: max - min };
};

function healAntimeridian(features){
  const healed = [];
  for(const f of features){
    if(f.id === 'ATA') continue;                    // legitimately spans the globe
    if(lngStats(f.geometry.coordinates).span < 180) continue;

    // 1. Unwrap each ring. Natural Earth has rings that themselves jump the seam
    //    mid-ring (Russia's is one), so a whole-polygon shift can't fix them.
    for(const part of polygons(f.geometry)){
      for(const ring of part){
        let offset = 0;
        for(let i = 1; i < ring.length; i++){
          const step = (ring[i][0] + offset) - ring[i - 1][0];
          if(step >  180) offset -= 360;
          else if(step < -180) offset += 360;
          ring[i][0] += offset;
        }
      }
    }

    // 2. Anchor every polygon to the largest one, so the outlying islands sit
    //    beside the mainland rather than 360° away from it.
    const parts = polygons(f.geometry).map(p => ({ p, ...lngStats(p) }));
    const anchor = parts.reduce((a, b) => (b.span > a.span ? b : a)).mean;
    let moved = 0;
    for(const part of parts){
      const k = Math.round((anchor - part.mean) / 360);
      if(k){ shiftLngs(part.p, k * 360); moved++; }
    }

    // 3. Prefer the eastern framing so Pacific nations stay next to their
    //    neighbours (Fiji beside NZ, Kiribati beside Micronesia) — unless that
    //    would carry the country clean off the map, which is what moving the
    //    continental US to lng 233 would do.
    const whole = lngStats(f.geometry.coordinates);
    const centre = (whole.min + whole.max) / 2;
    let flip = 0;
    if(centre < 0 && centre + 360 <= MAX_EAST_CENTRE) flip = 360;
    else if(centre > MAX_EAST_CENTRE) flip = -360;
    if(flip) shiftLngs(f.geometry.coordinates, flip);

    const after = lngStats(f.geometry.coordinates);
    healed.push(`${f.id} ${after.min.toFixed(0)}..${after.max.toFixed(0)}` +
                ` (${moved} part${moved === 1 ? '' : 's'} re-anchored${flip ? `, frame ${flip > 0 ? '+' : ''}${flip}` : ''})`);
  }
  return healed;
}

const bboxSpan = (coords) => {
  let mnx = 180, mxx = -180, mny = 90, mxy = -90;
  (function walk(c){
    if(typeof c[0] === 'number'){
      if(c[0] < mnx) mnx = c[0];
      if(c[0] > mxx) mxx = c[0];
      if(c[1] < mny) mny = c[1];
      if(c[1] > mxy) mxy = c[1];
      return;
    }
    for(const x of c) walk(x);
  })(coords);
  return Math.max(mxx - mnx, mxy - mny);
};

const countCoords = (features) => features.reduce((n, f) => {
  if(!f.geometry) return n;
  return n + (function walk(c){
    return typeof c[0] === 'number' ? 1 : c.reduce((m, x) => m + walk(x), 0);
  })(f.geometry.coordinates);
}, 0);

const round = (features, p) => {
  const q = 1 / p;
  for(const f of features){
    if(!f.geometry) continue;
    (function walk(c){
      if(typeof c[0] === 'number'){
        c[0] = Math.round(c[0] * q) / q;
        c[1] = Math.round(c[1] * q) / q;
        return;
      }
      for(const x of c) walk(x);
    })(f.geometry.coordinates);
  }
  return features;
};

async function main(){
  const wc = require('world-countries');
  const byNum = new Map(wc.map(c => [String(c.ccn3).padStart(3, '0'), c]));

  const collect = (topoJson) => {
    const fc = feature(topoJson, topoJson.objects.countries);
    const out = [];
    for(const f of fc.features){
      if(!f.geometry) continue;
      const iso = byNum.get(String(f.id).padStart(3, '0'));
      const alias = BY_NAME[f.properties.name];
      if(!iso && !alias){
        console.warn('  skipped (no ISO code):', f.properties.name);
        continue;
      }
      out.push({
        type: 'Feature',
        id: iso ? iso.cca3 : alias.id,
        properties: { name: iso ? iso.name.common : alias.name },
        geometry: f.geometry
      });
    }
    return out;
  };

  // Natural Earth stores some countries as several features sharing one code
  // (Australia is two). Merge them, or the consumer keeps whichever it sees
  // first and quietly loses the rest of the country.
  const mergeById = (list) => {
    const byId = new Map();
    for(const f of list){
      const prev = byId.get(f.id);
      if(!prev){ byId.set(f.id, f); continue; }
      prev.geometry = {
        type: 'MultiPolygon',
        coordinates: polygons(prev.geometry).concat(polygons(f.geometry))
      };
    }
    return [...byId.values()];
  };

  console.log('Reading Natural Earth 1:50m…');
  const raw = collect(require('world-atlas/countries-50m.json'));
  let features = mergeById(raw);
  if(features.length !== raw.length){
    console.log(`  merged ${raw.length - features.length} split feature(s) into their country`);
  }
  console.log(`  ${features.length} features, ${countCoords(features)} coords`);

  // Tuvalu is below the 1:50m threshold; borrow it from 1:10m so every country
  // in the region lists actually exists on the map.
  const present = new Set(features.map(f => f.id));
  const extras = collect(require('world-atlas/countries-10m.json'))
    .filter(f => !present.has(f.id) && GRAFT_FROM_10M.has(f.id));
  if(extras.length){
    console.log('  grafted from 1:10m:', extras.map(f => `${f.id} (${f.properties.name})`).join(', '));
    features = features.concat(extras);
  }

  // Bucket by the biggest single landmass, not the whole-country bbox: Kiribati
  // spans a third of the planet but is made entirely of specks, and global
  // simplification erases it.
  const largestPart = (f) => Math.max(...polygons(f.geometry).map(p => bboxSpan(p)));
  const big   = features.filter(f => largestPart(f) >= SMALL_SPAN_DEG);
  const small = features.filter(f => largestPart(f) <  SMALL_SPAN_DEG);
  console.log(`Simplifying ${big.length} large countries at ${SIMPLIFY_PCT}; keeping ${small.length} small ones at full detail`);

  // mapshaper drops the top-level `id`, so smuggle it through properties rather
  // than trusting feature order to survive.
  const input = {
    type: 'FeatureCollection',
    features: big.map(f => ({ ...f, properties: { ...f.properties, __id: f.id } }))
  };
  const res = await mapshaper.applyCommands(
    `-i in.json -simplify visvalingam ${SIMPLIFY_PCT} keep-shapes -o out.json precision=${PRECISION}`,
    { 'in.json': JSON.stringify(input) }
  );
  const simplified = JSON.parse(new TextDecoder().decode(res['out.json'])).features;
  if(simplified.length !== big.length){
    throw new Error(`mapshaper returned ${simplified.length} features, expected ${big.length}`);
  }
  for(const f of simplified){
    f.id = f.properties.__id;
    delete f.properties.__id;
    if(!f.id) throw new Error('lost a feature id during simplification');
  }

  const all = simplified
    .concat(round(small, PRECISION))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // Must run last: mapshaper silently mangles longitudes outside [-180, 180].
  const healed = healAntimeridian(all);
  console.log('Healed across the 180° seam:', healed.length ? healed.join(', ') : 'none');

  mkdirSync(OUT_DIR, { recursive: true });
  const geo = { type: 'FeatureCollection', features: all };
  const json = JSON.stringify(geo);
  writeFileSync(join(OUT_DIR, 'countries.geojson'), json);
  console.log(`\ncountries.geojson: ${all.length} features, ${countCoords(all)} coords, ${(json.length / 1024).toFixed(0)} KB`);

  // ISO3 -> ISO2, used for both the flag files and the emoji fallback.
  const iso = {};
  for(const c of wc) iso[c.cca3] = c.cca2;
  iso.XKX = 'XK';
  writeFileSync(join(OUT_DIR, 'iso3to2.json'), JSON.stringify(iso, null, 0));
  console.log(`iso3to2.json:      ${Object.keys(iso).length} codes`);

  await copyFlags(all, iso);
}

/**
 * Real flag artwork, because emoji flags are not a viable prompt: Windows ships
 * no flag glyphs at all and renders them as the two regional-indicator letters,
 * which for a guess-the-flag round literally spells out the country code.
 */
async function copyFlags(features, iso){
  const { optimize } = await import('svgo');
  const srcDir = join(HERE, 'node_modules', 'flag-icons', 'flags', '4x3');
  const outDir = join(HERE, '..', 'assets', 'flags');
  mkdirSync(outDir, { recursive: true });

  let written = 0, bytes = 0, missing = [];
  for(const f of features){
    const code = iso[String(f.id)];
    if(!code) continue;
    const src = join(srcDir, code.toLowerCase() + '.svg');
    let svg;
    try{ svg = readFileSync(src, 'utf8'); }
    catch{ missing.push(String(f.id)); continue; }
    const out = optimize(svg, { multipass: true }).data;
    writeFileSync(join(outDir, code.toLowerCase() + '.svg'), out);
    written++; bytes += out.length;
  }
  console.log(`assets/flags:      ${written} SVGs, ${(bytes / 1024 / 1024).toFixed(2)} MB` +
              (missing.length ? ` (no artwork for ${missing.join(', ')})` : ''));
}

main().catch(e => { console.error(e); process.exit(1); });
