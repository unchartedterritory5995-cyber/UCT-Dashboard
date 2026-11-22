// Ten exact edits to lightweight-charts' production build, applied at BUILD time by
// `patchChartLibrary()` in vite.config.js. Nothing in node_modules is changed. Edits 1-3 are the
// data layer (below); edits 4-5 stop the series markers plugin copying the whole series on every
// redraw and every data change; edit 6 stops `setData` rebuilding the time scale when no time
// point was added or removed; edit 7 paints what a draw's own layout raised in that draw, and edits
// 8-10 stop a canvas the paint resized asking for a second paint (see their entries in PATCHES).
//
// WHY. Flipping a chart to another symbol calls `series.setData` on every series. The library's
// data layer does work proportional to (time points x series) on EACH of those calls, so a chart
// with S series does S x S x points of work per flip. Measured on production with a CPU profile
// (2026-11-13, ~4,400-bar daily charts carrying the RS suite, about 30 series): `setData` was 343
// of the 740 busy milliseconds of a flip. In a bench of the library alone (30 series x 4,400
// points, real Chromium) one flip cost about 150 ms as shipped and about 45 ms with these edits.
//
// WHAT. Each edit keeps the library's behaviour exactly:
//   1. `timeScalePointTime` walked every row mapped to a time point to return the FIRST row's
//      original time (a `forEach` cannot stop early). It now stops at the first.
//   2. `assignIndexToPointData` rewrote the index of every row at every time point on every call,
//      including when the index had not moved. A row is always created with its point's current
//      index and only this function changes either, so an unmoved point needs no write.
//   3. `businessDayConverter` parsed each 'YYYY-MM-DD' string through `Date` twice for every point
//      of every series. The answer for a string never changes, so it is remembered; every call
//      still returns its own fresh objects.
//
// PROOF. `src/__tests__/chartLibraryPatch.test.js` runs the shipped and the patched build side by
// side through a long seeded sequence of data operations and compares what the public API reports
// after every step; it also counts the work, and shows each edit is needed by leaving it out.
//
// ⛔ The targets are the library's MINIFIED text, so they are tied to one exact version. A library
// upgrade that moves any of them fails the build (and the test) by name: re-derive the edits from
// `node_modules/lightweight-charts/dist/lightweight-charts.development.mjs` (`DataLayer`,
// `timeScalePointTime`, `assignIndexToPointData`, `businessDayConverter`), or delete the ones the
// new version no longer needs.

export const LWC_VERSION = '5.2.0'
export const LWC_TARGET = '/node_modules/lightweight-charts/dist/lightweight-charts.production.mjs'

