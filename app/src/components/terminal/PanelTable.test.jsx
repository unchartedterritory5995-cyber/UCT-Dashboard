// Customization pass 1: usePanelView (the hook) and PanelTable (the shared sortable header and its
// Columns menu). The shell half (saved with the board, debounced, no remount) is
// pages/terminal/TerminalShell.panelView.test.jsx.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { useEffect, useMemo, useState } from 'react'
import { PanelViewContext } from './terminalPanel'
import usePanelView, { readSortSlot, sortSlotKey, usePanelSort, usePanelSortSlot } from './usePanelView'
import { MENU_GAP, PanelColumns, PanelTableHead, applySort, cycleSort, placeMenu, usePanelTable } from './PanelTable'
import { expectNoAxeViolations } from '../../pages/journal-2-0/a11y/axeHarness'

afterEach(() => cleanup())

function Provider({ view = null, onSet = null, children }) {
  const value = useMemo(() => ({ view, setView: onSet }), [view, onSet])
  return <PanelViewContext.Provider value={value}>{children}</PanelViewContext.Provider>
}

let mounts = 0
function ViewProbe() {
  const [view, setView] = usePanelView({ sort: null, filters: { win: '1M' } })
  useEffect(() => { mounts += 1 }, [])
  return (
    <div>
      <span data-testid="win">{view.filters.win}</span>
      <span data-testid="sort">{view.sort ? `${view.sort.key}:${view.sort.dir}` : 'none'}</span>
      <button type="button" onClick={() => setView({ filters: { win: '3M' } })}>3M</button>
      <button type="button" onClick={() => setView({ filters: { win: '1M' } })}>1M</button>
      <button type="button" onClick={() => setView({ sort: { key: 'pct', dir: 'asc' } })}>sort</button>
    </div>
  )
}

describe('usePanelView', () => {
  it('outside the shell it is component state', () => {
    render(<ViewProbe />)
    expect(screen.getByTestId('win').textContent).toBe('1M')
    fireEvent.click(screen.getByRole('button', { name: '3M' }))
    expect(screen.getByTestId('win').textContent).toBe('3M')
  })
  it('reads the stored view and writes only what differs from the defaults, without remounting', () => {
    const onSet = vi.fn()
    mounts = 0
    render(<Provider view={{ sort: { key: 'pct', dir: 'desc' } }} onSet={onSet}><ViewProbe /></Provider>)
    expect(screen.getByTestId('sort').textContent).toBe('pct:desc')
    fireEvent.click(screen.getByRole('button', { name: '3M' }))
    expect(onSet).toHaveBeenLastCalledWith({ sort: { key: 'pct', dir: 'desc' }, filters: { win: '3M' } })
    fireEvent.click(screen.getByRole('button', { name: '1M' }))
    expect(onSet).toHaveBeenLastCalledWith({ sort: { key: 'pct', dir: 'desc' } })
    expect(mounts).toBe(1)
  })
  it('a write that changes nothing sends nothing; its echo is not re-read', () => {
    const onSet = vi.fn()
    function Echo() {
      const [v, setV] = useState(null)
      return <Provider view={v} onSet={(x) => { onSet(x); setV(x) }}><ViewProbe /></Provider>
    }
    render(<Echo />)
    fireEvent.click(screen.getByRole('button', { name: '1M' }))
    expect(onSet).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '3M' }))
    fireEvent.click(screen.getByRole('button', { name: '3M' }))
    expect(onSet).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('win').textContent).toBe('3M')
  })
  it('adopts a view written from outside (another board under the same panel id)', () => {
    const { rerender } = render(<Provider view={null} onSet={() => {}}><ViewProbe /></Provider>)
    rerender(<Provider view={{ filters: { win: '1Y' } }} onSet={() => {}}><ViewProbe /></Provider>)
    expect(screen.getByTestId('win').textContent).toBe('1Y')
  })
})

const COLS = [
  { key: 'sym', label: 'Symbol', sort: (r) => r.sym, type: 'text', required: true },
  { key: 'pct', label: '% Chg', sort: (r) => r.pct },
  { key: 'vol', label: 'Volume', sort: (r) => r.vol, defaultHidden: true },
  { key: 'note', label: 'Note' },
]
const ROWS = [
  { sym: 'BBB', pct: 2, vol: 10 },
  { sym: 'AAA', pct: null, vol: 30 },
  { sym: 'CCC', pct: 5, vol: 20 },
]

