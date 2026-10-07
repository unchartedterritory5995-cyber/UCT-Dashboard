/**
 * Wave 13 lane 13B — "Save a snapshot note": one click freezes My Playbook into a Notebook note.
 *
 * ⛔ FROZEN, BY CONSTRUCTION. The note holds the numbers as TEXT (a table and a list): no live
 * widget, no embed, nothing that re-reads the server. Tomorrow's playbook changes My Playbook,
 * never this note. `playbookSnapshot.test.js` holds that: the doc carries only static node types,
 * and a later payload leaves an already-built doc byte-identical.
 *
 * ⛔ ONE CREATE DOOR, like 13A's review note (`planReview.js`): `createNoteViaApi`, landed with
 * `settleNoteWrite`. Nothing here writes an existing note.
 *
 * The note never names an Entry or a Stop, so 13A's matcher can never read it as a trade plan.
 */
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { cardStats, findingText, statText } from './playbookFormat'

export const SNAPSHOT_TAG = 'playbook-snapshot'

/** The only node types a snapshot may contain. */
export const SNAPSHOT_NODE_TYPES = Object.freeze([
  'doc', 'heading', 'paragraph', 'text', 'table', 'tableRow', 'tableHeader', 'tableCell', 'bulletList', 'listItem',
])

const text = (s) => ({ type: 'text', text: String(s) })
const para = (s) => (s ? { type: 'paragraph', content: [text(s)] } : { type: 'paragraph' })
const heading = (level, s) => ({ type: 'heading', attrs: { level }, content: [text(s)] })
const cell = (kind, s) => ({ type: kind, content: [para(s)] })
const row = (kind, cells) => ({ type: 'tableRow', content: cells.map((c) => cell(kind, c)) })
const bullets = (items) => ({
  type: 'bulletList',
  content: items.map((s) => ({ type: 'listItem', content: [para(s)] })),
})

const HEAD = ['Setup', 'Trades', 'Win rate', 'Avg R', 'Expectancy', 'Profit factor', 'Total P&L']

/** The snapshot's body. Pure: the payload in, a TipTap doc out. */
export function buildSnapshotDoc(payload) {
  const asOf = String(payload?.asOf || '').slice(0, 10)
  const setups = Array.isArray(payload?.setups) ? payload.setups : []
  const content = [
    heading(2, `My Playbook, ${asOf}`),
    para(`Frozen on ${asOf}. These numbers never update; open My Playbook for today's.`),
  ]
  if (setups.length) {
    content.push({
      type: 'table',
      content: [
        row('tableHeader', HEAD),
        ...setups.map((rec) => {
          const stats = Object.fromEntries(cardStats(rec).map((s) => [s.key, statText(s.stat, s.fmt)]))
          return row('tableCell', [rec.setup, String(rec.tradeCount), stats.winRate, stats.avgR, stats.expectancy,
            stats.profitFactor, stats.totalPnl])
        }),
      ],
    })
  } else {
    content.push(para('No tagged setups yet.'))
  }
  const untagged = payload?.untagged?.count || 0
  if (untagged) content.push(para(`${untagged} closed trade${untagged === 1 ? '' : 's'} had no setup and sit on no row.`))

  const pat = payload?.patterns
  if (pat) {
    content.push(heading(3, 'What I wrote before losses vs wins'))
    content.push(para(pat.caption || 'Patterns, not proof'))
    if (pat.status === 'ok' && pat.findings?.length) content.push(bullets(pat.findings.map(findingText)))
    else content.push(para(pat.message || 'No pattern stood out.'))
  }
  return { type: 'doc', content }
}

/** Create the snapshot note and land its revision. Returns the created note. */
export async function createPlaybookSnapshotNote(payload) {
  const asOf = String(payload?.asOf || '').slice(0, 10)
  const created = await createNoteViaApi({
    title: `My Playbook snapshot ${asOf}`.trim(),
    bodyJson: buildSnapshotDoc(payload),
    tags: [SNAPSHOT_TAG],
  })
  await settleNoteWrite(created?.id ?? null, created)
  return created
}
