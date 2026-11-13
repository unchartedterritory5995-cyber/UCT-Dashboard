// Three exact edits to lightweight-charts' production build, applied at BUILD time by
// `patchChartLibrary()` in vite.config.js. Nothing in node_modules is changed.
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
