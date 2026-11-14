// RS screens (unit U5), items 3, 4 and 8: every caption part, tag rule, place, lead number,
// header sentence and why-strip fact, in the contract's own words (CONTRACT-SCREENS.md section 3).
// Table-driven: each row of a table is one sentence of the contract.
import { describe, expect, test } from 'vitest'
import {
  rowConfigOf, setupWords, flagWords, rsHighAgeWords, belowHighWords, movingWords, groupWords, captionOf, tagOf, placeOf,
  rowColumns, rowDisplay, leadOf, ratingsAsOf, sectorShare, rowFacts, RS_ROW_BASE_COLUMNS, SECTOR_SHARE_MIN_ROWS,
} from '../rsRows'
import { RS_STARTERS, TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS, PLAIN_STARTERS, RS_ROWS } from './rsScreensFixture'

const cfg = st => rowConfigOf(st)

describe('Setup words', () => {
  test.each([
    ['below_50', 0, 'Below its 50-day line'],
    ['extended', 0, 'Extended'],
    ['at_pivot', 0, 'At pivot'],
    ['pullback_8', 0, 'Pullback to the 8-day'],
    ['pullback_21', 0, 'Pullback to the 21-day'],
    ['uptrend', 0, 'Uptrend, no setup'],
    // rs_tight == 1: "Tight range" replaces "Uptrend, no setup" ...
    ['uptrend', 1, 'Tight range'],
    // ... is appended after a comma to the others ...
    ['at_pivot', 1, 'At pivot, tight range'],
    ['pullback_8', 1, 'Pullback to the 8-day, tight range'],
    ['pullback_21', 1, 'Pullback to the 21-day, tight range'],
    // ... except Extended and Below its 50-day line.
    ['extended', 1, 'Extended'],
    ['below_50', 1, 'Below its 50-day line'],
  ])('rs_setup %s, rs_tight %s reads "%s"', (rs_setup, rs_tight, words) => {
    expect(setupWords({ rs_setup, rs_tight })).toBe(words)
  })
  test.each([[null], [undefined], [''], ['buyable'], ['constructor'], [3]])('an unknown or missing setup (%s) prints nothing, tight or not', code => {
    expect(setupWords({ rs_setup: code, rs_tight: 1 })).toBe('')
    expect(setupWords({ rs_setup: code, rs_tight: 0 })).toBe('')
  })
  test('rs_tight that is not exactly 1 is not tight', () => {
    expect(setupWords({ rs_setup: 'uptrend', rs_tight: null })).toBe('Uptrend, no setup')
    expect(setupWords({ rs_setup: 'uptrend' })).toBe('Uptrend, no setup')
  })
})

test.each([
  ['buyout_pending', 'Buyout pending'], ['one_day_move', 'One-day move'], ['new_issue', 'New issue'],
  [null, ''], ['', ''], ['other', ''], ['toString', ''],
])('flag %s reads "%s"', (rs_flag, words) => { expect(flagWords({ rs_flag })).toBe(words) })

test.each([
  [0, 'RS high today'], [1, 'RS high yesterday'], [2, 'RS high 2 sessions ago'], [7, 'RS high 7 sessions ago'], [20, 'RS high 20 sessions ago'],
  [null, ''], [undefined, ''], ['3', ''], [NaN, ''], [-1, ''],
])('rs_high_age: rs_nh_bars_ago %s reads "%s"', (n, words) => { expect(rsHighAgeWords({ rs_nh_bars_ago: n })).toBe(words) })

test.each([
  [0, 'At its high'], [-0.2, 'At its high'], [-0.49, 'At its high'],
  // not above -0.5: a whole percent below
  [-0.5, '1% below its high'], [-0.6, '1% below its high'], [-3, '3% below its high'], [-6.4, '6% below its high'], [-6.5, '7% below its high'],
  [-12, '12% below its high'], [-25, '25% below its high'],
  [null, ''], [undefined, ''], ['-5', ''], [NaN, ''],
])('below_high: px_below_high_pct %s reads "%s"', (p, words) => { expect(belowHighWords({ px_below_high_pct: p })).toBe(words) })

