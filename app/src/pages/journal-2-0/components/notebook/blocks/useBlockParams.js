// ⛔⛔ THE ONE WAY A BLOCK CHANGES ITS STATE (spec §P2 integrity rule). One TipTap updateAttributes
// call = one editor transaction, so the change rides the note's existing save path (autosave -> outbox
// -> compare-and-set) and nothing else. lib/blocks/blockDoors.test.js fails on any other
// updateAttributes call in a block file, and on this file no longer making that call.
import { useCallback, useRef } from 'react'
import { paramsPlainText } from '../../../../../widgets/registry'

export function useBlockParams({ attrs, updateAttributes, editable }) {
  // `latest` holds the params the NEXT write merges into: the node's own params, or the value this
  // hook just wrote if the node has not re-rendered with it yet (two ticks inside one event).
  // When the node's params object changes (our write landed, or a rebase from another tab), the
  // node's value wins again.
  const latest = useRef(attrs?.params || {})
  const seen = useRef(attrs?.params)
  if (attrs?.params !== seen.current) {
    seen.current = attrs?.params
    latest.current = attrs?.params || {}
  }
  // R-T12-C fix round 1: an optional `{ capturedAt }` rides the SAME updateAttributes call (one
  // transaction, never two). Only the market context stamp's "Capture now" passes it: a stamp is a
  // dated reading. Every block calls setParams(patch) alone, so its write is exactly what it was.
  // Fix round 2 (I-1): `{ clearArchive: true }` adds `fallback: null` to that same call -- the archived
  // image showed the uncaptured frame, so it goes with the capture (the switchTf / onEmbedSettings /
  // syncFromMyChart idiom; the node view re-arms its self-archive for that call).
  return useCallback((patch, opts) => {
    if (!editable || typeof updateAttributes !== 'function') return false
    const params = { ...latest.current, ...patch }
    latest.current = params
    const next = { params, searchText: paramsPlainText(attrs.widgetId, params) }
    if (typeof opts?.capturedAt === 'string' && opts.capturedAt) next.capturedAt = opts.capturedAt
    if (opts?.clearArchive === true) next.fallback = null
    updateAttributes(next)
    return true
  }, [editable, updateAttributes, attrs?.widgetId])
}
