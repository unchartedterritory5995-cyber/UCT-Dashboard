import { CATEGORIES } from './data'
import { Avatar } from './util'
import {
  IconHome, IconHelp, IconChat, IconBulb, IconTrophy, IconBook, IconBookmark, IconUser, IconBell,
} from './icons'

const ICONS = { home: IconHome, help: IconHelp, chat: IconChat, bulb: IconBulb, trophy: IconTrophy, book: IconBook }

const PRESENCE = [
  { id: 'u1', name: 'UCT Mentor', is_mentor: true }, { id: 'u2', name: 'Blake' },
  { id: 'u3', name: 'Dana R' }, { id: 'u4', name: 'Marcus' }, { id: 'u5', name: 'Priya' },
]

export default function Sidebar({ view, onPick, notifUnread = 0 }) {
  const item = (key, label, Icon, badge) => (
    <button key={key} className={`nav-item ${view === key ? 'active' : ''}`} onClick={() => onPick(key)}>
      <Icon size={19} /> {label}
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </button>
  )

  return (
    <aside className="sidebar">
      <div className="side-section">Browse</div>
      {CATEGORIES.map((c) => item(c.key, c.label, ICONS[c.icon] || IconChat))}

      <div className="side-divider" />
      <div className="side-section">Yours</div>
      {item('myposts', 'My Posts', IconUser)}
      {item('bookmarks', 'Bookmarks', IconBookmark)}
      {item('notifications', 'Notifications', IconBell, notifUnread || null)}

      <div className="side-divider" />
      <div className="presence-card">
        <div className="presence-top"><span className="presence-dot" /> On the floor</div>
        <div className="presence-avatars">
          {PRESENCE.map((p) => <Avatar key={p.id} id={p.id} info={p} size={26} />)}
        </div>
        <div className="presence-sub">Permanent &amp; searchable — nothing here expires</div>
      </div>
    </aside>
  )
}
