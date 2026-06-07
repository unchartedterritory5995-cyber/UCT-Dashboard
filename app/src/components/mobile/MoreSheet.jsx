import { useNavigate } from 'react-router-dom'
import Sheet from './Sheet'
import styles from './MoreSheet.module.css'

const LINKS = [
  { to: '/uct-20', label: 'UCT 20', icon: '⭐' },
  { to: '/morning-wire', label: 'Morning Wire', icon: '📰' },
  { to: '/model-book', label: 'Model Book', icon: '📚' },
  { to: '/setup-library', label: 'Setup Library', icon: '🗂' },
  { to: '/support', label: 'Support', icon: '💬' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export default function MoreSheet({ open, onClose }) {
  const navigate = useNavigate()
  if (!open) return null
  const go = (to) => { onClose?.(); navigate(to) }
  return (
    <Sheet open onClose={onClose} variant="bottom-sheet" title="More">
      <div className={styles.list}>
        {LINKS.map((l) => (
          <button key={l.to} type="button" className={styles.item} onClick={() => go(l.to)}>
            <span className={styles.icon} aria-hidden="true">{l.icon}</span>
            <span>{l.label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
