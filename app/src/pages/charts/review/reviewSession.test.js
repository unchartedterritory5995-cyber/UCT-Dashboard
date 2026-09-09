// @vitest-environment node
/* The review-session contract, pinned.
 *
 * ⛔ The lifecycle cases are the ones worth guarding: a session that lies about
 * position, wraps silently, or survives into an unrelated symbol is worse than
 * no session at all — it puts a confident "12 of 47" next to a chart that is not
 * part of any review.
 */
import { describe, it, expect } from 'vitest'
import {
  enter, step, position, syncToSymbol, reconcile, adopt,
  currentSymbol, nextSymbol, prevSymbol, normaliseSymbols, neighbours,
  read, write, clear, STORAGE_KEY,
} from './reviewSession'

const LIST = ['NVDA', 'AMD', 'AVGO', 'MU']
const mk = (symbol = 'AMD') => enter({ source: 'scan', sourceId: 's1', label: 'Momentum', symbols: LIST, symbol })

/** A sessionStorage stand-in — node env has none. */
const memStore = () => {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => m,
  }
}

describe('ENTER', () => {
  it('captures order, identity and the opened position', () => {
    const s = mk('AVGO')
    expect(s.symbols).toEqual(LIST)
    expect(s.index).toBe(2)
    expect(currentSymbol(s)).toBe('AVGO')
    expect(s.label).toBe('Momentum')
    expect(s.source).toBe('scan')
  })

  it('⛔ refuses to build a session that would lie — symbol not in the list', () => {
    expect(enter({ symbols: LIST, symbol: 'TSLA' })).toBeNull()
  })

  it('⛔ refuses an empty list rather than reporting "1 / 0"', () => {
    expect(enter({ symbols: [], symbol: 'NVDA' })).toBeNull()
    expect(enter({ symbols: LIST, symbol: '' })).toBeNull()
  })

  it('dedupes and upper-cases while PRESERVING the caller’s visual order', () => {
    expect(normaliseSymbols([' nvda ', 'AMD', 'nvda', null, 'MU'])).toEqual(['NVDA', 'AMD', 'MU'])
  })
})

describe('position + boundaries', () => {
  it('reports a 1-based label over a 0-based index', () => {
    const p = position(mk('NVDA'))
    expect(p).toMatchObject({ index: 0, total: 4, canPrev: false, canNext: true, label: '1 / 4' })
  })

  it('the last item can go back but not forward', () => {
    expect(position(mk('MU'))).toMatchObject({ canPrev: true, canNext: false, label: '4 / 4' })
  })

  it('an absent session degrades to an empty position, never a throw', () => {
    expect(() => position(null)).not.toThrow()
    expect(position(null).total).toBe(0)
  })
})

describe('NEXT / PREV', () => {
  it('advances and retreats by one', () => {
    const s = mk('AMD')
    expect(currentSymbol(step(s, 1))).toBe('AVGO')
    expect(currentSymbol(step(s, -1))).toBe('NVDA')
    expect(nextSymbol(s)).toBe('AVGO')
    expect(prevSymbol(s)).toBe('NVDA')
  })

  it('⛔⛔ DOES NOT WRAP — a finite review must be able to END', () => {
    expect(step(mk('MU'), 1)).toBeNull()
    expect(step(mk('NVDA'), -1)).toBeNull()
  })

  it('⛔ a boundary returns null, which the caller must read as "nothing happened"', () => {
    // If a caller mistook null for "clear the session", hitting the end of a scan
    // would silently destroy the review context instead of disabling a button.
    const atEnd = mk('MU')
    expect(step(atEnd, 1)).toBeNull()
    expect(currentSymbol(atEnd)).toBe('MU')      // untouched
  })

  it('records progress as symbols are visited', () => {
    const s = step(step(mk('NVDA'), 1), 1)
    expect(s.reviewed).toEqual(['NVDA', 'AMD', 'AVGO'])
  })
})

describe('EXIT vs re-index — a symbol arriving from elsewhere', () => {
  it('a symbol INSIDE the set re-indexes and keeps the review alive', () => {
    const s = syncToSymbol(mk('NVDA'), 'MU')
    expect(s.index).toBe(3)
    expect(position(s).label).toBe('4 / 4')
  })

  it('⛔⛔ a symbol OUTSIDE the set EXITS — no stale "12 of 47" on an unrelated chart', () => {
    expect(syncToSymbol(mk('NVDA'), 'TSLA')).toBeNull()
  })

  it('the same symbol is a no-op, not a progress event', () => {
    const s = mk('AMD')
    expect(syncToSymbol(s, 'AMD')).toBe(s)
  })
})

