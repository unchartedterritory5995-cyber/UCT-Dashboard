import { describe, it, expect } from 'vitest'
import {
  EMPTY_SCOPE,
  SCOPE_VERSION,
  DEFAULT_PAGE_SIZE,
  scopeToSearchParams,
  scopeFromSearchParams,
  scopeToApiParams,
  scopeIsActive,
  scopeActiveCount,
} from './scope.js'

// A fresh, fully-shaped scope built off EMPTY_SCOPE so deep-equal round-trips
// compare exactly the 7 canonical keys.
const mk = (over = {}) => ({
  acct: null, from: null, to: null, symbol: null,
  sides: [], setups: [], tags: [],
  ...over,
})

describe('constants', () => {
  it('SCOPE_VERSION is 1', () => expect(SCOPE_VERSION).toBe(1))

  it('EMPTY_SCOPE has the canonical shape', () => {
    expect(EMPTY_SCOPE).toEqual({
      acct: null, from: null, to: null, symbol: null,
      sides: [], setups: [], tags: [],
    })
  })

  it('EMPTY_SCOPE is frozen (arrays too) so a shared const cannot be mutated', () => {
    expect(Object.isFrozen(EMPTY_SCOPE)).toBe(true)
    expect(Object.isFrozen(EMPTY_SCOPE.sides)).toBe(true)
    // parse must hand back a FRESH, mutable copy — never the frozen const.
    const parsed = scopeFromSearchParams(new URLSearchParams())
    expect(parsed).not.toBe(EMPTY_SCOPE)
    expect(Object.isFrozen(parsed)).toBe(false)
    expect(() => parsed.sides.push('Long')).not.toThrow()
  })
})

describe('scopeToSearchParams — canonical namespaced keys', () => {
  it('scalar facets map to sc_acct/sc_from/sc_to/sc_sym + sc_v', () => {
    const p = scopeToSearchParams(mk({ acct: '42', from: '2026-01-01', to: '2026-02-01', symbol: 'AAPL' }))
    expect(p.get('sc_acct')).toBe('42')
    expect(p.get('sc_from')).toBe('2026-01-01')
    expect(p.get('sc_to')).toBe('2026-02-01')
    expect(p.get('sc_sym')).toBe('AAPL')
    expect(p.get('sc_v')).toBe('1')
  })

  it('multi-value facets map to sc_side/sc_setup/sc_tag comma-joined', () => {
    const p = scopeToSearchParams(mk({ sides: ['Long', 'Short'], setups: ['VCP'], tags: ['fomo', 'revenge'] }))
    expect(p.get('sc_side')).toBe('Long,Short')
    expect(p.get('sc_setup')).toBe('VCP')
    expect(p.get('sc_tag')).toBe('fomo,revenge')
    expect(p.get('sc_v')).toBe('1')
  })

  it('empty/null facets emit NO key', () => {
    const p = scopeToSearchParams(mk({ symbol: 'TSLA' }))
    expect(p.has('sc_acct')).toBe(false)
    expect(p.has('sc_from')).toBe(false)
    expect(p.has('sc_side')).toBe(false)
    expect(p.has('sc_setup')).toBe(false)
    expect(p.has('sc_tag')).toBe(false)
    expect(p.get('sc_sym')).toBe('TSLA')
  })

  it('empty scope → ZERO params (and no sc_v)', () => {
    const p = scopeToSearchParams(EMPTY_SCOPE)
    expect([...p.keys()]).toHaveLength(0)
    expect(p.has('sc_v')).toBe(false)
    expect(p.toString()).toBe('')
  })

  it('sc_v present iff the scope is non-empty', () => {
    expect(scopeToSearchParams(mk({ sides: ['Long'] })).get('sc_v')).toBe('1')
    expect(scopeToSearchParams(EMPTY_SCOPE).has('sc_v')).toBe(false)
  })
})

