// tools/pine_runtime_host_parity.mjs
//
// W5 T4 — THE HOST-PARITY RAIL, NODE HALF (docs/pine/SERVER-RUNTIME-DESIGN.md 2.3, HP-1 .. HP-7).
//
// One semantic source, two hosts: the SERVER BUNDLE (`app/dist-server/pine-runtime.mjs`, T1) and
// the browser's real `runtimeWorker-*.js` chunk must compute byte-identical columns. Each run of a
// corpus case is reduced to ONE sha256 by the canonical codec (T3, `runtime/columnDigest.js`), and
// the digests are committed in `runtime/__fixtures__/hostParity/expected-digests.json`.
//
//   --host node [--bundle <mjs>] --check      HP-1 + HP-5: run the BUNDLE (built fresh into a temp
//                                             dir unless --bundle is given) over the corpus and
//                                             compare with expected-digests.json. Exit 0 equal, 1 red
//                                             (by case name), 2 inconclusive, 130 INTERRUPTED (SIGINT /
//                                             SIGTERM / SIGHUP mid-run: no verdict, nothing written).
//   --host node [--bundle <mjs>] --out <json> write this host's records (no compare)
//   --write                                   regenerate expected-digests.json. REFUSES to change an
//                                             existing case's digest unless the engine identity
//                                             moved (the coordinator's SCRIPT_ENGINE_VERSION bump).
//   --mutation-control [--bundle <mjs>]       HP-4: one operator of the bundle's VM through
//                                             `Math.fround`; the rail must go red BY CASE NAME.
//   --emit-jobs <json>                        the Chromium half's input (the SAME defs, rows, ctx).
//   --digest-raw <raw.json> --out <json>      the Chromium half's raw worker answers -> records,
//                                             through the SAME recordOf() the Node half uses.
//   --compare <a.json> <b.json>               HP-3 + HP-5: two record files agree case by case.
//   --adapters                                HP-7: the worker's call and this host's call build the
//                                             same (def, rows, ctx, opts), by a static parse.
//                                             W5-INT: THIS tool's Node half only. The SERVICE's
//                                             adapter (services/pine_runtime/job.mjs) has ONE HP-7
//                                             authority, services/pine_runtime/test/adapter.test.mjs,
//                                             which requires its budgetMs to be the worker's own
//                                             (RUNTIME_PANE_TIME_BUDGET_MS). This tool exempts budgetMs
//                                             for its measurement host only, so it no longer reads
//                                             job.mjs (two rails, two rules, was the W5-T7b finding).
//
// ⛔ THE DIGEST'S `bundle_sha256` IS ARTIFACT-NEUTRAL (64 zeros). The parity claim is about the
// COLUMNS two different artifacts compute; the artifact's own sha256 is HP-6's and the canary's
// business. With the real sha in the preimage the two hosts could never agree (two artifacts) and
// every refactor would move every committed digest. The other four identity fields are LIVE, read
// from the bundle's exports, so an engine bump moves every digest — which is what makes
// "a digest change without an engine bump is red" mechanical.
//
// ⛔ NO LICENCE-HELD TEXT. The corpus is original first-party Pine (corpus/*.pine) plus the
// hostile corpus of design section 4; the bars are generated from fixed seeds here.
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const APP = join(REPO, 'app')
export const RUNTIME_DIR = join(APP, 'src', 'components', 'chart', 'engine', 'runtime')
export const FIXTURE_DIR = join(RUNTIME_DIR, '__fixtures__', 'hostParity')
export const EXPECTED_FILE = join(FIXTURE_DIR, 'expected-digests.json')
export const ARTIFACT_NEUTRAL_SHA = '0'.repeat(64)
/** A stop that depends on the wall clock: never a digest, never a verdict (design H5). */
export const NON_DETERMINISTIC_GUARDS = Object.freeze(['runtime:time-budget'])
/** A case the run never finished because the RUN was stopped (SIGINT / SIGTERM / SIGHUP, or the
 *  caller's AbortSignal). Never `runtime:failed` (that is the ENGINE's verdict), never a digest. */
export const INTERRUPTED_GUARD = 'harness:interrupted'
export const INTERRUPTED_EXIT = 130
const interruptedRecord = () => ({ status: 'interrupted', digest: null, guards: [INTERRUPTED_GUARD], warmup: null })

const codec = await import(pathToFileURL(join(RUNTIME_DIR, 'columnDigest.js')).href)

// ─── the corpus ────────────────────────────────────────────────────────────────

/** mulberry32: a 32-bit PRNG in integer arithmetic only, so the bars are the same on every host. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** US Eastern daylight time on a civil date (rules from 2007: 2nd Sunday of March .. 1st Sunday of Nov). */
function easternDst(y, m, d) {
  const nthSunday = (month, n) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay()
    return 1 + ((7 - first) % 7) + 7 * (n - 1)
  }
  const start = nthSunday(2, 2)
  const end = nthSunday(10, 1)
  if (m < 2 || m > 10) return false
  if (m > 2 && m < 10) return true
  return m === 2 ? d >= start : d < end
}

