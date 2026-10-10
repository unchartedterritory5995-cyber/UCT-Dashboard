// CAP-A12 — the Journal columns picker reorders through the platform's HTML5
// drag-and-drop (the app's one drag mechanism), not @dnd-kit. Each migrated
// interaction is pinned here: pointer drag onto another row, the drop that
// lands nowhere, the drag that is not ours, and the ↑/↓ door that touch and
// keyboard users take because HTML5 drag never fires on touch.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ColumnsPicker, { reorderKeys } from './ColumnsPicker'

const COLUMNS = [
  { key: 'symbol', label: 'Symbol', nonHideable: true },
  { key: 'entry', label: 'Entry' },
  { key: 'stop', label: 'Stop' },
  { key: 'pnl', label: 'P&L' },
]

function setup(extra = {}) {
  const onReorder = vi.fn()
  render(
    <ColumnsPicker
      open
      anchorRef={{ current: null }}
      columns={COLUMNS}
      hiddenKeys={new Set()}
      onToggle={() => {}}
      onReorder={onReorder}
      onReset={() => {}}
      onClose={() => {}}
      {...extra}
    />,
  )
  return { onReorder }
}

// jsdom has no DataTransfer; a minimal store is enough for setData/getData.
function dataTransfer() {
  const store = {}
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (t, v) => { store[t] = v },
    getData: (t) => store[t] ?? '',
  }
}

const row = (key) => document.querySelector(`[data-column-key="${key}"]`)

describe('reorderKeys — arrayMove semantics, pure', () => {
  it('moves a key to the slot the target occupies, both directions', () => {
    expect(reorderKeys(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(reorderKeys(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })
  it('a drop on itself or an unknown key is no move', () => {
    expect(reorderKeys(['a', 'b'], 'a', 'a')).toBeNull()
    expect(reorderKeys(['a', 'b'], 'zz', 'a')).toBeNull()
  })
})

describe('ColumnsPicker — HTML5 drag reorder', () => {
  it('dragging a handle onto another row emits the reordered keys', () => {
    const { onReorder } = setup()
    const dt = dataTransfer()
    fireEvent.dragStart(screen.getByLabelText('Drag Entry'), { dataTransfer: dt })
    fireEvent.dragOver(row('pnl'), { dataTransfer: dt })
    fireEvent.drop(row('pnl'), { dataTransfer: dt })
    expect(onReorder).toHaveBeenCalledTimes(1)
    expect(onReorder).toHaveBeenCalledWith(['symbol', 'stop', 'pnl', 'entry'])
  })

  it('dragging upward lands before the target', () => {
    const { onReorder } = setup()
    const dt = dataTransfer()
    fireEvent.dragStart(screen.getByLabelText('Drag P&L'), { dataTransfer: dt })
    fireEvent.dragOver(row('entry'), { dataTransfer: dt })
    fireEvent.drop(row('entry'), { dataTransfer: dt })
    expect(onReorder).toHaveBeenCalledWith(['symbol', 'pnl', 'entry', 'stop'])
  })

  it('marks the dragged row and the hovered drop target while the drag is live', () => {
    setup()
    const dt = dataTransfer()
    fireEvent.dragStart(screen.getByLabelText('Drag Entry'), { dataTransfer: dt })
    expect(row('entry').style.opacity).toBe('0.5')
    fireEvent.dragOver(row('stop'), { dataTransfer: dt })
    expect(row('stop').style.outline).toContain('dashed')
    fireEvent.dragEnd(screen.getByLabelText('Drag Entry'), { dataTransfer: dt })
    expect(row('entry').style.opacity).toBe('1')
    expect(row('stop').style.outline).toBe('')
  })

  it('a drop back on its own row reorders nothing', () => {
    const { onReorder } = setup()
    const dt = dataTransfer()
    fireEvent.dragStart(screen.getByLabelText('Drag Stop'), { dataTransfer: dt })
    fireEvent.drop(row('stop'), { dataTransfer: dt })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('a drag that did not start on a handle (a file, another widget) is ignored', () => {
    const { onReorder } = setup()
    const dt = dataTransfer()
    const over = fireEvent.dragOver(row('stop'), { dataTransfer: dt })
    // not ours: dragover is NOT cancelled, so the browser refuses the drop
    expect(over).toBe(true)
    fireEvent.drop(row('stop'), { dataTransfer: dt })
    expect(onReorder).not.toHaveBeenCalled()
  })
})

describe('ColumnsPicker — the non-drag door (touch + keyboard)', () => {
  it('↑ and ↓ move one slot and are disabled at the ends', () => {
    const { onReorder } = setup()
    fireEvent.click(screen.getByLabelText('Move Stop up'))
    expect(onReorder).toHaveBeenLastCalledWith(['symbol', 'stop', 'entry', 'pnl'])
    fireEvent.click(screen.getByLabelText('Move Entry down'))
    expect(onReorder).toHaveBeenLastCalledWith(['symbol', 'stop', 'entry', 'pnl'])
    expect(screen.getByLabelText('Move Symbol up')).toBeDisabled()
    expect(screen.getByLabelText('Move P&L down')).toBeDisabled()
  })
})

describe('CAP-A12 — one drag mechanism', () => {
  // Read from disk, not typed: the claim is about the tree.
  const APP = path.resolve(__dirname, '../../../..')
  it('no source file imports @dnd-kit, and package.json no longer ships it', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(Object.keys(deps).filter((d) => d.startsWith('@dnd-kit/'))).toEqual([])
    // control: the read really is this app's package.json
    expect(deps.react).toBeTruthy()

    const offenders = []
    let seen = 0
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) { if (ent.name !== 'node_modules') walk(p) }
        else if (/\.(jsx?|mjs|cjs)$/.test(ent.name) && !/\.test\./.test(ent.name)) {
          seen++
          if (/from\s+['"]@dnd-kit\//.test(fs.readFileSync(p, 'utf8'))) offenders.push(p)
        }
      }
    }
    walk(path.join(APP, 'src'))
    expect(offenders).toEqual([])
    // control: the walk really read the tree, so an empty list is not a failed read
    expect(seen).toBeGreaterThan(1000)
  })
})
