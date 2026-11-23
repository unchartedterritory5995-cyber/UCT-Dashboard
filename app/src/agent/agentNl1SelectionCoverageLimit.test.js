// NL-1 ACTION SELECTION at the PER-REQUEST LIMIT (60) on the DEV and EXPOSED sets — for comparison with the shipped budget
// (55, agentNl1SelectionCoverage.test.js: every invariant and floor). Free, local, no model call.
// Split out of that file 2026-11-23 (it was the same test's second capture, report-only, unchanged): CI timed the one file
// out at 300 s once heldout-v2 was exposed, and two files let vitest's shards place the two captures apart.
// ⛔ The SEALED sets are never opened here (filtered by split before any file is read).
import { it, expect, vi, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { NL1_LIMIT } from './nl1/selection'
import { isProtected } from './protectedLayouts'
import { OPEN, loadScreenerFixture, capture, measure, fmt } from './testing/nl1SelectionCoverage'

registerBuiltins()

beforeAll(() => loadScreenerFixture(vi))

it('reports first-call coverage at the per-request limit (comparison only)', () => {
  const cap = capture(NL1_LIMIT, (e) => isProtected(e))
  expect(cap.rows.length).toBeGreaterThan(300)
  const at60 = measure(cap)
  expect(Object.keys(at60).sort()).toEqual(OPEN.map(s => s.file).sort())
  console.log(`\nNL-1 selection coverage (dev / exposed only; budget ${NL1_LIMIT}, for comparison)\nbudget ${NL1_LIMIT}:\n${fmt(at60)}\n`)
}, 300000)
