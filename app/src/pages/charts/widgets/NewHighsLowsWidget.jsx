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
import { mergeNhnlSettings, nhnlDefaultsForTheme, nhnlWidgetStyleVars } from './nhnlSettings'
import styles from './NewHighsLowsWidget.module.css'

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

function fmtPrice(p) {
  const n = Number(p)
  if (!Number.isFinite(n)) return '—'
  return n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                   : n.toFixed(2)
}

const WINDOW_LABEL = { rth: 'LIVE', pre: 'PRE-MARKET', post: 'POST-MARKET', closed: 'CLOSED' }

// One side (highs OR lows) — a scrollable event log with a count histogram. `total`
// is the universe-wide distinct-symbol count for the panel header.
function Side({ title, tone, events, total, onPick }) {
  const maxCount = useMemo(
    () => events.reduce((m, e) => Math.max(m, e.count || 0), 0) || 1,
    [events],
  )
  return (
    <div className={`${styles.side} ${styles[tone]}`}>
      <div className={styles.sideHead}>
        <span className={styles.sideTitle}>{title}</span>
        <span className={styles.sideCount}>{total}</span>
      </div>
      <div className={styles.rows} role="list">
        {events.map((e, i) => (
          <button
            type="button"
            role="listitem"
            key={`${e.sym}-${e.ts}-${i}`}
            className={styles.row}
            onClick={() => onPick(e.sym)}
            title={`${e.sym} — new ${tone === 'up' ? 'high' : 'low'} #${e.count} at ${fmtTime(e.ts)}`}
          >
            <span
              className={styles.bar}
              style={{ width: `${Math.max(4, (e.count / maxCount) * 100)}%` }}
              aria-hidden="true"
            />
            <span className={styles.arrow}>{tone === 'up' ? '▲' : '▼'}</span>
            <span className={styles.sym}>{e.sym}</span>
            <span className={styles.price}>{fmtPrice(e.price)}</span>
            <span className={styles.time}>{fmtTime(e.ts)}</span>
            <span className={styles.count}>{e.count}</span>
          </button>
        ))}
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

  // Scope: view the whole universe, or filter by sector / industry / theme. Picking
  // a dimension clears the category so a stale pick from another dim can't linger.
  const scope = opts?.scope || 'all'                 // 'all' | 'sector' | 'industry' | 'theme'
  const scopeValue = opts?.scopeValue || ''
  const commitScope = useCallback((v) => onOptsChange?.({ ...opts, scope: v, scopeValue: '' }), [opts, onOptsChange])
  const commitScopeValue = useCallback((v) => onOptsChange?.({ ...opts, scopeValue: v }), [opts, onOptsChange])

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

  const scopeQ = scope !== 'all'
    ? `&group=${scope}${scopeValue ? `&value=${encodeURIComponent(scopeValue)}` : ''}`
    : ''
  const url = `/api/nhnl/live?limit=150&min_price=${minPrice}&min_count=${minCount}${scopeQ}`
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
  // Categories for the scope dropdown (busiest first), from the current payload.
  const catOptions = useMemo(
    () => Object.entries(data?.categories || {}).sort((a, b) => b[1] - a[1]),
    [data?.categories])
  const window = data?.window || 'rth'
  const isActive = window !== 'closed'
  const stamp = WINDOW_LABEL[window] || ''

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
        <select
          className={styles.scopeSelect}
          value={scope}
          onChange={(e) => commitScope(e.target.value)}
          aria-label="Group scope"
          title="Group by"
        >
          <option value="all">All stocks</option>
          <option value="sector">Sector</option>
          <option value="industry">Industry</option>
          <option value="theme">Theme</option>
        </select>
        {scope !== 'all' && (
          <select
            className={`${styles.scopeSelect} ${styles.scopeValue}`}
            value={scopeValue}
            onChange={(e) => commitScopeValue(e.target.value)}
            aria-label="Category"
            title={`Pick a ${scope}`}
          >
            <option value="">All {scope}s</option>
            {catOptions.map(([cat, cnt]) => (
              <option key={cat} value={cat}>{cat} ({cnt})</option>
            ))}
          </select>
        )}
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
          <Side title="NEW HIGHS" tone="up" events={highs} total={highsTotal} onPick={onPick} />
          <Side title="NEW LOWS" tone="down" events={lows} total={lowsTotal} onPick={onPick} />
        </div>
      )}
    </div>
  )
}
