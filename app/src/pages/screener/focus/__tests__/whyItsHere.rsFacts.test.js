// RS screens (unit U5), item 8: fact notes in the why strip. They follow the screen's own filter
// checks, are never ticks, and stay inside the strip's maximum of five.
import { expect, test } from 'vitest'
import { whyItsHere, FACT_SLOTS } from '../whyItsHere'
import { rowFacts } from '../rsRows'
import { TOP_RATING, LEADERS, RS_ROWS } from './rsScreensFixture'

const META = [
  { key: 'price', label: 'Price', type: 'range', unit: '$', presets: [] },
  { key: 'dollar_vol_30d', label: 'Dollar volume', type: 'range', unit: '$', presets: [] },
  { key: 'rs_rating_pos', label: 'RS Rating place', type: 'range', presets: [] },
  { key: 'rs_rank', label: 'RS Rank', type: 'range', presets: [] },
  { key: 'adr_pct', label: 'ADR', type: 'range', unit: '%', presets: [] },
  { key: 'market_cap', label: 'Market cap', type: 'range', unit: '$', presets: [] },
]
const keyed = spec => Object.fromEntries(spec.filters.map(({ key, ...r }) => [key, r]))
const mu = { ...RS_ROWS[1], price: 100, dollar_vol_30d: 5e7, adr_pct: 4, market_cap: 9e9, security_type: 'Stock' }
const FACTS = ['Extended', 'RS high 3 sessions ago', '6% below its high', 'RS Rating place 120 of 1,931']

test('without facts the strip is what it was', () => {
  const a = whyItsHere({ filters: keyed(TOP_RATING.spec), metaFilters: META, row: mu })
  const b = whyItsHere({ filters: keyed(TOP_RATING.spec), metaFilters: META, row: mu, facts: null })
  const c = whyItsHere({ filters: keyed(TOP_RATING.spec), metaFilters: META, row: mu, facts: [] })
  expect(b).toEqual(a)
  expect(c).toEqual(a)
  expect(a.items).toHaveLength(4)
  expect(a.more).toBe(0)
})

test('facts follow the filter checks, most distinctive first, as notes', () => {
  expect(rowFacts(mu).map(f => f.label)).toEqual(FACTS)
  const out = whyItsHere({ filters: { price: { op: 'gte', min: 10 } }, metaFilters: META, row: mu, facts: rowFacts(mu) })
  expect(out.items.map(i => i.kind)).toEqual(['check', 'note', 'note', 'note', 'note'])
  expect(out.items.slice(1).map(i => i.label)).toEqual(FACTS)
  expect(out.more).toBe(0)
  // a fact carries no value and no tick
  for (const f of out.items.slice(1)) { expect(f.value).toBeUndefined(); expect(f.kind).toBe('note') }
})

test('the strip never holds more than five, and facts keep the last places when checks would fill it', () => {
  expect(FACT_SLOTS).toBe(2)
  // Top RS Rating: four checks. Three stay, the two most distinctive facts follow, one check is "+1 more".
  const top = whyItsHere({ filters: keyed(TOP_RATING.spec), metaFilters: META, row: mu, facts: rowFacts(mu) })
  expect(top.items).toHaveLength(5)
  expect(top.items.map(i => i.kind)).toEqual(['check', 'check', 'check', 'note', 'note'])
  expect(top.items.slice(3).map(i => i.label)).toEqual(FACTS.slice(0, 2))
  expect(top.more).toBe(1)
  // UCT RS Leaders: ten filters and a rank note. Still five on the strip, two of them facts.
  const lead = whyItsHere({ filters: keyed(LEADERS.spec), rank: LEADERS.spec.rank, metaFilters: META, row: mu, facts: rowFacts(mu) })
  expect(lead.items).toHaveLength(5)
  expect(lead.items.slice(3).map(i => i.label)).toEqual(FACTS.slice(0, 2))
  // `more` counts only what the Filters drawer holds: the displaced filters and the rank note, never a fact
  const plain = whyItsHere({ filters: keyed(LEADERS.spec), rank: LEADERS.spec.rank, metaFilters: META, row: mu })
  expect(lead.more).toBe(plain.items.length + plain.more - 3)
})

test('a row with one fact gives up one place, a row with none gives up nothing', () => {
  const one = whyItsHere({ filters: keyed(TOP_RATING.spec), metaFilters: META, row: mu, facts: [{ kind: 'note', label: 'Extended' }] })
  expect(one.items.map(i => i.kind)).toEqual(['check', 'check', 'check', 'check', 'note'])
  expect(one.more).toBe(0)
  const none = whyItsHere({ filters: keyed(TOP_RATING.spec), metaFilters: META, row: mu, facts: rowFacts({}) })
  expect(none.items.map(i => i.kind)).toEqual(['check', 'check', 'check', 'check'])
})

test('a fact is never passed off as a check, whatever kind it arrives with', () => {
  const out = whyItsHere({ filters: {}, metaFilters: META, row: mu, facts: [{ kind: 'check', label: 'Extended', value: 'x' }, null, { kind: 'note' }] })
  expect(out.items).toEqual([{ kind: 'note', label: 'Extended' }])
})
