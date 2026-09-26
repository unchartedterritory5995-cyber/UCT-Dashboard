import { useMemo } from 'react'
import { WorkspaceContext } from '../../../charts/WorkspaceContext'
import BreadthWidget from '../../../charts/widgets/BreadthWidget'
import { frozenWorkspaceValue } from './frozenWorkspace'
import { embedAutoCaption } from '../../lib/widgetEmbedCore'

/**
 * The breadth journal renderer: the REAL BreadthWidget under the frozen
 * workspace host, rendering the CAPTURED heat-map verbatim (owner-approved
 * payload freeze). ⭐ A mid-session capture holds the LIVE intraday row the
 * 4:15 collector DISCARDS — this embed is the only surface anywhere that can
 * show it back. readOnly strips the ⚙/＋/✕, tile drill, and the footer's
 * app-wide refresh.
 */
export default function BreadthEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const value = useMemo(() => frozenWorkspaceValue(), [])
  const frozen = useMemo(() => ({
    row: params.row || null,
    series: params.series || {},
    settings: params.settings || null,
    updated: params.updated || null,
  }), [params.row, params.series, params.settings, params.updated])
  const opts = useMemo(
    () => ({ hiddenMetrics: Array.isArray(params.hiddenMetrics) ? params.hiddenMetrics : [] }),
    [params.hiddenMetrics],
  )
  return (
    // Wave 8 (8A): a figure named by the embed's own caption -- the same
    // words its archived image uses for alt (embedAutoCaption).
    <div style={{ height, overflow: 'hidden' }} role="figure" aria-label={embedAutoCaption(attrs)}>
      <WorkspaceContext.Provider value={value}>
        <BreadthWidget
          opts={opts}
          onOptsChange={null}
          frozen={frozen}
          readOnly
          journalDoor={false}
        />
      </WorkspaceContext.Provider>
    </div>
  )
}
