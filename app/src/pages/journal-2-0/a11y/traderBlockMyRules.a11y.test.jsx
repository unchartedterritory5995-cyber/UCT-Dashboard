// app/src/pages/journal-2-0/a11y/traderBlockMyRules.a11y.test.jsx
//
// Notebook P2b, Task 8: the My rules block's body through 8A's axe harness (part a's S23, "A11y per
// block"). The first recipe renders the member-visible shapes together: two rules (one checked before
// entry, one with its why) with the Edit form OPEN on the first; "All rules", which adds a dismissed
// rule, read-only; and a reader's view (no Edit, switches that cannot move). The second renders the
// empty state with a write's status sentence. Each shape is proved on screen BEFORE axe runs, so an
// empty render cannot pass as a clean one.
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { vi, expect } from 'vitest'
import { axeSurface } from './surface'

const state = { rules: [] }
vi.mock('../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1' }) }))
vi.mock('../hooks/useJournalRules', () => ({
  default: (id, status) => (status === 'dismissed'
    ? { rules: [{ id: 'd1', label: 'No trades in the first minute', evidence: null, version: 1, changedAt: '2026-09-01T15:00:00+00:00', beforeEntry: false, status: 'dismissed' }], mutate: () => {} }
    : { rules: state.rules, mutate: () => {} }),
}))
import MyRulesBlock from '../components/notebook/blocks/MyRulesBlock'

const RULES = [
  { id: 'r1', label: 'Wait 15 minutes', evidence: null, version: 2, changedAt: '2026-10-02T15:00:00+00:00', beforeEntry: true, status: 'active' },
  { id: 'r2', label: 'No adds to a loser', evidence: 'Cost $1,200 in September', version: 1, changedAt: '2026-09-10T15:00:00+00:00', beforeEntry: false, status: 'active' },
]

axeSurface('trader-block-my-rules', async () => {
  state.rules = RULES
  render(<div>
    <MyRulesBlock params={{}} setParams={() => true} editable />
    <MyRulesBlock params={{ which: 'all' }} setParams={() => true} editable />
    <MyRulesBlock params={{}} setParams={() => true} editable={false} />
  </div>)
  const [first] = screen.getAllByRole('button', { name: "Edit 'Wait 15 minutes'" })
  fireEvent.click(first)
  const form = screen.getByRole('form', { name: "Edit 'Wait 15 minutes'" })
  expect(within(form).getByLabelText('Rule').value).toBe('Wait 15 minutes')
  expect(within(form).getByLabelText('Why')).toBeTruthy()
  expect(within(form).getByLabelText('What changed?')).toBeTruthy()
  const switches = screen.getAllByRole('switch', { name: "Check 'No adds to a loser' before entry" })
  expect(switches).toHaveLength(3)
  expect(switches.map((s) => s.disabled)).toEqual([false, false, true])
  expect(screen.getAllByText('v2 · changed Oct 2').length).toBeGreaterThan(0)
  expect(screen.getByText('Dismissed · v1 · made Sep 1')).toBeTruthy()
  expect(screen.getAllByText('Cost $1,200 in September')).toHaveLength(3)
})

axeSurface('trader-block-my-rules:empty', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ detail: 'rule_dismissed' }) }))
  try {
    state.rules = [RULES[1]]
    const { rerender } = render(<MyRulesBlock params={{}} setParams={() => true} editable />)
    fireEvent.click(screen.getByRole('switch', { name: "Check 'No adds to a loser' before entry" }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe("This rule was dismissed, so it can't be edited."))
    state.rules = []
    rerender(<MyRulesBlock params={{}} setParams={() => true} editable />)
    expect(screen.getByText('You have no rules yet. Turn a recurring mistake into a rule from Insights, then it shows here.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe("This rule was dismissed, so it can't be edited.")
  } finally {
    globalThis.fetch = realFetch
  }
})
