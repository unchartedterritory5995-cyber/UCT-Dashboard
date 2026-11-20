// app/src/components/chart/engine/__tests__/vendorHarness/ourSide.js
//
// ─── OUR SIDE: the member door, run on the VENDOR'S bars ──────────────────────
//
// ⛔⛔ THIS IS NOT AN EVALUATOR. It calls, in order, exactly what a member's
// paste reaches:
//
//   memberPaneDefinition({source, id})   — MemberPane.jsx's own call
//   installUserDefinitions([definition]) — the install door (it re-validates and
//                                          can refuse what the builder accepted)
//   computeFor(def, bars, inputs, ctx)   — what `binder.sync` calls per instance
//   createBinder(...).sync(...)          — the real binder over the repo's own
//                                          recording chart double, so a colour
//                                          is read off the POINTS the renderer
//                                          was handed, not re-derived here
//   objectReaderFor → evaluateObjects → toRenderState
//                                        — the object lane, counting what the
//                                          render state KEEPS
//
// A harness that evaluated differently from the product would measure itself.
// Nothing here computes a value; it only moves the vendor's bars into the shape
// the product's bars have and reads back what the product produced.
//
// ⚠️ It lives under `__tests__/` on purpose: it is test infrastructure (the
// reachability rail's TEST_INFRA rule), invoked by the harness tests and the
// vitest CLI entry, and must never be imported by a member surface.

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'
import { createBinder, drawShiftOf, paintColoursFor, plotStripNoticesOf } from '../../binder'
import { bindWithheldPaintsOf } from './paintColours'
import { bindingKey } from '../../pool'
import { addInstance } from '../../instanceControls'
import { mergeChartSettings } from '../../../chartDefaults'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { NOT_SHOWN, runtimeWithheldWhy, runtimeWithheldCause, runtimeUnknownSentence } from '../../ast/objectLoss'
import { toRenderState } from '../../objectRenderState'
// ⭐ RT5 — a runtime document's own drawings.
import { runtimeObjectsOf, runtimeObjectsWithheldOf, drawsRunObjectsOn, runtimeWarmupOf, RUNTIME_WARMUP_KEY, runHalfOf, carriesRunHalf } from '../../runtime/runtimeObjects'
import { runtimeDeclinedTag } from '../../../../../../../tools/pine_coverage/runtime_lane.mjs'
import { maxLookback, CHART_CLOCK_WHOLE, TF_MERGE_NEWEST_CODE, TF_MERGE_FIRST_CODE, interpret as interpretTree } from '../../ast/interpret'
import { setRuntimeDoorClock, RUNTIME_REQUEST_WITHHELD_KEY } from '../../runtime/runtimeColumns'
import { paneObjectsGate } from '../../ast/paneGate'
import { otherSymbolRequestsOf, storeTickerOf, witnessRowOf, heldFetchOf, heldFetchesOf, OWN_DAILY_KEY } from '../../otherSymbols'
import { lowerTfCodesOf, LOWER_TF_SOURCE } from '../../lowerTf'
import { storeExchangeOfCapture } from './storeExchange.js'
import { createFakeChart } from '../fakeChart'
import { isThemeColour } from '../../objectTheme'
import { normalizeColor, COLOUR_WITHHELD_POINT, substitutionProblems, vendorValueOf } from '../../../../../../../tools/vendor_harness/compare.mjs'
// ⭐ RS RATING L3 — which classification fields a script reads, and the binding's substitution tags.
import { substitutedFor } from '../../ast/symbolSubstitution'
import { CLASSIFICATION_FIELD_NAMES } from '../../ast/bind'
import { validateCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { startsAtBar0Holds, startsAtBar0Refuted, BAR_INDEX_CONTROL } from '../../../../../../../tools/vendor_harness/history_claim.mjs'
import { fullBarsFor } from '../../../../../utils/barsBackfill'
// ⭐ SETTINGS PARITY (2c): a capture is graded at the settings TradingView recorded in it
import { captureInstanceInputs } from './captureInputs.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { instanceDocumentForFetch } from '../../symbolInputs.js'
// ⭐⭐ THE STRATEGY ON THE RUNTIME LANE (2026-11-17, strategy-decl admission evidence): a broker document the
// member door minted (`strategyWindow.js`, possible only with the strategy broker gate on) is handed the
// server's history window exactly as the binder hands it (`binder.js`, W9-T11-F1), and its run's record is
// read back off the columns (`strategyRecord.js::runtimeStrategyOf`), never re-run here.
import { isStrategyWindowDefinition } from '../../strategyWindow'
import { runtimeStrategyOf } from '../../runtime/strategyRecord.js'
import { historyWindowBarsOf } from '../../runtime/__tests__/strategyArmed.js'

// ─── ⭐⭐ C26 — ANOTHER SYMBOL'S BARS, FROM COMMITTED CAPTURES ONLY ─────────────
//
// A script that reads another symbol needs that symbol's bars on OUR side, and
// the only honest source is a capture TradingView gave us: the vendor's own bars,
// receipt-verified, of that listing at the chart's timeframe. The chart supplies
// the same thing from `/api/bars` (`useSecondarySources`); the harness supplies it
// from `tests/fixtures/vendor/harness/`. ⛔ Nothing is synthesised: a symbol with
// no committed capture is supplied NOTHING, and the note names the capture that
// is missing.

const OTHER_CAPTURE_DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
let otherIndex = null
// ⭐⭐ C41 — THE CHART SYMBOL'S OWN INTRADAY BARS, FROM COMMITTED CAPTURES ONLY: the
// supply an `ltf` read (`request.security(syminfo.tickerid, "60", …)` on a daily
// chart) needs. `TICKER|minutes` → the union of every capture of that listing at
// that intraday timeframe, REGULAR session (`symbol.session` `0930-1600`) kept
// apart from every other: a 60-minute bar of an extended-hours chart opens on the
// clock hour, off the 09:30 grid, and mixing the two would mark its days
// incomplete. Filled in the same pass as `otherIndex`.
let intradayIndex = null
const REGULAR_SESSION = '0930-1600'

/** `TICKER|tf` → `{bars, exchange, file, last}` over the committed native
 *  captures (receipt-verified). Where two captures hold one listing at one
 *  timeframe, the one reaching the later bar wins (then the deeper one). */
function otherCaptureIndex() {
  if (otherIndex) return otherIndex
  otherIndex = new Map()
  intradayIndex = new Map()
  if (!fs.existsSync(OTHER_CAPTURE_DIR)) return otherIndex
  for (const name of fs.readdirSync(OTHER_CAPTURE_DIR).sort()) {
    if (!name.endsWith('.json')) continue
    let cap
    try { cap = JSON.parse(fs.readFileSync(path.join(OTHER_CAPTURE_DIR, name), 'utf8')) } catch { continue }
    if (!cap || cap.schema !== 'uct.vendor-capture/v1' || !cap.bars || !Array.isArray(cap.bars.rows)) continue
    if (!validateCapture(cap).ok) continue
    const { ticker, exchange } = symbolOf(cap)
    if (!ticker) continue
    const key = `${String(ticker).toUpperCase()}|${tfCodeOf(cap.timeframe)}`
    const bars = toProductBars(cap)
    const last = bars.length ? String(bars[bars.length - 1].t) : ''
    if (/^[0-9]+$/.test(tfCodeOf(cap.timeframe))) {
      const session = cap.symbol && cap.symbol.session === REGULAR_SESSION ? 'regular' : 'other'
      if (!intradayIndex.has(key)) intradayIndex.set(key, { regular: null, other: null })
      const slot = intradayIndex.get(key)
      if (!slot[session]) slot[session] = { byT: new Map(), files: [] }
      // a bar two captures share keeps the one from the capture reaching later
      for (const b of bars) {
        const had = slot[session].byT.get(b.t)
        if (!had || had.last < last) slot[session].byT.set(b.t, { b, last })
      }
      slot[session].files.push(name)
    }
    // ⭐ C29 — the UNION of every capture of one listing at one timeframe, keyed by
    // the bar's own date: each is TradingView's own bars of the same series, so a
    // short recent capture (the 2026-09-30 SPY probes, 300 bars) EXTENDS a deeper
    // older one instead of replacing it (which left C26's 632 RDDT dates short —
    // red at base `bcac5dd34`). A date two captures share keeps the capture
    // reaching the later bar (its newest bar may have closed since).
    const held = otherIndex.get(key)
    if (!held) {
      otherIndex.set(key, { byT: new Map(bars.map((b) => [String(b.t), { b, last }])),
        exchange: storeExchangeOfCapture(cap, exchange), files: [name], last })
      continue
    }
    for (const b of bars) {
      const k = String(b.t)
      const had = held.byT.get(k)
      if (!had || had.last < last) held.byT.set(k, { b, last })
    }
    held.files.push(name)
    if (last > held.last) held.last = last
  }
  for (const entry of otherIndex.values()) {
    entry.bars = [...entry.byT.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v.b)
    entry.file = entry.files.join(', ')
  }
  return otherIndex
}

// OUR STORE's exchange spelling for a captured listing: `storeExchange.js` (one authority, shared with the
// strategy harness since 2026-11-16).

/** ⭐⭐ C41 — the lower-timeframe supply a capture's script asks for
 *  (`ctx.lowerTf`), and the notes naming what was and was not supplied. Per code:
 *  the committed captures of the CHART'S OWN listing at the store timeframe that
 *  code is built from (`LOWER_TF_SOURCE`), else at the deepest other timeframe
 *  the code's buckets can be built from. ⛔ Nothing is synthesised: a code with no
 *  such capture is supplied nothing, its reads are UNKNOWN, and the note names
 *  the capture that is missing. */
function lowerTfSupply(def, capture) {
  const codes = lowerTfCodesOf(def)
  if (!codes.length) return { lowerTf: null, notes: [] }
  otherCaptureIndex()
  const { ticker } = symbolOf(capture)
  const held = new Map() // minutes → {bars, files}
  for (const [key, slot] of intradayIndex) {
    const [t, tf] = key.split('|')
    if (t !== String(ticker).toUpperCase()) continue
    const pick = slot.regular || slot.other
    if (!pick.bars) {
      pick.bars = [...pick.byT.entries()].sort(([a], [b]) => a - b).map(([, v]) => v.b)
    }
    held.set(tf, pick)
  }
  const lowerTf = new Map()
  const notes = []
  for (const code of codes) {
    const want = LOWER_TF_SOURCE[code]
    const fits = [...held.keys()].filter((tf) => Number(code) % Number(tf) === 0)
    // ⭐ C49 (wave-11 merge) — THE SUPPLY REACHING FURTHEST BACK, the store's own
    // source timeframe winning a tie. This read `fits.includes(want) ? want : <the
    // longest other>`. Capture round 3 (2026-10-01) then committed a 15-minute
    // capture of SPY — 3,300 bars, 127 sessions — and `want` for 60 / 240 is 15, so
    // the eleven-year 60-minute capture C41's rows are graded on was displaced by
    // it: 2,950 graded sessions → 125. A shallower capture must not shadow a deeper
    // one; where the store's source timeframe reaches as far back as any other (RDDT:
    // 15-minute bars from the listing) it is still the one used, as the product builds it.
    // compared by the first bar's DAY: two captures that both start on the listing
    // day tie, whatever minute their first bucket opens
    const firstT = (tf) => { const b = held.get(tf).bars; return b.length ? Math.floor(Number(b[0].t) / 86400) : Infinity }
    const tf = fits.slice().sort((a, b) => (firstT(a) - firstT(b)) || ((b === want) - (a === want))
      || (held.get(b).bars.length - held.get(a).bars.length))[0]
    if (!tf) {
      notes.push(`lower timeframe ${code}: no committed capture of ${ticker} at ${want} minutes `
        + '(regular session) — the vendor bars this read would need')
      continue
    }
    // ⭐⭐ F7 (step 93) — NO INTRABAR FROM AFTER THE CAPTURE'S OWN CLOCK. The supply is
    // every committed capture of the listing, and a LATER capture holds bars this one
    // could not have seen: CAP round 4's `vw-request-htf-alignment-spy-60-2026-10-02`
    // (bars to 2026-10-02 19:30Z) fed 2026-10-01 / 10-02 60m closes into the 1W capture
    // taken 2026-10-01T03:10Z, so its forming week read 769.65 where TradingView, at
    // that moment, read 762.46. What the chart saw then is the bars that had OPENED.
    const clock = Date.parse((capture && capture.capturedAtUTC) || '')
    const cut = Number.isFinite(clock) ? clock / 1000 : Infinity
    const all = held.get(tf).bars
    const seen = cut === Infinity ? all : all.filter((x) => Number(x.t) < cut)
    lowerTf.set(`code:${code}`, { bars: seen, status: 'available', sourceCode: tf })
    notes.push(`lower timeframe ${code}: built from the committed ${tf}-minute capture(s) ${held.get(tf).files.join(', ')}`)
  }
  return { lowerTf, notes }
}

// ─── ⭐⭐ RS RATING L8 — THE BARS OUR SERVER SERVES, RECORDED BESIDE A CAPTURE ────────
//
// C26 supplies another symbol from committed CAPTURES: TradingView's own bars of that listing.
// For a symbol TradingView's own bars must NOT feed (an index such as `SP:SPX`, where grading
// on the vendor's values would be circular, and a Pine seed, which no capture holds as bars),
// the honest supply is what OUR SERVER serves, recorded: `tests/fixtures/vendor-supply/<capture
// id>.json` (`uct.harness-supply/v1`). Each `other.<STORE TICKER>` is either
//   * `{servedBy, source, recordedAtUTC, bars}`: the served bars, in the shape the server
//     serves them, with where they came from (a fallback says so in `source`); or
//   * `{notRecorded}`: the source a member is served was not recorded, so NOTHING is supplied
//     (the read refuses by name, the grade is INCONCLUSIVE), never a stand-in; or
//     ⚠️ Inline PROVIDER bars (FMP, Yahoo) are committed only under an owner ruling the entry
//     quotes in `licence` (the RS Rating records: 2026-11-15, "That's fine, I accept it all",
//     covering those records only; railed in vendorHarness.l9LocalSupply.test.js); or
//   * (RS RATING L9) `{servedBy, source, recordedAtUTC, rows: {file, sha256, count, first, last}}`:
//     for provider data NO ruling covers (the repo is public; FMP is class R/LA for member display
//     and Yahoo class X, `provider_licensing_class.py`), git holds only this manifest and the rows
//     live OUT of git, in the local supply store
//     (`$UCT_HARNESS_SUPPLY_STORE`, default `%LOCALAPPDATA%/uct-vendor-batch/supply`), the way a
//     licence-held capture lives in the capture store. The file is read only when its sha256, row
//     count and first / last session are the manifest's (else the record throws); a machine
//     without it supplies NOTHING and the grade is refused by name (INCONCLUSIVE), never run on a
//     stand-in.
// and `symbol.<field>` feeds a classification field the capture does not carry with the
// VENDOR's value read off a committed capture (`vendorValueFrom: 'committed:<path>'`), checked
// here against that capture's own text before it is fed.
// and (RS RATING L9) `store.securityType` feeds OUR STORE's instrument class for the chart symbol
// (`{value: 'Stock'|'ADR'|'ETF', source}`), the field a member's chart threads from
// `ticker_meta.security_type` (`StockChart.jsx`). It is ours, never the vendor's (a capture carries
// TradingView's `type`, which is not our class), so it names where it was read, and a record that
// states none feeds none: the bind then keys no class row, exactly as before.
// ⛔ A record that names another capture, or a malformed one, throws: it is never half-read.
const SUPPLY_DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor-supply')
let _supplyDir = SUPPLY_DIR
/** Rails only: read recorded supply from a scratch directory (null restores the committed one). */
export function __setSupplyDirForTests(dir) { _supplyDir = dir || SUPPLY_DIR }
export const HARNESS_SUPPLY_SCHEMA = 'uct.harness-supply/v1'
/** The out-of-git rows file a manifest names (`uct.harness-supply-rows/v1`: `{ticker, source,
 *  servedBy, recordedAtUTC, bars}`). */
export const HARNESS_SUPPLY_ROWS_SCHEMA = 'uct.harness-supply-rows/v1'
export const SUPPLY_STORE_ENV = 'UCT_HARNESS_SUPPLY_STORE'
let _supplyStoreForTests = null
/** Rails only: read out-of-git rows from a scratch store (null restores the configured one). */
export function __setSupplyStoreForTests(dir) { _supplyStoreForTests = dir || null }
/** The local supply store, read per call. */
export function supplyStoreDir() {
  if (_supplyStoreForTests) return _supplyStoreForTests
  if (process.env[SUPPLY_STORE_ENV]) return path.resolve(process.env[SUPPLY_STORE_ENV])
  const base = process.env.LOCALAPPDATA || process.env.TEMP || os.tmpdir()
  return path.join(base, 'uct-vendor-batch', 'supply')
}
/** Our store's instrument classes (`screener_universe.COARSE_TYPES`, keyed by `bind.js`'s
 *  `by_class` rows). */
export const STORE_SECURITY_TYPES = Object.freeze(['Stock', 'ADR', 'ETF'])

/** The Q-RS4 probe's label keys (`IND=<industry>|SEC=<sector>|TYPE=<type>`). */
const CLASSIFICATION_PROBE_KEY = Object.freeze({ industry: 'IND', sector: 'SEC' })

// ⭐⭐ SUPPLY-HELD RECORDS (coordinator ruling 2026-11-19, Q-FRED-NHDOT): a supply record that may NOT enter the public
// repository (a vendor's or a store's bars the owner has not cleared) lives in the HELD directory, never in
// tests/fixtures/vendor-supply. It is read after the committed directory (a committed record always wins), and a row
// graded with one records it (`supplyHeld`, `./storeHeld.js`; the Python rule is `tools/vendor_harness/store_held.py`),
// so a run without the directory (CI) names that row "supply-held" instead of losing it.
export const SUPPLY_HELD_ENV = 'UCT_HARNESS_SUPPLY_HELD'
let _supplyHeldDirForTests = null
/** Rails only: read held records from a scratch directory (null restores the configured one). */
export function __setSupplyHeldDirForTests(dir) { _supplyHeldDirForTests = dir || null }
/** The held supply directory, read per call (never the committed one). */
export function supplyHeldDir() {
  if (_supplyHeldDirForTests) return _supplyHeldDirForTests
  if (process.env[SUPPLY_HELD_ENV]) return path.resolve(process.env[SUPPLY_HELD_ENV])
  const base = process.env.LOCALAPPDATA || process.env.TEMP || os.tmpdir()
  return path.join(base, 'uct-vendor-batch', 'supply-held')
}
/** Where this capture's recorded supply is read from: the committed file, else the held one, else null. */
export function recordedSupplyFileOf(id, dir = _supplyDir) {
  if (typeof id !== 'string' || !id) return null
  const committed = path.join(dir, `${id}.json`)
  if (fs.existsSync(committed)) return { file: committed, held: false }
  if (dir !== _supplyDir) return null          // a rail's scratch directory stands alone
  const held = path.join(supplyHeldDir(), `${id}.json`)
  return fs.existsSync(held) ? { file: held, held: true } : null
}

/** The recorded supply beside this capture (committed, or held: `recordedSupplyFileOf`), or null when there is none. */
export function recordedSupplyOf(capture, dir = _supplyDir) {
  const id = capture && capture.id
  if (typeof id !== 'string' || !id) return null
  const at = recordedSupplyFileOf(id, dir)
  if (!at) return null
  const file = at.file
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'))
  const bad = (why) => { throw new Error(`ourSide: recorded supply ${path.basename(file)} refused: ${why}`) }
  if (!rec || rec.schema !== HARNESS_SUPPLY_SCHEMA) bad(`schema is not ${HARNESS_SUPPLY_SCHEMA}`)
  if (rec.capture !== id) bad(`it is the record of ${JSON.stringify(rec.capture)}, not of ${id}`)
  for (const [ticker, e] of Object.entries(rec.other || {})) {
    if (!e || typeof e !== 'object') bad(`other.${ticker} is not an object`)
    const forms = [Array.isArray(e.bars), !!(e.rows && typeof e.rows === 'object'),
      typeof e.notRecorded === 'string' && e.notRecorded.length > 0]
    if (forms.filter(Boolean).length !== 1) {
      bad(`other.${ticker} must hold exactly one of \`bars\`, \`rows\` or \`notRecorded\``)
    }
    if (!forms[2] && !(typeof e.source === 'string' && e.source && typeof e.servedBy === 'string' && e.servedBy)) {
      bad(`other.${ticker} records bars without naming \`source\` and \`servedBy\``)
    }
    // ⭐ RS RATING L11 PR 2 — the server's `newest_bar_is_forming` for this series, as the bars route
    // answered beside the capture (the chart's cache entry carries it, `secondaryBars._read`): it decides
    // what the chart's newest bar reads (`otherSymbols.newestOwnPeriodOf`). Optional; when present it is
    // the route's tri-state exactly, and a record without it supplies an entry without it, as before.
    if (Object.prototype.hasOwnProperty.call(e, 'newestBarIsForming')
        && ![true, false, null].includes(e.newestBarIsForming)) {
      bad(`other.${ticker}.newestBarIsForming must be the route's tri-state (true, false or null), not ${JSON.stringify(e.newestBarIsForming)}`)
    }
    if (forms[1]) e.bars = outOfGitRows(ticker, e, bad)            // [] -> e.notOnThisMachine
  }
  for (const [field, e] of Object.entries(rec.symbol || {})) {
    if (!CLASSIFICATION_PROBE_KEY[field]) bad(`symbol.${field} is not a classification field`)
    if (!e || typeof e.value !== 'string' || !e.value) bad(`symbol.${field} carries no value`)
    const from = String(e.vendorValueFrom || '')
    if (!from.startsWith('committed:')) bad(`symbol.${field} must cite a committed capture (\`committed:<path>\`)`)
    const probe = path.resolve(process.cwd(), '..', from.slice('committed:'.length))
    if (!fs.existsSync(probe)) bad(`symbol.${field} cites ${from}, which is not committed`)
    const texts = ((JSON.parse(fs.readFileSync(probe, 'utf8')).objects || {}).texts || {}).labels || []
    const key = CLASSIFICATION_PROBE_KEY[field]
    const said = texts.map((t) => String(t).split('|').find((part) => part.startsWith(`${key}=`)))
      .filter(Boolean).map((part) => part.slice(key.length + 1))
    if (!said.includes(e.value)) {
      bad(`symbol.${field} = ${JSON.stringify(e.value)} is not what ${from} printed (${JSON.stringify(said)})`)
    }
  }
  for (const [field, e] of Object.entries(rec.store || {})) {
    if (field !== 'securityType') bad(`store.${field} is not a store field the bind reads`)
    if (!e || !STORE_SECURITY_TYPES.includes(e.value)) {
      bad(`store.securityType must be one of ${STORE_SECURITY_TYPES.join(' / ')} (our store's class), not ${JSON.stringify(e && e.value)}`)
    }
    if (!(typeof e.source === 'string' && e.source)) bad('store.securityType does not say where our store\'s class was read (`source`)')
    if (Object.prototype.hasOwnProperty.call(e, 'vendorValueFrom')) {
      bad('store.securityType is our store\'s class, never a vendor value (`vendorValueFrom`)')
    }
  }
  return rec
}

/** ⭐ RS RATING L9 — the bars an out-of-git manifest names, read from the local supply store and
 *  checked against the manifest; `undefined` (with `e.notOnThisMachine` set) when the file is not
 *  on this machine. A file that IS here but is not the manifest's throws (`bad`). */
function outOfGitRows(ticker, e, bad) {
  const m = e.rows
  const name = typeof m.file === 'string' ? m.file : ''
  if (!name || name !== path.basename(name)) bad(`other.${ticker}.rows.file must be a bare file name in the supply store`)
  if (!/^[0-9a-f]{64}$/.test(String(m.sha256 || ''))) bad(`other.${ticker}.rows names no sha256`)
  if (!Number.isInteger(m.count) || m.count < 1) bad(`other.${ticker}.rows names no row count`)
  const file = path.join(supplyStoreDir(), name)
  if (!fs.existsSync(file)) {
    e.notOnThisMachine = `the served bars (${e.source}) are kept out of git (provider data; the repo `
      + `is public) and ${name} is not in the local supply store (${supplyStoreDir()}, \`${SUPPLY_STORE_ENV}\`)`
    return undefined
  }
  const raw = fs.readFileSync(file)
  const sha = crypto.createHash('sha256').update(raw).digest('hex')
  if (sha !== m.sha256) bad(`other.${ticker}.rows: ${name} is not the recorded file (sha256 ${sha.slice(0, 12)}, the manifest says ${m.sha256.slice(0, 12)})`)
  const doc = JSON.parse(raw.toString('utf8'))
  if (!doc || doc.schema !== HARNESS_SUPPLY_ROWS_SCHEMA || !Array.isArray(doc.bars)) bad(`other.${ticker}.rows: ${name} is not a ${HARNESS_SUPPLY_ROWS_SCHEMA} file`)
  if (doc.ticker !== ticker) bad(`other.${ticker}.rows: ${name} holds ${JSON.stringify(doc.ticker)}`)
  // ⭐ A daily row's `t` is the store's session DATE (`'2026-11-16'`, the OWN~D rows and the seed's); an intraday
  // or index row's is unix seconds. ⚰️ `new Date('2026-11-16' * 1000)` is an Invalid Date, and toISOString threw a
  // RangeError that failed the whole corpus file (l12-now-2026-11-18 regrade, 2026-11-19).
  const day = (b) => (typeof b.t === 'number' ? new Date(b.t * 1000).toISOString().slice(0, 10) : String(b.t).slice(0, 10))
  if (doc.bars.length !== m.count || day(doc.bars[0]) !== m.first || day(doc.bars[doc.bars.length - 1]) !== m.last) {
    bad(`other.${ticker}.rows: ${name} holds ${doc.bars.length} sessions ${day(doc.bars[0])}..${day(doc.bars[doc.bars.length - 1])}, the manifest ${m.count} ${m.first}..${m.last}`)
  }
  return doc.bars
}

/** ⭐ RS RATING L9 — our store's class for the chart symbol, from the recorded supply, or {}. */
function recordedStoreOf(capture) {
  const rec = recordedSupplyOf(capture)
  const e = rec && rec.store && rec.store.securityType
  return e ? { securityType: e.value } : {}
}

/** The classification fields the recorded supply feeds, and the committed capture each cites. */
function recordedClassificationOf(capture) {
  const rec = recordedSupplyOf(capture)
  const fields = {}
  const from = {}
  for (const [field, e] of Object.entries((rec && rec.symbol) || {})) { fields[field] = e.value; from[field] = e.vendorValueFrom }
  return { fields, from }
}

/** The secondary supply a capture's script asks for, and the notes naming what
 *  could not be supplied. (Exported for RS RATING L11's rail, which grades a probe's daily reads
 *  below a weekly chart on the runtime lane with this same supply.) */
export function otherSymbolSupply(def, capture) {
  const requests = otherSymbolRequestsOf(def)
  if (!requests.length) return { secondary: null, exchangeOf: null, notes: [] }
  const tf = tfCodeOf(capture.timeframe)
  const index = otherCaptureIndex()
  const secondary = new Map()
  const notes = []
  // ⭐ RS RATING L8 — a recorded server supply beside this capture answers first, for the
  // symbols it names (`recordedSupplyOf`); every other symbol keeps C26's committed captures.
  const recorded = recordedSupplyOf(capture)
  const unrecorded = []
  for (const { ticker, spellings } of requests) {
    // the key the chart fetches it under: a witnessed spelling's row's store key (`SPX`,
    // `SEED_FRED6725_RS_RATING:RSRATING`), else our store's ticker (`fetchableOtherSymbols`)
    const row = (spellings || []).map((v) => witnessRowOf(v, ticker)).find(Boolean)
    const storeKey = row ? row.store : storeTickerOf(ticker)
    // ⭐ RS RATING L11 — a spelling this capture's timeframe HOLDS at another one (SP:SPX and the seed on
    // a weekly chart: their DAILY rows, `heldFetchOf`) is filed under the key the chart files it under
    // (`SPX@D`); the record keeps it under its store key, as the server serves it
    const held = row ? heldFetchOf(storeKey, tf) : null
    const cacheKey = held ? held.key : storeKey
    const rec = recorded && recorded.other ? recorded.other[storeKey] : null
    if (rec) {
      if (Array.isArray(rec.bars)) {
        // SUPPLY-ATTRIBUTED (2026-11-17): the counterfactual run (`runOurSideWithSupply`) replaces these
        // bars for ONE run; every graded run reads the recorded supply as served
        const over = _supplyOverride && Array.isArray(_supplyOverride[storeKey]) ? _supplyOverride[storeKey] : null
        const flagged = Object.prototype.hasOwnProperty.call(rec, 'newestBarIsForming')
        secondary.set(cacheKey, { bars: over || rec.bars, status: 'available',
          ...(flagged ? { newestBarIsForming: rec.newestBarIsForming } : {}) })
        notes.push(`other symbol ${ticker}: the bars our server serves, recorded beside the capture `
          + `(${rec.servedBy}; ${rec.source})`
          + (flagged ? `; newest bar forming: ${rec.newestBarIsForming}` : '')
          + (held ? `; held at ${held.tf} on this ${tf} chart` : '')
          + (rec.rows ? `; kept out of git, read from the local supply store as ${rec.rows.file} (sha256 ${rec.rows.sha256.slice(0, 12)})` : ''))
        // ⭐ RS RATING L12 — a block held at a SECOND timeframe too (an intraday chart holds SP:SPX's daily rows
        // beside its intraday bars, `heldFetchesOf`): the record keeps them under that key (`SPX@D`), as the chart
        // files them
        for (const h of row ? heldFetchesOf(storeKey, tf).slice(1) : []) {
          const second = recorded.other[h.key]
          if (second && Array.isArray(second.bars)) {
            const f2 = Object.prototype.hasOwnProperty.call(second, 'newestBarIsForming')
            secondary.set(h.key, { bars: second.bars, status: 'available', ...(f2 ? { newestBarIsForming: second.newestBarIsForming } : {}) })
            notes.push(`other symbol ${ticker}: its ${h.tf} rows our server serves, recorded beside the capture (${second.servedBy}; ${second.source})`)
          } else {
            secondary.set(h.key, { bars: [], status: 'no_data' })
            unrecorded.push(`other symbol ${ticker}: its ${h.tf} rows (${h.key}) were not recorded beside this capture`)
          }
        }
      } else if (rec.notOnThisMachine) {
        secondary.set(cacheKey, { bars: [], status: 'no_data' })
        notes.push(`other symbol ${ticker}: not supplied: ${rec.notOnThisMachine}`)
        unrecorded.push(`other symbol ${ticker}: ${rec.notOnThisMachine}`)
      } else {
        secondary.set(cacheKey, { bars: [], status: 'no_data' })
        notes.push(`other symbol ${ticker}: not supplied: ${rec.notRecorded}`)
        unrecorded.push(`other symbol ${ticker}: ${rec.notRecorded}`)
      }
      continue
    }
    const hit = index.get(`${ticker}|${tf}`)
    if (hit) {
      // ⭐ C29 — keyed as the product keys it: our store's ticker (`BRK-B`).
      secondary.set(storeTickerOf(ticker), { bars: hit.bars, status: 'available', exchange: hit.exchange })
      for (const f of hit.files) notes.push(`other symbol ${ticker}: bars from the committed capture ${f}`)
    } else {
      secondary.set(storeTickerOf(ticker), { bars: [], status: 'no_data' })
      notes.push(`other symbol ${ticker}: no committed capture of ${ticker} at ${capture.timeframe} — `
        + 'the vendor bars (and listing) this read would need')
    }
  }
  // ⭐ RS RATING L12 PR 2 (U-DAILY) — this chart symbol's own daily rows, for a run that reads them above an intraday
  // chart (`OWN_DAILY_KEY`), when the record carries them (the chart fetches them only then: `ownDailyNeeded`)
  const ownRec = recorded && recorded.other ? recorded.other[OWN_DAILY_KEY] : null
  if (ownRec && Array.isArray(ownRec.bars)) {
    const f3 = Object.prototype.hasOwnProperty.call(ownRec, 'newestBarIsForming')
    secondary.set(OWN_DAILY_KEY, { bars: ownRec.bars, status: 'available', ...(f3 ? { newestBarIsForming: ownRec.newestBarIsForming } : {}) })
    notes.push(`this chart symbol's own daily rows our server serves, recorded beside the capture (${ownRec.servedBy}; ${ownRec.source})`)
  }
  const exchangeOf = (t) => {
    const e = secondary.get(t)
    return e && e.exchange ? e.exchange : null
  }
  return { secondary, exchangeOf, notes, unrecorded }
}

// ─── ⭐⭐ RC1 — WARM BARS: THE SAME SERIES' OWN HISTORY, FROM COMMITTED CAPTURES ─
//
// A capture that does NOT start at the listing (`history.startsAtBar0 !== true`)
// was computed by TradingView with history BEFORE its first bar: its study engine
// holds more bars than it ships to the chart, so `window.studyBarsLoaded` is the
// output buffer, not the computation depth. Measured 2026-10-04 (lane RC1) on SPY
// 1D, window 2019-08-06..2026-10-02: TradingView's `ema(close, 35)`-based plots are
// numeric ON BAR 0, which no cold start can produce; a cold replay of the 1800
// window bars disagreed on 109 bars across six scripts' paints, and the same
// window with SPY's 1993+ history in front of it agreed on every one.
//
// The member's chart is warm the same way (a standalone D chart loads 12,500 bars
// and `binder.sync` computes over all of them), so replaying [prehistory + window]
// is what the product does, not a tolerance.
//
// ⛔⛔ NOTHING IS SPLICED THAT IS NOT PROVED. A supplier is another committed
// capture of the SAME listing at the SAME timeframe that holds bars before the
// window AND holds the window's first bar. Every window bar inside the supplier's
// span must be in it, equal on time, open, high, low, close AND volume. One field
// off on one bar and that supplier is REFUSED BY NAME (the note says which file,
// which bar, which field); the next supplier is tried, and with none left the
// replay is cold and says so. The deepest proved supplier wins.
// ⛔ A capture whose own `bar_index` control reads 0 on its first bar is never
// warmed: TradingView itself started counting there, so its history did too.
// ⭐ THE LISTING FLAG IS INHERITED FROM THE SUPPLIER, NEVER ASSUMED (lane B1P,
// 2026-10-04, atr-trailing-stop-by-ceyhun-spy): the replay over [prehistory +
// window] carries `historyFromListing` exactly when the SUPPLIER asserts
// `startsAtBar0` (its first bar is the listing, so the replayed series is too, as
// on a member's standalone D chart). A supplier that does not start at the listing
// keeps it off. ⛔ It is NEVER forced on for the short capture itself: that seeds a
// listing-only pass at a bar that is not the listing (B1P probe C: 23 WRONG colours).
const OHLCV_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume']

// ⭐ RC1 — `TICKER|tf` → what each committed capture spans (metadata only, so the index
// costs one parse of the directory and holds no bars). A candidate's own rows are read
// back, and its receipt validated, only once it is actually considered.
// ⛔ Deliberately NOT `otherCaptureIndex`: that validates every capture's receipt up
// front (measured ~57 s for the directory), which every paint capture would then pay.
const warmCandidateIndexes = new Map() // `${dir}|${useIndex}` → Map(key → metas)
const warmCandidateRows = new Map()

// ⭐ The metadata of every capture, cached on disk so a fresh worker does not parse the whole
// directory (610 files / 420 MB took 5.4 s per worker on 2026-11-15, and that cost grows with
// every capture). One row per file: what `warmBarsSupply` reads, plus the file's size and
// mtimeMs. A row is trusted ONLY when both still match the file; any other row (missing,
// malformed, stale, or an unreadable index) is rebuilt from the file itself, so the index can
// never pick a supplier the full scan would not. Gitignored; rewritten atomically when it changes.
export const WARM_INDEX_NAME = '.warm-candidates.index'
// ⛔ v3 (2026-11-19): a row's `listing` is the claim as `history_claim.mjs` reads it (a claim the capture's own
// bar_index row refutes is false), so every v2 row, which stored the raw claim, is rebuilt.
export const WARM_INDEX_SCHEMA = 'uct.warm-candidates-index/v3'

/** A capture's bar times, run-length encoded on their deltas: `t0;d1xn1,d2xn2,...`. Small enough to
 *  keep in the index for every capture, and enough to place the window's first bar exactly. */
function encodeTimes(rows) {
  if (!rows.length) return ''
  const runs = []
  for (let i = 1; i < rows.length; i += 1) {
    const d = rows[i][0] - rows[i - 1][0]
    if (runs.length && runs[runs.length - 1][0] === d) runs[runs.length - 1][1] += 1
    else runs.push([d, 1])
  }
  return `${rows[0][0]};${runs.map(([d, n]) => `${d}x${n}`).join(',')}`
}

/** The position of time `t` in encoded times, or -1 when it is not one of them. */
function timeIndexOf(enc, t) {
  const [head, tail] = enc.split(';')
  let cur = Number(head)
  let i = 0
  if (cur === t) return 0
  if (!(cur < t) || !tail) return -1
  for (const run of tail.split(',')) {
    const [d, n] = run.split('x').map(Number)
    if (d > 0 && (t - cur) % d === 0 && (t - cur) / d <= n) return i + (t - cur) / d
    cur += d * n
    i += n
    if (cur > t) return -1
  }
  return -1
}

/** One file's index row: the signature plus either the candidate metadata or `skip`. */
function warmMetaRow(dir, name, st) {
  const sig = { size: st.size, mtimeMs: st.mtimeMs }
  let cap
  try { cap = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) } catch { return { ...sig, skip: true } }
  if (!cap || cap.schema !== 'uct.vendor-capture/v1' || !cap.bars || !Array.isArray(cap.bars.rows)) return { ...sig, skip: true }
  const rows = cap.bars.rows
  if (!rows.length) return { ...sig, skip: true }
  const { ticker } = symbolOf(cap)
  if (!ticker) return { ...sig, skip: true }
  return { ...sig, key: `${String(ticker).toUpperCase()}|${tfCodeOf(cap.timeframe)}`, timeUnit: cap.bars.timeUnit,
    firstT: rows[0][0], lastT: rows[rows.length - 1][0],
    listing: startsAtBar0Holds(cap),
    capturedAt: typeof cap.capturedAtUTC === 'string' ? cap.capturedAtUTC : '',
    times: encodeTimes(rows) }
}

