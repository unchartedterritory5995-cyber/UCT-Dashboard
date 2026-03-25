import FuturesStrip from '../components/tiles/FuturesStrip'
import IntradayPulse from '../components/tiles/IntradayPulse'
import MarketBreadth from '../components/tiles/MarketBreadth'
import ThemeTracker from '../components/tiles/ThemeTracker'
import CatalystFlow from '../components/tiles/CatalystFlow'
import LeadershipTile from '../components/tiles/LeadershipTile'
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

        {/* Intraday pulse — only renders when brain has pushed an update */}
        <IntradayPulse />

        {/* Row 2: Movers at the Open + UCT Exposure Rating + Theme Tracker */}
        <div className={styles.row2}>
          <MoversSidebar />
          <MarketBreadth />
          <ThemeTracker />
        </div>

        {/* Row 3: Catalyst Flow + UCT 20 + News */}
        <div className={styles.row3}>
          <CatalystFlow />
          <LeadershipTile />
          <NewsFeed />
        </div>

        {/* Row 4: Options Flow + Dark Pool */}
        <div className={styles.row4}>
          <TileCard title="Options Flow">
            <div className={styles.comingSoon}>
              <span className={styles.comingSoonIcon}>🔧</span>
              <span className={styles.comingSoonLabel}>Coming Soon</span>
            </div>
          </TileCard>
          <TileCard title="Dark Pool">
            <div className={styles.comingSoon}>
              <span className={styles.comingSoonIcon}>🔧</span>
              <span className={styles.comingSoonLabel}>Coming Soon</span>
            </div>
          </TileCard>
        </div>

      </div>
    </div>
  )
}
