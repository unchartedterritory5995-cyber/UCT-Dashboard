import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import ScanFilterChip, { scanChipText } from './ScanFilterChip'

const H1 = 'sha256:' + 'a'.repeat(64)
const H2 = 'sha256:' + 'b'.repeat(64)
const H3 = 'sha256:' + 'c'.repeat(64) // absent from `scans` — the shared-spec arrival case

const scans = [
  { def_hash: H1, name: 'Breakout base',
    latest: { as_of: 20260820, evaluated: 10, answered: 8, dropped: 1, not_computable: 1, freshness: 'D' } },
  { def_hash: H2, name: 'Quiet pullback', latest: null },
]

test('a hash with latest renders name + swept as-of + coverage counts', () => {
  const spec = { op: 'in', value: H1 }
  expect(scanChipText({ scans, spec, hash: H1, scanJoins: [] }))
    .toBe('Breakout base — swept 2026-08-20 · 8/10 answered · 1 dropped')
})

test('latest: null renders first sweep tonight', () => {
  const spec = { op: 'in', value: H2 }
  expect(scanChipText({ scans, spec, hash: H2, scanJoins: [] }))
    .toBe('Quiet pullback — first sweep tonight')
})

test('a hash absent from scans falls back to spec.label then Saved scan', () => {
  const withLabel = { op: 'in', value: H3, label: 'Shared scan name' }
  expect(scanChipText({ scans, spec: withLabel, hash: H3, scanJoins: [] }))
    .toBe('Shared scan name — first sweep tonight')
  const withoutLabel = { op: 'in', value: H3 }
  expect(scanChipText({ scans, spec: withoutLabel, hash: H3, scanJoins: [] }))
    .toBe('Saved scan — first sweep tonight')
})

test('scanJoins applied:false forces first sweep tonight even when meta carries a latest', () => {
  const spec = { op: 'in', value: H1 }
  const scanJoins = [{ def_hash: H1, as_of: null, applied: false }]
  expect(scanChipText({ scans, spec, hash: H1, scanJoins }))
    .toBe('Breakout base — first sweep tonight')
})

test('each chip’s × calls onRemoveHash with its hash', () => {
  const onRemoveHash = vi.fn()
  render(<ScanFilterChip scans={scans} spec={{ op: 'in', value: H1 }} scanJoins={[]}
    onRemoveHash={onRemoveHash} />)
  fireEvent.click(screen.getByLabelText('Remove scan filter'))
  expect(onRemoveHash).toHaveBeenCalledWith(H1)
})

test('two hashes render two chips', () => {
  render(<ScanFilterChip scans={scans} spec={{ op: 'in', value: [H1, H2] }} scanJoins={[]}
    onRemoveHash={() => {}} />)
  expect(screen.getByText(/Breakout base/)).toBeInTheDocument()
  expect(screen.getByText(/Quiet pullback/)).toBeInTheDocument()
  expect(screen.getAllByLabelText('Remove scan filter')).toHaveLength(2)
})
