// ONE button family for Study (round 18). Brushed gold with a real edge for the one primary action; black glass with
// a gold rim for the second; a quiet ghost for the way out; the verdict's own colour for Next. `hotkey="Enter"` fires
// it from the keyboard (never from inside a field; never while busy or disabled), and the key glyph says so. `busy`
// shows a sweep and blocks a second press while an attempt is on the wire. Owner, batch 18: the Check button "needs so
// much improvement" (Cut); round 12: "one primary button family ... the yellow slab is gone".
import { useEffect } from 'react'
import UIcon from '../../../components/ui/UIcon'
import s from './study.module.css'

const KIND = { primary: 'primary', secondary: 'secondary', ghost: 'ghost', good: 'btnGood', bad: 'btnBad' }

export default function StudyButton({ kind = 'primary', children, sub = null, icon = null, hotkey = null, busy = false, wide = false, disabled = false, onClick, className = '', testId = null, ariaLabel = null }) {
  const off = disabled || busy
  useEffect(() => {
    if (!hotkey || off) return undefined
    const k = (e) => {
      if (e.key !== hotkey || e.repeat) return
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      onClick?.()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [hotkey, off, onClick])
  const cls = [s.btn, s[KIND[kind] || KIND.primary], busy ? s.busy : '', wide ? s.wide : '', className].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} disabled={off} onClick={onClick} aria-label={ariaLabel || undefined} aria-busy={busy || undefined} data-testid={testId || undefined}>
      {icon ? <UIcon name={icon} size={18} gold={false} /> : null}
      <span className={s.btnText}><span>{children}</span>{sub ? <span className={s.btnSub}>{sub}</span> : null}</span>
      {hotkey === 'Enter' ? <span className={s.hotkey} aria-hidden="true">↵</span> : null}
    </button>
  )
}
