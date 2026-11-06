// W5-T7b rail on the REAL server bundle, through the supervisor (server.mjs) and the pool: an ok
// answer carries the design 2.3 digest of exactly the bytes it sends, and the run's own warm-up.
// The reference for both is the SAME bundle run in this process the way the browser worker runs it
// (computeRuntimeColumns + runtimeWarmupOf, runtimeWorker.js), digested by T3's module.
// One pool of 1 worker, closed here.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { pathToFileURL } from 'node:url'
import { SIGNATURE_HEADER, signHeader } from '../auth.mjs'
import { createPool } from '../pool.mjs'
import { createPineRuntimeServer, loadBundle } from '../server.mjs'
import { CODEC, SECRET } from './helpers.mjs'
import { barColumns, buildRealBundle, wireRequest } from './poolFixtures.mjs'

const H = (body) => `//@version=5\nindicator("t7b")\n${body}`
const SOURCE = H('plot(ta.ema(close, 10))')
const N = 300
const docOf = (history) => ({
  id: 'u_0123456789ab', compute: { kind: 'runtime', fn: 'runtime:t7b', outputs: { value: 0 }, source: SOURCE },
  meta: history ? { runtimeHistory: history } : {},
})

let real
let door
let pool
let server
let port
before(async () => {
  real = await buildRealBundle()
  door = await loadBundle(real.outfile)
  pool = await createPool({ bundle: real.outfile, workers: 1 })
  server = createPineRuntimeServer({ secrets: [SECRET], door, runner: pool.run, canary: () => pool.ready(), log: () => {} })
  await new Promise((d) => server.listen(0, '127.0.0.1', d))
  port = server.address().port
})
after(async () => {
  if (server) await new Promise((d) => server.close(d))
  if (pool) await pool.close()
  if (real) real.cleanup()
})

