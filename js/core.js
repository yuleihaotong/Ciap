/* ciap — tiny geometry / search / formatting core shared by the prototype.
   In production this logic lives in the cross-platform C core. */
(function (root) {
  "use strict";

  var R = 6371008.8;
  var RAD = Math.PI / 180;

  var MODES = {
    driving: { key: "driving", label: "驾车", short: "驾车", icon: "car" },
    transit: { key: "transit", label: "公交", short: "公交", icon: "bus" },
    bicycling: { key: "bicycling", label: "骑行", short: "骑行", icon: "bike" },
    walking: { key: "walking", label: "步行", short: "步行", icon: "walk" }
  };
  var MODE_ORDER = ["driving", "transit", "bicycling", "walking"];

  var CATEGORY = {
    spring: { icon: "wave", label: "泉水", tint: "cat-spring" },
    lake: { icon: "leaf", label: "湖泊", tint: "cat-lake" },
    hill: { icon: "mountain", label: "山野", tint: "cat-hill" },
    museum: { icon: "museum", label: "人文", tint: "cat-museum" },
    rail: { icon: "train", label: "车站", tint: "cat-rail" },
    airport: { icon: "plane", label: "机场", tint: "cat-airport" },
    street: { icon: "store", label: "街巷", tint: "cat-street" },
    mall: { icon: "bag", label: "商场", tint: "cat-mall" },
    office: { icon: "building", label: "园区", tint: "cat-office" }
  };

  function parseLocation(value) {
    if (!value) return null;
    if (Array.isArray(value)) {
      var lng = Number(value[0]);
      var lat = Number(value[1]);
      return isFinite(lng) && isFinite(lat) ? { lng: lng, lat: lat } : null;
    }
    if (typeof value === "object" && value.lng != null && value.lat != null) {
      return { lng: Number(value.lng), lat: Number(value.lat) };
    }
    var parts = String(value).split(",");
    if (parts.length !== 2) return null;
    var a = Number(parts[0]);
    var b = Number(parts[1]);
    return isFinite(a) && isFinite(b) ? { lng: a, lat: b } : null;
  }

  function haversine(a, b) {
    a = parseLocation(a);
    b = parseLocation(b);
    if (!a || !b) return 0;
    var dLat = (b.lat - a.lat) * RAD;
    var dLng = (b.lng - a.lng) * RAD;
    var s1 = Math.sin(dLat / 2);
    var s2 = Math.sin(dLng / 2);
    var h = s1 * s1 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * s2 * s2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function normalizePolyline(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var p = parseLocation(raw[i]);
      if (p) out.push(p);
    }
    return out;
  }

  function pathLength(points) {
    var total = 0;
    for (var i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
    return total;
  }

  function cumulativeDistances(points) {
    var cum = new Array(points.length);
    var total = 0;
    cum[0] = 0;
    for (var i = 1; i < points.length; i++) {
      total += haversine(points[i - 1], points[i]);
      cum[i] = total;
    }
    return cum;
  }

  function interpolate(a, b, t) {
    return {
      lng: a.lng + (b.lng - a.lng) * t,
      lat: a.lat + (b.lat - a.lat) * t,
      heading: bearing(a, b)
    };
  }

  function bearing(a, b) {
    var y = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * RAD);
    var x = b.lat - a.lat;
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  function pointAtDistance(points, cum, distance) {
    if (!points.length) return null;
    if (points.length === 1) return { lng: points[0].lng, lat: points[0].lat, heading: 0, index: 0 };
    var total = cum[cum.length - 1];
    var d = Math.max(0, Math.min(total, distance));
    var lo = 0;
    var hi = cum.length - 1;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    var span = cum[hi] - cum[lo] || 1;
    var t = (d - cum[lo]) / span;
    var p = interpolate(points[lo], points[hi], t);
    p.index = lo;
    return p;
  }

  function slicePath(points, cum, from, to) {
    if (!points.length) return [];
    var total = cum[cum.length - 1];
    var a = Math.max(0, Math.min(total, from));
    var b = Math.max(a, Math.min(total, to));
    var out = [pointAtDistance(points, cum, a)];
    for (var i = 0; i < points.length; i++) {
      if (cum[i] > a && cum[i] < b) out.push(points[i]);
    }
    if (b > a) out.push(pointAtDistance(points, cum, b));
    if (out.length === 1) out.push({ lng: out[0].lng, lat: out[0].lat });
    return out;
  }

  function formatDistance(meters) {
    var m = Number(meters) || 0;
    if (m < 1000) return Math.round(m / 10) * 10 + " 米";
    if (m < 10000) return (m / 1000).toFixed(1).replace(/\.0$/, "") + " 公里";
    return Math.round(m / 1000) + " 公里";
  }

  function formatDuration(seconds) {
    var mins = Math.max(1, Math.round((Number(seconds) || 0) / 60));
    if (mins < 60) return mins + " 分钟";
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return m ? h + " 小时 " + m + " 分钟" : h + " 小时";
  }

  function formatMinutes(seconds) {
    return Math.max(1, Math.round((Number(seconds) || 0) / 60)) + " 分";
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function formatClock(date) {
    var d = date || new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function formatETA(remainingSeconds) {
    return formatClock(new Date(Date.now() + Math.max(0, remainingSeconds) * 1000));
  }

  function normalize(value) {
    return String(value == null ? "" : value).toLowerCase().replace(/\s+/g, "");
  }

  function searchPois(pois, query) {
    var list = Array.isArray(pois) ? pois : [];
    var q = normalize(query);
    if (!q) {
      return list.slice().sort(function (a, b) {
        return (a.distanceMeters || 0) - (b.distanceMeters || 0);
      });
    }
    var scored = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var names = [p.name, p.shortName].concat(p.aliases || []).map(normalize).filter(Boolean);
      var address = normalize(p.address);
      var type = normalize(p.type);
      var score = -1;
      if (names.indexOf(q) >= 0) score = 100;
      else if (names.some(function (n) { return n.indexOf(q) === 0; })) score = 80;
      else if (names.some(function (n) { return n.indexOf(q) > 0; })) score = 55;
      else if (address.indexOf(q) >= 0) score = 32;
      else if (type.indexOf(q) >= 0) score = 18;
      if (score >= 0) scored.push({ poi: p, score: score });
    }
    scored.sort(function (a, b) {
      return b.score - a.score || (a.poi.distanceMeters || 0) - (b.poi.distanceMeters || 0);
    });
    return scored.map(function (item) { return item.poi; });
  }

  function categoryOf(poi) {
    return CATEGORY[poi && poi.category] || { icon: "pin", label: "地点", tint: "cat-spring" };
  }

  function modeOf(mode) {
    return MODES[mode] || MODES.driving;
  }

  function formatRouteClock(seconds) {
    return formatETA(seconds);
  }

  var api = {
    MODES: MODES,
    MODE_ORDER: MODE_ORDER,
    CATEGORY: CATEGORY,
    parseLocation: parseLocation,
    haversine: haversine,
    normalizePolyline: normalizePolyline,
    pathLength: pathLength,
    cumulativeDistances: cumulativeDistances,
    pointAtDistance: pointAtDistance,
    slicePath: slicePath,
    bearing: bearing,
    formatDistance: formatDistance,
    formatDuration: formatDuration,
    formatMinutes: formatMinutes,
    formatClock: formatClock,
    formatETA: formatETA,
    formatRouteClock: formatRouteClock,
    searchPois: searchPois,
    categoryOf: categoryOf,
    modeOf: modeOf,
    pad2: pad2
  };

  root.CiapCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
