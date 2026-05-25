import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import useMediaQuery from './useMediaQuery'

let mqListeners = []
let mqMatches = false

beforeEach(() => {
  mqListeners = []
  mqMatches = false
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(query => ({
    matches: mqMatches,
    media: query,
    addEventListener: (_event, fn) => { mqListeners.push(fn) },
    removeEventListener: (_event, fn) => { mqListeners = mqListeners.filter(f => f !== fn) },
  })))
})

function Probe({ query }) {
  const matches = useMediaQuery(query)
  return <span data-testid="matches">{String(matches)}</span>
}

test('returns initial match state from matchMedia', () => {
  mqMatches = true
  render(<Probe query="(max-width: 640px)" />)
  expect(screen.getByTestId('matches').textContent).toBe('true')
})

test('returns false when matchMedia returns false', () => {
  mqMatches = false
  render(<Probe query="(max-width: 640px)" />)
  expect(screen.getByTestId('matches').textContent).toBe('false')
})

test('updates when matchMedia change event fires', () => {
  mqMatches = false
  render(<Probe query="(max-width: 640px)" />)
  expect(screen.getByTestId('matches').textContent).toBe('false')
  act(() => {
    mqListeners.forEach(fn => fn({ matches: true }))
  })
  expect(screen.getByTestId('matches').textContent).toBe('true')
})
