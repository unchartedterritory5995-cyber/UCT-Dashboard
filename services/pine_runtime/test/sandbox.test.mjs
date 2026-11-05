// W5-T7 rail: the sandbox (sandbox.mjs). L1: the built bundle holds no capability token outside
// the allowlist, and the scan can fail. L3: the preamble runs BEFORE the bundle evaluates and
// leaves the job no network, no scheduling, no native process doors, an empty env and a frozen
// global. L4: the self-test passes only under the service's node flags.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPool } from '../pool.mjs'
import { DEFAULT_L4_TARGET, L1_ALLOWLIST, L1_TOKENS, REMOVED_GLOBALS, REMOVED_PROCESS, SANDBOX_URL, applyPreamble, scanBundle, selfTestL4 } from '../sandbox.mjs'
import { FAKE_BUNDLE, buildRealBundle, decodeColumn, parsedRequest } from './poolFixtures.mjs'

let real
let dir
before(async () => {
  real = await buildRealBundle()
  dir = mkdtempSync(join(tmpdir(), 'pine-rt-t7-sb-'))
})
after(() => { real.cleanup(); rmSync(dir, { recursive: true, force: true }) })

test('L1: the built server bundle holds no capability token outside the allowlist, and no allowlist entry is stale', () => {
  const { hits, stale } = scanBundle(readFileSync(real.outfile, 'utf8'))
  assert.deepEqual(hits, [])
  assert.deepEqual(stale, [], 'an allowlisted line the bundle no longer holds must leave the list')
})

test('L1 can fail: every token is caught, an allowlisted line passes only verbatim, a stale entry is named', () => {
  const lines = {
    eval: 'x = eval("1")', Function: 'const f = new Function("return 1")', 'dynamic import': 'await import("./x.js")',
    'static import': "import fs from 'fs'", require: 'const m = require("m")', process: 'const e = process.env',
    child_process: 'const cp = "child_process"', 'node module': "const s = 'node:net'", network: 'fetch(url)',
  }
  assert.deepEqual(Object.keys(lines).sort(), L1_TOKENS.map(([t]) => t).sort())
  for (const [token, line] of Object.entries(lines)) {
    const { hits } = scanBundle(`ok\n  ${line}\nok`, [])
    assert.ok(hits.some((h) => h.token === token && h.line === 2), `${token}: ${JSON.stringify(hits)}`)
  }
  for (const alt of ["x = process['env']", 'import x from "./y.js"', 'export { a } from "./b.js"', "s = 'fs'", 's = "node:http"']) {
    assert.equal(scanBundle(alt, []).hits.length, 1, alt)
  }
  for (const benign of ['const offset = 2', 'http_status = 200 // https docs', 'a.processed = true', 'reimport(x)', 'myFetch(x)']) {
    assert.deepEqual(scanBundle(benign, []).hits, [], benign)
  }
  // train: L1_ALLOWLIST is empty since W5-T2 cut the edges it excused; the matcher is proved on a synthetic entry
  const entry = { token: 'network', line: 'return fetch(url, { credentials: "include" }).then((r) => {', why: 'synthetic, for the matcher' }
  assert.deepEqual(scanBundle(`    ${entry.line}`, [entry]), { hits: [], stale: [] })
  assert.equal(scanBundle(`${entry.line} // and more`, [entry]).hits.length, 1, 'only the exact line is excused')
  assert.deepEqual(scanBundle('nothing here', [entry]).stale, [entry])
  const both = 'fetch(process.env.X)'
  const hits = scanBundle(both, [{ token: 'network', line: both, why: 'test' }]).hits
  assert.deepEqual(hits.map((h) => h.token), ['process'], 'an entry excuses its own token only')
})

test('L1: the pool refuses to start on a bundle with a capability token, and starts no worker', async () => {
  const bad = join(dir, 'tainted.mjs')
  writeFileSync(bad, `${readFileSync(FAKE_BUNDLE, 'utf8')}\nexport const leak = () => globalThis.fetch && fetch('http://x')\n`)
  await assert.rejects(createPool({ bundle: bad, workers: 1 }), /1 capability token\(s\) outside the L1 allowlist \(network at line \d+\)/)
})

