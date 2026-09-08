import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CaptureDialog from './CaptureDialog'
import { CAPTURE_OPEN_EVENT } from '../../lib/captureBus'
import { captureDestination } from '../../lib/capture'

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

  useEffect(() => {
    const onOpen = (e) => { setDetail(e.detail || {}); setSeq((n) => n + 1); setOpen(true) }
    window.addEventListener(CAPTURE_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(CAPTURE_OPEN_EVENT, onOpen)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
      if ((e.code || '') !== 'KeyY') return
      e.preventDefault()
      // Deliberately works while typing in the editor: "capture the thought I
      // just had" is a real case, and a shortcut that only works when no field
      // is focused would miss it.
      setDetail({}); setSeq((n) => n + 1); setOpen(true)
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
      onSaved={onSaved}
    />
  )
}
