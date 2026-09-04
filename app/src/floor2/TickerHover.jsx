import { useState, useEffect } from 'react'
import ChartCard from './ChartCard'

// Hovering any $TICKER (elements tagged data-ticker) pops a mini live-style chart.
export default function TickerHover({ rootRef }) {
  const [h, setH] = useState(null) // { ticker, x, y }
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let timer
    const onOver = (e) => {
      const el = e.target.closest?.('[data-ticker]')
      if (!el) return
      const t = el.getAttribute('data-ticker')
      if (!t) return
      const r = el.getBoundingClientRect()
      clearTimeout(timer)
      timer = setTimeout(() => setH({ ticker: t, x: r.left, y: r.bottom }), 150)
    }
    const onOut = (e) => {
      if (!e.target.closest?.('[data-ticker]')) return
      clearTimeout(timer)
      setH(null)
    }
    root.addEventListener('mouseover', onOver)
    root.addEventListener('mouseout', onOut)
    return () => {
      root.removeEventListener('mouseover', onOver)
      root.removeEventListener('mouseout', onOut)
      clearTimeout(timer)
    }
  }, [rootRef])

  if (!h) return null
  const left = Math.max(8, Math.min(h.x, window.innerWidth - 356))
  const top = Math.min(h.y + 6, window.innerHeight - 210)
  return (
    <div className="ticker-hover" style={{ position: 'fixed', left, top, zIndex: 300, pointerEvents: 'none' }}>
      <ChartCard ticker={h.ticker} tf="1D" caption={null} height={150} />
    </div>
  )
}
