// The flow-facts BUNDLE must build, and the built artifact must actually run.
//
// ⛔ WHY THIS EXISTS. `npm run build` runs vite AND the two bundle scripts, but
// vite does not compile `flowFactsEntry.js` — only
// `scripts/build-flow-facts.mjs` does. So a syntax error in that file can sit
// there while the frontend build looks green. It happened: a literal newline
// inside a JS string produced `Unterminated string literal`, and nothing in the
// test suite noticed, because every other test imports the SOURCE module rather
// than the built CJS artifact.
//
// That is a deployment hole, not a typo. flow-worker executes
// `app/dist/flow-facts.cjs`. When its rebuild fails, the service keeps serving
// the PREVIOUS bundle — so the failure mode is not "the deploy breaks", it is
// "the deploy silently does nothing and the old answers keep coming". That is
// the same shape as the watch-path trap, and it is invisible from the frontend.
//
// So this rail does two things a type check cannot:
//   1. builds the bundle, and fails on a non-zero exit;
//   2. SMOKE-INVOKES the built CLI, because a file can be syntactically valid
//      and still be unusable (a bad import, a missing export, a top-level throw).
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = process.cwd()
const BUILD = resolve(APP, 'scripts/build-flow-facts.mjs')
const BUNDLE = resolve(APP, 'dist/flow-facts.cjs')
const FIXTURE = resolve(APP, 'src/pages/optionsFlow/__fixtures__/flow-sample.csv')

const run = (args, input) => execFileSync(process.execPath, args, {
  input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
})

describe('the flow-facts bundle builds and runs', () => {
  it('CONTROL: the build script and the fixture are where this test thinks', () => {
    expect(existsSync(BUILD)).toBe(true)
    expect(existsSync(FIXTURE)).toBe(true)
    expect(readFileSync(FIXTURE, 'utf8').length).toBeGreaterThan(100)
  })

  it('builds without error — vite passing does NOT prove this', () => {
    // Throws on a non-zero exit, which is the whole point.
    const out = run([BUILD])
    expect(String(out)).toMatch(/flow-facts: wrote/)
    expect(existsSync(BUNDLE)).toBe(true)
  })

  it('the BUILT artifact answers `stats` with parseable JSON on stdout', () => {
    // ⛔ Runs the artifact flow-worker actually executes, not the source module.
    const csv = readFileSync(FIXTURE, 'utf8')
    const out = run([BUNDLE, 'stats'], csv)
    const j = JSON.parse(out)
    expect(j.ok).toBe(true)
    expect(j.stats).toBeTruthy()
  })

  it('the BUILT artifact answers `search` with the Search product', () => {
    const csv = readFileSync(FIXTURE, 'utf8')
    const out = run([BUNDLE, 'search'], csv)
    const j = JSON.parse(out)
    expect(j.ok).toBe(true)
    // The product is either null (fixture produced nothing) or exactly the two
    // consumed keys — never a full processFlowData result leaking through.
    if (j.product !== null) {
      expect(Object.keys(j.product).sort()).toEqual(['TICKER_DB', 'all_directional'])
    }
    expect(typeof j.rows).toBe('number')
  })

  it('⛔ CONTROL: an unknown command exits non-zero and writes NOTHING to stdout', () => {
    // Proves the smoke checks above can fail, and pins the CLI contract that a
    // caller can never mistake a diagnostic for a payload.
    let threw = false
    let stdout = 'not-empty'
    try {
      stdout = run([BUNDLE, 'definitely-not-a-command'], '')
    } catch (e) {
      threw = true
      stdout = String(e.stdout || '')
    }
    expect(threw, 'an unknown command should exit non-zero').toBe(true)
    expect(stdout.trim()).toBe('')
  })
})
