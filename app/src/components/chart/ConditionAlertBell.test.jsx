import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartSettingsConditions from './ChartSettingsConditions'
import { bellState } from './engine/conditionBell'
import { conditionsOf, addCondition } from './engine/conditionControls'

const DEF_ID = 'u_275dadc9fafe'

// ── a chart with one of each kind of condition ───────────────────────────────
const build = () => {
  let cs = { conditions: [], header: { fields: [], infoFormulas: [] } }
  cs = addCondition(cs, { name: 'Self contained', formula: 'rsi(close, 14) > 50' })
  cs = addCondition(cs, { name: 'Follows RSI', formula: 'a > 50', bindings: { a: '@legacy:rsi::rsi' } })
  const ids = conditionsOf(cs).map((c) => c.id)
  // …plus a durable one, which only the normaliser can express
  cs = { ...cs, conditions: [...cs.conditions, { id: 'cond:durable', name: 'Durable', definitionId: DEF_ID, enabled: true, actions: [] }] }
  return { cs, ids: { plain: ids[0], bound: ids[1], durable: 'cond:durable' } }
}

const registry = (over = {}) => ({
  getDefinition: (id) => (id === DEF_ID
    ? { id: DEF_ID, compute: { kind: 'ast', source: 'rsi(close, 14) > 50' } }
    : null),
  ...over,
})

const ARMED = [{ id: 1, sym: 'TSLA', indicator: `${DEF_ID}.value`, condition: 'cross_above', threshold: 0.5 }]

const mount = (props = {}) => {
  const { cs } = props.chart || build()
  return render(
    <ChartSettingsConditions
      settings={cs}
      onChange={() => {}}
      registry={registry()}
      sym="TSLA"
      onArmAlert={props.onArm === undefined ? vi.fn() : props.onArm}
      onPromoteCondition={props.onPromote === undefined ? vi.fn() : props.onPromote}
      {...props}
    />,
  )
}

const bell = (name) => screen.getByRole('button', { name: new RegExp(name) })

describe('the bell — one control, four answers', () => {
  it('⭐⭐ each condition’s bell reports its OWN capability', () => {
    mount()
    expect(bell('Alert me — Self contained').dataset.capability).toBe('promotable')
    expect(bell('Alert me — Follows RSI').dataset.capability).toBe('local_only')
    expect(bell('Alert me — Durable').dataset.capability).toBe('durable')
  })

  it('⛔ a DURABLE condition whose definition is gone is disabled, with the sentence', () => {
    const { cs } = build()
    render(
      <ChartSettingsConditions
        settings={cs} onChange={() => {}} sym="TSLA"
        registry={{ getDefinition: () => null }}
        onArmAlert={vi.fn()} onPromoteCondition={vi.fn()}
      />,
    )
    const b = bell('Alert me — Durable')
    expect(b.dataset.capability).toBe('source_unavailable')
    expect(b).toBeDisabled()
    expect(b.title).toMatch(/no longer available/)
  })

  it('⭐ a PROMOTABLE bell says what the extra step IS, before it happens', () => {
    mount()
    expect(bell('Alert me — Self contained').title)
      .toMatch(/run when the chart is closed/)
  })

  it('⛔ a LOCAL_ONLY bell is not greyed out — it has something to say', () => {
    mount()
    const b = bell('Alert me — Follows RSI')
    expect(b).not.toBeDisabled()
    expect(b.title).toMatch(/follows an indicator on this chart/)
  })
})

