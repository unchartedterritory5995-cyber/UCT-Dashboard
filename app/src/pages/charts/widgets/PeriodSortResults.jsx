// Custom-Period Sort results, rendered through the REAL scanner/watchlist table (the same
// path ScannerResults uses) so it's identical in look AND features: every column, the +
// column menu, drag-resize gridlines, sort, flag-star, right-click ticker actions,
// per-widget appearance, live prices — for ALL ~4,900 US common stocks (the Watchlists
// scan-mode render is virtualized + streams only the visible window). Membership + the
// period % come from /api/scans/period-change; a row click publishes to the color group.
import { useMemo, useCallback, useId } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import Watchlists from '../../Watchlists'
import UIcon from '../../../components/ui/UIcon'
import { WL_COLS_LS } from '../../watchlist/watchlistTemplates'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'
import styles from './ScannerResults.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
const fmtYmd = (ymd) => { const s = String(ymd); return `${+s.slice(4, 6)}/${+s.slice(6, 8)}/${s.slice(0, 4)}` }
function fmtScanTime(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) } catch { return '' }
}

// Lead with the Period % column, sorted biggest-gainer first (users can re-sort / add cols).
const DEFAULT_COLS = { order: ['flag', 'sym', 'price', 'vol', 'periodchg'], sort: { key: 'periodchg', dir: 'desc' } }

export default function PeriodSortResults({ start, end, color, settingsOverride = null, onSettingsPersist = null, onExit = null }) {
  const { groupSyms, setGroupSym } = useWorkspace() || {}
  const widgetId = useId()

  const setSym = useCallback((s) => { if (color) setGroupSym?.(color, s) }, [color, setGroupSym])
  const scopedSymContext = useMemo(() => ({ sym: color ? groupSyms?.[color] : null, setSym }), [groupSyms, color, setSym])

  const url = start && end ? `/api/scans/period-change?start=${start}&end=${end}` : null
  const { data, mutate, isValidating } = useMobileSWR(url, fetcher, {
    refreshInterval: 30_000, dedupingInterval: 15_000, revalidateOnFocus: false,
  })

  // Backend returns rows already ranked; keep that as the symbol order (the table's default
  // sort is periodchg desc, which matches). Content-keyed so a 30s poll doesn't rebuild.
  const symKey = (data?.results || []).map((r) => r.sym).join(',')
  const symbols = useMemo(() => (symKey ? symKey.split(',') : []), [symKey])

  // The period % per symbol → the `periodchg` column via perfOverride (static: the period
  // is a fixed [start, end], so it doesn't recompute against the live price).
  const perfOverride = useMemo(() => {
    const rows = data?.results || []
    let out = null
    for (const r of rows) {
      if (r && r.period_change != null) (out ||= {})[r.sym] = { period: r.period_change }
    }
    return out
  }, [data])

  const scanEmptyText = !data ? 'Loading…' : data.status === 'computing' ? 'Ranking the market…' : 'No results.'
  const scanCriteria = useMemo(
    () => ['Every US Common Stock', start && end ? `% Change from ${fmtYmd(start)} to ${fmtYmd(end)}` : 'Ranked by % change over the period'],
    [start, end],
  )

  // Title carries the dates (e.g. "Custom-Period Sort (3/31/2026 – 6/11/2026)"); the
  // footer keeps just the count + freshness (no date range — that moved to the title).
  const ds = data?.start ?? start, de = data?.end ?? end
  const title = `Custom-Period Sort (${fmtYmd(ds)} – ${fmtYmd(de)})`
  const scanFooter = (
    <div className={styles.scanFooter}>
      <span className={styles.scanCount}>{symbols.length.toLocaleString()} {symbols.length === 1 ? 'stock' : 'stocks'}</span>
      {data?.as_of && <span className={styles.scanUpdated}>· {fmtScanTime(data.as_of)} ET</span>}
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
        backLabel={onExit ? '‹ Back' : null}
        onExitPick={onExit}
        settingsOverride={settingsOverride}
        onSettingsPersist={onSettingsPersist}
        widgetKey={widgetId}
        colStorageKey={`${WL_COLS_LS}.periodsort`}
        scanEmptyText={scanEmptyText}
        defaultColCfg={DEFAULT_COLS}
        perfOverride={perfOverride}
        scanFooter={scanFooter}
        scanCriteria={scanCriteria}
      />
    </ChartsSymContext.Provider>
  )
}
