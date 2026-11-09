/* ciap — interaction prototype controller. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var DATA = window.CIAP_FIXTURES || { meta: {}, origin: {}, pois: [], routes: {} };
  var C = window.CiapCore;
  var MAP = window.CiapMap;

  var origin = DATA.origin || { name: "我的位置", label: "泉城广场", location: "117.022086,36.661373" };
  var pois = Array.isArray(DATA.pois) ? DATA.pois : [];
  var routes = DATA.routes || {};

  var device = $("device");
  var searchScreen = $("search-screen");
  var placeSheet = $("place-sheet");
  var routeScreen = $("route-screen");
  var navUi = $("nav-ui");
  var searchInput = $("search-input");
  var searchClear = $("search-clear");
  var searchResults = $("search-results");
  var searchRecents = $("search-recents");
  var searchHotSection = $("search-hot-section");
  var searchRelated = $("search-related");
  var searchRelatedList = $("search-related-list");
  var searchEmpty = $("search-empty");
  var searchRecentList = $("search-recent-list");
  var placeDrag = $("place-grab");
  var modeRow = $("mode-row");
  var modeSwitch = $("mode-switch");
  var routeSheet = document.querySelector(".route-sheet");
  var routeOptionsEl = $("route-options");
  var routeDetailEl = $("route-detail");
  var arriveCard = $("arrive-card");
  var toastEl = $("toast");
  var splash = $("splash");

  var state = {
    view: "home",
    previousView: "home",
    searchOpen: false,
    searchIntent: "home",
    selectedPoi: null,
    mode: "driving",
    optionIndex: 0,
    currentOptions: [],
    routeOrigin: "home",
    detailOpen: false,
    history: [],
    nav: null,
    navRaf: 0,
    navSimPaused: false,
    lastStatus: 0
  };

  var toastTimer = 0;
  var placeDragState = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function icon(name) {
    return '<svg class="ico" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }

  function findPoi(key) {
    if (!key) return null;
    if (typeof key === "object" && key.id) return key;
    var value = String(key);
    return pois.find(function (p) { return p.id === value; }) ||
      pois.find(function (p) { return p.shortName === value; }) ||
      pois.find(function (p) { return p.name === value; }) ||
      pois.find(function (p) { return p.name.indexOf(value) >= 0; }) ||
      null;
  }

  function routeOptions(poi, mode) {
    return (routes[poi.id] && routes[poi.id][mode] && routes[poi.id][mode].options) || [];
  }

  function firstRoute(poi, mode) {
    return routeOptions(poi, mode)[0] || null;
  }

  function routePad() {
    return state.currentOptions.length === 1 ? 325 : 438;
  }

  function category(poi) { return C.categoryOf(poi); }

  function shortDuration(seconds) {
    var mins = Math.max(1, Math.round((Number(seconds) || 0) / 60));
    if (mins < 60) return mins + " 分";
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return h + " 小时" + (m ? " " + m + " 分" : "");
  }

  function turnIcon(action) {
    var a = String(action || "");
    if (a.indexOf("掉头") >= 0) return "turn-left";
    if (a.indexOf("左") >= 0) return "turn-left";
    if (a.indexOf("右") >= 0) return "turn-right";
    return "straight";
  }

  function roadSummary(option) {
    var seen = {};
    var names = [];
    (option.steps || []).forEach(function (step) {
      var road = String(step.road || "").split(";")[0].trim();
      if (road.length > 1 && road.length < 18 && !seen[road]) {
        seen[road] = 1;
        names.push(road);
      }
    });
    return names.slice(0, 2).join(" · ");
  }

  function lineShort(name) {
    return String(name || "")
      .replace(/\(.*\)/g, "")
      .replace(/（.*）/g, "")
      .trim();
  }

  var METRO_TINTS = [
    ["rgba(60, 120, 190, 0.12)", "#356fa8"],
    ["rgba(193, 132, 62, 0.13)", "#a06b2e"],
    ["rgba(108, 146, 85, 0.13)", "#5e8448"],
    ["rgba(146, 96, 145, 0.12)", "#875b85"],
    ["rgba(70, 145, 143, 0.13)", "#3d7d7b"]
  ];

  function lineBadges(option) {
    var badges = [];
    (option.segments || []).forEach(function (segment, i) {
      if (!segment || segment.type === "walk") return;
      var isMetro = /地铁|号线/.test(String(segment.lineType || "") + String(segment.lineName || ""));
      var tint = isMetro ? METRO_TINTS[i % METRO_TINTS.length] : ["rgba(24,32,31,0.055)", "#59625c"];
      badges.push('<span class="line-badge" style="--line-bg:' + tint[0] + ';--line-fg:' + tint[1] + '">' + esc(lineShort(segment.lineName)) + "</span>");
    });
    if (!badges.length) return "";
    return '<div class="transit-badges">' + badges.slice(0, 4).join('<span class="transit-arrow">›</span>') + "</div>";
  }

  function optionMeta(option, mode) {
    if (mode === "transit") {
      return C.formatDistance(option.distance) + " · ¥" + (option.cost == null ? "—" : option.cost) +
        " · 换乘 " + (option.transfers || 0) + " 次 · 步行 " + C.formatDistance(option.walkingDistance || 0);
    }
    if (mode === "driving") {
      return C.formatDistance(option.distance) + " · " +
        (option.trafficLights ? option.trafficLights + " 个红绿灯" : "红绿灯少") + " · " +
        (option.tolls ? "过路费 " + option.tolls + " 元" : "无收费");
    }
    var roads = roadSummary(option);
    return C.formatDistance(option.distance) + (roads ? " · 途经 " + roads : " · 城市道路");
  }

  function optionHTML(option, index) {
    var active = index === state.optionIndex;
    var mins = Math.max(1, Math.round(option.duration / 60));
    var tag = state.currentOptions.length > 1 ? '<span class="option-tag">' + esc(option.label || "备选") + "</span>" : "";
    var badges = state.mode === "transit" ? lineBadges(option) : "";
    return '<button class="route-option' + (active ? " is-active" : "") + '" type="button" data-index="' + index + '" aria-pressed="' + active + '">' +
      '<span class="option-body">' +
        '<span class="option-line"><span class="option-time">' + mins + '<span class="unit">分钟</span></span>' + tag + "</span>" +
        badges +
        '<span class="option-meta">' + esc(optionMeta(option, state.mode)) + "</span>" +
      "</span>" +
      '<span class="option-radio" aria-hidden="true"></span>' +
      "</button>";
  }

  function detailHTML(option) {
    var html = '<div class="detail-head"><b>' + esc(C.modeOf(state.mode).label) + "详情</b><span>" +
      C.formatDistance(option.distance) + " · " + C.formatDuration(option.duration) + "</span></div>";
    if (state.mode === "transit") {
      (option.segments || []).forEach(function (segment) {
        var isWalk = segment.type === "walk";
        var mark = isWalk ? "walk" : (/地铁|号线/.test(String(segment.lineType || "") + String(segment.lineName || "")) ? "train" : "bus");
        html += '<div class="segment"><span class="segment-mark">' + icon(mark) + "</span>" +
          '<span class="segment-copy">' + esc(isWalk ? (segment.instruction || "步行前往") : (lineShort(segment.lineName) + " → " + segment.toStop)) +
          "<span>" + esc(isWalk ? segment.distance + " 米" : (segment.fromStop ? "从 " + segment.fromStop + " 上车" : "") + (segment.viaStops ? " · 乘坐 " + segment.viaStops + " 站" : "")) + "</span></span>" +
          '<span class="segment-time">' + Math.max(1, Math.round((segment.duration || 0) / 60)) + " 分</span></div>";
      });
    } else {
      var steps = option.steps || [];
      var cap = state.mode === "driving" ? 42 : 32;
      steps.slice(0, cap).forEach(function (step, i) {
        var road = String(step.road || "").trim();
        html += '<div class="step"><span class="step-icon">' + icon(turnIcon(step.action)) + "</span>" +
          '<span class="step-copy"><b>' + esc(step.instruction || ((step.action || "继续") + (road ? "进入" + road : ""))) + "</b>" +
          (road ? "<span>" + esc(road) + "</span>" : "") + "</span>" +
          '<span class="step-dist">' + C.formatDistance(step.distance) + "</span></div>";
      });
      if (steps.length > cap) {
        html += '<div class="detail-foot">演示仅展开前 ' + cap + " 段，共 " + steps.length + " 段。</div>";
      }
    }
    html += '<div class="detail-foot">路线来自 AMap · 演示数据，实际以实时路况与规划为准。</div>';
    return html;
  }

  function renderRouteSheet() {
    var option = state.currentOptions[state.optionIndex];
    if (!option) return;
    $("route-eyebrow").textContent = C.modeOf(state.mode).label + (state.currentOptions.length > 1 ? " · " + (option.label || "路线") : "");
    $("route-title").textContent = C.formatDuration(option.duration);
    $("route-summary").textContent = C.formatDistance(option.distance) + (state.mode === "transit" ? " · ¥" + (option.cost == null ? "—" : option.cost) : "");
    routeOptionsEl.innerHTML = state.currentOptions.map(optionHTML).join("") +
      '<div class="route-hint"><span class="hint-dot"></span>' + (state.mode === "transit" ? "换乘信息来自 AMap" : "路线来自 AMap") + " · 演示数据</div>";
    routeDetailEl.innerHTML = detailHTML(option);
    routeOptionsEl.hidden = state.detailOpen;
    routeDetailEl.hidden = !state.detailOpen;
    routeSheet.classList.toggle("compact", state.currentOptions.length === 1);
    $("detail-toggle").textContent = state.detailOpen ? "收起详情" : "路线详情";
    $("start-nav").innerHTML = "开始导航" + icon("arrow");
  }

  function renderModeSwitch() {
    modeSwitch.innerHTML = C.MODE_ORDER.map(function (mode) {
      var m = C.modeOf(mode);
      return '<button class="mode-tab' + (mode === state.mode ? " is-active" : "") + '" type="button" role="tab" aria-selected="' + (mode === state.mode) + '" data-mode="' + mode + '">' + icon(m.icon) + "<span>" + m.label + "</span></button>";
    }).join("");
  }

  function renderQuickList() {
    var names = ["大明湖", "趵突泉", "宽厚里"];
    var list = names.map(function (name) { return pois.find(function (p) { return p.shortName === name; }) || findPoi(name); }).filter(Boolean);
    if (!list.length) list = pois.slice().sort(function (a, b) { return a.distanceMeters - b.distanceMeters; }).slice(0, 3);
    $("quick-list").innerHTML = list.map(function (poi) {
      var cat = category(poi);
      var option = firstRoute(poi, "driving");
      return '<button class="quick-card" type="button" data-quick="' + esc(poi.id) + '" aria-label="驾车前往' + esc(poi.name) + '">' +
        '<span class="quick-icon ' + cat.tint + '">' + icon(cat.icon) + "</span>" +
        '<span class="quick-copy"><span class="quick-name">' + esc(poi.shortName || poi.name) + "</span>" +
        '<span class="quick-meta">' + (option ? "驾车 " + shortDuration(option.duration) : "路线准备中") + "</span></span></button>";
    }).join("");
    $("home-footnote").textContent = "从" + origin.label + "出发";
  }

  function recentPois() {
    var ids = state.history.slice();
    var defaults = ["大明湖", "趵突泉", "宽厚里"];
    defaults.forEach(function (name) {
      var poi = pois.find(function (p) { return p.shortName === name; });
      if (poi && ids.indexOf(poi.id) < 0) ids.push(poi.id);
    });
    return ids.map(function (id) { return pois.find(function (p) { return p.id === id; }); }).filter(Boolean).slice(0, 4);
  }

  function remember(poi) {
    state.history = [poi.id].concat(state.history.filter(function (id) { return id !== poi.id; })).slice(0, 8);
  }

  function rowHTML(poi, kind) {
    var cat = category(poi);
    var meta = cat.label + " · " + (poi.address || (poi.type || "").split(";").slice(-1)[0] || "济南");
    return '<button class="result-row" type="button" data-poi-id="' + esc(poi.id) + '">' +
      '<span class="result-icon ' + cat.tint + '">' + icon(kind === "recent" ? "clock" : cat.icon) + "</span>" +
      '<span class="result-copy"><span class="result-name">' + esc(poi.name) + "</span>" +
      '<span class="result-meta">' + esc(meta) + "</span></span>" +
      '<span class="result-distance">' + C.formatDistance(poi.distanceMeters) + "</span></button>";
  }

  function renderSearch() {
    var q = searchInput.value.trim();
    var recents = recentPois();
    var matches = C.searchPois(pois, q);
    searchRelated.hidden = true;
    searchRelatedList.innerHTML = "";
    if (!q) {
      searchRecents.hidden = false;
      searchHotSection.hidden = false;
      searchEmpty.hidden = true;
      searchHotSection.querySelector(".eyebrow").textContent = "济南热门";
      searchHotSection.querySelector(".section-note").textContent = "按距离";
      searchRecentList.innerHTML = recents.map(function (p) { return rowHTML(p, "recent"); }).join("");
      searchResults.innerHTML = matches.slice(0, 8).map(function (p) { return rowHTML(p, "hot"); }).join("");
    } else {
      searchRecents.hidden = true;
      searchHotSection.hidden = true;
      searchResults.innerHTML = "";
      if (matches.length) {
        searchEmpty.hidden = true;
        searchHotSection.hidden = false;
        searchHotSection.querySelector(".eyebrow").textContent = "搜索结果";
        searchHotSection.querySelector(".section-note").textContent = matches.length + " 个地点";
        searchResults.innerHTML = matches.slice(0, 8).map(function (p) { return rowHTML(p, "hot"); }).join("");
        if (matches.length < 4) {
          var found = {};
          matches.forEach(function (p) { found[p.id] = 1; });
          var related = pois.filter(function (p) { return !found[p.id]; })
            .sort(function (a, b) { return a.distanceMeters - b.distanceMeters; })
            .slice(0, 3);
          if (related.length) {
            searchRelated.hidden = false;
            searchRelatedList.innerHTML = related.map(function (p) { return rowHTML(p, "hot"); }).join("");
          }
        }
      } else {
        searchEmpty.hidden = false;
        searchEmpty.innerHTML = '<div class="empty-mark">' + icon("pin") + "</div><h3>没找到「" + esc(q) + "」</h3><p>换个说法试试，比如「大明湖」</p>";
      }
    }
    searchClear.hidden = !q;
  }

  function openSearch(intent) {
    hideToast();
    state.previousView = state.view;
    state.searchIntent = intent || "home";
    state.searchOpen = true;
    searchInput.value = "";
    searchInput.placeholder = state.searchIntent === "destination" ? "搜索终点" : "搜索济南";
    renderSearch();
    applyVisibility();
    window.setTimeout(function () { if (state.searchOpen) searchInput.focus(); }, 260);
  }

  function closeSearch() {
    state.searchOpen = false;
    searchInput.blur();
    applyVisibility();
  }

  function selectSearchResult(poi) {
    if (!poi) return;
    remember(poi);
    var intent = state.searchIntent;
    closeSearch();
    if (intent === "destination") {
      openRoute(poi, state.mode, "home");
    } else {
      openPlace(poi);
    }
  }

  function openPlace(poi) {
    if (!poi) return;
    hideToast();
    state.selectedPoi = poi;
    state.view = "place";
    state.searchOpen = false;
    state.detailOpen = false;
    state.optionIndex = 0;
    var cat = category(poi);
    var parts = String(poi.type || "").split(";").filter(Boolean);
    var last = parts[parts.length - 1] || "";
    var typeText = cat.label;
    if (last && last.length <= 10 && last.indexOf(cat.label) < 0) typeText += " · " + last;
    else if (poi.rating) typeText += " · " + poi.rating.toFixed(1) + " 分";
    $("place-type").textContent = typeText;
    $("place-name").textContent = poi.name;
    $("place-address").textContent = poi.address || "济南";
    var walk = firstRoute(poi, "walking");
    var drive = firstRoute(poi, "driving");
    var meta = "距你 " + C.formatDistance(poi.distanceMeters);
    if (poi.distanceMeters > 2500 && drive) meta += " · 驾车 " + C.formatDuration(drive.duration);
    else if (walk) meta += " · 步行 " + C.formatDuration(walk.duration);
    $("place-meta").textContent = meta;
    modeRow.innerHTML = C.MODE_ORDER.map(function (mode) {
      var m = C.modeOf(mode);
      var opt = firstRoute(poi, mode);
      return '<button class="mode-tile" type="button" data-mode="' + mode + '" aria-label="' + m.label + "前往" + esc(poi.name) + '">' +
        icon(m.icon) + "<b>" + m.label + "</b><span>" + (opt ? shortDuration(opt.duration) : "—") + "</span></button>";
    }).join("");
    placeSheet.style.transform = "";
    applyVisibility();
    MAP.setView("place");
    MAP.flyToPoi(poi);
  }

  function closePlace() {
    if (state.view !== "place") return;
    state.view = "home";
    state.selectedPoi = null;
    placeSheet.style.transform = "";
    applyVisibility();
    MAP.resetHome(true);
    MAP.setView("home");
  }

  function openRoute(poi, mode, routeOrigin) {
    if (!poi) return;
    hideToast();
    var from = routeOrigin || (state.view === "place" ? "place" : "home");
    state.selectedPoi = poi;
    state.mode = mode || "driving";
    state.optionIndex = 0;
    state.detailOpen = false;
    state.currentOptions = routeOptions(poi, state.mode);
    if (!state.currentOptions.length) {
      toast("这条路线的演示数据还没有准备好");
      return;
    }
    state.routeOrigin = from;
    state.view = "route";
    state.searchOpen = false;
    state.previousView = "route";
    $("trip-origin").textContent = "我的位置 · " + origin.label;
    $("trip-dest").textContent = poi.name;
    renderModeSwitch();
    renderRouteSheet();
    applyVisibility();
    MAP.setView("route");
    MAP.showRoute(state.currentOptions, 0, state.mode, poi, routePad());
  }

  function backFromRoute() {
    if (state.routeOrigin === "place" && state.selectedPoi) {
      openPlace(state.selectedPoi);
      return;
    }
    goHome();
  }

  function changeMode(mode) {
    if (mode === state.mode || !state.selectedPoi) return;
    var options = routeOptions(state.selectedPoi, mode);
    if (!options.length) { toast("这条路线暂无演示数据"); return; }
    state.mode = mode;
    state.optionIndex = 0;
    state.detailOpen = false;
    state.currentOptions = options;
    renderModeSwitch();
    renderRouteSheet();
    MAP.showRoute(options, 0, mode, state.selectedPoi, routePad());
  }

  function selectOption(index) {
    if (index < 0 || index >= state.currentOptions.length || index === state.optionIndex) return;
    state.optionIndex = index;
    state.detailOpen = false;
    renderRouteSheet();
    MAP.setActiveOption(index);
  }

  function toggleDetail() {
    state.detailOpen = !state.detailOpen;
    routeOptionsEl.hidden = state.detailOpen;
    routeDetailEl.hidden = !state.detailOpen;
    $("detail-toggle").textContent = state.detailOpen ? "收起详情" : "路线详情";
    routeScreen.querySelector(".route-scroll").scrollTop = 0;
  }

  function goHome() {
    stopNavLoop();
    state.nav = null;
    state.view = "home";
    hideToast();
    state.searchOpen = false;
    state.selectedPoi = null;
    state.currentOptions = [];
    state.detailOpen = false;
    placeSheet.style.transform = "";
    arriveCard.classList.remove("is-visible");
    arriveCard.hidden = true;
    navUi.classList.remove("is-arrived");
    applyVisibility();
    MAP.stopNavigation();
    MAP.setView("home");
    MAP.resetHome(true);
  }

  function applyVisibility() {
    var search = state.searchOpen;
    device.dataset.view = search ? "search" : state.view;
    searchScreen.classList.toggle("is-open", search);
    searchScreen.setAttribute("aria-hidden", String(!search));
    var placeOpen = !search && state.view === "place";
    placeSheet.classList.toggle("is-open", placeOpen);
    placeSheet.setAttribute("aria-hidden", String(!placeOpen));
    var routeVisible = search ? state.previousView === "route" : state.view === "route";
    routeScreen.classList.toggle("is-visible", routeVisible);
    routeScreen.setAttribute("aria-hidden", String(!routeVisible));
    var navVisible = !search && state.view === "nav";
    navUi.classList.toggle("is-visible", navVisible);
    navUi.setAttribute("aria-hidden", String(!navVisible));
  }

  function toast(message) {
    if (!message) return;
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toastEl.classList.remove("is-visible"); }, 2400);
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    toastEl.classList.remove("is-visible");
  }

  /* ---------- navigation ---------- */
  var SIM_SPEED = 40;

  function startNavigation() {
    var option = state.currentOptions[state.optionIndex];
    var poi = state.selectedPoi;
    if (!option || !poi) return;
    var points = C.normalizePolyline(option.polyline);
    if (points.length < 2) { toast("路线数据不完整"); return; }
    var cum = C.cumulativeDistances(points);
    var steps = option.steps || [];
    var stepCum = [];
    var acc = 0;
    steps.forEach(function (step) {
      acc += Number(step.distance) || 0;
      stepCum.push(acc);
    });
    var segmentCum = [];
    var segAcc = 0;
    (option.segments || []).forEach(function (segment) {
      segAcc += Number(segment.duration) || 0;
      segmentCum.push(segAcc);
    });
    state.view = "nav";
    state.searchOpen = false;
    state.previousView = "nav";
    state.nav = {
      option: option,
      poi: poi,
      mode: state.mode,
      points: points,
      cum: cum,
      totalGeo: cum[cum.length - 1],
      totalDuration: option.duration,
      steps: steps,
      stepCum: stepCum,
      stepTotal: acc,
      segments: option.segments || [],
      segmentCum: segmentCum,
      segmentTotal: segAcc,
      simTime: 0,
      lastTick: 0,
      lastHud: 0,
      lastCardKey: "",
      paused: false,
      finished: false
    };
    navUi.classList.remove("is-arrived");
    arriveCard.classList.remove("is-visible");
    arriveCard.hidden = true;
    $("end-nav").style.visibility = "visible";
    $("nav-demo").style.visibility = "visible";
    MAP.startNavigation([option], 0, state.mode, poi);
    updateNavHud(0);
    updateManeuver(0);
    applyVisibility();
    resumeNavLoop();
  }

  function resumeNavLoop() {
    if (!state.nav || state.nav.finished) return;
    state.nav.paused = false;
    state.nav.lastTick = performance.now();
    cancelAnimationFrame(state.navRaf);
    state.navRaf = requestAnimationFrame(tickNav);
  }

  function tickNav(now) {
    var nav = state.nav;
    if (!nav || nav.finished || nav.paused) return;
    if (!nav.lastTick) nav.lastTick = now;
    var dt = Math.min(120, now - nav.lastTick);
    nav.lastTick = now;
    nav.simTime += (dt / 1000) * SIM_SPEED;
    var ratio = Math.min(1, nav.simTime / nav.totalDuration);
    var traveled = ratio * nav.totalGeo;
    MAP.updateNavigation(traveled);
    updateNavHud(now);
    updateManeuver(ratio);
    if (ratio >= 1) {
      finishNavigation();
      return;
    }
    state.navRaf = requestAnimationFrame(tickNav);
  }

  function updateNavHud(now) {
    var nav = state.nav;
    if (!nav) return;
    if (now && now - nav.lastHud < 110 && nav.lastHud) return;
    nav.lastHud = now || performance.now();
    var ratio = Math.min(1, nav.simTime / nav.totalDuration);
    var remainingSeconds = Math.max(0, nav.totalDuration * (1 - ratio));
    var remainingDistance = Math.max(0, nav.option.distance * (1 - ratio));
    $("nav-remain").textContent = C.formatDuration(remainingSeconds);
    $("nav-distance").textContent = C.formatDistance(remainingDistance);
    $("nav-eta").textContent = C.formatETA(remainingSeconds);
  }

  function setText(id, text) {
    var node = $(id);
    if (node && node.textContent !== text) node.textContent = text;
  }

  function setManeuverIcon(name) {
    var node = $("maneuver-icon");
    var key = "icon-" + name;
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    node.innerHTML = icon(name);
  }

  function updateManeuver(ratio) {
    var nav = state.nav;
    if (!nav) return;
    if (nav.mode === "transit") {
      updateTransitCard(ratio);
      return;
    }
    var steps = nav.steps;
    if (!steps.length) {
      setText("maneuver-distance", "继续前行");
      setText("maneuver-text", "沿当前道路行驶");
      setText("maneuver-next", "即将到达 " + (nav.poi.shortName || nav.poi.name));
      setManeuverIcon("straight");
      return;
    }
    var stepDistance = ratio * nav.stepTotal;
    var index = 0;
    while (index < nav.stepCum.length - 1 && nav.stepCum[index] < stepDistance) index++;
    var step = steps[index];
    var remain = Math.max(0, nav.stepCum[index] - stepDistance);
    var distanceText = remain < 12 ? "现在" : C.formatDistance(remain);
    var instruction = step.instruction || ((step.action || "继续") + (step.road ? "进入" + step.road : ""));
    var next = steps[index + 1];
    var nextText = next ? "然后 " + (next.action || "继续") + (next.distance ? " " + C.formatDistance(next.distance) : "") : "即将到达 " + (nav.poi.shortName || nav.poi.name);
    setText("maneuver-distance", distanceText);
    setText("maneuver-text", instruction);
    setText("maneuver-next", nextText);
    setManeuverIcon(turnIcon(step.action));
    $("nav-demo").textContent = "模拟 ×" + SIM_SPEED + " · " + (nav.mode === "walking" ? "步行" : nav.mode === "bicycling" ? "骑行" : "驾车");
  }

  function updateTransitCard(ratio) {
    var nav = state.nav;
    var segments = nav.segments;
    if (!segments.length) return;
    var elapsed = ratio * (nav.segmentTotal || nav.totalDuration);
    var index = 0;
    while (index < nav.segmentCum.length - 1 && nav.segmentCum[index] < elapsed) index++;
    var segment = segments[index] || segments[segments.length - 1];
    var isWalk = segment.type === "walk";
    if (isWalk) {
      setText("maneuver-distance", C.formatDistance(segment.distance));
      setText("maneuver-text", segment.instruction || "步行前往站点");
      setText("maneuver-next", "到站后上车");
      setManeuverIcon("walk");
    } else {
      var line = lineShort(segment.lineName);
      setText("maneuver-distance", (segment.viaStops ? segment.viaStops + " 站" : "乘车"));
      setText("maneuver-text", "乘坐 " + line);
      setText("maneuver-next", "在 " + (segment.toStop || "下一站") + " 下车");
      setManeuverIcon(/地铁|号线/.test(String(segment.lineType || "") + String(segment.lineName || "")) ? "train" : "bus");
    }
    $("nav-demo").textContent = "模拟 ×" + SIM_SPEED + " · 公交";
  }

  function finishNavigation() {
    var nav = state.nav;
    if (!nav) return;
    nav.finished = true;
    cancelAnimationFrame(state.navRaf);
    state.navRaf = 0;
    MAP.updateNavigation(nav.totalGeo);
    $("arrive-place").textContent = nav.poi.shortName || nav.poi.name;
    arriveCard.hidden = false;
    requestAnimationFrame(function () { arriveCard.classList.add("is-visible"); });
    navUi.classList.add("is-arrived");
    $("nav-demo").style.visibility = "hidden";
  }

  function stopNavLoop() {
    cancelAnimationFrame(state.navRaf);
    state.navRaf = 0;
    if (state.nav) state.nav.paused = true;
  }

  function endNavigation() {
    stopNavLoop();
    var nav = state.nav;
    if (!nav) { goHome(); return; }
    var poi = nav.poi;
    var mode = nav.mode;
    var optionIndex = state.optionIndex;
    state.nav = null;
    navUi.classList.remove("is-arrived");
    arriveCard.classList.remove("is-visible");
    arriveCard.hidden = true;
    state.view = "route";
    state.selectedPoi = poi;
    state.mode = mode;
    state.currentOptions = routeOptions(poi, mode);
    state.optionIndex = Math.min(optionIndex, Math.max(0, state.currentOptions.length - 1));
    state.detailOpen = false;
    state.previousView = "route";
    MAP.stopNavigation();
    MAP.setView("route");
    renderModeSwitch();
    renderRouteSheet();
    applyVisibility();
    MAP.showRoute(state.currentOptions, state.optionIndex, mode, poi, routePad());
    toast("导航已结束");
  }

  function seekNav(ratio) {
    var nav = state.nav;
    if (!nav) return;
    stopNavLoop();
    var t = Math.max(0, Math.min(1, Number(ratio) || 0));
    nav.simTime = t * nav.totalDuration;
    var traveled = t * nav.totalGeo;
    MAP.updateNavigation(traveled);
    updateNavHud();
    updateManeuver(t);
    if (t >= 1) finishNavigation();
  }

  window.ciap = {
    data: DATA,
    state: state,
    openSearch: openSearch,
    openPlace: function (key) {
      var poi = findPoi(key);
      if (poi) { closeSearch(); openPlace(poi); }
    },
    openRoute: function (key, mode, from) {
      var poi = findPoi(key);
      if (poi) { closeSearch(); openRoute(poi, mode || "driving", from || "home"); }
    },
    changeMode: changeMode,
    selectOption: selectOption,
    startNavigation: startNavigation,
    seekNav: seekNav,
    resumeNav: function () { if (state.nav && !state.nav.finished) { state.nav.paused = false; resumeNavLoop(); } },
    pauseNav: function () { if (state.nav) { state.nav.paused = true; stopNavLoop(); } },
    endNavigation: endNavigation,
    goHome: goHome,
    closePlace: closePlace,
    search: function (q) {
      if (!state.searchOpen) openSearch("home");
      searchInput.value = q || "";
      renderSearch();
    },
    dismissSplash: dismissSplash
  };

  /* ---------- events ---------- */
  function bindEvents() {
    $("search-open").addEventListener("click", function () { openSearch("home"); });
    $("route-open").addEventListener("click", function () { openSearch("destination"); });
    $("locate-btn").addEventListener("click", function () {
      if (state.view === "home") {
        MAP.resetHome(true);
        toast("回到泉城广场");
      }
    });
    $("search-back").addEventListener("click", closeSearch);
    $("search-cancel").addEventListener("click", closeSearch);
    searchClear.addEventListener("click", function () {
      searchInput.value = "";
      renderSearch();
      searchInput.focus();
    });
    searchInput.addEventListener("input", renderSearch);
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var matches = C.searchPois(pois, searchInput.value.trim());
        if (matches.length) selectSearchResult(matches[0]);
      }
    });
    searchScreen.addEventListener("click", function (e) {
      var row = e.target.closest("[data-poi-id]");
      if (!row) return;
      selectSearchResult(pois.find(function (p) { return p.id === row.dataset.poiId; }));
    });
    $("quick-list").addEventListener("click", function (e) {
      var card = e.target.closest("[data-quick]");
      if (!card) return;
      var poi = pois.find(function (p) { return p.id === card.dataset.quick; });
      if (poi) openRoute(poi, "driving", "home");
    });
    $("place-close").addEventListener("click", closePlace);
    modeRow.addEventListener("click", function (e) {
      var tile = e.target.closest("[data-mode]");
      if (!tile || !state.selectedPoi) return;
      openRoute(state.selectedPoi, tile.dataset.mode, "place");
    });
    $("route-back").addEventListener("click", backFromRoute);
    $("trip-dest-btn").addEventListener("click", function () { openSearch("destination"); });
    modeSwitch.addEventListener("click", function (e) {
      var tab = e.target.closest("[data-mode]");
      if (tab) changeMode(tab.dataset.mode);
    });
    routeOptionsEl.addEventListener("click", function (e) {
      var card = e.target.closest("[data-index]");
      if (card) selectOption(Number(card.dataset.index));
    });
    $("detail-toggle").addEventListener("click", toggleDetail);
    $("start-nav").addEventListener("click", startNavigation);
    $("end-nav").addEventListener("click", endNavigation);
    $("arrive-done").addEventListener("click", goHome);
    MAP.setCallbacks({ onMapTap: function () { if (state.view === "place") closePlace(); } });

    // place sheet drag-to-dismiss
    placeDrag.addEventListener("pointerdown", function (e) {
      if (!placeSheet.classList.contains("is-open")) return;
      placeDrag.setPointerCapture && placeDrag.setPointerCapture(e.pointerId);
      placeDragState = { startY: e.clientY, dy: 0 };
      placeSheet.classList.add("is-dragging");
    });
    placeDrag.addEventListener("pointermove", function (e) {
      if (!placeDragState) return;
      var dy = Math.max(-16, e.clientY - placeDragState.startY);
      placeDragState.dy = dy;
      placeSheet.style.transform = "translateY(" + Math.max(0, dy) + "px)";
    });
    placeDrag.addEventListener("pointerup", function () {
      if (!placeDragState) return;
      var dy = placeDragState.dy;
      placeDragState = null;
      placeSheet.classList.remove("is-dragging");
      placeSheet.style.transform = "";
      if (dy > 86) closePlace();
    });
    placeDrag.addEventListener("pointercancel", function () {
      placeDragState = null;
      placeSheet.classList.remove("is-dragging");
      placeSheet.style.transform = "";
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (state.searchOpen) closeSearch();
      else if (state.view === "nav") endNavigation();
      else if (state.view === "route") backFromRoute();
      else if (state.view === "place") closePlace();
    });
  }

  function tickStatus() {
    var now = new Date();
    var time = C.formatClock(now);
    $("status-time").textContent = time;
  }

  function dismissSplash() {
    if (!splash || splash.classList.contains("is-done")) return;
    splash.classList.add("is-done");
    if (!splash.dataset.keep) window.setTimeout(function () { if (splash && splash.parentNode) splash.parentNode.removeChild(splash); }, 800);
  }

  function boot() {
    state.history = ["大明湖", "趵突泉", "宽厚里"].map(function (name) {
      var poi = pois.find(function (p) { return p.shortName === name; });
      return poi ? poi.id : null;
    }).filter(Boolean);
    tickStatus();
    window.setInterval(tickStatus, 30000);
    if (!DATA.pois || !DATA.pois.length) {
      toast("地图数据没有加载，请检查 js/fixtures.js");
      return;
    }
    MAP.init($("map"), {
      origin: origin.location,
      pois: pois,
      callbacks: {
        onMapTap: function () {
          if (state.view === "place") closePlace();
        }
      }
    });
    renderQuickList();
    renderSearch();
    bindEvents();
    var params = new URLSearchParams(window.location.search);
    if (params.get("nointro") === "1" || params.get("skip") === "1") {
      dismissSplash();
    } else {
      window.setTimeout(dismissSplash, 1900);
      splash.addEventListener("click", dismissSplash);
    }
  }

  boot();
})();
