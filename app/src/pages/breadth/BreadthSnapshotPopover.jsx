// app/src/pages/breadth/BreadthSnapshotPopover.jsx
//
// The Breadth Monitor's "Snapshot…" popover (owner 11-19), opened from the top bar's ⋯ menu. It is
// the /charts camera's floating menu (WorkspaceShotButton — same Signature panel, thumbnail, pixel
// size, "Copy image" / "Download PNG", same stylesheet), anchored under ⋯ instead of a camera
// button. The capture runs as soon as it opens; "Capturing…" shows while it renders.
//
// ⛔ The capture code and modern-screenshot are a dynamic import taken on open (breadthSnapshot.js),
// never a static one: this file is the only part of the feature the Breadth page carries.
import { useCallback, useEffect, useRef, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import s from '../charts/WorkspaceShotButton.module.css'

const loadShot = () => import('./breadthSnapshot')

export default function BreadthSnapshotPopover({ getSheet, universe, universeLabel, topDate, onClose, returnFocusTo }) {
  // status: 'busy' | 'ready' | 'error'
  const [status, setStatus] = useState('busy')
  const [shot, setShot] = useState(null)           // { blob, url, filename, width, height }
  const [note, setNote] = useState('')
  const panelRef = useRef(null)
  const urlRef = useRef(null)

  // Esc closes and hands focus back to ⋯; a press outside closes in place.
  useEffect(() => {
    const close = (restoreFocus) => {
      onClose?.()
      if (restoreFocus) returnFocusTo?.current?.focus?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(true) } }
    const onDown = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) close(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose, returnFocusTo])

  // Focus moves into the panel on open, so the keyboard is where the actions are.
  useEffect(() => { panelRef.current?.focus?.() }, [])

  // Capture once, on open. The thumbnail's object URL is released on close.
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        // Let the closing ⋯ menu leave the DOM before the sheet is read.
        await new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)))
        const mod = await loadShot()
        const res = await mod.captureBreadthSheet(getSheet?.(), { universe, universeLabel, topDate })
        if (!live) return
        let url = null
        try { url = URL.createObjectURL(res.blob) } catch { /* no object URLs: no thumbnail */ }
        urlRef.current = url
        setShot({ ...res, url })
        setStatus('ready')
      } catch {
        if (live) setStatus('error')
      }
    })()
    return () => {
      live = false
      if (urlRef.current) { try { URL.revokeObjectURL(urlRef.current) } catch { /* jsdom */ } urlRef.current = null }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- one capture per open

  const onCopy = useCallback(async () => {
    if (!shot) return
    const { copyPng } = await loadShot()
    setNote((await copyPng(shot.blob)) ? 'Copied' : 'Copy isn’t available here — use Download PNG')
  }, [shot])

  const onDownload = useCallback(async () => {
    if (!shot) return
    const { downloadBlob } = await loadShot()
    try { downloadBlob(shot.blob, shot.filename); setNote('Saved') } catch { setNote('Couldn’t save — try again') }
  }, [shot])

  return (
    <div
      ref={panelRef}
      className={s.menu}
      role="dialog"
      aria-label="Breadth snapshot"
      aria-busy={status === 'busy'}
      tabIndex={-1}
      style={{ outline: 'none' }}
      data-testid="breadth-snapshot"
    >
      {status === 'busy' && <div className={s.status} role="status">Capturing…</div>}
      {status === 'error' && <div className={s.status} role="alert">Couldn’t capture — try again</div>}
      {status === 'ready' && shot && (<>
        {shot.url && <img className={s.thumb} src={shot.url} alt="Breadth snapshot preview" />}
        <div className={s.meta} data-testid="breadth-snapshot-size">{shot.width} × {shot.height}</div>
        <button type="button" className={s.item} onClick={onCopy} aria-label="Copy image">
          <span className={s.glyph} aria-hidden="true"><UIcon name="copy" size={15} gold={false} /></span>Copy image
        </button>
        <button type="button" className={s.item} onClick={onDownload} aria-label="Download PNG">
          <span className={s.glyph} aria-hidden="true"><UIcon name="download" size={15} gold={false} /></span>Download PNG
        </button>
        {note && <div className={s.note} role="status">{note}</div>}
      </>)}
    </div>
  )
}

/** "Copy share link" feedback: a quiet Signature note under ⋯ for two seconds. */
export function ShareLinkNote({ ok, onDone }) {
  useEffect(() => {
    const id = setTimeout(() => onDone?.(), 2000)
    return () => clearTimeout(id)
  }, [ok, onDone])
  return (
    <div className={s.menu} role="status" data-testid="breadth-share-link-note" style={{ width: 'auto', whiteSpace: 'nowrap' }}>
      <div className={s.status}>{ok ? 'Link copied' : 'Couldn’t copy the link — copy it from the address bar'}</div>
    </div>
  )
}
