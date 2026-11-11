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
import { SERVER_BUNDLE_VITE_NAMES, buildPineRuntime, defineOf, viteEnvOf } from '../../../../../../scripts/build-pine-runtime.mjs'
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
import { walk } from '../../../../../../../tools/pine_runtime_closure.mjs'

const APP = path.resolve(process.cwd())
const REPO = path.resolve(APP, '..')
const SERIES = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'vw-deadband-ticks-aapl-1d-2026-09-28.json')
const MEASURE = path.join(APP, 'scripts', 'measure-pine-runtime.mjs')
import { STRATEGY_RECORD_SCHEMA, strategyRecordShapeErrors } from '../strategyRecord.js'

const EXPORTS = [
  'DEFAULT_LIMITS', 'NATIVE_TFS', 'RUNTIME_FAILED_GUARD', 'RUNTIME_FRONTEND_LANGUAGE', 'RUNTIME_FRONTEND_VERSION',
  'RUNTIME_INCREMENTAL_KEY', 'RUNTIME_IR_VERSION', 'RUNTIME_OBJECTS_KEY', 'RUNTIME_PANE_TIME_BUDGET_MS',
  'RUNTIME_TIME_BUDGET_GUARD', 'SCRIPT_ENGINE_VERSION', 'STRATEGY_RECORD_SCHEMA',
  'bytesToB64', 'columnDigest', 'computeRuntimeColumns', 'decodeColumn', 'encodeColumn', 'resetRuntimeLedgers', 'resetRuntimeSessions',
  'runtimeStrategyOf', 'runtimeVersionRefusal', 'runtimeWarmupOf', 'strategyRecordShapeErrors',
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

  it('inlines jsep and the JSON tables: every module and JSON of the compute closure is in the bundle', () => {
    expect(text).toMatch(/jsep/i)
    // ⭐ W5-T2 — the closure is the one `tools/pine_runtime_closure.mjs` walks (64 modules and 3 JSON
    // once the registry, the gates and the network modules were cut out of it; 84 and 4 before).
    const closure = walk()
    expect(built.manifest.modules).toBeGreaterThanOrEqual(closure.modules.size + closure.json.size)
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
    // W9-T14: the strategy record's reader and its ONE shape check, the declaring module's own
    expect(mod.STRATEGY_RECORD_SCHEMA).toBe(STRATEGY_RECORD_SCHEMA)
    expect(mod.runtimeStrategyOf({})).toBe(null)
    expect(mod.strategyRecordShapeErrors(null)).toEqual(strategyRecordShapeErrors(null))
    expect(mod.strategyRecordShapeErrors({ schema: STRATEGY_RECORD_SCHEMA })).toEqual(strategyRecordShapeErrors({ schema: STRATEGY_RECORD_SCHEMA }))
  })

  it('bakes import.meta.env once: no live read remains, and no VITE_* value reaches the closure (W5-T2)', async () => {
    expect(text.split(String.fromCharCode(10)).filter((l) => !l.startsWith('//') && l.includes('import.meta'))).toEqual([])
    const on = await buildPineRuntime({ outfile: path.join(dir, 'on', 'pine-runtime.mjs'), logLevel: 'silent',
      env: { VITE_PINE_LOWER_TF_ENABLED: '1', NOT_BAKED: 'x' } })
    expect(on.manifest.viteEnvNames).toEqual(['VITE_PINE_LOWER_TF_ENABLED'])
    // ⭐ W5-T2 — the build gates were cut from the compute closure (design 2.2 H3): a VITE_* value
    // is still baked by the define, and no longer reaches anything the bundle holds.
    expect(on.manifest.sha256).toBe(built.manifest.sha256)
    expect(built.manifest.viteEnvNames).toEqual([])
    expect(Object.entries(viteEnvOf({ VITE_PINE_RUNTIME_PANE_ENABLED: '2', X: '1', VITE_PINE_LOWER_TF_ENABLED: '1', VITE_A: '1' })))
      .toEqual([['VITE_PINE_LOWER_TF_ENABLED', '1'], ['VITE_PINE_RUNTIME_PANE_ENABLED', '2']])
  })

  // â›” W5-INT SECRETS: web's build env holds secret VITE_* values. `define` inlines the whole
  // import.meta.env object, so the bundle may bake ONLY the named non-secret constants.
  it('bakes no VITE_* off its allowlist: a build with web\'s secret values set carries none of them', async () => {
    const MARK = 'w5int-secret-marker-7f3a'
    const env = { VITE_CHART_RENDER_TOKEN: `${MARK}-render`, VITE_CHART_RENDER_TOKEN_PREVIOUS: `${MARK}-prev`,
      VITE_PICOVOICE_ACCESS_KEY: `${MARK}-pico`, VITE_WS_HOST: `${MARK}-ws`, VITE_PINE_LOWER_TF_ENABLED: '1' }
    const leaky = await buildPineRuntime({ outfile: path.join(dir, 'leak', 'pine-runtime.mjs'), logLevel: 'silent', env })
    const t = readFileSync(leaky.outfile, 'utf8')
    expect(t.includes(MARK)).toBe(false)
    expect(leaky.manifest.viteEnvNames).toEqual(['VITE_PINE_LOWER_TF_ENABLED'])
    // the define list itself: the allowlisted names and vite's mode constants, nothing else
    const baked = JSON.parse(defineOf(env)['import.meta.env'])
    expect(Object.keys(defineOf(env))).toEqual(['import.meta.env'])
    expect(Object.keys(baked).sort()).toEqual(['DEV', 'MODE', 'PROD', 'SSR', 'VITE_PINE_LOWER_TF_ENABLED'])
    for (const k of Object.keys(baked)) if (k.startsWith('VITE_')) expect(SERVER_BUNDLE_VITE_NAMES).toContain(k)
  }, 120000)

  it('the allowlist is exactly the VITE_* names the bundle reads: no unlisted read, no stale entry, no secret-shaped name', () => {
    const names = [...new Set(text.match(/VITE_[A-Z0-9_]+/g) || [])].sort()
    // train (W5-INT x W5-T2): since W5-T2 cut the build gates from the compute closure (design 2.2 H3),
    // the bundle reads NO VITE_* name at all, so "exactly the allowlist" became "none". Every name read
    // must still be allowlisted (none is), and the allowlist stays non-secret; whether the bake-list
    // itself can now be emptied is a follow-up (runs/train/FIXES.md).
    expect(names).toEqual([])
    for (const n of names) expect(SERVER_BUNDLE_VITE_NAMES).toContain(n)
    for (const n of SERVER_BUNDLE_VITE_NAMES) expect(n).not.toMatch(/TOKEN|KEY|SECRET|PASSWORD|PRIVATE/)
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
