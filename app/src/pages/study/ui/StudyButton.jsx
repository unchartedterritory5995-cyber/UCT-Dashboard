// ONE button for every Study screen (kit v2, 2026-11-08). The owner ranked Start, Check and Next Weak or Cut in every
// round ("horrible and low quality visual"; "the START BUTTON can be significantly better and cleaner") and asked that
// his notes hold everywhere (docs/study/OWNER_PRINCIPLES.md, rule 17), so every drill, challenge, start and end screen
// presses this one: a struck-gold ingot that sinks into its base, an engraved label, a light that runs across it, the
// arrow in a dark medallion (kit2.module.css .pbtn). Kinds: primary (gold), secondary (black and gold), good / bad (the
// verdict's colour), ghost (the quiet way out). `hotkey="Enter"` fires it from the keyboard (never from inside a field,
// never while busy or disabled); `busy` runs a sweep and blocks a second press.
import { useEffect } from 'react'
import UIcon from '../../../components/ui/UIcon'
import k from './kit2.module.css'

const KIND = { primary: '', secondary: 'dark', dark: 'dark', ghost: 'ghost', good: 'good', bad: 'bad' }

export default function StudyButton({ kind = 'primary', children, sub = null, icon = null, arrow = false, size = null, hotkey = null, busy = false, wide = false, disabled = false, onClick, className = '', testId = null, ariaLabel = null }) {
  const off = disabled || busy
  useEffect(() => {
    if (!hotkey || off) return undefined
    const h = (e) => {
      if (e.key !== hotkey || e.repeat) return
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      // a focused Study button presses itself (the browser's own Enter); anywhere else, a picked tile included, Enter
      // presses this one, once (the default is stopped so a focused tile is not clicked again)
      if (e.target?.dataset?.studyBtn === '1') return
      e.preventDefault()
      onClick?.()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [hotkey, off, onClick])
  const variant = KIND[kind] ?? ''
  const cap = arrow && kind !== 'ghost'
  const cls = [k.pbtn, variant ? k[variant] : '', size === 'xl' ? k.xl : '', wide ? k.wide : '', cap ? '' : k.noCap, busy ? k.busy : '', className].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} disabled={off} onClick={onClick} aria-label={ariaLabel || undefined} aria-busy={busy || undefined} data-testid={testId || undefined} data-study-btn="1">
      {icon ? <span className={k.icon}><UIcon name={icon} size={20} gold={false} /></span> : null}
      <span className={k.label}><span>{children}</span>{sub ? <small>{sub}</small> : null}</span>
      {cap ? <span className={k.cap} aria-hidden="true"><UIcon name="chevronRight" size={22} gold={false} /></span> : null}
    </button>
  )
}
