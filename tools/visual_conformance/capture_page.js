// tools/visual_conformance/capture_page.js
//
// The browser-side half of a TradingView reference capture. Paste into the chart
// tab (or run through the browser tool), then stage a payload and copy it with a
// REAL Ctrl+C; `verify_clipboard.py` does the rest.
//
// ⛔ THIS INSTRUMENT ONLY READS. It never changes the symbol, the timeframe, the
// studies, the layout, or the Pine editor buffer. That is a hard rule, not a
// nicety: this browser is shared with whoever else is working on this machine,
// and a capture must never be the thing that disturbs them. `__uctCleanup()`
// removes every trace it does add.
//
// Protocol, dead ends, and the measured findings: see README.md beside this file.

(function () {
  const SENTINEL = -1000000;           // rows at or below this index are padding
  const real = r => r && r.index > SENTINEL;

  function chart() {
    const col = window._exposed_chartWidgetCollection;
    if (!col) throw new Error('no _exposed_chartWidgetCollection — is this a chart page?');
    return col.activeChartWidget.value();
  }

  /** Walk a TradingView property node into a plain object.
   *  ⚠️ `properties().state(true)` throws on some studies ("(e ?? []) is not
   *  iterable"), which is why this exists rather than the one-liner. */
  function plain(node, depth) {
    if (depth > 4 || node == null) return undefined;
    if (typeof node.value === 'function' && typeof node.childNames !== 'function') {
      try { return node.value() } catch (e) { return 'ERR' }
    }
    const out = {};
    let names = [];
    try { names = typeof node.childNames === 'function' ? node.childNames() : [] } catch (e) { /* leaf */ }
    for (const n of names) {
      let c;
      try { c = node.child(n) } catch (e) { continue }
      if (!c) continue;
      const v = plain(c, depth + 1);
      if (v !== undefined) out[n] = v;
    }
    if (!names.length && typeof node.value === 'function') {
      try { return node.value() } catch (e) { return 'ERR' }
    }
    return Object.keys(out).length ? out : undefined;
  }

  /** Everything about the current chart state, over the last N bars. */
  window.__uctCapture = function (opts) {
    const N = (opts && opts.bars) || 250;
    const cw = chart();
    const src = cw.model().model();
    const series = src.mainSeries();
    const si = series.symbolInfo() || {};

    // ⚠️ `series.bars()`, NOT `series.data()` — the latter does not exist.
    const bars = series.bars()._items.filter(real).slice(-N).map(r => ({
      i: r.index, t: r.value[0], o: r.value[1], h: r.value[2], l: r.value[3], c: r.value[4], v: r.value[5],
    }));
    const firstIdx = bars.length ? bars[0].i : null;

    const studies = src.allStudies().map(s => {
      const meta = s.metaInfo();
      const rows = (s._data && s._data._items ? s._data._items : [])
        .filter(r => real(r) && r.index >= firstIdx)
        .map(r => ({ i: r.index, v: r.value }));
      return {
        id: meta.id,
        description: meta.description,
        title: (() => { try { return s.title(true) } catch (e) { return null } })(),
        isCustom: /tv-scripting/.test(meta.id),
        plots: (meta.plots || []).map(p => ({ id: p.id, type: p.type, target: p.target || null })),
        styles: meta.styles || null,
        properties: plain(s.properties(), 0) || null,
        rowCount: rows.length,
        rows,
      };
    });

    return {
      capturedAt: new Date().toISOString(),
      layout: { url: location.href, title: document.title },
      symbol: {
        name: si.name || null, full_name: si.full_name || null, pro_name: si.pro_name || null,
        description: si.description || null, exchange: si.exchange || null, type: si.type || null,
        pricescale: si.pricescale || null, timezone: si.timezone || null, session: si.session || null,
      },
      // ⚠️ `series.interval()`, NOT `cw.resolution()` — the latter does not exist.
      resolution: series.interval(),
      barCount: bars.length,
      barRange: bars.length
        ? { firstIndex: bars[0].i, lastIndex: bars[bars.length - 1].i,
            firstTime: bars[0].t, lastTime: bars[bars.length - 1].t }
        : null,
      bars,
      studies,
      chartTheme: (() => {
        try {
          const p = chart().properties().paneProperties;
          return { background: p.background.value(),
                   vertGridColor: p.vertGridProperties.color.value(),
                   horzGridColor: p.horzGridProperties.color.value() };
        } catch (e) { return 'ERR ' + e.message }
      })(),
      mainSeriesStyle: (() => {
        try {
          const b = chart().properties().mainSeriesProperties.candleStyle;
          return { upColor: b.upColor.value(), downColor: b.downColor.value(),
                   borderUpColor: b.borderUpColor.value(), borderDownColor: b.borderDownColor.value(),
                   wickUpColor: b.wickUpColor.value(), wickDownColor: b.wickDownColor.value() };
        } catch (e) { return 'ERR ' + e.message }
      })(),
    };
  };

  /** One study's per-bar values as CSV, joined to the OHLCV of the same bars.
   *  A bar with no study row gets empty cells rather than a dropped line — the
   *  row count must always equal the bar count, or an alignment bug reads as a
   *  short file. */
  window.__uctCsv = function (studyIdPrefix, bars) {
    const p = window.__uctCapture({ bars: bars || 250 });
    const st = p.studies.find(s => s.id.startsWith(studyIdPrefix));
    if (!st) throw new Error('no study matching ' + studyIdPrefix + ' — have: ' + p.studies.map(s => s.id).join(', '));
    const byIdx = new Map(st.rows.map(r => [r.i, r.v]));
    const cols = ['i', 't', 'o', 'h', 'l', 'c', 'v'].concat(st.plots.map(x => x.id));
    const lines = [cols.join(',')];
    for (const b of p.bars) {
      const v = byIdx.get(b.i);
      const plot = st.plots.map((_, k) => {
        const x = v ? v[k + 1] : undefined;              // v[0] is the bar time
        return (x === undefined || x === null || Number.isNaN(x)) ? '' : x;
      });
      lines.push([b.i, b.t, b.o, b.h, b.l, b.c, b.v].concat(plot).join(','));
    }
    return {
      csv: lines.join('\n'),
      meta: {
        capturedAt: p.capturedAt, symbol: p.symbol, resolution: p.resolution,
        barCount: p.barCount, barRange: p.barRange, layout: p.layout,
        chartTheme: p.chartTheme, mainSeriesStyle: p.mainSeriesStyle,
        study: { id: st.id, title: st.title, description: st.description,
                 plots: st.plots, styles: st.styles, properties: st.properties },
      },
    };
  };

  /** FNV-1a over UTF-16 code units. The shell recomputes this identically. */
  window.__uctHash = function (s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
    return h;
  };

  /**
   * Stage text for a real Ctrl+C and report its receipt.
   *
   * ⭐⭐ THE RECEIPT IS THE WHOLE POINT. The OS clipboard is machine-wide and this
   * box runs concurrent sessions; one of them overwriting the clipboard mid-copy
   * produces a silent no-op, and a capture written from a stomped clipboard is
   * wrong in a way nothing downstream can detect. Nothing is written unless the
   * shell recomputes the same length AND the same hash.
   */
  window.__uctStage = function (text) {
    document.getElementById('uct-stage')?.remove();
    const ta = document.createElement('textarea');
    ta.id = 'uct-stage';
    Object.assign(ta.style, {
      position: 'fixed', left: '120px', top: '480px', width: '400px', height: '120px',
      zIndex: 2147483647, background: '#111', color: '#0f0', fontSize: '10px',
    });
    ta.value = text;
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const r = ta.getBoundingClientRect();
    return {
      chars: text.length,
      fnv1a: window.__uctHash(text),
      selected: ta.selectionEnd - ta.selectionStart,
      // The browser tool's coordinates are screenshot pixels, not CSS pixels.
      clickAt: { x: Math.round((r.x + r.width / 2) * (1568 / innerWidth)),
                 y: Math.round((r.y + r.height / 2) * (1568 / innerWidth)) },
    };
  };

  /** Remove every trace this instrument added. Run it when the capture is done. */
  window.__uctCleanup = function () {
    document.getElementById('uct-stage')?.remove();
    const names = ['__uctCapture', '__uctCsv', '__uctHash', '__uctStage', '__uctCleanup'];
    const left = [];
    for (const k of names) { try { delete window[k] } catch (e) { window[k] = undefined } }
    for (const k of names) if (window[k] !== undefined) left.push(k);
    return { staged: !!document.getElementById('uct-stage'), globalsLeft: left };
  };

  return 'uct capture instrument ready: __uctCapture, __uctCsv, __uctStage, __uctCleanup';
})();
