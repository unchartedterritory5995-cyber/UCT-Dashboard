import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompassChat from './CompassChat'

vi.mock('../hooks/useJ2CoachChat', () => ({
  default: vi.fn(),
}))

import useJ2CoachChat from '../hooks/useJ2CoachChat'

function _hookReturn(overrides = {}) {
  return {
    messages: [],
    status: { enabled: true, rate_limit_remaining: 200, conversation_message_count: 0 },
    isLoading: false,
    error: null,
    isStreaming: false,
    streamingTokens: '',
    pendingAction: null,
    send: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    forget: vi.fn(),
    forgetAll: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  }
}

describe('CompassChat', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders empty state with suggested prompts when no messages', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn())
    render(<CompassChat accountId="acc1" />)
    expect(screen.getByText(/Compass is here/i)).toBeInTheDocument()
    expect(screen.getByText(/How am I doing this week/i)).toBeInTheDocument()
  })

  it('clicking a suggested prompt populates and submits', async () => {
    const send = vi.fn()
    useJ2CoachChat.mockReturnValue(_hookReturn({ send }))
    const user = userEvent.setup()
    render(<CompassChat accountId="acc1" />)
    await user.click(screen.getByRole('button', { name: /How am I doing this week/i }))
    expect(send).toHaveBeenCalledWith('How am I doing this week?')
  })

  it('typing + Send calls send', async () => {
    const send = vi.fn()
    useJ2CoachChat.mockReturnValue(_hookReturn({ send }))
    const user = userEvent.setup()
    render(<CompassChat accountId="acc1" />)
    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'Hi Compass')
    await user.click(screen.getByRole('button', { name: /^Send$/ }))
    expect(send).toHaveBeenCalledWith('Hi Compass')
  })

  it('renders pending-action card when pendingAction is set', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      pendingAction: {
        message_id: 'm1', tool_call_id: 'tc1', name: 'mute_setup',
        args: { setup_name: 'Pullback' },
        preview: { narration: 'Mute Pullback', contextual_warnings: [],
                   confirm_label: 'Mute setup', elevated: false },
      },
    }))
    render(<CompassChat accountId="acc1" />)
    expect(screen.getByText(/Compass wants to/i)).toBeInTheDocument()
    expect(screen.getByText(/Mute Pullback/i)).toBeInTheDocument()
  })

  it('hides panel when status.enabled is false', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      status: { enabled: false, rate_limit_remaining: 200, conversation_message_count: 0 },
    }))
    const { container } = render(<CompassChat accountId="acc1" />)
    expect(container.firstChild).toBeNull()
  })

  it('disables composer when rate-limit remaining is 0', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      status: { enabled: true, rate_limit_remaining: 0, conversation_message_count: 200 },
    }))
    render(<CompassChat accountId="acc1" />)
    expect(screen.getByText(/Daily limit reached/i)).toBeInTheDocument()
    const sendBtn = screen.getByRole('button', { name: /^Send$/ })
    expect(sendBtn).toBeDisabled()
  })
})
