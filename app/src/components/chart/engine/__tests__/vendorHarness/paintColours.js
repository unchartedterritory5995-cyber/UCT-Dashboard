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
//   withheld     the door withheld it by name (the reason is carried) — NOT graded
//   notDrawn     the vendor draws it, our door carried nothing for it
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

/** One capture's paints, paired and graded. `ours` is `runOurSide(capture)`. */
export function gradePaints(capture, ours) {
  const vendor = vendorPaints(capture)
  const rows = []
  const unpaired = []
  if (!ours || !ours.ok) {
    return { rows, unpaired, refused: (ours && ours.refusal) || 'our side did not run', vendorCount: vendor.length }
  }
  const tr = ours.translationPaints || []
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
      if (t.withheld) { rows.push({ ...base, state: 'withheld', reason: t.withheld.reason, displayed: v.displayed }); return }
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
      for (let j = 0; j < v.colors.length; j += 1) {
        const vc = v.colors[j]
        if (vc === undefined) continue
        const a = canon(vc)
        const b = canon(ourColours[j])
        compared += 1
        if (a !== NO_COLOUR) vendorPainted += 1
        if (!coloursAgree(a, b)) {
          differ += 1
          if (!first) first = { bar: j, vendor: a, ours: b }
        }
      }
      const state = t.na ? (differ ? 'naDiffers' : 'naBoth') : (differ ? 'differ' : 'agree')
      rows.push({ ...base, state, compared, differ, vendorPainted, first })
    })
  }
  return { rows, unpaired, vendorCount: vendor.length }
}
