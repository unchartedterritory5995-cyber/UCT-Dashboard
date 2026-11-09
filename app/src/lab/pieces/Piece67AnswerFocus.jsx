import { useState } from 'react'
import { AnswerLessonApp, AnswerQuizShow, AnswerTicket } from '../../pages/study/ui/AnswerLooks'
import s from '../../pages/study/ui/study.module.css'

/** Focus round 2 (2026-11-08): the answer area (the question, the four answers, Check), three versions side by side.
 *  Each one is live: pick an answer, Check it (Kicker is right here), then Next resets it. `?state=sel|ok|bad` holds a
 *  moment for pictures. */
const CHOICES = ['Kicker', 'Oops Reversal', 'Nothing fired', 'Bear gap']
const RIGHT = 'Kicker'

function Demo(props) {
  const { View, still } = props
  const init = still === 'sel' ? { pick: 1, state: 'ask' } : still === 'ok' ? { pick: 0, state: 'ok' } : still === 'bad' ? { pick: 1, state: 'bad' } : { pick: null, state: 'ask' }
  const [st, setSt] = useState(init)
  const [n, setN] = useState(0)
  return (
    <View key={n} choices={CHOICES} pick={st.pick} state={st.state} answer={st.state === 'ask' ? null : RIGHT} step={0} total={8}
      onPick={(i) => setSt({ pick: i, state: 'ask' })}
      onCheck={() => setSt((x) => ({ ...x, state: CHOICES[x.pick] === RIGHT ? 'ok' : 'bad' }))}
      onNext={() => { setSt({ pick: null, state: 'ask' }); setN((k) => k + 1) }} />
  )
}

const LOOKS = [
  { key: 'lesson', name: 'A · Lesson app', ref: "like Duolingo's lesson screen: a context line, a fuller question, tactile tiles, one wide Check bar that lights up", View: AnswerLessonApp },
  { key: 'quiz', name: 'B · Quiz show', ref: 'like Kahoot: four big tiles with their own colour and shape; the tile you pick carries "Lock it in", no separate Check', View: AnswerQuizShow },
  { key: 'ticket', name: 'C · Order ticket', ref: "like a trading platform's order ticket: the question and what to read on the candle, the answers as rows, a gold submit bar", View: AnswerTicket },
]

export default function Piece67AnswerFocus() {
  const still = new URLSearchParams(window.location.search).get('state')
  return (
    <div className={s.kit} style={{ minHeight: '100vh', background: 'radial-gradient(1200px 500px at 50% -10%, #1a1608, #070707 60%)', padding: '22px 18px 40px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', color: '#dcbb5e' }}>Focus · the answer area</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>The question, the four answers and Check, three ways</div>
          <div style={{ fontSize: 13, color: '#a39e94', marginTop: 4 }}>Each one works: pick an answer and check it (Kicker is the right one here), then Next starts it again. The chart sits above this on the real screen.</div>
        </div>
        {LOOKS.map((look) => { const { key, name, ref } = look; const View = look.View; return (
          <section key={key} data-look={key} style={{ border: '1px solid rgba(220,187,94,.28)', borderRadius: 18, padding: '14px 18px 18px', background: 'linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.008))' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15, color: '#e9cd77' }}>{name}</b>
              <span style={{ fontSize: 12.5, color: '#a39e94' }}>{ref}</span>
            </div>
            <Demo View={View} still={still} />
          </section>
        )})}
      </div>
    </div>
  )
}
