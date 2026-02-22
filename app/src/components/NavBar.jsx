// app/src/components/NavBar.jsx
import { NavLink } from 'react-router-dom'
import styles from './NavBar.module.css'

const NAV_ITEMS = [
  { to: '/dashboard',    label: 'Dashboard',    icon: '⊞' },
  { to: '/morning-wire', label: 'Morning Wire',  icon: '📰' },
  { to: '/traders',      label: 'Traders',       icon: '👥' },
  { to: '/screener',     label: 'Screener',      icon: '⚡' },
  { to: '/options-flow', label: 'Options Flow',  icon: '📊' },
  { to: '/post-market',  label: 'Post Market',   icon: '🌙' },
  { to: '/model-book',   label: 'Model Book',    icon: '📖' },
]

export default function NavBar() {
  return (
    <nav data-testid="nav-sidebar" className={styles.nav}>
      <div className={styles.brand}>UCT</div>
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
    </nav>
  )
}
