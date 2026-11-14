import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MenuRows, useMenuButton } from './NewNoteMenu'
import { expectSecondView } from '../../lib/testing/menuSecondView.testkit'

// S11 (audit 2026-11-05): the notes list's own caret (NewNoteCaret) was retired into the list toolbar's
// menus, which run the SAME engine (`useMenuButton` + `MenuRows`). "The list form" below is that engine as
// NotebookTab uses it, so every keyboard rail here still reads both callers of the one engine.
function ListForm({ onFromOutline, onFromStyle, onToday, onVoice }) {
  const menu = useMenuButton()
  const items = [
    onFromOutline && { key: 'outline', label: 'From an outline', run: onFromOutline },
    onFromStyle && { key: 'style', label: 'From a template', run: onFromStyle },
    onVoice && { key: 'voice', label: 'Voice note', run: onVoice },
    onToday && { key: 'today', label: "Today's note", run: onToday },
  ].filter(Boolean)
  return (
    <div>
      <button {...menu.triggerProps} type="button" className="btn btn-primary btn-sm" aria-label="More ways to start a note">▾</button>
      {menu.open && <div {...menu.menuProps} aria-label="Start a note"><MenuRows menu={menu} items={items} /></div>}
    </div>
  )
}

// Go-live wave 1: Research home's split button (NewNoteMenu's default export) was deleted with Research home. Its
// cases that pinned the ENGINE (the tour card keeps the menu open, focus is on the trigger by the time an item runs,
// Escape) now run on the list form; the cases that pinned only its own markup (the main button, which doors it listed,
// "From a template") went with it.
describe('the engine: presses, focus and Escape (list form)', () => {
  // P0.10: the voice-notes tour keeps this menu open while its card describes the voice item. The
  // card is portalled to document.body, so a press on its Next button is "outside" the menu;
  // without an exemption the menu closed on pointerdown and the tour ended before the click landed.
  it('a press on the tour card (data-tour-card) leaves the menu open; a press elsewhere closes it', () => {
    render(
      <div>
        <ListForm onFromOutline={vi.fn()} onVoice={vi.fn()} />
        <div data-tour-card="non-modal"><button type="button">Next</button></div>
        <p>elsewhere</p>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Next' }))
    expect(screen.queryByRole('menu')).not.toBeNull()
    fireEvent.pointerDown(screen.getByText('elsewhere'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
  // M2 (final review): `run` closed the menu but left focus on the item, which then unmounted, so
  // when the New-note sheet or the voice dialog closed, focus returned to a detached item (<body>).
  // Focus goes back to the trigger BEFORE the chosen item runs, so whatever opens and closes after
  // it hands focus back to a live control.
  it('M2: focus is on the trigger by the time a chosen item runs, for every item', () => {
    const seen = {}
    const spy = (name) => vi.fn(() => { seen[name] = document.activeElement })
    const onFromOutline = spy('outline'); const onVoice = spy('voice'); const onToday = spy('today')
    render(<ListForm onFromOutline={onFromOutline} onVoice={onVoice} onToday={onToday} />)
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    for (const [name, label] of [['outline', 'From an outline'], ['voice', 'Voice note'], ['today', "Today's note"]]) {
      fireEvent.click(caret)
      fireEvent.click(screen.getByRole('menuitem', { name: label }))
      expect(screen.queryByRole('menu'), `${name}: menu closed`).toBeNull()
      expect(seen[name], `${name}: focus was on the trigger when the item ran`).toBe(caret)
      expect(document.activeElement, `${name}: and it is still there afterwards`).toBe(caret)
    }
  })
  it('Escape closes the menu and returns focus to the trigger', () => {
    render(<ListForm onFromOutline={vi.fn()} />)
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    fireEvent.click(caret)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(caret)
  })
})

// The list form (the toolbar engine): a row runs its door and focus goes back to the trigger first, and
// Left/Right/Home/End never escape the open menu to the toolbar that roves around it.
describe('the list form (useMenuButton + MenuRows)', () => {
  it('a row runs its door, focus returns to the trigger, the menu closes', () => {
    const onFromStyle = vi.fn()
    render(<ListForm onFromOutline={vi.fn()} onFromStyle={onFromStyle} onToday={vi.fn()} />)
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    expect(caret).toHaveAttribute('aria-haspopup', 'menu')
    fireEvent.click(caret)
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent.trim()))
      .toEqual(['From an outline', 'From a template', "Today's note"])
    fireEvent.click(screen.getByRole('menuitem', { name: 'From a template' }))
    expect(onFromStyle).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(caret)
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('a checked row is a menuitemradio with aria-checked; a separator is drawn, not focused', () => {
    function Radio() {
      const menu = useMenuButton()
      return (
        <div>
          <button {...menu.triggerProps} type="button">View: List</button>
          {menu.open && <div {...menu.menuProps} aria-label="View"><MenuRows menu={menu} items={[
            { key: 'list', label: 'List', checked: true, run: () => {} },
            { key: 'table', label: 'Table', checked: false, run: () => {} },
            { key: 'sep', separator: true },
            { key: 'save', label: 'Save view', run: () => {} },
          ]} /></div>}
        </div>
      )
    }
    render(<Radio />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'View: List' }), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Save view' }))   // the separator is skipped
    expect(screen.getByRole('menuitemradio', { name: 'List' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Table' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('separator')).toBeTruthy()
  })
  it('Left/Right inside the open menu do not escape it (a toolbar around it cannot steal them)', () => {
    const outer = vi.fn()
    render(<div onKeyDown={outer}><ListForm onFromOutline={vi.fn()} onToday={vi.fn()} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    const [first] = screen.getAllByRole('menuitem')
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) fireEvent.keyDown(first, { key })
    expect(outer).not.toHaveBeenCalled()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(outer).toHaveBeenCalledTimes(1)   // the keys the menu does not need still bubble
  })
})

// Fix round 1 (review M1, M2). The open menu keeps Left/Right/Home/End to itself in BOTH forms:
// Home's split button too (nothing around it roves, but a window-level Left/Right, such as the video
// seek shortcuts, no longer sees them while a menu item holds focus). Home/End move to the first or
// last item and do not scroll the page.
describe('the open menu keeps Left/Right/Home/End', () => {
  it.each([['the list form', (p) => <ListForm {...p} />]])(
    '%s: Home and End focus the first and last item, and the page does not scroll', (_n, mount) => {
      render(mount({ onFromOutline: vi.fn(), onFromStyle: vi.fn(), onToday: vi.fn() }))
      fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
      const items = screen.getAllByRole('menuitem')
      expect(fireEvent.keyDown(items[0], { key: 'End' })).toBe(false)   // false = default prevented
      expect(document.activeElement).toBe(items[items.length - 1])
      expect(fireEvent.keyDown(items[items.length - 1], { key: 'Home' })).toBe(false)
      expect(document.activeElement).toBe(items[0])
    },
  )
})

// Review follow-up R1: the menu button's keyboard pattern. ArrowDown / ArrowUp on the caret open the
// menu on its first / last item, and a Tab that takes focus out of the open menu closes it.
describe.each([['the list form', (p) => <ListForm {...p} />]])(
  'keyboard: open from the caret, close on Tab-out (%s)', (_n, mount) => {
    const doors = () => ({ onFromOutline: vi.fn(), onFromStyle: vi.fn(), onToday: vi.fn() })
    const page = (p) => render(<div>{mount(p)}<button type="button">after</button></div>)
    const caretOf = () => screen.getByRole('button', { name: 'More ways to start a note' })
    it('ArrowDown on the caret opens the menu on the first item', () => {
      page(doors())
      caretOf().focus()
      expect(fireEvent.keyDown(caretOf(), { key: 'ArrowDown' })).toBe(false)   // false = default prevented
      const items = screen.getAllByRole('menuitem')
      expect(caretOf()).toHaveAttribute('aria-expanded', 'true')
      expect(document.activeElement).toBe(items[0])
    })
    it('ArrowUp on the caret opens the menu on the last item', () => {
      page(doors())
      caretOf().focus()
      fireEvent.keyDown(caretOf(), { key: 'ArrowUp' })
      const items = screen.getAllByRole('menuitem')
      expect(document.activeElement).toBe(items[items.length - 1])
    })
    it('ArrowDown after ArrowUp still starts at the first item (the request is not remembered)', () => {
      page(doors())
      fireEvent.keyDown(caretOf(), { key: 'ArrowUp' })
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      fireEvent.keyDown(caretOf(), { key: 'ArrowDown' })
      expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0])
    })
    it('a click after an ArrowUp-open still starts at the first item (the request is read once)', () => {
      page(doors())
      fireEvent.keyDown(caretOf(), { key: 'ArrowUp' })
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      fireEvent.click(caretOf())
      expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0])
    })
    it('ArrowDown on the caret of an already-open menu moves into it; other keys do not open it', () => {
      page(doors())
      fireEvent.click(caretOf())
      caretOf().focus()
      fireEvent.keyDown(caretOf(), { key: 'ArrowUp' })
      const items = screen.getAllByRole('menuitem')
      expect(document.activeElement).toBe(items[items.length - 1])
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      for (const key of ['ArrowLeft', 'ArrowRight', 'a']) fireEvent.keyDown(caretOf(), { key })
      expect(screen.queryByRole('menu')).toBeNull()
    })
    it('Tab out of the open menu closes it and leaves focus where Tab sent it', async () => {
      const user = userEvent.setup()
      page(doors())
      fireEvent.keyDown(caretOf(), { key: 'ArrowUp' })
      expect(screen.getByRole('menu')).toBeTruthy()
      await user.tab()
      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }))
      expect(caretOf()).toHaveAttribute('aria-expanded', 'false')
    })
    it('focus moving between items, or back to the caret, keeps the menu open', async () => {
      const user = userEvent.setup()
      page(doors())
      fireEvent.keyDown(caretOf(), { key: 'ArrowDown' })
      await user.tab()   // first item -> second item? No: a menu's rows are tabbable buttons, so Tab walks them
      expect(screen.getByRole('menu')).toBeTruthy()
      const items = screen.getAllByRole('menuitem')
      items[1].focus()
      await user.tab({ shift: true })
      await user.tab({ shift: true })
      expect(document.activeElement).toBe(caretOf())
      expect(screen.getByRole('menu')).toBeTruthy()
    })
    it('focus going to the tour card keeps the menu open; focus going anywhere else closes it', () => {
      render(<div>{mount(doors())}<div data-tour-card="non-modal"><button type="button">Next</button></div><button type="button">elsewhere</button></div>)
      fireEvent.click(caretOf())
      const first = screen.getAllByRole('menuitem')[0]
      fireEvent.focusOut(first, { relatedTarget: screen.getByRole('button', { name: 'Next' }) })
      expect(screen.getByRole('menu')).toBeTruthy()
      fireEvent.focusOut(first, { relatedTarget: null })   // the window lost focus: the pointer handler owns outside presses
      expect(screen.getByRole('menu')).toBeTruthy()
      fireEvent.focusOut(first, { relatedTarget: screen.getByRole('button', { name: 'elsewhere' }) })
      expect(screen.queryByRole('menu')).toBeNull()
    })
  },
)

