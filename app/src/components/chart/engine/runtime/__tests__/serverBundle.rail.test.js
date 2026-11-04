// @vitest-environment node
// app/src/components/chart/engine/runtime/__tests__/serverBundle.rail.test.js
//
// ⭐ W5-T1 — THE SERVER BUNDLE (docs/pine/SERVER-RUNTIME-DESIGN.md, 2.2 H2/H3 and task T1).
// `scripts/build-pine-runtime.mjs` must produce ONE ES module that imports under bare `node`
// with no node_modules: no bare import left, every JSON inlined, `import.meta.env` baked once,
// the identity constants exported from the modules that declare them, and a real 5,000-bar-style
// run executing in a child process whose directory holds nothing but the bundle.
import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildPineRuntime, viteEnvOf } from '../../../../../../scripts/build-pine-runtime.mjs'
import { SCRIPT_ENGINE_VERSION } from '../../scriptEngineVersion.js'
import { RUNTIME_FRONTEND_LANGUAGE, RUNTIME_FRONTEND_VERSION } from '../../ast/pineRuntimeFrontend.js'
import { RUNTIME_IR_VERSION } from '../ir.js'
import { NATIVE_TFS } from '../../../timeframes.js'
import { DEFAULT_LIMITS } from '../limits.js'
import {
  RUNTIME_PANE_TIME_BUDGET_MS, RUNTIME_INCREMENTAL_KEY, RUNTIME_TIME_BUDGET_GUARD, RUNTIME_FAILED_GUARD,
} from '../runtimeColumns.js'
import { RUNTIME_OBJECTS_KEY } from '../runtimeObjects.js'
import { columnDigest } from '../columnDigest.js'

const APP = path.resolve(process.cwd())
const REPO = path.resolve(APP, '..')
const SERIES = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'vw-deadband-ticks-aapl-1d-2026-09-28.json')
const MEASURE = path.join(APP, 'scripts', 'measure-pine-runtime.mjs')
const EXPORTS = [
  'DEFAULT_LIMITS', 'NATIVE_TFS', 'RUNTIME_FAILED_GUARD', 'RUNTIME_FRONTEND_LANGUAGE', 'RUNTIME_FRONTEND_VERSION',
  'RUNTIME_INCREMENTAL_KEY', 'RUNTIME_IR_VERSION', 'RUNTIME_OBJECTS_KEY', 'RUNTIME_PANE_TIME_BUDGET_MS',
  'RUNTIME_TIME_BUDGET_GUARD', 'SCRIPT_ENGINE_VERSION',
  'columnDigest', 'computeRuntimeColumns', 'decodeColumn', 'resetRuntimeLedgers', 'resetRuntimeSessions',
  'runtimeVersionRefusal', 'runtimeWarmupOf',
]

let dir, built, text
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'pine-rt-bundle-'))
  built = await buildPineRuntime({ outfile: path.join(dir, 'pine-runtime.mjs'), logLevel: 'silent', env: {} })
  text = readFileSync(built.outfile, 'utf8')
}, 120000)

