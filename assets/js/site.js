(function () {
  "use strict";
  var doc = document, win = window;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent) {
    var n = doc.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  var INK = "#141414", GRAPHITE = "#6b6b6b", RULE = "#c4c4c4", OURS_INK = "#bf4a2c";

  /* A reader can play one experiment at a time. Within it, the comparison nearest
     the centre of the viewport plays in sync; offscreen groups keep their place. */
  var activeResult = null, activeGroup = null, started = false, frame = 0, generation = 0;
  var filmVideo = $(".film video[data-film]");

  function pauseGroup() {
    generation++;
    if (activeGroup) activeGroup.forEach(function (clip) { clip.pause(); });
    activeGroup = null;
    started = false;
  }
  function stopResult(retry) {
    pauseGroup();
    if (activeResult) activeResult.button.textContent = (retry ? "Retry " : "Play ") + activeResult.label;
    activeResult = null;
  }
  function playWhenReady() {
    if (!activeGroup || started || !activeGroup.every(function (clip) { return clip.readyState >= 3; })) return;
    started = true;
    var time = activeGroup[0].currentTime, version = generation;
    activeGroup.forEach(function (clip) {
      if (Math.abs(clip.currentTime - time) > 0.05) clip.currentTime = time;
      var promise = clip.play();
      if (promise) promise.catch(function () { if (generation === version) stopResult(true); });
    });
  }
  function updateFootage() {
    frame = 0;
    if (!activeResult) return;
    var nearest = null, distance = Infinity;
    if (!doc.hidden && activeResult.detail.open) {
      activeResult.groups.forEach(function (clips) {
        clips.forEach(function (clip) {
          var bounds = clip.getBoundingClientRect();
          if (!bounds.height || bounds.bottom <= 0 || bounds.top >= win.innerHeight) return;
          var d = Math.abs((bounds.top + bounds.bottom - win.innerHeight) / 2);
          if (d < distance) { nearest = clips; distance = d; }
        });
      });
    }
    if (nearest === activeGroup) return;
    pauseGroup();
    activeGroup = nearest;
    if (!nearest) return;
    nearest.forEach(function (clip) {
      if (!clip.hasAttribute("src") || clip.error) {
        clip.preload = "auto";
        clip.src = clip.dataset.src;
      }
    });
    playWhenReady();
  }
  function requestUpdate() {
    if (activeResult && !frame) frame = win.requestAnimationFrame(updateFootage);
  }
  win.addEventListener("scroll", requestUpdate, { passive: true });
  win.addEventListener("resize", requestUpdate);
  doc.addEventListener("visibilitychange", updateFootage);
  doc.addEventListener("toggle", requestUpdate, true);

  $$("#results details.result").forEach(function (detail) {
    var clips = $$("video[data-src]", detail);
    if (!clips.length) return;
    var groups = new Map();
    clips.forEach(function (clip) {
      var key = clip.dataset.sync || clip;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(clip);
      clip.muted = true;
      clip.playsInline = true;
      clip.addEventListener("canplay", playWhenReady);
      clip.addEventListener("error", function () {
        if (groups.get(key) === activeGroup) stopResult(true);
      });
    });
    groups.forEach(function (members) {
      var lead = members[0];
      lead.addEventListener("ended", function () {
        if (activeGroup !== members) return;
        members.forEach(function (clip) { clip.currentTime = 0; });
        started = false;
        playWhenReady();
      });
      lead.addEventListener("timeupdate", function () {
        if (activeGroup !== members || lead.paused || lead.duration - lead.currentTime < 0.3) return;
        members.slice(1).forEach(function (clip) {
          if (clip.readyState >= 2 && !clip.seeking && Math.abs(clip.currentTime - lead.currentTime) > 0.14)
            clip.currentTime = lead.currentTime;
        });
      });
    });

    var button = doc.createElement("button");
    var result = { detail: detail, button: button, groups: groups,
                   label: detail.id === "humanoid" ? "motion examples" : "comparison clips" };
    button.type = "button";
    button.className = "clip-toggle";
    button.textContent = "Play " + result.label;
    $(".block", detail).before(button);
    button.addEventListener("click", function () {
      var turningOff = activeResult === result;
      stopResult(false);
      if (turningOff) return;
      if (filmVideo && !filmVideo.paused) filmVideo.pause();
      activeResult = result;
      button.textContent = "Pause " + result.label;
      updateFootage();
    });
    detail.addEventListener("toggle", function () {
      if (!detail.open && activeResult === result) stopResult(false);
    });
  });

  /* a line or a mark on a clip that belongs to one moment of it: it shows once the clip has reached that second (and, with
     data-until, only up to that second), whether the clip plays or is paused. A clip that has not started shows its poster,
     which is taken at that moment, so the line shows there too. */
  $$(".plate__media [data-at]").forEach(function (tag) {
    var v = $("video", tag.parentNode), at = parseFloat(tag.getAttribute("data-at")), un = parseFloat(tag.getAttribute("data-until"));
    if (!v) return;
    var set = function () {
      var t = v.currentTime, started = t > 0 || !v.paused;
      var on = !started || (isNaN(un) ? (v.ended || t >= at) : (t >= at && t < un));
      tag.classList.toggle("is-wait", !on);
    };
    ["timeupdate", "playing", "pause", "seeked", "ended"].forEach(function (name) { v.addEventListener(name, set); });
    /* while the clip plays, the mark follows it frame by frame (timeupdate comes only four times a second) */
    var raf = 0, loop = function () { set(); raf = !v.paused && !v.ended ? win.requestAnimationFrame(loop) : 0; };
    v.addEventListener("playing", function () { if (!raf && win.requestAnimationFrame) raf = win.requestAnimationFrame(loop); });
  });

  /* ------------------------------------------------------------ the film */
  if (filmVideo) {
    var film = filmVideo.closest(".film");
    filmVideo.addEventListener("play", function () {
      if (!filmVideo.paused) stopResult(false);
    });
    var start = function () {
      if (film.classList.contains("is-playing")) return;
      stopResult(false);
      filmVideo.src = filmVideo.dataset.film;
      filmVideo.controls = true;
      film.classList.add("is-playing");
      var p = filmVideo.play();
      if (p && p.catch) p.catch(function () {});
      filmVideo.focus({ preventScroll: true });
    };
    film.addEventListener("click", start);
  }

  /* ------------------------------------------------------------ the matching figure
     Four samples of one group at drawn positions in a schematic feature plane. With centered weights alpha_k,
     the witness is u(f) = sum_k alpha_k kappa(f, f_k); the arrows are its gradients at the samples. */
  $$("[data-match]").forEach(function (box) {
    var plot = $(".match__plot", box), cv = $("canvas", box), arrows = $(".match__arrows", box);
    var discs = $$(".match__s", box), reset = $(".match__reset", box), segs = $$(".seg button", box);
    var say = $(".match__say", box.parentNode), hint = $(".match__hint", box);
    var R = box.getAttribute("data-rewards").split(",").map(Number), K = R.length;
    var mean = R.reduce(function (a, b) { return a + b; }, 0) / K;
    var dev = R.map(function (r) { return r - mean; });
    /* first-order weights 1/K + alpha, at a display temperature that leaves the lightest sample 0.15 of the mass */
    var KB = Math.max.apply(null, dev.map(function (d) { return -d; })) / (1 / K - 0.15);
    var alpha = dev.map(function (d) { return d / KB; });
    var size = alpha.map(function (a) { return Math.sqrt((1 / K + a) * K); });
    var AR = 1.25, DIA = 0.215;                        /* plot units: x in [0, 1.25], y in [0, 1] */
    /* the samples sit around the one with the highest reward (the layout of the film's method scene) */
    var P0 = [[0.58, 0.20], [0.20, 0.66], [0.71, 0.63], [1.10, 0.83]];
    /* kernel width: half the median distance between the samples at their starting positions, the rule of the paper's image
       experiments. With this width a direction depends on the samples near it, so the four directions differ. */
    var dd = [];
    P0.forEach(function (a, i) { P0.forEach(function (b, k) { if (k > i) dd.push(Math.hypot(a[0] - b[0], a[1] - b[1])); }); });
    dd.sort(function (a, b) { return a - b; });
    var SIG = 0.5 * (dd[2] + dd[3]) / 2;
    var P = P0.map(function (p) { return p.slice(); }), kernel = "gauss";
    var TEXT = {
      gauss: "With a Gaussian kernel, each sample gets its own, toward nearby samples with above-average reward and away from nearby samples with below-average reward.",
      linear: "With a linear kernel, every sample gets the same direction. On latents, this is the group direction of DiffusionART."
    };
    function grad(i, pts, kind) {
      var gx = 0, gy = 0, k;
      if (kind === "linear") {
        for (k = 0; k < K; k++) { gx += alpha[k] * pts[k][0]; gy += alpha[k] * pts[k][1]; }
        return [gx, gy];
      }
      for (k = 0; k < K; k++) {
        if (k === i) continue;
        var ex = pts[k][0] - pts[i][0], ey = pts[k][1] - pts[i][1], kap = Math.exp(-(ex * ex + ey * ey) / (2 * SIG * SIG));
        gx += alpha[k] * ex * kap; gy += alpha[k] * ey * kap;
      }
      return [gx / (SIG * SIG), gy / (SIG * SIG)];
    }
    function witness(x, y, kind, cx, cy) {
      var u = 0, k;
      if (kind === "linear") {
        for (k = 0; k < K; k++) u += alpha[k] * ((x - cx) * P[k][0] + (y - cy) * P[k][1]);
        return u;
      }
      for (k = 0; k < K; k++) { var ex = x - P[k][0], ey = y - P[k][1]; u += alpha[k] * Math.exp(-(ex * ex + ey * ey) / (2 * SIG * SIG)); }
      return u;
    }
    /* one arrow scale and one colour scale per kernel, fixed at the starting positions */
    function maxlen(kind) { return Math.max.apply(null, P0.map(function (_, i) { var g = grad(i, P0, kind); return Math.hypot(g[0], g[1]); })); }
    var ASC = { gauss: 0.15 / maxlen("gauss"), linear: 0.15 / maxlen("linear") };
    var GW = 60, GH = 48, USC = {};
    cv.width = GW; cv.height = GH;
    var ctx = cv.getContext("2d"), img = ctx.createImageData(GW, GH);
    function field(calibrate) {
      var cx = 0, cy = 0, k, x, y, u, m = 0, vals = new Float32Array(GW * GH);
      for (k = 0; k < K; k++) { cx += P[k][0] / K; cy += P[k][1] / K; }
      for (y = 0; y < GH; y++) for (x = 0; x < GW; x++) {
        u = witness((x + 0.5) / GW * AR, (y + 0.5) / GH, kernel, cx, cy);
        vals[y * GW + x] = u; if (Math.abs(u) > m) m = Math.abs(u);
      }
      if (calibrate || !USC[kernel]) USC[kernel] = m || 1;
      for (k = 0; k < GW * GH; k++) {
        u = vals[k] / USC[kernel];
        var a = Math.min(1, Math.abs(u)), o = k * 4;
        if (u >= 0) { img.data[o] = 231; img.data[o + 1] = 111; img.data[o + 2] = 81; }
        else { img.data[o] = 28; img.data[o + 1] = 118; img.data[o + 2] = 127; }
        img.data[o + 3] = Math.round(255 * 0.46 * Math.pow(a, 0.85));
      }
      ctx.putImageData(img, 0, 0);
    }
    arrows.setAttribute("viewBox", "0 0 " + AR * 100 + " 100");
    arrows.setAttribute("preserveAspectRatio", "none");
    function draw(calibrate) {
      var H = plot.clientHeight || 1;
      field(calibrate);
      while (arrows.firstChild) arrows.removeChild(arrows.firstChild);
      discs.forEach(function (d, i) {
        var dia = DIA * size[i];
        d.style.left = P[i][0] / AR * 100 + "%"; d.style.top = P[i][1] * 100 + "%";
        d.style.width = d.style.height = dia * H + "px";
        var g = grad(i, P, kernel), L = Math.hypot(g[0], g[1]) * ASC[kernel];
        if (L < 0.012) return;
        L = Math.min(L, 0.34);
        var ux = g[0] / Math.hypot(g[0], g[1]), uy = g[1] / Math.hypot(g[0], g[1]), r = dia / 2 + 0.022;
        var x1 = (P[i][0] + ux * r) * 100, y1 = (P[i][1] + uy * r) * 100, x2 = x1 + ux * L * 100, y2 = y1 + uy * L * 100;
        var hl = Math.min(4.4, L * 100 * 0.6), hw = hl * 0.46;
        el("line", { x1: x1, y1: y1, x2: x2 - ux * hl * 0.8, y2: y2 - uy * hl * 0.8, stroke: INK, "stroke-width": 0.85 }, arrows);
        el("polygon", { points: [x2, y2, x2 - ux * hl - uy * hw, y2 - uy * hl + ux * hw, x2 - ux * hl + uy * hw, y2 - uy * hl - ux * hw].join(" "), fill: INK }, arrows);
      });
    }
    function moved() { reset.disabled = !P.some(function (p, i) { return Math.abs(p[0] - P0[i][0]) + Math.abs(p[1] - P0[i][1]) > 1e-6; }); }
    function place(i, x, y) {
      var r = DIA * size[i] / 2;
      P[i][0] = Math.min(AR - r, Math.max(r, x)); P[i][1] = Math.min(1 - r, Math.max(r, y));
      if (hint) hint.hidden = true;
      moved(); draw(false);
    }
    discs.forEach(function (d, i) {
      var grab = null;
      d.addEventListener("pointerdown", function (ev) {
        var b = plot.getBoundingClientRect();
        grab = { dx: P[i][0] - (ev.clientX - b.left) / b.height, dy: P[i][1] - (ev.clientY - b.top) / b.height };
        d.setPointerCapture(ev.pointerId); ev.preventDefault(); d.focus({ preventScroll: true });
      });
      d.addEventListener("pointermove", function (ev) {
        if (!grab) return;
        var b = plot.getBoundingClientRect();
        place(i, (ev.clientX - b.left) / b.height + grab.dx, (ev.clientY - b.top) / b.height + grab.dy);
      });
      var drop = function () { grab = null; };
      d.addEventListener("pointerup", drop); d.addEventListener("pointercancel", drop);
      d.addEventListener("keydown", function (ev) {
        var s = ev.shiftKey ? 0.08 : 0.025, m = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[ev.key];
        if (!m) return;
        ev.preventDefault(); place(i, P[i][0] + m[0], P[i][1] + m[1]);
      });
    });
    segs.forEach(function (b) {
      b.addEventListener("click", function () {
        kernel = b.getAttribute("data-kernel");
        segs.forEach(function (s) { var on = s === b; s.classList.toggle("is-on", on); s.setAttribute("aria-pressed", String(on)); });
        if (say) say.textContent = TEXT[kernel];
        draw(false);
      });
    });
    reset.addEventListener("click", function () { P = P0.map(function (p) { return p.slice(); }); moved(); draw(false); });
    /* colour scales at the starting positions, for both kernels */
    kernel = "linear"; field(true); kernel = "gauss"; draw(true);
    if ("ResizeObserver" in win) new ResizeObserver(function () { draw(false); }).observe(plot);
    else win.addEventListener("resize", function () { draw(false); });
  });

  /* ------------------------------------------------------------ charts */
  var MINUS = "−";
  function num(v, d) { var s = Math.abs(v).toFixed(d); return (v < 0 ? MINUS : "") + s; }
  function lineChart(fig, spec) {
    var host = $(".chart__plot", fig), last = 0;
    function draw() {
      var W = Math.round(host.clientWidth);
      if (!W || W === last) return;
      last = W;
      while (host.firstChild) host.removeChild(host.firstChild);
      var narrow = W < 500;
      var named = spec.series.filter(function (s) { return s.name; });
      if (narrow) {
        var key = doc.createElement("div"); key.className = "chart__key";
        named.slice().reverse().forEach(function (s) {
          var sp = doc.createElement("span"), sw = doc.createElement("i");
          sw.style.background = s.color; sp.appendChild(sw);
          sp.appendChild(doc.createTextNode(s.name + (s.end ? " " + s.end : "")));
          if (s.ours) sp.style.color = OURS_INK;
          key.appendChild(sp);
        });
        host.appendChild(key);
      }
      var mL = 40, mR = narrow ? 10 : 182, mT = 8, mB = 48;
      var H = Math.round(Math.min(440, Math.max(250, W * 0.6)));
      var w = W - mL - mR, h = H - mT - mB;
      var x0 = spec.x[0], x1 = spec.x[1], y0 = spec.y[0], y1 = spec.y[1];
      var sx = function (v) { return mL + (v - x0) / (x1 - x0) * w; }, sy = function (v) { return mT + h - (v - y0) / (y1 - y0) * h; };
      var s = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "aria-hidden": "true" }, host);
      var id = "clip-" + fig.getAttribute("data-chart");
      el("rect", { x: mL - 2, y: mT - 4, width: w + 4, height: h + 4 }, el("clipPath", { id: id }, s));
      spec.yt.forEach(function (v) {
        el("line", { x1: mL, x2: mL + w, y1: sy(v), y2: sy(v), stroke: "#ececec", "stroke-width": 1 }, s);
        el("text", { x: mL - 10, y: sy(v) + 4.5, "text-anchor": "end", "font-size": 13, fill: GRAPHITE }, s).textContent = num(v, spec.yd);
      });
      el("line", { x1: mL, x2: mL + w, y1: mT + h, y2: mT + h, stroke: RULE, "stroke-width": 1.5 }, s);
      spec.xt.forEach(function (v) {
        el("line", { x1: sx(v), x2: sx(v), y1: mT + h, y2: mT + h + 6, stroke: RULE, "stroke-width": 1.5 }, s);
        el("text", { x: sx(v), y: mT + h + 22, "text-anchor": "middle", "font-size": 13, fill: GRAPHITE }, s).textContent = String(v);
      });
      el("text", { x: mL + w, y: mT + h + 42, "text-anchor": "end", "font-size": 13, fill: GRAPHITE }, s).textContent = spec.xlabel;
      var labels = [];
      if (spec.base) {
        el("line", { x1: mL, x2: mL + w, y1: sy(spec.base[0]), y2: sy(spec.base[0]), stroke: "#9a9a9a", "stroke-width": 1.5, "stroke-dasharray": "5 5" }, s);
        labels.push({ y: sy(spec.base[0]), text: spec.base[1], fill: GRAPHITE, weight: 400, swatch: "#9a9a9a", thick: 1.5, dash: "4 3" });
      }
      var g = el("g", { "clip-path": "url(#" + id + ")" }, s);
      spec.series.forEach(function (se) {
        if (se.band) {
          var up = se.band.map(function (p) { return sx(p[0]).toFixed(1) + "," + sy(p[2]).toFixed(1); });
          var lo = se.band.slice().reverse().map(function (p) { return sx(p[0]).toFixed(1) + "," + sy(p[1]).toFixed(1); });
          el("polygon", { points: up.concat(lo).join(" "), fill: se.color, opacity: 0.16 }, g);
        }
      });
      spec.series.forEach(function (se) {
        var d = "M" + se.pts.map(function (p) { return sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1); }).join("L");
        el("path", { d: d, fill: "none", stroke: se.color, "stroke-width": se.ours ? 3.2 : se.thin ? 1.5 : 2, "stroke-linejoin": "round", "stroke-linecap": "butt" }, g);
        var e = se.pts[se.pts.length - 1];
        if (se.name) labels.push({ y: sy(Math.min(y1, Math.max(y0, e[1]))), text: se.name + (se.end ? " " + se.end : ""), fill: se.ours ? OURS_INK : INK, weight: se.ours ? 700 : 500, swatch: se.color, thick: se.ours ? 3.2 : se.thin ? 1.5 : 2 });
      });
      spec.series.forEach(function (se) {
        if (se.reach) el("line", { x1: sx(se.reach[0][0]), y1: sy(se.reach[0][1]), x2: sx(se.reach[1]), y2: sy(se.reach[0][1]), stroke: se.color,
                                   "stroke-width": 1.8, "stroke-dasharray": "1 5", "stroke-linecap": "round" }, s);
      });
      spec.series.forEach(function (se) {
        (se.dots || []).forEach(function (p) {
          el("circle", { cx: sx(p[0]), cy: sy(p[1]), r: se.ours ? 5 : 4.2, fill: se.color, stroke: "#fff", "stroke-width": 1.5 }, s);
        });
      });
      if (!narrow) {
        /* names at the ends of the lines, pushed apart where they would touch */
        labels.sort(function (a, b) { return a.y - b.y; });
        var gap = 18, i;
        for (i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < gap) labels[i].y = labels[i - 1].y + gap;
        var over = labels.length ? labels[labels.length - 1].y - (mT + h) : 0;
        if (over > 0) for (i = labels.length - 1; i >= 0; i--) { labels[i].y -= over; if (i && labels[i].y - labels[i - 1].y >= gap) break; }
        labels.forEach(function (l) {
          var a = { x1: mL + w + 10, x2: mL + w + 24, y1: l.y, y2: l.y, stroke: l.swatch, "stroke-width": l.thick };
          if (l.dash) a["stroke-dasharray"] = l.dash;
          el("line", a, s);
          el("text", { x: mL + w + 30, y: l.y + 4.5, "font-size": 13.5, "font-weight": l.weight, fill: l.fill }, s).textContent = l.text;
        });
      } else if (spec.base) {
        el("text", { x: mL + w, y: sy(spec.base[0]) - 7, "text-anchor": "end", "font-size": 12.5, fill: GRAPHITE }, s).textContent = spec.base[1];
      }
    }
    draw();
    if ("ResizeObserver" in win) new ResizeObserver(draw).observe(host);
    else {
      win.addEventListener("resize", draw);
      var detail = host.closest("details");
      if (detail) detail.addEventListener("toggle", draw);
    }
  }
  var DATA = (win.FLOWRDM && win.FLOWRDM.charts) || {};
  $$("[data-chart]").forEach(function (fig) { var sp = DATA[fig.getAttribute("data-chart")]; if (sp) lineChart(fig, sp); });

  /* Reveal the target before the browser follows a same-page link. Opening a
     result directly or revisiting it in browser history also reveals its content. */
  function revealFragment(hash, scroll) {
    if (!hash) return;
    var id;
    try { id = decodeURIComponent(hash.slice(1)); } catch (error) { return; }
    var target = doc.getElementById(id);
    if (!target) return;
    var changed = false;
    for (var parent = target; parent; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS" && !parent.open) { parent.open = true; changed = true; }
    }
    if (changed && scroll) target.scrollIntoView({ block: "start", behavior: "instant" });
  }
  doc.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target.closest("a[href^='#']");
    if (link) revealFragment(link.hash, false);
  });
  function revealLocation() { revealFragment(win.location.hash, true); }
  win.addEventListener("hashchange", revealLocation);
  revealLocation();

  /* ------------------------------------------------------------ copy the BibTeX entry */
  $$("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = $(b.getAttribute("data-copy"));
      if (!t || !navigator.clipboard) return;
      navigator.clipboard.writeText(t.textContent).then(function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1600); });
    });
  });

})();