describe('scopeFromSearchParams', () => {
  it('missing facets fall back to EMPTY_SCOPE defaults', () => {
    const parsed = scopeFromSearchParams(new URLSearchParams('sc_sym=NVDA&sc_v=1'))
    expect(parsed).toEqual(mk({ symbol: 'NVDA' }))
  })

  it('ignores unknown / extra params (j2tab, calendar view/y/m/w)', () => {
    const parsed = scopeFromSearchParams(
      new URLSearchParams('j2tab=journal&view=month&y=2026&m=1&w=3&sc_sym=MSFT&sc_v=1&random=x')
    )
    expect(parsed).toEqual(mk({ symbol: 'MSFT' }))
  })

  it('splits + decodes multi-value members', () => {
    const parsed = scopeFromSearchParams(new URLSearchParams('sc_side=Long,Short&sc_tag=fomo,revenge'))
    expect(parsed.sides).toEqual(['Long', 'Short'])
    expect(parsed.tags).toEqual(['fomo', 'revenge'])
  })

  it('accepts any object exposing .get()', () => {
    const fake = { get: (k) => (k === 'sc_sym' ? 'AMD' : null) }
    expect(scopeFromSearchParams(fake)).toEqual(mk({ symbol: 'AMD' }))
  })
})

describe('round-trip: scopeFromSearchParams(scopeToSearchParams(s)) deep-equals s', () => {
  const cases = {
    'empty': EMPTY_SCOPE,
    'scalars only': mk({ acct: '7', from: '2026-03-01', to: '2026-03-31', symbol: 'AAPL' }),
    'multiple sides + tags': mk({ sides: ['Long', 'Short'], tags: ['fomo', 'revenge', 'fear'] }),
    'setup with a literal comma': mk({ setups: ['Break, retest', 'VCP'] }),
    'everything at once': mk({
      acct: '3', from: '2026-01-01', to: '2026-06-30', symbol: 'SMCI',
      sides: ['Long'], setups: ['Gap & Go, day 2'], tags: ['patient', 'disciplined'],
    }),
  }
  for (const [name, s] of Object.entries(cases)) {
    it(name, () => {
      expect(scopeFromSearchParams(scopeToSearchParams(s))).toEqual(s)
    })
  }

  it('survives a real stringify → reparse cycle (transport layer)', () => {
    const s = mk({ setups: ['Break, retest'], tags: ['a,b', 'c'] })
    const wire = scopeToSearchParams(s).toString()
    const reparsed = scopeFromSearchParams(new URLSearchParams(wire))
    expect(reparsed).toEqual(s)
  })
})

describe('literal comma in a facet member', () => {
  it('is protected as %2C inside the stored URL value', () => {
    const p = scopeToSearchParams(mk({ setups: ['a,b'] }))
    // Member-level encoding: the comma is %2C so the split boundary survives.
    expect(p.get('sc_setup')).toBe('a%2Cb')
  })

  it('round-trips through the URL codec', () => {
    const p = scopeToSearchParams(mk({ setups: ['a,b', 'c'] }))
    expect(scopeFromSearchParams(p).setups).toEqual(['a,b', 'c'])
  })

  it('survives scopeToApiParams — backend split(",")+unquote restores it', () => {
    const api = scopeToApiParams(mk({ setups: ['a,b', 'c'] }))
    expect(api.setups).toBe('a%2Cb,c')
    // Simulate parse_filter_query: split on comma, then unquote each member.
    const backend = api.setups.split(',').map((x) => decodeURIComponent(x))
    expect(backend).toEqual(['a,b', 'c'])
  })
})

