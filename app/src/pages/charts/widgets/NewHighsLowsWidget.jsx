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
import NhnlDropdown from './NhnlDropdown'
import { mergeNhnlSettings, nhnlDefaultsForTheme, nhnlWidgetStyleVars } from './nhnlSettings'
import styles from './NewHighsLowsWidget.module.css'

const SCOPE_OPTIONS = [
  { value: 'all', label: 'UCT Universe' },
  { value: 'sector', label: 'Sector' },
  { value: 'industry', label: 'Industry' },
  { value: 'theme', label: 'Theme' },
]

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

// Event ts (ISO, ET offset) → "1:26:04 PM" market-clock time.
function fmtTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York',
    })
  } catch { return '' }
}

const WINDOW_LABEL = { rth: 'LIVE', pre: 'PRE-MARKET', post: 'POST-MARKET', closed: 'CLOSED' }

// A stock row — the flat universe list OR a nested row inside an expanded group.
// Ticker + running count; clicking charts it. The soft "hot" wash re-fires when the
// count ticks up (the wash overlay is keyed by count so it remounts only then).
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
      <span key={`f${e.count}`} className={styles.flash} aria-hidden="true" />
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
      <div className={styles.sideHead}>
        <span className={styles.sideTitle}>{title}</span>
        <span className={styles.sideCount}>{total}</span>
      </div>
      <div className={styles.rows} role="list">
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
                <span key={`f${e.count}`} className={styles.flash} aria-hidden="true" />
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

// Debounced filter box: types instantly into local state, commits to opts after a
// pause (and on blur / Enter). Keeps the fetch key + layout-save off the keystroke
// path, which is what made the old controlled-through-opts inputs feel glitchy.
function FilterBox({ label, ariaLabel, value, placeholder, min, onCommit }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const timer = useRef(null)
  const inputRef = useRef(null)
  // Re-sync if opts change from elsewhere, but never fight the user mid-type.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setText(value == null ? '' : String(value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const schedule = (raw) => {
    setText(raw)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(raw), 350)
  }
  const commit = (raw) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const n = raw === '' ? min : Number(raw)
    onCommit(Number.isFinite(n) ? Math.max(min, n) : min)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <label className={styles.filter}>
      <span className={styles.filterLbl}>{label}</span>
      <input
        ref={inputRef}
        type="number" min={min} step="1" inputMode="decimal"
        className={styles.filterInput}
        value={text}
        placeholder={placeholder}
        onChange={(e) => schedule(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
        aria-label={ariaLabel}
      />
    </label>
  )
}

export default function NewHighsLowsWidget({ color, opts, onOptsChange }) {
  const { setGroupSym } = useWorkspace() || {}
  const minPrice = Number(opts?.minPrice) || 0
  const minCount = Math.max(1, Number(opts?.minCount) || 1)

  const onPick = useCallback((sym) => {
    if (color && sym) setGroupSym?.(color, sym)
  }, [color, setGroupSym])

  const commitPrice = useCallback((v) => onOptsChange?.({ ...opts, minPrice: v }), [opts, onOptsChange])
  const commitCount = useCallback((v) => onOptsChange?.({ ...opts, minCount: v }), [opts, onOptsChange])

  // Scope: view the whole universe, or group by sector / industry / theme (each group
  // row expands in place to its member stocks — Theme-Tracker style).
  const scope = opts?.scope || 'all'                 // 'all' | 'sector' | 'industry' | 'theme'
  const commitScope = useCallback((v) => onOptsChange?.({ ...opts, scope: v }), [opts, onOptsChange])

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

  const filterQS = `min_price=${minPrice}&min_count=${minCount}`
  const scopeQ = scope !== 'all' ? `&group=${scope}` : ''
  const url = `/api/nhnl/live?limit=150&${filterQS}${scopeQ}`
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
  const stamp = WINDOW_LABEL[window] || ''
  // Group scope → rows are groups (sectors/industries/themes) that expand in place.
  const groupView = !!data?.group
  const dim = scope !== 'all' ? scope : null

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
        <span className={`${styles.live} ${isActive ? styles.liveOn : ''}`}>
          <span className={styles.dot} aria-hidden="true" />{stamp}
        </span>
        {data?.asof && <span className={styles.asof}>{fmtTime(data.asof)} ET</span>}
        <span className={styles.spacer} />
        <NhnlDropdown
          value={scope}
          options={SCOPE_OPTIONS}
          onChange={commitScope}
          title="Group by"
          minWidth={96}
          maxWidth={112}
        />
        <FilterBox label="$≥" ariaLabel="Minimum price" value={opts?.minPrice}
          placeholder="0" min={0} onCommit={commitPrice} />
        <FilterBox label="#≥" ariaLabel="Minimum count" value={opts?.minCount}
          placeholder="1" min={1} onCommit={commitCount} />
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
