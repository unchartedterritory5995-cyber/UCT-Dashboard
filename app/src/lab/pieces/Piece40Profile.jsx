import { useMemo } from 'react'
import TileCard from '../../components/TileCard'
import Logo from '../Logo'
import d5 from '../duo.module.css'

/** Round 8, piece 5: THE PROFILE. Setups mastered with crowns, accuracy per setup, best run, charts seen, a
 *  practice heat map of the last twelve weeks, crown decay (a setup idle for two weeks shows a cracked crown and
 *  asks for a review), and the weekly league card. Numbers here are placeholders shaped like the real ones. */
const SETUPS = [
  { name: 'Kicker', crowns: 2, acc: 86, seen: 64, last: 1 },
  { name: 'Slingshot', crowns: 1, acc: 71, seen: 30, last: 16 },
  { name: 'Launchpad', crowns: 3, acc: 94, seen: 48, last: 3 },
  { name: 'Oops Reversal', crowns: 0, acc: null, seen: 0, last: null },
  { name: 'Go Signal', crowns: 0, acc: null, seen: 0, last: null },
]
const DECAY_DAYS = 14

export default function Piece40Profile() {
  // 12 weeks x 7 days of practice, newest at the right; deterministic placeholder pattern
  const weeks = useMemo(() => Array.from({ length: 12 }, (_, w) => Array.from({ length: 7 }, (_, dd) => { const v = ((w * 7 + dd) * 37) % 11; return w === 11 && dd > 3 ? 0 : v > 7 ? 3 : v > 4 ? 2 : v > 2 ? 1 : 0 })), [])
  const total = SETUPS.reduce((a, x) => a + x.seen, 0)
  return (
    <div className={`${d5.home} ${d5.homeTiles}`}>
      <div className={d5.homeBar}><span className={d5.course}><Logo mood="idle" size={28} /> Profile</span><span className={d5.stat}><b style={{ color: '#ff9600' }}>🔥</b> 4</span><span className={d5.stat}><b style={{ color: 'var(--g)' }}>◆</b> 1,240 XP</span></div>
      <div className={d5.scroll}>
        <TileCard title="Trader">
          <div className={d5.todayRow}>
            <Logo mood="happy" size={92} />
            <div className={d5.todayText}><b>Patrick · Trader</b><span>Member since Oct 2026 · 260 XP to Pro</span><div className={d5.uprog} style={{ width: 180, marginTop: 6 }}><i style={{ width: '66%' }} /></div></div>
            <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>📈</span><small>Charts seen</small><b>{total}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>🔥</span><small>Best run</small><b>9</b></div></div></div>
          </div>
        </TileCard>
        <TileCard title="Setups">
          <div className={d5.setupRows}>
            {SETUPS.map((x) => {
              const stale = x.last != null && x.last >= DECAY_DAYS
              return (
                <div key={x.name} className={`${d5.setupRow} ${stale ? d5.stale : ''} ${x.seen === 0 ? d5.dimRow : ''}`}>
                  <b>{x.name}</b>
                  <span className={d5.crowns}>{[1, 2, 3].map((c) => <i key={c} className={c <= x.crowns ? (stale ? d5.cracked : d5.lit) : ''}>♛</i>)}</span>
                  <span className={d5.acc}>{x.acc != null ? <><em style={{ width: `${x.acc}%` }} /><small>{x.acc}% right · {x.seen} charts</small></> : <small>not started</small>}</span>
                  {stale ? <button type="button" className={d5.reviewBtn}>Review · {x.last} days idle</button> : x.seen ? <small className={d5.lastSeen}>{x.last === 1 ? 'yesterday' : `${x.last} days ago`}</small> : null}
                </div>
              )
            })}
          </div>
          <p className={d5.leagueNote}>A crown cracks after {DECAY_DAYS} days without practice. A short review restores it.</p>
        </TileCard>
        <TileCard title="Practice · last 12 weeks">
          <div className={d5.heat}>{weeks.map((w, wi) => <div key={wi} className={d5.heatCol}>{w.map((v, di) => <i key={di} className={d5[`h${v}`]} />)}</div>)}</div>
          <div className={d5.heatKey}><small>less</small>{[0, 1, 2, 3].map((v) => <i key={v} className={d5[`h${v}`]} />)}<small>more</small></div>
        </TileCard>
        <TileCard title="This week's league">
          <div className={d5.league}>{[['1', 'Trader 0412', 1890], ['2', 'Trader 0077', 1655], ['3', 'You', 1240], ['4', 'Trader 1193', 1120]].map(([p, nme, x]) => <div key={p} className={`${d5.lrow} ${nme === 'You' ? d5.me : ''}`}><span>{p}</span><b>{nme}</b><em>{x.toLocaleString()} XP</em></div>)}</div>
          <p className={d5.leagueNote}>Top three move up on Sunday night. Names are placeholders.</p>
        </TileCard>
      </div>
      <nav className={d5.tabs2}>{[['🏠', 'Learn'], ['💪', 'Practice'], ['🛡', 'League'], ['🎁', 'Quests'], ['👤', 'Profile', true]].map(([ic, l, on]) => <button key={l} type="button" className={`${d5.tabBtn} ${on ? d5.on : ''}`}><span>{ic}</span>{l}</button>)}</nav>
    </div>
  )
}
