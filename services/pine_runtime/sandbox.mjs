// services/pine_runtime/sandbox.mjs
//
// W5-T7: THE JOB WORKER'S SANDBOX (docs/pine/SERVER-RUNTIME-DESIGN.md section 4, L1/L3/L4, H4/H9).
// This file is both the worker's entry (pool.mjs starts it with `workerData.role`) and, imported
// on the main thread, the home of the L1 bundle scan and the L4 self-test.
//
// L3, IN THE WORKER, IN THIS ORDER, BEFORE THE BUNDLE IS EVALUATED:
//   1. `applyPreamble()` deletes the network, code-loading and scheduling globals
//      (REMOVED_GLOBALS) and the native-reaching process methods (REMOVED_PROCESS), then
//      materialises Node's lazy globals and FREEZES `globalThis`;
//   2. only then is the bundle `import()`ed (a dynamic import, so it evaluates after step 1).
//   The worker is started with `env: {}` and the pool's `resourceLimits`; `terminate()` is the
//   hard stop and the pool never reuses a terminated worker.
//
// L1: `scanBundle(text)` reads the built bundle for capability tokens (L1_TOKENS). Any hit outside
// L1_ALLOWLIST refuses the pool's boot; an allowlist entry that matches no line is reported as
// stale, so the list cannot outlive what it excuses (the rail fails on a stale entry).
//
// L4: `selfTestL4()` starts a worker and tries a file write, a child process and code generation
// from a string. Under the service's node flags (--permission, --disallow-code-generation-from-
// strings; T10 sets them) all three throw. The production boot (server.mjs main) refuses to start
// unless they do.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads'
import { budgetOf, runJob } from './job.mjs'

export const SANDBOX_URL = new URL(import.meta.url)
export const ROLE_JOB = 'pine-runtime-job'
export const ROLE_L4 = 'pine-runtime-l4-selftest'

/** Globals a job never needs: network (H4), code loading, scheduling and host channels (H9). */
export const REMOVED_GLOBALS = Object.freeze([
  'fetch', 'Request', 'Response', 'Headers', 'FormData', 'WebSocket', 'EventSource', 'XMLHttpRequest',
  'CloseEvent', 'MessageEvent', 'WebAssembly', 'navigator', 'Navigator', 'crypto', 'Crypto', 'CryptoKey',
  'SubtleCrypto', 'BroadcastChannel', 'MessageChannel', 'MessagePort',
  'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask',
])
/** `process` methods that reach native code, other processes or a module loader. W5-INT:
 *  `getBuiltinModule` (Node >= 20.16, so on the 20.18 pin) is a SYNCHRONOUS loader of any node:
 *  built-in (node:net, node:fs, ...) for code that holds `process`: the door L3 closes. */
export const REMOVED_PROCESS = Object.freeze(['binding', '_linkedBinding', 'dlopen', 'kill', '_kill', 'getBuiltinModule'])

/** L3 preamble. Returns what it removed, for the boot record. */
export function applyPreamble(g = globalThis) {
  const removed = []
  for (const k of REMOVED_GLOBALS) {
    if (Object.hasOwn(g, k)) { delete g[k]; removed.push(k) }
  }
  const proc = g.process
  for (const k of REMOVED_PROCESS) {
    if (proc && k in proc) { delete proc[k]; removed.push(`process.${k}`) }
  }
  // Node defines some globals as lazy accessors that install a property on first read; a frozen
  // global object would make that first read throw, so read each one once, then freeze.
  for (const k of Object.getOwnPropertyNames(g)) { try { void g[k] } catch { /* a getter that throws stays absent */ } }
  Object.freeze(g)
  return removed
}

/** L1: capability tokens that must not appear in the server bundle (design section 4). `fs`, `net`
 *  and `http` are read as MODULE SPECIFIERS (quoted), since the bare letters occur in ordinary text. */
