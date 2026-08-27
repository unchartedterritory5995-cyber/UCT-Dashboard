/**
 * Alerts widget — a standalone price-alert command center.
 *
 * NOT linked to any chart / color group: it always lists ALL of the user's price
 * alerts (the same `watchlist_alerts` that power the bell + email/Discord), no
 * matter what the neighboring widgets are showing. Add an alert for ANY ticker
 * from the box at the top; each active alert shows when it was created and a live
 * "Price above / below" status vs its level. Recently-triggered alerts list below.
 *
 * Appearance (canvas + text color + text size) is a per-widget ⚙ blob persisted
 * like the other widget settings; a widget with NO explicit look follows the app
 * theme (light → white canvas + dark text, OLED → black canvas + light text).
 */
import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { useWorkspace } from '../WorkspaceContext'
import { useAuth } from '../../../context/AuthContext'
import usePreferences from '../../../hooks/usePreferences'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import useLivePrices from '../../../hooks/useLivePrices'
import { menuThemeVars } from '../../../utils/dividerColor'
import { sendCaptureToJournal } from '../../journal-2-0/lib/sendToJournal'
import { useJournalToast, JournalToast } from '../../journal-2-0/lib/useJournalToast'
import UIcon from '../../../components/ui/UIcon'
import NewsSettingsPanel from './NewsSettingsPanel'
import {
  mergeAlertsWidgetSettings, alertsWidgetStyleVars, alertsDefaultsForTheme,
} from './alertsWidgetSettings'
import styles from './AlertsWidget.module.css'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : []))