// Tier 1b fix round 1 (review Important 4): a row with NO BOX (the ⋯ menu's phone-only rows, `display: none` on a
// desktop) is not a stop. Focus went to the hidden first row (a no-op), so the menu hung open with focus on the
// trigger, and ArrowUp from Export got stuck on the hidden Import. jsdom has no layout, so the hidden rows' boxes are
// stubbed; where NOTHING has a box (a layout-less test) every row counts, as useToolbarRoving does.
describe('rows with no box are skipped (Important 4)', () => {
  function Menu() {
    const menu = useMenuButton()
    return (
      <div>
        <button {...menu.triggerProps} type="button">More</button>
        {menu.open && <div {...menu.menuProps} aria-label="More"><MenuRows menu={menu} items={[
          { key: 'today', label: 'Today', run: () => {}, className: 'phoneOnly' },
          { key: 'import', label: 'Import', run: () => {}, className: 'phoneOnly' },
          { key: 'export', label: 'Export', run: () => {} },
          { key: 'tools', label: 'My tools', run: () => {} },
        ]} /></div>}
      </div>
    )
  }
  const real = HTMLElement.prototype.getClientRects
  beforeEach(() => {
    HTMLElement.prototype.getClientRects = function rects() { return this.classList.contains('phoneOnly') ? [] : [{}] }
  })
  afterEach(() => { HTMLElement.prototype.getClientRects = real })

  it('opening on ArrowDown lands on the first SHOWN row; ArrowUp from it wraps past the hidden ones', () => {
    render(<Menu />)
    const trigger = screen.getByRole('button', { name: 'More' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Export' }))
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'My tools' }))
    fireEvent.keyDown(document.activeElement, { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Export' }))
  })
})

// Go-live wave 1: a caller can draw a row (or a group's box) itself, so a walkthrough anchor is a literal `data-tour`
// in the caller's own file. The row it draws is the row MenuRows would have drawn: same role, class and press.
describe('MenuRows `render`: a caller-drawn row is the same row', () => {
  function Drawn({ onVoice, onDaily }) {
    const menu = useMenuButton()
    const items = [
      { key: 'blank', label: 'Blank', run: () => {} },
      { key: 'voice', label: 'Voice note', run: onVoice, render: (p, c) => <button {...p} data-tour="drawn-row">{c}</button> },
      {
        key: 'reviews', group: 'Reviews', heading: true,
        render: (p, c) => <div {...p} data-tour="drawn-group">{c}</div>,
        items: [{ key: 'daily', label: "Today's recap", run: onDaily }],
      },
    ]
    return (
      <div>
        <button {...menu.triggerProps} type="button">New</button>
        {menu.open && <div {...menu.menuProps} aria-label="Start a note"><MenuRows menu={menu} items={items} /></div>}
      </div>
    )
  }
  it('the drawn row is a menuitem with the engine class and runs its door; the drawn group is a named group', () => {
    const onVoice = vi.fn(); const onDaily = vi.fn()
    render(<Drawn onVoice={onVoice} onDaily={onDaily} />)
    const trigger = screen.getByRole('button', { name: 'New' })
    fireEvent.click(trigger)
    const blank = screen.getByRole('menuitem', { name: 'Blank' })
    const row = screen.getByRole('menuitem', { name: 'Voice note' })
    expect(row).toHaveAttribute('data-tour', 'drawn-row')
    expect(row.className).toBe(blank.className)
    const group = screen.getByRole('group', { name: 'Reviews' })
    expect(group).toHaveAttribute('data-tour', 'drawn-group')
    expect(group.textContent).toContain('Reviews')
    // ArrowDown walks into the drawn row: it is one of the menu's rows.
    fireEvent.keyDown(blank, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row)
    fireEvent.click(row)
    expect(onVoice).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: "Today's recap" }))
    expect(onDaily).toHaveBeenCalledTimes(1)
  })
})

