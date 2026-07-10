// app/src/components/admin/CommunityReportsPanel.jsx
import useSWR from 'swr'
import { apiCall, fetcher } from '../../pages/community/hooks/useCommunity'

export default function CommunityReportsPanel() {
  const { data, mutate } = useSWR('/api/community/admin/reports', fetcher,
                                  { refreshInterval: 60_000 })
  const reports = data?.reports || []
  if (!data) return null            // flag off / not loaded — render nothing

  const act = async (id, action) => {
    await apiCall(`/api/community/admin/reports/${id}`, { action }, 'PATCH')
    mutate()
  }
  const mute = async (userId) => {
    if (!window.confirm(`Mute ${userId}? They can read but not post.`)) return
    await apiCall(`/api/community/admin/mute/${userId}`, { muted: true })
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h3>Community Reports ({reports.length} open)</h3>
      {reports.length === 0 && <p style={{ opacity: 0.6 }}>Queue is clear.</p>}
      {reports.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center',
                                 padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden',
                         textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong>{r.thread_id ? 'Thread' : 'Post'}</strong> — {r.preview}
            <em style={{ opacity: 0.6 }}> · “{r.reason}” by {r.reporter_id}</em>
          </span>
          <button onClick={() => act(r.id, 'hide')}>Hide</button>
          <button onClick={() => act(r.id, 'dismiss')}>Dismiss</button>
          <button onClick={() => mute(r.target_author_id)}>Mute author</button>
        </div>
      ))}
    </section>
  )
}
