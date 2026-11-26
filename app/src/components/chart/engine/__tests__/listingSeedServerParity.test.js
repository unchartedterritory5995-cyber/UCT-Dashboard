// ─── ⭐⭐ e100 (2026-11-26) — ONE LISTING RULE, TWO HOSTS ─────────────────────────────────────────────────────────
//
// A member's daily chart runs a script from the listing when `listingSeed.historyFromListingOf` says bar 0 is the
// listing day (against `listingReferenceDate` of the `/api/ticker-ipo` payload). The alert lane and the single-symbol
// strategy route ask the SAME question on the server, through a Python port (`api/services/listing_history.py`). Both
// hosts read `tests/fixtures/listing_rule_parity.json`: this rail holds the chart's functions to it, and
// `tests/test_listing_history.py` holds the port to it, so a change to either side turns one rail red.
// (`server` and its finality condition are the Python rail's; `chartServed` pins the chart's serving switch, which
// differs from the rule only on a weekly chart, a gap the fixture names.)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { historyFromListingOf, listingReferenceDate, servedFromListingOf } from '../listingSeed.js'

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../tests/fixtures/listing_rule_parity.json')
const { schema, cases } = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

describe('e100 listing rule parity (the chart side of tests/fixtures/listing_rule_parity.json)', () => {
  it('reads the shared fixture', () => {
    expect(schema).toBe('uct.listing-rule-parity/v1')
    expect(cases.length).toBeGreaterThanOrEqual(15)
    // both arms of the rule are exercised, so the rail can tell a true from a false
    expect(cases.some((c) => c.rule === true)).toBe(true)
    expect(cases.some((c) => c.rule === false)).toBe(true)
  })

  for (const c of cases) {
    it(`PARITY ${c.name}`, () => {
      const listDate = listingReferenceDate(c.ipo)
      expect(listDate).toBe(c.reference)
      expect(historyFromListingOf({ bars: c.bars, tf: c.tf, listDate })).toBe(c.rule)
      expect(servedFromListingOf({ bars: c.bars, tf: c.tf, listDate })).toBe(c.chartServed)
      // the server's answer is never looser than the chart's rule
      if (c.server) expect(c.rule).toBe(true)
    })
  }
})
