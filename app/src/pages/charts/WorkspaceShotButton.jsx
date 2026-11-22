// app/src/pages/charts/WorkspaceShotButton.jsx
//
// The /charts top row's "Screenshot workspace" button (owner 11-16). Click → the board (and only the
// board: `getBoard()` returns the workspace <main>) is rasterized at high resolution, then a small
// floating menu under the button offers Copy image / Download PNG with a thumbnail of the shot.
// The capture code (and modern-screenshot) is a dynamic import taken on the click — see workspaceShot.js.
import { useCallback, useEffect, useRef, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import s from './WorkspaceShotButton.module.css'

const loadShot = () => import('./workspaceShot')

export default function WorkspaceShotButton({ getBoard, layoutName, excludeClasses, onBeforeCapture }) {
  const [open, setOpen] = useState(false)
  // status: 'busy' | 'ready' | 'error'
  const [status, setStatus] = useState(null)
  const [shot, setShot] = useState(null)           // { blob, url, filename, width, height }
  const [note, setNote] = useState('')
  const wrapRef = useRef(null)
  const runRef = useRef(0)

  const close = useCallback(() => {
    runRef.current += 1
    setOpen(false); setStatus(null); setNote('')
    setShot((prev) => { if (prev?.url) { try { URL.revokeObjectURL(prev.url) } catch { /* jsdom */ } } return null })
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') close() }
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) close() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open, close])

  useEffect(() => () => { runRef.current += 1 }, [])

  // Hover/focus warms the click: the capture module + modern-screenshot load and the board's
  // capture context is built before the press (once; later hovers are no-ops).
  const warm = useCallback(() => {
    loadShot().then((m) => m.warmWorkspaceShot?.(getBoard?.())).catch(() => {})
  }, [getBoard])

  const capture = useCallback(async () => {
    if (open) { close(); return }
    onBeforeCapture?.()
    const run = ++runRef.current
    setOpen(true); setStatus('busy'); setNote(''); setShot(null)
    try {
      // Let the closed menus leave the DOM before the board is read.
      await new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)))
      const mod = await loadShot()
      const res = await mod.captureWorkspace(getBoard?.(), { layoutName, excludeClasses })
      if (run !== runRef.current) return
      let url = null
      try { url = URL.createObjectURL(res.blob) } catch { /* no object URLs: no thumbnail */ }
      setShot({ ...res, url })
      setStatus('ready')
    } catch {
      if (run !== runRef.current) return
      setStatus('error')
    }
  }, [open, close, onBeforeCapture, getBoard, layoutName, excludeClasses])

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
    <div className={s.wrap} ref={wrapRef} data-shot-exclude="">
      <button
        type="button"
        className={s.btn}
        aria-label="Screenshot workspace"
        title="Screenshot workspace"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={status === 'busy'}
        data-guide="workspace.screenshot"
        data-testid="workspace-shot-btn"
        onClick={capture}
        onPointerEnter={warm}
        onFocus={warm}
      ><UIcon name="camera" size={16} gold={false} /></button>
      {open && (
        <div className={s.menu} role="menu" aria-label="Workspace screenshot" data-testid="workspace-shot-menu">
          {status === 'busy' && <div className={s.status} role="status">Capturing…</div>}
          {status === 'error' && <div className={s.status} role="alert">Couldn’t capture — try again</div>}
          {status === 'ready' && shot && (<>
            {shot.url && <img className={s.thumb} src={shot.url} alt="Workspace screenshot preview" />}
            <div className={s.meta}>{shot.width} × {shot.height}</div>
            <button type="button" role="menuitem" className={s.item} onClick={onCopy}>
              <span className={s.glyph}><UIcon name="copy" size={15} gold={false} /></span>Copy image
            </button>
            <button type="button" role="menuitem" className={s.item} onClick={onDownload}>
              <span className={s.glyph}><UIcon name="download" size={15} gold={false} /></span>Download PNG
            </button>
            {note && <div className={s.note} role="status">{note}</div>}
          </>)}
        </div>
      )}
    </div>
  )
}
