// Joystick hub — THE SEAM RAIL. Renders each component with the props `contracts.js` declares
// and asserts the declared behaviour. See docs/plans/joystick/40-phase2-gate.md (retro).
//
// ⛔ THIS IS THE TEST THAT WAS MISSING IN PHASE 2. Every prop across the engine/components/
// integrator seam was mismatched — fan got `layout` not `actions`, knob got `target` not
// `targetColor`+`offset`, chip got `mode`/`hidden` not `label`/`tapHint`/`open`, scrim got
// `onDismiss` not `onPointerDown` — and the hub was non-functional while EVERY suite stayed green,
// because each half tested its own contract and nothing tested the join.
//
// So this file deliberately does NOT test a component's internals. It tests that the names in
// `contracts.js` are the names the components actually answer to, and that passing them produces
// the documented, observable result. A rename on either side turns this red.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { COMPONENT_PROPS, JOYSTICK_STATE_KEYS, cssVar } from './contracts'
import { modesById } from './registry'
import HubPad from './HubPad'
import HubKnob from './HubKnob'
import HubFan from './HubFan'
import HubChip from './HubChip'
import HubScrim from './HubScrim'
import HubActionsButton from './HubActionsButton'

const scan = modesById.scan
const outer = scan.fan.filter((a) => a.ring === 0)

let executed = 0
const ran = () => { executed += 1 }

describe('cssVar — the colour contract', () => {
  it('wraps a token NAME, and never double-wraps', () => {
    ran()
    expect(cssVar('--hub-mode-scan')).toBe('var(--hub-mode-scan)')
    expect(cssVar(null)).toBeUndefined()
    // The registry must store bare token names. A pre-wrapped value would become
    // `var(var(--x))`, which resolves to nothing — silently, with no error.
    for (const action of scan.fan) {
      expect(action.color.startsWith('--'), `${action.id} colour is pre-wrapped`).toBe(true)
    }
  })
})

describe('HubPad — the contract', () => {
  it('answers to the declared prop names and forwards its ref to the touched element', () => {
    ran()
    const onPointerDown = vi.fn()
    const ref = { current: null }
    render(<HubPad ref={ref} mirrored={false} onPointerDown={onPointerDown} />)

    const pad = screen.getByTestId('hub-pad')
    // The ref must land on the pad itself — useJoystick reads its centre for every angle.
    expect(ref.current).toBe(pad)
    fireEvent.pointerDown(pad)
    expect(onPointerDown).toHaveBeenCalled()
    expect(COMPONENT_PROPS.HubPad).toContain('onPointerDown')
  })
})

describe('HubKnob — the contract', () => {
  it('announces the mode LABEL, and takes a token NAME for colour', () => {
    ran()
    render(<HubKnob mode="Scan" modeColor="--hub-mode-scan" offset={{ x: 3, y: -4 }} />)
    // The label is announced, so it must be the human name, never the id.
    expect(screen.getByRole('button', { name: /scan/i })).toBeTruthy()
  })

  it('moves with `offset` — the prop that was missing when the knob never moved', () => {
    ran()
    const { container } = render(<HubKnob mode="Scan" modeColor="--hub-mode-scan" offset={{ x: 7, y: -9 }} />)
    expect(container.innerHTML).toContain('translate(7px, -9px)')
  })

  it('`targetColor` overrides `modeColor` — the prop that was missing when the dot never recoloured', () => {
    ran()
    const { container } = render(
      <HubKnob mode="Scan" modeColor="--hub-mode-scan" targetColor="--hub-mode-journal" />,
    )
    expect(container.innerHTML).toContain('var(--hub-mode-journal)')
  })
})

describe('HubFan — the contract', () => {
  it('takes `actions` and renders one bubble each — NOT a precomputed `layout`', () => {
    ran()
    render(<HubFan actions={scan.fan} open />)
    for (const action of scan.fan) {
      expect(screen.getByText(action.label), `no bubble for ${action.id}`).toBeTruthy()
    }
  })

  it('renders NOTHING recognisable when handed a `layout` prop instead — the Phase 2 defect', () => {
    ran()
    // The exact mistake: HubRoot passed `layout=`. With no `actions`, the fan has nothing to draw.
    render(<HubFan layout={[{ action: outer[0] }]} open />)
    expect(screen.queryByText(outer[0].label)).toBeNull()
  })

  it('marks a disabled action `aria-disabled`, never the native `disabled` attribute', () => {
    ran()
    const { container } = render(<HubFan actions={scan.fan} open disabledIds={[outer[0].id]} />)
    expect(container.querySelector('[aria-disabled="true"]')).toBeTruthy()
    // A native `disabled` control can be skipped by VoiceOver's touch sweep, which would hide the
    // very action whose reason we want announced.
    expect(container.querySelector('[disabled]')).toBeNull()
  })
})

