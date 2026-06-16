import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import useResearchOverview from './hooks/useResearchOverview'
import ResearchHeader from './ResearchHeader'
import OverviewTab from './tabs/OverviewTab'
import FinancialsTab from './tabs/FinancialsTab'
import ComingSoonTab from './tabs/ComingSoonTab'
import PaywallTeaser from './PaywallTeaser'
import styles from './ResearchPage.module.css'

const TABS = ['Overview', 'Financials', 'Estimates', 'Ratings', 'Ownership', 'Calls & Transcript', 'Filings & Events']

export default function ResearchPage() {
  const { sym: rawSym } = useParams()
  const navigate = useNavigate()
  const { isPaid } = useAuth()
  const [active, setActive] = useState('Overview')
  const data = useResearchOverview(rawSym)
  const sym = data.sym

  if (!isPaid) {
    return <div className={styles.page}><PaywallTeaser sym={sym} /></div>
  }

  return (
    <div className={styles.page}>
      <ResearchHeader
        sym={sym}
        meta={data.meta}
        live={data.live}
        onSymbolChange={(s) => s && navigate(`/research/${s.toUpperCase()}`)}
      />
      <nav className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t}
            className={`${styles.tab} ${active === t ? styles.tabOn : ''}`}
            onClick={() => setActive(t)}
          >{t}</button>
        ))}
      </nav>
      {active === 'Overview' && <OverviewTab stats={data.stats} analyst={data.analyst} ai={data.ai} row={null} />}
      {active === 'Financials' && <FinancialsTab sym={sym} />}
      {active !== 'Overview' && active !== 'Financials' && <ComingSoonTab name={active} />}
    </div>
  )
}
