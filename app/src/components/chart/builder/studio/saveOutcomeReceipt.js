// app/src/components/chart/builder/studio/saveReceipt.js
//
// ─── ⭐⭐ BATCH 1 — WHAT A SAVE ACTUALLY DID, IN ONE RECEIPT ────────────────────
//
// A conversation's Save is several steps owned by different doors: the store
// accepts the DEFINITION, then the chart may gain an instance, a setting may move,
// a header value may be shown, an alert may be armed. Each door already reports an
// outcome (`conversationSave.js`). ⚰️ Before this, the panel closed on the same
// tick the outcomes were written, so a refused alert or a definition that saved but
// was not added to the chart was never seen — the member assumed all of it worked.
//
// The receipt is that list, made honest in one place:
//   • the definition line comes first, and is the only line a Save can promise;
//   • every other step keeps its door's own words and its own ok flag;
//   • `status` is 'complete' ONLY when every step succeeded — anything else is
//     'partial', and the title says so. Nothing here can report full success over a
//     step that failed.
//
// Pure. The toolbar shows it after the panel closes (`SaveReceipt.jsx`).

const nameOf = (doc) => (doc && doc.meta && typeof doc.meta.name === 'string' && doc.meta.name.trim()) || 'Indicator'

/**
 * @param {{storedDoc: object, created: boolean, outcomes: Array<{kind: string, ok: boolean, text: string}>}} p
 * @returns {{status: 'complete'|'partial', title: string, name: string, version: number|null,
 *            created: boolean, items: Array<{kind: string, ok: boolean, text: string}>}}
 */
export function saveReceipt({ storedDoc, created, outcomes = [] }) {
  const name = nameOf(storedDoc)
  const version = storedDoc && Number.isInteger(storedDoc.version) ? storedDoc.version : null
  const steps = (outcomes || []).filter((o) => o && typeof o.text === 'string' && o.text)
    .map((o) => ({ kind: String(o.kind || 'step'), ok: o.ok === true, text: o.text }))
  const definition = {
    kind: 'definition', ok: true,
    text: created ? `“${name}” is saved to your indicators.`
      : `“${name}” is saved${version ? ` as version ${version}` : ''}.`,
  }
  const failed = steps.filter((s) => !s.ok).length
  const status = failed ? 'partial' : 'complete'
  const title = failed
    ? `Saved — ${failed === 1 ? 'one step' : `${failed} steps`} did not complete`
    : (created ? 'Indicator saved and added' : 'Changes saved')
  return { status, title, name, version, created: !!created, items: [definition, ...steps] }
}
