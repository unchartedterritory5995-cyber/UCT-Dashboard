// The Breadth "Columns" menu (owner 2026-11-19, design A simplified): the button names the
// template; UCT Core edits show "· edited" + one strip (Save as new / Revert), never a prompt;
// own templates have ⋯ → Rename / Duplicate / Delete with an inline confirm; search; families
// fold; Reset only when something differs; Esc closes an inline editor first, then the menu.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import ColumnsMenu from './ColumnsMenu'
import useBreadthCustomize, { STORAGE_KEY } from './useBreadthCustomize'

const COLS = [
  { key: 'breadth_score', label: 'Health', group: 'Score' },
  { key: 'uct_exposure', label: 'UCT Exp', group: 'Score' },
  { key: 'up_4pct_today', label: 'Up 4%+', group: 'Primary Breadth' },
  { key: 'down_4pct_today', label: 'Dn 4%+', group: 'Primary Breadth' },
  { key: 'ratio_5day', label: '5D Ratio', group: 'Primary Breadth' },
  { key: 'vix', label: 'VIX', group: 'Regime' },
]
const DEFAULTS = {
  hidden: ['vix', 'ratio_5day', 'uct_exposure'],
  order: ['breadth_score', 'uct_exposure', 'up_4pct_today', 'down_4pct_today', 'ratio_5day', 'vix'],
}

let api
function Harness({ columnTag }) {
  const customize = useBreadthCustomize({ defaults: DEFAULTS })
  api = customize
  return <ColumnsMenu cols={COLS} customize={customize} columnTag={columnTag} />
}

const button = () => screen.getByRole('button', { name: /Columns/ })
const menu = () => screen.getByTestId('breadth-columns-menu')
const openMenu = () => { fireEvent.pointerDown(button()); fireEvent.click(button()) }
const expand = (name) => {
  const h = within(menu()).getByRole('button', { name })
  if (h.getAttribute('aria-expanded') !== 'true') fireEvent.click(h)
}
const esc = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })

beforeEach(() => { localStorage.clear() })