describe('what a click does', () => {
  it('⭐ DURABLE → the host is asked to arm, with the definition and the policy', () => {
    const onArm = vi.fn()
    mount({ onArm })
    fireEvent.click(bell('Alert me — Durable'))
    expect(onArm).toHaveBeenCalledTimes(1)
    const call = onArm.mock.calls[0][0]
    expect(call.cond.id).toBe('cond:durable')
    expect(call.definition.id).toBe(DEF_ID)
    expect(call.policyId).toBe('becomes_true')
  })

  it('⭐ PROMOTABLE → the host is asked to PROMOTE, not to arm', () => {
    const onArm = vi.fn(); const onPromote = vi.fn()
    mount({ onArm, onPromote })
    fireEvent.click(bell('Alert me — Self contained'))
    expect(onPromote).toHaveBeenCalledTimes(1)
    expect(onPromote.mock.calls[0][0].cond.name).toBe('Self contained')
    expect(onArm).not.toHaveBeenCalled()
  })

  it('⛔⛔ LOCAL_ONLY → NOTHING is created. It explains.', () => {
    const onArm = vi.fn(); const onPromote = vi.fn()
    mount({ onArm, onPromote })
    fireEvent.click(bell('Alert me — Follows RSI'))
    expect(onArm).not.toHaveBeenCalled()
    expect(onPromote).not.toHaveBeenCalled()
    expect(screen.getByRole('note')).toHaveTextContent(/follows an indicator on this chart/)
  })

  it('⭐ …and the explanation NAMES what it follows', () => {
    mount()
    fireEvent.click(bell('Alert me — Follows RSI'))
    expect(screen.getByRole('note')).toHaveTextContent(/Follows: legacy:rsi/)
  })

  it('⭐ the handoff opens the Builder on the member’s OWN text, unrewritten', () => {
    const onBuild = vi.fn()
    mount({ onBuild })
    fireEvent.click(bell('Alert me — Follows RSI'))
    fireEvent.click(screen.getByRole('button', { name: /Create an alertable version/ }))
    expect(onBuild).toHaveBeenCalledWith({
      consumerKind: 'condition',
      prefill: 'a > 50',            // ⛔ NOT `rsi(close, 14) > 50` — that is a different sentence
      boundTo: ['legacy:rsi'],
      fromConditionId: expect.any(String),
    })
  })

  it('⛔ the note closes again — it is a disclosure, not a permanent error', () => {
    mount()
    fireEvent.click(bell('Alert me — Follows RSI'))
    expect(screen.queryByRole('note')).not.toBeNull()
    fireEvent.click(bell('Alert me — Follows RSI'))
    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('already armed', () => {
  it('⭐ a condition with an alert reads as ON', () => {
    mount({ alerts: ARMED })
    const b = screen.getByRole('button', { name: /Alerts on for Durable/ })
    expect(b.dataset.armed).toBe('yes')
    expect(b.getAttribute('aria-pressed')).toBe('true')
    expect(b.title).toMatch(/Alerting when this becomes true/)
  })

  it('⛔ an alert on ANOTHER symbol does not light this chart’s bell', () => {
    mount({ alerts: [{ ...ARMED[0], sym: 'AAPL' }] })
    expect(bell('Alert me — Durable').dataset.armed).toBe('no')
  })
})

describe('the door', () => {
  it('⛔⛔ ABSENT HOST ⇒ ABSENT BELL — not a control that does nothing', () => {
    const { cs } = build()
    render(<ChartSettingsConditions settings={cs} onChange={() => {}} registry={registry()} />)
    expect(screen.queryByRole('button', { name: /Alert me/ })).toBeNull()
  })

  it('⛔ a busy row cannot be clicked twice', () => {
    const onPromote = vi.fn()
    const { cs, ids } = build()
    render(
      <ChartSettingsConditions
        settings={cs} onChange={() => {}} registry={registry()} sym="TSLA"
        onPromoteCondition={onPromote} promotingId={ids.plain}
      />,
    )
    const b = bell('Alert me — Self contained')
    expect(b).toBeDisabled()
    fireEvent.click(b)
    expect(onPromote).not.toHaveBeenCalled()
  })
})

describe('bellState — the derivation, without mounting', () => {
  it('⛔ NO REGISTRY ⇒ a definition-backed condition is TRUSTED, not reported missing', () => {
    // The right answer for a surface that holds no registry: reporting
    // "unavailable" because nothing was asked would be a fault it invented.
    const cond = { id: 'c', name: 'D', definitionId: DEF_ID }
    expect(bellState(cond, null, [], 'TSLA').cap.capability).toBe('durable')
    expect(bellState(cond, null, [], 'TSLA').definition).toBe(null)
  })

  it('⛔ a registry without `getDefinition` is treated as no registry, not crashed into', () => {
    const cond = { id: 'c', name: 'D', definitionId: DEF_ID }
    expect(bellState(cond, {}, [], 'TSLA').cap.capability).toBe('durable')
  })

  it('⭐ an INVALID condition can neither act nor explain', () => {
    const s = bellState({ id: 'c', name: 'X', formula: 'zzz > 1' }, registry(), [], 'TSLA')
    expect(s.cap.capability).toBe('invalid')
    expect(s.action).toBe(null)
    expect(s.enabled).toBe(false)
  })
})

describe('a durable condition does not read as broken', () => {
  const withDurable = () => {
    const { cs, ids } = build()
    return { cs, ids }
  }

  it('⛔⛔ ITS ROW BADGE IS NOT AN ERROR — the formula lives in the definition', () => {
    mount()
    // `validateConditionFormula('')` says "a condition needs a formula". Asking it
    // about a definition-backed row had the settings panel calling a perfectly
    // good condition broken, on the one screen a member opens when something looks
    // wrong. The badge that replaces it says WHERE the formula is.
    const row = document.querySelector('[data-condition-id="cond:durable"]')
    expect(row.textContent).not.toMatch(/needs a formula/i)
    expect(row.textContent).toMatch(/saved formula/i)
  })

  it('⛔ the SOURCE_UNAVAILABLE row says so, and says it once', () => {
    const { cs } = build()
    render(
      <ChartSettingsConditions
        settings={cs} onChange={() => {}} sym="TSLA"
        registry={{ getDefinition: () => null }}
        onArmAlert={vi.fn()} onPromoteCondition={vi.fn()}
      />,
    )
    const row = document.querySelector('[data-condition-id="cond:durable"]')
    expect(row.textContent).toMatch(/no longer available/i)
    expect(row.textContent).not.toMatch(/needs a formula/i)
  })

  /** The row's own disclosure button, not its bell. */
  const openRow = (id) => {
    const row = document.querySelector(`[data-condition-id="${id}"]`)
    fireEvent.click([...row.querySelectorAll('button')].find((b) => b.hasAttribute('aria-expanded')
      && b.getAttribute('aria-label') === null))
    return row
  }

  it('⛔⛔ THERE IS NO FORMULA BOX ON A DURABLE ROW — a second editable truth', () => {
    // An editable box here would write `cond.formula` while the chart went on
    // evaluating the DEFINITION: the member types and nothing happens.
    mount()
    const row = openRow('cond:durable')
    expect(screen.queryByLabelText('Durable formula')).toBeNull()
    // …the formula that ACTUALLY runs is shown instead
    expect(row.textContent).toMatch(/rsi\(close, 14\) > 50/)
    expect(row.textContent).toMatch(/Saved formula — edit it in the formula builder/)
  })

  it('⭐ a LOCAL row still has its editable box', () => {
    mount()
    // ⚠️ the id comes from the RENDERED row — `build()` mints a fresh one per call
    const id = bell('Alert me — Self contained').closest('[data-condition-id]').dataset.conditionId
    openRow(id)
    expect(screen.getByLabelText('Self contained formula')).toBeTruthy()
  })
})
