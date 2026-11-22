// app/src/components/chart/engine/__tests__/rsSplitTestKit.js
//
// ─── UCT RS split, unit U6 — what the three definition tests share ──────────
//
// `rsRatingDef.test.js`, `rsPhasesDef.test.js` and `rsVsEmaDef.test.js` each
// pin ONE registered server definition against the same five claims (schema,
// server inputs, scalar paths, the definition gate, a placed instance drawn
// through the real binder on a fixture envelope). The pieces that are the same
// for all three live here, so a change to the harness is one change.
//
// ⛔ THE CONTRACT IS READ, NEVER RETYPED: `rsSplitContract.json` is the JS copy
// of `tests/test_rs_split_rows.py::RS_SPLIT_CONTRACT`, and
// `tests/test_rs_split_js_rows.py` pins the two equal.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import contract from './rsSplitContract.json'
import { createFakeChart } from './fakeChart'
import { createBinder } from '../binder'
import * as engineRegistry from '../nativeRegistry'
import { resolveInputs } from '../nativeRegistry'
import { primeServerColumns, clearServerColumns, pickServerInputs } from '../serverCompute'
import { parseReadoutSource } from '../readoutSchema'

export const RS_SPLIT_CONTRACT = contract

/** The repo-root fixtures, resolved from `app/` or from the root (the
 *  `rsIndicator.golden.test.js` rule): fail loudly when neither hits. */
const FIX = [
  join(process.cwd(), '..', 'tests', 'fixtures', 'indicators'),
  join(process.cwd(), 'tests', 'fixtures', 'indicators'),
].find((p) => existsSync(join(p, 'rs_phases_spy.json')))
if (!FIX) {
  throw new Error(`indicator fixtures not found from cwd ${process.cwd()} — expected tests/fixtures/indicators/rs_phases_spy.json at the repo root`)
}
export const loadCase = (name) => JSON.parse(readFileSync(join(FIX, `${name}.json`), 'utf8'))

/** Every `scalar:` path a definition reads, wherever the readout grammar lets it:
 *  readout rows (source, when, note, muted, band.source, card.evidenceSource),
 *  `meta.legendFallback` and `meta.paneTable` (columns, when, band.when). */
export function scalarPathsOf(def) {
  const out = new Set()
  const take = (v) => {
    const p = typeof v === 'string' ? parseReadoutSource(v) : null
    if (p && p.kind === 'scalar') out.add(p.path.join('.'))
  }
  for (const row of def.readout || []) {
    for (const k of ['source', 'when', 'note', 'muted']) take(row[k])
    if (row.band) take(row.band.source), take(row.band.when)
    if (row.card) take(row.card.evidenceSource)
  }
  for (const e of (def.meta && def.meta.legendFallback) || []) { take(e.source); take(e.when); take(e.muted) }
  const pt = def.meta && def.meta.paneTable
  if (pt) {
    for (const c of pt.columns || []) take(c.source)
    for (const g of Array.isArray(pt.when) ? pt.when : (pt.when ? [pt.when] : [])) take(g)
    if (pt.band) take(pt.band.when)
  }
  return [...out].sort()
}

/** Every member-facing label on a definition (inputs, plots, readout rows, the
 *  pane table): the repo rule is at most 18 characters, the long form in the tooltip. */
export function labelsOf(def) {
  const out = []
  for (const i of def.inputs || []) if (typeof i.label === 'string') out.push(['input', i.key, i.label])
  for (const p of def.plots || []) if (typeof p.label === 'string') out.push(['plot', p.key, p.label])
  for (const r of def.readout || []) if (typeof r.label === 'string') out.push(['readout', r.key, r.label])
  for (const c of (def.meta && def.meta.paneTable && def.meta.paneTable.columns) || []) out.push(['paneTable', c.key, c.label])
  return out
}

/** The wire envelope the columns route answers, from a fixture's expected
 *  columns (null-padded, aligned to its bars) and a payload. */
export function wireFrom(bars, columns, payload, rev = 1) {
  return { times: bars.map((b) => b.t), rev, columns, payload }
}

const SYM = 'NVDA'
const TF = 'D'
export const CTX = Object.freeze({ sym: SYM, tf: TF })

/** Land an envelope for `def` at its default server inputs (what a placed
 *  instance with no stored inputs asks for). */
export function primeEnvelope(def, wire, inputs = {}) {
  clearServerColumns()
  const sent = pickServerInputs(def, resolveInputs(def, inputs))
  const primed = primeServerColumns(def.id, SYM, TF, sent, wire)
  if (!primed) throw new Error(`${def.id}: the fixture envelope was refused by primeServerColumns`)
  return sent
}

/** A placed instance of `def` — a member's own add, not a legacy toggle. */
export const placed = (def, inputs = {}) => ({ instanceId: `user:${def.id}:1`, defId: def.id, inputs, hidden: false })

/** The binder test's placement fake and `_applyData` stand-in, verbatim. */
const placementFake = (instance) => ({ paneIndex: 1, scaleId: instance.defId,
  scaleOptions: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 }, autoScale: true } })
const applyDataLike = (plan) => (series, data) => {
  if (!series || !data) return
  if (plan.noop) return
  if (plan.incr && data.length) { series.update(data[data.length - 1]); return }
  series.setData(data)
}

/**
 * ONE binder pass over `instances` on `bars` with the fake chart: what the
 * real `StockChart` hands the binder, with the server lane's `{sym, tf}`.
 * Returns the fake (its `calls`, `seriesCreated`) and the sync result.
 */
export function bindOnce(instances, bars, { plan = { fresh: true } } = {}) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const result = binder.sync({
    enabled: true,
    instances,
    registry: engineRegistry,
    bars,
    adjustTime: (t) => t,
    plan,
    applyData: applyDataLike(plan),
    resolvePlacement: placementFake,
    sym: SYM,
    tf: TF,
  })
  return { fake, binder, result }
}

/** The data series the pass created, by the plot key the binder stamped on it
 *  (`series.__options.title` is not reliable; the setData payload is). */
export function seriesWithData(fake) {
  return fake.seriesCreated.filter((s) => fake.calls.some((c) => c.id === s.__id && c.method === 'setData'))
}
