/**
 * The always-on rail that the PERF CONTRACT HARNESS still exists.
 *
 * `OptionsFlow.perfContract.test.jsx` is the behavioural contract (no raw tape
 * on a prepared load, no interaction parts at first paint, deferred parts still
 * arrive). It runs under its own mode because Vite inlines the flow flags at
 * transform time, so it is opt-in by command: `npm run test:flowperf`.
 *
 * ⛔ AN OPT-IN RAIL READS AS "VERIFIED" WHEN NOBODY RUNS IT. This file is the
 * cheap always-on half: it cannot tell you the contract HOLDS, only that the
 * machinery to check it has not quietly been deleted, renamed, or emptied of
 * its flags. That is a deliberate and stated limitation, not an oversight --
 * `lesson_a_rails_important_half_can_be_opt_in`.
 *
 * If you wire one thing into CI, wire `npm run test:flowperf`; then delete the
 * apology above.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const R = (...p) => path.resolve(process.cwd(), ...p)
const read = (...p) => fs.readFileSync(R(...p), 'utf8')

/** Read live from Railway `web` on 2026-09-08. All four gate the speed work. */
const PROD_FLAGS = [
  'VITE_FLOW_DEFER_TAPE',
  'VITE_FLOW_PARTS',
  'VITE_FLOW_SERVER_TOPPICKS',
  'VITE_FLOW_SERVER_SEARCH',
]

/**
 * Source with comments removed.
 *
 * ⛔ The first version of the exclude check below grepped RAW file text and
 * went red against a perfectly correct config -- because the flowperf config
 * names the contract in its own header comment explaining what it un-excludes.
 * It was matching PROSE. (Importing the configs instead is not an option here:
 * vite.config.js pulls in esbuild, which throws under jsdom.)
 */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

describe('the flow perf-contract harness', () => {
  it('the contract file still exists', () => {
    expect(fs.existsSync(R('src/pages/OptionsFlow.perfContract.test.jsx'))).toBe(true)
  })

  it('npm run test:flowperf still points at it, with its own config and mode', () => {
    const pkg = JSON.parse(read('package.json'))
    const s = pkg.scripts && pkg.scripts['test:flowperf']
    expect(s, 'the test:flowperf script is gone').toBeTruthy()
    expect(s).toContain('OptionsFlow.perfContract.test.jsx')
    expect(s).toContain('--mode flowperf')
    expect(s).toContain('vitest.flowperf.config.js')
  })

  it('the mode env file still carries every production flag', () => {
    // A flag silently dropped here would make the contract measure a build no
    // member runs -- while still reporting a pass.
    const env = read('.env.flowperf')
    for (const f of PROD_FLAGS) {
      expect(env, `${f} missing from .env.flowperf`).toContain(`${f}=1`)
    }
  })

  it('the flowperf config un-excludes the contract the base config hides', () => {
    const hides = (src) => code(src).includes('OptionsFlow.perfContract')
    // The base MUST hide it, or the default suite goes red.
    expect(hides(read('vite.config.js')),
      'base config no longer excludes the contract').toBe(true)
    // The dedicated config must NOT, or `npm run test:flowperf` runs zero tests
    // and exits 0 -- which reads exactly like a pass.
    expect(hides(read('vitest.flowperf.config.js')),
      'flowperf config also excludes it: it would run nothing').toBe(false)
  })

  it('CONTROL: the comment stripper really strips, and really keeps', () => {
    // Without this the stripper could return '' and every check above would
    // pass for the wrong reason.
    const out = code('/* BLOCK */ keepMe // LINE')
    expect(out).toContain('keepMe')
    expect(out).not.toContain('BLOCK')
    expect(out).not.toContain('LINE')
  })

  it('CONTROL: these probes read real files, not empty strings', () => {
    expect(read('.env.flowperf').length).toBeGreaterThan(50)
    expect(read('vitest.flowperf.config.js').length).toBeGreaterThan(100)
    expect(read('src/pages/OptionsFlow.perfContract.test.jsx').length)
      .toBeGreaterThan(1000)
  })
})
