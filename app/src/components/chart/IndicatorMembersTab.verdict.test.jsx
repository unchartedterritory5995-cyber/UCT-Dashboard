// THE AUTHOR'S VERDICT IN THE MEMBERS LIST (Studio lane R4; `pages/formulas/sharedVerdict.js`).
//
// A listed indicator whose saved version has a verdict says it on its card, and an install says it
// once in its confirmation. One with none says nothing more than before.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react'
import IndicatorMembersTab from './IndicatorMembersTab'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const ENTRIES = [
  { token: 'sh_one', name: 'Tight Weekly Closes', repaint: 'non-repainting', placement: 'overlay', inputs: 2,
    headline: 'Runs fully', engine_version: 'e67', headline_current: true },
  { token: 'sh_two', name: 'Up Down Volume', repaint: 'repaints', placement: 'pane', inputs: 0 },
]
const mount = (install) => render(
  <IndicatorMembersTab fetchLibrary={async () => ({ ok: true, entries: ENTRIES, next: null })} install={install} />,
)
const card = (token) => screen.getAllByTestId('members-entry').find((r) => r.dataset.token === token)

describe('the verdict on a member\'s published indicator', () => {
  it('a card whose listing carries one says it, in words; a card without one says nothing more', async () => {
    mount(async () => ({ ok: false }))
    await waitFor(() => expect(screen.getAllByTestId('members-entry')).toHaveLength(2))
    expect(within(card('sh_one')).getByTestId('members-entry-verdict').textContent).toBe('Runs fully, checked on engine e67.')
    expect(within(card('sh_two')).queryByTestId('members-entry-verdict')).toBeNull()
    // the facts line that was already there is untouched on both
    expect(within(card('sh_two')).getByTestId('members-entry-facts')).toBeTruthy()
  })

  it('an install says the installed version\'s verdict once, from the row the install returned', async () => {
    mount(async (token) => ({ ok: true, row: token === 'sh_one'
      ? { def_id: 'u_0123456789ab', headline: 'Runs on charts, 2 values withheld (not guessed)', engine_version: 'e67' }
      : { def_id: 'u_ba9876543210' } }))
    await waitFor(() => expect(screen.getAllByTestId('members-entry')).toHaveLength(2))
    await act(async () => { fireEvent.click(within(card('sh_one')).getByTestId('members-install')) })
    expect(within(card('sh_one')).getByTestId('members-installed-note').textContent)
      .toBe('Installed: Runs on charts, 2 values withheld (not guessed). Your copy is under “Your indicators”.')
    await act(async () => { fireEvent.click(within(card('sh_two')).getByTestId('members-install')) })
    expect(within(card('sh_two')).getByTestId('members-installed-note').textContent)
      .toBe('Installed. Your copy is under “Your indicators”.')         // no verdict: the sentence it always was
  })
})
