/**
 * Notebook-only TipTap builders for the built-in template catalog (wave 12, lane 12B):
 * toggle, callout, table and numbered list, plus the walkthrough every template ends with.
 *
 * ⛔ NOTEBOOK ONLY. `app/src/lib/tiptapDocBuilders.js` is shared with the Model Book
 * (`pages/modelbook/builder/upbTemplates.js`) and stays headings/paragraphs/lists. These
 * builders live here so nothing the Notebook adds reaches that second consumer.
 *
 * ⛔ NO NEW NODE TYPE. Every type below (`toggle`, `toggleSummary`, `toggleContent`,
 * `callout`, `table`, `tableRow`, `tableHeader`, `tableCell`, `orderedList`) is already in
 * the schema table at level 0 (`lib/notebookSchema.js`), so every bundle since before wave 5
 * reads it. The catalog's rail (`notebookTemplates.test.js`) derives that from the table and
 * builds every template through the real editor schema (`notebookTemplates.buildable.test.js`).
 *
 * ⛔ KEEP THIS FILE IMPORTABLE BY A PLAIN BUNDLE: its only import is the shared builders.
 * `tests/test_notebook_builtin_templates_create.py` bundles the catalog with esbuild and
 * evaluates it in Node, so a Vite-only or editor import here would turn that rail red.
 */
import { p } from '../../../lib/tiptapDocBuilders'

/** The summary of the walkthrough toggle -- also how the catalog recognises it. */
export const WALKTHROUGH_TITLE = 'How to use this template'

const textOf = (s) => (s ? [{ type: 'text', text: s }] : undefined)

/** A paragraph that may be empty (a text node may never carry ''). */
const para = (s) => p(s || undefined)

/**
 * A toggle: `summary` is the always-visible line, `blocks` the collapsible body.
 * `open: false` writes it collapsed. An empty body still gets one empty paragraph,
 * because `toggleContent` is `block+`.
 */
export function toggle(summary, blocks, { open = false } = {}) {
  const summaryNode = { type: 'toggleSummary' }
  const inline = textOf(summary)
  if (inline) summaryNode.content = inline
  return {
    type: 'toggle',
    attrs: { open: Boolean(open) },
    content: [
      summaryNode,
      { type: 'toggleContent', content: blocks && blocks.length ? blocks : [para()] },
    ],
  }
}

/**
 * A callout in one of the editor's styles (`calloutNode.js` CALLOUT_VARIANTS:
 * note / info / success / warning / danger). `body` is a string (one paragraph) or
 * an array of blocks.
 */
export function callout(variant, body) {
  const blocks = Array.isArray(body) ? body : [para(body)]
  return { type: 'callout', attrs: { variant }, content: blocks.length ? blocks : [para()] }
}

const cell = (type, s) => ({ type, content: [para(s)] })

/**
 * A table whose first row is a header row. `rows` are arrays of strings; '' (or a
 * missing cell) is an empty cell to write into. Every row is padded to the header's
 * width, so a short row can never make a ragged table.
 */
export function table(header, rows = []) {
  const width = header.length
  const row = (cells, type) => ({
    type: 'tableRow',
    content: Array.from({ length: width }, (_, i) => cell(type, cells[i] || '')),
  })
  return { type: 'table', content: [row(header, 'tableHeader'), ...rows.map((r) => row(r, 'tableCell'))] }
}

/** A two-column "what / value" table: one row per label, the value left to fill in. */
export const metricTable = (labels, header = ['Metric', 'Value']) =>
  table(header, labels.map((label) => [label, '']))

/** A numbered list from plain strings. */
export const numbered = (items) => ({
  type: 'orderedList',
  attrs: { start: 1 },
  content: items.map((s) => ({ type: 'listItem', content: [para(s)] })),
})

/** The walkthrough block: a COLLAPSED toggle titled WALKTHROUGH_TITLE, its steps numbered. */
export const walkthroughToggle = (steps) => toggle(WALKTHROUGH_TITLE, [numbered(steps)], { open: false })

function summaryText(node) {
  const s = (node?.content || []).find((c) => c?.type === 'toggleSummary')
  return (s?.content || []).map((c) => (c?.type === 'text' ? c.text || '' : '')).join('')
}

/** Is `node` the walkthrough toggle (and not some other toggle a template writes)? */
export function isWalkthroughNode(node) {
  return Boolean(node) && node.type === 'toggle' && summaryText(node) === WALKTHROUGH_TITLE
}
