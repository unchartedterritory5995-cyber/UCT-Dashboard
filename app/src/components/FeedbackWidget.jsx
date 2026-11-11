import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import UIcon from './ui/UIcon'
import useHideOnScroll from '../hooks/useHideOnScroll'
import useScrollLocked from '../hooks/useScrollLocked'
import fb from './FeedbackWidget.module.css'
import Textarea from './ui/Textarea'
import {
  OPEN_FEEDBACK_EVENT, helpHostMounted, markFeedbackMenuMounted, shortcutsHostOpen, subscribeHelpHosts,
} from './feedbackDoor'
import { HELP_SEARCH_HREF, HELP_WALKTHROUGHS_HREF, NEW_TICKET_HREF, QUICK_ANSWERS_HREF } from './helpAnchors'
import { notebookFlag } from '../pages/journal-2-0/lib/offline/notebookFlags'
import { checklistEnabled } from '../pages/journal-2-0/components/notebook/onboarding/gettingStartedPref'

/** Which rows this page may offer (Tier 2 review minors 10 and 17): "Tours" only where Help > Walkthroughs is on the
 *  Support page (the same predicate Support.jsx's section reads), and "Keyboard shortcuts" only where the page has a
 *  shortcut sheet and the member has a keyboard (not a phone-sized touch screen). */
export function helpMenuRows({ hasShortcuts, flag = notebookFlag, phoneTouch = false } = {}) {
  return HELP_MENU_ITEMS.filter((it) => {
    if (it.key === 'shortcuts') return hasShortcuts && !phoneTouch
    if (it.key === 'tours') return checklistEnabled(flag)
    return true
  })
}
const phoneTouchNow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(pointer: coarse) and (max-width: 640px)').matches

/** S14 (audit 2026-11-05): the ONE Help menu's rows, in the spec's order. `shortcuts` is offered only where the page
 *  has a keyboard-shortcut sheet (a registered shortcuts host). */
export const HELP_MENU_ITEMS = Object.freeze([
  { key: 'search', label: 'Search help', icon: 'search', href: HELP_SEARCH_HREF },
  { key: 'answers', label: 'Quick answers', icon: 'sparkle', href: QUICK_ANSWERS_HREF },
  { key: 'shortcuts', label: 'Keyboard shortcuts', icon: 'sliders' },
  { key: 'tours', label: 'Tours', icon: 'compass', href: HELP_WALKTHROUGHS_HREF },
  { key: 'feedback', label: 'Send feedback', icon: 'chat' },
])

