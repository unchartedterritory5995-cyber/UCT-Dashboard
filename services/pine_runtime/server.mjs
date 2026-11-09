// services/pine_runtime/server.mjs
//
// W5-T6: the pine-runtime SUPERVISOR's front door (docs/pine/SERVER-RUNTIME-DESIGN.md 3.1, 3.6,
// 3.8, section 4 L2/L5). Order of every `POST /v1/run`, each step refusing before the next runs:
//
//   1. signature header + clock (401)  BEFORE the body is read
//   2. body read, capped at MAX_BODY_BYTES while it streams (400)
//   3. HMAC over the exact body bytes, any configured secret (401); then the replay check (401)
//   4. closed schema, engine identity, doc and bars hashes recomputed (protocol.mjs: 400/409/422)
//   5. the runner (the T7 pool). With no runner the service is NOT ready and every run answers
//      503 runtime:server-unavailable. Nothing is ever computed in this process.
//   6. the seal (W5-T7b, protocol.mjs sealRunResults): every result is checked against the closed
//      result schema and stamped with its design 2.3 digest by the bundle's own T3 codec; anything
//      else is a 500 and no job of the request is answered.
//   W5-INT, THE T8 CACHES (cache.mjs, design 3.3), ON BY DEFAULT: step 4 answers `doc: null` from
//   the document cache (a fresh copy per request) and files every sent document whose hash it
//   recomputed; around step 5, the result lane answers each job it holds from a COPY (this
//   request's job id, `cache: 'hit'`), sends only the misses to the runner, and stores a miss only
//   after step 6 sealed the whole reply and only when it is deterministic (cache.mjs `cacheable`).
//   The parity canary bypasses both (it calls the pool directly; its all-zero hashes are never keys).
//
// ⛔ A refused request runs ZERO jobs. ⛔ No log line carries a body, a source, a secret or an
// owner id: refusals log their status and guard only.
//
// THE LISTENER IS DUAL-STACK and proves it at boot (the chart-renderer lesson,
// services/chart_renderer/serve.py): `::` alone can come up IPv6-only, and Railway's private
// network is IPv6 while a local prober may be IPv4. `listenDualStack` connects to itself over
// 127.0.0.1 AND ::1 and refuses to serve if either family fails.
//
// THE ENV ALLOWLIST (L2): the service holds nothing worth stealing, so it refuses to boot when
// any variable outside ENV_ALLOWLIST is set. That catches a service duplicated from `web` (Railway
// copies the env on duplication) before it serves a single request. NODE_OPTIONS is deliberately
// absent: it could drop the node flags T10 sets.
import { createServer as createHttpServer } from 'node:http'
import { connect } from 'node:net'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  AUTH_GUARD, SIGNATURE_HEADER, ReplayGuard, parseSecrets, parseSignatureHeader, sha256Hex, verifyBody,
} from './auth.mjs'
import { MAX_BODY_BYTES, PROTOCOL, SCHEMA_GUARD, parseRunRequest, sealRunResults } from './protocol.mjs'
import { DocCache, createResultLane } from './cache.mjs'
import { BUSY_GUARD, createPool } from './pool.mjs'
// W5-T9 (the only T9 additions to this file: these two imports, the metrics wiring in
// createPineRuntimeServer, the /v1/metrics route, and the canary wiring in main)
import { createMetrics } from './metrics.mjs'
import { createCanary, loadCanaryInputs } from './canary.mjs'

export const UNAVAILABLE_GUARD = 'runtime:server-unavailable'
export const FAILED_GUARD = 'runtime:server-failed'
export const DEFAULT_PORT = 8080
/** W5-T7: the pool the service's own boot runs. requireL4: the boot refuses to start unless a
 *  worker can write no file, spawn no process and generate no code (design section 4, L4). */
export const SERVICE_POOL_OPTIONS = Object.freeze({ requireL4: true })

/** The only variables the service may boot with. Platform-injected names are listed one by one;
 *  a prefix rule would admit RAILWAY_TOKEN. Public-exposure names (RAILWAY_PUBLIC_DOMAIN,
 *  RAILWAY_STATIC_URL, RAILWAY_TCP_PROXY_*) are absent on purpose: the service has no public domain. */