/** Weekday session opens (unix seconds of 09:30 New York) from a civil start date. */
function* weekdays(startIso) {
  const [y0, m0, d0] = startIso.split('-').map(Number)
  let day = Date.UTC(y0, m0 - 1, d0)
  for (;;) {
    const dt = new Date(day)
    const dow = dt.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const y = dt.getUTCFullYear(), m = dt.getUTCMonth(), d = dt.getUTCDate()
      const utcHour = easternDst(y, m, d) ? 13 : 14
      yield Date.UTC(y, m, d, utcHour, 30) / 1000
    }
    day += 86400000
  }
}

/** One bar set's rows `{t,o,h,l,c,v}`, from its spec in corpus.json. Prices are whole cents. */
export function makeBars(spec) {
  const rnd = mulberry32(spec.seed)
  const times = []
  const perDay = spec.tf === 'D' ? 1 : Math.round((6.5 * 60) / Number(spec.tf))
  const step = spec.tf === 'D' ? 0 : Number(spec.tf) * 60
  for (const open of weekdays(spec.start)) {
    for (let k = 0; k < perDay && times.length < spec.n; k += 1) times.push(open + k * step)
    if (times.length >= spec.n) break
  }
  let c = spec.startCents
  const rows = []
  for (const t of times) {
    const o = Math.max(100, c + Math.round((rnd() - 0.5) * spec.volCents * 0.4))
    c = Math.max(100, o + Math.round((rnd() - 0.5) * 2 * spec.volCents))
    const h = Math.max(o, c) + Math.round(rnd() * spec.volCents * 0.6)
    const l = Math.max(50, Math.min(o, c) - Math.round(rnd() * spec.volCents * 0.6))
    const v = 1000 + Math.floor(rnd() * 5000000)
    rows.push({ t, o: o / 100, h: h / 100, l: l / 100, c: c / 100, v })
  }
  return rows
}

/** sha256 over the rows' canonical Float64 bytes (t o h l c v, row-major): pins the generator. */
export function barsSha256(rows) {
  const buf = new Float64Array(rows.length * 6)
  rows.forEach((r, i) => { buf.set([r.t, r.o, r.h, r.l, r.c, r.v], i * 6) })
  return createHash('sha256').update(new Uint8Array(buf.buffer)).digest('hex')
}

/** A generated hostile source (design section 4) that is too big to commit as a file. */
export function generatedSource(kind) {
  if (kind === 'program-size') {
    const line = '// padding padding padding padding padding padding padding padding padding\n'
    let body = ''
    while (body.length <= 512 * 1024) body += line
    return `//@version=5\nindicator("hp hostile program size", overlay=false)\n${body}plot(close, "c")\n`
  }
  if (kind === 'ir-size') {
    // a balanced tree (depth 12) of 32-term products, each led by its OWN constant so no two
    // subtrees are one expression: ~266k VM instructions, past IR_SIZE (200,000), in ~300 KB of
    // source (under PROGRAM_SIZE) and shallow enough for any parser stack
    const tail = new Array(32).fill('a').join('*')
    let k = 0
    const tree = (d) => (d === 0 ? `${(k += 1)}*${tail}` : `(${tree(d - 1)}+${tree(d - 1)})`)
    return `//@version=5
indicator("hp hostile ir size", overlay=false)
a = close
x = ${tree(12)}
plot(x, "x")
`
  }
  if (kind === 'deep-chain') {
    // a 120,001-term left-associative chain: deep enough to exhaust a parser's stack
    const terms = new Array(120001).fill('a').join('+')
    return `//@version=5
indicator("hp hostile deep chain", overlay=false)
a = close
x = ${terms}
plot(x, "x")
`
  }
  throw new Error(`unknown generated source "${kind}"`)
}

/** `calc_bars_count = N` added to the corpus's one-line `indicator(...)` header. */
export function withCalcBars(source, n) {
  const re = /^(indicator\(.*)\)[ \t]*$/m
  if (!re.test(source)) throw new Error('withCalcBars: no one-line indicator(...) header')
  return source.replace(re, `$1, calc_bars_count=${n})`)
}

