import FuturesStrip from '../components/tiles/FuturesStrip'
import MarketBreadth from '../components/tiles/MarketBreadth'
import ThemeTracker from '../components/tiles/ThemeTracker'
import CatalystFlow from '../components/tiles/CatalystFlow'
import EpisodicPivots from '../components/tiles/EpisodicPivots'
import KeyLevels from '../components/tiles/KeyLevels'
import NewsFeed from '../components/tiles/NewsFeed'
import MoversSidebar from '../components/MoversSidebar'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        {/* Row 1: Futures strip */}
        <div className={styles.row1}>
          <FuturesStrip />
        </div>

        {/* Row 2: Market Breadth + Theme Tracker */}
        <div className={styles.row2}>
          <div className={styles.breadthCol}>
            <MarketBreadth />
          </div>
          <div className={styles.themeCol}>
            <ThemeTracker />
          </div>
        </div>

        {/* Row 3: Catalyst Flow + Episodic Pivots + Key Levels + News */}
        <div className={styles.row3}>
          <CatalystFlow />
          <EpisodicPivots />
          <KeyLevels />
          <NewsFeed />
        </div>
      </div>
      <MoversSidebar />
    </div>
  )
}
