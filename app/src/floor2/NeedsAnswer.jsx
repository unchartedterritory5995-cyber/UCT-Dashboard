import { useMemo } from 'react'
import { timeAgo } from './util'
import { IconHelp } from './icons'

// Open questions with no accepted answer yet — the community's to-do list.
export default function NeedsAnswer({ questions = [], onOpen }) {
  const open = useMemo(
    () => questions.filter((p) => p.flair === 'Question' && !p.answerId)
      .sort((a, b) => (a.commentCount ?? 0) - (b.commentCount ?? 0)), // fewest replies first
    [questions],
  )

  return (
    <div className="rail-card needs-card">
      <h4><IconHelp size={16} /> Needs an Answer{open.length ? <span className="need-count">{open.length}</span> : null}</h4>
      <div className="need-list">
        {open.length === 0 ? (
          <div className="need-empty">All caught up — every question has an answer. 🎉</div>
        ) : open.map((p) => {
          const n = p.commentCount ?? 0
          return (
            <button key={p.id} className="need-row" onClick={() => onOpen(p.id)}>
              <span className="need-q"><IconHelp size={15} /></span>
              <div className="need-body">
                <div className="need-title">{p.title}</div>
                <div className="need-meta">{n} repl{n === 1 ? 'y' : 'ies'} · {timeAgo(p.createdAt)}</div>
              </div>
              <span className="need-cta">Answer</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
