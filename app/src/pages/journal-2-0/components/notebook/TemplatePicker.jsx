// Template picker grid — the Notebook's "what kind of note?" surface.
// Rendered inside a Sheet from the toolbar AND inline on the empty-notebook
// state. Families come from the catalog; "Blank note" is always first, and
// the last card points setup-documentation work at My Playbook (which owns
// that artifact — see the templates plan §3).
import { useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { FAMILIES, templatesByFamily } from '../../lib/notebookTemplates'
import MemberTemplates from './MemberTemplates'
import styles from './TemplatePicker.module.css'

// Wave 6: `onPickMember` adds "Your templates" (the member's own, saved from
// their notes) right after Blank — the templates a member made are the ones
// they reach for first. Absent, the picker is exactly the built-in catalog.
export default function TemplatePicker({ onPick, onPickMember, busy = false }) {
  const navigate = useNavigate()
  // A picker can be on screen twice (the empty notebook and the New-note sheet),
  // so the label ids are per instance.
  const uid = useId()
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.card} ${styles.blankCard}`}
        onClick={() => onPick(null)}
        disabled={busy}
      >
        <span className={styles.cardLabel}>Blank note</span>
        <span className={styles.cardDesc}>An empty page — structure it your way.</span>
      </button>

      {onPickMember && <MemberTemplates onPick={onPickMember} busy={busy} />}

      {FAMILIES.map((fam) => (
        <section key={fam.key} className={styles.family}>
          {/* Wave 8 (8A): each family's cards are a group named by its label. */}
          <div className={styles.famLabel} id={`${uid}-family-${fam.key}`}>{fam.label}</div>
          <div className={styles.grid} role="group" aria-labelledby={`${uid}-family-${fam.key}`}>
            {templatesByFamily(fam.key).map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                className={styles.card}
                onClick={() => onPick(tpl)}
                disabled={busy}
              >
                <span className={styles.cardWhen}>{tpl.when}</span>
                <span className={styles.cardLabel}>{tpl.label}</span>
                <span className={styles.cardDesc}>{tpl.description}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <button
        type="button"
        className={`${styles.card} ${styles.pointerCard}`}
        onClick={() => navigate('/model-book?view=builder')}
        disabled={busy}
      >
        <span className={styles.cardLabel}>Documenting a setup?</span>
        <span className={styles.cardDesc}>
          Build it in My Playbook — annotated charts, entry criteria, linked notes. →
        </span>
      </button>
    </div>
  )
}