test('L3: inside a job, every removed global and process door is absent, at bundle evaluation AND at run time', async () => {
  const pool = await createPool({ bundle: FAKE_BUNDLE, workers: 1 })
  try {
    const [r] = await pool.run(parsedRequest({ source: 'probe' }))
    assert.equal(r.status, 'ok')
    const v = (k) => decodeColumn(r.columns[k])[0]
    for (const k of REMOVED_GLOBALS) assert.equal(v(k), 1, `${k} is reachable`)
    for (const k of ['require', 'module', 'importScripts']) assert.equal(v(k), 1, `${k} is reachable`)
    for (const k of REMOVED_PROCESS) assert.equal(v(`proc:${k}`), 1, `process.${k} is reachable`)
    // W5-INT: named on its own, so dropping it from REMOVED_PROCESS cannot also drop it from the loop
    // above. Present on this host (Node >= 20.16) and absent inside the job.
    assert.equal(typeof process.getBuiltinModule, 'function', 'the host has the door this rail closes')
    assert.equal(v('proc:getBuiltinModule'), 1, 'process.getBuiltinModule (a sync node: module loader) is reachable')
    assert.equal(v('frozen'), 1, 'globalThis is frozen')
    assert.equal(v('env'), 0, 'the worker env is empty')
  } finally {
    await pool.close()
  }
})

test('L3: applyPreamble removes what it lists and freezes the object it is given', () => {
  const g = { fetch: 1, setTimeout: 2, keep: 3, process: { binding: 1, dlopen: 2, exit: 3 } }
  Object.defineProperty(g, 'lazy', { configurable: true, enumerable: false, get() { return 4 } })
  const removed = applyPreamble(g)
  assert.deepEqual(removed, ['fetch', 'setTimeout', 'process.binding', 'process.dlopen'])
  assert.deepEqual(Object.keys(g).sort(), ['keep', 'process'])
  assert.ok(Object.isFrozen(g))
  assert.equal(typeof g.process.exit, 'number')
})

const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission'
function selfTestIn(flags, target) {
  const script = `import { selfTestL4 } from ${JSON.stringify(SANDBOX_URL.href)}\n`
    + `console.log(JSON.stringify(await selfTestL4(${target === undefined ? '' : `{ target: ${JSON.stringify(target)} }`})))`
  const file = join(dir, `l4-${flags.length}.mjs`)
  writeFileSync(file, script)
  const p = spawnSync(process.execPath, [...flags, file], { encoding: 'utf8', timeout: 60_000 })
  assert.equal(p.status, 0, p.stderr)
  return JSON.parse(p.stdout.trim().split('\n').pop())
}

test('L4: under the service flags a worker can write no file, spawn no process and generate no code', () => {
  const target = join(dir, 'l4-flags.txt')
  const r = selfTestIn([permissionFlag, '--allow-fs-read=*', '--allow-worker', '--disallow-code-generation-from-strings'], target)
  assert.deepEqual(r, { ok: true, results: { fsWrite: 'threw', spawn: 'threw', codegen: 'threw' } })
  assert.equal(existsSync(target), false)
})

test('L4: one flag missing is enough to fail the self-test', () => {
  const r = selfTestIn([permissionFlag, '--allow-fs-read=*', '--allow-worker'], join(dir, 'l4-partial.txt'))
  assert.deepEqual(r, { ok: false, results: { fsWrite: 'threw', spawn: 'threw', codegen: 'ALLOWED' } })
})

test('L4: the boot\'s default target is a writable path, so only the flags can make the write throw', () => {
  assert.ok(DEFAULT_L4_TARGET.startsWith(tmpdir()))
  assert.throws(() => selfTestL4({ target: null }), /needs a file path/)
  const bare = selfTestIn([], undefined)
  assert.equal(bare.results.fsWrite, 'ALLOWED', 'with no flags the default target IS written (and removed)')
  assert.equal(existsSync(DEFAULT_L4_TARGET), false)
  const flagged = selfTestIn([permissionFlag, '--allow-fs-read=*', '--allow-worker', '--disallow-code-generation-from-strings'], undefined)
  assert.equal(flagged.ok, true)
})

test('L4 can fail: without the flags the self-test names all three, and the production pool refuses to start', async () => {
  const target = join(dir, 'l4-bare.txt')
  const r = selfTestIn([], target)
  assert.deepEqual(r, { ok: false, results: { fsWrite: 'ALLOWED', spawn: 'ALLOWED', codegen: 'ALLOWED' } })
  assert.equal(existsSync(target), false, 'the self-test removes what it wrote')
  const copy = join(dir, 'fake.mjs')
  copyFileSync(FAKE_BUNDLE, copy)
  await assert.rejects(createPool({ bundle: copy, workers: 1, requireL4: true, l4Target: join(dir, 'l4-pool.txt') }),
    /L4 self-test found fsWrite, spawn, codegen allowed/)
  assert.deepEqual((await selfTestL4({ target: join(dir, 'l4-direct.txt') })).ok, false)
})
