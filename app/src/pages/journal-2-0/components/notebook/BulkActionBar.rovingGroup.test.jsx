// Wave 13 lane 13Q-5 (click-budget: Q11, "tag and move 5 notes"). The bar's own
// action buttons form ONE roving group -- Left/Right/Up/Down move the single
// Tab stop among them, so a member already in the bar never pays a full Tab
// walk from "Tags" to "Archive". Deliberately still `role="group"`, never
// "toolbar" (BulkActionBar.test.jsx already pins that the opposite would be
// wrong) -- none of THAT file's assertions are touched here.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BulkActionBar from './BulkActionBar'

const FOLDERS = [{ id: 'f1', name: 'Research', parentId: null }]
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: FOLDERS }) }))

function setup(over = {}) {
  const props = {
    count: 2, totalInView: 5, allSelected: false,
    onSelectAll: vi.fn(), onClear: vi.fn(), selectedTags: [], tagNodes: [],
    onMove: vi.fn(), onAddTag: vi.fn(), onRemoveTag: vi.fn(),
    onFavorite: vi.fn(), onUnfavorite: vi.fn(), onExport: vi.fn(),
    onTrash: vi.fn(), onRestore: vi.fn(), onArchive: vi.fn(), onUnarchive: vi.fn(),
    ...over,
  }
  return { ...render(<BulkActionBar {...props} />), props }
}

beforeEach(() => vi.clearAllMocks())

const btn = (name) => screen.getByRole('button', { name })
const actions = () => [...document.querySelectorAll('[data-bulk-action]')]

describe('BulkActionBar — roving group (13Q-5)', () => {
  it('Move starts disabled (no folder chosen), so Tags is the ONE Tab stop at mount', () => {
    setup()
    const tags = btn('Tags')
    expect(tags.tabIndex).toBe(0)
    for (const el of actions()) {
      if (el === tags) continue
      if (!el.disabled) expect(el.tabIndex).toBe(-1)
    }
  })

  it('ArrowRight moves the roving stop AND real focus to the next action', () => {
    setup()
    const tags = btn('Tags')
    tags.focus()
    fireEvent.keyDown(tags, { key: 'ArrowRight' })
    const favorite = btn('Favorite')
    expect(document.activeElement).toBe(favorite)
    expect(favorite.tabIndex).toBe(0)
    expect(tags.tabIndex).toBe(-1)
  })

  it('ArrowLeft moves back; the first stop holds rather than wrapping', () => {
    setup()
    const tags = btn('Tags')
    tags.focus()
    fireEvent.keyDown(tags, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tags)
    expect(tags.tabIndex).toBe(0)
  })

  // Lane FIN-A11Y (review R4, M-15): the shared roving hook has Home and End; this bar's own
  // handler had only the arrows.
  it('End jumps to the last action and Home back to the first, moving the Tab stop with them', () => {
    setup()
    const tags = btn('Tags')
    tags.focus()
    expect(fireEvent.keyDown(tags, { key: 'End' })).toBe(false)   // handled: default prevented
    const trash = btn('Move to Trash')
    expect(document.activeElement).toBe(trash)
    expect(trash.tabIndex).toBe(0)
    expect(tags.tabIndex).toBe(-1)
    expect(fireEvent.keyDown(trash, { key: 'Home' })).toBe(false)
    expect(document.activeElement).toBe(tags)
    expect(tags.tabIndex).toBe(0)
    expect(trash.tabIndex).toBe(-1)
  })

  it('Home and End from OUTSIDE the action group are left alone (a text field keeps them)', () => {
    setup()
    const select = screen.getByRole('combobox', { name: /move/i })
    select.focus()
    expect(fireEvent.keyDown(select, { key: 'End' })).toBe(true)
    expect(document.activeElement).toBe(select)
  })

  it('the last stop holds too (Move to Trash, going right)', () => {
    // Arrow movement reads the keydown's OWN target (real DOM focus), never the
    // `activeAction` state, so this needs no setup beyond focusing the last button directly.
    setup()
    const trash = btn('Move to Trash')
    trash.focus()
    fireEvent.keyDown(trash, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(trash)
  })

  it('ArrowDown/ArrowUp move the same distance as ArrowRight/ArrowLeft', () => {
    setup()
    const tags = btn('Tags')
    tags.focus()
    fireEvent.keyDown(tags, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(btn('Favorite'))
    fireEvent.keyDown(btn('Favorite'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(tags)
  })

  it('⛔ CONTROL -- an arrow key from OUTSIDE the action group (e.g. the Move select) does nothing', () => {
    setup()
    const before = btn('Tags').tabIndex
    const sel = screen.getByRole('combobox', { name: 'Folder to move the selected notes to' })
    fireEvent.keyDown(sel, { key: 'ArrowRight' })
    expect(btn('Tags').tabIndex).toBe(before)
  })

  it('in the Trash view, Restore is the lone roving stop (no neighbours to move to)', () => {
    setup({ trashView: true })
    const restore = btn('Restore')
    expect(restore.tabIndex).toBe(0)
    restore.focus()
    fireEvent.keyDown(restore, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(restore)
  })

  it('choosing a folder enables Move and repaints its tabIndex (never left unmanaged)', () => {
    setup()
    fireEvent.change(screen.getByRole('combobox', { name: 'Folder to move the selected notes to' }),
      { target: { value: 'f1' } })
    const move = btn('Move')
    expect(move.disabled).toBe(false)
    // the real HTML attribute, not the IDL property (which defaults to 0 even
    // when nothing ever set it -- that default would pass vacuously).
    expect(['0', '-1']).toContain(move.getAttribute('tabindex'))
  })

  // 13Q-5: NotebookTab's Ctrl+Alt+B jump reads this attribute as its stable
  // landing anchor (never the roving group's active stop -- measured: that
  // broke the SECOND reach, since Move sits before Tags in DOM order).
  it('the Move select carries the jump-shortcut anchor, and sits OUTSIDE the roving group', () => {
    setup()
    const sel = screen.getByRole('combobox', { name: 'Folder to move the selected notes to' })
    expect(sel).toHaveAttribute('data-bulk-move-select', '')
    expect(sel.hasAttribute('data-bulk-action')).toBe(false)
  })
})
