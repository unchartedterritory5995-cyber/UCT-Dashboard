import { describe, it, expect } from 'vitest'
import { stampText, continues } from './chatTime'

describe('chat time beside the sender (Discord style)', () => {
  const now = new Date(2026, 9, 10, 22, 30).getTime()
  const time = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  it('today: the time alone', () => {
    const d = new Date(2026, 9, 10, 22, 14)
    expect(stampText(d.getTime(), now)).toBe(time(d))
  })
  it('yesterday: "Yesterday at …"', () => {
    const d = new Date(2026, 9, 9, 9, 5)
    expect(stampText(d.getTime(), now)).toBe(`Yesterday at ${time(d)}`)
  })
  it('older: the date, then the time', () => {
    const d = new Date(2026, 9, 1, 9, 5)
    expect(stampText(d.getTime(), now)).toBe(`${d.toLocaleDateString()} ${time(d)}`)
  })
})

describe('Discord grouping', () => {
  const m = (at) => ({ role: 'member', at })
  const a = (role, at) => ({ role, at })
  it('same sender within 7 minutes joins the group', () => {
    expect(continues(m(0), m(60_000))).toBe(true)
    expect(continues(a('agent', 0), a('receipt', 1000))).toBe(true)
    expect(continues(a('refusal', 0), a('question', 1000))).toBe(true)
  })
  it('a different sender, a 7-minute gap, or the first line starts a new group', () => {
    expect(continues(m(0), a('agent', 1000))).toBe(false)
    expect(continues(m(0), m(7 * 60_000))).toBe(false)
    expect(continues(undefined, m(0))).toBe(false)
  })
})
