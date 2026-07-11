import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TagSuggestions from './TagSuggestions'

// Feature flag controlled per-test via a mutable let (mirrors AdherenceChecklist.test.jsx).
let flagOn = true
vi.mock('../../featureFlags', () => ({
  useFeatureFlag: () => flagOn,
}))

const SUGGESTIONS = {
  mistakes: ['no_stop', 'revenge'],
  emotions: ['revenge-driven'],
  reasons: {
    no_stop: 'No stop was logged on this trade.',
    revenge: 'Re-entered NVDA shortly after a loss on it.',
    'revenge-driven': 'Re-entered NVDA shortly after a loss on it.',
  },
}

beforeEach(() => {
  flagOn = true
})

describe('TagSuggestions', () => {
  it('renders nothing when the tagSuggest flag is OFF', () => {
    flagOn = false
    const { container } = render(
      <TagSuggestions suggestions={SUGGESTIONS} currentMistakes={[]} currentEmotions={[]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there are no suggestions', () => {
    const { container } = render(
      <TagSuggestions
        suggestions={{ mistakes: [], emotions: [], reasons: {} }}
        currentMistakes={[]}
        currentEmotions={[]}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a chip per suggested tag with the reason as a tooltip', () => {
    render(
      <TagSuggestions suggestions={SUGGESTIONS} currentMistakes={[]} currentEmotions={[]} />,
    )
    expect(screen.getByRole('button', { name: /no_stop/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^revenge$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revenge-driven/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /no_stop/ })).toHaveAttribute(
      'title', 'No stop was logged on this trade.',
    )
  })

  it('clicking a mistake chip calls onAcceptMistake with that tag; an emotion chip calls onAcceptEmotion', () => {
    const onAcceptMistake = vi.fn()
    const onAcceptEmotion = vi.fn()
    render(
      <TagSuggestions
        suggestions={SUGGESTIONS}
        currentMistakes={[]}
        currentEmotions={[]}
        onAcceptMistake={onAcceptMistake}
        onAcceptEmotion={onAcceptEmotion}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /no_stop/ }))
    expect(onAcceptMistake).toHaveBeenCalledWith('no_stop')

    fireEvent.click(screen.getByRole('button', { name: /revenge-driven/ }))
    expect(onAcceptEmotion).toHaveBeenCalledWith('revenge-driven')
  })

  it('does not render an already-applied tag', () => {
    render(
      <TagSuggestions
        suggestions={SUGGESTIONS}
        currentMistakes={['no_stop']}
        currentEmotions={['revenge-driven']}
      />,
    )
    expect(screen.queryByRole('button', { name: /no_stop/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /revenge-driven/ })).not.toBeInTheDocument()
    // The still-unapplied mistake remains.
    expect(screen.getByRole('button', { name: /^revenge$/ })).toBeInTheDocument()
  })

  it('the dismiss button hides the whole row', () => {
    const { container } = render(
      <TagSuggestions suggestions={SUGGESTIONS} currentMistakes={[]} currentEmotions={[]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss suggestions' }))
    expect(container).toBeEmptyDOMElement()
  })
})