/** A row read from the index is usable only if its signature matches the file and its shape is whole. */
function warmRowFresh(r, st) {
  if (!r || typeof r !== 'object' || r.size !== st.size || r.mtimeMs !== st.mtimeMs) return false
  if (r.skip === true) return true
  return typeof r.key === 'string' && typeof r.timeUnit === 'string' && Number.isFinite(r.firstT)
    && Number.isFinite(r.lastT) && typeof r.listing === 'boolean' && typeof r.capturedAt === 'string'
    && typeof r.times === 'string'
}

function readWarmIndex(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (j && j.schema === WARM_INDEX_SCHEMA && j.rows && typeof j.rows === 'object' && !Array.isArray(j.rows)) return j.rows
  } catch { /* unreadable or absent: every row is rebuilt */ }
  return {}
}

function writeWarmIndex(file, rows) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify({ schema: WARM_INDEX_SCHEMA, rows }))
    fs.renameSync(tmp, file)
  } catch {
    // another worker may hold or have just replaced it; the index is a cache, never required
    try { fs.unlinkSync(tmp) } catch { /* gone */ }
  }
}

/** `TICKER|tf` → candidate metadata for every capture in `dir`.
 *  @param {{dir?: string, useIndex?: boolean}} [opts] useIndex:false is the full scan the index must equal. */