let seq = 0
function post(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, owner: `hmac:${(seq += 1).toString(16).padStart(16, '0')}` }))
  return new Promise((done, fail) => {
    const r = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/v1/run',
      headers: { 'content-length': body.length, [SIGNATURE_HEADER]: signHeader(SECRET, Math.floor(Date.now() / 1000), body) } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => done({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    r.on('error', fail)
    r.end(body)
  })
}

/** The browser worker's run of the same job, on the same bundle, in this process. */
async function referenceRun(doc, listing) {
  const rt = await import(pathToFileURL(real.outfile).href)
  const c = barColumns(N, 0)
  const rows = Array.from({ length: N }, (_, i) => ({ t: c.t[i], o: c.o[i], h: c.h[i], l: c.l[i], c: c.c[i], v: c.v[i] }))
  try {
    const cols = rt.computeRuntimeColumns({ id: doc.id, compute: doc.compute, meta: doc.meta }, rows,
      { tf: 'D', newestBarIsForming: false, historyFromListing: listing, runtimeInputs: {}, symbol: { ticker: 'AAPL', exchange: 'NASDAQ' } },
      { budgetMs: rt.RUNTIME_PANE_TIME_BUDGET_MS, incremental: false })
    return { value: Array.from(cols.value), warmup: rt.runtimeWarmupOf(cols) }
  } finally { rt.resetRuntimeSessions(); rt.resetRuntimeLedgers() }
}

const b64Bytes = (text) => new Uint8Array(Buffer.from(text, 'base64'))

for (const [label, history, listing] of [['off the listing (the warm-up curtain runs)', 'listing', false], ['from the listing', null, true]]) {
  test(`real bundle, ${label}: the ok answer carries the T3 digest of its own bytes and the run's warm-up`, async () => {
    const doc = docOf(history)
    const req = wireRequest(door.identity, { doc, jobs: [{ name: 'AAPL|D', n: N }] })
    req.jobs[0].ctx.historyFromListing = listing
    const { status, json } = await post(req)
    assert.equal(status, 200)
    const [r] = json.results
    assert.equal(r.status, 'ok', JSON.stringify(r.refusals))
    const ref = await referenceRun(doc, listing)
    const value = CODEC.decodeColumn(b64Bytes(r.columns.value), N)
    assert.deepEqual(Array.from(value).map((x) => Object.is(x, -0) ? '-0' : Number.isNaN(x) ? 'na' : x),
      ref.value.map((x) => Object.is(x, -0) ? '-0' : Number.isNaN(x) ? 'na' : x), 'the service computed what the browser host computes')
    // the digest a caller recomputes from the reply alone (its engine, its bytes, its refusals)
    assert.equal(r.digest, CODEC.columnDigest({ engine: json.engine, columns: { value }, refusals: r.refusals }))
    assert.equal(r.digest, CODEC.columnDigest({ engine: door.identity, columns: { value: ref.value }, refusals: [] }), 'and from the reference run')
    // the warm-up is the run's own record's bar count, and it is 0 only when the run withheld none
    const want = ref.warmup === null ? 0 : ref.warmup.withheldBars
    assert.deepEqual(r.warmup, { withheldBars: want })
    if (listing) assert.equal(ref.warmup, null)
    else {
      assert.ok(want > 0, `the curtain withheld bars (${JSON.stringify(ref.warmup)})`)
      assert.ok(Array.from(value).slice(0, want).every(Number.isNaN), 'every withheld bar is na on the wire')
      assert.ok(!Number.isNaN(value[want]), 'the first bar past the warm-up has a value')
    }
  })
}

test('real bundle: a run-wide stop is sealed too, with the digest of its refusal and no warm-up', async () => {
  const doc = { ...docOf(null), compute: { ...docOf(null).compute, source: H('x = request.security("NASDAQ:MSFT", "D", close)\nplot(x)') } }
  const { status, json } = await post(wireRequest(door.identity, { doc, jobs: [{ name: 'AAPL|D', n: N }] }))
  assert.equal(status, 200)
  const [r] = json.results
  assert.equal(r.status, 'withheld')
  assert.equal(r.warmup, undefined)
  assert.equal(r.digest, CODEC.columnDigest({ engine: json.engine, columns: {}, refusals: r.refusals }))
})

// ─── what the service reads as a daily bar's time (coordinator question, W5-T15 / W5-T11) ──────
// `bars.t` is a Float64 on the wire (protocol.mjs: finite, strictly increasing; nothing else), and
// the runtime reads a NUMERIC `t` as UNIX SECONDS, verbatim, as the bar's instant (indicators.js
// barOpenInstant's number branch; the chart's ISO-date branch cannot cross this wire). So the
// door accepts every spelling below, and this rail pins what each one MEANS to the run:
//   seconds at the 09:30 ET open   the chart's own reading of a daily bar (barOpenInstant)
//   seconds at UTC midnight        read as 19:00 ET the PREVIOUS day: every clock built-in is a day early
//   YYYYMMDD ints                  below the 1990 unit floor: every clock built-in is na
//   milliseconds                   read as seconds: a far-future instant, plausible-looking garbage
test('real bundle: a daily bar time is read as unix seconds verbatim; the door accepts any finite spelling', async () => {
  const days = [[2026, 0, 5], [2026, 0, 6], [2026, 0, 7]] // Mon, Tue, Wed
  const spellings = {
    open: days.map(([y, m, d]) => Date.UTC(y, m, d, 14, 30) / 1000),
    utcMidnight: days.map(([y, m, d]) => Date.UTC(y, m, d) / 1000),
    yyyymmdd: days.map(([y, m, d]) => y * 10000 + (m + 1) * 100 + d),
    ms: days.map(([y, m, d]) => Date.UTC(y, m, d)),
  }
  const doc = { id: 'u_0123456789ab', meta: {},
    compute: { kind: 'runtime', fn: 'runtime:t7b', outputs: { dow: 0, dom: 1 }, source: H('plot(dayofweek)\nplot(dayofmonth)') } }
  const got = {}
  for (const [name, ts] of Object.entries(spellings)) {
    const req = wireRequest(door.identity, { doc, jobs: [{ name: `AAPL|${name}`, n: 3 }] })
    const b = Buffer.alloc(24)
    ts.forEach((t, i) => b.writeDoubleLE(t, i * 8))
    const bars = req.jobs[0].bars
    bars.t = b.toString('base64')
    const { barsSha256, BAR_COLUMNS } = await import('../protocol.mjs')
    bars.sha256 = barsSha256(3, Object.fromEntries(BAR_COLUMNS.map((k) => [k, Buffer.from(bars[k], 'base64')])))
    const { status, json } = await post(req)
    assert.equal(status, 200, `${name}: the door accepts it`)
    const [r] = json.results
    assert.equal(r.status, 'ok', `${name}: ${JSON.stringify(r.refusals)}`)
    got[name] = ['dow', 'dom'].map((k) => Array.from(CODEC.decodeColumn(b64Bytes(r.columns[k]), 3)).map((x) => (Number.isNaN(x) ? 'na' : x)))
  }
  assert.deepEqual(got.open, [[2, 3, 4], [5, 6, 7]], 'the 09:30 ET open: Mon-Wed, the 5th-7th (Pine dayofweek: 1 = Sunday)')
  assert.deepEqual(got.utcMidnight, [[1, 2, 3], [4, 5, 6]], 'UTC midnight is the previous New York evening: one day early')
  assert.deepEqual(got.yyyymmdd, [['na', 'na', 'na'], ['na', 'na', 'na']], 'YYYYMMDD is below the unit floor: na, never a guess')
  assert.notDeepEqual(got.ms, got.open, 'milliseconds are read as seconds: wrong, and not refused')
})
