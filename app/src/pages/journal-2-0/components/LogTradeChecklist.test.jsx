// Log Trade's checklist body and its slot (Notebook P2a, Task 8). The body reads through the real
// read seam (hooks/useChecklistSources); only the three Journal hooks behind it are stood in for, so
// the seam's states are the ones a member gets. Every case is a render with assertions on what is
// on screen (R-RC-2).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const src = {}
vi.mock('../hooks/useJ2Settings', () => ({ default: () => src.settings }))
vi.mock('../hooks/useJ2SelectedAccount', () => ({ default: () => src.account }))
vi.mock('../hooks/useJournalRules', () => ({ default: () => src.rules }))
import LogTradeChecklist from './LogTradeChecklist'

const SETTINGS = {
  setups: ['VCP', 'Flag'],
  setupRules: {
    VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }],
    Flag: [{ id: 'f1', label: 'Pole first' }],
  },
}

beforeEach(() => {
  src.settings = { settings: SETTINGS, isLoading: false }
  src.account = { accountId: 'a1', isLoading: false, isAllAccounts: false, accounts: [{ id: 'a1' }] }
  src.rules = { rules: [], isLoading: false }
})

const renderList = (props) => render(
  <LogTradeChecklist setup="VCP" requireAll="no" checked={[]} onChange={vi.fn()} {...props} />,
)

describe('LogTradeChecklist', () => {
  it('requireAll yes: ticks report up, and the soft warning shows and never disables anything', () => {
    const onChange = vi.fn()
    renderList({ requireAll: 'yes', onChange })
    expect(screen.getByRole('group', { name: 'Pre-entry checklist' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Volume dry-up' }))
    expect(onChange).toHaveBeenCalledWith(['s1'], 2)
    expect(screen.getByRole('status').textContent).toBe('2 checklist items not ticked. You can still log this trade.')
    expect(screen.getAllByRole('checkbox').every((b) => !b.disabled)).toBe(true)
  })

  it('requireAll yes with every item ticked: the status line is empty', () => {
    renderList({ requireAll: 'yes', checked: ['s1', 's2'] })
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('N-3: disabled shows the boxes as sent, read-only, and a click reports nothing', () => {
    const onChange = vi.fn()
    renderList({ checked: ['s2'], disabled: true, onChange })
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((b) => [b.disabled, b.checked])).toEqual([[true, false], [true, true]])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Volume dry-up' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('requireAll no: the same boxes, no warning', () => {
    renderList({ requireAll: 'no' })
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('no setup chosen yet: one line, no boxes', () => {
    renderList({ setup: '' })
    expect(screen.getByText('Pick a setup to see its pre-entry checklist.')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it("a tick keeps another setup's ticks (I-2): they are never shown and never erased", () => {
    const onChange = vi.fn()
    renderList({ checked: ['f1'], onChange })
    expect(screen.getByRole('checkbox', { name: 'Volume dry-up' }).checked).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tight closes' }))
    expect(onChange).toHaveBeenCalledWith(['s2', 'f1'], 2)
  })

  it('before-entry rules join the list after the setup items', () => {
    src.rules = { rules: [{ id: 'r1', label: 'Index above 21 EMA', beforeEntry: true }, { id: 'r2', label: 'Not this', beforeEntry: false }] }
    renderList()
    expect(screen.getAllByRole('checkbox').map((b) => b.closest('label').textContent))
      .toEqual(['Volume dry-up', 'Tight closes', 'Index above 21 EMA'])
  })

  it('reports the ids on screen up, and again when the setup changes', () => {
    const onItems = vi.fn()
    const { rerender } = renderList({ onItems })
    expect(onItems).toHaveBeenLastCalledWith(['s1', 's2'])
    rerender(<LogTradeChecklist setup="Flag" requireAll="no" checked={[]} onChange={vi.fn()} onItems={onItems} />)
    expect(onItems).toHaveBeenLastCalledWith(['f1'])
    const calls = onItems.mock.calls.length
    rerender(<LogTradeChecklist setup="Flag" requireAll="no" checked={['f1']} onChange={vi.fn()} onItems={onItems} />)
    expect(onItems.mock.calls.length).toBe(calls)          // the same ids are not reported twice
  })

  it('a setup with no checklist and no rules says so, with no boxes', () => {
    renderList({ setup: 'Breakout' })
    expect(screen.getByText('No checklist for Breakout yet. Add its rules in Journal settings, under Trade setups.')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('C-1: with All Accounts chosen, no setup or rule is shown as the member\'s own', () => {
    src.account = { accountId: null, isLoading: false, isAllAccounts: true, accounts: [{ id: 'a1' }] }
    const onItems = vi.fn()
    renderList({ onItems })
    expect(screen.getByText('Your pre-entry checklist shows here when one account is selected.')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(onItems).toHaveBeenLastCalledWith([])
  })

  it('every other state with no account says why, in its own words, with no boxes', () => {
    const cases = [
      [{ accountId: null, isLoading: true, accounts: [] }, 'Loading your pre-entry checklist…'],
      [{ accountId: null, isLoading: false, accounts: [] }, 'Your pre-entry checklist shows here once you have a Journal account.'],
      [{ accountId: null, isLoading: false, accounts: [], accountsError: new Error('x') }, "Your accounts couldn't load, so your pre-entry checklist isn't shown."],
    ]
    for (const [account, line] of cases) {
      src.account = account
      const { unmount } = renderList()
      expect(screen.getByText(line)).toBeTruthy()
      expect(screen.queryByRole('checkbox')).toBeNull()
      unmount()
    }
  })

  it('settings still loading, or failed: says so; a failure offers Retry', () => {
    src.settings = { settings: undefined, isLoading: true }
    const { unmount } = renderList()
    expect(screen.getByText('Loading your pre-entry checklist…')).toBeTruthy()
    unmount()
    const refresh = vi.fn()
    src.settings = { settings: undefined, isLoading: false, error: new Error('x'), refresh }
    renderList()
    expect(screen.getByText("Your setups couldn't load, so your pre-entry checklist isn't shown.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("rules that failed to load: the setup's items still show, and the line says the rules are missing", () => {
    src.rules = { rules: undefined, isLoading: false, error: new Error('x') }
    renderList()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByText("Your rules couldn't load, so none are listed here.")).toBeTruthy()
  })
})

describe('LogTradeChecklistSlot', () => {
  it('loads the body on demand and passes every prop through', async () => {
    const { default: LogTradeChecklistSlot } = await import('./LogTradeChecklistSlot')
    render(<LogTradeChecklistSlot setup="VCP" requireAll="yes" checked={['s2']} onChange={vi.fn()} />)
    expect(await screen.findByRole('group', { name: 'Pre-entry checklist' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Tight closes' }).checked).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('1 checklist item not ticked. You can still log this trade.')
  })

  it('a body that cannot load is simply absent: nothing renders and nothing throws', async () => {
    vi.resetModules()
    vi.doMock('./LogTradeChecklist', () => { throw new Error('chunk') })
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { default: Slot } = await import('./LogTradeChecklistSlot')
      const { container } = render(<div data-testid="host"><Slot setup="VCP" requireAll="no" checked={[]} onChange={vi.fn()} /></div>)
      // the failed load settles (one in-place retry, then the boundary); the host stays empty
      await waitFor(() => expect(errs).toHaveBeenCalled(), { timeout: 3000 })
      expect(container.querySelector('[data-testid="host"]').innerHTML).toBe('')
      expect(screen.queryByRole('group')).toBeNull()
    } finally {
      errs.mockRestore()
      vi.doUnmock('./LogTradeChecklist')
    }
  })
})
