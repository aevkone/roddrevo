/* «Места и память рода» — фон генеалогического древа.
 * Единый приём: страница старинного альбома. Каждое изображение — в одинаковом паспарту
 * с волосяной золотой рамкой и четырьмя «альбомными уголками», без наклона, на модульной сетке
 * (L / M / S, кратно шагу колонки древа). Подпись — всегда на одном расстоянии под паспарту, по центру.
 * Изображения распределены равномерно по всей свободной площади вокруг древа (ячейки Ллойда),
 * острова по смыслу идут слева направо.
 * Нити — мягкие дуги с узелками только между местами и только по свободному полю (через древо не идут).
 * Связь «место ↔ человек» показывается подсветкой при наведении, без линий.
 *
 * Подключение: <link rel="stylesheet" href="memorynet/memorynet.css"> и
 *              <script src="memorynet/memorynet.js" defer></script> после основного кода древа.
 * Настройки (необязательно, до подключения): window.MEMNET = {src: 'memorynet/images.json'}.
 */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var CFG = Object.assign({
    src: 'memorynet/images.json',
    padTop: 1300,          // поле над схемой (в координатах SVG)
    padBottom: 1300,       // поле под схемой
    captionsFrom: 0.4,     // подписи видны, когда 1 единица SVG ≥ 0.4 px («Крупно» и крупнее)
    mobile: '(max-width: 600px)',
    maxThread: 5200,       // длиннее — нить не рисуем
    fill: 0.55             // какую долю свободного поля занимают изображения (с полями)
  }, window.MEMNET || {});

  // модульная сетка: шаг колонки древа U = 392
  var U = 392;
  var FRAME = {               // высота окна изображения; ширина — по пропорции (альбомная 4:3 или книжная 4:5)
    L: {h: 2.25 * U, fs: 40, fw: 31},   // 882
    M: {h: 1.69 * U, fs: 35, fw: 28},   // 662
    S: {h: 1.22 * U, fs: 31, fw: 26}    // 478
  };
  var MAT = 30;        // поле паспарту вокруг изображения
  var CAP_GAP = 38;    // от паспарту до подписи — всегда одинаково
  var HALO = 110;      // воздух вокруг изображения
  var CELL = 40;       // шаг сетки поиска свободного места
  var ISLAND_LABEL = {
    path: 'Путь Кочергиных: Рязань → Тамбов → Москва',
    west: 'Города ветви Чижевских',
    posad20: 'Сергиев посад начала XX века',
    east: 'Города ветвей Семенчинских',
    lavra: 'Лавра и Сергиев посад XVIII–XIX веков'
  };

  var DATA = null, BASE = '', building = false, lastSvg = null, roSvg = null;

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function year(it) { var m = String(it.caption_year).match(/\d{4}/); return m ? +m[0] : 1900; }

  /* ---------- текст: перенос по реальной ширине шрифта ---------- */
  var ctx = document.createElement('canvas').getContext('2d');
  function wrap(text, font, maxW) {
    ctx.font = font;
    var words = text.split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  /* ---------- геометрия одного изображения ---------- */
  function measure(it, k) {
    k = k || 1;
    var f0 = FRAME[it.size] || FRAME.M, f = {h: f0.h * k, fs: Math.round(f0.fs * Math.sqrt(k)), fw: Math.round(f0.fw * Math.sqrt(k))};
    var portrait = (it.aspect || 1.4) < 1.05;
    var h = f.h, w = Math.round(portrait ? h * 0.8 : h * 4 / 3);
    var outerW = w + 2 * MAT, outerH = h + 2 * MAT;
    var capW = Math.max(outerW, 2.2 * U * k);                 // узкие книжные кадры получают подпись пошире
    var tf = 'italic 600 ' + f.fs + 'px "Cormorant Garamond"';
    var wf = 'italic 400 ' + f.fw + 'px "Cormorant Garamond"';
    var tl = wrap(it.caption_title + ' · ' + it.caption_year, tf, capW);
    var wl = wrap(it.caption_why, wf, capW);
    var capH = tl.length * f.fs * 1.18 + 26 + wl.length * f.fw * 1.25;
    return {w: w, h: h, ow: outerW, oh: outerH, capW: capW, tl: tl, wl: wl, f: f,
            boxW: Math.max(outerW, capW), boxH: outerH + CAP_GAP + capH};
  }

  /* ---------- занятость: суммарная таблица для быстрых проверок ---------- */
  function Grid(x0, y0, w, h) {
    this.x0 = x0; this.y0 = y0;
    this.gw = Math.ceil(w / CELL); this.gh = Math.ceil(h / CELL);
    this.b = new Uint8Array(this.gw * this.gh);
    this.sat = null;
  }
  Grid.prototype.mark = function (x0, y0, x1, y1) {
    var a = Math.max(0, Math.floor((x0 - this.x0) / CELL)), b = Math.min(this.gw, Math.ceil((x1 - this.x0) / CELL));
    var c = Math.max(0, Math.floor((y0 - this.y0) / CELL)), d = Math.min(this.gh, Math.ceil((y1 - this.y0) / CELL));
    for (var y = c; y < d; y++) for (var x = a; x < b; x++) this.b[y * this.gw + x] = 1;
    this.sat = null;
  };
  Grid.prototype.build = function () {
    var W = this.gw + 1, s = new Int32Array(W * (this.gh + 1));
    for (var y = 0; y < this.gh; y++) {
      var row = 0;
      for (var x = 0; x < this.gw; x++) { row += this.b[y * this.gw + x]; s[(y + 1) * W + x + 1] = s[y * W + x + 1] + row; }
    }
    this.sat = s;
  };
  Grid.prototype.free = function (x0, y0, x1, y1) {
    if (!this.sat) this.build();
    var a = Math.floor((x0 - this.x0) / CELL), b = Math.ceil((x1 - this.x0) / CELL);
    var c = Math.floor((y0 - this.y0) / CELL), d = Math.ceil((y1 - this.y0) / CELL);
    if (a < 0 || c < 0 || b > this.gw || d > this.gh) return false;
    var W = this.gw + 1, s = this.sat;
    return s[d * W + b] - s[c * W + b] - s[d * W + a] + s[c * W + a] === 0;
  };

  /* ---------- линии родства: разбор «M x,y V y H x …» в отрезки ---------- */
  function linkSegments(svg, grid) {
    svg.querySelectorAll('.links path, .rings *').forEach(function (p) {
      var d = p.getAttribute('d');
      if (!d) { try { var bb = p.getBBox(); grid.mark(bb.x - 30, bb.y - 30, bb.x + bb.width + 30, bb.y + bb.height + 30); } catch (e) {} return; }
      var t = d.match(/[MLHVZ]|-?[\d.]+/gi) || [], x = 0, y = 0, cmd = '', i = 0, P = 34;
      while (i < t.length) {
        if (/[A-Z]/i.test(t[i])) { cmd = t[i++].toUpperCase(); continue; }
        var nx = x, ny = y;
        if (cmd === 'M' || cmd === 'L') { nx = +t[i++]; ny = +t[i++]; }
        else if (cmd === 'H') nx = +t[i++];
        else if (cmd === 'V') ny = +t[i++];
        else { i++; continue; }
        if (cmd !== 'M') grid.mark(Math.min(x, nx) - P, Math.min(y, ny) - P, Math.max(x, nx) + P, Math.max(y, ny) + P);
        x = nx; y = ny;
      }
    });
  }

  /* ---------- расстановка: равномерно по всей свободной площади ----------
   * 1. Карта занятости: карточки с медальонами, линии родства, кольца, номера поколений.
   * 2. Свободная площадь вокруг древа (поля сверху и снизу + просветы между ветвями)
   *    делится на N равных по площади ячеек (центроидная диаграмма Вороного, алгоритм Ллойда).
   *    Центр каждой ячейки — место одного изображения: так плотность одинакова везде.
   * 3. Центры упорядочены слева направо; острова получают их по порядку (seq),
   *    крупным изображениям достаются центры, где они помещаются.
   * 4. Каждое изображение встаёт в ближайшее к своему центру свободное место. */
  function layout(svg, items, vbW, vbH, k) {
    k = k || 1;
    items.forEach(function (it) { it.m = measure(it, k); });
    var maxBox = Math.max.apply(null, items.map(function (it) { return it.m.boxH; }));
    var pad = Math.max(CFG.padTop, maxBox + 260);
    var top = -pad, H = vbH + 2 * pad;
    var grid = new Grid(0, top, vbW, H), nodes = {};
    svg.querySelectorAll('.node[data-pid]').forEach(function (g) {
      var r = g.querySelector('rect.card'); if (!r) return;
      var x = +r.getAttribute('x'), y = +r.getAttribute('y'), w = +r.getAttribute('width'), h = +r.getAttribute('height');
      var bb; try { bb = g.getBBox(); } catch (e) { bb = {x: x, y: y, width: w, height: h}; }
      nodes[g.dataset.pid] = {x: x + w / 2, y: y + h / 2, top: Math.min(y, bb.y), bot: y + h};
      grid.mark(Math.min(x, bb.x) - 60, Math.min(y, bb.y) - 60, Math.max(x + w, bb.x + bb.width) + 60, y + h + 60);
    });
    linkSegments(svg, grid);
    grid.mark(0, top, 200, top + H);                       // колонка номеров поколений
    grid.mark(0, top, vbW, top + 90); grid.mark(0, top + H - 90, vbW, top + H); grid.mark(vbW - 90, top, vbW, top + H); // рамка полотна
    var tree = new Uint8Array(grid.b);                      // копия «только древо» — для проверки нитей
    items.forEach(function (it) { it.ppl = (it.people || []).filter(function (p) { return nodes[p]; }); });

    // 2. свободные точки (где помещается хотя бы небольшое изображение) и ячейки Ллойда
    var pts = [], STEP = 80, PW = 300, PH = 260;
    for (var y = top; y < top + H; y += STEP) for (var x = 0; x < vbW; x += STEP)
      if (grid.free(x - PW, y - PH, x + PW, y + PH)) pts.push([x, y]);
    var N = items.length, C = [];
    if (!pts.length) return {placed: [], nodes: nodes, top: top, H: H, tree: tree, grid: grid};
    // общий масштаб: изображения занимают заданную долю свободной площади — без пустых пятен
    if (!layout.scaled) {
      var freeArea = pts.length * STEP * STEP, imgArea = 0;
      items.forEach(function (it) { imgArea += (it.m.boxW + HALO) * (it.m.boxH + HALO); });
      var kk = Math.max(0.8, Math.min(1.6, Math.sqrt(CFG.fill * freeArea / imgArea)));
      if (Math.abs(kk - 1) > 0.04) { layout.scaled = true; try { return layout(svg, items, vbW, vbH, kk); } finally { layout.scaled = false; } }
    }
    // начальные центры — «самая дальняя точка» (детерминированно, без случайности)
    var d2 = new Float64Array(pts.length).fill(Infinity), cur = 0;
    pts.forEach(function (p, i) { if (p[0] + p[1] < pts[cur][0] + pts[cur][1]) cur = i; });
    for (var k = 0; k < N; k++) {
      C.push(pts[cur].slice());
      var far = 0;
      for (var i = 0; i < pts.length; i++) {
        var dx = pts[i][0] - C[k][0], dy = (pts[i][1] - C[k][1]) * 1.25, d = dx * dx + dy * dy;
        if (d < d2[i]) d2[i] = d;
        if (d2[i] > d2[far]) far = i;
      }
      cur = far;
    }
    var own = new Int32Array(pts.length);
    function lloyd(iters, W) {                             // W — «вес» ячейки: крупному изображению — больше площади
      for (var it8 = 0; it8 < iters; it8++) {
        var sx = new Float64Array(N), sy = new Float64Array(N), sn = new Float64Array(N), i, k, dx, dy, d, bd;
        for (i = 0; i < pts.length; i++) {
          var bi = 0; bd = Infinity;
          for (k = 0; k < N; k++) { dx = pts[i][0] - C[k][0]; dy = (pts[i][1] - C[k][1]) * 1.25; d = (dx * dx + dy * dy) / (W ? W[k] : 1); if (d < bd) { bd = d; bi = k; } }
          own[i] = bi; sx[bi] += pts[i][0]; sy[bi] += pts[i][1]; sn[bi]++;
        }
        for (k = 0; k < N; k++) if (sn[k]) {              // центр тяжести, притянутый к ближайшей свободной точке своей ячейки
          var mx = sx[k] / sn[k], my = sy[k] / sn[k], bp = null; bd = Infinity;
          for (i = 0; i < pts.length; i++) if (own[i] === k) { dx = pts[i][0] - mx; dy = pts[i][1] - my; d = dx * dx + dy * dy; if (d < bd) { bd = d; bp = pts[i]; } }
          C[k] = [bp[0], bp[1]];
        }
      }
    }
    lloyd(14);

    // 3. какое изображение где: центры слева направо, острова по порядку, крупным — просторные центры
    function fits(c, m) {
      for (var r = 0; r <= 600; r += 120) for (var ox = -r; ox <= r; ox += 120) for (var oy = -r; oy <= r; oy += 120) {
        var x0 = c[0] + ox - m.boxW / 2, y0 = c[1] + oy - m.boxH / 2;
        if (grid.free(x0 - HALO / 2, y0 - HALO / 2, x0 + m.boxW + HALO / 2, y0 + m.boxH + HALO / 2)) return true;
      }
      return false;
    }
    var cs = C.map(function (c) { return {c: c, used: false}; }).sort(function (a, b) { return a.c[0] - b.c[0] || a.c[1] - b.c[1]; });
    items.forEach(function (it) {
      var free = cs.filter(function (q) { return !q.used; }), pick = free[0];
      for (var j = 0; j < Math.min(CFG.win || 5, free.length); j++) if (fits(free[j].c, it.m)) { pick = free[j]; break; }
      pick.used = true; pick.it = it;
    });
    // ещё раз Ллойд — теперь ячейка каждого изображения по площади соответствует его размеру
    C = cs.map(function (q) { return q.c; });
    var W = cs.map(function (q) { return (q.it.m.boxW + HALO) * (q.it.m.boxH + HALO); }), wm = W.reduce(function (a, b) { return a + b; }) / N;
    W = W.map(function (w) { return Math.pow(w / wm, CFG.wPow || 2); });
    lloyd(CFG.wIter || 30, W);
    cs.forEach(function (q, k) { q.it.tx = C[k][0]; q.it.ty = C[k][1]; });

    // 4. ставим: крупные первыми; ближайшее свободное место к своему центру, с мягким отталкиванием от соседей
    var order = items.slice().sort(function (a, b) { return b.m.boxW * b.m.boxH - a.m.boxW * a.m.boxH; });
    var placed = [];
    order.forEach(function (it) {
      var m = it.m, best = null, bs = Infinity;
      for (var R = 400; R <= 6400 && !best; R *= 2) {
        for (var y = Math.max(top + 90, it.ty - R - m.boxH / 2); y <= Math.min(top + H - 90 - m.boxH, it.ty + R - m.boxH / 2); y += CELL) {
          for (var x = Math.max(210, it.tx - R - m.boxW / 2); x <= Math.min(vbW - 90 - m.boxW, it.tx + R - m.boxW / 2); x += CELL) {
            var cx = x + m.boxW / 2, cy = y + m.boxH / 2, s = Math.hypot(cx - it.tx, cy - it.ty);
            if (s >= bs) continue;
            for (var k = 0; k < placed.length; k++) {
              var q = placed[k], dd = Math.hypot(cx - q.cx, cy - q.cy), RR = CFG.rr || 1500;
              if (dd < RR) s += (RR - dd) * (CFG.rk == null ? 0.6 : CFG.rk);
            }
            if (s >= bs) continue;
            if (!grid.free(x - HALO / 2, y - HALO / 2, x + m.boxW + HALO / 2, y + m.boxH + HALO / 2)) continue;
            bs = s; best = [x, y];
          }
        }
      }
      if (!best) return;
      it.bx = best[0]; it.by = best[1];
      it.cx = it.bx + m.boxW / 2; it.cy = it.by + m.boxH / 2;
      it.fx = it.cx - m.ow / 2; it.fy = it.by;
      placed.push(it);
      grid.mark(it.bx - HALO / 2, it.by - HALO / 2, it.bx + m.boxW + HALO / 2, it.by + m.boxH + HALO / 2);
    });
    return {placed: placed, nodes: nodes, top: top, H: H, tree: tree, grid: grid};
  }

  /* ---------- нити ---------- */
  function rectExit(r, ax, ay, bx, by, cx, cy) {
    // точка выхода квадратичной кривой A→(C)→B из прямоугольника r, считая от A
    var lo = 0, hi = 1;
    for (var i = 0; i < 18; i++) {
      var t = (lo + hi) / 2, u = 1 - t;
      var x = u * u * ax + 2 * u * t * cx + t * t * bx, y = u * u * ay + 2 * u * t * cy + t * t * by;
      if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) lo = t; else hi = t;
    }
    return hi;
  }
  function quadAt(ax, ay, cx, cy, bx, by, t) { var u = 1 - t; return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by]; }
  function subQuad(ax, ay, cx, cy, bx, by, t0, t1) {
    // отрезок кривой [t0, t1] как новая квадратичная
    var p0 = quadAt(ax, ay, cx, cy, bx, by, t0), p1 = quadAt(ax, ay, cx, cy, bx, by, t1);
    var u0 = 1 - t0, ctl = [u0 * ((1 - t1) * ax + t1 * cx) + t0 * ((1 - t1) * cx + t1 * bx), u0 * ((1 - t1) * ay + t1 * cy) + t0 * ((1 - t1) * cy + t1 * by)];
    return 'M' + r1(p0[0]) + ',' + r1(p0[1]) + ' Q' + r1(ctl[0]) + ',' + r1(ctl[1]) + ' ' + r1(p1[0]) + ',' + r1(p1[1]);
  }
  function knot(g, x, y, r, cls, data) {
    var c = el('circle', {cx: r1(x), cy: r1(y), r: r, 'class': 'mem-knot ' + cls}, g);
    for (var k in data) c.setAttribute('data-' + k, data[k]);
  }
  function diamond(g, x, y, s, cls, data) {
    var p = el('path', {d: 'M' + r1(x) + ',' + r1(y - s) + ' L' + r1(x + s) + ',' + r1(y) + ' L' + r1(x) + ',' + r1(y + s) + ' L' + r1(x - s) + ',' + r1(y) + 'Z', 'class': 'mem-knot ' + cls}, g);
    for (var k in data) p.setAttribute('data-' + k, data[k]);
  }

  /* ---------- сборка слоя ---------- */
  function build(svg) {
    if (!DATA || building || !svg) return;
    building = true;
    var t0 = performance.now();
    try {
      var old = svg.querySelector(':scope > .mem-net');
      if (old) old.remove();
      var vb0 = svg.getAttribute('data-mem-vb');
      if (!vb0) { vb0 = svg.getAttribute('viewBox'); svg.setAttribute('data-mem-vb', vb0); }
      var v = vb0.split(/[\s,]+/).map(Number), vbW = v[2], vbH = v[3];
      var mobile = matchMedia(CFG.mobile).matches;
      var items = DATA.filter(function (it) { return !(mobile && it.size === 'S'); })
                      .map(function (it) { return Object.assign({}, it); })
                      .sort(function (a, b) { return a.seq - b.seq; });

      var L = layout(svg, items, vbW, vbH);
      svg.setAttribute('viewBox', '0 ' + L.top + ' ' + vbW + ' ' + L.H);

      var net = el('g', {'class': 'mem-net' + (mobile ? ' mem-mobile' : ''), 'aria-hidden': 'true'});
      el('rect', {'class': 'mem-paper', x: -20000, y: L.top - 2000, width: vbW + 40000, height: L.H + 4000}, net);
      // рамка полотна (двойная волосяная линия с ромбиками) рисуется в scaleWatch:
      // по бокам она стоит ровно в 1 см экрана от крайних карточек при любом масштабе
      el('g', {'class': 'mem-frame'}, net);
      var gThreads = el('g', {'class': 'mem-threads'}, net);
      var gPics = el('g', {'class': 'mem-pics'}, net);
      var byId = {};
      L.placed.forEach(function (it) { byId[it.id] = it; });

      // нити только между местами и только по свободному полю: ни одна не пересекает древо
      // (линии к людям не рисуются — связь «место ↔ человек» видна при наведении)
      function blocked(pts, a, b) {
        var g = L.grid;
        for (var i = 0; i < pts.length; i++) {
          var gx = Math.floor((pts[i][0] - g.x0) / CELL), gy = Math.floor((pts[i][1] - g.y0) / CELL);
          if (gx < 0 || gy < 0 || gx >= g.gw || gy >= g.gh || L.tree[gy * g.gw + gx]) return true;
          for (var k = 0; k < L.placed.length; k++) {
            var q = L.placed[k]; if (q === a || q === b) continue;
            if (pts[i][0] > q.bx - 40 && pts[i][0] < q.bx + q.m.boxW + 40 && pts[i][1] > q.by - 40 && pts[i][1] < q.by + q.m.boxH + 40) return true;
          }
        }
        return false;
      }
      L.placed.forEach(function (a) {
        (a.links || []).forEach(function (bid) {
          var b = byId[bid]; if (!b) return;
          var ax = a.cx, ay = a.fy + a.m.oh / 2, bx = b.cx, by = b.fy + b.m.oh / 2;
          var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
          if (len > CFG.maxThread) return;
          var ra = {x: a.fx, y: a.fy, w: a.m.ow, h: a.m.oh}, rb = {x: b.fx, y: b.fy, w: b.m.ow, h: b.m.oh};
          [0.16, -0.16, 0.06, -0.06].some(function (bend) {
            var cx = (ax + bx) / 2 - dy * bend, cy = (ay + by) / 2 + dx * bend;
            var t0 = rectExit(ra, ax, ay, bx, by, cx, cy), t1 = 1 - rectExit(rb, bx, by, ax, ay, cx, cy);
            if (t1 - t0 < 0.05) return false;
            var smp = [];
            for (var t = t0; t <= t1; t += (t1 - t0) / 40) smp.push(quadAt(ax, ay, cx, cy, bx, by, t));
            if (blocked(smp, a, b)) return false;
            var g = el('g', {'class': 'mem-t mem-pp', 'data-img': a.id + ' ' + b.id}, gThreads);
            el('path', {d: subQuad(ax, ay, cx, cy, bx, by, t0, t1)}, g);
            var p0 = smp[0], p1 = quadAt(ax, ay, cx, cy, bx, by, t1), pm = quadAt(ax, ay, cx, cy, bx, by, (t0 + t1) / 2);
            knot(g, p0[0], p0[1], 9, '', {}); knot(g, p1[0], p1[1], 9, '', {}); diamond(g, pm[0], pm[1], 14, '', {});
            return true;
          });
        });
      });

      // изображения в паспарту
      L.placed.forEach(function (it) {
        var m = it.m, fx = it.fx, fy = it.fy;
        var g = el('g', {'class': 'mem-pic mem-' + it.size.toLowerCase() + ' mem-isl-' + it.island, 'data-img': it.id}, gPics);
        el('rect', {'class': 'mem-shadow', x: fx + 10, y: fy + 12, width: m.ow, height: m.oh}, g);
        el('rect', {'class': 'mem-mat', x: fx, y: fy, width: m.ow, height: m.oh}, g);
        el('rect', {'class': 'mem-rule', x: fx + 10, y: fy + 10, width: m.ow - 20, height: m.oh - 20}, g);
        var ix = fx + MAT, iy = fy + MAT;
        var img = el('image', {x: ix, y: iy, width: m.w, height: m.h, preserveAspectRatio: 'xMidYMid slice', 'class': 'mem-img'}, g);
        img.setAttribute('data-src', BASE + it.file);
        el('rect', {'class': 'mem-edge', x: ix, y: iy, width: m.w, height: m.h}, g);
        // альбомные уголки
        var c = Math.round(m.h * 0.075) + 18;
        [[ix, iy, 1, 1], [ix + m.w, iy, -1, 1], [ix, iy + m.h, 1, -1], [ix + m.w, iy + m.h, -1, -1]].forEach(function (q) {
          var x = q[0] - q[2] * 7, y = q[1] - q[3] * 7;
          el('path', {'class': 'mem-corner', d: 'M' + x + ',' + y + ' h' + (q[2] * c) + ' L' + x + ',' + (y + q[3] * c) + 'Z'}, g);
        });
        // подпись
        var cap = el('g', {'class': 'mem-cap'}, g), y = fy + m.oh + CAP_GAP + m.f.fs * 0.9;
        m.tl.forEach(function (line) { var t = el('text', {'class': 'mem-cap-t', x: it.cx, y: r1(y), 'font-size': m.f.fs}, cap); t.textContent = line; y += m.f.fs * 1.18; });
        el('path', {'class': 'mem-cap-rule', d: 'M' + r1(it.cx - 46) + ',' + r1(y - m.f.fs * 0.35) + ' h92'}, cap);
        y += 26 - m.f.fs * 0.18 + m.f.fw * 0.25;
        m.wl.forEach(function (line) { var t = el('text', {'class': 'mem-cap-w', x: it.cx, y: r1(y), 'font-size': m.f.fw}, cap); t.textContent = line; y += m.f.fw * 1.25; });
        var tt = el('title', {}, g);
        tt.textContent = it.caption_title + ' · ' + it.caption_year + '\n' + it.caption_why + (it.source_url ? '\nИсточник: ' + it.source_url : '') + (it.license ? ' (' + it.license + ')' : '');
      });

      svg.insertBefore(net, svg.firstChild);
      svg.setAttribute('data-mem', L.placed.length + '/' + items.length + ' · ' + Math.round(performance.now() - t0) + ' мс');
      lazy(svg, net);
      scaleWatch(svg, net, vbW, L);
      hover(svg, net, byId);
      lastSvg = svg;
    } finally { building = false; }
  }

  /* ---------- ленивая загрузка ---------- */
  function lazy(svg, net) {
    var imgs = net.querySelectorAll('image[data-src]');
    function load(i) { var s = i.getAttribute('data-src'); if (s) { i.setAttribute('href', s); i.removeAttribute('data-src'); } }
    if (!('IntersectionObserver' in window)) { imgs.forEach(load); return; }
    var root = document.getElementById('scroller');
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { load(e.target); io.unobserve(e.target); } });
    }, {root: root || null, rootMargin: '1200px'});
    imgs.forEach(function (i) { io.observe(i); });
  }

  /* ---------- подписи только с «Крупно» ---------- */
  var CM = 96 / 2.54;   // 1 см в CSS-пикселях
  function cardSpan(svg) {
    var a = Infinity, z = -Infinity;
    svg.querySelectorAll('.node[data-pid] rect.card').forEach(function (r) {
      var x = +r.getAttribute('x'), w = +r.getAttribute('width'); a = Math.min(a, x); z = Math.max(z, x + w);
    });
    return isFinite(a) ? [a, z] : [140, svg.__memVbW - 40];
  }
  function frame(svg, net, vbW, L) {
    var w = svg.getBoundingClientRect().width; if (!w) return;
    var sp = cardSpan(svg), VW = +svg.viewBox.baseVal.width || vbW, g, x0, x1, fL, fR;
    for (var i = 0; i < 6; i++) {           // масштаб зависит от ширины viewBox, а она — от отступа
      g = CM * VW / w; fL = sp[0] - g; fR = sp[1] + g;
      x0 = Math.min(0, fL - 140); x1 = Math.max(vbW, fR + 40); VW = x1 - x0;
    }
    svg.setAttribute('viewBox', x0 + ' ' + L.top + ' ' + VW + ' ' + L.H);
    var gens = svg.querySelector(':scope > .gens');          // номера поколений — снаружи рамки, как и были
    if (gens) gens.setAttribute('transform', 'translate(' + (fL - 140) + ' 0)');
    var fr = net.querySelector('.mem-frame'), fy0 = L.top + 40, fy1 = L.top + L.H - 40;
    while (fr.firstChild) fr.removeChild(fr.firstChild);
    [0, 14].forEach(function (o) {
      el('rect', {x: fL + o, y: fy0 + o, width: fR - fL - 2 * o, height: fy1 - fy0 - 2 * o, 'class': o ? 'mem-frame-in' : 'mem-frame-out'}, fr);
    });
    for (var dx = fL + 6 * U; dx < fR - 6 * U; dx += 6 * U) { diamond(fr, dx, fy0 + 7, 12, 'mem-frame-d', {}); diamond(fr, dx, fy1 - 7, 12, 'mem-frame-d', {}); }
  }
  function scaleWatch(svg, net, vbW, L) {
    var lastW = 0;
    function upd() {
      var w = svg.getBoundingClientRect().width, k = w / vbW;
      if (Math.abs(w - lastW) > 0.5) { lastW = w; frame(svg, net, vbW, L); }
      net.classList.toggle('mem-far', k < CFG.captionsFrom);
      net.classList.toggle('mem-overview', k < 0.15);
    }
    upd();
    if (roSvg) roSvg.disconnect();
    if ('ResizeObserver' in window) { roSvg = new ResizeObserver(upd); roSvg.observe(svg); }
  }

  /* ---------- подсветка (без линий): человек → его места, место → его люди ---------- */
  function hover(svg, net, byId) {
    var byPid = {};
    Object.keys(byId).forEach(function (id) { byId[id].ppl.forEach(function (p) { (byPid[p] = byPid[p] || []).push(id); }); });
    svg.__memMaps = {byId: byId, byPid: byPid};
    if (svg.__memHover) return;
    svg.__memHover = true;
    function off() {
      svg.classList.remove('mem-hl');
      svg.querySelectorAll('.mem-on, .mem-near').forEach(function (x) { x.classList.remove('mem-on'); x.classList.remove('mem-near'); });
    }
    function pic(id) { return svg.querySelector('.mem-pic[data-img="' + id + '"]'); }
    svg.addEventListener('mouseover', function (e) {
      var M = svg.__memMaps, t = e.target, n = t.closest && t.closest('.node[data-pid]'), m = t.closest && t.closest('.mem-pic');
      off();
      if (n) {
        var ids = M.byPid[n.dataset.pid] || [];
        if (!ids.length) return;
        svg.classList.add('mem-hl');
        ids.forEach(function (id) { var p = pic(id); if (p) p.classList.add('mem-on'); });
      } else if (m) {
        var it = M.byId[m.dataset.img]; if (!it) return;
        svg.classList.add('mem-hl'); m.classList.add('mem-on');
        it.ppl.forEach(function (pid) { var nd = svg.querySelector('.node[data-pid="' + pid + '"]'); if (nd) nd.classList.add('mem-on'); });
        svg.querySelectorAll('.mem-t[data-img~="' + it.id + '"]').forEach(function (th) {
          th.classList.add('mem-on');
          th.dataset.img.split(' ').forEach(function (o) { var p = pic(o); if (p && p !== m) p.classList.add('mem-near'); });
        });
      }
    });
    svg.addEventListener('mouseleave', off);
  }

  /* ---------- подключение к древу ---------- */
  var pending = 0;
  function schedule() {
    clearTimeout(pending);
    pending = setTimeout(function () {
      var s = document.querySelector('#canvas svg.tree') || document.querySelector('#canvas svg');
      if (s && s.querySelector('.node[data-pid]')) build(s);
    }, 120);
  }
  function watch() {
    var canvas = document.getElementById('canvas'); if (!canvas) return;
    // древо перерисовывается, когда родственники добавляют людей: пересчитываем расстановку
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var t = list[i].target;
        if (t.closest && t.closest('.mem-net')) continue;
        var added = list[i].addedNodes;
        for (var j = 0; j < added.length; j++) if (!(added[j].classList && added[j].classList.contains('mem-net'))) { schedule(); return; }
      }
    }).observe(canvas, {childList: true, subtree: true});
    var prev = window.familyRehook;
    window.familyRehook = function (svg) { if (prev) prev.apply(this, arguments); schedule(); };
    matchMedia(CFG.mobile).addEventListener && matchMedia(CFG.mobile).addEventListener('change', schedule);
  }

  BASE = CFG.src.replace(/[^\/]*$/, '');
  var fontsReady = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load('italic 600 40px "Cormorant Garamond"'), document.fonts.load('italic 400 30px "Cormorant Garamond"')]).catch(function () {})
    : Promise.resolve();
  Promise.all([fetch(CFG.src).then(function (r) { return r.json(); }), fontsReady]).then(function (a) {
    DATA = a[0];
    watch();
    schedule();
  }).catch(function (e) { console.warn('memorynet:', e); });
  window.memorynetRebuild = schedule;
})();
