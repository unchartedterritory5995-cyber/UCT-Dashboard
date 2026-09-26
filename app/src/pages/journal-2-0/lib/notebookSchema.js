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
 * ⛔ KEEP THIS FILE IMPORTABLE BY PLAIN NODE: no static imports. The Python rail
 * reads the table (and `SCHEMA_REFUSAL_DETAIL`) by importing this module in
 * Node, so any layout of the table is read exactly as the product reads it. A
 * static import of a Vite-only module would turn that rail red.
 *
 * ⛔⛔ B1 (wave 5, final review) — THE DECLARATION DESCRIBES THE BUNDLE THAT
 * WROTE THE BODY, NOT THE ONE THAT SENDS IT. A production tab that opened a
 * wave-5 note as empty queued that empty body in the offline layer; a NEWER tab
 * then sent it, declaring its own level, and the server let it through. So every
 * capture that another page load may send later (the durable record, its outbox
 * entry, the crash draft) carries `writtenSchema` — the level of the editor that
 * produced it — and every door that FORWARDS a body declares
 * `min(writtenSchema ?? 0, this bundle's level)` (`notebookSchemaHeaders(
 * { writtenSchema })`). A capture with no stamp — everything written before
 * stamps existed — is 0.
 */
export const NOTEBOOK_SCHEMA_HEADER = 'X-UCT-Notebook-Schema'

/**
 * The server's refusal, verbatim — `notebook_schema.py::REFUSAL_DETAIL`. ⛔ One
 * sentence in two files, pinned equal by `tests/test_notebook_schema_guard.py`
 * (which reads this constant through Node). The editor tells a schema refusal
 * from a compare-and-set conflict by it (`isSchemaRefusal`), and the locked
 * editor shows it (`noteContentGuard.js` derives its message from this one).
 */
export const SCHEMA_REFUSAL_DETAIL = 'This note has content from a newer version of the app. Reload to edit it.'

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

/**
 * A capture's stamp, read. ⛔ A stamp that is missing, or is anything but a
 * non-negative integer, is 0 — the OLDEST writer. Every record, entry and draft
 * written before stamps existed has none, and each of them may hold an empty
 * stand-in for a note its writer could not read.
 */
export function writtenSchemaOf(stamp) {
  return Number.isInteger(stamp) && stamp >= 0 ? stamp : 0
}

/** The editor holds its OWN read of the server copy: nothing forwarded. */
export const OWN_READ = null

/**
 * The stamp for a body an editor holds right now: the level `schema` can read —
 * and never more than the level of the capture that body was restored from.
 *
 * @param carried  `OWN_READ` (null) when the body is this editor's read of the
 *                 server copy; otherwise the stamp of the recovered capture it
 *                 came from. ⛔ Only the `OWN_READ` sentinel means "own read":
 *                 any other value — `undefined` from an unstamped record
 *                 included — is read as a stamp, and a missing one is 0.
 */
export function bodyWrittenSchema(schema, carried = OWN_READ) {
  const own = deriveDeclaredSchema(schema)
  return carried === OWN_READ ? own : Math.min(writtenSchemaOf(carried), own)
}

/**
 * The header every body write carries.
 *
 *  · no argument — a body THIS bundle produced from its own read of the note
 *    (the importer's rewrite, the enrichment undo, the widget editor): this
 *    bundle's derived level.
 *  · `{ writtenSchema }` — a body FORWARDED from a capture (the outbox drain,
 *    the editor sending recovered words): `min(writtenSchema ?? 0, derived)`.
 *
 * ⛔ Only OMITTING the argument means "my own read". An object without a usable
 * stamp — an unstamped outbox entry — declares 0, and the server then refuses it
 * on a note that holds a level its writer could not read (B1).
 */
export async function notebookSchemaHeaders(forwarded) {
  const derived = await declaredNotebookSchema()
  const level = forwarded === undefined
    ? derived
    : Math.min(writtenSchemaOf(forwarded?.writtenSchema), derived)
  return { [NOTEBOOK_SCHEMA_HEADER]: String(level) }
}

/**
 * Was this failed write the SCHEMA refusal (not a compare-and-set conflict)?
 * Both are 409s; the refusal's detail is `SCHEMA_REFUSAL_DETAIL`, which the note
 * PUT client (`useJ2Note.update`) and the outbox's `sendNoteUpdate` put on the
 * thrown error's `message`. ⛔ A retry cannot fix it — the same body from the
 * same writer is refused again — so the caller preserves both copies instead.
 */
export function isSchemaRefusal(err) {
  return err?.status === 409 && err?.message === SCHEMA_REFUSAL_DETAIL
}