const S = {
  btn: {
    position: 'fixed', top: 10, right: 14, width: 24, height: 24,
    borderRadius: '50%', background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)',
    color: '#c9a84c', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 500, transition: 'all 0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    lineHeight: 1,
  },
  menu: {
    position: 'fixed', top: 40, right: 14, width: 170,
    background: '#1a1c17', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, zIndex: 499, boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  },
  menuItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', cursor: 'pointer', fontSize: 12,
    color: '#e8e3d6', fontFamily: 'Instrument Sans, sans-serif',
    fontWeight: 600, letterSpacing: 0.3,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    transition: 'background 0.12s',
  },
  popup: {
    position: 'fixed', top: 40, right: 14, width: 300,
    background: '#1a1c17', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, padding: 18, zIndex: 499,
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  menuButton: {
    width: '100%', textAlign: 'left', borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderRadius: 0,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  title: { fontSize: 12, color: '#c9a84c', fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' },
  textarea: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#e8e3d6', padding: '8px 10px', borderRadius: 6,
    fontSize: 12, fontFamily: 'inherit', resize: 'vertical', minHeight: 70, outline: 'none',
  },
  starsRow: { display: 'flex', gap: 3, alignItems: 'center' },
  star: (active) => ({
    fontSize: 17, cursor: 'pointer', color: active ? '#c9a84c' : 'rgba(255,255,255,0.15)',
    transition: 'color 0.15s', background: 'none', border: 'none', padding: '0 2px',
  }),
  sendBtn: {
    background: 'rgba(201,168,76,0.18)', color: '#c9a84c',
    border: '1px solid rgba(201,168,76,0.35)', padding: '7px 14px',
    borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  success: { color: '#4ade80', fontSize: 12, textAlign: 'center', padding: 14 },
  ticketLink: { color: '#c9a84c', fontSize: 12, textDecoration: 'underline' },
}

/** Where a menu hangs under `el`: 6 px below it, its right edge on the button's, kept inside an 8 px gutter. */
export function anchorUnder(el, vw = typeof window !== 'undefined' ? window.innerWidth : 0) {
  const r = el?.getBoundingClientRect?.()
  if (!r || (!r.width && !r.height)) return null
  const right = Math.max(8, Math.round((vw || r.right) - r.right))
  return { top: Math.round(r.bottom + 6), right }
}

export default function FeedbackWidget() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mode, setMode] = useState(null) // null | 'menu' | 'feedback'
  const [message, setMessage] = useState('')
  const [rating, setRating] = useState(0)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [hovered, setHovered] = useState(null)
  const [anchor, setAnchor] = useState(null)   // { top, right } under a page's Help button, or null (the corner)
  // S14: a page that draws its own Help button (the Journal header) is a help host; the corner "?" steps aside
  // while one is mounted, so exactly one "?" is on screen. The menu below still answers both.
  const hostTick = useSyncExternalStore(subscribeHelpHosts, () => (helpHostMounted() ? 1 : 0) + (shortcutsHostOpen() ? 2 : 0))
  const pageOwnsHelp = (hostTick & 1) === 1
  const hasShortcuts = (hostTick & 2) === 2
  const hiddenOnScroll = useHideOnScroll()
  const scrollLocked = useScrollLocked()   // a modal/sheet is open
  const triggerRef = useRef(null)
  const returnToRef = useRef(null)   // fix round 2 (N2): the opener, when the feedback door opened it
  const panelRef = useRef(null)
  const firstItemRef = useRef(null)
  const messageRef = useRef(null)
  // Opening the menu moves focus into it (fix round 1, minor 8); choosing Send Feedback unmounts the
  // pressed item, so focus goes to the message field, never <body> (fix round 2, re-review N7).
  useEffect(() => {
    if (mode === 'menu') firstItemRef.current?.focus()
    if (mode === 'feedback') messageRef.current?.focus()
  }, [mode])

  // ⛔ Audit 2026-11-05, spec S5 (B10): Esc did not close this, and a transparent full-page
  // backdrop (z-index 498) sat over the whole app while it was open -- the member's next click on
  // the page was eaten just to close it. The backdrop is gone. While open: Esc closes and hands
  // focus back to the "?" button; a press OUTSIDE the panel and the button closes it and still
  // reaches whatever was pressed (a capture-phase listener that never stops the event).
  useEffect(() => {
    if (!mode) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeAndReturn()
    }
    const onDown = (e) => {
      // the control that opened it (the Journal header's Help, the phone "+") toggles on its own press
      const inside = panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)
        || returnToRef.current?.contains?.(e.target)
      if (!inside) close()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Tier 1b fix round 1 (review Minor 8): the phone Notebook does not draw the "?" (S12); its "+" sheet opens this
  // menu through components/feedbackDoor.js.
  useEffect(() => {
    const onOpen = (e) => {
      const next = e.detail?.mode === 'feedback' ? 'feedback' : 'menu'
      // S14: a page's own Help button is a toggle, like the corner "?": pressed again while its menu is open, it closes
      if (e.detail?.toggle && returnToRef.current && returnToRef.current === e.detail?.returnTo) {
        setMode((m) => (m ? null : next))
        return
      }
      returnToRef.current = e.detail?.returnTo || null
      // Review minor 9: opened from a page's own Help button, the menu hangs under THAT button (right-aligned to it,
      // inside the viewport), not in the corner where the corner "?" would be.
      setAnchor(e.detail?.toggle ? anchorUnder(e.detail.returnTo) : null)
      setMode(next)
    }
    window.addEventListener(OPEN_FEEDBACK_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, onOpen)
  }, [])
  // S14: the menu can answer the door only where it renders (a signed-in member, off the admin pages).
  const answers = Boolean(user) && !location.pathname.startsWith('/admin')
  useEffect(() => (answers ? markFeedbackMenuMounted() : undefined), [answers])

  if (!user || location.pathname.startsWith('/admin')) return null
  // Hide when a modal/sheet is open so the "?" never covers its bottom CTA.
  if (scrollLocked && !mode) return null

  // Tuck away while scrolling, but stay put while a menu/popup is open.
  const tucked = hiddenOnScroll && !mode

  function close() { setMode(null); setSent(false); setMessage(''); setRating(0) }
  // Fix round 2 (N2): opened through the feedback door, focus goes back to the control that opened it (the phone
  // Notebook's "+"); otherwise to the "?" as before.
  function closeAndReturn() {
    close()
    const back = returnToRef.current
    returnToRef.current = null
    if (back && back.isConnected) back.focus()
    else triggerRef.current?.focus()
  }

  function choose(it) {
    if (it.key === 'feedback') { setMode('feedback'); return }
    if (it.key === 'shortcuts') {
      // Focus goes back to the button that opened the menu FIRST, so the sheet records it as the place to return
      // to on close (the pressed row unmounts with the menu and would leave focus on <body>).
      const open = shortcutsHostOpen()
      closeAndReturn()
      open?.()
      return
    }
    close()
    returnToRef.current = null
    navigate(it.href)
  }

  function onMenuKeys(e) {
    const items = Array.from(panelRef.current?.querySelectorAll('[role="menuitem"]') || [])
    const at = items.indexOf(document.activeElement)
    let to = null
    if (e.key === 'ArrowDown') to = items[(at + 1) % items.length]
    else if (e.key === 'ArrowUp') to = items[(at - 1 + items.length) % items.length]
    else if (e.key === 'Home') to = items[0]
    else if (e.key === 'End') to = items[items.length - 1]
    if (to) { e.preventDefault(); to.focus() }
  }

  async function handleSend() {
    if (!message.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/auth/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), page: location.pathname, rating: rating || null }),
      })
      if (res.ok) {
        setSent(true)
        setTimeout(close, 2000)
      }
    } catch { /* ignore */ }
    finally { setSending(false) }
  }

  return (
    <>
      {mode === 'menu' && (
        <div style={anchor ? { ...S.menu, ...anchor } : S.menu} className={fb.panel} ref={panelRef} role="menu" aria-label="Help"
          onKeyDown={onMenuKeys} data-help-anchored={anchor ? '' : undefined}>
          {/* S14: ONE Help menu (Search help, Quick answers, Keyboard shortcuts, Tours, Send feedback). Real
              buttons with role="menuitem": Enter and Space work, Arrow keys walk them, Escape closes. */}
          {helpMenuRows({ hasShortcuts, phoneTouch: phoneTouchNow() }).map((it, i, all) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              ref={i === 0 ? firstItemRef : undefined}
              data-help-item={it.key}
              style={{ ...S.menuItem, ...S.menuButton, ...(i === all.length - 1 ? { borderBottom: 'none' } : null),
                background: hovered === it.key ? 'rgba(255,255,255,0.05)' : 'transparent' }}
              className={fb.menuItem}
              onMouseEnter={() => setHovered(it.key)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => choose(it)}
            >
              <UIcon name={it.icon} size={15} /> {it.label}
            </button>
          ))}
        </div>
      )}

      {mode === 'feedback' && (
        <div style={anchor ? { ...S.popup, ...anchor } : S.popup} className={fb.panel} ref={panelRef}>
          {sent ? (
            <div style={S.success}>Thanks! We read every message.</div>
          ) : (
            <>
              <div style={S.title}>Send Feedback</div>
              <Textarea aria-label="Feedback message"
                style={S.textarea}
                placeholder="What's on your mind?"
                value={message}
                onChange={e => setMessage(e.target.value)}
                ref={messageRef}
              />
              <div style={S.starsRow}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginRight: 3 }}>Rating:</span>
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} style={S.star(n <= rating)} onClick={() => setRating(n === rating ? 0 : n)}><UIcon name="star-fill" size={17} /></button>
                ))}
              </div>
              <button
                style={{ ...S.sendBtn, opacity: (!message.trim() || sending) ? 0.5 : 1, cursor: (!message.trim() || sending) ? 'not-allowed' : 'pointer' }}
                onClick={handleSend}
                disabled={!message.trim() || sending}
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
              {/* Tier 2 fix round 1 (review Important 3): feedback is not answered; a ticket is. The menu keeps the
                  spec's five rows, and this is the labelled door to a reply. */}
              <a href={NEW_TICKET_HREF} style={S.ticketLink} data-help-ticket=""
                onClick={(e) => { e.preventDefault(); close(); returnToRef.current = null; navigate(NEW_TICKET_HREF) }}>
                Need a reply? Open a support ticket
              </a>
            </>
          )}
        </div>
      )}

      {!pageOwnsHelp && <button
        ref={triggerRef}
        type="button"
        style={S.btn}
        className={`${fb.fab} ${tucked ? fb.hidden : ''}`}
        onClick={() => { if (mode) close(); else { setAnchor(null); setMode('menu') } }}
        title="Help & Feedback"
        aria-label="Help & Feedback"
        aria-expanded={Boolean(mode)}
        aria-haspopup="menu"
      >
        ?
      </button>}
    </>
  )
}
