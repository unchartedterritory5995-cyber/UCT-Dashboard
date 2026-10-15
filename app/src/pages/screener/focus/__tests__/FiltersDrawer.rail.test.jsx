// The drawer over the REAL FilterRail + FilterControl: owner decision 2's calm drawer.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'
vi.mock('../../shell/CriteriaBox', () => ({ default: () => <div data-testid="criteria" /> }))
vi.mock('../useDescribe', () => ({ default: () => ({ available: false, busy: false, error: null, run: vi.fn() }) }))
import FiltersDrawer from '../FiltersDrawer'
import { COMMON_FILTERS, BUTTONS_MAX, isLongEnum } from '../drawerFilters'
import own from '../FiltersDrawer.module.css'
import styles from '../FocusScreener.module.css'

const enumOf = (key, label, category, n) => ({ key, label, category, type: 'enum', allow_custom: false,
  presets: [{ label: 'Any' }, ...Array.from({ length: n }, (_, i) => ({ label: `${label} ${i + 1}`, op: 'eq', value: `${label} ${i + 1}` }))] })
const range = (key, label, category) => ({ key, label, category, type: 'range', allow_custom: true,
  presets: [{ label: 'Any' }, { label: 'Over 10', op: 'gte', min: 10 }] })

// Keys as the screener meta sends them (api/services/screener/filters.py).
const META = {
  categories: [{ key: 'descriptive', label: 'Descriptive' }, { key: 'technical', label: 'Technical' },
    { key: 'momentum', label: 'Momentum' }, { key: 'context', label: 'Context' }],
  filters: [
    range('price', 'Price', 'descriptive'), range('market_cap', 'Market Cap', 'descriptive'),
    range('avg_volume_30d', 'Avg Volume (30d)', 'descriptive'),
    enumOf('sector', 'Sector', 'descriptive', 11),
    enumOf('industry', 'Industry', 'descriptive', 150),
    range('rs_rank', 'RS Rank', 'technical'), range('atr_pct', 'ATR % of Price', 'technical'),
    range('pole_pct', 'Prior Run', 'momentum'),
    enumOf('theme', 'UCT Theme', 'context', BUTTONS_MAX),
  ],
}
const base = { open: true, onClose: vi.fn(), meta: META, logic: null, onSetFilter: vi.fn(), onClear: vi.fn(), onSetLogic: vi.fn(),
  count: 214, countLoading: false, lists: [] }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })

const groupHead = name => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const groupOf = name => groupHead(name).closest('section')

test('Common comes first and holds Price, Market cap, RS Rank, Avg volume, Sector in that order', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  const sections = screen.getByTestId('filter-rail').querySelectorAll('section')
  expect(sections[0]).toBe(groupOf('Common'))
  const keys = [...groupOf('Common').querySelectorAll('[data-filter-key]')].map(n => n.dataset.filterKey)
  expect(keys).toEqual(COMMON_FILTERS)
})

test('every other category starts collapsed, and no filter renders twice', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  expect(groupHead('Common')).toHaveAttribute('aria-expanded', 'true')
  for (const name of ['Descriptive', 'Technical', 'Momentum', 'Context']) {
    expect(groupHead(name)).toHaveAttribute('aria-expanded', 'false')
  }
  expect(screen.queryByText('ATR % of Price')).toBeNull()
  fireEvent.click(groupHead('Descriptive'))
  const desc = [...groupOf('Descriptive').querySelectorAll('[data-filter-key]')].map(n => n.dataset.filterKey)
  expect(desc).toEqual(['industry'])          // price/market cap/avg volume/sector live in Common only
})

test('a category holding an active filter starts open', () => {
  render(<FiltersDrawer {...base} filters={{ atr_pct: { op: 'gte', min: 10 } }} />)
  expect(groupHead('Technical')).toHaveAttribute('aria-expanded', 'true')
  expect(groupHead('Momentum')).toHaveAttribute('aria-expanded', 'false')
  expect(groupHead('Technical')).toHaveTextContent('1')
})

test('an opened category is remembered for this viewer, apart from the desktop rail', () => {
  const { unmount } = render(<FiltersDrawer {...base} filters={{}} />)
  fireEvent.click(groupHead('Momentum'))
  unmount()
  render(<FiltersDrawer {...base} filters={{}} />)
  expect(groupHead('Momentum')).toHaveAttribute('aria-expanded', 'true')
  expect(localStorage.getItem('uct.screener.drawer.momentum')).toBe('1')
  expect(localStorage.getItem('uct.screener.rail.momentum')).toBeNull()
})

