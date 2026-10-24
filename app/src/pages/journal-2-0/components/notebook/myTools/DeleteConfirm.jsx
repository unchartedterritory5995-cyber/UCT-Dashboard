import { useEffect, useId, useRef, useState } from 'react'
import { postJson } from '../../../lib/builtWidgets'
import PanelHead from './PanelHead'
import { RECENTLY_DELETED_DAYS, actionFailure, notesWord } from './myToolsLib'
import styles from './myTools.module.css'

/**
 * "Delete permanently" (spec 5.8): offered only from Archived, and it needs the widget's name typed exactly. The
 * server checks both again (`soft_delete`: "Archive this widget before deleting it." / "Type the widget's name
 * exactly to delete it."), and its sentence is the one shown. A deleted widget stays in Recently deleted for
 * RECENTLY_DELETED_DAYS days; its notes keep their snapshots.
 *
 * Accessible: the field is labelled by what to type and described by what deleting does; the Delete button says why
 * it is off; a refusal is an alert; Enter in the field deletes once the name matches.
 */
export default function DeleteConfirm({ d, onBack, onDeleted }) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  useEffect(() => { input.current?.focus() }, [])
  const name = String(d.name || '')
  const matches = typed === name && name !== ''
  const used = Number.isInteger(d.usedIn) ? d.usedIn : 0

  const submit = async (e) => {
    e.preventDefault()
    if (!matches || busy) return
    setBusy(true)
    setError('')
    const got = await postJson(`/${encodeURIComponent(String(d.id))}/delete`, { typedName: typed })
    setBusy(false)
    if (got.ok) onDeleted(got.data, `“${name}” moved to Recently deleted. It's kept for ${RECENTLY_DELETED_DAYS} days.`)
    else setError(actionFailure(got))
  }

  return (
    <div className={styles.panel} data-testid="my-tools-delete">
      <PanelHead title={`Delete “${name}” permanently?`} onBack={onBack} focusHeading={false} />
      <form className={styles.form} onSubmit={submit} aria-describedby={`${id}-what`}>
        <p className={styles.sentence} id={`${id}-what`}>
          {`It moves to Recently deleted for ${RECENTLY_DELETED_DAYS} days, then it is gone for good.`}
          {used > 0 ? ` Your ${notesWord(used)} keep${used === 1 ? 's' : ''} the widget as a snapshot.` : ''}
        </p>
        <label className={styles.fieldLabel} htmlFor={id}>
          {'Type '}<strong className={styles.typeName}>{name}</strong>{' to confirm'}
        </label>
        <input ref={input} id={id} className={styles.input} value={typed} autoComplete="off" spellCheck={false}
          aria-describedby={`${id}-gate`} aria-invalid={error ? true : undefined}
          onChange={(e) => { setTyped(e.target.value); setError('') }} data-testid="delete-typed-name" />
        <p className={styles.hint} id={`${id}-gate`}>
          {matches ? 'The name matches.' : 'Delete turns on when the name matches exactly.'}
        </p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onBack}>Cancel</button>
          <button type="submit" className={styles.btnDanger} disabled={!matches || busy} aria-busy={busy || undefined}
            aria-describedby={`${id}-gate`}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
        </div>
      </form>
    </div>
  )
}