export function warmCandidates({ dir = OTHER_CAPTURE_DIR, useIndex = true } = {}) {
  const cacheKey = `${dir}|${useIndex}`
  if (warmCandidateIndexes.has(cacheKey)) return warmCandidateIndexes.get(cacheKey)
  const byKey = new Map()
  warmCandidateIndexes.set(cacheKey, byKey)
  if (!fs.existsSync(dir)) return byKey
  const indexFile = path.join(dir, WARM_INDEX_NAME)
  const cached = useIndex ? readWarmIndex(indexFile) : {}
  const rows = {}
  let changed = false
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue
    let st
    try { st = fs.statSync(path.join(dir, name)) } catch { continue }
    let r = cached[name]
    if (!warmRowFresh(r, st)) { r = warmMetaRow(dir, name, st); changed = true }
    rows[name] = r
    if (r.skip) continue
    if (!byKey.has(r.key)) byKey.set(r.key, [])
    byKey.get(r.key).push({ file: name, timeUnit: r.timeUnit, firstT: r.firstT, lastT: r.lastT, listing: r.listing, capturedAt: r.capturedAt, times: r.times })
  }
  if (useIndex && (changed || Object.keys(cached).length !== Object.keys(rows).length)) writeWarmIndex(indexFile, rows)
  return byKey
}

/** Forget the in-process metadata (rails only: the on-disk index is untouched). */
export function resetWarmCandidateCache() {
  warmCandidateIndexes.clear()
  warmCandidateRows.clear()
}

/** A candidate's own rows, or null when its receipt does not validate. */
function warmCandidateRowsOf(file, dir = OTHER_CAPTURE_DIR) {
  const cacheKey = path.join(dir, file)
  if (!warmCandidateRows.has(cacheKey)) {
    let rows = null
    try {
      const cap = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (validateCapture(cap).ok) rows = cap.bars.rows
    } catch { rows = null }
    warmCandidateRows.set(cacheKey, rows)
  }
  return warmCandidateRows.get(cacheKey)
}

/** The order among proved warm suppliers: the deepest prehistory first; on equal depth the
 *  earliest `capturedAtUTC`; a supplier with NO stamp (missing or empty) sorts AFTER every
 *  stamped one, so an unstamped capture can never take over a tie; then the file name.
 *  @param {{rows: any[], capturedAt?: string, file: string}} a
 *  @param {{rows: any[], capturedAt?: string, file: string}} b */
export function compareWarmSuppliers(a, b) {
  const depth = b.rows.length - a.rows.length
  if (depth) return depth
  const sa = typeof a.capturedAt === 'string' && a.capturedAt ? a.capturedAt : null
  const sb = typeof b.capturedAt === 'string' && b.capturedAt ? b.capturedAt : null
  if (sa !== sb) {
    if (sa === null) return 1
    if (sb === null) return -1
    return sa < sb ? -1 : 1
  }
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0
}

/** The prehistory a capture's paints, plots and objects are replayed over (DIV-1:
 *  plots and objects too), or why there is none.
 *  @returns {{kind: 'warm'|'cold'|'bar0', rows: any[]|null, file: string|null,
 *             bars: number, refused: string[], reason: string}}
 *  @param {{dir?: string, useIndex?: boolean}} [opts] where the candidates live, and whether
 *  their metadata comes through the on-disk index (the default) or a full scan. */
export function warmBarsSupply(capture, { dir = OTHER_CAPTURE_DIR, useIndex = true } = {}) {
  const none = (kind, reason, refused = []) => ({ kind, rows: null, file: null, bars: 0, refused, reason, historyFromListing: null })
  if (startsAtBar0Holds(capture)) {
    return none('bar0', 'the capture starts at the listing (history.startsAtBar0); there is no history before bar 0')
  }
  if (barIndexStartsAtZero(capture)) {
    return none('bar0', "the capture's own bar_index control reads 0 on its first bar; TradingView's history started there")
  }
  const rows = (capture && capture.bars && capture.bars.rows) || []
  if (!rows.length) return none('cold', 'the capture holds no bars')
  const { ticker } = symbolOf(capture)
  const key = `${String(ticker || '').toUpperCase()}|${tfCodeOf(capture.timeframe)}`
  const first = rows[0][0]
  const metas = (warmCandidates({ dir, useIndex }).get(key) || [])
    // only a capture that starts BEFORE the window and reaches its first bar
    .filter((meta) => meta.timeUnit === capture.bars.timeUnit && meta.firstT < first && meta.lastT >= first)
  let windowTimes = null
  /** One candidate: its prehistory when the overlap is the SAME SERIES as the window, else why not.
   *  The same series means both directions: every window bar is in the candidate, equal, AND every
   *  candidate bar inside the window's span is in the window. ⛔ (2026-11-17) The second direction
   *  was missing: an extended-hours capture holds every regular-hours bar, equal, so it proved
   *  against a regular-hours window and handed it extended-hours prehistory.
   *  `rolling-vwap-spy-5-2026-11-16` (session 0400-2000) supplied three 0930-1600 SPY 5m windows
   *  that way. The bars decide, not the `symbol.session` label: the label is a claim, the bars are
   *  what gets replayed. */
  const prove = (meta) => {
    const candRows = warmCandidateRowsOf(meta.file, dir)
    if (!candRows) return { refused: `${meta.file}: its receipt does not validate` }
    const at = candRows.findIndex((r) => r[0] === first)
    if (at <= 0) return { skip: true } // the window's first bar is not in it
    const byT = new Map(candRows.map((r) => [r[0], r]))
    const candLast = candRows[candRows.length - 1][0]
    for (const w of rows) {
      if (w[0] > candLast) break
      const c = byT.get(w[0])
      if (!c) return { refused: `${meta.file}: window bar ${w[0]} is absent from it inside its span` }
      for (let k = 1; k < OHLCV_FIELDS.length; k += 1) {
        if (c[k] !== w[k]) return { refused: `${meta.file}: bar ${w[0]} ${OHLCV_FIELDS[k]} ${c[k]} vs the capture's ${w[k]}` }
      }
    }
    windowTimes = windowTimes || new Set(rows.map((r) => r[0]))
    const windowLast = rows[rows.length - 1][0]
    for (let i = at; i < candRows.length && candRows[i][0] <= windowLast; i += 1) {
      if (!windowTimes.has(candRows[i][0])) {
        return { refused: `${meta.file}: its bar ${candRows[i][0]} lies inside the window's span and the window has no such bar (another session's series)` }
      }
    }
    return { proved: { file: meta.file, rows: candRows.slice(0, at), listing: meta.listing, capturedAt: meta.capturedAt } }
  }
  let refused = []
  let proved = []
  // The index knows each candidate's bar times, so it knows each one's prehistory depth EXACTLY
  // without reading the file: try them in the final order and stop at the first that proves,
  // reading one file instead of every one (SPY 1D had 220 candidates, 257 MB, on 2026-11-15).
  // Fails closed: a depth the file contradicts, or no candidate proving, falls through to the
  // full pass below, which is the same code the `useIndex: false` scan runs.
  let fast = null
  if (useIndex && metas.every((m) => typeof m.times === 'string')) {
    const ordered = metas.map((meta) => ({ meta, at: timeIndexOf(meta.times, first) })).filter((x) => x.at > 0)
      .sort((a, b) => compareWarmSuppliers({ rows: { length: a.at }, capturedAt: a.meta.capturedAt, file: a.meta.file },
        { rows: { length: b.at }, capturedAt: b.meta.capturedAt, file: b.meta.file }))
    const fastRefused = []
    for (const { meta, at } of ordered) {
      const r = prove(meta)
      if (r.refused) { fastRefused.push(r.refused); continue }
      if (r.skip || r.proved.rows.length !== at) break // the index disagrees with the file: full pass
      fast = { proved: [r.proved], refused: fastRefused }
      break
    }
  }
  if (fast) {
    proved = fast.proved
    refused = fast.refused
  } else {
    for (const meta of metas) {
      const r = prove(meta)
      if (r.refused) refused.push(r.refused)
      else if (r.proved) proved.push(r.proved)
    }
  }
  if (!proved.length) {
    return none('cold', refused.length
      ? `every candidate supplier was refused, cold replay (${refused.join('; ')})`
      : `no committed capture of ${key} holds bars before ${first}, cold replay`, refused)
  }
  // Deepest prehistory wins. On a tie (every listing capture of a series offers the same
  // bars, and each is proved bar for bar against the window, so the replay is identical)
  // the EARLIEST-CAPTURED supplier wins, then the name: a later capture of the same series
  // must never relabel a replay that is already pinned. (2026-11-15: ordering by name alone
  // let S9's `supply-demand-mtf-flux-charts-spy-1d-2026-11-14.json` (#1296), then
  // `3-level-zigzag-semafor-spy-1d-2026-11-14.json` (#1307), take over from
  // `vw-clock-close-tfchange-spy-1d-2026-09-28.json` and turned 13 pins red with no change
  // in any bar or grade. Under this rule the SPY 1D supplier is
  // `vw-object-gc-b-spy-1d-2026-09-28.json`, the earliest proved one, and a new capture can
  // no longer displace it.)
  proved.sort(compareWarmSuppliers)
  const pick = proved[0]
  return { kind: 'warm', rows: pick.rows, file: pick.file, bars: pick.rows.length, refused,
    historyFromListing: pick.listing === true,
    reason: `${pick.rows.length} bars of prehistory from ${pick.file}`
      + `${pick.listing ? ' (which starts at the listing: historyFromListing on)' : ' (not from the listing: historyFromListing off)'}`
      + `, every overlapping window bar equal on ${OHLCV_FIELDS.join('/')}` }
}

