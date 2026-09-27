import { useMemo } from 'react'
import { WorkspaceContext } from '../../../charts/WorkspaceContext'
import AlertsWidget from '../../../charts/widgets/AlertsWidget'
import { frozenWorkspaceValue } from './frozenWorkspace'
import { embedAutoCaption } from '../../lib/widgetEmbedCore'

/**
 * The alerts journal renderer: the REAL AlertsWidget under the frozen
 * workspace host, rendering the CAPTURED list verbatim (owner-approved
 * payload freeze). Each row's badges read levelAtCapture/priceAtCapture —
 * never the ambient clock or live prices — so "Price above" means above at
 * the moment of capture. Deleted alerts are gone from the server; this embed
 * is their only durable record. readOnly strips quick-add (a real POST), row
 * delete (a real DELETE), and the ⚙.
 */
export default function AlertsEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const value = useMemo(() => frozenWorkspaceValue(), [])
  const alerts = useMemo(
    () => (Array.isArray(params.alerts) ? params.alerts : []),
    [params.alerts],
  )
  const opts = useMemo(() => ({ settings: params.settings || null }), [params.settings])
  return (
    // Wave 8 (8A): a figure named by the embed's own caption -- the same
    // words its archived image uses for alt (embedAutoCaption).
    <div style={{ height, overflow: 'hidden' }} role="figure" aria-label={embedAutoCaption(attrs)}>
      <WorkspaceContext.Provider value={value}>
        <AlertsWidget
          color="A"
          opts={opts}
          onOptsChange={null}
          frozenAlerts={alerts}
          readOnly
          journalDoor={false}
        />
      </WorkspaceContext.Provider>
    </div>
  )
}
