import { useMemo, useCallback, useId, useEffect, useRef } from 'react'
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

// First-run column layout. Sorted by % change desc because that is what a
// breadth cell IS — the stocks that moved — and it matches the order the
// endpoint already returns.
const DRILL_DEFAULT_COLS = {
  order: ['flag', 'sym', 'price', 'chg', 'rvol'],
  sort: { key: 'chg', dir: 'desc' },
}

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
      // `vr` IS relative volume — the "1.7x" the retired table showed in its VOL
      // column. The watchlist's Vol column means RAW volume, which this payload
      // does not carry, so without this the ratio would be the one piece of
      // information the new surface shows LESS of than the old one. RVOL is
      // stored as a percent (the cell divides by 100).
      if (Number.isFinite(it.vr)) entry.rvol = it.vr * 100
      if (Object.keys(entry).length) out[sym] = entry
    }
    if (groups) {
      for (const g of groups) out[String(g.key).toUpperCase()] = { group_count: g.count }
    }
    return Object.keys(out).length ? out : null
  }, [items, groups])

  // ⭐ A RECORDED DRILL PINS ITS QUOTES. The snapshot for 2026-09-04 holds what
  // those stocks did THAT DAY; streaming a later price into it would relabel
  // history as the present. Only the LIVE row streams.
  //
  // ⛔ This deliberately does NOT exempt the newest recorded day. An earlier
  // version did — reasoning that "today's snapshot is today, so let it tick" —
  // and it shipped a drill whose Price, Vol and % Chg were ALL em-dashes,
  // because a recorded day plus a closed market means there are no live quotes
  // to fall back to. The bespoke table this replaces always rendered the
  // snapshot's own numbers; a recorded day is a recorded day.
  const isRecorded = !drill?.live && !!drill?.date
  const quoteOverride = useMemo(() => {
    if (!isRecorded) return null
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
  }, [isRecorded, items])

  // Paint the FIRST row on open. The drill's items arrive after mount (the list
  // is fetched), so seeding the colour group at mount seeds it with nothing and
  // the chart is left showing whatever symbol it had last — which shipped as a
  // chart displaying a ticker that was not even in the list. Seeds once, and
  // only while the group is empty, so a user's own selection is never stomped.
  const seededSymRef = useRef(false)
  useEffect(() => {
    if (seededSymRef.current || !color) return
    const first = items.length ? String(tickerOf(items[0]) || '').toUpperCase() : ''
    if (!first) return
    seededSymRef.current = true
    if (!groupSyms?.[color]) setGroupSym?.(color, first)
  }, [items, color, groupSyms, setGroupSym])

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
            // FIRST-RUN columns only. `colStorageKey` is deliberately absent, so
            // this list stores under the GLOBAL watchlist key — a user who has
            // ever arranged their watchlist columns sees exactly that arrangement
            // here, which is the whole point. This default applies only when
            // there is no saved layout yet, and it leads with RVOL rather than
            // Vol because a recorded drill carries the ratio, not raw volume.
            defaultColCfg={DRILL_DEFAULT_COLS}
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
