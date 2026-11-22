// tools/pine_runtime_capacity.mjs
//
// W5-T9: THE FIRST CAPACITY NUMBERS for the pine-runtime service (docs/pine/SERVER-RUNTIME-DESIGN.md
// section 6 and 9.1: "T9 must measure CPU per symbol on a container capped at the proposed vCPU").
//
// ⛔ A LOCAL MEASUREMENT. It never talks to Railway. There is no Docker on this machine, so "a
// container capped at 2 vCPU" is: the SERVICE PROCESS (a separate node process, the real
// server.mjs `main` with the real pool and the parity canary) pinned to N logical CPUs by Windows
// processor affinity, with `workers = N`. Differences from the deployed container, all named in
// the evidence: no memory cap; no cgroup CPU-quota throttling (affinity pins, a quota meters);
// the permission-model flags of the L4 self-test are not set (`requireL4` off); localhost HTTP, not
// Railway's private network; this machine's CPU, not Railway's. Read the numbers as a ratio and a
// lower bound, never as the deployed figure.
//
// MODES
//   node tools/pine_runtime_capacity.mjs [--cpus 2] [--stride 1|2] [--symbols 100] [--chunk 20] [--out file.json]
//       the driver: builds the bundle, starts the service process, pins it, measures, stops it.
//   node tools/pine_runtime_capacity.mjs --serve --bundle <mjs> --port <n> --workers <n>
//       the service process (started by the driver; waits for "go" on stdin, then
//       "cpu" prints its CPU time, "quit" stops it). Every line it prints starts with `@@ `.
//
// WHAT IS MEASURED
//   request overhead   sequential signed requests of ONE tiny job (50 bars, `plot(close)`) and of ONE
//                      5,000-bar job: wall RTT minus the job's own `ms` (what the service did).
//   sweep              `--symbols` distinct 5,000-bar D series (the design's yardstick) for each of
//                      CAP_DOCS, sent as profile `sweep` in requests of `--chunk` jobs with two
//                      requests in flight. Reported per symbol: wall ms (at the pinned workers),
//                      the service process's CPU ms (user + system over every thread, bars decode,
//                      HMAC and JSON included), and the worker's own `ms` p50/p95.
//   extrapolation      x 3,742 symbols (the universe, `api/data/cap_universe.json`).
//
// ⛔ No secret is committed: the HMAC key is drawn fresh from the OS RNG for each run.
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const UNIVERSE = 3742
export const CAP_DOCS = Object.freeze(['adx-and-di-for-v4', 'ema_macd', 'bollinger', 'rsi_stoch'])
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i < 0 ? dflt : process.argv[i + 1] }
const has = (name) => process.argv.includes(name)

// ─── the service process ───────────────────────────────────────────────────────────────────────

async function serve() {
  const { main } = await import(pathToFileURL(join(REPO, 'services', 'pine_runtime', 'server.mjs')).href)
  const say = (o) => process.stdout.write(`@@ ${JSON.stringify(o)}\n`)
  let server = null
  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    const cmd = line.trim()
    if (cmd === 'go') {
      server = await main({
        env: { PINE_RUNTIME_SERVICE_SECRET: process.env.CAP_SECRET, PORT: arg('--port') },
        bundle: arg('--bundle'), pool: { workers: Number(arg('--workers')) }, canary: true, log: () => {},
      })
      const port = Number(arg('--port'))
      for (let i = 0; i < 200; i += 1) {
        const r = await fetch(`http://127.0.0.1:${port}/ready`).catch(() => null)
        if (r && r.status === 200) break
        await new Promise((d) => setTimeout(d, 100))
      }
      say({ event: 'ready', pid: process.pid })
    } else if (cmd === 'cpu') {
      const c = process.cpuUsage()
      say({ event: 'cpu', user_us: c.user, system_us: c.system, rss: process.memoryUsage().rss })
    } else if (cmd === 'quit') {
      if (server) await new Promise((d) => server.close(d))
      say({ event: 'bye' })
      process.exit(0)
    }
  }
}

// ─── the driver ────────────────────────────────────────────────────────────────────────────────

const freePort = () => new Promise((done) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)) })
})

const pctl = (xs, p) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
}
const round = (x, d = 1) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d)

