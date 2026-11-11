// How it plays: open by itself the first time a member meets a game, closed (one tap away) after "Got it".
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import HowItPlays from './HowItPlays'

const steps = [{ icon: 'chart', title: 'Read it', body: 'a' }, { icon: 'check', title: 'Answer it', body: 'b' }, { icon: 'bolt', title: 'Climb', body: 'c' }]

describe('HowItPlays', () => {
  afterEach(() => localStorage.clear())

  it('opens the first time, and stays closed after Got it', () => {
    const { unmount } = render(<HowItPlays mode="t" steps={steps} />)
    expect(screen.getByText('Answer it')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByText('Answer it')).not.toBeInTheDocument()
    unmount()
    render(<HowItPlays mode="t" steps={steps} />)
    expect(screen.queryByText('Answer it')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /How it plays/ }))
    expect(screen.getByText('Answer it')).toBeInTheDocument()
  })
})