export const PATCHES = [
  {
    name: 'timeScalePointTime stops at the first row',
    find: 'function cs(t){let i;return t.forEach((t=>{void 0===i&&(i=t.Qr)})),_(i)}',
    replace: 'function cs(t){for(const i of t.values())if(void 0!==i.Qr)return i.Qr;return _(void 0)}',
  },
  {
    name: 'assignIndexToPointData skips a point whose index has not moved',
    find: 'function fs(t,i){t.$n=i,t.GM.forEach((t=>{t.$n=i}))}',
    replace: 'function fs(t,i){t.$n!==i&&(t.$n=i,t.GM.forEach((t=>{t.$n=i})))}',
  },
  {
    name: 'businessDayConverter remembers each date string',
    find: 'function ln(t){let i=t;if(m(t)&&(i=_n(t)),!Ki(i))throw new Error("time must be of type BusinessDay");const n=new Date(Date.UTC(i.year,i.month-1,i.day,0,0,0,0));return{Sf:Math.round(n.getTime()/1e3),xf:i}}',
    replace: 'const uctDayMemo=new Map;function ln(t){const s="string"==typeof t;if(s){const c=uctDayMemo.get(t);if(void 0!==c)return{Sf:c.Sf,xf:{day:c.day,month:c.month,year:c.year}}}let i=t;if(m(t)&&(i=_n(t)),!Ki(i))throw new Error("time must be of type BusinessDay");const n=new Date(Date.UTC(i.year,i.month-1,i.day,0,0,0,0)),r=Math.round(n.getTime()/1e3);return s&&uctDayMemo.size<5e4&&uctDayMemo.set(t,{Sf:r,day:i.day,month:i.month,year:i.year}),{Sf:r,xf:i}}',
    introduces: ['uctDayMemo'],
  },
  // ⭐ THE SERIES MARKERS PLUGIN COPIED THE WHOLE SERIES (2026-11-19). `createSeriesMarkers` (the
  // chart's BUY/SELL, earnings and event markers) called `series.data()`, which rebuilds every row
  // of the series as a new object, in two places: its pane view on EVERY redraw (each pan, zoom and
  // crosshair frame), and its marker re-index after EVERY data change (each live tick's update()).
  // On a 50,000-bar hourly chart that is a 50,000-object copy per frame and per tick. Measured on
  // production data (real Chrome, 60m list flips): the product's whole-series copies were 99-140 ms
  // of each flip's first 700 ms of main-thread work.
  {
    name: 'series markers: the redraw no longer copies the series for a check that never fires',
    // `data()[0]` is a row object or undefined, never null: the early return is unreachable. The
    // copy it made is the only thing the line did.
    find: 'if(null===this.Te.data()[0])return;',
    replace: '/*uct:markers-redraw-no-copy*/',
  },
  {
    name: 'series markers: the re-index reads the first bar, not a copy of every bar',
    // The copy was read for its length and its first row's time only. `dataByIndex` with the most
    // negative index and NearestRight (1) is that first row, or null for an empty series: the same
    // row the copy's [0] was (the library's own binary search over the same rows).
    find: 'i=this.Te?.data();if(null==t.getVisibleLogicalRange()||!this.Te||0===i.length)return void(this.US=[]);const n=t.timeToIndex(u(i[0].time),!0);',
    replace: 'i=this.Te?.dataByIndex(-9007199254740991,1);if(null==t.getVisibleLogicalRange()||!this.Te||null==i)return void(this.US=[]);const n=t.timeToIndex(u(i.time),!0);',
  },
  // ⭐ A SERIES REPLACED ON THE SAME TIMES NO LONGER REBUILDS THE TIME SCALE (2026-11-19).
  // `setSeriesData` first removed the series from every time point and counted ANY removal as a
  // change of the time scale, so EVERY `setData` on a chart with more than one series rebuilt the
  // whole time scale: one object per time point, a sort, and a walk comparing it to the old one.
  // A symbol flip calls `setData` on every series (candles, volume, the moving averages), so an
  // hourly chart of 45,000 points paid that rebuild six times per flip, though only the call that
  // adds a time point and the call that empties one can change the scale at all.
  // The time scale changes exactly when a time point is created (the library already notes that)
  // or a point is left with no series and removed by its own cleanup (now noted by the cleanup
  // shrinking the point map). With neither, the rebuilt scale has the same keys in the same order,
  // and the library's own comparison of old and new returns "unchanged" and keeps the old scale
  // object, so skipping the rebuild changes nothing anyone can see.
  // Measured 2026-11-19 (real Chromium, the library alone, candles + volume + 4 lines x 45,000
  // hourly points, both builds interleaved in one page, three runs): a flip 131-144 ms -> 105-108 ms.
  {
    name: 'setSeriesData rebuilds the time scale only when a time point is added or removed',
    find: 'else for(const i of this.ng)i.pointData.GM.delete(t)&&(s=!0);let r=[];if(0!==i.length){const n=i.map((t=>t.time)),e=this.xu.createConverterToInternalObj(i),h=os(t.bh()),a=t.ll(),l=t.ol();r=i.map(((i,r)=>{const o=e(i.time),_=this.xu.key(o);let u=this.QM.get(_);void 0===u&&(u=_s(o),this.QM.set(_,u),s=!0);const c=h(o,u.$n,i,n[r],a,l);return u.GM.set(t,c),c}))}n&&this.eg(),this.rg(t,r);',
    replace: 'else for(const i of this.ng)i.pointData.GM.delete(t);let r=[];if(0!==i.length){const n=i.map((t=>t.time)),e=this.xu.createConverterToInternalObj(i),h=os(t.bh()),a=t.ll(),l=t.ol();r=i.map(((i,r)=>{const o=e(i.time),_=this.xu.key(o);let u=this.QM.get(_);void 0===u&&(u=_s(o),this.QM.set(_,u),s=!0);const c=h(o,u.$n,i,n[r],a,l);return u.GM.set(t,c),c}))}n&&(n=this.QM.size,this.eg(),n!==this.QM.size&&(s=!0)),this.rg(t,r);',
  },
  // ⭐ ONE CHANGE, ONE PAINT (2026-11-21). The chart widget's draw (`_drawImpl`, `MM` here) lays the
  // chart out first on a full update (`_updateGui`: pane widgets, then `_adjustSizeImpl`, which
  // measures every price axis and sets every pane's size), then paints. Laying out RAISES
  // invalidations of its own: setting a pane's height or the chart's width recalculates every pane
  // (`recalculateAllPanes` -> `Pane.recalculate` -> `lightUpdate`), and a price axis whose labels
  // grew asks for a full update (`PriceAxisWidget._onMarksChanged` -> `fullUpdate`). The widget
  // clears its pending mask at the START of a draw, so each of those schedules ANOTHER frame:
  //   * the light one always, though the paint that follows in the same draw already shows the
  //     recalculated panes: a second paint of the same picture;
  //   * the full one is folded back into the draw (the library's own `3===this.iM?.ls()` step), and
  //     the relayout that fold runs raises the light one again.
  // Measured on eight real-Chrome list flips of the production build (2026-11-20, CPU samples):
  // one switch cost each chart THREE paints in three consecutive frames (full, full, light), about
  // 13 ms of the flip's 51 ms of chart paint for the second and third. Edits 8-10 take the other
  // repaint a resized canvas asked for.
  // The edit keeps the library's draw as it is (its one full fold included) and adds one step before
  // the paint: a pending update of light level or lower, raised by this draw's own layout and carrying
  // no time-scale work, is merged into the draw's mask (its autoscale flags applied first, as the next
  // frame's draw would apply them) and painted by this draw. The frame it asked for then finds nothing
  // to do. A FULL update still pending there (a relayout that grew an axis again), anything raised
  // DURING the paint itself, and any pending time-scale work still get their own frame, as before.
  // (A draw handed the pending mask itself, as `takeScreenshot` does, merges nothing: `iM !== t`.)
  {
    name: 'a draw paints what its own layout raised, in the same frame',
    find: 'MM(t,i){const n=t.ls();3===n&&this.VM(),3!==n&&2!==n||(this.BM(t),this.EM(t,i),this._M.kt(),this.Gw.forEach((t=>{t.sw()})),3===this.iM?.ls()&&(this.iM.Ss(t),this.VM(),this.BM(this.iM),this.EM(this.iM,i),t=this.iM,this.iM=null)),this.km(t)}',
    replace: 'MM(t,i){const n=t.ls();3===n&&this.VM(),3!==n&&2!==n||(this.BM(t),this.EM(t,i),this._M.kt(),this.Gw.forEach((t=>{t.sw()})),3===this.iM?.ls()&&(this.iM.Ss(t),this.VM(),this.BM(this.iM),this.EM(this.iM,i),t=this.iM,this.iM=null),null!==this.iM&&this.iM!==t&&2>=this.iM.ls()&&0===this.iM.bs().length&&(this.BM(this.iM),this.iM.Ss(t),t=this.iM,this.iM=null)),this.km(t)}',
  },
  // ⭐ …AND A CANVAS RESIZED BY THE PAINT ASKS FOR NO SECOND PAINT (2026-11-21). Every widget (a pane, a
  // price axis, the time axis) listens to its canvases' "suggested bitmap size changed" and asks for a light
  // update, so a canvas the layout resized is redrawn at its new size. The paint then APPLIES the suggestion
  // (`applySuggestedBitmapSize`, the first thing each widget's paint does) and fancy-canvas reports that as a
  // change too: from the size it suggested to none (`_emitSuggestedBitmapSizeChanged(old, null)`). The widget
  // asked for another light update, and the frame after every resize repainted the picture the paint had just
  // drawn at the applied size. A report whose new suggestion is NONE has nothing left to show (the bitmap is
  // already that size, or already the canvas' size) and now asks for nothing; a new suggestion still does.
  {
    name: 'an applied canvas size asks for no second paint (price axis)',
    find: 'this.hm=()=>{this.rm||this.yt.am().Qt().mr()},this.lm=()=>{this.rm||this.yt.am().Qt().mr()}',
    replace: 'this.hm=(t,i)=>{this.rm||null===i||this.yt.am().Qt().mr()},this.lm=(t,i)=>{this.rm||null===i||this.yt.am().Qt().mr()}',
  },
  {
    name: 'an applied canvas size asks for no second paint (pane)',
    find: 'this.hm=()=>{this.rm||null===this.Zm||this.sn().mr()},this.lm=()=>{this.rm||null===this.Zm||this.sn().mr()}',
    replace: 'this.hm=(t,i)=>{this.rm||null===this.Zm||null===i||this.sn().mr()},this.lm=(t,i)=>{this.rm||null===this.Zm||null===i||this.sn().mr()}',
  },
  {
    name: 'an applied canvas size asks for no second paint (time axis)',
    find: 'this.hm=()=>{this.rm||this.qv.Qt().mr()},this.lm=()=>{this.rm||this.qv.Qt().mr()}',
    replace: 'this.hm=(t,i)=>{this.rm||null===i||this.qv.Qt().mr()},this.lm=(t,i)=>{this.rm||null===i||this.qv.Qt().mr()}',
  },
]

