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
import useTickerMeta from '../../../hooks/useTickerMeta'
import * as drawingsStore from '../../../components/chart/drawingsStore'
import UIcon from '../../../components/ui/UIcon'
import CompanyLogo from '../../../components/CompanyLogo'
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
// Beyond this, an item's headline is clamped (with a "Show more" toggle) so a single
// long wire tweet can't dominate the whole feed.
const LONG_TITLE_CHARS = 220

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
// Capitalize the first letter of every word, leaving the rest untouched (owner ask:
// "all catalyst labels capitalized on every word"). Preserves acronyms/tickers/$/%
// (e.g. FY2026, EPS, $42.7M stay as-is; "earnings — beat" → "Earnings — Beat").
function titleCase(s) {
  return String(s || '').replace(/(^|\s)(\p{L})/gu, (_m, pre, ch) => pre + ch.toUpperCase())
}
// Wrap a placed headline into BALANCED lines so a long catalyst never renders as
// one giant single row on the chart — each line caps near HEADLINE_WRAP_CHARS
// (≈ half a long wire headline), so e.g. a 70-char headline lands on two rows.
const HEADLINE_WRAP_CHARS = 36
function wrapHeadline(text) {
  const s = String(text || '').trim()
  if (s.length <= HEADLINE_WRAP_CHARS) return [s]
  const words = s.split(/\s+/)
  const nLines = Math.max(2, Math.ceil(s.length / HEADLINE_WRAP_CHARS))
  const target = Math.ceil(s.length / nLines)   // balanced width per line
  const lines = []
  let cur = ''
  for (const w of words) {
    if (cur && (cur.length + 1 + w.length) > target && lines.length < nLines - 1) {
      lines.push(cur); cur = w
    } else {
      cur = cur ? `${cur} ${w}` : w
    }
  }
  if (cur) lines.push(cur)
  return lines
}
// The text placed on the chart: the Title-Cased headline (wrapped to balanced
// rows), plus (for earnings) an abbreviated second line per stat — "- EPS 0.08
// (+366%)" / "- REV $42.7M (+7%)".
function chartText(e) {
  const lines = wrapHeadline(titleCase(e.title))
  if (Array.isArray(e.chart_lines)) for (const l of e.chart_lines) if (l) lines.push(`- ${l}`)
  return lines.join('\n')
}

