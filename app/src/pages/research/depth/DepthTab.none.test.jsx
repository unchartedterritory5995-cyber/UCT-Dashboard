// Completeness audit 2026-10-07, ERROR/RETRY gap 6 (DPTH): with no depth panel switched on, the
// panel opened as an empty box. It now says, in plain words, that nothing is switched on.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DepthTab from './DepthTab'

describe('DepthTab with no panel switched on', () => {
  it.each([['no flags at all', undefined], ['every flag off', { events_timeline_enabled: false, call_replay_enabled: false }]])(
    '%s: a plain explanation, not a blank box', (_name, flags) => {
      render(<DepthTab sym="nvda" flags={flags} />)
      const state = screen.getByTestId('depth-none-on')
      expect(state).toHaveAttribute('data-kind', 'locked')
      expect(state).toHaveTextContent('No depth panel is switched on yet.')
      expect(state).toHaveTextContent('nothing to show for NVDA')
      expect(state).toHaveTextContent('not a failed read')
    })
})
