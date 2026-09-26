import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChartHealth, {
  severityTreatment,
  SEVERITY_TIER,
  UNKNOWN_SEVERITY_NOTE,
} from './ChartHealth'

// The Recent Alerts row used to be marked by
// `a.severity === 'warning' || a.severity === 'error'`.
//
// WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
// 1. `critical` -- the only severity that pages Discord -- rendering LESS marked than
//    the warning beside it. (Mutation: put the old disjunction back. Measured: reds
//    all three DOM tests.)
// 2. an undeclared severity rendering identically to a healthy row. That silence is
//    the defect: `warn` really was emitted by bars_reconciliation.py and really did
//    fall through the old predicate unstyled. (Mutation: let the final branch return
//    the quiet treatment. Measured: reds three tests.)
// 3. an undeclared word being NORMALISED into a tier instead of flagged. Aliasing
//    `warn` to warning hides a mis-scaled emitter on the one page an operator sees it.
// 4. EVERYTHING being marked. The `info` row is the CONTROL -- without it, 1-3 are all
//    satisfied by a component that highlights every row it is handed.
//
// The declared vocabulary is `api/services/alerts.py`: info / warning / critical.
// Every alert_key below is a real one, except the last, which is next week's word.
const ALERTS = [
  { severity: 'critical', alert_key: 'bars_store_unhealthy', message: 'THE BARS STORE CANNOT SERVE', emitted_at: 1758000000 },
  { severity: 'warning', alert_key: 'source_degraded:fmp', message: "Source 'fmp' pass rate dropped below 95%", emitted_at: 1758000100 },
  { severity: 'warn', alert_key: 'daily_drift_detected', message: 'AAPL/D: 2 daily bar(s) diverge from canonical', emitted_at: 1758000200 },
  { severity: 'info', alert_key: 'audit_completed', message: 'priority audit finished, nothing to do', emitted_at: 1758000300 },
  { severity: 'galactic', alert_key: 'a_word_from_next_week', message: 'a severity nobody declared', emitted_at: 1758000400 },
]

const PAYLOADS = {
  '/api/admin/bars/audit/latest': { report: null },
  '/api/admin/bars/quarantine/count': { count: 0 },
  '/api/admin/bars/liveness': { ages: {} },
  '/api/admin/bars/source-health': { sources: {}, by_source: {} },
  '/api/admin/bars/quality': { scores: {} },
  '/api/admin/bars/alerts': { alerts: ALERTS },
  '/api/admin/bars/hot-tier': { size: 0, capacity: 500 },
}

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    const hit = Object.keys(PAYLOADS).find(k => String(url).startsWith(k))
    return Promise.resolve({ ok: true, json: () => Promise.resolve(hit ? PAYLOADS[hit] : {}) })
  })
})

const rowFor = key => screen.getByText(key).closest('tr')

describe('severityTreatment -- the lookup that replaced the disjunction', () => {
  it('ranks critical above warning, and an undeclared word above the all-clear', () => {
    expect(severityTreatment('critical').tier).toBeGreaterThan(severityTreatment('warning').tier)
    expect(severityTreatment('warning').tier).toBeGreaterThan(severityTreatment('galactic').tier)
    expect(severityTreatment('galactic').tier).toBeGreaterThan(severityTreatment('info').tier)
    expect(severityTreatment('info').tier).toBe(SEVERITY_TIER.quiet)
  })

  it('marks every word outside the declared vocabulary, rather than falling through', () => {
    // `warn` is api/services/audit.py's diff scale, not an alert severity, and it is
    // the word that really fell through. `error` is what the old predicate tested for
    // and nothing emits. The empty and missing cases are severities that never arrived.
    for (const undeclared of ['warn', 'error', 'galactic', 'fatal', 'ok', 'notice', '', undefined, null]) {
      const mark = severityTreatment(undeclared)
      expect(mark.tier).toBe(SEVERITY_TIER.unknown)
      expect(mark.style).toBeTruthy()
      expect(mark.note).toBe(UNKNOWN_SEVERITY_NOTE)
    }
  })

  it('does NOT quietly normalise `warn` into the warning tier', () => {
    // Doing so would render a mis-scaled emitter as a legitimate warning.
    expect(severityTreatment('warn').tier).not.toBe(SEVERITY_TIER.warning)
    expect(severityTreatment('warn').note).toBe(UNKNOWN_SEVERITY_NOTE)
  })

  it('reads a declared word regardless of case or surrounding space', () => {
    expect(severityTreatment(' CRITICAL ').tier).toBe(SEVERITY_TIER.critical)
    expect(severityTreatment('Warning').tier).toBe(SEVERITY_TIER.warning)
  })

  it('CONTROL: the declared all-clear is genuinely unmarked, so "marked" means something', () => {
    const mark = severityTreatment('info')
    expect(mark.className).toBeFalsy()
    expect(mark.style).toBeUndefined()
    expect(mark.note).toBe('')
  })

  it('NON-VACUITY: the stylesheet resolves here, so a className assertion can fail', () => {
    // If CSS modules were stubbed to {}, `className` would be undefined for every
    // severity and the DOM assertions below could not tell warning from info.
    expect(severityTreatment('warning').className).toBeTruthy()
  })
})

describe('ChartHealth Recent Alerts -- what the operator actually sees', () => {
  it('marks a critical row MORE than a warning, and leaves a healthy row alone', async () => {
    render(<ChartHealth />)
    const critical = (await screen.findByText('bars_store_unhealthy')).closest('tr')
    const warning = rowFor('source_degraded:fmp')
    const quiet = rowFor('audit_completed')

    // critical: the warning treatment PLUS a background the warning does not have
    expect(critical.getAttribute('class')).toBeTruthy()
    expect(critical.getAttribute('style')).toMatch(/background/)
    expect(warning.getAttribute('class')).toBe(critical.getAttribute('class'))
    expect(warning.getAttribute('style')).toBeNull()

    // CONTROL -- a healthy row carries neither
    expect(quiet.getAttribute('class')).toBeNull()
    expect(quiet.getAttribute('style')).toBeNull()
  })

  it('marks the `warn` row that fell through the old predicate, and names it', async () => {
    render(<ChartHealth />)
    const warn = (await screen.findByText('daily_drift_detected')).closest('tr')
    const quiet = rowFor('audit_completed')
    expect(warn.getAttribute('style')).toMatch(/background/)
    expect(warn.getAttribute('style')).not.toBe(quiet.getAttribute('style'))
    expect(warn.textContent).toContain(UNKNOWN_SEVERITY_NOTE)
  })

  it('makes an unrecognised severity visibly distinct from a healthy row, and says why', async () => {
    render(<ChartHealth />)
    const odd = (await screen.findByText('a_word_from_next_week')).closest('tr')
    const quiet = rowFor('audit_completed')

    expect(odd.getAttribute('style')).toMatch(/background/)
    expect(odd.getAttribute('style')).not.toBe(quiet.getAttribute('style'))
    // Assert the SENTENCE, not just the style: a tinted row with no explanation
    // reads as decoration.
    expect(odd.textContent).toContain(UNKNOWN_SEVERITY_NOTE)
    expect(odd.textContent).toContain('galactic')
    expect(quiet.textContent).not.toContain(UNKNOWN_SEVERITY_NOTE)
  })
})
