import { useState, useRef, useEffect } from 'react'
import { Avatar } from './util'
import { IconUser, IconBookmark, IconGear } from './icons'

export default function AccountMenu({ onNav, me }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const go = (k) => { onNav?.(k); setOpen(false) }
  return (
    <div className="acct" ref={ref}>
      <button className="acct-btn" title="Account" onClick={() => setOpen((o) => !o)}>
        <Avatar id={me?.id} info={me} size={32} />
      </button>
      {open && (
        <div className="acct-menu">
          <div className="acct-head">
            <Avatar id={me?.id} info={me} size={36} />
            <div>
              <div className="acct-name">{me?.name || 'You'}</div>
              {me?.is_mentor && <div className="acct-handle">Mentor</div>}
            </div>
          </div>
          <button className="acct-item" onClick={() => go('myposts')}><IconUser size={16} /> My Posts</button>
          <button className="acct-item" onClick={() => go('bookmarks')}><IconBookmark size={16} /> Bookmarks</button>
          <button className="acct-item" onClick={() => setOpen(false)}><IconGear size={16} /> Settings</button>
          <div className="acct-sep" />
          <button className="acct-item muted" onClick={() => setOpen(false)}>Sign out</button>
        </div>
      )}
    </div>
  )
}
