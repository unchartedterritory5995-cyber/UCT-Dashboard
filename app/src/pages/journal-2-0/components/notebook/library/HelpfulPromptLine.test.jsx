// Task 11.18 (W11-R8 / W11-R9): the 3rd-day "Was <title> helpful?" line, against a fake of Task 11.12's two routes.
// ⛔ Asserted by RENDERED TEXT and by what reached the wire, never by a state transition.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HelpfulPromptLine, { promptOf } from './HelpfulPromptLine'
import { GALLERY } from '../../../lib/templateLibrary'

const SHOW = { show: true, itemId: 'g1', title: 'Pre-market prep', line: 'Was Pre-market prep helpful?' }
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

let calls
let promptAnswer
let postAnswer
beforeEach(() => {
  calls = []
  promptAnswer = json(SHOW)
  postAnswer = json({ answer: 'yes', helpful: true, count: 4 })
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null })
    if (method === 'GET' && String(url) === `${GALLERY}/notes/n1/helpful-prompt`) return promptAnswer
    if (method === 'POST' && String(url) === `${GALLERY}/g1/helpful-prompt`) return postAnswer
    return json({ detail: 'Not found' }, 404)
  })
})

const posts = () => calls.filter((c) => c.method === 'POST')
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('HelpfulPromptLine', () => {
  it('line_shows_only_when_server_says_show', async () => {
    const { unmount } = render(<HelpfulPromptLine noteId="n1" />)
    expect(await screen.findByText('Was Pre-market prep helpful?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Not really' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    expect(calls).toEqual([{ url: `${GALLERY}/notes/n1/helpful-prompt`, method: 'GET', body: null }])
    unmount()

    // CONTROL: the server says no, says nothing usable, or the route is dark -> no line at all.
    // `show: false` carries every other field, so only `show` can be what hides it.
    for (const answer of [json({ ...SHOW, show: false }), json({ show: true }), json({ detail: 'Not found' }, 404)]) {
      promptAnswer = answer
      calls = []
      const { container, unmount: done } = render(<HelpfulPromptLine noteId="n1" />)
      await waitFor(() => expect(calls).toHaveLength(1))
      await settle()
      expect(container.textContent).toBe('')
      done()
    }
  })

  it('builds the line from the title only when the server sent no line', () => {
    expect(promptOf({ ok: true, data: { show: true, itemId: 'g1', title: 'Setup study' } }).line).toBe('Was Setup study helpful?')
    expect(promptOf({ ok: true, data: { show: true, itemId: 'g1', title: '', line: '' } })).toBeNull()
    expect(promptOf({ ok: true, data: { show: true, title: 'X' } })).toBeNull()
    expect(promptOf({ ok: false, code: 'unavailable' })).toBeNull()
  })

  it('answers_post_and_hide (Yes, and Not really)', async () => {
    for (const [label, answer] of [['Yes', 'yes'], ['Not really', 'not_really']]) {
      calls = []
      const user = userEvent.setup()
      const { container, unmount } = render(<HelpfulPromptLine noteId="n1" />)
      await user.click(await screen.findByRole('button', { name: label }))
      // Hidden at once (optimistic), before the post has answered.
      expect(container.textContent).toBe('')
      await waitFor(() => expect(posts()).toHaveLength(1))
      expect(posts()[0]).toEqual({ url: `${GALLERY}/g1/helpful-prompt`, method: 'POST', body: { answer } })
      await settle()
      expect(container.textContent).toBe('')
      unmount()
    }
  })

  it('dismiss_posts_dismissed', async () => {
    const user = userEvent.setup()
    const { container } = render(<HelpfulPromptLine noteId="n1" />)
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(container.textContent).toBe('')
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toEqual({ answer: 'dismissed' })
  })

  it('a failed post shows nothing: the line stays hidden and no sentence appears', async () => {
    postAnswer = json({ detail: { code: 'not_found', message: 'Gone.' } }, 500)
    const user = userEvent.setup()
    const { container } = render(<HelpfulPromptLine noteId="n1" />)
    await user.click(await screen.findByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    await settle()
    expect(container.textContent).toBe('')
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)   // never asked again
  })
})
