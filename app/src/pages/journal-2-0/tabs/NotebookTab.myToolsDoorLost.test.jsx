// Task 8.18 fix round 1 (m-1): the header's My tools door when its chunk cannot load (a stale tab after a deploy). It
// says the / doors' own sentence (lib/notebookWidgetsFlags WIDGET_CHUNK_LOST), never nothing.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { WIDGET_CHUNK_LOST } from '../lib/notebookWidgetsFlags'
import NotebookTab from './NotebookTab'

// The chunk 404s: the dynamic import rejects.
vi.mock('../components/notebook/myTools/openMyTools.js', () => { throw new Error('Failed to fetch dynamically imported module') })

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

beforeEach(() => { installFetch([[/mapping-offer$/, { offer: null }]]) })
afterEach(() => { cleanup(); __resetNotebookFlags() })

describe('the My tools door whose chunk cannot load', () => {
  it('says the reload sentence', async () => {
    latchNotebookFlags({ notebook_widgets_w8_enabled: true })
    render(<Providers route="/journal/notebook?view=all"><NotebookTab /></Providers>)
    await settle()
    expect(screen.queryByText(WIDGET_CHUNK_LOST)).toBeNull()                      // control: not said before
    fireEvent.click(screen.getByRole('button', { name: 'My tools' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(WIDGET_CHUNK_LOST)
  })
})
