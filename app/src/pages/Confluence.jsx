import { useState, useMemo, useEffect } from 'react'
import useConfluence from '../hooks/useConfluence'
import TickerPopup from '../components/TickerPopup'
import s from './Confluence.module.css'

const BAND_ORDER = ['L', 'M', 'S']
const BAND_FALLBACK = { L: ['Large Cap', '$10B – $500B'], M: ['Mid Cap', '$2B – $10B'], S: ['Small Cap', '< $2B'] }

const usd = n => {
  const a = Math.abs(n || 0)
  if (a >= 1e9) return `$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${Math.round(a / 1e6)}M`
  if (a >= 1e3) return `$${Math.round(a / 1e3)}K`
  return `$${Math.round(a)}`
}
const pxfmt = v => {
  const a = Math.abs(v || 0)
  return a >= 100 ? `$${Math.round(a)}` : `$${(v || 0).toFixed(2)}`
}
const pctS = v => `${v >= 0 ? '+' : '−'}${Math.abs(v || 0).toFixed(1)}%`
const expShort = e => (typeof e === 'string' ? e.replace(/\/(\d{2})(\d{2})$/, '/$2') : e)

// Live-price overlay: the board is server-cached (30-min), but the ladder marker
// and the green/red performance read the LIVE price so they track intraday. Falls
// back to each row's dpLast (last dark-pool session) until a quote arrives.
function useLivePrices(syms) {
  const [px, setPx] = useState({})
  const key = syms.join(',')
  useEffect(() => {
    if (!syms.length) return undefined
    let alive = true
    const run = () => {
      const chunks = []
      for (let i = 0; i < syms.length; i += 200) chunks.push(syms.slice(i, i + 200))
      Promise.all(chunks.map(c =>
        fetch(`/api/live-prices?tickers=${c.join(',')}`).then(r => (r.ok ? r.json() : {})).catch(() => ({}))))
        .then(parts => { if (!alive) return; const m = {}; parts.forEach(p => Object.assign(m, p)); setPx(m) })
    }
    run()
    const id = setInterval(run, 60000)
    return () => { alive = false; clearInterval(id) }
  }, [key])   // eslint-disable-line react-hooks/exhaustive-deps
  return px
}

// scale lo/hi/avg/now onto a 0-100 track with a little headroom each side
function ladderPos(lo, hi, avg, now) {
  const vals = [lo, hi, now].filter(v => v > 0)
  if (vals.length < 2 || !(now > 0)) return null
  const mn = Math.min(...vals) * 0.985
  const mx = Math.max(...vals) * 1.015
  const R = (mx - mn) || 1
  const p = v => Math.max(0, Math.min(100, ((v - mn) / R) * 100))
  return { zl: p(lo), zw: Math.max(3, p(hi) - p(lo)), av: p(avg), now: p(now) }
}

