// ciap prototype self-test — Node.js only (no Python, no dependencies).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

// 1. Load the AMap-derived fixtures exactly like the browser does.
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/fixtures.js'), 'utf8'), sandbox, { filename: 'fixtures.js' });
const data = sandbox.window.CIAP_FIXTURES;
assert.ok(data, 'fixtures set window.CIAP_FIXTURES');
assert.equal(data.pois.length, 10, '10 Jinan POIs');
assert.equal(data.meta.adcode, '370100', 'Jinan adcode');
assert.ok(data.origin.location, 'origin location');

const C = require('../js/core.js');
const origin = C.parseLocation(data.origin.location);
const modes = ['driving', 'walking', 'bicycling', 'transit'];
let routeCount = 0;
let optionCount = 0;

for (const poi of data.pois) {
  assert.ok(poi.id && poi.name && poi.location, 'poi identity');
  assert.ok(C.parseLocation(poi.location), `poi location parses: ${poi.name}`);
  assert.ok(poi.distanceMeters > 0, `distance > 0: ${poi.name}`);
  for (const mode of modes) {
    const group = data.routes[poi.id]?.[mode];
    assert.ok(group && Array.isArray(group.options) && group.options.length >= 1, `route mode exists: ${poi.name}/${mode}`);
    for (const option of group.options) {
      routeCount++;
      optionCount++;
      assert.ok(option.distance > 0 && option.duration > 0, `route distance/duration: ${poi.name}/${mode}`);
      assert.ok(Array.isArray(option.polyline) && option.polyline.length >= 2, `polyline: ${poi.name}/${mode}`);
      const pts = C.normalizePolyline(option.polyline);
      assert.equal(pts.length, option.polyline.length, `polyline parses: ${poi.name}/${mode}`);
      const start = C.haversine(origin, pts[0]);
      const end = C.haversine(C.parseLocation(poi.location), pts[pts.length - 1]);
      assert.ok(start < 350, `route starts near origin: ${poi.name}/${mode} ${start.toFixed(0)}m`);
      assert.ok(end < 900, `route ends near poi: ${poi.name}/${mode} ${end.toFixed(0)}m`);
      assert.ok(C.pathLength(pts) > 0, 'route has length');
    }
  }
  assert.ok(data.routes[poi.id].transit.options[0].segments.length >= 1, `transit segments: ${poi.name}`);
}

// 2. Core geometry / formatting / search.
const baotu = data.pois.find(p => p.shortName === '趵突泉');
const daming = data.pois.find(p => p.shortName === '大明湖');
assert.ok(baotu && daming);
const d = C.haversine(origin, C.parseLocation(baotu.location));
assert.ok(d > 500 && d < 650, `泉城广场→趵突泉 ~555m, got ${Math.round(d)}m`);
assert.match(C.formatDistance(555), /^560 米$/);
assert.match(C.formatDistance(1365), /^1\.4 公里$/);
assert.equal(C.formatDuration(607), '10 分钟');
assert.equal(C.formatDuration(5101), '1 小时 25 分钟');
assert.equal(C.formatETA(600).length, 5, 'ETA HH:MM');

const results = C.searchPois(data.pois, '大明');
assert.equal(results[0].shortName, '大明湖', 'search by Chinese');
assert.equal(C.searchPois(data.pois, 'daminghu')[0].shortName, '大明湖', 'search by pinyin alias');
assert.equal(C.searchPois(data.pois, '趵突泉')[0].shortName, '趵突泉', 'search by short name');
assert.equal(C.searchPois(data.pois, 'zzzzz').length, 0, 'empty search result');

const pts = C.normalizePolyline(data.routes[baotu.id].driving.options[0].polyline);
const cum = C.cumulativeDistances(pts);
const mid = C.pointAtDistance(pts, cum, cum[cum.length - 1] / 2);
assert.ok(mid && Math.abs(mid.lat - (pts[0].lat + pts[pts.length - 1].lat) / 2) < 0.02, 'midpoint interpolation');
const slice = C.slicePath(pts, cum, cum[Math.floor(cum.length / 3)], cum[Math.floor(cum.length * 2 / 3)]);
assert.ok(slice.length >= 2, 'path slice');

// 3. No API key anywhere in the shipped prototype.
const keyFile = path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'amap.key');
if (fs.existsSync(keyFile)) {
  const key = fs.readFileSync(keyFile, 'utf8').trim();
  if (key.length > 8) {
    for (const file of ['index.html', 'js/fixtures.js', 'js/core.js', 'js/map.js', 'js/app.js', 'styles.css']) {
      assert.ok(!fs.readFileSync(path.join(ROOT, file), 'utf8').includes(key), `no API key in ${file}`);
    }
  }
}

console.log(`PASS — ${data.pois.length} POIs, ${routeCount} route options (${optionCount} total), 4 modes, key-safe, core OK`);