export const ENV_ALLOWLIST = Object.freeze([
  'PORT', 'PINE_RUNTIME_SERVICE_SECRET',
  'PATH', 'HOME', 'HOSTNAME', 'PWD', 'SHLVL', 'TERM', 'LANG', 'LC_ALL', '_', 'NODE_VERSION', 'YARN_VERSION',
  'RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_PROJECT_ID',
  'RAILWAY_PROJECT_NAME', 'RAILWAY_SERVICE_ID', 'RAILWAY_SERVICE_NAME', 'RAILWAY_PRIVATE_DOMAIN',
  'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_REPLICA_ID', 'RAILWAY_REPLICA_REGION', 'RAILWAY_SNAPSHOT_ID',
  'RAILWAY_GIT_COMMIT_SHA', 'RAILWAY_GIT_AUTHOR', 'RAILWAY_GIT_BRANCH', 'RAILWAY_GIT_REPO_NAME',
  'RAILWAY_GIT_REPO_OWNER', 'RAILWAY_GIT_COMMIT_MESSAGE',
  // W5-INT: the bundle's only build args (app/scripts/build-pine-runtime.mjs SERVER_BUNDLE_VITE_NAMES,
  // non-secret '1'/unset flags). On Railway a service variable is both a build arg and a runtime
  // variable, so mirroring web's value of one must not refuse the boot. Nothing reads them at run
  // time (the bundle baked them); a rail holds this pair equal to the build script's list.
  'VITE_PINE_LOWER_TF_ENABLED', 'VITE_PINE_RUNTIME_PANE_ENABLED',
])

/** The sentence when `env` holds a variable outside the allowlist, else null. Names only, never values. */
export function envRefusal(env) {
  const extra = Object.keys(env).filter((k) => !ENV_ALLOWLIST.includes(k)).sort()
  if (extra.length === 0) return null
  return `the pine-runtime service refuses to start: ${extra.length} variable(s) outside its allowlist are set `
    + `(${extra.join(', ')}). It holds no credentials by design; remove them.`
}

/** The listening port: PORT when it is a whole number 1-65535, DEFAULT_PORT when unset. */
export function portOf(env) {
  if (env.PORT === undefined || env.PORT === '') return DEFAULT_PORT
  if (!/^\d{1,5}$/.test(env.PORT) || Number(env.PORT) < 1 || Number(env.PORT) > 65535) {
    throw new Error('PORT is not a whole number from 1 to 65535; the service refuses to start.')
  }
  return Number(env.PORT)
}

export const DEFAULT_BUNDLE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'dist-server', 'pine-runtime.mjs')

/**
 * Import the server bundle and derive the door's facts FROM it: the engine identity (its own
 * constants plus the sha256 of the bytes on disk, never a manifest's claim), the timeframe set
 * and the bars ceiling. Nothing here is retyped.
 */
export async function loadBundle(path = DEFAULT_BUNDLE) {
  const bytes = readFileSync(path)
  const mod = await import(pathToFileURL(path).href)
  const identity = {
    script_engine: mod.SCRIPT_ENGINE_VERSION,
    runtime_language: mod.RUNTIME_FRONTEND_LANGUAGE,
    runtime_frontend: mod.RUNTIME_FRONTEND_VERSION,
    runtime_ir: mod.RUNTIME_IR_VERSION,
    bundle_sha256: sha256Hex(bytes),
  }
  for (const [k, v] of Object.entries(identity)) {
    if (v === undefined) throw new Error(`the bundle at ${path} exports no ${k}; the service refuses to start.`)
  }
  if (!Array.isArray(mod.NATIVE_TFS) || !mod.DEFAULT_LIMITS || !Number.isSafeInteger(mod.DEFAULT_LIMITS.HISTORY)) {
    throw new Error(`the bundle at ${path} exports no NATIVE_TFS / DEFAULT_LIMITS.HISTORY; the service refuses to start.`)
  }
  // W5-T7b: the T3 codec the seal digests with is the bundle's own (one implementation, in the artifact)
  for (const k of ['columnDigest', 'decodeColumn']) {
    if (typeof mod[k] !== 'function') throw new Error(`the bundle at ${path} exports no ${k}; the service refuses to start.`)
  }
  // W9-T14: and the bundle's ONE strategy record check, which the seal asks of a served record. A bundle
  // without it still boots: the seal then refuses any record it is handed (fails closed), and nothing else changes.
  const codec = { columnDigest: mod.columnDigest, decodeColumn: mod.decodeColumn,
    strategyRecordShapeErrors: typeof mod.strategyRecordShapeErrors === 'function' ? mod.strategyRecordShapeErrors : null }
  return { mod, identity, codec, tfSet: [...mod.NATIVE_TFS], maxBars: mod.DEFAULT_LIMITS.HISTORY }
}

