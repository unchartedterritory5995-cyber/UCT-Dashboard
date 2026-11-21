// app/src/components/chart/builder/memberPane/memberDoorProtocol.js
//
// ⭐⭐ THE PASTE WORKER — WHAT CROSSES BETWEEN THE PAGE AND THE MEMBER DOOR'S WORKER, a leaf module (it imports
// nothing), so the page can speak the protocol without loading what the worker runs.
//
// The worker (`memberDoorWorker.js`, handler `memberDoorWorkerCore.js`) answers three kinds of job, each over the page's
// state imaged into it (`memberDoorImage.js`):
//   · MEMBER_DOOR_JOB     the chart door's build of a script (`memberPaneDefinition`);
//   · INSPECT_JOB         PasteBox's report of a text (`inspectSource` / `inspectPine`);
//   · INSPECT_LIBRARY_JOB the report of a paste of several scripts (`libraryIntake.inspectLibrary`).
//
// ⛔ AN ANSWER CROSSES FAITHFULLY. A structured clone keeps every own ENUMERABLE field, a Map, a Set and an object
// reached twice as one object; it drops a NON-ENUMERABLE own property, and the translator writes those on purpose (a
// parameter's id on a tree literal, `__uctParamId`; a row's handoffs, `_displaceParams`, ...), read on the page by
// what PasteBox and the sheet build from the report. So the worker sends, beside the answer, every non-enumerable own
// property it holds (`hidden`: the object, the key, the value and its descriptor's flags), and the page puts each one
// back exactly so (`restoreFaithful`) before anyone reads the answer: the same object, field for field, as the
// synchronous call returned. A property the clone cannot carry at all (a function, a symbol key) is counted
// (`lost`), never silently dropped from the count.

/** The message kind of a chart door build. */
export const MEMBER_DOOR_JOB = 'member-door'
/** The message kind of PasteBox's report of one text. */
export const INSPECT_JOB = 'inspect'
/** The message kind of the report of a paste holding several scripts. */
export const INSPECT_LIBRARY_JOB = 'inspect-library'
/** The message kind of the editor status panel's status (`editorStatus`) of a report and the chart door's answer. */
export const STATUS_JOB = 'editor-status'

/**
 * The page's side of a faithful answer: puts back every non-enumerable own property the worker recorded (each
 * `{node, key, value, writable, configurable}`, `node` being an object INSIDE `value`, which the structured clone kept
 * as the same object), and returns the answer. A record that names no object is skipped.
 * @param {{value: any, hidden?: object[]}} faithful
 */
export function restoreFaithful(faithful) {
  const f = faithful && typeof faithful === 'object' ? faithful : { value: faithful }
  const hidden = Array.isArray(f.hidden) ? f.hidden : []
  for (const h of hidden) {
    if (!h || !h.node || typeof h.node !== 'object' || typeof h.key !== 'string') continue
    Object.defineProperty(h.node, h.key, {
      value: h.value, enumerable: false, writable: h.writable !== false, configurable: h.configurable !== false,
    })
  }
  // ⭐ the table is kept with the answer, so the answer can be handed on to another job as faithfully as it came
  // (`hiddenTableOf`): a structured clone of `{value, hidden}` keeps every `node` inside `value`, without a walk here
  if (hidden.length && f.value && typeof f.value === 'object') TABLES.set(f.value, hidden)
  return f.value
}

const TABLES = new WeakMap()
/** The non-enumerable properties an answer that crossed carried (`restoreFaithful`'s `hidden`), or null. */
export function hiddenTableOf(value) {
  return value && typeof value === 'object' ? (TABLES.get(value) || null) : null
}
