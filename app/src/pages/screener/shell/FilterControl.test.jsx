import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilterControl from './FilterControl'
import { COLUMN_DEFS } from '../columnDefs'

const RS = { key: 'rs_rank', label: 'RS Rank', type: 'range', allow_custom: true,
  presets: [{ label: 'Any' }, { label: 'Over 80', op: 'gte', min: 80 }], unit: null }

const SCAN = { key: 'scan', label: 'Scan', type: 'select', allow_custom: false,
  presets: [{ label: 'Any' }, { label: 'Breakout base', op: 'in', value: 'sha256:aaa' }], unit: null }

describe('FilterControl', () => {
  it('preset select emits the preset spec; Any clears', () => {
    const onChange = vi.fn()
    render(<FilterControl filter={RS} value={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Over 80' } })
    expect(onChange).toHaveBeenCalledWith({ op: 'gte', min: 80 })
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Any' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('custom range commits on Enter — controlled, no DOM id pairing', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<FilterControl filter={RS} value={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Custom…' } })
    await user.type(screen.getByLabelText('RS Rank min'), '70')
    await user.type(screen.getByLabelText('RS Rank max'), '95{Enter}')
    expect(onChange).toHaveBeenLastCalledWith({ op: 'between', min: 70, max: 95 })
  })

  it('clearing both custom inputs drops the filter and closes the row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<FilterControl filter={RS} value={{ op: 'gte', min: 70 }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Custom…' } })
    await user.clear(screen.getByLabelText('RS Rank min'))
    fireEvent.keyDown(screen.getByLabelText('RS Rank min'), { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryByLabelText('RS Rank min')).toBeNull()
  })

  it('K9: the preset label rides into the spec only on the scan filter', () => {
    const onScan = vi.fn()
    render(<FilterControl filter={SCAN} value={null} onChange={onScan} />)
    fireEvent.change(screen.getByLabelText('Scan'), { target: { value: 'Breakout base' } })
    expect(onScan).toHaveBeenCalledWith({ op: 'in', value: 'sha256:aaa', label: 'Breakout base' })

    const onRs = vi.fn()
    render(<FilterControl filter={RS} value={null} onChange={onRs} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Over 80' } })
    expect(onRs).toHaveBeenCalledWith({ op: 'gte', min: 80 })
    expect(onRs.mock.calls[0][0]).not.toHaveProperty('label')
  })

  it('a value applied from outside re-seeds the inputs', () => {
    const { rerender } = render(<FilterControl filter={RS} value={null} onChange={() => {}} />)
    rerender(<FilterControl filter={RS} value={{ op: 'between', min: 60, max: 90 }} onChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Custom…' } })
    expect(screen.getByLabelText('RS Rank min')).toHaveValue(60)
    expect(screen.getByLabelText('RS Rank max')).toHaveValue(90)
  })
})

// The misreading happens when a member picks a THRESHOLD, not only when they
// read a cell — so the same `columnDefs.desc` has to reach the rail. `meta()`
// ships no description of its own; the join is filter.key → COLUMN_DEFS[key].
const DP = { key: 'dp_notional_1d', label: 'Dark Pool Block Notional (1d)',
  type: 'range', allow_custom: true, presets: [{ label: 'Any' }], unit: '$' }
const infoButtons = () => screen.queryAllByRole('button', { name: /^What .+ means$/ })

