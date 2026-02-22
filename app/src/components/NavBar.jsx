// app/src/components/NavBar.jsx
import { NavLink } from 'react-router-dom'
import styles from './NavBar.module.css'

const NAV_ITEMS = [
  { to: '/dashboard',    label: 'Dashboard',    icon: '⊞' },
  { to: '/morning-wire', label: 'Morning Wire',  icon: '📰' },
  { to: '/uct-20',       label: 'UCT 20',        icon: '⭐' },
  { to: '/traders',      label: 'Traders',       icon: '👥' },
  { to: '/screener',     label: 'Screener',      icon: '⚡' },
  { to: '/options-flow', label: 'Options Flow',  icon: '📊' },
  { to: '/post-market',  label: 'Post Market',   icon: '🌙' },
  { to: '/model-book',   label: 'Model Book',    icon: '📖' },
]

const WEBSITE_URL = 'https://whop.com/uncharted/uncharted'

export default function NavBar() {
  return (
    <nav data-testid="nav-sidebar" className={styles.nav}>
      <div className={styles.brand}>UCT</div>
      <div className={styles.mainItems}>
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [styles.item, isActive ? styles.active : ''].filter(Boolean).join(' ')
            }
            title={item.label}
            aria-label={item.label}
          >
            <span className={styles.icon} aria-hidden="true">{item.icon}</span>
            <span className={styles.label}>{item.label}</span>
          </NavLink>
        ))}
      </div>
      <div className={styles.bottomItems}>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            [styles.item, isActive ? styles.active : ''].filter(Boolean).join(' ')
          }
          title="Settings"
          aria-label="Settings"
        >
          <span className={styles.icon} aria-hidden="true">⚙️</span>
          <span className={styles.label}>Settings</span>
        </NavLink>
        <a
          href={WEBSITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.item}
          title="UCT Website"
          aria-label="UCT Website"
        >
          <span className={styles.icon} aria-hidden="true">🌐</span>
          <span className={styles.label}>Website</span>
        </a>
      </div>
    </nav>
  )
}