describe('scopeToApiParams — snake_case for parse_filter_query', () => {
  it('maps camelCase UI keys → backend snake_case names (+ paging defaults)', () => {
    const api = scopeToApiParams(mk({
      acct: '9', from: '2026-01-01', to: '2026-02-01', symbol: 'AAPL',
      sides: ['Long', 'Short'], setups: ['VCP'], tags: ['fomo', 'revenge'],
    }))
    expect(api).toEqual({
      account_id: '9',
      date_from: '2026-01-01',
      date_to: '2026-02-01',
      symbol: 'AAPL',
      sides: 'Long,Short',
      setups: 'VCP',
      tags: 'fomo,revenge',
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
    })
  })

  it('omits FACET keys whose value is empty/null (but always emits paging)', () => {
    const api = scopeToApiParams(mk({ symbol: 'TSLA' }))
    expect(api).toEqual({ symbol: 'TSLA', limit: DEFAULT_PAGE_SIZE, offset: 0 })
    expect('account_id' in api).toBe(false)
    expect('date_from' in api).toBe(false)
    expect('sides' in api).toBe(false)
  })

  it('empty scope → paging defaults ONLY (no facet keys)', () => {
    expect(scopeToApiParams(EMPTY_SCOPE)).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 })
  })

  it('account_id present iff acct is set', () => {
    expect('account_id' in scopeToApiParams(mk({ acct: '1' }))).toBe(true)
    expect('account_id' in scopeToApiParams(mk())).toBe(false)
  })
})

describe('scopeToApiParams — pagination (limit + offset)', () => {
  it('DEFAULT_PAGE_SIZE is 50', () => expect(DEFAULT_PAGE_SIZE).toBe(50))

  it('emits DEFAULT_PAGE_SIZE limit + 0 offset when the scope carries neither', () => {
    const api = scopeToApiParams(mk({ symbol: 'AAPL' }))
    expect(api.limit).toBe(DEFAULT_PAGE_SIZE)
    expect(api.offset).toBe(0)
  })

  it('emits an EXPLICIT limit + offset from the scope', () => {
    const api = scopeToApiParams({ ...mk({ symbol: 'AAPL' }), limit: 25, offset: 100 })
    expect(api.limit).toBe(25)
    expect(api.offset).toBe(100)
  })

  it('an explicit offset of 0 is preserved (not treated as unset)', () => {
    const api = scopeToApiParams({ ...mk(), limit: 100, offset: 0 })
    expect(api.limit).toBe(100)
    expect(api.offset).toBe(0)
  })

  it('paging keys do NOT count toward scopeActiveCount / scopeIsActive', () => {
    const paged = { ...mk(), limit: 100, offset: 200 }
    expect(scopeActiveCount(paged)).toBe(0)
    expect(scopeIsActive(paged)).toBe(false)
  })
})

describe('scopeActiveCount + scopeIsActive', () => {
  it('empty scope → 0 / inactive', () => {
    expect(scopeActiveCount(EMPTY_SCOPE)).toBe(0)
    expect(scopeIsActive(EMPTY_SCOPE)).toBe(false)
  })

  it('each non-null scalar counts as 1', () => {
    expect(scopeActiveCount(mk({ acct: '1' }))).toBe(1)
    expect(scopeActiveCount(mk({ symbol: 'AAPL', from: '2026-01-01' }))).toBe(2)
  })

  it('each non-empty array counts as 1 (regardless of member count)', () => {
    expect(scopeActiveCount(mk({ sides: ['Long', 'Short'] }))).toBe(1)
    expect(scopeActiveCount(mk({ sides: ['Long'], setups: ['VCP'], tags: ['fomo'] }))).toBe(3)
  })

  it('acct counts as an active facet', () => {
    expect(scopeIsActive(mk({ acct: '5' }))).toBe(true)
  })

  it('empty-string scalars and empty arrays do NOT count', () => {
    expect(scopeActiveCount(mk({ symbol: '', sides: [] }))).toBe(0)
    expect(scopeIsActive(mk({ symbol: '' }))).toBe(false)
  })

  it('all seven facets set → 7', () => {
    expect(scopeActiveCount(mk({
      acct: '1', from: 'a', to: 'b', symbol: 'C',
      sides: ['Long'], setups: ['VCP'], tags: ['fomo'],
    }))).toBe(7)
  })

  it('scopeIsActive matches scopeActiveCount > 0', () => {
    const s = mk({ setups: ['VCP'] })
    expect(scopeIsActive(s)).toBe(scopeActiveCount(s) > 0)
  })
})
