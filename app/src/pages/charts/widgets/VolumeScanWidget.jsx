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
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
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

// The signal column shows the surge TIER (not a raw RVOL multiple) — this is a
// composite-signal scanner, not a plain relative-volume list. Rows still RANK by the
// underlying sustained RVOL; the tier is what's shown. T1 Notable → T5 Extreme.
const TIER_NAME = { 1: 'Notable', 2: 'Elevated', 3: 'High', 4: 'Very High', 5: 'Extreme' }

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
  // `pending` = a name just added to a custom list, shown INSTANTLY before its first
  // server reading lands (placeholder row so the add feels immediate).
  const cls = e.pending
    ? styles.unlit
    : e.lit
      ? `${styles.lit} ${styles['t' + (e.tier || 1)]}${igniting ? ` ${styles.igniting}` : ''}`
      : styles.unlit
  // Description used as an aria-label (NOT title) — a `title` shows a native hover
  // tooltip that obscures the chart; aria-label keeps it accessible with no popup.
  const desc = e.pending
    ? `${e.sym} — added to your list (waiting for the first reading)`
    : `${e.sym} — ${e.rvol}× relative volume (last ~10m)${e.rvol_day != null ? `, ${e.rvol_day}× on the day` : ''}${e.burst ? `, ${e.burst}× burst` : ''}, ${fmtPct(e.move)} in the last few min (${fmtPct(e.pct)} on day) at $${fmtPrice(e.price)}${e.dvol ? ` · ${fmtDollar(e.dvol)} traded in the last min` : ''}${igniting ? ' · igniting now' : ''}${e.lit ? '' : ' — below criteria'}`
  return (
    <button
      type="button"
      role="listitem"
      className={`${styles.row} ${cls}`}
      onClick={() => onPick(e.sym)}
      onContextMenu={onContext ? (ev) => onContext(ev, e.sym) : undefined}
      aria-label={desc}
    >
      {!e.pending && <SurgeFlash flash={e.flash} />}
      {igniting && <span className={styles.ignite} aria-hidden="true" />}
      <span className={styles.symCell}>
        {logos && <CompanyLogo sym={e.sym} size={15} round />}
        <span className={styles.sym}>{e.sym}</span>
      </span>
      <span className={styles.surge}>
        {e.pending ? '…' : (
          <>
            <span className={styles.tierCode}>T{e.tier || 1}</span>
            <span className={styles.tierName}>{TIER_NAME[e.tier || 1] || ''}</span>
          </>
        )}
      </span>
    </button>
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

  // ── Custom scan lists — scan ONLY the user's names, else the top-1,000 liquid
  // universe. The LIST DEFINITIONS live on the user's ACCOUNT (preference
  // `volume_scan_lists`), so they persist across every layout + widget instance until
  // deleted — NOT in per-widget opts (which vanish when a widget is closed). Only the
  // per-widget ACTIVE selection stays in opts, so two widgets can watch different lists.
  const { prefs, setPref } = usePreferences()
  const lists = useMemo(() => {
    const arr = parsePref(prefs?.volume_scan_lists, [])
    return Array.isArray(arr) ? arr : []
  }, [prefs?.volume_scan_lists])
  const activeListId = opts?.volActive || null
  const activeList = useMemo(() => lists.find(l => l.id === activeListId) || null, [lists, activeListId])
  const commitLists = useCallback(
    (nextLists, nextActiveId) => {
      setPref('volume_scan_lists', nextLists)                       // account-wide, durable
      onOptsChange?.({ ...opts, volActive: nextActiveId ?? null })  // per-widget selection
    },
    [setPref, opts, onOptsChange])
  const listHelpers = useMemo(() => makeListHelpers(lists, activeListId, commitLists), [lists, activeListId, commitLists])
  // One-time migration: lists used to live per-widget in opts.volLists — move any still
  // there up to the account so a pre-existing list isn't lost on the next widget close.
  const migratedRef = useRef(false)
  useEffect(() => {
    if (migratedRef.current) return
    const legacy = Array.isArray(opts?.volLists) ? opts.volLists : []
    const acct = parsePref(prefs?.volume_scan_lists, null)
    if (legacy.length && !Array.isArray(acct)) {
      migratedRef.current = true
      setPref('volume_scan_lists', legacy)
      onOptsChange?.({ ...opts, volLists: undefined })   // drop the stale per-widget copy
    }
  }, [opts, prefs?.volume_scan_lists, setPref, onOptsChange])
  const customEmpty = !!(activeList && activeList.syms.length === 0)
  const [ctxMenu, setCtxMenu] = useState(null)   // {sym,x,y} right-click "remove from list" menu
  const ctxRef = useRef(null)
  const onRowContext = useCallback((ev, sym) => {
    ev.preventDefault()
    setCtxMenu({ sym, x: ev.clientX, y: ev.clientY })
  }, [])
  useEffect(() => {
    if (!ctxMenu) return
    // Ignore mousedowns INSIDE the menu — otherwise this capture-phase close fires
    // before the menu button's own handler, so "Remove" would never run (the bug).
    const onDown = (ev) => { if (ctxRef.current && ctxRef.current.contains(ev.target)) return; setCtxMenu(null) }
    const onWheel = () => setCtxMenu(null)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('wheel', onWheel, true)
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('wheel', onWheel, true) }
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
  // For a custom list, drive the visible rows off the LIST itself so add/remove is
  // instant: keep the server-ranked rows that are still on the list, then append any
  // just-added names as pending placeholders (filled in on the next ~2s poll).
  const displayRows = useMemo(() => {
    if (!activeList) return rows
    const want = activeList.syms
    const wantSet = new Set(want)
    const present = rows.filter(r => wantSet.has(r.sym))
    const presentSet = new Set(present.map(r => r.sym))
    const pending = want.filter(s => !presentSet.has(s)).map(s => ({ sym: s, rvol: null, lit: false, pending: true }))
    return [...present, ...pending]
  }, [rows, activeList])
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
      {/* Toolbar: LIVE + time on the left, gear on the right, the scope pill CENTERED
          between two flex spacers — so it sits mid-toolbar when wide and packs back
          toward LIVE as the widget narrows. */}
      <div className={chrome.toolbar}>
        <span className={`${chrome.live} ${isActive ? chrome.liveOn : ''}`}>
          <span className={chrome.dot} aria-hidden="true" />{stamp}
        </span>
        {data?.asof && <span className={chrome.asof}>{fmtTime(data.asof)} ET</span>}
        <span className={chrome.spacer} />
        <ScopeControl lists={lists} activeId={activeListId} helpers={listHelpers} themeVars={panelThemeVars} />
        <span className={chrome.spacer} />
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
              <span className={styles.headSurge}>SIGNAL</span>
            </div>
            {customEmpty ? (
              <div className={styles.none}>This list is empty — add tickers below to start scanning it.</div>
            ) : displayRows.length === 0 ? (
              <div className={styles.none}>
                {activeList ? 'Warming up your list…' : 'Warming up… (baselines build over the first minute)'}
              </div>
            ) : (
              displayRows.map((e) => (
                <Row key={e.sym} e={e} onPick={onPick} logos={showLogos}
                  onContext={activeList ? onRowContext : undefined} />
              ))
            )}
          </div>
          {activeList && <AddTickerBar list={activeList} helpers={listHelpers} />}
        </>
      )}

      {ctxMenu && activeList && (
        <div ref={ctxRef} className={styles.rowMenu} style={{ top: ctxMenu.y, left: ctxMenu.x }} role="menu">
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
