import { Suspense, useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
// Match the project-wide convention: lazyWithRetry hard-reloads the page
// when a stale chunk 404s after a Railway redeploy. Used everywhere in App.jsx.
import lazy from '../../utils/lazyWithRetry'
import usePreferences from '../../hooks/usePreferences'
import { ChartsSymContext } from './ChartsSymContext'
import styles from './ChartsHub.module.css'

const ChartTab = lazy(() => import('./ChartTab'))
const WatchlistTab = lazy(() => import('../Watchlists'))
const ThemesTab = lazy(() => import('../ThemeTrackerPage'))
const MultiChartTab = lazy(() => import('../MultiChart'))

const SUB_TABS = [
  { id: 'chart',      label: 'Chart',       Component: ChartTab },
  { id: 'watchlist',  label: 'Watchlist',   Component: WatchlistTab },
  { id: 'themes',     label: 'Themes',      Component: ThemesTab },
  { id: 'multichart', label: 'Multi-Chart', Component: MultiChartTab },
]

const VALID_IDS = new Set(SUB_TABS.map(t => t.id))

export default function ChartsHub() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { prefs, setPref } = usePreferences()

  const urlTab = searchParams.get('tab')
  const prefTab = prefs?.charts_last_tab
  const initial = VALID_IDS.has(urlTab) ? urlTab
                : VALID_IDS.has(prefTab) ? prefTab
                : 'chart'

  const [activeId, setActiveId] = useState(initial)

  // If the resolved initial came from the preference (not the URL),
  // push it into the URL so the address bar reflects state.
  useEffect(() => {
    if (!urlTab && activeId) {
      const next = new URLSearchParams(searchParams)
      next.set('tab', activeId)
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // React to external URL changes (e.g., back/forward button).
  useEffect(() => {
    if (urlTab && VALID_IDS.has(urlTab) && urlTab !== activeId) {
      setActiveId(urlTab)
    }
  }, [urlTab, activeId])

  // Track which sub-tabs have been mounted at least once (lazy keep-alive).
  const [mountedIds, setMountedIds] = useState(() => new Set([initial]))
  useEffect(() => {
    setMountedIds(prev => {
      if (prev.has(activeId)) return prev
      const next = new Set(prev)
      next.add(activeId)
      return next
    })
  }, [activeId])

  // Shared ticker context — seed from ?sym= if present.
  const [sym, setSym] = useState(searchParams.get('sym'))
  const symContextValue = useMemo(() => ({ sym, setSym }), [sym])

  function handleTabClick(id) {
    if (id === activeId) return
    setActiveId(id)
    const next = new URLSearchParams(searchParams)
    next.set('tab', id)
    navigate(`/charts?${next.toString()}`, { replace: true })
    setPref('charts_last_tab', id)
  }

  return (
    <ChartsSymContext.Provider value={symContextValue}>
      <div className={styles.hub}>
        <header className={styles.header}>
          <h1 className={styles.title}>📈 Charts</h1>
          <div className={styles.subtabStrip} role="tablist">
            {SUB_TABS.map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={tab.id === activeId}
                className={[styles.subtab, tab.id === activeId ? styles.subtabActive : ''].join(' ')}
                onClick={() => handleTabClick(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>
        <main className={styles.body}>
          {SUB_TABS.map(tab => mountedIds.has(tab.id) && (
            <div
              key={tab.id}
              className={styles.tabPanel}
              style={{ display: tab.id === activeId ? 'block' : 'none' }}
              role="tabpanel"
              aria-hidden={tab.id !== activeId}
            >
              <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
                <tab.Component />
              </Suspense>
            </div>
          ))}
        </main>
      </div>
    </ChartsSymContext.Provider>
  )
}
