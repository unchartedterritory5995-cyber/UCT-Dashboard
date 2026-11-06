// THE STATUS LINE (round 18 HUD; round 20 bare; round 21 after the owner ranked it Weak in batch 21). One line: the mode,
// one progress rail cut into a notch per chart (gold for a chart named, red for a miss, a breathing outline on the one in
// play), the step as a count, and the charts named so far. Gone: the struck-through "ticker" chip (the masked badge on
// the chart already says the ticker is hidden) and the small ring with a lone number in it.
import UIcon from '../../../components/ui/UIcon'
import s from './study.module.css'

const LABEL = { hard: 'Hard mode' }

export default function Hud({ mode = 'hard', step = 0, total = 1, results = [], live = false, named = null, stepTestId = 'hard-step' }) {
  const name = LABEL[mode] || mode
  const got = named == null ? results.filter(Boolean).length : named
  return (
    <div className={s.status} role="group" aria-label={`${name}, chart ${step + 1} of ${total}, ${got} named`}>
      <span className={`${s.modeTag} ${s[mode] || ''} ${live ? s.live : ''}`}>
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor" /></svg>
        <span className={s.modeName}>{name}</span>
      </span>
      <div className={s.rail} aria-hidden="true">
        {Array.from({ length: total }, (_, i) => {
          const r = results[i]
          const cls = r === true ? s.done : r === false ? s.miss : i === step ? s.now : ''
          return <i key={i} className={`${s.notch} ${cls}`} />
        })}
      </div>
      <span className={s.stepCount} data-testid={stepTestId || undefined}><b>{step + 1}</b><i>/</i>{total}</span>
      <span className={`${s.namedChip} ${got > 0 ? s.on : ''}`} title="charts named">
        <UIcon name="check" size={13} gold={false} />
        <b>{got}</b>
      </span>
    </div>
  )
}