/** The plot count of a corpus source: its top-level `plot(` lines. */
export const plotCountOf = (source) => (source.match(/^plot\(/gm) || []).length

export function loadCorpus(dir = FIXTURE_DIR) {
  const corpus = JSON.parse(readFileSync(join(dir, 'corpus.json'), 'utf8'))
  const files = readdirSync(join(dir, 'corpus')).filter((f) => f.endsWith('.pine')).sort()
  const listed = new Set(corpus.scripts.filter((s) => s.file).map((s) => s.file))
  for (const f of files) if (!listed.has(`corpus/${f}`)) throw new Error(`corpus/${f} is not listed in corpus.json`)
  return corpus
}

/** Every case: one script on one bar set. -> [{case, script, set, def, ctx, hostile, expectGuard}] */
export function caseList(corpus, dir = FIXTURE_DIR) {
  const out = []
  for (const s of corpus.scripts) {
    const base = s.file ? readFileSync(join(dir, s.file), 'utf8').replace(/\r\n/g, '\n') : generatedSource(s.generate)
    const sets = s.barSets || Object.keys(corpus.barSets)
    for (const set of sets) {
      const spec = corpus.barSets[set]
      if (!spec) throw new Error(`${s.name}: unknown bar set "${set}"`)
      const source = spec.calcBars ? withCalcBars(base, spec.calcBars) : base
      const n = Math.max(1, plotCountOf(source))
      const outputs = {}
      for (let i = 0; i < n; i += 1) outputs[`p${i}`] = i
      const name = `${s.name}@${set}`
      out.push({
        case: name, script: s.name, set, hostile: !!s.hostile, expectGuard: s.expectGuard || null,
        // the shape `runtimeAsync.messageOf` posts (HP-7)
        def: { id: `hp:${name}`, compute: { kind: 'runtime', fn: `runtime:hp:${s.name}`, outputs, source },
          meta: { runtimeHistory: 'listing' } },
        ctx: { ...spec.ctx },
      })
    }
  }
  return out
}

// ─── one record per run (the ONE normalisation both hosts go through) ───────────

/** Columns -> `{key: base64 of Float64 LE}`. SELF-CONTAINED (no outer reference): the Chromium half
 *  injects `encodeColumnsB64.toString()` into the page, so both hosts encode through this one
 *  function. `null`/`undefined`/holes are NaN; a non-number value is reported, never coerced. */
export function encodeColumnsB64(columns) {
  const out = {}
  const bad = []
  for (const key of Object.keys(columns || {})) {
    const col = columns[key]
    const n = col && typeof col.length === 'number' ? col.length : -1
    if (n < 0) { bad.push(key); continue }
    const f = new Float64Array(n)
    for (let i = 0; i < n; i += 1) {
      const v = col[i]
      if (v === null || v === undefined) f[i] = NaN
      else if (typeof v === 'number') f[i] = v
      else { bad.push(key); break }
    }
    const u = new Uint8Array(f.buffer)
    let s = ''
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000))
    out[key] = btoa(s)
  }
  return { columns: out, nonNumeric: bad }
}

function b64ToF64(text) {
  const bin = Buffer.from(text, 'base64')
  if (bin.length % 8 !== 0) throw new Error('column bytes are not whole Float64 rows')
  const copy = new Uint8Array(bin.length)
  copy.set(bin)
  return new Float64Array(copy.buffer)
}

/** A run's raw answer (the worker's message shape) -> the record that is compared. */
export function recordOf(raw, identity) {
  if (raw.ok) {
    const enc = raw.encoded
    if (enc.nonNumeric.length) {
      return { status: 'failed', digest: null, guards: [`harness:non-numeric:${enc.nonNumeric.sort().join(',')}`], warmup: null }
    }
    const columns = {}
    for (const k of Object.keys(enc.columns)) columns[k] = b64ToF64(enc.columns[k])
    const digest = codec.columnDigest({ engine: identity, columns, refusals: [] })
    return { status: 'ok', digest, guards: [], warmup: raw.warmup || null, keys: Object.keys(columns).sort(), cols: enc.columns }
  }
  const e = raw.error || {}
  const guard = e.guard || `unnamed:${e.name || 'Error'}`
  const bar = Number.isInteger(e.bar) && e.bar >= 0 ? e.bar : null
  if (NON_DETERMINISTIC_GUARDS.includes(guard)) return { status: 'inconclusive', digest: null, guards: [guard], warmup: null }
  const digest = codec.columnDigest({ engine: identity, columns: {}, refusals: [{ key: '*', guard, bar }] })
  return { status: 'withheld', digest, guards: [guard], bar, warmup: null }
}

// ─── the Node half ─────────────────────────────────────────────────────────────

/** Build the server bundle into a fresh temp dir with NO node_modules beside it. */
export async function buildBundle() {
  const { buildPineRuntime } = await import(pathToFileURL(join(APP, 'scripts', 'build-pine-runtime.mjs')).href)
  const dir = mkdtempSync(join(tmpdir(), 'hp-bundle-'))
  const { outfile, manifest } = await buildPineRuntime({ outfile: join(dir, 'pine-runtime.mjs'), logLevel: 'error' })
  return { bundle: outfile, dir, manifest }
}

export function identityOf(rt) {
  return {
    script_engine: rt.SCRIPT_ENGINE_VERSION,
    runtime_language: rt.RUNTIME_FRONTEND_LANGUAGE,
    runtime_frontend: rt.RUNTIME_FRONTEND_VERSION,
    runtime_ir: rt.RUNTIME_IR_VERSION,
    bundle_sha256: ARTIFACT_NEUTRAL_SHA,
  }
}