describe('Breadth Columns menu', () => {
  it('the button names the template, and the menu lists UCT Core with the gold ✓ and a lock', () => {
    render(<Harness />)
    expect(button().textContent).toMatch(/Columns\s*UCT Core/)
    expect(button().textContent).not.toMatch(/Default/)
    openMenu()
    const core = within(menu()).getByRole('button', { name: /UCT Core, built-in/ })
    expect(core.getAttribute('aria-current')).toBe('true')
    expect(core.textContent).toContain('✓')
    expect(core.textContent).toMatch(/built-in/)
    expect(within(menu()).queryByRole('button', { name: /UCT Core actions/ })).toBeNull()
  })

  it('the family with most visible columns starts open; others fold; a header toggles; counts show', () => {
    render(<Harness />)
    openMenu()
    const primary = within(menu()).getByRole('button', { name: /Primary breadth/ })
    const score = within(menu()).getByRole('button', { name: /^Score/ })
    expect(primary.getAttribute('aria-expanded')).toBe('true')
    expect(primary.textContent).toContain('2/3')
    expect(score.getAttribute('aria-expanded')).toBe('false')
    expect(within(menu()).queryByRole('checkbox', { name: /Breadth health/ })).toBeNull()
    fireEvent.click(score)
    expect(within(menu()).getByRole('checkbox', { name: /Breadth health/ }).getAttribute('aria-checked')).toBe('true')
    expect(score.textContent).toContain('1/2')
    fireEvent.click(primary)
    expect(within(menu()).queryByRole('checkbox', { name: /Stocks up 4%\+ today/ })).toBeNull()
  })

  it('a toggle on UCT Core applies at once: "· edited", one strip, Revert restores it', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(within(menu()).getByRole('checkbox', { name: /5-day up\/down ratio/ }))
    expect(api.hidden.has('ratio_5day')).toBe(false)
    expect(button().textContent).toMatch(/UCT Core\s*· edited/)
    expect(screen.getByTestId('breadth-columns-edited')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /New template name/ })).toBeNull()  // no prompt
    fireEvent.click(within(menu()).getByRole('button', { name: 'Revert' }))
    expect(api.isEdited).toBe(false)
    expect(api.hidden.has('ratio_5day')).toBe(true)
    expect(screen.queryByTestId('breadth-columns-edited')).toBeNull()
  })

  it('Save as new… from the strip makes a template with the edited columns, active', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(within(menu()).getByRole('checkbox', { name: /5-day up\/down ratio/ }))
    fireEvent.click(within(menu()).getByRole('button', { name: /Save as new/ }))
    const field = screen.getByRole('textbox', { name: 'New template name' })
    fireEvent.change(field, { target: { value: 'UCT Core' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toMatch(/built-in/)
    fireEvent.change(field, { target: { value: 'Swing' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(api.activePreset).toBe('Swing')
    expect(api.hidden.has('ratio_5day')).toBe(false)
    expect(api.isEdited).toBe(false)
    expect(button().textContent).toMatch(/Swing/)
    expect(button().textContent).not.toMatch(/edited/)
  })

  it('"+ Save current as template…" is an inline field: Enter saves, Esc cancels (menu stays open)', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(within(menu()).getByRole('button', { name: /Save current as template/ }))
    let field = screen.getByRole('textbox', { name: 'New template name' })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'New template name' })).toBeNull()
    expect(screen.getByTestId('breadth-columns-menu')).toBeTruthy()
    fireEvent.click(within(menu()).getByRole('button', { name: /Save current as template/ }))
    field = screen.getByRole('textbox', { name: 'New template name' })
    fireEvent.change(field, { target: { value: 'Mine' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(api.presetNames).toEqual(['Default', 'Mine'])
    expect(api.activePreset).toBe('Mine')
  })

  it('own templates autosave and show no edited state', () => {
    render(<Harness />)
    act(() => api.savePreset('Mine'))
    openMenu()
    expand(/^Regime/)
    fireEvent.click(within(menu()).getByRole('checkbox', { name: /VIX/ }))
    expect(button().textContent).not.toMatch(/edited/)
    expect(screen.queryByTestId('breadth-columns-edited')).toBeNull()
    expect(api.presets.Mine.hidden.sort()).toEqual(['ratio_5day', 'uct_exposure'])
  })

  it('⋯ → Rename / Duplicate / Delete, and Delete confirms in the row (Keep / Delete)', () => {
    render(<Harness />)
    act(() => api.savePreset('Mine'))
    openMenu()
    const more = () => within(menu()).getByRole('button', { name: 'Mine actions' })
    // Rename
    fireEvent.click(more())
    expect(within(menu()).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Rename', 'Duplicate', 'Delete'])
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Rename' }))
    const f = screen.getByRole('textbox', { name: 'Rename Mine' })
    fireEvent.change(f, { target: { value: 'Swing' } })
    fireEvent.keyDown(f, { key: 'Enter' })
    expect(api.presetNames).toEqual(['Default', 'Swing'])
    // Duplicate
    fireEvent.click(within(menu()).getByRole('button', { name: 'Swing actions' }))
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Duplicate' }))
    expect(api.presetNames).toEqual(['Default', 'Swing', 'Swing copy'])
    expect(api.activePreset).toBe('Swing copy')
    // Delete → Keep
    fireEvent.click(within(menu()).getByRole('button', { name: 'Swing copy actions' }))
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Delete' }))
    const confirm = within(menu()).getByRole('group', { name: /Delete Swing copy\?/ })
    expect(confirm.textContent).toMatch(/Delete “Swing copy”\?/)
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep' }))
    expect(api.presetNames).toContain('Swing copy')
    // Delete → Delete
    fireEvent.click(within(menu()).getByRole('button', { name: 'Swing copy actions' }))
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(within(within(menu()).getByRole('group', { name: /Delete Swing copy\?/ })).getByRole('button', { name: 'Delete' }))
    expect(api.presetNames).toEqual(['Default', 'Swing'])
    expect(api.activePreset).toBe('Default')
  })

  it('search finds columns by name or short label across folded families', () => {
    render(<Harness />)
    openMenu()
    const find = screen.getByRole('textbox', { name: 'Find a column' })
    fireEvent.change(find, { target: { value: 'vix' } })
    // VIX itself, plus Health (its explanation names VIX as an input) — owner 2026-11-19 copy
    const hits = within(menu()).getAllByRole('checkbox').map(b => b.getAttribute('aria-label') || b.textContent)
    expect(hits.some(t => /VIX/.test(t))).toBe(true)
    expect(hits.length).toBeLessThanOrEqual(3)
    fireEvent.change(find, { target: { value: 'zzz' } })
    expect(menu().textContent).toMatch(/No column matches/)
  })

  it('Reset to UCT Core is enabled only when something differs', () => {
    render(<Harness />)
    openMenu()
    const reset = () => within(menu()).getByRole('button', { name: 'Reset to UCT Core' })
    expect(reset().disabled).toBe(true)
    fireEvent.click(within(menu()).getByRole('checkbox', { name: /Stocks down 4%\+ today/ }))
    expect(reset().disabled).toBe(false)
    fireEvent.click(reset())
    expect(api.isEdited).toBe(false)
    expect(reset().disabled).toBe(true)
  })

  it('the universe hook: a tag replaces the short label; `na` dims the row', () => {
    render(<Harness columnTag={(k) => (k === 'vix' ? 'Market-wide' : k === 'up_4pct_today' ? { label: 'n/a for Nasdaq', na: true } : null)} />)
    openMenu()
    const up = within(menu()).getByRole('checkbox', { name: /Stocks up 4%\+ today/ })
    expect(up.textContent).toContain('n/a for Nasdaq')
    expect(up.className).toMatch(/na/)
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a column' }), { target: { value: 'vix' } })
    expect(within(menu()).getByRole('checkbox', { name: /VIX/ }).textContent).toContain('Market-wide')
  })

  it('arrow keys walk the rows; Esc closes and the button keeps the name', () => {
    render(<Harness />)
    openMenu()
    const find = screen.getByRole('textbox', { name: 'Find a column' })
    find.focus()
    fireEvent.keyDown(find, { key: 'ArrowDown' })
    expect(document.activeElement.textContent).toMatch(/UCT Core/)
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement.textContent).toMatch(/Save current as template/)
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(find)
    esc()
    expect(screen.queryByTestId('breadth-columns-menu')).toBeNull()
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })

  it('never writes the built-in: storage holds a draft, not a "Default" preset', () => {
    const { unmount } = render(<Harness />)
    openMenu()
    expand(/^Regime/)
    fireEvent.click(within(menu()).getByRole('checkbox', { name: /VIX/ }))
    unmount()
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(s.presets.Default).toBeUndefined()
    expect(s.activePreset).toBe('Default')
    expect(s.draft.hidden.sort()).toEqual(['ratio_5day', 'uct_exposure'])
  })
})
