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

// F1 (final review): scanJoins wins in BOTH directions. An applied join must
// never render as inert — a chip claiming "first sweep tonight" over rows the
// join is actively filtering reads a scan-filtered set as the whole market.
test('applied:true with NO meta entry renders SWEPT off the join, never first-sweep-tonight', () => {
  const spec = { op: 'in', value: H3, label: 'Shared scan name' }
  const scanJoins = [{ def_hash: H3, as_of: 20260821, applied: true }]
  expect(scanChipText({ scans, spec, hash: H3, scanJoins }))
    .toBe('Shared scan name — swept 2026-08-21')
})

test('applied:true with a STALE meta (different as_of) shows the join date and DROPS the counts', () => {
  // The 05:00 sweep crossed an open tab: meta still says 08-20, the join ran 08-21.
  const spec = { op: 'in', value: H1 }
  const scanJoins = [{ def_hash: H1, as_of: 20260821, applied: true }]
  expect(scanChipText({ scans, spec, hash: H1, scanJoins }))
    .toBe('Breakout base — swept 2026-08-21')
})

test('applied:true with a MATCHING meta keeps the full one-authority counts text', () => {
  const spec = { op: 'in', value: H1 }
  const scanJoins = [{ def_hash: H1, as_of: 20260820, applied: true }]
  expect(scanChipText({ scans, spec, hash: H1, scanJoins }))
    .toBe('Breakout base — swept 2026-08-20 · 8/10 answered · 1 dropped')
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
