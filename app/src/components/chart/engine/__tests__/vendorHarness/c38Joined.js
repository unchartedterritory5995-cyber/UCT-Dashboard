// app/src/components/chart/engine/__tests__/vendorHarness/c38Joined.js
//
// ─── ⭐⭐ C38 — A 300-BAR PROBE, GRADED ON THE VENDOR'S WHOLE HISTORY ──────────
//
// The 2026-09-30 SPY probes (`vw-offset-na`, `vw-mbb-auto`, `vw-gradient`) hold
// the last 300 daily bars of AMEX:SPY, and every one of them keys its rows on
// `bar_index` — which TradingView counts from the symbol's first bar (8175 on
// the window's first bar) and the member door, handed 300 bars, counts from 0.
// Graded as captured the control row diverges for that reason alone, and
// `vw-mbb-auto` reads up to 399 bars back, past the window's first bar.
//
// ⭐ THE VENDOR'S OWN EARLIER BARS ARE COMMITTED: `vw-bool-cast-spy-1d-2026-09-28`
// holds all 8,473 daily bars from the 1993-01-29 listing (`history.startsAtBar0`).
// Joining them in front of the probe's window gives the series TradingView ran
// the probe on — and the join PROVES ITSELF: the probe's first bar must land at
// exactly the index the vendor's own `bar_index` control column prints
// (`joinedFromListing` throws otherwise), which is true only if the history is
// gap-free and starts at the vendor's bar 0.
//
// So the probe's source is graded UNEDITED through the real member door, on bars
// that are all TradingView's, with `bar_index` the vendor's and no warm-up
// excuse. ⛔ Nothing is synthesised; a derived capture is re-sealed only after
// both parents' receipts verify, and it never enters `tests/fixtures/`.
//
// ⚠️ Test infrastructure (it lives under `__tests__/`), shared by the two C38
// rails. Never imported by a member surface.

import fs from 'node:fs'
import path from 'node:path'
import { validateCapture, sealCapture, sha256Hex } from '../../../../../../../tools/vendor_harness/schema.mjs'

export const HARNESS = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
/** The committed capture that holds AMEX:SPY 1D from its listing. */
export const SPY_FROM_LISTING = 'vw-bool-cast-spy-1d-2026-09-28'

const cache = new Map()
/** A committed capture, receipt-verified once. */
export function parent(id) {
  if (cache.has(id)) return cache.get(id)
  const cap = JSON.parse(fs.readFileSync(path.join(HARNESS, `${id}.json`), 'utf8'))
  const v = validateCapture(cap)
  if (!v.ok) throw new Error(`${id}: the committed capture does not verify — ${v.errors.join('; ')}`)
  cache.set(id, cap)
  return cap
}

/** One vendor plot column of a capture, by plot title, aligned to its bars. */
export function vendorColumn(cap, title) {
  const plot = cap.study.plots.find((p) => p.title === title)
  if (!plot) throw new Error(`${cap.id}: no plot titled ${title}`)
  const k = cap.plotValues.fields.indexOf(plot.id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[k]]))
  return cap.bars.rows.map((r) => (byTime.has(r[0]) ? byTime.get(r[0]) : null))
}

/**
 * The probe capture with TradingView's own earlier bars joined in front of it.
 *
 * @param {object} cap           a committed SPY 1D probe capture
 * @param {object} o
 * @param {string} o.control     title of the probe's `plot(bar_index, …)` row
 * @param {string} [o.id]        suffix for the derived id
 * @param {(text: string) => string} [o.source]  an edit of the source (cutting
 *                               rows the door does not carry); default unedited
 * @param {string[]} [o.keep]    plot titles to keep (others are cut from the
 *                               study and the rows); default all
 * @param {(fields: string[], rows: any[][], plots: object[]) => void} [o.mutateVendor]
 *                               a CONTROL may corrupt a vendor column
 */
export function joinedFromListing(cap, { control, id = 'joined', source, keep, mutateVendor } = {}) {
  const hist = parent(SPY_FROM_LISTING)
  if (!(hist.history && hist.history.startsAtBar0 === true)) {
    throw new Error(`${SPY_FROM_LISTING}: the history capture does not assert it starts at the listing`)
  }
  const same = (a, b) => String(a.pro_name || a.full_name) === String(b.pro_name || b.full_name)
  if (!same(hist.symbol, cap.symbol) || !/^1?D$/.test(cap.timeframe) || !/^1?D$/.test(hist.timeframe)) {
    throw new Error(`${cap.id}: not the listing ${SPY_FROM_LISTING} holds`)
  }
  const first = cap.bars.rows[0][0]
  const earlier = hist.bars.rows.filter((r) => r[0] < first)
  // ⛔ THE JOIN PROVES ITSELF OR IT IS NOT USED: the probe's first bar sits at
  // the index TradingView's own `bar_index` printed for it.
  const b0 = vendorColumn(cap, control)[0]
  if (earlier.length !== b0) {
    throw new Error(`${cap.id}: ${earlier.length} earlier bars are held, and the vendor's bar_index on the `
      + `window's first bar is ${b0} — the joined history is not the series TradingView ran`)
  }
  const text = source ? source(cap.source.text) : cap.source.text
  let plots = cap.study.plots
  let fields = cap.plotValues.fields
  let rows = cap.plotValues.rows
  if (keep) {
    const kept = new Set(cap.study.plots.filter((p) => keep.includes(p.title)).map((p) => p.id))
    plots = cap.study.plots.filter((p) => kept.has(p.id) || (p.type === 'colorer' && kept.has(p.target)))
    const ids = new Set(plots.map((p) => p.id))
    const at = fields.map((f, i) => ((f === 'time' || ids.has(f)) ? i : -1)).filter((i) => i >= 0)
    fields = at.map((i) => cap.plotValues.fields[i])
    rows = cap.plotValues.rows.map((r) => at.map((i) => r[i]))
  } else {
    rows = rows.map((r) => r.slice())
  }
  if (mutateVendor) mutateVendor(fields, rows, plots)
  const bars = { ...cap.bars, count: earlier.length + cap.bars.rows.length, rows: [...earlier, ...cap.bars.rows] }
  return sealCapture({
    ...cap,
    id: `${cap.id}-c38-${id}`,
    // the plot rows cover the probe's own window only: a bar before it has no
    // row because the vendor was not READ there, not because it answered `na`
    adaptedFrom: {
      format: 'harness-v1',
      path: `tests/fixtures/vendor/harness/${cap.id}.json`,
      note: `bars joined in front from ${SPY_FROM_LISTING} (${earlier.length} bars, the listing on); `
        + 'plot rows are the probe capture\'s own, untouched',
    },
    history: { startsAtBar0: true, why: `joined from ${SPY_FROM_LISTING}: ${hist.history.why}` },
    source: text === cap.source.text ? cap.source : { ...cap.source, text, sha256: sha256Hex(text), chars: text.length },
    study: { ...cap.study, plots },
    plotValues: { ...cap.plotValues, fields, rows },
    bars,
    window: { ...cap.window, chartBarsLoaded: bars.rows.length, firstBarTime: bars.rows[0][0] },
  })
}

/** Cut every `plot(…, "<title>" …)` line whose title is not kept. */
export const keepPlotLines = (titles) => (text) => text.split('\n')
  .filter((l) => {
    const m = /^plot\(.*"([A-Za-z0-9_]+)"/.exec(l)
    return !m || titles.includes(m[1])
  }).join('\n')
