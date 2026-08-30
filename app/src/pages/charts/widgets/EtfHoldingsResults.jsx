// ETF holdings rendered through the REAL scanner/watchlist table (same as
// Custom-Period Sort), so it's identical in look AND features — live prices, flag,
// sort, resizable/addable columns, settings. Default columns: Flag · Symbol ·
// % Change (LIVE daily) · Weight % · Industry, sorted by weight (top holdings first).
// Weight/sector/industry come from /api/etf/holdings via metaOverride (industry is
// resolved server-side from the universe-wide industry_map, not the watchlist's own
// meta-batch layer — that path caps at 100 alphabetically-sorted symbols and would
// leave most of a >100-holding ETF blank); price/% chg still come from the
// watchlist's own live layer.
import { useMemo, useCallback, useId, useRef, useEffect } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import Watchlists from '../../Watchlists'
import UIcon from '../../../components/ui/UIcon'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'
import { prefetchListDeep } from '../../../utils/prefetchBars'
import styles from './ScannerResults.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

// ETF: Flag · Symbol · % Change (live) · Weight % · Industry, sorted by weight desc
// so the fund's biggest positions lead. A THEMATIC INDEX ($IDX:) is equal-weight, so
// the weight column is uninformative — drop it and sort by the live daily move.
const DEFAULT_COLS = { order: ['flag', 'sym', 'chg', 'weight', 'industry'], sort: { key: 'weight', dir: 'desc' }, widths: { flag: 18, industry: 200 } }
const DEFAULT_COLS_IDX = { order: ['flag', 'sym', 'chg', 'industry'], sort: { key: 'chg', dir: 'desc' }, widths: { flag: 18, industry: 200 } }

export default function EtfHoldingsResults({ sym, color, settingsOverride = null, onSettingsPersist = null }) {
  const { groupSyms, setGroupSym, activeWatchlistRef } = useWorkspace() || {}
  const widgetId = useId()
  const setSym = useCallback((s) => { if (color) setGroupSym?.(color, s) }, [color, setGroupSym])
  const scopedSymContext = useMemo(() => ({ sym: color ? groupSyms?.[color] : null, setSym }), [groupSyms, color, setSym])

  // A thematic-index pseudo-ticker ("$IDX:<slug>") lists the THEME's holdings (its
  // merged owner+engine basket) from the theme-index endpoint; a normal symbol is an
  // ETF and lists fund holdings. Both render through the same table.
  const isIdx = typeof sym === 'string' && sym.startsWith('$IDX:')
  const etf = (sym || '').toUpperCase()
  const idxSlug = isIdx ? sym.slice(5).toLowerCase() : null
  const url = isIdx
    ? `/api/theme-index/${encodeURIComponent(idxSlug)}/holdings`
    : (etf ? `/api/etf/holdings/${encodeURIComponent(etf)}` : null)
  const { data, mutate, isValidating } = useMobileSWR(
    url, fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )
  const holdings = data?.holdings || null

  const symbols = useMemo(() => (holdings || []).map((h) => h.sym), [holdings])
  const metaOverride = useMemo(() => {
    // Theme baskets are <= 60 symbols (under the meta-batch cap), so let the
    // watchlist's own meta layer resolve name/sector/industry — the endpoint only
    // carries the equal weight, which we don't display for an index.
    if (!holdings || isIdx) return null
    const out = {}
    for (const h of holdings) {
      out[h.sym] = { weight: h.weight, name: h.name || null, sector: h.sector || null, industry: h.industry || null }
    }
    return out
  }, [holdings, isIdx])

  // Warm the deep (zoomed-out) history for the holdings so opening one is instant.
  const _warmedRef = useRef(null)
  useEffect(() => {
    if (!symbols.length || _warmedRef.current === etf) return
    _warmedRef.current = etf
    prefetchListDeep(symbols)
  }, [symbols, etf])

  const title = isIdx ? `${data?.name || 'Theme'} Index Holdings` : `${etf} Holdings`
  const scanCriteria = useMemo(() => (
    isIdx
      ? [`Stocks in the ${data?.name || 'theme'} equal-weight index`, 'Live prices · updates with the Theme Tracker']
      : [`Holdings of ${etf}`, 'Live prices · weight in fund']
  ), [isIdx, data?.name, etf])
  const scanEmptyText = !data ? 'Loading…' : (isIdx ? 'No holdings found for this index.' : 'No holdings found for this ETF.')
  const scanFooter = (
    <div className={styles.scanFooter}>
      <span className={styles.scanCount}>{symbols.length.toLocaleString()} {symbols.length === 1 ? 'holding' : 'holdings'}</span>
      <button type="button" className={styles.scanRefresh} onClick={() => mutate()} title="Refresh" aria-label="Refresh">
        <UIcon name="refresh" size={12} gold={false} className={isValidating ? styles.scanRefreshSpin : undefined} />
      </button>
    </div>
  )

  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <Watchlists
        embedded
        pickList="__scan__"
        scanSymbols={symbols}
        pickName={title}
        settingsOverride={settingsOverride}
        onSettingsPersist={onSettingsPersist}
        // ⛔⛔ `activeRef` TRAVELS WITH `widgetKey` OR THE WIDGET NEVER LOSES THE KEYBOARD.
        // Watchlists reads them as a PAIR: `isActiveWidget()` is `!activeRef || ...`,
        // so passing the key alone leaves this widget permanently "active" — it answers
        // every Shift+F and every arrow no matter which widget you are actually in — while
        // `markActiveWidget()` (`if (activeRef && widgetKey)`) can never fire, so it cannot
        // claim the lock either. With a scan widget open beside a watchlist, ONE Shift+F
        // flagged in BOTH. WatchlistWidget and ThemesWidget always passed both. 2026-08-29.
        activeRef={activeWatchlistRef}
        widgetKey={widgetId}
        ephemeralCols
        scanEmptyText={scanEmptyText}
        defaultColCfg={isIdx ? DEFAULT_COLS_IDX : DEFAULT_COLS}
        metaOverride={metaOverride}
        scanFooter={scanFooter}
        scanCriteria={scanCriteria}
      />
    </ChartsSymContext.Provider>
  )
}
