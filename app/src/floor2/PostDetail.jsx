import { useState, useMemo } from 'react'
import { FLAIR } from './data'
import { Avatar, Author, RenderDoc, timeAgo, isOld, countComments } from './util'
import { IconBack, IconUp, IconDown, IconBookmark, IconShare, IconPin, IconCheck } from './icons'
import Reactions from './Reactions'
import ReplyBox from './ReplyBox'
import Comment from './Comment'
import ChartCard from './ChartCard'

const CSORTS = {
  top: (a, b) => b.votes - a.votes,
  new: (a, b) => b.createdAt - a.createdAt,
  old: (a, b) => a.createdAt - b.createdAt,
}

export default function PostDetail({ post, dispatch, onBack, me, canAnswer }) {
  const [csort, setCsort] = useState('top')
  const flair = FLAIR[post.flair] || {}
  const v = post.myVote
  const nComments = countComments(post.comments)
  const isQuestion = post.flair === 'Question'
  const comments = useMemo(() => {
    const sorted = [...post.comments].sort(CSORTS[csort])
    if (post.answerId) { // float the accepted answer to the top
      const i = sorted.findIndex((c) => c.id === post.answerId)
      if (i > 0) { const [ans] = sorted.splice(i, 1); sorted.unshift(ans) }
    }
    return sorted
  }, [post.comments, csort, post.answerId])

  return (
    <div className="detail-wrap">
      <div className="back-bar">
        <button className="back-btn" onClick={onBack}><IconBack size={16} /> Back to feed</button>
      </div>

      <article className={`card detail accented ${post.pinned ? 'pinned' : ''}`}
        style={{ borderLeftColor: flair.color, borderLeftWidth: '3px' }}>
        <div className="votecol">
          <button className={`vote-btn up ${v === 1 ? 'on' : ''}`} onClick={() => dispatch({ type: 'VOTE_POST', postId: post.id, dir: 1 })}><IconUp size={20} /></button>
          <span className={`vote-score ${v === 1 ? 'up' : v === -1 ? 'down' : ''}`}>{post.votes}</span>
          <button className={`vote-btn down ${v === -1 ? 'on' : ''}`} onClick={() => dispatch({ type: 'VOTE_POST', postId: post.id, dir: -1 })}><IconDown size={20} /></button>
        </div>
        <div className="card-body">
          <div className="post-meta">
            <Avatar id={post.author} info={post.authorInfo} size={24} />
            <Author info={post.authorInfo} />
            <span className="dot-sep">·</span>
            <span>{timeAgo(post.createdAt)}</span>
            {post.pinned && <><span className="dot-sep">·</span><span className="pin-flag"><IconPin size={13} /> Pinned</span></>}
            <span style={{ flex: 1 }} />
            {post.answerId && <span className="answered-badge"><IconCheck size={12} /> Answered</span>}
            <span className="flair" style={{ color: flair.color, background: flair.bg, borderColor: flair.border }}>{post.flair}</span>
          </div>

          <h1 className="post-title">{post.title}</h1>
          <RenderDoc body={post.body} className="post-body" />
          {post.chart && <ChartCard {...post.chart} height={230} />}

          {post.tickers.length > 0 && (
            <div className="tickers">{post.tickers.map((t) => <span key={t} className="ticker-chip" data-ticker={t}>${t}</span>)}</div>
          )}

          <div className="actions">
            <Reactions reactions={post.reactions} onToggle={(emoji) => dispatch({ type: 'REACT_POST', postId: post.id, emoji })} />
            <span className="act-spacer" />
            <button className={`act-btn ${post.saved ? 'on' : ''}`} onClick={() => dispatch({ type: 'SAVE_POST', postId: post.id })}>
              <IconBookmark size={16} /> {post.saved ? 'Bookmarked' : 'Bookmark'}
            </button>
            <button className="act-btn"><IconShare size={16} /> Share</button>
          </div>
        </div>
      </article>

      <div className="reply-composer">
        <ReplyBox me={me} placeholder="Share your take, answer the question, or add to the conversation…"
          onSubmit={(body, chart) => dispatch({ type: 'ADD_COMMENT', postId: post.id, parentId: null, body, chart })} />
        {isOld(post.createdAt) && (
          <div className="revive-hint">This thread is {timeAgo(post.createdAt).replace(' ago', '')} old — replying brings it back to the top for everyone. Nothing here expires.</div>
        )}
      </div>

      <div className="comments-head">
        <h3>{nComments} {nComments === 1 ? 'comment' : 'comments'}</h3>
        <div className="sort-mini">
          {['top', 'new', 'old'].map((k) => (
            <button key={k} className={csort === k ? 'active' : ''} onClick={() => setCsort(k)}>
              {k === 'top' ? 'Top' : k === 'new' ? 'Newest' : 'Oldest'}
            </button>
          ))}
        </div>
      </div>

      {comments.map((c) => (
        <Comment key={c.id} postId={post.id} comment={c} dispatch={dispatch} me={me}
          canMark={isQuestion && canAnswer}
          isAnswer={c.id === post.answerId}
          onMarkAnswer={(cid) => dispatch({ type: 'MARK_ANSWER', postId: post.id, commentId: cid })}
        />
      ))}
    </div>
  )
}
