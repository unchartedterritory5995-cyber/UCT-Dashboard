// The Screener as a widget board (boardModel.js). It is the Charts board's grid and its own drop
// rule (24 x 20, locked to the window; nothing moves while you drag, and on the drop every other
// widget re-tiles around the one you moved: charts/repackAroundMoved.js), so a scan board
// behaves the way a Charts layout does. Locked until Customize is on.
//
// The drop rule is its own small module, loaded when the member first turns Customize on. It must
// never be imported from the Charts workspace module: that pulls the whole workspace, and the
// Agent with it, into every page that mounts a scan board (scanBoardLoad.rail.test.js).
import { useEffect, useMemo, useRef, useState } from 'react'
import GridLayout, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import { COLS, ROWS, WIDGETS, GAP, KEY_DIRS, keyboardTarget, rowHeightFor, settleDrop } from './boardModel'
import s from './Board.module.css'

const Grid = WidthProvider(GridLayout)
const SIDE_WORD = { left: 'to the left of', right: 'to the right of', up: 'above', down: 'below' }
const RESIZE_WORD = { left: 'narrower', right: 'wider', up: 'shorter', down: 'taller' }

export default function ScanBoard({ board, api, renderWidget, onRefused, loadRepack = () => import('../../../charts/repackAroundMoved').then(m => m.repackAroundMoved) }) {
  const host = useRef(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = host.current
    if (!el) return undefined
    const read = () => setHeight(el.clientHeight)
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [repack, setRepack] = useState(null)
  const wantRepack = board.edit && !repack
  useEffect(() => {
    if (!wantRepack) return undefined
    let alive = true
    loadRepack().then(fn => { if (alive && typeof fn === 'function') setRepack(() => fn) }).catch(() => { /* Customize stays locked; the board is unharmed */ })
    return () => { alive = false }
  }, [wantRepack, loadRepack])
  const canEdit = board.edit && !!repack
  const widgets = board.widgets
  // `n` changes when a drop is refused: the grid then takes the stored layout back (it compares
  // the layout it is given by value, and a refused drop leaves that value unchanged).
  const [nonce, setNonce] = useState(0)
  const layout = useMemo(() => widgets.map(w => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: WIDGETS[w.type].minW, minH: WIDGETS[w.type].minH, n: nonce })), [widgets, nonce])
  const snapRef = useRef(null)
  const onStart = () => { snapRef.current = widgets.map(w => ({ ...w })) }
  // A move and a resize end the same way: the widget keeps the box it was given, the rest re-tile.
  const onStop = wasMove => (_l, _old, item) => {
    const base = snapRef.current || widgets
    snapRef.current = null
    if (!item || !repack) return
    const out = settleDrop(base, item, repack, api.acceptArrangement, wasMove)
    // The grid keeps the dragged widget where it was dropped until it is handed a layout that
    // differs by value: when the board did not change, the nonce is that difference.
    if (out !== 'accepted') setNonce(n => n + 1)
    if (out === 'refused') onRefused?.()
  }
  // Customize by keyboard: an arrow key on a widget's bar moves it to that side, Shift + arrow
  // resizes it. The same drop rule and the same check as a drag; what happened is said aloud.
  const [said, setSaid] = useState('')
  const onBarKey = w => e => {
    const dir = KEY_DIRS[e.key]
    if (!dir || e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey || !canEdit) return
    e.preventDefault()
    const name = WIDGETS[w.type].name
    const rect = keyboardTarget(widgets, w.id, dir, e.shiftKey)
    if (!rect) { setSaid(e.shiftKey ? `${name} cannot be made any ${RESIZE_WORD[dir]}.` : `Nothing ${SIDE_WORD[dir]} ${name} to trade places with.`); return }
    const out = settleDrop(widgets, { i: w.id, ...rect }, repack, api.acceptArrangement, !e.shiftKey)
    if (out === 'refused') { onRefused?.(); setSaid(`Not enough room to ${e.shiftKey ? 'resize' : 'move'} ${name} that way.`); return }
    if (out === 'accepted') setSaid(e.shiftKey ? `${name} is ${RESIZE_WORD[dir]}.` : `${name} moved ${dir}.`)
  }
  return (
    <div ref={host} className={s.board} data-edit={board.edit ? '' : undefined} data-testid="scan-board">
      {board.edit && <div className="sr-only" role="status" aria-live="polite" data-testid="board-said">{said}</div>}
      {height > 0 && (
        <Grid className={s.boardGrid} layout={layout} cols={COLS} rowHeight={rowHeightFor(height)} maxRows={ROWS} margin={[GAP, GAP]} containerPadding={[0, 0]}
          isDraggable={canEdit} isResizable={canEdit} isBounded={false} compactType={null} preventCollision={false} allowOverlap
          useCSSTransforms={false} draggableHandle={`.${s.bwBar}`} draggableCancel="button" resizeHandles={['se', 'sw', 'ne', 'nw']}
          onDragStart={onStart} onDragStop={onStop(true)} onResizeStart={onStart} onResizeStop={onStop(false)}>
          {widgets.map(w => (
            <div key={w.id} className={s.bw} data-widget={w.type}>
              {board.edit && (
                <div className={s.bwBar} tabIndex={0} role="group" onKeyDown={onBarKey(w)}
                  aria-label={`${WIDGETS[w.type].name} widget. Arrow keys move it, Shift and an arrow key resize it.`}>
                  <span className={s.bwGrip} aria-hidden="true">⋮⋮</span>
                  <span className={s.bwName}>{WIDGETS[w.type].name}</span>
                  <span className={s.bwHint}>drag or arrow keys to move · corners or Shift + arrows to resize</span>
                  {widgets.length > 1 && <button type="button" className={s.bwClose} aria-label={`Remove ${WIDGETS[w.type].name}`} onClick={() => api.removeWidget(w.id)}>×</button>}
                </div>
              )}
              <div className={s.bwBody}>{renderWidget(w)}</div>
            </div>
          ))}
        </Grid>
      )}
    </div>
  )
}