/** ⭐ DIV-1 — a column map computed over [prehistory + window], as the WINDOW's:
 *  every column sliced past the `pre` prehistory bars, every non-enumerable payload
 *  the readers walk (`columnErrors`, other-symbol / lower-timeframe / chart-clock
 *  reports, the runtime's drawings) carried verbatim — the shape
 *  `calcBarsWindow.widenToChart` uses in the other direction. The runtime's withheld
 *  warm-up (`runtimeWarmupOf`) is the one payload counted in bars, so it is moved
 *  into the window's indices (never below 0, and never dropped: a curtain that
 *  existed still withholds the run's drawings, as on the chart). */
/** ⭐ ENGINE 56 — the union of a plot's per-bar witness withholdings (`registry
 *  .withheldBarsReport`, computed over `calcBars`), sliced to the window: a 0/1 array, or
 *  null when no bar of it was withheld by name. */
export function withheldBarsOf(report, key, pre) {
  const codes = report && report[key]
  if (!codes) return null
  const masks = Object.values(codes)
  if (!masks.length) return null
  const n = masks[0].length
  const out = new Array(Math.max(0, n - (pre || 0))).fill(0)
  for (const m of masks) for (let i = pre || 0; i < n; i++) if (m[i]) out[i - (pre || 0)] = 1
  return out.some(Boolean) ? { bars: out, codes: Object.keys(codes).sort() } : null
}

/** ⭐⭐ ENGINE 56 (S4-4) — THE FLOAT-ORDER FLOOR OF A PLOT FED BY A RUNNING TOTAL, per bar
 *  of the window, or null. Coordinator ruling: where a `cum` (or `sum`) feeds the plot, two
 *  correct engines that add the same terms in a different order differ by a few ulps of the
 *  TOTAL, not of the plot (an `ema(ad, 12) - ema(ad, 26)` of a 1e9 accumulation is a 1e6
 *  difference carrying 1e9's rounding). So the absolute floor on bar i is
 *  `8 · ε · max |c · total|` over bars 0..i of the computed series (prehistory included; `c` the
 *  constant the total is scaled by on its way to the plot, `linearTotalsOf`). Only
 *  the running-total operand's own magnitude enters: a relative 1e-6 error in the plot is
 *  still a DIVERGE (railed in `vendorHarness.engine56FloatFloor.test.js`). */
export const FLOAT_ORDER_ULPS = 8
const RUNNING_TOTAL_NODES = new Set(['cum', 'cumFrom', 'sum'])
/** ⭐ (review #1265 finding 4) the calls that are LINEAR in their source: a total's float-order
 *  error passes through them unscaled by any other value. */
const LINEAR_OF_SOURCE = new Set(['sma', 'ema', 'rma', 'wma', 'change'])
const TOTAL_PASS_THROUGH = new Set(['tf', 'tf_live', 'tf_merge', 'ltf'])
const hasTotal = (n) => !!n && typeof n === 'object'
  && ((n.type === 'call' && RUNNING_TOTAL_NODES.has(n.name)) || (Array.isArray(n.args) && n.args.some(hasTotal)))
/** A written constant (a finite literal, its negation, `+ - * /` of constants), or null. */
const constantOf = (n, d = 0) => {
  if (!n || typeof n !== 'object' || d > 32) return null
  if (n.type === 'num') return Number.isFinite(n.value) ? n.value : null
  const a = Array.isArray(n.args) ? n.args.map((x) => constantOf(x, d + 1)) : []
  if (n.type !== 'op' || a.some((x) => x === null)) return null
  if (n.name === 'u-' && a.length === 1) return -a[0]
  if (a.length !== 2) return null
  const v = n.name === '+' ? a[0] + a[1] : n.name === '-' ? a[0] - a[1] : n.name === '*' ? a[0] * a[1]
    : n.name === '/' ? a[0] / a[1] : NaN
  return Number.isFinite(v) ? v : null
}
/** The running totals a plot is a LINEAR combination of (sums and differences of totals, a
 *  total times or over a CONSTANT, an offset, a linear smoother of one), each with the factor
 *  its float-order error reaches the plot by (`|c|` for `total * c`, `1 / |c|` for `total / c`;
 *  re-review #1265, 4), or null when a total reaches the plot any other way (a ratio or product
 *  of totals, a non-constant multiplier or divisor, `abs`, a comparison, …). Only then is the
 *  absolute floor sound: through a ratio (`cum(hlc3 * v) / cum(v)`) the total's ulps are
 *  divided away, and the plot is graded by REL 1e-9 on its own magnitude. */
export function linearTotalsOf(tree) {
  const totals = []
  const walk = (n, scale) => {
    if (!n || typeof n !== 'object' || !hasTotal(n)) return true
    if (n.type === 'call' && RUNNING_TOTAL_NODES.has(n.name)) { totals.push({ node: n, scale }); return true }
    const args = Array.isArray(n.args) ? n.args : []
    if (n.type === 'op' && (n.name === '+' || n.name === '-' || n.name === 'u-')) return args.every((x) => walk(x, scale))
    if (n.type === 'op' && (n.name === '*' || n.name === '/')) {
      const [a, b] = args
      if (n.name === '*' && !hasTotal(a)) {
        const c = constantOf(a)
        return c !== null && walk(b, scale * Math.abs(c))
      }
      if (!hasTotal(b)) {
        const c = constantOf(b)
        if (c === null || c === 0) return false
        return walk(a, n.name === '*' ? scale * Math.abs(c) : scale / Math.abs(c))
      }
      return false
    }
    if (n.type === 'offset') return walk(args[0], scale)
    // a read of the SAME symbol on other bars (`security(tickerid, res, hist)`): the same total's
    // float order, read where that timeframe's bar closes (never another symbol's, `sym`)
    if (TOTAL_PASS_THROUGH.has(n.type)) return walk(args[0], scale)
    // a `?:` draws ONE of its arms on each bar (its test selects, it adds nothing to the value):
    // the arms decide (accdist-macd's `sh and hist ? hist : na`)
    if (n.type === 'op' && n.name === '?:' && args.length === 3) return walk(args[1], scale) && walk(args[2], scale)
    if (n.type === 'call' && LINEAR_OF_SOURCE.has(n.name)) return walk(args[0], scale) && args.slice(1).every((x) => !hasTotal(x))
    return false
  }
  return walk(tree, 1) && totals.length ? totals : null
}
export function floatOrderFloorOf(tree, calcBars, pre) {
  if (!tree || typeof tree !== 'object') return null
  const totals = linearTotalsOf(tree)
  if (!totals) return null
  const len = calcBars.length
  const mag = new Float64Array(len)
  for (const { node, scale } of totals) {
    let col
    try { col = interpretTree(node, calcBars, undefined, undefined, undefined, {}) } catch { return null }
    if (!col || typeof col.length !== 'number' || col.length !== len) return null
    let m = 0
    for (let i = 0; i < len; i++) {
      const v = scale * Math.abs(col[i])
      if (Number.isFinite(v) && v > m) m = v
      if (m > mag[i]) mag[i] = m
    }
  }
  const out = []
  for (let i = pre || 0; i < len; i++) out.push(FLOAT_ORDER_ULPS * Number.EPSILON * mag[i])
  return out
}

export function columnsInWindow(cols, pre) {
  if (!cols || typeof cols !== 'object' || !(pre > 0)) return cols
  const out = {}
  for (const [k, col] of Object.entries(cols)) {
    out[k] = col && typeof col.slice === 'function' ? col.slice(pre) : col
  }
  for (const key of Object.getOwnPropertyNames(cols)) {
    if (Object.hasOwn(out, key)) continue
    let value = cols[key]
    if (key === RUNTIME_WARMUP_KEY && value && Number.isInteger(value.withheldBars)) {
      value = { ...value, withheldBars: Math.max(0, value.withheldBars - pre) }
    }
    Object.defineProperty(out, key, { value, enumerable: false, configurable: true })
  }
  return out
}

/** ⭐⭐ DIV-1 — does the PLOT / OBJECT lane replay over the proved prehistory, and why
 *  not when it does not. ONE decision, pure, so every rule is railed on its own.
 *
 *  Replays only what a member's chart computes:
 *   · a proved supplier (`warmBarsSupply` 'warm') — never invented history;
 *   · a DAILY chart — an intraday chart first-paints a shallow window and deepens only
 *     on a pan, so it never computes from the supplier's first bar;
 *   · a script reading no other symbol's / lower timeframe's bars — their prehistory is
 *     not supplied;
 *   · ⭐ r1 (review N2) — at most the depth the product computes: the standalone daily
 *     chart loads `fullBarsFor('D')` bars (the product's own constant, read here, never
 *     restated), so a supplier whose prehistory + window exceeds it would grade a series
 *     no member's chart computes. Then the replay is cold, and graded as before.
 *  ⚠️ What a replayed MATCH speaks for (review N3): the STANDALONE daily chart. A grid
 *  cell first-paints shallow (`backgroundWarm={false}`), and W / M stay cold here.
 *  @returns {{replay: boolean, kind: 'replayed'|'cold'|'bar0', why: string}} */
export function replayDecisionOf({ supplyKind, supplyBars = 0, supplyReason = '', file = null,
  windowBars = 0, tf, readsOtherSymbol = false, readsLowerTf = false } = {}) {
  if (supplyKind !== 'warm') return { replay: false, kind: supplyKind === 'bar0' ? 'bar0' : 'cold', why: supplyReason }
  if (tf !== 'D') {
    return { replay: false, kind: 'cold',
      why: `a proved supplier exists (${file}) but a ${tf} chart first-paints a shallow window and deepens only on a pan, so it does not compute from the supplier's first bar (not a daily chart), cold replay` }
  }
  if (readsOtherSymbol || readsLowerTf) {
    return { replay: false, kind: 'cold',
      why: `a proved supplier exists (${file}) but the script also reads ${readsOtherSymbol ? 'another symbol' : 'a lower timeframe'} whose prehistory is not supplied, cold replay` }
  }
  const depth = fullBarsFor('D')
  if (supplyBars + windowBars > depth) {
    return { replay: false, kind: 'cold',
      why: `a proved supplier exists (${file}) but its ${supplyBars} bars of prehistory + the ${windowBars}-bar window exceed the ${depth} bars a member's daily chart computes (fullBarsFor('D')), cold replay` }
  }
  return { replay: true, kind: 'replayed',
    why: `${supplyReason}; graded as the STANDALONE daily chart computes it (${supplyBars + windowBars} of at most ${depth} bars; a grid cell first-paints shallow, and W / M stay cold)` }
}

/** The id every harness run installs under. Satisfies `defSchema.ID_RE` (it is
 *  the member pane's own prefix) and is uninstalled after every run. */
export const HARNESS_DEF_ID = 'u_member-pane-vendorharness'

/** TradingView interval string → the chart's own timeframe code. An interval
 *  the chart has no code for is passed through unchanged, which folds nothing
 *  (`timeframeFlags` returns null for an unknown code rather than guessing). */
export function tfCodeOf(interval) {
  const s = String(interval || '').trim()
  if (/^\d+$/.test(s)) return s
  if (/^1?D$/i.test(s)) return 'D'
  if (/^1?W$/i.test(s)) return 'W'
  if (/^1?M$/.test(s)) return 'M'
  return s
}

const isDailyLike = (interval) => /^\d*[DWM]$/.test(String(interval || '').trim())

/** The ISO date a unix time falls on, in the exchange's timezone.
 *  ⭐ G17 — ONE formatter per timezone, reused. This built a fresh
 *  `Intl.DateTimeFormat` per BAR; `toProductBars` calls it for every daily row of
 *  every committed capture when the other-symbol index is first built, and with
 *  wave 16's 337 captures (163 MB, master: 139 / 78 MB) that build measured 66 s
 *  of a 64 s first `request.security` read — past C26's 60 s case budget. The
 *  formatter is pure, so the dates are byte-identical. */
const ISO_DATE_FORMATTERS = new Map()
export function isoDateIn(unixSeconds, timeZone) {
  const zone = timeZone || 'Etc/UTC'
  let f = ISO_DATE_FORMATTERS.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    ISO_DATE_FORMATTERS.set(zone, f)
  }
  return f.format(new Date(unixSeconds * 1000))
}

/**
 * The vendor's bars in the SHAPE the product's bars have: `/api/bars` returns an
 * ISO date for a daily/weekly/monthly bar and unix seconds for an intraday one
 * (`tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json` is that payload).
 * The NUMBERS are the vendor's, untouched. A missing volume becomes 0 and the
 * verdict carries the adapter's note saying so.
 */
export function toProductBars(capture) {
  const tz = capture.symbol && capture.symbol.timezone
  const daily = isDailyLike(capture.timeframe)
  const iso = capture.bars.timeUnit === 'iso-date'
  const code = tfCodeOf(capture.timeframe)
  return capture.bars.rows.map(([t, o, h, l, c, v]) => ({
    t: iso ? t : (daily ? productPeriodKey(isoDateIn(t, tz), code) : t),
    o, h, l, c, v: v === null || v === undefined ? 0 : v,
  }))
}

/** ⭐ THE DAY THE PRODUCT KEYS A W / M BAR BY (2026-09-28), not the day the
 *  vendor stamps it: `/api/bars` dates a weekly bar by the FRIDAY of its ISO week
 *  (`bars_fetch._resample_weekly_iso`, holiday Fridays included — the startup
 *  fingerprint's `weekly_dating=friday-close`) and a monthly bar by the 1st of
 *  its month (`_resample_monthly_iso`). Until this rule the harness keyed both by
 *  the vendor's own first-session date, a shape the product never serves. The
 *  clock maps any day of the ISO week / month to the same opening instant
 *  (`barOpenInstant`), so the grade is unchanged by construction; what changed
 *  is that the harness now feeds the engine what a member's chart does. */
export function productPeriodKey(isoDate, code) {
  if (code !== 'W' && code !== 'M') return isoDate
  const [y, m, d] = isoDate.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  if (code === 'M') return `${isoDate.slice(0, 8)}01`
  at.setUTCDate(at.getUTCDate() + (4 - ((at.getUTCDay() + 6) % 7)))
  return at.toISOString().slice(0, 10)
}

