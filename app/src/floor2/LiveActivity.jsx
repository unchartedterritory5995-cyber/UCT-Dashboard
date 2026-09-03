import { Avatar, timeAgo } from './util'

function verb(e) {
  switch (e.kind) {
    case 'reaction': return <>reacted <span className="emo">{e.emoji}</span> to</>
    case 'comment': return 'commented on'
    case 'reply': return 'replied in'
    case 'answer': return <span style={{ color: 'var(--gain)' }}>answered</span>
    case 'mention': return 'mentioned you in'
    case 'post': return 'posted'
    default: return 'in'
  }
}

// Real activity stream from /api/community/floor/activity (polled).
export default function LiveActivity({ activity = [], onOpen }) {
  return (
    <div className="rail-card live-card">
      <h4><span className="live-dot" /> LIVE ACTIVITY</h4>
      <div className="act-list">
        {activity.length === 0 ? (
          <div className="need-empty">Quiet on the floor right now.</div>
        ) : activity.map((e) => (
          <button key={e.id} className={`act-row ${Date.now() - e.createdAt < 20000 ? 'fresh' : ''}`}
            onClick={() => e.threadId && onOpen(e.threadId)}>
            <Avatar id={e.actorId} info={{ name: e.actor }} size={26} />
            <div className="act-text">
              <b>{e.actor}</b> {verb(e)} <span className="act-target">{e.postTitle}</span>
              <div className="act-time">{timeAgo(e.createdAt)}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
