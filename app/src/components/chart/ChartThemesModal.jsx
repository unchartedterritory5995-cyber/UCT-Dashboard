import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CHART_THEMES, THEME_FAMILIES } from './chartThemes'
import styles from './ChartThemesModal.module.css'

// A fixed, idealized OHLC series (an uptrend with pullbacks so BOTH candle colors
// appear) shared by every preview tile — like the reference gallery, where every
// mini chart shows the same price action so only the palette differs. Values are
// arbitrary price units; the tile maps them to pixels.
const PREVIEW_BARS = [
  { o: 40, h: 46, l: 38, c: 44 }, { o: 44, h: 50, l: 42, c: 48 },
  { o: 48, h: 52, l: 44, c: 45 }, { o: 45, h: 49, l: 40, c: 47 },
  { o: 47, h: 55, l: 46, c: 54 }, { o: 54, h: 58, l: 50, c: 51 },
  { o: 51, h: 56, l: 49, c: 55 }, { o: 55, h: 63, l: 54, c: 61 },
  { o: 61, h: 64, l: 56, c: 58 }, { o: 58, h: 62, l: 52, c: 54 },
  { o: 54, h: 60, l: 52, c: 59 }, { o: 59, h: 68, l: 58, c: 66 },
]

// A lightly smoothed close line for the two MA overlays in the preview.
function smooth(vals, win) {
  return vals.map((_, i) => {
    let sum = 0, n = 0
    for (let k = Math.max(0, i - win + 1); k <= i; k++) { sum += vals[k]; n++ }
    return sum / n
  })
}

/** SVG mock-candle preview painted in a theme's own colors. No data fetch. */
function ThemePreview({ theme }) {
  const W = 200, H = 116
  const padL = 8, padR = 22, padT = 10, padB = 10
  const bars = PREVIEW_BARS
  const lo = Math.min(...bars.map(b => b.l)) - 3
  const hi = Math.max(...bars.map(b => b.h)) + 3
  const y = (p) => padT + (hi - p) / (hi - lo) * (H - padT - padB)
  const plotW = W - padL - padR
  const step = plotW / bars.length
  const bodyW = Math.max(3, step * 0.62)

  const closes = bars.map(b => b.c)
  const ma1 = smooth(closes, 3)
  const ma2 = smooth(closes, 6)
  const cx = (i) => padL + step * i + step / 2
  const line = (arr) => arr.map((v, i) => `${cx(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  const grid = theme.grid || 'rgba(255,255,255,0.05)'
  const up = theme.up, down = theme.down
  const ma = Array.isArray(theme.ma) ? theme.ma : []
  const bgId = `bg-${theme.id}`
  const gradient = theme.bgGradient

  return (
    <svg className={styles.preview} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${theme.name} preview`}>
      <defs>
        {gradient && (
          <linearGradient id={bgId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={gradient.top} />
            <stop offset="100%" stopColor={gradient.bottom} />
          </linearGradient>
        )}
      </defs>
      <rect x="0" y="0" width={W} height={H} fill={gradient ? `url(#${bgId})` : theme.bg} />
      {/* faint horizontal gridlines */}
      {[0.28, 0.55, 0.82].map((f, i) => (
        <line key={i} x1={padL} y1={padT + f * (H - padT - padB)} x2={W - padR} y2={padT + f * (H - padT - padB)} stroke={grid} strokeWidth="1" />
      ))}
      {/* right axis rail tint */}
      <line x1={W - padR + 2} y1={padT} x2={W - padR + 2} y2={H - padB} stroke={grid} strokeWidth="1" />
      {/* MA overlays */}
      {ma[2] && <polyline points={line(ma2)} fill="none" stroke={ma[2]} strokeWidth="1.4" strokeLinejoin="round" opacity="0.9" />}
      {ma[0] && <polyline points={line(ma1)} fill="none" stroke={ma[0]} strokeWidth="1.4" strokeLinejoin="round" opacity="0.9" />}
      {/* candles */}
      {bars.map((b, i) => {
        const rising = b.c >= b.o
        const body = rising ? up : down
        const border = rising ? (theme.upBorder || up) : (theme.downBorder || down)
        const wick = rising ? (theme.upWick || up) : (theme.downWick || down)
        const x = cx(i)
        const yo = y(b.o), yc = y(b.c)
        const top = Math.min(yo, yc)
        const hgt = Math.max(1.5, Math.abs(yc - yo))
        return (
          <g key={i}>
            <line x1={x} y1={y(b.h)} x2={x} y2={y(b.l)} stroke={wick} strokeWidth="1" />
            <rect x={x - bodyW / 2} y={top} width={bodyW} height={hgt} fill={body} stroke={border} strokeWidth="0.75" />
          </g>
        )
      })}
      {/* last-price tag on the right rail, in the theme's up color */}
      <rect x={W - padR + 3} y={y(bars[bars.length - 1].c) - 5} width={padR - 4} height="10" rx="1.5" fill={up} opacity="0.9" />
    </svg>
  )
}

