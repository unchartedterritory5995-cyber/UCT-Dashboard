import { useState } from 'react'
import coach from '../../components/intro/assets/compass-mark.png'
import d5 from '../duo.module.css'

/** Round 6, piece 5: the home, higher production (owner: "cool but can be a lot better and higher quality").
 *  The Duolingo layout kept, now on brand: gold and black, a drawn path curving through the nodes, crowns on what
 *  is done, unit progress in the banner, the banner sticks while you scroll, the coach beside the path. */
const UNITS = [
  { name: 'Reading a candle', sub: 'Unit 1 · 5 levels', nodes: [{ id: 'u1a', state: 'done', crown: 3, title: 'Open, high, low, close' }, { id: 'u1b', state: 'done', crown: 2, title: 'Body and wicks' }, { id: 'u1c', state: 'done', kind: 'chest' }, { id: 'u1d', state: 'done', crown: 3, title: 'Green and red' }, { id: 'u1e', state: 'done', kind: 'trophy', title: 'Unit review' }] },
  { name: 'Candles that trap', sub: 'Unit 2 · 6 levels', nodes: [{ id: 'k1', state: 'done', crown: 1, title: 'Kicker · Learn 1' }, { id: 'k2', state: 'current', title: 'Kicker · Learn 2', sub: 'Lesson 2 of 4 · about 4 minutes' }, { id: 'k3', state: 'locked', title: 'Kicker · Practice' }, { id: 'o1', state: 'locked', kind: 'chest' }, { id: 'o2', state: 'locked', title: 'Oops Reversal · Learn 1' }, { id: 'u2t', state: 'locked', kind: 'trophy', title: 'Unit review' }] },
  { name: 'Pullbacks that fire', sub: 'Unit 3 · 4 levels', locked: true, nodes: [{ id: 's1', state: 'locked', title: 'Slingshot · Learn 1' }, { id: 's2', state: 'locked', title: 'Slingshot · Learn 2' }, { id: 'l1', state: 'locked', kind: 'chest' }, { id: 'u3t', state: 'locked', kind: 'trophy' }] },
]
const OFF = [0, 46, 74, 46, 0, -46, -74, -46]
const STEP = 102   // px per slot (node 76 + gap 26)

function PathLine({ count, offs, startPad }) {
  // x in 0..100 (the column's width), y in px: a viewBox 100 units wide stretched to the column with non-scaling strokes
  const H = startPad + count * STEP
  const pts = Array.from({ length: count }, (_, i) => [50 + (offs[i] / 5.6), startPad + 38 + i * STEP])
  let dAttr = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; dAttr += ` C ${x0} ${y0 + 50}, ${x1} ${y1 - 50}, ${x1} ${y1}` }
  return <svg className={d5.pathSvg} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none"><path d={dAttr} fill="none" stroke="#3a3115" strokeWidth="6" strokeLinecap="round" strokeDasharray="2 14" vectorEffect="non-scaling-stroke" /></svg>
}

export default function Piece30HomeV2() {
  const [open, setOpen] = useState('k2')
  let k = 0
  return (
    <div className={d5.home}>
      <div className={d5.homeBar}>
        <span className={d5.course}><img src={coach} alt="" /> Method</span>
        <span className={d5.stat}><b style={{ color: '#ff9600' }}>🔥</b> 4</span>
        <span className={d5.stat}><b style={{ color: 'var(--g)' }}>◆</b> 1,240 XP</span>
        <span className={d5.stat}><b style={{ color: 'var(--dn)' }}>♥</b> 5</span>
      </div>
      <div className={d5.scroll}>
        {UNITS.map((u, ui) => {
          const done = u.nodes.filter((x) => x.state === 'done').length
          const startIdx = u.nodes.findIndex((x) => x.state === 'current')
          return (
            <section key={u.name} className={d5.unit}>
              <div className={`${d5.banner} ${u.locked ? d5.locked : ''}`}>
                <div className={d5.bannerText}><small>SECTION 1 · UNIT {ui + 1}</small><b>{u.name}</b><em>{done} of {u.nodes.length} levels</em></div>
                <div className={d5.uprog}><i style={{ width: `${(done / u.nodes.length) * 100}%` }} /></div>
                <button type="button" className={d5.guide}>📖 Guidebook</button>
              </div>
              <div className={d5.pathCol}>
                <PathLine count={u.nodes.length} offs={u.nodes.map((_, i) => OFF[(k + i) % OFF.length])} startPad={startIdx >= 0 ? 18 : 18} />
                {u.nodes.map((nd) => {
                  const off = OFF[k % OFF.length]; k += 1
                  const isOpen = open === nd.id
                  return (
                    <div key={nd.id} className={d5.slot} style={{ transform: `translateX(${off}px)` }}>
                      {nd.state === 'current' ? <div className={d5.start}>START</div> : null}
                      <button type="button" className={`${d5.pebble} ${d5[nd.state]} ${nd.kind ? d5[nd.kind] : ''}`} onClick={() => setOpen(isOpen ? null : nd.id)} aria-label={nd.title || nd.kind || 'lesson'}>
                        {nd.kind === 'chest' ? '🎁' : nd.kind === 'trophy' ? '🏆' : nd.state === 'done' ? '✓' : nd.state === 'locked' ? '🔒' : '★'}
                        {nd.crown ? <span className={d5.crown}>♛ {nd.crown}</span> : null}
                      </button>
                      {isOpen ? (
                        <div className={`${d5.pop} ${nd.state === 'locked' ? d5.popLocked : ''}`}>
                          <b>{nd.title || (nd.kind === 'trophy' ? 'Unit review' : 'Reward chest')}</b>
                          <span>{nd.state === 'locked' ? 'Finish the levels above to unlock this.' : nd.sub || (nd.state === 'done' ? `Done · crown ${nd.crown || 0} of 3 · practice to raise it` : 'Open it')}</span>
                          <button type="button" className={d5.popBtn} disabled={nd.state === 'locked'}>{nd.state === 'locked' ? 'LOCKED' : nd.state === 'done' ? 'PRACTICE · +5 XP' : 'START · +10 XP'}</button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {ui === 1 ? <img src={coach} alt="" className={d5.coachPath} /> : null}
              </div>
            </section>
          )
        })}
      </div>
      <nav className={d5.tabs2}>
        {[['🏠', 'Learn', true], ['💪', 'Practice'], ['🛡', 'League'], ['🎁', 'Quests'], ['👤', 'Profile']].map(([ic, l, on]) => <button key={l} type="button" className={`${d5.tabBtn} ${on ? d5.on : ''}`}><span>{ic}</span>{l}</button>)}
      </nav>
    </div>
  )
}
