import { useContext } from 'react'
import { AuthContext } from '../../context/AuthContext'
import { approvedChecklist, HOW_TO_CHECKLISTS } from './howToChecklists'
import styles from './HowToChecklist.module.css'

// FT-046: the numbered "how to trade with this" checklist for one surface.
//
// Renders NOTHING unless BOTH hold:
//   * HOW_TO_CHECKLISTS_ENABLED is on (auth key how_to_checklists_enabled, read `=== true`);
//   * the surface's registry entry is APPROVED by the owner (approvedChecklist).
// A draft entry is invisible even with the flag on, so arming the flag cannot put
// unapproved copy in front of a member.
//
// `useContext(AuthContext)` rather than `useAuth()` so a host rendered outside an
// AuthProvider (isolated tests, embedded widgets) reads as OFF instead of throwing.
export default function HowToChecklist({ surface, registry = HOW_TO_CHECKLISTS }) {
  const on = useContext(AuthContext)?.howToChecklistsEnabled === true
  if (!on) return null
  const entry = approvedChecklist(surface, registry)
  if (!entry) return null
  return (
    <details className={styles.howTo} data-testid="how-to-checklist" data-surface={surface}>
      <summary className={styles.summary}>{entry.title}</summary>
      <ol className={styles.steps}>
        {entry.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    </details>
  )
}
