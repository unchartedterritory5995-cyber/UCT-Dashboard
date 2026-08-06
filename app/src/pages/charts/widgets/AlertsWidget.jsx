/**
 * Alerts widget — a per-color-group price-alert command center.
 *
 * Surfaces the user's price alerts (the same `watchlist_alerts` that power the
 * bell + email/Discord delivery) as a live, glanceable board: each alert shows
 * its condition, a PROXIMITY METER that fills as the live price nears the target
 * (glows "Armed" within ~1%, reads "Hit" once met), and a one-click quick-add for
 * whichever symbol is linked to this widget's color group.
 *
 * Appearance (canvas + text color + text size) is a per-widget ⚙ blob persisted
 * like the other widget settings; a widget with NO explicit look follows the app
 * theme (light → white canvas + dark text, OLED → black canvas + light text).
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { useWorkspace } from '../WorkspaceContext'
import { useAuth } from '../../../context/AuthContext'
import usePreferences from '../../../hooks/usePreferences'
import useLivePrices from '../../../hooks/useLivePrices'
import useTickerMeta from '../../../hooks/useTickerMeta'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import CompanyLogo from '../../../components/CompanyLogo'
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

// Proximity of `live` to `target` for an alert of the given direction.
// Returns { pct, fill, armed, hit } where fill is 0..100 (meter width),
// pct is the signed % distance still to go, armed = within 1%, hit = condition met.
function proximity(live, target, direction) {
  const l = Number(live), t = Number(target)
  if (!Number.isFinite(l) || !Number.isFinite(t) || t === 0) return null
  const gapPct = ((l - t) / t) * 100                 // + means live is above target
  const hit = direction === 'above' ? l >= t : l <= t
  const away = Math.abs(gapPct)
  // Meter starts filling within 10% and is ~full within ~0.5% of the target.
  const fill = hit ? 100 : Math.max(0, Math.min(100, 100 - away * 10))
  return { away, fill, armed: !hit && away <= 1, hit }
}

export default function AlertsWidget({ color, opts, onOptsChange }) {
  const { groupSyms } = useWorkspace()
  const sym = groupSyms?.[color] || null
  const { name: company } = useTickerMeta(sym)
  const { user } = useAuth()

  // ── Appearance settings (⚙) — mirrors the News widget ──
  const { prefs } = usePreferences()
  const settings = useMemo(
    () => mergeAlertsWidgetSettings(opts?.settings ?? alertsDefaultsForTheme(prefs.theme)),
    [opts?.settings, prefs.theme],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  // ── Scope filter — this symbol vs all — persisted per-widget via opts ──
  const scope = opts?.scope === 'all' ? 'all' : 'sym'
  const setScope = useCallback((next) => onOptsChange?.({ ...(opts || {}), scope: next }), [opts, onOptsChange])

  // ── Alerts data (active + triggered) ──
  const { data, mutate } = useSWR(
    user ? '/api/watchlist-alerts?active_only=false' : null,
    fetcher,
    { refreshInterval: 30000, dedupingInterval: 10000 },
  )
  const allAlerts = useMemo(() => (Array.isArray(data) ? data : []), [data])

  const visible = useMemo(() => {
    const list = scope === 'sym' && sym
      ? allAlerts.filter(a => (a.sym || '').toUpperCase() === sym.toUpperCase())
      : allAlerts
    return list
  }, [allAlerts, scope, sym])

  const active = useMemo(() => visible.filter(a => a.is_active), [visible])
  const triggered = useMemo(
    () => visible.filter(a => !a.is_active).sort((x, y) => String(y.triggered_at || '').localeCompare(String(x.triggered_at || ''))),
    [visible],
  )
  const activeCount = allAlerts.filter(a => a.is_active).length

  // Live prices for every symbol we're showing (+ the linked one, for quick-add default).
  const priceSyms = useMemo(() => {
    const s = new Set(visible.map(a => (a.sym || '').toUpperCase()).filter(Boolean))
    if (sym) s.add(sym.toUpperCase())
    return [...s]
  }, [visible, sym])
  const { prices } = useLivePrices(priceSyms)
  const liveFor = useCallback((s) => prices[(s || '').toUpperCase()]?.price ?? null, [prices])

  // ── Quick-add ──
  const [dir, setDir] = useState('above')
  const [priceStr, setPriceStr] = useState('')
  const canAdd = !!sym && Number.isFinite(Number(priceStr)) && Number(priceStr) > 0
  const addAlert = useCallback(async () => {
    if (!canAdd) return
    try {
      await fetch('/api/watchlist-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sym: sym.toUpperCase(), target_price: Number(priceStr), direction: dir }),
      })
      setPriceStr('')
      mutate()
    } catch { /* non-fatal */ }
  }, [canAdd, sym, priceStr, dir, mutate])

  const removeAlert = useCallback(async (id) => {
    try {
      await fetch(`/api/watchlist-alerts/${id}`, { method: 'DELETE' })
      mutate()
    } catch { /* non-fatal */ }
  }, [mutate])

  // Prefill the quick-add price with the live price the first time it's blank + focused.
  const onPriceFocus = useCallback(() => {
    if (priceStr) return
    const lp = liveFor(sym)
    if (lp != null) setPriceStr(String(Number(lp).toFixed(2)))
  }, [priceStr, liveFor, sym])

  const renderRow = (a, isTriggered) => {
    const live = liveFor(a.sym)
    const prox = isTriggered ? null : proximity(live, a.target_price, a.direction)
    const dirCls = a.direction === 'above' ? styles.above : styles.below
    return (
      <div key={a.id} className={`${styles.row}${isTriggered ? ' ' + styles.rowTriggered : ''}${prox?.armed ? ' ' + styles.armed : ''}`}>
        <span className={`${styles.dirIcon} ${dirCls}`} title={a.direction === 'above' ? 'Cross above' : 'Cross below'} aria-hidden="true">
          {a.direction === 'above' ? '▲' : '▼'}
        </span>
        <div className={styles.main}>
          <div className={styles.line1}>
            {(scope === 'all' || !sym) && <span className={styles.rowSym}>{a.sym}</span>}
            <span className={styles.cond}>
              {a.direction === 'above' ? 'above ' : 'below '}
              <span className={styles.target}>${fmtPrice(a.target_price)}</span>
            </span>
          </div>
          {!isTriggered && (
            <div className={styles.meterRow}>
              <span className={styles.track}>
                <span className={`${styles.fill} ${dirCls}`} style={{ width: `${prox ? prox.fill : 0}%` }} />
              </span>
              <span className={`${styles.dist}${prox?.hit ? ' ' + styles.distHit : prox?.armed ? ' ' + styles.distArmed : ''}`}>
                {!prox ? '—' : prox.hit ? 'Hit' : prox.armed ? 'Armed' : `${prox.away.toFixed(prox.away < 10 ? 1 : 0)}%`}
              </span>
            </div>
          )}
        </div>
        {!isTriggered && (
          <span className={styles.right}>
            <span className={styles.live}>{live != null ? `$${fmtPrice(live)}` : '—'}</span>
            <span className={styles.liveLbl}>Live</span>
          </span>
        )}
        <button type="button" className={styles.delBtn} onClick={() => removeAlert(a.id)} title="Delete alert" aria-label="Delete alert">
          <UIcon name="x" size={12} />
        </button>
      </div>
    )
  }

  return (
    <div ref={rootRef} className={styles.root} style={rootStyle}>
      {settingsOpen && (
        <NewsSettingsPanel
          title="Alerts Settings"
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

      {/* Header: logo + ticker + scope pills + gear */}
      <div className={styles.bar}>
        <span className={styles.symWrap}>
          {sym && <CompanyLogo sym={sym} size={18} name={company} round />}
          <span className={styles.sym}>{sym || 'Alerts'}</span>
        </span>
        <div className={styles.filters}>
          <button
            type="button"
            className={`${styles.pill}${scope === 'sym' ? ' ' + styles.pillOn : ''}`}
            onClick={() => setScope('sym')}
            disabled={!sym}
            title={sym ? `Alerts for ${sym}` : 'Link a symbol to filter'}
          >{sym || 'Symbol'}</button>
          <button
            type="button"
            className={`${styles.pill}${scope === 'all' ? ' ' + styles.pillOn : ''}`}
            onClick={() => setScope('all')}
          >All<span className={styles.count}>{activeCount ? ` ${activeCount}` : ''}</span></button>
        </div>
        <button
          ref={settingsBtnRef}
          type="button"
          className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="Alerts widget settings"
        ><UIcon name="gear" size={13} /></button>
      </div>

      {/* Quick-add for the linked symbol */}
      {sym && (
        <div className={styles.quickAdd}>
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
            onFocus={onPriceFocus}
            onChange={e => setPriceStr(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addAlert() }}
          />
          <button type="button" className={styles.addBtn} onClick={addAlert} disabled={!canAdd}>
            <UIcon name="bell" size={11} /> Set
          </button>
        </div>
      )}

      {/* Body */}
      <div className={styles.list}>
        {active.length === 0 && triggered.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><UIcon name="bell" size={26} /></span>
            {sym
              ? <>No alerts for {sym} yet.<br />Set a price above or below to arm one.</>
              : <>Link this widget's color group to a stock, or switch to <strong>All</strong> to see every alert.</>}
          </div>
        )}

        {active.length > 0 && (
          <>
            <div className={styles.sectionLabel}>Armed · {active.length}</div>
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
