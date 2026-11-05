import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NewNoteMenu, { MenuRows, useMenuButton } from './NewNoteMenu'

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

describe('NewNoteMenu', () => {
  it('the main button makes a blank note in one press', () => {
    const onBlank = vi.fn()
    render(<NewNoteMenu onBlank={onBlank} onFromOutline={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'New note' }))
    expect(onBlank).toHaveBeenCalledTimes(1)
  })
  it('the menu lists only the doors that work (gatesOff)', () => {
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent.trim())
    expect(items).toEqual(['From an outline'])
  })
  it('voice and today appear when their handlers are given, and each fires', () => {
    const onVoice = vi.fn(); const onToday = vi.fn()
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} onVoice={onVoice} onToday={onToday} />)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent.trim()))
      .toEqual(['From an outline', 'Voice note', "Today's note"])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Voice note' }))
    expect(onVoice).toHaveBeenCalledTimes(1)
  })
  // P0.10: the voice-notes tour keeps this menu open while its card describes the voice item. The
  // card is portalled to document.body, so a press on its Next button is "outside" the menu;
  // without an exemption the menu closed on pointerdown and the tour ended before the click landed.
  it('a press on the tour card (data-tour-card) leaves the menu open; a press elsewhere closes it', () => {
    render(
      <div>
        <NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} onVoice={vi.fn()} />
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
  // Focus goes back to the caret BEFORE the chosen item runs, so whatever opens and closes after
  // it hands focus back to a live control.
  it('M2: focus is on the caret by the time a chosen item runs, for every item', () => {
    const seen = {}
    const spy = (name) => vi.fn(() => { seen[name] = document.activeElement })
    const onFromOutline = spy('outline'); const onVoice = spy('voice'); const onToday = spy('today')
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={onFromOutline} onVoice={onVoice} onToday={onToday} />)
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    for (const [name, label] of [['outline', 'From an outline'], ['voice', 'Voice note'], ['today', "Today's note"]]) {
      fireEvent.click(caret)
      fireEvent.click(screen.getByRole('menuitem', { name: label }))
      expect(screen.queryByRole('menu'), `${name}: menu closed`).toBeNull()
      expect(seen[name], `${name}: focus was on the caret when the item ran`).toBe(caret)
      expect(document.activeElement, `${name}: and it is still there afterwards`).toBe(caret)
    }
  })
  it('Escape closes the menu and returns focus to the caret', () => {
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} />)
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    fireEvent.click(caret)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(caret)
  })
})

describe('NewNoteMenu: From a template (Notebook P1)', () => {
  it('lists "From a template" only when a handler is passed', () => {
    const { rerender } = render(<NewNoteMenu onBlank={() => {}} onFromOutline={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    expect(screen.queryByRole('menuitem', { name: /From a template/ })).toBeNull()
    const onFromStyle = vi.fn()
    rerender(<NewNoteMenu onBlank={() => {}} onFromOutline={() => {}} onFromStyle={onFromStyle} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /From a template/ }))
    expect(onFromStyle).toHaveBeenCalledTimes(1)
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
describe('the open menu keeps Left/Right/Home/End (both forms)', () => {
  it('Home\'s form: Left/Right do not escape the open menu', () => {
    const outer = vi.fn()
    render(<div onKeyDown={outer}><NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} onToday={vi.fn()} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    const [first] = screen.getAllByRole('menuitem')
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(outer).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(first)
    expect(screen.getByRole('menu')).toBeTruthy()
  })
  it.each([['Home\'s form', (p) => <NewNoteMenu onBlank={vi.fn()} {...p} />], ['the list form', (p) => <ListForm {...p} />]])(
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
describe.each([["Home's form", (p) => <NewNoteMenu onBlank={vi.fn()} {...p} />], ['the list form', (p) => <ListForm {...p} />]])(
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
