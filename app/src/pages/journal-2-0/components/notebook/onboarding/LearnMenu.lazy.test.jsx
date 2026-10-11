// Residual round (ruling R25: the spec says the Notebook's first-open budget must not move).
// The Learn BUTTON is eager; the menu behind it (LearnMenuPanel.jsx, with learnTours, capabilityList
// and the sample-notebook client) is a chunk fetched on the first press. Its own file so its module
// registry is fresh: LearnMenu.test.jsx warms the lazy chunk once and then finds the menu at once.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const { loads } = vi.hoisted(() => ({ loads: { n: 0 } }))
// The factory runs when the module is FIRST imported, so the counter is "how many chunk fetches".
vi.mock('./LearnMenuPanel', () => {
  loads.n += 1
  return {
    default: ({ open, hasAnyNotes }) => (open ? <div role="menu" aria-label="Learn: walkthroughs" data-notes={String(hasAnyNotes)} /> : null),
  }
})

import LearnMenu from './LearnMenu'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'

const WAVE14 = { notebook_onboarding_enabled: true, notebook_getting_started_enabled: true }
const learn = () => screen.getByRole('button', { name: 'Learn' })

beforeEach(() => { __resetNotebookFlags() })
afterEach(() => { __resetNotebookFlags() })

describe('the Learn menu is a lazy chunk behind an eager button', () => {
  it('LearnMenu.jsx imports the panel dynamically and none of what the panel needs', () => {
    const src = readFileSync(join(__dirname, 'LearnMenu.jsx'), 'utf8')
    expect(src).toMatch(/lazyChunk\(\(\) => import\('\.\/LearnMenuPanel'\)\)/)
    for (const heavy of ['learnTours', 'capabilityList', 'sampleNotebook', 'LearnMenuPanel', 'CapabilityPreview']) {
      expect(src, heavy).not.toMatch(new RegExp(String.raw`^import[^\n]*${heavy}`, 'm'))
    }
  })

  it('draws the button at once, fetches nothing until the first press, then fetches once and keeps the panel', async () => {
    latchNotebookFlags(WAVE14)
    render(<LearnMenu hasAnyNotes={false} />)
    expect(learn()).toHaveAttribute('aria-expanded', 'false')
    expect(loads.n).toBe(0)
    fireEvent.click(learn())
    expect(learn()).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('menu')).toHaveAttribute('data-notes', 'false')
    expect(loads.n).toBe(1)
    fireEvent.click(learn()) // close
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(learn()) // open again: the same chunk, no second fetch
    expect(await screen.findByRole('menu')).toBeTruthy()
    expect(loads.n).toBe(1)
  })

  it('the switch off draws nothing and fetches nothing', () => {
    render(<LearnMenu />)
    expect(screen.queryByRole('button', { name: 'Learn' })).toBeNull()
    expect(loads.n).toBe(1) // unchanged from the case before: this file never fetched it again
  })
})
