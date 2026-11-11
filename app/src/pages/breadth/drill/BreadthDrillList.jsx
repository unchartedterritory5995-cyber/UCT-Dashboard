import { useMemo, useCallback, useId, useEffect, useRef } from 'react'
import Watchlists from '../../Watchlists'
import GroupControls from '../grouping/GroupControls'
import useBreadthGrouping from '../grouping/useBreadthGrouping'
import { ChartsSymContext } from '../../charts/ChartsSymContext'
import { useWorkspace } from '../../charts/WorkspaceContext'
import { DRILL_COLS_KEY, DRILL_TABLE_COLS_KEY } from './drillListCols'
import { prefetchListDeep } from '../../../utils/prefetchBars'
import { useDrillSource } from './DrillSourceContext'
import { FilterButton, GroupSwitch, FilterChips } from './scan/ScanFilters'
import GroupHeader from './scan/GroupHeader'
import { GROUP_HUES } from './scan/scanDeckModel'
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
// Section colours, in group order (largest group first). Muted so they tag,
// not shout.

// First-run column layout. Sorted by % change desc because that is what a
// breadth cell IS — the stocks that moved — and it matches the order the
// endpoint already returns.
// Focus list (owner, 2026-11-08): Symbol, % Chg, Price, Vol — in that order —
// with the three number columns one width, so the table ends on the Vol edge.
export const DRILL_NUM_COL_W = 73
const DRILL_DEFAULT_COLS = {
  order: ['flag', 'sym', 'chg', 'price', 'vol'],
  sort: { key: 'chg', dir: 'desc' },
  widths: { chg: DRILL_NUM_COL_W, price: DRILL_NUM_COL_W, vol: DRILL_NUM_COL_W },
}
// The Scan Deck's TABLE mode gives the list most of the window, so it opens with
// the columns a screener would: who the company is, where it sits, how big, and
// how stretched. Its OWN key, so arranging Table never rearranges the compact
// Scan list (and vice versa). Every column here is one the drill CAN fill — the
// meta batch, the theme map, or the drill payload itself.
const DRILL_TABLE_DEFAULT_COLS = {
  order: ['flag', 'sym', 'name', 'price', 'chg', 'rvol', 'sector', 'theme', 'mcap', 'rating', 'atr', 'a50', 'earn'],
  sort: { key: 'chg', dir: 'desc' },
}

