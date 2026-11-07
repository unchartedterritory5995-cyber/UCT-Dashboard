// ONE button family for Study (round 18; round 21). Black glass with a gold rim and gold type (the owner's round-12
// ruling: "the yellow slab is gone"; a gold slab was Cut in batches 18 and 19), and since round 21 a real pressed edge:
// the button sits on a darker lip and travels down onto it when pressed, the way the best lesson apps' buttons do (batch
// 21 ranked Check and Next Weak). A quiet ghost for the way out; the verdict's own colour for Next. `arrow` ends the
// label with a chevron. `hotkey="Enter"` fires it from the keyboard (never from inside a field; never while busy or
// disabled); the round-20 hint line beside it is gone (batch 21: Cut). `busy` shows a sweep and blocks a second press.
import { useEffect } from 'react'
import UIcon from '../../../components/ui/UIcon'
import s from './study.module.css'

const KIND = { primary: 'primary', secondary: 'secondary', ghost: 'ghost', good: 'btnGood', bad: 'btnBad' }

export default function StudyButton({ kind = 'primary', children, sub = null, icon = null, arrow = false, size = null, hotkey = null, busy = false, wide = false, disabled = false, onClick, className = '', testId = null, ariaLabel = null }) {
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
  const cls = [s.btn, s[KIND[kind] || KIND.primary], kind === 'ghost' ? '' : s.lip, size === 'xl' ? s.btnXl : '', busy ? s.busy : '', wide ? s.wide : '', className].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} disabled={off} onClick={onClick} aria-label={ariaLabel || undefined} aria-busy={busy || undefined} data-testid={testId || undefined}>
      {icon ? <UIcon name={icon} size={18} gold={false} /> : null}
      <span className={s.btnText}><span>{children}</span>{sub ? <span className={s.btnSub}>{sub}</span> : null}</span>
      {arrow ? <span className={s.btnArrow} aria-hidden="true"><UIcon name="chevronRight" size={18} gold={false} /></span> : null}
    </button>
  )
}
