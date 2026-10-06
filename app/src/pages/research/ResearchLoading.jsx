// The research tabs' loading line. Inside a terminal panel it is the terminal's one
// skeleton (components/terminal PanelSkeleton), so a member sees the shell's chunk loader
// settle into content instead of a second, different "Loading …" line; on /research it
// stays the muted state line every research tab uses.
import { useInTerminalPanel, PanelSkeleton } from '../../components/terminal'
import styles from './ResearchPage.module.css'

export default function ResearchLoading({ label, shape = 'rows' }) {
  const inPanel = useInTerminalPanel()
  if (inPanel) return <PanelSkeleton label={label} shape={shape} />
  return <div className={styles.fnote}>{label}…</div>
}
