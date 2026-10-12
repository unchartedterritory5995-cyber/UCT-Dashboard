// The Journal styles manager (Notebook P1, spec P1.4): Notebook > Styles, and the Settings door.
// Lists styles by kind; create, edit, duplicate, rename, set as default, soft-delete with Undo; add,
// rename and delete your own kinds; the one-shot "set Kind of note from Research Type" offer.
// ⛔ Everything here is a CREATING door: it renders nothing while journalStylesEnabled() is off, and the
// hook fails closed on the same gate. A note that already holds a style's blocks is never affected.
// ⛔ Offline (the list came from the saved copy): reading works, every write control is disabled.
// ⛔ A sentence the SERVER worded (a kind still in use, a refused name) is shown as written; the browser's
//    "Failed to fetch" and a bare "500" never are (./styleErrors.js).
// Focus: opening the editor moves focus to its heading and scrolls it into view (the one-column phone layout
// puts it far below the list); closing it returns focus to the button that opened it; after Delete focus
// lands on Undo, after Undo on the restored row. The status line is sticky, so it is seen where the member is.
import { useContext, useEffect, useRef, useState } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import Sheet from '../../../../../components/mobile/Sheet'
import UIcon, { UICON_NAMES } from '../../../../../components/ui/UIcon'
import usePreferences from '../../../../../hooks/usePreferences'
import { AuthContext } from '../../../../../context/AuthContext'
import useJournalStyles from '../../../hooks/useJournalStyles'
import { journalStylesEnabled } from '../../../lib/journalStylesFlag'
import { kindIcon } from '../../../lib/noteKinds'
import {
  applyMappingOffer, createJournalStyle, createKind, deleteJournalStyle, deleteKind, getJournalStyle,
  getMappingOffer, MAX_STYLE_NAME_CHARS as MAX_STYLE_NAME, restoreJournalStyle, setDefaultJournalStyle, stylesOfKind,
  updateKind,
} from '../../../lib/journalStyles'
import StyleEditor from './StyleEditor'
import { friendlyError, logIfUnexpected, reportError } from './styleErrors'
import { markOfferApplied, offerApplied } from './offerApplied'
import styles from './StylesManager.module.css'

const MAPPING_PREF = 'notebook_kind_mapping'
const MAX_KIND_NAME = 40                           // note_kinds.MAX_KIND_NAME_CHARS
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const dismissed = (v) => String(v ?? '').replace(/^"|"$/g, '') === 'dismissed'
const newDraftStyle = (kindId) => ({ id: null, name: '', kindId, outlineTemplateId: null, outlineBodyJson: null, blocks: [], properties: {} })
const iconFor = (kind) => (UICON_NAMES.includes(kindIcon(kind)) ? kindIcon(kind) : 'document')
const copyName = (name) => {
  const suffix = ' copy'
  return name.length + suffix.length > MAX_STYLE_NAME ? name.slice(0, MAX_STYLE_NAME - suffix.length) + suffix : name + suffix
}