describe('server bundle (W5-T1)', () => {
  it('leaves no bare or JSON import: only node: builtins may be imported', () => {
    const specs = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n;]*?\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1])
      .concat([...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]))
      .concat([...text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]))
    const bad = specs.filter((s) => !s.startsWith('node:'))
    expect(bad).toEqual([])
    expect(text).not.toMatch(/from\s*["'][^"']*\.json["']/)
  })

  it('inlines jsep and the four JSON tables', () => {
    expect(text).toMatch(/jsep/i)
    expect(built.manifest.modules).toBeGreaterThan(80)
  })

  it('exports the entry surface and the identity constants read from their declaring modules', async () => {
    const mod = await import(/* @vite-ignore */ pathToFileURL(built.outfile).href)
    expect(Object.keys(mod).sort()).toEqual(EXPORTS)
    expect(mod.SCRIPT_ENGINE_VERSION).toBe(SCRIPT_ENGINE_VERSION)
    expect(mod.RUNTIME_FRONTEND_LANGUAGE).toBe(RUNTIME_FRONTEND_LANGUAGE)
    expect(mod.RUNTIME_FRONTEND_VERSION).toBe(RUNTIME_FRONTEND_VERSION)
    expect(mod.RUNTIME_IR_VERSION).toBe(RUNTIME_IR_VERSION)
    expect(mod.NATIVE_TFS).toEqual(NATIVE_TFS)
    expect(mod.DEFAULT_LIMITS).toEqual(DEFAULT_LIMITS)
    // W5-T7: the job adapter's reads, each the declaring module's own value
    expect(mod.RUNTIME_PANE_TIME_BUDGET_MS).toBe(RUNTIME_PANE_TIME_BUDGET_MS)
    expect(mod.RUNTIME_INCREMENTAL_KEY).toBe(RUNTIME_INCREMENTAL_KEY)
    expect(mod.RUNTIME_TIME_BUDGET_GUARD).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(mod.RUNTIME_FAILED_GUARD).toBe(RUNTIME_FAILED_GUARD)
    expect(mod.RUNTIME_OBJECTS_KEY).toBe(RUNTIME_OBJECTS_KEY)
    // W5-T7b: the codec and the warm-up reader are the declaring modules' own functions' behaviour
    const engine = { script_engine: 1, runtime_language: 'pine', runtime_frontend: 1, runtime_ir: 1, bundle_sha256: '0'.repeat(64) }
    const run = { engine, columns: { a: [1, NaN, -0] }, refusals: [{ key: 'b', guard: 'g', bar: null }] }
    expect(mod.columnDigest(run)).toBe(columnDigest(run))
    expect([...mod.decodeColumn(new Uint8Array(8), 1)]).toEqual([0])
    expect(mod.runtimeWarmupOf({})).toBe(null)
  })

  it('bakes import.meta.env once: no live read remains, the VITE_* value moves the bundle', async () => {
    expect(text.split(String.fromCharCode(10)).filter((l) => !l.startsWith('//') && l.includes('import.meta'))).toEqual([])
    const on = await buildPineRuntime({ outfile: path.join(dir, 'on', 'pine-runtime.mjs'), logLevel: 'silent',
      env: { VITE_PINE_LOWER_TF_ENABLED: '1', NOT_BAKED: 'x' } })
    expect(on.manifest.viteEnvNames).toEqual(['VITE_PINE_LOWER_TF_ENABLED'])
    expect(on.manifest.sha256).not.toBe(built.manifest.sha256)
    expect(built.manifest.viteEnvNames).toEqual([])
    expect(Object.entries(viteEnvOf({ VITE_B: '2', X: '1', VITE_A: '1' }))).toEqual([['VITE_A', '1'], ['VITE_B', '2']])
  })

  it('is deterministic: a second build of the same tree has the same sha256', async () => {
    const again = await buildPineRuntime({ outfile: path.join(dir, 'again', 'pine-runtime.mjs'), logLevel: 'silent', env: {} })
    expect(again.manifest.sha256).toBe(built.manifest.sha256)
  })

  it('runs a Pine document over bars under bare node, in a directory holding only the bundle', () => {
    const iso = mkdtempSync(path.join(tmpdir(), 'pine-rt-bare-'))
    copyFileSync(built.outfile, path.join(iso, 'pine-runtime.mjs'))
    copyFileSync(MEASURE, path.join(iso, 'measure.mjs'))
    expect(readdirSync(iso).sort()).toEqual(['measure.mjs', 'pine-runtime.mjs'])
    const env = { ...process.env }
    delete env.NODE_PATH
    const r = spawnSync(process.execPath, ['measure.mjs', '--bundle', 'pine-runtime.mjs', '--bars', SERIES, '--n', '400', '--runs', '2'],
      { cwd: iso, env, encoding: 'utf8', timeout: 120000 })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout.trim().split('\n').pop())
    expect(out.bars).toBe(400)
    expect(out.columns).toBe(4)
    expect(out.finiteValues).toBeGreaterThan(1400) // 4 columns x 400 bars, less the warm-up
    expect(out.engine.SCRIPT_ENGINE_VERSION).toBe(SCRIPT_ENGINE_VERSION)
  }, 150000)
})
