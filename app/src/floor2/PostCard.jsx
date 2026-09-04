import { useState, useEffect, useRef } from 'react'
import { FLAIR } from './data'
import { Avatar, Author, timeAgo, highlightMatch, docSnippet, docImages } from './util'
import { IconUp, IconDown, IconComment, IconShare, IconBookmark, IconPin, IconCheck, IconTrash } from './icons'
import Reactions from './Reactions'
import ChartCard from './ChartCard'

// Delete button with a two-step confirm (guards against accidental deletion).
function DeleteButton({ onDelete }) {
  const [confirm, setConfirm] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const click = (e) => {
    e.stopPropagation()
    if (confirm) { onDelete() } else { setConfirm(true); timer.current = setTimeout(() => setConfirm(false), 3000) }
  }
  return (
    <button className={`act-btn ${confirm ? 'danger' : ''}`} onClick={click}>
      <IconTrash size={16} /> {confirm ? 'Confirm delete?' : 'Delete'}
    </button>
  )
}

function VoteCol({ post, dispatch }) {
  const v = post.myVote
  return (
    <div className="votecol" onClick={(e) => e.stopPropagation()}>
      <button className={`vote-btn up ${v === 1 ? 'on' : ''}`}
        onClick={() => dispatch({ type: 'VOTE_POST', postId: post.id, dir: 1 })}>
        <IconUp size={20} />
      </button>
      <span className={`vote-score ${v === 1 ? 'up' : v === -1 ? 'down' : ''}`}>{post.votes}</span>
      <button className={`vote-btn down ${v === -1 ? 'on' : ''}`}
        onClick={() => dispatch({ type: 'VOTE_POST', postId: post.id, dir: -1 })}>
        <IconDown size={20} />
      </button>
    </div>
  )
}

export default function PostCard({ post, onOpen, dispatch, highlight, mine }) {
  const flair = FLAIR[post.flair] || {}
  const nComments = post.commentCount ?? 0
  const snippet = docSnippet(post.body)
  const image = docImages(post.body)[0]
  return (
    <article className={`card clickable accented ${post.pinned ? 'pinned' : ''}`} onClick={onOpen}
      style={{ borderLeftColor: flair.color, borderLeftWidth: '3px' }}>
      <VoteCol post={post} dispatch={dispatch} />
      <div className="card-body">
        <div className="post-meta">
          <Avatar id={post.author} info={post.authorInfo} size={22} />
          <Author info={post.authorInfo} />
          <span className="dot-sep">·</span>
          <span>{timeAgo(post.createdAt)}</span>
          {post.pinned && <><span className="dot-sep">·</span><span className="pin-flag"><IconPin size={13} /> Pinned</span></>}
          <span style={{ flex: 1 }} />
          {post.answerId && <span className="answered-badge"><IconCheck size={12} /> Answered</span>}
          <span className="flair" style={{ color: flair.color, background: flair.bg, borderColor: flair.border }}>{post.flair}</span>
        </div>

        <h2 className="post-title">{highlight ? highlightMatch(post.title, highlight) : post.title}</h2>
        {snippet && <div className="post-snippet">{highlight ? highlightMatch(snippet, highlight) : snippet}</div>}

        {post.tickers.length > 0 && (
          <div className="tickers">
            {post.tickers.map((t) => <span key={t} className="ticker-chip" data-ticker={t}>${t}</span>)}
          </div>
        )}

        {post.chart && <ChartCard {...post.chart} caption={null} height={160} />}
        {image && (
          <div className="post-images feed">
            <img src={image} alt="attachment" />
          </div>
        )}

        <div className="actions">
          <Reactions
            reactions={post.reactions}
            onToggle={(emoji) => dispatch({ type: 'REACT_POST', postId: post.id, emoji })}
          />
          <span className="act-spacer" />
          <button className="act-btn" onClick={(e) => { e.stopPropagation(); onOpen() }}>
            <IconComment size={16} /> {nComments} {nComments === 1 ? 'comment' : 'comments'}
          </button>
          <button className={`act-btn ${post.saved ? 'on' : ''}`}
            onClick={(e) => { e.stopPropagation(); dispatch({ type: 'SAVE_POST', postId: post.id }) }}>
            <IconBookmark size={16} /> {post.saved ? 'Bookmarked' : 'Bookmark'}
          </button>
          <button className="act-btn" onClick={(e) => e.stopPropagation()}><IconShare size={16} /></button>
          {mine && (
            <DeleteButton onDelete={() => dispatch({ type: 'DELETE_POST', postId: post.id })} />
          )}
        </div>
      </div>
    </article>
  )
}