describe('FilterControl — column description surface', () => {
  it('the described filter opens the full column text from the keyboard', async () => {
    const user = userEvent.setup()
    render(<FilterControl filter={DP} value={null} onChange={() => {}} />)

    const btn = screen.getByRole('button', { name: 'What Dark Pool Block Notional (1d) means' })
    await user.tab()
    expect(document.activeElement).toBe(btn) // in tab order ahead of the select

    await user.keyboard('{Enter}')
    // The $4M block floor and the three-way-ambiguous blank, in full — the two
    // facts a member setting this threshold would otherwise get wrong.
    expect(screen.getByRole('note')).toHaveTextContent(COLUMN_DEFS.dp_notional_1d.desc)
    expect(btn).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('Escape closes the description and never reaches the sheet hosting the rail', async () => {
    const user = userEvent.setup()
    // Below 1024px the rail is display:none and FiltersSheet re-hosts it, so
    // this IS the shipping arrangement on touch. `Sheet.jsx` registers Escape
    // on `document` in CAPTURE when it opens — before the panel exists — and
    // two listeners on one node fire in registration order, so a
    // stopImmediatePropagation from the panel would arrive second and too
    // late. Dismissing a tooltip must not dump the member out of the sheet.
    const hostEscape = vi.fn()
    document.addEventListener('keydown', hostEscape, true)
    try {
      render(<FilterControl filter={DP} value={null} onChange={() => {}} />)
      const btn = screen.getByRole('button', { name: 'What Dark Pool Block Notional (1d) means' })

      // CONTROL: with nothing open the host DOES hear Escape. Without this the
      // assertion below could pass because the probe never fires at all.
      await user.keyboard('{Escape}')
      expect(hostEscape).toHaveBeenCalledTimes(1)

      await user.click(btn)
      expect(screen.getByRole('note')).toBeTruthy()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('note')).toBeNull()
      expect(hostEscape).toHaveBeenCalledTimes(1) // still 1 — the sheet never heard it
      expect(document.activeElement).toBe(btn)
    } finally {
      document.removeEventListener('keydown', hostEscape, true)
    }
  })

  it('the panel carries a labelled dismiss, and Tab leaves by the on-screen order', async () => {
    const user = userEvent.setup()
    render(<FilterControl filter={DP} value={null} onChange={() => {}} />)
    const btn = screen.getByRole('button', { name: 'What Dark Pool Block Notional (1d) means' })

    await user.click(btn)
    // A touch screen reader has no Escape key; the dismiss is how it closes.
    await user.click(screen.getByRole('button', { name: 'Close description' }))
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.activeElement).toBe(btn)

    // Tab out of a panel portaled to the END of <body> would otherwise strand
    // focus there. The panel closes and focus is handed back to the trigger,
    // so it is never left on a node that has just been removed.
    //
    // ⚠️ RAW keyDown, not `user.tab()`, and the difference is the point. jsdom
    // has no default action for Tab, so userEvent supplies its own focus move
    // AFTER the handlers run — from the panel, which is the last thing in
    // <body>, it lands on <body>. Asserting through it would be asserting
    // userEvent's internals. This dispatches the key and asserts exactly the
    // half this component owns; that the browser's default Tab then continues
    // from the trigger to the select is verified in Chromium.
    await user.click(btn)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close description' }), { key: 'Tab' })
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  // ⛔ THE FIRST TAB IS THE DISMISS'S. The branch above used to fire on ANY Tab
  // while focus was inside the panel, so it closed before `Close description`
  // could ever be focused: an affordance advertised generally that no keyboard
  // user could ever reach. jsdom has no default Tab action, so what is asserted
  // here is the half the component owns — it must NOT dismiss on that first Tab,
  // leaving the browser free to move focus to the dismiss, which is the panel's
  // only focusable and next in document order. Where the browser actually lands
  // is measured in Chromium.
  it('Tab from the panel leaves the dismiss reachable; the Tab AFTER it leaves', async () => {
    const user = userEvent.setup()
    render(<FilterControl filter={DP} value={null} onChange={() => {}} />)
    const btn = screen.getByRole('button', { name: 'What Dark Pool Block Notional (1d) means' })

    await user.click(btn)
    const panel = screen.getByRole('note')
    expect(panel).toBe(document.activeElement) // focus starts on the panel itself

    fireEvent.keyDown(panel, { key: 'Tab' })
    expect(screen.queryByRole('note')).not.toBeNull() // still open — the dismiss is next
    const dismiss = screen.getByRole('button', { name: 'Close description' })
    // ⭐ THE PANEL HOLDS EXACTLY ONE FOCUSABLE, which is what makes "leave the
    // first Tab to the browser" equivalent to "land on the dismiss". Derived
    // from the DOM, not assumed: a second control added here would change where
    // that Tab goes and this fails rather than quietly misdescribing it.
    expect([...panel.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')])
      .toEqual([dismiss])

    fireEvent.keyDown(dismiss, { key: 'Tab' })
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('Shift+Tab leaves from anywhere in the panel — and never traps focus', async () => {
    const user = userEvent.setup()
    render(<FilterControl filter={DP} value={null} onChange={() => {}} />)
    const btn = screen.getByRole('button', { name: 'What Dark Pool Block Notional (1d) means' })

    // Backwards from the panel would otherwise walk into the END of <body>,
    // which is nowhere near the control the member is reading about.
    await user.click(btn)
    fireEvent.keyDown(screen.getByRole('note'), { key: 'Tab', shiftKey: true })
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  // ⛔⛔ THE ONE THAT SHIPPED. `9d76cb410` made the focus move into the panel
  // unconditional and, in the same round, changed the scroll-away handler to
  // restore focus. Inside an `overflow:auto` container a bare `focus()` scrolls
  // its target back into view, so every flick with a description open threw the
  // member back to the filter they had opened — on the sheet that is the ONLY
  // filter surface on touch.
  //
  // ⚠️ WHAT THIS LAYER CAN AND CANNOT SEE. jsdom has no layout and no scrolling,
  // so NO test here can observe the viewport moving; 182 green tests were blind
  // to the regression for exactly that reason. What it CAN see is the
  // distinction the fix encodes — implicit dismissals restore focus with
  // `preventScroll`, explicit ones do not — and these go red on the shipped
  // code. The viewport consequence itself is measured in Chromium against the
  // real FiltersSheet and lives in the punch-list report, not in CI.
  const openPanelAndWatchTrigger = async user => {
    render(<FilterControl filter={DP} value={null} onChange={() => {}} />)
    const btn = screen.getByRole('button', { name: 'What Dark Pool Block Notional (1d) means' })
    await user.click(btn)
    expect(screen.getByRole('note')).toBeTruthy()
    return { btn, focusSpy: vi.spyOn(btn, 'focus') }
  }
  const lastFocusOptions = spy => {
    expect(spy).toHaveBeenCalled() // a spy that never fired proves nothing
    return spy.mock.calls.at(-1)[0]
  }

  it.each([
    ['a scroll', () => fireEvent.scroll(window)],
    ['a resize — the phone URL bar hiding BECAUSE the member scrolled',
      () => fireEvent.resize(window)],
    ['an outside click', () => fireEvent.mouseDown(document.body)],
  ])('%s restores focus WITHOUT scrolling the trigger back into view', async (_label, act) => {
    const user = userEvent.setup()
    const { btn, focusSpy } = await openPanelAndWatchTrigger(user)
    act()
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.activeElement).toBe(btn) // never stranded on <body>
    expect(lastFocusOptions(focusSpy)).toEqual({ preventScroll: true })
  })

  it.each([
    ['Escape', async user => { await user.keyboard('{Escape}') }],
    ['the dismiss button', async user => {
      await user.click(screen.getByRole('button', { name: 'Close description' }))
    }],
  ])('%s is EXPLICIT — the member asked to come back, so focus scrolls normally',
    async (_label, act) => {
      const user = userEvent.setup()
      const { btn, focusSpy } = await openPanelAndWatchTrigger(user)
      await act(user)
      expect(screen.queryByRole('note')).toBeNull()
      expect(document.activeElement).toBe(btn)
      // No options object at all — the browser's default scroll-into-view is
      // the RIGHT behaviour here and suppressing it would strand a keyboard
      // user looking at a control they can no longer see.
      expect(lastFocusOptions(focusSpy)).toBeUndefined()
    })

  it('a filter whose column has no desc grows NO affordance — same probe, both populations', () => {
    // CONTROL: absence is only evidence if the query can see a present one.
    const { unmount } = render(<FilterControl filter={RS} value={null} onChange={() => {}} />)
    expect(COLUMN_DEFS.rs_rank.desc).toBeUndefined()
    expect(infoButtons()).toHaveLength(0)
    unmount()

    render(<FilterControl filter={DP} value={null} onChange={() => {}} />)
    expect(infoButtons().map(b => b.dataset.coldesc)).toEqual(['dp_notional_1d'])
  })
})
