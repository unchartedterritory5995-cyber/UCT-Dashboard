import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartSettingsConditions from './ChartSettingsConditions'
import ConditionAlertPopover from './ConditionAlertPopover'
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

const ARMED = [{
  id: 1, sym: 'TSLA', tf: 'D', active: true,
  indicator: `${DEF_ID}.value`, condition: 'cross_above', threshold: 0.5,
}]

const mount = (props = {}) => {
  const { cs } = props.chart || build()
  return render(
    <ChartSettingsConditions
      settings={cs}
      onChange={() => {}}
      registry={registry()}
      sym="TSLA"
      onOpenAlerts={props.onOpenAlerts === undefined ? vi.fn() : props.onOpenAlerts}
      {...props}
    />,
  )
}

const bell = (name) => screen.getByRole('button', { name: new RegExp(name) })

describe('the bell — one gesture, four answers', () => {
  it('⭐⭐ each condition’s bell reports its OWN capability', () => {
    mount()
    expect(bell('Alert me — Self contained').dataset.capability).toBe('promotable')
    expect(bell('Alert me — Follows RSI').dataset.capability).toBe('local_only')
    expect(bell('Alert me — Durable').dataset.capability).toBe('durable')
  })

  it('⭐⭐ ONE CLICK, ONE DESTINATION — every capability opens the same sheet', () => {
    // ⚰️ The bell used to branch three ways (arm / promote / explain), so the
    // same control did something different depending on a capability the member
    // could not see. It now always opens the sheet and the SHEET decides.
    const onOpenAlerts = vi.fn()
    mount({ onOpenAlerts })
    fireEvent.click(bell('Alert me — Durable'))
    fireEvent.click(bell('Alert me — Self contained'))
    fireEvent.click(bell('Alert me — Follows RSI'))
    expect(onOpenAlerts).toHaveBeenCalledTimes(3)
    // …and it hands over the anchor rect, so the sheet needs no second lookup
    expect(onOpenAlerts.mock.calls[0][1]).toBeTruthy()
    expect(onOpenAlerts.mock.calls.map((c) => c[0].name))
      .toEqual(['Durable', 'Self contained', 'Follows RSI'])
  })

  it('⛔ a DURABLE condition whose definition is gone is disabled, with the sentence', () => {
    const { cs } = build()
    render(
      <ChartSettingsConditions
        settings={cs} onChange={() => {}} sym="TSLA"
        registry={{ getDefinition: () => null }}
        onOpenAlerts={vi.fn()}
      />,
    )
    const b = bell('Alert me — Durable')
    expect(b.dataset.capability).toBe('source_unavailable')
    expect(b).toBeDisabled()
    expect(b.title).toMatch(/no longer available/)
  })

  it('⭐ a PROMOTABLE bell says what the extra step IS, before it happens', () => {
    mount()
    expect(bell('Alert me — Self contained').title).toMatch(/run when the chart is closed/)
  })

  it('⛔ a LOCAL_ONLY bell is not greyed out — it has something to say', () => {
    mount()
    const b = bell('Alert me — Follows RSI')
    expect(b).not.toBeDisabled()
    expect(b.title).toMatch(/follows an indicator on this chart/)
  })
})

describe('already armed', () => {
  it('⭐ a condition with an alert reads as ON and says how many', () => {
    mount({ alerts: ARMED })
    const b = screen.getByRole('button', { name: /Alerts on for Durable/ })
    expect(b.dataset.armed).toBe('yes')
    expect(b.getAttribute('aria-pressed')).toBe('true')
    expect(b.getAttribute('aria-label')).toMatch(/1 alert\b/)
  })

  it('⭐⭐ TWO alerts show a COUNT; one does not', () => {
    // One alert is already reported by the bell being ON; a "1" beside it is
    // noise on a row that has to stay compact.
    const one = mount({ alerts: ARMED })
    expect(one.container.querySelector('[data-armed="yes"]').textContent.trim()).toBe('')
    one.unmount()
    const two = mount({ alerts: [...ARMED, { ...ARMED[0], id: 2, tf: '60' }] })
    expect(two.container.querySelector('[data-armed="yes"]').textContent).toContain('2')
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
    const onOpenAlerts = vi.fn()
    const { cs, ids } = build()
    render(
      <ChartSettingsConditions
        settings={cs} onChange={() => {}} registry={registry()} sym="TSLA"
        onOpenAlerts={onOpenAlerts} busyId={ids.plain}
      />,
    )
    const b = bell('Alert me — Self contained')
    expect(b).toBeDisabled()
    fireEvent.click(b)
    expect(onOpenAlerts).not.toHaveBeenCalled()
  })
})

// ─── THE SHEET ──────────────────────────────────────────────────────────────

const RECT = { left: 400, top: 200, bottom: 216, width: 16, height: 16 }

const sheet = (condId, props = {}) => {
  const { cs } = props.chart || build()
  const cond = conditionsOf(cs).find((c) => c.id === condId)
  const state = bellState(cond, props.registry || registry(), props.alerts || [], 'TSLA')
  return {
    cond,
    ...render(
      <ConditionAlertPopover
        cond={cond} state={state} sym="TSLA" tf="D" anchorRect={RECT}
        onClose={vi.fn()} {...props}
      />,
    ),
  }
}

