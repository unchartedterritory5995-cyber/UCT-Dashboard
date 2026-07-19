import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import AiSearchWidget from './charts/widgets/AiSearchWidget'
import styles from './AiSearchPage.module.css'

/**
 * Standalone AI Search page — primarily the mobile home for the widget
 * (the /charts workspace that hosts it on desktop collapses to a single
 * chart on phones). Works at any viewport.
 *
 * Ticker clicks in answers load the symbol on the mobile chart: the
 * charts phone fallback reads localStorage['charts_mobile_sym'] on mount.
 */
export default function AiSearchPage() {
  const navigate = useNavigate()
  const onTicker = useCallback((tk) => {
    try { localStorage.setItem('charts_mobile_sym', tk) } catch { /* noop */ }
    navigate('/charts')
  }, [navigate])

  return (
    <div className={styles.page}>
      <AiSearchWidget onTicker={onTicker} />
    </div>
  )
}
