// Plan F Task 10 (review M-4): the notice's chunk loads only when there is a notice to show.
//
// Its own file, and ONE test that holds both halves (no chunk while show is false, then exactly
// one once it is true), so the result does not depend on which test in a file ran first: a module
// loads once per file, and a counter another test had already moved would make "0" vacuous.
import { it, expect, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers } from '../../a11y/fixtures'
import NotebookTab, { __resetRepairNoticeForTests } from '../../tabs/NotebookTab'

// Counts how many times NotebookTab's lazy import pulls the notice chunk in. Nothing else in this
// file imports the module.
const chunk = vi.hoisted(() => ({ loads: 0 }))
vi.mock('./ImportRepairNotice', async () => {
  chunk.loads += 1
  return vi.importActual('./ImportRepairNotice')
})

const HEADING = 'Some imported notes are missing pictures'
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

async function renderList() {
  render(<Providers route="/journal/notebook?view=all"><NotebookTab /></Providers>)
  await screen.findAllByText('Weekly plan')
  await settle()
}

it('no chunk loads while show is false, and exactly one once it is true', async () => {
  latchWave8Flags(false)

  __resetRepairNoticeForTests()
  installFetch([[/^\/api\/j2\/notes\/import\/repair-notice$/, { show: false, lossNotes: 0 }]])
  await renderList()
  expect(screen.queryByText(HEADING)).toBeNull()
  expect(chunk.loads).toBe(0)
  cleanup()

  // The control: the same tab with a notice to show DOES load it, so the 0 above can fail.
  __resetRepairNoticeForTests()
  installFetch([[/^\/api\/j2\/notes\/import\/repair-notice$/, { show: true, lossNotes: 2 }]])
  await renderList()
  await screen.findByRole('heading', { name: HEADING })
  expect(chunk.loads).toBe(1)
  cleanup()
}, 30000)
