/**
 * ⛔⛔ WHICH SCHEMA INTRODUCED EACH NOTE TYPE — THE CLIENT HALF OF ONE FACT.
 *
 * ⛔⛔ NEVER REVERTED WITH THE FEATURES. This file, its server twin and the
 * guard that reads them ride ONE commit that a rollback keeps
 * (`docs/notebook/wave5-rollback.md`).
 *
 * The hazard (H14): TipTap reads a stored body whole or not at all. One node or
 * mark type the loading editor's schema lacks and the note opens EMPTY; the
 * next save writes that empty document over it. So every body write DECLARES
 * the newest schema this bundle can read (`X-UCT-Notebook-Schema`), and the
 * server refuses a write whose client is older than the STORED body
 * (`api/services/journal_two/notebook_schema.py::check_body_write`, 409).
 *
 * ⛔ ONE FACT IN TWO FILES. The server half is `NOTEBOOK_TYPE_SCHEMA` in
 * `notebook_schema.py`; `tests/test_notebook_schema_guard.py` PARSES the table
 * below and asserts equality. `notebookSchema.rail.test.js` asserts every name
 * the LIVE editor schema registers is in it, so a node added without an entry
 * goes red.
 *
 * ⛔ NEVER REMOVE AN ENTRY. A forgotten type reads as 0 on the server — "every
 * client can read this" — which is the lie this table exists to stop.
 * Keep one `name: N,` per line: the Python rail parses that shape.
 */
export const NOTEBOOK_SCHEMA_HEADER = 'X-UCT-Notebook-Schema'

export const NOTEBOOK_TYPE_SCHEMA = Object.freeze({
  // ── 0: production's schema before wave 5 (origin/master 3207690b4) — nodes ──
  attachmentChip: 0,
  blockquote: 0,
  bulletList: 0,
  callout: 0,
  codeBlock: 0,
  doc: 0,
  documentExcerpt: 0,
  financialFact: 0,
  hardBreak: 0,
  heading: 0,
  horizontalRule: 0,
  image: 0,
  listItem: 0,
  noteLink: 0,
  orderedList: 0,
  paragraph: 0,
  table: 0,
  tableCell: 0,
  tableHeader: 0,
  tableRow: 0,
  taskItem: 0,
  taskList: 0,
  text: 0,
  toggle: 0,
  toggleContent: 0,
  toggleSummary: 0,
  videoTimestamp: 0,
  widgetEmbed: 0,
  // ── 0: marks ──
  bold: 0,
  code: 0,
  italic: 0,
  link: 0,
  strike: 0,
  textStyle: 0,
  underline: 0,
  // ── 1: G-064 (#183) ──
  askCitation: 1,
  askInsert: 1,
  // ── 1: wave 5 ──
  blockMath: 1,
  inlineMath: 1,
  highlight: 1,
  textColor: 1,
})

/**
 * The newest schema a bundle whose editor has `schema` can READ: the largest N
 * such that EVERY type the table introduces at or below N is registered.
 *
 * ⛔ DERIVED FROM THE LIVE SCHEMA, NEVER `max(table)`. The table keeps every
 * entry through a rollback (see above), so after "revert the features, keep this
 * commit" it still lists types the reverted editor cannot read. `max(table)`
 * would then declare 1 for a bundle that blanks a formula — the guard defeated
 * by the very rollback it exists for. Derived, a missing type pulls the
 * declaration down below its level, the safe direction: the server refuses, the
 * note is untouched.
 */
export function deriveDeclaredSchema(schema) {
  const registered = (name) => Boolean(schema?.nodes?.[name] || schema?.marks?.[name])
  let declared = Math.max(...Object.values(NOTEBOOK_TYPE_SCHEMA))
  for (const [name, level] of Object.entries(NOTEBOOK_TYPE_SCHEMA)) {
    if (!registered(name)) declared = Math.min(declared, level - 1)
  }
  return Math.max(declared, 0)
}

let declaredPromise = null

/**
 * This bundle's declaration, from its real editor schema. Loaded lazily: the
 * writers that need it (the note PUT, the outbox, the playbook save) must not
 * drag the editor into modules that only list notes. ⛔ A failure answers 0 —
 * the OLDEST client — and is not cached, so the next write asks again.
 */
export function declaredNotebookSchema() {
  if (!declaredPromise) {
    declaredPromise = import('./tiptap')
      .then((mod) => deriveDeclaredSchema(mod.editorSchema()))
      .catch(() => { declaredPromise = null; return 0 })
  }
  return declaredPromise
}

/** The header every body write carries. */
export async function notebookSchemaHeaders() {
  return { [NOTEBOOK_SCHEMA_HEADER]: String(await declaredNotebookSchema()) }
}
