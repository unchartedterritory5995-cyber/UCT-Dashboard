/**
 * ⭐⭐ D3b fix round 1, residual (a) — WHAT THE OWNING EDITOR DOES WITH A 409.
 * ONE authority, asked by `NoteEditorPage`'s `reconcileConflict` and by the
 * property rail's model of it, so the rail cannot drift from the editor.
 *
 * ⚰️ THE RESIDUAL (`f5-fixes-2026-09-23.md` §F.1): a sweep that passed its last
 * owner-lock check before the note opened can still have its PUT in flight while
 * the editor adopts the SAME queued words. The sweep's PUT lands those words; the
 * editor's own send, on the revision the words were written on, then 409s — and
 * the reconcile classified the server's copy against that revision, read
 * BODY_REWRITE (the member's own words ARE the change), and forked the member's
 * note with nobody else writing.
 *
 * ⭐ THE QUESTION THE CONTENT CAN ANSWER: does the server already hold exactly
 * what this send carried? `sameAuthoredContent` is the drain's own test for "the
 * server copy is ours" (`serverCopyIsOursDefault`: byte-identical ⇒ "sending it
 * again could not change anything, so there is nothing to preserve and nothing to
 * fork"). When it does, the 409 was not a conflict — the words LANDED, one
 * revision later — and the editor settles exactly as a 200 would.
 * ⛔ Nothing is lost by it: the server holds every word that was sent, and
 * anything typed since is ahead of that and still the editor's (and the durable
 * store's) to send, on the server's revision now.
 * ⛔ NARROW, as the drain's is. Content that differs by anything — a door's
 * block, another device's sentence, a title — is not this case, and the
 * classifier decides it exactly as before: metadata ⇒ retry, append ⇒ merge,
 * anything else ⇒ fork.
 *
 * @param fresh the server's copy, fetched after the 409
 * @param base  what the sent words were written on (`lastSavedRef`)
 * @param sent  EXACTLY what the 409'd send carried: { title, subtitle, bodyJson }
 * @returns { plan: LANDED | RETRY | FORK, shape }
 */
import { sameAuthoredContent } from './recoverLocalState'
import { BODY_REWRITE, classifyServerChange } from './serverChange'

export const LANDED = 'landed'
export const RETRY = 'retry'
export const FORK = 'fork'

export function ownerReconcilePlan({ fresh, base, sent } = {}) {
  if (fresh && sent && sameAuthoredContent(fresh, sent)) return { plan: LANDED, shape: null }
  const shape = classifyServerChange(fresh, base)
  return { plan: shape === BODY_REWRITE ? FORK : RETRY, shape }
}
