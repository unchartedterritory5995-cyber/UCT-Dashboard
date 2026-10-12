// The Journal styles manager (Notebook P1, spec P1.4): Notebook > Styles, and the Settings door.
// Lists styles by kind; create, edit, duplicate, rename, set as default, soft-delete with Undo; add,
// rename and delete your own kinds; the one-shot "set Kind of note from Research Type" offer.
// ⛔ Everything here is a CREATING door: it renders nothing while journalStylesEnabled() is off, and the
// hook fails closed on the same gate. A note that already holds a style's blocks is never affected.
// ⛔ Offline (the list came from the saved copy): reading works, every write control is disabled.
// ⛔ Every server sentence (a kind still in use, a refused name) is shown as the server wrote it.
import { useState } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import Sheet from '../../../../../components/mobile/Sheet'
import UIcon, { UICON_NAMES } from '../../../../../components/ui/UIcon'
import usePreferences from '../../../../../hooks/usePreferences'
import useJournalStyles from '../../../hooks/useJournalStyles'
import { journalStylesEnabled } from '../../../lib/journalStylesFlag'
import { kindIcon } from '../../../lib/noteKinds'
import {
  applyMappingOffer, createJournalStyle, createKind, deleteJournalStyle, deleteKind, getJournalStyle,
  getMappingOffer, restoreJournalStyle, setDefaultJournalStyle, stylesOfKind, updateKind,
} from '../../../lib/journalStyles'
import StyleEditor from './StyleEditor'
import styles from './StylesManager.module.css'

const MAPPING_PREF = 'notebook_kind_mapping'
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const dismissed = (v) => String(v ?? '').replace(/^"|"$/g, '') === 'dismissed'
const newDraftStyle = (kindId) => ({ id: null, name: '', kindId, outlineTemplateId: null, outlineBodyJson: null, blocks: [], properties: {} })
const iconFor = (kind) => (UICON_NAMES.includes(kindIcon(kind)) ? kindIcon(kind) : 'document')

