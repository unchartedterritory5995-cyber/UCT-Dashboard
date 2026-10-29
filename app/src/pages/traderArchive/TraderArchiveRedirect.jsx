// app/src/pages/traderArchive/TraderArchiveRedirect.jsx
//
// /trader-archive moved into The Desk (owner ruling 2026-10-28). Old links, bookmarks and links
// already posted in Discord keep working: ?sym, ?setup, ?view and ?q carry over to the Desk tab.
import { Navigate, useLocation } from 'react-router-dom'

import { archiveHref } from '../../utils/traderArchive'

export default function TraderArchiveRedirect() {
  const p = new URLSearchParams(useLocation().search)
  const view = p.get('view') || undefined
  let to = archiveHref({ view, sym: p.get('sym') || undefined, setup: p.get('setup') || undefined })
  if (p.get('q')) to += `&q=${encodeURIComponent(p.get('q'))}`
  return <Navigate to={to} replace />
}
