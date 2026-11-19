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
import crypto from 'node:crypto'
import REQUEST_WITNESSES from '../../requestWitnesses.json'
import { witnessedBarsOf } from '../../otherSymbols'
import { isoDay } from '../../ast/interpret'
import { isTradingDay, sessionAt, closeTime } from '../../../../../lib/marketClock/sessionCalendar.js'
import { recordedSupplyOf, runOurSideWithSupply } from './ourSide'

const HARNESS_DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
// ⭐ (#2015, 2026-11-19) A capture id may end in a PHASE (`<script>-<sym>-<tf>-<yyyy-mm-dd>[-<phase>]`), from the closed
// vocabulary `tools/vendor_harness/evidence_ledger.py::CAPTURE_PHASES`. It is restated here only because this reader is
// JavaScript; `supplyAttributionPhasedId.test.js` holds the two lists equal. ⚰️ Without the suffix a phased witness id was
// cut at its date and named a capture that does not exist.
export const CAPTURE_PHASES = Object.freeze(['insession', 'postclose-open', 'postclose-fresh', 'preopen'])
const CAPTURE_ID_RE = new RegExp(`[a-z0-9][a-z0-9-]*-\\d{4}-\\d{2}-\\d{2}(?:-(?:${CAPTURE_PHASES.join('|')}))?`, 'g')
/** Every capture id a witness text names, each whole (with its phase when it has one). */
export function captureIdsIn(text) {
  return String(text || '').match(CAPTURE_ID_RE) || []
}
const CLOSE_TITLE_RE = /_D_close$/

/** The witness row whose `store` is this store ticker, or null. */
function witnessRowFor(store) {
  for (const [k, row] of Object.entries((REQUEST_WITNESSES && REQUEST_WITNESSES.rows) || {})) {
    if (!k.startsWith('_') && row && row.store === store) return { ...row, spelling: k }
  }
  return null
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
const _witnessMemo = new Map()

/** Every committed TradingView witness of a row's symbol: `[{id, capturedAtUTC, byDay}]`, each the
 *  capture's own `*_D_close` read per chart day. A witness is a capture the row names (`witness`) or a
 *  committed capture of the row's own probe (`probe`: a file named `<probe>-*.json` whose source is the
 *  probe's text, sha256 checked), so a witness taken after the row was written counts too. */
export function witnessCaptures(row, dir = HARNESS_DIR) {
  const key = `${dir}|${row && row.spelling}`
  if (_witnessMemo.has(key)) return _witnessMemo.get(key)
  const ids = new Set(captureIdsIn(row && row.witness))
  const probeFile = row && typeof row.probe === 'string' ? path.resolve(dir, '..', '..', '..', '..', row.probe) : null
  if (probeFile && fs.existsSync(probeFile) && fs.existsSync(dir)) {
    const want = sha256(fs.readFileSync(probeFile, 'utf8'))
    const stem = path.basename(probeFile, '.pine')
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(`${stem}-`) || !f.endsWith('.json')) continue
      const cap = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      if (cap && cap.source && sha256(cap.source.text) === want) ids.add(f.slice(0, -'.json'.length))
    }
  }
  const out = []
  for (const id of [...ids].sort()) {
    const file = path.join(dir, `${id}.json`)
    if (!fs.existsSync(file)) continue
    const cap = JSON.parse(fs.readFileSync(file, 'utf8'))
    const plots = (cap.study && cap.study.plots) || []
    const fields = (cap.plotValues && cap.plotValues.fields) || []
    const plot = plots.find((p) => p && CLOSE_TITLE_RE.test(String(p.title || '')))
    const col = plot ? fields.indexOf(plot.id) : -1
    if (col < 0) continue
    const byDay = new Map()
    for (const r of cap.plotValues.rows || []) {
      const day = isoDay(r[0])
      const v = r[col]
      if (day && typeof v === 'number' && Number.isFinite(v)) byDay.set(day, v)
    }
    out.push({ id, capturedAtUTC: cap.capturedAtUTC || null, byDay })
  }
  _witnessMemo.set(key, out)
  return out
}

