import { useMemo, useState } from 'react'
import TileCard from '../../components/TileCard'
import { SetupGlyph } from '../../pages/modelbook/SetupsView'
import { SETUP_CATALOG } from '../../pages/modelbook/setupCatalog'
import coach from '../../components/intro/assets/compass-mark.webp'
import d5 from '../duo.module.css'
import { XP, CROWNS, DAILY_GOAL, RANKS } from '../rewards'

/** Round 7, piece 5: the home in OUR layout (owner: "more of OUR BRAND and our layout", "3X the production",
 *  "improve the reward system and scoring a lot"). The site's own TileCard panels with its gold tile headers; the
 *  Setup Library's own glyph art as unit artwork; a rank card with the XP economy; a Rewards tile that states the
 *  rules; a league tile. Units mix Foundations and setups in a sensible order (owner ruling). */
const TOTAL_XP = 1240
const RULES = [
  ['◆', `+${XP.RIGHT} XP`, 'every right answer'],
  ['🔥', `+${XP.COMBO_STEP} per step`, `combo bonus, up to +${XP.COMBO_CAP}`],
  ['★', `+${XP.PERFECT_LESSON} XP`, 'a perfect lesson, no hearts lost'],
  ['♛', '1 · 2 · 3 crowns', `per level at ${CROWNS.ONE} · ${CROWNS.TWO} · ${CROWNS.THREE}% accuracy`],
  ['🎁', 'daily chest', `${DAILY_GOAL} right answers in a day`],
  ['🗓', 'streak', 'a day with a finished lesson'],
  ['🏅', 'setup badge', 'three crowns on every level of a setup'],
  ['🛡', 'weekly league', 'ranked by XP, top three move up'],
]
const UNITS = [
  { name: 'Reading a candle', kind: 'Foundations', glyph: null, nodes: [{ id: 'u1a', state: 'done', crown: 3 }, { id: 'u1b', state: 'done', crown: 2 }, { id: 'u1c', state: 'done', kind: 'chest' }, { id: 'u1d', state: 'done', crown: 3 }, { id: 'u1e', state: 'done', kind: 'trophy' }] },
  { name: 'Kicker', kind: 'Setup', glyph: 'Kicker', nodes: [{ id: 'k1', state: 'done', crown: 1, title: 'Learn 1' }, { id: 'k2', state: 'current', title: 'Learn 2', sub: 'Lesson 2 of 4 · about 4 minutes' }, { id: 'k3', state: 'locked', title: 'Practice' }, { id: 'k4', state: 'locked', kind: 'trophy', title: 'Kicker badge' }] },
  { name: 'The averages', kind: 'Foundations', glyph: null, nodes: [{ id: 'f3a', state: 'locked', title: 'The 9 and the 20' }, { id: 'f3b', state: 'locked', title: 'The 50 and the 200' }, { id: 'f3c', state: 'locked', kind: 'chest' }] },
  { name: 'Oops Reversal', kind: 'Setup', glyph: 'Oops', nodes: [{ id: 'o1', state: 'locked', title: 'Learn 1' }, { id: 'o2', state: 'locked', title: 'Learn 2' }, { id: 'o3', state: 'locked', kind: 'trophy' }] },
  { name: 'Slingshot', kind: 'Setup', glyph: 'Slingshot', nodes: [{ id: 's1', state: 'locked' }, { id: 's2', state: 'locked' }, { id: 's3', state: 'locked', kind: 'chest' }, { id: 's4', state: 'locked', kind: 'trophy' }] },
]
const OFF = [0, 46, 74, 46, 0, -46, -74, -46]
const STEP = 102

function PathLine({ count, offs, startPad = 18 }) {
  const H = startPad + count * STEP
  const pts = Array.from({ length: count }, (_, i) => [50 + (offs[i] / 5.6), startPad + 38 + i * STEP])
  let dAttr = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; dAttr += ` C ${x0} ${y0 + 50}, ${x1} ${y1 - 50}, ${x1} ${y1}` }
  return <svg className={d5.pathSvg} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none"><path d={dAttr} fill="none" stroke="#3a3115" strokeWidth="6" strokeLinecap="round" strokeDasharray="2 14" vectorEffect="non-scaling-stroke" /></svg>
}

