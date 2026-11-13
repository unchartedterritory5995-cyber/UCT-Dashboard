import { describe, it, expect } from 'vitest'
import { rsExitBadge, rsExitSortValue, RS_EXIT_RECENT_SESSIONS } from './rsExitBadge'
import { EXTRA_COLS, COL_LABELS, resolveColumn } from './watchlistColumns'
import { watchlistRsExitKey } from '../../hooks/useWatchlistRsExit'

describe('the Watchlist RS Exit cell', () => {
  it('colours each warning by severity and says how long ago', () => {
    expect(rsExitBadge({ last: 'Quick Break', bars_ago: 0 })).toMatchObject({ recent: true, tone: 'quick', text: 'Quick Break · today' })
    expect(rsExitBadge({ last: 'Quicksand', bars_ago: 3 })).toMatchObject({ recent: true, tone: 'sand', text: 'Quicksand · 3d' })
    expect(rsExitBadge({ last: 'Grateful Dead Break', bars_ago: 1 })).toMatchObject({ recent: true, tone: 'dead', text: 'GD Break · 1d' })
  })

  it('the tooltip names the warning in sessions and never reads as an order to sell', () => {
    const t = rsExitBadge({ last: 'Quicksand', bars_ago: 3 }).title
    expect(t).toMatch(/^Quicksand, 3 sessions ago\./)
    expect(t).toContain('not an order to sell')
    expect(t).toContain('Webster')
    expect(rsExitBadge({ last: 'Quick Break', bars_ago: 1 }).title).toMatch(/^Quick Break, 1 session ago\./)
  })

  it('an old warning is a muted dash whose tooltip still names it', () => {
    const old = rsExitBadge({ last: 'Quicksand', bars_ago: RS_EXIT_RECENT_SESSIONS + 1 })
    expect(old).toMatchObject({ recent: false, tone: null, text: '' })
    expect(old.title).toContain('Quicksand, 21 sessions ago')
    expect(rsExitBadge({ last: 'Quicksand', bars_ago: RS_EXIT_RECENT_SESSIONS }).recent).toBe(true)
  })

  it('no warning, no data, or a name it does not know shows nothing', () => {
    expect(rsExitBadge(null)).toMatchObject({ recent: false, text: '', title: '' })
    expect(rsExitBadge({ last: null, bars_ago: null })).toMatchObject({ recent: false, text: '' })
    expect(rsExitBadge({ last: 'Sell now', bars_ago: 1 }).recent).toBe(false)
    expect(rsExitBadge({ last: 'Quicksand', bars_ago: -1 }).recent).toBe(false)
  })

  it('sorts newer warnings first on the first (descending) click and sinks the rest', () => {
    const vals = [{ last: 'Quicksand', bars_ago: 5 }, { last: 'Quick Break', bars_ago: 0 }, null, { last: 'Quicksand', bars_ago: 40 }]
      .map(rsExitSortValue)
    expect(vals).toEqual([-5, -0, null, null])
    expect(vals[1] > vals[0]).toBe(true)
  })

  it('is a column the + menu offers and a member can name', () => {
    expect(EXTRA_COLS.some(c => c.key === 'rsexit')).toBe(true)
    expect(COL_LABELS.rsexit).toEqual(['RS Exit Warning', 'RS Exit'])
    expect(resolveColumn('RS Exit')).toBe('rsexit')
  })

  it('asks the batch under one sorted key, and asks nothing for no tickers', () => {
    expect(watchlistRsExitKey(['NVDA', 'AAPL', 'NVDA'])).toEqual(['/api/watchlists/rs-exit-batch', ['AAPL', 'NVDA']])
    expect(watchlistRsExitKey([])).toBe(null)
  })
})
