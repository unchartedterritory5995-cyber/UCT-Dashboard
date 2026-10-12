// Polish round (review I4-a): the FIRST press of a page load opens a menu whose chunk is still on
// its way (LearnMenu.jsx -> LearnMenuPanel.jsx, lazy). While it loads:
//   * `aria-controls` names no id, because no element carries one yet;
//   * a press outside the button, or Escape, cancels the open, so the menu does not pop open later.
// The panel here is a stand-in whose chunk stays pending until the test releases it, so the loading
// window is as long as the test needs. Its own file: React.lazy resolves once per module registry.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

const { gate, loads } = vi.hoisted(() => {
  let release
  const p = new Promise((r) => { release = r })
  return { gate: { p, release: () => release() }, loads: { n: 0 } }
})
vi.mock('./LearnMenuPanel', async () => {
  loads.n += 1
  await gate.p
  return {
    default: function PanelStandIn({ open, menuId, onReady }) {
      useEffect(() => { onReady?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps
      return open ? <div id={menuId} role="menu" aria-label="Learn: walkthroughs" /> : null
    },
  }
})

import LearnMenu from './LearnMenu'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'

const WAVE14 = { notebook_onboarding_enabled: true, notebook_getting_started_enabled: true }
const learn = () => screen.getByRole('button', { name: 'Learn' })
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => { __resetNotebookFlags(); latchNotebookFlags(WAVE14) })
afterEach(() => { __resetNotebookFlags() })

describe('the Learn menu while its chunk is still loading', () => {
  it('names no menu it cannot point at, and a press outside or Escape cancels the open for good', async () => {
    render(
      <>
        <button type="button">elsewhere</button>
        <LearnMenu hasAnyNotes />
      </>,
    )
    // First press: open, chunk requested, nothing on the page to control yet.
    fireEvent.click(learn())
    // non-vacuity: the chunk really was asked for (a dynamic import reaches the module a few ticks
    // later under vitest), and it is still pending
    await act(async () => { await vi.waitFor(() => expect(loads.n).toBe(1)) })
    expect(learn()).toHaveAttribute('aria-expanded', 'true')
    expect(learn()).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('menu')).toBeNull()

    // A press outside the button cancels the open.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }))
    expect(learn()).toHaveAttribute('aria-expanded', 'false')

    // Open again (still loading), then Escape: closed, and focus is on the button.
    learn().focus()
    fireEvent.click(learn())
    expect(learn()).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(learn()).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(learn())

    // The chunk lands after both dismissals: no menu pops open.
    gate.release()
    await settle()
    await settle()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(learn()).toHaveAttribute('aria-expanded', 'false')
    expect(learn()).not.toHaveAttribute('aria-controls')

    // And the next press opens it at once, naming the menu that is now on the page.
    fireEvent.click(learn())
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(learn()).toHaveAttribute('aria-controls', menu.id))
    expect(document.getElementById(learn().getAttribute('aria-controls'))).toBe(menu)
    expect(loads.n).toBe(1)
  })
})
