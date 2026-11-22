// THE START SCREEN of every challenge mode (owner, batch 9: "too much space from the page to the START THE CLOCK
// button" · "for all of them the START BUTTON can be significantly better and cleaner"). The content and the
// primary button live in ONE centred card, so there is never a void between the text and the button; the fixed
// footer is not used on a start screen. One StartButton for every mode: a wide pill of brushed gold with a lit
// edge, a breathing glow, an icon, a caps label with a small subline, a shimmer, a pressed state; Enter starts it.
import StudyButton from '../pages/study/ui/StudyButton'
import d5 from './duo.module.css'


// Kit v2 (2026-11-08): the lesson player, the reveal, the end card and the Blitz, Boss and Kicker challenges all press
// this, so it is the product's one button (pages/study/ui/StudyButton, the owner's rule 17 in
// docs/study/OWNER_PRINCIPLES.md). Same props as before; the tone picks the kind.
export function StartButton({ icon = 'play', label, sub, onClick, tone = 'gold', hotkey = true, className = '', ariaLabel = null, disabled = false, testId = null }) {
  void icon
  const kind = tone === 'red' ? 'bad' : tone === 'dark' ? 'secondary' : 'primary'
  return (
    <StudyButton kind={kind} size="xl" arrow sub={sub || null} hotkey={hotkey ? 'Enter' : null} disabled={disabled} onClick={onClick} className={className} ariaLabel={ariaLabel} testId={testId}>
      {label}
    </StudyButton>
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
