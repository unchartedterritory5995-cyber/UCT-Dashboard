// UCT Terminal — a security name inside an embedded panel that LOADS that name when clicked,
// exactly as typing its row number does (`$SYM` into the linked group). Wave 2 (audit
// 2026-10-08): STRS, REL and RISK printed symbols as plain text, so the only way to open one
// was to type its row number. Outside a terminal panel (or in a shell without the run wire)
// it renders the plain name, unchanged.
//
// Linked panels (2026-10-09): this is the ONE publisher a list's ticker goes through. The shell
// sends the name to the group of the panel it was clicked in, and every panel on that group
// follows; the list itself keeps its function. The name the group shows now is marked current.
import { usePanelLinkedSym, usePanelRun } from './terminalPanel'
import styles from './PanelSymbol.module.css'

export default function PanelSymbol({ sym, className = '', children = null }) {
  const run = usePanelRun()
  const linked = usePanelLinkedSym()
  const name = String(sym || '').trim().toUpperCase()
  const label = children ?? name
  if (!run || !name) return <span className={className}>{label}</span>
  const current = !!linked && linked === name
  return (
    <button type="button" className={`${styles.link} ${current ? styles.current : ''} ${className}`} onClick={() => run(`$${name}`)}
      aria-current={current ? 'true' : undefined}
      title={`Load ${name} into the linked panels`} aria-label={`Load ${name}`} data-testid={`panel-symbol-${name}`}>
      {label}
    </button>
  )
}
