// S12 + VIS-4 (audit 2026-11-05, M9): ONE floating "+" on a phone's Notebook. It opens a Sheet of the quick doors --
// Quick note · Voice note · Ask AI · Help -- and REPLACES the five floating buttons that sat over the notes there
// (the Compass orb and its Learn, paperclip and agent-menu buttons, and the Help "?"). Those keep their places on
// every other page: this component writes `data-notebook-route` on <html> while it is mounted, and only the phone
// rules in FloatingOrb.module.css and FeedbackWidget.module.css read it (an orb in a live call is never hidden).
//
// ⛔ Each row runs a door that already exists (the list's own create and voice doors, the Compass page, Support);
// a door whose gate is off is absent, never a row that opens nothing. The button itself is phone-only (CSS).
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import styles from './NotebookPlusFab.module.css'

export const NOTEBOOK_ROUTE_ATTR = 'data-notebook-route'

export default function NotebookPlusFab({ onQuickNote, onVoiceNote = null, askAi = false, busy = false }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const buttonRef = useRef(null)

  useEffect(() => {
    const el = typeof document !== 'undefined' ? document.documentElement : null
    if (!el) return undefined
    el.setAttribute(NOTEBOOK_ROUTE_ATTR, '')
    return () => el.removeAttribute(NOTEBOOK_ROUTE_ATTR)
  }, [])

  const rows = [
    { key: 'note', label: 'Quick note', icon: 'edit', run: onQuickNote, disabled: busy },
    onVoiceNote && { key: 'voice', label: 'Voice note', icon: 'mic', run: onVoiceNote },
    askAi && { key: 'ask', label: 'Ask AI', icon: 'compass', run: () => navigate('/journal/compass') },
    { key: 'help', label: 'Help', icon: 'info', run: () => navigate('/support') },
  ].filter(Boolean)
  const choose = (run) => () => { setOpen(false); run?.() }

  return (
    <>
      <button ref={buttonRef} type="button" className={styles.fab} aria-label="Add to your notebook"
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} data-notebook-plus="">
        <UIcon name="plus" size={24} gold={false} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add" labelledByTitle variant="bottom-sheet"
        returnFocusTo={buttonRef}>
        <div className={styles.rows}>
          {rows.map((r) => (
            <button key={r.key} type="button" className={styles.row} onClick={choose(r.run)} disabled={r.disabled}>
              <UIcon name={r.icon} size={18} gold={false} /> {r.label}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  )
}
