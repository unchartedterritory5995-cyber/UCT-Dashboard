/** Keyboard shortcut cheat sheet. Bound to `?`. */

import { useEffect, useId } from 'react'
import shellStyles from './ModalShell.module.css'
import styles from './ShortcutCheatSheet.module.css'

const GLOBAL_SHORTCUTS = [
  { keys: ['g', 'p'], label: 'Go to Open Positions' },
  { keys: ['g', 'j'], label: 'Go to Trade Journal' },
  { keys: ['g', 'c'], label: 'Go to Community' },
  { keys: ['?'], label: 'Show this cheat sheet' },
  { keys: ['Esc'], label: 'Close any open modal or panel' },
]

const POSITIONS_SHORTCUTS = [
  { keys: ['a'], label: 'Add Position' },
  { keys: ['c'], label: 'Open Columns picker' },
]

const JOURNAL_SHORTCUTS = [
  { keys: ['t'], label: 'Add Trade' },
  { keys: ['f'], label: 'Toggle Filters panel' },
  { keys: ['c'], label: 'Open Columns picker' },
  { keys: ['/'], label: 'Focus symbol filter' },
]

function Kbd({ keys }) {
  return (
    <span className={styles.kbdGroup}>
      {keys.map((k, i) => (
        <span key={i}>
          <kbd className={styles.kbd}>{k}</kbd>
          {i < keys.length - 1 && <span className={styles.then}>then</span>}
        </span>
      ))}
    </span>
  )
}

function Section({ title, shortcuts }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <ul className={styles.list}>
        {shortcuts.map((s, i) => (
          <li key={i} className={styles.row}>
            <span className={styles.label}>{s.label}</span>
            <Kbd keys={s.keys} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function ShortcutCheatSheet({ open, onClose }) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={shellStyles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div
        className={shellStyles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={shellStyles.header}>
          <h2 id={titleId} className={shellStyles.title}>Keyboard Shortcuts</h2>
          <button
            type="button"
            className={shellStyles.xBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className={shellStyles.body}>
          <Section title="Global" shortcuts={GLOBAL_SHORTCUTS} />
          <Section title="Open Positions tab" shortcuts={POSITIONS_SHORTCUTS} />
          <Section title="Trade Journal tab" shortcuts={JOURNAL_SHORTCUTS} />
          <p className={styles.footNote}>
            Shortcuts are disabled while typing in an input, textarea, or
            contenteditable element.
          </p>
        </div>
      </div>
    </div>
  )
}
