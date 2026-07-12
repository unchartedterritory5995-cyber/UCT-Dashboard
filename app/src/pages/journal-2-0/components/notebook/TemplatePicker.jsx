// Template picker grid — the Notebook's "what kind of note?" surface.
// Rendered inside a Sheet from the toolbar AND inline on the empty-notebook
// state. Families come from the catalog; "Blank note" is always first, and
// the last card points setup-documentation work at My Playbook (which owns
// that artifact — see the templates plan §3).
import { useNavigate } from 'react-router-dom'
import { FAMILIES, templatesByFamily } from '../../lib/notebookTemplates'
import styles from './TemplatePicker.module.css'

export default function TemplatePicker({ onPick, busy = false }) {
  const navigate = useNavigate()
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

      {FAMILIES.map((fam) => (
        <section key={fam.key} className={styles.family}>
          <div className={styles.famLabel}>{fam.label}</div>
          <div className={styles.grid}>
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