function Table({ testId = 't' }) {
  const t = usePanelTable({ columns: COLS, defaultSort: null })
  const rows = useMemo(() => t.apply(ROWS), [t.apply])
  return (
    <div>
      <PanelColumns table={t} testId={`${testId}-cols`} />
      <table>
        <PanelTableHead table={t} testId={testId} />
        <tbody>
          {rows.map((r) => (
            <tr key={r.sym} data-testid="row">
              {t.shows('sym') && <td>{r.sym}</td>}
              {t.shows('pct') && <td>{r.pct ?? '-'}</td>}
              {t.shows('vol') && <td>{r.vol}</td>}
              {t.shows('note') && <td>n</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
const order = () => screen.getAllByTestId('row').map((r) => r.firstChild.textContent).join(',')
const th = (label) => screen.getByRole('columnheader', { name: new RegExp(label) })

describe('the pure sort', () => {
  it('cycles first direction, the other way, then the list order', () => {
    const pct = COLS[1]
    const s1 = cycleSort(null, pct)
    expect(s1).toEqual({ key: 'pct', dir: 'desc' })
    const s2 = cycleSort(s1, pct)
    expect(s2).toEqual({ key: 'pct', dir: 'asc' })
    expect(cycleSort(s2, pct)).toBeNull()
    expect(cycleSort(null, COLS[0])).toEqual({ key: 'sym', dir: 'asc' })
    expect(cycleSort(null, COLS[3])).toBeNull()
  })
  it('a default sort is a two-step cycle on its own column', () => {
    const def = { key: 'pct', dir: 'desc' }
    expect(cycleSort(def, COLS[1], def)).toEqual({ key: 'pct', dir: 'asc' })
    expect(cycleSort({ key: 'pct', dir: 'asc' }, COLS[1], def)).toEqual(def)
    expect(cycleSort({ key: 'sym', dir: 'desc' }, COLS[0], def)).toEqual(def)
  })
  it('blanks sink both ways; no sort keeps the list order', () => {
    expect(applySort(ROWS, { key: 'pct', dir: 'desc' }, COLS).map((r) => r.sym)).toEqual(['CCC', 'BBB', 'AAA'])
    expect(applySort(ROWS, { key: 'pct', dir: 'asc' }, COLS).map((r) => r.sym)).toEqual(['BBB', 'CCC', 'AAA'])
    expect(applySort(ROWS, null, COLS)).toBe(ROWS)
    expect(applySort(ROWS, { key: 'gone', dir: 'asc' }, COLS)).toBe(ROWS)
  })
})

describe('PanelTableHead', () => {
  it('a click sorts, again turns it round, a third puts the list order back; aria-sort follows', () => {
    render(<Table />)
    expect(order()).toBe('BBB,AAA,CCC')
    expect(th('% Chg').getAttribute('aria-sort')).toBe('none')
    expect(th('Note').hasAttribute('aria-sort')).toBe(false)
    fireEvent.click(screen.getByTestId('t-sort-pct'))
    expect(order()).toBe('CCC,BBB,AAA')
    expect(th('% Chg').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByTestId('t-sort-pct'))
    expect(order()).toBe('BBB,CCC,AAA')
    expect(th('% Chg').getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(screen.getByTestId('t-sort-pct'))
    expect(order()).toBe('BBB,AAA,CCC')
    expect(th('% Chg').getAttribute('aria-sort')).toBe('none')
  })
  it('is keyboard operable: the header is a real button', () => {
    render(<Table />)
    const btn = screen.getByTestId('t-sort-sym')
    expect(btn.tagName).toBe('BUTTON')
    btn.focus()
    expect(document.activeElement).toBe(btn)
    fireEvent.click(btn)   // Enter / Space on a <button> is a click
    expect(order()).toBe('AAA,BBB,CCC')
  })
  it('a column the list does not sort by has no button', () => {
    render(<Table />)
    expect(screen.queryByTestId('t-sort-note')).toBeNull()
  })
})

describe('PanelColumns', () => {
  it('hides and shows a column, a required one stays, Reset puts sort and columns back', () => {
    render(<Table />)
    expect(screen.queryByRole('columnheader', { name: /Volume/ })).toBeNull()   // hidden by default
    fireEvent.click(screen.getByTestId('t-cols'))
    expect(screen.getByTestId('t-cols-col-sym').disabled).toBe(true)
    fireEvent.click(screen.getByTestId('t-cols-col-vol'))
    expect(screen.getByRole('columnheader', { name: /Volume/ })).toBeTruthy()
    fireEvent.click(screen.getByTestId('t-cols-col-note'))
    expect(screen.queryByRole('columnheader', { name: /Note/ })).toBeNull()
    fireEvent.click(screen.getByTestId('t-cols-col-sym'))
    expect(screen.getByRole('columnheader', { name: /Symbol/ })).toBeTruthy()
    fireEvent.click(screen.getByTestId('t-sort-pct'))
    expect(screen.getByTestId('t-cols').textContent).toContain('changed')
    fireEvent.click(screen.getByTestId('t-cols-reset'))
    expect(order()).toBe('BBB,AAA,CCC')
    expect(screen.queryByRole('columnheader', { name: /Volume/ })).toBeNull()
    expect(screen.getByRole('columnheader', { name: /Note/ })).toBeTruthy()
    expect(screen.getByTestId('t-cols-reset').disabled).toBe(true)
  })
  it('a required column is never stored as hidden, even when asked directly', () => {
    let stored = null
    function Direct() {
      const t = usePanelTable({ columns: COLS })
      return <button type="button" onClick={() => t.toggleColumn('sym')}>hide sym</button>
    }
    render(<Provider view={null} onSet={(v) => { stored = v }}><Direct /></Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'hide sym' }))
    expect(stored).toBeNull()
  })
  it('Escape closes the menu and gives focus back', () => {
    render(<Table />)
    const btn = screen.getByTestId('t-cols')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    // focus is in the menu once it opens; Escape there (an element listener, not a page one) closes it
    expect(screen.getByTestId('t-cols-menu').contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByTestId('t-cols-menu')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })
  it('sort and hidden columns survive a remount from the stored view', () => {
    let stored = null
    const onSet = (v) => { stored = v }
    const first = render(<Provider view={stored} onSet={onSet}><Table /></Provider>)
    fireEvent.click(screen.getByTestId('t-sort-pct'))
    fireEvent.click(screen.getByTestId('t-cols'))
    fireEvent.click(screen.getByTestId('t-cols-col-note'))
    expect(stored).toEqual({ sort: { key: 'pct', dir: 'desc' }, cols: { hidden: ['vol', 'note'] } })
    first.unmount()
    render(<Provider view={stored} onSet={onSet}><Table /></Provider>)
    expect(order()).toBe('CCC,BBB,AAA')
    expect(screen.queryByRole('columnheader', { name: /Note/ })).toBeNull()
  })
  it('has no axe violations, menu open', async () => {
    const { container } = render(<Table />)
    fireEvent.click(screen.getByTestId('t-sort-pct'))
    fireEvent.click(screen.getByTestId('t-cols'))
    await act(async () => { await expectNoAxeViolations(container) })
  })
})

describe('usePanelSort', () => {
  function Sorter() {
    const [sort, setSort] = usePanelSort({ key: 'order', dir: 'asc' })
    return (
      <div>
        <span data-testid="s">{`${sort.key}:${sort.dir}`}</span>
        <button type="button" onClick={() => setSort((s) => ({ key: 'pct', dir: s.key === 'pct' ? 'asc' : 'desc' }))}>pct</button>
        <button type="button" onClick={() => setSort({ key: 'order', dir: 'asc' })}>reset</button>
      </div>
    )
  }
  it('takes a value or an updater, stores only a sort that is not the default', () => {
    const onSet = vi.fn()
    render(<Provider view={null} onSet={onSet}><Sorter /></Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'pct' }))
    expect(screen.getByTestId('s').textContent).toBe('pct:desc')
    expect(onSet).toHaveBeenLastCalledWith({ sort: { key: 'pct', dir: 'desc' } })
    fireEvent.click(screen.getByRole('button', { name: 'pct' }))
    expect(screen.getByTestId('s').textContent).toBe('pct:asc')
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    expect(onSet).toHaveBeenLastCalledWith(undefined)
    expect(screen.getByTestId('s').textContent).toBe('order:asc')
  })
})

describe('the Columns menu is never cut', () => {
  const view = { width: 1000, height: 800 }
  const btn = (left, top) => ({ left, right: left + 70, top, bottom: top + 26 })
  it('placeMenu: under the button, kept inside the window, above when below has no room', () => {
    expect(placeMenu(btn(100, 50), { width: 200, height: 300 }, view)).toMatchObject({ left: 100, top: 80, up: false })
    // a button at the right edge: the menu moves left so its right edge stays GAP inside the window
    expect(placeMenu(btn(950, 50), { width: 200, height: 300 }, view).left).toBe(1000 - MENU_GAP - 200)
    // a button at the left edge of a phone
    expect(placeMenu(btn(4, 50), { width: 200, height: 300 }, { width: 390, height: 800 }).left).toBe(MENU_GAP)
    // near the bottom: it opens above, and never past the top
    const up = placeMenu(btn(100, 700), { width: 200, height: 300 }, view)
    expect(up.up).toBe(true)
    expect(up.top).toBe(700 - 4 - 300)
    // too tall for either side: it keeps to the room it has and scrolls inside
    const tall = placeMenu(btn(100, 300), { width: 200, height: 2000 }, view)
    expect(tall.maxHeight).toBe(800 - MENU_GAP - 330)
    // wider than a tiny window: it is pinned to the gap
    expect(placeMenu(btn(10, 50), { width: 500, height: 100 }, { width: 300, height: 800 }).left).toBe(MENU_GAP)
  })
  it('is drawn on document.body, outside the clipping panel, placed from the button', () => {
    const rects = {
      't-cols': { left: 940, right: 1010, top: 40, bottom: 66, width: 70, height: 26 },
      't-cols-menu': { left: 0, right: 220, top: 0, bottom: 260, width: 220, height: 260 },
    }
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      return rects[this.getAttribute?.('data-testid')] || { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }
    })
    const was = [window.innerWidth, window.innerHeight]
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    try {
      render(<div data-testid="clip" style={{ overflow: 'hidden', height: 40 }}><Table /></div>)
      fireEvent.click(screen.getByTestId('t-cols'))
      const menu = screen.getByTestId('t-cols-menu')
      expect(screen.getByTestId('clip').contains(menu)).toBe(false)
      expect(menu.parentElement).toBe(document.body)
      expect(menu.style.left).toBe(`${1024 - MENU_GAP - 220}px`)
      expect(menu.style.top).toBe('70px')
      expect(menu.getAttribute('data-placement')).toBe('below')
      // focus is in the menu (the portal is at the end of the page)
      expect(menu.contains(document.activeElement)).toBe(true)
      // a click outside closes it
      fireEvent.mouseDown(screen.getByTestId('clip'))
      expect(screen.queryByTestId('t-cols-menu')).toBeNull()
    } finally {
      spy.mockRestore()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: was[0] })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: was[1] })
    }
  })
  it('a column the answer cannot fill is neither drawn nor offered', () => {
    function Partial() {
      const cols = COLS.map((c) => (c.key === 'note' ? { ...c, available: false } : c))
      const t = usePanelTable({ columns: cols })
      return (
        <div>
          <PanelColumns table={t} testId="p-cols" />
          <table aria-label="p"><PanelTableHead table={t} /><tbody><tr><td>{t.shows('note') ? 'note' : 'none'}</td></tr></tbody></table>
        </div>
      )
    }
    render(<Partial />)
    expect(screen.queryByRole('columnheader', { name: /Note/ })).toBeNull()
    expect(screen.getByText('none')).toBeTruthy()
    fireEvent.click(screen.getByTestId('p-cols'))
    expect(screen.queryByTestId('p-cols-col-note')).toBeNull()
    expect(screen.getByTestId('p-cols-col-pct')).toBeTruthy()
  })
})