// Simplify pass 2 (C1-C3): a row with `children` opens a SECOND VIEW inside the same menu (the "Aa" menu's Font and
// Size view, lifted into the engine). The shared kit holds every menu that uses it to Review focus 5.
describe('the engine: a second view inside the same menu', () => {
  function Nested({ onDaily = () => {}, busy = false, onPick = () => {} }) {
    const menu = useMenuButton()
    const items = [
      { key: 'blank', label: 'Blank', run: onPick },
      {
        key: 'reviews', label: 'Draft a review', icon: 'book',
        children: [
          { key: 'daily', label: "Today's recap", run: onDaily, disabled: busy },
          { key: 'weekly', label: "This week's review", run: () => {}, disabled: busy },
        ],
      },
      { key: 'import', label: 'Import', run: onPick },
    ]
    return (
      <div>
        <button {...menu.triggerProps} type="button">New</button>
        {menu.open && <div {...menu.menuProps} aria-label="Start a note"><MenuRows menu={menu} items={items} label="Start a note" /></div>}
      </div>
    )
  }
  const trigger = () => screen.getByRole('button', { name: 'New' })
  const open = () => { fireEvent.click(trigger()); return screen.getByRole('menu', { name: 'Start a note' }) }

  it('meets the shared contract (Review focus 5): Back, Left and Escape return to the row; a second Escape closes', async () => {
    render(<Nested />)
    await expectSecondView({
      openMenu: open, parentRowName: 'Draft a review', childRowNames: ["Today's recap", "This week's review"], trigger,
    })
  })

  it('the parent row says it opens more rows; Back is named for the menu; the children are one named group', () => {
    render(<Nested />)
    const menu = open()
    const row = screen.getByRole('menuitem', { name: 'Draft a review' })
    expect(row).toHaveAttribute('aria-haspopup', 'menu')
    fireEvent.click(row)
    expect(screen.getByRole('menu', { name: 'Start a note' })).toBe(menu)
    expect(screen.getByRole('menuitem', { name: 'Back to Start a note' }).textContent.trim()).toBe('Back')
    expect(screen.getByRole('group', { name: 'Draft a review' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Blank' })).toBeNull()
  })

  it('a child runs its door, closes the menu and leaves focus on the trigger; the menu reopens on its first view', () => {
    const onDaily = vi.fn(() => { expect(document.activeElement).toBe(trigger()) })
    render(<Nested onDaily={onDaily} />)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Draft a review' }))
    fireEvent.click(screen.getByRole('menuitem', { name: "Today's recap" }))
    expect(onDaily).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    open()
    expect(screen.getByRole('menuitem', { name: 'Blank' })).toBeTruthy()
  })

  it('Right on the parent row opens it; with every child disabled, focus waits on Back', async () => {
    render(<Nested busy />)
    open()
    const row = screen.getByRole('menuitem', { name: 'Draft a review' })
    row.focus()
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    const back = await screen.findByRole('menuitem', { name: 'Back to Start a note' })
    expect(document.activeElement).toBe(back)
    expect(screen.getByRole('menuitem', { name: "Today's recap" })).toBeDisabled()
  })

  // Final fix M7: the parent row leaves while its view is open (its gate turned off, e.g. review drafts switched off
  // mid-session). The menu goes back to its first view with focus on its first row, and the keyboard still works.
  it('M7: the parent row gone while its view is open: the first view again, focus on its first row', async () => {
    function Gated({ withReviews }) {
      const menu = useMenuButton()
      const items = [
        { key: 'blank', label: 'Blank', run: () => {} },
        withReviews && { key: 'reviews', label: 'Draft a review', children: [{ key: 'daily', label: "Today's recap", run: () => {} }] },
        { key: 'import', label: 'Import', run: () => {} },
      ].filter(Boolean)
      return (
        <div>
          <button {...menu.triggerProps} type="button">New</button>
          {menu.open && <div {...menu.menuProps} aria-label="Start a note"><MenuRows menu={menu} items={items} label="Start a note" /></div>}
        </div>
      )
    }
    const { rerender } = render(<Gated withReviews />)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Draft a review' }))
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: "Today's recap" }))
    rerender(<Gated withReviews={false} />)
    const blank = await screen.findByRole('menuitem', { name: 'Blank' })
    expect(screen.queryByRole('menuitem', { name: 'Back to Start a note' })).toBeNull()
    expect(document.activeElement).toBe(blank)
    fireEvent.keyDown(blank, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Import' }))
    // Escape on the first view closes the menu (sub is cleared, not left set), focus on the trigger.
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('CONTROL: Escape on the first view closes the menu at once', () => {
    render(<Nested />)
    open()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Blank' }), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })
})
