/** Keyboard shortcut cheat sheet. Bound to `?`. */

import { useEffect, useId } from 'react'
import { altKeyLabel, modKeyLabel, replaceChordKeys } from '../lib/platform'
import shellStyles from './ModalShell.module.css'
import styles from './ShortcutCheatSheet.module.css'

// The `g>` SEQUENCES (press g, then the letter) navigate between the 5-surface
// shell (Task A4). Each aliases the old 8-tab shortcut to the new nested route,
// so the label names the destination surface, not the retired tab.
// ⛔ `sequence: true` is what makes a row read "g then o". Every other row is a
// CHORD -- keys pressed together, "Ctrl + Alt + J" -- (review N9: the renderer
// put "then" between every key, so Mod+Shift+H read as three presses).
const NAVIGATION_SHORTCUTS = [
  { keys: ['Ctrl', 'Alt', 'J'], label: 'Capture the hovered chart to your Notebook inbox' },
  { keys: ['g', 'o'], sequence: true, label: 'Go to Today' },
  { keys: ['g', 'p'], sequence: true, label: 'Go to Open Positions' },
  { keys: ['g', 'j'], sequence: true, label: 'Go to Closed Trades' },
  { keys: ['g', 'a'], sequence: true, label: 'Go to Calendar' },
  { keys: ['g', 'n'], sequence: true, label: 'Go to Notebook' },
  { keys: ['g', 'y'], sequence: true, label: 'Go to Insights' },
  { keys: ['g', 't'], sequence: true, label: 'Go to Accounts' },
  { keys: ['g', 'k'], sequence: true, label: 'Go to Compass' },
  { keys: ['g', 'c'], sequence: true, label: 'Go to Community' },
]

const GENERAL_SHORTCUTS = [
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

// Wave B (High-Frequency Notebook UX). Deliberately small (§35 — "do not
// create dozens of shortcuts at once") and, unlike the bare-letter shortcuts
// above, these ARE active while typing inside the note editor's
// contenteditable body — Ctrl/Cmd never collides with normal typing the way
// a bare letter would, so they're exempt from this sheet's own footnote.
// ⛔ Built at RENDER, from lib/platform.js: a Mac member reads Cmd and Option
// (and Cmd+Option+F for replace -- Ctrl+H deletes a character there), never
// a chord for somebody else's keyboard (wave-5 review N8).
function notebookShortcuts() {
  const mod = modKeyLabel()
  const alt = altKeyLabel()
  return [
    { keys: [mod, 'K'], label: 'Open command palette (works from anywhere, incl. Notebook)' },
    // The quick switcher lives in that same palette — no second box, no second
    // shortcut. Stated here because "type a title" is not discoverable from a
    // search field whose history is tickers.
    { keys: [mod, 'K'], label: 'Jump to any note: type part of its title, then Enter' },
    { keys: [mod, 'F'], label: 'Find in the current note' },
    // Wave 5 editor chords.
    { keys: replaceChordKeys(), label: 'Find and replace in the current note' },
    { keys: [mod, 'Shift', 'H'], label: 'Highlight the selection' },
    { keys: [mod, alt, '1–6'], label: 'Make the line a heading of that level (1–6)' },
    { keys: [mod, alt, 'L'], label: 'Choose a code block\'s language (inside a code block)' },
    { keys: ['Esc'], label: 'Close find, or the command palette' },
    // Wave 5 bulk operations (list and table views).
    { keys: ['Shift', 'Click'], label: 'Select every note between the last one checked and this one' },
    { keys: ['Esc'], label: 'Clear the selected notes' },
  ]
}

function Kbd({ keys, sequence = false }) {
  return (
    <span className={styles.kbdGroup}>
      {keys.map((k, i) => (
        <span key={i}>
          <kbd className={styles.kbd}>{k}</kbd>
          {i < keys.length - 1 && (sequence
            ? <>{' '}<span className={styles.then}>then</span>{' '}</>
            : <>{' '}<span className={styles.plus}>+</span>{' '}</>)}
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
            <Kbd keys={s.keys} sequence={s.sequence} />
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
          <Section title="Navigation" shortcuts={NAVIGATION_SHORTCUTS} />
          <Section title="General" shortcuts={GENERAL_SHORTCUTS} />
          <Section title="Open Positions" shortcuts={POSITIONS_SHORTCUTS} />
          <Section title="Trade Journal" shortcuts={JOURNAL_SHORTCUTS} />
          <Section title="Notebook" shortcuts={notebookShortcuts()} />
          <p className={styles.footNote}>
            Shortcuts are disabled while typing in an input, textarea, or
            contenteditable element.
          </p>
        </div>
      </div>
    </div>
  )
}