describe('HubChip — the contract', () => {
  it('takes `label` + `tapHint`, and `open` HIDES it', () => {
    ran()
    const { rerender } = render(<HubChip label="Scan" tapHint="tap: next result" open={false} />)
    expect(screen.getByText('Scan')).toBeTruthy()
    expect(screen.getByText('tap: next result')).toBeTruthy()

    // `open` means "the fan is showing", so the chip gets out of the way.
    rerender(<HubChip label="Scan" tapHint="tap: next result" open />)
    expect(screen.queryByText('tap: next result')).toBeNull()
  })

  it('falls back to the literal "Scrub" when scrubbing with no readout supplied', () => {
    ran()
    render(<HubChip label="Scan" tapHint="tap: next result" scrubbing scrubReadout={null} />)
    expect(screen.getByText(/scrub/i)).toBeTruthy()
  })
})

describe('HubScrim — the contract', () => {
  it('dismisses via `onPointerDown`, not `onDismiss` — the Phase 2 defect', () => {
    ran()
    const onPointerDown = vi.fn()
    render(<HubScrim open onPointerDown={onPointerDown} />)
    fireEvent.pointerDown(screen.getByTestId('hub-scrim'))
    expect(onPointerDown).toHaveBeenCalled()
    expect(COMPONENT_PROPS.HubScrim).toContain('onPointerDown')
    expect(COMPONENT_PROPS.HubScrim).not.toContain('onDismiss')
  })

  it('honours `excludeBottom` so the chart\'s volume band stays visible', () => {
    ran()
    render(<HubScrim open excludeBottom="calc(22% + 32px)" />)
    expect(screen.getByTestId('hub-scrim').style.bottom).toContain('22%')
  })
})

describe('HubActionsButton — the contract', () => {
  it('is present at rest, ≥44px, and opens a sheet listing every action', () => {
    ran()
    render(<HubActionsButton mode="Scan" actions={scan.fan} onAction={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /actions/i })
    expect(parseInt(btn.style.minHeight, 10)).toBeGreaterThanOrEqual(44)
    expect(parseInt(btn.style.minWidth, 10)).toBeGreaterThanOrEqual(44)

    fireEvent.click(btn)
    for (const action of scan.fan) {
      expect(screen.getAllByText(action.label).length, `sheet missing ${action.id}`).toBeGreaterThan(0)
    }
  })

  it('fires `onAction` with the ACTION, and `onFeedback` for the Feedback entry', () => {
    ran()
    const onAction = vi.fn()
    const onFeedback = vi.fn()
    render(<HubActionsButton mode="Scan" actions={scan.fan} onAction={onAction} onFeedback={onFeedback} />)
    fireEvent.click(screen.getByRole('button', { name: /actions/i }))

    fireEvent.click(screen.getAllByText(outer[0].label)[0])
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: outer[0].id }))

    // Picking an action CLOSES the sheet, so it has to be reopened to reach Feedback. (This
    // tripped the first draft of this test — worth keeping as a note rather than a silent fix.)
    fireEvent.click(screen.getByRole('button', { name: /actions/i }))
    fireEvent.click(screen.getByRole('button', { name: /feedback/i }))
    // ⛔ Not optional: with the hub active, Layout stops mounting FeedbackWidget, so an unwired
    // Feedback entry would DELETE the only feedback path a mobile member has.
    expect(onFeedback).toHaveBeenCalled()
  })
})

describe('the engine\'s public state surface', () => {
  it('is exactly what contracts.js declares — no more, no less', async () => {
    ran()
    const { default: useJoystick } = await import('./useJoystick')
    const { renderHook } = await import('@testing-library/react')
    const { result } = renderHook(() => useJoystick({ mode: scan, settings: {}, padRef: { current: null } }))
    expect(Object.keys(result.current.state).sort()).toEqual([...JOYSTICK_STATE_KEYS].sort())
    expect(typeof result.current.dismiss).toBe('function')
  })
})

describe('rail integrity', () => {
  it('actually executed its cases — a vitest -t regex matching nothing exits 0 and reads as a PASS', () => {
    expect(executed).toBeGreaterThanOrEqual(13)
  })
})
