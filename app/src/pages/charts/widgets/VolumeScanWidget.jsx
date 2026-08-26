/**
 * Volume Surge widget — the "Situational Awareness" relative-volume scanner.
 *
 * A live, whole-market leaderboard of stocks REACTING right now: an unusual spike
 * in trading volume that is SUSTAINED over the last minute AND is moving in price
 * (dark-pool / non-directional prints are structurally excluded). The top row is
 * the strongest sustained relative-volume surge; a name that spikes then fades
 * decays back down within ~a minute. The ultimate job is to surface a stock the
 * instant size + price move together — often before the catalyst hits the wires.
 *
 * Same UCT skin + settings model as the New Highs / Lows scanner and H/L Pulse: it
 * reuses their chrome tokens (--nh-*), the same ⚙ settings panel, and the same
 * per-widget theme, so the three line up side by side and follow "Apply to: All
 * widgets" chart themes together.
 *
 * Data: GET /api/volume-scan/live (the volume_live accumulator; pre/RTH/post). Polls
 * ~2s during market hours. Clicking a row routes the ticker into this widget's color
 * group so a paired chart follows. RVOL / move filters are debounced local state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { useWorkspace } from '../WorkspaceContext'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import CompanyLogo from '../../../components/CompanyLogo'
import NhnlSettingsPanel from './NhnlSettingsPanel'
import { mergeNhnlSettings, nhnlDefaultsForTheme, nhnlWidgetStyleVars } from './nhnlSettings'
import { ScopeControl, AddTickerBar, makeListHelpers } from './VolumeScanLists'
import chrome from './NewHighsLowsWidget.module.css'
import styles from './VolumeScanWidget.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

const WINDOW_LABEL = { rth: 'LIVE', pre: 'PRE-MARKET', post: 'POST-MARKET', closed: 'CLOSED' }

function fmtTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York',
    })
  } catch { return '' }
}

const fmtPrice = (p) => (typeof p === 'number' ? (p >= 100 ? p.toFixed(1) : p.toFixed(2)) : '')
const fmtPct = (v) => (typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '')
const fmtDollar = (d) => {
  if (typeof d !== 'number' || d <= 0) return ''
  if (d >= 1e6) return `$${(d / 1e6).toFixed(1)}M`
  if (d >= 1e3) return `$${Math.round(d / 1e3)}K`
  return `$${Math.round(d)}`
}

// Extreme-surge alert: a white triple-pulse the moment the server flags a row as a
// genuinely SHARP move on big volume (`flash` = big volume AND a sudden range expansion
// vs the stock's own recent 1–5-min candles — NOT a smooth 45° grind at elevated volume).
// A heavy-volume name still shades its tier colour + gets the gold igniting pulse; only a
// big + SHARP move flashes white. Fires only on the transition INTO flash; a row already
// flashing on first render never re-fires.
function SurgeFlash({ flash }) {
  const wasFlash = useRef(!!flash)
  const [k, setK] = useState(0)
  useEffect(() => {
    if (flash && !wasFlash.current) setK((x) => x + 1)
    wasFlash.current = !!flash
  }, [flash])
  if (k === 0) return null
  return <span key={k} className={styles.surgeFlash} aria-hidden="true" />
}

// Two columns only — Symbol · Vol Surge (the RVOL ×). Every top-N name is shown,
// ranked by RVOL (lit first); a name that MEETS the criteria lights the WHOLE row
// in its tier colour (TC2000-style filled block, dark ink), the rest stay dark. On
// each price tick the row flashes. Clicking charts the ticker.
function Row({ e, onPick, logos, onContext }) {
  // "Igniting now" = a fresh volume burst WITH a real move (server flag). A lit
  // igniter gets a persistent pulse ring, distinct from the one-shot surge flash —
  // the "this is moving fast RIGHT NOW" cue, on top of its (hotter) tier colour.
  const igniting = e.lit && e.igniting
  const cls = e.lit
    ? `${styles.lit} ${styles['t' + (e.tier || 1)]}${igniting ? ` ${styles.igniting}` : ''}`
    : styles.unlit
  return (
    <button
      type="button"
      role="listitem"
      className={`${styles.row} ${cls}`}
      onClick={() => onPick(e.sym)}
      onContextMenu={onContext ? (ev) => onContext(ev, e.sym) : undefined}
      title={`${e.sym} — ${e.rvol}× relative volume (last ~10m)${e.rvol_day != null ? `, ${e.rvol_day}× on the day` : ''}${e.burst ? `, ${e.burst}× burst` : ''}, ${fmtPct(e.move)} in the last few min (${fmtPct(e.pct)} on day) at $${fmtPrice(e.price)}${e.dvol ? ` · ${fmtDollar(e.dvol)} traded in the last min` : ''}${igniting ? ' · igniting now' : ''}${e.lit ? '' : ' — below criteria'}`}
    >
      <SurgeFlash flash={e.flash} />
      {igniting && <span className={styles.ignite} aria-hidden="true" />}
      <span className={styles.symCell}>
        {logos && <CompanyLogo sym={e.sym} size={15} round />}
        <span className={styles.sym}>{e.sym}</span>
      </span>
      <span className={styles.surge}>{e.rvol}×</span>
    </button>
  )
}

// Debounced numeric filter box (types instantly to local state, commits after a
// pause / on blur / Enter — keeps the fetch key off the keystroke path).
function FilterBox({ label, ariaLabel, value, placeholder, min, step, onCommit }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const timer = useRef(null)
  const inputRef = useRef(null)
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(value == null ? '' : String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const commit = (raw) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const n = raw === '' ? min : Number(raw)
    onCommit(Number.isFinite(n) ? Math.max(min, n) : min)
  }
  const schedule = (raw) => {
    setText(raw)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(raw), 350)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <label className={chrome.filter}>
      <span className={chrome.filterLbl}>{label}</span>
      <input
        ref={inputRef}
        type="number" min={min} step={step || 1} inputMode="decimal"
        className={chrome.filterInput}
        value={text}
        placeholder={placeholder}
        onChange={(e) => schedule(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        aria-label={ariaLabel}
      />
    </label>
  )
}

export default function VolumeScanWidget({ color, opts, onOptsChange }) {
  const { setGroupSym } = useWorkspace() || {}
  const minRvol = Number(opts?.minRvol) || 2
  const minBurst = opts?.minBurst == null ? 3 : Number(opts.minBurst)
  const minMove = opts?.minMove == null ? 0.25 : Number(opts.minMove)
  // Min $-volume traded in the last minute, in $thousands. Undefined = let the
  // server pick a session-aware default (thinner for pre/post).
  const minDollarK = opts?.minDollarK == null ? '' : Number(opts.minDollarK)

  const showLogos = opts?.showLogos === true   // company logos next to tickers (default OFF)

  const onPick = useCallback((sym) => {
    if (color && sym) setGroupSym?.(color, sym)
  }, [color, setGroupSym])
  const commitRvol = useCallback((v) => onOptsChange?.({ ...opts, minRvol: v }), [opts, onOptsChange])
  const commitBurst = useCallback((v) => onOptsChange?.({ ...opts, minBurst: v }), [opts, onOptsChange])
  const commitMove = useCallback((v) => onOptsChange?.({ ...opts, minMove: v }), [opts, onOptsChange])
  const commitDollar = useCallback((v) => onOptsChange?.({ ...opts, minDollarK: v }), [opts, onOptsChange])
  const toggleLogos = useCallback((v) => onOptsChange?.({ ...opts, showLogos: v }), [opts, onOptsChange])

  // Appearance settings — same per-widget model + ⚙ panel as the NH/NL scanner.
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
  const panelThemeVars = useMemo(
    () => (styleVars['--nh-bg'] ? menuThemeVars(settings.bgMode === 'gradient' ? settings.bgGradient?.top : settings.bg) : null) || null,
    [styleVars, settings])

  // ── Custom scan lists (persisted in opts) — scan ONLY the user's names, else the
  // top-1,000 liquid universe. ─────────────────────────────────────────────────────
  const lists = Array.isArray(opts?.volLists) ? opts.volLists : []
  const activeListId = opts?.volActive || null
  const activeList = useMemo(() => lists.find(l => l.id === activeListId) || null, [lists, activeListId])
  const commitLists = useCallback(
    (nextLists, nextActiveId) => onOptsChange?.({ ...opts, volLists: nextLists, volActive: nextActiveId ?? null }),
    [opts, onOptsChange])
  const listHelpers = useMemo(() => makeListHelpers(lists, activeListId, commitLists), [lists, activeListId, commitLists])
  const customEmpty = !!(activeList && activeList.syms.length === 0)
  const [ctxMenu, setCtxMenu] = useState(null)   // {sym,x,y} right-click "remove from list" menu
  const onRowContext = useCallback((ev, sym) => {
    ev.preventDefault()
    setCtxMenu({ sym, x: ev.clientX, y: ev.clientY })
  }, [])
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    document.addEventListener('mousedown', close, true)
    document.addEventListener('wheel', close, true)
    return () => { document.removeEventListener('mousedown', close, true); document.removeEventListener('wheel', close, true) }
  }, [ctxMenu])

  const dollarQ = (minDollarK !== '' && Number.isFinite(minDollarK) && minDollarK > 0)
    ? `&min_dollar=${Math.round(minDollarK * 1000)}` : ''
  const symsQ = (activeList && activeList.syms.length)
    ? `&syms=${encodeURIComponent(activeList.syms.join(','))}` : ''
  // Show every name in scope (ranked by surge); the criteria only decide colour. An empty
  // custom list fetches nothing (null URL) — the empty-state + add-bar show instead.
  const url = customEmpty ? null
    : `/api/volume-scan/live?show_all=1&limit=300&min_rvol=${minRvol}&min_burst=${minBurst}&min_move=${minMove}${dollarQ}${symsQ}`
  const { data } = useMobileSWR(url, fetcher, {
    refreshInterval: 2000,       // feel live; server accumulates every ~2.5s
    dedupingInterval: 1200,
    marketHoursOnly: true,
    revalidateOnFocus: false,
  })

  const rows = data?.rows || []
  const total = data?.total ?? rows.length
  const window = data?.window || 'rth'
  const isActive = window !== 'closed'
  const stamp = WINDOW_LABEL[window] || ''

  return (
    <div ref={rootRef} className={chrome.wrap} style={styleVars}>
      {settingsOpen && (
        <NhnlSettingsPanel
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={gearRef.current}
          hostEl={rootRef.current}
          themeVars={panelThemeVars}
          title="Volume Surge Settings"
          showLogos={showLogos}
          onToggleLogos={toggleLogos}
        />
      )}
      <div className={chrome.toolbar}>
        <span className={`${chrome.live} ${isActive ? chrome.liveOn : ''}`}>
          <span className={chrome.dot} aria-hidden="true" />{stamp}
        </span>
        {data?.asof && <span className={chrome.asof}>{fmtTime(data.asof)} ET</span>}
        <ScopeControl lists={lists} activeId={activeListId} helpers={listHelpers} themeVars={panelThemeVars} />
        <span className={chrome.spacer} />
        <FilterBox label="RVOL≥" ariaLabel="Minimum relative volume" value={opts?.minRvol}
          placeholder="2" min={1} step={0.5} onCommit={commitRvol} />
        <FilterBox label="Burst≥" ariaLabel="Minimum burst relative volume" value={opts?.minBurst}
          placeholder="3" min={1} step={0.5} onCommit={commitBurst} />
        <FilterBox label="Δ%≥" ariaLabel="Minimum move percent" value={opts?.minMove}
          placeholder="0.25" min={0} step={0.25} onCommit={commitMove} />
        <FilterBox label="$K≥" ariaLabel="Minimum dollar volume per minute (thousands)"
          value={opts?.minDollarK} placeholder="auto" min={0} step={10} onCommit={commitDollar} />
        <button
          ref={gearRef}
          type="button"
          className={`${chrome.gear} ${settingsOpen ? chrome.gearOn : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="Volume Surge settings"
          aria-label="Volume Surge settings"
        >
          <UIcon name="gear" size={13} gold={false} />
        </button>
      </div>

      {!isActive ? (
        <div className={chrome.empty}>
          <div className={chrome.emptyTitle}>Market closed</div>
          <div className={chrome.emptySub}>
            The Volume Surge scanner runs 4:00 AM – 8:00 PM ET (pre-market, regular, and post-market).
          </div>
        </div>
      ) : (
        <>
          <div className={chrome.rows} role="list">
            <div className={`${chrome.sideHead} ${styles.head}`}>
              <span className={styles.headSym}>SYMBOL</span>
              <span className={styles.headSurge}>RVOL</span>
            </div>
            {customEmpty ? (
              <div className={styles.none}>This list is empty — add tickers below to start scanning it.</div>
            ) : rows.length === 0 ? (
              <div className={styles.none}>
                {activeList ? 'Warming up your list…' : 'Warming up… (baselines build over the first minute)'}
              </div>
            ) : (
              rows.map((e) => (
                <Row key={e.sym} e={e} onPick={onPick} logos={showLogos}
                  onContext={activeList ? onRowContext : undefined} />
              ))
            )}
          </div>
          {activeList && <AddTickerBar list={activeList} helpers={listHelpers} />}
        </>
      )}

      {ctxMenu && activeList && (
        <div className={styles.rowMenu} style={{ top: ctxMenu.y, left: ctxMenu.x }} role="menu">
          <div className={styles.rowMenuHead}>{ctxMenu.sym}</div>
          <button type="button" className={styles.rowMenuItem}
            onMouseDown={(ev) => { ev.preventDefault(); listHelpers.removeSym(activeListId, ctxMenu.sym); setCtxMenu(null) }}>
            <UIcon name="trash" size={12} gold={false} />
            <span>Remove from {activeList.name}</span>
          </button>
        </div>
      )}
    </div>
  )
}