/** HP-7: this host's call. `incremental: false` is H6 (no session); no `now` (design); no
 *  `budgetMs` — the wall-clock safety stop, whose refusal this rail reads as INCONCLUSIVE (H5). */
function nodeRaw(rt, c, rows) {
  rt.resetRuntimeSessions()
  rt.resetRuntimeLedgers()
  try {
    const columns = rt.computeRuntimeColumns(c.def, rows, c.ctx, { incremental: false })
    const warm = columns && columns.__runtimeWarmup
    return { ok: true, encoded: encodeColumnsB64(columns), warmup: warm ? { ...warm } : null }
  } catch (err) {
    return { ok: false, error: { name: (err && err.name) || 'Error', guard: (err && err.guard) || null,
      bar: err && Number.isInteger(err.bar) ? err.bar : null } }
  }
}

export async function runNode({ bundle, corpus = loadCorpus(), only = null, log = () => {}, rawSink = null, signal = null } = {}) {
  const rt = await import(pathToFileURL(resolve(bundle)).href)
  const identity = identityOf(rt)
  const cases = caseList(corpus).filter((c) => !only || only.includes(c.case) || only.includes(c.script))
  const bars = {}
  const barsSha = {}
  for (const [set, spec] of Object.entries(corpus.barSets)) { bars[set] = makeBars(spec); barsSha[set] = barsSha256(bars[set]) }
  const records = {}
  let interrupted = false
  for (const c of cases) {
    // a case runs synchronously: yield so a pending signal is delivered BETWEEN cases
    await new Promise((r) => setImmediate(r))
    if (signal && signal.aborted) { interrupted = true; records[c.case] = interruptedRecord(); continue }
    const t0 = performance.now()
    const rows = bars[c.set].map((b) => ({ ...b }))
    const raw = nodeRaw(rt, c, rows)
    if (rawSink) rawSink[c.case] = raw
    records[c.case] = recordOf(raw, identity)
    log(`${c.case.padEnd(40)} ${records[c.case].status.padEnd(9)} ${(performance.now() - t0).toFixed(0).padStart(6)} ms ${records[c.case].guards.join(',')}`)
  }
  return { host: 'node', identity, barsSha256: barsSha, records, recordedOn: hostVersions(), interrupted }
}

/** The host's JS engine. NOT part of the digest: two V8 builds can disagree in the last ulp of
 *  Math.sin / Math.cos (measured 2026-11-04: V8 13.6 vs 14.5), and naming both sides is what
 *  turns such a red into a diagnosis. */
export const hostVersions = () => ({ node: process.version, v8: process.versions.v8 })

// ─── checks ────────────────────────────────────────────────────────────────────

/** The fields two hosts (or a host and the committed file) must agree on. HP-5 is `guards`. */
export const COMPARED = Object.freeze(['status', 'digest', 'guards', 'warmup'])

/** -> [{case, field, a, b}] for every disagreement; a case missing on either side is one. */
export function compareRecords(a, b) {
  const out = []
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  for (const name of names) {
    const x = a[name], y = b[name]
    if (!x || !y) { out.push({ case: name, field: 'missing', a: !!x, b: !!y }); continue }
    for (const f of COMPARED) {
      if (JSON.stringify(x[f] ?? null) !== JSON.stringify(y[f] ?? null)) out.push({ case: name, field: f, a: x[f], b: y[f] })
    }
  }
  return out
}

// ─── report-only cases (the V8 sin/cos finding) ───────────────────────────────

/** The NAMED report-only list: `corpus.reportOnly = { reason, cases: [case names] }`. Never a
 *  pattern. -> Map(case -> reason). A name that is not a real case is an error. */
export function reportOnlyOf(corpus) {
  const r = corpus.reportOnly
  const out = new Map()
  if (!r) return out
  if (!r.reason || !Array.isArray(r.cases)) throw new Error('corpus.reportOnly needs { reason, cases: [...] }')
  const real = new Set(caseList(corpus).map((c) => c.case))
  for (const name of r.cases) {
    if (!real.has(name)) throw new Error(`reportOnly names "${name}", which is not a corpus case`)
    out.set(name, r.reason)
  }
  return out
}

const _f64 = new Float64Array(1)
const _i64 = new BigInt64Array(_f64.buffer)
/** A double's position on the ordered number line (so adjacent doubles differ by 1). */
function orderedBits(x) {
  _f64[0] = x
  const b = _i64[0]
  return b < 0n ? -(b & 0x7fffffffffffffffn) : b
}

/** Rows that differ bit for bit, and the largest ulp distance, over every column. NaN equals NaN.
 *  -> { rows, total, maxUlp } or null when either side carries no columns. */