/** `{ids, byDay}`: TradingView's read of the symbol's daily close per chart day, over every committed
 *  witness (`witnessCaptures`); a day two witnesses disagree on is dropped (never attributed). */
export function witnessCloses(row, dir = HARNESS_DIR) {
  const used = []
  const byDay = new Map()
  const conflicted = new Set()
  for (const w of witnessCaptures(row, dir)) {
    used.push(w.id)
    for (const [day, v] of w.byDay) {
      if (byDay.has(day) && byDay.get(day) !== v) conflicted.add(day)
      else byDay.set(day, v)
    }
  }
  for (const d of conflicted) byDay.delete(d)
  return { ids: used, byDay }
}

/** OTHER-SYMBOL UNSETTLED (coordinator ruling on #1541): what `compare.mjs` asks to decide whether a bar is
 *  one TradingView's own captures disagree about, or null when the capture's supply symbol has no committed
 *  witness. `candidatesFor(time)`: the other values this capture may have read there (the supply's values
 *  of that session and of the one before it, minus the one our side read), each with a lazy run of our side
 *  reading it on that bar; `witnessesFor(time)`: every committed witness's read of that date. */
export function otherSymbolUnsettledOf(capture, { dir = HARNESS_DIR } = {}) {
  let rec
  try { rec = recordedSupplyOf(capture) } catch { return null }
  if (!rec || !rec.other) return null
  for (const [store, e] of Object.entries(rec.other)) {
    if (!e || !Array.isArray(e.bars) || !e.bars.length) continue
    const row = witnessRowFor(store)
    if (!row) continue
    const witnesses = witnessCaptures(row, dir)
    if (!witnesses.length) continue
    const placed = witnessedBarsOf(row, e.bars)
    const readIdx = new Map()
    placed.forEach((p, j) => { const d = isoDay(p.t); if (d) readIdx.set(d, j) })
    const ownIdx = new Map()
    e.bars.forEach((b, j) => { const d = isoDay(b.t); if (d) ownIdx.set(d, j) })
    const runs = new Map()
    return {
      symbol: store,
      dayOf: (t) => isoDay(t),
      witnessesFor: (t) => {
        const day = isoDay(t)
        return witnesses.filter((w) => w.byDay.has(day)).map((w) => ({ id: w.id, capturedAtUTC: w.capturedAtUTC, value: w.byDay.get(day) }))
      },
      candidatesFor: (t) => {
        const day = isoDay(t)
        const j = readIdx.get(day)
        if (j === undefined) return []
        const read = e.bars[j].c
        const own = ownIdx.get(day)
        const values = [...new Set([own !== undefined ? e.bars[own].c : null, j > 0 ? e.bars[j - 1].c : null])]
          .filter((v) => typeof v === 'number' && Number.isFinite(v) && v !== read)
        return values.map((v) => ({
          read: v,
          run: () => {
            const k = `${day}|${v}`
            if (!runs.has(k)) {
              const over = e.bars.map((b) => ({ ...b }))
              over[j].c = v
              runs.set(k, runOurSideWithSupply(capture, { [store]: over }))
            }
            return runs.get(k)
          },
        }))
      },
    }
  }
  return null
}