test('one match count: the footer button; no Clear 1 in the rail', () => {
  render(<FiltersDrawer {...base} filters={{ price: { op: 'gte', min: 10 } }} />)
  // Visible once (the button), plus the one visually hidden status that speaks it.
  expect(screen.getAllByText(/214/).map(n => n.textContent)).toEqual(['Show 214 stocks', '214 matches'])
  expect(screen.getByRole('button', { name: 'Show 214 stocks' })).not.toHaveAttribute('aria-live')
  expect(screen.getByText('214 matches')).toHaveClass('sr-only')
  expect(screen.getByText('214 matches')).toHaveAttribute('role', 'status')
  expect(screen.queryByRole('button', { name: /^Clear 1$/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument()
})

test('an unknown count never reads as a number', () => {
  render(<FiltersDrawer {...base} count={null} filters={{}} />)
  expect(screen.getByRole('button', { name: 'Show stocks' })).toBeInTheDocument()
  expect(screen.queryByText(/Show 0/)).toBeNull()
})
test('the hidden status speaks only a settled count', () => {
  const { rerender, container } = render(<FiltersDrawer {...base} countLoading filters={{}} />)
  const status = () => container.querySelector('footer [role="status"]')
  expect(status()).toHaveTextContent(/^$/)
  rerender(<FiltersDrawer {...base} count={null} filters={{}} />)
  expect(status()).toHaveTextContent(/^$/)
  rerender(<FiltersDrawer {...base} count={1240} filters={{}} />)
  expect(status()).toHaveTextContent('1,240 matches')
})
test('the narrowing box comes first, controls the select, and announces "N of M" politely', () => {
  render(<FiltersDrawer {...base} filters={{ industry: { op: 'eq', value: 'Industry 3' } }} />)
  const industry = groupOf('Descriptive').querySelector('[data-filter-key="industry"]')
  const box = within(industry).getByLabelText('Narrow Industry choices')
  const select = within(industry).getByRole('combobox', { name: 'Industry' })
  expect(box.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(box).toHaveAttribute('aria-controls', select.id)
  const hint = industry.querySelector('[aria-live="polite"]')
  expect(hint).toHaveTextContent(/^$/)
  fireEvent.change(box, { target: { value: 'industry 14' } })
  expect(hint).toHaveTextContent('2 of 150')         // Industry 14, plus the chosen Industry 3
})
test('narrowing keeps every chosen value of an `in` filter', () => {
  render(<FiltersDrawer {...base} filters={{ industry: { op: 'in', value: ['Industry 5', 'Industry 9'] } }} />)
  const industry = groupOf('Descriptive').querySelector('[data-filter-key="industry"]')
  fireEvent.change(within(industry).getByLabelText('Narrow Industry choices'), { target: { value: 'industry 150' } })
  const labels = [...within(industry).getByRole('combobox').querySelectorAll('option')].map(o => o.textContent)
  expect(labels.filter(l => l !== 'Custom…')).toEqual(['Any', 'Industry 5', 'Industry 9', 'Industry 150'])
})

test('Edit as code is a muted link, not a primary button', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  const summary = screen.getByText('Edit as code')
  expect(summary).toHaveClass(own.codeLink)
  expect(summary).not.toHaveClass(styles.btnPrimary)
})

test('an enum with more than 12 choices is a select with a narrowing box; 12 or fewer stay buttons', () => {
  expect(isLongEnum(META.filters.find(f => f.key === 'industry'))).toBe(true)
  expect(isLongEnum(META.filters.find(f => f.key === 'theme'))).toBe(false)
  render(<FiltersDrawer {...base} filters={{}} />)
  fireEvent.click(groupHead('Descriptive'))
  fireEvent.click(groupHead('Context'))
  const industry = groupOf('Descriptive').querySelector('[data-filter-key="industry"]')
  expect(within(industry).getByRole('combobox', { name: 'Industry' })).toBeInTheDocument()
  expect(within(industry).queryAllByRole('button', { pressed: false })).toHaveLength(0)
  const theme = groupOf('Context').querySelector('[data-filter-key="theme"]')
  expect(within(theme).queryByRole('combobox')).toBeNull()
  expect(within(theme).getAllByRole('button')).toHaveLength(BUTTONS_MAX + 1)  // Any + 12
  // Sector (11) stays buttons inside Common.
  const sector = groupOf('Common').querySelector('[data-filter-key="sector"]')
  expect(within(sector).queryByRole('combobox')).toBeNull()
})

test('the narrowing box filters the select, keeps the chosen value, and picking sets the filter', () => {
  const chosen = { op: 'eq', value: 'Industry 7' }
  render(<FiltersDrawer {...base} filters={{ industry: chosen }} />)
  const industry = groupOf('Descriptive').querySelector('[data-filter-key="industry"]')   // active => open
  const select = within(industry).getByRole('combobox', { name: 'Industry' })
  expect(select.querySelectorAll('option')).toHaveLength(151)
  fireEvent.change(within(industry).getByLabelText('Narrow Industry choices'), { target: { value: 'industry 12' } })
  const labels = [...select.querySelectorAll('option')].map(o => o.textContent)
  expect(labels).toEqual(['Any', 'Industry 7', 'Industry 12', 'Industry 120', 'Industry 121', 'Industry 122', 'Industry 123',
    'Industry 124', 'Industry 125', 'Industry 126', 'Industry 127', 'Industry 128', 'Industry 129'])
  expect(select.value).toBe('Industry 7')
  fireEvent.change(select, { target: { value: 'Industry 12' } })
  expect(base.onSetFilter).toHaveBeenCalledWith('industry', { op: 'eq', value: 'Industry 12' })
})

test('search still reaches inside collapsed categories', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  fireEvent.change(screen.getByLabelText('Find a filter'), { target: { value: 'prior' } })
  expect(screen.getByText('Prior Run')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Common/ })).toBeNull()
})