/** `{ticker, exchange}` for the bind-time fold, from the capture's symbol. */
function symbolOf(capture) {
  const s = capture.symbol || {}
  const pro = String(s.pro_name || s.full_name || s.name || '')
  const ticker = pro.includes(':') ? pro.split(':').pop() : (s.name || pro)
  const tv = s.exchange || (pro.includes(':') ? pro.split(':')[0] : null)
  // ⭐ C29 — the product hands the fold OUR STORE's exchange spelling (`NYSE
  // Arca` for SPY), never TradingView's (`AMEX`). A capture carries the vendor's,
  // so it is linked to the store's by the same witness rule the other-symbol
  // supply uses; where no witness links it, the vendor's spelling is kept (what
  // the harness did before, so nothing unlinked changes).
  const exchange = storeExchangeOfCapture(capture, tv) || tv
  // ⭐ RS RATING L8 — a field the capture does not carry may be fed from its recorded supply
  // (the vendor's value off a committed probe, checked in `recordedSupplyOf`); the capture's
  // own value, where it has one, wins.
  // ⭐ RS RATING L9 — and our store's class (`securityType`), so an ETF keys the witnessed L3
  // `by_class` row as on a member's chart; absent unless the record states it.
  return { ticker, exchange, ...recordedStoreOf(capture), ...recordedClassificationOf(capture).fields,
    ...vendorClassificationOf(capture) }
}

/** ⭐⭐ RS RATING L3 — THE GRADE FEEDS OUR SIDE THE VENDOR'S OWN VALUE of each substituted input
 *  (RS-RATING-TRANSFER.md: "the grade proves the engine, the substitute is disclosed"): the
 *  capture's `symbol.industry` / `symbol.sector`, read with `compare.mjs::vendorValueOf` (the
 *  comparator's own resolver), in the slot our store's string fills on a member's chart. The path
 *  is the one `bind.js::classificationWith` writes into its tag (`capture.symbol.<field>`), so
 *  what is fed and what is declared cannot name different fields. A capture without them leaves the
 *  fields unsettled (a script reading one refuses by name): nothing is invented. ⛔ No
 *  `securityType` HERE: that is our store's class, and a capture carries TradingView's `type`;
 *  it comes from the recorded supply's `store` block (`recordedStoreOf`, RS RATING L9). */
function vendorClassificationOf(capture) {
  const out = {}
  for (const f of CLASSIFICATION_FIELD_NAMES) {
    const got = vendorValueOf(capture, `capture.symbol.${f}`)
    if (got.found && typeof got.value === 'string' && got.value.trim()) out[f] = got.value
  }
  return out
}

/** ⭐⭐ RS RATING L3 — THIS run's substituted inputs: each classification field the script reads
 *  that the binding served from the substitution path (`symbolSubstitution.js::substitutedFor`),
 *  with `value`, what our side was fed for it (the capture's own value, `vendorClassificationOf`). */
function classificationSubstitutions(source, symbol, capture = null) {
  // ⭐ RS RATING L8 — a field fed from the recorded supply (not off the capture) cites the
  // committed capture it was read from, so the comparator never looks for it on this one.
  const viaRecord = capture ? recordedClassificationOf(capture) : { fields: {}, from: {} }
  return substitutedFor(source, symbol).map((e) => {
    const field = e.name.slice('syminfo.'.length)
    const fromRecord = !vendorValueOf(capture || {}, `capture.symbol.${field}`).found && viaRecord.from[field]
    return { ...e, value: symbol[field], ...(fromRecord ? { vendorValueFrom: viaRecord.from[field] } : {}) }
  })
}

/** The reach of a plot's per-bar colour rule, or null when it has none. */
function colourRuleLookback(o) {
  const p = o && o.presentation
  if (!p) return null
  const reaches = ['colorIndex', 'colorCondition', 'colorGradient']
    .map((k) => (p[k] && p[k].ast ? lookbackOf(p[k].ast) : null))
    .filter((n) => Number.isInteger(n))
  return reaches.length ? Math.max(...reaches) : null
}

function lookbackOf(ast) {
  try {
    const n = maxLookback(ast)
    return Number.isInteger(n) ? n : null
  } catch {
    return null
  }
}

/** Colour a series point/option to `#rrggbbaa`, folding a plot opacity in. */
function withOpacity(hex, opacity) {
  const c = normalizeColor(hex)
  if (!c || !Number.isFinite(opacity)) return c
  const a = Math.max(0, Math.min(255, Math.round(opacity * 255))).toString(16).padStart(2, '0')
  return `${c.slice(0, 7)}${a}`
}

/** ⭐ RT6 — the paint records the pairing reads (`paintColours.gradePaints`).
 *  For a host-lane document they are the translation's own. A RUNTIME document
 *  draws a paint the host withheld for its colour (the run computes it): such a
 *  paint, found on the document by its kind and line, is graded as drawn rather
 *  than reported "withheld"; every other record is the translation's, verbatim. */
function runtimeAwarePaints(built, def) {
  const host = ((built.translation && built.translation.presentation) || {}).paints || []
  // ⭐ DIV-4 — a HOST document draws a `barcolor` the host withheld for its colour
  // when it reads that colour from the per-bar run (`compute.runtimeColours`,
  // `memberPaneDefinition::runtimeReadPaints`): graded as drawn, the same rule.
  const readsRunColours = !!(def && def.compute && def.compute.runtimeColours)
  if (built.lane !== 'runtime' && !readsRunColours) return host
  const drawn = new Set((def.paints || []).map((p) => `${p.kind}@${p.line}`))
  return host.map((p) => {
    if (!p || !drawn.has(`${p.kind}@${p.line}`)) return p
    const { withheld: _w, na: _n, ...rest } = p
    return rest
  })
}

/** Drive the real binder over the recording double; per plot key, the colour
 *  the renderer was handed for every bar (point colour, else series colour). */
function drawnColours(def, bars, ctx, inputs = undefined) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  let cs = addInstance(mergeChartSettings({}), def.id, registry)
  // ⭐ SETTINGS PARITY (2c) — the instance carries the capture's own moved settings, as a member's would
  if (inputs) {
    cs = { ...cs, indicatorInstances: (cs.indicatorInstances || []).map((i) => (i && i.defId === def.id
      ? { ...i, inputs: { ...(i.inputs || {}), ...inputs } } : i)) }
  }
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const out = new Map()
  if (!instances.length) return { ok: false, reason: 'addInstance produced no instance', byKey: out }
  // ⭐ B1 — the chart's own candles (an overlay `bgcolor` with no series of its own is
  // drawn through them) and the `barcolor` overrides, exactly as StockChart hands them.
  const candles = fake.chart.addSeries(fake.LWC.CandlestickSeries || 'CandlestickSeries', {}, 0)
  let barColours = null
  const res = binder.sync({
    priceSeries: () => candles,
    setBarColours: (map) => { barColours = map },
    enabled: true,
    cs,
    instances,
    registry,
    bars,
    tf: ctx.tf,
    symbol: ctx.symbol,
    newestBarIsForming: ctx.newestBarIsForming,
    historyFromListing: ctx.historyFromListing === true,
    barIndexFromFirstBar: ctx.barIndexFromFirstBar === true,
    secondary: ctx.secondary || null,
    exchangeOf: ctx.exchangeOf,
    lowerTf: ctx.lowerTf || null,
    // ⭐⭐ (2026-11-17) — a broker document's window, as StockChart hands the binder `strategyHistoryWindow`
    // (absent for every other document, whose ctx carries none)
    ...(ctx.historyWindowBars != null ? { historyWindowBars: ctx.historyWindowBars } : {}),
    adjustTime: (t) => t,
    applyData: (series, data) => series.setData(data),
    plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
  })
  const plotByKey = new Map((def.plots || []).map((p) => [p.key, p]))
  for (const b of binder.bindings()) {
    if (!b || !b.series) continue
    const sets = fake.calls.filter((c) => c.method === 'setData' && c.id === b.series.__id)
    const data = sets.length ? sets[sets.length - 1].args[0] : null
    if (!Array.isArray(data)) continue
    const plot = plotByKey.get(b.plotKey) || {}
    const seriesColor = b.series.__options && b.series.__options.color
    const byTime = new Map(data.map((p) => [String(p.time), p]))
    // ⭐⭐ A GAP-BREAKING LINE IS DRAWN BY MORE THAN ONE SERIES (`gapRuns.js`): the
    // primary holds the NEWEST valued run and whitespace elsewhere, and each earlier
    // run is drawn by a run series the binding owns (`runSeries` / `runData`). Reading
    // the primary alone read every earlier run as "none" — a renderer that drew the
    // colour, scored as one that did not (row 42: `plot.style_linebr` now breaks, and
    // supertrend-strategy / pa-zigzag read 332 and 8 phantom colour misses). What the
    // renderer was handed for a bar is the valued point of whichever series drew it.
    for (const run of (Array.isArray(b.runData) ? b.runData : [])) {
      for (const p of (Array.isArray(run) ? run : [])) {
        if (p && Number.isFinite(p.value)) byTime.set(String(p.time), p)
      }
    }
    // ⭐⭐ A DISPLACED PLOT'S COLOUR IS READ WHERE THE RENDERER DREW IT.
    // `offset = -N` draws the value computed on bar i at bar i - N (the binder's
    // `displacedColumn`), and TradingView's study data keys that value — and its
    // colour — to the computing bar i (the VALUES agree bar for bar, which is how
    // this was established). Reading the point at the undisplaced bar i found
    // nothing there: measured 2026-09-28 on liquidity-pools (offset -4, 46 bars
    // "vendor #787b86ff vs ours none"), price-action-as-in-book (-5, 26 bars) and
    // the legacy trendlines capture (-15). A value that would sit left of bar 0
    // was never drawn by either platform, so its colour is not a reading
    // (`undefined`, which the comparator skips), not a "none".
    // ⛔ The shift is the binder's OWN `drawShiftOf`, never re-derived here.
    const shift = drawShiftOf(plot)
    // ⭐ ENGINE 58 — a colour-rule row whose series colour is withheld by name
    // (`plots[].colorWithheld.points`): a point the renderer was handed no colour of
    // its own for draws in none, by name — `COLOUR_WITHHELD_POINT`, not a colour.
    const pointsWithheld = !!(plot.colorWithheld && plot.colorWithheld.points)
    const colors = bars.map((_bar, i) => {
      const at = i + shift
      if (at < 0) return undefined
      const p = at < bars.length ? byTime.get(String(bars[at].t)) : null
      if (!p || !Number.isFinite(p.value)) return null
      if (pointsWithheld && !p.color) return COLOUR_WITHHELD_POINT
      // ⭐⭐ WHAT THE RENDERER WAS HANDED IS FINAL. The pool already folded the
      // plot's opacity into a point colour and a series colour (`withAlpha`,
      // which MULTIPLIES through); re-applying `opacity` here REPLACED the
      // colour's alpha. ⚰️ Measured 2026-09-28 on Ultimate Pivot Points' Pivot:
      // the `na` branch is a palette entry `rgba(0, 0, 0, 0)`, the plot's
      // opacity is 0.9, the renderer drew it at alpha 0 — and this read it
      // `#000000e6`, a visible black line nobody drew. Only the definition's
      // own colour, when the renderer was handed none, still takes the opacity.
      const drawn = p.color || seriesColor
      return drawn ? normalizeColor(drawn) : withOpacity(plot.color, plot.opacity)
    })
    out.set(b.plotKey, colors)
  }
  // ⭐ B1 — every background the binder attached, and what each was told to draw.
  const backgrounds = fake.calls
    .filter((c) => c.method === 'attachPrimitive' && c.args[0] && typeof c.args[0].options === 'function')
    .map((c) => ({ seriesId: c.id, colors: c.args[0].options().colors || null }))
  // ⛔ read BEFORE the teardown: releasing the binder clears the overrides it handed.
  const handed = barColours
  binder.teardown()
  return { ok: true, reason: null, byKey: out, sync: res, paints: { backgrounds, barColours: handed } }
}

/** ⭐ C45 — does the capture's OWN `bar_index` control row print 0, 1, 2 … on
 *  its bars? The vendor's statement that this series starts at its bar 0. Every
 *  bar is checked, not the first: a row that starts at 0 and skips is not it. */
export function barIndexStartsAtZero(capture) {
  const plots = (capture && capture.study && capture.study.plots) || []
  const control = plots.find((p) => BAR_INDEX_CONTROL.test(p.title || ''))
  const pv = capture && capture.plotValues
  if (!control || !pv || !Array.isArray(pv.rows) || !pv.rows.length) return false
  const at = pv.fields.indexOf(control.id)
  if (at < 0) return false
  const bars = (capture.bars && capture.bars.rows) || []
  if (bars.length !== pv.rows.length) return false
  for (let i = 0; i < pv.rows.length; i += 1) {
    if (pv.rows[i][0] !== bars[i][0] || pv.rows[i][at] !== i) return false
  }
  return true
}

/** ⭐⭐ RT5 — a runtime document's LIVE set at the last bar, made by its own run
 *  (`runtime/runtimeObjects.js`), in the same shape the object lane reports. */
function runtimeObjectsReport(def, bars, ctx, cols) {
  const withheldRun = runtimeObjectsWithheldOf(cols)
  if (withheldRun) {
    return { drawsObjects: true, ok: false, lane: 'runtime', withheld: withheldRun.guard,
      reason: `withheld by name (${withheldRun.guard}) — ${withheldRun.reason}` }
  }
  const payload = runtimeObjectsOf(cols)
  if (!payload) {
    const errs = registry.columnErrors ? registry.columnErrors(cols) : null
    const first = errs ? Object.values(errs)[0] : null
    return { drawsObjects: true, ok: false, lane: 'runtime',
      reason: `the run drew nothing${first ? ` (${first.guard || ''}: ${first.message || ''})` : ''}` }
  }
  const run = { live: payload.live, pineVersion: payload.pineVersion }
  const state = toRenderState(run.live, { bars, tf: ctx.tf, pineVersion: payload.pineVersion })
  // ⭐ OZ — a family the run withheld whole is graded as a gap with a name, the
  // way the host lane's are (the member reads the same sentence, `runtimeWithheldWhy`).
  const rtWhy = runtimeWithheldWhy(payload.withheld)
  const rtFams = rtWhy ? Object.keys(rtWhy).sort() : []
  return { ...heldReport(run.live, state, payload.pineVersion), lane: 'runtime',
    ...(rtFams.length ? { withheldFamilies: rtFams,
      withheldGuards: [...new Set(rtFams.map((f) => runtimeWithheldCause(payload.withheld[f], f)))].sort(),
      withheldWhy: [...new Set(Object.values(rtWhy))].join(' ') } : {}),
    runStatus: payload.status, runReason: payload.reason || null, runWithheld: payload.withheld || {},
    undrawnProps: payload.undrawnProps || {}, chartClock: [] }
}

/** Counts, texts and held objects off a LIVE set and its render state. */
function heldReport(live, state, pineVersion) {
  const cells = state.tables.flatMap((t) => t.cells || [])
  const held = { line: 0, label: 0, box: 0 }
  const heldTexts = { label: [], box: [] }
  for (const o of live || []) {
    if (!o || !Object.prototype.hasOwnProperty.call(held, o.family)) continue
    held[o.family] += 1
    if (heldTexts[o.family]) {
      const t = o.props ? o.props.text : undefined
      heldTexts[o.family].push(t === undefined || t === null ? '' : String(t))
    }
  }
  return {
    drawsObjects: true,
    ok: true,
    counts: { lines: held.line, labels: held.label, boxes: held.box, tables: state.tables.length, tableCells: cells.length },
    drawn: { lines: state.lines.length, labels: state.labels.length, boxes: state.boxes.length },
    texts: { labels: heldTexts.label, boxes: heldTexts.box, tableCells: cells.map((c) => c.text) },
    dropped: state.dropped || null,
    held: live || [],
    tables: state.tables || [],
    pineVersion,
  }
}

/** ⭐⭐ F3 (2026-10-02) — A SCRIPT THAT DRAWS, WHOSE DRAWING THE DOOR WITHHELD,
 *  IS NOT A SCRIPT WITH "NO DRAWING PROGRAM". The host translation carried
 *  drawing steps (`objectDiagnostics.attemptedOps`), and the door kept none of
 *  them: either the object gate withheld the whole program for a lost removal
 *  (`paneObjectsGate`, the member's own "its drawings are not shown" sentence),
 *  or the program kept none of the steps it attempted (a create whose text
 *  reads an unbounded `ta.barssince`, another symbol's `request.security`).
 *  Graded as a GAP, by name — the verdict a withholding gets — never as a
 *  script that draws nothing. ⛔ Host lane only: a runtime-lane document has no
 *  drawing program of its own yet (RT5), and saying so is the true sentence. */
