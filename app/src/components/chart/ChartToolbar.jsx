// app/src/components/chart/ChartToolbar.jsx — TradingView-style vertical drawing toolbar
import { useState, useRef, useEffect } from 'react'
import styles from './ChartToolbar.module.css'

// ─── SVG icon factory ────────────────────────────────────────────────────────
const I = (children) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none"
    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

const ICONS = {
  cursor:     I(<path d="M4 2v11l2.5-2.5L9 14l1.5-1-2.5-3.5H12z" fill="currentColor" stroke="none" />),
  trendline:  I(<line x1="3" y1="13" x2="13" y2="3" />),
  ray:        I(<><line x1="3" y1="13" x2="13" y2="3" /><polyline points="13,3 9,3 13,7" fill="none" /></>),
  extended:   I(<><line x1="1" y1="15" x2="15" y2="1" strokeDasharray="1.5 1.5" /><line x1="4" y1="12" x2="12" y2="4" /></>),
  horizontal: I(<><line x1="1" y1="8" x2="15" y2="8" /><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" /></>),
  hray:       I(<><line x1="6" y1="8" x2="15" y2="8" /><circle cx="6" cy="8" r="1.5" fill="currentColor" stroke="none" /><polyline points="15,8 12,6 12,10" fill="currentColor" stroke="none" /></>),
  vertical:   I(<><line x1="8" y1="1" x2="8" y2="15" /><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" /></>),
  rect:       I(<rect x="3" y="4" width="10" height="8" />),
  circle:     I(<ellipse cx="8" cy="8" rx="6" ry="5" />),
  arrow:      I(<><line x1="3" y1="13" x2="13" y2="3" /><polyline points="7,3 13,3 13,9" fill="none" /></>),
  fib:        I(<><line x1="2" y1="2" x2="14" y2="2" /><line x1="2" y1="6" x2="14" y2="6" strokeDasharray="2 1" /><line x1="2" y1="10" x2="14" y2="10" strokeDasharray="2 1" /><line x1="2" y1="14" x2="14" y2="14" /></>),
  channel:    I(<><line x1="2" y1="12" x2="11" y2="3" /><line x1="5" y1="14" x2="14" y2="5" /></>),
  avwap:      I(<><path d="M3 12 C5 6, 8 4, 13 5" fill="none" /><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none" /><text x="9" y="13" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">V</text></>),
  text:       I(<text x="4" y="12.5" fontSize="11" fontWeight="700" fill="currentColor" stroke="none" fontFamily="monospace">T</text>),
  measure:    I(<><rect x="2" y="4" width="12" height="8" strokeDasharray="2 1" /><line x1="4" y1="8" x2="12" y2="8" /><line x1="4" y1="6" x2="4" y2="10" /><line x1="12" y1="6" x2="12" y2="10" /></>),
  delete:     I(<><polyline points="3,5 4,14 12,14 13,5" /><line x1="2" y1="5" x2="14" y2="5" /><line x1="6" y1="3" x2="10" y2="3" /><line x1="7" y1="7" x2="7" y2="12" /><line x1="9" y1="7" x2="9" y2="12" /></>),
  clear:      I(<><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></>),
}

// ─── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  { id: 'cursor',     label: 'Select (V)' },
  'sep',
  { id: 'trendline',  label: 'Trendline (T)' },
  { id: 'extended',   label: 'Extended Line' },
  { id: 'horizontal', label: 'Horizontal Line (H)' },
  { id: 'hray',       label: 'Horizontal Ray' },
  { id: 'vertical',   label: 'Vertical Line' },
  'sep',
  { id: 'rect',       label: 'Rectangle (R)' },
  { id: 'circle',     label: 'Circle' },
  { id: 'arrow',      label: 'Arrow' },
  'sep',
  { id: 'fib',        label: 'Fibonacci Retracement (F)' },
  { id: 'channel',    label: 'Parallel Channel' },
  { id: 'avwap',      label: 'Anchored VWAP' },
  'sep',
  { id: 'text',       label: 'Text Note (X)' },
  { id: 'measure',    label: 'Measure (M)' },
]

const COLORS = [
  '#c9a84c', // gold
  '#4ade80', // green
  '#ef4444', // red
  '#60a5fa', // blue
  '#f472b6', // pink
  '#fb923c', // orange
  '#a78bfa', // purple
  '#e2e8f0', // light gray
]

const WIDTHS = [1, 2, 3]

// ─── Component ───────────────────────────────────────────────────────────────
export default function ChartToolbar({
  activeTool, setActiveTool,
  color, setColor,
  lineWidth, setLineWidth,
  hasSelection, onDelete, onClearAll,
  drawingCount,
}) {
  const [showColors, setShowColors] = useState(false)
  const [showWidths, setShowWidths] = useState(false)
  const colorRef = useRef(null)
  const widthRef = useRef(null)

  // Close popups on outside click
  useEffect(() => {
    const handler = (e) => {
      if (showColors && colorRef.current && !colorRef.current.contains(e.target)) setShowColors(false)
      if (showWidths && widthRef.current && !widthRef.current.contains(e.target)) setShowWidths(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColors, showWidths])

  const selectTool = (id) => {
    if (id === 'cursor') {
      setActiveTool(activeTool === 'cursor' ? null : 'cursor')
    } else {
      setActiveTool(activeTool === id ? null : id)
    }
  }

  return (
    <div className={styles.toolbar}>
      {/* ── Tool buttons ── */}
      <div className={styles.tools}>
        {TOOLS.map((t, i) =>
          t === 'sep' ? <div key={`sep-${i}`} className={styles.sep} /> : (
            <button
              key={t.id}
              className={`${styles.btn} ${activeTool === t.id ? styles.active : ''}`}
              onClick={() => selectTool(t.id)}
              title={t.label}
            >
              {ICONS[t.id]}
            </button>
          )
        )}
      </div>

      {/* ── Bottom actions ── */}
      <div className={styles.actions}>
        <div className={styles.sep} />

        {/* Color picker */}
        <div ref={colorRef} className={styles.pickerWrap}>
          <button
            className={styles.btn}
            onClick={() => { setShowColors(!showColors); setShowWidths(false) }}
            title="Color"
          >
            <div className={styles.colorSwatch} style={{ background: color }} />
          </button>
          {showColors && (
            <div className={styles.popup}>
              {COLORS.map(c => (
                <button
                  key={c}
                  className={`${styles.colorOption} ${c === color ? styles.colorActive : ''}`}
                  style={{ background: c }}
                  onClick={() => { setColor(c); setShowColors(false) }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Line width */}
        <div ref={widthRef} className={styles.pickerWrap}>
          <button
            className={styles.btn}
            onClick={() => { setShowWidths(!showWidths); setShowColors(false) }}
            title={`Line width: ${lineWidth}px`}
          >
            <svg viewBox="0 0 14 14" width="14" height="14">
              <line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="1" />
              <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="2" />
              <line x1="1" y1="11" x2="13" y2="11" stroke="currentColor" strokeWidth="3" />
            </svg>
          </button>
          {showWidths && (
            <div className={styles.popup}>
              {WIDTHS.map(w => (
                <button
                  key={w}
                  className={`${styles.widthOption} ${w === lineWidth ? styles.widthActive : ''}`}
                  onClick={() => { setLineWidth(w); setShowWidths(false) }}
                >
                  <svg viewBox="0 0 28 12" width="28" height="12">
                    <line x1="2" y1="6" x2="26" y2="6" stroke="currentColor" strokeWidth={w} />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.sep} />

        {/* Delete selected */}
        <button
          className={`${styles.btn} ${hasSelection ? styles.danger : ''}`}
          onClick={onDelete}
          disabled={!hasSelection}
          title="Delete selected (Del)"
        >
          {ICONS.delete}
        </button>

        {/* Clear all */}
        <button
          className={`${styles.btn} ${drawingCount > 0 ? styles.danger : ''}`}
          onClick={() => { if (drawingCount > 0 && confirm('Clear all drawings on this chart?')) onClearAll() }}
          disabled={!drawingCount}
          title={`Clear all (${drawingCount})`}
        >
          {ICONS.clear}
        </button>
      </div>
    </div>
  )
}
