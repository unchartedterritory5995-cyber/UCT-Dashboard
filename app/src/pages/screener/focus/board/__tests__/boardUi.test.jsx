// The scan board's parts, each on its own: the Layout menu, the Customize line, the grid's widget
// frames and its drop decision, screens as tabs, the Results widget's row styles, the details card.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi, afterEach, beforeEach, describe, expect, test } from 'vitest'

vi.mock('../../../../../components/CompanyLogo', () => ({ default: p => <span data-testid={`logo-${p.sym}`} /> }))
vi.mock('../../useSparks', () => ({ default: () => new Map([['MU', [1, 2, 3]], ['ECO', [3, 2, 4]], ['DAWN', [2, 2, 2]]]) }))
vi.mock('../../ChartPane', () => ({ paneFacts: () => 'Volume 1.0x avg' }))
import { BoardMenu, BoardEditBar } from '../BoardMenu'
import ScanBoard from '../ScanBoard'
import { ScreenTabs, ScreenSidebar } from '../ScreenNav'
import DetailsCard from '../DetailsCard'
import ResultList from '../../ResultList'
import { sanitize, saveMine, setRows, addWidget, acceptArrangement, settleDrop, rowHeightFor, GAP, PRESETS, ROWS, WIDGETS } from '../boardModel'

const here = path.dirname(fileURLToPath(import.meta.url))
const api = () => ({ pickLayout: vi.fn(), acceptArrangement: vi.fn(() => true), setRows: vi.fn(), addWidget: vi.fn(), removeWidget: vi.fn(),
  saveMine: vi.fn(), updateMine: vi.fn(), deleteMine: vi.fn(), setOption: vi.fn(), setEdit: vi.fn() })
const boardOf = (patch = {}) => ({ ...sanitize(null), edit: false, ...patch })
const openLayout = () => { fireEvent.click(screen.getByRole('button', { name: 'Layout' })); return screen.getByRole('menu', { name: 'Layout' }) }
const itemNames = menu => within(menu).getAllByRole('menuitem').map(el => el.textContent.replace(/\s+/g, ' ').trim())

