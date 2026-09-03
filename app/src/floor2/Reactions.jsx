import { useState, useRef, useEffect } from 'react'
import { REACTION_PALETTE } from './util'
import { IconPlus } from './icons'

// Discord-style reaction pills + an emoji picker. `size="mini"` for comments.
// The picker is fixed-positioned so it is never clipped by the scrolling column.
export default function Reactions({ reactions, onToggle, size }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const ref = useRef(null)
  const btnRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true) }
  }, [open])

  const toggle = (e) => {
    e.stopPropagation()
    if (open) { setOpen(false); return }
    const r = btnRef.current.getBoundingClientRect()
    const popW = 372; const popH = 48
    const left = Math.max(8, Math.min(r.left, window.innerWidth - popW - 8))
    let top = r.bottom + 6
    if (top + popH > window.innerHeight - 8) top = r.top - popH - 6
    setPos({ left, top })
    setOpen(true)
  }

  const pill = size === 'mini' ? 'mini-react' : 'reaction'
  return (
    <>
      {reactions.filter((r) => r.count > 0).map((r) => (
        <button key={r.emoji} className={`${pill} ${r.reacted ? 'on' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggle(r.emoji) }}>
          <span className="emo">{r.emoji}</span>{r.count}
        </button>
      ))}
      <div className="pop-anchor" ref={ref}>
        <button ref={btnRef} className={size === 'mini' ? 'mini-btn' : 'reaction add-react'}
          title="Add reaction" onClick={toggle}>
          <IconPlus size={size === 'mini' ? 14 : 16} />
        </button>
        {open && (
          <div className="emoji-pop" style={{ position: 'fixed', left: pos.left, top: pos.top, margin: 0, zIndex: 250 }}
            onClick={(e) => e.stopPropagation()}>
            {REACTION_PALETTE.map((emo) => (
              <button key={emo} onClick={() => { onToggle(emo); setOpen(false) }}>{emo}</button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
