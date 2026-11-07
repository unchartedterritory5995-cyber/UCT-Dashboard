// services/pine_runtime/canary.mjs
//
// W5-T9: THE PARITY CANARY (docs/pine/SERVER-RUNTIME-DESIGN.md 3.8). At boot, and then every 15
// minutes, the service runs CANARY_CASES (10 cases of the T4 host-parity corpus) THROUGH ITS OWN
// POOL (worker, sandbox, adapter and wire encoding: the exact path a member's job takes) and
// compares each answer's digest with `expected-digests.json`, the file T4 commits. A mismatch sets
// readiness false and logs `[pine-runtime] CANARY DIVERGED case=<name>`: a bad build or a V8
// surprise is seen here before any alert reads it.
//
// ONE NORMALISATION: the wire answer is turned into the host-parity record by T4's own
// `recordOf` (tools/pine_runtime_host_parity.mjs), which digests with T3's codec. The corpus, the
// bars generator, the artifact-neutral bundle sha and the expected file are T4's; nothing is
// retyped here. (T10: the image must ship that tool, the codec and the fixture directory.)
//
// VERDICTS. A case is `ok` (record equals the committed one), `diverged` (it does not), or
// `inconclusive` (the pool stopped it for a reason that says nothing about the engine: a queue
// deadline or the wall-clock stop). An inconclusive case is never a verdict (design H5): it can
// neither turn the canary red nor green. A canary that has never been green is not ready.
//
// NO LICENCE-HELD TEXT: the corpus is first-party Pine; bars come from fixed seeds.
import {
  ARTIFACT_NEUTRAL_SHA, COMPARED, FIXTURE_DIR, caseList, loadCorpus, makeBars, recordOf,
} from '../../tools/pine_runtime_host_parity.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BAR_COLUMNS } from './protocol.mjs'
import { BUSY_GUARD } from './pool.mjs'

/** The 10 cases. Eight computed, two withheld by name (so a wrong refusal is seen as well as a wrong
 *  value). All on the 1,500-bar `listing` set: cheap enough to run every 15 minutes on a busy pool. */
// Engine 21 (W6-T5) serves arrays_sort, so its withheld slot moved to h_request_security (runtime:request,
// refused at build: cheap, and a by-name refusal the engine must keep giving).
export const CANARY_CASES = Object.freeze([
  'ema_macd@listing', 'rsi_stoch@listing', 'supertrend@listing', 'bollinger@listing',
  'dmi_manual@listing', 'pivots@listing', 'rma_alma_hma@listing', 'methods_udt@listing',
  'h_request_security@listing', 'dmi_adx@listing',
])
/** The lowest priority: a canary must never take a worker from an alert. */
export const CANARY_PROFILE = 'sweep'
export const CANARY_OWNER = 'hmac:00000000000000ca'
export const CANARY_INTERVAL_MS = 15 * 60 * 1000
/** Stops that describe the pool's load or the wall clock, never the engine (H5). */
export const INCONCLUSIVE_GUARDS = Object.freeze([BUSY_GUARD, 'runtime:time-budget'])
export const DIVERGED_PREFIX = '[pine-runtime] CANARY DIVERGED'

/** The cases (def, ctx, rows) and the committed records, read from T4's fixture directory. */
export function loadCanaryInputs({ dir = FIXTURE_DIR, names = CANARY_CASES } = {}) {
  const corpus = loadCorpus(dir)
  const expected = JSON.parse(readFileSync(join(dir, 'expected-digests.json'), 'utf8'))
  const all = new Map(caseList(corpus, dir).map((c) => [c.case, c]))
  const rowsBySet = new Map()
  const cases = names.map((name) => {
    const c = all.get(name)
    if (!c) throw new Error(`canary case ${name} is not in the host-parity corpus`)
    if (!expected.cases[name]) throw new Error(`canary case ${name} has no committed digest`)
    if (!rowsBySet.has(c.set)) rowsBySet.set(c.set, makeBars(corpus.barSets[c.set]))
    return { name, def: c.def, ctx: c.ctx, rows: rowsBySet.get(c.set) }
  })
  return { cases, expected }
}

/** A runner request for one case, in the parsed shape protocol.parseRunRequest hands the pool. */
function requestOf(c, identity) {
  const n = c.rows.length
  const bars = { n, sha256: '0'.repeat(64) }
  for (const k of BAR_COLUMNS) bars[k] = Float64Array.from(c.rows, (r) => r[k])
  return {
    protocol: 1, profile: CANARY_PROFILE, owner: CANARY_OWNER, engine: { ...identity },
    definition: { def_id: `canary:${c.name}`.slice(0, 64), version: 1, doc_sha256: '0'.repeat(64), doc: c.def },
    jobs: [{
      job: c.name, symbol: c.ctx.symbol, tf: c.ctx.tf, bars,
      ctx: { newestBarIsForming: c.ctx.newestBarIsForming, historyFromListing: c.ctx.historyFromListing === true, runtimeInputs: {} },
      want: [],
    }],
  }
}

