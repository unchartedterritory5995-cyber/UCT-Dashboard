import { useMemo } from 'react'
import { WorkspaceContext } from '../../../charts/WorkspaceContext'
import IndexesWidget from '../../../charts/widgets/IndexesWidget'
import { frozenWorkspaceValue } from './frozenWorkspace'

/**
 * The indexes journal renderer: the REAL IndexesWidget under the frozen
 * workspace host, rendering the CAPTURED readings verbatim (payload freeze).
 * ⭐ `/api/snapshot` has no date parameter — no endpoint anywhere can serve
 * back what SPY read at 1:26 PM on a past Thursday, and the daily bar store
 * would answer with that session's CLOSE instead. The frozen rows are the only
 * honest record of the levels the member was looking at. readOnly strips the
 * per-tile hide and its restore control (both write workspace opts).
 */
export default function IndexesEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const value = useMemo(() => frozenWorkspaceValue(), [])
  const frozen = useMemo(() => ({
    rows: Array.isArray(params.rows) ? params.rows : [],
    updated: params.updated || null,
  }), [params.rows, params.updated])
  return (
    <div style={{ height, overflow: 'hidden' }}>
      <WorkspaceContext.Provider value={value}>
        <IndexesWidget
          opts={null}
          onOptsChange={null}
          frozen={frozen}
          readOnly
          journalDoor={false}
        />
      </WorkspaceContext.Provider>
    </div>
  )
}
