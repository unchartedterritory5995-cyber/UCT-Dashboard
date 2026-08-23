import { describe, it, expect } from 'vitest'
import { QUOTES, quoteOfTheDay, dayOrdinal, TAGS } from './quotes'
import { strideFor } from './quoteRotation'

// Typography-insensitive form so a curly-vs-straight apostrophe or a trailing
// period can't hide a duplicate.
const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))

// Journal-hostile attributions: a quote you can't cite isn't note-taking material.
const UNCITABLE = new Set(['unknown', 'anonymous', 'anon', 'author unknown', ''])

describe('quote library (content contract)', () => {
  it('covers more than a trading year without a repeat', () => {
    // ~252 trading days/yr; the rotation below reaches every entry once before
    // any repeat, so ≥450 means no reader sees the same quote inside ~21 months.
    expect(QUOTES.length).toBeGreaterThanOrEqual(450)
  })

  it('every entry carries text, an author and a citable source', () => {
    for (const q of QUOTES) {
      expect(typeof q.t, `text of ${JSON.stringify(q)}`).toBe('string')
      expect(q.t.trim().length, `text too short: ${q.t}`).toBeGreaterThan(10)
      expect(typeof q.a).toBe('string')
      expect(q.a.trim().length, `no author for: ${q.t}`).toBeGreaterThan(1)
      expect(typeof q.src, `no src for: ${q.t}`).toBe('string')
      expect(q.src.trim().length, `empty src for: ${q.t}`).toBeGreaterThan(1)
    }
  })

  it('has no Unknown / Anonymous attributions', () => {
    const bad = QUOTES.filter((q) => UNCITABLE.has(q.a.trim().toLowerCase()))
    expect(bad.map((q) => q.t)).toEqual([])
  })

  it('has no duplicate or near-duplicate texts', () => {
    const seenFull = new Map()
    const seenPrefix = new Map()
    const dupes = []
    for (const q of QUOTES) {
      const n = norm(q.t)
      const p = n.slice(0, 50)
      if (seenFull.has(n)) dupes.push([q.t, seenFull.get(n)])
      else if (seenPrefix.has(p)) dupes.push([q.t, seenPrefix.get(p)])
      seenFull.set(n, q.t)
      seenPrefix.set(p, q.t)
    }
    expect(dupes).toEqual([])
  })

  it('fits the banners: no quote longer than 240 characters', () => {
    const long = QUOTES.filter((q) => q.t.length > 240).map((q) => `${q.t.length}: ${q.t}`)
    expect(long).toEqual([])
  })

  it('uses typographic quotes inside text (straight double quotes would break the banner markup)', () => {
    const straight = QUOTES.filter((q) => q.t.includes('"')).map((q) => q.t)
    expect(straight).toEqual([])
  })

  it('every entry carries 1–3 theme tags from the fixed vocabulary', () => {
    const bad = []
    for (const q of QUOTES) {
      const ok = Array.isArray(q.tags) && q.tags.length >= 1 && q.tags.length <= 3
        && q.tags.every((t) => TAGS.includes(t)) && new Set(q.tags).size === q.tags.length
      if (!ok) bad.push(`${q.t} → ${JSON.stringify(q.tags)}`)
    }
    expect(bad).toEqual([])
  })

  it('every theme has a usable pool — a regime pick must never run dry', () => {
    // The server picks from the pool carrying a regime's preferred tags; a tag
    // with a handful of quotes would repeat inside a month.
    const counts = Object.fromEntries(TAGS.map((t) => [t, 0]))
    for (const q of QUOTES) for (const t of q.tags) counts[t] += 1
    const thin = Object.entries(counts).filter(([, n]) => n < 25)
    expect(thin).toEqual([])
  })
})

describe('quoteOfTheDay (rotation contract)', () => {
  it('is deterministic within a calendar date, whatever the hour', () => {
    const morning = new Date(2026, 7, 24, 6, 35)   // 2026-08-24 06:35 local
    const evening = new Date(2026, 7, 24, 23, 59)
    expect(quoteOfTheDay(morning)).toBe(quoteOfTheDay(evening))
  })

  it('changes across consecutive days', () => {
    expect(quoteOfTheDay(new Date(2026, 7, 24))).not.toBe(quoteOfTheDay(new Date(2026, 7, 25)))
    expect(quoteOfTheDay(new Date(2026, 7, 25))).not.toBe(quoteOfTheDay(new Date(2026, 7, 26)))
  })

  it('day ordinal advances by exactly one per calendar day, including across month and year ends', () => {
    expect(dayOrdinal(new Date(2026, 11, 31)) + 1).toBe(dayOrdinal(new Date(2027, 0, 1)))
    expect(dayOrdinal(new Date(2026, 1, 28)) + 1).toBe(dayOrdinal(new Date(2026, 2, 1)))
    expect(dayOrdinal(new Date(2026, 7, 31)) + 1).toBe(dayOrdinal(new Date(2026, 8, 1)))
  })

  it('reaches every quote exactly once before any repeat', () => {
    // The legacy YYYYMMDD*97 seed jumped unevenly at month ends and reached only
    // ~141 of 392 quotes across a year of weekdays. A day-ordinal with a stride
    // coprime to the length is a full cycle by construction — assert both halves.
    expect(gcd(strideFor(QUOTES.length), QUOTES.length)).toBe(1)
    const seen = new Set()
    const start = new Date(2026, 7, 24)
    for (let i = 0; i < QUOTES.length; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      seen.add(quoteOfTheDay(d))
    }
    expect(seen.size).toBe(QUOTES.length)
  })

  it('defaults to today and returns a library entry', () => {
    const q = quoteOfTheDay()
    expect(QUOTES).toContain(q)
    expect(q).toHaveProperty('src')
  })
})