describe('the sheet — the common case is one click', () => {
  it('⭐⭐ symbol, timeframe and timing are STATED, not asked', () => {
    sheet('cond:durable')
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveTextContent(/TSLA/)
    // ⭐ `1D`, THE SHIPPED VOCABULARY — `tfLabel` is what the chart's own
    // timeframe bar and menu render, so the sheet cannot say "Daily" while the
    // button behind it says "1D". A second labelling is a twin.
    expect(dlg).toHaveTextContent(/1D/)
    expect(dlg).toHaveTextContent(/on bar close/)
    // ⛔ …and there is no form to fill in
    expect(dlg.querySelectorAll('select, input')).toHaveLength(0)
  })

  it('⭐ it names the condition and the trigger in member language', () => {
    sheet('cond:durable')
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveTextContent(/Durable/)
    expect(dlg).toHaveTextContent(/becomes true/i)
    // ⛔ never the encoding
    expect(dlg.textContent).not.toMatch(/cross_above|0\.5|u_275/)
  })

  it('⭐⭐ DURABLE → Create alert asks the host to POST', () => {
    const onCreate = vi.fn()
    const { cond } = sheet('cond:durable', { onCreate })
    fireEvent.click(screen.getByRole('button', { name: 'Create alert' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    const call = onCreate.mock.calls[0][0]
    expect(call.cond.id).toBe(cond.id)
    expect(call.definition.id).toBe(DEF_ID)
    expect(call.policyId).toBe('becomes_true')
  })

  it('⭐ PROMOTABLE → the same button PROMOTES, and says so first', () => {
    const { cs, ids } = build()
    const onPromote = vi.fn(); const onCreate = vi.fn()
    sheet(ids.plain, { chart: { cs }, onPromote, onCreate })
    expect(screen.getByRole('dialog'))
      .toHaveTextContent(/saved so it can keep running when the chart is closed/)
    fireEvent.click(screen.getByRole('button', { name: 'Create alert' }))
    expect(onPromote).toHaveBeenCalledTimes(1)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('⭐⭐ IN UCT IS STATED; EMAIL IS A CHOICE, AND IT IS OFF', () => {
    // ⛔ In UCT is not a checkbox: it is always on, and a control that cannot be
    // unticked is a lie about who is in control. Email is a real choice and
    // starts OFF — creating an alert and subscribing to email are separate
    // member decisions, and one click must not make the second one.
    sheet('cond:durable', { email: 'me@example.com' })
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveTextContent(/Notify me/)
    expect(dlg).toHaveTextContent(/In UCT/)
    const boxes = dlg.querySelectorAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(1)
    expect(boxes[0].checked).toBe(false)
  })

  it('⭐ the email choice travels WITH the create', () => {
    const onCreate = vi.fn()
    sheet('cond:durable', { email: 'me@example.com', onCreate })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Create alert' }))
    expect(onCreate.mock.calls[0][0].channels).toEqual(['in_app', 'email'])
  })

  it('⭐ unticked, it creates in-app only', () => {
    const onCreate = vi.fn()
    sheet('cond:durable', { email: 'me@example.com', onCreate })
    fireEvent.click(screen.getByRole('button', { name: 'Create alert' }))
    expect(onCreate.mock.calls[0][0].channels).toEqual(['in_app'])
  })

  it('⛔⛔ NO ADDRESS ⇒ NO TOGGLE, and it says why', () => {
    // An enabled control that silently never delivers is the defect this whole
    // lane exists to prevent, one layer up.
    sheet('cond:durable', { email: null })
    const dlg = screen.getByRole('dialog')
    expect(dlg.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    expect(dlg).toHaveTextContent(/no email address on your account/)
  })

  it('⛔ Discord is not offered at all', () => {
    sheet('cond:durable', { email: 'me@example.com' })
    expect(screen.getByRole('dialog').textContent).not.toMatch(/discord/i)
  })
})

describe('the sheet — refusals carry the next move', () => {
  it('⛔⛔ LOCAL_ONLY explains, names what it follows, and offers the handoff', () => {
    const { cs, ids } = build()
    const onBuild = vi.fn(); const onCreate = vi.fn()
    sheet(ids.bound, { chart: { cs }, onBuild, onCreate })
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveTextContent(/follows an indicator on this chart/)
    expect(dlg).toHaveTextContent(/Follows: legacy:rsi/)
    expect(screen.queryByRole('button', { name: 'Create alert' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Create alertable version/ }))
    expect(onBuild).toHaveBeenCalledWith({
      consumerKind: 'condition',
      prefill: 'a > 50',           // ⛔ NOT the inlined form — a different sentence
      boundTo: ['legacy:rsi'],
      fromConditionId: expect.any(String),
    })
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('⛔ SOURCE_UNAVAILABLE offers nothing but the sentence', () => {
    sheet('cond:durable', { registry: { getDefinition: () => null } })
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveTextContent(/no longer available/)
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull()
  })
})

describe('the sheet — existing alerts', () => {
  it('⭐ it lists them, and the primary action becomes "Create another"', () => {
    sheet('cond:durable', { alerts: ARMED })
    expect(screen.getByRole('dialog')).toHaveTextContent(/TSLA · 1D/)
    expect(screen.getByRole('button', { name: 'Create another' })).toBeTruthy()
  })

  it('⭐ pause and delete reach the host by alert id', () => {
    const onToggle = vi.fn(); const onDelete = vi.fn()
    sheet('cond:durable', { alerts: ARMED, onToggle, onDelete })
    fireEvent.click(screen.getByRole('button', { name: /Pause this alert/ }))
    fireEvent.click(screen.getByRole('button', { name: /Delete this alert/ }))
    expect(onToggle).toHaveBeenCalledWith(1)
    expect(onDelete).toHaveBeenCalledWith(1)
  })

  it('⭐ a paused alert reads as paused and offers Resume', () => {
    // ⚠️ `onToggle` IS REQUIRED FOR THE CONTROL TO EXIST — absent host, absent
    // door, the same rule the bell itself follows.
    sheet('cond:durable', { alerts: [{ ...ARMED[0], active: false }], onToggle: vi.fn() })
    expect(screen.getByRole('dialog')).toHaveTextContent(/Paused/)
    expect(screen.getByRole('button', { name: /Resume this alert/ })).toBeTruthy()
  })

  it('⭐ "Manage in Alerts" hands the host the alert id', () => {
    const onManage = vi.fn()
    sheet('cond:durable', { alerts: ARMED, onManage })
    fireEvent.click(screen.getByRole('button', { name: /Manage in Alerts/ }))
    expect(onManage).toHaveBeenCalledWith(1)
  })
})

describe('the sheet — it behaves like a dialog', () => {
  it('⭐ Escape closes it', () => {
    const onClose = vi.fn()
    sheet('cond:durable', { onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('⭐ a click outside closes it', () => {
    const onClose = vi.fn()
    sheet('cond:durable', { onClose })
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('⭐⭐ it is clamped into the viewport, never off the right edge', () => {
    // A bell at the far right of a narrow cell would otherwise place a 268px
    // sheet half off-screen, with no scrollbar to recover it.
    const { cs } = build()
    const cond = conditionsOf(cs).find((c) => c.id === 'cond:durable')
    const state = bellState(cond, registry(), [], 'TSLA')
    render(
      <ConditionAlertPopover
        cond={cond} state={state} sym="TSLA" tf="D"
        anchorRect={{ left: 4000, top: 100, bottom: 116, width: 16, height: 16 }}
        onClose={vi.fn()}
      />,
    )
    const dlg = screen.getByRole('dialog')
    const left = parseFloat(dlg.style.left)
    expect(left).toBeGreaterThanOrEqual(8)
    expect(left + 268).toBeLessThanOrEqual(window.innerWidth)
  })

  it('⭐ focus moves into the sheet', () => {
    sheet('cond:durable')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Create alert' }))
  })
})

describe('bellState — the derivation, without mounting', () => {
  it('⛔ NO REGISTRY ⇒ a definition-backed condition is TRUSTED, not reported missing', () => {
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
  const openRow = (id) => {
    const row = document.querySelector(`[data-condition-id="${id}"]`)
    fireEvent.click([...row.querySelectorAll('button')].find((b) => b.hasAttribute('aria-expanded')
      && b.getAttribute('aria-label') === null))
    return row
  }

  it('⛔⛔ ITS ROW BADGE IS NOT AN ERROR — the formula lives in the definition', () => {
    mount()
    const row = document.querySelector('[data-condition-id="cond:durable"]')
    expect(row.textContent).not.toMatch(/needs a formula/i)
    expect(row.textContent).toMatch(/saved formula/i)
  })

  it('⛔ the SOURCE_UNAVAILABLE row says so, and says it once', () => {
    const { cs } = build()
    render(
      <ChartSettingsConditions
        settings={cs} onChange={() => {}} sym="TSLA"
        registry={{ getDefinition: () => null }} onOpenAlerts={vi.fn()}
      />,
    )
    const row = document.querySelector('[data-condition-id="cond:durable"]')
    expect(row.textContent).toMatch(/no longer available/i)
    expect(row.textContent).not.toMatch(/needs a formula/i)
  })

  it('⛔⛔ THERE IS NO FORMULA BOX ON A DURABLE ROW — a second editable truth', () => {
    mount()
    const row = openRow('cond:durable')
    expect(screen.queryByLabelText('Durable formula')).toBeNull()
    expect(row.textContent).toMatch(/rsi\(close, 14\) > 50/)
    expect(row.textContent).toMatch(/Saved formula — edit it in the formula builder/)
  })

  it('⭐ a LOCAL row still has its editable box', () => {
    mount()
    const id = bell('Alert me — Self contained').closest('[data-condition-id]').dataset.conditionId
    openRow(id)
    expect(screen.getByLabelText('Self contained formula')).toBeTruthy()
  })
})
