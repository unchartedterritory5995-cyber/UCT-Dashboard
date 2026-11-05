// Notebook widgets phase 2, wave 11 (Task 11.16): a Template library item's detail, with the member's own data.
//
// Opened by a Template library card's "Preview". It shows, in order:
//   * the template's outline (its headings and prompts), drawn by the picker's own read-only renderer (`DocBody`,
//     TemplatePreview.jsx), from the listed item (`GET /template-gallery/{id}`);
//   * "Preview with your data": ONE `previewMine(galleryId)` call on open (W11-R12). Each widget card is drawn by the
//     placed widget's own read-only body (`BuiltWidgetEmbed`, loaded on demand), labelled "Sample data" when the
//     server says `sample` (fewer than 5 trades); a card the server could not run is ITS sentence, as given
//     ("Pick a setup to see this widget."); each routine and tracker is its name, its items and the day it binds to
//     (the server's `forDayLabel`, else `bindWords`), never a tick or a value (no day state, W11-R12). Cards and tools
//     are drawn by the ONE renderer the adoption sheet uses too (PreviewParts.jsx, fix round 1 m-1);
//   * the credit line, exactly as the server wrote it (`credit`, W11-R24; nothing here builds one);
//   * Audit 2026-11-05, spec S7/S9 (M8): "Use" makes the note at once (libraryUse.js's
//     `useLibraryTemplate`, the one one-press Use), "Customize first" beside it opens the adoption sheet, and the
//     section's "Also start this every weekday" checkbox is shown here too (one value, the section's). It was "Use this
//     template", which opened the adoption sheet as a second step ("Make it yours", then Use again).
// ⛔ Opening it writes nothing: one GET for the outline and one `preview-mine`. A refusal is the server's own sentence
//    (a rate refusal reads "Too many previews in an hour. Try again later.", the preview scope's own words).
// ⛔ LAZY. Rendered only by TemplateLibrarySection.jsx (itself a lazy chunk); the adoption sheet and the built views
//    load on demand.
import { Suspense, useEffect, useId, useRef, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import { previewMine } from '../../../lib/templateLibrary'
import { getGalleryTemplate } from '../../../lib/templateGallery'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import lazyChunk from '../../../lib/lazyChunk'
import { DocBody } from '../TemplatePreview'
import { outlineWithBlockNames, previewSlotNames } from '../../../lib/templateSlots'
import { PreviewCard, PreviewTool } from './PreviewParts'
import { CUSTOMIZE_LABEL, MAKING_SENTENCE, START_LABEL, USE_LABEL, openCustomize, useLibraryTemplate } from './libraryUse'
import styles from './library.module.css'

const BuiltWidgetEmbed = lazyChunk(() => import('../widgets/BuiltWidgetEmbed'))

// S7 (one vocabulary): "Use this template" is "Use".
export const USE_TEMPLATE_LABEL = USE_LABEL
export const DATA_HEADING = 'Preview with your data'
export const LOADING_SENTENCE = 'Getting your preview ready…'
export const OUTLINE_LOADING = 'Loading the outline…'
export const OUTLINE_FAILED = "Couldn't load this template's outline."
// The footer's dismiss button. ⛔ Not "Close": the Sheet's header × is already the button named "Close", and two
// controls with one name are indistinguishable in a screen reader's list. "Cancel" beside the primary action is the
// picker's own built-in preview's word (TemplatePreview.jsx: Cancel when a Use button sits beside it).
export const CANCEL_LABEL = 'Cancel'

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const listOf = (v) => (Array.isArray(v) ? v : [])
const text = (v) => (typeof v === 'string' ? v : '')

/** A card's payload in the placed widget's own read-only body (loaded on demand). */
const drawBuilt = (payload) => (
  <Suspense fallback={<p className={styles.hint}>{LOADING_SENTENCE}</p>}>
    <BuiltWidgetEmbed attrs={widgetEmbedNode('builtWidget', payload).attrs} height={180} shareView />
  </Suspense>
)

/**
 * @param item     the listed template (a Template library row)
 * @param onClose  Close, Escape, or the hand-over to the adoption sheet
 * @param navigate the app router's navigate, handed to the adoption sheet (a template's Use opens the new note)
 * @param busy     the picker is making a note: "Use this template" waits (fix round 1 m-4)
 * @param landNote `(note) => void` from the picker's host (11.20 walk D1): the new note is landed by it, which closes
 *                 the New note sheet, instead of a bare navigate that left the sheet open over the note
 * @param returnFocusTo the card's Preview button that opened this (Sheet's `returnFocusTo`): focus goes back to it on
 *                 close even after a TAP, which WebKit never focuses
 */
export default function TemplateDetailSheet({ item, onClose, navigate = null, busy = false, landNote = null, returnFocusTo = null,
  startEveryWeekday = false, onStartEveryWeekday = null }) {
  const uid = useId()
  const id = item?.id
  const [outline, setOutline] = useState({ status: 'loading', body: null })
  const [data, setData] = useState(null)          // null while asking, then the library's answer {ok, data | code, message}
  const [doorProblem, setDoorProblem] = useState('')
  const [using, setUsing] = useState(false)
  const usingRef = useRef(false)

  useEffect(() => {
    let alive = true
    setOutline({ status: 'loading', body: null })
    setData(null)
    getGalleryTemplate(id).then(
      (t) => { if (alive) setOutline({ status: 'ok', body: t?.bodyJson || null, blocks: t?.payload?.blocks }) },
      () => { if (alive) setOutline({ status: 'error', body: null }) },
    )
    previewMine(id).then((out) => { if (alive) setData(out) })
    return () => { alive = false }
  }, [id])

  // ⛔ The note lands only AFTER this sheet has closed: the page under a Sheet is inert, and focus cannot go into it.
  const landAfterClose = typeof landNote === 'function'
    ? (note) => { onClose?.(); setTimeout(() => landNote(note), 0) }
    : null
  const use = async () => {
    if (busy || usingRef.current) return
    usingRef.current = true
    setUsing(true)
    setDoorProblem('')
    try {
      const said = await useLibraryTemplate(item, { startEveryWeekday, navigate, landNote: landAfterClose })
      if (said) setDoorProblem(said)
      else onClose?.()            // landed, or Customize first opened: either way this sheet is done
    } finally {
      usingRef.current = false
      setUsing(false)
    }
  }
  const customize = async () => {
    if (busy) return
    setDoorProblem('')
    onClose?.()
    const said = await openCustomize(item, { navigate, landNote })
    if (said) setDoorProblem(said)
  }

  const answer = data?.ok ? data.data : null
  const credit = text(answer?.credit).trim()
  const cards = listOf(answer?.cards).filter(isRecord)
  const tools = listOf(answer?.tools).filter(isRecord)

  return (
    <Sheet open onClose={onClose} title={text(item?.title) || 'Template'} labelledByTitle variant="auto" maxWidth={640}
      returnFocusTo={returnFocusTo || undefined}>
      <div className={styles.sheet} data-template-detail={id}>
        {credit && <p className={styles.credit} data-credit="">{credit}</p>}
        <section className={styles.section} aria-label="Outline">
          {outline.status === 'loading' && <p className={styles.hint} role="status">{OUTLINE_LOADING}</p>}
          {outline.status === 'error' && <p className={styles.notice} role="alert">{OUTLINE_FAILED}</p>}
          {outline.status === 'ok' && <DocBody body={outlineWithBlockNames(outline.body, outline.blocks, previewSlotNames(answer))} />}
        </section>
        <section className={styles.section} aria-labelledby={`${uid}-data`}>
          <h3 className={styles.subheading} id={`${uid}-data`}>{DATA_HEADING}</h3>
          {data === null && <p className={styles.hint} role="status">{LOADING_SENTENCE}</p>}
          {data && !data.ok && <p className={styles.notice} role="alert" data-refusal={data.code}>{data.message}</p>}
          {cards.length > 0 && <ul className={styles.previewList}>{cards.map((c, i) => <PreviewCard key={text(c.slot) || i} card={c} drawPayload={drawBuilt} />)}</ul>}
          {tools.length > 0 && <ul className={styles.previewList}>{tools.map((t, i) => <PreviewTool key={text(t.slot) || i} tool={t} />)}</ul>}
        </section>
        {doorProblem && <p className={styles.notice} role="alert">{doorProblem}</p>}
        {typeof onStartEveryWeekday === 'function' && (
          <label className={styles.choice} data-start-every-weekday="">
            <input type="checkbox" checked={startEveryWeekday} onChange={(e) => onStartEveryWeekday(e.target.checked)} />
            <span>{START_LABEL}</span>
          </label>
        )}
        <p className={styles.hint} aria-live="polite">{using ? MAKING_SENTENCE : ''}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose}>{CANCEL_LABEL}</button>
          <button type="button" className={styles.linkBtn} onClick={customize} disabled={busy || using}>{CUSTOMIZE_LABEL}</button>
          <button type="button" className={styles.btnPrimary} onClick={use} disabled={busy || using}>{USE_TEMPLATE_LABEL}</button>
        </div>
      </div>
    </Sheet>
  )
}
