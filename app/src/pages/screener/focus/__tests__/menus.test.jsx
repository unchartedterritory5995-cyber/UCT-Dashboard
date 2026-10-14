import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
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
test('outside mousedown closes, inside mousedown does not', () => {
  render(<div><button type="button">elsewhere</button><Menu label="Things" trigger="Things"><MenuItem onSelect={() => {}}>One</MenuItem></Menu></div>)
  fireEvent.click(screen.getByRole('button', { name: 'Things' }))
  fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'One' }))
  expect(screen.getByRole('menu')).toBeInTheDocument()
  fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }))
  expect(screen.queryByRole('menu')).toBeNull()
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
  expect(screen.getByRole('dialog', { name: 'About this data' })).toHaveTextContent('11,230')
})
