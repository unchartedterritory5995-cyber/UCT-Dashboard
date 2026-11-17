// The Screener as a widget board (boardModel.js). It is the Charts board's grid and its own drop
// rule (24 x 20, locked to the window; nothing moves while you drag, and on the drop every other
// widget re-tiles around the one you moved: ChartsWorkspace `repackAroundMoved`), so a scan board
// behaves the way a Charts layout does. Locked until Customize is on.
//
// The drop rule lives in the Charts workspace module, which is large: it is loaded only when the
// member first turns Customize on, never to draw a board.
import { useEffect, useMemo, useRef, useState } from 'react'
import GridLayout, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import { COLS, ROWS, WIDGETS, GAP, rowHeightFor, settleDrop } from './boardModel'
import s from './Board.module.css'

const Grid = WidthProvider(GridLayout)

export default function ScanBoard({ board, api, renderWidget, onRefused, loadRepack = () => import('../../../charts/ChartsWorkspace').then(m => m.repackAroundMoved) }) {
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
  return (
    <div ref={host} className={s.board} data-edit={board.edit ? '' : undefined} data-testid="scan-board">
      {height > 0 && (
        <Grid className={s.boardGrid} layout={layout} cols={COLS} rowHeight={rowHeightFor(height)} maxRows={ROWS} margin={[GAP, GAP]} containerPadding={[0, 0]}
          isDraggable={canEdit} isResizable={canEdit} isBounded={false} compactType={null} preventCollision={false} allowOverlap
          useCSSTransforms={false} draggableHandle={`.${s.bwBar}`} draggableCancel="button" resizeHandles={['se', 'sw', 'ne', 'nw']}
          onDragStart={onStart} onDragStop={onStop(true)} onResizeStart={onStart} onResizeStop={onStop(false)}>
          {widgets.map(w => (
            <div key={w.id} className={s.bw} data-widget={w.type}>
              {board.edit && (
                <div className={s.bwBar}>
                  <span className={s.bwGrip} aria-hidden="true">⋮⋮</span>
                  <span className={s.bwName}>{WIDGETS[w.type].name}</span>
                  <span className={s.bwHint}>drag to move · corners to resize</span>
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
