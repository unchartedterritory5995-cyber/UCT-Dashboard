// Self-contained candlestick chart card for embedding in posts/replies.
// Deterministic mock series (seeded by ticker+tf) so it looks real and stable
// without any backend. Styled with the app tokens.

function hashStr(s) {
  let h = 1779033703 ^ s.length
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

function makeSeries(seed, n = 46) {
  const rnd = hashStr(seed)
  let price = 40 + rnd() * 120
  const drift = (rnd() - 0.38) * 0.9 // slight upward bias on average
  const bars = []
  for (let i = 0; i < n; i++) {
    const vol = price * (0.012 + rnd() * 0.03)
    const o = price
    const move = (rnd() - 0.5) * vol * 2 + drift * (vol * 0.5)
    const c = Math.max(1, o + move)
    const hi = Math.max(o, c) + rnd() * vol
    const lo = Math.min(o, c) - rnd() * vol
    bars.push({ o, h: hi, l: lo, c })
    price = c
  }
  return bars
}

export default function ChartCard({ ticker, tf = '1D', caption, height = 190 }) {
  const bars = makeSeries(`${ticker}:${tf}`)
  const W = 620
  const H = height
  const padT = 10; const padB = 8; const padL = 6; const padR = 52
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const highs = bars.map((b) => b.h); const lows = bars.map((b) => b.l)
  const max = Math.max(...highs); const min = Math.min(...lows)
  const range = max - min || 1
  const y = (p) => padT + (1 - (p - min) / range) * plotH
  const cw = plotW / bars.length
  const bw = Math.max(2, cw * 0.62)

  const last = bars[bars.length - 1]
  const first = bars[0]
  const chg = ((last.c - first.o) / first.o) * 100
  const up = chg >= 0

  // a few horizontal gridlines
  const grid = [0.25, 0.5, 0.75].map((f) => padT + f * plotH)

  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <span className="cc-ticker">${ticker}</span>
        <span className="cc-tf">{tf}</span>
        <span className="cc-last">{last.c.toFixed(2)}</span>
        <span className={`cc-chg ${up ? 'up' : 'down'}`}>{up ? '+' : ''}{chg.toFixed(2)}%</span>
        <span className="cc-src">chart</span>
      </div>
      <svg className="cc-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={`${ticker} ${tf} chart`}>
        {grid.map((gy, i) => (
          <line key={i} x1={padL} x2={W - padR} y1={gy} y2={gy} className="cc-grid" />
        ))}
        {/* last price line + tag */}
        <line x1={padL} x2={W - padR} y1={y(last.c)} y2={y(last.c)} className="cc-lastline" />
        <rect x={W - padR + 2} y={y(last.c) - 8} width={padR - 4} height={16} rx="3" className={`cc-tag ${up ? 'up' : 'down'}`} />
        <text x={W - padR / 2} y={y(last.c) + 4} className="cc-tagtext" textAnchor="middle">{last.c.toFixed(2)}</text>
        {bars.map((b, i) => {
          const cx = padL + i * cw + cw / 2
          const isUp = b.c >= b.o
          const cls = isUp ? 'cc-up' : 'cc-down'
          const bodyTop = y(Math.max(b.o, b.c))
          const bodyH = Math.max(1, Math.abs(y(b.o) - y(b.c)))
          return (
            <g key={i} className={cls}>
              <line x1={cx} x2={cx} y1={y(b.h)} y2={y(b.l)} className="cc-wick" />
              <rect x={cx - bw / 2} y={bodyTop} width={bw} height={bodyH} className="cc-body" />
            </g>
          )
        })}
      </svg>
      {caption && <div className="chart-card-caption">{caption}</div>}
    </div>
  )
}
