// Joystick hub — behaviour/semantics tests for the Phase 2 presentational components.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (components) and §C2 (accessibility).

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import HubPad from './HubPad'
import HubKnob from './HubKnob'
import HubFan from './HubFan'
import HubChip from './HubChip'
import HubScrim from './HubScrim'
import HubActionsButton from './HubActionsButton'
import { modesById } from './registry'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const scanMode = modesById.scan
const journalMode = modesById.journal

// ── non-vacuity control (house idiom, see HubRoot.test.jsx) ────────────────
// `vitest -t` is a regex; a filter matching nothing exits 0 and reads as a
// PASS. `ran()` is called at the top of every `it()` below and the final
// assertion in "rail integrity" fails loudly if fewer cases executed than
// this file is supposed to contain.
let executed = 0
const ran = () => {
  executed += 1
}

describe('HubKnob — accessible name carries the mode (§C2)', () => {
  it('names the button after the current mode', () => {
    ran()
    render(<HubKnob mode={scanMode.label} modeColor={scanMode.color} />)
    expect(screen.getByRole('button', { name: /scan/i })).toBeInTheDocument()
  })

  it('renames itself when the mode changes', () => {
    ran()
    const { rerender } = render(<HubKnob mode={scanMode.label} modeColor={scanMode.color} />)
    expect(screen.getByRole('button', { name: /scan/i })).toBeInTheDocument()
    rerender(<HubKnob mode={journalMode.label} modeColor={journalMode.color} />)
    expect(screen.getByRole('button', { name: /journal/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^scan mode$/i })).not.toBeInTheDocument()
  })

  it('never names the button for the target action — only the mode', () => {
    ran()
    render(<HubKnob mode={scanMode.label} modeColor={scanMode.color} targetColor="--hub-mode-chart" />)
    // targetColor recolours the dot (a style, asserted in the report as
    // visual), it must never leak into the accessible NAME.
    expect(screen.getByRole('button', { name: /scan/i })).toBeInTheDocument()
  })
})

describe('HubActionsButton — the WCAG 2.5.1 door (§5, §C2)', () => {
  it('is present at rest, not only while a fan is open, and is >=44px by its own declared style', () => {
    ran()
    render(<HubActionsButton mode={scanMode.label} actions={scanMode.fan} />)
    const btn = screen.getByRole('button', { name: `${scanMode.label} actions` })
    expect(btn).toBeInTheDocument()
    expect(parseFloat(btn.style.minWidth)).toBeGreaterThanOrEqual(44)
    expect(parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44)
  })

  it('opens a sheet listing every action of the current mode, plus Feedback', () => {
    ran()
    render(<HubActionsButton mode={scanMode.label} actions={scanMode.fan} />)
    fireEvent.click(screen.getByRole('button', { name: `${scanMode.label} actions` }))

    const list = screen.getByRole('list')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(scanMode.fan.length + 1)

    for (const action of scanMode.fan) {
      expect(within(list).getByText(action.label)).toBeInTheDocument()
    }
    expect(within(list).getByText('Feedback')).toBeInTheDocument()
  })

  it('forces role="list"/"listitem" even though the list has no bullets (iOS VoiceOver gotcha, §C2)', () => {
    ran()
    render(<HubActionsButton mode={scanMode.label} actions={scanMode.fan} />)
    fireEvent.click(screen.getByRole('button', { name: `${scanMode.label} actions` }))
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0)
  })

  it('renders a disabled action with aria-disabled and NEVER the native disabled attribute', () => {
    ran()
    const disabledAction = scanMode.fan[0]
    render(<HubActionsButton mode={scanMode.label} actions={scanMode.fan} disabledIds={[disabledAction.id]} />)
    fireEvent.click(screen.getByRole('button', { name: `${scanMode.label} actions` }))

    const disabledBtn = screen.getByText(disabledAction.label).closest('button')
    expect(disabledBtn).toHaveAttribute('aria-disabled', 'true')
    expect(disabledBtn).not.toHaveAttribute('disabled')
    expect(disabledBtn.disabled).toBe(false)
  })

  it('an enabled action calls onAction; a disabled one never does', () => {
    ran()
    const disabledAction = scanMode.fan[0]
    const enabledAction = scanMode.fan[1]
    const onAction = vi.fn()
    render(
      <HubActionsButton
        mode={scanMode.label}
        actions={scanMode.fan}
        disabledIds={[disabledAction.id]}
        onAction={onAction}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: `${scanMode.label} actions` }))

    fireEvent.click(screen.getByText(disabledAction.label).closest('button'))
    expect(onAction).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(enabledAction.label).closest('button'))
    expect(onAction).toHaveBeenCalledWith(enabledAction)
  })

  it('calls onFeedback for the Feedback entry', () => {
    ran()
    const onFeedback = vi.fn()
    render(<HubActionsButton mode={scanMode.label} actions={scanMode.fan} onFeedback={onFeedback} />)
    fireEvent.click(screen.getByRole('button', { name: `${scanMode.label} actions` }))
    fireEvent.click(screen.getByText('Feedback').closest('button'))
    expect(onFeedback).toHaveBeenCalledTimes(1)
  })
})

