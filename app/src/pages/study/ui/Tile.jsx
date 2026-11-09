// ONE answer tile for every Study screen (kit v2, 2026-11-08; the owner, batch 24, on the tiles: "Think these can be much
// cooler and better graphics, by a lot! I want a really cool production man!", and his rule that a note holds everywhere,
// docs/study/OWNER_PRINCIPLES.md). A physical card: black glass, a 3D key cap with the number, a lift on hover, a gold
// border that runs round it when picked, a green or red glow and a medallion after the verdict (kit2.module.css .tile).
// States: idle · sel · right · wrong · quiet. Semantics are the caller's: pass role / aria-checked for a radio group.
import { forwardRef } from 'react'
import UIcon from '../../../components/ui/UIcon'
import k from './kit2.module.css'

const Tile = forwardRef(function Tile({ n = null, label, state = 'idle', i = 0, deal = true, disabled = false, onClick, onKeyDown, role = null, checked = undefined, tabIndex = undefined, testId = null, className = '', dataIndex = undefined }, ref) {
  const cls = [k.tile, k[state] || '', deal ? k.deal : '', className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type="button" className={cls} style={{ '--i': i }} disabled={disabled} onClick={onClick} onKeyDown={onKeyDown}
      role={role || undefined} aria-checked={checked} aria-pressed={role ? undefined : (state === 'sel' || undefined)} tabIndex={tabIndex}
      data-state={state} data-testid={testId || undefined} data-choice-index={dataIndex}>
      {n != null ? <span className={k.key} aria-hidden="true">{state === 'right' ? <UIcon name="check" size={18} gold={false} /> : state === 'wrong' ? <UIcon name="x" size={18} gold={false} /> : n}</span> : null}
      <span className={k.tileLabel}>{label}</span>
      <span className={k.tileEnd} aria-hidden="true">{state === 'right' || state === 'sel' ? <UIcon name="check" size={20} gold={false} /> : state === 'wrong' ? <UIcon name="x" size={20} gold={false} /> : null}</span>
    </button>
  )
})

export default Tile