// Does `settings` already look like `theme`? (background + up + down match.)
function isApplied(settings, theme) {
  if (!settings) return false
  const bg = theme.bgGradient ? theme.bgGradient.bottom : theme.bg
  const norm = (c) => String(c || '').trim().toLowerCase()
  return norm(settings.background) === norm(bg)
    && norm(settings.candles?.upColor) === norm(theme.up)
    && norm(settings.candles?.downColor) === norm(theme.down)
}

/**
 * The big, blurred UCT Chart Themes gallery. Opened from ChartSettingsModal's
 * header. `onApply(theme, scope)` applies the theme's visual layer; `scope` is
 * 'one' (this chart) or 'all' (every chart in the layout — only offered when
 * `canApplyAll` is true). Applies and closes so the user immediately sees the
 * reskinned chart behind the (now dismissed) blur.
 */
export default function ChartThemesModal({ open, onClose, onApply, canApplyAll = false, canApplyAllWidgets = false, currentSettings = null, themeVars = null }) {
  const [family, setFamily] = useState('all')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('one')
  const famLabel = (id) => (THEME_FAMILIES.find(f => f.id === id) || {}).label || id

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Reset transient UI each open.
  useEffect(() => { if (open) { setFamily('all'); setQuery(''); setScope('one') } }, [open])
  // A scope is only honored when the surface actually supports it — clamp at read
  // time so a stale scope can never fall through to the wrong target.
  const effScope = (scope === 'allwidgets' && canApplyAllWidgets) ? 'allwidgets'
    : (scope === 'all' && canApplyAll) ? 'all'
    : 'one'

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CHART_THEMES.filter(t =>
      (family === 'all' || t.family === family) &&
      (!q || t.name.toLowerCase().includes(q) || t.family.toLowerCase().includes(q)))
  }, [family, query])

  if (!open) return null

  const pick = (theme) => { onApply?.(theme, effScope); onClose?.() }

  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="UCT Chart Themes">
      <div className={styles.panel} style={themeVars || undefined} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleWrap}>
            <span className={styles.title}>UCT Chart Themes</span>
            <span className={styles.subtitle}>Pick a look — your indicators, timeframes and layout stay put.</span>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.controls}>
          <div className={styles.pills}>
            <button type="button" className={`${styles.pill} ${family === 'all' ? styles.pillOn : ''}`} onClick={() => setFamily('all')}>All</button>
            {THEME_FAMILIES.map(f => (
              <button key={f.id} type="button" className={`${styles.pill} ${family === f.id ? styles.pillOn : ''}`} onClick={() => setFamily(f.id)}>{f.label}</button>
            ))}
          </div>
          <input
            className={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search themes…"
            aria-label="Search themes"
          />
        </div>

        <div className={styles.grid}>
          {shown.map(theme => {
            const applied = isApplied(currentSettings, theme)
            return (
              <button
                key={theme.id}
                type="button"
                className={`${styles.tile} ${applied ? styles.tileApplied : ''}`}
                onClick={() => pick(theme)}
                title={`Apply “${theme.name}”${effScope === 'all' ? ' to all charts' : effScope === 'allwidgets' ? ' to all widgets' : ''}`}
              >
                <div className={styles.tileHead}>
                  <span className={styles.tileName}>{theme.name}</span>
                  {applied
                    ? <span className={styles.appliedTag}>✓ Active</span>
                    : <span className={styles.tileFam}>{famLabel(theme.family)}</span>}
                </div>
                <ThemePreview theme={theme} />
              </button>
            )
          })}
          {shown.length === 0 && <div className={styles.empty}>No themes match “{query}”.</div>}
        </div>

        <div className={styles.footer}>
          <span className={styles.footLabel}>Apply to:</span>
          <div className={styles.scopeSeg}>
            <button type="button" className={`${styles.scopeBtn} ${effScope === 'one' ? styles.scopeOn : ''}`} onClick={() => setScope('one')}>This chart</button>
            <button
              type="button"
              className={`${styles.scopeBtn} ${effScope === 'all' ? styles.scopeOn : ''}`}
              onClick={() => canApplyAll && setScope('all')}
              disabled={!canApplyAll}
              title={canApplyAll ? 'Apply the next pick to every chart in the layout' : 'Available on the Charts workspace'}
            >All charts</button>
            <button
              type="button"
              className={`${styles.scopeBtn} ${effScope === 'allwidgets' ? styles.scopeOn : ''}`}
              onClick={() => canApplyAllWidgets && setScope('allwidgets')}
              disabled={!canApplyAllWidgets}
              title={canApplyAllWidgets ? 'Apply to every widget in the layout — watchlist, breadth, fundamentals, and the rest' : 'Available on the Charts workspace'}
            >All widgets</button>
          </div>
          <span className={styles.footHint}>{CHART_THEMES.length} themes</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
