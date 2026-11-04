// THE START SCREEN of every challenge mode (owner, batch 9: "too much space from the page to the START THE CLOCK
// button" · "for all of them the START BUTTON can be significantly better and cleaner"). The content and the
// primary button live in ONE centred card, so there is never a void between the text and the button; the fixed
// footer is not used on a start screen. One StartButton for every mode: a wide pill of brushed gold with a lit
// edge, a breathing glow, an icon, a caps label with a small subline, a shimmer, a pressed state; Enter starts it.
import { useEffect } from 'react'
import d5 from './duo.module.css'

const ICONS = {
  play: <path d="M8 5v14l11-7z" />,
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></>,
  crown: <path d="M3 18h18l-2-10-5 4-2-7-2 7-5-4z" />,
  medal: <><circle cx="12" cy="14" r="6" /><path d="M8 3l4 6 4-6" /></>,
  pen: <path d="M4 20l4-1 11-11-3-3L5 16z" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
}

export function StartButton({ icon = 'play', label, sub, onClick, tone = 'gold', hotkey = true, className = '' }) {
  useEffect(() => {
    if (!hotkey) return undefined
    const k = (e) => { if (e.key === 'Enter' && !e.repeat && !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) onClick?.() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClick, hotkey])
  return (
    <button type="button" className={`${d5.startBtn} ${tone === 'red' ? d5.startRed : tone === 'dark' ? d5.startDark : ''} ${className}`} onClick={onClick}>
      <span className={d5.startIcon}><svg viewBox="0 0 24 24" width="22" height="22" fill={icon === 'play' || icon === 'crown' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon] || ICONS.play}</svg></span>
      <span className={d5.startText}><b>{label}</b>{sub ? <small>{sub}</small> : null}</span>
      <span className={d5.startKey}>↵</span>
    </button>
  )
}

export default function StartCard({ eyebrow, title, lead, children, button, below, tone = '', art = null, className = '' }) {
  return (
    <div className={`${d5.startWrap} ${className}`}>
      <div className={`${d5.startCard} ${tone === 'red' ? d5.startCardRed : tone === 'dark' ? d5.startCardDark : ''}`}>
        {art ? <div className={d5.startArt}>{art}</div> : null}
        {eyebrow ? <div className={d5.eyebrowG}>{eyebrow}</div> : null}
        {title ? <div className={d5.heroWord}>{title}</div> : null}
        {lead ? <p className={d5.startLead}>{lead}</p> : null}
        {children}
        {button}
        {below ? <div className={d5.startBelow}>{below}</div> : null}
      </div>
    </div>
  )
}
