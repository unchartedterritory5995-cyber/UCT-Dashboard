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
import NhnlSettingsPanel from './NhnlSettingsPanel'
import { mergeNhnlSettings, nhnlDefaultsForTheme, nhnlWidgetStyleVars } from './nhnlSettings'
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

// A single surge row. RVOL is the headline (colour-tiered); the move column is the
// short-window price change that the volume is driving (green up / red down); price
// is the tradable level. Clicking charts the ticker.
function Row({ e, onPick }) {
  return (
    <button
      type="button"
      role="listitem"
      className={`${styles.row} ${styles['t' + (e.tier || 1)]}`}
      onClick={() => onPick(e.sym)}
      title={`${e.sym} — ${e.rvol}× relative volume, ${fmtPct(e.move)} in the last few min (${fmtPct(e.pct)} on day) at $${fmtPrice(e.price)}`}
    >
      <span className={styles.rail} aria-hidden="true" />
      <span className={styles.sym}>{e.sym}</span>
      <span className={styles.price}>{fmtPrice(e.price)}</span>
      <span className={`${styles.move} ${e.dir === 'up' ? styles.up : styles.down}`}>
        {e.dir === 'up' ? '▲' : '▼'}{fmtPct(e.move).replace('+', '')}
      </span>
      <span className={styles.rvol}>{e.rvol}×</span>
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
  const minMove = opts?.minMove == null ? 0.25 : Number(opts.minMove)

  const onPick = useCallback((sym) => {
    if (color && sym) setGroupSym?.(color, sym)
  }, [color, setGroupSym])
  const commitRvol = useCallback((v) => onOptsChange?.({ ...opts, minRvol: v }), [opts, onOptsChange])
  const commitMove = useCallback((v) => onOptsChange?.({ ...opts, minMove: v }), [opts, onOptsChange])

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

  const url = `/api/volume-scan/live?limit=150&min_rvol=${minRvol}&min_move=${minMove}`
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
        />
      )}
      <div className={chrome.toolbar}>
        <span className={`${chrome.live} ${isActive ? chrome.liveOn : ''}`}>
          <span className={chrome.dot} aria-hidden="true" />{stamp}
        </span>
        {data?.asof && <span className={chrome.asof}>{fmtTime(data.asof)} ET</span>}
        <span className={chrome.spacer} />
        <FilterBox label="RVOL≥" ariaLabel="Minimum relative volume" value={opts?.minRvol}
          placeholder="2" min={1} step={0.5} onCommit={commitRvol} />
        <FilterBox label="Δ%≥" ariaLabel="Minimum move percent" value={opts?.minMove}
          placeholder="0.25" min={0} step={0.25} onCommit={commitMove} />
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
        <div className={chrome.rows} role="list">
          <div className={`${chrome.sideHead} ${styles.head}`}>
            <span className={styles.headTitle}>RELATIVE VOLUME</span>
            <span className={styles.headCols}>
              <span className={styles.hcPrice}>PRICE</span>
              <span className={styles.hcMove}>MOVE</span>
              <span className={styles.hcRvol}>RVOL</span>
            </span>
          </div>
          {rows.length === 0 ? (
            <div className={styles.none}>No volume surges right now.</div>
          ) : (
            rows.map((e) => <Row key={e.sym} e={e} onPick={onPick} />)
          )}
        </div>
      )}
    </div>
  )
}