async function driver() {
  const cpus = Number(arg('--cpus', '2'))
  const symbols = Number(arg('--symbols', '100'))
  const chunk = Number(arg('--chunk', '20'))
  const out = arg('--out', null)
  const hp = await import(pathToFileURL(join(REPO, 'tools', 'pine_runtime_host_parity.mjs')).href)
  const { signHeader, sha256Hex } = await import(pathToFileURL(join(REPO, 'services', 'pine_runtime', 'auth.mjs')).href)
  const { barsSha256, BAR_COLUMNS } = await import(pathToFileURL(join(REPO, 'services', 'pine_runtime', 'protocol.mjs')).href)
  const { buildPineRuntime } = await import(pathToFileURL(join(REPO, 'app', 'scripts', 'build-pine-runtime.mjs')).href)

  const dir = mkdtempSync(join(tmpdir(), 'pine-cap-'))
  const bundle = join(dir, 'pine-runtime.mjs')
  await buildPineRuntime({ outfile: bundle, logLevel: 'silent', env: {} })
  const secret = randomBytes(32).toString('hex')
  const port = await freePort()
  const child = spawn(process.execPath, [join(HERE, 'pine_runtime_capacity.mjs'), '--serve', '--bundle', bundle, '--port', String(port), '--workers', String(cpus)],
    { env: { ...process.env, CAP_SECRET: secret }, stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = []
  let waiter = null
  createInterface({ input: child.stdout }).on('line', (l) => {
    if (!l.startsWith('@@ ')) return
    const o = JSON.parse(l.slice(3))
    if (waiter && waiter.event === o.event) { const w = waiter; waiter = null; w.done(o) } else lines.push(o)
  })
  const ask = (cmd, event) => new Promise((done) => { waiter = { event, done }; child.stdin.write(`${cmd}\n`) })
  let finished = false
  const stop = async () => {
    if (finished) return
    finished = true
    try { await Promise.race([ask('quit', 'bye'), new Promise((d) => setTimeout(d, 8000))]) } catch { /* ignore */ }
    if (child.exitCode === null) child.kill()
    rmSync(dir, { recursive: true, force: true })
  }

  try {
    // pin the service process BEFORE it starts its pool: workers inherit the process affinity
    // logical CPUs 4, 4+stride, ... (not CPU 0, which the OS favours). stride 1 = adjacent logical CPUs, which
    // are usually hyperthread SIBLINGS of one core; stride 2 = one logical CPU per core
    const stride = Number(arg('--stride', '1'))
    const mask = Array.from({ length: cpus }, (_, i) => 1 << (4 + i * stride)).reduce((a, b) => a | b, 0)
    const ps = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).ProcessorAffinity = ${mask}; (Get-Process -Id ${child.pid}).ProcessorAffinity`], { encoding: 'utf8' })
    const pinned = Number(String(ps.stdout).trim())
    if (pinned !== mask) throw new Error(`could not pin the service process (wanted mask ${mask}, got ${JSON.stringify(ps.stdout)} ${ps.stderr})`)
    await ask('go', 'ready')

    const corpus = hp.loadCorpus()
    const cases = new Map(hp.caseList(corpus).map((c) => [c.case, c]))
    const adx = JSON.parse(readFileSync(join(REPO, 'tests', 'fixtures', 'runtime_documents', 'documents.json'), 'utf8')).documents.find((d) => d.slug === 'adx-and-di-for-v4').definition
    const docs = {
      'adx-and-di-for-v4': { id: adx.id, compute: adx.compute, meta: { runtimeHistory: adx.meta.runtimeHistory } },
      ema_macd: cases.get('ema_macd@d5000').def,
      bollinger: cases.get('bollinger@d5000').def,
      rsi_stoch: cases.get('rsi_stoch@d5000').def,
    }
    const tiny = { id: 'u_000000000cap', compute: { kind: 'runtime', fn: 'runtime:cap', outputs: { p0: 0 }, source: '//@version=5\nindicator("cap")\nplot(close)' }, meta: {} }
    const f64 = (xs) => { const b = Buffer.alloc(xs.length * 8); xs.forEach((x, i) => b.writeDoubleLE(x, i * 8)); return b }
    const wireBars = (rows) => {
      const w = { n: rows.length }
      const bytes = {}
      for (const k of BAR_COLUMNS) { bytes[k] = f64(rows.map((r) => r[k])); w[k] = bytes[k].toString('base64') }
      w.sha256 = barsSha256(rows.length, bytes)
      return w
    }
    // the engine identity comes from the service's own signed metrics (never retyped here)
    const signedGet = async (path) => {
      const t = Math.floor(Date.now() / 1000)
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'x-pine-runtime-signature': signHeader(secret, t, Buffer.alloc(0)) } })
      return r.json()
    }
    const metrics0 = await signedGet('/v1/metrics')
    const engine = metrics0.engine
    const spec = corpus.barSets.d5000
    const series = (i, n = spec.n) => wireBars(hp.makeBars({ ...spec, seed: 1000 + i, n }))
    const bodyOf = (profile, doc, jobs, defId) => {
      const docText = JSON.stringify(doc)
      return Buffer.from(JSON.stringify({
        protocol: 1, profile, engine, owner: 'hmac:00000000000000cc',
        definition: { def_id: defId, version: 1, doc_sha256: sha256Hex(Buffer.from(docText, 'utf8')), doc: docText },
        jobs: jobs.map(({ name, bars }) => ({ job: name, symbol: { ticker: name, exchange: 'NASDAQ' }, tf: 'D', bars,
          ctx: { newestBarIsForming: false, historyFromListing: true, runtimeInputs: {} }, want: [] })),
      }))
    }
    const post = async (body) => {
      const t = Math.floor(Date.now() / 1000)
      const t0 = performance.now()
      const r = await fetch(`http://127.0.0.1:${port}/v1/run`, { method: 'POST', body, headers: { 'x-pine-runtime-signature': signHeader(secret, t, body), 'content-type': 'application/json' } })
      const j = await r.json()
      return { status: r.status, rtt: performance.now() - t0, results: j.results || [], error: j.error || null }
    }
    // a request is signed over its own bytes, so two identical bodies in one second collide as a
    // replay: every body here carries a distinct job name, and a retry is never sent.

    const report = { local_measurement: true, cpus, stride, workers: cpus, affinity_mask: mask, node: process.version, symbols, chunk, universe: UNIVERSE, machine_logical_cpus: (await import('node:os')).availableParallelism() }

    // 1. request overhead
    const overhead = {}
    for (const [label, n, count] of [['tiny_50_bars', 50, 200], ['one_5000_bar_job', 5000, 40]]) {
      const rtts = []
      const jobMs = []
      for (let i = 0; i < count; i += 1) {
        const body = bodyOf('on-demand', n === 50 ? tiny : docs.ema_macd, [{ name: `OH${label}${i}`, bars: series(i, n) }], 'cap:overhead')
        const r = await post(body)
        if (r.status !== 200 || r.results[0].status !== 'ok') throw new Error(`overhead request failed: ${r.status} ${JSON.stringify(r.error || r.results[0])}`)
        rtts.push(r.rtt)
        jobMs.push(r.results[0].ms)
      }
      const over = rtts.map((x, i) => x - jobMs[i])
      overhead[label] = { requests: count, rtt_ms: { p50: round(pctl(rtts, 50)), p95: round(pctl(rtts, 95)) }, job_ms: { p50: pctl(jobMs, 50), p95: pctl(jobMs, 95) }, overhead_ms: { p50: round(pctl(over, 50)), p95: round(pctl(over, 95)) } }
    }
    report.request_overhead = overhead

    // 2. sweep
    const barsPool = Array.from({ length: symbols }, (_, i) => series(i))
    const sweep = {}
    for (const slug of CAP_DOCS) {
      const bodies = []
      for (let s = 0; s < symbols; s += chunk) {
        const jobs = barsPool.slice(s, s + chunk).map((bars, k) => ({ name: `${slug.slice(0, 6)}${s + k}`, bars }))
        bodies.push(bodyOf('sweep', docs[slug], jobs, `cap:${slug}`.slice(0, 60)))
      }
      const before = await ask('cpu', 'cpu')
      const t0 = performance.now()
      const answers = []
      let next = 0
      const lane = async () => { while (next < bodies.length) { const b = bodies[next]; next += 1; answers.push(await post(b)) } }
      await Promise.all([lane(), lane()])
      const wall = performance.now() - t0
      const after = await ask('cpu', 'cpu')
      const results = answers.flatMap((a) => a.results)
      const bad = answers.filter((a) => a.status !== 200).length
      const ok = results.filter((r) => r.status === 'ok').length
      const withheld = results.filter((r) => r.status !== 'ok')
      const cpuMs = ((after.user_us - before.user_us) + (after.system_us - before.system_us)) / 1000
      const ms = results.filter((r) => r.status === 'ok').map((r) => r.ms)
      sweep[slug] = {
        jobs: results.length, ok, withheld: withheld.length, withheld_guards: [...new Set(withheld.flatMap((r) => (r.refusals || []).map((f) => f.guard)))], bad_requests: bad,
        wall_ms_per_symbol: round(wall / results.length, 2),
        service_cpu_ms_per_symbol: round(cpuMs / results.length, 2),
        worker_job_ms: { p50: pctl(ms, 50), p95: pctl(ms, 95), mean: round(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length), 2) },
        cpu_utilisation_of_pinned_cpus: round(cpuMs / (wall * cpus), 3),
        extrapolated_universe: {
          wall_minutes: round((wall / results.length) * UNIVERSE / 60000, 2),
          cpu_minutes: round((cpuMs / results.length) * UNIVERSE / 60000, 2),
        },
      }
    }
    report.sweep = sweep
    report.rss_mb = Math.round((await ask('cpu', 'cpu')).rss / 1048576)
    const m = await signedGet('/v1/metrics')
    report.metrics_after = { jobs: m.jobs, refusals: m.refusals, latency_ms: m.latency_ms, workers: m.workers, queue_depth: m.queue_depth, heap: m.heap, canary_runs: m.canary && m.canary.runs, canary_ok: m.canary && m.canary.ok }
    const text = `${JSON.stringify(report, null, 1)}\n`
    if (out) writeFileSync(out, text)
    process.stdout.write(text)
  } finally {
    await stop()
  }
}

const here = fileURLToPath(import.meta.url).toLowerCase()
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === here) {
  (has('--serve') ? serve() : driver()).catch((e) => { console.error(`capacity: ${e.stack || e.message}`); process.exit(1) })
}