export const L1_TOKENS = Object.freeze([
  ['eval', /\beval\s*\(/],
  ['Function', /\bFunction\s*\(/],
  ['dynamic import', /\bimport\s*\(/],
  ['static import', /^\s*(?:import|export)\b[^\n]*\bfrom\s*['"`]/],
  ['require', /\brequire\s*\(/],
  ['process', /\bprocess\s*(?:\.|\[)/],
  ['child_process', /child_process/],
  ['node module', /['"`](?:node:)?(?:fs|fs\/promises|net|http|https|http2|dgram|dns|tls|vm|worker_threads|module|inspector|os)['"`]/],
  ['network', /\b(?:fetch|WebSocket|XMLHttpRequest|EventSource|importScripts)\s*\(/],
])

/** Lines allowed to hold a token, matched on their exact trimmed text, each with its reason. */
// train (W5-T7 x W5-T2): the three `network` lines this list excused (serverCompute.js, runtimeKill.js,
// lib/runtimePanePermission.js) were each marked "until W5-T2 cuts the edge (H4)"; W5-T2 cut it, the bundle no
// longer holds them, and a stale entry must leave the list (sandbox.test.mjs). The list is empty: no token is excused.
export const L1_ALLOWLIST = Object.freeze([])

/** L1 scan: `{ hits: [{token, line, text}], stale: [allowlist entries matching nothing] }`. */
export function scanBundle(text, allowlist = L1_ALLOWLIST) {
  const hits = []
  const used = new Set()
  text.split('\n').forEach((raw, i) => {
    const t = raw.trim()
    for (const [token, re] of L1_TOKENS) {
      if (!re.test(raw)) continue
      const allowed = allowlist.findIndex((a) => a.token === token && a.line === t)
      if (allowed >= 0) used.add(allowed)
      else hits.push({ token, line: i + 1, text: t.slice(0, 160) })
    }
  })
  return { hits, stale: allowlist.filter((_, i) => !used.has(i)) }
}

/** Where the self-test tries to write: the temp dir, the one place the image's read-only root
 *  file system still allows, so only the permission model can stop the write. */
export const DEFAULT_L4_TARGET = join(tmpdir(), 'pine-runtime-l4-selftest')

/**
 * L4 self-test: from inside a sandboxed worker, try a file write at `target`, a child process and
 * code generation from a string. `{ ok, results: {fsWrite, spawn, codegen} }`, each 'threw' or
 * 'ALLOWED'; ok only when all three threw.
 */
export function selfTestL4({ target = DEFAULT_L4_TARGET, execPath = process.execPath } = {}) {
  if (typeof target !== 'string' || target === '') throw new Error('the L4 self-test needs a file path to try')
  return new Promise((done, fail) => {
    const w = new Worker(SANDBOX_URL, { workerData: { role: ROLE_L4, target, execPath }, env: {} })
    w.once('message', (results) => {
      w.terminate().then(() => done({ ok: Object.values(results).every((r) => r === 'threw'), results }))
    })
    w.once('error', fail)
  })
}

async function l4Worker({ target, execPath }) {
  // node: built-ins are bound BEFORE the preamble on purpose: the self-test asks what the
  // process flags allow, not whether the preamble hid a name.
  const fs = await import('node:fs')
  const cp = await import('node:child_process')
  applyPreamble()
  const results = {}
  try { fs.writeFileSync(target, 'x'); results.fsWrite = 'ALLOWED'; fs.rmSync(target, { force: true }) } catch { results.fsWrite = 'threw' }
  try { cp.spawnSync(execPath, ['--version'], { stdio: 'ignore' }); results.spawn = 'ALLOWED' } catch { results.spawn = 'threw' }
  try { (0, Object.getPrototypeOf(function f() {}).constructor)('return 1')(); results.codegen = 'ALLOWED' } catch { results.codegen = 'threw' }
  parentPort.postMessage(results)
}

async function jobWorker({ bundle }) {
  const removed = applyPreamble()
  let rt
  try {
    rt = await import(bundle)
    for (const k of ['computeRuntimeColumns', 'resetRuntimeSessions', 'resetRuntimeLedgers', 'runtimeWarmupOf', 'encodeColumn', 'bytesToB64']) {
      if (typeof rt[k] !== 'function') throw new Error(`the bundle exports no ${k}`)
    }
    budgetOf(rt) // W5-INT: no explicit wall budget, no worker (job.mjs header, "time budget")
  } catch (e) {
    parentPort.postMessage({ type: 'boot-error', message: String((e && e.message) || e).slice(0, 400) })
    return
  }
  parentPort.on('message', (m) => {
    parentPort.postMessage({ type: 'result', id: m.id, result: runJob(rt, m.doc, m.job) })
  })
  parentPort.postMessage({ type: 'ready', removed })
}

if (!isMainThread && workerData && workerData.role === ROLE_JOB) jobWorker(workerData)
if (!isMainThread && workerData && workerData.role === ROLE_L4) l4Worker(workerData)
