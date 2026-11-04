import { useState } from 'react'
import s from '../lab.module.css'

/** Round 4, piece 5: THE HOME, a Duolingo-style path. The direction piece: where a member lands every day. Units
 *  as nodes on a winding path (done / current / locked), today's goal ring, the streak, the daily set, and a tap on
 *  a node slides up the lesson card with Start. Names are the spec's Foundations + the Method's setups. */
const PATH = [
  { id: 'f1', unit: 'Foundations 1', name: 'Market basics', state: 'done', score: 10 },
  { id: 'f2', unit: 'Foundations 2', name: 'Reading a candle', state: 'done', score: 9 },
  { id: 'f3', unit: 'Foundations 3', name: 'The averages', state: 'done', score: 8 },
  { id: 'k', unit: 'Method', name: 'Kicker', state: 'current', score: null, sub: 'Learn 2 of 3' },
  { id: 'o', unit: 'Method', name: 'Oops Reversal', state: 'locked' },
  { id: 'sl', unit: 'Method', name: 'Slingshot', state: 'locked' },
  { id: 'lp', unit: 'Method', name: 'Launchpad', state: 'locked' },
  { id: 'f4', unit: 'Foundations 4', name: 'Volume', state: 'locked' },
  { id: 'gs', unit: 'Method', name: 'Go Signal', state: 'locked' },
]

export default function Piece20Path() {
  const [open, setOpen] = useState(null)
  const node = open != null ? PATH[open] : null
  return (
    <div className={`${s.col} ${s.home}`}>
      <div className={s.homeTop}>
        <div className={s.goal} style={{ '--p': '60%' }}><div><b>3</b><small>/ 5</small></div></div>
        <div className={s.homeText}><div className={s.eyebrow}>Today</div><h1 className={s.h1}>Two more to keep the streak.</h1><p className={s.sub}>Kicker · Learn 2 of 3 · about 4 minutes</p></div>
        <div className={s.streak}><b>🔥 4</b><small>day streak</small></div>
      </div>
      <div className={s.path}>
        {PATH.map((p, i) => (
          <button key={p.id} type="button" className={`${s.node} ${s[p.state]} ${open === i ? s.sel : ''}`} style={{ marginLeft: `${50 + 34 * Math.sin(i * 1.1)}%` }} onClick={() => setOpen(open === i ? null : i)} aria-label={`${p.unit}: ${p.name}`}>
            <span className={s.nodeDot}>{p.state === 'done' ? '✓' : p.state === 'locked' ? '🔒' : '▶'}</span>
            <span className={s.nodeText}><small>{p.unit}</small><b>{p.name}</b>{p.sub ? <em>{p.sub}</em> : null}{p.score != null ? <em>{p.score}/10</em> : null}</span>
          </button>
        ))}
      </div>
      {node ? (
        <div className={`${s.sheet} ${s.open}`}><div className={s.sheetIn}>
          <div className={s.eyebrow}>{node.unit}</div>
          <div className={s.big}>{node.name}</div>
          <p className={s.lesson}>{node.state === 'locked' ? 'Finish the Kicker to unlock this one.' : node.state === 'done' ? `Done, ${node.score}/10. Play it again for XP, or review your misses.` : 'One red day, then the candle that opens above it. Ten questions on real charts.'}</p>
          <button type="button" className={s.cta} disabled={node.state === 'locked'} onClick={() => setOpen(null)}>{node.state === 'done' ? 'Practice again' : node.state === 'locked' ? 'Locked' : 'Start'}</button>
        </div></div>
      ) : null}
    </div>
  )
}
