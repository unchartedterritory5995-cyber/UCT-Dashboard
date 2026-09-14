// app/src/pages/breadth/chartLoadError.test.js
import { describe, it, expect } from 'vitest'
import { describeLoadError, describeRefreshError, shouldRetryLoad } from './chartLoadError'

const withStatus = status => Object.assign(new Error(`answered ${status}`), { status })

describe('describeLoadError', () => {
  it('sends an ended session to sign in', () => {
    expect(describeLoadError(withStatus(401))).toEqual({
      kind: 'signin', title: 'Your session has ended.', body: 'Sign in again to load breadth history.',
      action: { label: 'Sign in', href: '/login' },
    })
  })

  it('names the plan on a 402', () => {
    expect(describeLoadError(withStatus(402))).toEqual({
      kind: 'plan', title: 'Data Charts is part of the UCT plan.', body: 'Choose a plan to chart breadth history.',
      action: { label: 'See plans', href: '/pricing' },
    })
  })

  it('calls any other answer a server error, with a retry', () => {
    for (const s of [500, 502, 503, 404, 403]) {
      expect(describeLoadError(withStatus(s))).toEqual({
        kind: 'server', title: "Breadth history didn't load.", body: 'The server returned an error.',
        action: { label: 'Retry', retry: true },
      })
    }
  })

  // An HTML error page parsed as JSON is the server's fault, not the connection's.
  it('does not blame the connection for a body it could not parse', () => {
    expect(describeLoadError(new SyntaxError('Unexpected token <')).kind).toBe('server')
  })

  it('asks about the connection when no answer arrived', () => {
    expect(describeLoadError(new TypeError('Failed to fetch'))).toEqual({
      kind: 'network', title: "Breadth history didn't load.", body: 'Check your connection, then retry.',
      action: { label: 'Retry', retry: true },
    })
  })
})

describe('describeRefreshError', () => {
  it('keeps the chart and says which data it is for a server or network failure', () => {
    for (const e of [withStatus(500), new TypeError('Failed to fetch')]) {
      expect(describeRefreshError(e)).toMatchObject({
        title: "Couldn't refresh breadth history.", body: 'Showing the last loaded data.',
        action: { label: 'Retry', retry: true },
      })
    }
  })

  it('still sends an ended session or a lapsed plan to its door', () => {
    expect(describeRefreshError(withStatus(401)).action.href).toBe('/login')
    expect(describeRefreshError(withStatus(402)).action.href).toBe('/pricing')
  })
})

describe('shouldRetryLoad', () => {
  it('does not repeat what asking again cannot fix', () => {
    expect(shouldRetryLoad(withStatus(401))).toBe(false)
    expect(shouldRetryLoad(withStatus(402))).toBe(false)
  })
  it('retries a server or network failure', () => {
    expect(shouldRetryLoad(withStatus(503))).toBe(true)
    expect(shouldRetryLoad(new TypeError('Failed to fetch'))).toBe(true)
  })
})
