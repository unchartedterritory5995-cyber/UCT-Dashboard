// HOW IT PLAYS (the owner, batch 9: "it should begin with a tutorial"; rule 12). Every game's start screen carries the
// same three steps in the shared look: open by itself the first time a member meets the game, then one tap away.
import { useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import h from './howItPlays.module.css'

const seenKey = (mode) => `study.howto.${mode}`
const wasSeen = (mode) => { try { return localStorage.getItem(seenKey(mode)) === '1' } catch { return false } }
const markSeen = (mode) => { try { localStorage.setItem(seenKey(mode), '1') } catch { /* no storage */ } }

/** `steps`: [{ icon, title, body }] (three); `mode` keys the first-time memory. */
export default function HowItPlays({ mode, steps, testId = null }) {
  const [open, setOpen] = useState(() => !wasSeen(mode))
  const toggle = () => { setOpen((o) => { if (o) markSeen(mode); return !o }) }
  return (
    <div className={`${h.how} ${open ? h.open : ''}`} data-testid={testId || undefined}>
      <button type="button" className={h.head} onClick={toggle} aria-expanded={open}>
        <UIcon name="info" size={15} gold={false} /><span>How it plays</span><UIcon name={open ? 'chevronUp' : 'chevronDown'} size={15} gold={false} />
      </button>
      {open ? (
        <>
          <ol className={h.steps}>
            {steps.map((st, i) => (
              <li key={i} className={h.step} style={{ '--i': i }}>
                <span className={h.num}>{i + 1}</span>
                <span className={h.icon}><UIcon name={st.icon} size={18} /></span>
                <b>{st.title}</b>
                <span className={h.body}>{st.body}</span>
              </li>
            ))}
          </ol>
          <button type="button" className={h.got} onClick={toggle}>Got it</button>
        </>
      ) : null}
    </div>
  )
}