const occurrences = (code, needle) => code.split(needle).length - 1

/**
 * The patched source. Throws, naming the edit, unless every edit's target is present exactly once.
 * `leaveOut` (tests only) skips the named edits, to show each one is needed.
 */
export function patchLightweightCharts(code, leaveOut = []) {
  let out = code
  for (const p of PATCHES) {
    if (leaveOut.includes(p.name)) continue
    const n = occurrences(out, p.find)
    if (n !== 1) {
      throw new Error(`chart library patch "${p.name}": expected its target once and found it ${n} times. `
        + `lightweight-charts is no longer the ${LWC_VERSION} build these edits were written for: see scripts/chartLibraryPatch.mjs.`)
    }
    for (const id of p.introduces || []) {
      if (occurrences(out, id) !== 0) throw new Error(`chart library patch "${p.name}": the name ${id} is already used by the library`)
    }
    out = out.replace(p.find, () => p.replace)
  }
  return out
}

/** The Vite plugin: patch the library's production build as it is bundled, and refuse a build that bundled it unpatched. */
export function patchChartLibrary() {
  let patched = false
  const slashed = (id) => String(id).split('\\').join('/').split('?')[0]
  return {
    name: 'uct-chart-library-data-layer',
    apply: 'build',
    enforce: 'pre',
    buildStart() { patched = false },
    transform(code, id) {
      const file = slashed(id)
      if (!file.includes('/lightweight-charts/dist/')) return null
      if (!file.endsWith(LWC_TARGET)) {
        throw new Error(`chart library patch: the build bundled ${file}, not ${LWC_TARGET}; the edits were written for that file only`)
      }
      const out = patchLightweightCharts(code)
      patched = true
      return { code: out, map: null }
    },
    // A build that bundled the library by a path the transform did not recognise would ship it
    // unpatched and say nothing.
    buildEnd(error) {
      if (error || patched) return
      const library = [...this.getModuleIds()].map(slashed).find((id) => id.includes('/lightweight-charts/'))
      if (library) this.error(`chart library patch: ${library} was bundled without its data-layer edits`)
    },
  }
}
