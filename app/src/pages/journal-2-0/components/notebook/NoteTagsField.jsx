/**
 * Wave 6 item 9 — the note's own tags, in the editor header: each tag a chip
 * with its own remove button, and one field that ADDS a tag, suggesting the
 * member's existing tags hierarchy-first (wave 5C's TagSuggestInput).
 *
 * It reports DELTAS — `onAdd(tag)` / `onRemove(tag)` — never a list: the page
 * applies each one to the list the server holds at that moment (lib/tagDelta.js
 * says why a whole list must never be resent).
 *
 * A suggestion fills the field; Enter adds what is in it (TagSuggestInput takes
 * a highlighted suggestion on the first Enter, adds on the next).
 */
import { useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import TagSuggestInput from './TagSuggestInput'
import { normalizeTagPath } from '../../lib/tagTree'
import styles from './NoteTagsField.module.css'

export default function NoteTagsField({ tags = [], nodes = [], onAdd, onRemove, busy = false }) {
  const [draft, setDraft] = useState('')

  const submit = (e) => {
    e.preventDefault()
    const tag = normalizeTagPath(String(draft).replace(/^#+/, ''))
    if (!tag || busy) return
    setDraft('')
    onAdd?.(tag)
  }

  return (
    <div className={styles.field} role="group" aria-label="Tags">
      {tags.length > 0 && (
        <ul className={styles.chips} aria-label="This note's tags">
          {tags.map((t) => (
            <li key={t} className={styles.chip}>
              <span className={styles.chipText}>{t}</span>
              <button
                type="button"
                className={styles.remove}
                onClick={() => onRemove?.(t)}
                disabled={busy}
                aria-label={`Remove tag ${t}`}
                title={`Remove tag ${t}`}
              >
                <UIcon name="x" size={10} gold={false} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className={styles.add} onSubmit={submit}>
        <TagSuggestInput
          value={draft}
          onChange={setDraft}
          nodes={nodes}
          disabled={busy}
          ariaLabel="Add a tag to this note"
          placeholder="Add a tag"
        />
      </form>
    </div>
  )
}
