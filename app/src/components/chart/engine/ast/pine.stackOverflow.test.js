// app/src/components/chart/engine/ast/pine.stackOverflow.test.js
//
// ─── THE HOST STACK RUNNING OUT IS THE DEPTH BOUND, NOT A RETRY ─────────────
//
// ⛔⛔ WHAT CI WAS DOING (A0 / PR #369, run 39005606553, 2026-10-17). `cc-yata`
// re-enters `buyCounCC8Close` / `sellCounCC8Close` without end, and on a full
// Node 24 stack the 400-level bound refuses it in ~450ms. On Node 20.19.0 — the
// security suite's image — a cold JIT's frames are bigger and the host stack
// broke first, at 321-339 levels. The `RangeError` was swallowed by the probes
// (`constIntOf`, `constantBranchOf`) and retried ~255,000 times until the 10s
// WALL CLOCK refused every output still unread, and `Both Mode` — read only by
// those — was never minted. `paramIds.test.js` then saw `__uct_param_5` absent.
// Whether it went red depended on how warm the JIT was, i.e. on runner speed.
//
// ⭐ SO THIS FILE TAKES THE STACK AWAY ON PURPOSE, on any host: it recurses to a
// calibrated depth first and translates at the bottom, and the reply must be
// byte-identical to the one given with the whole stack.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const CC_YATA = 'corpus/committed/cc-yata__bd898a1af0.pine'
const src = fs.readFileSync(path.join(REPO, CC_YATA), 'utf8')
const pinned = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/pine/param-ids.json'), 'utf8'))[CC_YATA]

const OPTS = { strict: true, paramManifest: true }
const paramMap = (t) => Object.fromEntries((t.inputParams || []).map((p) => [p.id, String(p.label || p.title || '')]))
// The two refusals that mean "a budget ran out", not "the bound refused".
const exhausted = (t) => (t.refusals || [])
  .filter((r) => /whole script|resolution steps/.test(String(r.message)))

// ── the stack, taken away ──────────────────────────────────────────────────
let reached = 0
function burn(left, fn) {
  reached += 1
  if (left === 0) return fn()
  // Held in a local, not returned directly: every level keeps its frame (V8 has
  // no tail calls, but the test should not depend on that).
  const r = burn(left - 1, fn)
  return r
}
/** How many `burn` frames the whole stack holds. Measured three times so the
 *  number is taken with `burn` at the tier it will run at below. */
function framesAvailable() {
  let n = 0
  for (let i = 0; i < 3; i += 1) {
    reached = 0
    try { burn(Number.MAX_SAFE_INTEGER, null) } catch { /* the overflow is the measurement */ }
    n = reached
  }
  return n
}
/** `fn()` run with only `keep` of the stack left; also reports how much was. */
function withStackKept(keep, fn) {
  const total = framesAvailable()
  let left = 0
  const value = burn(Math.floor(total * (1 - keep)), () => {
    const r = fn()
    reached = 0
    try { burn(Number.MAX_SAFE_INTEGER, null) } catch { /* measured */ }
    left = reached
    return r
  })
  return { value, keptFraction: left / total }
}

describe('a host stack that runs out before the depth bound', () => {
  const full = translatePine(src, OPTS)

  it('⭐ THE CONTROL: with the whole stack, cc-yata pins its committed map', () => {
    expect(paramMap(full)).toEqual(pinned)
    expect(paramMap(full).__uct_param_5).toBe('Both Mode')
    expect(exhausted(full)).toEqual([])
  })

  for (const keep of [0.2, 0.35]) {
    it(`⛔⛔ with ${keep * 100}% of the stack left the reply is BYTE-IDENTICAL`, () => {
      const { value: starved, keptFraction } = withStackKept(keep, () => translatePine(src, OPTS))
      // ⛔ NON-VACUITY: the stack really was taken away — without this, a
      // `burn` that stopped consuming stack would pass every assertion below.
      expect(keptFraction).toBeLessThan(keep + 0.1)
      expect(exhausted(starved), 'a budget ran out — the overflow was retried').toEqual([])
      expect(paramMap(starved)).toEqual(pinned)
      expect(JSON.stringify(starved)).toBe(JSON.stringify(full))
    }, 60000)
  }

  it('⛔ an overflow is refused AS the bound, named, even when the bound is unreachable', () => {
    // A bound of 1e9 cannot be reached by counting, so a depth refusal here can
    // only have come from the host stack running out and being converted.
    const t = translatePine(src, { ...OPTS, maxDepth: 1e9 })
    expect(exhausted(t)).toEqual([])
    expect((t.refusals || []).some((r) => /nested past 1000000000 levels/.test(r.message))).toBe(true)
    expect(paramMap(t)).toEqual(pinned)
  }, 60000)
})
