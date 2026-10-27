// Notebook widgets phase 2, wave 11: the ONE renderer of a `preview-mine` answer's cards and tools (Task 11.16 fix
// round 1, review m-1). The adoption sheet (AdoptSheet.jsx) and the template detail (TemplateDetailSheet.jsx) both
// draw the server's preview through these two components, so the words a card or a routine shows are decided once.
//   * PreviewCard: the card's title; its sentence as given ("Pick a setup to see this widget.") when the server could
//     not run it; else its payload, drawn by `drawPayload` (the adoption sheet's small thumbnail by default; the
//     detail hands in the placed widget's read-only body); "Sample data" only when the server says `sample`.
//   * PreviewTool: a routine's or tracker's name, its items, a tracker's kind, and the day it binds to: the server's
//     own `forDayLabel` ("For the week of Oct 19", W11-R14) when it sent one, else `bindWords(bind)`. Only these fields
//     are read, so a tick, a value or a day state the answer might carry is never drawn (W11-R12).
// ⛔ LAZY. Imported only by the two lazy sheets above.
import { bindWords } from '../../../lib/templateSlots'
import MiniPreview from '../widgetBuilder/miniPreview'
import { SAMPLE_RIBBON } from '../widgetBuilder/ExampleCard'
import { kindWords } from '../routines/toolEditorLib'
import styles from './library.module.css'

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const listOf = (v) => (Array.isArray(v) ? v : [])
const text = (v) => (typeof v === 'string' ? v : '')

const thumbnail = (payload) => <MiniPreview payload={payload} />

export function PreviewCard({ card, drawPayload = thumbnail }) {
  const title = text(card.title)
  const sentence = text(card.sentence).trim()
  const payload = isRecord(card.payload) ? card.payload : null
  return (
    <li className={styles.previewCard} data-preview-card={text(card.slot)}>
      {title && <p className={styles.previewTitle}>{title}</p>}
      {sentence ? <p className={styles.hint}>{sentence}</p> : payload && drawPayload(payload)}
      {card.sample === true && !sentence && <p className={styles.sampleTag} data-sample="">{SAMPLE_RIBBON}</p>}
    </li>
  )
}

/** The bound day in words: the server's `forDayLabel`, else the bind's words. */
export function toolDayWords(tool) {
  return text(tool?.forDayLabel).trim() || bindWords(tool?.bind)
}

export function PreviewTool({ tool }) {
  const items = listOf(tool.items).map((it) => text(isRecord(it) ? it.text : it)).filter((t) => t.trim())
  const day = toolDayWords(tool)
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
