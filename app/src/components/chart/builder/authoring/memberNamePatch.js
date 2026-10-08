// app/src/components/chart/builder/authoring/memberNamePatch.js
//
// ─── ⭐ BATCH 1 — THE MEMBER'S NAME WINS, ON EVERY TURN ───────────────────────
//
// A name the member gave after an explicit cue ("call it Swing Line", "rename it
// to Momentum Pulse") is THEIR words and is the indicator's name, whatever the
// model wrote. The create turn already enforced this (`applyPatch` `create`); a
// LATER turn did not — ⚰️ measured 2026-10-08, "Call it Swing Line" on turn 3 was
// refused before any model call, and "make it 28 and call it Swing Line" lost the
// name. Two pure helpers close it, both expressed as ordinary patch ops so the
// engine applies them atomically with the rest of the turn (same lineage, one
// revision, one undo step):
//
//   renamePatch      — a message that is ONLY a naming request: the studio applies
//                      `rename_definition` itself, with no model call and no cost.
//   withMemberName   — a change turn whose message ALSO named it: the rename rides
//                      in the same envelope (or corrects the model's rename).
//
// ⛔ Never on a create envelope (the create op enforces it there), never when the
// member gave two names, never past the patch's op limit.

import { memberCueNames, NAME_MAX } from './derivedName'
import { PATCH_CONTRACT, PATCH_LIMITS } from './patchValidate'

const clip = (name) => (name.length > NAME_MAX ? name.slice(0, NAME_MAX) : name)

/** The patch for a naming-only message over `state`'s working definition. */
export function renamePatch(state, name) {
  return { contract: PATCH_CONTRACT, baseRevision: state.revision, disposition: 'change',
    ops: [{ op: 'rename_definition', name: clip(name) }] }
}

/**
 * `envelope` with the member's one cue name applied: an existing
 * `rename_definition` is corrected to it, else one is appended. Returns the SAME
 * envelope when there is nothing to do.
 */
export function withMemberName(envelope, words) {
  if (!envelope || !Array.isArray(envelope.ops)) return envelope
  const names = memberCueNames(words)
  if (names.length !== 1) return envelope
  const ops = envelope.ops
  if (ops.some((o) => o && o.op === 'create')) return envelope
  const name = clip(names[0])
  const at = ops.findIndex((o) => o && o.op === 'rename_definition')
  if (at >= 0) {
    if (ops[at].name === name) return envelope
    const next = ops.slice()
    next[at] = { ...ops[at], name }
    return { ...envelope, ops: next }
  }
  if (ops.length >= ((PATCH_LIMITS && PATCH_LIMITS.maxOps) || 12)) return envelope
  return { ...envelope, ops: [...ops, { op: 'rename_definition', name }] }
}
