// UCT Terminal — a row inside an embedded panel that OPENS a related function (wave 3 #3):
// an EVTS filing opens CF, a room-attention day opens CN. The function twin of `PanelSymbol`
// (which loads a name): it runs the command through the shell's `open` wire, beside this panel.
// Outside a terminal panel (the research page) it renders its label as plain text, unchanged.
import { usePanelOpen } from './terminalPanel'
import styles from './PanelSymbol.module.css'

export default function PanelCommand({ cmd, label, className = '', children }) {
  const open = usePanelOpen()
  const text = String(cmd || '').trim()
  if (!open || !text) return <span className={className}>{children}</span>
  return (
    <button type="button" className={`${styles.link} ${className}`} onClick={() => open(text)}
      title={`${label} (${text})`} aria-label={`${label} (${text})`} data-testid={`panel-command-${text.replace(/\s+/g, '-')}`}>
      {children}
    </button>
  )
}
