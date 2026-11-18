// app/src/components/chart/engine/__tests__/vendorHarness/paintColours.js
//
// ─── B1 — `bgcolor` / `barcolor`, graded against TradingView's own record ──────
//
// Test infrastructure (like `colourColumn.js`). A capture records every paint as a
// plot of its own: `bg_colorer` for a `bgcolor(…)` and `bar_colorer` for a
// `barcolor(…)`, one per call in source order, with the bar's colour per row — a
// palette INDEX (through `valToIndex`) or, palette-less, the packed colour — and
// `null` where the colour is `na`. The style's `transparency` folds in, and a
// `display` of 0 is a paint TradingView does not draw. `compare.mjs::vendorColorsFor`
// already reads exactly that for a plot's colorer, so it is asked here too: ONE
// reader of the vendor's colour.
//
// OUR side is `ourSide.runOurSide`'s `paints`: the binder's own `paintColoursFor`
// over the member door's computed columns — the function the chart draws with.
//
// ⛔ PAIRING IS BY SOURCE ORDER WITHIN A KIND, and it is checked, not assumed:
// Pine allows `bgcolor` / `barcolor` only in the global scope, so the vendor's k-th
// `bg_colorer` is the script's k-th `bgcolor(…)` statement, which is the k-th entry
// of the translator's `presentation.paints` of that kind. A count that disagrees is
// reported (`unpaired`), never paired by guess. A title both sides carry must match.
//
// Each vendor paint is one of:
//   graded       our colour compared bar for bar (`agree` / `differ`)
//   hiddenBoth   TradingView draws it nowhere (display 0) and neither do we
//   naBoth       our door folded it to `na` and the vendor's every bar is `na`
//   withheld     the door withheld it by name (the reason is carried) — NOT graded.
//                Either the translator withheld it (`t.withheld`), or (G5) the BIND
//                refused the column its colour is read from AND the member's
//                disclosure strip names the paint itself (`bindWithheldPaintsOf`,
//                `by: 'bind'`)
//   notDrawn     the vendor draws it, our door carried nothing for it, and nothing
//                the member reads names it
import { vendorColorsFor, coloursAgree, normalizeColor, NO_COLOUR, decodeVendorText } from '../../../../../../../tools/vendor_harness/compare.mjs'

const PAINT_TYPES = Object.freeze({ bg_colorer: 'bgcolor', bar_colorer: 'barcolor' })

/** Every paint plot the capture records, in its own (source) order, with the
 *  vendor's colour on each of the capture's bars. */
export function vendorPaints(capture) {
  const study = capture.study || {}
  const plots = study.plots || []
  const pv = capture.plotValues || { fields: [], rows: [] }
  const rowsByTime = new Map((pv.rows || []).map((r) => [String(r[0]), r]))
  const times = ((capture.bars && capture.bars.rows) || []).map((r) => r[0])
  const styles = study.styleState || {}
  const out = []
  for (const p of plots) {
    const kind = PAINT_TYPES[p.type]
    if (!kind) continue
    const column = (pv.fields || []).indexOf(p.id)
    const rec = { ...p, column, target: p.id }
    const style = styles[p.id] || {}
    const v = column < 0 ? { colors: null, reason: `no values recorded for ${p.id}` }
      : vendorColorsFor(capture, { id: p.id }, [rec], rowsByTime, times)
    out.push({
      id: p.id,
      kind,
      // TradingView hands titles through `metaInfo()` HTML-escaped (`K &gt; Upper level`).
      title: decodeVendorText(p.title ?? null),
      displayed: style.display !== 0,
      colors: v.colors,
      reason: v.reason || null,
    })
  }
  return out
}

const canon = (c) => (c === null || c === undefined ? NO_COLOUR : (normalizeColor(c) || c))

/** The name the member's strip gives a paint: `` `bgcolor` (line 12) ``. */
export const paintStripName = (kind, line) => `\`${kind || 'bgcolor'}\`${Number.isInteger(line) ? ` (line ${line})` : ''}`