function drawingWithheldBy(built) {
  if (!built || built.lane === 'runtime') return null
  const t = built.translation
  const d = (t && t.objectDiagnostics) || {}
  if (!(Number.isInteger(d.attemptedOps) && d.attemptedOps > 0)) return null
  const gate = paneObjectsGate(t)
  if (!gate.draw) {
    const keys = [...new Set(((gate.loss && gate.loss.removes) || []).map((r) => r.key))]
    return { guard: gate.guard, reason: `the object gate withheld the whole drawing program for a lost removal (${keys.join(', ') || 'unnamed'})` }
  }
  if (t.objects && (t.objects.ops || []).length) return null
  const reasons = [
    ...Object.entries(d.dropReasons || {}).map(([k, n]) => `${k} ×${n}`),
    ...(((gate.loss && gate.loss.readerNames) || []).length ? [`never carried: ${gate.loss.readerNames.join(', ')}`] : []),
  ]
  const why = (d.createDropWhy || []).map((w) => (/ (pine:[a-z-]+)/.exec(w) || [])[1]).filter(Boolean)
  return {
    guard: 'pine:object-ops-refused',
    reason: `the program carried none of its ${d.attemptedOps} drawing steps (dropped: ${reasons.join(', ') || 'none named'}${why.length ? `; ${[...new Set(why)].join(', ')}` : ''})`,
  }
}

/** ⭐ OZ — the families a run withheld by name with nothing of them drawn
 *  (`NOT_SHOWN` guards), merged into the collector's `withheldFamilies`, with the
 *  guards and the member's sentence(s) for the verdict's reason. */
function notShownReport(withheldBy, withheldWhy, base = null) {
  const by = withheldBy || {}
  const guards = Object.values(NOT_SHOWN).filter((g) => Array.isArray(by[g]) && by[g].length)
  if (!guards.length) return {}
  const fams = new Set([...(by['objects:collector'] || []), ...(by['objects:collector-all'] || []), ...(base || [])])
  for (const g of guards) for (const f of by[g]) fams.add(f)
  const why = [...new Set(guards.flatMap((g) => by[g]).map((f) => (withheldWhy || {})[f]).filter(Boolean))]
  return {
    withheldFamilies: [...fams].sort(),
    withheldGuards: [...(by['objects:collector'] ? ['objects:collector'] : []),
      ...(by['objects:collector-all'] ? ['objects:collector-all'] : []), ...guards],
    withheldWhy: why.join(' '),
  }
}

/** ⭐⭐ ENGINE 53 — a host document's RUN HALF (`nativeRegistry.js::withRunHalf`): where the
 *  bind served it, the run's drawings are graded (the binder draws them and not the host
 *  program's); otherwise the host program's, as the chart draws them. The state rides on
 *  the report (`runHalf`, `runHalfCode`) for the census and the regrade. */
function objectsOf(def, bars, ctx, cols, built = null, inputs = undefined) {
  const half = carriesRunHalf(def) ? runHalfOf(cols) : null
  const tag = half ? { runHalf: half.state, runHalfCode: half.code || null } : {}
  if (half && half.state === 'served') return { ...runtimeObjectsReport(def, bars, ctx, cols), ...tag }
  const r = hostObjectsOf(def, bars, ctx, cols, built, inputs)
  return r && half ? { ...r, ...tag } : r
}

/** Rails only (PARITY UNIT LF): the object report the grader builds for one instance's columns. */
export const __objectsReportForTests = (...args) => hostObjectsOf(...args)

/** `{partialFamilies}` — the families a disclosed partial drew fewer of (see `hostObjectsOf`), or nothing. */
function partialFamiliesOf(program, run) {
  const fams = new Set(Array.isArray(program && program.lostCreates) ? program.lostCreates : [])
  for (const [f, n] of Object.entries((run && run.withheld) || {})) if (n > 0) fams.add(f)
  return fams.size ? { partialFamilies: [...fams].sort() } : {}
}

/** The object lane's LIVE set at the last bar, as counts and texts. */
function hostObjectsOf(def, bars, ctx, cols, built = null, inputs = undefined) {
  // ⭐⭐ PARITY UNIT LF — the binder's own answer (`drawsRunObjectsOn`): a run-owned document carrying its
  // clean host program draws that program when the run holds back a family it draws
  if (drawsRunObjectsOn(def, cols)) return runtimeObjectsReport(def, bars, ctx, cols)
  if (!def.objects || !(def.objects.ops || []).length) {
    const w = drawingWithheldBy(built)
    return w ? { drawsObjects: false, withheld: w.guard, reason: w.reason } : { drawsObjects: false }
  }
  try {
    const reader = objectReaderFor(def, bars, {
      // ⭐ SETTINGS PARITY (2c) — the capture's own settings, as the chart's object lane reads them
      inputs, tf: ctx.tf, symbol: ctx.symbol, newestBarIsForming: ctx.newestBarIsForming,
      historyFromListing: ctx.historyFromListing === true,
      barIndexFromFirstBar: ctx.barIndexFromFirstBar === true,
      secondary: ctx.secondary || null, exchangeOf: ctx.exchangeOf,
      lowerTf: ctx.lowerTf || null,
    })
    if (!reader) return { drawsObjects: true, ok: false, reason: 'objectReaderFor returned null' }
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime,
      readUnknown: reader.readUnknown, readUnknownOther: reader.readUnknownOther,
      // ⭐ F1 — the binder's own statement (`binder.js`): off the listing a `var`
      // list of drawings is withheld whole (`objectRuntime.js`, `withheldBy`).
      offListing: reader.historyFromListing !== true,
      // ⭐ ENGINE 55 — the binder's own statement of why run-half values are unknown.
      unknownBecause: runtimeUnknownSentence(reader.runtime),
    })
    if (run.withheldBy && run.withheldBy['objects:off-listing']) {
      const fams = run.withheldBy['objects:off-listing']
      // the same report shape as a drawing the door's gate withholds (F3,
      // `drawingWithheldBy`): a withheld family is a gap, graded as one
      return { drawsObjects: false, withheld: 'objects:off-listing',
        reason: `the ${fams.join(' / ')} drawings live in a \`var\` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable`,
        // the run's live set, for DIAGNOSTICS only (F4's window analysis reads it):
        // never graded — there is no `ok`, so `gradeCapture` pairs nothing
        held: [...(run.live || []), ...(run.offListingLive || [])].sort((x, y) => x.id - y.id) }
    }
    const state = toRenderState(run.live, { bars, tf: ctx.tf, pineVersion: reader.program.pineVersion })
    const cells = state.tables.flatMap((t) => t.cells || [])
    // ⭐⭐ LINES, LABELS AND BOXES ARE COUNTED AS THE SCRIPT HOLDS THEM — the
    // runtime's LIVE set at the last bar — because that is what the capture's
    // counts are. TradingView's `graphics()` collections keep an object whose
    // coordinate is `na`: measured 2026-09-27 on Zero-Lag MA Trend Levels
    // (NYSE:RDDT 1D), 18 box records, five of them with a null top or bottom
    // (`ta.atr(200)` is still warming when they are made). The render state
    // cannot draw those five and drops them, so counting IT compared 13 drawable
    // boxes against 18 held ones — a divergence between two different questions,
    // not between two engines. The render state's own drops are still reported
    // (`dropped`) so an undrawable object is named, never hidden.
    // ⚠️ Tables and cells keep the render state's count: no capture yet shows a
    // held-but-undrawn table or cell, so there is nothing to say they differ.
    const held = { line: 0, label: 0, box: 0 }
    const heldTexts = { label: [], box: [] }
    for (const o of run.live || []) {
      if (!o || !Object.prototype.hasOwnProperty.call(held, o.family)) continue
      held[o.family] += 1
      if (heldTexts[o.family]) {
        const t = o.props ? o.props.text : undefined
        heldTexts[o.family].push(t === undefined || t === null ? '' : String(t))
      }
    }
    return {
      drawsObjects: true,
      ok: true,
      counts: {
        lines: held.line,
        labels: held.label,
        boxes: held.box,
        tables: state.tables.length,
        tableCells: cells.length,
      },
      drawn: { lines: state.lines.length, labels: state.labels.length, boxes: state.boxes.length },
      // ⭐ `boxes` is reported, never graded by v1's comparator (it reads
      // labels and cells) — the zero-lag rail pins it against the records.
      texts: { labels: heldTexts.label, boxes: heldTexts.box, tableCells: cells.map((c) => c.text) },
      dropped: state.dropped || null,
      // ⭐ C37 — the objects themselves (the runtime's LIVE set, and the render
      // state's tables), for the colour column: a colour is compared on an object
      // PAIRED by value, which a count cannot do. ⭐ C44 — `gradeCapture` pairs
      // them (`objectColours.js`) and hands the slot rows to the verdict.
      // ⛔ The objects themselves are never written to a verdict file.
      held: run.live || [],
      tables: state.tables || [],
      pineVersion: reader.program.pineVersion,
      // ⭐ C36 — why drawings that read `time(<timeframe>)` are withheld here.
      chartClock: reader.chartClock || [],
      // ⭐ RENDER GAPS (census tools) — the names the run gave each text it withheld (`formatNumberWhy`), by count:
      // `renderGaps.js` names a withheld-text gap by them. Never graded, never written to a verdict file.
      ...(run.stats && run.stats.textsWithheldWhy ? { textsWithheldWhy: { ...run.stats.textsWithheldWhy } } : {}),
      // ⭐ W-C22-DEL — families the run withheld WHOLE, by name, because
      // TradingView's collector may have removed objects this run holds
      // (`objectRuntime.js`, `withheldBy['objects:collector']`): graded as a gap.
      ...(run.withheldBy && (run.withheldBy['objects:collector'] || run.withheldBy['objects:collector-all'])
        ? { withheldFamilies: [...new Set([...(run.withheldBy['objects:collector'] || []),
          ...(run.withheldBy['objects:collector-all'] || [])])].sort() } : {}),
      // ⭐ OZ — and a family the run drew NONE of for a cause of the engine's own
      // (`objectRuntime.js`, `notShown`), by the same name the member reads.
      ...notShownReport(run.withheldBy, run.withheldWhy),
      // ⭐⭐ DISCLOSED PARTIAL (coordinator ruling 2026-11-19) — the families of which this program drew FEWER objects
      // than the script makes, and SAID SO at the door: a create the program lost (`program.lostCreates`, `'*'` = every
      // family) or an object the run withheld by name (`run.withheld`). A count gap in such a family is graded on what
      // is drawn (`compare.mjs::compareObjects`), never as a count DIVERGE.
      ...partialFamiliesOf(reader.program, run),
    }
  } catch (err) {
    return { drawsObjects: true, ok: false, reason: `the object lane threw: ${String((err && err.message) || err)}` }
  }
}

/**
 * The two doors a member's paste passes through, and nothing else: the builder
 * (`memberPaneDefinition`, MemberPane.jsx's own call) and the install door
 * (`installUserDefinitions`, which re-validates and can refuse what the builder
 * accepted). `def` is the installed definition, or null with the door's own
 * sentence in `refusal`.
 *
 * ⛔ ONE AUTHORITY FOR "CAN THE MEMBER DOOR BUILD THIS". `runOurSide` below and
 * the vendor-batch manifest census (`memberDoorCensus.measure.test.js`) both
 * call this, so the batch never targets a script the grader would then refuse
 * for a reason the census did not see.
 *
 * ⚠️ On any path that reached the install door, the caller owns the uninstall
 * (`registry.uninstallUserDefinition(HARNESS_DEF_ID)`).
 */
export function enterMemberDoor(source) {
  const built = memberPaneDefinition({ source, id: HARNESS_DEF_ID, name: 'vendor harness' })
  if (!built.ok) {
    // ⭐ WS-0: a refusal the RUNTIME lane declined (pane on) says so, by code, so a
    // runtime-on harness run can count its walls; with the pane dark it never appears.
    return { built, def: null, stage: 'builder', refusal: `member door refused${built.guard ? ` (${built.guard})` : ''}${built.runtimeDeclined ? ` ${runtimeDeclinedTag(built.runtimeDeclined.code)}` : ''}: ${built.reason}` }
  }
  const { installed, errors } = registry.installUserDefinitions([built.definition])
  if (!installed.length) {
    return { built, def: null, stage: 'install', refusal: `install door refused: ${errors.join(' | ')}` }
  }
  return { built, def: installed[0], stage: null, refusal: null }
}

/**
 * ⭐⭐ (2026-11-17) — WHAT A BROKER DOCUMENT'S RUN PUBLISHED, read back off the columns the product computed
 * (`registry.computeFor`, the binder's call): its strategy record (`runtimeStrategyOf`), its own drawings, and,
 * when it published no record, the refusal the columns carry by name (a run stopped at an unpinned or unsettled
 * rule, a window it cannot start from, a build the lane refused). Nothing is re-run or re-derived here.
 * The record's times are the run's own (each bar's opening instant, `runtimeColumns.js::brokerBarTimes`): they
 * are graded as recorded, never mapped onto the capture's clock (2026-11-17, strategy-epoch-bar-times).
 */
export function strategyRunOf(cols, bars, rows) {
  const record = runtimeStrategyOf(cols)
  let refusal = null
  if (!record) {
    const errs = (typeof registry.columnErrors === 'function' ? registry.columnErrors(cols) : null) || {}
    const first = Object.values(errs).find((e) => e && e.guard) || null
    refusal = first
      ? { guard: String(first.guard), message: String(first.message || '') }
      : { guard: 'harness:no-record', message: 'the broker document ran and published no strategy record' }
  }
  // `unixAt[x]`: the capture's time of run bar `x` (a drawing's `bar_index` x)
  const unixAt = bars.map((b, i) => (rows[i] ? rows[i][0] : null))
  return { record, refusal, objects: runtimeObjectsOf(cols), objectsWithheld: runtimeObjectsWithheldOf(cols), unixAt }
}

/** ⭐⭐ THE PARITY CLOCK: one that never moves. A grade is a question about VALUES, so
 *  the runtime pane's wall-clock stop (`RUNTIME_PANE_TIME_BUDGET_MS`) must not answer it:
 *  on a busy box delta-rsi's cold run passed 1,000 ms and graded INCONCLUSIVE ("no
 *  column") while its values MATCH. Installed for the length of one grade and restored in
 *  the `finally`; the instruction budgets (`limits.js`) still stop a runaway, and the
 *  member door's budget is railed on its own (`runtimeDoorBudget.rail.test.js`). */
const PARITY_CLOCK = () => 0

/**
 * Run the member door on the capture's bars.
 *
 * @returns {{ok: boolean, refusal: string|null, plots: object[], objects: object,
 *            ctx: object, notes: string[]}}
 */
/** Does this column hold no value on any bar (a by-name withholding that reached
 *  every bar)? A missing column answers no: there is nothing to grade either way. */
export function withholdsEveryBar(column) {
  if (!column || typeof column.length !== 'number' || !column.length) return false
  for (let i = 0; i < column.length; i++) if (column[i] === column[i]) return false
  return true
}

/** ⭐ 2026-11-09 (triage lane WN; review N2) — WHICH PLOTS OUR SIDE WITHHELD BY
 *  NAME ON EVERY BAR: `Map<plotKey, code>` from the door's chart-clock report.
 *  ⛔ The COLUMN decides, for every code, whole-series ones included: a plot whose
 *  column holds no value on any bar is withheld (graded INCONCLUSIVE, with the
 *  code); a code named on a plot that still draws a value is graded on those
 *  values and SAID (`notes`), so a mislabelled served plot cannot hide as
 *  INCONCLUSIVE. Each code's note is pushed here too. */
