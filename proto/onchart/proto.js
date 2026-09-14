/* ── UCT on-chart plot management · shared prototype engine ─────────────────
 *
 * This file is a RESEARCH FIXTURE. It imports nothing from the app and the app
 * imports nothing from it. Its vocabulary deliberately mirrors the real engine
 * so the interaction findings transfer without translation:
 *
 *   instance          an entry in cs.indicatorInstances
 *   defId             the definition behind it
 *   plots[]           one instance can emit several plots (MACD → 3)
 *   target            where it draws: 'price' | 'pane' | '@<hostInstanceId>'
 *   host              an instance whose target resolves to 'pane' owns that pane
 *
 * The destination rules below are a faithful reduction of
 *   engine/displayTarget.displayTargetOptions()   (which hosts may be joined)
 *   engine/instanceControls.setInstanceDisplayTarget()  (the one writer)
 * — see the audit. No second placement model is invented here.
 */
(function (global) {
  'use strict';

  // ── deterministic series ────────────────────────────────────────────────
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function walk(n, start, vol, seed) {
    const r = rng(seed); const out = []; let p = start;
    for (let i = 0; i < n; i++) {
      p *= 1 + (r() - 0.5) * vol + Math.sin(i / 17) * vol * 0.28;
      const o = p * (1 + (r() - 0.5) * vol * 0.4);
      const c = p;
      const h = Math.max(o, c) * (1 + r() * vol * 0.5);
      const l = Math.min(o, c) * (1 - r() * vol * 0.5);
      out.push({ o, h, l, c });
    }
    return out;
  }
  function sma(src, n) {
    const out = []; let acc = 0;
    for (let i = 0; i < src.length; i++) {
      acc += src[i]; if (i >= n) acc -= src[i - n];
      out.push(i >= n - 1 ? acc / n : NaN);
    }
    return out;
  }
  const N = 150;
  const AAPL = walk(N, 190, 0.016, 7);
  const QQQ = walk(N, 540, 0.012, 23);
  const SPY = walk(N, 640, 0.010, 91);
  const closes = a => a.map(b => b.c);
  const RSI = (() => {
    const c = closes(AAPL); const out = []; let g = 0, l = 0;
    for (let i = 0; i < c.length; i++) {
      if (i === 0) { out.push(NaN); continue; }
      const d = c[i] - c[i - 1];
      g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14;
      out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
    }
    return out;
  })();
  const MACD = (() => {
    const c = closes(AAPL);
    const ema = (src, n) => { const k = 2 / (n + 1); const o = []; let p = src[0]; src.forEach((v, i) => { p = i ? v * k + p * (1 - k) : v; o.push(p); }); return o; };
    const f = ema(c, 12), s = ema(c, 26);
    const m = f.map((v, i) => v - s[i]);
    const sig = ema(m, 9);
    return { m, sig, h: m.map((v, i) => v - sig[i]) };
  })();
  const CK = (() => {
    const hi = AAPL.map(b => b.h), lo = AAPL.map(b => b.l);
    return { long: sma(hi, 10).map(v => v * 0.985), short: sma(lo, 9).map(v => v * 1.015) };
  })();

  // ── the fixture ─────────────────────────────────────────────────────────
  // `target` is the canonical string. `pane` = owns a pane of its own.
  const FIXTURE = [
    { id: 'inst:aapl', def: 'dataSeries', stem: 'AAPL', args: '', pres: 'candles', target: 'price',
      plots: [{ key: 'close', label: 'AAPL', color: '#d8d3c6', dec: 2, series: closes(AAPL) }] },
    { id: 'inst:ma20a', def: 'movingAverage', stem: 'MA', args: '20', src: 'AAPL', target: 'price',
      plots: [{ key: 'ma', label: 'MA 20', color: '#5ea8f7', dec: 2, series: sma(closes(AAPL), 20) }] },
    { id: 'inst:ma50a', def: 'movingAverage', stem: 'MA', args: '50', src: 'AAPL', target: 'price',
      plots: [{ key: 'ma', label: 'MA 50', color: '#c07be0', dec: 2, series: sma(closes(AAPL), 50) }] },
    { id: 'inst:ma200a', def: 'movingAverage', stem: 'MA', args: '200', src: 'AAPL', target: 'price', hidden: true,
      plots: [{ key: 'ma', label: 'MA 200', color: '#e08a4a', dec: 2, series: sma(closes(AAPL), 120) }] },

    { id: 'inst:qqq', def: 'dataSeries', stem: 'QQQ', args: '', pres: 'candles', target: 'pane',
      plots: [{ key: 'close', label: 'QQQ', color: '#8fd7a8', dec: 2, series: closes(QQQ) }] },
    { id: 'inst:spy', def: 'dataSeries', stem: 'SPY', args: '', pres: 'line', target: '@inst:qqq',
      plots: [{ key: 'close', label: 'SPY', color: '#f0c674', dec: 2, series: closes(SPY) }] },
    { id: 'inst:ma20q', def: 'movingAverage', stem: 'MA', args: '20', src: 'QQQ', target: '@inst:qqq',
      plots: [{ key: 'ma', label: 'MA 20', color: '#6fb3d8', dec: 2, series: sma(closes(QQQ), 20) }] },
    { id: 'inst:qqq2', def: 'dataSeries', stem: 'QQQ', args: '', pres: 'line', target: '@inst:qqq', dup: 2,
      plots: [{ key: 'close', label: 'QQQ', color: '#cf6d6d', dec: 2, series: closes(QQQ).map(v => v * 0.998) }] },

    { id: 'inst:rsi', def: 'rsi', stem: 'RSI', args: '14', target: 'pane',
      plots: [{ key: 'rsi', label: 'RSI 14', color: '#dcbb5e', dec: 1, series: RSI }] },
    { id: 'inst:ma9r', def: 'movingAverage', stem: 'MA', args: '9', src: 'RSI 14', target: '@inst:rsi',
      plots: [{ key: 'ma', label: 'MA 9', color: '#9aa4b2', dec: 1, series: sma(RSI.map(v => isNaN(v) ? 50 : v), 9) }] },

    { id: 'inst:macd', def: 'macd', stem: 'MACD', args: '12,26,9', target: 'pane',
      plots: [
        { key: 'macd', label: 'MACD', color: '#5ea8f7', dec: 2, series: MACD.m },
        { key: 'signal', label: 'Signal', color: '#e08a4a', dec: 2, series: MACD.sig },
        { key: 'hist', label: 'Hist', color: '#6f7a86', dec: 2, series: MACD.h, hist: true },
      ] },

    { id: 'inst:ck', def: 'chandeKroll', stem: 'Chande Kroll Stop', args: '10,9,3', target: 'pane',
      plots: [
        { key: 'long', label: 'Long', color: '#2faf68', dec: 2, series: CK.long },
        { key: 'short', label: 'Short', color: '#df4646', dec: 2, series: CK.short, nocompute: true },
      ] },
  ];

  const PANE_H = { price: 196, 'inst:qqq': 124, 'inst:rsi': 92, 'inst:macd': 92, 'inst:ck': 84 };

  // ── icons (12px stroke set, matching UIcon's weight) ────────────────────
  const I = {
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.3 10.3 0 0 1 12 19c-6.4 0-10-7-10-7a18 18 0 0 1 5.1-5.9M9.9 4.2A10 10 0 0 1 12 4c6.4 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    panes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="8" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z"/></svg>',
  };

  // ── model helpers — the canonical questions, asked the canonical way ────
  function hostsOf(model) { return model.filter(i => i.target === 'pane'); }
  function paneOf(inst) { return inst.target === 'pane' ? inst.id : inst.target === 'price' ? 'price' : inst.target.slice(1); }
  function paneOrder(model) { return ['price'].concat(hostsOf(model).map(i => i.id)); }
  function guestsOf(model, id) { return model.filter(i => i.target === '@' + id); }
  function byId(model, id) { return model.find(i => i.id === id); }
  function labelOf(inst) {
    let s = inst.stem + (inst.args ? ' ' + inst.args : '');
    if (inst.dup) s += ' #' + inst.dup;
    return s;
  }
  function paneLabel(model, key) {
    if (key === 'price') return 'Price';
    const h = byId(model, key); return h ? labelOf(h) : 'Pane unavailable';
  }

  /** Every destination this instance may be WRITTEN to, plus a refusal sentence
   *  for the ones it may not. Mirrors displayTargetOptions + moveTargetRefusal. */
  function destinations(model, id) {
    const inst = byId(model, id); if (!inst) return [];
    const here = paneOf(inst);
    const out = [
      { value: 'price', label: 'Price pane', group: 'shared' },
      { value: 'pane', label: 'Its own pane', group: 'shared' },
    ];
    hostsOf(model).forEach(h => {
      if (h.id === id) return;              // it can never be its own guest
      out.push({ value: '@' + h.id, label: labelOf(h) + ' pane', group: 'panes' });
    });
    return out.map(o => {
      const target = o.value === 'pane' ? id : o.value === 'price' ? 'price' : o.value.slice(1);
      if (target === here) return Object.assign({}, o, { current: true, refusal: 'it is already here' });
      return o;
    });
  }

  /** The ONE writer. Everything in every concept funnels through this. */
  function setDisplayTarget(model, id, target, onWrite) {
    const inst = byId(model, id); if (!inst) return;
    const from = inst.target;
    inst.target = target;
    // A host that leaves strands its guests — the real engine's "Pane unavailable".
    // The prototype resolves it the safe way: promote the first guest to host.
    if (from === 'pane') {
      const g = model.filter(i => i.target === '@' + id);
      if (g.length && target !== 'pane') {
        g[0].target = 'pane';
        g.slice(1).forEach(x => { x.target = '@' + g[0].id; });
      }
    }
    if (onWrite) onWrite({ writer: 'setInstanceDisplayTarget', id: id, target: target });
  }

  // ── chart painting ──────────────────────────────────────────────────────
  function paint(canvas, model, paneKey) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const members = model.filter(i => paneOf(i) === paneKey && !i.hidden);
    const cols = members.flatMap(i => i.plots.filter(p => !p.nocompute).map(p => ({ i: i, p: p })));
    if (!cols.length) return;

    const AXIS = 48, PADL = 6, PADT = 16, PADB = 8;
    const plotW = w - AXIS - PADL, plotH = h - PADT - PADB;
    const from = 20;
    const vis = N - from;
    const x = k => PADL + (k / (vis - 1)) * plotW;

    // ⭐ ONE SCALE PER MEMBER when a pane hosts several — which is what a real
    // multi-series pane does (TC2000 shows two axes; the axis here belongs to the
    // pane HOST). A single shared scale flattens QQQ against SPY into a hairline.
    const candleOwner = members.find(m => m.pres === 'candles');
    function rangeOf(list) {
      let a = Infinity, b = -Infinity;
      list.forEach(v => { if (isFinite(v)) { if (v < a) a = v; if (v > b) b = v; } });
      return [a, b];
    }
    const scaleFor = new Map();
    let hostLo = Infinity, hostHi = -Infinity;
    members.forEach((m, mi) => {
      let a = Infinity, b = -Infinity;
      if (m.pres === 'candles') {
        const bars = m.stem === 'AAPL' ? AAPL : QQQ;
        for (let k = from; k < N; k++) { if (bars[k].l < a) a = bars[k].l; if (bars[k].h > b) b = bars[k].h; }
      }
      m.plots.filter(pp => !pp.nocompute).forEach(pp => {
        const [x0, x1] = rangeOf(pp.series.slice(from));
        if (x0 < a) a = x0; if (x1 > b) b = x1;
      });
      if (!isFinite(a)) { a = 0; b = 1; }
      const pd = (b - a) * 0.10 || 1;
      scaleFor.set(m.id, [a - pd, b + pd]);
      if (mi === 0) { hostLo = a - pd; hostHi = b + pd; }
    });
    if (!isFinite(hostLo)) return;
    const yFor = (id) => { const [a, b] = scaleFor.get(id) || [hostLo, hostHi];
      return v => PADT + plotH - ((v - a) / (b - a)) * plotH; };
    const lo = hostLo, hi = hostHi;
    const y = yFor(members[0].id);

    // grid + the HOST's axis (a guest keeps its own scale but not its own axis —
    // the same compromise TC2000 makes when two indicators share a pane)
    g.strokeStyle = 'rgba(255,255,255,.045)'; g.lineWidth = 1;
    g.fillStyle = '#706b5e'; g.font = '9px Instrument Sans, sans-serif'; g.textAlign = 'left';
    for (let n = 0; n <= 4; n++) {
      const v = lo + (hi - lo) * (n / 4), yy = Math.round(y(v)) + .5;
      g.beginPath(); g.moveTo(0, yy); g.lineTo(w - AXIS, yy); g.stroke();
      g.fillText(Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2), w - AXIS + 6, yy + 3);
    }

    // candles first, then lines
    if (candleOwner) {
      const bars = candleOwner.stem === 'AAPL' ? AAPL : QQQ;
      const y = yFor(candleOwner.id);
      const bw = Math.max(1.5, plotW / vis * 0.62);
      for (let k = from; k < N; k++) {
        const b = bars[k], xx = x(k - from), up = b.c >= b.o;
        g.strokeStyle = up ? '#2faf68' : '#df4646'; g.fillStyle = g.strokeStyle; g.lineWidth = 1;
        g.beginPath(); g.moveTo(Math.round(xx) + .5, y(b.h)); g.lineTo(Math.round(xx) + .5, y(b.l)); g.stroke();
        const yo = y(b.o), yc = y(b.c);
        g.fillRect(xx - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
      }
    }
    cols.forEach(({ i, p }) => {
      if (i.pres === 'candles') return;
      const y = yFor(i.id);
      if (p.hist) {
        const bw = Math.max(1.2, plotW / vis * 0.55);
        for (let k = from; k < N; k++) {
          const v = p.series[k]; if (!isFinite(v)) continue;
          g.fillStyle = v >= 0 ? 'rgba(47,175,104,.5)' : 'rgba(223,70,70,.5)';
          const y0 = y(0), y1 = y(v);
          g.fillRect(x(k - from) - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
        }
        return;
      }
      g.strokeStyle = p.color; g.lineWidth = i.sel ? 2.2 : 1.3;
      if (i.sel) { g.shadowColor = 'rgba(220,187,94,.55)'; g.shadowBlur = 7; }
      g.beginPath(); let started = false;
      for (let k = from; k < N; k++) {
        const v = p.series[k]; if (!isFinite(v)) { started = false; continue; }
        const xx = x(k - from), yy = y(v);
        if (!started) { g.moveTo(xx, yy); started = true; } else g.lineTo(xx, yy);
      }
      g.stroke(); g.shadowBlur = 0;
    });
  }

  // ── legend markup ───────────────────────────────────────────────────────
  function rowHTML(inst, opts) {
    const o = opts || {};
    const multi = inst.plots.length > 1;
    const c = inst.plots[0].color;
    const vals = inst.plots.map(p => {
      const last = p.series[N - 1];
      if (p.nocompute) return '<span class="v">—</span>';
      const t = isFinite(last) ? last.toFixed(p.dec) : '—';
      return '<span class="v' + (multi ? ' tinted' : '') + '" style="--c2:' + p.color + '">' + t + '</span>';
    }).join('');
    const nameBits = '<span class="stem">' + inst.stem + '</span>'
      + (inst.args ? '<span class="args">' + inst.args + '</span>' : '')
      + (inst.dup ? '<span class="args">#' + inst.dup + '</span>' : '')
      + (inst.src ? '<span class="src">· ' + inst.src + '</span>' : '');
    const cls = ['row', inst.hidden ? 'hidden' : '', multi ? 'parent' : '',
      inst.plots.some(p => p.nocompute) ? 'nocompute' : '', o.rowClass || ''].filter(Boolean).join(' ');
    let html = '<div class="' + cls + '" data-id="' + inst.id + '" style="--c:' + c + '" tabindex="0" role="button"'
      + ' aria-label="' + labelOf(inst) + '">'
      + '<span class="name"><i class="rail"></i>' + nameBits + '</span>'
      + '<span class="vals">' + (o.hideValues ? '' : vals) + '</span>'
      + '<span class="gut">' + (o.gut || '') + '</span>'
      + '</div>';
    if (multi) {
      html += inst.plots.map(p => {
        const last = p.series[N - 1];
        const t = p.nocompute ? '—' : (isFinite(last) ? last.toFixed(p.dec) : '—');
        return '<div class="sub" data-sub="' + inst.id + '" style="--c:' + p.color + '">'
          + '<span class="name"><i class="rail"></i><span class="stem">' + p.label + '</span></span>'
          + '<span class="v">' + t + '</span><span class="gut"></span></div>';
      }).join('');
    }
    return html;
  }

  function render(root, model, opts) {
    const o = opts || {};
    const order = paneOrder(model);
    root.innerHTML = order.map(key => {
      const members = model.filter(i => paneOf(i) === key);
      const h = PANE_H[key] || 88;
      const tag = members.length > 1 && key !== 'price'
        ? '<div class="paneTag">' + paneLabel(model, key) + ' pane · ' + members.length + '</div>' : '';
      return '<div class="pane" data-pane="' + key + '" style="height:' + h + 'px">'
        + '<canvas></canvas>'
        + '<div class="dropTarget"></div>'
        + '<div class="paneLegend">' + tag + members.map(i => rowHTML(i, o)).join('') + '</div>'
        + '</div>';
    }).join('')
      + '<div class="dock"><span class="dockIcon">' + I.pin + '</span><span class="dockCap">Park</span></div>'
      + '<div class="well">' + I.trash + ' Remove</div>'
      + order.map((k, n) => '<div class="seam" data-seam="' + n + '"><div class="line"></div><div class="cap">New pane</div></div>').join('')
      + '<div class="parkRail"></div>';

    // seams sit on the boundary between panes
    let top = 0;
    order.forEach((key, n) => {
      const seam = root.querySelector('[data-seam="' + n + '"]');
      if (seam) seam.style.top = (top - 6) + 'px';
      top += (PANE_H[key] || 88);
    });
    root.querySelectorAll('.pane').forEach(p => paint(p.querySelector('canvas'), model, p.dataset.pane));
    return root;
  }

  // ── small shared utilities ──────────────────────────────────────────────
  let toastEl;
  function toast(html) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.innerHTML = html;
    toastEl.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.classList.remove('on'), 2600);
  }
  function wrote(w) {
    toast('canonical write → <code>' + w.writer + '(cs, &quot;' + w.id + '&quot;'
      + (w.target !== undefined ? ', &quot;' + w.target + '&quot;' : '')
      + (w.value !== undefined ? ', ' + w.value : '') + ')</code>');
  }
  function closePops() { document.querySelectorAll('.pop').forEach(p => p.remove()); }
  function place(el, x, y) {
    document.body.appendChild(el);
    const r = el.getBoundingClientRect();
    el.style.left = Math.min(x, window.innerWidth - r.width - 10) + 'px';
    el.style.top = Math.min(y, window.innerHeight - r.height - 10) + 'px';
  }

  global.UCT = {
    FIXTURE, PANE_H, I, N,
    clone: () => FIXTURE.map(f => Object.assign({}, f,
      { plots: f.plots.map(p => Object.assign({}, p)) })),
    hostsOf, paneOf, paneOrder, guestsOf, byId, labelOf, paneLabel,
    destinations, setDisplayTarget, render, paint, rowHTML, toast, wrote, closePops, place,
  };
})(window);
