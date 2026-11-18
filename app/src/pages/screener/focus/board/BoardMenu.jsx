// The scan board's controls (boardModel.js), in the page's own menu parts.
//   BoardMenu     "Layout" in the top bar: presets, the member's layouts, Customize, Save, and how
//                 results are shown. `onCommunity` / `onShare` (community layouts, behind their own
//                 flag) add the two sharing entries; without them the menu is as it was.
//   BoardEditBar  the slim line shown while Customize is on: Add widget, Reset, Done.
import Menu, { MenuItem, MenuDivider, MenuHeading } from '../Menu'
import { presetsOf, ROW_STYLES, SWITCHES, WIDGETS, MAX_MINE, currentLayout, hasWidget, missingWidgets, rowsOf } from './boardModel'
import focus from '../FocusScreener.module.css'
import menuStyles from '../FocusMenus.module.css'
import s from './Board.module.css'

// The chosen option carries the tick (UCT Signature 2b, mark 3); everything else is plain.
const Tick = () => <span className={menuStyles.smTick} aria-hidden="true"> ✓</span>

export function BoardMenu({ board, api, onSaveAs, onCommunity = null, onShare = null, reviewCount = 0 }) {
  const cur = currentLayout(board)
  const mineCur = board.mine.find(m => m.id === board.layoutId) || null
  const rows = rowsOf(board)
  const presets = presetsOf(board.tier)
  const item = l => {
    const on = l.id === board.layoutId
    return (
      <MenuItem key={l.id} onSelect={() => api.pickLayout(l.id)} hint={on && board.changed ? 'changed' : undefined}>
        {l.name}{on && <><Tick /><span className="sr-only"> (current)</span></>}
      </MenuItem>
    )
  }
  return (
    <Menu label="Layout" align="right" width={290} testId="board-menu"
      /* An admin with shared layouts to review sees the count on the button itself, so one waiting
         is not missed until the menu happens to be opened. Grey: it is a count, not a selection. */
      trigger={<>Layout{reviewCount > 0 && <span className={s.reviewCount} title={`${reviewCount} shared ${reviewCount === 1 ? 'layout' : 'layouts'} to review`} data-testid="board-review-count">{reviewCount}</span>} <span aria-hidden="true">▾</span></>}>
      <MenuHeading>Presets</MenuHeading>
      {presets.map(item)}
      {board.mine.length > 0 && <MenuHeading>My layouts</MenuHeading>}
      {board.mine.map(item)}
      <MenuDivider />
      <MenuItem onSelect={() => api.setEdit(!board.edit)}>{board.edit ? 'Done customizing' : 'Customize layout'}</MenuItem>
      {mineCur && board.changed && <MenuItem onSelect={() => api.updateMine(mineCur.id)}>Save changes to “{mineCur.name}”</MenuItem>}
      {board.mine.length < MAX_MINE && <MenuItem onSelect={onSaveAs}>Save layout as…</MenuItem>}
      {mineCur && <MenuItem danger onSelect={() => api.deleteMine(mineCur.id)}>Delete “{mineCur.name}”</MenuItem>}
      {!cur && <MenuItem onSelect={() => api.pickLayout(presets[0].id)}>Back to the {presets[0].name} preset</MenuItem>}
      {(onCommunity || onShare) && <MenuDivider />}
      {onCommunity && <MenuItem onSelect={onCommunity} hint={reviewCount > 0 ? `${reviewCount} to review` : undefined}>Community layouts…</MenuItem>}
      {onShare && <MenuItem onSelect={onShare}>Share this layout…</MenuItem>}
      {hasWidget(board, 'results') && (
        <>
          <MenuDivider />
          <MenuHeading>Result rows</MenuHeading>
          {ROW_STYLES.map(([v, label]) => (
            <MenuItem key={v} onSelect={() => api.setRows(v)}>{label}{rows === v && <><Tick /><span className="sr-only"> (current)</span></>}</MenuItem>
          ))}
        </>
      )}
      <MenuDivider />
      <MenuHeading>Show</MenuHeading>
      {/* a tablet's top bar has no room for tabs: there the screens are always the dropdown */}
      {board.tier !== 'tablet' && <MenuItem onSelect={() => api.setOption('screens', board.screens === 'tabs' ? 'menu' : 'tabs')} hint={board.screens === 'tabs' ? 'on' : 'off'}>Pinned screens as tabs</MenuItem>}
      {SWITCHES.map(([k, label]) => (
        <MenuItem key={k} onSelect={() => api.setOption(k, !board[k])} hint={board[k] ? 'on' : 'off'}>{label}</MenuItem>
      ))}
    </Menu>
  )
}

export function BoardEditBar({ board, api }) {
  const missing = missingWidgets(board)
  const cur = currentLayout(board)
  return (
    <div className={s.editBar} role="region" aria-label="Customize layout" data-testid="board-edit-bar">
      <span className={s.editTitle}>Customizing layout</span>
      <span className={s.editHint}>Drag a widget by its bar and resize it from a corner, or use the arrow keys on a bar (Shift resizes).</span>
      <span className={focus.spacer} />
      <Menu label="Add widget" trigger="+ Add widget" align="right" width={300} testId="board-add-menu" disabled={missing.length === 0} disabledTitle="Every widget is on the board">
        {missing.map(t => <MenuItem key={t} onSelect={() => api.addWidget(t)}>{WIDGETS[t].name}<span className={s.addBlurb}>{WIDGETS[t].blurb}</span></MenuItem>)}
      </Menu>
      {board.changed && <button type="button" className={focus.btn} onClick={() => api.pickLayout(cur ? cur.id : presetsOf(board.tier)[0].id)}>Undo changes</button>}
      <button type="button" className={focus.btnPrimary} onClick={() => api.setEdit(false)}>Done</button>
    </div>
  )
}
