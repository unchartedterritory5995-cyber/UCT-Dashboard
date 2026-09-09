import { useEffect, useReducer } from 'react'
import { requestNoteLinkTarget, subscribeNoteLinkTargets } from '../lib/noteLinkTargetsBatch'

/** Wave D — resolves ONE `noteLink` target's current title/trashed status
 * through the shared micro-batcher (see noteLinkTargetsBatch.js for why
 * this isn't a plain per-id useSWR call). Returns:
 *   { status: 'loading' }                        -- request queued/in flight
 *   { status: 'unavailable' }                     -- no id, or resolved but
 *                                                     not found/not owned
 *   { status: 'active' | 'trashed', title: str }  -- resolved
 */
export default function useNoteLinkTarget(noteId) {
  const [, bump] = useReducer((x) => x + 1, 0)
  useEffect(() => subscribeNoteLinkTargets(bump), [])

  if (!noteId) return { status: 'unavailable' }
  const cached = requestNoteLinkTarget(noteId)
  if (cached === undefined) return { status: 'loading' }
  if (cached === null) return { status: 'unavailable' }
  return { status: cached.status, title: cached.title }
}
