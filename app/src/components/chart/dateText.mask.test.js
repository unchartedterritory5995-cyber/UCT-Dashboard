// The date box's mask (owner, 2026-11-28: "when i ... use the change date tool to jump in the past it looks off").
// A typed "/" ENDS the month or the day: "6/2/2023" stays 6/2/2023 (it became 6/22/023), "1/2/2024" stays 1/2/2024
// (it became 12/20/24). Digits alone keep the old inference. Typed one character at a time, as the box receives it.
import { describe, it, expect } from 'vitest'
import { maskMDY, parseDate } from './dateText'

const typed = (s) => { let v = ''; for (const ch of s) v = maskMDY(v + ch); return v }

describe('maskMDY', () => {
  it.each([
    ['6/2/2023', '6/2/2023'],
    ['1/2/2024', '1/2/2024'],
    ['5/1/2024', '5/1/2024'],
    ['1/12/2024', '1/12/2024'],
    ['12/2/2024', '12/2/2024'],
    ['3/3/2025', '3/3/2025'],
    ['2/17/2023', '2/17/2023'],
    ['6/22/2023', '6/22/2023'],
    ['06/02/2023', '06/02/2023'],
  ])('typed %s reads %s and parses to that day', (input, want) => {
    expect(typed(input)).toBe(want)
    const [m, d, y] = want.split('/').map(Number)
    expect(parseDate(typed(input), { whole: true })).toBe(Date.UTC(y, m - 1, d))
  })

  it('keeps a just-typed slash so the next digits land in the next field', () => {
    expect(typed('6/')).toBe('6/')
    expect(typed('6/2/')).toBe('6/2/')
    expect(typed('12/')).toBe('12/')
  })

  it('digits alone keep the old inference', () => {
    expect(typed('01022024')).toBe('01/02/2024')
    expect(typed('12252024')).toBe('12/25/2024')
    expect(typed('3032025')).toBe('3/03/2025')
    expect(typed('')).toBe('')
  })
})
