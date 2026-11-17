// app/src/components/chart/engine/__tests__/vendorHarness/supplyAttribution.js
//
// ─── SUPPLY-ATTRIBUTED DIVERGENCE (coordinator ruling on #1541, 2026-11-17) ──────────────────
//
// The rule is `compare.mjs::attributableToSupply` (read its header). This file builds what the
// grade needs for ONE capture, and builds nothing unless every precondition holds:
//   * the capture has a recorded server supply (`ourSide.js::recordedSupplyOf`) with bars for a
//     store ticker;
//   * that store ticker has a request-witness row (`engine/requestWitnesses.json`) whose
//     `witness` names at least one COMMITTED capture (tests/fixtures/vendor/harness/<id>.json)
//     holding a `*_D_close` plot: TradingView's own read of that symbol's daily close on each of
//     its chart bars (the `rs-spx-daily` probe);
//   * our supply, placed on chart dates by the ENGINE's own alignment for that row
//     (`otherSymbols.js::witnessedBarsOf`), and the witness disagree on at least one date.
// Then it returns `{diffDays, dayOf, record, counterfactual}`: the dates that differ, the day of a
// chart bar (`interpret.js::isoDay`, the key the engine uses), the record a grade names, and a
// lazy run of our side on the supply with the witness's values on those dates
// (`runOurSideWithSupply`), asked only when a plot's divergences all fall on them.
//
// ⛔ Witnesses that disagree with each other on a date leave that date OUT (never attributed).
// ⛔ The member-facing grade stays on OUR supply; the counterfactual only proves the cause.
import fs from 'node:fs'
import path from 'node:path'
import REQUEST_WITNESSES from '../../requestWitnesses.json'
import { witnessedBarsOf } from '../../otherSymbols'
import { isoDay } from '../../ast/interpret'
import { recordedSupplyOf, runOurSideWithSupply } from './ourSide'

const HARNESS_DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const CAPTURE_ID_RE = /[a-z0-9][a-z0-9-]*-\d{4}-\d{2}-\d{2}/g
const CLOSE_TITLE_RE = /_D_close$/

/** The witness row whose `store` is this store ticker, or null. */
function witnessRowFor(store) {
  for (const [k, row] of Object.entries((REQUEST_WITNESSES && REQUEST_WITNESSES.rows) || {})) {
    if (!k.startsWith('_') && row && row.store === store) return { ...row, spelling: k }
  }
  return null
}

/** `{ids, byDay}`: TradingView's read of the symbol's daily close per chart day, from every committed
 *  witness capture the row names; a day two witnesses disagree on is dropped. */
export function witnessCloses(row, dir = HARNESS_DIR) {
  const ids = [...new Set(String((row && row.witness) || '').match(CAPTURE_ID_RE) || [])]
  const used = []
  const byDay = new Map()
  const conflicted = new Set()
  for (const id of ids) {
    const file = path.join(dir, `${id}.json`)
    if (!fs.existsSync(file)) continue
    const cap = JSON.parse(fs.readFileSync(file, 'utf8'))
    const plots = (cap.study && cap.study.plots) || []
    const fields = (cap.plotValues && cap.plotValues.fields) || []
    const plot = plots.find((p) => p && CLOSE_TITLE_RE.test(String(p.title || '')))
    const col = plot ? fields.indexOf(plot.id) : -1
    if (col < 0) continue
    used.push(id)
    for (const r of cap.plotValues.rows || []) {
      const day = isoDay(r[0])
      const v = r[col]
      if (!day || typeof v !== 'number' || !Number.isFinite(v)) continue
      if (byDay.has(day) && byDay.get(day) !== v) conflicted.add(day)
      else byDay.set(day, v)
    }
  }
  for (const d of conflicted) byDay.delete(d)
  return { ids: used, byDay }
}

/** What the grade needs to attribute a divergence to the supply, or null (see the header). */
export function supplyAttributionOf(capture, { dir = HARNESS_DIR } = {}) {
  let rec
  try { rec = recordedSupplyOf(capture) } catch { return null }
  if (!rec || !rec.other) return null
  // N of M counts the CHART's dates only: a difference outside the capture's window grades nothing
  const chartDays = new Set(((capture.bars && capture.bars.rows) || []).map((r) => isoDay(r[0])).filter(Boolean))
  for (const [store, e] of Object.entries(rec.other)) {
    if (!e || !Array.isArray(e.bars) || !e.bars.length) continue
    const row = witnessRowFor(store)
    if (!row) continue
    const w = witnessCloses(row, dir)
    if (!w.ids.length) continue
    const placed = witnessedBarsOf(row, e.bars)
    const diffDays = new Set()
    let compared = 0
    const corrected = e.bars.map((b) => ({ ...b }))
    for (let j = 0; j < placed.length; j += 1) {
      const day = isoDay(placed[j].t)
      if (!day || !chartDays.has(day) || !w.byDay.has(day)) continue
      compared += 1
      const tv = w.byDay.get(day)
      if (placed[j].c !== tv) {
        diffDays.add(day)
        // `witnessedBarsOf` keeps the supply's order (a bar whose day cannot be read is dropped,
        // and a recorded supply's `t` always reads), so placed[j] is the read of e.bars[j]
        corrected[j].c = tv
      }
    }
    if (!diffDays.size) continue
    let cf
    return {
      diffDays,
      dayOf: (t) => isoDay(t),
      record: { symbol: store, source: e.source, witness: w.ids, datesDiffer: diffDays.size, datesCompared: compared },
      counterfactual: () => (cf === undefined ? (cf = runOurSideWithSupply(capture, { [store]: corrected })) : cf),
    }
  }
  return null
}
