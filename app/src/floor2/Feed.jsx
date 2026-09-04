import PostCard from './PostCard'
import { IconFlame, IconSparkle, IconTop, IconComment } from './icons'

const TABS = [
  { key: 'hot', label: 'Hot', Icon: IconFlame },
  { key: 'new', label: 'New', Icon: IconSparkle },
  { key: 'top', label: 'Top', Icon: IconTop },
  { key: 'active', label: 'Active', Icon: IconComment },
]

export default function Feed({ posts, sort, setSort, searching, query, loading, onOpen, dispatch, showSort = true, myId }) {
  return (
    <>
      {(showSort || searching) && (
        <div className="feed-toolbar">
          {showSort && (
            <div className="fx-tabs">
              {TABS.map(({ key, label, Icon }) => (
                <button key={key} className={`fx-tab ${sort === key ? 'active' : ''}`} onClick={() => setSort(key)}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          )}
          {searching && (
            <span className="result-note"><b>{posts.length}</b> result{posts.length === 1 ? '' : 's'} for “{query.trim()}”</span>
          )}
        </div>
      )}

      {posts.length === 0 ? (
        <div className="empty">
          {loading ? <h3>Loading…</h3> : (
            <>
              <h3>No conversations found</h3>
              {searching
                ? <>Nothing matches “{query.trim()}” yet — try a broader term or a $TICKER. Or start the conversation with <b>New Post</b>.</>
                : <>Be the first to post here.</>}
            </>
          )}
        </div>
      ) : (
        <div className="feed">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} onOpen={() => onOpen(p.id)} dispatch={dispatch}
              highlight={searching ? query : ''} mine={p.author === myId} />
          ))}
        </div>
      )}
    </>
  )
}