export function withheldPlotsOf(clockReport, cols, notes) {
  const out = new Map()
  if (!clockReport) return out
  for (const r of clockReport.withheld) {
    const what = r.code.startsWith('bar-index:') ? '`bar_index`'
      : r.code.startsWith('running-total:') ? 'a running total'
        : r.code.startsWith('var-origin:') ? '`var`'
          : r.code.startsWith('request:') ? '`request.security`'
            // engine HL: `windowHoleMask`
            : r.code.startsWith('window-extreme:') ? 'a window over `na` gaps'
              : r.code.startsWith('pine:') ? 'a value (engine 56 per-bar witness)' : 'time(<timeframe>)'
    notes.push(`${what} withheld (${r.code}) on ${r.plots.length} plot(s) — ${r.reason}`)
    const whole = CHART_CLOCK_WHOLE.includes(r.code)
    // ⭐ ENGINE 55 — a NEWEST-BAR code is never a whole-series withholding, even on a
    // plot whose column is empty for its own reasons (RDDT's monthly pivots never
    // form in its history): that bar is excluded by `withheldNewest`, the rest graded.
    // …and review L2's first-period code withholds the first period's bars only, never the series.
    if (r.code === TF_MERGE_NEWEST_CODE || r.code === TF_MERGE_FIRST_CODE) continue
    for (const key of r.plots) {
      if (out.has(key)) continue
      if (withholdsEveryBar(cols[key])) out.set(key, r.code)
      else if (whole) notes.push(`${key}: named ${r.code} (withheld on every bar) but its column holds values — graded on them`)
    }
  }
  return out
}

/** ⭐⭐ L7 (2026-11-14) — THE SUBSTITUTED INPUTS OF ONE GRADE: our side's declaration,
 *  read by `compare.mjs::compareCapture` (the contract is stated there, beside
 *  `substitutionProblems`). Each entry is `{name, source, vendorValueFrom, value}`: a
 *  vendor-only fact the member door answers from UCT data (`source`), which THIS run was
 *  fed from the vendor instead (`vendorValueFrom`, resolved with `compare.mjs::vendorValueOf`,
 *  the comparator's own resolver), so the grade proves the translation and only the UCT
 *  value is left unproven (the member door discloses it).
 *  ⛔ Nothing in the engine supplies a substituted value yet, so today every run declares
 *  `[]` and grades exactly as before. L3 (`syminfo.industry`) is the first to fill it: the
 *  lane that feeds a vendor value into `ctx` pushes its entry here, in the same change.
 *  A malformed declaration is refused HERE, before it can reach a verdict. */
export function substitutedInputsOf(capture, declared = []) {
  const list = Array.isArray(declared) ? declared : []
  const problems = substitutionProblems(capture, list)
  if (problems.length) throw new Error(`ourSide: substituted inputs refused: ${problems.join('; ')}`)
  return list.map((e) => ({ ...e }))
}

// SUPPLY-ATTRIBUTED (coordinator ruling on #1541, 2026-11-17): the counterfactual run of
// `supplyAttribution.js` - our side on the recorded supply with TradingView's witnessed values on the
// dates they differ. ONLY that file calls it; it never feeds a grade a member reads (the grade runs on
// the recorded supply, RS RATING L8), it only proves which side of a difference is the data.
let _supplyOverride = null
/** Our side, once, with `overrides` (`{<store ticker>: bars}`) in place of the recorded supply. */
export function runOurSideWithSupply(capture, overrides) {
  _supplyOverride = overrides || null
  try {
    return runOurSide(capture)
  } finally {
    _supplyOverride = null
  }
}

export function runOurSide(capture) {
  setRuntimeDoorClock(PARITY_CLOCK)
  try {
    return runOurSideOnTheParityClock(capture)
  } finally {
    setRuntimeDoorClock(null)
  }
}

