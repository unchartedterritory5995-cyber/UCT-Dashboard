import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import FilterChips from './FilterChips'

const meta = { filters: [
  { key: 'rsi14', label: 'RSI (14)', unit: '', presets: [{ label: 'Any' }, { label: '40–60', op: 'between', min: 40, max: 60 }] },
  { key: 'sector', label: 'Sector', unit: null, presets: [{ label: 'Any' }] },
] }

test('renders a chip per active filter and removes one', () => {
  const onRemove = vi.fn()
  render(<FilterChips meta={meta}
    activeFilters={{ rsi14: { op: 'between', min: 40, max: 60 }, sector: { op: 'eq', value: 'Technology' } }}
    onRemove={onRemove} onClear={() => {}} />)
  expect(screen.getByText('RSI (14): 40–60')).toBeInTheDocument()
  expect(screen.getByText('Sector: Technology')).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Remove RSI (14) filter'))
  expect(onRemove).toHaveBeenCalledWith('rsi14')
})

test('renders nothing when no active filters', () => {
  const { container } = render(<FilterChips meta={meta} activeFilters={{}} onRemove={() => {}} onClear={() => {}} />)
  expect(container.firstChild).toBeNull()
})

const H1 = 'sha256:' + 'a'.repeat(64)
const H2 = 'sha256:' + 'b'.repeat(64)
const metaWithScan = { filters: [...meta.filters, {
  key: 'scan', label: 'My Scans', category: 'my_scans', type: 'enum',
  presets: [{ label: 'Any' }], allow_custom: false, unit: null,
  scans: [
    { def_hash: H1, name: 'Breakout base',
      latest: { as_of: 20260820, evaluated: 10, answered: 8, dropped: 1, not_computable: 1, freshness: 'D' } },
    { def_hash: H2, name: 'Quiet pullback', latest: null },
  ],
}] }

test('a scan-keyed active filter renders via ScanFilterChip (swept-text, not chipLabel output)', () => {
  render(<FilterChips meta={metaWithScan}
    activeFilters={{ scan: { op: 'in', value: H1 } }}
    onRemove={() => {}} onClear={() => {}} onReplace={() => {}} />)
  expect(screen.getByText('Breakout base — swept 2026-08-20 · 8/10 answered · 1 dropped')).toBeInTheDocument()
})

test('removing the LAST hash calls onReplace(key, null)', () => {
  const onReplace = vi.fn()
  render(<FilterChips meta={metaWithScan}
    activeFilters={{ scan: { op: 'in', value: H1 } }}
    onRemove={() => {}} onClear={() => {}} onReplace={onReplace} />)
  fireEvent.click(screen.getByLabelText('Remove scan filter'))
  expect(onReplace).toHaveBeenCalledWith('scan', null)
})

test('removing one of two hashes calls onReplace with the remaining-array spec', () => {
  const onReplace = vi.fn()
  render(<FilterChips meta={metaWithScan}
    activeFilters={{ scan: { op: 'in', value: [H1, H2], label: 'Breakout base' } }}
    onRemove={() => {}} onClear={() => {}} onReplace={onReplace} />)
  fireEvent.click(screen.getAllByLabelText('Remove scan filter')[0])
  expect(onReplace).toHaveBeenCalledWith('scan', { op: 'in', value: [H2], label: 'Breakout base' })
})