export function ulpStats(a, b) {
  if (!a || !b || !a.cols || !b.cols) return null
  let rows = 0, total = 0, maxUlp = 0n
  for (const k of new Set([...Object.keys(a.cols), ...Object.keys(b.cols)])) {
    if (!a.cols[k] || !b.cols[k]) return null
    const x = b64ToF64(a.cols[k]), y = b64ToF64(b.cols[k])
    total += Math.max(x.length, y.length)
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
      const u = x[i], v = y[i]
      if (Number.isNaN(u) && Number.isNaN(v)) continue
      if (Object.is(u, v)) continue
      rows += 1
      if (Number.isNaN(u) || Number.isNaN(v) || !Number.isFinite(u) || !Number.isFinite(v)) { maxUlp = -1n; continue }
      const d = orderedBits(u) - orderedBits(v)
      const ad = d < 0n ? -d : d
      if (maxUlp >= 0n && ad > maxUlp) maxUlp = ad
    }
  }
  return { rows, total, maxUlp: maxUlp < 0n ? 'inf/nan' : Number(maxUlp) }
}

/** `describe(name, reason)` (optional) words the REPORTED line (HP-1 has no columns to measure).
 *  Split diffs into gated RED, REPORTED (a listed case whose ONLY difference is the digest) and
 *  INCONCLUSIVE. -> { red, reported: [{case, text}], inconclusive } */
export function classifyDiffs(diffs, ra, rb, reportOnly = new Map(), describe = null) {
  const inc = new Set(Object.entries({ ...ra, ...rb }).filter(([, r]) => r.status === 'inconclusive').map(([n]) => n))
  const byCase = new Map()
  for (const d of diffs) byCase.set(d.case, [...(byCase.get(d.case) || []), d])
  const red = [], reported = [], inconclusive = []
  for (const [name, ds] of byCase) {
    if (inc.has(name)) { inconclusive.push(...ds); continue }
    if (reportOnly.has(name) && ds.every((d) => d.field === 'digest')) {
      if (describe) { reported.push({ case: name, text: describe(name, reportOnly.get(name)) }); continue }
      const st = ulpStats(ra[name], rb[name])
      const where = st ? `${st.rows}/${st.total} values differ, max ${st.maxUlp} ulp` : 'ulp not measurable (a side carries no columns)'
      reported.push({ case: name, text: `REPORTED ${name}: digest differs; ${where}; ${reportOnly.get(name)}` })
      continue
    }
    red.push(...ds)
  }
  return { red, reported, inconclusive }
}

/** "A fixture that cannot distinguish is not a rail": every ok case has its OWN digest, and the
 *  corpus produces more than one digest. -> a sentence, or null when the corpus distinguishes. */
export function distinguishes(records) {
  const all = Object.values(records).map((r) => r.digest).filter(Boolean)
  if (new Set(all).size < 2) return 'the corpus produces one digest for every case'
  const seen = new Map()
  for (const [name, r] of Object.entries(records)) {
    if (r.status !== 'ok') continue
    if (seen.has(r.digest)) return `cases ${seen.get(r.digest)} and ${name} share one digest`
    seen.set(r.digest, name)
  }
  return null
}

/** Hostile cases must end in their NAMED stop (design section 4). -> [sentence] */
export function hostileFailures(corpus, records) {
  const out = []
  for (const c of caseList(corpus)) {
    if (!c.hostile) continue
    const r = records[c.case]
    if (!r) continue
    if (r.status !== 'withheld' || !r.guards.includes(c.expectGuard)) {
      out.push(`${c.case}: expected the stop ${c.expectGuard}, got ${r.status} ${r.guards.join(',')}`)
    }
  }
  return out
}

const sameIdentity = (a, b) => ['script_engine', 'runtime_language', 'runtime_frontend', 'runtime_ir']
  .every((k) => String(a && a[k]) === String(b && b[k]))

