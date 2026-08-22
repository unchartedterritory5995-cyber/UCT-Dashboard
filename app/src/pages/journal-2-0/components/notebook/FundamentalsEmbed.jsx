import { useMemo } from 'react'
import { WorkspaceContext } from '../../../charts/WorkspaceContext'
import FundamentalsWidget from '../../../charts/widgets/FundamentalsWidget'
import { frozenWorkspaceValue } from './frozenWorkspace'

/**
 * The fundamentals journal renderer: the REAL FundamentalsWidget under the
 * frozen workspace host, rendering the CAPTURED reported rows (owner-approved
 * payload freeze — the rows are immutable and a few KB, so a March capture
 * shows March's table verbatim, no fetch, no drift when new quarters land).
 * readOnly strips the view tabs and the ⚙ (which writes a GLOBAL pref).
 */
export default function FundamentalsEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const value = useMemo(
    () => frozenWorkspaceValue({ symbol: params.symbol || null }),
    [params.symbol],
  )
  const frozen = useMemo(() => ({
    symbol: params.symbol,
    data: params.data || null,
    company: params.company || null,
    settings: params.settings || null,
  }), [params.symbol, params.data, params.company, params.settings])
  const opts = useMemo(() => ({ view: params.view }), [params.view])
  return (
    <div style={{ height, overflow: 'hidden' }}>
      <WorkspaceContext.Provider value={value}>
        <FundamentalsWidget
          color="A"
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
