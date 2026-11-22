/**
 * Owner 11-15 (live bug): the board Notebook asked for notes with no limit, so the server sent its
 * default first 100 and the footer read "100 notes" for a member with more. It now asks for pages of
 * 500, keeps loading until there are no more, and the footer counts the server's true total.
 */
import { render, screen, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { vi, describe, it, expect, afterEach } from 'vitest'

const notesCall = vi.hoisted(() => ({ args: null, loadMore: null }))
vi.mock('../../journal-2-0/hooks/useJ2Notes', () => ({
  default: (args) => {
    notesCall.args = args
    return {
      notes: Array.from({ length: 3 }, (_, i) => ({ id: `n${i}`, title: `Note ${i}`, folderId: null })),
      total: 1234, hasMore: true, loadMore: notesCall.loadMore, isLoadingMore: false, loadMoreError: null, refresh: () => {},
    }
  },
  useJ2Note: () => ({ note: null, update: async () => {} }),
}))
vi.mock('../../journal-2-0/hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPrefs: () => {}, loading: false }) }))
vi.mock('../../../hooks/usePlacedTheme', () => ({ default: () => null }))

import NotebookWidget from './NotebookWidget'
import { UctHeaderSlotContext } from '../uctHeaderSlot'

afterEach(cleanup)

function Board() {
  const [row] = useState(() => document.body.appendChild(document.createElement('span')))
  const [ctrl] = useState(() => document.body.appendChild(document.createElement('span')))
  return (
    <UctHeaderSlotContext.Provider value={{ row, rowAlways: row, controls: ctrl, claim: null }}>
      <NotebookWidget color="A" opts={{}} onOptsChange={() => {}} />
    </UctHeaderSlotContext.Provider>
  )
}

describe('the board Notebook lists every note (owner 11-15)', () => {
  it('asks for pages of 500, loads the rest, and counts the true total', () => {
    notesCall.loadMore = vi.fn()
    render(<Board />)
    expect(notesCall.args.limit).toBe(500)
    expect(notesCall.loadMore).toHaveBeenCalled()
    expect(screen.getByText('1234')).toBeTruthy()
  })
})
