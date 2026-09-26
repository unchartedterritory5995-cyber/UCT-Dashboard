// app/src/pages/journal-2-0/a11y/settingsCards.a11y.test.jsx
//
// A1: the three Notebook cards on the Settings page — Personal API, Email to
// Notebook and Browser Capture — each in its populated state (tokens listed, an
// address shown with its rotate confirmation open, two connections listed) and
// the Personal API card with a freshly made token on screen.
import { describe, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers } from './fixtures'
import { axeSurface } from './surface'
import PersonalApiCard from '../components/PersonalApiCard'
import InboundEmailCard from '../components/InboundEmailCard'
import BrowserCaptureCard from '../components/BrowserCaptureCard'

const T = '2026-09-19T15:00:00Z'

describe('Notebook settings cards', () => {
  beforeEach(() => {
    installFetch([
      [/^\/api\/j2\/personal\/tokens$/, (url) => (url && url.includes('tokens') ? {
        tokens: [
          { id: 't1', label: 'iPhone Shortcuts', createdAt: T, lastUsedAt: T, expiresAt: '2027-09-19T15:00:00Z', expired: false },
          { id: 't2', label: 'Old laptop', createdAt: T, lastUsedAt: null, expiresAt: T, expired: true },
        ],
        token: 'uct_pat_example_token_value', id: 't3', label: 'New',
      } : {})],
      [/^\/api\/j2\/inbound-email\/address$/, { address: 'notes-7f3a@in.uctintelligence.com', unpaid: false }],
      [/^\/api\/j2\/capture\/connections$/, { connections: [
        { id: 'c1', label: 'Chrome on MacBook', createdAt: T, lastUsedAt: T, expiresAt: '2026-10-19T15:00:00Z', expired: false },
        { id: 'c2', label: 'Chrome on desktop', createdAt: T, lastUsedAt: null, expiresAt: T, expired: true },
      ] }],
    ])
    latchWave8Flags(true)
  })

  axeSurface('settings-personal-api', async () => {
    render(<Providers><PersonalApiCard /></Providers>)
    await screen.findByText('iPhone Shortcuts')
    screen.getByRole('textbox', { name: 'Token name' })
  })

  axeSurface('settings-personal-api-made', async () => {
    render(<Providers><PersonalApiCard /></Providers>)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Token name' }), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make a token' }))
    await screen.findByTestId('personal-api-new-token')
  })

  axeSurface('settings-inbound-email', async () => {
    render(<Providers><InboundEmailCard /></Providers>)
    await screen.findByDisplayValue('notes-7f3a@in.uctintelligence.com')
    fireEvent.click(screen.getByRole('button', { name: 'Make a new address…' }))
    await screen.findByRole('group', { name: 'Make a new address' })
  })

  axeSurface('settings-browser-capture', async () => {
    render(<Providers><BrowserCaptureCard /></Providers>)
    await screen.findByText('Chrome on MacBook')
  })
})