describe('the Layout menu', () => {
  test('lists the presets with the tick on the open one, then Customize, Save, the row styles and the switches', () => {
    const a = api()
    render(<BoardMenu board={boardOf()} api={a} onSaveAs={vi.fn()} />)
    const menu = openLayout()
    expect(itemNames(menu)).toEqual([
      'Board ✓ (current)', 'Three columns', 'List first',
      'Customize layout', 'Save layout as…',
      'One line ✓ (current)', 'Compact', 'Two lines', 'Cards', 'Chips',
      'Pinned screens as tabson', 'Company logosoff', 'Mini charts in rowsoff', 'Group by setupoff', 'Dim stocks I have looked atoff', 'Keyboard hintsoff', 'Roomier rowsoff',
    ])
    // owner ruling 2026-11-17: neither is offered anywhere on the menu
    expect(menu.textContent).not.toMatch(/table|heat ?map/i)
  })
  test('the sharing entries are there only when the page hands them in (community layouts are behind their own flag)', () => {
    const onCommunity = vi.fn(), onShare = vi.fn()
    const first = render(<BoardMenu board={boardOf()} api={api()} onSaveAs={vi.fn()} />)
    expect(itemNames(openLayout()).some(n => /Community|Share/.test(n))).toBe(false)
    first.unmount()
    render(<BoardMenu board={boardOf()} api={api()} onSaveAs={vi.fn()} onCommunity={onCommunity} onShare={onShare} />)
    const names = itemNames(openLayout())
    expect(names.slice(names.indexOf('Save layout as…') + 1, names.indexOf('One line ✓ (current)'))).toEqual(['Community layouts…', 'Share this layout…'])
    fireEvent.click(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: 'Community layouts…' }))
    fireEvent.click(within(openLayout()).getByRole('menuitem', { name: 'Share this layout…' }))
    expect([onCommunity.mock.calls.length, onShare.mock.calls.length]).toEqual([1, 1])
  })
  test('an admin with layouts to review sees the count on the Community entry; with none, nothing is added', () => {
    const first = render(<BoardMenu board={boardOf()} api={api()} onSaveAs={vi.fn()} onCommunity={vi.fn()} onShare={vi.fn()} reviewCount={3} />)
    expect(itemNames(openLayout())).toContain('Community layouts…3 to review')
    // and on the Layout button itself, so a waiting layout is not missed with the menu shut
    expect(screen.getByTestId('board-review-count')).toHaveTextContent('3')
    expect(screen.getByTestId('board-review-count')).toHaveAttribute('title', '3 shared layouts to review')
    expect(screen.getByRole('button', { name: 'Layout' })).toContainElement(screen.getByTestId('board-review-count'))
    first.unmount()
    render(<BoardMenu board={boardOf()} api={api()} onSaveAs={vi.fn()} onCommunity={vi.fn()} onShare={vi.fn()} />)
    expect(itemNames(openLayout())).toContain('Community layouts…')
    expect(screen.queryByTestId('board-review-count')).toBeNull()
  })
  test('each item calls the board with what it names', () => {
    const a = api()
    const onSaveAs = vi.fn()
    const { rerender } = render(<BoardMenu board={boardOf()} api={a} onSaveAs={onSaveAs} />)
    const pick = name => { fireEvent.click(within(openLayout()).getByRole('menuitem', { name })); rerender(<BoardMenu board={boardOf()} api={a} onSaveAs={onSaveAs} />) }
    pick('Three columns'); expect(a.pickLayout).toHaveBeenLastCalledWith('three')
    pick('Customize layout'); expect(a.setEdit).toHaveBeenLastCalledWith(true)
    pick('Save layout as…'); expect(onSaveAs).toHaveBeenCalledTimes(1)
    pick('Cards'); expect(a.setRows).toHaveBeenLastCalledWith('cards')
    pick(/Pinned screens as tabs/); expect(a.setOption).toHaveBeenLastCalledWith('screens', 'menu')
    pick(/Group by setup/); expect(a.setOption).toHaveBeenLastCalledWith('group', true)
  })
  test('a layout of your own: listed, ticked, and offers Save changes and Delete only for itself', () => {
    const a = api()
    const mine = { ...saveMine(setRows(sanitize(null), 'compact'), 'My swing board', 'm-a') }
    const { rerender } = render(<BoardMenu board={{ ...mine, edit: false }} api={a} onSaveAs={vi.fn()} />)
    let names = itemNames(openLayout())
    expect(names.slice(0, 4)).toEqual(['Board', 'Three columns', 'List first', 'My swing board ✓ (current)'])
    expect(names).toContain('Delete “My swing board”')
    expect(names.some(n => n.startsWith('Save changes'))).toBe(false) // nothing changed yet
    fireEvent.click(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: 'Delete “My swing board”' }))
    expect(a.deleteMine).toHaveBeenCalledWith('m-a')
    rerender(<BoardMenu board={{ ...mine, changed: true, edit: true }} api={a} onSaveAs={vi.fn()} />)
    names = itemNames(openLayout())
    expect(names).toContain('My swing board ✓ (current)changed')
    expect(names).toContain('Done customizing')
    fireEvent.click(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: 'Save changes to “My swing board”' }))
    expect(a.updateMine).toHaveBeenCalledWith('m-a')
  })
  test('with no Results widget on the board there are no row styles to choose', () => {
    const b = boardOf({ widgets: [{ id: 'chart', type: 'chart', x: 0, y: 0, w: 24, h: 20 }] })
    render(<BoardMenu board={b} api={api()} onSaveAs={vi.fn()} />)
    expect(itemNames(openLayout())).not.toContain('Compact')
  })
})