// ─── SUPPLY BEHIND THE CAPTURE (coordinator ruling, 2026-11-18) ──────────────────────────────────────
//
// A capture whose newest bar is FORMING read another symbol's newest session. When the supply recorded beside
// it was recorded EARLIER and holds no row of that session, our side cannot answer that bar from it: no rule
// reproduces a value the supply does not contain. That ONE bar grades INCONCLUSIVE by name and the plot's
// verdict follows from the other bars (`compare.mjs`, `behindBars`; the counterfactual compare gets the same
// mask). ⛔ Only the newest bar, only when it is forming, only when the supply's newest held row is STRICTLY
// before the session the capture read, and only for a symbol whose witness row is aligned by exchange
// session (`SUPPLY_BEHIND_ALIGNMENTS`: a row per NYSE session; a sparse series such as the RS seed,
// `same-date-gaps-na`, is stale by design and never qualifies). The session is derived from the capture's own
// `capturedAtUTC` and the NYSE calendar (`lib/marketClock/sessionCalendar.js`), never guessed.
// ⚰️ MEASURED (2026-11-18): rs-rating-fred6724-w-{rddt,nvda}-1w-2026-11-17 were captured 2026-11-17T21:16Z
// beside an SPX supply recorded 2026-11-16T23:13Z (newest row 2026-11-16). TradingView's forming week read
// the 2026-11-17 close (7340.53); ours read the previous week's 7561.67 (37.8408 / 36.7341 = 7561.67 / 7340.53).

/** Witness-row alignments that hold a row per exchange session (see the header). */
export const SUPPLY_BEHIND_ALIGNMENTS = new Set(['previous-session'])

const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })

/** The NYSE session a capture taken at `capturedAtUTC` read as its newest, 'YYYY-MM-DD', or null: that ET day
 *  when it is a trading day whose regular session had opened (in session, after the close, or later that
 *  evening), else the trading day before it. */
export function sessionReadAt(capturedAtUTC) {
  const ms = Date.parse(String(capturedAtUTC || ''))
  if (!Number.isFinite(ms)) return null
  const day = ET_DAY.format(new Date(ms))
  if (isTradingDay(day)) {
    const s = sessionAt(ms)
    const close = closeTime(day)
    if (s === 'rth' || s === 'post' || (close && ms >= close.getTime())) return day
  }
  let t = Date.parse(`${day}T12:00:00Z`)
  for (let k = 0; k < 15; k += 1) {
    t -= 86400000
    const d = new Date(t).toISOString().slice(0, 10)
    if (isTradingDay(d)) return d
  }
  return null
}

/** The pure rule: a supply-behind record, or null (see the header). */
export function supplyBehindRecord({ capturedAtUTC, newestBarIsForming, symbol, alignment, newestRowDay, recordedAtUTC = null }) {
  if (newestBarIsForming !== true || !SUPPLY_BEHIND_ALIGNMENTS.has(alignment)) return null
  const session = sessionReadAt(capturedAtUTC)
  if (!session || typeof newestRowDay !== 'string' || !(newestRowDay < session)) return null
  return {
    symbol, recordedAtUTC, newestRow: newestRowDay, session, capturedAtUTC,
    sentence: `the ${symbol} supply recorded beside this capture (recorded ${recordedAtUTC || 'at an unstated time'}, `
      + `newest row ${newestRowDay}) predates session ${session}, which this capture's forming newest bar read `
      + `(captured ${capturedAtUTC}): our side cannot answer that bar from it`,
  }
}

/** SUPPLY BEHIND THE CAPTURE for one capture: the record of the first recorded supply symbol it applies to, or null. */
export function supplyBehindOf(capture) {
  if (!capture || capture.newestBarIsForming !== true) return null
  let rec
  try { rec = recordedSupplyOf(capture) } catch { return null }
  if (!rec || !rec.other) return null
  for (const [store, e] of Object.entries(rec.other)) {
    if (!e || !Array.isArray(e.bars) || !e.bars.length) continue
    const row = witnessRowFor(store)
    if (!row) continue
    const r = supplyBehindRecord({ capturedAtUTC: capture.capturedAtUTC, newestBarIsForming: capture.newestBarIsForming,
      symbol: store, alignment: row.alignment, newestRowDay: isoDay(e.bars[e.bars.length - 1].t), recordedAtUTC: e.recordedAtUTC || null })
    if (r) return r
  }
  return null
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
