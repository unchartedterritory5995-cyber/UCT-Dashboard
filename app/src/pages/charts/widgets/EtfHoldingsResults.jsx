// ETF holdings rendered through the REAL scanner/watchlist table (same as
// Custom-Period Sort), so it's identical in look AND features — live prices, flag,
// sort, resizable/addable columns, settings. Default columns: Flag · Symbol ·
// % Change (LIVE daily) · Weight % · Industry, sorted by weight (top holdings first).
// Weight comes from /api/etf/holdings via metaOverride; prices/industry from the
// watchlist's own live + meta layers.
import { useMemo, useCallback, useId, useRef, useEffect } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import Watchlists from '../../Watchlists'
import UIcon from '../../../components/ui/UIcon'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'
import { prefetchListDeep } from '../../../utils/prefetchBars'
import styles from './ScannerResults.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

// Flag · Symbol · % Change (live) · Weight % · Industry. Sorted by weight desc so the
// fund's biggest positions lead. Wide industry so long labels don't clip.
const DEFAULT_COLS = { order: ['flag', 'sym', 'chg', 'weight', 'industry'], sort: { key: 'weight', dir: 'desc' }, widths: { flag: 18, industry: 200 } }

export default function EtfHoldingsResults({ sym, color, settingsOverride = null, onSettingsPersist = null }) {
  const { groupSyms, setGroupSym } = useWorkspace() || {}
  const widgetId = useId()
  const setSym = useCallback((s) => { if (color) setGroupSym?.(color, s) }, [color, setGroupSym])
  const scopedSymContext = useMemo(() => ({ sym: color ? groupSyms?.[color] : null, setSym }), [groupSyms, color, setSym])

  const etf = (sym || '').toUpperCase()
  const { data, mutate, isValidating } = useMobileSWR(
    etf ? `/api/etf/holdings/${encodeURIComponent(etf)}` : null, fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )
  const holdings = data?.holdings || null

  const symbols = useMemo(() => (holdings || []).map((h) => h.sym), [holdings])
  const metaOverride = useMemo(() => {
    if (!holdings) return null
    const out = {}
    for (const h of holdings) out[h.sym] = { weight: h.weight, name: h.name || null }
    return out
  }, [holdings])

  // Warm the deep (zoomed-out) history for the holdings so opening one is instant.
  const _warmedRef = useRef(null)
  useEffect(() => {
    if (!symbols.length || _warmedRef.current === etf) return
    _warmedRef.current = etf
    prefetchListDeep(symbols)
  }, [symbols, etf])

  const title = `${etf} Holdings`
  const scanCriteria = useMemo(() => [`Holdings of ${etf}`, 'Live prices · weight in fund'], [etf])
  const scanEmptyText = !data ? 'Loading…' : 'No holdings found for this ETF.'
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
        widgetKey={widgetId}
        ephemeralCols
        scanEmptyText={scanEmptyText}
        defaultColCfg={DEFAULT_COLS}
        metaOverride={metaOverride}
        scanFooter={scanFooter}
        scanCriteria={scanCriteria}
      />
    </ChartsSymContext.Provider>
  )
}
