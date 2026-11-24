// ─── ⭐⭐ T4 B2 — A RUN THAT READS UCT BREADTH NEVER GRADES MATCH (coordinator ruling 2026-11-22) ─────────────────────
//
// A `USI:` spelling is served from UCT's own breadth counts (`engine/pineBreadth.js`), which differ from the exchanges'
// official issue counts by construction. So the grade of a run that reads one is MATCH_SUBSTITUTED (every plot agreeing)
// or what it was otherwise (a DIVERGE carries the named words), NEVER MATCH. `ours.breadth` is our side's own report
// (`otherSymbols.breadthReadsOf`); `compare.mjs` applies it last, after every roll-up, as L7 does.
//
// The run is a real one (the L7 fixture: an SMA observation, which grades plain MATCH); only the breadth tag differs.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compareCapture, MATCH_SUBSTITUTED } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { fromObservation } from '../../../../../../../tools/vendor_harness/adapters.mjs'
import { runOurSide } from './ourSide'
import { REPO } from './harness'
import { BREADTH_DATA_WORDS } from '../../pineBreadth'

const OBS = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/observations/sma-close20-2026-09-06.json'), 'utf8'))
const CAPTURE = fromObservation(OBS, { path: 'observations/sma-close20-2026-09-06.json' })
const OK = { integrity: { ok: true, errors: [] } }
const OURS = runOurSide(CAPTURE)
const TAG = { spellings: ['USI:ADVN.NY', 'USI:DECL.NY'], words: BREADTH_DATA_WORDS }

describe('B2 — the grade of a run that reads UCT breadth', () => {
  it('⛔ CONTROL: the run reads no USI spelling, our side tags nothing, and it grades plain MATCH', () => {
    expect(OURS.ok, OURS.refusal).toBe(true)
    expect(OURS.breadth).toBeNull()
    const v = compareCapture(CAPTURE, OURS, OK)
    expect(v.verdict, v.reason).toBe('MATCH')
    expect(v.breadthRead).toBeUndefined()
  })

  it('⭐ the same run tagged as reading UCT breadth: MATCH_SUBSTITUTED, named, every plot relabelled', () => {
    const v = compareCapture(CAPTURE, { ...OURS, breadth: TAG }, OK)
    expect(v.verdict, v.reason).toBe(MATCH_SUBSTITUTED)
    expect(v.breadthRead).toEqual(TAG)
    expect(v.reason).toContain(`on ${BREADTH_DATA_WORDS} (USI:ADVN.NY, USI:DECL.NY)`)
    expect(v.plots.length).toBeGreaterThan(0)
    expect(v.plots.some((p) => p.verdict === 'MATCH')).toBe(false)
  })

  it('a DIVERGE stays DIVERGE and says what it read (a named divergence, never lifted)', () => {
    const bent = { ...OURS, breadth: TAG, plots: OURS.plots.map((p, i) => (i || !p.column ? p
      : { ...p, column: Float64Array.from(p.column, (x) => (Number.isFinite(x) ? x + 1 : x)) })) }
    const v = compareCapture(CAPTURE, bent, OK)
    expect(v.verdict).toBe('DIVERGE')
    expect(v.reason).toContain(`this script reads ${BREADTH_DATA_WORDS}`)
  })
})