export default function Confluence() {
  const { data, isLoading } = useConfluence()
  const [dir, setDir] = useState('all')       // all | BULL | BEAR
  const [cap, setCap] = useState('all')       // all | L | M | S
  const [status, setStatus] = useState('all') // all | BUILDING | STEADY | ESTABLISHED
  const [q, setQ] = useState('')

  const rows = data?.rows || []
  const bandMeta = data?.band_meta || BAND_FALLBACK
  const allSyms = useMemo(() => [...new Set(rows.map(r => r.sym))].slice(0, 250), [rows])
  const px = useLivePrices(allSyms)

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase()
    return rows.filter(r =>
      (dir === 'all' || r.dir === dir) &&
      (cap === 'all' || r.band === cap) &&
      (status === 'all' || r.status === status) &&
      (!needle || r.sym.includes(needle) || (r.sector || '').toUpperCase().includes(needle)))
  }, [rows, dir, cap, status, q])

  const counts = data?.counts || { total: rows.length, bull: 0, bear: 0, building: 0 }
  const totDP = useMemo(() => filtered.reduce((a, r) => a + (r.dpn || 0), 0), [filtered])
  // breadth of the dark-pool read: names trading above big money's average price
  const aboveCount = useMemo(() => rows.reduce((a, r) => {
    const now = px[r.sym]?.price ?? r.dpLast ?? r.dpAvg ?? 0
    return a + (r.dpAvg > 0 && now >= r.dpAvg ? 1 : 0)
  }, 0), [rows, px])

  const Seg = ({ opts, val, set }) => (
    <div className={s.seg}>
      {opts.map(o => (
        <button key={o.v} className={[val === o.v ? s.on : '', o.cls ? s[o.cls] : ''].join(' ')}
          onClick={() => set(o.v)}>{o.l}</button>
      ))}
    </div>
  )

  const renderRow = (r, i) => {
    const bull = r.dir === 'BULL'
    const t = r.top || {}
    const ls = Math.round((r.leapShare || 0) * 100)
    const now = px[r.sym]?.price ?? r.dpLast ?? r.dpAvg ?? 0
    const avg = r.dpAvg || 0
    const perf = avg > 0 && now > 0 ? ((now - avg) / avg) * 100 : 0
    const up = perf >= 0
    const since = r.bigPrice > 0 && now > 0 ? ((now - r.bigPrice) / r.bigPrice) * 100 : null
    const lad = ladderPos(r.dpLo, r.dpHi, avg, now)

    return (
      <div className={s.row} key={r.sym}>
        <div className={s.anchor}>
          <span className={`${s.rank} mono`}>#{i + 1}</span>
          <TickerPopup sym={r.sym} as="button" className={s.tkr} darkPool>{r.sym}</TickerPopup>
          <span className={s.sector}>{r.sector}</span>
        </div>

        <div className={`${s.sig} ${s.dp} ${up ? s.up : s.down}`}>
          <div className={s.lab}><span>Dark Pool · 30d</span>
            <span className={`${s.perf} ${up ? s.pUp : s.pDn}`}>{up ? '▲' : '▼'} {pctS(perf)}</span>
          </div>
          <div className={s.prem}>
            <span className={`${s.big} mono`}>{usd(r.dpn)}</span>
            <span className={s.premLab}>traded · 30d</span>
          </div>
          {lad && (
            <div className={s.ladder}>
              <div className={s.track}>
                <span className={s.zoneband} style={{ left: `${lad.zl}%`, width: `${lad.zw}%` }}>
                  <span className={s.zcap}>big-money zone</span>
                </span>
                <span className={s.avgtick} style={{ left: `${lad.av}%` }} />
                <span className={`${s.zlabel} mono`} style={{ left: `${lad.zl}%` }}>{pxfmt(r.dpLo)}</span>
                <span className={`${s.zlabel} mono`} style={{ left: `${lad.zl + lad.zw}%` }}>{pxfmt(r.dpHi)}</span>
                <span className={s.marker} style={{ left: `${lad.now}%` }} />
                <span className={`${s.nowpill} mono`} style={{ left: `${lad.now}%` }}>
                  <span className={s.nlb}>NOW</span>{pxfmt(now)}
                </span>
              </div>
            </div>
          )}
          <div className={s.print}>
            Biggest print <span className={`${s.pamt} mono`}>{usd(r.bigPrint)}</span>
            {r.bigPrice > 0 ? <> at <span className={`${s.pat} mono`}>{pxfmt(r.bigPrice)}</span></> : null}
            {r.bigDate ? <span className={s.pdt}> · {r.bigDate}</span> : null}
            {since != null ? <> · <span className={since >= 0 ? s.sUp : s.sDn}>{pctS(since)} since</span></> : null}
          </div>
        </div>

        <div className={`${s.sig} ${bull ? s.fl : s.bearfl}`}>
          <div className={s.lab}><span>Options Flow · net</span>
            <span className={`${s.status} ${s[r.status]}`}>{r.status}</span>
          </div>
          <div className={s.big}>{bull ? '+' : '−'}{usd(r.net)}</div>
          <div className={s.meta}>
            <span className="mono">{t.cp}${t.strike}</span> {expShort(t.exp)}
            {t.prem ? <> · <span className="mono">{usd(t.prem)}</span></> : null}
            {' · '}<span className={`${s.pct} ${bull ? s.bull : s.bear}`}>{r.bullPct}% {bull ? 'bull' : 'bear'}</span>
          </div>
          <div className={s.leap}>
            <span className={s.lb}>LEAP depth</span>
            <span className={s.bar}><i style={{ width: `${Math.min(100, ls)}%` }} /></span>
            <span className={s.lv}>{usd(r.leapPrem)} · {ls}%</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={s.page}>
      <div className={s.head}>
        <div className={s.titleWrap}>
          <div className={s.eyebrow}>Confluence Radar</div>
          <h1 className={s.title}>Dark Pool × LEAP Flow</h1>
          <p className={s.sub}>
            Where <span className={s.dp}>big money's dark-pool footprint</span> and{' '}
            <span className={s.fl}>LEAP / size-with-time options flow</span> line up. The ladder shows
            where the stock trades versus big money's average price — green above, red below.
          </p>
        </div>
        <div className={s.updated}>
          {data?.window && <div className="mono">{data.window}</div>}
          <div>{isLoading && !data ? 'loading…' : <><span className={s.live}>●</span> updated ~2m</>}</div>
        </div>
      </div>

      <div className={s.summary}>
        <div className={s.metric}><div className={s.k}>Confluence names</div><div className={`${s.v} mono`}>{counts.total}<small>{counts.bear ? `${counts.bull} bull · ${counts.bear} bear` : 'all bullish'}</small></div></div>
        <div className={s.metric}><div className={s.k}>Building now</div><div className={`${s.v} mono`}>{counts.building}<small>accelerating</small></div></div>
        <div className={s.metric}><div className={s.k}>Dark-pool premium</div><div className={`${s.v} mono`}>{usd(totDP)}<small>shown · 30d</small></div></div>
        <div className={s.metric}><div className={s.k}>Above avg price</div><div className={`${s.v} mono`} style={{ color: 'var(--c-green-br)' }}>{aboveCount}<small>of {counts.total} names</small></div></div>
      </div>

      <div className={s.filters}>
        <Seg val={dir} set={setDir} opts={[{ v: 'all', l: 'All' }, { v: 'BULL', l: 'Bull', cls: 'bull' }, { v: 'BEAR', l: 'Bear', cls: 'bear' }]} />
        <Seg val={cap} set={setCap} opts={[{ v: 'all', l: 'All caps' }, { v: 'L', l: 'Large' }, { v: 'M', l: 'Mid' }, { v: 'S', l: 'Small' }]} />
        <Seg val={status} set={setStatus} opts={[{ v: 'all', l: 'Any' }, { v: 'BUILDING', l: 'Building' }, { v: 'STEADY', l: 'Steady' }, { v: 'ESTABLISHED', l: 'Established' }]} />
        <input className={s.search} placeholder="Ticker / sector…" value={q} onChange={e => setQ(e.target.value)} />
        <span className={s.count}>{filtered.length} of {rows.length}</span>
      </div>

      <div className={s.legend}>
        <span><span className={`${s.dot} ${s.dp}`} /> Price vs big-money average (green above · red below)</span>
        <span><span className={`${s.dot} ${s.fl}`} /> Net flow + LEAP depth</span>
      </div>

      {(!data || (!data.ok && isLoading)) && (
        <div className={s.state}><div className={s.spin} /><div>Loading the board…</div></div>
      )}
      {data && !data.ok && !isLoading && (
        <div className={s.state}><div className={s.spin} /><div>The board is computing — check back in a moment.</div></div>
      )}
      {data?.ok && filtered.length === 0 && (
        <div className={s.empty}>No names match these filters.</div>
      )}

      {data?.ok && BAND_ORDER.map(b => {
        const g = filtered.filter(r => r.band === b)
        if (!g.length) return null
        const [name, rng] = bandMeta[b] || BAND_FALLBACK[b]
        return (
          <section className={s.band} key={b}>
            <div className={s.bandHd}>
              <h2>{name}</h2><span className={s.cnt}>{g.length}</span>
              <span className={`${s.rng} mono`}>{rng}</span>
            </div>
            {g.map((r, i) => renderRow(r, i))}
          </section>
        )
      })}
    </div>
  )
}
