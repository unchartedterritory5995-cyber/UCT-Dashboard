import { useState, useMemo } from 'react'
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
const expShort = e => (typeof e === 'string' ? e.replace(/\/(\d{2})(\d{2})$/, '/$2') : e)

export default function Confluence() {
  const { data, isLoading } = useConfluence()
  const [dir, setDir] = useState('all')      // all | BULL | BEAR
  const [cap, setCap] = useState('all')      // all | L | M | S
  const [status, setStatus] = useState('all')// all | BUILDING | STEADY | ESTABLISHED
  const [q, setQ] = useState('')

  const rows = data?.rows || []
  const bandMeta = data?.band_meta || BAND_FALLBACK

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

  const Seg = ({ opts, val, set }) => (
    <div className={s.seg}>
      {opts.map(o => (
        <button key={o.v} className={[val === o.v ? s.on : '', o.cls ? s[o.cls] : ''].join(' ')}
          onClick={() => set(o.v)}>{o.l}</button>
      ))}
    </div>
  )

  return (
    <div className={s.page}>
      <div className={s.head}>
        <div className={s.titleWrap}>
          <div className={s.eyebrow}>Confluence Radar</div>
          <h1 className={s.title}>Dark Pool × LEAP Flow</h1>
          <p className={s.sub}>
            Where institutional <span className={s.dp}>dark-pool accumulation</span> and{' '}
            <span className={s.fl}>LEAP / size-with-time options flow</span> point the same way.
            Freshness is a status, not a filter — a positioned book still counts.
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
        <div className={s.metric}><div className={s.k}>Dark-pool accum</div><div className={`${s.v} mono`}>{usd(totDP)}<small>shown · 30d</small></div></div>
        <div className={s.metric}><div className={s.k}>Window</div><div className={`${s.v} mono`}>{data?.days || 30}d<small>trailing</small></div></div>
      </div>

      <div className={s.filters}>
        <Seg val={dir} set={setDir} opts={[{ v: 'all', l: 'All' }, { v: 'BULL', l: 'Bull', cls: 'bull' }, { v: 'BEAR', l: 'Bear', cls: 'bear' }]} />
        <Seg val={cap} set={setCap} opts={[{ v: 'all', l: 'All caps' }, { v: 'L', l: 'Large' }, { v: 'M', l: 'Mid' }, { v: 'S', l: 'Small' }]} />
        <Seg val={status} set={setStatus} opts={[{ v: 'all', l: 'Any' }, { v: 'BUILDING', l: 'Building' }, { v: 'STEADY', l: 'Steady' }, { v: 'ESTABLISHED', l: 'Established' }]} />
        <input className={s.search} placeholder="Ticker / sector…" value={q} onChange={e => setQ(e.target.value)} />
        <span className={s.count}>{filtered.length} of {rows.length}</span>
      </div>

      <div className={s.legend}>
        <span><span className={`${s.dot} ${s.dp}`} /> Dark-pool 30d + accumulation</span>
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
            {g.map((r, i) => {
              const bull = r.dir === 'BULL'
              const t = r.top || {}
              const ls = Math.round((r.leapShare || 0) * 100)
              return (
                <div className={s.row} key={r.sym}>
                  <div className={s.anchor}>
                    <span className={`${s.rank} mono`}>#{i + 1}</span>
                    <TickerPopup sym={r.sym} as="button" className={s.tkr} darkPool>{r.sym}</TickerPopup>
                    <span className={s.sector}>{r.sector}</span>
                  </div>

                  <div className={`${s.sig} ${s.dp}`}>
                    <div className={s.lab}><span>Dark Pool · 30d</span>
                      <span className={`${s.chip} ${r.acc === 'Dist' ? s.dist : s.acc}`}>{(r.acc || '').toUpperCase()}</span>
                    </div>
                    <div className={s.big}>{usd(r.dpn)}</div>
                    <div className={s.meta}>biggest block <span className="mono">{usd(r.bigPrint)}</span>{r.bigDate ? <> · <span className="mono">{r.bigDate}</span></> : null}</div>
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
            })}
          </section>
        )
      })}
    </div>
  )
}
