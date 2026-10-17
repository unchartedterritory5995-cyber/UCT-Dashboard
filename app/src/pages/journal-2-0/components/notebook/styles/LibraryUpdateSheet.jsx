// P3a Task 10: review an author's update to a style the member adopted from the community library, then
// "Update my copy" or "Not now" (R-P3-8: an explicit, previewed merge that never removes the member's edits).
// StylesManager opens it from its Updates list and from the bell notice's link (?libraryUpdate=<styleId>).
// ⛔ Named LibraryUpdateSheet, not the plan's StyleUpdateSheet: that name is the P1 "Update layout" sheet for one
//    NOTE (StyleUpdateSheet.jsx, pinned by NoteEditorPage.styleChunks.test.js). This one updates a STYLE.
// ⛔ Lazy-only: StylesManager's own chunk imports this, nothing eager does (R-P3-5).
// ⛔ The outline is replaced ONLY when the member ticks "Use the author's new outline", and it starts unticked.
// ⛔ What is sent is what was PREVIEWED (fix round 1, M-1 / M-8): the copy's `updatedAt` is captured WHEN THE PLAN
//    IS READ (never re-read live from the list, which revalidates on focus), and the plan's `toVersion` rides with
//    it. A copy changed in another tab since then, or a newer listed version, is a 409 that writes nothing, and
//    "Look again" re-reads the copy and the plan together and captures both afresh.
import { useEffect, useId, useRef, useState } from 'react'
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
// M-6: the plan route answers 404 when there is nothing newer to offer (or the style is no adopted copy).
export const UP_TO_DATE_SENTENCE = 'Your copy is already up to date. There is nothing new to add.'
export const NO_COPY_SENTENCE = "Your copy of this style is no longer in your styles, so it can't be updated."
export const COPY_UNREADABLE_SENTENCE = "Couldn't read your copy of this style, so it can't be updated right now."
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
  const { data, error: listError, mutate } = useJournalStyles()
  const copy = data?.styles?.find((s) => s.id === styleId) || null
  const copyRef = useRef(copy)                                 // the latest copy, read only when a plan lands
  useEffect(() => { copyRef.current = copy }, [copy])
  const offline = data?.fromCache === true
  const [state, setState] = useState({ phase: 'loading' })     // loading | plan | none | error
  const [base, setBase] = useState(null)                       // the copy's updatedAt, captured with the plan
  const [round, setRound] = useState(0)                        // "Look again" bumps this
  const [takeOutline, setTakeOutline] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [stale, setStale] = useState(false)

  useEffect(() => {
    let live = true
    setState({ phase: 'loading' })
    getUpdatePlan(styleId).then(
      (plan) => {
        if (!live) return
        setState({ phase: 'plan', plan })
        setBase(copyRef.current?.updatedAt ?? null)
      },
      (e) => {
        if (!live) return
        setState(e?.status === 404 ? { phase: 'none' } : { phase: 'error', message: libraryError(e, PLAN_FAILED) })
      },
    )
    return () => { live = false }
  }, [styleId, round])

  // The plan landed before the copy's list did (a cold cache): capture the base once, when the copy appears.
  useEffect(() => {
    if (state.phase === 'plan' && base == null && copy) setBase(copy.updatedAt)
  }, [state.phase, base, copy])

  // A 409 means the copy or the listed version moved: re-read the copy (the new base) and the plan together, and
  // start the choice over.
  const lookAgain = async () => {
    setNotice(null); setStale(false); setTakeOutline(false); setBase(null)
    const fresh = await mutate()
    const again = fresh?.styles?.find((s) => s.id === styleId)
    if (again) copyRef.current = again
    setRound((r) => r + 1)
  }

  const update = async () => {
    const plan = state.plan
    if (busy || !copy || !base || !plan) return
    setBusy(true)
    setNotice(null)
    try {
      // An outline the author did not change is never taken, whatever the (hidden) box holds.
      const take = Boolean(plan.outlineChanged) && takeOutline
      const style = await applyStyleUpdate(styleId, { takeOutline: take, baseUpdatedAt: base, toVersion: plan.toVersion })
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
  // M-6: Update is unavailable without the copy; say why rather than leave a dead button.
  const copyProblem = plan && !copy ? (data ? NO_COPY_SENTENCE : listError ? COPY_UNREADABLE_SENTENCE : null) : null
  return (
    <Sheet open onClose={onClose} title={`Update ${name}`} labelledByTitle variant="auto" maxWidth={640}
      footer={(
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose}>{state.phase === 'none' ? 'Close' : 'Not now'}</button>
          {stale && <button type="button" className={styles.btn} onClick={lookAgain}>Look again</button>}
          {plan && !stale && (
            <button type="button" className={styles.btn} onClick={update} disabled={busy || !copy || !base || offline}>
              {busy ? 'Updating…' : 'Update my copy'}
            </button>
          )}
        </div>
      )}>
      <div className={styles.editor}>
        {state.phase === 'loading' && <p className={styles.hint} role="status">Checking what the author changed…</p>}
        {state.phase === 'none' && <p className={styles.hint} role="status">{UP_TO_DATE_SENTENCE}</p>}
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
            {copyProblem && <p className={styles.error} role="alert">{copyProblem}</p>}
            {offline && <p className={styles.notice}>You are offline. Updating a style needs a connection.</p>}
          </>
        )}
        {notice && <p className={styles.error} role="alert">{notice}</p>}
      </div>
    </Sheet>
  )
}