function send(res, status, payload) {
  const text = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

function refuseResponse(res, status, guard, sentence, log) {
  log(`[pine-runtime] refused status=${status} guard=${guard}`)
  send(res, status, { protocol: PROTOCOL, error: { guard, sentence } })
}

/** Read the body, refusing (null) once it passes `cap` bytes. Never buffers past the cap. */
function readCapped(req, cap) {
  return new Promise((done, fail) => {
    const chunks = []
    let size = 0
    let over = false
    req.on('data', (c) => {
      if (over) return
      size += c.length
      if (size > cap) { over = true; chunks.length = 0; return }
      chunks.push(c)
    })
    req.on('end', () => done(over ? null : Buffer.concat(chunks)))
    req.on('error', fail)
  })
}

/**
 * The supervisor's HTTP server. Everything it trusts is passed in, so a rail can drive it.
 * @param {object} o
 * @param {string[]} o.secrets     from parseSecrets(PINE_RUNTIME_SERVICE_SECRET)
 * @param {{identity:object, codec:object, tfSet:string[], maxBars:number}} o.door   from loadBundle()
 * @param {(request:object) => Promise<object[]>} [o.runner]  the job pool (T7); absent = not ready
 * @param {() => boolean} [o.canary]  readiness beyond "loaded" (the T9 parity canary)
 * @param {() => number} [o.now]      unix seconds
 * @param {object} [o.metrics]       W5-T9: createMetrics(); counted per request, served at GET /v1/metrics
 * @param {() => object} [o.poolStats] W5-T9: the pool's stats(), for /v1/metrics
 * @param {() => object} [o.canaryStatus] W5-T9: the canary's status(), for /v1/metrics
 * @param {object} [o.boot]          W5-T9: the boot fingerprint's fields, for /v1/metrics
 * @param {DocCache|null} [o.docCache]  W5-INT: the T8 document cache (null: none, every doc must be sent)
 * @param {object|null} [o.resultLane]  W5-INT: cache.createResultLane() (null: no result cache)
 */
export function createPineRuntimeServer({ secrets, door, runner = null, canary = () => true,
  now = () => Math.floor(Date.now() / 1000), log = console.log,
  metrics = createMetrics(), poolStats = null, canaryStatus = null, boot = null,
  docCache = new DocCache(), resultLane = createResultLane() } = {}) {
  if (!Array.isArray(secrets) || secrets.length === 0) throw new Error('createPineRuntimeServer needs at least one secret')
  const replay = new ReplayGuard()
  const refuse = (res, status, guard, sentence, l) => { metrics.refused(guard); return refuseResponse(res, status, guard, sentence, l) }
  const ready = () => Boolean(door && door.identity && runner) && canary() === true

  async function run(req, res) {
    const parsed = parseSignatureHeader(req.headers[SIGNATURE_HEADER], now())
    if (parsed.reason) {
      res.setHeader('connection', 'close') // the body is never read; do not reuse the socket
      return refuse(res, 401, AUTH_GUARD, `${parsed.reason}, so nothing runs.`, log)
    }
    const declared = Number(req.headers['content-length'])
    if (declared > MAX_BODY_BYTES) {
      res.setHeader('connection', 'close')
      return refuse(res, 400, SCHEMA_GUARD, `body: is larger than ${MAX_BODY_BYTES} bytes`, log)
    }
    const body = await readCapped(req, MAX_BODY_BYTES)
    if (body === null) {
      res.setHeader('connection', 'close')
      return refuse(res, 400, SCHEMA_GUARD, `body: is larger than ${MAX_BODY_BYTES} bytes`, log)
    }
    if (!verifyBody(secrets, parsed, body)) return refuse(res, 401, AUTH_GUARD, 'the signature does not match the body, so nothing runs.', log)
    if (!replay.admit(parsed.v1, parsed.t, now())) return refuse(res, 401, AUTH_GUARD, 'this signed request was already received, so it is not run twice.', log)
    const checked = parseRunRequest(body, door, docCache)
    if (!checked.ok) return refuse(res, checked.status, checked.guard, checked.sentence, log)
    if (!ready()) return refuse(res, 503, UNAVAILABLE_GUARD, 'the runtime service is not ready, so nothing is computed.', log)
    // Every job answered once, in order, by id, in the closed result schema, then sealed (step 6)
    const seal = (results) => sealRunResults(door.codec, door.identity, checked.request.jobs, results)
    let sealed
    try {
      sealed = resultLane ? await resultLane.answer(checked.request, runner, seal) : seal(await runner(checked.request))
    } catch (e) {
      // W5-T7: a full queue refuses the whole request before any job of it is queued (design 3.4)
      if (e && e.guard === BUSY_GUARD) return refuse(res, 429, BUSY_GUARD, e.message, log)
      return refuse(res, 500, FAILED_GUARD, 'the runtime pool failed, so no job in this request has a value.', log)
    }
    if (!sealed.ok) {
      return refuse(res, 500, FAILED_GUARD, 'the runtime pool did not answer every job once in the result schema, so no job in this request has a value.', log)
    }
    metrics.answered(checked.request.profile, sealed.results)
    return send(res, 200, { protocol: PROTOCOL, engine: door.identity, results: sealed.results })
  }

  /** W5-T9: GET /v1/metrics. Signed like /v1/run, over the empty body; same clock and replay rules. */
  function metricsRoute(req, res) {
    const parsed = parseSignatureHeader(req.headers[SIGNATURE_HEADER], now())
    if (parsed.reason) return refuse(res, 401, AUTH_GUARD, `${parsed.reason}, so no metrics are served.`, log)
    if (!verifyBody(secrets, parsed, Buffer.alloc(0))) return refuse(res, 401, AUTH_GUARD, 'the signature does not match, so no metrics are served.', log)
    if (!replay.admit(parsed.v1, parsed.t, now())) return refuse(res, 401, AUTH_GUARD, 'this signed request was already received, so it is not served twice.', log)
    return send(res, 200, metrics.snapshot({ identity: door && door.identity, boot, pool: poolStats && poolStats(),
      canary: canaryStatus && canaryStatus(), cache: resultLane ? resultLane.stats() : null }))
  }

  const server = createHttpServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
    const path = (req.url || '').split('?')[0]
    if (path === '/health') return req.method === 'GET' ? send(res, 200, { ok: true }) : send(res, 405, { ok: false })
    if (path === '/ready') {
      if (req.method !== 'GET') return send(res, 405, { ready: false })
      return ready() ? send(res, 200, { ready: true }) : send(res, 503, { ready: false })
    }
    if (path === '/v1/metrics') {
      if (req.method !== 'GET') return send(res, 405, { protocol: PROTOCOL, error: { guard: SCHEMA_GUARD, sentence: 'GET only' } })
      return metricsRoute(req, res)
    }
    if (path === '/v1/run') {
      if (req.method !== 'POST') return send(res, 405, { protocol: PROTOCOL, error: { guard: SCHEMA_GUARD, sentence: 'POST only' } })
      return run(req, res).catch(() => {
        if (!res.headersSent) refuse(res, 500, FAILED_GUARD, 'the service failed on this request, so nothing is computed.', log)
        else res.destroy()
      })
    }
    return send(res, 404, { ok: false })
  })
  server.requestTimeout = 120_000 // the per-request total of design 3.4
  server.headersTimeout = 10_000
  return server
}

