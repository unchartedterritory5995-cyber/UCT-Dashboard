/**
 * Wave 13 lane 13A — "Write review note": one click turns a graded trade into a Notebook note.
 *
 * The note carries the FROZEN grade table (the server's numbers, worded here, never
 * recomputed), a link to the plan note, and two frozen daily charts — one ending on the entry
 * day, one on the exit day — so the review shows what the member saw at each moment.
 *
 * ⛔ ONE CREATE DOOR. Through `createNoteViaApi` (the canonical create) and the answer is landed
 * with `settleNoteWrite`, exactly like the canvas door (`tradeCanvasCreate.js`): the revision
 * is recorded before the editor that opens the note can meet it.
 *
 * ⛔ The note is tagged `plan-review`, and the matcher skips that tag (plan_grading
 * `_window_notes`): its grade table names an Entry and a Stop, and without the tag a review
 * written today would be read as the PLAN for the next trade on the same ticker.
 */
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { buildWidgetEmbedAttrs } from './widgetEmbedCore'
import { checkDetail, checkVerdict } from './planGradeText'

export const REVIEW_TAG = 'plan-review'

const text = (s) => ({ type: 'text', text: String(s) })
const para = (...inline) => {
  const content = inline.filter(Boolean)
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}
const heading = (level, s) => ({ type: 'heading', attrs: { level }, content: [text(s)] })
const cell = (kind, s) => ({ type: kind, content: [para(s ? text(s) : null)] })
const row = (kind, cells) => ({ type: 'tableRow', content: cells.map((c) => cell(kind, c)) })

const CHECK_ROWS = [['entry', 'Entry'], ['stop', 'Stop'], ['size', 'Size'], ['target', 'Target']]

/** End of an ISO day as unix seconds (a frozen chart's `to`). */
function dayEndTs(iso) {
  const day = typeof iso === 'string' ? iso.slice(0, 10) : ''
  const t = Date.parse(`${day}T23:59:59Z`)
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

function chartNode(symbol, iso) {
  const to = dayEndTs(iso)
  if (!symbol || to == null) return null
  return { type: 'widgetEmbed', attrs: buildWidgetEmbedAttrs('chart', { symbol, tf: 'D', to }, { annotations: [] }) }
}

/** The review note's body. Pure: the grade payload and the trade in, a TipTap doc out. */
export function buildReviewDoc(grade, trade = {}) {
  const plan = grade?.plan || {}
  const checks = grade?.checks || {}
  const sym = grade?.symbol || trade.symbol || ''
  const content = [
    heading(2, `Plan vs execution: ${sym}`),
    para(text(`${grade?.side || trade.side || ''} ${trade.shares ?? ''} ${sym}, entered ${(trade.entryDate || '').slice(0, 10)} at ${trade.entryPrice ?? ''}, exited ${(trade.exitDate || '').slice(0, 10)} at ${trade.exitPrice ?? ''}.`.replace(/\s+/g, ' ').trim())),
  ]
  if (plan.noteId) {
    content.push(para(text('The plan: '), { type: 'noteLink', attrs: { noteId: plan.noteId } }))
  } else if (plan.sourceLabel) {
    content.push(para(text(`The plan: ${plan.sourceLabel}.`)))
  }
  content.push({
    type: 'table',
    content: [
      row('tableHeader', ['Check', 'Result', 'Detail']),
      ...CHECK_ROWS.map(([key, label]) => row('tableCell', [
        label, checkVerdict(key, checks[key]).word, checkDetail(key, checks[key], plan),
      ])),
    ],
  })
  content.push(para(text(`Frozen when first matched (${(plan.matchedAt || '').slice(0, 10)}). Editing the plan does not change this grade.`)))
  const entryChart = chartNode(sym, trade.entryDate)
  const exitChart = chartNode(sym, trade.exitDate)
  if (entryChart) content.push(heading(3, 'At entry'), entryChart)
  if (exitChart) content.push(heading(3, 'At exit'), exitChart)
  content.push(heading(3, 'What I would do differently'), para())
  return { type: 'doc', content }
}

/** Create the review note and land its revision. Returns the created note. */
export async function createPlanReviewNote(grade, trade = {}) {
  const sym = grade?.symbol || trade.symbol || ''
  const created = await createNoteViaApi({
    title: `Plan review: ${sym} ${(trade.exitDate || '').slice(0, 10)}`.trim(),
    bodyJson: buildReviewDoc(grade, trade),
    tags: [REVIEW_TAG],
    ...(sym ? { ticker: sym } : {}),
  })
  await settleNoteWrite(created?.id ?? null, created)
  return created
}