/** --check: the run against the committed file. -> {code, lines} */
export function checkAgainst(expected, got, corpus) {
  const lines = []
  let code = 0
  const inconclusive = Object.entries(got.records).filter(([, r]) => r.status === 'inconclusive').map(([n]) => n)
  for (const [set, sha] of Object.entries(got.barsSha256)) {
    if (expected.barsSha256[set] !== sha) { lines.push(`RED bars "${set}": generator output moved (${sha.slice(0, 12)})`); code = 1 }
  }
  let diffs = compareRecords(expected.cases, got.records).filter((d) => !inconclusive.includes(d.case))
  // W5-T19: HP-1 on a V8 other than the one the digests were recorded on (the gate runs Node 20 =
  // V8 11.3; recorded on V8 13.6). ONLY the NAMED report-only cases, ONLY when their sole difference
  // is the digest, ONLY when the V8 moved. On the recording V8 they are gated like every other case.
  const v8Was = expected.recordedOn && expected.recordedOn.v8, v8Now = got.recordedOn && got.recordedOn.v8
  const v8Moved = Boolean(v8Was && v8Now && v8Was !== v8Now)
  // ONE rule: classifyDiffs (HP-3 uses the same function); the list is empty unless the V8 moved.
  const cls = classifyDiffs(diffs, expected.cases, got.records, v8Moved ? reportOnlyOf(corpus) : new Map(),
    (name, reason) => `REPORTED ${name}: digest differs from the one recorded on V8 ${v8Was}; this run is V8 ${v8Now}; ${reason}`)
  const reportedLines = cls.reported.map((r) => r.text)
  diffs = [...cls.red, ...cls.inconclusive]
  if (diffs.length) {
    code = 1
    const bumped = !sameIdentity(expected.identity, got.identity)
    lines.push(bumped
      ? 'RED the engine identity moved: the coordinator regenerates expected-digests.json with --write at the bump'
      : 'RED a digest changed WITHOUT an engine bump (SCRIPT_ENGINE_VERSION): output-changing engine work')
    for (const d of diffs) lines.push(`RED ${d.case}: ${d.field} ${JSON.stringify(d.b)} != committed ${JSON.stringify(d.a)}`)
    const was = expected.recordedOn && expected.recordedOn.v8, now = got.recordedOn && got.recordedOn.v8
    if (was && now && was !== now) lines.push(`NOTE committed on V8 ${was}, this run is V8 ${now}: a last-ulp Math difference between V8 builds reads as this red`)
  }
  lines.push(...reportedLines)
  const nd = distinguishes(got.records)
  if (nd) { code = 1; lines.push(`RED corpus: ${nd}`) }
  for (const h of hostileFailures(corpus, got.records)) { code = 1; lines.push(`RED hostile ${h}`) }
  if (code === 0 && inconclusive.length) {
    code = 2
    lines.push(`INCONCLUSIVE (wall-clock stop, never a verdict): ${inconclusive.join(', ')}`)
  }
  return { code, lines }
}

/** The HP-1 verdict line. REPORTED cases (a V8 other than the recording V8) are counted apart. */
export function hp1Summary(r, n) {
  const rep = r.lines.filter((l) => l.startsWith('REPORTED ')).length
  if (r.code === 0) return `HP-1 GREEN: ${n - rep}/${n} cases equal the committed digests${rep ? `; ${rep} REPORTED, not gated (V8 differs from the recording V8)` : ''}`
  return r.code === 2 ? 'HP-1 INCONCLUSIVE' : 'HP-1 RED'
}

/** --write: refuse to move an existing case's digest unless the engine identity moved. */
export function writeExpected(prev, got, corpus) {
  const stopped = Object.entries(got.records).filter(([, r]) => r.status === 'interrupted').map(([n]) => n)
  if (got.interrupted || stopped.length) throw new Error(`refused: the run was interrupted (${stopped.length} case(s) never finished)`)
  const ns = distinguishes(got.records)
  if (ns) throw new Error(`refused: ${ns}`)
  const hf = hostileFailures(corpus, got.records)
  if (hf.length) throw new Error(`refused: ${hf.join('; ')}`)
  const inc = Object.entries(got.records).filter(([, r]) => r.status === 'inconclusive')
  if (inc.length) throw new Error(`refused: inconclusive cases ${inc.map(([n]) => n).join(', ')}`)
  if (prev && sameIdentity(prev.identity, got.identity)) {
    const moved = compareRecords(prev.cases, got.records).filter((d) => d.field !== 'missing')
    if (moved.length) throw new Error(`refused: ${moved.length} committed case(s) changed without an engine bump, first ${moved[0].case}`)
    for (const [set, sha] of Object.entries(got.barsSha256)) {
      if (prev.barsSha256[set] && prev.barsSha256[set] !== sha) throw new Error(`refused: bars "${set}" moved without an engine bump`)
    }
  }
  const cases = {}
  for (const name of Object.keys(got.records).sort()) {
    const r = got.records[name]
    cases[name] = { status: r.status, digest: r.digest, guards: r.guards, warmup: r.warmup }
  }
  return { codec: codec.CODEC_TAG, identity: got.identity, recordedOn: got.recordedOn || null, barsSha256: got.barsSha256, cases }
}

// ─── HP-4: the mutation control ────────────────────────────────────────────────

/** The one perturbation: the VM's `+` through `Math.fround`. Exactly one site, or it refuses
 *  (a control that cannot be applied cannot clear anything). */
export const PERTURB_FROM = 'stack[sp - 1] = ADD(stack[sp - 1], y);'
export const PERTURB_TO = 'stack[sp - 1] = Math.fround(ADD(stack[sp - 1], y));'
export function perturb(text) {
  const n = text.split(PERTURB_FROM).length - 1
  if (n !== 1) throw new Error(`perturbation site found ${n} times, expected exactly 1`)
  return text.replace(PERTURB_FROM, PERTURB_TO)
}

// ─── HP-7: adapter agreement (static parse) ────────────────────────────────────

/** Options a host may set that the other does not, each with its reason. Anything else is red. */
export const ADAPTER_EXEMPT = Object.freeze({
  now: 'the injected clock (design HP-7: "minus now")',
  incremental: 'H6: the service runs with no session; the cold path the incremental rails compare against',
  budgetMs: 'H5: the wall-clock safety stop; its refusal is never a verdict (INCONCLUSIVE here). This MEASUREMENT host only: '
    + 'the service adapter passes the worker\'s budget, held by services/pine_runtime/test/adapter.test.mjs',
})

