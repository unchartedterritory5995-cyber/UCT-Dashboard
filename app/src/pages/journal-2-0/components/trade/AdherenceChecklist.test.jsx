import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AdherenceChecklist from './AdherenceChecklist'

// Feature flag is controlled per-test via a mutable let (mirrors the runtime
// hook's on/off contract without touching localStorage).
let flagOn = true
vi.mock('../../featureFlags', () => ({
  useFeatureFlag: () => flagOn,
}))

// SWR is mocked so the test drives the stored adherence record directly (same
// idiom as TradeScreenshots.test.jsx). The REAL useJ2Adherence hook still runs
// over this mock, so toggling a box exercises the real PUT via global.fetch.
let swrData
const mutateSpy = vi.fn()
vi.mock('swr', () => ({
  default: () => ({ data: swrData, isLoading: false, mutate: mutateSpy }),
}))

const RULES = [
  { id: 'r1', label: 'Waited for confirmation' },
  { id: 'r2', label: 'Sized at 1R risk' },
]
const SETTINGS = { setupRules: { VCP: RULES } }
const TRADE = { id: 't1', setup: 'VCP' }

beforeEach(() => {
  flagOn = true
  swrData = null
  mutateSpy.mockClear()
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          tradeRef: 'id:t1', setup: 'VCP', checkedRuleIds: ['r1'],
          totalRules: 2, adherencePct: 0.5, updatedAt: 'now',
        }),
    }),
  )
})

describe('AdherenceChecklist', () => {
  it('renders nothing when the adherence flag is OFF', () => {
    flagOn = false
    const { container } = render(<AdherenceChecklist trade={TRADE} settings={SETTINGS} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a checkbox per rule; checking one PUTs the record + updates the summary', () => {
    render(<AdherenceChecklist trade={TRADE} settings={SETTINGS} />)

    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(2)
    expect(screen.getByText('0 of 2 rules followed · adherence 0%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Waited for confirmation' }))

    const putCall = global.fetch.mock.calls.find(
      (c) => c[0] === '/api/j2/trades/t1/adherence' && c[1]?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
    expect(JSON.parse(putCall[1].body)).toEqual({
      setup: 'VCP', checkedRuleIds: ['r1'], totalRules: 2,
    })

    // Optimistic local update → summary reflects the toggle immediately.
    expect(screen.getByText('1 of 2 rules followed · adherence 50%')).toBeInTheDocument()
  })

  it('shows the Settings affordance (no checkboxes) when the setup has no rules', () => {
    render(<AdherenceChecklist trade={TRADE} settings={{ setupRules: {} }} />)
    expect(screen.getByText('Define rules for VCP in Settings')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('prompts to tag a setup when the trade has no setup', () => {
    render(<AdherenceChecklist trade={{ id: 't1', setup: '' }} settings={SETTINGS} />)
    expect(screen.getByText('Tag a setup to track adherence')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('renders the stored checked rules as checked boxes', () => {
    swrData = {
      tradeRef: 'id:t1', setup: 'VCP', checkedRuleIds: ['r2'],
      totalRules: 2, adherencePct: 0.5, updatedAt: 'now',
    }
    render(<AdherenceChecklist trade={TRADE} settings={SETTINGS} />)
    expect(screen.getByRole('checkbox', { name: 'Waited for confirmation' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Sized at 1R risk' })).toBeChecked()
    expect(screen.getByText('1 of 2 rules followed · adherence 50%')).toBeInTheDocument()
  })
})
