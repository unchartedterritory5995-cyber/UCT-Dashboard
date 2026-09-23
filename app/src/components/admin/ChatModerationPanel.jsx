// app/src/components/admin/ChatModerationPanel.jsx
//
// Packet Q CP1 (signed 2026-09-22, fingerprint 362cb5156) -- a live chat
// message can already be reported by a member (ChatView.jsx's
// reportMessage -> POST /api/community/chat/reports), but nothing read the
// admin queue GET/PATCH /api/community/chat/admin/reports already exists
// for. Modeled directly on CommunityReportsPanel.jsx's exact idiom (its own
// sibling, older thread/post pipeline, a DIFFERENT route) -- same file,
// same shape, deliberately no "Mute author" action (that sibling's mute
// endpoint is thread/post-scoped; whether it applies to chat authors is not
// verified here, per the packet's own explicit deferral).
import useSWR from 'swr'
import { apiCall, fetcher } from '../../pages/community/hooks/useCommunity'

export default function ChatModerationPanel() {
  const { data, mutate } = useSWR('/api/community/chat/admin/reports', fetcher,
                                  { refreshInterval: 60_000 })
  const reports = data?.reports || []
  if (!data) return null            // flag off / not loaded — render nothing

  const act = async (id, action) => {
    await apiCall(`/api/community/chat/admin/reports/${id}`, { action }, 'PATCH')
    mutate()
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h3>Chat Moderation ({reports.length} open)</h3>
      {reports.length === 0 && <p style={{ opacity: 0.6 }}>Queue is clear.</p>}
      {reports.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center',
                                 padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden',
                         textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong>#{r.channel_slug || 'chat'}</strong> — {r.preview}
            <em style={{ opacity: 0.6 }}> · "{r.reason}" by {r.reporter_id}</em>
          </span>
          <button onClick={() => act(r.id, 'hide')}>Hide</button>
          <button onClick={() => act(r.id, 'dismiss')}>Dismiss</button>
        </div>
      ))}
    </section>
  )
}