/** -> [{file, args: [text of arg0..2], optKeys}] for every `computeRuntimeColumns(...)` call. */
export function adapterCalls(file) {
  const require = createRequire(join(APP, 'package.json'))
  const acorn = require('acorn')
  const text = readFileSync(file, 'utf8')
  const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' })
  const calls = []
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'CallExpression') onCall(node)
    for (const k of Object.keys(node)) if (k !== 'type' && node[k] && typeof node[k] === 'object') visit(node[k])
  }
  const onCall = (node) => {
      const callee = node.callee
      const name = callee.type === 'Identifier' ? callee.name
        : callee.type === 'MemberExpression' && !callee.computed ? callee.property.name : null
      if (name !== 'computeRuntimeColumns') return
      const opts = node.arguments[3]
      calls.push({
        file, args: node.arguments.slice(0, 3).map((a) => text.slice(a.start, a.end)),
        optKeys: opts && opts.type === 'ObjectExpression'
          ? opts.properties.map((p) => (p.key && (p.key.name || p.key.value)) || '...').sort() : opts ? ['<not a literal>'] : [],
      })
  }
  visit(ast)
  return calls
}

/** The hosts this tool compares. NOT job.mjs: its one HP-7 rail is services/pine_runtime/test/adapter.test.mjs. */
export const ADAPTER_FILES = Object.freeze({
  worker: join(RUNTIME_DIR, 'runtimeWorker.js'),
  node: fileURLToPath(import.meta.url),
})