/** ⭐ G5 — THE PAINTS THE BIND WITHHOLDS BY NAME. A paint whose colour is read from a
 *  helper column (`colorMode: 'column:<key>'`) that the BIND refused (a column error:
 *  another symbol it cannot serve, …) draws nothing. The translator never knew, so
 *  `t.withheld` is empty, and the grade used to read it as `notDrawn` ("our door
 *  carried nothing"): the wrong label, and the name was lost.
 *
 *  ⛔ BY NAME MEANS WHAT THE MEMBER READS. Both are required, and neither is
 *  inferred:
 *   - the column the paint's colour reads carries a column error (`columnErrors`);
 *   - a notice on the member's disclosure strip (`notices`: what the binder publishes,
 *     `chartClockReport().withheld` + `externalReadNotices()`) names THIS paint, i.e. its
 *     reason opens with the paint's strip name (`paintStripName`), and gives a reason.
 *  A refused helper the strip does not name stays `notDrawn` (fail closed).
 *  @returns {{kind: string, line: number|null, code: string|null, reason: string}[]} */
export function bindWithheldPaintsOf(def, { columnErrors = {}, notices = [] } = {}) {
  const out = []
  for (const p of (def && Array.isArray(def.paints) ? def.paints : [])) {
    const mode = p && p.colorMode
    const key = typeof mode === 'string' && mode.startsWith('column:') ? mode.slice('column:'.length) : null
    const err = key ? columnErrors[key] : null
    if (!err) continue
    const name = paintStripName(p.kind, p.line)
    const said = (notices || []).find((n) => n && typeof n.reason === 'string' && n.reason.startsWith(`${name} `))
    if (!said) continue
    out.push({ kind: p.kind || 'bgcolor', line: p.line ?? null, code: said.code || err.code || err.guard || null, reason: said.reason })
  }
  return out
}

// ─── ⭐ RC1 — THE WARM-UP A COLD REPLAY CANNOT GRADE ──────────────────────────
//
// A capture that does not start at the listing was computed by TradingView WARM
// (history before its bar 0). `ourSide.warmBarsSupply` replays the window over the
// same series' own proved history whenever a committed capture holds it; then
// nothing is in warm-up and every bar is graded. Where no supplier is proved, the
// replay is COLD, and its first bars are a warm-up region: reported SEPARATELY,
// `warm-up, not graded`, never counted as agreeing.
//
// The region is the capture's declared `warmup.bars` when it states one, else
// PAINT_WARMUP_FLOOR. ⭐ Why 200, measured (lane RC1, 2026-10-04, SPY 1D, six
// scripts, cold vs N bars of real SPY prehistory): every paint graded clean from
// N = 200 on; the slowest were ema-ribbon (EMA convergence + `var trendBars`:
// still 1 bar off at N = 100 and 150, 0 from 200) and elliott-wave (`ema(close, 35)`
// seed inside a 50-bar `ta.highest` equality: 0 from 100). A plot's `lookback`
// would undercount here: EMA and `var` state have unbounded memory.
// ⛔ The floor covers the measured scripts; a script with longer memory than these
// can still differ after bar 200 on a cold replay. That is a reason to commit a
// supplier capture, never a reason to raise this number until it is quiet.
export const PAINT_WARMUP_FLOOR = 200

/** Bars [0, W) of a capture's paint grade that are warm-up (not graded). */
export function paintWarmupOf(capture, supply) {
  const bar0 = !!(capture && capture.history && capture.history.startsAtBar0 === true)
  if (bar0 || (supply && (supply.kind === 'warm' || supply.kind === 'bar0'))) return 0
  const declared = capture && capture.warmup && capture.warmup.bars
  return Number.isInteger(declared) && declared >= 0 ? declared : PAINT_WARMUP_FLOOR
}

