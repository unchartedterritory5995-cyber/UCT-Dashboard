import { test, expect } from 'vitest'
import { DOORS } from './doors'

test('every door has a key, label, route and icon', () => {
  expect(DOORS.length).toBe(8)
  for (const d of DOORS) {
    expect(d.key).toMatch(/^[a-z0-9_]+$/)
    expect(d.to.startsWith('/')).toBe(true)
    expect(d.label.length).toBeGreaterThan(0)
    expect(d.icon.length).toBeGreaterThan(0)
  }
})

test('door keys are unique', () => {
  expect(new Set(DOORS.map(d => d.key)).size).toBe(DOORS.length)
})
