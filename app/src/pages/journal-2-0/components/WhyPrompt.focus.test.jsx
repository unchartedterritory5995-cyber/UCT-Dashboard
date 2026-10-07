// Lane FIN-A11Y (review R4, I-9). "Why did you take it?": Edit swapped the saved view for
// the editor and the Edit button unmounted with focus on it; Save swapped back and the Save
// button unmounted the same way. Focus fell to <body> both times, and nothing said the save
// had worked. Now Edit lands in the text field, Save and Cancel land on Edit, and a status
// that stays mounted says "Saved".
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import WhyPrompt from './WhyPrompt'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const WHY = { text: 'Tight flag at the 21EMA', updatedAt: '2026-10-02T00:00:00Z' }

/** The card as its parent holds it: the saved answer comes back through onSaved. */
function Host({ initial = WHY }) {
  const [why, setWhy] = useState(initial)
  return (
    <>
      <button type="button">before</button>
      <WhyPrompt symbol="NVDA" entryDay="2026-10-02" why={why} whyMaxChars={500}
        onSaved={(ctx) => setWhy(ctx?.why || null)} />
    </>
  )
}

afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const field = () => screen.getByLabelText('Why did you take it?')
const status = () => document.querySelector('[data-why-status]')

describe('I-9 -- Edit, Save and Cancel leave focus on a named element', () => {
  it('Edit moves focus into the text field', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(field()).toHaveFocus()
  })

  it('Save moves focus to the Edit button', async () => {
    global.fetch = vi.fn(async () => json({ context: { why: { text: 'New reason', updatedAt: 'now' } } }))
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(field())
    await user.type(field(), 'New reason')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus())
    expect(screen.getByText('New reason')).toBeInTheDocument()
  })

  it('Cancel moves focus to the Edit button', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus()
  })

  it('a failed save keeps focus in the editor (the alert says why)', async () => {
    global.fetch = vi.fn(async () => json({ detail: 'The note is at most 500 characters.' }, 422))
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(screen.getByTestId('why-prompt-editing').contains(document.activeElement)).toBe(true)
  })

  it('never takes focus on its own: not on first render, and not when the card shows another position', () => {
    const { rerender } = render(
      <><button type="button">before</button>
        <WhyPrompt symbol="NVDA" entryDay="2026-10-02" why={null} whyMaxChars={500} onSaved={() => {}} /></>,
    )
    expect(document.body).toHaveFocus()
    screen.getByRole('button', { name: 'before' }).focus()
    rerender(
      <><button type="button">before</button>
        <WhyPrompt symbol="AMD" entryDay="2026-10-03" why={WHY} whyMaxChars={500} onSaved={() => {}} /></>,
    )
    expect(screen.getByRole('button', { name: 'before' })).toHaveFocus()
  })
})

describe('I-9 -- a save is said', () => {
  it('a status region is mounted before anything is saved, and is empty', () => {
    render(<Host />)
    expect(status()).not.toBeNull()
    expect(status()).toHaveAttribute('role', 'status')
    expect(status()).toHaveTextContent('')
  })

  it('it is the SAME element across Edit and Save, and says "Saved." after a save', async () => {
    global.fetch = vi.fn(async () => json({ context: { why: { text: 'New reason', updatedAt: 'now' } } }))
    const user = userEvent.setup()
    render(<Host />)
    const region = status()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(status()).toBe(region)
    await user.type(field(), ' more')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(status()).toHaveTextContent('Saved.'))
    expect(status()).toBe(region)
  })

  it('editing again clears it, so a second save is announced as a change', async () => {
    global.fetch = vi.fn(async () => json({ context: { why: { text: 'New reason', updatedAt: 'now' } } }))
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(status()).toHaveTextContent('Saved.'))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(status()).toHaveTextContent('')
  })
})

describe('M-16 -- two prompts on one page do not share an id', () => {
  it('each text field has its own id and its own label', () => {
    render(
      <>
        <WhyPrompt symbol="NVDA" entryDay="2026-10-02" why={null} whyMaxChars={500} onSaved={() => {}} />
        <WhyPrompt symbol="AMD" entryDay="2026-10-02" why={null} whyMaxChars={500} onSaved={() => {}} />
      </>,
    )
    const fields = screen.getAllByLabelText('Why did you take it?')
    expect(fields).toHaveLength(2)
    expect(fields[0].id).not.toBe(fields[1].id)
  })
})
