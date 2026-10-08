// app/src/components/chart/builder/studio/editPreview.js
//
// ─── ⭐ BATCH 1 — AN EDIT'S PREVIEW SHOWS THE SETTING THE EDIT CHANGES ─────────
//
// Editing a stored indicator previews IN PLACE of the saved drawing, shaped like
// the chart's own instance (`chartPreview.previewInstanceLike`) — including that
// instance's own input VALUES. ⚰️ So "change my risk to 0.5%" moved the
// definition's default to 0.5 while the preview kept drawing the instance's 1: the
// member saw nothing change until Save, where `attachConversation` writes the new
// value to this chart's instance (`changedInputDefaults` + `setInstanceInput`).
//
// The preview now applies EXACTLY that rule to the preview instance — the same
// pair of functions, so preview and Save cannot disagree: a member number input
// whose default this edit moved takes the new value; one the instance writer would
// refuse is left as it is (as Save leaves it). Chrome inputs (colour / width) are
// excluded by `changedInputDefaults`, as at Save. Nothing here is written anywhere:
// the result is the ephemeral preview instance only.

import { changedInputDefaults } from '../conversationSave'
import { setInstanceInput } from '../../engine/instanceControls'

/**
 * @param {object|null} instance  the preview instance (already re-pointed at the preview def)
 * @param {{base: object|null, working: object|null, settings: object|null, registry: object}} ctx
 * @returns {object|null} the instance with the pending input values (or `instance` unchanged)
 */
export function withPendingInputs(instance, { base, working, settings, registry }) {
  if (!instance || !base || !working || !settings) return instance
  const changed = changedInputDefaults(base, working)
  if (!changed.length) return instance
  let cs = { ...settings, indicatorInstances: [instance] }
  for (const [key, to] of changed) cs = setInstanceInput(cs, instance.instanceId, key, to.default, registry)
  const next = (cs.indicatorInstances || []).find((i) => i && i.instanceId === instance.instanceId)
  return next ? { ...instance, inputs: next.inputs } : instance
}