describe('the Customize line', () => {
  test('Add widget offers only what is not on the board; Undo shows only after a change; Done leaves', () => {
    const a = api()
    const { rerender } = render(<BoardEditBar board={boardOf({ edit: true })} api={a} />)
    expect(screen.getByRole('region', { name: 'Customize layout' })).toHaveTextContent('Customizing layout')
    expect(screen.queryByRole('button', { name: 'Undo changes' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add widget' }))
    const add = screen.getByRole('menu', { name: 'Add widget' })
    expect(within(add).getAllByRole('menuitem').map(el => el.textContent)).toEqual([
      `${WIDGETS.news.name}${WIDGETS.news.blurb}`, `${WIDGETS.screens.name}${WIDGETS.screens.blurb}`])
    fireEvent.click(within(add).getByRole('menuitem', { name: /Screens/ }))
    expect(a.addWidget).toHaveBeenCalledWith('screens')
    rerender(<BoardEditBar board={boardOf({ edit: true, changed: true })} api={a} />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }))
    expect(a.pickLayout).toHaveBeenCalledWith('board')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(a.setEdit).toHaveBeenCalledWith(false)
  })
  test('with every widget on the board, Add widget is shut and says why', () => {
    const full = boardOf({ edit: true, ...addWidget(addWidget(sanitize(null), 'news'), 'screens') })
    expect(full.widgets).toHaveLength(5)
    render(<BoardEditBar board={full} api={api()} />)
    const btn = screen.getByRole('button', { name: 'Add widget' })
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    expect(btn).toHaveAttribute('title', 'Every widget is on the board')
    fireEvent.click(btn)
    expect(screen.queryByRole('menu', { name: 'Add widget' })).toBeNull()
  })
})

describe('the grid', () => {
  let heightSpy
  beforeEach(() => { heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600) })
  afterEach(() => { heightSpy.mockRestore() })
  const draw = (board, a = api(), extra = {}) => render(
    <ScanBoard board={board} api={a} renderWidget={w => <div data-testid={`body-${w.type}`} />} loadRepack={() => new Promise(() => {})} {...extra} />)

  test('locked: every widget of the layout is drawn, with nothing to drag or remove', () => {
    draw(boardOf())
    expect(PRESETS[0].widgets.map(w => !!screen.getByTestId(`body-${w.type}`))).toEqual([true, true, true])
    expect(screen.getByTestId('scan-board')).not.toHaveAttribute('data-edit')
    expect(screen.queryByText(/arrow keys to move/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull()
  })
  test('Customize: each widget gets its bar and a Remove; the last widget has no Remove', () => {
    const a = api()
    const { unmount } = draw(boardOf({ edit: true }), a)
    expect(screen.getByTestId('scan-board')).toHaveAttribute('data-edit', '')
    expect(screen.getAllByText(/arrow keys to move/)).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: "Remove Why it's here" }))
    expect(a.removeWidget).toHaveBeenCalledWith('details')
    unmount()
    draw(boardOf({ edit: true, widgets: [{ id: 'chart', type: 'chart', x: 0, y: 0, w: 24, h: 20 }] }))
    expect(screen.getAllByText(/arrow keys to move/)).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull()
  })
  test('the rows fill the height exactly: no gap under the last row', () => {
    for (const h of [600, 733, 1040]) expect(rowHeightFor(h) * ROWS + GAP * (ROWS - 1)).toBeCloseTo(h, 6)
    expect(rowHeightFor(0)).toBe(20)
  })
  test('a drop: nothing moved, accepted, or refused (the board then stays as it was)', () => {
    const base = sanitize(null).widgets
    const item = { i: 'details', x: 0, y: 12, w: 7, h: 8 }
    const still = ws => ws.map(w => ({ ...w }))
    expect(settleDrop(base, item, still, () => { throw new Error('not asked') })).toBe('same')
    const moved = ws => ws.map(w => (w.id === 'details' ? { ...w, x: 0 } : w.id === 'results' ? { ...w, x: 0 } : { ...w, x: 7 }))
    const seen = []
    expect(settleDrop(base, item, (ws, id, rect, cols, rows) => { seen.push([id, rect, cols, rows]); return moved(ws) }, ws => acceptArrangement(sanitize(null), ws) !== sanitize(null) && true)).toBe('accepted')
    expect(seen).toEqual([['details', { x: 0, y: 12, w: 7, h: 8 }, 24, 20]])
    const squeezed = ws => ws.map(w => (w.id === 'details' ? { ...w, w: 2 } : w))
    const state = sanitize(null)
    expect(settleDrop(base, item, squeezed, ws => acceptArrangement(state, ws) !== state)).toBe('refused')
  })
})

