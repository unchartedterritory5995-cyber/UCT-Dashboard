// app/src/components/chart/engine/ast/pine.oosBaseline.test.js
//
// ─── LAYER A RUNNER for OOS_2_MEASUREMENT_PROTOCOL.md ────────────────────────
//
// Runs `oosHarness.measureScript` over a corpus directory and writes the full
// per-script measurement to JSON. It is a MEASUREMENT INSTRUMENT first and a
// regression net second: its assertions are non-vacuity checks only, because the
// baseline's job is to record what the product does today, not to pin a number
// nobody has looked at yet.
//
// ⛔ NO RATCHET IN THIS FILE YET. A floor asserted before the baseline is
// adjudicated would pin numbers that the silent-false-success audit may still
// move — `lesson_an_arming_condition_that_names_a_test_expires`. The ratchet is
// added in a separate commit once the baseline is accepted.
//
//   OOS_CORPUS_DIR   corpus to measure (default: the frozen OOS-1 corpus)
//   OOS_REPORT_OUT   where to write the JSON report
//
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { measureScript } from './oosHarness.js'

const DIR = path.resolve(
  process.cwd(),
  process.env.OOS_CORPUS_DIR || '../tests/fixtures/pine_oos',
)
const OUT = process.env.OOS_REPORT_OUT
  ? path.resolve(process.cwd(), process.env.OOS_REPORT_OUT)
  : null

// ⛔ NO `existsSync` GUARD ON THE CORPUS. A corpus gate that passes with no
// corpus is `lesson_gate_that_cannot_fail`.
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()

const ROWS = FILES.map((f) => measureScript(
  f.replace(/\.pine$/, ''),
  fs.readFileSync(path.join(DIR, f), 'utf8'),
))

const count = (o) => ROWS.filter((r) => r.outcome === o).length
const OUTCOMES = {
  RAW_ACCEPTED: count('RAW_ACCEPTED'),
  ASSISTED_ACCEPTED: count('ASSISTED_ACCEPTED'),
  CORRECTLY_REFUSED: count('CORRECTLY_REFUSED'),
  INVALID_SOURCE: count('INVALID_SOURCE'),
  UNKNOWN_NEEDS_ADJUDICATION: count('UNKNOWN_NEEDS_ADJUDICATION'),
}

describe('OOS Layer A baseline', () => {
  it('the corpus is really there', () => {
    expect(FILES.length).toBeGreaterThan(0)
  })

  it('⛔ every script gets an outcome, and none of them is a thrown exception', () => {
    // A refusal is the door working. An exception is not — it reaches a member
    // as a 500 rather than as a sentence naming what it cannot take.
    const threw = ROWS.filter((r) => r.raw && r.raw.threw).map((r) => [r.name, r.raw.threw])
    expect(threw).toEqual([])
    expect(ROWS.every((r) => typeof r.outcome === 'string' && r.outcome.length > 0)).toBe(true)
  })

  it('⭐ the instrument is not vacuous — it separates the corpus', () => {
    // The control. Every measurement here would look equally "successful" if the
    // harness graded everything identically.
    const distinct = new Set(ROWS.map((r) => r.outcome))
    expect(distinct.size).toBeGreaterThan(1)
    const guards = new Set(ROWS.map((r) => r.primaryBlocker).filter(Boolean))
    expect(guards.size).toBeGreaterThan(0)
  })

  it('⭐ writes the full per-script report', () => {
    const report = {
      corpus: DIR,
      scripts: FILES.length,
      generatedAt: new Date().toISOString(),
      outcomes: OUTCOMES,
      truthfulOutcomeRate: (
        OUTCOMES.RAW_ACCEPTED + OUTCOMES.ASSISTED_ACCEPTED
        + OUTCOMES.CORRECTLY_REFUSED + OUTCOMES.INVALID_SOURCE
      ) / FILES.length,
      needsSilentWrongResultAudit: ROWS.filter((r) => r.needsSilentWrongResultAudit).map((r) => r.name),
      rows: ROWS,
    }
    if (OUT) {
      fs.mkdirSync(path.dirname(OUT), { recursive: true })
      fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
      expect(fs.existsSync(OUT)).toBe(true)
    }
    // Printed so a run is legible without opening the JSON.
    const blockers = {}
    for (const r of ROWS) if (r.primaryBlocker) blockers[r.primaryBlocker] = (blockers[r.primaryBlocker] || 0) + 1
    // eslint-disable-next-line no-console
    console.log(
      `\n=== OOS LAYER A: ${FILES.length} scripts from ${DIR} ===\n`
      + Object.entries(OUTCOMES).map(([k, v]) => `  ${k.padEnd(28)} ${v}`).join('\n')
      + `\n  ${'TRUTHFUL OUTCOME RATE'.padEnd(28)} ${(report.truthfulOutcomeRate * 100).toFixed(1)}%`
      + `\n  ${'flagged for SWR audit'.padEnd(28)} ${report.needsSilentWrongResultAudit.length}`
      + `\n\n=== PRIMARY BLOCKERS ===\n`
      + Object.entries(blockers).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `  ${String(v).padStart(3)}  ${k}`).join('\n'),
    )
    expect(report.scripts).toBe(FILES.length)
  })
})
