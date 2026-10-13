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

// P2b Task 8 (R-T8-1 I-3, ruling R-PF-B9): the card reads the selected account's rules through the
// checklist's ONE read seam, so its list is the list Log Trade and the pre-entry checklist show.
let seam
const seamCalls = []
vi.mock('../../hooks/useChecklistSources', () => ({
  default: (opts) => { seamCalls.push(opts); return seam },
}))

const RULES = [
  { id: 'r1', label: 'Waited for confirmation' },
  { id: 'r2', label: 'Sized at 1R risk' },
]
const SETTINGS = { setupRules: { VCP: RULES } }
const TRADE = { id: 't1', setup: 'VCP' }
const WAIT = { id: 'x1', label: 'Wait 15 minutes', beforeEntry: true }

beforeEach(() => {
  flagOn = true
  swrData = null
  seam = { rules: [], rulesState: 'ready' }
  seamCalls.length = 0
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

// ── P2b Task 8: the "Before entry" switch can make a rule part of every checklist (R-T8-1 I-3) ──
const putBody = () => {
  const call = global.fetch.mock.calls.find((c) => c[0] === '/api/j2/trades/t1/adherence' && c[1]?.method === 'PUT')
  return call ? JSON.parse(call[1].body) : null
}

describe('AdherenceChecklist and before-entry rules (R-PF-B9)', () => {
  it('the card lists the rules marked "before entry" after the setup\'s items, and counts them', () => {
    seam = { rules: [WAIT, { id: 'x2', label: 'Not before entry', beforeEntry: false }], rulesState: 'ready' }
    render(<AdherenceChecklist trade={TRADE} settings={SETTINGS} />)
    expect(screen.getAllByRole('checkbox').map((b) => b.closest('label').textContent))
      .toEqual(['Waited for confirmation', 'Sized at 1R risk', 'Wait 15 minutes'])
    expect(screen.getByText('0 of 3 rules followed · adherence 0%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wait 15 minutes' }))
    expect(putBody()).toEqual({ setup: 'VCP', checkedRuleIds: ['rule:x1'], totalRules: 3 })
    expect(screen.getByText('1 of 3 rules followed · adherence 33%')).toBeInTheDocument()
    expect(seamCalls.every((o) => o?.wantRules === true)).toBe(true)
  })

  it('the card\'s set is the checklist\'s set: its total is checklistItems(..., includeRules yes).length', async () => {
    const { checklistItems } = await import('../../lib/blocks/checklistItems')
    seam = { rules: [WAIT], rulesState: 'ready' }
    render(<AdherenceChecklist trade={TRADE} settings={SETTINGS} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Waited for confirmation' }))
    const items = checklistItems({ settings: SETTINGS, rules: [WAIT], setup: 'VCP', includeRules: 'yes' })
    expect(putBody().totalRules).toBe(items.length)
    expect(putBody().checkedRuleIds.every((id) => items.some((i) => i.id === id))).toBe(true)
  })

  it('a stored rule tick shows ticked, and the first tick here keeps it (item 1: the write keeps rule ids)', () => {
    swrData = { tradeRef: 'id:t1', setup: 'VCP', checkedRuleIds: ['rule:x1'], totalRules: 3, adherencePct: 1 / 3 }
    seam = { rules: [WAIT], rulesState: 'ready' }
    render(<AdherenceChecklist trade={TRADE} settings={SETTINGS} />)
    expect(screen.getByRole('checkbox', { name: 'Wait 15 minutes' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sized at 1R risk' }))
    expect(putBody()).toEqual({ setup: 'VCP', checkedRuleIds: ['r2', 'rule:x1'], totalRules: 3 })
  })

  it('a rule tick Log Trade stored for a rule no longer listed is kept, counted and said; never erased', () => {
    swrData = { tradeRef: 'id:t1', setup: 'VCP', checkedRuleIds: ['r1', 'rule:gone'], totalRules: 3, adherencePct: 2 / 3 }
    render(<AdherenceChecklist trade={TRADE} settings={SETTINGS} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByText('2 of 3 rules followed · adherence 67%')).toBeInTheDocument()
    expect(screen.getByText('Also counted as followed: 1 rule ticked earlier that is not listed here.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sized at 1R risk' }))
    expect(putBody()).toEqual({ setup: 'VCP', checkedRuleIds: ['r1', 'r2', 'rule:gone'], totalRules: 3 })
  })

  it('CONTROL: a stale SETUP id still drops out (only setup items are the card\'s to resolve)', () => {
    swrData = { tradeRef: 'id:t1', setup: 'VCP', checkedRuleIds: ['deleted-setup-item'], totalRules: 3 }
    render(<AdherenceChecklist trade={TRADE} settings={SETTINGS} />)
    expect(screen.getByText('0 of 2 rules followed · adherence 0%')).toBeInTheDocument()
    expect(screen.queryByText(/Also counted as followed/)).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Waited for confirmation' }))
    expect(putBody()).toEqual({ setup: 'VCP', checkedRuleIds: ['r1'], totalRules: 2 })
  })

  it('while the rules are still loading, the boxes wait: no write can count a set it has not read', () => {
    seam = { rules: [], rulesState: 'loading' }
    render(<AdherenceChecklist trade={TRADE} settings={SETTINGS} />)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.every((b) => b.disabled)).toBe(true)
    fireEvent.click(boxes[0])
    expect(putBody()).toBeNull()
  })
})