/** One wire answer -> T4's record (the same digest the committed file holds). */
export function recordOfResult(result, identity) {
  if (result.status === 'ok') {
    return recordOf({ ok: true, encoded: { columns: result.columns || {}, nonNumeric: [] }, warmup: null }, identity)
  }
  const ref = (result.refusals || []).find((r) => r.key === '*') || (result.refusals || [])[0] || {}
  return recordOf({ ok: false, error: { name: 'Error', guard: ref.guard || null, bar: ref.bar } }, identity)
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Run every case once through `run` (the pool's runner) and compare with the committed records.
 * Never throws: a runner that throws is a diverged case (the pool failed the canary's own job).
 * @returns {Promise<{verdict:'green'|'red'|'inconclusive', checked:number, diverged:object[], inconclusive:string[], ms:number}>}
 */
export async function runCanary({ run, inputs, identity, now = () => performance.now() }) {
  const started = now()
  // the committed digests are taken on the ARTIFACT-NEUTRAL identity (T4 decision 1); the other
  // four fields are the live ones, so an engine bump that skipped `--write` is red by name
  const ident = { ...identity, bundle_sha256: ARTIFACT_NEUTRAL_SHA }
  const diverged = []
  const inconclusive = []
  const moved = ['script_engine', 'runtime_language', 'runtime_frontend', 'runtime_ir']
    .filter((k) => String(inputs.expected.identity[k]) !== String(identity[k]))
  if (moved.length) diverged.push({ case: 'engine-identity', field: moved.join(','), expected: null, got: null })
  for (const c of inputs.cases) {
    let result
    try {
      result = (await run(requestOf(c, identity)))[0]
    } catch (e) {
      diverged.push({ case: c.name, field: 'run', expected: 'an answer', got: (e && e.guard) || 'the pool threw' })
      continue
    }
    const got = recordOfResult(result, ident)
    if (got.status === 'inconclusive' || (got.status === 'withheld' && got.guards.some((g) => INCONCLUSIVE_GUARDS.includes(g)))) {
      inconclusive.push(c.name)
      continue
    }
    const want = inputs.expected.cases[c.name]
    for (const f of COMPARED.filter((x) => x !== 'warmup')) {
      if (!sameJson(want[f], got[f])) diverged.push({ case: c.name, field: f, expected: want[f] ?? null, got: got[f] ?? null })
    }
  }
  const verdict = diverged.length ? 'red' : inconclusive.length ? 'inconclusive' : 'green'
  return { verdict, checked: inputs.cases.length - inconclusive.length, diverged, inconclusive, ms: Math.round(now() - started) }
}

/**
 * The canary as the service holds it: `ok()` is readiness' question, `status()` is /v1/metrics'.
 * `ok()` is true only after a green run and stays true through an inconclusive one; a red run
 * clears it until the next green run.
 */
export function createCanary({ run, inputs, identity, intervalMs = CANARY_INTERVAL_MS, log = console.log, clock = () => Date.now(),
  setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let ok = null // null: never decided
  let last = null
  let runs = 0
  let reds = 0
  let timer = null
  let running = null

  function once() {
    if (running) return running
    running = (async () => {
      const r = await runCanary({ run, inputs, identity })
      runs += 1
      if (r.verdict === 'green') ok = true
      else if (r.verdict === 'red') {
        ok = false
        reds += 1
        for (const d of r.diverged) log(`${DIVERGED_PREFIX} case=${d.case} field=${d.field}`)
      }
      last = { at: clock(), verdict: r.verdict, checked: r.checked, ms: r.ms, diverged: r.diverged.map((d) => d.case), inconclusive: r.inconclusive }
      return r
    })().finally(() => { running = null })
    return running
  }

  return {
    runOnce: once,
    /** Every `intervalMs` from now. The timer never keeps the process alive. */
    start() {
      if (timer) return
      timer = setTimer(() => { once().catch(() => {}) }, intervalMs)
      if (timer && typeof timer.unref === 'function') timer.unref()
    },
    async stop() { if (timer) clearTimer(timer); timer = null; if (running) await running.catch(() => {}) },
    ok: () => ok === true,
    status: () => ({ ok, runs, reds, intervalMs, last }),
  }
}
