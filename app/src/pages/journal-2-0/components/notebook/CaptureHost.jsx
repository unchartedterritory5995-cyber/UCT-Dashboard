import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import CaptureDialog from './CaptureDialog'
import { CAPTURE_OPEN_EVENT } from '../../lib/captureBus'
import { captureDestination } from '../../lib/capture'
import { shareCaptureDetail, takePendingShare } from '../../lib/shareTarget'
import { destinationFromLocation } from '../../lib/captureContext'
import { useJ2Recents } from '../../hooks/useJ2Notes'

/**
 * Mounts THE capture dialog once, app-wide, and owns the global shortcut.
 *
 * ⛔ THE SHORTCUT, AND WHY THIS ONE (Slice 2b §11 — audited before chosen; the
 * full audit is in docs/notebook/wave-l-capture-shortcut-audit.md):
 *   Cmd/Ctrl+K          — already the command palette
 *   Cmd/Ctrl+Shift+V/T  — already push-to-talk and read-aloud, both global
 *   Cmd/Ctrl+Shift+C/M  — browser devtools inspector / device toolbar
 *   Cmd/Ctrl+Shift+B/O  — bookmarks bar / bookmark manager
 *   Cmd/Ctrl+Shift+N    — incognito window
 *   Cmd/Ctrl+Shift+K    — Firefox web console
 * Cmd/Ctrl+Shift+Y is the least-contested remaining combination; its only known
 * collision is Firefox-on-Linux's Downloads library. The palette stays the
 * PRIMARY discoverable door, so the shortcut is an accelerator, not the only way
 * in — which is what makes an imperfect key acceptable rather than a trap.
 */
export default function CaptureHost() {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState({})
  // Bumped per opening so the dialog REMOUNTS: every capture starts clean.
  const [seq, setSeq] = useState(0)
  const navigate = useNavigate()
  const location = useLocation()
  // Recent notes are the destination picker's options when a door has no
  // context. Fetched only while capture is open, and reusing the member's own
  // canonical recents rather than a second destination store.
  const { notes: recents } = useJ2Recents({ enabled: open })

  // Where the member is standing, kept current for the once-bound key listener.
  // ⚠️ `recents` is fetched only while capture is OPEN, so at hotkey time it is
  // usually empty and a note destination falls back to the honest generic
  // label. The destination itself is correct either way — this only decides
  // whether the member reads the note's name or "This note".
  const ctxRef = useRef({ location, recents })
  ctxRef.current = { location, recents }

  useEffect(() => {
    const onOpen = (e) => { setDetail(e.detail || {}); setSeq((n) => n + 1); setOpen(true) }
    window.addEventListener(CAPTURE_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(CAPTURE_OPEN_EVENT, onOpen)
  }, [])

  // ⭐ THE MOBILE SHARE DOOR LANDS HERE (Wave L Slice 4 §6). `ShareTargetPage`
  // lives OUTSIDE `Layout`, so arriving from it always mounts this component
  // fresh — a mount-time consume is sufficient and needs no second channel.
  //
  // ⛔ CONSUMED EXACTLY ONCE (`takePendingShare` reads AND clears). A share left
  // in storage would reopen the dialog on every subsequent mount, which is a
  // capture the member cannot dismiss.
  useEffect(() => {
    const pending = takePendingShare()
    if (!pending) return
    setDetail(shareCaptureDetail(pending))
    setSeq((n) => n + 1)
    setOpen(true)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
      if ((e.code || '') !== 'KeyY') return
      e.preventDefault()
      // Deliberately works while typing in the editor: "capture the thought I
      // just had" is a real case, and a shortcut that only works when no field
      // is focused would miss it.
      // ⛔ AND IT CARRIES THE MEMBER'S CONTEXT. This used to pass `{}`, so the
      // hotkey pressed INSIDE a note asked which note to save to. Derived in
      // `captureContext.js` so the palette cannot answer it differently.
      // ⛔ Read through a REF, not the closure: this listener is bound once, so
      // a captured `location` would freeze at whatever page the app first
      // mounted on and quietly file every later capture there.
      const destination = destinationFromLocation(ctxRef.current.location,
                                                  { recents: ctxRef.current.recents })
      setDetail(destination ? { destination } : {})
      setSeq((n) => n + 1); setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onSaved = useCallback((result, opts) => {
    // Saving keeps the member exactly where they were (§20). Only an explicit
    // "Open" navigates, and it uses a normal push so Back returns here.
    if (opts?.open && result?.noteId) navigate(`/journal/notebook?note=${result.noteId}`)
  }, [navigate])

  return (
    <CaptureDialog
      key={seq}
      open={open}
      onClose={() => setOpen(false)}
      destination={detail.destination || captureDestination({})}
      initial={detail.initial || {}}
      doorSource={detail.source || 'hotkey'}
      recentDestinations={(recents || []).slice(0, 8)}
      onSaved={onSaved}
    />
  )
}
