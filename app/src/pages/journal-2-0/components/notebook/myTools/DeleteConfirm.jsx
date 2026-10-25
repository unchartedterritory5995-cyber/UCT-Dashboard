import { useEffect, useId, useRef, useState } from 'react'
import PanelHead from './PanelHead'
import { RECENTLY_DELETED_DAYS, actionFailure, notesWord, request } from './myToolsLib'
import styles from './myTools.module.css'

/**
 * "Delete permanently" (spec 5.8): offered only from Archived, and it needs the widget's name typed exactly. The
 * server checks both again (`soft_delete`: "Archive this widget before deleting it." / "Type the widget's name
 * exactly to delete it."), and its sentence is the one shown. A deleted widget stays in Recently deleted for
 * RECENTLY_DELETED_DAYS days; its notes keep their snapshots.
 *
 * Accessible: the field is labelled by what to type; the field AND the Delete button are described by what deleting
 * does and by why the button is off; a refusal is an alert; Enter in the field deletes once the name matches.
 */
export default function DeleteConfirm({ d, onBack, onDeleted, onGone }) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  useEffect(() => { input.current?.focus() }, [])
  const name = String(d.name || '')
  const matches = typed === name && name !== ''
  const used = Number.isInteger(d.usedIn) ? d.usedIn : 0
  const described = `${id}-what ${id}-gate${error ? ` ${id}-err` : ''}`

  const submit = async (e) => {
    e.preventDefault()
    if (!matches || busy) return
    setBusy(true)
    setError('')
    const got = await request('POST', `/${encodeURIComponent(String(d.id))}/delete`, { body: { typedName: typed } })
    setBusy(false)
    if (got.ok) onDeleted(got.data, `“${name}” moved to Recently deleted. It's kept for ${RECENTLY_DELETED_DAYS} days.`)
    else if (got.code === 'unavailable') onGone?.(actionFailure(got))
    else setError(actionFailure(got))
  }

  return (
    <div className={styles.pushPanel} data-testid="my-tools-delete">
      <PanelHead title={`Delete “${name}” permanently?`} onBack={onBack} focusHeading={false} />
      <form className={styles.form} onSubmit={submit}>
        <p className={styles.sentence} id={`${id}-what`}>
          {`It moves to Recently deleted for ${RECENTLY_DELETED_DAYS} days, then it is gone for good.`}
          {used > 0 ? ` Your ${notesWord(used)} keep${used === 1 ? 's' : ''} the widget as a snapshot.` : ''}
        </p>
        <label className={styles.fieldLabel} htmlFor={id}>
          {'Type '}<strong className={styles.typeName}>{name}</strong>{' to confirm'}
        </label>
        <input ref={input} id={id} className={styles.input} value={typed} autoComplete="off" spellCheck={false}
          aria-describedby={described} aria-invalid={error ? true : undefined}
          onChange={(e) => { setTyped(e.target.value); setError('') }} data-testid="delete-typed-name" />
        <p className={styles.hint} id={`${id}-gate`}>
          {matches ? 'The name matches.' : 'Delete turns on when the name matches exactly.'}
        </p>
        {error && <p className={styles.error} role="alert" id={`${id}-err`}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onBack}>Cancel</button>
          <button type="submit" className={styles.btnDanger} aria-disabled={!matches || busy || undefined} aria-busy={busy || undefined}
            aria-describedby={described}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
        </div>
      </form>
    </div>
  )
}