describe('moving', () => {
  test.each([
    // the place a month ago, when it is a number and differs from today's
    [{ rs_rating_pos: 14, rs_rating_pos_prev20: 41, rs_rating_chg_5: 3 }, 'was #41 a month ago'],
    [{ rs_rating_pos: 14, rs_rating_pos_prev20: 1204, rs_rating_chg_5: 3 }, 'was #1,204 a month ago'],
    [{ rs_rating_pos: null, rs_rating_pos_prev20: 41, rs_rating_chg_5: 3 }, 'was #41 a month ago'],
    // else this week's change, when it is a non-zero number
    [{ rs_rating_pos: 14, rs_rating_pos_prev20: 14, rs_rating_chg_5: 3 }, 'RS Rating up 3 this week'],
    [{ rs_rating_pos: 14, rs_rating_pos_prev20: 14, rs_rating_chg_5: -4 }, 'RS Rating down 4 this week'],
    [{ rs_rating_pos: 14, rs_rating_pos_prev20: null, rs_rating_chg_5: 12 }, 'RS Rating up 12 this week'],
    // else nothing
    [{ rs_rating_pos: 14, rs_rating_pos_prev20: 14, rs_rating_chg_5: 0 }, ''],
    [{ rs_rating_pos: 14, rs_rating_pos_prev20: null, rs_rating_chg_5: null }, ''],
    [{ rs_rating_pos: 14 }, ''],
    [{ rs_rating_pos: 14, rs_rating_pos_prev20: '41', rs_rating_chg_5: '3' }, ''],
  ])('%o reads "%s"', (row, words) => { expect(movingWords(row)).toBe(words) })
})

test('group: the theme when the row has one, else its industry', () => {
  expect(groupWords({ industry: 'Semiconductors' }, 'AI chips')).toBe('AI chips')
  expect(groupWords({ industry: 'Semiconductors' }, null)).toBe('Semiconductors')
  expect(groupWords({ industry: 'Semiconductors' }, '')).toBe('Semiconductors')
  expect(groupWords({}, null)).toBe('')
})

describe('the caption: the starter\'s parts in its order, joined with " · "', () => {
  const [nvda, mu, lly, xom, amd] = RS_ROWS
  test.each([
    ['Top RS Rating', TOP_RATING, nvda, null, 'At pivot · was #41 a month ago'],
    ['Top RS Rating', TOP_RATING, mu, null, 'Extended · RS Rating down 4 this week'],
    ['Top RS Rating', TOP_RATING, lly, null, 'Tight range'],                       // nothing moving: no trailing separator
    ['RS New Highs', NEW_HIGHS, nvda, 'AI chips', 'RS high today · AI chips'],
    ['RS New Highs', NEW_HIGHS, lly, null, 'RS high yesterday · Drug makers'],
    ['RS New Highs', NEW_HIGHS, xom, null, 'Oil and gas'],                          // no RS high age: no leading separator
    ['RS New High Before Price', BEFORE_PRICE, mu, null, '6% below its high · Semiconductors'],
    ['RS New High Before Price', BEFORE_PRICE, nvda, null, 'At its high · Semiconductors'],
    ['UCT RS Leaders', LEADERS, lly, 'GLP-1', 'Tight range · GLP-1'],
    ['UCT RS Leaders', LEADERS, amd, null, 'Below its 50-day line · Semiconductors'],
    ['RS exit warnings', EXIT_WARNINGS, xom, null, 'Oil and gas'],
  ])('%s: %o', (_n, st, row, theme, words) => { expect(captionOf(row, cfg(st), theme)).toBe(words) })

  test('the Setup words come first wherever a screen has them, so truncation eats the group', () => {
    for (const st of RS_STARTERS.filter(s => s.row.caption.includes('setup'))) expect(st.row.caption[0]).toBe('setup')
    expect(captionOf(RS_ROWS[0], cfg(LEADERS), 'AI chips').startsWith('At pivot')).toBe(true)
  })
  test('an unknown part prints nothing and leaves no separator', () => {
    expect(captionOf(RS_ROWS[0], { caption: ['nope', 'group'], tags: [] }, null)).toBe('Semiconductors')
    expect(captionOf(RS_ROWS[0], { caption: [], tags: [] }, null)).toBe('')
  })
})