function fmtPrice(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Short "Aug 6" from an ISO/epoch timestamp; '' if unparseable.
function fmtDate(ts) {
  if (!ts) return ''
  const d = new Date(typeof ts === 'number' ? ts : String(ts))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// The alert's level right now. A trendline's level is interpolated/extrapolated
// from its two anchors (matches the server-side checker); everything else is the
// fixed target_price.
function levelNow(a) {
  if (a.alert_type === 'trendline') {
    const { anchor_t1: t1, anchor_p1: p1, anchor_t2: t2, anchor_p2: p2 } = a
    if ([t1, p1, t2, p2].every(v => v != null) && t2 !== t1) {
      const now = Date.now() / 1000
      return p1 + (p2 - p1) * ((now - t1) / (t2 - t1))
    }
  }
  return Number(a.target_price)
}

export default function AlertsWidget({
  color, opts, onOptsChange,
  // Frozen-embed mode (journal host): frozenAlerts is the captured list —
  // each row carries levelAtCapture/priceAtCapture so the badges read the
  // CAPTURED state, never the ambient clock or live prices. readOnly strips
  // the quick-add (a real POST), row delete (a real DELETE), and the gear.
  frozenAlerts = null, readOnly = false, journalDoor = true,
}) {
  const { user } = useAuth()
  // One-directional link: clicking an alert row PUBLISHES its symbol to this
  // widget's color group (→ any chart on the same group jumps to it). We never
  // READ the group here, so scanning tickers on the chart never touches the list.
  const { setGroupSym } = useWorkspace() || {}
  const goToSym = useCallback((sym) => {
    if (sym && setGroupSym) setGroupSym(color, sym.toUpperCase())
  }, [setGroupSym, color])

  // ── Appearance settings (⚙) — mirrors the News widget ──
  const { prefs } = usePreferences()
  const placedTheme = usePlacedTheme()
  const settings = useMemo(
    () => mergeAlertsWidgetSettings(opts?.settings ?? alertsDefaultsForTheme(placedTheme)),
    [opts?.settings, prefs.theme],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [journalMsg, setJournalMsg] = useJournalToast()
  const settingsBtnRef = useRef(null)
  const rootRef = useRef(null)
  const patchSettings = useCallback(
    (patch) => onOptsChange?.({ ...(opts || {}), settings: { ...settings, ...patch } }),
    [opts, settings, onOptsChange],
  )
  const resetSettings = useCallback(
    () => onOptsChange?.({ ...(opts || {}), settings: null }),
    [opts, onOptsChange],
  )
  const rootStyle = useMemo(() => alertsWidgetStyleVars(settings), [settings])
  const menuVars = useMemo(() => {
    const canvas = settings.bgMode === 'gradient' ? (settings.bgGradient?.top || settings.bg) : settings.bg
    return menuThemeVars(canvas) || {}
  }, [settings])

  // ── Alerts data (active + triggered) — ALL of the user's, chart-independent ──
  const { data, mutate } = useSWR(
    user && !frozenAlerts ? '/api/watchlist-alerts?active_only=false' : null,
    fetcher,
    { refreshInterval: 30000, dedupingInterval: 10000 },
  )
  const allAlerts = useMemo(
    () => (frozenAlerts ?? (Array.isArray(data) ? data : [])),
    [frozenAlerts, data],
  )

  const active = useMemo(() => allAlerts.filter(a => a.is_active), [allAlerts])
  const triggered = useMemo(
    () => allAlerts.filter(a => !a.is_active)
      .sort((x, y) => String(y.triggered_at || '').localeCompare(String(x.triggered_at || ''))),
    [allAlerts],
  )

  // Live prices for every symbol we're showing, for the price-vs-level status.
  const priceSyms = useMemo(
    () => [...new Set(allAlerts.map(a => (a.sym || '').toUpperCase()).filter(Boolean))],
    [allAlerts],
  )
  const { prices } = useLivePrices(frozenAlerts ? [] : priceSyms)
  const liveFor = useCallback(
    (s) => (frozenAlerts ? null : (prices[(s || '').toUpperCase()]?.price ?? null)),
    [frozenAlerts, prices],
  )

  // ── Quick-add — any ticker, a level, above/below ──
  const [ticker, setTicker] = useState('')
  const [dir, setDir] = useState('above')
  const [priceStr, setPriceStr] = useState('')
  const cleanTicker = ticker.trim().toUpperCase()
  const canAdd = !!cleanTicker && Number.isFinite(Number(priceStr)) && Number(priceStr) > 0
  const addAlert = useCallback(async () => {
    if (!canAdd) return
    try {
      await fetch('/api/watchlist-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sym: cleanTicker, target_price: Number(priceStr), direction: dir }),
      })
      setTicker('')
      setPriceStr('')
      mutate()
    } catch { /* non-fatal */ }
  }, [canAdd, cleanTicker, priceStr, dir, mutate])

  const removeAlert = useCallback(async (id) => {
    try {
      await fetch(`/api/watchlist-alerts/${id}`, { method: 'DELETE' })
      mutate()
    } catch { /* non-fatal */ }
  }, [mutate])

  const renderRow = (a, isTriggered) => {
    const dirCls = a.direction === 'above' ? styles.above : styles.below
    const live = isTriggered ? null : (frozenAlerts ? (a.priceAtCapture ?? null) : liveFor(a.sym))
    const level = frozenAlerts ? (a.levelAtCapture ?? Number(a.target_price)) : levelNow(a)
    const priceAbove = live != null ? live >= level : null
    const dirWord = a.direction === 'above' ? 'above ' : 'below '
    return (
      <div
        key={a.id}
        className={`${styles.row}${isTriggered ? ' ' + styles.rowTriggered : ''}`}
        onClick={readOnly ? undefined : () => goToSym(a.sym)}
        title={readOnly ? undefined : `Show ${a.sym} on the linked chart`}
      >
        <span className={`${styles.dirIcon} ${dirCls}`} title={a.direction === 'above' ? 'Cross above' : 'Cross below'} aria-hidden="true">
          {a.direction === 'above' ? '▲' : '▼'}
        </span>
        <div className={styles.main}>
          <div className={styles.line1}>
            <span className={styles.rowSym}>{a.sym}</span>
            <span className={styles.cond}>
              {a.alert_type === 'line'
                ? <>{dirWord}line <span className={styles.target}>${fmtPrice(a.target_price)}</span></>
                : a.alert_type === 'trendline'
                  ? <>{dirWord}trendline <span className={styles.target}>${fmtPrice(level)}</span></>
                  : <>{dirWord}<span className={styles.target}>${fmtPrice(a.target_price)}</span></>}
            </span>
          </div>
          <div className={styles.sub}>
            {isTriggered
              ? (fmtDate(a.triggered_at) ? `Triggered ${fmtDate(a.triggered_at)}` : 'Triggered')
              : (fmtDate(a.created_at) ? `Set ${fmtDate(a.created_at)}` : '')}
          </div>
        </div>
        {!isTriggered && (
          <span className={styles.right}>
            <span className={`${styles.status}${priceAbove == null ? '' : priceAbove ? ' ' + styles.statusAbove : ' ' + styles.statusBelow}`}>
              {priceAbove == null ? '—' : priceAbove ? 'Price above' : 'Price below'}
            </span>
          </span>
        )}
        {!readOnly && (
        <button type="button" className={styles.delBtn} onClick={(e) => { e.stopPropagation(); removeAlert(a.id) }} title="Delete alert" aria-label="Delete alert">
          <UIcon name="x" size={13} strokeWidth={2.4} gold={false} />
        </button>
        )}
      </div>
    )
  }

  return (
    <div ref={rootRef} className={styles.root} style={rootStyle}>
      {settingsOpen && (
        <NewsSettingsPanel
          title="Alerts Settings"
          widgetType="alerts"
          showPerf={false}
          extraSections={[
            { label: 'Text size', rows: [{ key: 'textSize', label: 'Size', type: 'segmented', options: [
              { key: 's', label: 'S' }, { key: 'm', label: 'M' }, { key: 'l', label: 'L' },
            ] }] },
            { label: 'Alert accents', rows: [
              { key: 'aboveColor', label: 'Above', hint: 'cross-above' },
              { key: 'belowColor', label: 'Below', hint: 'cross-below' },
            ] },
          ]}
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={rootRef.current}
          themeVars={menuVars}
        />
      )}

      {/* Header: title + active count + gear (no chart link — this lists everything) */}
      <div className={styles.bar}>
        <span className={styles.titleWrap}>
          <UIcon name="bell" size={14} />
          <span className={styles.title}>Alerts</span>
          {active.length > 0 && <span className={styles.countBadge}>{active.length}</span>}
        </span>
        {/* Send to Journal: freeze the alert list + live state into the note
            (payload capture — deleted alerts are unrecoverable; the capture is
            the only durable record of the list as it stood). */}
        {/* Cluster note (panel finding): .gearBtn here is ABSOLUTE right:8 —
            a position:static door floated beside the title instead of beside
            the gear. right:34 pairs them, same geometry as the calendar's. */}
        {journalDoor && !readOnly && allAlerts.length > 0 && (
          <button
            type="button"
            className={styles.gearBtn}
            style={{ right: 34 }}
            onClick={async () => {
              setJournalMsg('sending…')
              setJournalMsg(await sendCaptureToJournal('alerts', {
                alerts: allAlerts.map((a) => ({
                  ...a, levelAtCapture: levelNow(a), priceAtCapture: liveFor(a.sym),
                })),
                settings,
              }, { label: `${active.length} alerts` }))
            }}
            title="Send these alerts to Journal"
            aria-label="Send these alerts to Journal"
          ><UIcon name="journal" size={13} /></button>
        )}
        <JournalToast msg={journalMsg} />
        {!readOnly && (
        <button
          ref={settingsBtnRef}
          type="button"
          className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="Alerts widget settings"
        ><UIcon name="gear" size={13} /></button>
        )}
      </div>

      {/* Quick-add — any ticker, a level, above/below. Hidden in a frozen
          embed: it is a REAL POST. */}
      {!readOnly && (
      <div className={styles.quickAdd}>
        <input
          className={styles.tickerInput}
          type="text"
          placeholder="Ticker"
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') addAlert() }}
          spellCheck={false}
          autoCapitalize="characters"
          maxLength={8}
        />
        <span className={styles.dirToggle}>
          <button
            type="button"
            className={`${styles.dirBtn} ${styles.dirBtnAbove}${dir === 'above' ? ' ' + styles.dirBtnOn : ''}`}
            onClick={() => setDir('above')}
          >Above</button>
          <button
            type="button"
            className={`${styles.dirBtn} ${styles.dirBtnBelow}${dir === 'below' ? ' ' + styles.dirBtnOn : ''}`}
            onClick={() => setDir('below')}
          >Below</button>
        </span>
        <input
          className={styles.priceInput}
          type="number"
          inputMode="decimal"
          step="0.01"
          placeholder="Price"
          value={priceStr}
          onChange={e => setPriceStr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addAlert() }}
        />
        <button type="button" className={styles.addBtn} onClick={addAlert} disabled={!canAdd}>
          <UIcon name="bell" size={11} gold={false} /> Set
        </button>
      </div>
      )}

      {/* Body */}
      <div className={styles.list}>
        {active.length === 0 && triggered.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><UIcon name="bell" size={26} /></span>
            No alerts yet.<br />Add one above — any ticker, a price, above or below.
          </div>
        )}

        {active.length > 0 && (
          <>
            <div className={styles.sectionLabel}>Live Alerts · {active.length}</div>
            {active.map(a => renderRow(a, false))}
          </>
        )}

        {triggered.length > 0 && (
          <>
            <div className={styles.sectionLabel}>Recently triggered</div>
            {triggered.slice(0, 12).map(a => renderRow(a, true))}
          </>
        )}
      </div>
    </div>
  )
}
