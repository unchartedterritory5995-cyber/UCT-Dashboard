import { IconPlus, IconCommunity, IconBell } from './icons'
import { Avatar } from './util'
import SearchBox from './SearchBox'
import AccountMenu from './AccountMenu'

export default function Header({ embedded, query, setQuery, onBrand, onNew, onNav, notifUnread = 0, me }) {
  const search = <SearchBox query={query} setQuery={setQuery} />

  const bell = (
    <button className="hdr-icon" title="Notifications" onClick={() => onNav?.('notifications')}>
      <IconBell size={19} />
      {notifUnread > 0 && <span className="hdr-badge">{notifUnread > 9 ? '9+' : notifUnread}</span>}
    </button>
  )

  // Embedded: a compact page header inside the app content area.
  if (embedded) {
    return (
      <div className="fx-header">
        <div className="fx-h-left">
          <h1 className="fx-title" onClick={onBrand}>
            <IconCommunity size={18} /> Community
          </h1>
        </div>
        <div className="fx-h-center">{search}</div>
        <div className="fx-h-right">
          {bell}
          <AccountMenu onNav={onNav} me={me} />
          <button className="btn-new" onClick={onNew}><IconPlus size={16} /> New Post</button>
        </div>
      </div>
    )
  }

  // Standalone (floor2.html): full brand top bar.
  return (
    <header className="topbar">
      <div className="brand" onClick={onBrand}>
        <div className="brand-mark">UT</div>
        <div>
          <div className="brand-name">The Floor</div>
          <div className="brand-sub">UCT Community</div>
        </div>
      </div>
      {search}
      <div className="topbar-actions">
        <button className="btn-new" onClick={onNew}><IconPlus size={17} /> New Post</button>
        <span className="me-avatar"><Avatar id={me?.id} info={me} size={34} /></span>
      </div>
    </header>
  )
}
