/**
 * DockNews — the News & Catalysts panel rebuilt for the RIGHT dock of a chart.
 * NOT the standalone widget: no logo, no ticker, no company name, no ⚙, no
 * Notebook door — the chart already names the stock. Keeps the up/down filter and
 * the "place headline on chart" pin (a genuine chart integration, not chrome).
 *
 * Takes the chart's resolved `sym` directly, so it mirrors the chart exactly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useNewsCatalysts from '../../../hooks/useNewsCatalysts'
import * as drawingsStore from '../../../components/chart/drawingsStore'
import UIcon from '../../../components/ui/UIcon'
import { fmtDate, fmtMove } from '../../../utils/feedFormat'
import styles from './dockPanels.module.css'

const SOURCE_ICON = { catalyst: 'bolt', earnings: 'calendar', breaking: 'bell' }
const SOURCE_LABEL = { catalyst: 'Catalyst', earnings: 'Earnings', breaking: 'Wire' }
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'up', label: '▲ Up' },
  { key: 'down', label: '▼ Down' },
]

const HEADLINE_WRAP_CHARS = 36
function titleCase(s) { return String(s || '').replace(/(^|\s)(\p{L})/gu, (_m, pre, ch) => pre + ch.toUpperCase()) }
function wrapHeadline(text) {
  const s = String(text || '').trim()
  if (s.length <= HEADLINE_WRAP_CHARS) return [s]
  const words = s.split(/\s+/)
  const nLines = Math.max(2, Math.ceil(s.length / HEADLINE_WRAP_CHARS))
  const target = Math.ceil(s.length / nLines)
  const lines = []; let cur = ''
  for (const w of words) {
    if (cur && (cur.length + 1 + w.length) > target && lines.length < nLines - 1) { lines.push(cur); cur = w }
    else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) lines.push(cur)
  return lines
}
function chartText(e) {
  const lines = wrapHeadline(titleCase(e.title))
  if (Array.isArray(e.chart_lines)) for (const l of e.chart_lines) if (l) lines.push(`- ${l}`)
  return lines.join('\n')
}

export default function DockNews({ sym, filter, onFilter }) {
  const [fastPoll, setFastPoll] = useState(false)
  const { status, events } = useNewsCatalysts(sym || null, { generating: fastPoll })
  useEffect(() => { setFastPoll(status === 'generating') }, [status])
  const generating = status === 'generating'

  const shown = useMemo(
    () => (filter === 'all' ? events : (events || []).filter(e => e.direction === filter)),
    [events, filter],
  )

  // Place a catalyst onto the chart as a headline + leader line (shared drawings store).
  const [placedKey, setPlacedKey] = useState(null)
  const placedTimer = useRef(null)
  useEffect(() => () => { if (placedTimer.current) clearTimeout(placedTimer.current) }, [])
  const placeOnChart = useCallback((e, key) => {
    const date = e?.date && String(e.date).slice(0, 10)
    if (!sym || !date || !e?.title) return
    const cid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `cid-${date}-${Math.round(Date.now() / 1000)}`
    drawingsStore.addDrawing(sym, { type: 'text', text: chartText(e), points: [], calloutRole: 'label', calloutId: cid, calloutAnchorTime: date, calloutAutoPlace: true })
    drawingsStore.addDrawing(sym, { type: 'trendline', points: [], calloutRole: 'line', calloutId: cid, calloutAutoPlace: true })
    setPlacedKey(key)
    if (placedTimer.current) clearTimeout(placedTimer.current)
    placedTimer.current = setTimeout(() => setPlacedKey(null), 1400)
  }, [sym])

  if (!sym) return <div className={styles.emptyState}>No symbol.</div>

  return (
    <div className={styles.news}>
      <div className={styles.newsFilters}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            className={`${styles.filterPill}${filter === f.key ? ' ' + styles.filterOn : ''}`}
            onClick={() => onFilter(f.key)}
          >{f.label}</button>
        ))}
      </div>

      {generating && <div className={styles.generating} style={{ padding: '8px 12px' }}><span className={styles.spinner} /> Finding significant catalysts…</div>}
      {!generating && shown.length === 0 && (
        <div className={styles.emptyState}>No {filter !== 'all' ? filter + ' ' : ''}catalysts yet for {sym}.</div>
      )}

      {shown.length > 0 && (
        <div className={styles.feed}>
          {shown.map((e, i) => {
            const d = e.direction || 'neutral'
            const dc = d === 'up' ? styles.up : d === 'down' ? styles.down : styles.neutral
            const key = `${e.type}-${e.date}-${i}`
            const canPlace = !!(sym && e.date && e.title)
            const placed = placedKey === key
            return (
              <div key={key} className={`${styles.newsRow} ${dc}`}>
                <span className={`${styles.newsIcon} ${dc}`} title={SOURCE_LABEL[e.type] || e.type}>
                  <UIcon name={SOURCE_ICON[e.type] || 'bolt'} size={13} gold={false} />
                </span>
                <div className={styles.newsMain}>
                  <div className={styles.newsTitle}>{e.title}</div>
                  {e.description && <div className={styles.newsDesc}>{e.description}</div>}
                  <div className={styles.newsMeta}>
                    <span>{fmtDate(e.date)}</span>
                    {e.move_pct != null && <span className={`${styles.newsMove} ${dc}`}>{fmtMove(e.move_pct)}</span>}
                    {e.url
                      ? <a className={styles.newsSource} href={e.url} target="_blank" rel="noreferrer">{e.source}</a>
                      : <span className={styles.newsSource}>{e.source}</span>}
                  </div>
                </div>
                {canPlace && (
                  <button
                    type="button"
                    className={`${styles.pinBtn}${placed ? ' ' + styles.pinOn : ''}`}
                    onClick={() => placeOnChart(e, key)}
                    title="Place headline on chart"
                    aria-label="Place headline on chart"
                  ><UIcon name={placed ? 'check' : 'pin'} size={12} gold={false} /></button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
