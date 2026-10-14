import { setupLine, pivotDetail } from '../setupLine'

test('head of base_render, +N stripped', () => {
  expect(setupLine({ base_render: 'Three Weeks Tight (Stage 2 Breakout) +2', vol_ratio: 1.2 }))
    .toEqual({ text: 'Three Weeks Tight', detail: null, quiet: false })
})
test('null base', () => {
  expect(setupLine({ base_render: null, vol_ratio: 1 }))
    .toEqual({ text: 'Not enough history for a base', detail: null, quiet: true })
})
test('zero volume says so and is quiet', () => {
  expect(setupLine({ base_render: 'Flat Base', vol_ratio: 0 }))
    .toEqual({ text: 'No trades today', detail: null, quiet: true })
})
test('pivot detail only with a finite pivot and price', () => {
  expect(pivotDetail(956.12, 988)).toBe('3.2% below pivot 988')
  expect(pivotDetail(102, 100)).toBe('2.0% above pivot 100')
  expect(pivotDetail(100.1, 100)).toBe('at pivot 100')
  expect(pivotDetail(null, 100)).toBeNull()
  expect(pivotDetail(10, null)).toBeNull()
  expect(pivotDetail(10, 0)).toBeNull()
})
test('pivot detail rides the row when base_pivot_px exists', () => {
  expect(setupLine({ base_render: 'Flat Base', vol_ratio: 1, price: 97, base_pivot_px: 100 }).detail)
    .toBe('3.0% below pivot 100')
})
test('a render that opens with a parenthetical keeps it instead of going blank', () => {
  expect(setupLine({ base_render: '(Stage 2 Breakout) +2', vol_ratio: 1 }).text).toBe('(Stage 2 Breakout)')
})
test('pivot under 10 keeps two decimals', () => {
  expect(pivotDetail(4.5, 4.75)).toBe('5.3% below pivot 4.75')
})
