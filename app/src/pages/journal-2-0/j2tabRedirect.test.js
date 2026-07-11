import { describe, it, expect } from 'vitest'
import { mapJ2TabToRoute } from './j2tabRedirect'

// Helper: build the URLSearchParams the way React Router hands them to us.
const sp = (qs) => new URLSearchParams(qs)

describe('mapJ2TabToRoute — tab → route mapping', () => {
  it('positions → /journal/trades?seg=open', () => {
    expect(mapJ2TabToRoute(sp('j2tab=positions'))).toEqual({
      path: '/journal/trades',
      search: '?seg=open',
    })
  })

  it('journal → /journal/trades?seg=closed', () => {
    expect(mapJ2TabToRoute(sp('j2tab=journal'))).toEqual({
      path: '/journal/trades',
      search: '?seg=closed',
    })
  })

  it('calendar → /journal/journal?seg=calendar', () => {
    expect(mapJ2TabToRoute(sp('j2tab=calendar'))).toEqual({
      path: '/journal/journal',
      search: '?seg=calendar',
    })
  })

  it('notebook → /journal/journal?seg=notebook', () => {
    expect(mapJ2TabToRoute(sp('j2tab=notebook'))).toEqual({
      path: '/journal/journal',
      search: '?seg=notebook',
    })
  })

  it('analytics → /journal/insights (no seg, no other params)', () => {
    expect(mapJ2TabToRoute(sp('j2tab=analytics'))).toEqual({
      path: '/journal/insights',
      search: '',
    })
  })

  it('accounts → /journal/accounts', () => {
    expect(mapJ2TabToRoute(sp('j2tab=accounts'))).toEqual({
      path: '/journal/accounts',
      search: '',
    })
  })

  it('compass → /journal/compass', () => {
    expect(mapJ2TabToRoute(sp('j2tab=compass'))).toEqual({
      path: '/journal/compass',
      search: '',
    })
  })

  it('community → /journal/community', () => {
    expect(mapJ2TabToRoute(sp('j2tab=community'))).toEqual({
      path: '/journal/community',
      search: '',
    })
  })
})

describe('mapJ2TabToRoute — querystring preservation', () => {
  it('analytics carries ins=edge → /journal/insights?ins=edge (EdgeScoreCard share)', () => {
    expect(mapJ2TabToRoute(sp('j2tab=analytics&ins=edge'))).toEqual({
      path: '/journal/insights',
      search: '?ins=edge',
    })
  })

  it('journal preserves scope params + appends seg (TradeDetailPage / PlaybookSection)', () => {
    const out = mapJ2TabToRoute(sp('j2tab=journal&sc_setup=VCP&sc_v=1'))
    expect(out.path).toBe('/journal/trades')
    // Scope params survive verbatim …
    const got = new URLSearchParams(out.search)
    expect(got.get('sc_setup')).toBe('VCP')
    expect(got.get('sc_v')).toBe('1')
    // … and the segment is set from the j2tab value.
    expect(got.get('seg')).toBe('closed')
    // j2tab itself is stripped.
    expect(got.has('j2tab')).toBe(false)
    // Full deterministic string (seg appended last).
    expect(out.search).toBe('?sc_setup=VCP&sc_v=1&seg=closed')
  })

  it('notebook preserves note=abc + seg=notebook (GlobalAddPositionProvider)', () => {
    const out = mapJ2TabToRoute(sp('j2tab=notebook&note=abc'))
    expect(out.path).toBe('/journal/journal')
    const got = new URLSearchParams(out.search)
    expect(got.get('note')).toBe('abc')
    expect(got.get('seg')).toBe('notebook')
    expect(got.has('j2tab')).toBe(false)
  })

  it('preserves multiple scope params on an insights share', () => {
    const out = mapJ2TabToRoute(
      sp('j2tab=analytics&ins=edge&sc_setup=Flag&sc_sym=NVDA&sc_v=1'),
    )
    expect(out.path).toBe('/journal/insights')
    const got = new URLSearchParams(out.search)
    expect(got.get('ins')).toBe('edge')
    expect(got.get('sc_setup')).toBe('Flag')
    expect(got.get('sc_sym')).toBe('NVDA')
    expect(got.get('sc_v')).toBe('1')
  })

  it('is order-independent — same result regardless of param order', () => {
    const a = mapJ2TabToRoute(sp('sc_v=1&j2tab=journal&sc_setup=VCP'))
    // Path + seg are stable; scope params survive regardless of input order.
    expect(a.path).toBe('/journal/trades')
    const got = new URLSearchParams(a.search)
    expect(got.get('sc_setup')).toBe('VCP')
    expect(got.get('sc_v')).toBe('1')
    expect(got.get('seg')).toBe('closed')
  })

  it('does not double-encode a value containing %2C (comma)', () => {
    // Consumer built the link from an already-encoded value (`VCP,Flag`).
    const out = mapJ2TabToRoute(sp('j2tab=journal&sc_setup=VCP%2CFlag&sc_v=1'))
    // Decoded value round-trips cleanly (single decode, single re-encode).
    const got = new URLSearchParams(out.search)
    expect(got.get('sc_setup')).toBe('VCP,Flag')
    // Serialized form is encoded exactly once — no `%252C`.
    expect(out.search).toContain('sc_setup=VCP%2CFlag')
    expect(out.search).not.toContain('%252C')
  })

  it('a raw comma in the value serializes encoded exactly once', () => {
    const out = mapJ2TabToRoute(sp('j2tab=analytics&ins=a,b'))
    const got = new URLSearchParams(out.search)
    expect(got.get('ins')).toBe('a,b')
    expect(out.search).not.toContain('%252C')
  })
})

describe('mapJ2TabToRoute — edge cases', () => {
  it('no j2tab → null (no redirect)', () => {
    expect(mapJ2TabToRoute(sp('foo=bar'))).toBeNull()
    expect(mapJ2TabToRoute(sp(''))).toBeNull()
  })

  it('empty j2tab value → null (no redirect)', () => {
    expect(mapJ2TabToRoute(sp('j2tab='))).toBeNull()
  })

  it('unknown j2tab → documented default /journal/trades?seg=open', () => {
    expect(mapJ2TabToRoute(sp('j2tab=xyz'))).toEqual({
      path: '/journal/trades',
      search: '?seg=open',
    })
  })

  it('unknown j2tab still preserves other params', () => {
    const out = mapJ2TabToRoute(sp('j2tab=xyz&sc_v=1'))
    expect(out.path).toBe('/journal/trades')
    const got = new URLSearchParams(out.search)
    expect(got.get('sc_v')).toBe('1')
    expect(got.get('seg')).toBe('open')
    expect(got.has('j2tab')).toBe(false)
  })

  it('null / non-searchParams input → null (defensive)', () => {
    expect(mapJ2TabToRoute(null)).toBeNull()
    expect(mapJ2TabToRoute(undefined)).toBeNull()
    expect(mapJ2TabToRoute({})).toBeNull()
  })

  it('segmented j2tab wins over an incoming seg param', () => {
    // A stale/conflicting seg is overridden by the j2tab-selected segment.
    const out = mapJ2TabToRoute(sp('j2tab=positions&seg=closed'))
    const got = new URLSearchParams(out.search)
    expect(got.get('seg')).toBe('open')
  })
})