export default function BreadthDrillList({ color, settingsOverride = null, onSettingsPersist = null }) {
  const { groupSyms, setGroupSym, groupTfs, activeWatchlistRef } = useWorkspace() || {}
  const drill = useDrillSource()
  const widgetId = useId()
  const items = drill?.items ?? NO_ITEMS
  const tableMode = drill?.mode === 'table'
  // Scoped sym context: a row click publishes into THIS widget's colour group so
  // the paired chart follows — identical wiring to ScannerResults/WatchlistWidget.
  const setSym = useCallback((s) => { if (color) setGroupSym?.(color, s) }, [color, setGroupSym])
  // `tf` = the timeframe this group's chart is on, so the wrapped list warms
  // the cache key that chart actually reads (see ThemeTrackerPage's warmTf note).
  const scopedSymContext = useMemo(
    () => ({ sym: color ? groupSyms?.[color] : null, setSym, tf: color ? groupTfs?.[color] : undefined }),
    [groupSyms, groupTfs, color, setSym],
  )

  // The shared grouping toolkit — the same engine the retired bespoke table used,
  // so List|Grouped and Sector|Industry behave exactly as they did.
  const {
    viewMode, setViewMode, dimension, setDimension, grouped,
  } = useBreadthGrouping(items, { tickerOf, pctOf, meta: drill?.groupMeta || undefined })

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
        // Raw volume (`v`); never the RVOL ratio. The recorded-day route fills
        // `v` from that session's daily bars (the stored lists only hold RVOL).
        volume: Number.isFinite(it.v) ? it.v : null,
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
    // The scan window picks its own first stock (the top gainer) and re-picks
    // it for every new list, so the list does not seed one here.
    if (drill?.deckHosted) return
    if (seededSymRef.current || !color) return
    const first = items.length ? String(tickerOf(items[0]) || '').toUpperCase() : ''
    if (!first) return
    seededSymRef.current = true
    if (!groupSyms?.[color]) setGroupSym?.(color, first)
  }, [items, color, groupSyms, setGroupSym, drill?.deckHosted])

  // ⭐ WARM THE BARS THE USER IS ABOUT TO OPEN. Clicking a row swaps the paired
  // chart's symbol, and with nothing warmed every click is a cold fetch. The drill
  // this replaced DID prefetch (CLAUDE.md records it under the bars cache), and both
  // sibling ad-hoc lists still do — PeriodSortResults and EtfHoldingsResults. Same
  // helper as theirs on purpose: `prefetchListDeep` warms Daily FIRST (the timeframe
  // the chart is showing) then W/M, is idle-deferred, bounded, and self-capping at
  // DEEP_WARM_CAP — so a 2,667-name universe drill costs no more than a 40-name cell.
  const warmedRef = useRef(null)
  useEffect(() => {
    const syms = items.map(i => String(tickerOf(i) || '').toUpperCase()).filter(Boolean)
    if (!syms.length) return
    // Keyed on the CELL, not the array identity, so a re-render never re-warms.
    const key = `${drill?.label || ''}|${drill?.date || ''}|${drill?.live ? 'live' : ''}|${syms.length}`
    if (warmedRef.current === key) return
    warmedRef.current = key
    prefetchListDeep(syms)
  }, [items, drill?.label, drill?.date, drill?.live])

  // What is ON SCREEN jumps ahead of that background trickle, so the row you are
  // about to click is warm before you reach it. `prefetchListDeep` dedupes over a
  // 5-minute window and is bounded, so firing this per scroll is cheap.
  const warmVisible = useCallback((syms) => {
    if (syms?.length) prefetchListDeep(syms, { cap: 60, priority: true })
  }, [])

  const stockCount = items.length
  const fullCount = Number.isFinite(drill?.total) ? drill.total : stockCount
  const scanFooter = drill?.deckHosted ? (
    <div className={styles.footer}>
      <span className={styles.count}>
        {stockCount !== fullCount ? `${stockCount.toLocaleString()} of ${fullCount.toLocaleString()} stocks` : `${stockCount.toLocaleString()} ${stockCount === 1 ? 'stock' : 'stocks'}`}
      </span>
    </div>
  ) : (
    <div className={styles.footer}>
      <span className={styles.count}>{stockCount} {stockCount === 1 ? 'stock' : 'stocks'}</span>
      {drill?.live
        ? <span className={styles.when}>· Live</span>
        : drill?.date && <span className={styles.when}>· {drill.date}</span>}
    </div>
  )

  // Section headers (Scan Deck): the group's own-case name, count, average move
  // and a colour that also edges its rows. Keyed by the UPPERCASE row sym.
  const groupInfo = useMemo(() => {
    if (!groups) return null
    const out = {}
    groups.forEach((g, i) => {
      out[String(g.key).toUpperCase()] = { name: g.key, count: g.count, avgPct: g.avgPct, color: GROUP_HUES[i % GROUP_HUES.length] }
    })
    return out
  }, [groups])
  const renderGroupRow = useCallback(({ sym, expanded, onToggle }) => {
    const g = groupInfo?.[sym]
    return (
      <GroupHeader name={g?.name || sym} count={g?.count ?? 0} total={items.length} avgPct={g?.avgPct}
        color={g?.color || 'var(--ut-gold)'} expanded={expanded} onToggle={onToggle} />
    )
  }, [groupInfo, items.length])
  const groupAccent = useCallback((sym) => groupInfo?.[sym]?.color || null, [groupInfo])

  // In the Scan Deck the window already names the list, so the list's title row
  // carries the scan controls instead: Filters, and how to group.
  const groupValue = viewMode === 'grouped' ? dimension : 'none'
  const onGroup = (k) => {
    if (k === 'none') { setViewMode('list'); return }
    setDimension(k)
    setViewMode('grouped')
  }
  const deckFilters = drill?.deckHosted ? drill.filters : null
  const titleSlot = deckFilters ? (
    <div className={styles.deckControls}>
      <FilterButton filters={deckFilters} total={fullCount} shown={stockCount} />
      <GroupSwitch value={groupValue} onChange={onGroup} />
    </div>
  ) : null
  const subHeader = deckFilters ? <FilterChips filters={deckFilters} /> : null

  // ⛔ A FAILED LOAD IS NOT AN EMPTY RESULT. Rendering the table here would show
  // "No stocks matched this filter" — a confident, wrong answer that reads as a
  // quiet market. One dropped request (a pod restart mid-deploy will do it) is
  // enough. Say what happened and offer the retry instead.
  if (drill?.error) {
    return (
      <div className={styles.wrap}>
        <div className={styles.errorPane} role="alert">
          <div className={styles.errorTitle}>Couldn&rsquo;t load this list</div>
          <p className={styles.errorBody}>
            The request for {drill.label || 'these stocks'} didn&rsquo;t come back.
            This is a loading problem, not an empty result.
          </p>
          {drill.onRetry && (
            <button type="button" className={styles.retryBtn} onClick={drill.onRetry}>
              Try again
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* The grouping controls live INSIDE the widget, not in the modal's bar, so
          they travel with it if it is ever ejected into its own window. */}
      {items.length > 0 && !drill?.deckHosted && (
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
            // Remount on a mode change (the table reads its column layout once)
            // AND on a new list. The scan window steps between sessions and lists
            // without closing, and a table kept mounted across two different
            // memberships kept a stale % Chg sort — measured in the harness: the
            // Dn 4%+ list rendered -4.0, -8.2, -39.7, -31.7… after a switch.
            // Filters do NOT remount: they narrow the same list.
            key={`${tableMode ? 'table' : 'list'}|${drill?.label || ''}|${drill?.live ? 'live' : drill?.date || ''}`}
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
            // In the Scan Deck: sections, ONE open at a time, the top one first
            // (owner pick, like Theme Tracker). Elsewhere: all open, each
            // independently collapsible.
            groupExpand={drill?.deckHosted ? 'accordion' : 'multi'}
            openFirstGroup={!!drill?.deckHosted}
            stableGutter={!!drill?.deckHosted}
            renderGroupRow={drill?.deckHosted ? renderGroupRow : null}
            groupAccent={drill?.deckHosted ? groupAccent : null}
            // ⛔ The drill keeps its OWN column layout, and that is the
            // consistent choice rather than a divergence: ScannerResults already
            // gives every scan its own key, for exactly this reason.
            //
            // Sharing the global watchlist key was tried and shipped a DEAD
            // column. A watchlist's `Vol` means RAW volume, which works fine on
            // /charts; a recorded breadth snapshot stores only the RATIO (the
            // route now adds the shares from that day's bars). With one shared layout, whichever
            // surface the user did not arrange for keeps a column of em-dashes.
            // Its own key lets the drill lead with RVOL — which it CAN fill —
            // while the user's watchlists keep their arrangement untouched.
            colStorageKey={tableMode ? DRILL_TABLE_COLS_KEY : DRILL_COLS_KEY}
            defaultColCfg={tableMode ? DRILL_TABLE_DEFAULT_COLS : DRILL_DEFAULT_COLS}
            metaOverride={metaOverride}
            quoteOverride={quoteOverride}
            scanFooter={scanFooter}
            pickTitleSlot={titleSlot}
            pickSubHeader={subHeader}
            onScanVisibleSyms={warmVisible}
            // `loading` is "not answered yet"; a genuinely empty answer is the
            // only thing allowed to say nothing matched.
            scanEmptyText={drill?.loading ? 'Loading…' : 'No stocks matched this filter.'}
          />
        </ChartsSymContext.Provider>
      </div>
    </div>
  )
}
