/**
 * News & Catalysts widget — a per-stock feed of HIGH-IMPACT catalysts + breaking
 * news for whichever symbol is selected on this widget's color group.
 *
 * Reuses the shared catalyst generator (historical YTD-2026), earnings markers,
 * and curated wire tweets via one thin endpoint (/api/news-catalysts/{sym}). No
 * per-view LLM cost; near-real-time via market-hours-aware polling.
 *
 * Appearance (canvas + text color) is a per-widget ⚙ blob persisted globally like
 * the other widget settings; the up/down filter persists per-widget via opts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import { menuThemeVars } from '../../../utils/dividerColor'
import useNewsCatalysts from '../../../hooks/useNewsCatalysts'
import UIcon from '../../../components/ui/UIcon'
import NewsSettingsPanel from './NewsSettingsPanel'
import {
  NEWS_WIDGET_SETTINGS_KEY, NEWS_WIDGET_DEFAULTS,
  mergeNewsWidgetSettings, newsWidgetStyleVars,
} from './newsWidgetSettings'
import styles from './NewsWidget.module.css'

const SOURCE_ICON = { catalyst: 'bolt', earnings: 'calendar', breaking: 'bell' }
const SOURCE_LABEL = { catalyst: 'Catalyst', earnings: 'Earnings', breaking: 'Wire' }
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'up', label: '▲ Up' },
  { key: 'down', label: '▼ Down' },
]
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(d) {
  if (!d) return ''
  const parts = String(d).slice(0, 10).split('-')
  const y = Number(parts[0]), m = Number(parts[1]), day = Number(parts[2])
  return (m >= 1 && m <= 12) ? `${MON[m - 1]} ${day}, ${y}` : String(d)
}
function fmtMove(mp) {
  const n = Number(mp)
  if (!Number.isFinite(n)) return ''
  return `${n >= 0 ? '+' : ''}${Number.isInteger(n) ? n : n.toFixed(1)}%`
}

export default function NewsWidget({ color, opts, onOptsChange }) {
  const { groupSyms } = useWorkspace()
  const sym = groupSyms?.[color] || null

  // ── Appearance settings (⚙) — mirrors the other widget settings ──
  const { prefs, setPref } = usePreferences()
  const settings = useMemo(
    () => mergeNewsWidgetSettings(parsePref(prefs?.[NEWS_WIDGET_SETTINGS_KEY], null)),
    [prefs],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const rootRef = useRef(null)
  const patchSettings = useCallback(
    (patch) => setPref(NEWS_WIDGET_SETTINGS_KEY, JSON.stringify({ ...settings, ...patch })),
    [settings, setPref],
  )
  const resetSettings = useCallback(
    () => setPref(NEWS_WIDGET_SETTINGS_KEY, JSON.stringify(NEWS_WIDGET_DEFAULTS)),
    [setPref],
  )
  const rootStyle = useMemo(() => newsWidgetStyleVars(settings), [settings])
  const menuVars = useMemo(() => {
    const canvas = settings.bgMode === 'gradient' ? (settings.bgGradient?.top || settings.bg) : settings.bg
    return menuThemeVars(canvas) || {}
  }, [settings])

  // ── Up/down filter — per-widget, persisted via workspace opts ──
  const filter = ['up', 'down'].includes(opts?.filter) ? opts.filter : 'all'
  const setFilter = useCallback((next) => {
    onOptsChange?.({ ...(opts || {}), filter: next })
  }, [opts, onOptsChange])

  // ── Data — poll fast while historical catalysts generate, then settle ──
  const [fastPoll, setFastPoll] = useState(false)
  const { status, events } = useNewsCatalysts(sym, { generating: fastPoll })
  useEffect(() => { setFastPoll(status === 'generating') }, [status])

  const shown = useMemo(
    () => (filter === 'all' ? events : events.filter(e => e.direction === filter)),
    [events, filter],
  )
  const generating = status === 'generating'

  // ── Compact detection — when the column is too narrow to auto-show the
  // description inline, rows become click-to-expand instead (owner ask). ──
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || el.clientWidth
      setCompact(w < 320)   // only the very-thin widget hides detail behind a click
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Expanded row (compact mode only). Close on symbol/filter/width change, and on
  // any click that isn't inside a row (i.e. "click away anywhere").
  const [expandedKey, setExpandedKey] = useState(null)
  useEffect(() => { setExpandedKey(null) }, [sym, filter, compact])
  useEffect(() => {
    if (expandedKey == null) return
    const onDown = (e) => {
      if (!e.target.closest?.('[data-news-row]')) setExpandedKey(null)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [expandedKey])

  return (
    <div ref={rootRef} className={styles.root} style={rootStyle}>
      {settingsOpen && (
        <NewsSettingsPanel
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={rootRef.current}
          themeVars={menuVars}
        />
      )}

      {/* Header: symbol chip + up/down filter pills + gear */}
      <div className={styles.bar}>
        <span className={styles.sym}>{sym || '—'}</span>
        <div className={styles.filters}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              className={`${styles.pill}${filter === f.key ? ' ' + styles.pillOn : ''}`}
              onClick={() => setFilter(f.key)}
            >{f.label}</button>
          ))}
        </div>
        <button
          ref={settingsBtnRef}
          type="button"
          className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="News widget settings"
        ><UIcon name="gear" size={13} /></button>
      </div>

      {generating && (
        <div className={styles.generating}>
          <span className={styles.spinner} /> Finding significant catalysts…
        </div>
      )}

      {!sym && (
        <div className={styles.empty}>
          Link this widget's color group to a stock to see its news &amp; catalysts.
        </div>
      )}

      {sym && !generating && shown.length === 0 && (
        <div className={styles.empty}>No {filter !== 'all' ? filter + ' ' : ''}catalysts yet for {sym}.</div>
      )}

      {sym && shown.length > 0 && (
        <div className={styles.list}>
          {shown.map((e, i) => {
            const dir = e.direction || 'neutral'
            const dirCls = dir === 'up' ? styles.up : dir === 'down' ? styles.down : styles.neutral
            const key = `${e.type}-${e.date}-${i}`
            const hasDetail = !!e.description
            // Only the very-thin widget hides the detail behind a click; every
            // wider size auto-shows it inline. The revealed text IS the inline
            // detail — same plain style, no box.
            const expandable = compact && hasDetail
            const showDetail = !compact || (expandable && expandedKey === key)
            return (
              <div
                key={key}
                data-news-row
                className={`${styles.row}${expandable ? ' ' + styles.rowClickable : ''}`}
                onClick={expandable ? () => setExpandedKey(k => (k === key ? null : key)) : undefined}
              >
                <span className={`${styles.icon} ${dirCls}`} title={SOURCE_LABEL[e.type] || e.type}>
                  <UIcon name={SOURCE_ICON[e.type] || 'bolt'} size={13} />
                </span>
                <div className={styles.main}>
                  <span className={styles.title}>{e.title}</span>
                  {showDetail && e.description && <div className={styles.desc}>{e.description}</div>}
                  <div className={styles.meta}>
                    <span className={styles.date}>{fmtDate(e.date)}</span>
                    {e.move_pct != null && <span className={`${styles.move} ${dirCls}`}>{fmtMove(e.move_pct)}</span>}
                    {e.url
                      ? <a className={styles.source} href={e.url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>{e.source}</a>
                      : <span className={styles.source}>{e.source}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