describe('tags: one per row, the first of the starter\'s list that applies', () => {
  const all = { tags: ['before_price', 'down_day', 'flag', 'new'] }
  test.each([
    // Before price: rs_nhbp_age is a number AND px_below_high_pct <= -3
    [{ rs_nhbp_age: 0, px_below_high_pct: -3 }, false, 'Before price'],
    [{ rs_nhbp_age: 4, px_below_high_pct: -12 }, false, 'Before price'],
    [{ rs_nhbp_age: 0, px_below_high_pct: -2.9 }, false, ''],
    [{ rs_nhbp_age: null, px_below_high_pct: -12 }, false, ''],
    [{ rs_nhbp_age: 2, px_below_high_pct: null }, false, ''],
    // Market down day: rs_nh_red_bars_ago is a number equal to rs_nh_bars_ago
    [{ rs_nh_red_bars_ago: 3, rs_nh_bars_ago: 3 }, false, 'Market down day'],
    [{ rs_nh_red_bars_ago: 0, rs_nh_bars_ago: 0 }, false, 'Market down day'],
    [{ rs_nh_red_bars_ago: 5, rs_nh_bars_ago: 3 }, false, ''],
    [{ rs_nh_red_bars_ago: null, rs_nh_bars_ago: null }, false, ''],
    [{ rs_nh_red_bars_ago: undefined, rs_nh_bars_ago: undefined }, false, ''],
    // the flag words
    [{ rs_flag: 'buyout_pending' }, false, 'Buyout pending'],
    [{ rs_flag: 'one_day_move' }, false, 'One-day move'],
    [{ rs_flag: 'new_issue' }, false, 'New issue'],
    // the existing New pill
    [{}, true, 'New'],
    [{}, false, ''],
    // priority: the list's order decides
    [{ rs_nhbp_age: 0, px_below_high_pct: -5, rs_nh_red_bars_ago: 0, rs_nh_bars_ago: 0, rs_flag: 'new_issue' }, true, 'Before price'],
    [{ rs_nh_red_bars_ago: 0, rs_nh_bars_ago: 0, rs_flag: 'new_issue' }, true, 'Market down day'],
    [{ rs_flag: 'new_issue' }, true, 'New issue'],
  ])('%o, new=%s reads "%s"', (row, isNew, words) => { expect(tagOf(row, all, isNew)).toBe(words) })

  test('a tag the starter does not list never shows, and the order is the starter\'s', () => {
    const both = { rs_nhbp_age: 0, px_below_high_pct: -5, rs_nh_red_bars_ago: 0, rs_nh_bars_ago: 0, rs_flag: 'new_issue' }
    expect(tagOf(both, cfg(BEFORE_PRICE), true)).toBe('Market down day')       // tags: down_day, flag, new
    expect(tagOf(both, cfg(TOP_RATING), true)).toBe('New issue')               // tags: flag, new
    expect(tagOf(both, cfg(EXIT_WARNINGS), true)).toBe('New')                  // tags: new
    expect(tagOf(both, cfg(EXIT_WARNINGS), false)).toBe('')
    expect(tagOf(both, { tags: ['new', 'flag'] }, true)).toBe('New')
  })
})

