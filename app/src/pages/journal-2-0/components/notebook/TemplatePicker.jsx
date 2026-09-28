// Template picker grid — the Notebook's "what kind of note?" surface.
// Rendered inside a Sheet from the toolbar AND inline on the empty-notebook
// state. Families come from the catalog; "Blank note" is always first, and
// the last card points setup-documentation work at My Playbook (which owns
// that artifact — see the templates plan §3).
//
// Wave 10 lane D2 (design finding D-4): a BROWSABLE gallery, the way Notion's and
// Evernote's are. Every built-in card shows the template's name, its one-line
// description and a short preview of the note it makes -- its first lines, built
// from the template's own `build()` (`templatePreview`, lib/notebookTemplates.js),
// never a second, hand-typed list. Grouped by family, as the catalog declares.
// A card is named by the template's name and described by the rest, so a screen
// reader hears "Daily Game Plan, button" and then the detail, not a paragraph.
// Arrow keys move between cards (Home/End to the ends); Tab still walks every one.
// Picking a card hands `onPick` the catalog's own object, exactly as before.
import { useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { FAMILIES, templatesByFamily, templatePreview } from '../../lib/notebookTemplates'
import MemberTemplates from './MemberTemplates'
import styles from './TemplatePicker.module.css'

const CARD = '[data-template-card]'
const MOVES = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

/** Arrow / Home / End move focus between the gallery's cards (enabled ones only). */
function onGalleryKeyDown(e) {
  const from = e.target.closest?.(CARD)
  if (!from) return
  const cards = [...e.currentTarget.querySelectorAll(CARD)].filter((c) => !c.disabled)
  const at = cards.indexOf(from)
  if (at < 0) return
  let to = null
  if (e.key in MOVES) to = cards[Math.min(cards.length - 1, Math.max(0, at + MOVES[e.key]))]
  else if (e.key === 'Home') to = cards[0]
  else if (e.key === 'End') to = cards[cards.length - 1]
  if (!to) return
  e.preventDefault()
  to.focus()
}

// Wave 6: `onPickMember` adds "Your templates" (the member's own, saved from
// their notes) right after Blank — the templates a member made are the ones
// they reach for first. Absent, the picker is exactly the built-in catalog.
export default function TemplatePicker({ onPick, onPickMember, busy = false }) {
  const navigate = useNavigate()
  // A picker can be on screen twice (the empty notebook and the New-note sheet),
  // so the label ids are per instance.
  const uid = useId()
  return (
    // The keys are handled for the card buttons inside (see onGalleryKeyDown).
    <div className={styles.wrap} onKeyDown={onGalleryKeyDown} data-template-gallery="">
      <button
        type="button"
        className={`${styles.card} ${styles.blankCard}`}
        onClick={() => onPick(null)}
        disabled={busy}
        data-template-card=""
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
            {templatesByFamily(fam.key).map((tpl) => {
              const id = `${uid}-tpl-${tpl.key}`
              const lines = templatePreview(tpl)
              return (
                <button
                  key={tpl.key}
                  type="button"
                  className={styles.card}
                  onClick={() => onPick(tpl)}
                  disabled={busy}
                  data-template-card=""
                  data-template-key={tpl.key}
                  aria-label={tpl.label}
                  aria-describedby={`${id}-when ${id}-desc${lines.length ? ` ${id}-preview` : ''}`}
                >
                  <span className={styles.cardWhen} id={`${id}-when`}>{tpl.when}</span>
                  <span className={styles.cardLabel}>{tpl.label}</span>
                  <span className={styles.cardDesc} id={`${id}-desc`}>{tpl.description}</span>
                  {lines.length > 0 && (
                    <span className={styles.cardPreview} id={`${id}-preview`} data-template-preview="">
                      {lines.map((line, i) => (
                        <span
                          // a preview's lines are fixed for a given template: the index is its identity
                          key={i}
                          className={`${styles.previewLine} ${styles[`preview_${line.kind}`] || ''}`}
                        >
                          {line.kind === 'bullet' ? `• ${line.text}` : line.text}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      ))}

      <button
        type="button"
        className={`${styles.card} ${styles.pointerCard}`}
        onClick={() => navigate('/model-book?view=builder')}
        disabled={busy}
        data-template-card=""
      >
        <span className={styles.cardLabel}>Documenting a setup?</span>
        <span className={styles.cardDesc}>
          Build it in My Playbook — annotated charts, entry criteria, linked notes. →
        </span>
      </button>
    </div>
  )
}
