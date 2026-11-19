import { describe, it, expect } from 'vitest'
import { COLUMN_INFO, columnInfo } from './columnInfo'
import { COLS } from '../Breadth'

// Every Monitor column explains itself (owner 2026-11-19): a new column cannot ship
// without a plain-words name and a description.
describe('column info covers every metric', () => {
  it.each(COLS.map(c => [c.key, c.label]))('%s (%s) has a name and a description', (key) => {
    const info = columnInfo(key)
    expect(info, `add ${key} to breadth/columnInfo.js`).toBeTruthy()
    expect(info.name.trim().length).toBeGreaterThan(2)
    expect(info.desc.trim().length).toBeGreaterThan(20)
  })

  it('copy rules: American spelling, no stale-feed notes, no "AI"', () => {
    for (const [key, info] of Object.entries(COLUMN_INFO)) {
      const text = `${info.name} ${info.desc}`
      expect(text, key).not.toMatch(/colour/i)
      expect(text, key).not.toMatch(/\bAI\b/)
      expect(text, key).not.toMatch(/stale since/i)
    }
  })

  it('the weekly surveys say so; the daily columns do not', () => {
    const weekly = Object.entries(COLUMN_INFO).filter(([, i]) => i.weekly).map(([k]) => k).sort()
    expect(weekly).toEqual(['aaii_bears', 'aaii_bulls', 'aaii_neutral', 'aaii_spread', 'naaim'])
  })

  it('the MA-dot columns explain the dots', () => {
    for (const k of ['spy_ma_stack', 'qqq_ma_stack']) {
      expect(COLUMN_INFO[k].desc).toMatch(/10, 20, 50 and 200-day/)
      expect(COLUMN_INFO[k].desc).toMatch(/Filled means above/)
      expect(COLUMN_INFO[k].desc).toMatch(/ring means below/)
    }
  })
})
