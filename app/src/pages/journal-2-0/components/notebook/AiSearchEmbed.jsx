import { useMemo } from 'react'
import { WorkspaceContext } from '../../../charts/WorkspaceContext'
import AiSearchWidget from '../../../charts/widgets/AiSearchWidget'
import { frozenWorkspaceValue } from './frozenWorkspace'

/**
 * The AI-search journal renderer: the REAL AiSearchWidget under the frozen
 * workspace host, replaying the CAPTURED conversation via its own
 * initialThread seam. The thread IS the frozen params — it is never
 * re-queried (re-running would return a different answer), so this renders
 * text + citations + ticker links live instead of a flat PNG.
 *
 * readOnly: the thread is evidence — no ask bar, no follow-ups, no
 * save/share (ShareToFloor posts to the community; a frozen embed must not
 * carry a live community-posting control — the structural-readOnly audit
 * finding). chrome={false} strips the workspace furniture; onThread stays
 * null so nothing can write.
 */
export default function AiSearchEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const value = useMemo(() => frozenWorkspaceValue(), [])
  const thread = useMemo(
    () => (Array.isArray(params.thread) ? params.thread : []),
    [params.thread],
  )
  return (
    <div style={{ height, overflow: 'hidden' }}>
      <WorkspaceContext.Provider value={value}>
        <AiSearchWidget chrome={false} readOnly initialThread={thread} onThread={null} />
      </WorkspaceContext.Provider>
    </div>
  )
}
