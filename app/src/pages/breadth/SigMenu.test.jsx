import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SigMenu, { SigMenuItem } from './SigMenu'

// The Breadth column-header / "⋯" menu: opens from its trigger, runs a row and
// closes, Esc closes and hands focus back, a disabled row cannot run.
function setup(onMove = vi.fn(), onHide = vi.fn()) {
  render(
    <SigMenu label="Health column options" trigger="Health">
      <SigMenuItem onSelect={onMove} disabled>Move left</SigMenuItem>
      <SigMenuItem onSelect={onHide}>Hide column</SigMenuItem>
    </SigMenu>,
  )
  return { trigger: screen.getByRole('button', { name: 'Health column options' }), onMove, onHide }
}

describe('SigMenu', () => {
  it('opens on the trigger and focuses the first enabled row', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement.textContent).toBe('Hide column')
  })

  it('runs a row and closes', () => {
    const { trigger, onHide } = setup()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide column' }))
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a disabled row does not run', () => {
    const { trigger, onMove } = setup()
    fireEvent.click(trigger)
    const row = screen.getByRole('menuitem', { name: 'Move left' })
    expect(row).toBeDisabled()
    fireEvent.click(row)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('Esc closes and returns focus to the trigger', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('SigMenu header + open reporting', () => {
  it('renders the header above the rows and reports open/close', () => {
    const changes = []
    render(
      <SigMenu label="Col options" trigger="Col" header={<div>Plain name</div>} onOpenChange={o => changes.push(o)}>
        <SigMenuItem onSelect={() => {}}>Hide column</SigMenuItem>
      </SigMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Col options' }))
    const menu = screen.getByRole('menu')
    expect(menu.textContent.startsWith('Plain name')).toBe(true)
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(changes).toEqual([true, false])
  })
})