/** One capture's paints, paired and graded. `ours` is `runOurSide(capture)`. */
export function gradePaints(capture, ours) {
  const vendor = vendorPaints(capture)
  const rows = []
  const unpaired = []
  if (!ours || !ours.ok) {
    return { rows, unpaired, refused: (ours && ours.refusal) || 'our side did not run', vendorCount: vendor.length }
  }
  const tr = ours.translationPaints || []
  // ⭐ RC1 — which bars the paints were replayed over, carried into the grade so a
  // reader can tell a warm replay from a cold one, and the warm-up it implies.
  const warmupBars = paintWarmupOf(capture, ours.paintSupply)
  const supply = { ...(ours.paintSupply || { kind: 'cold', file: null, bars: 0, refused: [], reason: 'no supply recorded' }), warmupBars }
  for (const kind of ['bgcolor', 'barcolor']) {
    const vk = vendor.filter((v) => v.kind === kind)
    const ok = tr.filter((p) => p && p.kind === kind)
    if (vk.length !== ok.length) {
      unpaired.push({ kind, vendor: vk.length, ours: ok.length })
      continue
    }
    vk.forEach((v, i) => {
      const t = ok[i]
      const base = { id: v.id, kind, title: v.title, line: t.line ?? null }
      if (v.title && t.title && v.title !== t.title) {
        rows.push({ ...base, state: 'titleMismatch', vendorTitle: v.title, ourTitle: t.title })
        return
      }
      // ⭐ ENGINE 58 (S11) — with how many bars TradingView painted, so a paint we withheld
      // where TradingView paints NOTHING is "neither side draws", as `notDrawn` is
      // (`compare.mjs::comparePaints`). `null` when the capture's colours are unreadable.
      if (t.withheld) {
        const vendorPainted = v.displayed && v.colors
          ? v.colors.filter((c) => c !== undefined && canon(c) !== NO_COLOUR).length : null
        rows.push({ ...base, state: 'withheld', reason: t.withheld.reason, displayed: v.displayed, vendorPainted })
        return
      }
      if (!v.displayed) {
        rows.push({ ...base, state: t.hidden ? 'hiddenBoth' : 'hiddenVendorOnly' })
        return
      }
      if (!v.colors) { rows.push({ ...base, state: 'vendorUnreadable', reason: v.reason }); return }
      if (t.hidden) { rows.push({ ...base, state: 'hiddenOursOnly' }); return }
      let ourColours = null
      if (t.na) ourColours = v.colors.map(() => null)
      else {
        const drawn = (ours.paints || []).find((p) => p.kind === kind && p.line === t.line)
        if (!drawn || !drawn.colors) {
          // ⭐ G5 — the bind withheld it, and the member's strip names it: withheld BY NAME
          const named = (ours.bindWithheldPaints || []).find((w) => w.kind === kind && w.line === (t.line ?? null))
          if (named) {
            rows.push({ ...base, state: 'withheld', by: 'bind', code: named.code, reason: named.reason, displayed: v.displayed })
            return
          }
          // how many bars TradingView painted — 0 means neither side draws a bar
          // (the verdict counts that, `compare.mjs::comparePaints`)
          const vendorPainted = v.colors.filter((c) => c !== undefined && canon(c) !== NO_COLOUR).length
          rows.push({ ...base, state: 'notDrawn', vendorPainted })
          return
        }
        ourColours = drawn.colors
      }
      let compared = 0
      let differ = 0
      let vendorPainted = 0
      let first = null
      const warmup = { bars: Math.min(warmupBars, v.colors.length), compared: 0, differ: 0 }
      // ⭐ NUMBER PENDING (harness, fix/kill-spy-runtime-diverges) — THE RUN'S OWN CURTAIN. Off the listing the runtime
      // lane withholds its warm-up by name (`supply.curtainBars`): there it draws NO colour, as it draws no plot value
      // (the plot grade's warm-up is that same curtain). A bar there is excused only when our side drew nothing; a
      // colour drawn there is compared like any other bar. ⚰️ fvg-trend-spy-1d-2026-11-17: the run withheld bars 0-254
      // (its `var` counter reaches before the chart's first bar); the fixed floor graded bars 200-254 as "differ" and
      // every bar from 255 on agrees.
      const curtainBars = supply && Number.isInteger(supply.curtainBars) ? supply.curtainBars : 0
      for (let j = 0; j < v.colors.length; j += 1) {
        const vc = v.colors[j]
        if (vc === undefined) continue
        const a = canon(vc)
        const b = canon(ourColours[j])
        if (j < warmupBars || (j < curtainBars && (ourColours[j] === null || ourColours[j] === undefined))) {
          // warm-up, not graded: counted apart, never as agreeing
          warmup.compared += 1
          if (!coloursAgree(a, b)) warmup.differ += 1
          continue
        }
        compared += 1
        if (a !== NO_COLOUR) vendorPainted += 1
        if (!coloursAgree(a, b)) {
          differ += 1
          if (!first) first = { bar: j, vendor: a, ours: b }
        }
      }
      const state = t.na ? (differ ? 'naDiffers' : 'naBoth') : (differ ? 'differ' : 'agree')
      rows.push({ ...base, state, compared, differ, vendorPainted, first, ...(warmupBars ? { warmup } : {}) })
    })
  }
  return { rows, unpaired, vendorCount: vendor.length, supply }
}
