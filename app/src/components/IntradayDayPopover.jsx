// IntradayDayPopover — floating 5-minute intraday chart for a single session.
// Opened from the Model Book when a setup/catalyst candle is clicked: shows what
// that day looked like intraday (price candles + volume + 9/20 EMA + white VWAP),
// styled exactly like the main charts. Anchored near the clicked candle; closes
// on click-outside or Escape. Intraday history only exists for ~recent years —
// older dates come back empty and render a friendly "unavailable" note.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import StockChart from './StockChart'

const POPOVER_W = 460
const POPOVER_H = 360

// 9/20 EMA in the standard chart palette (matches chartDefaults overlays).
const POPUP_OVERLAYS = [
  { enabled: true, type: 'EMA', period: 9,  color: '#4ade80' },
  { enabled: true, type: 'EMA', period: 20, color: '#f472b6' },
]
const VWAP_WHITE = { color: '#ffffff' }

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null))

function fmtDate(d) {
  try {
    const [y, m, day] = d.split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return d }
}

export default function IntradayDayPopover({ symbol, date, anchorRef, clientX, clientY, onClose }) {
  const { data } = useSWR(
    symbol && date ? `/api/modelbook/intraday-day?symbol=${encodeURIComponent(symbol)}&date=${encodeURIComponent(date)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 300_000 }
  )
  // SWR: data is `undefined` until the first response; the fetcher resolves to
  // `null` on an HTTP error. Distinguish the two so an error doesn't hang on the
  // spinner forever.
  const loading = data === undefined
  const bars = data?.bars || null
  const unavailable = !loading && (bars == null || bars.length === 0)

  // Position: when an anchor element is given (the info panel), cover it exactly
  // so the popup sits right over the earnings table + company description.
  // Otherwise fall back to a fixed-size panel near the clicked candle.
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = anchorRef?.current
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) { setPos({ left: r.left, top: r.top, width: r.width, height: r.height }); return }
      }
      // Fallback: fixed-size panel anchored near the cursor, clamped on-screen.
      const vw = window.innerWidth, vh = window.innerHeight
      let left = (clientX ?? vw / 2) + 16
      let top = (clientY ?? vh / 2) - POPOVER_H / 2
      if (left + POPOVER_W + 8 > vw) left = (clientX ?? vw / 2) - POPOVER_W - 16
      left = Math.max(8, Math.min(left, vw - POPOVER_W - 8))
      top = Math.max(8, Math.min(top, vh - POPOVER_H - 8))
      setPos({ left, top, width: POPOVER_W, height: POPOVER_H })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchorRef, clientX, clientY])

  // Escape closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const panelRef = useRef(null)

  if (!pos) return null

  return (
    // Transparent full-screen catcher → click-outside closes.
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1200 }}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', left: pos.left, top: pos.top, width: pos.width, height: pos.height,
          background: 'var(--bg-elevated, #14161a)', border: '1px solid var(--border, #2a2e25)',
          borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderBottom: '1px solid var(--border, #2a2e25)', flex: 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary, #e8e6df)', letterSpacing: 0.3 }}>{symbol}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted, #8b8778)' }}>{fmtDate(date)} · 5-min</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              flex: 'none', width: 22, height: 22, lineHeight: 1, cursor: 'pointer',
              border: 'none', background: 'transparent', color: 'var(--text-muted, #8b8778)', fontSize: 16,
            }}
          >×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {loading && (
            <div style={centerNote}>Loading intraday…</div>
          )}
          {unavailable && (
            <div style={centerNote}>No intraday data available for this date.</div>
          )}
          {bars && bars.length > 0 && (
            <StockChart
              key={`${symbol}_${date}`}
              sym={symbol}
              tf="5"
              height="100%"
              barsOverride={bars}
              liveUpdates={false}
              showDrawingTools={false}
              showVolume
              volumeSeparatePane
              volumePaneHeightPct={22}
              overlays={POPUP_OVERLAYS}
              vwapOverride={VWAP_WHITE}
              disableHvc
              hidePriceLine
              hideWatermark
              subtleSeparator
              hideLegend
              priceScaleTopMargin={0.06}
              priceScaleBottomMargin={0.04}
              hideLastValue
              hideReplay
              hidePatterns
              hideCompare
              hideCountdown
            />
          )}
        </div>
      </div>
    </div>
  )
}

const centerNote = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-muted, #8b8778)', fontSize: 13, textAlign: 'center', padding: 16,
}
