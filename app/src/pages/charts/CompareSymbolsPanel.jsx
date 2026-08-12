// Compare Symbols — Tools → overlay other tickers' normalized % performance on the
// active chart. A centered modal (same chrome as the Custom-Period Sort dialog:
// dimmed backdrop, fixed position, not draggable/resizable) that reads/writes the
// active chart's comparison overlays through the workspace chart-API registry
// (chartApiById). Two display modes: "Candles + %" (base stays candles, compares are
// % lines) and "All %" (base flips to the % price scale too). Each symbol also picks
// its own price scale (Same % scale / New price scale).
import { useCallback, useEffect, useRef, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import { pickComparisonColor } from '../../components/chart/comparisonUtils'
import shell from './PeriodSortPanel.module.css'
import c from './CompareSymbolsPanel.module.css'

export default function CompareSymbolsPanel({ chartApiById, activeChartRef, onClose }) {
  const [symbols, setSymbols] = useState([])
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
          apiRef.current = api
          setSymbols(api.getComparison() || [])
          // Compare no longer flips the base into % scale (that detached the MAs). If
          // a chart is still stuck in % from the retired "All %" mode, clear it once.
          try { if (api.getPercentScale && api.getPercentScale()) api.setPercentScale(false) } catch { /* older api */ }
          setReady(true)
          return true
        }
      }
      return false
    }
    if (resolve()) return undefined
    const t = setInterval(() => { if (resolve() || ++tries > 20) clearInterval(t) }, 150)
    return () => clearInterval(t)
  }, [chartApiById, activeChartRef])

  // Escape closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const push = useCallback((next) => {
    setSymbols(next)
    apiRef.current?.setComparison(next)
  }, [])

  const addSymbol = useCallback((raw) => {
    const s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '')
    if (!s) return
    setSymbols(prev => {
      if (prev.some(x => x.sym === s)) return prev
      const next = [...prev, { sym: s, enabled: true, color: pickComparisonColor(prev.length), scaleMode: 'new' }]
      apiRef.current?.setComparison(next)
      return next
    })
    setEntry('')
  }, [])

  const removeSymbol = useCallback((sym) => {
    push(symbols.filter(x => x.sym !== sym))
  }, [symbols, push])

  // Per-symbol price-scale choice. 'new' = its own auto-fitting left % scale (fills
  // the pane independently — the default). 'same' = share the base's price scale in
  // Percentage mode, so an out-performer visibly rises above the base.
  const setScaleMode = useCallback((sym, sm) => {
    push(symbols.map(x => x.sym === sym ? { ...x, scaleMode: sm } : x))
  }, [symbols, push])

  return (
    <div className={shell.cfgBackdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={c.card} role="dialog" aria-label="Compare Symbols">
        <div className={c.head}>
          <span className={c.headTitle}>Compare Symbols</span>
          <button type="button" className={c.close} onClick={onClose} title="Close" aria-label="Close"><UIcon name="x" size={13} gold={false} /></button>
        </div>

        <div className={c.body}>
          {/* Add a symbol */}
          <input
            className={c.input}
            value={entry}
            onChange={e => setEntry(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') addSymbol(entry); else if (e.key === 'Escape') setEntry('') }}
            placeholder="+ Add symbol (e.g. QQQ) — Enter"
            spellCheck={false}
            autoComplete="off"
          />

          {/* Legend */}
          {symbols.length === 0 ? (
            <div className={c.empty}>{ready ? 'No comparisons yet. Add a ticker above.' : 'Connecting to the chart…'}</div>
          ) : (
            <div className={c.list}>
              {symbols.map(s => (
                <div key={s.sym} className={c.row}>
                  <div className={c.rowMain}>
                    <span className={c.dot} style={{ background: s.color }} />
                    <span className={c.sym}>{s.sym}</span>
                    <button type="button" className={c.rm} onClick={() => removeSymbol(s.sym)} title={`Remove ${s.sym}`} aria-label={`Remove ${s.sym}`}><UIcon name="x" size={10} gold={false} /></button>
                  </div>
                  <div className={c.scaleSeg}>
                    <button
                      type="button"
                      className={`${c.scaleBtn}${(s.scaleMode === 'same') ? ' ' + c.scaleOn : ''}`}
                      onClick={() => setScaleMode(s.sym, 'same')}
                      title="Share the main price scale — an out-performer rises above the base"
                    >Same % scale</button>
                    <button
                      type="button"
                      className={`${c.scaleBtn}${(s.scaleMode !== 'same') ? ' ' + c.scaleOn : ''}`}
                      onClick={() => setScaleMode(s.sym, 'new')}
                      title="Draw on its own left % scale — fills the pane independently"
                    >New price scale</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className={c.hint}>Normalized to 0% at the left edge of the framed range.</div>
        </div>
      </div>
    </div>
  )
}