function probe(host, port) {
  return new Promise((done) => {
    const s = connect({ host, port })
    const finish = (ok) => { s.destroy(); done(ok) }
    s.setTimeout(2000, () => finish(false))
    s.once('connect', () => finish(true))
    s.once('error', () => finish(false))
  })
}

/**
 * Listen on `::` with IPv4 mapped in, then PROVE both families reach this server. Rejects (and
 * closes the server) when either family fails: a silent IPv6-only listener is the outage the
 * chart-renderer shipped once. `host` is a seam for the rail that shows the proof can fail.
 */
export async function listenDualStack(server, port, { host = '::' } = {}) {
  await new Promise((done, fail) => {
    server.once('error', fail)
    server.listen({ host, port, ipv6Only: false }, () => { server.off('error', fail); done() })
  })
  const bound = server.address().port
  const [v4, v6] = await Promise.all([probe('127.0.0.1', bound), probe('::1', bound)])
  if (!v4 || !v6) {
    await new Promise((done) => server.close(done))
    throw new Error(`the listener is not dual-stack (IPv4 ${v4 ? 'ok' : 'REFUSED'}, IPv6 ${v6 ? 'ok' : 'REFUSED'}); `
      + 'the service refuses to serve on one family.')
  }
  return bound
}

/** Boot: env allowlist, secrets, bundle, dual-stack listener, one grep-able fingerprint line.
 *  `pool` (W5-T7): options for createPool; when given and no `runner` is, the job pool is started
 *  on the same bundle, is the runner, and is stopped when the server closes.
 *  `canary` (W5-T9; default ON exactly when `pool` is SERVICE_POOL_OPTIONS, the real boot): with a pool, run the parity canary at boot and every 15 minutes; /ready is
 *  false until it is green and while it is red (design 3.8). */
