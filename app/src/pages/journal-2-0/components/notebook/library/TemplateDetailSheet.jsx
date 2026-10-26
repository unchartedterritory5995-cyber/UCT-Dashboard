// Notebook widgets phase 2, wave 11 (Task 11.16): a Template library item's detail, with the member's own data.
//
// Opened by a Template library card's "Preview". It shows, in order:
//   * the template's outline (its headings and prompts), drawn by the picker's own read-only renderer (`DocBody`,
//     TemplatePreview.jsx), from the listed item (`GET /template-gallery/{id}`);
//   * "Preview with your data": ONE `previewMine(galleryId)` call on open (W11-R12). Each widget card is drawn by the
//     placed widget's own read-only body (`BuiltWidgetEmbed`, loaded on demand), labelled "Sample data" when the
//     server says `sample` (fewer than 5 trades); a card the server could not run is ITS sentence, as given
//     ("Pick a setup to see this widget."); each routine and tracker is its name, its items and the day it binds to
//     (`bindWords`), never a tick or a value (no day state, W11-R12);
//   * the credit line, exactly as the server wrote it (`credit`, W11-R24; nothing here builds one);
//   * one "Use this template" button, which opens the adoption sheet (`openAdoptSheet({galleryId, kind: 'template'})`)
//     where the member makes it theirs.
// ⛔ Opening it writes nothing: one GET for the outline and one `preview-mine`. A refusal is the server's own sentence
//    (a rate refusal reads "Too many previews in an hour. Try again later.", the preview scope's own words).
// ⛔ LAZY. Rendered only by TemplateLibrarySection.jsx (itself a lazy chunk); the adoption sheet and the built views
//    load on demand.
import { Suspense, useEffect, useId, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import { previewMine } from '../../../lib/templateLibrary'
import { getGalleryTemplate } from '../../../lib/templateGallery'
import { bindWords } from '../../../lib/templateSlots'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { doorLostSentence } from '../../../lib/notebookWidgetsFlags'
import lazyChunk from '../../../lib/lazyChunk'
import { DocBody } from '../TemplatePreview'
import { SAMPLE_RIBBON } from '../widgetBuilder/ExampleCard'
import { kindWords } from '../routines/toolEditorLib'
import styles from './library.module.css'

const BuiltWidgetEmbed = lazyChunk(() => import('../widgets/BuiltWidgetEmbed'))

export const USE_TEMPLATE_LABEL = 'Use this template'
export const DATA_HEADING = 'Preview with your data'
export const LOADING_SENTENCE = 'Getting your preview ready…'
export const OUTLINE_LOADING = 'Loading the outline…'
export const OUTLINE_FAILED = "Couldn't load this template's outline."

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const listOf = (v) => (Array.isArray(v) ? v : [])
const text = (v) => (typeof v === 'string' ? v : '')

function DataCard({ card }) {
  const title = text(card.title)
  const sentence = text(card.sentence).trim()
  const payload = isRecord(card.payload) ? card.payload : null
  return (
    <li className={styles.previewCard} data-preview-card={text(card.slot)}>
      {title && <p className={styles.previewTitle}>{title}</p>}
      {sentence ? (
        <p className={styles.hint}>{sentence}</p>
      ) : payload && (
        <Suspense fallback={<p className={styles.hint}>{LOADING_SENTENCE}</p>}>
          <BuiltWidgetEmbed attrs={widgetEmbedNode('builtWidget', payload).attrs} height={180} shareView />
        </Suspense>
      )}
      {card.sample === true && !sentence && <p className={styles.sampleTag} data-sample="">{SAMPLE_RIBBON}</p>}
    </li>
  )
}

/** A routine or tracker slot: its name, items and bound day. Only these fields are read, so a tick, a value or a
 *  day state the answer might carry can never be drawn here. */
function DataTool({ tool }) {
  const items = listOf(tool.items).map((it) => text(isRecord(it) ? it.text : it)).filter((t) => t.trim())
  const day = bindWords(tool.bind)
  return (
    <li className={styles.previewCard} data-preview-tool={text(tool.slot)}>
      <p className={styles.previewTitle}>{text(tool.name)}</p>
      {tool.kind === 'tracker' && typeof tool.trackerKind === 'string' && tool.trackerKind && (
        <p className={styles.hint}>{kindWords(tool.trackerKind)}</p>
      )}
      {items.length > 0 && (
        <ul className={styles.list}>{items.map((t, i) => <li key={i} className={styles.travelRow}>{t}</li>)}</ul>
      )}
      {day && <p className={styles.hint}>{day}</p>}
    </li>
  )
}

/**
 * @param item     the listed template (a Template library row)
 * @param onClose  Close, Escape, or the hand-over to the adoption sheet
 * @param navigate the app router's navigate, handed to the adoption sheet (a template's Use opens the new note)
 */
export default function TemplateDetailSheet({ item, onClose, navigate = null }) {
  const uid = useId()
  const id = item?.id
  const [outline, setOutline] = useState({ status: 'loading', body: null })
  const [data, setData] = useState(null)          // null while asking, then the library's answer {ok, data | code, message}
  const [doorProblem, setDoorProblem] = useState('')

  useEffect(() => {
    let alive = true
    setOutline({ status: 'loading', body: null })
    setData(null)
    getGalleryTemplate(id).then(
      (t) => { if (alive) setOutline({ status: 'ok', body: t?.bodyJson || null }) },
      () => { if (alive) setOutline({ status: 'error', body: null }) },
    )
    previewMine(id).then((out) => { if (alive) setData(out) })
    return () => { alive = false }
  }, [id])

  const use = async () => {
    setDoorProblem('')
    try {
      const mod = await import('./openAdoptSheet')
      onClose?.()
      mod.openAdoptSheet({ galleryId: id, kind: 'template', ...(typeof navigate === 'function' ? { navigate } : {}) })
    } catch {
      setDoorProblem(doorLostSentence())
    }
  }

  const answer = data?.ok ? data.data : null
  const credit = text(answer?.credit).trim()
  const cards = listOf(answer?.cards).filter(isRecord)
  const tools = listOf(answer?.tools).filter(isRecord)

  return (
    <Sheet open onClose={onClose} title={text(item?.title) || 'Template'} labelledByTitle variant="auto" maxWidth={640}>
      <div className={styles.sheet} data-template-detail={id}>
        {credit && <p className={styles.credit} data-credit="">{credit}</p>}
        <section className={styles.section} aria-label="Outline">
          {outline.status === 'loading' && <p className={styles.hint} role="status">{OUTLINE_LOADING}</p>}
          {outline.status === 'error' && <p className={styles.notice} role="alert">{OUTLINE_FAILED}</p>}
          {outline.status === 'ok' && <DocBody body={outline.body} />}
        </section>
        <section className={styles.section} aria-labelledby={`${uid}-data`}>
          <h3 className={styles.subheading} id={`${uid}-data`}>{DATA_HEADING}</h3>
          {data === null && <p className={styles.hint} role="status">{LOADING_SENTENCE}</p>}
          {data && !data.ok && <p className={styles.notice} role="alert" data-refusal={data.code}>{data.message}</p>}
          {cards.length > 0 && <ul className={styles.previewList}>{cards.map((c, i) => <DataCard key={text(c.slot) || i} card={c} />)}</ul>}
          {tools.length > 0 && <ul className={styles.previewList}>{tools.map((t, i) => <DataTool key={text(t.slot) || i} tool={t} />)}</ul>}
        </section>
        {doorProblem && <p className={styles.notice} role="alert">{doorProblem}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose}>Close</button>
          <button type="button" className={styles.btnPrimary} onClick={use}>{USE_TEMPLATE_LABEL}</button>
        </div>
      </div>
    </Sheet>
  )
}