export default function StylesManager({ open, onClose, blockedNoteIds = [] }) {
  const on = journalStylesEnabled()
  const { data, error, isLoading, mutate } = useJournalStyles({ enabled: open })
  const { data: offerData } = useSWR(
    open && on ? 'journal-styles:mapping-offer' : null, () => getMappingOffer(), { shouldRetryOnError: false })
  const { prefs, setPref } = usePreferences()
  const userId = useContext(AuthContext)?.user?.id

  const [editing, setEditing] = useState(null)          // { style, seq } while the editor is open
  const openSeq = useRef(0)                             // a new number per opening: Discard must remount the editor even for the same style
  const [editorDirty, setEditorDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(null)   // { then } while the discard question is up
  const [undo, setUndo] = useState(null)                // { id } of the style just deleted
  const [status, setStatus] = useState('')
  const [problem, setProblem] = useState('')
  const [kindProblem, setKindProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [newKind, setNewKind] = useState({ name: '', icon: 'document' })
  const [renaming, setRenaming] = useState(null)        // { id, name }
  const [confirmKind, setConfirmKind] = useState(null)  // id of the kind a Delete is waiting on
  const [offerDone, setOfferDone] = useState(false)     // the offer was applied (also kept in offerApplied.js, which outlives this tab)

  const editorHeadRef = useRef(null)
  const openerRef = useRef(null)
  const undoRef = useRef(null)
  const keepEditingRef = useRef(null)
  const rowEls = useRef({})
  const kindRowEls = useRef({})
  const kindDeleteBtns = useRef({})
  const confirmYesRef = useRef(null)
  const pendingFocus = useRef(null)                     // { type: 'opener' | 'undo' | 'row' | 'kindDelete' | 'kindRow' | 'addKind', id? }

  // The editor opened: bring it to the member. (On a phone it sits below the whole list.)
  useEffect(() => {
    const h = editorHeadRef.current
    if (!editing || !h) return
    h.focus()
    h.scrollIntoView?.({ block: 'start' })
  }, [editing])
  useEffect(() => { if (confirmDiscard) keepEditingRef.current?.focus() }, [confirmDiscard])
  useEffect(() => { if (error) logIfUnexpected(error) }, [error])        // a first-load bug of ours: logged once, not per render
  useEffect(() => { if (confirmKind) confirmYesRef.current?.focus() }, [confirmKind])
  // Focus a moved target once it exists (Undo appears, a restored row comes back, the opener is still there).
  useEffect(() => {
    const pf = pendingFocus.current
    if (!pf) return
    if (pf.type === 'opener') {
      pendingFocus.current = null
      if (openerRef.current?.isConnected) openerRef.current.focus()
    } else if (pf.type === 'undo') {
      if (undoRef.current) { pendingFocus.current = null; undoRef.current.focus() }
    } else if (pf.type === 'row') {
      const li = rowEls.current[pf.id]
      if (li) { pendingFocus.current = null; (li.querySelector('button:not(:disabled)') || li).focus() }
    } else if (pf.type === 'kindDelete') {
      const b = kindDeleteBtns.current[pf.id]
      if (b) { pendingFocus.current = null; b.focus() }
    } else if (pf.type === 'kindRow') {
      const li = kindRowEls.current[pf.id]
      if (li) { pendingFocus.current = null; (li.querySelector('button:not(:disabled)') || li).focus() }
    } else if (pf.type === 'addKind') {
      pendingFocus.current = null
      document.getElementById('js-kind-name')?.focus()
    }
  })

  if (!on) return null

  const kinds = data?.kinds || []
  const ownKinds = kinds.filter((k) => !k.builtin)
  const offline = data?.fromCache === true
  const locked = busy || offline
  const offer = offerData?.offer
  const showOffer = Boolean(offer) && !offline && !offerDone && !offerApplied(userId) && !dismissed(prefs?.[MAPPING_PREF])

  /** Any action but Undo ends the Undo line ("kept until the next action or close"). */
  const run = async (fn, { keepUndo = false } = {}) => {
    setBusy(true); setProblem(''); setKindProblem(''); setStatus('')
    pendingFocus.current = null
    if (!keepUndo) setUndo(null)
    try { await fn() } catch (e) { setProblem(reportError(e)) } finally { setBusy(false) }
  }
  const finish = () => {
    setUndo(null); setStatus(''); setProblem(''); setKindProblem(''); setEditing(null); setConfirmDiscard(null); setConfirmKind(null)
    onClose()
  }
  /** Closing over an editor with unsaved changes asks first, in the page (never window.confirm). */
  const close = () => guard(finish)
  /** Anything that would replace or close the editor asks first when it holds unsaved changes. */
  const guard = (then) => {
    if (editing && editorDirty) { setConfirmDiscard({ then }); return }
    then()
  }
  const closeEditor = () => {
    setEditing(null); setEditorDirty(false); setConfirmDiscard(null)     // a waiting discard question has nothing left to ask about
    pendingFocus.current = { type: 'opener' }
  }
  const discard = () => {
    const then = confirmDiscard?.then
    setConfirmDiscard(null); setEditorDirty(false)
    then?.()
  }

  const openEditor = (style, opener) => { openerRef.current = opener || null; openSeq.current += 1; setEditing({ style, seq: openSeq.current }) }
  const editStyle = (s, opener) => run(async () => {
    const out = await getJournalStyle(s.id)
    openEditor(out.style, opener)
  })
  const duplicate = (s, opener, { thenEdit = true } = {}) => run(async () => {
    const full = (await getJournalStyle(s.id)).style
    const body = { name: copyName(full.name), kindId: full.kindId, blocks: full.blocks || [], properties: full.properties || {} }
    if (full.outlineTemplateId) body.outlineTemplateId = full.outlineTemplateId
    if (full.outlineBodyJson) body.outlineBodyJson = full.outlineBodyJson
    const out = await createJournalStyle(body)
    await mutate()
    if (thenEdit) openEditor(out.style, opener); else setStatus('Style duplicated.')
  })
  const makeDefault = (s) => run(async () => {
    await setDefaultJournalStyle(s.id)
    await mutate()
    setStatus(`${s.name} is now the default.`)
  })
  const remove = (s) => run(async () => {
    await deleteJournalStyle(s.id)
    await mutate()
    if (editing?.style?.id === s.id) { setEditing(null); setEditorDirty(false); setConfirmDiscard(null) }
    pendingFocus.current = { type: 'undo' }            // the row that held focus is gone: Undo is the next stop
    setUndo({ id: s.id })
  })
  const restore = () => run(async () => {
    await restoreJournalStyle(undo.id)
    await mutate()
    pendingFocus.current = { type: 'row', id: undo.id }
    setUndo(null)
    setStatus('Style restored.')
  }, { keepUndo: true })
  const saved = (s) => {
    setUndo(null); setProblem('')
    setStatus(`Saved ${s?.name || 'the style'}.`)
    closeEditor()
    mutate()
  }

  const addKind = (e) => {
    e.preventDefault()
    if (!newKind.name.trim()) { setKindProblem('Give the kind a name.'); return }
    run(async () => {
      try {
        await createKind({ name: newKind.name.trim(), icon: newKind.icon })
      } catch (err) { setKindProblem(reportError(err)); return }
      setNewKind({ name: '', icon: 'document' })
      await mutate()
      setStatus('Kind added.')
    })
  }
  const saveRename = (e) => {
    e.preventDefault()
    run(async () => {
      try {
        await updateKind(renaming.id, { name: renaming.name.trim() })
      } catch (err) { setKindProblem(reportError(err)); return }
      setRenaming(null)
      await mutate()
      setStatus('Kind renamed.')
    })
  }
  const removeKind = (k) => run(async () => {
    setConfirmKind(null)
    const at = ownKinds.findIndex((x) => x.id === k.id)
    const next = ownKinds[at + 1] || ownKinds[at - 1]
    let out
    try { out = await deleteKind(k.id) } catch (err) { setKindProblem(reportError(err)); pendingFocus.current = { type: 'kindDelete', id: k.id }; return }       // the server's own sentence
    await mutate()
    pendingFocus.current = next ? { type: 'kindRow', id: next.id } : { type: 'addKind' }
    const n = out?.purgedDeletedStyles || 0
    setStatus(n ? `Kind deleted. ${plural(n, 'style you had deleted', 'styles you had deleted')} for it ${n === 1 ? 'was' : 'were'} removed for good.` : 'Kind deleted.')
  })

  const applyOffer = () => run(async () => {
    const ids = Array.from(blockedNoteIds || [])
    const asked = offer?.total ?? 0
    const out = await applyMappingOffer(ids)
    const count = out.count ?? (out.notes || []).length
    const skipped = out.skipped || []
    const lockedN = skipped.filter((s) => (s.reason ?? 'locked') === 'locked').length
    // Held back for unsent offline work: what the response says, and whatever it left unaccounted for
    // among the notes the offer counted (the excluded ids are never sent to the server's count).
    const unsent = skipped.length - lockedN + (ids.length ? Math.max(0, asked - count - skipped.length) : 0)
    setOfferDone(true)                                  // never ask again: the server still counts the notes it skipped
    markOfferApplied(userId)                            // ...and not on the next visit either (this tab remounts)
    globalMutate((k) => typeof k === 'string' && k.startsWith('/api/j2/notes'))
    setStatus(
      `Set the kind on ${plural(count, 'note', 'notes')}.`
      + (lockedN ? ` ${plural(lockedN, 'locked note', 'locked notes')} ${lockedN === 1 ? 'was' : 'were'} left as ${lockedN === 1 ? 'it was' : 'they were'}.` : '')
      + (unsent ? ` ${plural(unsent, 'note', 'notes')} with unsent changes ${unsent === 1 ? 'was' : 'were'} left for later.` : ''))
  })
  const notNow = () => { setPref(MAPPING_PREF, 'dismissed') }

  return (
    <Sheet open={open} onClose={close} title={<h2 style={{ margin: 0, font: 'inherit' }}>Journal styles</h2>}
      labelledByTitle variant="auto" maxWidth={960}>
      <div className={styles.wrap}>
        <p className={styles.hint}>
          A style is how a kind of note starts: its outline, its blocks and the properties it fills. Changing a style never changes notes you already made.
        </p>

        <div className={styles.stickyTop} data-empty={undo || status || confirmDiscard ? undefined : 'true'}>
          <div role="status" aria-live="polite">
            {undo ? (
              <p className={styles.notice}>
                <span>Style deleted.</span>
                <button type="button" ref={undoRef} className={styles.btn} onClick={restore} disabled={busy}>Undo</button>
              </p>
            ) : status ? <p className={styles.notice}>{status}</p> : null}
          </div>
          {confirmDiscard && (
            <section className={styles.notice} aria-label="Unsaved changes">
              <span>Discard your unsaved changes to this style?</span>
              <button type="button" ref={keepEditingRef} className={styles.btn}
                onClick={() => { setConfirmDiscard(null); document.getElementById('js-name')?.focus() }}>Keep editing</button>
              <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={discard}>Discard changes</button>
            </section>
          )}
        </div>
        {problem && <p role="alert" className={styles.error}>{problem}</p>}
        {offline && (
          <p className={styles.notice}>You are offline. These are the styles saved on this device. Making or changing a style needs a connection.</p>
        )}

        {showOffer && (
          <section className={styles.notice} aria-label="Set Kind of note from Research Type">
            <span>{`You have ${plural(offer.total, 'note', 'notes')} with a Research Type. Set their Kind of note to match?`}</span>
            <button type="button" className={styles.btn} onClick={applyOffer} disabled={locked}>Set kinds</button>
            <button type="button" className={styles.btn} onClick={notNow}>Not now</button>
          </section>
        )}

        {isLoading && !data && <p className={styles.hint}>Loading your styles…</p>}
        {error && !data && (
          <p role="alert" className={styles.error}>
            {friendlyError(error)}{' '}
            <button type="button" className={styles.btn} onClick={() => mutate()}>Try again</button>
          </p>
        )}

        {data && (
          <div className={styles.layout}>
            <div className={styles.listCol}>
              <button type="button" className={`${styles.btn}`} disabled={locked || !kinds.length}
                onClick={(e) => { const opener = e.currentTarget; guard(() => { setUndo(null); openEditor(newDraftStyle(kinds[0]?.id), opener) }) }}>
                <UIcon name="plus" size={14} gold={false} /> New style
              </button>

              {kinds.map((k) => {
                const list = stylesOfKind(data, k.id)
                return (
                  <section key={k.id} className={styles.kindGroup} aria-labelledby={`js-kind-${k.id}`}>
                    <h3 id={`js-kind-${k.id}`} className={styles.kindHead}>
                      <UIcon name={iconFor(k)} size={14} gold={false} />{k.name}
                    </h3>
                    {list.length === 0 ? <p className={styles.hint}>No styles for this kind yet.</p> : (
                      <ul className={styles.styleList}>
                        {list.map((s) => (
                          <li key={s.id} className={styles.styleRow} tabIndex={-1}
                            ref={(el) => { if (el) rowEls.current[s.id] = el; else delete rowEls.current[s.id] }}>
                            <div className={styles.rowTop}>
                              <span className={styles.rowName}>{s.name}</span>
                              {s.isDefault && <span className={styles.badge}>Default</span>}
                              <span className={styles.version}>{`v${s.version}`}</span>
                            </div>
                            <div className={styles.rowActions}>
                              {s.builtin ? (
                                <button type="button" className={styles.btn} disabled={locked} onClick={(e) => { const opener = e.currentTarget; guard(() => duplicate(s, opener)) }}
                                  aria-label={`Duplicate ${s.name} to edit`}>Duplicate to edit</button>
                              ) : (
                                <button type="button" className={styles.btn} disabled={locked} onClick={(e) => { const opener = e.currentTarget; guard(() => editStyle(s, opener)) }}
                                  aria-label={`Edit ${s.name}`}>Edit</button>
                              )}
                              {!s.builtin && (
                                <button type="button" className={styles.btn} disabled={locked} onClick={(e) => duplicate(s, e.currentTarget, { thenEdit: false })}
                                  aria-label={`Duplicate ${s.name}`}>Duplicate</button>
                              )}
                              {!s.isDefault && (
                                <button type="button" className={styles.btn} disabled={locked} onClick={() => makeDefault(s)}
                                  aria-label={`Set ${s.name} as default`}>Set as default</button>
                              )}
                              {!s.builtin && (
                                <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={locked} onClick={() => remove(s)}
                                  aria-label={`Delete ${s.name}`}>Delete</button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )
              })}

              <section className={styles.kindGroup} aria-labelledby="js-own-kinds">
                <h3 id="js-own-kinds" className={styles.kindHead}>Your kinds of note</h3>
                {ownKinds.length === 0 && <p className={styles.hint}>You have no kinds of your own yet. Add one below.</p>}
                <ul className={styles.kindList}>
                  {ownKinds.map((k) => (
                    <li key={k.id} className={styles.kindRow} tabIndex={-1}
                      ref={(el) => { if (el) kindRowEls.current[k.id] = el; else delete kindRowEls.current[k.id] }}>
                      {renaming?.id === k.id ? (
                        <form className={styles.kindForm} onSubmit={saveRename} aria-label={`Rename ${k.name}`}>
                          <input type="text" aria-label={`New name for ${k.name}`} value={renaming.name} maxLength={MAX_KIND_NAME}
                            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
                          <button type="submit" className={styles.btn} disabled={locked}>Save name</button>
                          <button type="button" className={styles.btn} onClick={() => setRenaming(null)}>Cancel</button>
                        </form>
                      ) : confirmKind === k.id ? (
                        <>
                          <p className={styles.hint}>{`Delete the kind ${k.name}? Styles you deleted that used it are removed permanently.`}</p>
                          <div className={styles.rowActions}>
                            <button type="button" ref={confirmYesRef} className={`${styles.btn} ${styles.danger}`} disabled={locked}
                              onClick={() => removeKind(k)}>{`Yes, delete kind ${k.name}`}</button>
                            <button type="button" className={styles.btn}
                              onClick={() => { pendingFocus.current = { type: 'kindDelete', id: k.id }; setConfirmKind(null) }}>{`Keep kind ${k.name}`}</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className={styles.rowTop}>
                            <UIcon name={iconFor(k)} size={14} gold={false} />
                            <span className={styles.rowName}>{k.name}</span>
                          </div>
                          <div className={styles.rowActions}>
                            <button type="button" className={styles.btn} disabled={locked} aria-label={`Rename ${k.name}`}
                              onClick={() => { setKindProblem(''); setRenaming({ id: k.id, name: k.name }) }}>Rename</button>
                            <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={locked}
                              ref={(el) => { if (el) kindDeleteBtns.current[k.id] = el; else delete kindDeleteBtns.current[k.id] }}
                              aria-label={`Delete kind ${k.name}`} onClick={() => { setKindProblem(''); setConfirmKind(k.id) }}>Delete</button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <form className={styles.kindForm} onSubmit={addKind} aria-label="Add a kind of note">
                  <div className={styles.field}>
                    <label htmlFor="js-kind-name">New kind name</label>
                    <input id="js-kind-name" type="text" value={newKind.name} maxLength={MAX_KIND_NAME}
                      onChange={(e) => setNewKind({ ...newKind, name: e.target.value })} />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="js-kind-icon">Icon</label>
                    <select id="js-kind-icon" value={newKind.icon} onChange={(e) => setNewKind({ ...newKind, icon: e.target.value })}>
                      {UICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <button type="submit" className={styles.btn} disabled={locked}>Add kind</button>
                </form>
                {kindProblem && <p role="alert" className={styles.error}>{kindProblem}</p>}
              </section>
            </div>

            <div className={styles.editorCol}>
              {editing ? (
                <>
                  <h3 className={styles.kindHead} tabIndex={-1} ref={editorHeadRef}>{editing.style.id ? 'Edit style' : 'New style'}</h3>
                  <StyleEditor key={editing.seq} style={editing.style} kinds={kinds} offline={offline}
                    onSaved={saved} onCancel={closeEditor} onDirtyChange={setEditorDirty} />
                </>
              ) : (
                <p className={styles.hint}>Pick a style to edit, or make a new one.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
