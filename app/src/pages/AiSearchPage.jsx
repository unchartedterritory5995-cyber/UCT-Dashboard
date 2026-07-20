import { useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AiSearchWidget from './charts/widgets/AiSearchWidget'
import styles from './AiSearchPage.module.css'

/**
 * Standalone AI Search page — the mobile home for the widget (the /charts
 * workspace that hosts it on desktop collapses to a single chart on phones)
 * AND the app-wide deep-link target. Works at any viewport.
 *
 * Deep-link: /ai-search?q=<question> auto-runs that question on mount — this is
 * how "Ask AI about $SYM" (TickerActions, reachable from any ticker in the app)
 * and any shared question link land here. Keying the widget on the query so a
 * NEW ?q= (navigating here again with a different question) remounts + re-runs.
 *
 * Ticker clicks in answers load the symbol on the mobile chart: the charts
 * phone fallback reads localStorage['charts_mobile_sym'] on mount.
 */
export default function AiSearchPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialQuery = (params.get('q') || '').trim() || null

  const onTicker = useCallback((tk) => {
    try { localStorage.setItem('charts_mobile_sym', tk) } catch { /* noop */ }
    navigate('/charts')
  }, [navigate])

  return (
    <div className={styles.page}>
      <AiSearchWidget key={initialQuery || 'blank'} initialQuery={initialQuery} onTicker={onTicker} />
    </div>
  )
}