describe('HubChip — tap hint + hides while open (§5)', () => {
  it('is a role="status" live region showing the mode label and tap hint', () => {
    ran()
    render(<HubChip label={scanMode.label} tapHint={scanMode.tapHint} modeColor={scanMode.color} />)
    const status = screen.getByRole('status')
    expect(within(status).getByText(scanMode.label)).toBeInTheDocument()
    expect(within(status).getByText(scanMode.tapHint)).toBeInTheDocument()
  })

  it('hides entirely while the fan is open', () => {
    ran()
    render(<HubChip label={scanMode.label} tapHint={scanMode.tapHint} modeColor={scanMode.color} open />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the literal "Scrub" fallback, then the supplied readout, while scrubbing', () => {
    ran()
    const { rerender } = render(
      <HubChip label={scanMode.label} tapHint={scanMode.tapHint} modeColor={scanMode.color} scrubbing />,
    )
    expect(screen.getByText('Scrub')).toBeInTheDocument()
    expect(screen.queryByText(scanMode.tapHint)).not.toBeInTheDocument()

    rerender(
      <HubChip
        label={scanMode.label}
        tapHint={scanMode.tapHint}
        modeColor={scanMode.color}
        scrubbing
        scrubReadout="3/41"
      />,
    )
    expect(screen.getByText('3/41')).toBeInTheDocument()
    expect(screen.queryByText('Scrub')).not.toBeInTheDocument()
  })
})

describe('HubFan — one bubble per action, right icon, disabled state (§5, §C2)', () => {
  it('renders exactly one bubble per action, each with its own registry icon and label', () => {
    ran()
    render(<HubFan actions={scanMode.fan} open />)
    const bubbles = screen.getAllByTestId(/^hub-bubble-/)
    expect(bubbles).toHaveLength(scanMode.fan.length)

    for (const action of scanMode.fan) {
      const bubble = screen.getByTestId(`hub-bubble-${action.id}`)
      expect(bubble.dataset.icon).toBe(action.icon)
      expect(within(bubble).getByText(action.label)).toBeInTheDocument()
      expect(bubble.querySelector('svg')).not.toBeNull()
    }
  })

  it('marks the disabled bubble, and only the disabled one', () => {
    ran()
    const disabledAction = scanMode.fan[0]
    render(<HubFan actions={scanMode.fan} open disabledIds={[disabledAction.id]} />)
    const disabledBubble = screen.getByTestId(`hub-bubble-${disabledAction.id}`)
    const otherAction = scanMode.fan.find((a) => a.id !== disabledAction.id)
    const otherBubble = screen.getByTestId(`hub-bubble-${otherAction.id}`)
    expect(disabledBubble.className).toMatch(/bubbleDisabled/)
    expect(otherBubble.className).not.toMatch(/bubbleDisabled/)
  })

  it('is entirely aria-hidden — selection is by angle, never by hit-testing a bubble', () => {
    ran()
    const { container } = render(<HubFan actions={scanMode.fan} open />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('HubScrim — full-page dim while the fan is open (§5)', () => {
  it('renders nothing when closed', () => {
    ran()
    render(<HubScrim open={false} />)
    expect(screen.queryByTestId('hub-scrim')).not.toBeInTheDocument()
  })

  it('renders when open, and excludeBottom keeps it off that much of the bottom of the viewport', () => {
    ran()
    render(<HubScrim open excludeBottom="calc(22% + 32px)" />)
    const scrim = screen.getByTestId('hub-scrim')
    expect(scrim).toBeInTheDocument()
    expect(scrim.style.bottom).toBe('calc(22% + 32px)')
  })
})

describe('HubPad — spreads the engine\'s pointer handlers, ring is decorative (§5, §C2)', () => {
  it('spreads onPointerDown/Move/Up/Cancel onto the pad itself', () => {
    ran()
    const handlers = {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
    }
    render(<HubPad {...handlers} />)
    const pad = screen.getByTestId('hub-pad')
    fireEvent.pointerDown(pad)
    fireEvent.pointerMove(pad)
    fireEvent.pointerUp(pad)
    fireEvent.pointerCancel(pad)
    expect(handlers.onPointerDown).toHaveBeenCalledTimes(1)
    expect(handlers.onPointerMove).toHaveBeenCalledTimes(1)
    expect(handlers.onPointerUp).toHaveBeenCalledTimes(1)
    expect(handlers.onPointerCancel).toHaveBeenCalledTimes(1)
  })

  it('hides the decorative compass ring from assistive tech', () => {
    ran()
    render(<HubPad />)
    const ring = screen.getByTestId('hub-pad').querySelector('[aria-hidden="true"]')
    expect(ring).not.toBeNull()
  })

  it('mirrors to the left edge in left-handed mode', () => {
    ran()
    render(<HubPad mirrored />)
    const pad = screen.getByTestId('hub-pad')
    expect(pad.style.left).toBeTruthy()
    expect(pad.style.right).toBe('')
  })
})

describe('no literal hex colour in any hub component source (tokens only — §2a non-negotiable)', () => {
  // A hex code is the one thing the whole token block exists to make
  // unnecessary. Scanned as text, not as computed style, because jsdom never
  // resolves an external stylesheet.
  const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/

  const files = [
    'HubPad.jsx',
    'HubKnob.jsx',
    'HubFan.jsx',
    'HubChip.jsx',
    'HubScrim.jsx',
    'HubActionsButton.jsx',
    'hub.module.css',
  ]

  for (const file of files) {
    it(`${file} contains no literal hex colour`, () => {
      ran()
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      const match = src.match(HEX_PATTERN)
      expect(match).toBeNull()
    })
  }
})

describe('rail integrity', () => {
  it('actually executed its cases — a vitest -t regex matching nothing exits 0 and reads as a PASS', () => {
    expect(executed).toBeGreaterThanOrEqual(27)
  })
})
