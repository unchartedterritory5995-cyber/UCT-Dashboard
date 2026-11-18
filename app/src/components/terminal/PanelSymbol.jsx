// UCT Terminal — a security name inside an embedded panel that LOADS that name when clicked,
// exactly as typing its row number does (`$SYM` into the linked group). Wave 2 (audit
// 2026-10-08): STRS, REL and RISK printed symbols as plain text, so the only way to open one
// was to type its row number. Outside a terminal panel (or in a shell without the run wire)
// it renders the plain name, unchanged.
//
// Linked panels (2026-10-09): this is the ONE publisher a list's ticker goes through. The shell
// sends the name to the group of the panel it was clicked in, and every panel on that group
// follows; the list itself keeps its function. The name the group shows now is marked current.
//
// Watchlist marks (owner request 2026-11-17): a name on the member's watchlists or Flagged list
// carries the kit's ONE mark (`WatchMark`), drawn here, so every list that shows its names
// through this cell gets it with no code of its own. The words ride in the button's accessible
// name and title, so the mark never depends on sight or colour. A name that is not marked
// renders exactly as it did before.
import { usePanelLinkedSym, usePanelRun } from './terminalPanel'
import { useWatchMark, watchMarkWords } from './watchMarks'
import { WatchMarkGlyph } from './WatchMark'
import styles from './PanelSymbol.module.css'

export default function PanelSymbol({ sym, className = '', children = null }) {
  const run = usePanelRun()
  const linked = usePanelLinkedSym()
  const name = String(sym || '').trim().toUpperCase()
  const mark = useWatchMark(name)
  const label = children ?? name
  if (!run || !name) {
    return <span className={className}>{label}{mark && name ? <WatchMarkGlyph mark={mark} /> : null}</span>
  }
  const current = !!linked && linked === name
  const words = watchMarkWords(mark)
  const classes = `${styles.link} ${current ? styles.current : ''} ${className}`
  return (
    <button type="button" className={words ? `${classes} ${styles.marked}` : classes} onClick={() => run(`$${name}`)}
      aria-current={current ? 'true' : undefined}
      title={`Load ${name} into the linked panels${words ? `. ${words.title}.` : ''}`}
      aria-label={`Load ${name}${words ? `, ${words.short}` : ''}`} data-testid={`panel-symbol-${name}`}>
      {label}
      {words ? <WatchMarkGlyph mark={mark} decorative className={styles.cellMark} /> : null}
    </button>
  )
}