describe('REFRESH — the list moved while reviewing', () => {
  it('⭐ follows the SYMBOL, not the index', () => {
    // Re-pointing at "position 1" of a re-sorted list would show a different
    // company while the chart still displayed the old one.
    const s = mk('AVGO')                                  // index 2 of NVDA,AMD,AVGO,MU
    const next = reconcile(s, ['MU', 'AVGO', 'NVDA'])     // AVGO is now index 1
    expect(next.index).toBe(1)
    expect(currentSymbol(next)).toBe('AVGO')
    expect(position(next).label).toBe('2 / 3')
  })

  it('⛔ the review ENDS when the current symbol leaves the list', () => {
    expect(reconcile(mk('AVGO'), ['NVDA', 'AMD'])).toBeNull()
  })

  it('⛔ and ends on an emptied list rather than reporting a phantom total', () => {
    expect(reconcile(mk('AVGO'), [])).toBeNull()
  })
})

describe('the handoff flag', () => {
  it('a same-page entry is adopted from the start', () => {
    // The watchlist sets the symbol in the same gesture that enters, so its
    // session is never waiting on anything.
    expect(mk('AMD').pending).toBe(false)
  })

  it('an entry made from another page starts pending', () => {
    const s = enter({ source: 'scan', symbols: LIST, symbol: 'AMD', pending: true })
    expect(s.pending).toBe(true)
  })

  it('⛔ ONLY an explicit `true` — a truthy value does not buy a wait state', () => {
    // The flag suppresses the EXIT rule. Anything that can slip into it by
    // accident (a string, an object, a stray 1) would suppress it by accident.
    expect(enter({ symbols: LIST, symbol: 'AMD', pending: 'yes' }).pending).toBe(false)
    expect(enter({ symbols: LIST, symbol: 'AMD', pending: 1 }).pending).toBe(false)
  })

  it('adopt clears it, and is a no-op on an already-adopted session', () => {
    const p = enter({ symbols: LIST, symbol: 'AMD', pending: true })
    expect(adopt(p).pending).toBe(false)
    const done = adopt(p)
    expect(adopt(done)).toBe(done)          // same object — nothing to change
    expect(adopt(null)).toBe(null)
  })

  it('⭐ adoption changes NOTHING else about the review', () => {
    const p = enter({ source: 'scan', symbols: LIST, symbol: 'AVGO', pending: true })
    const a = adopt(p)
    expect(a.symbols).toEqual(p.symbols)
    expect(a.index).toBe(p.index)
    expect(a.source).toBe(p.source)
    expect(a.reviewed).toEqual(p.reviewed)
  })
})

describe('persistence is defensive', () => {
  it('round-trips through a store', () => {
    const store = memStore()
    write(mk('AMD'), store)
    expect(currentSymbol(read(store))).toBe('AMD')
  })

  it('⛔ malformed stored state reads as "no review", never a throw', () => {
    const store = memStore()
    for (const bad of ['{', 'null', '{}', '{"symbols":[]}', '{"symbols":"NVDA"}', '[]']) {
      store.setItem(STORAGE_KEY, bad)
      expect(() => read(store)).not.toThrow()
      expect(read(store)).toBeNull()
    }
  })

  it('an out-of-range stored index is clamped rather than trusted', () => {
    const store = memStore()
    store.setItem(STORAGE_KEY, JSON.stringify({ v: 1, symbols: LIST, index: 99 }))
    expect(read(store).index).toBe(3)
  })

  it('clear removes it', () => {
    const store = memStore()
    write(mk(), store)
    clear(store)
    expect(read(store)).toBeNull()
  })

  it('NON-VACUITY · the same store DOES return a healthy session', () => {
    const store = memStore()
    store.setItem(STORAGE_KEY, JSON.stringify(mk('MU')))
    expect(read(store)).not.toBeNull()
  })
})


describe('the prefetch window', () => {
  it('⭐ is ASYMMETRIC — 2 ahead, 1 behind, in drain order', () => {
    // Reviewers move forward far more than back, and the queue drains in order,
    // so the very next symbol must be warmed FIRST.
    expect(neighbours(mk('AMD'))).toEqual(['AVGO', 'MU', 'NVDA'])
  })

  it('⛔ never returns the whole list — the shared queue caps at three', () => {
    const big = enter({ symbols: Array.from({ length: 50 }, (_, i) => `S${i}`), symbol: 'S10' })
    expect(neighbours(big)).toHaveLength(3)
  })

  it('shrinks at the ends rather than padding with nulls', () => {
    expect(neighbours(mk('NVDA'))).toEqual(['AMD', 'AVGO'])   // nothing behind
    expect(neighbours(mk('MU'))).toEqual(['AVGO'])            // nothing ahead
  })

  it('an absent session warms nothing', () => {
    expect(neighbours(null)).toEqual([])
    expect(neighbours({})).toEqual([])
  })
})
