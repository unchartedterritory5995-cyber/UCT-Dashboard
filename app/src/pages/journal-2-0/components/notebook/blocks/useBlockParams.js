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
  return useCallback((patch) => {
    if (!editable || typeof updateAttributes !== 'function') return false
    const params = { ...latest.current, ...patch }
    latest.current = params
    updateAttributes({ params, searchText: paramsPlainText(attrs.widgetId, params) })
    return true
  }, [editable, updateAttributes, attrs?.widgetId])
}