export async function main({ env = process.env, bundle = DEFAULT_BUNDLE, runner = null, pool: poolOpts = null, canary: canaryOn = poolOpts === SERVICE_POOL_OPTIONS, log = console.log } = {}) {
  const refusal = envRefusal(env)
  if (refusal) throw new Error(refusal)
  const secrets = parseSecrets(env.PINE_RUNTIME_SERVICE_SECRET)
  const port = portOf(env)
  const door = await loadBundle(bundle)
  const pool = !runner && poolOpts ? await createPool({ ...poolOpts, bundle }) : null
  const canary = pool && canaryOn
    ? createCanary({ run: pool.run, inputs: loadCanaryInputs(), identity: door.identity, log })
    : null
  const id = door.identity
  const boot = { engine: `${id.script_engine}/${id.runtime_frontend}/${id.runtime_ir}`, bundle: id.bundle_sha256.slice(0, 12),
    node: process.version, workers: pool ? pool.size : null }
  const server = createPineRuntimeServer({
    secrets, door, runner: pool ? pool.run : runner, log, boot,
    canary: pool ? () => pool.ready() && (!canary || canary.ok()) : undefined,
    poolStats: pool ? pool.stats : null, canaryStatus: canary ? canary.status : null,
  })
  if (pool) server.once('close', () => { (canary ? canary.stop() : Promise.resolve()).then(() => pool.close()).then(() => log('[pine-runtime] pool stopped')) })
  let bound
  try {
    bound = await listenDualStack(server, port)
  } catch (e) {
    if (canary) await canary.stop()
    if (pool) await pool.close()
    throw e
  }
  log(`[pine-runtime] boot engine=${id.script_engine}/${id.runtime_frontend}/${id.runtime_ir} `
    + `bundle=${id.bundle_sha256.slice(0, 12)} node=${process.version} workers=${pool ? pool.size : runner ? 'pool' : 0} port=${bound}`)
  if (canary) { canary.start(); canary.runOnce().catch(() => {}) } // ready only once green
  return server
}

const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)
const isMain = Boolean(process.argv[1]) && fold(resolve(process.argv[1])) === fold(fileURLToPath(import.meta.url))
if (isMain) {
  // W5-T7: the service's own boot runs the pool and refuses to start unless the L4 self-test holds
  main({ pool: SERVICE_POOL_OPTIONS }).catch((e) => {
    console.error(`[pine-runtime] BOOT REFUSED: ${e.message}`)
    process.exit(1)
  })
}
