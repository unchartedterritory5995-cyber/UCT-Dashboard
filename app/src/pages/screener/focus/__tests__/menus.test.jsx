import { render, screen, fireEvent } from '@testing-library/react'
import { vi, expect, test } from 'vitest'
import Menu, { MenuItem } from '../Menu'
import SaveMenu from '../SaveMenu'
import MoreMenu from '../MoreMenu'
import HelpMenu from '../HelpMenu'
import DataReceipt, { coverageHasDrop } from '../DataReceipt'

test('menu opens, selects, closes and returns focus', () => {
  const onSelect = vi.fn()
  render(<Menu label="Things" trigger="Things"><MenuItem onSelect={onSelect}>One</MenuItem></Menu>)
  const btn = screen.getByRole('button', { name: 'Things' })
  fireEvent.click(btn)
  expect(btn).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(screen.getByRole('menuitem', { name: 'One' }))
  expect(onSelect).toHaveBeenCalled()
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(btn)
})
test('escape closes', () => {
  render(<Menu label="Things" trigger="Things"><MenuItem onSelect={() => {}}>One</MenuItem></Menu>)
  fireEvent.click(screen.getByRole('button', { name: 'Things' }))
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})
test('outside pointerdown closes (without stealing focus), inside pointerdown does not', () => {
  render(<div><button type="button">elsewhere</button><Menu label="Things" trigger="Things"><MenuItem onSelect={() => {}}>One</MenuItem></Menu></div>)
  fireEvent.click(screen.getByRole('button', { name: 'Things' }))
  fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'One' }))
  expect(screen.getByRole('menu')).toBeInTheDocument()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }))
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Things' }))
})
test('arrow keys move between items', () => {
  render(<Menu label="Things" trigger="Things"><MenuItem>One</MenuItem><MenuItem>Two</MenuItem></Menu>)
  fireEvent.click(screen.getByRole('button', { name: 'Things' }))
  const [one, two] = screen.getAllByRole('menuitem')
  expect(document.activeElement).toBe(one)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(two)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
  expect(document.activeElement).toBe(one)
})
test('save menu omits switched-off outcomes', () => {
  render(<SaveMenu canSaveScreen canFrozenList={false} canAlert={false} canNotebook
    onSaveScreen={vi.fn()} onFrozenList={vi.fn()} onAlert={vi.fn()} onNotebook={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByRole('menuitem', { name: /Save as a screen/ })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: /Add to Notebook/ })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: /today/ })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: /Alert me/ })).toBeNull()
})
test('save menu with nothing available renders nothing', () => {
  const { container } = render(<SaveMenu canSaveScreen={false} canFrozenList={false} canAlert={false} canNotebook={false} />)
  expect(container).toBeEmptyDOMElement()
})
test('more menu hides Excel when server export is off', () => {
  render(<MoreMenu onExportCsv={vi.fn()} onExportXlsx={null} liveSortEligible={false} density="compact" onDensity={vi.fn()} showCompany onToggleCompany={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  expect(screen.getByRole('menuitem', { name: /Export CSV/ })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: /Excel/ })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: /Re-sort/ })).toBeNull()
})
test('help menu lists reading, not actions', () => {
  const onMethodology = vi.fn()
  render(<HelpMenu onHowTo={null} onMethodology={onMethodology} onLibrary={vi.fn()} onGlossary={vi.fn()} onShortcuts={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Methodology' }))
  expect(onMethodology).toHaveBeenCalled()
})
test('coverage drop detection', () => {
  expect(coverageHasDrop(null)).toBe(false)
  expect(coverageHasDrop({ evaluated: 10, answered: 10, dropped: 0, not_computable: 0 })).toBe(false)
  expect(coverageHasDrop({ evaluated: 10, answered: 8, dropped: 2, not_computable: 0 })).toBe(true)
  expect(coverageHasDrop({ evaluated: 10, answered: 9, dropped: 0, not_computable: 1 })).toBe(true)
})
test('data receipt shows the date and counts', () => {
  render(<DataReceipt snapshotDate="2026-10-12" live coverage={{ evaluated: 11230, answered: 11230, dropped: 0, not_computable: 0 }} />)
  const btn = screen.getByRole('button', { name: /Oct 12 close/ })
  fireEvent.click(btn)
  expect(screen.getByRole('region', { name: 'About this data' })).toHaveTextContent('11,230')
})

test('tab-out closes the menu; opening menu B afterwards leaves only B open', () => {
  render(<div>
    <Menu label="A" trigger="A"><MenuItem>a1</MenuItem><MenuItem>a2</MenuItem></Menu>
    <Menu label="B" trigger="B"><MenuItem>b1</MenuItem></Menu>
  </div>)
  const bBtn = screen.getByRole('button', { name: 'B' })
  fireEvent.click(screen.getByRole('button', { name: 'A' }))
  const [a1, a2] = screen.getAllByRole('menuitem')
  expect(a1).toHaveAttribute('tabindex', '0')
  expect(a2).toHaveAttribute('tabindex', '-1')
  fireEvent.focusOut(a1, { relatedTarget: bBtn })
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(bBtn)
  expect(screen.getAllByRole('menu')).toHaveLength(1)
  expect(screen.getByRole('menu', { name: 'B' })).toBeInTheDocument()
})
test('focus moving between items inside the menu does not close it', () => {
  render(<Menu label="Things" trigger="Things"><MenuItem>One</MenuItem><MenuItem>Two</MenuItem></Menu>)
  fireEvent.click(screen.getByRole('button', { name: 'Things' }))
  const [one, two] = screen.getAllByRole('menuitem')
  fireEvent.focusOut(one, { relatedTarget: two })
  expect(screen.getByRole('menu')).toBeInTheDocument()
})
test('home and end jump to first and last item', () => {
  render(<Menu label="Things" trigger="Things"><MenuItem>One</MenuItem><MenuItem>Two</MenuItem><MenuItem>Three</MenuItem></Menu>)
  fireEvent.click(screen.getByRole('button', { name: 'Things' }))
  const [one, , three] = screen.getAllByRole('menuitem')
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' })
  expect(document.activeElement).toBe(three)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' })
  expect(document.activeElement).toBe(one)
})
test('escape does not bubble out of an open menu', () => {
  const outer = vi.fn()
  render(<div onKeyDown={outer}><Menu label="Things" trigger="Things"><MenuItem>One</MenuItem></Menu></div>)
  fireEvent.click(screen.getByRole('button', { name: 'Things' }))
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(outer).not.toHaveBeenCalled()
})
test('help menu renders only items with a handler', () => {
  render(<HelpMenu onMethodology={vi.fn()} onShortcuts={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  expect(screen.queryByRole('menuitem', { name: 'Structure library' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: /What each filter/ })).toBeNull()
  expect(screen.getByRole('menuitem', { name: 'Methodology' })).toBeInTheDocument()
})
test('receipt is a disclosure: escape closes from trigger and from inside, focus returns', () => {
  render(<DataReceipt snapshotDate="2026-10-12" coverage={{ evaluated: 5, answered: 5, dropped: 0, not_computable: 0 }} />)
  const btn = screen.getByRole('button', { name: /Oct 12 close/ })
  expect(btn).not.toHaveAttribute('aria-controls')
  fireEvent.click(btn)
  const region = screen.getByRole('region', { name: 'About this data' })
  expect(btn).toHaveAttribute('aria-controls', region.id)
  fireEvent.keyDown(btn, { key: 'Escape' })
  expect(screen.queryByRole('region')).toBeNull()
  expect(document.activeElement).toBe(btn)
  fireEvent.click(btn)
  fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' })
  expect(screen.queryByRole('region')).toBeNull()
})
test('receipt closes on outside pointerdown', () => {
  render(<div><span>out</span><DataReceipt snapshotDate="2026-10-12" /></div>)
  fireEvent.click(screen.getByRole('button', { name: /Oct 12 close/ }))
  fireEvent.pointerDown(screen.getByText('out'))
  expect(screen.queryByRole('region')).toBeNull()
})
test('receipt date handling: time component, bad input, missing', () => {
  const { unmount } = render(<DataReceipt snapshotDate="2026-10-12T20:00:00Z" />)
  expect(screen.getByRole('button', { name: /Oct 12 close/ })).toBeInTheDocument()
  unmount()
  render(<DataReceipt snapshotDate="garbage" />)
  const btn = screen.getByRole('button', { name: /latest close/ })
  fireEvent.click(btn)
  expect(screen.getByRole('region')).toHaveTextContent('Nightly data from the latest close.')
})
