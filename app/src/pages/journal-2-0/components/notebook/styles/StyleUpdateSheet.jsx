// Notebook P1 (spec P1.3): "Update layout" and "Switch to a style" -- a PREVIEWED, explicit action. Editing a
// style never rewrites existing notes; this adds the style's missing blocks to ONE note, after the first
// heading, and never removes or moves the member's text. Lazy chunk (NoteEditorPage lazyChunk).
//
// ⛔ Review Focus 4: Apply never races the editor's own typing.
//   1. it AWAITS `waitForSave` (the editor's sendPendingEdits) first, so the server holds every word;
//   2. it reads the base revision AFTER that wait (`baseUpdatedAt` may be a getter): the save moved it;
//   3. it sends that base (lane B's applyStyleUpdate refuses without one), so a second writer's save in
//      between is a 409 that writes nothing.
// The write lands through lane B's applyStyleUpdate (it settles the revision); the editor adopts the note
// it returns (`onApplied`). Nothing here calls fetch.
import { useCallback, useEffect, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import { blockLabel } from '../../../lib/journalBlocks'
import { applyStyleUpdate, planStyleUpdate } from '../../../lib/journalStyles'
import useJournalStyles from '../../../hooks/useJournalStyles'
import styles from './StyleUpdateSheet.module.css'

export const STALE_SENTENCE = 'This note changed since you opened it. Nothing was added.'
export const LOCKED_SENTENCE = 'This note is locked. Unlock it to change its layout.'
export const STILL_SAVING_SENTENCE = 'Some words are still saving. Try again in a moment.'
const GONE_SENTENCE = "That style isn't available any more. Nothing was added."
const FAILED_SENTENCE = "Couldn't update this note. Nothing was added."
const SKIP_WORDS = {
  'needs-ticker': 'this note has no ticker yet',
  'unknown-block': 'this version of the app does not know that block',
  'cannot-build': 'it could not be built here',
}
const skipWords = (reason) => SKIP_WORDS[reason] || 'it could not be added'

const sentenceFor = (e) => {
  if (e?.status === 409) return STALE_SENTENCE
  if (e?.status === 423) return LOCKED_SENTENCE
  if (e?.status === 404) return GONE_SENTENCE
  return e?.status ? (e.message || FAILED_SENTENCE) : FAILED_SENTENCE
}

/**
 * @param styleId  null = update to the note's own style's latest; a value = switch to that style (/style).
 * @param baseUpdatedAt  the revision the member is looking at: a string, or a getter called AFTER the save.
 * @param waitForSave  `() => Promise<boolean>`: the editor's sendPendingEdits (true = nothing left unsent).
 * @param refreshBase  `() => Promise<boolean>`: the editor's clean re-read of the note, so a 409 can move the base.
 *   false = the editor holds unsent words and refused (nothing is adopted over them).
 * @param onApplied  `(note, plan) => boolean`: the editor adopts the returned note; false = it could not (unsent words).
 */
export default function StyleUpdateSheet({ open, onClose, noteId, styleId = null, baseUpdatedAt, waitForSave, refreshBase, onApplied }) {
  const [state, setState] = useState({ phase: 'loading' })   // loading | plan | error
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)                  // a sentence under the plan
  const [round, setRound] = useState(0)                       // "Check again" bumps this
  const [recheck, setRecheck] = useState(false)               // a 409 happened: the base needs a fresh read

  useEffect(() => {
    if (!open) return undefined
    let live = true
    setState({ phase: 'loading' })
    planStyleUpdate(noteId, styleId ? { styleId } : {}).then(
      (out) => { if (live) setState({ phase: 'plan', plan: out.plan }) },
      (e) => { if (live) setState({ phase: 'error', message: e?.status === 404 ? GONE_SENTENCE : "Couldn't check what this would change. Nothing was added." }) },
    )
    return () => { live = false }
  }, [open, noteId, styleId, round])

  // ⛔ A 409 means the base this sheet holds is old. Re-planning alone would offer an Apply that 409s
  // again, so the editor re-reads first (it refuses while it holds unsent words, and then nothing moves).
  const checkAgain = useCallback(async () => {
    setNotice(null)
    if (refreshBase && (await refreshBase()) === false) { setNotice(STILL_SAVING_SENTENCE); return }
    setRecheck(false)
    setRound((r) => r + 1)
  }, [refreshBase])

  const apply = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      if (waitForSave && (await waitForSave()) === false) { setNotice(STILL_SAVING_SENTENCE); return }
      const base = typeof baseUpdatedAt === 'function' ? baseUpdatedAt() : baseUpdatedAt
      const out = await applyStyleUpdate(noteId, { ...(styleId ? { styleId } : {}), baseUpdatedAt: base })
      if (onApplied?.(out.note, out.plan) === false) setNotice(STILL_SAVING_SENTENCE)
    } catch (e) {
      if (e?.status === 409) setRecheck(true)
      setNotice(sentenceFor(e))
    } finally {
      setBusy(false)
    }
  }

  const plan = state.phase === 'plan' ? state.plan : null
  const title = plan?.switching ? `Switch to ${plan.styleName}` : 'Update layout'
  // Nothing to do: the sheet says so and offers Close only.
  const nothing = plan && (plan.locked || (!plan.switching && plan.upToDate))

  return (
    <Sheet open={open} onClose={onClose} title={title} labelledByTitle variant="auto" maxWidth={520}
      footer={(
        <div className={styles.actions}>
          <button type="button" className={`btn btn-ghost ${styles.btn}`} onClick={onClose}>{nothing ? 'Close' : 'Cancel'}</button>
          {recheck && <button type="button" className={`btn btn-ghost ${styles.btn}`} onClick={checkAgain}>Check again</button>}
          {plan && !nothing && (
            <button type="button" className={`btn btn-primary ${styles.btn}`} onClick={apply}
              disabled={busy || (!plan.add.length && !plan.switching)}>
              {busy ? 'Applying…' : 'Apply'}
            </button>
          )}
        </div>
      )}>
      <div className={styles.wrap}>
        {state.phase === 'loading' && <p className={styles.p} role="status">Checking what this would change…</p>}
        {state.phase === 'error' && <p className={styles.p} role="alert">{state.message}</p>}
        {plan && plan.locked && <p className={styles.p} role="status">{LOCKED_SENTENCE}</p>}
        {plan && !plan.locked && !plan.switching && plan.upToDate && (
          <p className={styles.p} role="status">This note already has the latest layout.</p>
        )}
        {plan && !nothing && (
          <>
            <p className={styles.p}>
              {plan.switching
                ? `Switch this note to ${plan.styleName}.`
                : `Update this note from ${plan.styleName} v${plan.fromVersion} to v${plan.toVersion}.`}
            </p>
            {plan.insertsOutline && <p className={styles.p}>This note is empty, so the style’s outline is added too.</p>}
            {plan.add.length > 0 ? (
              <>
                <p className={styles.h}>Will be added</p>
                <ul className={styles.list} aria-label="Will be added">
                  {plan.add.map((a) => <li key={a.block}>{a.label || blockLabel(a.block)}</li>)}
                </ul>
              </>
            ) : (
              <p className={styles.p}>No blocks to add.</p>
            )}
            {plan.skipped.length > 0 && (
              <>
                <p className={styles.h}>Left out</p>
                <ul className={styles.list} aria-label="Left out">
                  {plan.skipped.map((s) => <li key={s.block}>{blockLabel(s.block)}: {skipWords(s.reason)}</li>)}
                </ul>
              </>
            )}
            <p className={styles.p}>Nothing in your note is removed or moved.</p>
            <p className={styles.muted}>Your latest words are saved first.</p>
          </>
        )}
        {notice && <p className={styles.p} role="alert">{notice}</p>}
      </div>
    </Sheet>
  )
}

/** `/style`: the member's styles grouped by kind; picking one opens the switch preview. */
export function StyleChooser({ open, onClose, onPick }) {
  const { data, error, isLoading } = useJournalStyles()
  return (
    <Sheet open={open} onClose={onClose} title="Choose a journal style" labelledByTitle variant="auto" maxWidth={520}>
      <div className={styles.wrap}>
        {isLoading && <p className={styles.p} role="status">Loading your styles…</p>}
        {!isLoading && (error || !data) && <p className={styles.p} role="alert">Couldn't load your journal styles.</p>}
        {data && data.kinds.map((k) => {
          const list = data.styles.filter((s) => s.kindId === k.id)
          if (!list.length) return null
          return (
            <section key={k.id} className={styles.kind} role="group" aria-label={k.name}>
              <p className={styles.h}>{k.name}</p>
              <ul className={styles.list}>
                {list.map((s) => (
                  <li key={s.id}>
                    <button type="button" className={styles.pick} onClick={() => onPick(s.id)}>
                      {s.name}{s.builtin ? ' · Built-in' : ''}{s.isDefault ? ' · Default' : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </Sheet>
  )
}
