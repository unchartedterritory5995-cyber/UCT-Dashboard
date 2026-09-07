import { useMemo, useCallback, useId } from 'react'
import Watchlists from '../../Watchlists'
import GroupControls from '../grouping/GroupControls'
import useBreadthGrouping from '../grouping/useBreadthGrouping'
import { ChartsSymContext } from '../../charts/ChartsSymContext'
import { useWorkspace } from '../../charts/WorkspaceContext'
import { useDrillSource } from './DrillSourceContext'
import styles from './BreadthDrillList.module.css'

// The breadth cell's constituents, rendered through the REAL watchlist table.
//
// This is `ScannerResults` with a different source: same `Watchlists` component,
// same scan mode, so the list keeps every column, the right-click column menu,
// header sorting, drag-to-resize, the flag star, the ⚙ appearance panel and the
// per-symbol menu. Membership comes from the breadth cell instead of a scan.
//
// ⛔ Do NOT hand-build a table here. The bespoke one this replaces is exactly
// what "the same structure throughout" exists to delete.

const tickerOf = (r) => r?.t
const pctOf = (r) => r?.pct
// ⛔ MODULE SCOPE. `drill?.items ?? []` allocates a NEW array whenever items is
// absent, which is a fresh identity on every render and churns every memo below.
const NO_ITEMS = []

export default function BreadthDrillList({ color, settingsOverride = null, onSettingsPersist = null }) {
  const { groupSyms, setGroupSym, activeWatchlistRef } = useWorkspace() || {}
  const drill = useDrillSource()
  const widgetId = useId()
  const items = drill?.items ?? NO_ITEMS

  // Scoped sym context: a row click publishes into THIS widget's colour group so
  // the paired chart follows — identical wiring to ScannerResults/WatchlistWidget.
  const setSym = useCallback((s) => { if (color) setGroupSym?.(color, s) }, [color, setGroupSym])
  const scopedSymContext = useMemo(
    () => ({ sym: color ? groupSyms?.[color] : null, setSym }),
    [groupSyms, color, setSym],
  )

  // The shared grouping toolkit — the same engine the retired bespoke table used,
  // so List|Grouped and Sector|Industry behave exactly as they did.
  const {
    viewMode, setViewMode, dimension, setDimension, grouped,
  } = useBreadthGrouping(items, { tickerOf, pctOf })

  // ⛔ THE WATCHLIST UPPERCASES EVERY ROW SYM (it is built for tickers), so a group
  // NAME renders and keys as its uppercase form. scanSymbols / scanGroups /
  // metaOverride must ALL be keyed that way or the lookup silently misses — the
  // bug that left only the already-all-caps "GLP-1" working in Period Sort.
  const groups = grouped?.groups ?? null

  // Top-level rows: group NAMES when grouped, tickers when flat.
  const symbols = useMemo(() => {
    if (!groups) return items.map(i => String(tickerOf(i) || '').toUpperCase())
    return groups.map(g => String(g.key).toUpperCase())
  }, [groups, items])

  const scanGroups = useMemo(() => {
    if (!groups) return null
    const out = {}
    for (const g of groups) {
      out[String(g.key).toUpperCase()] = g.items.map(i => String(tickerOf(i) || '').toUpperCase())
    }
    return out
  }, [groups])

  // Per-row fields the breadth payload supplies and the meta batch cannot:
  // the company name, ATR% and distance from the 50-day. Group rows get their
  // member count so the Stocks column reads.
  const metaOverride = useMemo(() => {
    const out = {}
    for (const it of items) {
      const sym = String(tickerOf(it) || '').toUpperCase()
      if (!sym) continue
      const entry = {}
      if (it.n != null) entry.name = it.n
      if (Number.isFinite(it.atr)) entry.atr = it.atr
      if (Number.isFinite(it.a50)) entry.a50 = it.a50
      if (Object.keys(entry).length) out[sym] = entry
    }
    if (groups) {
      for (const g of groups) out[String(g.key).toUpperCase()] = { group_count: g.count }
    }
    return Object.keys(out).length ? out : null
  }, [items, groups])

  // ⭐ A HISTORICAL DRILL PINS ITS QUOTES. The snapshot for 2026-09-04 is what
  // those stocks did THAT DAY; streaming today's price into it would relabel
  // history as the present. A LIVE drill passes nothing and streams normally,
  // exactly like any other watchlist.
  const isHistorical = !drill?.live && !!drill?.date && drill.date !== drill?.latestDate
  const quoteOverride = useMemo(() => {
    if (!isHistorical) return null
    const out = {}
    for (const it of items) {
      const sym = String(tickerOf(it) || '').toUpperCase()
      if (!sym) continue
      out[sym] = {
        price: Number.isFinite(it.c) ? it.c : null,
        change_pct: Number.isFinite(it.pct) ? it.pct : null,
        volume: null,
      }
    }
    return out
  }, [isHistorical, items])

  const stockCount = items.length
  const scanFooter = (
    <div className={styles.footer}>
      <span className={styles.count}>{stockCount} {stockCount === 1 ? 'stock' : 'stocks'}</span>
      {drill?.live
        ? <span className={styles.when}>· Live</span>
        : drill?.date && <span className={styles.when}>· {drill.date}</span>}
    </div>
  )

  return (
    <div className={styles.wrap}>
      {/* The grouping controls live INSIDE the widget, not in the modal's bar, so
          they travel with it if it is ever ejected into its own window. */}
      {items.length > 0 && (
        <div className={styles.ctrlBar}>
          <GroupControls
            viewMode={viewMode}
            setViewMode={setViewMode}
            dimension={dimension}
            setDimension={setDimension}
          />
        </div>
      )}
      <div className={styles.tableWrap}>
        <ChartsSymContext.Provider value={scopedSymContext}>
          <Watchlists
            embedded
            pickList="__scan__"
            scanSymbols={symbols}
            pickName={drill?.label || 'Breadth'}
            // No onExitPick: there is no picker to return to, and Watchlists
            // renders no dead back button when it is absent (Period Sort relies
            // on the same thing).
            settingsOverride={settingsOverride}
            onSettingsPersist={onSettingsPersist}
            // ⛔⛔ activeRef TRAVELS WITH widgetKey or the widget never loses the
            // keyboard: isActiveWidget() is `!activeRef || …`, so the key alone
            // leaves it permanently active and it answers every Shift+F and arrow
            // no matter which widget you are actually in. (2026-08-29.)
            activeRef={activeWatchlistRef}
            widgetKey={widgetId}
            scanGroups={scanGroups}
            // All industries open at once, each independently collapsible —
            // seeing which dominate the cohort IS the read.
            groupExpand="multi"
            metaOverride={metaOverride}
            quoteOverride={quoteOverride}
            scanFooter={scanFooter}
            scanEmptyText={drill?.items ? 'No stocks matched this filter.' : 'Loading…'}
          />
        </ChartsSymContext.Provider>
      </div>
    </div>
  )
}
