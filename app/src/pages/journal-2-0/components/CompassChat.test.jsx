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
    status: { enabled: true, rate_limit_remaining: 200, conversation_message_count: 0,
              onboarded: false, onboarding_mode: false },
    isLoading: false,
    error: null,
    isStreaming: false,
    streamingTokens: '',
    pendingAction: null,
    isOnboarding: false,
    needsOnboarding: false,
    send: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    forget: vi.fn(),
    forgetAll: vi.fn(),
    startOnboarding: vi.fn(),
    skipOnboarding: vi.fn(),
    redoOnboarding: vi.fn(),
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

  it('renders Start Onboarding CTA when needsOnboarding is true', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      status: { enabled: true, rate_limit_remaining: 200, conversation_message_count: 0,
                onboarded: false, onboarding_mode: false },
      isOnboarding: false,
      needsOnboarding: true,
    }))
    render(<CompassChat accountId="acc1" />)
    expect(screen.getByRole('button', { name: /Start onboarding/i })).toBeInTheDocument()
  })

  it('clicking Start Onboarding calls startOnboarding', async () => {
    const startOnboarding = vi.fn()
    useJ2CoachChat.mockReturnValue(_hookReturn({
      status: { enabled: true, rate_limit_remaining: 200, conversation_message_count: 0,
                onboarded: false, onboarding_mode: false },
      needsOnboarding: true,
      startOnboarding,
    }))
    const user = userEvent.setup()
    render(<CompassChat accountId="acc1" />)
    await user.click(screen.getByRole('button', { name: /Start onboarding/i }))
    expect(startOnboarding).toHaveBeenCalled()
  })

  it('renders onboarding progress header when isOnboarding is true', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      isOnboarding: true,
      messages: [
        { id: 'm1', role: 'assistant', content: 'Question 1?' },
      ],
    }))
    render(<CompassChat accountId="acc1" />)
    expect(screen.getByText(/Onboarding interview/i)).toBeInTheDocument()
  })

  it('hides BEGIN_ONBOARDING_INTERVIEW sentinel messages', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      messages: [
        { id: 'm0', role: 'user', content: '[BEGIN_ONBOARDING_INTERVIEW]' },
        { id: 'm1', role: 'assistant', content: 'Welcome!' },
      ],
    }))
    render(<CompassChat accountId="acc1" />)
    expect(screen.queryByText(/BEGIN_ONBOARDING_INTERVIEW/)).not.toBeInTheDocument()
    expect(screen.getByText(/Welcome!/)).toBeInTheDocument()
  })
})
