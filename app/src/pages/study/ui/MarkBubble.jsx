// THE MARK AND ITS BUBBLE (round 18; owner, batch 18: "can be improved, use a lot more creativity and production
// quality"). The live three.js mark beside one glass bubble that takes the verdict's colour; the bubble is a status
// region so a screen reader hears the verdict the moment it lands.
import StudyMark from '../../../components/study/StudyMark'
import s from './study.module.css'

export default function MarkBubble({ mood = 'idle', tone = 'ask', size = 64, sealed = false, children }) {
  return (
    <div className={s.ask}>
      <StudyMark mood={mood} size={size} />
      <div className={`${s.bubble} ${tone === 'ok' ? s.ok : tone === 'bad' ? s.bad : ''} ${sealed ? s.sealed : ''}`} role="status">{children}</div>
    </div>
  )
}
