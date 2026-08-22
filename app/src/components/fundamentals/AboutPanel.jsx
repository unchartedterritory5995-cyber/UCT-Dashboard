// app/src/components/fundamentals/AboutPanel.jsx
// The ticker-popup "About" tab: an AI trader brief (what they do / what moves it,
// cached server-side) + deterministic company facts + trader snapshot + peers.
// Data: GET /api/about/{sym}. Peers click → onSwitch(ticker) (popup ticker search).
import { useState, useEffect } from 'react'

const GOLD = '#c9a84c', GOLD_BRI = '#e6cd8a', CREAM = '#dcd6c8', MUTED = '#8b8e85', DIM = '#63665e', LINE = '#22251d'

const money = (v) => {
  if (v == null || !isFinite(v)) return '—'
  const n = Math.abs(v)
  if (n >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${Math.round(v).toLocaleString()}`
}
const num = (v) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString())
const cleanUrl = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
const shares = (v) => {
  if (v == null || !isFinite(v)) return '—'
  const n = Math.abs(v)
  if (n >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return `${Math.round(v)}`
}
const fmtDate = (iso) => {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  return isNaN(d) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const daysUntil = (iso) => {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d)) return null
  const diff = Math.round((d - new Date()) / 86400000)
  return diff >= 0 ? diff : null
}

const lblStyle = { fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: GOLD, fontWeight: 700, margin: '0 0 10px' }
const kStyle = { color: DIM, fontSize: 13 }
const vStyle = { color: CREAM, fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const subStyle = { color: MUTED, fontWeight: 400, fontSize: 11 }
const aiHead = { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: GOLD_BRI, fontWeight: 700, margin: '0 0 5px' }
const para = { fontSize: 13.5, lineHeight: 1.6, color: '#c8c3b6' }

export default function AboutPanel({ sym, onSwitch }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!sym) return
    let cancelled = false
    setData(null); setErr(false)
    fetch(`/api/about/${encodeURIComponent(sym)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (!cancelled) setData(j) })
      .catch(() => { if (!cancelled) setErr(true) })
    return () => { cancelled = true }
  }, [sym])

  if (err) return <div style={{ padding: 24, color: MUTED }}>Couldn’t load company info.</div>
  if (!data) return <div style={{ padding: 24, color: MUTED }}>Loading…</div>

  const p = data.profile || {}
  const brief = data.brief || {}
  const peers = data.peers || []
  const hasFacts = p.name || p.description || p.sector
  if (!hasFacts && peers.length === 0) {
    return <div style={{ padding: 24, color: MUTED }}>No company info available for {sym}.</div>
  }

  const lo = p.week52Low, hi = p.week52High, px = p.price
  const rangePct = (lo != null && hi != null && hi > lo && px != null)
    ? Math.max(0, Math.min(100, ((px - lo) / (hi - lo)) * 100)) : null
  const divYld = (p.lastDiv && p.price) ? (p.lastDiv / p.price * 100) : null
  const dollarVol = (p.avgVolume && p.price) ? p.avgVolume * p.price : null
  const founded = p.ipoDate ? String(p.ipoDate).slice(0, 4) : null
  const hq = [p.city, p.state || p.country].filter(Boolean).join(', ') || null
  const floatPct = (p.floatShares && p.sharesOutstanding) ? (p.floatShares / p.sharesOutstanding * 100) : null
  const earnDate = fmtDate(p.nextEarnings)
  const earnDays = daysUntil(p.nextEarnings)

  return (
    <div style={{ padding: '18px 20px', maxHeight: '82vh', overflowY: 'auto', width: '100%', alignSelf: 'flex-start', fontFamily: "'Instrument Sans',system-ui,sans-serif" }}>
      {(brief.whatTheyDo || brief.whatMovesIt) ? (
        <div style={{ border: '1px solid #c9a84c33', background: 'linear-gradient(180deg,#181610,#141310)', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: GOLD, fontWeight: 700, marginBottom: 8 }}>
            ✦ AI brief <span style={{ color: DIM, fontWeight: 400, textTransform: 'none' }}>· cached</span>
          </div>
          {brief.whatTheyDo && (<>
            <div style={aiHead}>What they do</div>
            <p style={{ ...para, margin: '0 0 12px' }}>{brief.whatTheyDo}</p>
          </>)}
          {brief.whatMovesIt && (<>
            <div style={aiHead}>What moves it</div>
            <p style={{ ...para, margin: 0 }}>{brief.whatMovesIt}</p>
          </>)}
        </div>
      ) : (p.description ? (
        <p style={{ ...para, margin: '0 0 16px' }}>{p.description.slice(0, 600)}{p.description.length > 600 ? '…' : ''}</p>
      ) : null)}

      {(p.sector || p.industry) && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 22 }}>
          {[p.sector, p.industry].filter(Boolean).map((t) => (
            <span key={t} style={{ fontSize: 11, fontWeight: 600, color: GOLD_BRI, border: '1px solid #c9a84c44', background: '#c9a84c14', borderRadius: 999, padding: '3px 11px' }}>{t}</span>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: p.isEtf ? '1fr' : '1fr 1.15fr', gap: 26 }}>
        {!p.isEtf && (
          <div>
            <p style={lblStyle}>Company</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '9px 16px' }}>
              {p.ceo && (<><span style={kStyle}>CEO</span><span style={vStyle}>{p.ceo}</span></>)}
              {founded && (<><span style={kStyle}>Founded</span><span style={vStyle}>{founded}</span></>)}
              {hq && (<><span style={kStyle}>HQ</span><span style={vStyle}>{hq}</span></>)}
              {p.employees != null && (<><span style={kStyle}>Employees</span><span style={vStyle}>{num(p.employees)}</span></>)}
              {p.exchange && (<><span style={kStyle}>Exchange</span><span style={vStyle}>{p.exchange}</span></>)}
              {p.website && (<><span style={kStyle}>Website</span><span style={vStyle}><a href={p.website} target="_blank" rel="noopener noreferrer" style={{ color: GOLD_BRI, textDecoration: 'none' }}>{cleanUrl(p.website)} ↗</a></span></>)}
            </div>
          </div>
        )}
        <div>
          <p style={lblStyle}>Trader snapshot</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '9px 16px' }}>
            <span style={kStyle}>Market cap</span><span style={vStyle}>{money(p.mktCap)}</span>
            {p.floatShares != null && (<><span style={kStyle}>Float</span><span style={vStyle}>{shares(p.floatShares)}{floatPct != null ? <span style={subStyle}> {floatPct.toFixed(0)}% of shares</span> : null}</span></>)}
            {p.shortPctFloat != null && (<><span style={kStyle}>Short float</span><span style={vStyle}>{p.shortPctFloat.toFixed(1)}%{p.daysToCover != null ? <span style={subStyle}> · {p.daysToCover.toFixed(1)}d to cover</span> : null}</span></>)}
            {p.beta != null && (<><span style={kStyle}>Beta</span><span style={vStyle}>{p.beta.toFixed(2)}</span></>)}
            {dollarVol != null && (<><span style={kStyle}>Avg $ volume</span><span style={vStyle}>{money(dollarVol)}<span style={subStyle}>/day</span></span></>)}
            <span style={kStyle}>Dividend</span><span style={vStyle}>{divYld != null && divYld > 0 ? `${divYld.toFixed(2)}%` : '—'}</span>
            {earnDate && (<><span style={kStyle}>Next earnings</span><span style={vStyle}>{earnDate}{earnDays != null ? <span style={subStyle}> {earnDays}d</span> : null}</span></>)}
            {rangePct != null && (
              <div style={{ gridColumn: '1 / -1', marginTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: DIM, marginBottom: 5 }}>
                  <span>52W low ${lo.toFixed(2)}</span><span>{rangePct.toFixed(0)}% of range</span><span>high ${hi.toFixed(2)}</span>
                </div>
                <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'linear-gradient(90deg,#243a2e,#3a3320,#3a2420)' }}>
                  <div style={{ position: 'absolute', top: -4, left: `${rangePct}%`, width: 2, height: 14, background: GOLD_BRI, borderRadius: 1, boxShadow: '0 0 6px #c9a84c88' }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {peers.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <p style={lblStyle}>Peers · moves with</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {peers.map((pr) => (
              <button
                key={pr.ticker}
                type="button"
                onClick={() => onSwitch?.(pr.ticker)}
                style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, fontWeight: 700, color: CREAM, border: `1px solid ${LINE}`, background: '#161813', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}
              >
                {pr.ticker}{pr.name ? <span style={{ color: DIM, fontWeight: 400, fontSize: 10, marginLeft: 6 }}>{pr.name}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
