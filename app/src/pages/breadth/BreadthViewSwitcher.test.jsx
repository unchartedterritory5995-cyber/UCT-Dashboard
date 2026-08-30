import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BreadthViewSwitcher from './BreadthViewSwitcher'
import { STYLES, VIEW_CONFIG } from './views/viewMetricConfig'

describe('BreadthViewSwitcher', () => {
  it('renders a button per style and marks the active one pressed', () => {
    render(<BreadthViewSwitcher viewStyle="rings" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Treemap' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Rings' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('calls onSelect with the chosen style', () => {
    const onSelect = vi.fn()
    render(<BreadthViewSwitcher viewStyle="treemap" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tug' }))
    expect(onSelect).toHaveBeenCalledWith('tug')
  })

  it('renders a button for every registered style and no others', () => {
    const { getAllByRole } = render(<BreadthViewSwitcher viewStyle="treemap" onSelect={() => {}} />)
    const labels = getAllByRole('button').map(b => b.textContent)
    expect(labels.sort()).toEqual(STYLES.map(s => VIEW_CONFIG[s].label).sort())
  })

  // 🔴 BOARD-VS-LENS REACHED NO ASSISTIVE TECHNOLOGY AT ALL. The visible label
  // is `aria-hidden` and the phone stylesheet `display: none`s it, so the one
  // distinction the switcher is organised around was sighted-desktop-only.
  describe('the board/lens grouping is reachable by name', () => {
    it('names both groups, and puts each style under the right one', () => {
      render(<BreadthViewSwitcher viewStyle="treemap" onSelect={() => {}} />)
      for (const [kind, name] of [['board', 'Boards'], ['lens', 'Lenses']]) {
        const group = screen.getByRole('group', { name })
        const inside = [...group.querySelectorAll('button')].map(b => b.textContent).sort()
        const expected = STYLES.filter(s => VIEW_CONFIG[s].kind === kind)
          .map(s => VIEW_CONFIG[s].label).sort()
        expect(expected.length, `no ${kind} styles — this assertion would be vacuous`)
          .toBeGreaterThan(0)
        expect(inside).toEqual(expected)
      }
    })

    it('keeps the name on the GROUP, not only on the label the phone hides', () => {
      // The span is decorative-and-hidden by design; deleting the group's own
      // aria-label (or the role that carries it) must fail this, not merely
      // change what a sighted user reads.
      const { container } = render(<BreadthViewSwitcher viewStyle="treemap" onSelect={() => {}} />)
      const named = [...container.querySelectorAll('[role="group"][aria-label]')]
        .map(el => el.getAttribute('aria-label'))
      expect(named).toEqual(['Visualization style', 'Boards', 'Lenses'])
      for (const el of container.querySelectorAll('[aria-hidden="true"]')) {
        expect(el.closest('[role="group"]').getAttribute('aria-label')).toBeTruthy()
      }
    })
  })
})
