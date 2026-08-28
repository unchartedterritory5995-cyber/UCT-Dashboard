/**
 * New Highs / New Lows widget — the first "Situational Awareness" tool on /charts.
 *
 * A live twin-panel scanner (New Highs left, New Lows right) inspired by Trade
 * Ideas' new-HOD/LOD stream, but rebuilt in the UCT skin: dark card, dim-tinted
 * count histograms, gold accents, our greens/reds — NOT a visual clone. Its header,
 * rows and typography deliberately mirror the Watchlist widget (same 32px header,
 * same row metrics, same --font-sans symbol) so the two line up side by side.
 *
 * Each side is a rolling event log (newest on top): every time a cap-universe name
 * prints a fresh high-of-day (or low-of-day), a row lands with the symbol's RUNNING
 * COUNT of how many times it's done so today. The panel header shows the
 * UNIVERSE-WIDE count of distinct names at a new high / low today (highs_total /
 * lows_total), not just the rows in view. The count bar behind each row scales to
 * the busiest name on that side.
 *
 * Data: GET /api/nhnl/live (the nhnl_live accumulator; RTH only for now — pre/post
 * is Phase 3). Polls ~3s during market hours. Clicking a row routes the ticker into
 * this widget's color group so a paired chart follows. Filters (min price / min
 * count) are debounced local state (snappy typing) that persists through opts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { useWorkspace } from '../WorkspaceContext'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import NhnlSettingsPanel from './NhnlSettingsPanel'
import NhnlUniverseMenu from './NhnlUniverseMenu'
import { mergeNhnlSettings, nhnlDefaultsForTheme, nhnlWidgetStyleVars } from './nhnlSettings'
import styles from './NewHighsLowsWidget.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

// The soft "hot" wash, fired ONLY when a row's count actually increases while it's
// already on screen — never on first mount. That's what keeps a whole list (or a
// freshly-expanded group's stocks) from all flashing at once when it appears.
function FlashOverlay({ count }) {
  const prev = useRef(count)
  const [flashKey, setFlashKey] = useState(0)
  useEffect(() => {
    if (count > prev.current) setFlashKey((k) => k + 1)   // real increment → re-key → replay
    prev.current = count
  }, [count])
  if (flashKey === 0) return null                          // no wash until the first increment
  return <span key={flashKey} className={styles.flash} aria-hidden="true" />
}

// A stock row — the flat universe list OR a nested row inside an expanded group.
// Ticker + running count; clicking charts it.
function StockRow({ e, tone, maxCount, onPick, nested }) {
  return (
    <button
      type="button"
      role="listitem"
      className={`${styles.row}${nested ? ' ' + styles.subRow : ''}`}
      onClick={() => onPick(e.sym)}
      title={`${e.sym} — ${e.count} ${tone === 'up' ? 'new high' : 'new low'}${e.count === 1 ? '' : 's'} today`}
    >
      <span className={styles.bar}
        style={{ width: `${Math.max(4, (e.count / maxCount) * 100)}%` }} aria-hidden="true" />
      <FlashOverlay count={e.count} />
      <span className={styles.arrow}>{tone === 'up' ? '▲' : '▼'}</span>
      <span className={styles.sym}>{e.sym}</span>
      <span className={styles.count}>{e.count}</span>
    </button>
  )
}

// One side (highs OR lows). Flat stock list for UCT Universe; a Theme-Tracker-style
// accordion for a group scope — each group row expands IN PLACE to its top-10 member
// stocks on THIS side (new-high names under the highs column, new-low names under the
// lows column). Single-open: opening one closes the previous.
function Side({ title, tone, events, total, onPick, groupView, dim, drillBase }) {
  const [expanded, setExpanded] = useState(null)
  // Collapse when the scope dimension changes or we leave group view.
  useEffect(() => { setExpanded(null) }, [dim, groupView])
  // Only the expanded group fetches (top 10, this side). null key ⇒ no request.
  const drillUrl = (groupView && expanded && dim)
    ? `${drillBase}&group=${dim}&value=${encodeURIComponent(expanded)}&limit=10`
    : null
  const { data: drill } = useMobileSWR(drillUrl, fetcher, {
    refreshInterval: 2000, dedupingInterval: 1200, marketHoursOnly: true, revalidateOnFocus: false,
  })
  const sub = (tone === 'up' ? drill?.highs : drill?.lows) || []
  const subMax = useMemo(() => sub.reduce((m, e) => Math.max(m, e.count || 0), 0) || 1, [sub])
  const maxCount = useMemo(
    () => events.reduce((m, e) => Math.max(m, e.count || 0), 0) || 1, [events])

  return (
    <div className={`${styles.side} ${styles[tone]}`}>
      {/* Header lives INSIDE the scroll container (sticky) so the total is inset by
          the same scrollbar gutter as the rows — its number lines up with the row
          count column instead of hanging past it. */}
      <div className={styles.rows} role="list">
        <div className={styles.sideHead}>
          <span className={styles.sideTitle}>{title}</span>
          <span className={styles.sideCount}>{total}</span>
        </div>
        {events.map((e) => {
          if (!groupView) {
            return <StockRow key={`${tone}-${e.sym}`} e={e} tone={tone} maxCount={maxCount} onPick={onPick} />
          }
          const open = expanded === e.sym
          return (
            <div key={`${tone}-${e.sym}`} className={styles.groupBlock}>
              <button
                type="button"
                className={`${styles.row} ${styles.groupRow}`}
                onClick={() => setExpanded(open ? null : e.sym)}
                aria-expanded={open}
                title={`${e.sym} — ${e.count} ${tone === 'up' ? 'new high' : 'new low'}${e.count === 1 ? '' : 's'} · click to ${open ? 'collapse' : 'expand'}`}
              >
                <span className={styles.bar}
                  style={{ width: `${Math.max(4, (e.count / maxCount) * 100)}%` }} aria-hidden="true" />
                <FlashOverlay count={e.count} />
                <span className={`${styles.caret}${open ? ' ' + styles.caretOpen : ''}`} aria-hidden="true">▸</span>
                <span className={styles.sym}>{e.sym}</span>
                <span className={styles.count}>{e.count}</span>
              </button>
              {open && (
                <div className={styles.subList}>
                  {sub.length === 0
                    ? <div className={styles.subEmpty}>{drill ? 'No names' : 'Loading…'}</div>
                    : sub.map((s) => (
                        <StockRow key={`sub-${tone}-${s.sym}`} e={s} tone={tone} maxCount={subMax} onPick={onPick} nested />
                      ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// A menu pick → a universe descriptor (stored in opts.universes as a pill).
function descFromPick(sel) {
  if (sel.etf) return { key: `etf:${sel.etf}`, label: sel.label || sel.etf, etf: sel.etf }
  if (sel.watchlist) return { key: `wl:${sel.watchlist}`, label: sel.label || 'Watchlist', watchlist: sel.watchlist }
  if (sel.value) return { key: `cat:${sel.scope}:${sel.value}`, label: sel.label || sel.value, scope: sel.scope, value: sel.value }
  const s = sel.scope || 'all'
  return { key: s === 'all' ? 'all' : s, label: sel.label || (s === 'all' ? 'UCT Universe' : s), scope: s }
}
// Migrate a legacy single selection (pre-tabs opts) into a one-pill descriptor.
function legacyDesc(opts) {
  if (opts?.etf) return { key: `etf:${opts.etf}`, label: opts.uniLabel || opts.etf, etf: opts.etf }
  if (opts?.watchlist) return { key: `wl:${opts.watchlist}`, label: opts.uniLabel || 'Watchlist', watchlist: opts.watchlist }
  if (opts?.value && opts?.scope) return { key: `cat:${opts.scope}:${opts.value}`, label: opts.uniLabel || opts.value, scope: opts.scope, value: opts.value }
  const s = opts?.scope || 'all'
  return { key: s === 'all' ? 'all' : s, label: s === 'all' ? 'UCT Universe' : s, scope: s }
}

export default function NewHighsLowsWidget({ color, opts, onOptsChange }) {
  const { setGroupSym } = useWorkspace() || {}

  const onPick = useCallback((sym) => {
    if (color && sym) setGroupSym?.(color, sym)
  }, [color, setGroupSym])

  // ── Universe TABS — the exact model the Market Map (scatter) widget uses: a list
  // of saved universes (pills) + an active index; the ＋ opens the grouped menu. Each
  // universe is the whole UCT universe, a group-by dim (sector/industry/theme), a
  // category (one industry), an ETF's holdings, or a watchlist. ──
  const universes = useMemo(() => {
    if (Array.isArray(opts?.universes) && opts.universes.length) return opts.universes
    return [legacyDesc(opts)]
  }, [opts?.universes, opts?.scope, opts?.value, opts?.etf, opts?.watchlist, opts?.uniLabel])
  const activeIdx = Math.min(Math.max(0, opts?.activeUniverse ?? 0), universes.length - 1)
  const cur = universes[activeIdx] || universes[0]
  const scope = cur.scope || 'all'
  const uniValue = cur.value || null
  const etfUni = cur.etf || null
  const watchlistUni = cur.watchlist || null

  const patch = useCallback((p) => onOptsChange?.({ ...(opts || {}), ...p }), [opts, onOptsChange])
  const addUniverse = useCallback((sel) => {
    const d = descFromPick(sel)
    const exists = universes.findIndex(u => u.key === d.key)
    if (exists >= 0) { patch({ activeUniverse: exists }); return }
    patch({ universes: [...universes, d], activeUniverse: universes.length })
  }, [universes, patch])
  const removeUniverse = useCallback((i) => {
    if (universes.length <= 1) return
    const next = universes.filter((_, j) => j !== i)
    patch({ universes: next, activeUniverse: Math.min(activeIdx, next.length - 1) })
  }, [universes, activeIdx, patch])

  // ── Appearance settings (per-widget opts.settings — same model as News /
  // Watchlist; this is also what the "Apply to: All widgets" chart-theme patches). ──
  const placedTheme = usePlacedTheme(opts?.placedTheme)
  const settings = useMemo(() => mergeNhnlSettings(opts?.settings || null), [opts?.settings])
  const styleVars = useMemo(() => nhnlWidgetStyleVars(settings), [settings])
  const rootRef = useRef(null)
  const gearRef = useRef(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const patchSettings = useCallback(
    (p) => onOptsChange?.({ ...opts, settings: { ...settings, ...p } }),
    [opts, onOptsChange, settings])
  const resetSettings = useCallback(
    () => onOptsChange?.({ ...opts, settings: nhnlDefaultsForTheme(placedTheme) }),
    [opts, onOptsChange, placedTheme])
  // Theme the popover chrome to the widget's own canvas when customized.
  const panelThemeVars = useMemo(
    () => (styleVars['--nh-bg'] ? menuThemeVars(settings.bgMode === 'gradient' ? settings.bgGradient?.top : settings.bg) : null) || null,
    [styleVars, settings])

  const filterQS = 'min_price=0&min_count=1'
  // ETF / watchlist restriction wins and is a flat view (no group); otherwise a
  // group-by dim becomes the &group= param.
  const restrictQ = etfUni ? `&etf=${encodeURIComponent(etfUni)}`
    : watchlistUni ? `&watchlist=${encodeURIComponent(watchlistUni)}` : ''
  const scopeQ = restrictQ ? '' : (scope !== 'all' ? `&group=${scope}` : '')
  // A picked category (e.g. one industry) → flat leaderboard of that category's stocks.
  const valueQ = (!restrictQ && scope !== 'all' && uniValue) ? `&value=${encodeURIComponent(uniValue)}` : ''
  const url = `/api/nhnl/live?limit=150&${filterQS}${scopeQ}${valueQ}${restrictQ}`
  // Base for a group's inline expansion (Side appends &group=&value=&limit=10).
  const drillBase = `/api/nhnl/live?${filterQS}`
  const { data } = useMobileSWR(url, fetcher, {
    refreshInterval: 2000,       // feel live; server accumulates every ~2s
    dedupingInterval: 1200,
    marketHoursOnly: true,       // 10x-slow the poll when the market is closed
    revalidateOnFocus: false,
  })

  const highs = data?.highs || []
  const lows = data?.lows || []
  const highsTotal = data?.highs_total ?? highs.length
  const lowsTotal = data?.lows_total ?? lows.length
  const window = data?.window || 'rth'
  const isActive = window !== 'closed'
  // Group scope → rows are groups (sectors/industries/themes) that expand in place.
  // (A restrict view returns group:null, and a picked category echoes a `value` →
  // both are FLAT individual-stock leaderboards, not the expandable overview.)
  const groupView = !!data?.group && !data?.value
  const dim = data?.group || null

  return (
    <div ref={rootRef} className={styles.wrap} style={styleVars}>
      {settingsOpen && (
        <NhnlSettingsPanel
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={gearRef.current}
          hostEl={rootRef.current}
          themeVars={panelThemeVars}
        />
      )}
      <div className={styles.toolbar}>
        {/* Universe TAB strip (switch / delete) + a ＋ that opens the grouped menu —
            identical to the Market Map widget. */}
        <div className={styles.uniTabs}>
          {universes.map((u, i) => (
            <span key={`${u.key}:${i}`}
              className={`${styles.uniTab}${i === activeIdx ? ' ' + styles.uniTabActive : ''}`}
              role="button" tabIndex={0} onClick={() => patch({ activeUniverse: i })}
              title={u.label}>
              <span className={styles.uniTabLabel}>{u.label}</span>
              {universes.length > 1 && (
                <span className={styles.uniTabX} role="button" tabIndex={-1} aria-label="Remove universe"
                  title="Remove" onClick={(e) => { e.stopPropagation(); removeUniverse(i) }}>
                  <UIcon name="x" size={8} gold={false} />
                </span>
              )}
            </span>
          ))}
          <NhnlUniverseMenu activeKey={cur.key} onPick={addUniverse} addClassName={styles.uniAdd} />
        </div>
        <span className={styles.spacer} />
        <button
          ref={gearRef}
          type="button"
          className={`${styles.gear} ${settingsOpen ? styles.gearOn : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="New Highs / Lows settings"
          aria-label="New Highs / Lows settings"
        >
          <UIcon name="gear" size={13} gold={false} />
        </button>
      </div>

      {!isActive ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Market closed</div>
          <div className={styles.emptySub}>
            New-high / new-low tracking runs 4:00 AM – 8:00 PM ET (pre-market, regular, and post-market).
          </div>
        </div>
      ) : (
        <div className={styles.panels}>
          <Side title="NEW HIGHS" tone="up" events={highs} total={highsTotal}
            onPick={onPick} groupView={groupView} dim={dim} drillBase={drillBase} />
          <Side title="NEW LOWS" tone="down" events={lows} total={lowsTotal}
            onPick={onPick} groupView={groupView} dim={dim} drillBase={drillBase} />
        </div>
      )}
    </div>
  )
}
