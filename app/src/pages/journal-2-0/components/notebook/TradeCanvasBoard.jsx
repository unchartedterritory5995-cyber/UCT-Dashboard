import {
  memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react'
import UIcon from '../../../../components/ui/UIcon'
import CanvasItem, { NO_LEVELS } from './TradeCanvasItem'
import { ArrowDialog, ChartDialog, KeysDialog, LevelDialog, LinkThesisDialog } from './TradeCanvasDialogs'
import {
  BIG_STEP, CHART_MIN_ZOOM, GRID, SIZES, ZOOM_STEP,
  addEdge, addItems, addLevels, boardFromEditor, centerOn, clampZoom, commitBoard, duplicateItems,
  edgeLine, fitCamera, fmtPrice, itemLabel, itemOnScreen, loadHistoryHelpers, makeChart, makeSticky,
  makeTextCard, moveItems, placeFor, readingOrder, removeEdge, removeItems, removeLevel, resizeItem,
  roleOf, snap, sortedLevels, tfLabel, updateItem, updateLevel, visibleIds, zoomAt,
} from '../../lib/tradeCanvas'
import styles from './TradeCanvasBoard.module.css'

/**
 * Wave 11 lane 11D — THE TRADE-PLAN CANVAS. An infinite, pannable, zoomable
 * board of text cards, sticky notes, live or frozen charts, price levels and
 * arrows, rendered in place of the text editor for a note whose body is one
 * `tradeCanvas` node.
 *
 * ⛔⛔ THE EDITOR IS THE STORE. The board reads its state from the editor's
 * canvas node on every transaction and writes back through `commitBoard` (one
 * transaction per change), so the note's own autosave, compare-and-set, offline
 * outbox, schema guard, version history and undo all apply unchanged. Undo IS
 * the editor's undo.
 *
 * ⛔ PERFORMANCE: only the cards on screen are rendered; a pan or zoom moves one
 * layer (a transform written straight to the DOM, no React render); a drag
 * writes the dragged cards' transforms straight to the DOM and commits ONCE on
 * release; every card is memoised and receives one stable `api` object, so no
 * pointer move re-renders a card. The arrows re-render during a drag through
 * their own tiny store.
 *
 * ⛔ EVERY ACTION HAS A REAL CONTROL. Drag, pinch and double-click are
 * conveniences; the toolbar, the selection bar, the levels list and the dialogs
 * reach everything by keyboard and by touch (HTML5 drag never fires on touch).
 *
 * Props:
 *   editor          the note's TipTap editor (holds the canvas node)
 *   noteId, noteTitle, ticker
 *   readOnly        locked, unreadable, or the canvas gate is off
 *   readOnlyReason  a sentence shown above a read-only board (or null)
 *   onLinkFromNote(note)  open `note` offering to link this canvas at its end
 */

const DRAG_SLOP = 4

function createDragStore() {
  let state = null
  const subs = new Set()
  return {
    get: () => state,
    set: (s) => { state = s; subs.forEach((f) => f()) },
    subscribe: (f) => { subs.add(f); return () => subs.delete(f) },
  }
}

const EdgeLayer = memo(function EdgeLayer({ items, edges, dragStore, markerId }) {
  const drag = useSyncExternalStore(dragStore.subscribe, dragStore.get, dragStore.get)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const boxOf = (id) => {
    const it = byId.get(id)
    if (!it || !drag) return it || null
    let b = it
    if (drag.ids && drag.ids.has(id)) b = { ...b, x: b.x + drag.dx, y: b.y + drag.dy }
    if (drag.resize && drag.resize.id === id) b = { ...b, w: drag.resize.w, h: drag.resize.h }
    return b
  }
  if (!edges.length) return null
  return (
    <svg className={styles.edges} width="1" height="1" aria-hidden="true" focusable="false">
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className={styles.edgeHead} />
        </marker>
      </defs>
      {edges.map((e) => {
        const a = boxOf(e.from)
        const b = boxOf(e.to)
        if (!a || !b) return null
        const l = edgeLine(a, b)
        return (
          <g key={e.id} data-canvas-edge={e.id}>
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={styles.edgeLine} markerEnd={`url(#${markerId})`} vectorEffect="non-scaling-stroke" />
            {e.label && <text x={(l.x1 + l.x2) / 2} y={(l.y1 + l.y2) / 2 - 6} className={styles.edgeLabel} textAnchor="middle">{e.label}</text>}
          </g>
        )
      })}
    </svg>
  )
})

const isTyping = (el) => {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export default function TradeCanvasBoard({
  editor, noteId, noteTitle = '', ticker = null, readOnly = false, readOnlyReason = null, onLinkFromNote = null,
}) {
  const markerId = `${useId().replace(/:/g, '')}-arrow`
  const [board, setBoard] = useState(() => boardFromEditor(editor))
  const boardRef = useRef(board)
  boardRef.current = board
  const [selection, setSelection] = useState(() => new Set())
  const selRef = useRef(selection)
  selRef.current = selection
  const [currentId, setCurrentId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const editingRef = useRef(null)
  editingRef.current = editingId
  const [dialog, setDialog] = useState(null) // {kind, ...}
  const [announce, setAnnounce] = useState('')
  const [levelsOpen, setLevelsOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 640))
  const [snapOn, setSnapOn] = useState(true)
  const [visible, setVisible] = useState(() => new Set())
  const [zoomOk, setZoomOk] = useState(true)
  const dragStore = useMemo(createDragStore, [])

  const viewportRef = useRef(null)
  const layerRef = useRef(null)
  const zoomLabelRef = useRef(null)
  const camRef = useRef({ x: 0, y: 0, z: 1 })
  const sizeRef = useRef({ w: 0, h: 0 })
  const elsRef = useRef(new Map())
  const pendingFocusRef = useRef(null)
  const rafRef = useRef(0)
  const gestureRef = useRef(null)
  const pointersRef = useRef(new Map())
  // The editor's own editable state (a lock, or the editor still adopting the
  // note) can change without a React render here, so it is read as a store.
  const editorEditable = useSyncExternalStore(
    useCallback((cb) => {
      if (!editor) return () => {}
      editor.on('transaction', cb)
      const t = setInterval(cb, 400)
      return () => { editor.off('transaction', cb); clearInterval(t) }
    }, [editor]),
    () => Boolean(editor && !editor.isDestroyed && editor.isEditable),
    () => false,
  )
  const editable = !readOnly && editorEditable

  useEffect(() => { loadHistoryHelpers() }, [])

  // ── the editor is the store ────────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return undefined
    const sync = () => {
      const next = boardFromEditor(editor)
      if (next !== boardRef.current) setBoard(next)
    }
    sync()
    editor.on('transaction', sync)
    return () => { editor.off('transaction', sync) }
  }, [editor])

  // Drop selection entries whose card is gone (an undo, a delete, a reload).
  useEffect(() => {
    const ids = new Set(board.items.map((i) => i.id))
    setSelection((prev) => {
      let changed = false
      const next = new Set()
      prev.forEach((id) => { if (ids.has(id)) next.add(id); else changed = true })
      return changed ? next : prev
    })
    if (currentId && !ids.has(currentId)) setCurrentId(null)
  }, [board, currentId])

  const commit = useCallback((next, opts) => {
    if (readOnly) return false
    return commitBoard(editor, next, opts)
  }, [editor, readOnly])
  // The cards a keyboard action applies to: the selection when the focused card
  // is in it (or no card has focus), else the focused card alone.
  const targetIds = (onItem) => {
    const sel = selRef.current
    if (!onItem || sel.has(onItem)) return [...sel]
    const only = new Set([onItem])
    selRef.current = only
    setSelection(only)
    return [onItem]
  }

  // ── the camera ─────────────────────────────────────────────────────────────
  const recomputeVisible = useCallback(() => {
    rafRef.current = 0
    const cam = camRef.current
    const { w, h } = sizeRef.current
    const ids = visibleIds(boardRef.current.items, cam, w, h)
    setVisible((prev) => {
      if (prev.size === ids.length && ids.every((id) => prev.has(id))) return prev
      return new Set(ids)
    })
    setZoomOk(cam.z >= CHART_MIN_ZOOM)
  }, [])

  const applyCamera = useCallback((cam, { sync = false } = {}) => {
    camRef.current = cam
    const layer = layerRef.current
    if (layer) layer.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.z})`
    const vp = viewportRef.current
    if (vp) {
      const g = GRID * 4 * cam.z
      vp.style.backgroundSize = `${g}px ${g}px`
      vp.style.backgroundPosition = `${cam.x}px ${cam.y}px`
    }
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(cam.z * 100)}%`
    if (sync) { if (rafRef.current) cancelAnimationFrame(rafRef.current); recomputeVisible() }
    else if (!rafRef.current) rafRef.current = requestAnimationFrame(recomputeVisible)
  }, [recomputeVisible])

  // Size + the first fit (every card in view, never past 100%).
  const fittedRef = useRef(false)
  useLayoutEffect(() => {
    const vp = viewportRef.current
    if (!vp) return undefined
    const measure = () => {
      sizeRef.current = { w: vp.clientWidth, h: vp.clientHeight }
      if (!fittedRef.current && sizeRef.current.w) {
        fittedRef.current = true
        applyCamera(fitCamera(boardRef.current.items, sizeRef.current.w, sizeRef.current.h), { sync: true })
      } else {
        applyCamera(camRef.current, { sync: true })
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [applyCamera])

  // New items (an add, an undo) may land off the rendered set.
  useEffect(() => { recomputeVisible() }, [board.items, recomputeVisible])
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const zoomBy = useCallback((factor, px, py) => {
    const { w, h } = sizeRef.current
    applyCamera(zoomAt(camRef.current, factor, px ?? w / 2, py ?? h / 2), { sync: true })
  }, [applyCamera])
  const fitAll = useCallback(() => {
    const { w, h } = sizeRef.current
    applyCamera(fitCamera(boardRef.current.items, w, h), { sync: true })
  }, [applyCamera])

  // ── focus: a card the keyboard moves to may be off screen (not rendered) ──
  const focusItem = useCallback((id) => {
    const item = boardRef.current.items.find((i) => i.id === id)
    if (!item) return
    const { w, h } = sizeRef.current
    if (!itemOnScreen(item, camRef.current, w, h)) applyCamera(centerOn(item, camRef.current, w, h), { sync: true })
    setCurrentId(id)
    pendingFocusRef.current = id
    const el = elsRef.current.get(id)
    if (el) { el.focus({ preventScroll: true }); pendingFocusRef.current = null }
  }, [applyCamera])
  useEffect(() => {
    const id = pendingFocusRef.current
    if (!id) return
    const el = elsRef.current.get(id)
    if (el) { el.focus({ preventScroll: true }); pendingFocusRef.current = null }
  })
  const focusBoard = useCallback(() => { viewportRef.current?.focus({ preventScroll: true }) }, [])

  const order = useMemo(() => readingOrder(board.items), [board.items])
  const say = useCallback((s) => { setAnnounce(''); requestAnimationFrame(() => setAnnounce(s)) }, [])

  // ── the stable api every card receives ─────────────────────────────────────
  const actions = useRef({})
  const api = useMemo(() => ({
    register: (id, el) => { if (el) elsRef.current.set(id, el); else elsRef.current.delete(id) },
    focused: (id) => actions.current.focused(id),
    finishEdit: (id, text, opts) => actions.current.finishEdit(id, text, opts),
  }), [])
  actions.current.focused = (id) => { setCurrentId(id) }
  actions.current.finishEdit = (id, text, { refocus } = {}) => {
    if (editingRef.current !== id) return
    editingRef.current = null
    setEditingId(null)
    const item = boardRef.current.items.find((i) => i.id === id)
    if (item && item.text !== text) commit(updateItem(boardRef.current, id, { text }))
    if (refocus) focusItem(id)
  }

  // ── adding things ──────────────────────────────────────────────────────────
  const addItem = useCallback((item, what) => {
    const { board: next, added, refused } = addItems(boardRef.current, [item])
    if (refused || !added.length) { say('This canvas is full (300 items). Delete something to add more.'); return null }
    if (!commit(next)) return null
    setSelection(new Set(added))
    // A free spot may be off screen: bring the new card into view.
    const { w, h } = sizeRef.current
    if (!itemOnScreen(item, camRef.current, w, h)) applyCamera(centerOn(item, camRef.current, w, h), { sync: true })
    say(`${what} added.`)
    return added[0]
  }, [applyCamera, commit, say])

  const addText = useCallback((kind = 'text', at = null) => {
    if (!editable) return
    const size = SIZES[kind]
    const { w, h } = sizeRef.current
    const pos = at || placeFor(boardRef.current, camRef.current, w, h, size)
    const item = kind === 'sticky' ? makeSticky(pos) : makeTextCard(pos)
    const id = addItem(item, kind === 'sticky' ? 'Sticky note' : 'Text card')
    if (id) { setCurrentId(id); setEditingId(id) }
  }, [addItem, editable])

  const openChartDialog = useCallback((item = null) => {
    if (!editable) return
    setDialog({ kind: 'chart', item })
  }, [editable])
  const submitChart = (vals) => {
    const item = dialog?.item
    setDialog(null)
    if (item) {
      if (commit(updateItem(boardRef.current, item.id, vals))) say(`${vals.symbol} chart saved.`)
      focusItem(item.id)
      return
    }
    const { w, h } = sizeRef.current
    const pos = placeFor(boardRef.current, camRef.current, w, h, SIZES.chart)
    const id = addItem(makeChart({ ...pos, ...vals }), `${vals.symbol} ${vals.mode === 'frozen' ? 'frozen' : 'live'} chart`)
    if (id) focusItem(id)
  }

  const charts = useMemo(() => board.items.filter((i) => i.kind === 'chart'), [board.items])
  const levelsByChart = useMemo(() => {
    const m = new Map()
    for (const lv of board.levels) {
      if (!lv.chartId) continue
      if (!m.has(lv.chartId)) m.set(lv.chartId, [])
      m.get(lv.chartId).push(lv)
    }
    return m
  }, [board.levels])

  const openLevelDialog = useCallback((level = null) => {
    if (!editable) return
    const sel = [...selRef.current]
    const selChart = sel.length === 1 ? boardRef.current.items.find((i) => i.id === sel[0] && i.kind === 'chart') : null
    const onlyChart = charts.length === 1 ? charts[0] : null
    setDialog({ kind: 'level', level, defaultChartId: (selChart || onlyChart)?.id || null })
  }, [charts, editable])
  const submitLevels = (rows) => {
    const level = dialog?.level
    setDialog(null)
    if (level) {
      const r = rows[0]
      if (commit(updateLevel(boardRef.current, level.id, r))) say(`${r.label || 'Level'} saved at ${fmtPrice(r.price)}.`)
      return
    }
    if (commit(addLevels(boardRef.current, rows))) {
      say(`${rows.map((r) => `${r.label} ${fmtPrice(r.price)}`).join(', ')} added.`)
      setLevelsOpen(true)
    }
  }
  const deleteLevel = (lv) => {
    if (!editable) return
    if (commit(removeLevel(boardRef.current, lv.id))) say(`${lv.label} level deleted. Undo brings it back.`)
  }

  const openArrowDialog = useCallback((fromId) => {
    if (!editable) return
    const from = boardRef.current.items.find((i) => i.id === fromId)
    if (from) setDialog({ kind: 'arrow', fromId })
  }, [editable])

  // ── selection-wide actions ─────────────────────────────────────────────────
  const deleteSelection = useCallback(() => {
    if (!editable) return
    const ids = [...selRef.current]
    if (!ids.length) return
    const ord = readingOrder(boardRef.current.items).map((i) => i.id)
    const firstIdx = Math.min(...ids.map((id) => ord.indexOf(id)).filter((i) => i >= 0))
    const remaining = ord.filter((id) => !ids.includes(id))
    if (!commit(removeItems(boardRef.current, ids))) return
    setSelection(new Set())
    say(`${ids.length === 1 ? 'Card' : `${ids.length} cards`} deleted. Press Ctrl+Z (or Undo) to bring ${ids.length === 1 ? 'it' : 'them'} back.`)
    // ⛔ Focus is never lost: the card that took the deleted one's place, else the board.
    const nextId = remaining[Math.min(Number.isFinite(firstIdx) ? firstIdx : 0, remaining.length - 1)]
    if (nextId) focusItem(nextId); else { setCurrentId(null); focusBoard() }
  }, [commit, editable, focusBoard, focusItem, say])

  const duplicateSelection = useCallback(() => {
    if (!editable) return
    const ids = [...selRef.current]
    if (!ids.length) return
    const { board: next, ids: added } = duplicateItems(boardRef.current, ids)
    if (!added.length) { say('This canvas is full (300 items).'); return }
    if (!commit(next)) return
    setSelection(new Set(added))
    say(`${added.length === 1 ? 'Card' : `${added.length} cards`} duplicated.`)
    focusItem(added[0])
  }, [commit, editable, focusItem, say])

  const resizeSelection = useCallback((dw, dh) => {
    if (!editable) return
    let b = boardRef.current
    for (const id of selRef.current) {
      const it = b.items.find((i) => i.id === id)
      if (it) b = resizeItem(b, id, it.w + dw, it.h + dh)
    }
    if (commit(b, { merge: true })) {
      const one = selRef.current.size === 1 ? b.items.find((i) => selRef.current.has(i.id)) : null
      if (one) say(`${itemLabel(one)} is ${one.w} by ${one.h}.`)
    }
  }, [commit, editable, say])

  const nudgeSelection = useCallback((dx, dy) => {
    if (!editable) return
    const ids = [...selRef.current]
    if (!ids.length) return
    const next = moveItems(boardRef.current, ids, dx, dy)
    if (commit(next, { merge: true })) {
      const one = ids.length === 1 ? next.items.find((i) => i.id === ids[0]) : null
      if (one) {
        const { w, h } = sizeRef.current
        if (!itemOnScreen(one, camRef.current, w, h)) applyCamera(centerOn(one, camRef.current, w, h), { sync: true })
        say(`Moved to ${one.x}, ${one.y}.`)
      }
    }
  }, [applyCamera, commit, editable, say])

  const undo = useCallback(() => { if (editable) { editor.commands.undo(); say('Undone.') } }, [editable, editor, say])
  const redo = useCallback(() => { if (editable) { editor.commands.redo(); say('Redone.') } }, [editable, editor, say])

  const editItem = useCallback((id) => {
    const item = boardRef.current.items.find((i) => i.id === id)
    if (!item || !editable) return
    if (item.kind === 'chart') openChartDialog(item)
    else { setCurrentId(id); setEditingId(id) }
  }, [editable, openChartDialog])

  // ── keyboard ───────────────────────────────────────────────────────────────
  const onKeyDown = (e) => {
    if (isTyping(e.target)) return
    const mod = e.ctrlKey || e.metaKey
    const itemEl = e.target.closest?.('[data-canvas-item]')
    const onItem = itemEl ? itemEl.getAttribute('data-canvas-item') : null
    const sel = selRef.current
    const step = e.shiftKey ? BIG_STEP : GRID
    if (e.key === 'Tab') {
      // Only the board itself and its cards walk the cards; a control in the
      // board's chrome tabs on as any control does.
      if (!order.length || (!onItem && e.target !== viewportRef.current)) return
      const ids = order.map((i) => i.id)
      const at = onItem ? ids.indexOf(onItem) : -1
      const nextIdx = e.shiftKey ? at - 1 : at + 1
      if (onItem === null && e.shiftKey) return            // leave the board backwards
      if (nextIdx < 0 || nextIdx >= ids.length) return     // leave the board: no keyboard trap
      e.preventDefault()
      // Single selection follows the focus; a selection of several is kept.
      if (sel.size <= 1) { selRef.current = new Set([ids[nextIdx]]); setSelection(selRef.current) }
      focusItem(ids[nextIdx])
      return
    }
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
    if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return }
    if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); targetIds(onItem); duplicateSelection(); return }
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      setSelection(new Set(boardRef.current.items.map((i) => i.id)))
      say(`${boardRef.current.items.length} cards selected.`)
      return
    }
    if (mod || e.altKey && !e.key.startsWith('Arrow')) return
    if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      if ((onItem || sel.size) && e.altKey) { targetIds(onItem); resizeSelection(dx, dy); return }
      if (onItem || sel.size) { targetIds(onItem); nudgeSelection(dx, dy); return }
      // nothing selected: the keys move the view
      const c = camRef.current
      applyCamera({ ...c, x: c.x - dx * 4, y: c.y - dy * 4 })
      return
    }
    switch (e.key) {
      case 'Enter':
        if (onItem) { e.preventDefault(); editItem(onItem) }
        return
      case ' ':
        if (onItem) {
          e.preventDefault()
          setSelection((prev) => {
            const next = new Set(prev)
            if (next.has(onItem)) next.delete(onItem); else next.add(onItem)
            return next
          })
        }
        return
      case 'Delete':
      case 'Backspace':
        if (onItem || sel.size) { e.preventDefault(); targetIds(onItem); deleteSelection() }
        return
      case 'Escape':
        if (sel.size) { e.preventDefault(); setSelection(new Set()); say('Selection cleared.') }
        return
      case '+':
      case '=':
        e.preventDefault(); zoomBy(ZOOM_STEP); return
      case '-':
      case '_':
        e.preventDefault(); zoomBy(1 / ZOOM_STEP); return
      case '0':
        e.preventDefault(); fitAll(); return
      case '?':
        e.preventDefault(); setDialog({ kind: 'keys' }); return
      default:
        break
    }
    const k = e.key.toLowerCase()
    if (!editable) return
    if (k === 't') { e.preventDefault(); addText('text') }
    else if (k === 's') { e.preventDefault(); addText('sticky') }
    else if (k === 'c') { e.preventDefault(); openChartDialog() }
    else if (k === 'l') { e.preventDefault(); openLevelDialog() }
    else if (k === 'a') {
      const from = onItem || (sel.size === 1 ? [...sel][0] : null)
      if (from) { e.preventDefault(); openArrowDialog(from) }
      else say('Select a card first, then press A to draw an arrow from it.')
    }
  }

  // ── pointer: pan, pinch, drag, resize (one delegated handler) ──────────────
  const worldDelta = (dxScreen, dyScreen) => ({ dx: dxScreen / camRef.current.z, dy: dyScreen / camRef.current.z })

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return
    const t = e.target
    // Controls inside the board (toolbar, panels, a card's editor) keep their own clicks.
    if (t.closest('button, input, textarea, select, a, [data-canvas-chrome]')) return
    const vp = viewportRef.current
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try { vp.setPointerCapture(e.pointerId) } catch { /* not every environment supports capture */ }
    if (pointersRef.current.size === 2) {
      // a second finger: pinch, whatever the first one was doing
      cancelDragPreview()
      const [a, b] = [...pointersRef.current.values()]
      gestureRef.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), cam: camRef.current }
      return
    }
    const resizeId = t.closest('[data-canvas-resize]')?.getAttribute('data-canvas-resize')
    const itemId = t.closest('[data-canvas-item]')?.getAttribute('data-canvas-item')
    if (resizeId && editable) {
      const item = boardRef.current.items.find((i) => i.id === resizeId)
      if (item) gestureRef.current = { kind: 'resize', id: resizeId, sx: e.clientX, sy: e.clientY, w: item.w, h: item.h, moved: false }
      e.preventDefault()
      return
    }
    if (itemId) {
      if (editingRef.current === itemId) return
      const sel = selRef.current
      let ids
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        const next = new Set(sel)
        if (next.has(itemId)) next.delete(itemId); else next.add(itemId)
        setSelection(next)
        ids = next.has(itemId) ? [...next] : []
      } else if (sel.has(itemId)) {
        ids = [...sel]
      } else {
        setSelection(new Set([itemId]))
        ids = [itemId]
      }
      setCurrentId(itemId)
      elsRef.current.get(itemId)?.focus({ preventScroll: true })
      gestureRef.current = editable && ids.length
        ? { kind: 'drag', ids: new Set(ids), sx: e.clientX, sy: e.clientY, moved: false }
        : null
      return
    }
    gestureRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, cam: camRef.current, moved: false }
  }

  const dragFrame = useRef(0)
  const previewDrag = (g) => {
    const items = boardRef.current.items
    for (const it of items) {
      if (!g.ids.has(it.id)) continue
      const el = elsRef.current.get(it.id)
      if (el) el.style.transform = `translate3d(${it.x + g.dx}px, ${it.y + g.dy}px, 0)`
    }
    if (!dragFrame.current) {
      dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = 0
        const cur = gestureRef.current
        if (cur && cur.kind === 'drag') dragStore.set({ ids: cur.ids, dx: cur.dx, dy: cur.dy })
      })
    }
  }
  function cancelDragPreview() {
    const g = gestureRef.current
    if (g && g.kind === 'drag' && g.moved) {
      for (const it of boardRef.current.items) {
        if (!g.ids.has(it.id)) continue
        const el = elsRef.current.get(it.id)
        if (el) el.style.transform = `translate3d(${it.x}px, ${it.y}px, 0)`
      }
    }
    if (g && g.kind === 'resize' && g.moved) {
      const it = boardRef.current.items.find((i) => i.id === g.id)
      const el = elsRef.current.get(g.id)
      if (it && el) { el.style.width = `${it.w}px`; el.style.height = `${it.h}px` }
    }
    dragStore.set(null)
    gestureRef.current = null
  }

  const onPointerMove = (e) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gestureRef.current
    if (!g) return
    if (g.kind === 'pinch') {
      const [a, b] = [...pointersRef.current.values()]
      if (!a || !b) return
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const rect = viewportRef.current.getBoundingClientRect()
      const mx = (a.x + b.x) / 2 - rect.left
      const my = (a.y + b.y) / 2 - rect.top
      const factor = dist / Math.max(1, g.dist)
      applyCamera(zoomAt(g.cam, factor, mx, my))
      return
    }
    const dxs = e.clientX - g.sx
    const dys = e.clientY - g.sy
    if (!g.moved && Math.hypot(dxs, dys) < DRAG_SLOP) return
    g.moved = true
    if (g.kind === 'pan') {
      applyCamera({ ...g.cam, x: g.cam.x + dxs, y: g.cam.y + dys })
    } else if (g.kind === 'drag') {
      const { dx, dy } = worldDelta(dxs, dys)
      g.dx = snapOn ? snap(dx) : Math.round(dx)
      g.dy = snapOn ? snap(dy) : Math.round(dy)
      previewDrag(g)
    } else if (g.kind === 'resize') {
      const { dx, dy } = worldDelta(dxs, dys)
      g.nw = Math.max(40, Math.round(snapOn ? snap(g.w + dx) : g.w + dx))
      g.nh = Math.max(40, Math.round(snapOn ? snap(g.h + dy) : g.h + dy))
      const el = elsRef.current.get(g.id)
      if (el) { el.style.width = `${g.nw}px`; el.style.height = `${g.nh}px` }
      dragStore.set({ resize: { id: g.id, w: g.nw, h: g.nh } })
    }
  }

  const endPointer = (e) => {
    pointersRef.current.delete(e.pointerId)
    try { viewportRef.current?.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    const g = gestureRef.current
    if (!g) return
    if (g.kind === 'pinch') {
      if (pointersRef.current.size < 2) gestureRef.current = null
      return
    }
    gestureRef.current = null
    dragStore.set(null)
    if (e.type === 'pointercancel') { gestureRef.current = g; cancelDragPreview(); return }
    if (g.kind === 'pan' && !g.moved) {
      // a click on empty space clears the selection
      if (selRef.current.size) setSelection(new Set())
      return
    }
    if (g.kind === 'drag' && g.moved && (g.dx || g.dy)) {
      const next = moveItems(boardRef.current, [...g.ids], g.dx, g.dy)
      if (!commit(next)) { gestureRef.current = g; cancelDragPreview() }
      else say(`${g.ids.size === 1 ? 'Card' : `${g.ids.size} cards`} moved.`)
      return
    }
    if (g.kind === 'resize' && g.moved) {
      const next = resizeItem(boardRef.current, g.id, g.nw, g.nh)
      if (!commit(next)) { gestureRef.current = g; cancelDragPreview() }
    }
  }

  const onDoubleClick = (e) => {
    if (!editable) return
    if (e.target.closest('button, input, textarea, select, [data-canvas-chrome]')) return
    const itemId = e.target.closest('[data-canvas-item]')?.getAttribute('data-canvas-item')
    if (itemId) { editItem(itemId); return }
    const rect = viewportRef.current.getBoundingClientRect()
    const cam = camRef.current
    const x = snap((e.clientX - rect.left - cam.x) / cam.z - SIZES.text.w / 2)
    const y = snap((e.clientY - rect.top - cam.y) / cam.z - SIZES.text.h / 2)
    addText('text', { x, y })
  }

  // Wheel: Ctrl/⌘ (and a trackpad pinch) zooms at the pointer, otherwise pans.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return undefined
    const onWheel = (e) => {
      if (e.target.closest?.('[data-canvas-chrome], textarea')) return
      e.preventDefault()
      const rect = vp.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        applyCamera(zoomAt(camRef.current, Math.exp(-e.deltaY * 0.0025), e.clientX - rect.left, e.clientY - rect.top))
      } else {
        const c = camRef.current
        applyCamera({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY })
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [applyCamera])

  // ── render ─────────────────────────────────────────────────────────────────
  const rendered = useMemo(() => board.items.filter((i) => visible.has(i.id)), [board.items, visible])
  const selList = useMemo(() => board.items.filter((i) => selection.has(i.id)), [board.items, selection])
  const one = selList.length === 1 ? selList[0] : null
  const empty = board.items.length === 0 && board.levels.length === 0
  const levels = useMemo(() => sortedLevels(board.levels), [board.levels])
  const chartName = (id) => {
    const c = charts.find((x) => x.id === id)
    return c ? `${c.symbol} · ${tfLabel(c.tf)}` : null
  }
  const closeDialog = () => setDialog(null)

  return (
    <section className={styles.board} aria-label="Trade-plan canvas" data-trade-canvas={noteId}>
      {readOnlyReason && <p className={styles.readOnly} role="status">{readOnlyReason}</p>}
      <div className={styles.toolbar} role="toolbar" aria-label="Canvas tools" data-canvas-chrome>
        {editable && (
          <>
            <button type="button" className={styles.tool} onClick={() => addText('text')} aria-keyshortcuts="T" title="Add a text card (T)">
              <UIcon name="edit" size={14} gold={false} /> Text
            </button>
            <button type="button" className={styles.tool} onClick={() => addText('sticky')} aria-keyshortcuts="S" title="Add a sticky note (S)">
              <UIcon name="pin" size={14} gold={false} /> Sticky
            </button>
            <button type="button" className={styles.tool} onClick={() => openChartDialog()} aria-keyshortcuts="C" title="Add a chart (C)">
              <UIcon name="chart" size={14} gold={false} /> Chart
            </button>
            <button type="button" className={styles.tool} onClick={() => openLevelDialog()} aria-keyshortcuts="L" title="Add entry, stop and target (L)">
              <UIcon name="flag" size={14} gold={false} /> Levels
            </button>
            <button
              type="button" className={styles.tool} onClick={() => one && openArrowDialog(one.id)} disabled={!one}
              aria-keyshortcuts="A" title={one ? 'Draw an arrow from the selected card (A)' : 'Select one card to draw an arrow from it'}
            >
              <UIcon name="link" size={14} gold={false} /> Arrow
            </button>
            <span className={styles.sep} aria-hidden="true" />
            <button type="button" className={styles.tool} onClick={undo} aria-keyshortcuts="Control+Z Meta+Z" title="Undo (Ctrl+Z)">Undo</button>
            <button type="button" className={styles.tool} onClick={redo} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" title="Redo (Ctrl+Shift+Z)">Redo</button>
            <span className={styles.sep} aria-hidden="true" />
          </>
        )}
        <button type="button" className={styles.tool} onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="Zoom out" aria-keyshortcuts="-" title="Zoom out (−)">−</button>
        <button type="button" className={styles.toolZoom} onClick={fitAll} aria-label="Show everything" aria-keyshortcuts="0" title="Show everything (0)">
          <span ref={zoomLabelRef}>100%</span>
        </button>
        <button type="button" className={styles.tool} onClick={() => zoomBy(ZOOM_STEP)} aria-label="Zoom in" aria-keyshortcuts="+" title="Zoom in (+)">+</button>
        {editable && (
          <button type="button" className={styles.tool} aria-pressed={snapOn} onClick={() => setSnapOn((v) => !v)} title="Snap moves to the grid">
            Snap
          </button>
        )}
        <button
          type="button" className={styles.tool} aria-expanded={levelsOpen} aria-controls={`${markerId}-levels`}
          onClick={() => setLevelsOpen((v) => !v)}
        >
          Levels list ({board.levels.length})
        </button>
        {editable && onLinkFromNote && (
          <button type="button" className={styles.tool} onClick={() => setDialog({ kind: 'link' })}>
            <UIcon name="link" size={14} gold={false} /> Link from a thesis
          </button>
        )}
        <button type="button" className={styles.tool} onClick={() => setDialog({ kind: 'keys' })} aria-keyshortcuts="?" title="Canvas keys (?)">Keys</button>
      </div>

      <div
        ref={viewportRef}
        className={styles.viewport}
        tabIndex={0}
        role="application"
        aria-roledescription="canvas"
        aria-label={`Trade-plan canvas, ${board.items.length} card${board.items.length === 1 ? '' : 's'}. Tab moves between cards; press ? for every key.`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={onDoubleClick}
        data-zoom-ok={zoomOk ? 'true' : 'false'}
      >
        <div ref={layerRef} className={styles.layer}>
          <EdgeLayer items={board.items} edges={board.edges} dragStore={dragStore} markerId={markerId} />
          {rendered.map((item) => (
            <CanvasItem
              key={item.id}
              item={item}
              selected={selection.has(item.id)}
              current={currentId === item.id || (!currentId && order[0]?.id === item.id)}
              editing={editingId === item.id}
              readOnly={!editable}
              levels={item.kind === 'chart' ? (levelsByChart.get(item.id) || NO_LEVELS) : NO_LEVELS}
              zoomOk={item.kind === 'chart' ? zoomOk : true}
              api={api}
            />
          ))}
        </div>

        {empty && (
          <div className={styles.hint} data-canvas-chrome>
            {editable ? (
              <>
                <h3 className={styles.hintTitle}>Make your plan in three steps</h3>
                <ol className={styles.hintSteps}>
                  <li>
                    <button type="button" className={styles.hintBtn} onClick={() => openChartDialog()}>Add a chart</button>
                    <span> — live, or frozen at today so the plan keeps what you saw. Key: <kbd>C</kbd></span>
                  </li>
                  <li>
                    <button type="button" className={styles.hintBtn} onClick={() => openLevelDialog()}>Add entry, stop and target</button>
                    <span> — they are drawn as lines on the chart. Key: <kbd>L</kbd></span>
                  </li>
                  <li>
                    {onLinkFromNote
                      ? <button type="button" className={styles.hintBtn} onClick={() => setDialog({ kind: 'link' })}>Link it from your thesis</button>
                      : <strong>Link it from your thesis</strong>}
                    <span> — or type <kbd>[[</kbd> in the thesis and pick “{noteTitle || 'this plan'}”.</span>
                  </li>
                </ol>
                <p className={styles.hintFoot}>Add notes with <kbd>T</kbd>, drag empty space to move around, pinch or Ctrl+scroll to zoom. <kbd>?</kbd> lists every key.</p>
              </>
            ) : <p className={styles.hintFoot}>This canvas is empty.</p>}
          </div>
        )}

        {selList.length > 0 && editable && (
          <div className={styles.selBar} role="toolbar" aria-label="Selected cards" data-canvas-chrome>
            <span className={styles.selCount}>{selList.length === 1 ? itemLabel(one) : `${selList.length} cards`}</span>
            {one && <button type="button" className={styles.tool} onClick={() => editItem(one.id)}>Edit</button>}
            {one && <button type="button" className={styles.tool} onClick={() => openArrowDialog(one.id)}>Arrow…</button>}
            <button type="button" className={styles.tool} onClick={duplicateSelection}>Duplicate</button>
            <button type="button" className={styles.tool} onClick={() => resizeSelection(-BIG_STEP, -BIG_STEP / 2)} aria-label="Make smaller">Smaller</button>
            <button type="button" className={styles.tool} onClick={() => resizeSelection(BIG_STEP, BIG_STEP / 2)} aria-label="Make larger">Larger</button>
            <button type="button" className={`${styles.tool} ${styles.toolDanger}`} onClick={deleteSelection}>Delete</button>
          </div>
        )}

        {levelsOpen && (
          <section id={`${markerId}-levels`} className={styles.levels} aria-label="Plan levels" data-canvas-chrome>
            <div className={styles.levelsHead}>
              <h3 className={styles.levelsTitle}>Levels</h3>
              {editable && <button type="button" className={styles.tool} onClick={() => openLevelDialog()}>+ Add</button>}
            </div>
            {levels.length ? (
              <ul className={styles.levelList}>
                {levels.map((lv) => (
                  <li key={lv.id} className={styles.levelRow} style={{ '--level-color': roleOf(lv.role).color }}>
                    <span className={styles.levelDot} aria-hidden="true" />
                    <span className={styles.levelName}>{lv.label}</span>
                    <span className={styles.levelPrice}>{fmtPrice(lv.price)}</span>
                    {lv.chartId && chartName(lv.chartId) && <span className={styles.levelOn}>on {chartName(lv.chartId)}</span>}
                    {editable && (
                      <span className={styles.levelActions}>
                        <button type="button" className={styles.miniBtn} onClick={() => openLevelDialog(lv)} aria-label={`Edit ${lv.label} ${fmtPrice(lv.price)}`}>Edit</button>
                        <button type="button" className={styles.miniBtn} onClick={() => deleteLevel(lv)} aria-label={`Delete ${lv.label} ${fmtPrice(lv.price)}`}>Delete</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className={styles.levelsEmpty}>No levels yet.</p>}
          </section>
        )}
      </div>

      <div className={styles.srOnly} role="status" aria-live="polite">{announce}</div>

      {dialog?.kind === 'chart' && (
        <ChartDialog open initial={dialog.item} defaultSymbol={ticker || charts[0]?.symbol || ''} onSubmit={submitChart} onClose={closeDialog} />
      )}
      {dialog?.kind === 'level' && (
        <LevelDialog open initial={dialog.level} charts={charts} defaultChartId={dialog.defaultChartId} onSubmit={submitLevels} onClose={closeDialog} />
      )}
      {dialog?.kind === 'arrow' && (
        <ArrowDialog
          open
          from={board.items.find((i) => i.id === dialog.fromId)}
          items={board.items}
          edges={board.edges}
          onAdd={(to, label) => {
            const from = dialog.fromId
            const next = addEdge(boardRef.current, from, to, label)
            setDialog(null)
            if (next === boardRef.current) say('That arrow is already there.')
            else if (commit(next)) say('Arrow added.')
          }}
          onRemove={(edgeId) => { if (commit(removeEdge(boardRef.current, edgeId))) say('Arrow removed. Undo brings it back.') }}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'link' && onLinkFromNote && (
        <LinkThesisDialog open canvasId={noteId} onPick={(n) => { setDialog(null); onLinkFromNote(n) }} onClose={closeDialog} />
      )}
      {dialog?.kind === 'keys' && <KeysDialog open onClose={closeDialog} />}
    </section>
  )
}
