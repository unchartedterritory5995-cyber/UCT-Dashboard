import { Outlet } from 'react-router-dom'
import NavBar from './NavBar'
import styles from './Layout.module.css'

export default function Layout({ children }) {
  return (
    <div className={styles.shell}>
      <NavBar />
      <main className={styles.main}>
        {children ?? <Outlet />}
      </main>
    </div>
  )
}