/** -> {code, lines}. One call per adapter; same option keys modulo ADAPTER_EXEMPT. */
export function checkAdapters(files = ADAPTER_FILES) {
  const lines = []
  let code = 0
  const of = {}
  for (const [name, file] of Object.entries(files)) {
    if (!existsSync(file)) { lines.push(`${name}: ${file} absent (job.mjs is W5-T7's), not compared`); continue }
    const calls = adapterCalls(file)
    if (calls.length !== 1) { code = 1; lines.push(`RED ${name}: ${calls.length} computeRuntimeColumns calls, expected exactly 1`); continue }
    of[name] = calls[0]
  }
  const strip = (keys) => keys.filter((k) => !Object.hasOwn(ADAPTER_EXEMPT, k))
  const base = of.worker
  if (!base) { lines.push('RED worker: no call found'); return { code: 1, lines } }
  for (const [name, call] of Object.entries(of)) {
    const a = JSON.stringify(strip(base.optKeys)), b = JSON.stringify(strip(call.optKeys))
    if (a !== b) { code = 1; lines.push(`RED ${name}: options ${b} != worker's ${a} (exempt: ${Object.keys(ADAPTER_EXEMPT).join(', ')})`) }
    if (call.args.length !== 3) { code = 1; lines.push(`RED ${name}: ${call.args.length} positional arguments before opts`) }
    lines.push(`${name}: args (${call.args.join(', ')}) opts {${call.optKeys.join(', ')}}`)
  }
  return { code, lines }
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

function argOf(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function atomicWrite(file, text) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

export async function main(argv) {
  const log = argv.includes('--quiet') ? () => {} : (s) => console.log(s)
  const only = argOf(argv, '--only') ? argOf(argv, '--only').split(',') : null
  if (argv.includes('--adapters')) {
    const r = checkAdapters()
    r.lines.forEach((l) => console.log(l))
    console.log(r.code === 0 ? 'HP-7 GREEN' : 'HP-7 RED')
    return r.code
  }
  if (argv.includes('--compare')) {
    const i = argv.indexOf('--compare')
    const a = JSON.parse(readFileSync(argv[i + 1], 'utf8')), b = JSON.parse(readFileSync(argv[i + 2], 'utf8'))
    const ra = a.records || a.cases, rb = b.records || b.cases
    const diffs = compareRecords(ra, rb)
    const cls = classifyDiffs(diffs, ra, rb, reportOnlyOf(loadCorpus()))
    for (const d of cls.inconclusive) console.log(`INCONCLUSIVE ${d.case}: ${d.field} ${JSON.stringify(d.a)} != ${JSON.stringify(d.b)}`)
    for (const d of cls.red) console.log(`RED ${d.case}: ${d.field} ${JSON.stringify(d.a)} != ${JSON.stringify(d.b)}`)
    for (const r of cls.reported) console.log(r.text)
    const red = new Set(cls.red.map((d) => d.case)).size
    const inc = [...new Set(cls.inconclusive.map((d) => d.case))]
    const n = Object.keys(ra).length
    console.log(`HP-3 ${red ? 'RED' : inc.length ? 'INCONCLUSIVE' : 'GREEN'}: ${n - red - inc.length - cls.reported.length}/${n} cases equal (digest, guards, status, warmup)${cls.reported.length ? `; ${cls.reported.length} REPORTED, not gated` : ''}`)
    return red ? 1 : inc.length ? 2 : 0
  }
  const corpus = loadCorpus()
  if (argOf(argv, '--emit-jobs')) {
    const out = argOf(argv, '--emit-jobs')
    const bars = {}
    for (const [set, spec] of Object.entries(corpus.barSets)) bars[set] = makeBars(spec)
    const cases = caseList(corpus).filter((c) => !only || only.includes(c.case) || only.includes(c.script))
    atomicWrite(out, JSON.stringify({ bars, cases: cases.map(({ case: name, set, def, ctx }) => ({ case: name, set, def, ctx })),
      encoderJs: encodeColumnsB64.toString() }))
    console.log(`wrote ${cases.length} jobs over ${Object.keys(bars).length} bar sets to ${out}`)
    return 0
  }
  if (argOf(argv, '--digest-raw')) {
    const raw = JSON.parse(readFileSync(argOf(argv, '--digest-raw'), 'utf8'))
    const identity = raw.identity
    const records = {}
    for (const [name, r] of Object.entries(raw.results)) records[name] = recordOf(r, identity)
    const bars = {}
    for (const [set, spec] of Object.entries(corpus.barSets)) bars[set] = barsSha256(makeBars(spec))
    atomicWrite(argOf(argv, '--out'), `${JSON.stringify({ host: raw.host, identity, barsSha256: bars, records }, null, 1)}\n`)
    console.log(`digested ${Object.keys(records).length} ${raw.host} answers`)
    return 0
  }
  let built = null
  let bundle = argOf(argv, '--bundle')
  if (!bundle) { built = await buildBundle(); bundle = built.bundle; log(`bundle ${built.manifest.sha256.slice(0, 12)} ${built.manifest.bytes} bytes`) }
  try {
    if (argv.includes('--mutation-control')) {
      const dir = mkdtempSync(join(tmpdir(), 'hp-perturbed-'))
      try {
        const file = join(dir, 'pine-runtime.mjs')
        writeFileSync(file, perturb(readFileSync(bundle, 'utf8')))
        const got = await runNode({ bundle: file, corpus, only, log: () => {} })
        const r = checkAgainst(JSON.parse(readFileSync(EXPECTED_FILE, 'utf8')), got, corpus)
        const red = r.lines.filter((l) => /^RED [^ ]+@/.test(l))
        red.forEach((l) => console.log(l))
        console.log(red.length ? `HP-4 GREEN: the perturbed bundle is red on ${red.length} case(s)` : 'HP-4 RED: the perturbed bundle passed the rail')
        return red.length ? 0 : 1
      } finally { rmSync(dir, { recursive: true, force: true }) }
    }
    // W5-T5: --raw-out keeps Node's own encoded columns so a differing case can be explained by column and ulp
    const rawSink = argOf(argv, '--raw-out') ? {} : null
    const ac = new AbortController()
    let why = null
    const onSig = (sig) => { why = why || sig; ac.abort() }
    const SIGS = ['SIGINT', 'SIGTERM', 'SIGHUP']
    for (const s of SIGS) process.on(s, onSig)
    let got
    try { got = await runNode({ bundle, corpus, only, log, rawSink, signal: ac.signal }) } finally { for (const s of SIGS) process.off(s, onSig) }
    if (got.interrupted) {
      const n = Object.keys(got.records).length
      const stopped = Object.values(got.records).filter((r) => r.status === 'interrupted').length
      console.log(`HP-1 INTERRUPTED by ${why || 'abort'}: ${n - stopped}/${n} cases ran; nothing written, no verdict`)
      return INTERRUPTED_EXIT
    }
    if (rawSink) atomicWrite(argOf(argv, '--raw-out'), JSON.stringify({ host: 'node', results: rawSink }))
    if (argOf(argv, '--out')) atomicWrite(argOf(argv, '--out'), `${JSON.stringify(got, null, 1)}\n`)
    if (argv.includes('--write')) {
      const prev = existsSync(EXPECTED_FILE) ? JSON.parse(readFileSync(EXPECTED_FILE, 'utf8')) : null
      atomicWrite(EXPECTED_FILE, `${JSON.stringify(writeExpected(prev, got, corpus), null, 1)}\n`)
      console.log(`wrote ${EXPECTED_FILE} (${Object.keys(got.records).length} cases)`)
      return 0
    }
    if (argv.includes('--check')) {
      const expected = JSON.parse(readFileSync(EXPECTED_FILE, 'utf8'))
      if (only) for (const k of Object.keys(expected.cases)) if (!got.records[k]) delete expected.cases[k]
      const r = checkAgainst(expected, got, corpus)
      r.lines.forEach((l) => console.log(l))
      console.log(hp1Summary(r, Object.keys(got.records).length))
      return r.code
    }
    return 0
  } finally {
    if (built) rmSync(built.dir, { recursive: true, force: true })
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase()
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => { console.error(`host-parity: ${e.stack || e.message}`); process.exitCode = 1 })
}
