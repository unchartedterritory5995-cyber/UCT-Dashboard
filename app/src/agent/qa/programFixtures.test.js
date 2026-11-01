// agent-qa — the browser loader for the program fixtures sees what the Python generator wrote.
// (tests/test_uct_agent_qa_fixtures.py is the authority and validates every envelope with the server's
// validate_envelope; this file proves the browser side loads the same set and that it reads honestly.)
import { describe, it, expect } from 'vitest'
import { loadFixture, casesFor, allFixtures, KINDS, CASES } from '../__fixtures__/program'
import { CONTRACT, FRESHNESS } from '../marketdata/client'

const REQUIRED = ['contract', 'kind', 'params_echo', 'status', 'freshness', 'as_of', 'fetched_at', 'delay_s',
  'stale', 'source', 'coverage', 'data', 'notes', 'provider_calls']
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

describe('agent-qa program fixtures (browser loader)', () => {
  it('loads every MD-1 v1 and SC-1 kind', () => {
    expect(Object.keys(KINDS).sort()).toEqual([
      'bars.daily', 'bars.intraday', 'breadth.current', 'earnings', 'fundamentals', 'news.company', 'nhnl',
      'quote', 'quotes', 'ratings', 'screen.count', 'screen.run', 'screen.saved', 'themes', 'volume.surge'])
    const all = allFixtures()
    expect(all.length).toBeGreaterThan(Object.keys(KINDS).length)          // non-vacuity: many cases per kind
    expect(new Set(all.map(([, c]) => c))).toEqual(new Set(CASES))
  })

  it('every envelope has the MD-1 shape and an honest freshness', () => {
    for (const [kind, c, e] of allFixtures()) {
      for (const k of REQUIRED) expect(e, `${kind}/${c} ${k}`).toHaveProperty(k)
      expect(e.contract).toBe(CONTRACT)
      expect(FRESHNESS).toContain(e.freshness)
      expect(e.fetched_at).toMatch(ISO_Z)
      if (e.as_of !== null) expect(e.as_of).toMatch(ISO_Z)
      else expect(e.notes.length).toBeGreaterThan(0)
      if (e.status === 'ok' || e.status === 'partial') {
        expect(FRESHNESS.indexOf(e.freshness), `${kind}/${c}`).toBeGreaterThanOrEqual(FRESHNESS.indexOf(KINDS[kind].declared_freshness))
      } else {
        expect(e.data).toBeNull()
        expect(e.freshness).toBe('unavailable')
      }
    }
  })

  it('a market-closed quote is historical, never live', () => {
    const e = loadFixture('quote', 'market-closed')
    expect(e.freshness).toBe('historical')
    expect(e.notes.join(' ')).toMatch(/market closed/)
  })

  it('returns copies and refuses an unknown case', () => {
    const a = loadFixture('quote'); a.data.price = -1
    expect(loadFixture('quote').data.price).toBe(207.04)
    expect(() => loadFixture('quote', 'periodic')).toThrow()
    expect(casesFor('screen.run')).toContain('partial')
  })
})
