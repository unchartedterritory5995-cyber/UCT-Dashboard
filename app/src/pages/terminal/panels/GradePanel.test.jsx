// GRADE — Compass's buy / hold / skip verdict in the terminal. Rails:
//   * grading off on the server (`available: false`) says "Grade not available yet" and draws NO verdict;
//   * grade_ticker's own "no regime gate" (`ok: false`) is not a verdict either;
//   * a verdict renders every field grade_ticker returns, the verdict as a WORD (never colour alone),
//     hard flags in plain English and the sources;
//   * a failed read is an error with Retry (not an empty grade), a 404 is "not switched on";
//   * the registry: `NVDA GRADE` resolves to this panel.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import GradePanel, { flagText } from './GradePanel'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'

const GO = {
  available: true, ok: true, symbol: 'NVDA', verdict: 'GO', regime: 'GREEN', regime_note: 'Tape is healthy.',
  setup: 'VCP', grade: 'A', entry: 100, stop: 95, stop_pct: 5, size_pct: 20, account_risk_pct: 1,
  first_target: 110, basis: 'VCP on NVDA, graded A.', hard_flags: [],
  sources: ['regime classifier (GREEN)', 'pattern engine: VCP (conf 85)'], as_of: 1_790_000_000,
}

beforeEach(() => { jsonFetcher.mockReset() })

describe('GradePanel', () => {
  it('says "Grade not available yet" while grading is off, and shows no verdict', async () => {
    jsonFetcher.mockResolvedValue({ available: false, symbol: 'NVDA', reason: 'Compass grading is not switched on for this server yet (BRAIN_TOOLS_ENABLED).' })
    render(<GradePanel sym="NVDA" />)
    const el = await screen.findByTestId('terminal-grade-unavailable')
    expect(el.textContent).toContain('Grade not available yet')
    expect(el.textContent).toContain('BRAIN_TOOLS_ENABLED')
    expect(screen.queryByTestId('terminal-grade-verdict')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\b(GO|HOLD|SKIP)\b/)
    expect(jsonFetcher).toHaveBeenCalledWith('/api/terminal/grade/NVDA')
  })

  it('a missing regime gate (ok: false) is not a verdict', async () => {
    jsonFetcher.mockResolvedValue({ available: true, ok: false, symbol: 'NVDA', reason: 'regime unavailable' })
    render(<GradePanel sym="NVDA" />)
    expect((await screen.findByTestId('terminal-grade-unavailable')).textContent).toContain('Grade not available yet')
    expect(screen.queryByTestId('terminal-grade-verdict')).toBeNull()
  })

  it('renders every verdict field, the verdict as a word, and the sources', async () => {
    jsonFetcher.mockResolvedValue(GO)
    render(<GradePanel sym="NVDA" />)
    const verdict = await screen.findByTestId('terminal-grade-verdict')
    expect(verdict.textContent).toContain('GO')
    expect(verdict.textContent).toContain('Buy setup')
    const fields = screen.getByTestId('terminal-grade-fields').textContent
    for (const s of ['GREEN', 'VCP', 'Grade: A', '$100.00', '$95.00', '5.0% below entry', '20.0% of the account', '1.0%', '$110.00']) {
      expect(fields).toContain(s)
    }
    expect(screen.getByTestId('terminal-grade-basis').textContent).toBe('VCP on NVDA, graded A.')
    expect(screen.getByTestId('terminal-grade-no-flags')).toBeTruthy()
    expect(screen.getByTestId('terminal-grade-sources').textContent).toContain('pattern engine: VCP')
    expect(screen.getByTestId('terminal-grade-footnote').textContent).toContain('ET')
  })

  it('a SKIP for no setup says so in plain words, with no invented levels', async () => {
    jsonFetcher.mockResolvedValue({ ...GO, verdict: 'SKIP', setup: null, grade: null, entry: null, stop: null,
      stop_pct: null, size_pct: null, account_risk_pct: null, first_target: null, hard_flags: ['no_setup'],
      basis: 'No clean, tradable setup on NVDA right now.' })
    render(<GradePanel sym="NVDA" />)
    expect((await screen.findByTestId('terminal-grade-verdict')).textContent).toContain('SKIP')
    expect(screen.getByTestId('terminal-grade-flags').textContent).toContain(flagText('no_setup'))
    expect(screen.getByTestId('terminal-grade-fields').textContent).toContain('Entry: none')
    expect(screen.getByTestId('terminal-grade-fields').textContent).not.toContain('$')
  })

  it('a failed read is an error with Retry; a 404 reads as not switched on', async () => {
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }))
    const { unmount } = render(<GradePanel sym="AMD" />)
    const err = await screen.findByTestId('terminal-grade-error')
    expect(err.textContent).toContain('Could not grade AMD')
    jsonFetcher.mockResolvedValueOnce(GO)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTestId('terminal-grade-verdict')).toBeTruthy())
    unmount()
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404 }))
    render(<GradePanel sym="AMD" />)
    expect((await screen.findByTestId('terminal-grade-error')).textContent).toContain("isn't switched on yet")
  })

  it('with no ticker it asks for one and fetches nothing', () => {
    render(<GradePanel sym={null} />)
    expect(screen.getByText('GRADE needs a ticker.')).toBeTruthy()
    expect(jsonFetcher).not.toHaveBeenCalled()
  })
})

describe('GRADE in the registry', () => {
  it('NVDA GRADE opens the Grade panel, with no shell flag (the server decides)', async () => {
    expect(BY_CODE.GRADE.group).toBe('Security')
    const { variant } = variantFor('GRADE', true)
    expect(variant.panel).toBe('Grade')
    expect(variant.flag).toBeUndefined()
    const mod = await PANEL_IMPORTERS.Grade()
    expect(mod.default).toBe(GradePanel)
  })
})
