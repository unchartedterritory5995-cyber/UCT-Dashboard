/**
 * Trades surface — groups the existing Open Positions + Trade Journal tabs as
 * two segments of ONE surface (spec §2, "nav moves once"). The two tabs are
 * NOT merged — the segment toggle just picks which existing tab renders. The
 * unified single-table + server pagination is P5.
 *
 * Segment state lives in the URL (`?seg=open|closed|all`, default open) so it
 * deep-links + survives back/forward nav. `settings` comes from the
 * JournalLayout Outlet context (loaded once at the shell).
 *
 * The `All` segment (B5) renders the SAME paginated closed-trades server list as
 * `Closed Trades` — for v1 `All` ≈ the closed-trades view. The true one-table
 * union of open positions + closed trades is DEFERRED (open positions and closed
 * trades share few columns), so there is no combined table here yet.
 */

import { useCallback } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import OpenPositionsTab from '../tabs/OpenPositionsTab'
import TradeJournalTab from '../tabs/TradeJournalTab'
import styles from '../JournalLayout.module.css'

export default function TradesSurface() {
  const { settings } = useOutletContext() || {}
  const [searchParams, setSearchParams] = useSearchParams()
  const rawSeg = searchParams.get('seg')
  const seg = rawSeg === 'closed' ? 'closed' : rawSeg === 'all' ? 'all' : 'open'

  const setSeg = useCallback(
    (next) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next === 'open') p.delete('seg')
          else p.set('seg', next)
          return p
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return (
    <div>
      <div className={styles.segBar} role="tablist" aria-label="Trades view">
        <button
          type="button"
          role="tab"
          aria-selected={seg === 'open'}
          className={`${styles.segBtn} ${seg === 'open' ? styles.segBtnActive : ''}`}
          onClick={() => setSeg('open')}
        >
          Open Positions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={seg === 'closed'}
          className={`${styles.segBtn} ${seg === 'closed' ? styles.segBtnActive : ''}`}
          onClick={() => setSeg('closed')}
        >
          Closed Trades
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={seg === 'all'}
          className={`${styles.segBtn} ${seg === 'all' ? styles.segBtnActive : ''}`}
          onClick={() => setSeg('all')}
        >
          All
        </button>
      </div>

      {seg === 'open' ? (
        <OpenPositionsTab settings={settings} onTradeWritten={() => setSeg('closed')} />
      ) : (
        // 'closed' AND 'all' both render the paginated closed-trades list. `All`
        // == closed-trades server list for v1 (open+closed union deferred).
        <TradeJournalTab settings={settings} />
      )}
    </div>
  )
}
