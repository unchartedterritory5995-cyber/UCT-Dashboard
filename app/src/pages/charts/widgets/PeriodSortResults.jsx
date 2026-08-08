// Custom-Period Sort results, rendered through the REAL scanner/watchlist table so it's
// identical in look AND features (columns, + menu, resize, sort, flag, settings, live
// prices). Two modes:
//  • STOCKS: every US common stock ranked by % change over [start, end] (whole-market scan,
//    virtualized + visible-only streaming).
//  • GROUPS (theme/sector/industry): the groups ranked by their mean % change, each an
//    expandable row (click → its stocks inline). Feeds the same table with group NAMES as
//    rows + a Stocks-count column; group rows show name · % · count (no price/volume).
import { useMemo, useCallback, useId } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import Watchlists from '../../Watchlists'
import UIcon from '../../../components/ui/UIcon'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'
import styles from './ScannerResults.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
const fmtYmd = (ymd) => { const s = String(ymd); return `${+s.slice(4, 6)}/${+s.slice(6, 8)}/${s.slice(0, 4)}` }
function fmtScanTime(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) } catch { return '' }
}

const SEP = String.fromCharCode(1)   // symbol-list content-key separator (never appears in a name/ticker)
// Stocks: Flag · Symbol · % Change · Price · Volume (thin flag to save space).
const DEFAULT_COLS_STOCK = { order: ['flag', 'sym', 'periodchg', 'price', 'vol'], sort: { key: 'periodchg', dir: 'desc' }, widths: { flag: 18 } }
// Groups: Flag · Name · % Change · Stocks (no price/volume — meaningless for a group). Wide
// name column so full theme/sector/industry names fit; thin flag.
const DEFAULT_COLS_GROUP = { order: ['flag', 'sym', 'periodchg', 'grpcount'], sort: { key: 'periodchg', dir: 'desc' }, widths: { flag: 18, sym: 250 } }
const GROUP_LABEL = { theme: 'Themes', sector: 'Sectors', industry: 'Industries' }
const GROUP_UNIT = { theme: 'theme', sector: 'sector', industry: 'industry' }