describe('the place numeral', () => {
  test('a column key shows that column, "index" the 1-based position, null nothing', () => {
    expect(placeOf(RS_ROWS[0], cfg(TOP_RATING), 7)).toBe(14)
    expect(placeOf(RS_ROWS[0], cfg(LEADERS), 7)).toBe(8)
    expect(placeOf(RS_ROWS[0], cfg(LEADERS), 0)).toBe(1)
    expect(placeOf(RS_ROWS[0], cfg(NEW_HIGHS), 7)).toBeNull()
    expect(placeOf(RS_ROWS[0], cfg(EXIT_WARNINGS), 0)).toBeNull()
  })
  test('a place column the row does not carry is blank, never the index', () => {
    expect(placeOf({ ticker: 'X', rs_rating_pos: null }, cfg(TOP_RATING), 3)).toBeNull()
    expect(placeOf({ ticker: 'X' }, cfg(TOP_RATING), 3)).toBeNull()
  })
})

describe('the lead number', () => {
  test.each([[97, { value: 97, top: true }], [90, { value: 90, top: true }], [89, { value: 89, top: false }], [1, { value: 1, top: false }]])(
    'rs_rank %s', (rs_rank, lead) => { expect(leadOf({ rs_rank })).toEqual(lead) })
  test.each([[null], [undefined], ['97'], [NaN]])('rs_rank %s shows no lead number', v => { expect(leadOf({ rs_rank: v })).toBeNull() })
})

describe('the columns a row reads', () => {
  test('nothing for a starter without `row`', () => {
    for (const st of PLAIN_STARTERS) { expect(cfg(st)).toBeNull(); expect(rowColumns(cfg(st))).toEqual([]) }
    expect(rowConfigOf(null)).toBeNull()
    expect(rowConfigOf({ row: 'x' })).toBeNull()
    expect(rowConfigOf({ row: [] })).toBeNull()
  })
  test.each([
    ['Top RS Rating', TOP_RATING, ['rs_rating_pos', 'rs_setup', 'rs_tight', 'rs_rating_pos_prev20', 'rs_rating_chg_5', 'rs_flag']],
    ['RS New Highs', NEW_HIGHS, ['rs_nh_bars_ago', 'industry', 'rs_nhbp_age', 'px_below_high_pct', 'rs_nh_red_bars_ago', 'rs_flag']],
    ['RS New High Before Price', BEFORE_PRICE, ['px_below_high_pct', 'industry', 'rs_nh_red_bars_ago', 'rs_nh_bars_ago', 'rs_flag']],
    ['UCT RS Leaders', LEADERS, ['rs_setup', 'rs_tight', 'industry', 'rs_flag']],
    ['RS exit warnings', EXIT_WARNINGS, ['industry']],
  ])('%s asks for its parts, its tags and the shared base, each once', (_n, st, own) => {
    const cols = rowColumns(cfg(st))
    for (const c of [...own, ...RS_ROW_BASE_COLUMNS]) expect(cols).toContain(c)
    expect(new Set(cols).size).toBe(cols.length)
    expect(cols).not.toContain('index')
  })
  test('a screen asks for nothing its row does not read', () => {
    // no before-price tag and no moving part on UCT RS Leaders
    expect(rowColumns(cfg(LEADERS))).not.toContain('rs_nhbp_age')
    expect(rowColumns(cfg(LEADERS))).not.toContain('rs_rating_chg_5')
    expect(rowColumns(cfg(EXIT_WARNINGS))).not.toContain('rs_flag')
  })
})

test('rowDisplay hands the row component three primitives', () => {
  expect(rowDisplay(RS_ROWS[1], cfg(NEW_HIGHS), { index: 1, theme: null, isNew: true }))
    .toEqual({ place: null, caption: 'RS high 3 sessions ago · Semiconductors', tag: 'Before price' })
  expect(rowDisplay(RS_ROWS[2], cfg(LEADERS), { index: 2, theme: 'GLP-1', isNew: true }))
    .toEqual({ place: 3, caption: 'Tight range · GLP-1', tag: 'New issue' })
})

