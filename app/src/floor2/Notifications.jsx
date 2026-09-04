import { Avatar, timeAgo } from './util'

export default function Notifications({ notifications, onOpen, onMarkAll }) {
  const unread = notifications.filter((n) => !n.seen).length
  return (
    <div>
      <div className="notif-head">
        <h2>Notifications</h2>
        {unread > 0 && <button className="mark-read" onClick={onMarkAll}>Mark all read</button>}
      </div>
      {notifications.length === 0 ? (
        <div className="empty"><h3>No notifications yet</h3>When people react to or reply to your posts, you will see it here.</div>
      ) : (
        <div className="notif-list">
          {notifications.map((n) => (
            <div key={n.id} className={`notif ${n.seen ? '' : 'unread'}`} onClick={() => onOpen(n.threadId)}>
              <Avatar id={n.actorId} info={{ name: n.actor }} size={30} />
              <div className="notif-body">
                <span className="author"><span className="name">{n.actor}</span></span>{' '}
                {n.kind === 'reaction'
                  ? <>reacted <span className="emo">{n.emoji}</span> to your post</>
                  : n.kind === 'reply'
                    ? 'replied to your post'
                    : n.kind === 'answer'
                      ? 'marked your reply as the answer'
                      : 'commented on your post'}{' '}
                {n.postTitle && <span className="on-post">“{n.postTitle}”</span>}
                <div className="notif-time">{timeAgo(n.createdAt)}</div>
              </div>
              <span className={`notif-dot ${n.seen ? 'read' : ''}`} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
