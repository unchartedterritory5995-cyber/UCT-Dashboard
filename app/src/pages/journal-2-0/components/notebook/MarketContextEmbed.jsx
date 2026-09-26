import { useMemo } from 'react'
import { WorkspaceContext } from '../../../charts/WorkspaceContext'
import MarketContextWidget from '../../../charts/widgets/MarketContextWidget'
import { frozenWorkspaceValue } from './frozenWorkspace'
import { embedAutoCaption } from '../../lib/widgetEmbedCore'

/**
 * The market-context journal renderer: the REAL MarketContextWidget under the
 * frozen workspace host, rendering the CAPTURED readings verbatim (payload
 * freeze). ⭐ `/api/breadth` takes no date and `wire_data.json` is OVERWRITTEN
 * by each morning's run — yesterday's exposure score and market phase exist
 * nowhere once today's wire lands, so this embed is their only durable record.
 * ⛔ `powerTrend` stays null (owner direction 2026-04-17) and renders as an em
 * dash here exactly as it does on the board.
 */
export default function MarketContextEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const value = useMemo(() => frozenWorkspaceValue(), [])
  const frozen = useMemo(() => ({
    readings: (params.readings && typeof params.readings === 'object') ? params.readings : null,
    wireDate: params.wireDate || null,
    updated: params.updated || null,
  }), [params.readings, params.wireDate, params.updated])
  return (
    // Wave 8 (8A): a figure named by the embed's own caption -- the same
    // words its archived image uses for alt (embedAutoCaption).
    <div style={{ height, overflow: 'hidden' }} role="figure" aria-label={embedAutoCaption(attrs)}>
      <WorkspaceContext.Provider value={value}>
        <MarketContextWidget
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
