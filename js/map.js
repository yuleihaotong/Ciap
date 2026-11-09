/* ciap — hand-drawn Jinan basemap, route surface and navigation camera.
   Prototype basemap is intentionally schematic: production uses an AMap custom
   map style with the same porcelain / spring-teal palette. */
(function (global) {
  "use strict";

  var C = global.CiapCore;
  var RAD = Math.PI / 180;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

  var COLORS = {
    paper: "#f2efe9",
    paperEdge: "#eeebe3",
    water: "#d4eaec",
    waterEdge: "#c4dfe2",
    river: "#cfe7ea",
    park: "#e1ead6",
    parkEdge: "#d4e0c8",
    block: "#ece8df",
    blockEdge: "#e5e0d6",
    road: "#fdfbf6",
    roadEdge: "#e5dfd4",
    arterial: "#fffdf9",
    arterialEdge: "#ddd7cb",
    motorway: "#fbf8f2",
    motorwayEdge: "#d6cfc2",
    rail: "#c8c2b7",
    label: "#858b84",
    labelSoft: "#a2a69f",
    waterLabel: "#6f9fa6",
    parkLabel: "#7f9976",
    route: "#0b8b83",
    routeDeep: "#076b66",
    routeAlt: "#b8c1bc",
    routeGhost: "#cbd4cf"
  };

  var HOME = { center: { lng: 117.034, lat: 36.674 }, scale: 3820, offsetY: 0 };
  var view = "home";

  var state = {
    canvas: null,
    ctx: null,
    dpr: 1,
    w: 390,
    h: 844,
    center: { lng: HOME.center.lng, lat: HOME.center.lat },
    scale: HOME.scale,
    offsetY: 0,
    view: "home",
    origin: { lng: 117.024, lat: 36.662 },
    pois: [],
    selectedPoi: null,
    route: null,
    nav: null,
    animation: null,
    raf: 0,
    pointers: new Map(),
    drag: null,
    pinch: null,
    moved: false,
    callbacks: {},
    labelBoxes: [],
    time: 0
  };
  var animToken = 0;

  /* ---------- geographic sketch of Jinan ---------- */
  var ROAD_SOURCE = `
经十路|A|116.875,36.6505 116.935,36.6508 116.985,36.6504 117.025,36.6508 117.070,36.6518 117.120,36.6520 117.175,36.6514 117.235,36.6504
泺源大街|A|116.980,36.6638 116.998,36.6634 117.016,36.6630 117.032,36.6622 117.042,36.6610 117.049,36.6598
泉城路|A|117.003,36.6664 117.014,36.6665 117.024,36.6661 117.032,36.6652 117.037,36.6642
黑虎泉西路|S|117.017,36.6618 117.027,36.6616 117.036,36.6608
黑虎泉北路|S|117.019,36.6700 117.030,36.6692 117.037,36.6672
大明湖路|A|117.005,36.6689 117.015,36.6700 117.025,36.6699 117.034,36.6688
明湖东路|S|117.034,36.6688 117.043,36.6672 117.052,36.6658
共青团路|S|116.987,36.6648 116.999,36.6654 117.005,36.6659
经四路|S|116.968,36.6630 116.983,36.6632 116.995,36.6636 117.005,36.6640
经七路|S|116.952,36.6552 116.970,36.6552 116.990,36.6556 117.008,36.6559
文化西路|S|117.002,36.6559 117.018,36.6561 117.035,36.6566 117.047,36.6559
文化东路|A|117.047,36.6559 117.062,36.6552 117.080,36.6548 117.096,36.6551
解放路|A|117.040,36.6640 117.058,36.6647 117.078,36.6652 117.098,36.6650
和平路|S|117.037,36.6588 117.058,36.6592 117.082,36.6599 117.095,36.6602
山大路|S|117.057,36.6380 117.058,36.6550 117.059,36.6720 117.060,36.6900
历山路|A|117.0435,36.6350 117.0425,36.6520 117.0415,36.6680 117.0405,36.6840 117.0395,36.7010
舜耕路|S|117.0115,36.6200 117.0150,36.6360 117.0190,36.6510 117.0220,36.6650 117.0240,36.6800
英雄山路|A|116.9870,36.6000 116.9910,36.6200 116.9950,36.6400 116.9990,36.6550 117.0020,36.6650
纬二路|S|116.9945,36.6420 116.9948,36.6560 116.9952,36.6700 116.9957,36.6840
顺河高架|M|116.9855,36.6180 116.9875,36.6380 116.9895,36.6580 116.9915,36.6780 116.9935,36.6980 116.9960,36.7200
二环东路|A|117.0935,36.5980 117.0920,36.6230 117.0900,36.6480 117.0880,36.6740 117.0865,36.7000 117.0855,36.7200
二环西路|S|116.8990,36.5980 116.9015,36.6280 116.9040,36.6580 116.9075,36.6880 116.9115,36.7150
北园高架|M|116.9280,36.7000 116.9580,36.6990 116.9930,36.6980 117.0280,36.6980 117.0630,36.6990 117.0910,36.7000
旅游路|A|116.9970,36.6110 117.0280,36.6140 117.0580,36.6190 117.0920,36.6270 117.1270,36.6360 117.1650,36.6460
龙奥北路|S|117.1020,36.6520 117.1220,36.6560 117.1430,36.6590 117.1640,36.6620
世纪大道|A|117.1430,36.6570 117.1650,36.6510 117.1900,36.6440 117.2220,36.6370
工业南路|S|117.0530,36.6840 117.0830,36.6780 117.1130,36.6730 117.1480,36.6695 117.1840,36.6680
凤凰路|S|117.1415,36.5980 117.1420,36.6230 117.1428,36.6480 117.1436,36.6730 117.1445,36.6980 117.1450,36.7200
奥体中路|S|117.1295,36.6300 117.1305,36.6500 117.1315,36.6700 117.1325,36.6900
花园路|S|117.0180,36.6895 117.0430,36.6890 117.0680,36.6875 117.0940,36.6860
趵突泉南路|S|117.0168,36.6440 117.0162,36.6530 117.0154,36.6610 117.0138,36.6660
趵突泉北路|S|117.0138,36.6660 117.0108,36.6720 117.0068,36.6770
玉函路|S|117.0045,36.6230 117.0060,36.6390 117.0074,36.6550 117.0086,36.6650
青年东路|S|117.0345,36.6490 117.0357,36.6575 117.0366,36.6630
山师东路|S|117.0450,36.6440 117.0460,36.6570 117.0470,36.6655
县西巷|S|117.0278,36.6640 117.0278,36.6700 117.0268,36.6740
曲水亭街|P|117.0218,36.6678 117.0210,36.6716 117.0192,36.6748
芙蓉街|P|117.0233,36.6668 117.0234,36.6700 117.0240,36.6722
济泺路|S|116.9970,36.6790 116.9960,36.6990 116.9950,36.7200 116.9940,36.7410 116.9930,36.7600
将军路|S|117.0600,36.6890 117.0600,36.7090 117.0600,36.7290 117.0600,36.7450
纬十二路|S|116.9595,36.6490 116.9605,36.6650 116.9615,36.6800
经一路|S|116.9740,36.6700 116.9940,36.6710 117.0110,36.6712
明湖北路|S|116.9900,36.6780 117.0040,36.6800 117.0150,36.6810 117.0260,36.6815 117.0360,36.6790 117.0430,36.6750
经十一路|S|116.9580,36.6420 116.9980,36.6430 117.0350,36.6440 117.0780,36.6450
千佛山路|S|117.0300,36.6250 117.0315,36.6400 117.0325,36.6520
佛山街|S|117.0280,36.6500 117.0285,36.6590 117.0290,36.6635
济大路|S|116.9880,36.6300 117.0040,36.6310 117.0180,36.6320
舜玉路|S|117.0080,36.6330 117.0250,36.6345 117.0360,36.6360
六里山路|S|116.9880,36.6380 117.0050,36.6395 117.0140,36.6400
馆驿街|S|117.0040,36.6690 117.0130,36.6693
解放东路|S|117.0970,36.6650 117.1180,36.6665 117.1450,36.6675
华龙路|S|117.0680,36.6800 117.0930,36.6790 117.1180,36.6770
化纤厂路|S|117.0870,36.6630 117.0910,36.6750 117.0950,36.6890
机场高速|M|117.0600,36.6980 117.0950,36.7380 117.1300,36.7800 117.1600,36.8150 117.1900,36.8420 117.2070,36.8500
青银高速|M|117.0200,36.8050 117.0700,36.8080 117.1200,36.8120 117.1700,36.8160 117.2300,36.8180 117.2800,36.8150
机场路|A|117.1750,36.7900 117.1880,36.8100 117.1980,36.8320 117.2080,36.8520
荷花路|S|117.1450,36.7900 117.1750,36.7920 117.2050,36.7900
温梁路|S|117.1550,36.8350 117.1850,36.8400 117.2150,36.8450
济南东站北街|S|117.1450,36.7480 117.1650,36.7500 117.1850,36.7480
凤凰北路|S|117.1450,36.7000 117.1500,36.7250 117.1550,36.7500 117.1600,36.7750
开源路|S|117.1150,36.7350 117.1350,36.7380 117.1600,36.7400
坝王路|S|117.1800,36.7420 117.1950,36.7600 117.2050,36.7800
齐州路|S|116.8750,36.6500 116.8800,36.6650 116.8850,36.6800 116.8900,36.6950
大金路|S|116.8600,36.6680 116.8850,36.6685 116.9100,36.6690
青岛路|S|116.8650,36.6800 116.8850,36.6780 116.9150,36.6770
`;

  var WATER_POLYGONS = [
    {
      name: "大明湖",
      pts: [[117.003,36.670],[117.004,36.675],[117.009,36.679],[117.015,36.681],[117.023,36.6815],[117.030,36.6795],[117.035,36.6755],[117.036,36.671],[117.032,36.667],[117.026,36.6655],[117.020,36.6655],[117.016,36.668],[117.010,36.6675],[117.006,36.6685]]
    },
    { name: "趵突泉", center: [117.0155,36.6605], radius: [0.0025,0.0018] },
    { name: "五龙潭", center: [117.0102,36.6628], radius: [0.0017,0.0014] },
    { name: "黑虎泉", center: [117.0285,36.6635], radius: [0.0012,0.0009] },
    { name: "华山湖", center: [117.0610,36.7155], radius: [0.006,0.004] }
  ];

  var PARKS = [
    {
      name: "千佛山",
      pts: [[117.019,36.636],[117.024,36.641],[117.038,36.640],[117.050,36.635],[117.060,36.627],[117.058,36.617],[117.048,36.611],[117.035,36.614],[117.026,36.620]],
      contours: [[117.041,36.625,0.014,0.010],[117.042,36.625,0.010,0.007],[117.043,36.625,0.006,0.004]]
    },
    { name: "泉城公园", pts: [[117.017,36.636],[117.030,36.636],[117.031,36.646],[117.024,36.648],[117.017,36.644]] },
    { name: "英雄山", pts: [[116.995,36.632],[117.010,36.632],[117.012,36.641],[117.002,36.643],[116.994,36.638]] },
    { name: "森林公园", pts: [[116.933,36.654],[116.952,36.654],[116.954,36.665],[116.938,36.667],[116.932,36.661]] },
    { name: "华山公园", pts: [[117.049,36.705],[117.071,36.703],[117.074,36.720],[117.062,36.727],[117.049,36.721]] },
    { name: "百花公园", pts: [[117.066,36.682],[117.078,36.681],[117.080,36.688],[117.068,36.690]] },
    { name: "大明湖公园", pts: [[117.000,36.666],[117.002,36.681],[117.012,36.684],[117.028,36.684],[117.038,36.679],[117.039,36.670],[117.032,36.664],[117.018,36.663],[117.006,36.663]] }
  ];

  var RIVERS = [
    { name: "黄河", pts: [[116.840,36.770],[116.900,36.762],[116.960,36.750],[117.005,36.741],[117.052,36.744],[117.105,36.751],[117.160,36.755],[117.220,36.749],[117.290,36.735]], width: 0.0062 },
    { name: "小清河", pts: [[116.900,36.701],[116.950,36.703],[117.000,36.704],[117.050,36.704],[117.100,36.706],[117.150,36.709],[117.200,36.712]], width: 0.0016 }
  ];

  var MOAT = [[117.002,36.664],[117.004,36.673],[117.010,36.678],[117.021,36.679],[117.031,36.676],[117.036,36.669],[117.034,36.661],[117.027,36.657],[117.016,36.657],[117.008,36.660]];

  var WATER_LABELS = [
    { text: "黄河", at: [117.075, 36.748], angle: -0.1, size: 13, color: "#6f9fa6" },
    { text: "大明湖", at: [117.0195, 36.6755], angle: 0, size: 10.5, color: "#6d9aa1" },
    { text: "小清河", at: [117.105, 36.705], angle: -0.02, size: 9, color: "#89adb1" },
    { text: "护城河", at: [117.031, 36.6578], angle: 1.35, size: 8.5, color: "#8fb3b6" }
  ];

  var PARK_LABELS = [
    { text: "千佛山", at: [117.042, 36.6255], size: 11, color: "#708c66" },
    { text: "泉城公园", at: [117.0238, 36.6418], size: 8.5, color: "#829b78" },
    { text: "英雄山", at: [117.0035, 36.6372], size: 8.5, color: "#829b78" },
    { text: "森林公园", at: [116.943, 36.6605], size: 8, color: "#829b78" },
    { text: "华山", at: [117.0605, 36.7165], size: 9, color: "#7f9a75" }
  ];

  var DISTRICTS = [
    { text: "历下区", at: [117.070, 36.667], size: 21 },
    { text: "市中区", at: [117.000, 36.638], size: 20 },
    { text: "天桥区", at: [116.995, 36.712], size: 19 },
    { text: "槐荫区", at: [116.930, 36.675], size: 19 },
    { text: "历城区", at: [117.155, 36.688], size: 20 },
    { text: "遥墙", at: [117.205, 36.805], size: 16 }
  ];

  var LANDMARKS = [
    { type: "runway", pts: [[117.193, 36.834], [117.230, 36.850]], width: 11 },
    { type: "runway", pts: [[117.190, 36.843], [117.227, 36.859]], width: 11 },
    { type: "terminal", pts: [[117.197, 36.855], [117.211, 36.855], [117.214, 36.863], [117.200, 36.863]] },
    { type: "station", at: [117.1599, 36.7479], w: 0.0042, h: 0.0024, label: "济南东站" },
    { type: "station", at: [116.8913, 36.6688], w: 0.0052, h: 0.0026, label: "济南西站" },
    { type: "label", text: "遥墙机场", at: [117.205, 36.870], size: 10.5 }
  ];

  var AREAS = [
    { x1: 116.985, y1: 36.651, x2: 117.046, y2: 36.682, cell: 0.0022 },
    { x1: 117.046, y1: 36.646, x2: 117.155, y2: 36.707, cell: 0.0030 },
    { x1: 116.970, y1: 36.616, x2: 117.078, y2: 36.651, cell: 0.0028 },
    { x1: 116.901, y1: 36.644, x2: 116.985, y2: 36.695, cell: 0.0030 },
    { x1: 116.958, y1: 36.692, x2: 117.080, y2: 36.724, cell: 0.0032 },
    { x1: 117.150, y1: 36.642, x2: 117.232, y2: 36.716, cell: 0.0034 },
    { x1: 117.078, y1: 36.596, x2: 117.160, y2: 36.646, cell: 0.0035 },
    { x1: 117.118, y1: 36.718, x2: 117.200, y2: 36.792, cell: 0.0036 },
    { x1: 117.158, y1: 36.796, x2: 117.252, y2: 36.892, cell: 0.0058 },
    { x1: 116.846, y1: 36.640, x2: 116.930, y2: 36.710, cell: 0.0038 }
  ];

  var roads = parseRoads(ROAD_SOURCE);
  var blocks = [];
  var minorRoads = [];
  var parkTreeDots = [];
  var mapReady = false;

  function parseRoads(source) {
    return source.trim().split("\n").map(function (line) {
      var parts = line.trim().split("|");
      var pts = parts[2].trim().split(/\s+/).map(function (pair) {
        var xy = pair.split(",");
        return { lng: Number(xy[0]), lat: Number(xy[1]) };
      });
      return { name: parts[0], cls: parts[1], pts: pts };
    });
  }

  function circlePolygon(center, radius, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      out.push([center[0] + Math.cos(a) * radius[0], center[1] + Math.sin(a) * radius[1]]);
    }
    return out;
  }

  WATER_POLYGONS.forEach(function (water) {
    if (!water.pts) water.pts = circlePolygon(water.center, water.radius, 24);
  });

  function pointInPolygon(lng, lat, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1];
      var xj = poly[j][0], yj = poly[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function inAnyPolygon(lng, lat, polygons) {
    for (var i = 0; i < polygons.length; i++) {
      if (pointInPolygon(lng, lat, polygons[i])) return true;
    }
    return false;
  }

  function distToPolyline(lng, lat, pts) {
    var best = Infinity;
    var cos = Math.cos(lat * RAD);
    for (var i = 1; i < pts.length; i++) {
      var ax = (lng - pts[i - 1].lng) * cos;
      var ay = lat - pts[i - 1].lat;
      var bx = (pts[i].lng - pts[i - 1].lng) * cos;
      var by = pts[i].lat - pts[i - 1].lat;
      var len2 = bx * bx + by * by || 1e-12;
      var t = clamp((ax * bx + ay * by) / len2, 0, 1);
      var dx = ax - bx * t;
      var dy = ay - by * t;
      var d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function nearRiver(lng, lat) {
    for (var i = 0; i < RIVERS.length; i++) {
      if (distToPolyline(lng, lat, RIVERS[i].pts) < RIVERS[i].width * 0.9) return true;
    }
    return false;
  }

  function inParkOrWater(lng, lat) {
    if (inAnyPolygon(lng, lat, PARKS.map(function (p) { return p.pts; }))) return true;
    if (inAnyPolygon(lng, lat, WATER_POLYGONS.map(function (p) { return p.pts; }))) return true;
    return nearRiver(lng, lat);
  }

  function buildCityFabric() {
    var seed = 370100;
    var rand = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    AREAS.forEach(function (area) {
      for (var x = area.x1; x < area.x2; x += area.cell) {
        for (var y = area.y1; y < area.y2; y += area.cell) {
          var cx = x + area.cell * 0.5;
          var cy = y + area.cell * 0.5;
          if (rand() < 0.27) continue;
          if (inParkOrWater(cx, cy)) continue;
          var w = area.cell * (0.44 + rand() * 0.20);
          var h = area.cell * (0.44 + rand() * 0.20);
          blocks.push({ x: cx - w / 2 + (rand() - 0.5) * 0.0002, y: cy - h / 2 + (rand() - 0.5) * 0.0002, w: w, h: h });
          // street edges: a fine, mostly continuous grid
          var edgeY = y;
          if (!inParkOrWater(x + area.cell * 0.5, edgeY) && !inParkOrWater(x, edgeY)) {
            minorRoads.push([x, edgeY, Math.min(x + area.cell, area.x2), edgeY]);
          }
          var edgeX = x;
          if (!inParkOrWater(edgeX, y + area.cell * 0.5) && !inParkOrWater(edgeX, y)) {
            minorRoads.push([edgeX, y, edgeX, Math.min(y + area.cell, area.y2)]);
          }
        }
      }
    });
    // sparse tree texture for the big southern hills
    seed = 6600;
    PARKS.forEach(function (park) {
      if (!park.contours) return;
      for (var i = 0; i < 80; i++) {
        var lng = park.pts[0][0] + (rand() - 0.2) * 0.045;
        var lat = park.pts[0][1] + (rand() - 0.5) * 0.035;
        if (pointInPolygon(lng, lat, park.pts)) parkTreeDots.push([lng, lat]);
      }
    });
  }

  function buildLabels() {
    state.labelBoxes = [];
  }

  function init(canvas, opts) {
    opts = opts || {};
    state.canvas = canvas;
    state.ctx = canvas.getContext("2d");
    state.origin = C.parseLocation(opts.origin) || state.origin;
    state.pois = opts.pois || [];
    state.callbacks = opts.callbacks || {};
    if (!blocks.length) buildCityFabric();
    resize();
    bindEvents();
    state.center = { lng: HOME.center.lng, lat: HOME.center.lat };
    state.scale = HOME.scale;
    state.offsetY = HOME.offsetY;
    mapReady = true;
    draw();
    if (global.ResizeObserver) {
      new ResizeObserver(function () { resize(); }).observe(canvas);
    } else {
      global.addEventListener("resize", function () { resize(); });
    }
  }

  function resize() {
    if (!state.canvas) return;
    var rect = state.canvas.getBoundingClientRect();
    state.dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    state.w = Math.max(1, rect.width);
    state.h = Math.max(1, rect.height);
    state.canvas.width = Math.round(state.w * state.dpr);
    state.canvas.height = Math.round(state.h * state.dpr);
    draw();
  }

  function project(point) {
    var cos = Math.cos(state.center.lat * RAD);
    return {
      x: state.w / 2 + (point.lng - state.center.lng) * cos * state.scale,
      y: state.h / 2 + state.offsetY - (point.lat - state.center.lat) * state.scale
    };
  }

  function unproject(x, y) {
    var cos = Math.cos(state.center.lat * RAD);
    return {
      lng: state.center.lng + (x - state.w / 2) / (cos * state.scale),
      lat: state.center.lat - (y - state.h / 2 - state.offsetY) / state.scale
    };
  }

  function visible(point, margin) {
    var p = project(point);
    var m = margin == null ? 80 : margin;
    return p.x > -m && p.x < state.w + m && p.y > -m && p.y < state.h + m;
  }

  function tracePath(pts) {
    var ctx = state.ctx;
    if (!pts.length) return;
    if (pts.length < 3) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var j = 1; j < pts.length - 1; j++) {
      var midX = (pts[j].x + pts[j + 1].x) / 2;
      var midY = (pts[j].y + pts[j + 1].y) / 2;
      ctx.quadraticCurveTo(pts[j].x, pts[j].y, midX, midY);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }

  function strokeGeoLine(points, width, color, opts) {
    opts = opts || {};
    var ctx = state.ctx;
    var pts = points.map(project);
    ctx.save();
    ctx.lineCap = opts.cap || "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    if (opts.dash) ctx.setLineDash(opts.dash);
    tracePath(pts);
    ctx.stroke();
    ctx.restore();
  }

  function fillGeoPolygon(points, fill, stroke, width) {
    var ctx = state.ctx;
    var pts = points.map(project);
    ctx.beginPath();
    pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width || 1; ctx.stroke(); }
  }

  function drawPaper() {
    var ctx = state.ctx;
    ctx.clearRect(0, 0, state.w, state.h);
    var grad = ctx.createRadialGradient(state.w * 0.5, state.h * 0.32, 80, state.w * 0.5, state.h * 0.5, Math.max(state.w, state.h) * 0.8);
    grad.addColorStop(0, "#f4f1eb");
    grad.addColorStop(1, "#eeebe3");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, state.w, state.h);
  }

  function drawWater() {
    var scale = state.scale;
    RIVERS.forEach(function (river) {
      var casing = Math.max(3, river.width * scale * 1.25);
      strokeGeoLine(river.pts, casing, COLORS.waterEdge);
      strokeGeoLine(river.pts, Math.max(2, river.width * scale), COLORS.river);
    });
    WATER_POLYGONS.forEach(function (water) {
      fillGeoPolygon(water.pts, COLORS.water, COLORS.waterEdge, 1.2);
    });
    // Daming Lake island + bridge detail
    var island = circlePolygon([117.0215, 36.6744], [0.0016, 0.0011], 18);
    fillGeoPolygon(island, COLORS.park, COLORS.parkEdge, 0.8);
    strokeGeoLine([{ lng: 117.0182, lat: 36.6790 }, { lng: 117.0200, lat: 36.6760 }, { lng: 117.0224, lat: 36.6754 }], 1.1, "#b7cdc8");
    // moat
    strokeGeoLine(MOAT.map(function (p) { return { lng: p[0], lat: p[1] }; }), Math.max(1.5, 0.00125 * scale), COLORS.water, { cap: "round" });
  }

  function drawParks() {
    var ctx = state.ctx;
    PARKS.forEach(function (park) {
      fillGeoPolygon(park.pts, COLORS.park, COLORS.parkEdge, 1);
      if (park.contours && state.scale > 1450) {
        ctx.save();
        ctx.strokeStyle = "rgba(127, 157, 116, 0.28)";
        ctx.lineWidth = 0.8;
        park.contours.forEach(function (c) {
          var center = project({ lng: c[0], lat: c[1] });
          var rx = c[2] * Math.cos(state.center.lat * RAD) * state.scale;
          var ry = c[3] * state.scale;
          ctx.beginPath();
          ctx.ellipse(center.x, center.y, rx, ry, -0.35, 0, Math.PI * 2);
          ctx.stroke();
        });
        ctx.restore();
      }
    });
    if (state.scale > 5200) {
      ctx.save();
      ctx.fillStyle = "rgba(116, 143, 105, 0.32)";
      parkTreeDots.forEach(function (d) {
        var p = project({ lng: d[0], lat: d[1] });
        if (p.x < -20 || p.x > state.w + 20 || p.y < -20 || p.y > state.h + 20) return;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }
  }

  function drawBlocks() {
    if (state.scale < 1700) return;
    var ctx = state.ctx;
    var cos = Math.cos(state.center.lat * RAD);
    ctx.save();
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var p = project({ lng: b.x, lat: b.y + b.h });
      var w = b.w * cos * state.scale;
      var h = b.h * state.scale;
      if (p.x + w < -20 || p.x > state.w + 20 || p.y - h > state.h + 20 || p.y < -20) continue;
      ctx.fillStyle = COLORS.block;
      ctx.fillRect(p.x, p.y - h, w, h);
    }
    ctx.restore();
  }

  function drawMinorRoads() {
    if (state.scale < 2250) return;
    var ctx = state.ctx;
    var cos = Math.cos(state.center.lat * RAD);
    ctx.save();
    ctx.strokeStyle = "#fbf8f2";
    ctx.lineWidth = Math.max(0.65, state.scale / 4200);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (var i = 0; i < minorRoads.length; i++) {
      var r = minorRoads[i];
      var a = project({ lng: r[0], lat: r[1] });
      var b = project({ lng: r[2], lat: r[3] });
      if ((a.x < -30 && b.x < -30) || (a.x > state.w + 30 && b.x > state.w + 30) || (a.y < -30 && b.y < -30) || (a.y > state.h + 30 && b.y > state.h + 30)) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawMajorRoads() {
    var ctx = state.ctx;
    var mult = state.scale > 12000 ? 1.18 : 1;
    var classes = [
      { cls: "M", edge: COLORS.motorwayEdge, fill: COLORS.motorway, ew: 9.4 * mult, fw: 6.4 * mult },
      { cls: "A", edge: COLORS.arterialEdge, fill: COLORS.arterial, ew: 7.8 * mult, fw: 5.2 * mult },
      { cls: "S", edge: COLORS.roadEdge, fill: COLORS.road, ew: 4.7 * mult, fw: 2.9 * mult },
      { cls: "P", edge: COLORS.roadEdge, fill: COLORS.road, ew: 3.2 * mult, fw: 1.8 * mult }
    ];
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // casings first, fills second, so junctions blend
    classes.forEach(function (group) {
      ctx.strokeStyle = group.edge;
      ctx.lineWidth = group.ew;
      roads.forEach(function (road) {
        if (road.cls !== group.cls) return;
        if (!road.pts.some(function (p) { return visible(p, 120); })) return;
        tracePath(road.pts.map(project));
        ctx.stroke();
      });
    });
    classes.forEach(function (group) {
      ctx.strokeStyle = group.fill;
      ctx.lineWidth = group.fw;
      if (group.cls === "P") ctx.setLineDash([2.5, 3.5]);
      roads.forEach(function (road) {
        if (road.cls !== group.cls) return;
        if (!road.pts.some(function (p) { return visible(p, 120); })) return;
        tracePath(road.pts.map(project));
        ctx.stroke();
      });
      ctx.setLineDash([]);
    });
    ctx.restore();
  }

  function drawRail() {
    var ctx = state.ctx;
    var lines = [
      [{ lng: 116.890, lat: 36.798 }, { lng: 116.938, lat: 36.746 }, { lng: 116.980, lat: 36.705 }, { lng: 116.996, lat: 36.680 }, { lng: 117.004, lat: 36.657 }, { lng: 117.018, lat: 36.620 }, { lng: 117.040, lat: 36.575 }],
      [{ lng: 116.805, lat: 36.673 }, { lng: 116.887, lat: 36.671 }, { lng: 116.930, lat: 36.691 }, { lng: 116.970, lat: 36.718 }, { lng: 116.998, lat: 36.742 }],
      [{ lng: 116.998, lat: 36.742 }, { lng: 117.060, lat: 36.745 }, { lng: 117.120, lat: 36.747 }, { lng: 117.160, lat: 36.748 }, { lng: 117.220, lat: 36.755 }, { lng: 117.280, lat: 36.772 }]
    ];
    ctx.save();
    ctx.strokeStyle = COLORS.rail;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([5, 4]);
    lines.forEach(function (line) { strokeGeoLine(line, 1.1, COLORS.rail, { dash: [5, 4] }); });
    ctx.restore();
  }

  function drawLandmarks() {
    var ctx = state.ctx;
    var selected = selectedPoiLabel();
    LANDMARKS.forEach(function (mark) {
      if (mark.type === "runway" && state.scale > 900) {
        var pts = mark.pts.map(function (p) { return { lng: p[0], lat: p[1] }; });
        strokeGeoLine(pts, mark.width + 5, "#dfdbd2");
        strokeGeoLine(pts, mark.width, "#fbf9f5");
        strokeGeoLine(pts, 1, "rgba(188,183,173,0.7)", { dash: [6, 7] });
        return;
      }
      if (mark.type === "terminal") {
        fillGeoPolygon(mark.pts, "#f8f5ee", "#d9d4c8", 1);
        return;
      }
      if (mark.type === "station") {
        var p = project({ lng: mark.at[0], lat: mark.at[1] });
        var w = mark.w * Math.cos(state.center.lat * RAD) * state.scale;
        var h = mark.h * state.scale;
        if (w < 5) return;
        ctx.save();
        ctx.fillStyle = "#f7f4ec";
        ctx.strokeStyle = "#d9d3c7";
        ctx.lineWidth = 1;
        roundRect(ctx, p.x - w / 2, p.y - h / 2, w, h, Math.min(3, w / 3));
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        return;
      }
      if (mark.type === "label") {
        if (selected === mark.text || state.scale < 1200) return;
        var lp = project({ lng: mark.at[0], lat: mark.at[1] });
        if (lp.x < -40 || lp.x > state.w + 40 || lp.y < 50 || lp.y > state.h - 40) return;
        drawText(mark.text, lp.x, lp.y, {
          font: "500 " + mark.size + "px 'PingFang SC','Microsoft YaHei',sans-serif",
          color: "#8d938d",
          haloWidth: 2.4,
          letterSpacing: "0.06em"
        });
      }
    });
  }

  function drawText(text, x, y, opts) {
    var ctx = state.ctx;
    opts = opts || {};
    ctx.save();
    ctx.translate(x, y);
    if (opts.angle) ctx.rotate(opts.angle);
    ctx.font = opts.font || "500 9.5px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = opts.align || "center";
    ctx.textBaseline = "middle";
    if (opts.halo !== false) {
      ctx.lineWidth = opts.haloWidth || 3;
      ctx.strokeStyle = opts.halo || "rgba(243,240,234,0.92)";
      ctx.strokeText(text, 0, 0);
    }
    ctx.fillStyle = opts.color || COLORS.label;
    if (opts.letterSpacing && "letterSpacing" in ctx) ctx.letterSpacing = opts.letterSpacing;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function collide(x, y, w, h, pad) {
    var p = pad == null ? 3 : pad;
    var box = { x: x - w / 2 - p, y: y - h / 2 - p, w: w + p * 2, h: h + p * 2 };
    for (var i = 0; i < state.labelBoxes.length; i++) {
      var b = state.labelBoxes[i];
      if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) return true;
    }
    state.labelBoxes.push(box);
    return false;
  }

  function labelRoads() {
    var ctx = state.ctx;
    var list = roads.filter(function (r) { return r.cls === "A" || r.cls === "M" || (r.cls === "S" && state.scale > 5200); });
    list.forEach(function (road) {
      var font = state.scale > 7000 ? "500 10.5px 'PingFang SC','Microsoft YaHei',sans-serif" : "500 9px 'PingFang SC','Microsoft YaHei',sans-serif";
      var pr = road.pts;
      var candidates = [0.50, 0.32, 0.68, 0.18, 0.82];
      for (var c = 0; c < candidates.length; c++) {
        var idx = clamp(Math.round(pr.length * candidates[c]), 0, pr.length - 2);
        var a = project(pr[idx]);
        var b = project(pr[idx + 1]);
        if (a.x < 30 || a.x > state.w - 30 || a.y < 40 || a.y > state.h - 40) continue;
        var angle = Math.atan2(b.y - a.y, b.x - a.x);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
        ctx.save();
        ctx.font = font;
        var width = ctx.measureText(road.name).width;
        ctx.restore();
        if (collide(a.x, a.y, width, 13, 4)) continue;
        drawText(road.name, a.x, a.y, {
          angle: angle,
          font: font,
          color: road.cls === "M" ? "#98998f" : COLORS.label,
          haloWidth: 2.6
        });
        break;
      }
    });
  }

  function labelDistricts() {
    if (state.scale > 2600) return;
    DISTRICTS.forEach(function (d) {
      var p = project({ lng: d.at[0], lat: d.at[1] });
      if (p.x < -80 || p.x > state.w + 80 || p.y < -40 || p.y > state.h + 40) return;
      drawText(d.text, p.x, p.y, {
        font: "400 " + d.size + "px 'PingFang SC','Microsoft YaHei',sans-serif",
        color: "rgba(58, 70, 63, 0.13)",
        halo: false,
        letterSpacing: "0.18em"
      });
    });
  }

  function selectedPoiLabel() {
    return state.selectedPoi ? (state.selectedPoi.shortName || state.selectedPoi.name) : "";
  }

  function labelWaterAndParks() {
    var selected = selectedPoiLabel();
    WATER_LABELS.forEach(function (l) {
      if (selected && l.text === selected) return;
      var p = project({ lng: l.at[0], lat: l.at[1] });
      if (p.x < -30 || p.x > state.w + 30 || p.y < 30 || p.y > state.h - 30) return;
      drawText(l.text, p.x, p.y, {
        angle: l.angle,
        font: "500 " + l.size + "px 'PingFang SC','Microsoft YaHei',sans-serif",
        color: l.color,
        haloWidth: 2.4,
        letterSpacing: "0.1em"
      });
    });
    PARK_LABELS.forEach(function (l) {
      if (selected && l.text === selected) return;
      var p = project({ lng: l.at[0], lat: l.at[1] });
      if (p.x < -30 || p.x > state.w + 30 || p.y < 30 || p.y > state.h - 30) return;
      drawText(l.text, p.x, p.y, {
        font: "500 " + l.size + "px 'PingFang SC','Microsoft YaHei',sans-serif",
        color: l.color,
        haloWidth: 2.2,
        letterSpacing: "0.06em"
      });
    });
  }

  function drawPoiLabels() {
    if (state.scale < 7600) return;
    var drawn = 0;
    var selected = selectedPoiLabel();
    state.pois.forEach(function (poi) {
      if (state.selectedPoi && poi.id === state.selectedPoi.id) return;
      var loc = C.parseLocation(poi.location);
      if (!loc) return;
      var text = poi.shortName || poi.name;
      if (selected && text === selected) return;
      var p = project(loc);
      if (p.x < 30 || p.x > state.w - 30 || p.y < 50 || p.y > state.h - 50) return;
      if (drawn >= 6) return;
      var ctx = state.ctx;
      ctx.save();
      ctx.font = "500 9.5px 'PingFang SC','Microsoft YaHei',sans-serif";
      var tw = ctx.measureText(text).width;
      ctx.restore();
      if (collide(p.x + tw / 2 + 7, p.y - 8, tw + 8, 12, 2)) return;
      drawn++;
      var ctx2 = state.ctx;
      ctx2.save();
      ctx2.fillStyle = COLORS.routeDeep;
      ctx2.beginPath();
      ctx2.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.restore();
      drawText(text, p.x + tw / 2 + 7, p.y - 8, {
        font: "500 9.5px 'PingFang SC','Microsoft YaHei',sans-serif",
        color: "#5d6761",
        haloWidth: 2.4,
        align: "left"
      });
    });
  }

  function drawOriginPuck(alpha) {
    if (!state.origin) return;
    var p = project(state.origin);
    if (p.x < -30 || p.x > state.w + 30 || p.y < -30 || p.y > state.h + 30) return;
    var ctx = state.ctx;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(12,139,131,0.09)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8.2, 0, Math.PI * 2);
    ctx.fillStyle = "#fdfcf8";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5.2, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.route;
    ctx.fill();
    ctx.restore();
  }

  function drawDestinationPin(poi, pulse) {
    if (!poi) return;
    var loc = C.parseLocation(poi.location);
    if (!loc) return;
    var p = project(loc);
    if (p.x < -40 || p.x > state.w + 40 || p.y < -40 || p.y > state.h + 40) return;
    var ctx = state.ctx;
    var t = state.time || 0;
    ctx.save();
    if (pulse) {
      var rr = 13 + Math.sin(t / 520) * 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 20, rr, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(12,139,131,0.07)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 1, 7, 2.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(40,52,46,0.13)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.bezierCurveTo(p.x - 12, p.y - 15, p.x - 12, p.y - 29, p.x, p.y - 29);
    ctx.bezierCurveTo(p.x + 12, p.y - 29, p.x + 12, p.y - 15, p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = "#fdfcf8";
    ctx.fill();
    ctx.strokeStyle = COLORS.routeDeep;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y - 20, 3.3, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.route;
    ctx.fill();
    var label = poi.shortName || poi.name;
    ctx.font = "500 10.5px 'PingFang SC','Microsoft YaHei',sans-serif";
    var w = ctx.measureText(label).width + 16;
    ctx.fillStyle = "rgba(253,252,248,0.86)";
    roundRect(ctx, p.x - w / 2, p.y - 51, w, 20, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = "#26302c";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, p.x, p.y - 41);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function normalizeOption(option) {
    var pts = C.normalizePolyline(option.polyline);
    return { option: option, points: pts, cum: C.cumulativeDistances(pts) };
  }

  function drawRouteLine(points, width, color, opts) {
    if (!points || points.length < 2) return;
    strokeGeoLine(points, width, color, opts);
  }

  function drawRouteSurface() {
    if (!state.route || !state.route.options.length) return;
    var ctx = state.ctx;
    var route = state.route;
    var active = route.options[route.activeIndex] || route.options[0];
    // alternatives first
    route.options.forEach(function (item, i) {
      if (i === route.activeIndex) return;
      drawRouteLine(item.points, 4.4, "rgba(255,255,255,0.82)");
      drawRouteLine(item.points, 3.0, COLORS.routeAlt);
    });
    if (state.nav) {
      var traveled = C.slicePath(itemPoints(active), active.cum, 0, state.nav.traveled);
      var remaining = C.slicePath(itemPoints(active), active.cum, state.nav.traveled, active.cum[active.cum.length - 1]);
      drawRouteLine(traveled, 5.6, "rgba(255,255,255,0.86)");
      drawRouteLine(traveled, 3.8, COLORS.routeGhost);
      drawRouteLine(remaining, 10, "rgba(12,139,131,0.12)");
      drawRouteLine(remaining, 6, "rgba(255,255,255,0.88)");
      drawRouteLine(remaining, 4.6, COLORS.route);
      ctx.save();
      ctx.setLineDash([7, 13]);
      ctx.lineDashOffset = -(state.time / 65) % 20;
      strokeGeoLine(remaining, 1.4, "rgba(255,255,255,0.72)", { dash: [7, 13], cap: "round" });
      ctx.restore();
      return;
    }
    drawRouteLine(active.points, 11, "rgba(12,139,131,0.12)");
    drawRouteLine(active.points, 7.4, "rgba(255,255,255,0.9)");
    drawRouteLine(active.points, 4.9, COLORS.route);
    drawOriginPuck(1);
    drawDestinationPin(state.selectedPoi, true);
  }

  function itemPoints(option) { return option.points; }

  function drawNavPuck() {
    if (!state.nav || !state.nav.position) return;
    var p = project(state.nav.position);
    var ctx = state.ctx;
    var heading = (state.nav.heading || 0) * Math.PI / 180;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 30, -Math.PI / 2 - 0.36, -Math.PI / 2 + 0.36);
    ctx.closePath();
    var cone = ctx.createRadialGradient(0, 0, 3, 0, 0, 30);
    cone.addColorStop(0, "rgba(12,139,131,0.2)");
    cone.addColorStop(1, "rgba(12,139,131,0)");
    ctx.fillStyle = cone;
    ctx.rotate(heading);
    ctx.fill();
    ctx.rotate(-heading);
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(253,252,248,0.94)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 7.4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.route;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fdfcf8";
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (!mapReady || !state.ctx) return;
    state.time = (global.performance && performance.now()) || Date.now();
    var ctx = state.ctx;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.labelBoxes = [];
    drawPaper();
    drawWater();
    drawParks();
    drawBlocks();
    drawMinorRoads();
    drawMajorRoads();
    drawRail();
    drawLandmarks();
    labelDistricts();
    labelWaterAndParks();
    labelRoads();
    drawPoiLabels();
    drawRouteSurface();
    if (state.nav) {
      drawNavPuck();
      drawDestinationPin(state.selectedPoi, false);
    } else if (!state.route) {
      drawOriginPuck(1);
      if (state.selectedPoi) drawDestinationPin(state.selectedPoi, state.view === "place");
    }
  }

  function invalidate() {
    if (state.raf) return;
    state.raf = global.requestAnimationFrame(function () {
      state.raf = 0;
      draw();
    });
  }

  function animateTo(target, duration) {
    var token = ++animToken;
    state.animation = null;
    var from = { center: { lng: state.center.lng, lat: state.center.lat }, scale: state.scale, offsetY: state.offsetY };
    var to = {
      center: { lng: target.center.lng, lat: target.center.lat },
      scale: target.scale == null ? HOME.scale : target.scale,
      offsetY: target.offsetY == null ? 0 : target.offsetY
    };
    var start = performance.now();
    var dur = duration || 850;
    state.animation = { from: from, to: to, start: start, dur: dur, token: token };
    function tick(now) {
      if (!state.animation || state.animation.token !== token) return;
      var t = clamp((now - start) / dur, 0, 1);
      var e = ease(t);
      state.center = { lng: lerp(from.center.lng, to.center.lng, e), lat: lerp(from.center.lat, to.center.lat, e) };
      state.scale = Math.exp(lerp(Math.log(from.scale), Math.log(to.scale), e));
      state.offsetY = lerp(from.offsetY, to.offsetY, e);
      draw();
      if (t < 1) global.requestAnimationFrame(tick);
      else state.animation = null;
    }
    global.requestAnimationFrame(tick);
  }

  function fitPoints(points, padding) {
    padding = padding || { top: 180, bottom: 440, left: 30, right: 30 };
    if (!points.length) return;
    var minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    points.forEach(function (p) {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    });
    var center = { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 };
    var cos = Math.cos(center.lat * RAD);
    var dx = (maxLng - minLng) * cos;
    var dy = maxLat - minLat;
    var availW = state.w - padding.left - padding.right;
    var availH = state.h - padding.top - padding.bottom;
    var scale = Math.min(availW / Math.max(dx, 0.0018), availH / Math.max(dy, 0.0018));
    scale = clamp(scale * 0.88, 650, 22000);
    animateTo({ center: center, scale: scale, offsetY: (padding.top - padding.bottom) / 2 }, 900);
  }

  function resetHome(animated) {
    state.route = null;
    state.nav = null;
    state.selectedPoi = null;
    state.view = "home";
    if (animated !== false) animateTo(HOME, 900);
    else {
      animToken++;
      state.animation = null;
      state.center = { lng: HOME.center.lng, lat: HOME.center.lat };
      state.scale = HOME.scale;
      state.offsetY = HOME.offsetY;
      invalidate();
    }
  }

  function flyToPoi(poi) {
    var loc = C.parseLocation(poi && poi.location);
    if (!loc) return;
    state.selectedPoi = poi;
    state.view = "place";
    animateTo({ center: loc, scale: 5200, offsetY: -150 }, 950);
    invalidate();
  }

  function showRoute(options, activeIndex, mode, poi, padBottom) {
    state.selectedPoi = poi || state.selectedPoi;
    state.view = "route";
    state.nav = null;
    var normalized = (options || []).map(normalizeOption).filter(function (o) { return o.points.length >= 2; });
    state.route = {
      options: normalized,
      activeIndex: clamp(activeIndex || 0, 0, Math.max(0, normalized.length - 1)),
      mode: mode,
      padBottom: padBottom || 438
    };
    if (!normalized.length) { invalidate(); return; }
    fitPoints(normalized[state.route.activeIndex].points, { top: 190, bottom: state.route.padBottom, left: 32, right: 32 });
  }

  function setActiveOption(index) {
    if (!state.route) return;
    state.route.activeIndex = clamp(index, 0, state.route.options.length - 1);
    var points = state.route.options[state.route.activeIndex].points;
    fitPoints(points, { top: 190, bottom: state.route.padBottom || 438, left: 32, right: 32 });
  }

  function startNavigation(options, activeIndex, mode, poi) {
    var option = (options || [])[activeIndex || 0];
    if (!option) return;
    var normalized = normalizeOption(option);
    if (normalized.points.length < 2) return;
    state.selectedPoi = poi;
    state.view = "nav";
    state.route = { options: [normalized], activeIndex: 0, mode: mode };
    state.nav = {
      points: normalized.points,
      cum: normalized.cum,
      total: normalized.cum[normalized.cum.length - 1],
      traveled: 0,
      position: normalized.points[0],
      heading: 0,
      mode: mode
    };
    state.center = { lng: normalized.points[0].lng, lat: normalized.points[0].lat };
    state.scale = mode === "walking" ? 27000 : 22000;
    state.offsetY = state.h * 0.1;
    invalidate();
  }

  function updateNavigation(traveled) {
    if (!state.nav) return;
    var nav = state.nav;
    nav.traveled = clamp(traveled, 0, nav.total);
    var pos = C.pointAtDistance(nav.points, nav.cum, Math.min(nav.total, nav.traveled + 22));
    var lookAhead = C.pointAtDistance(nav.points, nav.cum, Math.min(nav.total, nav.traveled + 75));
    nav.position = pos;
    nav.heading = pos.heading || 0;
    var target = { lng: lookAhead.lng, lat: lookAhead.lat };
    // gentle follow; avoids a camera snap at every GPS tick
    state.center.lng = lerp(state.center.lng, target.lng, 0.22);
    state.center.lat = lerp(state.center.lat, target.lat, 0.22);
    state.offsetY = state.h * 0.1;
    invalidate();
  }

  function stopNavigation() {
    state.nav = null;
    state.route = null;
    state.selectedPoi = null;
    state.view = "home";
    invalidate();
  }

  function setView(next) {
    state.view = next;
    invalidate();
  }

  function bindEvents() {
    var canvas = state.canvas;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", function (e) {
      if (state.view === "nav") return;
      e.preventDefault();
      zoomAt(state.scale * 1.45, e.offsetX, e.offsetY);
    });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  function localPoint(e) {
    var r = state.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e) {
    if (state.view === "nav") return;
    state.canvas.setPointerCapture && state.canvas.setPointerCapture(e.pointerId);
    var p = localPoint(e);
    state.pointers.set(e.pointerId, p);
    state.animation = null;
    state.moved = false;
    if (state.pointers.size === 1) {
      state.drag = { start: p, last: p, center: { lng: state.center.lng, lat: state.center.lat } };
      state.canvas.classList.add("is-dragging");
    } else if (state.pointers.size === 2) {
      var pts = Array.from(state.pointers.values());
      state.pinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        scale: state.scale,
        center: { lng: state.center.lng, lat: state.center.lat },
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      };
      state.drag = null;
    }
  }

  function onPointerMove(e) {
    if (state.view === "nav" || !state.pointers.has(e.pointerId)) return;
    var p = localPoint(e);
    state.pointers.set(e.pointerId, p);
    if (state.pointers.size === 1 && state.drag) {
      var dx = p.x - state.drag.last.x;
      var dy = p.y - state.drag.last.y;
      if (Math.abs(p.x - state.drag.start.x) + Math.abs(p.y - state.drag.start.y) > 4) state.moved = true;
      var cos = Math.cos(state.center.lat * RAD);
      state.center.lng -= dx / (cos * state.scale);
      state.center.lat += dy / state.scale;
      state.drag.last = p;
      invalidate();
    } else if (state.pointers.size === 2 && state.pinch) {
      var pts = Array.from(state.pointers.values());
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      var nextScale = clamp(state.pinch.scale * (dist / Math.max(1, state.pinch.dist)), 620, 30000);
      var anchor = unproject(state.pinch.mid.x, state.pinch.mid.y);
      state.scale = nextScale;
      var cos = Math.cos(state.center.lat * RAD);
      state.center.lng = anchor.lng - (state.pinch.mid.x - state.w / 2) / (cos * nextScale) - (mid.x - state.pinch.mid.x) / (cos * nextScale);
      state.center.lat = anchor.lat + (state.pinch.mid.y - state.h / 2 - state.offsetY) / nextScale + (mid.y - state.pinch.mid.y) / nextScale;
      state.moved = true;
      invalidate();
    }
  }

  function onPointerUp(e) {
    if (!state.pointers.has(e.pointerId)) return;
    var wasSingle = state.pointers.size === 1;
    state.pointers.delete(e.pointerId);
    state.canvas.classList.remove("is-dragging");
    if (wasSingle && !state.moved && state.drag) {
      if (state.callbacks.onMapTap) state.callbacks.onMapTap(e);
    }
    state.drag = null;
    if (state.pointers.size < 2) state.pinch = null;
    if (state.pointers.size === 1) {
      var left = state.pointers.values().next().value;
      state.drag = { start: left, last: left, center: { lng: state.center.lng, lat: state.center.lat } };
    }
  }

  function zoomAt(nextScale, x, y) {
    nextScale = clamp(nextScale, 620, 30000);
    var anchor = unproject(x, y);
    state.scale = nextScale;
    var cos = Math.cos(state.center.lat * RAD);
    state.center.lng = anchor.lng - (x - state.w / 2) / (cos * nextScale);
    state.center.lat = anchor.lat + (y - state.h / 2 - state.offsetY) / nextScale;
    invalidate();
  }

  function onWheel(e) {
    if (state.view === "nav") return;
    e.preventDefault();
    var p = localPoint(e);
    var factor = Math.exp(-e.deltaY * 0.0014);
    zoomAt(state.scale * factor, p.x, p.y);
  }

  function hitPoi(x, y) {
    if (!state.pois.length) return null;
    var best = null;
    var bestD = 30;
    state.pois.forEach(function (poi) {
      var loc = C.parseLocation(poi.location);
      if (!loc) return;
      var p = project(loc);
      var d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = poi; }
    });
    return best;
  }

  // Public API
  global.CiapMap = {
    init: init,
    setOrigin: function (o) { state.origin = C.parseLocation(o) || state.origin; invalidate(); },
    setPois: function (pois) { state.pois = pois || []; invalidate(); },
    setView: setView,
    resetHome: resetHome,
    flyToPoi: flyToPoi,
    showRoute: showRoute,
    setActiveOption: setActiveOption,
    startNavigation: startNavigation,
    updateNavigation: updateNavigation,
    stopNavigation: stopNavigation,
    invalidate: invalidate,
    hitPoi: hitPoi,
    getState: function () { return state; },
    setCallbacks: function (cb) { state.callbacks = cb || {}; }
  };
})(window);
