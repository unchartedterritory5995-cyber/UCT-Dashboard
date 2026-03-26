import { Outlet } from 'react-router-dom'
import NavBar from './NavBar'
import MobileNav from './MobileNav'
import styles from './Layout.module.css'

export default function Layout({ children }) {
  return (
    <div className={styles.shell}>
      {/* Desktop sidebar — hidden on mobile via CSS */}
      <NavBar />
      {/* Mobile header + drawer — hidden on desktop via CSS */}
      <MobileNav />
      <main className={styles.main}>
        {children ?? <Outlet />}
      </main>
    </div>
  )
}
