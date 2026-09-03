import { useState } from 'react'
import { Avatar, Author, RenderDoc, timeAgo, isFresh, countComments } from './util'
import { IconUp, IconDown, IconReply, IconCheck } from './icons'
import Reactions from './Reactions'
import ReplyBox from './ReplyBox'
import ChartCard from './ChartCard'

export default function Comment({ postId, comment, dispatch, me, depth = 0, isAnswer, canMark, onMarkAnswer }) {
  const [collapsed, setCollapsed] = useState(false)
  const [replying, setReplying] = useState(false)
  const v = comment.myVote
  const childCount = countComments(comment.replies)

  if (comment.deleted) {
    return (
      <div className="comment">
        <div className="comment-inner">
          <div className="thread-rail"><div className="thread-line" /></div>
          <div style={{ minWidth: 0 }}>
            <div className="c-body" style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>[deleted]</div>
            {comment.replies.length > 0 && (
              <div className="replies">
                {comment.replies.map((r) => (
                  <Comment key={r.id} postId={postId} comment={r} dispatch={dispatch} me={me} depth={depth + 1} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`comment ${isAnswer ? 'is-answer' : ''}`}>
      <div className="comment-inner">
        <div className="thread-rail">
          <div className="thread-line" title={collapsed ? 'Expand' : 'Collapse thread'}
            onClick={() => setCollapsed((c) => !c)} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="c-avatar-row">
            <Avatar id={comment.author} info={comment.authorInfo} size={24} />
            <Author info={comment.authorInfo} />
            <span className="dot-sep">·</span>
            <span>{timeAgo(comment.createdAt)}</span>
            {isFresh(comment.createdAt) && <span className="new-badge">New</span>}
            {collapsed && childCount > 0 && (
              <button className="mini-btn" onClick={() => setCollapsed(false)} style={{ marginLeft: 6 }}>
                [+] {childCount} more
              </button>
            )}
          </div>

          {!collapsed && (
            <>
              {isAnswer && <div className="answer-tag"><IconCheck size={13} /> Answer</div>}
              <RenderDoc body={comment.body} className="c-body" />
              {comment.chart && <ChartCard {...comment.chart} height={170} />}
              <div className="c-actions">
                <span className="c-vote">
                  <button className={`up ${v === 1 ? 'on' : ''}`}
                    onClick={() => dispatch({ type: 'VOTE_COMMENT', postId, commentId: comment.id, dir: 1 })}>
                    <IconUp size={16} />
                  </button>
                  <span className={`n ${v === 1 ? 'up' : ''}`}>{comment.votes}</span>
                  <button className={`down ${v === -1 ? 'on' : ''}`}
                    onClick={() => dispatch({ type: 'VOTE_COMMENT', postId, commentId: comment.id, dir: -1 })}>
                    <IconDown size={16} />
                  </button>
                </span>
                <button className="mini-btn" onClick={() => setReplying((r) => !r)}>
                  <IconReply size={15} /> Reply
                </button>
                <Reactions size="mini"
                  reactions={comment.reactions}
                  onToggle={(emoji) => dispatch({ type: 'REACT_COMMENT', postId, commentId: comment.id, emoji })}
                />
                {canMark && (
                  <button className={`mini-btn ${isAnswer ? 'answer-active' : ''}`} onClick={() => onMarkAnswer(comment.id)}>
                    <IconCheck size={14} /> {isAnswer ? 'Unmark answer' : 'Mark as answer'}
                  </button>
                )}
              </div>

              {replying && (
                <ReplyBox autoFocus me={me} placeholder="Reply…"
                  onCancel={() => setReplying(false)}
                  onSubmit={(body, chart) => { dispatch({ type: 'ADD_COMMENT', postId, parentId: comment.id, body, chart }); setReplying(false) }}
                />
              )}

              {comment.replies.length > 0 && (
                <div className="replies">
                  {comment.replies.map((r) => (
                    <Comment key={r.id} postId={postId} comment={r} dispatch={dispatch} me={me} depth={depth + 1} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
