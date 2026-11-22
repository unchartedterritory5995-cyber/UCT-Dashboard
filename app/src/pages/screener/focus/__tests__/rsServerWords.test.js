// RS screens, unit U11: the page's row words and the SERVER's are one wording.
//
// The assistant (Compass, the UCT Agent) lists the five RS screens outside this page, and words
// each row on the server (api/services/screener/rs_words.py). That is a second copy of what
// rsRows.js says here, and two copies drift unless something holds them. So:
//
//   tests/fixtures/rs_screens_words.json   what the SERVER says for a table of rows
//                                          (written and pinned by tests/test_rs_screens_u11_words.py)
//
// and this file runs the PAGE's own code on the same rows and must read the same words. A word
// changed in rsRows.js fails here; a word changed on the server fails the Python suite until the
// file is rewritten (UPDATE_RS_SCREENS_GOLDEN=1), and then this file again until both agree.
//
// The rows: every row the scan route really served for the five screens (rs_screens_rows.json),
// and a hand-built table that walks each branch (every setup with and without a tight range,
// each age, a half that rounds up, a JSON true where a 1 is read, a blank).
import { describe, expect, test } from 'vitest'
import { rowConfigOf, rowColumns, rowDisplay, setupWords, groupWords, ratingsAsOf, daysWords } from '../rsRows'
import { plainColumnLabel } from '../plainWords'
import { RS_STARTERS, SERVED, readServerFixture } from './rsScreensFixture'

const WORDS = readServerFixture('rs_screens_words.json')

// One row as the page says it, in the shape the server wrote its own answer.
// `today` (unit U12): the New York day a case counts its earnings date from. Noon there, so the
// page's own clock conversion lands on that day whatever the season.
const nowOf = c => (c.today ? Date.parse(`${c.today}T17:00:00Z`) : undefined)
const said = c => ({
  ...rowDisplay(c.row, c.cfg, { index: c.index, theme: c.theme, isNew: c.is_new, now: nowOf(c) }),
  setup: setupWords(c.row),
  group: groupWords(c.row, c.theme),
})

describe('the server words an RS row exactly as the page does', () => {
  test('the file is the one the server suite writes, and it is not a stub', () => {
    expect(WORDS.cases.length).toBeGreaterThanOrEqual(150)
    expect(new Set(WORDS.cases.map(c => c.name)).size).toBe(WORDS.cases.length)
    // every screen's served rows are in it, and so is the 1-month board
    for (const s of RS_STARTERS) expect(WORDS.cases.some(c => c.name.startsWith(`${s.id} row `))).toBe(true)
    expect(WORDS.cases.some(c => c.name.startsWith('top rating 1M row '))).toBe(true)
    // the table says something: most rows carry a caption, and every tag word appears
    expect(WORDS.cases.filter(c => c.want.caption).length).toBeGreaterThan(100)
    const tags = new Set(WORDS.cases.map(c => c.want.tag))
    for (const t of ['Before price', 'Market down day', 'New', 'New issue', 'Earnings today', 'Earnings in 3 days', 'Weekly RS high']) expect(tags.has(t)).toBe(true)
    // a case that reads a report DATE names the day it is read on; without one it would change by itself
    const dated = WORDS.cases.filter(c => c.row.next_earnings_date != null)
    expect(dated.length).toBeGreaterThan(8)
    for (const c of dated) expect(c.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('"Day N on this list" reads the same count the same way', () => {
    expect(WORDS.days_on_list.length).toBeGreaterThan(5)
    expect(WORDS.days_on_list.some(d => d.want)).toBe(true)
    for (const { days, want } of WORDS.days_on_list) expect(daysWords({ rs_leaders_days: days })).toBe(want)
  })

  test.each(WORDS.cases.map(c => [c.name, c]))('%s', (_name, c) => {
    expect(said(c)).toEqual(c.want)
  })

  test('the columns a row reads are the same list, in the same order', () => {
    expect(WORDS.columns.length).toBeGreaterThan(RS_STARTERS.length)
    for (const entry of WORDS.columns) {
      const starter = RS_STARTERS.find(s => s.id === entry.starter)
      expect(rowColumns(rowConfigOf(starter, entry.place))).toEqual(entry.columns)
    }
  })

  test('"Ratings as of" reads a session the same way', () => {
    for (const { session, want } of WORDS.ratings_as_of) expect(ratingsAsOf([{ rs_rating_session: session }])).toBe(want)
  })

  test('a rule the assistant names carries the name the page gives it', () => {
    const meta = Object.fromEntries(SERVED.meta.filters.map(f => [f.key, f.label]))
    const keys = Object.keys(WORDS.rule_labels)
    expect(keys.length).toBeGreaterThan(5)
    for (const key of keys) expect(plainColumnLabel(key) || meta[key]).toBe(WORDS.rule_labels[key])
  })
})