export default function PeriodSortResults({ start, end, color, settingsOverride = null, onSettingsPersist = null, onExit = null, symbolsFilter = null, titlePrefix = null, group = null }) {
  const { groupSyms, setGroupSym } = useWorkspace() || {}
  const widgetId = useId()

  const setSym = useCallback((s) => { if (color) setGroupSym?.(color, s) }, [color, setGroupSym])
  const scopedSymContext = useMemo(() => ({ sym: color ? groupSyms?.[color] : null, setSym }), [groupSyms, color, setSym])

  // The whole-market stock scan (always) — for stock rows, drill-down members, AND the
  // per-stock % of a group's expanded members.
  const stockUrl = start && end ? `/api/scans/period-change?start=${start}&end=${end}` : null
  // Poll fast (3s) while the pre-~2004 bars.db fallback is still "computing" so the result
  // lands within seconds of the background thread finishing; back off once it's ready.
  // dedupingInterval must sit BELOW the fast poll or SWR would dedupe those 3s revalidations.
  const { data: stockData, mutate: stockMutate, isValidating: stockVal } = useMobileSWR(stockUrl, fetcher, {
    refreshInterval: (d) => (!d || d.status === 'computing') ? 3_000 : 30_000,
    dedupingInterval: 2_500, revalidateOnFocus: false,
  })
  // The group ranking (only in group mode).
  const groupUrl = group && start && end ? `/api/scans/period-change-groups?start=${start}&end=${end}&group=${group}` : null
  const { data: groupData, mutate: groupMutate, isValidating: groupVal } = useMobileSWR(groupUrl, fetcher, {
    refreshInterval: (d) => (!d || d.status === 'computing') ? 3_000 : 60_000,
    dedupingInterval: 2_500, revalidateOnFocus: false,
  })

  const data = group ? groupData : stockData
  const isValidating = group ? groupVal : stockVal

  const filterSet = useMemo(() => (Array.isArray(symbolsFilter) ? new Set(symbolsFilter) : null), [symbolsFilter])
  // Content-key the symbol list so an identical poll doesn't rebuild the table. SEP (a
  // control char), NOT a comma — group NAMES can contain commas ("Oil, Gas & Fuels"), which
  // would otherwise shift every later row out of sync with its data + members.
  const stockSymKey = (stockData?.results || []).filter((r) => !filterSet || filterSet.has(r.sym)).map((r) => r.sym).join(SEP)
  const groupSymKey = (groupData?.results || []).map((r) => r.name).join(SEP)

  // Top-level rows: group NAMES in group mode, stock syms otherwise.
  const symbols = useMemo(() => {
    const key = group ? groupSymKey : stockSymKey
    return key ? key.split(SEP) : []
  }, [group, groupSymKey, stockSymKey])

  // NOTE: the watchlist UPPERCASES every row sym (it's built for tickers). So a group NAME
  // shows/keys as its uppercase form — perfData/metaData/scanGroups must be keyed the SAME
  // way or the lookup misses (that's why only "GLP-1", already all-caps, used to work).
  // Group → member stocks (for inline expansion).
  const scanGroups = useMemo(() => {
    if (!group) return null
    const m = {}
    for (const r of (groupData?.results || [])) m[String(r.name).toUpperCase()] = r.members || []
    return m
  }, [group, groupData])

  // periodchg column: per-stock % (members + drill) AND per-group % (group rows). Static.
  const perfOverride = useMemo(() => {
    let out = null
    for (const r of (stockData?.results || [])) {
      if (r && r.period_change != null) (out ||= {})[r.sym] = { period: r.period_change }
    }
    if (group) {
      for (const r of (groupData?.results || [])) {
        if (r && r.period_change != null) (out ||= {})[String(r.name).toUpperCase()] = { period: r.period_change }
      }
    }
    return out
  }, [stockData, group, groupData])

  // The Stocks-count column for group rows.
  const metaOverride = useMemo(() => {
    if (!group) return null
    let out = null
    for (const r of (groupData?.results || [])) (out ||= {})[String(r.name).toUpperCase()] = { group_count: r.count }
    return out
  }, [group, groupData])

  const scanEmptyText = !data
    ? 'Loading…'
    : data.status === 'computing'
      ? 'Ranking the market…'
      : (data.status === 'unavailable' || data.status === 'error')
        ? (data.error || 'Data isn’t available for this period.')
        : 'No results.'
  const scanCriteria = useMemo(() => (group
    ? [`Every ${GROUP_UNIT[group]}`, start && end ? `Mean % change from ${fmtYmd(start)} to ${fmtYmd(end)}` : 'Ranked by mean % change']
    : ['Every US Common Stock', start && end ? `% Change from ${fmtYmd(start)} to ${fmtYmd(end)}` : 'Ranked by % change over the period']), [group, start, end])

  const ds = data?.start ?? start, de = data?.end ?? end
  const titleBase = group ? (GROUP_LABEL[group] || 'Groups') : (titlePrefix || 'Custom-Period Sort')
  const title = `${titleBase} (${fmtYmd(ds)} – ${fmtYmd(de)})`
  const unit = group ? GROUP_UNIT[group] : 'stock'
  const scanFooter = (
    <div className={styles.scanFooter}>
      <span className={styles.scanCount}>{symbols.length.toLocaleString()} {symbols.length === 1 ? unit : `${unit}s`}</span>
      {data?.partial && <span className={styles.scanUpdated}>· surviving universe</span>}
      {data?.as_of && <span className={styles.scanUpdated}>· {fmtScanTime(data.as_of)} ET</span>}
      <button type="button" className={styles.scanRefresh} onClick={() => { stockMutate(); if (group) groupMutate() }} title="Refresh" aria-label="Refresh">
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
        scanGroups={scanGroups}
        pickName={title}
        backLabel={onExit ? '‹ Back' : null}
        onExitPick={onExit}
        settingsOverride={settingsOverride}
        onSettingsPersist={onSettingsPersist}
        widgetKey={widgetId}
        ephemeralCols
        scanEmptyText={scanEmptyText}
        defaultColCfg={group ? DEFAULT_COLS_GROUP : DEFAULT_COLS_STOCK}
        perfOverride={perfOverride}
        metaOverride={metaOverride}
        scanFooter={scanFooter}
        scanCriteria={scanCriteria}
      />
    </ChartsSymContext.Provider>
  )
}
