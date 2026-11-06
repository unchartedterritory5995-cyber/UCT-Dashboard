// ANSWER CARDS (round 18; owner, batch 16: "gold-coin answer cards"; batch 18: "better and more on brand"; batch 19: the
// cards and their colours Weak). A thin gold ring with the number, the label, and after the verdict the ring itself
// carries the mark; the card is the control (a real button with a pressed state and a keyboard focus ring). States:
// idle · sel (picked, not yet checked) · right · wrong · quiet (the others after the verdict). `i` staggers the deal.
import UIcon from '../../../components/ui/UIcon'
import s from './study.module.css'

export function ChoiceGrid({ children, one = false, row = false, cascade = true, testId = null, label = null }) {
  return (
    <div className={`${s.cards} ${one ? s.one : ''} ${row ? s.row : ''} ${cascade ? s.cascade : ''}`} role="group" aria-label={label || undefined} data-testid={testId || undefined}>
      {children}
    </div>
  )
}

export default function Choice({ n, label, state = 'idle', onClick, disabled = false, i = 0, pill = false }) {
  const cls = [s.card, pill ? s.pill : '', state === 'sel' ? s.sel : '', state === 'right' ? s.right : '', state === 'wrong' ? s.wrong : '', state === 'quiet' ? s.quiet : ''].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} style={{ '--i': i }} disabled={disabled} onClick={onClick} aria-pressed={state === 'sel' ? true : undefined} data-state={state}>
      <span className={s.num} aria-hidden="true">
        {state === 'right' ? <UIcon name="check" size={14} gold={false} /> : state === 'wrong' ? <UIcon name="x" size={14} gold={false} /> : n}
      </span>
      <span className={s.cardLabel}>{label}</span>
    </button>
  )
}