describe('the header line', () => {
  test('"Ratings as of <Mon D>" from the first row\'s rs_rating_session', () => {
    expect(ratingsAsOf(RS_ROWS)).toBe('Ratings as of Nov 13')
    expect(ratingsAsOf([{ rs_rating_session: '2026-01-02' }, { rs_rating_session: '2026-11-13' }])).toBe('Ratings as of Jan 2')
  })
  test.each([[[]], [null], [[{ ticker: 'X' }]], [[{ rs_rating_session: null }]], [[{ rs_rating_session: 'soon' }]]])('no rating date (%o): nothing', rows => {
    expect(ratingsAsOf(rows)).toBe('')
  })

  const rowsOf = counts => Object.entries(counts).flatMap(([sector, n]) => Array.from({ length: n }, (_, i) => ({ ticker: `${sector}${i}`, sector: sector === 'none' ? null : sector })))
  test.each([
    // exactly 40% says it; one row under does not
    [{ Healthcare: 20, Technology: 30 }, '30 of 50 are Technology'],
    [{ Healthcare: 29, Technology: 11, Energy: 10 }, '29 of 50 are Healthcare'],
    [{ Healthcare: 4, Technology: 3, Energy: 3 }, '4 of 10 are Healthcare'],
    [{ Healthcare: 39, Technology: 31, Energy: 30 }, ''],
    [{ Healthcare: 3, Technology: 3, Energy: 2, Financials: 2 }, ''],
    // rows without a sector count in M and never in N
    [{ Healthcare: 4, none: 6 }, '4 of 10 are Healthcare'],
    [{ Healthcare: 3, none: 7 }, ''],
    [{ none: 10 }, ''],
  ])('%o reads "%s"', (counts, words) => { expect(sectorShare(rowsOf(counts))).toBe(words) })
  test('too few loaded rows say nothing, whatever the share', () => {
    expect(SECTOR_SHARE_MIN_ROWS).toBe(5)
    expect(sectorShare(rowsOf({ Energy: 4 }))).toBe('')
    expect(sectorShare(rowsOf({ Energy: 5 }))).toBe('5 of 5 are Energy')
    expect(sectorShare([])).toBe('')
    expect(sectorShare(null)).toBe('')
  })
})

describe('the why strip\'s fact notes', () => {
  test('the four facts, most distinctive first, each a note and never a tick', () => {
    expect(rowFacts(RS_ROWS[1])).toEqual([
      { kind: 'note', label: 'Extended' },
      { kind: 'note', label: 'RS high 3 sessions ago' },
      { kind: 'note', label: '6% below its high' },
      { kind: 'note', label: 'RS Rating place 120 of 1,931' },
    ])
  })
  test('a fact the row does not carry is left out', () => {
    expect(rowFacts(RS_ROWS[3]).map(f => f.label)).toEqual(['Pullback to the 21-day', 'RS Rating place 380 of 1,931'])
    expect(rowFacts({ rs_rating_pos: 5, rs_rating_pos_n: null }).map(f => f.label)).toEqual(['RS Rating place 5'])
    expect(rowFacts({})).toEqual([])
    expect(rowFacts({ rs_rating_pos: null, rs_rating_pos_n: 1931 })).toEqual([])
  })
})

test('the contract\'s never-words appear in no caption, tag or fact the sample rows can produce', () => {
  const said = []
  for (const st of RS_STARTERS) for (const [i, r] of RS_ROWS.entries()) {
    const d = rowDisplay(r, cfg(st), { index: i, theme: null, isNew: true })
    said.push(d.caption, d.tag, ...rowFacts(r).map(f => f.label))
  }
  for (const code of ['below_50', 'extended', 'at_pivot', 'pullback_8', 'pullback_21', 'uptrend']) for (const t of [0, 1]) said.push(setupWords({ rs_setup: code, rs_tight: t }))
  const text = said.join(' | ')
  for (const bad of [/\bbuy\b/i, /\bsell\b/i, /buyable/i, /\blens\b/i, /\bgate\b/i, /red day/i, /\bADR\b/, /\bRSI\b/, /—/]) expect(text).not.toMatch(bad)
})
