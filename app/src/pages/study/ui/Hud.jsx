// THE HUD (round 18; owner, batch 18, on the HARD tag, the step pill and the crown legend: "a higher level quality of
// production and graphics"). One glass bar: the mode tag, a segmented run (gold for a named chart, red for a miss, a
// sweep on the one in play), the step, and on the right what this mode hides plus whatever the mode adds (a crown row).
import UIcon from '../../../components/ui/UIcon'
import s from './study.module.css'

const LABEL = { hard: 'Hard mode' }

export default function Hud({ mode = 'hard', step = 0, total = 1, results = [], live = false, hidden = [], right = null, stepTestId = 'hard-step' }) {
  const name = LABEL[mode] || mode
  return (
    <div className={s.hud} role="group" aria-label={`${name}, ${step + 1} of ${total}`}>
      <span className={`${s.modeTag} ${s[mode] || ''} ${live ? s.live : ''}`}><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor" /></svg>{name}</span>
      <div className={s.segs} aria-hidden="true">
        {Array.from({ length: total }, (_, i) => {
          const r = results[i]
          const cls = r === true ? s.done : r === false ? s.miss : i === step ? s.now : ''
          return <i key={i} className={`${s.seg} ${cls}`} />
        })}
      </div>
      <span className={s.stepPill} data-testid={stepTestId || undefined}><b>{step + 1}</b> of {total}</span>
      <div className={s.hudRight}>
        {hidden.length ? (
          <span className={s.hidden} aria-label={`hidden on every chart: ${hidden.join(', ')}`}>
            {hidden.map((h) => <span key={h} className={s.hidChip}><UIcon name="eyeOff" size={11} gold={false} /><s>{h}</s></span>)}
          </span>
        ) : null}
        {right ? <span className={s.hudExtra}>{right}</span> : null}
      </div>
    </div>
  )
}
