// Journal Widgets — the one-action "send this widget somewhere" flow
// (owner decisions #9/#10). Extracted from ChartWidget so every widget type's
// capture door shares ONE wire — a second hand-rolled copy of this flow is
// how doors drift.
//
// The DESTINATION used to be baked in here (last-active note → inbox). It now
// lives in captureTargets.js, so a destination added there is available from
// every door at once and a widget added later gets all of them for free. This
// module keeps the capture-building half: attrs, the bars warm, the label.

import { buildWidgetEmbedAttrs } from './widgetEmbedCore'
import { noteHasUnsentWork, STILL_SYNCING_MESSAGE } from './offline/noteHasUnsentWork'
import { openNotebookDb } from './offline/notebookDb'
import { freshLastNote } from './captureTargets'
import { kickSnapshotWarm } from './embedArchive'
import { CAPTURE_TARGETS } from './captureTargets'

// Stage A member-validation instrumentation (decision-log "Stage A→B gate"
// entry, 2026-09-06) — fires once per genuine capture, from the one function
// every capture door funnels through, so it uniformly covers all three
// destinations (current note / new note / inbox). Aggregate metadata only —
// widget id, chosen destination, whether a trade link was attached — never
// the captured content itself. Best-effort: never blocks or throws.
function _logCaptureSaved(widgetId, target, hasTradeRef) {
  fetch('/api/j2/telemetry', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'notebook_capture_saved', props: { widgetId, target, hasTradeRef } }),
  }).catch(() => {})
}

/** Build the frozen embed attrs for a capture (+ fire the bars warm for
 *  charts). Split out so a caller that wants to offer a TARGET MENU can build
 *  once and route to any target, instead of re-capturing per destination.
 *  `extra` forwards straight to buildWidgetEmbedAttrs — Wave 1's destination
 *  menu uses this to carry an optional member-typed `caption` and/or
 *  `tradeRef` through to the frozen attrs without every one of the 9 call
 *  sites needing to know that shape. */
export function buildCapture(widgetId, capture, extra) {
  const attrs = buildWidgetEmbedAttrs(widgetId, capture, extra)
  // Bars-history warm is a chart concept; other widget types have no
  // (ticker, tf) to deep-fill.
  if (widgetId === 'chart') kickSnapshotWarm(attrs.params)
  return attrs
}

/** Capture → the chosen target. Returns the toast line — the CALLER owns its
 *  toast surface. `label` names the capture in toasts (a symbol, a date…);
 *  `target` selects a captureTargets entry and defaults to the historical
 *  behavior (current note, inbox fallback), so every existing door is
 *  byte-identical without passing anything. `comment`/`tradeRef` (Wave 1,
 *  P1-1) are optional and forward into the frozen embed attrs — omitted
 *  entirely, every existing call site's capture is byte-identical to before. */
export async function sendCaptureToJournal(
  widgetId, capture, { label, target = 'note', comment, tradeRef, tradeRefType } = {},
) {
  const extra = {}
  if (comment) extra.caption = comment
  if (tradeRef) extra.tradeRef = tradeRef
  if (tradeRef && tradeRefType) extra.tradeRefType = tradeRefType
  const attrs = buildCapture(widgetId, capture, extra)
  const name = label || attrs.params?.symbol || widgetId
  const t = CAPTURE_TARGETS[target] || CAPTURE_TARGETS.note
  // ⛔⛔ THE DOOR GUARD. MITIGATION, NOT ROOT CAUSE.
  //
  // Five production cells on this route lose a member's offline words: the embed
  // lands, the typed words do not, the durable record goes clean and nothing marks
  // the note as pending. Q1 fix 4 and fix 5 are both live and neither closed it;
  // the writer that clears the record is still UNNAMED (Q1/Q2 in
  // docs/notebook/q1-red-cells-investigation.md).
  //
  // ⭐ ONE GUARD, NOT THIRTEEN. Every door funnels here — ten chart widgets,
  // TickerActions, ThemeTrackerPage, Watchlists and CaptureMenu — proven by
  // sweeping the importers rather than by trusting the list in the plan, which
  // named five. Guarding the call sites would have missed eight of them.
  //
  // ⛔ It does NOT post the embed and does NOT touch the record: it returns the
  // toast line this function already contracts to return, so every caller's
  // existing toast surface shows it with no call-site change.
  if (target === 'note') {
    // ⛔ freshLastNote() returns {id, ts} or null — NOT an id. Passing the object
    // would make every lookup miss and the guard would pass silently, which is the
    // failure direction that costs the member's words.
    // ⛔⛔ THE PLAIN STORE OPENER, NOT `useDurableNote`. That module mints a
    // session id with crypto.randomUUID and takes a Web Lock AT MODULE SCOPE, so
    // importing it here would make every door take a lock the moment this file is
    // parsed — the defect settleNoteWrite.js already carries a fix for. I
    // re-committed it and the door tests caught it, twice: statically, then
    // dynamically through a module the tests mock.
    // ⭐ `openNotebookDb` is a plain opener in notebookDb.js with no module-scope
    // work, so the guard depends on the STORE, not on the editor's session.
    const last = freshLastNote()
    const verdict = await noteHasUnsentWork(last?.id || null,
                                            { connect: openNotebookDb })
    if (verdict.unsent) return STILL_SYNCING_MESSAGE
  }
  try {
    const result = await t.run(attrs, { widgetId, label: name })
    _logCaptureSaved(widgetId, target, !!tradeRef)
    return result
  } catch {
    return 'Capture failed — try again'
  }
}
