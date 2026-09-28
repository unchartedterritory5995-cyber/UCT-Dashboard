// app/src/pages/calendar/viewLadder.test.js
//
// TD-37 / TERM-074 — the view-preference ladder had no test at all. This rails
// every rung on BOTH input shapes (legacy v2 prefs, and the v3 key), plus the
// two properties a migration must have: it copies (never mutates or destroys
// the legacy value) and it is idempotent (same inputs, same answer, however
// many times it runs). The page-level rail is Calendar.viewLadder.test.jsx.
import { describe, it, expect } from 'vitest'
import {
  resolveCalendarView, legacyView, hasExplicitView, wireHasContent,
} from './viewLadder'

const PRINTS = { rows: [{ sym: 'NKE' }], expected: 3 }

describe('legacyView — the 2026-07-14 v2→v3 rung, unchanged', () => {
  it.each([
    [{ calendar_view_v2: 'month' }, 'month'],
    [{ calendar_view_v2: 'feed', calendar_density: 'rows' }, 'table'],
    [{ calendar_view_v2: 'feed', calendar_density: 'tiles' }, 'board'],
    [{ calendar_view_v2: 'feed' }, 'board'],
    [{ calendar_view_v2: 'week' }, 'board'],
    [{}, 'board'],
    [undefined, 'board'],
  ])('%j → %s', (prefs, want) => {
    expect(legacyView(prefs)).toBe(want)
  })
})

describe('resolveCalendarView — OLD SHAPE (no v3 key)', () => {
  it('lands on the Wire when the probe found prints', () => {
    for (const v2 of ['month', 'feed', 'week', undefined]) {
      expect(resolveCalendarView({ calendar_view_v2: v2 }, { wireLanding: true })).toBe('wire')
    }
  })

  it('falls back to the legacy answer when the Wire is empty or unprobed', () => {
    expect(resolveCalendarView({ calendar_view_v2: 'month' }, { wireLanding: false })).toBe('month')
    expect(resolveCalendarView({ calendar_view_v2: 'feed', calendar_density: 'rows' })).toBe('table')
    expect(resolveCalendarView({})).toBe('board')
  })
})

describe('resolveCalendarView — NEW SHAPE (explicit v3 choice)', () => {
  it('an explicit choice ALWAYS wins, even over a Wire with prints', () => {
    for (const v3 of ['board', 'table', 'month', 'wire']) {
      const prefs = { calendar_view_v3: v3, calendar_view_v2: 'month' }
      expect(hasExplicitView(prefs)).toBe(true)
      expect(resolveCalendarView(prefs, { wireLanding: true })).toBe(v3)
      expect(resolveCalendarView(prefs, { wireLanding: false })).toBe(v3)
    }
  })

  it('an empty v3 value is not a choice (the old `||` semantics)', () => {
    expect(hasExplicitView({ calendar_view_v3: '' })).toBe(false)
    expect(resolveCalendarView({ calendar_view_v3: '' }, { wireLanding: true })).toBe('wire')
  })
})

describe('the ladder is a COPY and is IDEMPOTENT', () => {
  it('never mutates the prefs it reads — the legacy value survives', () => {
    const prefs = Object.freeze({ calendar_view_v2: 'feed', calendar_density: 'rows' })
    const before = JSON.stringify(prefs)
    // Frozen input: any write attempt would throw in strict-mode ESM.
    resolveCalendarView(prefs, { wireLanding: true })
    resolveCalendarView(prefs, { wireLanding: false })
    expect(JSON.stringify(prefs)).toBe(before)
  })

  it('re-running on the same inputs gives the same answer', () => {
    const cases = [
      [{ calendar_view_v2: 'month' }, { wireLanding: true }],
      [{ calendar_view_v2: 'month' }, { wireLanding: false }],
      [{ calendar_view_v3: 'table' }, { wireLanding: true }],
      [{}, {}],
    ]
    for (const [p, o] of cases) {
      const first = resolveCalendarView(p, o)
      for (let i = 0; i < 3; i++) expect(resolveCalendarView(p, o)).toBe(first)
    }
  })
})

describe('wireHasContent', () => {
  it('is true only when at least one print is on the wire', () => {
    expect(wireHasContent(PRINTS)).toBe(true)
    expect(wireHasContent({ rows: [], expected: 12 })).toBe(false)
    expect(wireHasContent({ expected: 12 })).toBe(false)
    expect(wireHasContent(null)).toBe(false)          // fetch !ok → null
    expect(wireHasContent(undefined)).toBe(false)
    expect(wireHasContent({ rows: 'NKE' })).toBe(false)
  })
})
