// ANSWER CARDS (round 18; owner, batch 16: "gold-coin answer cards"; batch 18: "better and more on brand"). A numbered
// coin, the label, and after the verdict a mark; the card itself is the control (a real button with a pressed state and
// a keyboard focus ring). States: idle · sel (picked, not yet checked) · right · wrong · quiet (the others after the
// verdict). `i` staggers the deal when the grid cascades.
import UIcon from '../../../components/ui/UIcon'
import s from './study.module.css'

export function ChoiceGrid({ children, one = false, cascade = true, testId = null, label = null }) {
  return (
    <div className={`${s.cards} ${one ? s.one : ''} ${cascade ? s.cascade : ''}`} role="group" aria-label={label || undefined} data-testid={testId || undefined}>
      {children}
    </div>
  )
}

export default function Choice({ n, label, state = 'idle', onClick, disabled = false, i = 0 }) {
  const cls = [s.card, state === 'sel' ? s.sel : '', state === 'right' ? s.right : '', state === 'wrong' ? s.wrong : '', state === 'quiet' ? s.quiet : ''].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} style={{ '--i': i }} disabled={disabled} onClick={onClick} aria-pressed={state === 'sel' ? true : undefined} data-state={state}>
      <span className={s.coin} aria-hidden="true">{n}</span>
      <span className={s.cardLabel}>{label}</span>
      {state === 'right' ? <span className={s.cardMark} aria-label="right"><UIcon name="check" size={18} gold={false} /></span>
        : state === 'wrong' ? <span className={s.cardMark} aria-label="wrong"><UIcon name="x" size={18} gold={false} /></span> : null}
    </button>
  )
}
