/**
 * The member's plain templates ("Save as template" copies, `/api/j2/note-templates`): ONE implementation of their
 * rows and handlers, drawn in two places (follow-up C, one room for templates).
 *
 *   * default `MemberTemplates`: "Your templates" in the template picker (the New note sheet and the empty notebook's
 *     inline picker). It PICKS: each template's card makes a note from it (Use) and Preview opens the picker's own
 *     preview. With `onManage(place)` (NotebookTab, while the template manager's door can open) it also draws
 *     a "Manage" link (opens the manager at its Plain templates group, `place` 'plain') and "Daily notes start from:
 *     <name>. Change" (opens it at the daily control, `place` 'daily'). Without `onManage` (the door cannot open, e.g.
 *     its switch has not latched yet) the picker keeps its own Rename, Delete, Share and the daily control (fix round
 *     1, 2c), so a plain template is never without a manager.
 *   * `PlainTemplatesManage`: the manager's Plain templates group. It MANAGES: the "Daily notes start from" control
 *     (the preference `notebook_daily_template`, plain templates only), and per template Use (the picker's own action,
 *     `onUse`), Preview (its own preview sheet), Rename, Delete (asks once; there is no trash for a plain template, and
 *     the question says so) and Share (the Template library, while it is on).
 *
 * Wave 6 (lane E, item 3) rules kept: Rename and Delete sit BESIDE the template's card or name, never inside a button
 * (a button in a button is one control to a screen reader); every failure is a sentence on screen, never a silent
 * no-op. Wave 10 lane DR-C (D-4): `query` (the picker's search text, lower-cased and trimmed by the caller) filters
 * the cards by name and never hides the daily line or the empty-state copy; Preview reads the full body once via
 * `getMemberTemplate`, and "Use" from inside the preview hands `onPick` that SAME record, so the caller's own read is
 * skipped. Wave 12 lane 12A: Share opens GalleryPublishForm (a COPY goes to the Template library for review), only
 * while notebook_template_gallery_enabled is latched on.
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import {
  deleteMemberTemplate, getMemberTemplate, renameMemberTemplate, useMemberTemplates,
} from '../../lib/memberTemplates'
import { DAILY_TEMPLATE_PREF } from '../../lib/dailyNote'
import usePreferences from '../../../../hooks/usePreferences'
import UIcon from '../../../../components/ui/UIcon'
import { templateGalleryEnabled } from '../../lib/templateGallery'
import lazyChunk from '../../lib/lazyChunk'
import TemplatePreview from './TemplatePreview'
import styles from './TemplatePicker.module.css'

// Dark behind notebook_template_gallery_enabled and shown only after "Share" is pressed, so it
// loads then and not with the Notebook's first open.
const GalleryPublishForm = lazyChunk(() => import('./GalleryPublishForm'))

/** The words the manager's group and the picker's link share. */
export const PLAIN_COPY = Object.freeze({
  title: 'Plain templates',
  lead: 'Copies of a note made with Save as template. They start a note as plain text, without live blocks or a note type.',
  empty: "No plain templates yet. Open a note's More menu and choose Save as template.",
  dailyHint: 'Daily notes can start from a plain template.',
  none: 'None',
  dailyDelete: 'Daily notes start from this template. After deleting it they start from a blank page.',
})

/** The ONE write of the daily preference in this file (the select, and a delete of the template it names): the
 *  additions-only rail counts this file's opaque `setPref` sites. */
const writeDaily = (setPref, id) => setPref(DAILY_TEMPLATE_PREF, id)

/** Preview one plain template through `onPreview` (the picker's sheet, or the manager's own): a loading frame first,
 *  then the body with each `{{block:...}}` line named (W11-R76; the slot words load on demand). */
async function previewPlain(t, onPreview, onPick) {
  const base = { label: t.name, subtitle: t.title && t.title !== t.name ? t.title : null }
  onPreview({ ...base, body: null, loading: true, onUse: () => {} })
  try {
    const full = await getMemberTemplate(t.id)
    const { outlineWithBlockNames } = await import('../../lib/templateSlots')
    onPreview({ ...base, body: outlineWithBlockNames(full.bodyJson, null), onUse: () => { onPreview(null); onPick?.(full) } })
  } catch (e) {
    onPreview({ ...base, body: null, loadError: e?.message || "Couldn't load this template.", onUse: () => {} })
  }
}

