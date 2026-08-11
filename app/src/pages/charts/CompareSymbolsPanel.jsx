// Compare Symbols — Tools → overlay other tickers' normalized % performance on
// the active chart. A small draggable floating panel (same chrome as the
// Custom-Period Sort window) that reads/writes the active chart's comparison
// overlays through the workspace chart-API registry (chartApiById). Two display
// modes: "Candles + %" (base stays candles, compares are % lines on a left scale)
// and "All %" (base flips to the % price scale too, so every line is % from the
// visible left edge — the LWC Percentage scale rebases as you scroll).
import { useCallback, useEffect, useRef, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import { pickComparisonColor } from '../../components/chart/comparisonUtils'
import c from './CompareSymbolsPanel.module.css'

const DEF_W = 288, MIN_W = 220

// Center the panel on the ACTIVE chart widget (via the chart api's getRect),
// falling back to the viewport centre.
function centeredPos(chartApiById, activeChartRef) {
  try {
    const map = chartApiById?.current
    const active = activeChartRef?.current
    const api = map && (active && map.has(active) ? map.get(active) : (map.size ? map.get([...map.keys()][0]) : null))
    const r = api?.getRect?.()
    if (r && r.width) {
      return { x: Math.round(Math.max(8, r.left + (r.width - DEF_W) / 2)), y: Math.round(Math.max(8, r.top + (r.height - 300) / 2)) }
    }
  } catch { /* fall through */ }
  return { x: Math.max(12, Math.round((window.innerWidth - DEF_W) / 2)), y: 96 }
}

export default function CompareSymbolsPanel({ chartApiById, activeChartRef, onClose }) {
  const [pos, setPos] = useState(() => centeredPos(chartApiById, activeChartRef))
  const [width, setWidth] = useState(DEF_W)
  const [symbols, setSymbols] = useState([])
  const [mode, setMode] = useState('overlay')  // 'overlay' | 'pct'
  const [ready, setReady] = useState(false)
  const [entry, setEntry] = useState('')
  const apiRef = useRef(null)

  // Resolve the target chart's API — the active chart if it's registered, else the
  // first mounted chart. Retries briefly so a just-auto-opened chart is picked up.
  useEffect(() => {
    let tries = 0
    const resolve = () => {
      const map = chartApiById?.current
      if (map && map.size) {
        const active = activeChartRef?.current
        const api = (active && map.has(active)) ? map.get(active) : map.get([...map.keys()][0])
        if (api) {
          const first = !apiRef.current
          apiRef.current = api
          setSymbols(api.getComparison() || [])
          setMode(api.getPercentScale() ? 'pct' : 'overlay')
          setReady(true)
          if (first) setPos(centeredPos(chartApiById, activeChartRef))  // re-center once the chart is mounted
          return true
        }
      }
      return false
    }
    if (resolve()) return undefined
    const t = setInterval(() => { if (resolve() || ++tries > 20) clearInterval(t) }, 150)
    return () => clearInterval(t)
  }, [chartApiById, activeChartRef])

  const push = useCallback((next) => {
    setSymbols(next)
    apiRef.current?.setComparison(next)
  }, [])

  const addSymbol = useCallback((raw) => {
    const s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '')
    if (!s) return
    setSymbols(prev => {
      if (prev.some(x => x.sym === s)) return prev
      const next = [...prev, { sym: s, enabled: true, color: pickComparisonColor(prev.length) }]
      apiRef.current?.setComparison(next)
      return next
    })
    setEntry('')
  }, [])

  const removeSymbol = useCallback((sym) => {
    push(symbols.filter(x => x.sym !== sym))
  }, [symbols, push])

  const setModeAndApply = useCallback((m) => {
    setMode(m)
    apiRef.current?.setPercentScale(m === 'pct')
  }, [])

  const onHeaderPointerDown = useCallback((e) => {
    if (e.target.closest('[data-no-drag]')) return
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    setPos((p) => {
      const ox = p.x, oy = p.y
      const move = (ev) => setPos({ x: Math.max(0, ox + (ev.clientX - sx)), y: Math.max(0, oy + (ev.clientY - sy)) })
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return p
    })
  }, [])

  const startResize = (e) => {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, ow = width
    const move = (ev) => setWidth(Math.max(MIN_W, ow + (ev.clientX - sx)))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={c.root} style={{ left: pos.x, top: pos.y, width, height: 'auto' }}>
      <div className={c.header} onPointerDown={onHeaderPointerDown}>
        <span className={c.grip} aria-hidden="true" />
        <span className={c.title}>Compare Symbols</span>
        <button type="button" className={c.close} data-no-drag onClick={onClose} title="Close" aria-label="Close"><UIcon name="x" size={13} gold={false} /></button>
      </div>

      <div className={c.body}>
        {/* Display mode */}
        <div className={c.seg} data-no-drag>
          <button type="button" className={`${c.segBtn}${mode === 'overlay' ? ' ' + c.segOn : ''}`} onClick={() => setModeAndApply('overlay')} title="Base stays candles; compared tickers draw as % lines">Candles + %</button>
          <button type="button" className={`${c.segBtn}${mode === 'pct' ? ' ' + c.segOn : ''}`} onClick={() => setModeAndApply('pct')} title="Every line (incl. the base) shown as % from the visible left edge">All %</button>
        </div>

        {/* Add a symbol */}
        <input
          className={c.input}
          value={entry}
          onChange={e => setEntry(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') addSymbol(entry); else if (e.key === 'Escape') setEntry('') }}
          placeholder="+ Add symbol (e.g. QQQ) — Enter"
          spellCheck={false}
          autoComplete="off"
          data-no-drag
        />

        {/* Legend */}
        {symbols.length === 0 ? (
          <div className={c.empty}>{ready ? 'No comparisons yet. Add a ticker above.' : 'Connecting to the chart…'}</div>
        ) : (
          <div className={c.list}>
            {symbols.map(s => (
              <div key={s.sym} className={c.row}>
                <span className={c.dot} style={{ background: s.color }} />
                <span className={c.sym}>{s.sym}</span>
                <button type="button" className={c.rm} onClick={() => removeSymbol(s.sym)} title={`Remove ${s.sym}`} aria-label={`Remove ${s.sym}`}><UIcon name="x" size={10} gold={false} /></button>
              </div>
            ))}
          </div>
        )}
        <div className={c.hint}>Normalized to 0% at the left edge of the framed range.</div>
      </div>

      <span className={c.corner} onPointerDown={startResize} />
    </div>
  )
}
