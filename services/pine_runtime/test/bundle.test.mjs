// W5-T6 rail: the door's facts come FROM the T1 bundle (identity, timeframes, bars ceiling), and
// `main()` boots it end to end on a dual-stack port. Builds the bundle once into a temp dir.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPineRuntime } from '../../../app/scripts/build-pine-runtime.mjs'
import { SCRIPT_ENGINE_VERSION } from '../../../app/src/components/chart/engine/scriptEngineVersion.js'
import { RUNTIME_IR_VERSION } from '../../../app/src/components/chart/engine/runtime/ir.js'
import { DEFAULT_LIMITS } from '../../../app/src/components/chart/engine/runtime/limits.js'
import { NATIVE_TFS } from '../../../app/src/components/chart/timeframes.js'
import { signHeader, SIGNATURE_HEADER } from '../auth.mjs'
import { loadBundle, main } from '../server.mjs'
import { SECRET, validRequest } from './helpers.mjs'

let dir
let outfile
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pine-rt-t6-'))
  outfile = join(dir, 'pine-runtime.mjs')
  await buildPineRuntime({ outfile, logLevel: 'silent', env: {} })
})
after(() => rmSync(dir, { recursive: true, force: true }))

const freePort = () => new Promise((done) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)) })
})

test('loadBundle derives identity, timeframes and the bars ceiling from the bundle itself', async () => {
  const { identity, tfSet, maxBars } = await loadBundle(outfile)
  assert.equal(identity.script_engine, SCRIPT_ENGINE_VERSION)
  assert.equal(identity.runtime_ir, RUNTIME_IR_VERSION)
  assert.equal(identity.runtime_language, 'pine')
  assert.equal(identity.bundle_sha256, createHash('sha256').update(readFileSync(outfile)).digest('hex'),
    'the sha256 of the bytes on disk, not a manifest claim')
  assert.deepEqual(tfSet, NATIVE_TFS)
  assert.equal(maxBars, DEFAULT_LIMITS.HISTORY)
})

test('main() refuses to boot with a foreign variable or without a secret', async () => {
  await assert.rejects(main({ env: { PINE_RUNTIME_SERVICE_SECRET: SECRET, DATABASE_URL: 'x' }, bundle: outfile, log: () => {} }),
    /outside its allowlist are set \(DATABASE_URL\)/)
  await assert.rejects(main({ env: {}, bundle: outfile, log: () => {} }), /unset or empty/)
})

test('main() boots: one fingerprint line, and a signed run built for the bundle reaches the runner', async () => {
  const port = await freePort()
  const logs = []
  const calls = []
  const runner = async (req) => { calls.push(req); return req.jobs.map((j) => ({ job: j.job, status: 'withheld', refusals: [{ key: '*', guard: 'runtime:stub', sentence: 'a stub runner.', bar: null }] })) }
  const server = await main({ env: { PINE_RUNTIME_SERVICE_SECRET: SECRET, PORT: String(port) }, bundle: outfile, runner, log: (l) => logs.push(l) })
  try {
    const { identity } = await loadBundle(outfile)
    assert.equal(logs.length, 1)
    assert.match(logs[0], new RegExp(`^\\[pine-runtime\\] boot engine=${SCRIPT_ENGINE_VERSION}/\\d+/${RUNTIME_IR_VERSION} bundle=${identity.bundle_sha256.slice(0, 12)} node=v\\d+`))
    const q = validRequest(); q.engine = { ...identity }
    const body = Buffer.from(JSON.stringify(q))
    const t = Math.floor(Date.now() / 1000)
    const status = await new Promise((done, fail) => {
      const r = httpRequest({ host: '::1', port, method: 'POST', path: '/v1/run',
        headers: { 'content-length': body.length, [SIGNATURE_HEADER]: signHeader(SECRET, t, body) } }, (res) => { res.resume(); res.on('end', () => done(res.statusCode)) })
      r.on('error', fail); r.end(body)
    })
    assert.equal(status, 200)
    assert.equal(calls.length, 1)
  } finally {
    await new Promise((d) => server.close(d))
  }
})