/** A group's live line: it lives with the group, so it survives the rows going away (the last delete, 2b). */
function PlainMessage({ message }) {
  if (!message) return null
  return (
    <div className={message.tone === 'error' ? styles.memberError : styles.memberNote}
      role={message.tone === 'error' ? 'alert' : 'status'} data-plain-message="">
      {message.text}
    </div>
  )
}

/** The rows. `asCards`: each name is a card that is the Use (the picker); otherwise the name is text and Use is a
 *  button of its own (the manager). `manage` adds Rename, Delete and Share. `say(message)` is the group's live line;
 *  `onDeleted(template)` runs after a delete went through. */
function PlainRows({ templates, manage = false, asCards = true, onPick, onPreview, busy = false, say, onDeleted }) {
  const [renaming, setRenaming] = useState(null) // { id, draft }
  const [confirmDelete, setConfirmDelete] = useState(null) // id
  const [working, setWorking] = useState(false)
  const [sharing, setSharing] = useState(null) // id of the template being shared to the gallery
  const galleryOn = templateGalleryEnabled()
  const { prefs, setPref } = usePreferences()
  const dailyId = prefs?.[DAILY_TEMPLATE_PREF] || ''

  const submitRename = async (e) => {
    e.preventDefault()
    if (!renaming || working) return
    setWorking(true)
    say(null)
    try {
      const t = await renameMemberTemplate(renaming.id, renaming.draft)
      setRenaming(null)
      say({ tone: 'ok', text: `Renamed to “${t.name}”.` })
    } catch (err) {
      say({ tone: 'error', text: err?.message || "Couldn't rename that template." })
    } finally {
      setWorking(false)
    }
  }

  const doDelete = async (t) => {
    if (working) return
    setWorking(true)
    say(null)
    try {
      await deleteMemberTemplate(t.id)
      setConfirmDelete(null)
      // Fix round 1 (2a): the daily preference named this template: clear it, so the control and the picker's line
      // agree with what the next daily note does (it starts blank).
      if (dailyId && dailyId === t.id) writeDaily(setPref, '')
      say({ tone: 'ok', text: `Deleted “${t.name}”. Notes made from it are unchanged.` })
      onDeleted?.(t)
    } catch {
      say({ tone: 'error', text: `Couldn't delete “${t.name}”. It is still here.` })
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className={styles.grid}>
      {templates.map((t) => (
        <div key={t.id} className={styles.memberItem} data-plain-template={t.id}>
          {renaming?.id === t.id ? (
            <form className={styles.renameForm} onSubmit={submitRename}>
              <input
                className={styles.renameInput}
                value={renaming.draft}
                onChange={(e) => setRenaming({ id: t.id, draft: e.target.value })}
                aria-label={`New name for ${t.name}`}
                maxLength={80}
                autoFocus
              />
              <button type="submit" className={styles.miniBtn} disabled={working}>Save</button>
              <button type="button" className={styles.miniBtn} onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          ) : !asCards ? (
            <span className={styles.memberName}>
              <span className={styles.cardLabel}>{t.name}</span>
              {t.title && t.title !== t.name && <span className={styles.cardDesc}>{t.title}</span>}
            </span>
          ) : (
            <button
              type="button"
              className={styles.card}
              data-template-card=""
              onClick={() => onPick(t)}
              disabled={busy || working}
            >
              <span className={styles.cardLabel}>{t.name}</span>
              {t.title && t.title !== t.name && <span className={styles.cardDesc}>{t.title}</span>}
            </button>
          )}
          {confirmDelete === t.id ? (
            <div className={styles.memberActions} role="group" aria-label={`Delete ${t.name}?`}>
              <span className={styles.memberNote}>
                {`Delete “${t.name}”? This can't be undone.${dailyId === t.id ? ` ${PLAIN_COPY.dailyDelete}` : ''}`}
              </span>
              <button type="button" className={`${styles.miniBtn} ${styles.miniDanger}`}
                onClick={() => doDelete(t)} disabled={working}>
                Delete
              </button>
              <button type="button" className={styles.miniBtn} onClick={() => setConfirmDelete(null)}>
                Keep it
              </button>
            </div>
          ) : renaming?.id !== t.id && (
            <div className={styles.memberActions}>
              {!asCards && onPick && (
                <button type="button" className={styles.miniBtn} onClick={() => onPick(t)}
                  disabled={busy || working} aria-label={`Use ${t.name}`}>
                  Use
                </button>
              )}
              <button type="button" className={styles.miniBtn}
                onClick={() => previewPlain(t, onPreview, onPick)}
                aria-label={`Preview ${t.name}`}>
                <UIcon name="eye" size={12} gold={false} /> Preview
              </button>
              {manage && (
                <>
                  <button type="button" className={styles.miniBtn}
                    onClick={() => { setConfirmDelete(null); setSharing(null); setRenaming({ id: t.id, draft: t.name }) }}
                    aria-label={`Rename ${t.name}`}>
                    Rename
                  </button>
                  <button type="button" className={styles.miniBtn}
                    onClick={() => { setRenaming(null); setSharing(null); setConfirmDelete(t.id) }}
                    aria-label={`Delete ${t.name}`}>
                    Delete
                  </button>
                  {galleryOn && (
                    <button type="button" className={styles.miniBtn}
                      onClick={() => { setRenaming(null); setConfirmDelete(null); setSharing(t.id) }}
                      aria-expanded={sharing === t.id}
                      aria-label={`Share ${t.name} to the Template library`}>
                      Share
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {manage && galleryOn && sharing === t.id && (
            <Suspense fallback={<p role="status">Loading the share form…</p>}>
              <GalleryPublishForm
                template={t}
                onCancel={() => setSharing(null)}
                onDone={(text) => { setSharing(null); say({ tone: 'ok', text }) }}
              />
            </Suspense>
          )}
        </div>
      ))}
    </div>
  )
}

/** "Daily notes start from": which plain template makes each new daily note (a preference; wave 6 item 4). A template
 *  deleted since needs no guard: a <select> shows its first option ("A blank page") for a value it does not have, and
 *  Today itself says the template is gone (the server's `templateMissing`). Plain templates only: the server reads the
 *  id from `j2_note_templates` (note_daily.py) and falls back silently for anything else. */
export function DailyTemplateSelect({ templates, selectRef = null, hintId = 'js-daily-template-hint' }) {
  const { prefs, setPref } = usePreferences()
  const dailyChoice = prefs?.[DAILY_TEMPLATE_PREF] || ''
  return (
    <div className={styles.dailyBox}>
      <label className={styles.dailyPick}>
        <span>Daily notes start from</span>
        <select
          ref={selectRef}
          value={dailyChoice}
          aria-describedby={hintId}
          onChange={(e) => writeDaily(setPref, e.target.value)}
        >
          <option value="">A blank page</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <p className={styles.memberNote} id={hintId}>{PLAIN_COPY.dailyHint}</p>
    </div>
  )
}

/** The template manager's Plain templates group. `onUse(template)` makes a note from it (absent: no Use).
 *  `focusAsk` `{target: 'plain' | 'daily' | null, n}`: a door asked to land here; once the list has settled, focus
 *  moves to the daily control ('daily', when there is one) or the group's heading, scrolled into view, once per `n`
 *  (`onLanded()` then, so the manager stops asking). `classes` `{section, head, lead}`: the manager's own look for the
 *  group's frame. The group reads its own list, so it never waits on another one (fix round 1, 2c). */
export function PlainTemplatesManage({ onUse = null, busy = false, focusAsk = null, onLanded = null, classes = {} }) {
  const { templates, error, isLoading } = useMemberTemplates()
  const [preview, setPreview] = useState(null)
  const [message, setMessage] = useState(null)
  const headRef = useRef(null)
  const dailyRef = useRef(null)
  const landed = useRef(null)
  const target = focusAsk?.target === 'plain' || focusAsk?.target === 'daily' ? focusAsk.target : null
  useEffect(() => {
    if (!target || isLoading || landed.current === focusAsk.n) return
    landed.current = focusAsk.n
    const el = target === 'daily' && dailyRef.current ? dailyRef.current : headRef.current
    el?.scrollIntoView?.({ block: 'start' })
    el?.focus()
    onLanded?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, isLoading, focusAsk?.n])
  // Fix round 1 (2b): the last delete takes its row away; focus goes to the group's heading (the line stays above).
  const afterDelete = () => { if (templates.length <= 1) headRef.current?.focus() }
  return (
    <section className={classes.section} aria-labelledby="js-plain-templates" data-plain-templates="">
      <h3 id="js-plain-templates" ref={headRef} tabIndex={-1} className={classes.head}>{PLAIN_COPY.title}</h3>
      <p className={classes.lead}>{PLAIN_COPY.lead}</p>
      <PlainMessage message={message} />
      {error ? (
        <div className={styles.memberError} role="alert">Couldn't load your plain templates.</div>
      ) : isLoading ? (
        <div className={styles.memberNote}>Loading your plain templates…</div>
      ) : templates.length === 0 ? (
        <p className={styles.memberNote} data-testid="plain-templates-empty">{PLAIN_COPY.empty}</p>
      ) : (
        <>
          <DailyTemplateSelect templates={templates} selectRef={dailyRef} />
          <PlainRows templates={templates} manage asCards={false} onPick={onUse} onPreview={setPreview} busy={busy}
            say={setMessage} onDeleted={afterDelete} />
        </>
      )}
      <TemplatePreview
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.label}
        subtitle={preview?.subtitle}
        body={preview?.body}
        onUse={preview?.onUse}
        showUse={Boolean(onUse)}
        busy={busy}
        loading={Boolean(preview?.loading)}
        loadError={preview?.loadError || null}
      />
    </section>
  )
}

// `onMatches(n)`: how many of the member's templates this shows for the picker's search (null while the list is
// loading), derived from the list, never from the cards drawn.
export default function MemberTemplates({ onPick, busy = false, query = '', onPreview = () => {}, onMatches, onManage = null }) {
  const { templates, error, isLoading } = useMemberTemplates()
  const { prefs } = usePreferences()
  const [message, setMessage] = useState(null)
  const headRef = useRef(null)
  const q = query.trim().toLowerCase()
  const visible = q ? templates.filter((t) => t.name.toLowerCase().includes(q)) : templates
  const matchCount = isLoading ? null : visible.length
  useEffect(() => { onMatches?.(matchCount) }, [matchCount, onMatches])
  useEffect(() => () => { onMatches?.(0) }, [onMatches])
  const dailyId = prefs?.[DAILY_TEMPLATE_PREF] || ''
  const dailyName = (dailyId && templates.find((t) => t.id === dailyId)?.name) || PLAIN_COPY.none
  const canManage = typeof onManage === 'function'

  return (
    <section className={styles.family} aria-labelledby="member-templates-label">
      <div className={styles.memberHead}>
        <h3 id="member-templates-label" className={styles.famLabel} ref={headRef} tabIndex={-1}>Your templates</h3>
        {canManage && templates.length > 0 && (
          <button type="button" className={styles.linkBtn} onClick={() => onManage('plain')}
            aria-label="Manage your plain templates">
            Manage
          </button>
        )}
      </div>
      <PlainMessage message={message} />
      {error ? (
        <div className={styles.memberError} role="alert">Couldn't load your templates.</div>
      ) : isLoading ? (
        <div className={styles.memberNote}>Loading your templates…</div>
      ) : templates.length === 0 ? (
        <div className={styles.memberNote}>
          Save any note as a template from its menu, and it appears here.
        </div>
      ) : (
        <>
          {canManage ? (
            <p className={styles.dailyLine} data-daily-line="">
              {`Daily notes start from: ${dailyName}. `}
              <button type="button" className={styles.linkBtn} onClick={() => onManage('daily')}
                aria-label="Change what daily notes start from">
                Change
              </button>
            </p>
          ) : <DailyTemplateSelect templates={templates} hintId="js-daily-template-hint-picker" />}
          {q && visible.length === 0 && (
            <p className={styles.memberNote} role="status">No saved templates match “{query.trim()}”.</p>
          )}
          <PlainRows templates={visible} manage={!canManage} onPick={onPick} onPreview={onPreview} busy={busy}
            say={setMessage} onDeleted={() => { if (templates.length <= 1) headRef.current?.focus() }} />
        </>
      )}
    </section>
  )
}
