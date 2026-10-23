/**
 * ScreenFeedback rails (owner 2026-10-21: feedback on "the overall layout and
 * visual and effects and interactive and learning"): one door per screen, the
 * screen and what it showed ride along, nothing is sent until there is
 * something to say, and a failed post keeps the note on screen.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScreenFeedback from './ScreenFeedback'
import { SCREEN_FEEDBACK_URL, SCREEN_KINDS, drillScreen, screenLabel } from './screenFeedbackHelpers'

describe('ScreenFeedback', () => {
  it('opens on the screen it names and sends the kind, the note and the context', async () => {
    const post = vi.fn(async () => ({ id: 1 }))
    render(<ScreenFeedback screen="landing" context={{ study: 'today' }} post={post} />)
    expect(screen.queryByTestId('screen-feedback-form')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('screen-feedback-open'))
    const form = screen.getByTestId('screen-feedback-form')
    expect(form).toHaveTextContent('Courses landing')
    expect(screen.getByTestId('screen-feedback-send')).toBeDisabled()          // nothing to say yet
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: '  start button below the fold ' } })
    fireEvent.click(screen.getByTestId('screen-feedback-send'))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post).toHaveBeenCalledWith(SCREEN_FEEDBACK_URL, {
      method: 'POST',
      body: { screen: 'landing', kind: 'layout', text: 'start button below the fold', context: { study: 'today' } },
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByTestId('screen-feedback-sent')).toHaveTextContent('1')
    expect(screen.queryByTestId('screen-feedback-form')).not.toBeInTheDocument()
  })

  it('a note alone is enough and goes as "other"', async () => {
    const post = vi.fn(async () => ({ id: 2 }))
    render(<ScreenFeedback screen="reveal" post={post} />)
    fireEvent.click(screen.getByTestId('screen-feedback-open'))
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'too cramped' } })
    fireEvent.click(screen.getByTestId('screen-feedback-send'))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post.mock.calls[0][1].body).toEqual({ screen: 'reveal', kind: 'other', text: 'too cramped', context: null })
  })

  it('a failed post says so and keeps the note', async () => {
    const post = vi.fn(async () => { throw new Error('HTTP 500') })
    render(<ScreenFeedback screen="trail" post={post} />)
    fireEvent.click(screen.getByTestId('screen-feedback-open'))
    fireEvent.click(screen.getByRole('button', { name: 'Effects' }))
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'the glow is too much' } })
    fireEvent.click(screen.getByTestId('screen-feedback-send'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that')
    expect(screen.getByLabelText('Your note')).toHaveValue('the glow is too much')
  })

  it('the compact door is an icon button with a name', () => {
    render(<ScreenFeedback screen="question" compact post={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Feedback on this screen' })).toBeInTheDocument()
  })

  it('every kind the store accepts has a chip, and every screen has a name', () => {
    expect(SCREEN_KINDS.map(([k]) => k)).toEqual(
      ['layout', 'visuals', 'effects', 'interaction', 'learning', 'broken', 'great', 'other'])
    for (const s of ['landing', 'trail', 'question', 'reveal', 'end', 'practise', 'lessons', 'review', 'gallery']) {
      expect(screenLabel(s)).not.toBe(s)
    }
  })

  it('drillScreen names the end card, the reveal and the question', () => {
    expect(drillScreen({ finished: true, phase: 'answer' })).toBe('end')
    expect(drillScreen({ finished: false, phase: 'reveal' })).toBe('reveal')
    expect(drillScreen({ finished: false, phase: 'failed' })).toBe('reveal')
    expect(drillScreen({ finished: false, phase: 'answer' })).toBe('question')
    expect(drillScreen({ finished: false, phase: 'checking' })).toBe('question')
  })
})
