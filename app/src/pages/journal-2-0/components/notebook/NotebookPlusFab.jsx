// S12 + VIS-4 (audit 2026-11-05, M9): ONE floating "+" on a phone's Notebook. It opens a Sheet of the quick doors
// (NotebookPlusSheet.jsx, fetched on its first open) and REPLACES the five floating buttons that sat over the notes
// there (the Compass orb and its Train Me, paperclip and agent-menu buttons, and the Help "?"). Those keep their places
// on every other page: this component writes `data-notebook-route` on <html> while it is mounted, and only the phone
// rules in FloatingOrb.module.css and FeedbackWidget.module.css read it (an orb in a live or failing call stays).
// The button itself is phone-only (CSS).
import { forwardRef, useEffect } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './NotebookPlusFab.module.css'

export const NOTEBOOK_ROUTE_ATTR = 'data-notebook-route'

const NotebookPlusFab = forwardRef(function NotebookPlusFab({ open = false, onOpen }, ref) {
  useEffect(() => {
    const el = typeof document !== 'undefined' ? document.documentElement : null
    if (!el) return undefined
    el.setAttribute(NOTEBOOK_ROUTE_ATTR, '')
    return () => el.removeAttribute(NOTEBOOK_ROUTE_ATTR)
  }, [])
  return (
    <button ref={ref} type="button" className={styles.fab} aria-label="Add to your notebook"
      aria-haspopup="dialog" aria-expanded={open} onClick={onOpen} data-notebook-plus="">
      <UIcon name="plus" size={24} gold={false} />
    </button>
  )
})
export default NotebookPlusFab
