// W5-T6 rails over real HTTP: auth before work, zero jobs on any refusal, readiness, the
// dual-stack listener and the env allowlist (design 3.6, 3.8, section 4 L2/L5).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { readFileSync } from 'node:fs'
import { signHeader, SIGNATURE_HEADER } from '../auth.mjs'
import { MAX_BODY_BYTES } from '../protocol.mjs'
import {
  ENV_ALLOWLIST, ENV_ALLOWLIST_PATTERNS, WIN32_ENV_ALLOWLIST, envAllowlistFor, envNameAdmitted, createPineRuntimeServer,
  DEFAULT_SERVICE_WORKERS, MAX_SERVICE_WORKERS, workersOf,
  envRefusal, listenDualStack, portOf,
} from '../server.mjs'
import { DOOR, IDENTITY, SECRET, SECRET_2, mutate, rng, validRequest } from './helpers.mjs'

const T = 1_800_000_000
const servers = []
after(async () => { for (const s of servers) await new Promise((d) => s.close(d)) })

/** A served instance with a counting runner, on a dual-stack ephemeral port. */
async function boot({ runner = 'count', canary, now = () => T, secrets = [SECRET, SECRET_2] } = {}) {
  const calls = []
  const logs = []
  const run = runner === 'count'
    ? async (req) => { calls.push(req); return req.jobs.map((j) => ({ job: j.job, status: 'ok', columns: {}, refusals: [], warmup: { withheldBars: 0 } })) }
    : runner
  const server = createPineRuntimeServer({ secrets, door: DOOR, runner: run, canary, now, log: (l) => logs.push(l) })
  const port = await listenDualStack(server, 0)
  servers.push(server)
  return { port, calls, logs }
}

function call(port, { method = 'POST', path = '/v1/run', body = Buffer.alloc(0), headers = {}, host = '127.0.0.1' } = {}) {
  return new Promise((done, fail) => {
    const req = httpRequest({ host, port, method, path, headers: { 'content-length': body.length, ...headers } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch { /* not json */ }
        done({ status: res.statusCode, json, text })
      })
    })
    req.on('error', fail)
    req.end(body)
  })
}

const signed = (body, { secret = SECRET, t = T } = {}) => ({ body, headers: { [SIGNATURE_HEADER]: signHeader(secret, t, body) } })
const bodyOf = (o) => Buffer.from(JSON.stringify(o))

test('a signed valid request reaches the runner once and answers with the service identity', async () => {
  const { port, calls } = await boot()
  const r = await call(port, signed(bodyOf(validRequest())))
  assert.equal(r.status, 200, r.text)
  assert.equal(calls.length, 1)
  assert.deepEqual(r.json.engine, IDENTITY)
  assert.deepEqual(r.json.results.map((x) => x.job), ['SYM0|D', 'SYM1|D'])
})

test('unsigned, badly signed, skewed or wrong-key requests are 401 and run zero jobs', async () => {
  const { port, calls } = await boot()
  const b = bodyOf(validRequest())
  const cases = [
    ['unsigned', { body: b }],
    ['malformed header', { body: b, headers: { [SIGNATURE_HEADER]: 'nope' } }],
    ['signed for another body', { body: b, headers: { [SIGNATURE_HEADER]: signHeader(SECRET, T, Buffer.from('{}')) } }],
    ['unknown key', signed(b, { secret: 'u'.repeat(64) })],
    ['61 s old', signed(b, { t: T - 61 })],
    ['61 s ahead', signed(b, { t: T + 61 })],
  ]
  for (const [name, opts] of cases) {
    const r = await call(port, opts)
    assert.equal(r.status, 401, `${name}: ${r.text}`)
    assert.equal(r.json.error.guard, 'runtime:server-auth', name)
  }
  assert.equal(calls.length, 0, 'no refused request reached the runner')
})

test('rotation over the wire: the second configured secret is accepted', async () => {
  const { port, calls } = await boot()
  const r = await call(port, signed(bodyOf(validRequest()), { secret: SECRET_2 }))
  assert.equal(r.status, 200, r.text)
  assert.equal(calls.length, 1)
})