describe('screens as tabs', () => {
  const starters = [
    { id: 's1', name: 'Leaders', group: 'Momentum leaders', spec: { filters: [{ key: 'a' }] } },
    { id: 's2', name: 'New highs', group: 'Breakouts & entries', spec: { filters: [] } },
    { id: 's3', name: 'Tight bases', group: 'Bases & chart patterns', spec: { filters: [] } },
    { id: 's4', name: 'Pullbacks', group: 'Momentum leaders', spec: { filters: [] } },
    { id: 's5', name: 'Gaps', group: 'Earnings', spec: { filters: [] } },
    { id: 's6', name: 'Hidden one', group: 'Momentum leaders', hidden: true, spec: { filters: [] } },
  ]
  const saved = [{ id: 9, name: 'Semis on watch', spec: { filters: [{ key: 'b' }] } }]
  const tabs = () => screen.getAllByRole('tab').map(t => [t.textContent, t.getAttribute('aria-selected')])

  test('the pinned screens are the tabs, the open one selected with its count; a click opens that screen', () => {
    const onApply = vi.fn()
    render(<ScreenTabs starters={starters} saved={saved} pinned={['s2', '9', 's1']} currentId="9" currentName="Semis on watch" count={1204} onApply={onApply} />)
    expect(tabs()).toEqual([['New highs', 'false'], ['Semis on watch1,204', 'true'], ['Leaders', 'false']])
    fireEvent.click(screen.getByRole('tab', { name: 'Leaders' }))
    expect(onApply).toHaveBeenCalledWith({ filters: [{ key: 'a' }] }, expect.objectContaining({ id: 's1', kind: 'starter' }))
    fireEvent.click(screen.getByRole('tab', { name: /Semis on watch/ }))
    expect(onApply).toHaveBeenCalledTimes(1) // the open tab does not re-run its screen
  })
  test('an open screen that is not pinned still gets a tab (first), and the row never grows past four', () => {
    render(<ScreenTabs starters={starters} saved={saved} pinned={['s1', 's2', 's3', 's4', 's5']} currentId="s5x" currentName="Custom screen" isEdited count={7} onApply={vi.fn()} />)
    expect(tabs()).toEqual([['Custom screen (edited)7', 'true'], ['Leaders', 'false'], ['New highs', 'false'], ['Tight bases', 'false']])
  })
  test('with nothing pinned the first starters stand in (never a hidden one)', () => {
    render(<ScreenTabs starters={[starters[5], ...starters.slice(0, 5)]} saved={[]} pinned={[]} currentId="s1" currentName="Leaders" onApply={vi.fn()} />)
    expect(tabs().map(t => t[0])).toEqual(['Leaders', 'New highs', 'Tight bases', 'Pullbacks'])
  })
  test('the Screens widget lists every screen by group, pinned first and once, the open one marked', () => {
    const onApply = vi.fn()
    render(<ScreenSidebar starters={starters} saved={saved} pinned={['s3']} currentId="s2" onApply={onApply} />)
    const nav = screen.getByRole('navigation', { name: 'Screens' })
    expect(within(nav).getAllByRole('heading').map(h => h.textContent)).toEqual(['Pinned', 'Momentum leaders', 'Breakouts & entries', 'Earnings', 'My screens'])
    expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(['Tight bases', 'Leaders', 'Pullbacks', 'New highs', 'Gaps', 'Semis on watch'])
    expect(within(nav).getByRole('button', { name: 'New highs' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(nav).getByRole('button', { name: 'Semis on watch' }))
    expect(onApply).toHaveBeenCalledWith({ filters: [{ key: 'b' }] }, expect.objectContaining({ id: 9, kind: 'saved' }))
  })
})

describe('the Results widget', () => {
  const ROWS_ = [
    { ticker: 'MU', company: 'Micron', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', rs_rank: 94, rs_rating_session: 94, industry: 'Semiconductors' },
    { ticker: 'ECO', company: 'Okeanis', price: 99.48, chg_pct_1d: 0.9, base_render: 'Gap-up', rs_rank: 71, rs_rating_session: 71, industry: 'Shipping' },
    { ticker: 'DAWN', company: 'Day One', price: 12.5, chg_pct_1d: 0, base_render: 'Flat Base', rs_rank: 80, rs_rating_session: 80 },
  ]
  const opts = (patch = {}) => ({ rows: 'line', logos: false, spark: false, group: false, seen: false, hints: false, roomy: false, ...patch })
  const list = (board, extra = {}) => (
    <ResultList rows={ROWS_} index={0} onSelect={() => {}} onKeyDown={() => {}} sortLabel="RS Rank" total={214} hasMore={false} onLoadMore={() => {}} isLoading={false}
      board={board} title="UCT RS Leaders" headBelow={<div data-testid="why-not" />} {...extra} />)

  test('it is a titled card: the screen, the count, the sort; the place and "why not" sit in the foot', () => {
    const { container } = render(list(opts()))
    const wrap = container.firstChild
    expect(wrap).toHaveAttribute('data-board-rows', 'line')
    expect(wrap.firstChild).toHaveTextContent('UCT RS Leaders214 stocksSort: RS Rank')
    expect(wrap.lastChild).toHaveTextContent('1 of 214')
    expect(wrap.lastChild).toContainElement(screen.getByTestId('why-not'))
    expect(screen.queryByText('move')).toBeNull() // keyboard hints are a switch, off by default
  })
  test('one line: a column header and one line per stock, with no logo and no mini chart until switched on', () => {
    const { container, rerender } = render(list(opts()))
    const header = () => [...container.querySelectorAll('[aria-hidden="true"]')].map(e => e.textContent).find(t => t.startsWith('Symbol'))
    expect(header()).toBe('SymbolSetupRS% ChgPrice')
    const row = screen.getByTestId('focus-row-MU')
    expect(row).toHaveAttribute('role', 'option')
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(row.textContent).toMatch(/^MU.*94.*3\.7%.*956\.12$/)
    expect(row.querySelector('svg')).toBeNull()
    expect(screen.queryByTestId('logo-MU')).toBeNull()
    rerender(list(opts({ logos: true, spark: true, hints: true })))
    expect(screen.getByTestId('logo-MU')).toBeInTheDocument()
    expect(screen.getByTestId('focus-row-MU').querySelector('svg')).not.toBeNull()
    expect(screen.getByText('move')).toBeInTheDocument()
  })
  test('compact is a watchlist row: symbol, change, price, and no setup column', () => {
    const { container } = render(list(opts({ rows: 'compact' })))
    expect([...container.querySelectorAll('[aria-hidden="true"]')].map(e => e.textContent).find(t => t.startsWith('Symbol'))).toBe('Symbol% ChgPrice')
    expect(screen.getByTestId('focus-row-ECO').textContent).toMatch(/^ECO\+0\.9%99\.48$/)
  })
  test('two lines is the list as it always was, inside the card', () => {
    const { container } = render(list(opts({ rows: 'two' })))
    expect(container.firstChild).toHaveAttribute('data-board-rows', 'two')
    expect([...container.querySelectorAll('[aria-hidden="true"]')].some(e => e.textContent.startsWith('Symbol'))).toBe(false)
    expect(screen.getByTestId('focus-row-MU').querySelector('[title="Last 3 months, daily closes"]')).not.toBeNull() // the classic row's own cell
  })
  test('chips lay the stocks in a strip, and left / right step it as up / down do', () => {
    const onKeyDown = vi.fn()
    render(list(opts({ rows: 'chips' }), { onKeyDown }))
    const box = screen.getByRole('listbox', { name: 'Screen results' })
    expect(box).toHaveAttribute('data-dir', 'x')
    expect(screen.getByTestId('focus-row-MU').textContent).toMatch(/^MU.3\.7%$/)
    fireEvent.keyDown(box, { key: 'ArrowRight' })
    fireEvent.keyDown(box, { key: 'ArrowLeft' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onKeyDown.mock.calls.map(c => c[0].key)).toEqual(['ArrowDown', 'ArrowUp', 'Enter'])
  })
  test('group by setup puts a heading with its count over each run of the same setup', () => {
    const { container } = render(list(opts({ group: true })))
    const heads = [...container.querySelectorAll('[role="presentation"]')].map(e => e.textContent)
    // MU and DAWN share a setup, ECO has another: three runs here (the page itself orders the rows
    // by setup, so a member sees two), each heading carrying how many stocks hold that setup
    expect(heads).toHaveLength(3)
    expect(heads[0]).toBe(heads[2])
    expect(heads[0]).toMatch(/2$/)
    expect(heads[1]).toMatch(/1$/)
    expect(heads[1]).not.toBe(heads[0])
  })
  test('dim what I have looked at: a stock dims once the selection has been on it and moved on', () => {
    const { rerender } = render(list(opts({ seen: true })))
    expect(screen.getByTestId('focus-row-MU')).not.toHaveAttribute('data-seen')
    rerender(list(opts({ seen: true }), { index: 1 }))
    expect(screen.getByTestId('focus-row-MU')).toHaveAttribute('data-seen', '')
    expect(screen.getByTestId('focus-row-ECO')).not.toHaveAttribute('data-seen') // the selected stock is never dimmed
    expect(screen.getByTestId('focus-row-DAWN')).not.toHaveAttribute('data-seen')
    rerender(list(opts({ seen: false }), { index: 1 }))
    expect(screen.getByTestId('focus-row-MU')).not.toHaveAttribute('data-seen')
  })
})

describe('the details card', () => {
  const row = { ticker: 'MU', company: 'Micron', industry: 'Semiconductors', price: 956.12, base_render: 'Flat Base' }
  const why = { items: [1, 2, 3, 4, 5, 6].map(n => ({ kind: n < 5 ? 'check' : 'note', label: `Rule ${n}`, value: n < 5 ? `v${n}` : undefined })), more: 3 }
  const card = (extra = {}) => <DetailsCard row={row} why={why} onOpenFilters={vi.fn()} onFlag={vi.fn()} onWatch={vi.fn()} isFlagged={false} structures={{}} {...extra} />

  test('names the stock, shows the first four rules and how many there are in all, and carries the two actions', () => {
    const onOpenFilters = vi.fn(), onFlag = vi.fn(), onWatch = vi.fn()
    render(card({ onOpenFilters, onFlag, onWatch }))
    const sec = screen.getByRole('region', { name: 'MU details' })
    expect(sec).toHaveTextContent('MU')
    expect(sec).toHaveTextContent('Micron · Semiconductors')
    expect(within(sec).getAllByRole('listitem').map(li => li.textContent)).toEqual(['✓Rule 1v1', '✓Rule 2v2', '✓Rule 3v3', '✓Rule 4v4', 'Show all 9 rules'])
    fireEvent.click(screen.getByRole('button', { name: 'Show all 9 rules' })); expect(onOpenFilters).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Flag' })); expect(onFlag).toHaveBeenCalledWith(row)
    fireEvent.click(screen.getByRole('button', { name: 'Add to watchlist' })); expect(onWatch).toHaveBeenCalledWith(row)
  })
  test('News is a second tab only when the board has no News widget of its own; its host stays mounted', () => {
    const { rerender } = render(card())
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(["Why it's here"])
    const hosts = []
    rerender(card({ news: true, setNewsEl: el => { if (el) hosts.push(el) } }))
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(["Why it's here", 'News'])
    expect(hosts).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: 'News' }))
    expect(screen.getByRole('tab', { name: 'News' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Flag' })).toBeNull()
    expect(hosts[0].isConnected).toBe(true)
  })
  test('with no stock picked it says so', () => {
    render(card({ row: null }))
    expect(screen.getByText('Pick a stock from the list')).toBeInTheDocument()
  })
})

describe('the board in UCT Signature', () => {
  const css = readFileSync(path.join(here, '..', 'Board.module.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
  test('gold marks only what is current or chosen, as a bar or an underline', () => {
    const ALLOWED = [/^\.rowSel$/, /^\.rowSel:hover$/, /^\.cardRow\.rowSel$/, /^\.chip\.rowSel$/, /^\.tabOn::after$/, /^\.sideItemOn$/, /^\.dTabOn::after$/]
    const found = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/--ut-gold/.test(m[2])) continue
      for (const sel of m[1].split(',').map(x => x.trim()).filter(Boolean)) found.push(sel)
    }
    expect(found.filter(f => !ALLOWED.some(re => re.test(f)))).toEqual([])
    expect(found).toEqual(expect.arrayContaining(['.rowSel', '.tabOn::after', '.sideItemOn', '.dTabOn::after']))
    expect(css).not.toMatch(/border(-color)?:[^;}]*--ut-gold/)
    expect(css).not.toMatch(/--ut-gold-dim/)
  })
  test('sentence case, and no colour of its own: every colour is a Signature value', () => {
    expect(css).not.toMatch(/text-transform:\s*uppercase/)
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([])
  })
})