export default function Piece35HomeV3() {
  const [open, setOpen] = useState('k2')
  const glyphs = useMemo(() => Object.fromEntries(SETUP_CATALOG.map((x) => [x.name, x])), [])
  const findGlyph = (key) => (key ? Object.values(glyphs).find((x) => x.name.toLowerCase().includes(key.toLowerCase())) : null)
  const rankIdx = RANKS.reduce((r, [, min], i) => (TOTAL_XP >= min ? i : r), 0)
  const [rank, min] = RANKS[rankIdx]
  const nextMin = RANKS[rankIdx + 1]?.[1] ?? min
  const toNext = Math.min(100, ((TOTAL_XP - min) / Math.max(1, nextMin - min)) * 100)
  let k0 = 0
  const offsets = UNITS.map((u) => u.nodes.map(() => OFF[(k0++) % OFF.length]))
  return (
    <div className={`${d5.home} ${d5.homeTiles}`}>
      <div className={d5.homeBar}>
        <span className={d5.course}><img src={coach} alt="" /> Study</span>
        <span className={d5.stat}><b style={{ color: '#ff9600' }}>🔥</b> 4</span>
        <span className={d5.stat}><b style={{ color: 'var(--g)' }}>◆</b> {TOTAL_XP.toLocaleString()} XP</span>
        <span className={d5.stat}><b style={{ color: 'var(--dn)' }}>♥</b> 5</span>
      </div>
      <div className={d5.scroll}>
        <TileCard title="Today">
          <div className={d5.todayRow}>
            <div className={d5.goalRing} style={{ '--p': '60%', width: 92, height: 92 }}><div><b style={{ fontSize: 26 }}>3</b><small>/ 5</small></div></div>
            <div className={d5.todayText}><b>Two more to keep the streak.</b><span>Kicker · Learn 2 · about 4 minutes</span></div>
            <div className={d5.rankCard}><small>{rank} · {TOTAL_XP.toLocaleString()} XP</small><div className={d5.uprog} style={{ width: 150 }}><i style={{ width: `${toNext}%` }} /></div><em>{nextMin > min ? `${(nextMin - TOTAL_XP).toLocaleString()} XP to ${RANKS[rankIdx + 1][0]}` : 'top rank'}</em></div>
          </div>
        </TileCard>
        <TileCard title="Your path">
          <div className={d5.units}>
            {UNITS.map((u, ui) => {
              const done = u.nodes.filter((x) => x.state === 'done').length
              const g = findGlyph(u.glyph)
              return (
                <section key={u.name} className={d5.unit}>
                  <div className={`${d5.banner} ${u.nodes[0].state === 'locked' ? d5.locked : ''}`}>
                    {g ? <div className={d5.art}><SetupGlyph setup={g} /></div> : <div className={d5.artF}>📈</div>}
                    <div className={d5.bannerText}><small>{u.kind.toUpperCase()} · UNIT {ui + 1}</small><b>{u.name}</b><em>{done} of {u.nodes.length} levels</em></div>
                    <div className={d5.uprog}><i style={{ width: `${(done / u.nodes.length) * 100}%` }} /></div>
                    <button type="button" className={d5.guide}>📖</button>
                  </div>
                  <div className={d5.pathCol}>
                    <PathLine count={u.nodes.length} offs={offsets[ui]} />
                    {u.nodes.map((nd, ni) => {
                      const off = offsets[ui][ni]
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
                              <b>{u.name}{nd.title ? ` · ${nd.title}` : nd.kind === 'trophy' ? ' · unit review' : ' · reward chest'}</b>
                              <span>{nd.state === 'locked' ? 'Finish the levels above to unlock this.' : nd.sub || (nd.state === 'done' ? `Done · crown ${nd.crown || 0} of 3 · practice to raise it` : 'Open it')}</span>
                              <button type="button" className={d5.popBtn} disabled={nd.state === 'locked'}>{nd.state === 'locked' ? 'LOCKED' : nd.state === 'done' ? 'PRACTICE · +5 XP' : 'START · +10 XP'}</button>
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </TileCard>
        <TileCard title="Rewards">
          <div className={d5.rules}>{RULES.map(([ic, v, t]) => <div key={t} className={d5.rule}><span>{ic}</span><b>{v}</b><small>{t}</small></div>)}</div>
        </TileCard>
        <TileCard title="This week's league">
          <div className={d5.league}>{[['1', 'Trader 0412', 1890], ['2', 'Trader 0077', 1655], ['3', 'You', TOTAL_XP], ['4', 'Trader 1193', 1120], ['5', 'Trader 0890', 980]].map(([p, nme, x]) => <div key={p} className={`${d5.lrow} ${nme === 'You' ? d5.me : ''}`}><span>{p}</span><b>{nme}</b><em>{x.toLocaleString()} XP</em></div>)}</div>
          <p className={d5.leagueNote}>Top three move up on Sunday night.</p>
        </TileCard>
      </div>
      <nav className={d5.tabs2}>
        {[['🏠', 'Learn', true], ['💪', 'Practice'], ['🛡', 'League'], ['🎁', 'Quests'], ['👤', 'Profile']].map(([ic, l, on]) => <button key={l} type="button" className={`${d5.tabBtn} ${on ? d5.on : ''}`}><span>{ic}</span>{l}</button>)}
      </nav>
    </div>
  )
}