test('replay: the same signed request is refused the second time, and runs once', async () => {
  const { port, calls } = await boot()
  const req = signed(bodyOf(validRequest()))
  assert.equal((await call(port, req)).status, 200)
  const again = await call(port, req)
  assert.equal(again.status, 401)
  assert.match(again.json.error.sentence, /already received/)
  assert.equal(calls.length, 1)
})

test('fuzz over HTTP (L5): signed malformed bodies are 400 with zero jobs run', async () => {
  let clock = T
  const { port, calls } = await boot({ now: () => clock })
  const rand = rng(0xbeef)
  for (let i = 0; i < 80; i += 1) {
    const m = mutate(rand)
    clock = T + i // a fresh signature each time: a repeated mutation is not a replay
    const r = await call(port, signed(m.body, { t: clock }))
    assert.equal(r.status, 400, `${m.name}: ${r.text}`)
    assert.equal(r.json.error.guard, 'runtime:server-schema')
  }
  assert.equal(calls.length, 0)
})

test('an oversized body is refused without being buffered, declared or streamed', { timeout: 30_000 }, async () => {
  const { port, calls } = await boot()
  const declared = await call(port, { body: Buffer.alloc(16), headers: { [SIGNATURE_HEADER]: signHeader(SECRET, T, Buffer.alloc(16)), 'content-length': MAX_BODY_BYTES + 1 } })
  assert.equal(declared.status, 400, 'refused on the declared length, before any byte is read')
  assert.match(declared.json.error.sentence, /larger than 16777216 bytes/)
  const big = Buffer.alloc(MAX_BODY_BYTES + 1, 0x20)
  const streamed = await new Promise((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/v1/run',
      headers: { [SIGNATURE_HEADER]: signHeader(SECRET, T - 1, big), 'transfer-encoding': 'chunked' } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => done({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', fail)
    for (let o = 0; o < big.length; o += 1 << 20) req.write(big.subarray(o, o + (1 << 20)))
    req.end()
  })
  assert.equal(streamed.status, 400)
  assert.match(streamed.text, /larger than 16777216 bytes/, 'refused by the streaming cap, not by a later parse')
  assert.equal(calls.length, 0)
})

test('integrity and engine refusals run zero jobs', async () => {
  const { port, calls } = await boot()
  const lie = validRequest(); lie.jobs[0].bars.sha256 = '0'.repeat(64)
  assert.equal((await call(port, signed(bodyOf(lie)))).status, 422)
  const other = validRequest(); other.engine.script_engine = 6
  assert.equal((await call(port, signed(bodyOf(other), { t: T - 1 }))).status, 409)
  assert.equal(calls.length, 0)
})

test('/health is liveness (always 200); /ready needs the runner and the canary', async () => {
  const none = await boot({ runner: null })
  assert.equal((await call(none.port, { method: 'GET', path: '/health' })).status, 200)
  assert.equal((await call(none.port, { method: 'GET', path: '/ready' })).status, 503)
  const r = await call(none.port, signed(bodyOf(validRequest())))
  assert.equal(r.status, 503, 'a valid signed run with no pool is withheld by name')
  assert.equal(r.json.error.guard, 'runtime:server-unavailable')

  const red = await boot({ canary: () => false })
  assert.equal((await call(red.port, { method: 'GET', path: '/health' })).status, 200)
  assert.equal((await call(red.port, { method: 'GET', path: '/ready' })).status, 503)
  assert.equal((await call(red.port, signed(bodyOf(validRequest())))).status, 503)
  assert.equal(red.calls.length, 0)

  const green = await boot()
  assert.equal((await call(green.port, { method: 'GET', path: '/ready' })).status, 200)
  assert.equal((await call(green.port, { method: 'GET', path: '/nope' })).status, 404)
  assert.equal((await call(green.port, { method: 'GET', path: '/v1/run' })).status, 405)
})

test('a runner that does not answer every job exactly once is a 500, never a partial reply', async () => {
  const short = await boot({ runner: async (req) => req.jobs.slice(1).map((j) => ({ job: j.job, status: 'ok' })) })
  const r = await call(short.port, signed(bodyOf(validRequest())))
  assert.equal(r.status, 500); assert.equal(r.json.results, undefined)
  const wrong = await boot({ runner: async (req) => req.jobs.map((j) => ({ job: j.job, status: 'maybe' })) })
  assert.equal((await call(wrong.port, signed(bodyOf(validRequest())))).status, 500)
  const swapped = await boot({ runner: async (req) => req.jobs.map((j) => ({ job: j.job, status: 'ok' })).reverse() })
  assert.equal((await call(swapped.port, signed(bodyOf(validRequest())))).status, 500)
  const throws = await boot({ runner: async () => { throw new Error('boom') } })
  const t = await call(throws.port, signed(bodyOf(validRequest())))
  assert.equal(t.status, 500); assert.doesNotMatch(t.text, /boom/)
})

test('no log line carries a secret, a body or a source', async () => {
  const { port, logs } = await boot()
  const q = validRequest()
  await call(port, signed(bodyOf(q), { secret: 'z'.repeat(64) }))
  q.extra = 1
  await call(port, signed(bodyOf(q)))
  assert.ok(logs.length >= 2)
  for (const l of logs) {
    for (const s of [SECRET, SECRET_2, 'z'.repeat(64), 'indicator(', 'u_0123456789ab', '9f1c0123456789ab']) assert.ok(!l.includes(s), l)
  }
})

test('dual-stack: one listener answers on IPv4 AND IPv6', async () => {
  const { port } = await boot()
  assert.equal((await call(port, { method: 'GET', path: '/health', host: '127.0.0.1' })).status, 200)
  assert.equal((await call(port, { method: 'GET', path: '/health', host: '::1' })).status, 200)
})

test('dual-stack proof can fail: an IPv6-only listener is refused at boot, not served', async () => {
  const server = createPineRuntimeServer({ secrets: [SECRET], door: DOOR, log: () => {} })
  await assert.rejects(listenDualStack(server, 0, { host: '::1' }), /not dual-stack \(IPv4 REFUSED, IPv6 ok\)/)
  assert.equal(server.listening, false, 'the refused listener is closed')
})

test('env allowlist (L2): any variable outside it refuses boot, by name and never by value', () => {
  const base = { PORT: '8080', PINE_RUNTIME_SERVICE_SECRET: SECRET, PATH: '/usr/bin', RAILWAY_PRIVATE_DOMAIN: 'pine-runtime.railway.internal' }
  assert.equal(envRefusal(base), null)
  assert.equal(envRefusal({}), null)
  for (const name of ['DATABASE_URL', 'RAILWAY_TOKEN', 'RAILWAY_PUBLIC_DOMAIN', 'NODE_OPTIONS', 'PINE_RUNTIME_SERVICE_URL', 'MASSIVE_API_KEY']) {
    const s = envRefusal({ ...base, [name]: 'leak-value-xyz' })
    assert.ok(s && s.includes(name), name)
    assert.ok(!s.includes('leak-value-xyz') && !s.includes(SECRET), 'names only')
  }
  assert.ok(ENV_ALLOWLIST.includes('PINE_RUNTIME_SERVICE_SECRET') && ENV_ALLOWLIST.includes('PORT'))
  assert.equal(ENV_ALLOWLIST.some((k) => /TOKEN|KEY|PASSWORD|DATABASE|PUBLIC|STATIC_URL|PROXY|OPTIONS/.test(k)), false)
})

/** Track 6 (2026-11-22): the names Railway injects into the RUNNING process of a service that has no
 *  public domain, measured from chart-renderer's /proc/1/environ (names only) the same day. Without these
 *  the first deploy of this service would have refused to boot. */
const RAILWAY_INJECTED_2026_11_22 = [
  'RAILWAY_SERVICE_BARS_API_URL', 'RAILWAY_SERVICE_STREAM_EDGE_URL', 'RAILWAY_SERVICE_TRADE_EXCHANGE_NEWS_RECEIVER_URL',
  'RAILWAY_SERVICE_TX_RECAP_URL', 'RAILWAY_SERVICE_WEB_FRONT_URL', 'RAILWAY_SERVICE_WEB_URL',
  'RAILWAY_BETA_ENABLE_RUNTIME_V2',
]

test('env allowlist, track 6: the 7 names Railway injects into a domainless service boot, and every platform agrees', () => {
  const base = { PORT: '8080', PINE_RUNTIME_SERVICE_SECRET: SECRET, PATH: '/usr/bin', RAILWAY_PRIVATE_DOMAIN: 'pine-runtime.railway.internal' }
  const injected = Object.fromEntries(RAILWAY_INJECTED_2026_11_22.map((n) => [n, 'web-production-05cb6.up.railway.app']))
  for (const platform of ['linux', 'win32']) {
    assert.equal(envRefusal({ ...base, ...injected }, platform), null, platform)
    for (const n of RAILWAY_INJECTED_2026_11_22) assert.equal(envNameAdmitted(n, platform), true, `${n} on ${platform}`)
  }
  // a NEW public service in the project (a name nobody listed) still boots: the reason for a pattern
  assert.equal(envRefusal({ ...base, RAILWAY_SERVICE_PINE_RUNTIME_V2_URL: 'x.up.railway.app' }), null)
})

test('env allowlist, track 6: the pattern admits the URL family ONLY; tokens, secrets and look-alikes stay refused', () => {
  const base = { PORT: '8080', PINE_RUNTIME_SERVICE_SECRET: SECRET, PATH: '/usr/bin' }
  const refused = [
    // the platform's own credential and public-exposure names
    'RAILWAY_TOKEN', 'RAILWAY_API_TOKEN', 'RAILWAY_PROJECT_TOKEN', 'RAILWAY_PUBLIC_DOMAIN', 'RAILWAY_STATIC_URL',
    'RAILWAY_TCP_PROXY_DOMAIN', 'RAILWAY_TCP_PROXY_PORT',
    // the family's prefix without its suffix, and its suffix without its prefix
    'RAILWAY_SERVICE_WEB_HOST', 'RAILWAY_SERVICE_WEB', 'RAILWAY_SERVICE_', 'RAILWAY_SERVICE__URL', 'SERVICE_WEB_URL',
    'RAILWAY_WEB_URL', 'XRAILWAY_SERVICE_WEB_URL', 'RAILWAY_SERVICE_WEB_URLX', 'railway_service_web_url',
    // the family's shape carrying a credential word: refused by ENV_PATTERN_DENY
    'RAILWAY_SERVICE_X_TOKEN_URL', 'RAILWAY_SERVICE_X_SECRET_URL', 'RAILWAY_SERVICE_API_KEY_URL',
    'RAILWAY_SERVICE_DB_PASSWORD_URL',
    // any *_TOKEN / *_SECRET, Railway-prefixed or not
    'RAILWAY_SERVICE_WEB_TOKEN', 'RAILWAY_SERVICE_WEB_SECRET', 'GITHUB_TOKEN', 'SESSION_SECRET', 'PUSH_SECRET',
    'CHART_EDGE_SECRET', 'DATABASE_URL', 'NODE_OPTIONS', 'PINE_RUNTIME_SERVICE_URL',
  ]
  for (const platform of ['linux', 'win32']) {
    for (const name of refused) {
      assert.equal(envNameAdmitted(name, platform), false, `${name} on ${platform}`)
      const s = envRefusal({ ...base, [name]: 'leak-value-xyz' }, platform)
      assert.ok(s && s.includes(name), `${name} refuses the boot on ${platform}`)
      assert.ok(!s.includes('leak-value-xyz') && !s.includes(SECRET), `names only: ${name}`)
    }
  }
  // exactly one pattern, anchored at both ends
  assert.equal(ENV_ALLOWLIST_PATTERNS.length, 1)
  assert.equal(String(ENV_ALLOWLIST_PATTERNS[0]), String(/^RAILWAY_SERVICE_[A-Z0-9_]+_URL$/))
  // the exact list still carries no credential-looking name beyond the one key, and the new exact name
  assert.ok(ENV_ALLOWLIST.includes('RAILWAY_BETA_ENABLE_RUNTIME_V2'))
  assert.equal(ENV_ALLOWLIST.filter((k) => /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/.test(k)).join(','), 'PINE_RUNTIME_SERVICE_SECRET')
})

test('env allowlist, WINDOWS ONLY: SYSTEMROOT is admitted on win32 and nowhere else; nothing else is admitted', () => {
  const base = { PORT: '8080', PINE_RUNTIME_SERVICE_SECRET: SECRET, PATH: '/usr/bin' }
  assert.deepEqual([...WIN32_ENV_ALLOWLIST], ['SYSTEMROOT'])
  assert.equal(ENV_ALLOWLIST.includes('SYSTEMROOT'), false, 'production\'s list is unchanged')
  // (a) on a non-win32 platform it is still refused, by name (the platform is injected, never the box's)
  for (const platform of ['linux', 'darwin', 'freebsd']) {
    const s = envRefusal({ ...base, SYSTEMROOT: 'C:\\Windows' }, platform)
    assert.ok(s && s.includes('SYSTEMROOT'), platform)
    assert.equal(envAllowlistFor(platform), ENV_ALLOWLIST, platform)
  }
  // on win32 it is admitted
  assert.equal(envRefusal({ ...base, SYSTEMROOT: 'C:\\Windows' }, 'win32'), null)
  // (b) on win32 any other variable is still refused, git-bash's and Windows' own included
  for (const name of ['WINDIR', 'MSYSTEM', 'SystemRoot', 'COMSPEC', 'TEMP', 'USERPROFILE', 'DATABASE_URL', 'RAILWAY_TOKEN', 'NODE_OPTIONS']) {
    const s = envRefusal({ ...base, SYSTEMROOT: 'C:\\Windows', [name]: 'leak-value-xyz' }, 'win32')
    assert.ok(s && s.includes(name), name)
    // (c) the sentence names names only, never a value
    assert.ok(!s.includes('leak-value-xyz') && !s.includes(SECRET) && !s.includes('C:\\Windows'), `names only: ${name}`)
  }
})

test('workers, track 6: the pool follows the stated count, never the host CPUs (48 on Railway inside a 2 vCPU limit)', () => {
  assert.equal(DEFAULT_SERVICE_WORKERS, 2)
  assert.equal(workersOf({}, 48), 2, 'unset on a 48-CPU host: 2, not 48')
  assert.equal(workersOf({ PINE_RUNTIME_WORKERS: '' }, 48), 2)
  assert.equal(workersOf({}, 1), 1, 'never more than the host has when unset')
  assert.equal(workersOf({ PINE_RUNTIME_WORKERS: '4' }, 48), 4)
  assert.equal(workersOf({ PINE_RUNTIME_WORKERS: String(MAX_SERVICE_WORKERS) }, 48), MAX_SERVICE_WORKERS)
  for (const bad of ['0', '17', '99', '-1', '2.5', 'two', ' 2', '2 ', '007']) {
    assert.throws(() => workersOf({ PINE_RUNTIME_WORKERS: bad }, 48), /PINE_RUNTIME_WORKERS is not a whole number/, bad)
  }
  assert.ok(ENV_ALLOWLIST.includes('PINE_RUNTIME_WORKERS'))
  assert.equal(envRefusal({ PORT: '8080', PINE_RUNTIME_WORKERS: '2' }), null)
  // the boot passes it to the pool, and a test's own count (poolOpts.workers) still wins
  const text = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(text, /createPool\(\{ workers: workersOf\(env\), \.\.\.poolOpts, bundle \}\)/)
})

test('PORT: unset is the default; anything but a whole port number refuses boot', () => {
  assert.equal(portOf({}), 8080)
  assert.equal(portOf({ PORT: '3000' }), 3000)
  for (const p of ['0', '65536', 'abc', '80.5', ' 80']) assert.throws(() => portOf({ PORT: p }), /PORT/, p)
})
