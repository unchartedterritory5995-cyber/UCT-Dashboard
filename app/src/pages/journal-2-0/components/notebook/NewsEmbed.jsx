import { useMemo } from 'react'
import { WorkspaceContext } from '../../../charts/WorkspaceContext'
import NewsWidget from '../../../charts/widgets/NewsWidget'
import { frozenWorkspaceValue } from './frozenWorkspace'
import { embedAutoCaption } from '../../lib/widgetEmbedCore'

/**
 * The news journal renderer: the REAL NewsWidget under the frozen workspace
 * host, rendering the CAPTURED feed verbatim (owner-approved payload freeze —
 * headlines + moves as they read on capture day, never re-fetched). readOnly
 * strips the filter pills, the ⚙, and the PIN (which writes the SHARED
 * per-symbol drawings store — off-limits from inside a note).
 */
export default function NewsEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const value = useMemo(
    () => frozenWorkspaceValue({ symbol: params.symbol || null }),
    [params.symbol],
  )
  const events = useMemo(
    () => (Array.isArray(params.events) ? params.events : []),
    [params.events],
  )
  const opts = useMemo(() => ({
    filter: params.filter,
    settings: params.settings || null,
  }), [params.filter, params.settings])
  return (
    // Wave 8 (8A): a figure named by the embed's own caption -- the same
    // words its archived image uses for alt (embedAutoCaption).
    <div style={{ height, overflow: 'hidden' }} role="figure" aria-label={embedAutoCaption(attrs)}>
      <WorkspaceContext.Provider value={value}>
        <NewsWidget
          color="A"
          opts={opts}
          onOptsChange={null}
          frozenEvents={events}
          readOnly
          journalDoor={false}
        />
      </WorkspaceContext.Provider>
    </div>
  )
}