function runOurSideOnTheParityClock(capture) {
  const notes = []
  const source = capture && capture.source && capture.source.text
  const door = enterMemberDoor(source)
  const built = door.built
  if (!built.ok) {
    return { ok: false, refusal: door.refusal, plots: [], notes }
  }
  try {
    if (!door.def) {
      return { ok: false, refusal: door.refusal, plots: [], notes }
    }
    const def = door.def
    // ⭐⭐ SETTINGS PARITY (2c) — THE SETTINGS THE CAPTURE WAS TAKEN AT. At every default this is
    // `undefined` and our side computes exactly as it always has; a capture with a setting moved is
    // computed with the same setting moved, or refused by name (`captureInputs.js`).
    const taken = captureInstanceInputs(capture, def)
    if (!taken.ok) {
      return { ok: false, refusal: `the capture was taken at settings our side cannot set: ${taken.why}`, plots: [], notes }
    }
    const instanceInputs = taken.inputs
    if (instanceInputs) notes.push(`settings: graded at the capture's own moved settings ${JSON.stringify(taken.moved)}`)
    const bars = toProductBars(capture)
    const refutedListing = startsAtBar0Refuted(capture)
    if (refutedListing) notes.push(refutedListing)
    const tf = tfCodeOf(capture.timeframe)
    if (tf === capture.timeframe && !/^\d+$/.test(tf) && !['D', 'W', 'M'].includes(tf)) {
      notes.push(`timeframe ${JSON.stringify(capture.timeframe)} has no chart code — the bind-time fold folds nothing`)
    }
    const ctx = {
      tf,
      symbol: symbolOf(capture),
      newestBarIsForming: capture.newestBarIsForming ?? null,
      // ⭐ C12w — the product states this from the listing date
      // (`StockChart`, `listingSeed.historyFromListingOf`); a capture states it as
      // `history.startsAtBar0`, asserted only when the vendor's loaded history
      // stopped growing AND began on the listing day. Same fact, same door.
      // ⛔⛔ read through `history_claim.mjs`: a claim the capture's own bar_index row contradicts is FALSE
      historyFromListing: startsAtBar0Holds(capture),
      // ⭐⭐ C45 — `bar_index` is TradingView's only where the series starts at
      // the bar TradingView counted as 0. A capture PROVES that about itself when
      // its own `plot(bar_index, …)` control row reads 0, 1, 2 … on its bars (an
      // intraday or weekly capture whose `startsAtBar0` asserts nothing about a
      // listing still can); one with no control row, or one that reads 8175 on its
      // first bar, does not — and what depends on the count is withheld by name,
      // exactly as the member's chart withholds it.
      barIndexFromFirstBar: barIndexStartsAtZero(capture),
    }
    // ⭐⭐ THE STRATEGY WINDOW, AS THE BINDER HANDS IT (`binder.js` W9-T11-F1): a broker document is handed the
    // server's `bars_window.HISTORY_WINDOW_BARS` (what `GET /api/pine/history-window` answers a member's tab);
    // every other document is handed nothing, so an indicator's ctx is unchanged.
    const strategyDoc = isStrategyWindowDefinition(def)
    if (strategyDoc) ctx.historyWindowBars = historyWindowBarsOf(path.resolve(process.cwd(), '..'))
    // ⭐ C26 — another symbol's bars, from committed captures only.
    // ⭐ SETTINGS PARITY (symbol): the supply the capture's own symbol choice asks for (the chart fetches
    // the instance's chosen comparison symbol, `symbolInputs.instanceDocumentForFetch`)
    const supply = otherSymbolSupply(instanceDocumentForFetch(def, { inputs: instanceInputs }), capture)
    if (supply.secondary) { ctx.secondary = supply.secondary; ctx.exchangeOf = supply.exchangeOf }
    notes.push(...supply.notes)
    if (ctx.symbol.securityType) {
      const rec = recordedSupplyOf(capture)
      notes.push(`symbol class ${ctx.symbol.securityType}: our store's, recorded beside the capture (${rec.store.securityType.source})`)
    }
    // ⭐ RS RATING L8 — a capture whose recorded supply says the served source was NOT recorded is
    // not graded at all: a grade over another source (a fallback, or TradingView's own bars) would
    // speak for bars no member is served. INCONCLUSIVE, by name.
    if (supply.unrecorded && supply.unrecorded.length) {
      return { ok: false, refusal: `the supply this grade needs is not recorded — ${supply.unrecorded.join('; ')}`,
        plots: [], notes }
    }
    // ⭐ C41 — the chart symbol's own intraday bars, from committed captures only.
    const lower = lowerTfSupply(def, capture)
    if (lower.lowerTf) ctx.lowerTf = lower.lowerTf
    notes.push(...lower.notes)
    // ⭐⭐ DIV-1 (2026-11-09) — THE PLOT AND OBJECT LANES GRADE WITH THE HISTORY
    // TRADINGVIEW HAD. RC1 (below) already replayed the PAINTS over [prehistory +
    // window]; the plot and object lanes still started cold at the capture's first
    // bar, while TradingView computed every one of these captures with the symbol's
    // history back to the listing in front of it (DIVERGE triage 2026-11-08: 24 SPY
    // 1D captures diverging on a converging prefix). Gated on what the PRODUCT does,
    // measured before this was written: a standalone daily chart first-paints
    // `fullBarsFor('D')` = 12,500 bars (`StockChart._deepFirstPaint`), the server's
    // deep branch serves SPY from its 1993-01-29 listing (8,502 sessions; the 6,677
    // before the SPY windows are the supplier's own sessions, closes equal at the
    // median), the binder computes over every loaded bar, and `historyFromListing`
    // is stated from the listing date. So this makes the harness measure what a
    // member's chart computes; it is not a tolerance.
    // ⛔ ONE SUPPLIER, THE PROVED ONE (`warmBarsSupply`), and the listing flag is the
    // SUPPLIER's. `barIndexFromFirstBar` is NOT stated on the replay: no member
    // surface states it (`nativeRegistry.barIndexAbsoluteFor`); on a listing series
    // `interpret` derives `bar_index` from the listing itself, exactly as on the chart.
    // ⛔ NEVER INVENTED HISTORY: a capture that also reads another symbol's or a lower
    // timeframe's bars stays cold — those series' prehistory is not supplied, and
    // replaying ours against their window-only bars is a series no chart computes.
    // ⛔ DAILY ONLY — the gate measured a DAILY chart. An intraday chart first-paints
    // `firstPaintBarsFor(tf)` (under 1,200 bars) and deepens only when the member pans
    // (`barsBackfill.shouldBackfill`), so its computation does NOT start at the
    // supplier's first bar: replaying intraday would grade a series the chart does not
    // compute. (The paint lane's RC1 replay is its own rule and is unchanged.)
    // ⭐ r1 (review N2) — and never deeper than the product's own daily depth
    // (`replayDecisionOf`, which holds every rule above as one pure decision).
    const replaySupply = warmBarsSupply(capture)
    const decision = replayDecisionOf({
      supplyKind: replaySupply.kind, supplyBars: replaySupply.bars, supplyReason: replaySupply.reason,
      file: replaySupply.file, windowBars: bars.length, tf,
      readsOtherSymbol: !!supply.secondary, readsLowerTf: !!lower.lowerTf,
    })
    const replay = decision.replay
    const replayPre = replay ? replaySupply.bars : 0
    const calcBars = replay
      ? toProductBars({ ...capture, bars: { ...capture.bars, rows: replaySupply.rows.concat(capture.bars.rows) } })
      : bars
    const calcCtx = replay ? { ...ctx, historyFromListing: replaySupply.historyFromListing === true } : ctx
    notes.push(`plots/objects: ${decision.kind}: ${decision.why}`)
    const calcCols = registry.computeFor(def, calcBars, instanceInputs, calcCtx)
    const cols = replay ? columnsInWindow(calcCols, replayPre) : calcCols
    // ⭐⭐ THE STRATEGY'S OWN OUTPUT (2026-11-17): what the broker document's run published beside its columns
    const strategy = strategyDoc
      ? strategyRunOf(calcCols, calcBars, replay ? replaySupply.rows.concat(capture.bars.rows) : capture.bars.rows)
      : null
    // ⭐ B1 — each carried paint's colour on every bar, through the binder's own
    // `paintColoursFor` (the function the chart draws with), keyed as the binder keys.
    // ⭐⭐ RC1 — over [prehistory + window] when a proved supplier exists
    // (`warmBarsSupply`), then SLICED to the window. (DIV-1: the plot and object
    // lanes now take the same supplier, above; the paint lane's own rules — warm
    // even where DIV-1 stays cold — are unchanged.)
    // (asked whenever the script records a paint at all, so a grade whose paints the
    // door folded to `na` still says which history it stands on)
    const recordsPaints = (def.paints || []).length > 0 || runtimeAwarePaints(built, def).length > 0
    const paintSupply = recordsPaints ? replaySupply : null
    if (paintSupply) notes.push(`paints: ${paintSupply.kind}: ${paintSupply.reason}`)
    const warm = !!(paintSupply && paintSupply.kind === 'warm' && (def.paints || []).length > 0)
    const pre = warm ? paintSupply.bars : 0
    const paintBars = warm ? (replay ? calcBars
      : toProductBars({ ...capture, bars: { ...capture.bars, rows: paintSupply.rows.concat(capture.bars.rows) } }))
      : bars
    // ⭐ the warm replay's own context: the listing flag comes from the SUPPLIER
    const paintCtx = warm ? { ...ctx, historyFromListing: paintSupply.historyFromListing === true } : ctx
    // (with DIV-1 replaying, the paint pass is the SAME computation — same bars, same
    // context — so it is read off `calcCols` rather than run twice)
    const paintColsRaw = warm ? (replay ? calcCols : registry.computeFor(def, paintBars, instanceInputs, paintCtx)) : cols
    const paintCols = new Map(Object.keys(paintColsRaw || {}).map((k) => [bindingKey('harness', k), paintColsRaw[k]]))
    const paints = (def.paints || []).map((p) => {
      const all = paintColoursFor(p, 'harness', paintCols, paintBars.length)
      return { kind: p.kind, line: p.line ?? null, title: p.title ?? null,
        colors: Array.isArray(all) ? all.slice(pre) : all }
    })
    // ⭐ G5 — the paints the BIND withheld by name: the column their colour is read from was
    // refused, and the member's disclosure strip (`plotStripNoticesOf`, what the binder
    // publishes) names the paint itself. Read off the columns the paints were computed on.
    const bindWithheldPaints = bindWithheldPaintsOf(def, {
      columnErrors: typeof registry.columnErrors === 'function' ? registry.columnErrors(paintColsRaw || {}) : {},
      notices: plotStripNoticesOf(registry, def, paintColsRaw),
    })
    const lowerReport = registry.lowerTfReport(cols)
    if (lowerReport) {
      for (const c of lowerReport.served) notes.push(`lower timeframe ${c}: served`)
      for (const r of lowerReport.refused) notes.push(`lower timeframe ${r.code}: refused (${r.refusal}) — ${r.reason}`)
    }
    const otherReport = registry.otherSymbolReport(cols)
    if (otherReport) {
      for (const t of otherReport.served) notes.push(`other symbol ${t}: served`)
      for (const r of otherReport.refused) notes.push(`other symbol ${r.ticker}: refused (${r.code}) — ${r.reason}`)
    }
    // ⭐ C36 — a plot whose `time(<timeframe>)` is withheld on this chart, by name.
    // ⭐⭐ C45 — and one whose value depends on `bar_index` off the listing
    // (`bar-index:window`). A plot the door withholds on EVERY bar, by name, has
    // NO served value: it is graded "not compared — withheld by name", never as a
    // value that differs. ⚰️ Graded as a column of `na` it read DIVERGE, the
    // verdict a WRONG value gets, which is the one thing a withholding is not.
    // ⭐⭐ 2026-11-09 (`fix/pine-cumulative-off-listing`, triage lane WN) — EVERY
    // whole-series code, not only `bar-index:window`. ⚰️ The C36 codes
    // (`time-anchor:not-daily`, `time-own:chart-unwitnessed`, …) were left out "to
    // keep another lane's verdict", and their all-`na` columns graded DIVERGE: 13
    // captures over vw-time-tf / vw-bar-counters / vw-bar-origin read as WRONG
    // values where the door had withheld them by name. A per-bar code
    // (`time-anchor:period-open-missing`, `bar-index:early-bars`, …) withholds some
    // bars; a plot it names whose column holds NO value on any bar is withheld
    // whole just the same, and graded the same way. A plot with values keeps its
    // comparison: the bars the door drew are still judged.
    const withheldWhole = withheldPlotsOf(registry.chartClockReport(cols), cols, notes)
    // ⭐⭐ ENGINE 55 — the plots whose NEWEST bar the door withheld by name
    // (`request:htf-newest-unconfirmed`, `interpret.js::tfMergeMask`): that one bar is
    // not compared (`compare.mjs`, `withheldNewest`), every other bar is.
    const newestHeld = new Set(((registry.chartClockReport(cols) || {}).withheld || [])
      .filter((r) => r.code === TF_MERGE_NEWEST_CODE).flatMap((r) => r.plots))
    // ⭐ REQ-B1 (2026-11-18) — AND THE RUNTIME LANE'S OWN. A run whose request cannot know its newest bar
    // yet withholds that bar on EVERY column, by the same name (`runtimeColumns.js`,
    // `RUNTIME_REQUEST_WITHHELD_KEY`, RS RATING L5): the member reads it blank and named on every plot, so
    // it is not compared on any of them. ⚰️ Unread here, a daily plot of a runtime document that also
    // reads a monthly merge graded DIVERGE on that one named bar (SR-MTF, graded on the runtime lane forced).
    const runNewest = cols && cols[RUNTIME_REQUEST_WITHHELD_KEY]
    if (runNewest && Array.isArray(runNewest.codes) && runNewest.codes.includes(TF_MERGE_NEWEST_CODE)) {
      // ⭐⭐ HTF-NEWEST-NARROW (2026-11-19) — the plots the run blanked there (`keys`), or every plot (`null`)
      for (const p of (def.plots || [])) {
        if (p && typeof p.key === 'string' && (!Array.isArray(runNewest.keys) || runNewest.keys.includes(p.key))) newestHeld.add(p.key)
      }
    }
    // ⭐ ENGINE 56 — the bars each plot was withheld on by a per-bar witness code
    const withheldBarsReport = registry.withheldBarsReport(calcCols)
    let colours
    // ⭐ DIV-1 — the plot colours the binder draws over the SAME replayed bars the
    // values were computed on, each sliced to the window.
    let calcColours = null
    try {
      if (replay) {
        calcColours = drawnColours(def, calcBars, calcCtx, instanceInputs)
        colours = { ...calcColours,
          byKey: new Map([...calcColours.byKey].map(([k, c]) => [k, Array.isArray(c) ? c.slice(replayPre) : c])),
          paints: null }
      } else {
        colours = drawnColours(def, bars, ctx, instanceInputs)
      }
    } catch (err) {
      colours = { ok: false, reason: `binder threw: ${String((err && err.message) || err)}`, byKey: new Map() }
    }
    if (!colours.ok) notes.push(`colours unresolvable: ${colours.reason}`)
    // ⭐ RC1 — what the binder hands the chart for the PAINTS, over the same warm
    // bars the paints were graded on, sliced to the window (backgrounds by index,
    // candle overrides by the window's own bar times).
    let drawnPaints = colours && colours.paints ? colours.paints : null
    if (warm) {
      try {
        // (the DIV-1 pass above IS this pass when it replayed: same bars, same context)
        const w = replay && calcColours ? calcColours : drawnColours(def, paintBars, paintCtx, instanceInputs)
        const keep = new Set(bars.map((b) => String(b.t)))
        drawnPaints = w && w.paints ? {
          backgrounds: w.paints.backgrounds.map((b) => ({ ...b, colors: Array.isArray(b.colors) ? b.colors.slice(pre) : b.colors })),
          barColours: w.paints.barColours
            ? new Map([...w.paints.barColours].filter(([t]) => keep.has(String(t)))) : w.paints.barColours,
        } : null
      } catch (err) {
        notes.push(`paints: the warm binder pass threw (${String((err && err.message) || err)}); no drawn paints`)
        drawnPaints = null
      }
    }

    const rowByAst = new Map((built.rows || []).map((r) => [r.ast, r]))
    // ⭐ A RUNTIME-LANE document (`memberPaneDefinition`'s route for a script the
    // columnar lane refuses) has no tree per output — each row names the host
    // output it draws instead, and is matched by that.
    const rowByOutput = new Map((built.rows || [])
      .filter((r) => Number.isInteger(r.output)).map((r) => [r.output, r]))
    // ⭐ UIE PHASE 2 — a runtime run off the listing WITHHOLDS its warm-up
    // (`runtimeColumns.js::computeOffListing`): those bars are blank on the chart, so
    // they are the plot's warm-up region here, exactly as a tree's own lookback is.
    const curtain = built.lane === 'runtime' ? runtimeWarmupOf(cols) : null
    const plots = []
    const defPlotByKey = new Map((def.plots || []).map((p) => [p.key, p]))
    const defInputByKey = new Map((def.inputs || []).map((x) => [x.key, x]))
    for (const [index, o] of (built.translation.outputs || []).entries()) {
      if (o && o.kind === 'alertcondition') continue
      const row = built.lane === 'runtime'
        ? (rowByOutput.get(index) || null)
        : (o && o.ast ? rowByAst.get(o.ast) : null)
      const heldBy = row ? withheldWhole.get(row.key) : undefined
      // ⚠️ `bar-index:window` keeps the shape C45 pinned (no column at all); every
      // other by-name withholding keeps its all-`na` column for the rails that read
      // it, and carries `withheldBy` — which `compare.mjs` grades exactly as it grades
      // a missing column: INCONCLUSIVE, with the reason.
      const col = row && heldBy !== 'bar-index:window' ? cols[row.key] : undefined
      let missingReason = null
      if (heldBy) {
        missingReason = `withheld on this chart on every bar, by name (${heldBy}) — nothing is drawn for it`
      } else if (!row) {
        missingReason = o && o.refusal
          ? `the translator refused this plot (${(o.refusal && (o.refusal.guard || o.refusal.message)) || 'refusal'})`
          : 'the member pane did not carry this output (hidden helper or beyond its row ceiling)'
      } else if (!col) {
        // ⭐ HONESTY-SWEEP r3 — say WHY, when the door recorded it. A runtime run stopped by
        // its wall-clock budget (`runtime:time-budget`, 1,000 ms) read here as a bare "no
        // column", so a measure-pair could not tell a load-sensitive stop from a lane that
        // dropped its columns (delta-rsi RDDT, MATCH -> INCONCLUSIVE, 2026-11-08).
        const why = registry.columnErrors(cols)[row.key]
        missingReason = `computeFor returned no column for ${row.key}`
          + (why && why.guard ? ` (${why.guard})` : '')
          // ⭐ ENGINE 55 (review M1) — a refusal carrying its own code (a spelling no binding serves)
          // says its whole sentence, so a grade reads WHY that one plot is not drawn.
          + (why && why.code && why.message ? ` — ${why.message}` : '')
      }
      const heldBars = row && col ? withheldBarsOf(withheldBarsReport, row.key, replayPre) : null
      if (heldBars) notes.push(`${row.key}: ${heldBars.bars.filter(Boolean).length} bar(s) withheld by name (${heldBars.codes.join(', ')}) — not compared`)
      // ⭐⭐ ENGINE 58 — what the door said about this row's colour: withheld whole
      // by name (graded "not compared", INCONCLUSIVE with the name), withheld on the
      // bars its rule gives no colour (`COLOUR_WITHHELD_POINT`, counted), or a THEME
      // reference (`chart.fg_color@85`: our chart's own colour, theme-relative).
      const defPlot = row ? defPlotByKey.get(row.key) : null
      const cw = defPlot && defPlot.colorWithheld && typeof defPlot.colorWithheld.code === 'string' ? defPlot.colorWithheld : null
      const wholeWithheld = !!(cw && !cw.points)
      const rawColour = defPlot && typeof defPlot.color === 'string' && defPlot.color.startsWith('$')
        ? ((defInputByKey.get(defPlot.color.slice(1)) || {}).default) : (defPlot && defPlot.color)
      // ⛔ A WHOLE-WITHHELD colour draws in the chart's neutral ink (a theme reference,
      // `memberPaneDefinition.WITHHELD_COLOUR_INK`) and is NOT theme-relative: it is not
      // the script's colour, so it is not compared at all (INCONCLUSIVE by name).
      const themeRelative = !wholeWithheld && isThemeColour(rawColour)
      plots.push({
        title: o ? o.title : null,
        // the call that made it (`plot`, `plotshape`, ...): the strategy grade pairs `plot()` outputs only
        kind: o && typeof o.kind === 'string' ? o.kind : null,
        formula: o ? o.formula : null,
        key: row ? row.key : null,
        withheldBy: heldBy || null,
        withheldNewest: !!(col && row && newestHeld.has(row.key) && col.length > 0 && !(col[col.length - 1] === col[col.length - 1])),
        // ⭐ ENGINE 56 — 0/1 per window bar: withheld by name, graded "not compared"
        withheldBars: heldBars ? heldBars.bars : null,
        withheldBarsCodes: heldBars ? heldBars.codes : null,
        // ⭐ ENGINE 56 (S4-4) — the float-order floor where a running total feeds the plot
        floatOrderFloor: built.lane !== 'runtime' && o && o.ast && col ? floatOrderFloorOf(o.ast, calcBars, replayPre) : null,
        hidden: !!(o && o.hidden),
        column: col || null,
        missingReason,
        lookback: curtain ? curtain.withheldBars : (o && o.ast ? lookbackOf(o.ast) : null),
        // ⭐ DIV-1 — the bars of proved prehistory this plot was computed over before
        // the window (`compare.mjs` reads it into the warm-up region), or null (cold).
        historyReplayed: replay ? { bars: replayPre, file: replaySupply.file } : null,
        // ⭐ F2 — the colour rule's own reach (`compare.mjs::colourWarmupOf`).
        colorLookback: colourRuleLookback(o),
        colors: !wholeWithheld && row && colours.byKey.has(row.key) ? colours.byKey.get(row.key) : null,
        ...(themeRelative ? { colorsThemeRelative: true } : {}),
        ...(cw && cw.points ? { colorsWithheldBy: cw.code } : {}),
        // A positive `offset = N` the translator wrote INTO the tree as `x[N]`
        // (its `_treeShift` hand-off) — see compare.mjs `leadBy`.
        treeShift: o && Number.isInteger(o._treeShift) && o._treeShift > 0 ? o._treeShift : 0,
        // Why there are no colours, when there are none — so the verdict names the
        // cause instead of "could not be resolved".
        colorsReason: wholeWithheld ? `withheld by name (${cw.code}) — ${cw.reason}`
          : row && !colours.byKey.has(row.key)
          ? (o && o.hidden
            ? `our pane draws no series for this row — hidden (${o.hiddenReason || 'unstated'})`
            : (colours.ok ? 'the binder bound no series for this row' : colours.reason))
          : null,
      })
    }
    // ⭐ RT4 — the binder's own gate: a runtime document whose run computed
    // nothing here draws none of its object program (`runtimeObjectsWithheld`).
    const objectsWithheld = registry.runtimeObjectsWithheld(def, cols)
    const objects = objectsWithheld
      ? { drawsObjects: true, ok: false, withheld: objectsWithheld.guard, reason: `withheld by name (${objectsWithheld.guard}) — ${objectsWithheld.message}` }
      // ⭐ DIV-1 — the LIVE set at the last bar of the replayed series: the window's
      // last bar, after every bar TradingView ran before it
      : objectsOf(def, calcBars, calcCtx, calcCols, built, instanceInputs)
    // ⭐⭐ U13 (G1) — WHERE OUR x LIVES, in BOTH lanes (the host object lane and the
    // runtime's RT5 object store answer through `objectsOf`): the bars the object lane
    // ran on, and where the capture's window starts in them (the DIV-1 prehistory, if
    // replayed). Our `bar_index` x is an index into `bars`; `objectRecords.js::
    // ourXResolver` turns it, or a `bar_time` x, into the window bar the vendor's x is
    // graded against. ⛔ Test infrastructure only: never written to a verdict file.
    if (objects && objects.ok) {
      objects.xFrame = { bars: calcBars, windowStart: replayPre, windowBars: bars.length, tf: calcCtx.tf }
    }
    for (const r of (objects && objects.chartClock) || []) {
      const what = r.code.startsWith('bar-index:') ? '`bar_index`' : 'time(<timeframe>)'
      notes.push(`${what} withheld (${r.code}) in the object lane — ${r.reason}`)
    }
    if (objects && objects.ok && objects.drawn) {
      for (const f of ['lines', 'labels', 'boxes']) {
        const gap = objects.counts[f] - objects.drawn[f]
        if (gap > 0) notes.push(`${gap} of ${objects.counts[f]} held ${f} cannot be drawn (a coordinate is na) — counted as held, the way the capture counts them`)
      }
    }
    return {
      ok: true,
      refusal: null,
      plots,
      objects,
      // ⭐ SETTINGS PARITY (2c) — `{Pine name: TradingView value}` for every setting the capture moved
      capturedInputs: taken.moved,
      ctx,
      notes,
      bars,
      // ⭐ B1 — what the door carried (every call, withheld ones included, in source
      // order), what the document draws, and what the binder handed the chart.
      paints,
      // ⭐ RC1 — which bars the paints were replayed over: `warm` (with the
      // supplier's file and bar count), `cold`, or `bar0`. Read by `gradePaints`.
      paintSupply: paintSupply ? { kind: paintSupply.kind, file: paintSupply.file, bars: paintSupply.bars,
        replayed: warm,
        historyFromListing: warm ? paintCtx.historyFromListing : ctx.historyFromListing,
        refused: paintSupply.refused, reason: paintSupply.reason,
        // ⭐ NUMBER PENDING (harness, fix/kill-spy-runtime-diverges) — the bars of the window the RUNTIME lane withholds
        // by name off the listing (its warm-up curtain, `runtimeColumns.js::computeOffListing`): no colour is drawn
        // there, exactly as no plot value is (the plot grade's `lookback`). `gradePaints` excuses a withheld bar there,
        // never a bar painted differently.
        curtainBars: (() => {
          const c = built.lane === 'runtime' ? runtimeWarmupOf(paintColsRaw || {}) : null
          return c && Number.isInteger(c.withheldBars) ? Math.max(0, c.withheldBars - pre) : 0
        })() } : null,
      // ⭐ DIV-1 — which bars the PLOT and OBJECT lanes were computed over.
      historyReplay: { kind: decision.kind, file: replay ? replaySupply.file : null, bars: replayPre,
        historyFromListing: calcCtx.historyFromListing === true, reason: decision.why,
        // ⚠️ review N3 — what a replayed MATCH speaks for
        speaksFor: replay ? 'the standalone daily chart (not a grid cell, which first-paints shallow; W / M stay cold)' : null },
      translationPaints: runtimeAwarePaints(built, def),
      // ⭐⭐ (2026-11-19, held evidence) the document the grade was taken on: the host lane's or the runtime lane's
      // (a narrow withhold is honoured by the door that drew the element)
      door: built.lane === 'runtime' ? 'runtime' : 'host',
      // ⭐ G5 — read by `paintColours.gradePaints` where the binder drew nothing
      bindWithheldPaints,
      drawnPaints,
      // ⭐ ENGINE 53 — what the door did with the run half (minted / declined by code); the bind's
      // answer (served / refused) rides on `objects.runHalf`.
      runHalfDoor: built.runHalf ? 'minted' : (built.runHalfDeclined ? `declined:${built.runHalfDeclined.code}` : null),
      // ⭐ L7 — the inputs this run answered with the VENDOR's value in place of UCT data
      // (`substitutedInputsOf`); `[]` until a lane feeds one.
      // ⭐ RS RATING L3 — `syminfo.industry` / `sector`, fed the capture's value (`symbolOf`).
      substituted: substitutedInputsOf(capture, classificationSubstitutions(source, ctx.symbol, capture)),
      // ⭐⭐ (2026-11-17) — a broker document's run: its record, or why it published none (`strategyRunOf`);
      // null for every other document. Graded by `strategyLane.js`.
      strategy,
    }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}