describe('usePanelSortSlot: several sorts in one panel', () => {
  function Slot({ slot, def }) {
    const [sort, setSort] = usePanelSortSlot(slot, def)
    return (
      <div>
        <span data-testid={`s-${slot}`}>{`${sort.key}:${sort.dir}`}</span>
        <button type="button" onClick={() => setSort({ key: 'pct', dir: 'asc' })}>{`sort ${slot}`}</button>
        <button type="button" onClick={() => setSort(def)}>{`reset ${slot}`}</button>
      </div>
    )
  }
  it('two hooks in one panel keep two sorts; the record as it stands is the base, so neither writes over the other', () => {
    const store = { view: null }
    function Host({ children }) {
      const value = useMemo(() => ({ view: store.view, setView: (v) => { store.view = v || null }, get: () => store.view }), [])
      return <PanelViewContext.Provider value={value}>{children}</PanelViewContext.Provider>
    }
    render(<Host><Slot slot="rank" def={{ key: 'order', dir: 'asc' }} /><Slot slot="members" def={{ key: 'short', dir: 'desc' }} /></Host>)
    fireEvent.click(screen.getByRole('button', { name: 'sort rank' }))
    fireEvent.click(screen.getByRole('button', { name: 'sort members' }))
    expect(store.view).toEqual({ filters: { 's.rank': 'pct|asc', 's.members': 'pct|asc' } })
    fireEvent.click(screen.getByRole('button', { name: 'reset rank' }))
    expect(store.view).toEqual({ filters: { 's.members': 'pct|asc' } })
    expect(screen.getByTestId('s-rank').textContent).toBe('order:asc')
  })
  it('the slot name and its text are cleaned', () => {
    expect(sortSlotKey('30D')).toBe('s.30D')
    expect(sortSlotKey('a b/c')).toBe('s.abc')
    expect(readSortSlot('pct|asc')).toEqual({ key: 'pct', dir: 'asc' })
    expect(readSortSlot('pct|up')).toBeNull()
    expect(readSortSlot('')).toBeNull()
  })
})
