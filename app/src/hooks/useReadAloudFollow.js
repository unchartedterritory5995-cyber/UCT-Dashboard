/**
 * Follow-along highlighting for read-aloud.
 *
 * Highlights the briefing block (paragraph / focus bullet) currently being read
 * and scrolls it into view. Timing is char-proportional across the rendered
 * blocks — OpenAI TTS gives no word timestamps, so this estimates position from
 * how far through the audio we are. It tracks to within a paragraph, which is
 * what "follow along" needs.
 */
import { useEffect, useRef } from 'react'
import { subscribeProgress } from '../utils/readAloudProgress'

const HL_CLASS = 'rd-reading'

function inViewport(el) {
  const r = el.getBoundingClientRect()
  return r.top >= 0 && r.bottom <= (window.innerHeight || document.documentElement.clientHeight)
}

export default function useReadAloudFollow({ containerRef, trackId }) {
  const blocksRef = useRef([])
  const cumRef = useRef({ cum: [], total: 0 })
  const activeRef = useRef(-1)

  useEffect(() => {
    const clear = () => {
      const blocks = blocksRef.current
      if (activeRef.current >= 0 && blocks[activeRef.current]) {
        blocks[activeRef.current].classList.remove(HL_CLASS)
      }
      activeRef.current = -1
    }

    const unsub = subscribeProgress((p) => {
      const root = containerRef.current
      if (!root) return
      if (!trackId || p.trackId !== trackId || !p.duration) { clear(); return }

      // (Re)build the block list + cumulative char lengths when stale.
      let blocks = blocksRef.current
      if (!blocks.length || !root.contains(blocks[0])) {
        const sec = root.querySelector('.rd-sections') || root
        blocks = Array.from(sec.querySelectorAll('p, li'))
        blocksRef.current = blocks
        let total = 0
        const cum = []
        for (const b of blocks) {
          cum.push(total)
          total += (b.textContent || '').trim().length + 1
        }
        cumRef.current = { cum, total }
        activeRef.current = -1
      }

      const { cum, total } = cumRef.current
      if (!total || !blocks.length) return

      const frac = Math.min(1, Math.max(0, p.currentTime / p.duration))
      const target = frac * total
      let idx = 0
      for (let i = 0; i < blocks.length; i++) {
        if (cum[i] <= target) idx = i
        else break
      }

      if (idx !== activeRef.current) {
        if (activeRef.current >= 0 && blocks[activeRef.current]) {
          blocks[activeRef.current].classList.remove(HL_CLASS)
        }
        const el = blocks[idx]
        if (el) {
          el.classList.add(HL_CLASS)
          if (!inViewport(el)) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
        activeRef.current = idx
      }
    })

    return () => { clear(); unsub() }
  }, [containerRef, trackId])
}
