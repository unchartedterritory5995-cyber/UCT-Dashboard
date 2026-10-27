// Task 11.18 (W11-R8 / W11-R9): the 3rd-day "Was <title> helpful?" line, against a fake of Task 11.12's two routes.
// ⛔ Asserted by RENDERED TEXT and by what reached the wire, never by a state transition.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HelpfulPromptLine, { promptOf, ANSWERED_WORDS } from './HelpfulPromptLine'
import { GALLERY } from '../../../lib/templateLibrary'
import { contractBody } from '../../../__fixtures__/contract'

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

// After an answer the line is gone; only the live region remains, saying the answer was taken.
const lineGone = () => expect(document.querySelector('[data-helpful-prompt]')).toBeNull()
const status = () => document.querySelector('[data-helpful-prompt-status]')
const posts = () => calls.filter((c) => c.method === 'POST')
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('HelpfulPromptLine', () => {
  it("merge review I-2: the server's REAL answers (contract fixtures): the 3rd-day line shows, a 1st-day note shows none", async () => {
    const third = contractBody('template-gallery.helpful-prompt.third-day')
    expect(third.show).toBe(true)                                         // non-vacuity: the recorded 3rd day
    promptAnswer = json(third)
    postAnswer = json(contractBody('template-gallery.helpful-prompt.answer'))
    global.fetch.mockImplementation(async (url, init = {}) => {
      const method = init.method || 'GET'
      calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null })
      if (method === 'GET' && String(url) === `${GALLERY}/notes/n1/helpful-prompt`) return promptAnswer
      if (method === 'POST' && String(url) === `${GALLERY}/${third.itemId}/helpful-prompt`) return postAnswer
      return json({ detail: 'Not found' }, 404)
    })
    const user = userEvent.setup()
    const { unmount } = render(<HelpfulPromptLine noteId="n1" />)
    expect(await screen.findByText(third.line)).toBeInTheDocument()       // the server's own words
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0]).toEqual({ url: `${GALLERY}/${third.itemId}/helpful-prompt`, method: 'POST', body: { answer: 'dismissed' } })
    unmount()
    // The 1st-day answer (`{show: false}`) shows nothing.
    promptAnswer = json(contractBody('template-gallery.helpful-prompt'))
    calls = []
    const { container } = render(<HelpfulPromptLine noteId="n1" />)
    await waitFor(() => expect(calls).toHaveLength(1))
    await settle()
    expect(container.textContent).toBe('')
  })

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
      const onDone = vi.fn()
      const { unmount } = render(<HelpfulPromptLine noteId="n1" onDone={onDone} />)
      await user.click(await screen.findByRole('button', { name: label }))
      expect(onDone).toHaveBeenCalledTimes(1)
      // Hidden at once (optimistic), before the post has answered.
      lineGone()
      expect(status()).toHaveTextContent(ANSWERED_WORDS)
      await waitFor(() => expect(posts()).toHaveLength(1))
      expect(posts()[0]).toEqual({ url: `${GALLERY}/g1/helpful-prompt`, method: 'POST', body: { answer } })
      await settle()
      lineGone()
      expect(status()).toHaveTextContent(ANSWERED_WORDS)
      unmount()
    }
  })

  it('dismiss_posts_dismissed', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<HelpfulPromptLine noteId="n1" onDone={onDone} />)
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    lineGone()
    expect(status()).toHaveTextContent(ANSWERED_WORDS)
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toEqual({ answer: 'dismissed' })
  })

  it('a failed post shows nothing: the line stays hidden and no failure is said', async () => {
    postAnswer = json({ detail: { code: 'not_found', message: 'Gone.' } }, 500)
    const user = userEvent.setup()
    render(<HelpfulPromptLine noteId="n1" />)
    await user.click(await screen.findByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    await settle()
    lineGone()
    expect(status()).toHaveTextContent(ANSWERED_WORDS)
    expect(screen.queryByText('Gone.')).toBeNull()
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)   // never asked again
  })

  it('the group is named once, by its question (aria-labelledby, not a second copy of the words)', async () => {
    render(<HelpfulPromptLine noteId="n1" />)
    const group = await screen.findByRole('group', { name: 'Was Pre-market prep helpful?' })
    expect(group).not.toHaveAttribute('aria-label')
    expect(document.getElementById(group.getAttribute('aria-labelledby'))).toHaveTextContent('Was Pre-market prep helpful?')
  })

  it('the live region exists from mount, empty, and is the same element that speaks after the answer', async () => {
    const user = userEvent.setup()
    render(<HelpfulPromptLine noteId="n1" />)
    const region = status()
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveTextContent(/^$/)
    await user.click(await screen.findByRole('button', { name: 'Not really' }))
    expect(status()).toBe(region)
    expect(region).toHaveTextContent(ANSWERED_WORDS)
  })
})
