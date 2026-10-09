// UCT Terminal — a security name inside an embedded panel that LOADS that name when clicked,
// exactly as typing its row number does (`$SYM` into the linked group). Wave 2 (audit
// 2026-10-08): STRS, REL and RISK printed symbols as plain text, so the only way to open one
// was to type its row number. Outside a terminal panel (or in a shell without the run wire)
// it renders the plain name, unchanged.
import { usePanelRun } from './terminalPanel'
import styles from './PanelSymbol.module.css'

export default function PanelSymbol({ sym, className = '', children = null }) {
  const run = usePanelRun()
  const name = String(sym || '').trim().toUpperCase()
  const label = children ?? name
  if (!run || !name) return <span className={className}>{label}</span>
  return (
    <button type="button" className={`${styles.link} ${className}`} onClick={() => run(`$${name}`)}
      title={`Load ${name} into the linked panels`} aria-label={`Load ${name}`} data-testid={`panel-symbol-${name}`}>
      {label}
    </button>
  )
}
