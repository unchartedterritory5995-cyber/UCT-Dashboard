// 🎯 TRACK F (DEC-006) — the smallest useful parameter UI.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import ParamControls from './ParamControls'

afterEach(cleanup)

function def(paramManifest, ast, paramState) {
  return {
    compute: {
      ast: ast || { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 14 }] },
      paramManifest,
      ...(paramState ? { paramState } : {}),
    },
  }
}

const LENGTH_ENTRY = {
  sourceName: 'length', title: 'Length', type: 'int', default: 14,
  min: 1, max: 200, step: 1, options: null,
  locators: [{ treeIndex: null, astPath: ['args', 1] }],
}

describe('ParamControls', () => {
  it('⛔ renders nothing when there is no manifest', () => {
    const { container } = render(<ParamControls definition={{ compute: {} }} onChange={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('⭐⭐ an attached parameter shows title, current value, default, min, max', () => {
    render(<ParamControls definition={def({ __uct_param_1: LENGTH_ENTRY })} onChange={vi.fn()} />)
    expect(screen.getByText('Length')).toBeTruthy()
    const input = screen.getByTestId('param-input-__uct_param_1')
    expect(input.value).toBe('14')
    expect(screen.getByText('default 14')).toBeTruthy()
    expect(screen.getByText('min 1')).toBeTruthy()
    expect(screen.getByText('max 200')).toBeTruthy()
    // ⛔ AT THE DEFAULT VALUE, NO RESET BUTTON — nothing to reset to.
    expect(screen.queryByTestId('param-reset-__uct_param_1')).toBeNull()
  })

  it('⭐ committing a new value on blur calls onChange with the number', () => {
    const onChange = vi.fn()
    render(<ParamControls definition={def({ __uct_param_1: LENGTH_ENTRY })} onChange={onChange} />)
    const input = screen.getByTestId('param-input-__uct_param_1')
    fireEvent.change(input, { target: { value: '21' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith('__uct_param_1', 21)
  })

  it('⭐ Enter commits the same as blur', () => {
    const onChange = vi.fn()
    render(<ParamControls definition={def({ __uct_param_1: LENGTH_ENTRY })} onChange={onChange} />)
    const input = screen.getByTestId('param-input-__uct_param_1')
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('__uct_param_1', 30)
  })

  it('⛔ a blank commit reverts to the current value rather than calling onChange', () => {
    const onChange = vi.fn()
    render(<ParamControls definition={def({ __uct_param_1: LENGTH_ENTRY })} onChange={onChange} />)
    const input = screen.getByTestId('param-input-__uct_param_1')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('⭐ "Reset to Default" appears once changed, and calls onChange with the default', () => {
    const onChange = vi.fn()
    const d = def({ __uct_param_1: LENGTH_ENTRY }, undefined, {
      __uct_param_1: { state: 'attached', value: 21, reason: null },
    })
    render(<ParamControls definition={d} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('param-reset-__uct_param_1'))
    expect(onChange).toHaveBeenCalledWith('__uct_param_1', 14)
  })

  it('⛔⛔ a detached parameter shows a disabled reason, never an editable input', () => {
    const d = def(
      { __uct_param_1: LENGTH_ENTRY },
      { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }] }, // args[1] gone
    )
    render(<ParamControls definition={d} onChange={vi.fn()} />)
    expect(screen.queryByTestId('param-input-__uct_param_1')).toBeNull()
    expect(screen.getByTestId('param-reason-__uct_param_1')).toBeTruthy()
    expect(screen.queryByTestId('param-reset-__uct_param_1')).toBeNull()
  })

  it('⛔⛔ a conflicted parameter is disclosed by name, never a silently-picked value', () => {
    const d = {
      compute: {
        trees: {
          scan: { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 14 }] },
          plot2: { type: 'call', name: 'rsi', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 21 }] },
        },
        paramManifest: {
          __uct_param_1: {
            ...LENGTH_ENTRY,
            locators: [
              { treeIndex: 'scan', astPath: ['args', 1] },
              { treeIndex: 'plot2', astPath: ['args', 1] },
            ],
          },
        },
      },
    }
    render(<ParamControls definition={d} onChange={vi.fn()} />)
    expect(screen.getByTestId('param-reason-__uct_param_1')).toHaveTextContent(/disagree/)
  })

  it('⭐ a server-provided paramState is preferred over client-side reconciliation', () => {
    // A definition freshly loaded from the server carries its OWN paramState
    // (computed authoritatively by save()); this must be used verbatim, not
    // re-derived, matching ADR V2.2 S3(B).
    const d = def({ __uct_param_1: LENGTH_ENTRY }, undefined, {
      __uct_param_1: { state: 'detached', value: null, reason: 'server says so' },
    })
    render(<ParamControls definition={d} onChange={vi.fn()} />)
    expect(screen.getByTestId('param-reason-__uct_param_1')).toHaveTextContent('server says so')
  })

  it('⭐ numeric options render as a select, not a free-numeric input', () => {
    const entry = { ...LENGTH_ENTRY, options: [7, 14, 21], min: null, max: null }
    render(<ParamControls definition={def({ __uct_param_1: entry })} onChange={vi.fn()} />)
    expect(screen.queryByTestId('param-input-__uct_param_1').tagName).toBe('SELECT')
  })
})
