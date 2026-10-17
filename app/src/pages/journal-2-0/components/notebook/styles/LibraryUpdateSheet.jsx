// P3a Task 10: review an author's update to a style the member adopted from the community library, then
// "Update my copy" or "Not now" (R-P3-8: an explicit, previewed merge that never removes the member's edits).
// StylesManager opens it from its Updates list and from the bell notice's link (?libraryUpdate=<styleId>).
// ⛔ Named LibraryUpdateSheet, not the plan's StyleUpdateSheet: that name is the P1 "Update layout" sheet for one
//    NOTE (StyleUpdateSheet.jsx, pinned by NoteEditorPage.styleChunks.test.js). This one updates a STYLE.
// ⛔ Lazy-only: StylesManager's own chunk imports this, nothing eager does (R-P3-5).
// ⛔ The outline is replaced ONLY when the member ticks "Use the author's new outline", and it starts unticked.
// ⛔ The base revision is the copy's own `updatedAt` from the journal styles list, so a copy changed in another tab
//    since this sheet read it is a 409 that writes nothing, and "Look again" re-reads the copy and the plan.
import { useEffect, useId, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import { blockLabel } from '../../../lib/journalBlocks'
import { applyStyleUpdate, getUpdatePlan } from '../../../lib/styleLibrary'
import useJournalStyles from '../../../hooks/useJournalStyles'
import { DocBody } from '../TemplatePreview'
import { libraryError } from './styleErrors'
import styles from './StylesManager.module.css'

export const TAKE_OUTLINE_LABEL = "Use the author's new outline"
export const OUTLINE_STAYS = 'Your outline stays unless you tick this.'
export const NOTHING_REMOVED = 'Nothing you changed is removed.'
// ⛔ A 409's detail is the SERVER's fixed sentence and is shown as written; this is only the fallback for a 409
// with no body, pinned to the recorded answer (`template-gallery.updates.apply.stale`) by StyleLibraryDoors.test.jsx.
export const STALE_SENTENCE = 'This style changed since you opened the update. Nothing was changed. Look again.'
const PLAN_FAILED = "Couldn't check what this update would change. Nothing was changed."
const APPLY_FAILED = "Couldn't update your copy. Nothing was changed."

/** "Adds blocks: Your rules, Chart" (or "none"), in the block catalog's own words. */
export const addsBlocksLine = (ids) => `Adds blocks: ${(ids || []).map(blockLabel).join(', ') || 'none'}`

/**
 * @param styleId   the member's adopted copy (a j2_journal_styles id)
 * @param onClose   "Not now", Escape, or the Sheet's own close
 * @param onApplied `(style) => void` with the updated copy, after the server wrote it
 */
export default function LibraryUpdateSheet({ styleId, onClose, onApplied }) {
  const uid = useId()
  const { data, mutate } = useJournalStyles()
  const copy = data?.styles?.find((s) => s.id === styleId) || null
  const offline = data?.fromCache === true
  const [state, setState] = useState({ phase: 'loading' })     // loading | plan | error
  const [round, setRound] = useState(0)                        // "Look again" bumps this
  const [takeOutline, setTakeOutline] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [stale, setStale] = useState(false)

  useEffect(() => {
    let live = true
    setState({ phase: 'loading' })
    getUpdatePlan(styleId).then(
      (plan) => { if (live) setState({ phase: 'plan', plan }) },
      (e) => { if (live) setState({ phase: 'error', message: libraryError(e, PLAN_FAILED) }) },
    )
    return () => { live = false }
  }, [styleId, round])

  // A 409 means the copy moved: re-read it (the new base) and the plan, and start the choice over.
  const lookAgain = async () => {
    setNotice(null); setStale(false); setTakeOutline(false)
    await mutate()
    setRound((r) => r + 1)
  }

  const update = async () => {
    if (busy || !copy) return
    setBusy(true)
    setNotice(null)
    try {
      // An outline the author did not change is never taken, whatever the (hidden) box holds.
      const take = Boolean(state.plan?.outlineChanged) && takeOutline
      const style = await applyStyleUpdate(styleId, { takeOutline: take, baseUpdatedAt: copy.updatedAt })
      onApplied?.(style)
    } catch (e) {
      if (e?.status === 409) setStale(true)
      setNotice(libraryError(e, e?.status === 409 ? STALE_SENTENCE : APPLY_FAILED))
    } finally {
      setBusy(false)
    }
  }

  const plan = state.phase === 'plan' ? state.plan : null
  const name = copy?.name || 'your copy'
  return (
    <Sheet open onClose={onClose} title={`Update ${name}`} labelledByTitle variant="auto" maxWidth={640}
      footer={(
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose}>Not now</button>
          {stale && <button type="button" className={styles.btn} onClick={lookAgain}>Look again</button>}
          {plan && !stale && (
            <button type="button" className={styles.btn} onClick={update} disabled={busy || !copy || offline}>
              {busy ? 'Updating…' : 'Update my copy'}
            </button>
          )}
        </div>
      )}>
      <div className={styles.editor}>
        {state.phase === 'loading' && <p className={styles.hint} role="status">Checking what the author changed…</p>}
        {state.phase === 'error' && <p className={styles.error} role="alert">{state.message}</p>}
        {plan && (
          <>
            <p className={styles.hint}>{`The author's version ${plan.toVersion}. Your copy is from version ${plan.fromVersion}.`}</p>
            <p>{addsBlocksLine(plan.addBlocks)}</p>
            <p>{`Adds property defaults: ${(plan.addProperties || []).length}`}</p>
            {plan.outlineChanged && (
              <section className={styles.fieldset} aria-labelledby={`${uid}-outline`}>
                <label className={styles.radio} id={`${uid}-outline`}>
                  <input type="checkbox" checked={takeOutline} onChange={(e) => setTakeOutline(e.target.checked)} />
                  {TAKE_OUTLINE_LABEL}
                </label>
                <p className={styles.hint}>{OUTLINE_STAYS}</p>
                <div className={styles.preview} aria-label="The author's new outline" role="region">
                  <DocBody body={plan.newOutline} />
                </div>
              </section>
            )}
            <p className={styles.hint}>{NOTHING_REMOVED}</p>
            {offline && <p className={styles.notice}>You are offline. Updating a style needs a connection.</p>}
          </>
        )}
        {notice && <p className={styles.error} role="alert">{notice}</p>}
      </div>
    </Sheet>
  )
}
