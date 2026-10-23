import { forwardRef } from 'react'

// The IPO badge's "First trade" tag (StockChart opens it on a click on the IPO pill). It closes on
// an outside click, the wheel or Escape, so it carries data-escape-layer: lib/topLayer.js counts it
// as the layer on top, and a page surface under it (the study review card) lets its Escape through.
// FIXED dark menu palette (gold label, white text) — matches the earnings popover exactly and never
// tints with the canvas. (--menu-* is the app's single fixed-dark menu palette; see tokens.css.)
const IpoFirstTradeTag = forwardRef(function IpoFirstTradeTag({ date, x, y }, ref) {
  const d = new Date(`${date}T00:00:00Z`)
  const label = isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return (
    <div
      ref={ref}
      data-escape-layer=""
      data-testid="ipo-first-trade-tag"
      style={{
        position: 'fixed', left: x, top: y, zIndex: 60,
        background: 'var(--menu-bg, #0e0e10)',
        border: '1px solid var(--menu-border, rgba(255,255,255,0.09))', borderRadius: 6,
        padding: '5px 9px', font: "600 11px 'Instrument Sans', sans-serif",
        color: 'var(--menu-text, #ededed)', whiteSpace: 'nowrap', cursor: 'default',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)', pointerEvents: 'auto',
      }}
    >
      <span style={{ color: 'var(--menu-accent, #c9a84c)', fontWeight: 700, marginRight: 6 }}>IPO</span>
      First trade · {label}
    </div>
  )
})

export default IpoFirstTradeTag
