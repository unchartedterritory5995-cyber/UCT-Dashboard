import { useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import { arrowAt } from '../pointers'
import s from '../lab.module.css'

const RESULTS = [1, 1, 0, 1, 1, 1, 0, 1, 1, 1]
const MISSES = [
  { q: 'Q3 · MSTR', fix: 'you called a 0.3% red day real. The red day must be real.', sample: 'MSTR_2023-10-23' },
  { q: 'Q7 · HAS', fix: 'a Kicker inside a slide, not a base. It lives in a base or an uptrend.', sample: 'HAS_2023-02-02' },
]

function Confetti() {
  const bits = Array.from({ length: 80 }, (_, i) => ({ l: (i * 37) % 100, d: (i % 7) * 0.12, c: ['#d9b84a', '#1ae51a', '#ffffff', '#ff6b6b'][i % 4], r: 1.4 + (i % 5) * 0.25 }))
  return <div className={s.confetti}>{bits.map((b, i) => <i key={i} style={{ left: `${b.l}%`, background: b.c, animationDelay: `${b.d}s`, animationDuration: `${b.r}s` }} />)}</div>
}

function MissChart({ sample }) {
  const d = useSample(sample)
  const bars = d?.visible
  const ann = useMemo(() => (bars ? arrowAt(bars, bars.length - 1, { label: 'the one you missed', color: '#ff6b6b', id: 'm' }) : null), [bars])
  return <div className={s.chartBox}><StudyChart bars={bars} annotations={ann} height={220} /></div>
}

/** Round 4, piece 4: the real end of a lesson (owner on the mock frame: "not sure what this is trying to show").
 *  The last question on the widget, Check, the sheet, then the finish: the ring fills, the LEVEL bar fills and
 *  levels up, XP bursts, the streak flame grows, the next lesson flips open. Each miss opens its own chart. */
export default function Piece19FinishV4() {
  const d = useSample()
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')     // ask | ok | done
  const [count, setCount] = useState(0)
  const [lvl, setLvl] = useState(42)             // level progress %, fills to 100 then rolls over
  const [level, setLevel] = useState(2)
  const [open, setOpen] = useState(null)
  const right = RESULTS.filter(Boolean).length
  const bars = d?.visible
  useEffect(() => {
    if (state !== 'done') return undefined
    let i = 0
    const t = setInterval(() => {
      i += 1
      setCount(Math.min(i, right))
      setLvl((v) => { const nv = 42 + i * 8; if (nv >= 100) { setLevel(3); return nv - 100 } return nv })
      if (i >= right) clearInterval(t)
    }, 130)
    return () => clearInterval(t)
  }, [state, right])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  if (state !== 'done') {
    return (
      <div className={s.col}>
        <div className={s.top}><span>10 of 10</span><span className={s.bar}><i style={{ width: state === 'ask' ? '90%' : '100%' }} /></span><span className={s.combo}>🔥 3 in a row</span></div>
        <h1 className={s.h1}>Last one. What setup, if any, just fired?</h1>
        <div className={s.chartBox}><WidgetChart sym={d.sym} bars={bars} height={420} density="compact" /></div>
        <div className={s.choices}>
          {['Slingshot', 'None of these', 'Kicker', 'Launchpad'].map((c, i) => {
            let cls = s.choice
            if (state === 'ask' && pick === i) cls += ` ${s.on}`
            if (state === 'ok' && i === 2) cls += ` ${s.right}`
            return <button key={c} type="button" className={cls} disabled={state !== 'ask'} onClick={() => setPick(i)}><span className={s.n}>{i + 1}</span>{c}</button>
          })}
        </div>
        {state === 'ask' ? (
          <div className={s.foot}><button type="button" className={s.cta} disabled={pick == null} onClick={() => setState('ok')}>Check</button></div>
        ) : (
          <div className={`${s.sheet} ${s.open} ${s.ok}`}><div className={s.sheetIn}>
            <div className={`${s.big} ${s.ok}`}><span className={s.badge}>✓</span>{pick === 2 ? 'Right. Lesson done.' : 'Kicker. Lesson done.'}</div>
            <button type="button" className={s.cta} onClick={() => setState('done')}>See your result</button>
          </div></div>
        )}
      </div>
    )
  }
  return (
    <div className={s.col}>
      {count >= right ? <Confetti /> : null}
      <div className={s.finish}>
        <div className={s.eyebrow}>Kicker · lesson complete</div>
        <div className={s.ring2} style={{ '--p': `${(count / 10) * 100}%` }}><div><b>{count}</b><small>of 10</small></div></div>
        <div className={s.rank}>{count >= right ? 'Sharp' : ''}</div>
        <div className={s.levelRow}>
          <span className={s.levelTag}>Level {level}</span>
          <span className={s.levelBar}><i style={{ width: `${lvl}%` }} /></span>
          <span className={s.levelTag}>{level === 3 ? 'Level up!' : `Level ${level + 1}`}</span>
        </div>
        <div className={s.stats}>
          <div className={s.stat}><div className={s.v}>+{count * 12}</div><div className={s.k}>XP</div></div>
          <div className={s.stat}><div className={`${s.v} ${count >= right ? s.flame : ''}`}>🔥 4</div><div className={s.k}>day streak</div></div>
          <div className={s.stat}><div className={s.v}>🏆 5</div><div className={s.k}>best run</div></div>
        </div>
        <div className={s.chips}><span className={s.chip}>the red day is real</span><span className={s.chip}>opens above, closes strong</span><span className={s.chip}>the low is the line</span></div>
        <div className={s.strip}>{RESULTS.map((r, k) => <i key={k} className={r ? s.ok : s.bad} />)}</div>
        <div className={s.missRow}>
          {MISSES.map((m, i) => <button key={m.q} type="button" className={`${s.missBtn} ${open === i ? s.on : ''}`} onClick={() => setOpen(open === i ? null : i)}>{m.q}</button>)}
        </div>
        {open != null ? <div className={s.missOpen}><MissChart sample={MISSES[open].sample} /><p className={s.lesson}>{MISSES[open].fix}</p></div> : null}
        <div className={`${s.next} ${count >= right ? s.flip : ''}`}><span className={s.eyebrow}>Unlocked</span><b>Oops Reversal</b><small>the red day that fails to follow through</small></div>
      </div>
      <div className={s.foot}><button type="button" className={s.cta}>Continue</button></div>
    </div>
  )
}
