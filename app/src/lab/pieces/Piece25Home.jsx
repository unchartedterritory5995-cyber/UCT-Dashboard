import { useState } from 'react'
import coach from '../../components/intro/assets/compass-mark.png'
import d5 from '../duo.module.css'

/** Round 5, piece 5: the home, the way Duolingo lays it out (owner: "too confusing, check out a ton of apps LIKE
 *  DUOLINGO"). Top bar: course chip, streak flame, gems, hearts. A colored unit banner with the unit's name and a
 *  Guidebook button. A path of big round nodes down the middle, a floating START bubble over the current one,
 *  gold for done, grey for locked, a chest and a trophy at the unit's end, the coach beside the path. A bottom
 *  tab bar. Tapping a node opens its popup right under it with the lesson count and a Start button. */
const UNITS = [
  { name: 'Unit 1 · Reading a candle', color: '#58cc02', nodes: [{ id: 'u1a', state: 'done' }, { id: 'u1b', state: 'done' }, { id: 'u1c', state: 'done', kind: 'chest' }, { id: 'u1d', state: 'done' }, { id: 'u1e', state: 'done', kind: 'trophy' }] },
  { name: 'Unit 2 · Candles that trap', color: '#1cb0f6', nodes: [{ id: 'k1', state: 'done', title: 'Kicker · Learn 1' }, { id: 'k2', state: 'current', title: 'Kicker · Learn 2', sub: 'Lesson 2 of 4' }, { id: 'k3', state: 'locked', title: 'Kicker · Practice' }, { id: 'o1', state: 'locked', title: 'Oops Reversal · Learn 1', kind: 'chest' }, { id: 'o2', state: 'locked', title: 'Oops Reversal · Learn 2' }, { id: 'u2t', state: 'locked', kind: 'trophy', title: 'Unit review' }] },
  { name: 'Unit 3 · Pullbacks that fire', color: '#ce82ff', nodes: [{ id: 's1', state: 'locked', title: 'Slingshot · Learn 1' }, { id: 's2', state: 'locked', title: 'Slingshot · Learn 2' }, { id: 'l1', state: 'locked', title: 'Launchpad · Learn 1', kind: 'chest' }, { id: 'u3t', state: 'locked', kind: 'trophy' }] },
]
const OFF = [0, 44, 70, 44, 0, -44, -70, -44]

export default function Piece25Home() {
  const [open, setOpen] = useState('k2')
  let k = 0
  return (
    <div className={d5.home}>
      <div className={d5.homeBar}>
        <span className={d5.course}>📈 Method</span>
        <span className={d5.stat}><b style={{ color: '#ff9600' }}>🔥</b> 4</span>
        <span className={d5.stat}><b style={{ color: '#1cb0f6' }}>◆</b> 320</span>
        <span className={d5.stat}><b style={{ color: '#ff4b4b' }}>♥</b> 5</span>
      </div>
      <div className={d5.scroll}>
        {UNITS.map((u) => (
          <section key={u.name} className={d5.unit}>
            <div className={d5.banner} style={{ background: u.color }}>
              <div><small>SECTION 1</small><b>{u.name}</b></div>
              <button type="button" className={d5.guide}>📖 Guidebook</button>
            </div>
            <div className={d5.pathCol} style={{ '--c': u.color }}>
              {u.nodes.map((nd) => {
                const off = OFF[k % OFF.length]; k += 1
                const isOpen = open === nd.id
                return (
                  <div key={nd.id} className={d5.slot} style={{ transform: `translateX(${off}px)` }}>
                    {nd.state === 'current' ? <div className={d5.start}>START</div> : null}
                    <button type="button" className={`${d5.pebble} ${d5[nd.state]} ${nd.kind ? d5[nd.kind] : ''}`} onClick={() => setOpen(isOpen ? null : nd.id)} aria-label={nd.title || nd.kind || 'lesson'}>
                      {nd.kind === 'chest' ? '🎁' : nd.kind === 'trophy' ? '🏆' : nd.state === 'done' ? '✓' : nd.state === 'locked' ? '🔒' : '★'}
                    </button>
                    {isOpen ? (
                      <div className={`${d5.pop} ${nd.state === 'locked' ? d5.popLocked : ''}`} style={{ background: nd.state === 'locked' ? '#2b2b2b' : u.color }}>
                        <b>{nd.title || (nd.kind === 'trophy' ? 'Unit review' : 'Reward')}</b>
                        <span>{nd.state === 'locked' ? 'Complete all levels above to unlock this!' : nd.sub || (nd.state === 'done' ? 'Done · tap to practice again' : '')}</span>
                        <button type="button" className={d5.popBtn} disabled={nd.state === 'locked'}>{nd.state === 'locked' ? 'LOCKED' : nd.state === 'done' ? 'PRACTICE · +5 XP' : 'START · +10 XP'}</button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
              <img src={coach} alt="" className={d5.coachPath} />
            </div>
          </section>
        ))}
      </div>
      <nav className={d5.tabs2}>
        {[['🏠', 'Learn', true], ['💪', 'Practice'], ['🛡', 'League'], ['🎁', 'Quests'], ['👤', 'Profile']].map(([ic, l, on]) => <button key={l} type="button" className={`${d5.tabBtn} ${on ? d5.on : ''}`}><span>{ic}</span>{l}</button>)}
      </nav>
    </div>
  )
}