export default function NewsWidget({ color, opts, onOptsChange }) {
  const { groupSyms } = useWorkspace()
  const sym = groupSyms?.[color] || null
  // Company name for the header (⚙ "Show" = ticker / company / both) + logo hint.
  // Lightweight, localStorage-seeded, shared with the chart watermark.
  const { name: company } = useTickerMeta(sym)

  // ── Appearance settings (⚙) — mirrors the other widget settings ──
  const { prefs, setPref } = usePreferences()

  // ── "Place on chart" — one-time action, NOT a toggle ──
  // Drops the catalyst onto the linked chart as TWO ordinary, separately editable
  // drawings: a `text` headline + a `trendline` leader connecting it to the candle
  // (linked only by a shared calloutId the overlay uses to place them together, then
  // never again). From there each can be moved, recolored, or deleted on its own —
  // the widget tracks no on/off state. We write straight to the shared per-symbol
  // drawings store, so every chart on this ticker shows them. COLOR + WIDTH are left
  // for the chart's overlay to stamp at placement from ITS current drawing default
  // (what the user last "Saved as default"), so a placed catalyst always matches —
  // the News widget can't see that per-widget default. The overlay also runs the
  // Model-Book blank-space search once to position them clear of the candles.
  const [placedKey, setPlacedKey] = useState(null)   // transient "✓ placed" flash
  const placedTimerRef = useRef(null)
  useEffect(() => () => { if (placedTimerRef.current) clearTimeout(placedTimerRef.current) }, [])
  const placeOnChart = useCallback((e, rowKey) => {
    const date = e?.date && String(e.date).slice(0, 10)
    if (!sym || !date || !e?.title) return
    const cid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `cid-${date}-${Math.round(Date.now() / 1000)}`
    // Label (headline + abbreviated earnings stats) — the overlay fills its point +
    // color via the placement pass. Title-Cased; earnings get the EPS/REV second line.
    drawingsStore.addDrawing(sym, {
      type: 'text',
      text: chartText(e),
      // fontSize is intentionally omitted — like color/width, the chart overlay
      // stamps its current drawing default (what the user last "Saved as default")
      // at placement, so a placed catalyst matches the saved text size.
      points: [],
      calloutRole: 'label',
      calloutId: cid,
      calloutAnchorTime: date,   // candle the placement anchors to
      calloutAutoPlace: true,
    })
    // Leader line — the overlay fills its endpoints + color/width at placement.
    drawingsStore.addDrawing(sym, {
      type: 'trendline',
      points: [],
      calloutRole: 'line',
      calloutId: cid,
      calloutAutoPlace: true,
    })
    setPlacedKey(rowKey)
    if (placedTimerRef.current) clearTimeout(placedTimerRef.current)
    placedTimerRef.current = setTimeout(() => setPlacedKey(null), 1400)
  }, [sym])
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
          title="News & Catalysts Settings"
          extraSections={[{
            label: 'Header',
            rows: [
              { key: 'headerBg', label: 'Header color' },
              { key: 'headerShow', label: 'Show', type: 'segmented', options: [
                { key: 'both', label: 'Both' },
                { key: 'ticker', label: 'Ticker' },
                { key: 'company', label: 'Company' },
              ] },
            ],
          }]}
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={rootRef.current}
          themeVars={menuVars}
        />
      )}

      {/* Header: logo + ticker/company + up/down filter pills + gear.
          `headerShow` (⚙) chooses ticker / company / both. */}
      <div className={styles.bar}>
        <span className={styles.symWrap}>
          {sym && <CompanyLogo sym={sym} size={18} name={company} round />}
          {settings.headerShow !== 'company' && <span className={styles.sym}>{sym || '—'}</span>}
          {sym && company && settings.headerShow === 'both' && <span className={styles.company}>({company})</span>}
          {sym && company && settings.headerShow === 'company' && <span className={styles.sym}>{company}</span>}
          {sym && !company && settings.headerShow === 'company' && <span className={styles.sym}>{sym}</span>}
        </span>
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
            // A very long headline (e.g. a multi-headline wire tweet) is clamped so
            // one entry can't swallow the feed; a "Show more" toggle reveals it.
            const titleLong = (e.title?.length || 0) > LONG_TITLE_CHARS
            const isExpanded = expandedKey === key
            const rowExpandable = expandable || titleLong
            const canPlace = !!(sym && e.date && e.title)
            const justPlaced = placedKey === key
            return (
              <div
                key={key}
                data-news-row
                className={`${styles.row}${rowExpandable ? ' ' + styles.rowClickable : ''}`}
                onClick={rowExpandable ? () => setExpandedKey(k => (k === key ? null : key)) : undefined}
              >
                <span className={`${styles.icon} ${dirCls}`} title={SOURCE_LABEL[e.type] || e.type}>
                  <UIcon name={SOURCE_ICON[e.type] || 'bolt'} size={13} />
                </span>
                <div className={styles.main}>
                  <span className={`${styles.title}${titleLong && !isExpanded ? ' ' + styles.titleClamped : ''}`}>{e.title}</span>
                  {titleLong && (
                    <button
                      type="button"
                      className={styles.moreToggle}
                      onClick={(ev) => { ev.stopPropagation(); setExpandedKey(k => (k === key ? null : key)) }}
                    >{isExpanded ? 'Show less' : 'Show more'}</button>
                  )}
                  {showDetail && e.description && <div className={styles.desc}>{e.description}</div>}
                  <div className={styles.meta}>
                    <span className={styles.date}>{fmtDate(e.date)}</span>
                    {e.move_pct != null && <span className={`${styles.move} ${dirCls}`}>{fmtMove(e.move_pct)}</span>}
                    {e.url
                      ? <a className={styles.source} href={e.url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>{e.source}</a>
                      : <span className={styles.source}>{e.source}</span>}
                  </div>
                </div>
                {canPlace && (
                  <button
                    type="button"
                    className={`${styles.pinBtn}${justPlaced ? ' ' + styles.pinBtnOn : ''}`}
                    onClick={(ev) => { ev.stopPropagation(); placeOnChart(e, key) }}
                    title="Place headline on chart"
                    aria-label="Place headline on chart"
                  ><UIcon name={justPlaced ? 'check' : 'pin'} size={12} /></button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
