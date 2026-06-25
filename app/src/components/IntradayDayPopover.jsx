// IntradayDayPopover — floating 5-minute intraday chart for a single session.
// Opened from the Model Book when a setup/catalyst candle is clicked: shows what
// that day looked like intraday (price candles + volume + 9/20 EMA + white VWAP),
// styled exactly like the main charts. Anchored near the clicked candle; closes
// on click-outside or Escape. Intraday history only exists for ~recent years —
// older dates come back empty and render a friendly "unavailable" note.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import StockChart from './StockChart'
import UIcon from './ui/UIcon'

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

// One CSV cell → unix seconds. Accepts a unix timestamp (sec or ms) or any
// ISO/parseable datetime (TradingView "Export chart data" gives one of these).
function toUnixSec(s) {
  if (s == null || s === '') return null
  const str = String(s).trim()
  if (/^\d+$/.test(str)) {
    let n = parseInt(str, 10)
    if (n > 1e12) n = Math.floor(n / 1000)   // ms → s
    return n > 0 ? n : null
  }
  const ms = Date.parse(str)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

// Parse a TradingView 5-min CSV → [{t:unix_sec,o,h,l,c,v}] (keeps intraday time).
function parseIntradayCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []
  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''))
  const find = (...names) => header.findIndex(h => names.includes(h))
  const oi = find('open'), hi = find('high'), li = find('low'), ci = find('close', 'close/last', 'price')
  const vi = find('volume', 'vol')
  let ti = find('time', 'date', 'datetime', 'timestamp'); if (ti < 0) ti = 0
  const hasHeader = oi >= 0 && ci >= 0
  const out = []
  for (let r = hasHeader ? 1 : 0; r < lines.length; r++) {
    const cols = lines[r].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const t = toUnixSec(cols[ti]); if (t == null) continue
    const num = i => { const v = parseFloat(cols[i]); return Number.isFinite(v) ? v : null }
    const o = num(oi), h = num(hi), l = num(li), c = num(ci)
    if (o == null || h == null || l == null || c == null) continue
    const v = vi >= 0 ? (parseFloat(cols[vi]) || 0) : 0
    out.push({ t, o, h, l, c, v })
  }
  return out
}

export default function IntradayDayPopover({ symbol, date, stockId, isAdmin, anchorRef, bottomBoundaryRef, clientX, clientY, onClose }) {
  const { data, mutate } = useSWR(
    symbol && date
      ? `/api/modelbook/intraday-day?symbol=${encodeURIComponent(symbol)}&date=${encodeURIComponent(date)}${stockId ? `&stock_id=${stockId}` : ''}`
      : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 300_000 }
  )
  const [uploadMsg, setUploadMsg] = useState(null)
  const fileRef = useRef(null)

  async function onIntradayFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !stockId) return
    setUploadMsg('Parsing…')
    try {
      const bars = parseIntradayCsv(await file.text())
      if (!bars.length) { setUploadMsg('No valid rows — expected time,open,high,low,close,Volume.'); return }
      setUploadMsg(`Uploading ${bars.length} bars…`)
      const r = await fetch(`/api/modelbook/stock/${stockId}/intraday-day`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, bars }),
      })
      if (!r.ok) { setUploadMsg(`Upload failed: ${(await r.text()).slice(0, 120)}`); return }
      setUploadMsg(null)
      await mutate()   // re-fetch → uploaded bars now win → chart renders
    } catch (err) {
      setUploadMsg('Error: ' + (err?.message || 'failed to read file'))
    }
  }
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
        if (r.width > 0 && r.height > 0) {
          // Stop the bottom just above the setups/catalysts section so the popup
          // never covers it; otherwise fill the whole anchor element.
          let height = r.height
          const stop = bottomBoundaryRef?.current
          if (stop) {
            const sr = stop.getBoundingClientRect()
            if (sr.top > r.top) height = Math.max(120, sr.top - r.top - 10)
          }
          setPos({ left: r.left, top: r.top, width: r.width, height })
          return
        }
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
  }, [anchorRef, bottomBoundaryRef, clientX, clientY])

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
            <div style={centerNote}>
              <div>No intraday data available for this date.</div>
              {isAdmin && stockId && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => fileRef.current?.click()}
                    style={{
                      cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
                      border: '1px solid var(--ut-gold, #c9a84c)', background: 'rgba(201,168,76,0.12)',
                      color: 'var(--ut-gold, #c9a84c)',
                    }}
                  ><UIcon name="equity" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Upload 5-min CSV</button>
                  <span style={{ fontSize: 11, color: 'var(--text-muted, #8b8778)' }}>
                    {uploadMsg || 'TradingView export: time, open, high, low, close, Volume'}
                  </span>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onIntradayFile} />
                </div>
              )}
            </div>
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
              hideJournalOverlay
              showVolume
              volumeSeparatePane
              volumePaneHeightPct={22}
              overlays={POPUP_OVERLAYS}
              overlaysFromStart
              vwapOverride={VWAP_WHITE}
              disableHvc
              hidePriceLine
              hideWatermark
              subtleSeparator
              modelBookLook
              boldCandles={false}
              markVolumeExtremes={false}
              volumeMa={0}
              hideLegend
              leftBarPad={3}
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
  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-muted, #8b8778)', fontSize: 13, textAlign: 'center', padding: 16,
}
