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
import { kickSnapshotWarm } from './embedArchive'
import { CAPTURE_TARGETS } from './captureTargets'

/** Build the frozen embed attrs for a capture (+ fire the bars warm for
 *  charts). Split out so a caller that wants to offer a TARGET MENU can build
 *  once and route to any target, instead of re-capturing per destination. */
export function buildCapture(widgetId, capture) {
  const attrs = buildWidgetEmbedAttrs(widgetId, capture)
  // Bars-history warm is a chart concept; other widget types have no
  // (ticker, tf) to deep-fill.
  if (widgetId === 'chart') kickSnapshotWarm(attrs.params)
  return attrs
}

/** Capture → the chosen target. Returns the toast line — the CALLER owns its
 *  toast surface. `label` names the capture in toasts (a symbol, a date…);
 *  `target` selects a captureTargets entry and defaults to the historical
 *  behavior (current note, inbox fallback), so every existing door is
 *  byte-identical without passing anything. */
export async function sendCaptureToJournal(widgetId, capture, { label, target = 'note' } = {}) {
  const attrs = buildCapture(widgetId, capture)
  const name = label || attrs.params?.symbol || widgetId
  const t = CAPTURE_TARGETS[target] || CAPTURE_TARGETS.note
  try {
    return await t.run(attrs, { widgetId, label: name })
  } catch {
    return 'Capture failed — try again'
  }
}
