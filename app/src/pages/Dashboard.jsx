import FuturesStrip from '../components/tiles/FuturesStrip'
import MarketBreadth from '../components/tiles/MarketBreadth'
import ThemeTracker from '../components/tiles/ThemeTracker'
import CatalystFlow from '../components/tiles/CatalystFlow'
import LeadershipTile from '../components/tiles/LeadershipTile'
import KeyLevels from '../components/tiles/KeyLevels'
import NewsFeed from '../components/tiles/NewsFeed'
import MoversSidebar from '../components/MoversSidebar'
import TileCard from '../components/TileCard'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        {/* Row 1: Futures strip */}
        <div className={styles.row1}>
          <FuturesStrip />
        </div>

        {/* Row 2: UCT Exposure Rating + Coming Soon + Theme Tracker */}
        <div className={styles.row2}>
          <MarketBreadth />
          <TileCard title="Coming Soon">
            <div className={styles.comingSoon}>
              <span className={styles.comingSoonIcon}>🔧</span>
              <span className={styles.comingSoonLabel}>Coming Soon</span>
            </div>
          </TileCard>
          <ThemeTracker />
        </div>

        {/* Row 3: Catalyst Flow + UCT 20 + Key Levels + News */}
        <div className={styles.row3}>
          <CatalystFlow />
          <LeadershipTile />
          <KeyLevels />
          <NewsFeed />
        </div>
      </div>
      <MoversSidebar />
    </div>
  )
}