export default function StylesManager({ open, onClose, blockedNoteIds = [] }) {
  const on = journalStylesEnabled()
  const { data, error, isLoading, mutate } = useJournalStyles({ enabled: open })
  const { data: offerData, mutate: mutateOffer } = useSWR(
    open && on ? 'journal-styles:mapping-offer' : null, () => getMappingOffer(), { shouldRetryOnError: false })
  const { prefs, setPref } = usePreferences()

  const [editing, setEditing] = useState(null)          // { style } while the editor is open
  const [undo, setUndo] = useState(null)                // { id } of the style just deleted
  const [status, setStatus] = useState('')
  const [problem, setProblem] = useState('')
  const [kindProblem, setKindProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [newKind, setNewKind] = useState({ name: '', icon: 'document' })
  const [renaming, setRenaming] = useState(null)        // { id, name }

  if (!on) return null

  const kinds = data?.kinds || []
  const offline = data?.fromCache === true
  const locked = busy || offline
  const offer = offerData?.offer
  const showOffer = Boolean(offer) && !offline && !dismissed(prefs?.[MAPPING_PREF])

  /** Any action but Undo ends the Undo line ("kept until the next action or close"). */
  const run = async (fn, { keepUndo = false } = {}) => {
    setBusy(true); setProblem(''); setKindProblem(''); setStatus('')
    if (!keepUndo) setUndo(null)
    try { await fn() } catch (e) { setProblem(e.message || 'That did not work. Nothing was changed.') } finally { setBusy(false) }
  }
  const close = () => { setUndo(null); setStatus(''); setProblem(''); setKindProblem(''); setEditing(null); onClose() }

  const editStyle = (s) => run(async () => {
    const out = await getJournalStyle(s.id)
    setEditing({ style: out.style })
  })
  const duplicate = (s, { thenEdit = true } = {}) => run(async () => {
    const full = (await getJournalStyle(s.id)).style
    const body = { name: `${full.name} copy`, kindId: full.kindId, blocks: full.blocks || [], properties: full.properties || {} }
    if (full.outlineTemplateId) body.outlineTemplateId = full.outlineTemplateId
    if (full.outlineBodyJson) body.outlineBodyJson = full.outlineBodyJson
    const out = await createJournalStyle(body)
    await mutate()
    if (thenEdit) setEditing({ style: out.style }); else setStatus('Style duplicated.')
  })
  const makeDefault = (s) => run(async () => {
    await setDefaultJournalStyle(s.id)
    await mutate()
    setStatus(`${s.name} is now the default.`)
  })
  const remove = (s) => run(async () => {
    await deleteJournalStyle(s.id)
    await mutate()
    if (editing?.style?.id === s.id) setEditing(null)
    setUndo({ id: s.id })
  })
  const restore = () => run(async () => {
    await restoreJournalStyle(undo.id)
    await mutate()
    setUndo(null)
    setStatus('Style restored.')
  }, { keepUndo: true })
  const saved = (s) => {
    setEditing(null); setUndo(null); setProblem('')
    setStatus(`Saved ${s?.name || 'the style'}.`)
    mutate()
  }

  const addKind = (e) => {
    e.preventDefault()
    if (!newKind.name.trim()) { setKindProblem('Give the kind a name.'); return }
    run(async () => {
      try {
        await createKind({ name: newKind.name.trim(), icon: newKind.icon })
      } catch (err) { setKindProblem(err.message); return }
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
      } catch (err) { setKindProblem(err.message); return }
      setRenaming(null)
      await mutate()
      setStatus('Kind renamed.')
    })
  }
  const removeKind = (k) => run(async () => {
    let out
    try { out = await deleteKind(k.id) } catch (err) { setKindProblem(err.message); return }       // the server's own sentence
    await mutate()
    const n = out?.purgedDeletedStyles || 0
    setStatus(n ? `Kind deleted. ${plural(n, 'style you had deleted', 'styles you had deleted')} for it ${n === 1 ? 'was' : 'were'} removed for good.` : 'Kind deleted.')
  })

  const applyOffer = () => run(async () => {
    const out = await applyMappingOffer(Array.from(blockedNoteIds || []))
    const skipped = (out.skipped || []).length
    await mutateOffer()
    globalMutate((k) => typeof k === 'string' && k.startsWith('/api/j2/notes'))
    setStatus(`Set the kind on ${plural(out.count ?? (out.notes || []).length, 'note', 'notes')}.`
      + (skipped ? ` ${plural(skipped, 'locked note was', 'locked notes were')} left as ${skipped === 1 ? 'it is' : 'they are'}.` : ''))
  })
  const notNow = () => { setPref(MAPPING_PREF, 'dismissed') }

  const ownKinds = kinds.filter((k) => !k.builtin)

  return (
    <Sheet open={open} onClose={close} title={<h2 style={{ margin: 0, font: 'inherit' }}>Journal styles</h2>}
      labelledByTitle variant="auto" maxWidth={960}>
      <div className={styles.wrap}>
        <p className={styles.hint}>
          A style is how a kind of note starts: its outline, its blocks and the properties it fills. Changing a style never changes notes you already made.
        </p>

        <div role="status" aria-live="polite" className={styles.statusSlot}>
          {undo ? (
            <p className={styles.notice}>
              <span>Style deleted.</span>
              <button type="button" className={styles.btn} onClick={restore} disabled={busy}>Undo</button>
            </p>
          ) : status ? <p className={styles.notice}>{status}</p> : null}
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
            {error.message || 'Your styles could not be loaded.'}{' '}
            <button type="button" className={styles.btn} onClick={() => mutate()}>Try again</button>
          </p>
        )}

        {data && (
          <div className={styles.layout}>
            <div className={styles.listCol}>
              <button type="button" className={`${styles.btn}`} disabled={locked || !kinds.length}
                onClick={() => { setUndo(null); setEditing({ style: newDraftStyle(kinds[0]?.id) }) }}>
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
                          <li key={s.id} className={styles.styleRow}>
                            <div className={styles.rowTop}>
                              <span className={styles.rowName}>{s.name}</span>
                              {s.isDefault && <span className={styles.badge}>Default</span>}
                              <span className={styles.version}>{`v${s.version}`}</span>
                            </div>
                            <div className={styles.rowActions}>
                              {s.builtin ? (
                                <button type="button" className={styles.btn} disabled={locked} onClick={() => duplicate(s)}
                                  aria-label={`Duplicate ${s.name} to edit`}>Duplicate to edit</button>
                              ) : (
                                <button type="button" className={styles.btn} disabled={locked} onClick={() => editStyle(s)}
                                  aria-label={`Edit ${s.name}`}>Edit</button>
                              )}
                              {!s.builtin && (
                                <button type="button" className={styles.btn} disabled={locked} onClick={() => duplicate(s, { thenEdit: false })}
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
                    <li key={k.id} className={styles.kindRow}>
                      {renaming?.id === k.id ? (
                        <form className={styles.kindForm} onSubmit={saveRename} aria-label={`Rename ${k.name}`}>
                          <input type="text" aria-label={`New name for ${k.name}`} value={renaming.name} maxLength={60}
                            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
                          <button type="submit" className={styles.btn} disabled={locked}>Save name</button>
                          <button type="button" className={styles.btn} onClick={() => setRenaming(null)}>Cancel</button>
                        </form>
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
                              aria-label={`Delete kind ${k.name}`} onClick={() => removeKind(k)}>Delete</button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <form className={styles.kindForm} onSubmit={addKind} aria-label="Add a kind of note">
                  <div className={styles.field}>
                    <label htmlFor="js-kind-name">New kind name</label>
                    <input id="js-kind-name" type="text" value={newKind.name} maxLength={60}
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
                  <h3 className={styles.kindHead}>{editing.style.id ? 'Edit style' : 'New style'}</h3>
                  <StyleEditor key={editing.style.id || 'new'} style={editing.style} kinds={kinds} offline={offline}
                    onSaved={saved} onCancel={() => setEditing(null)} />
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
