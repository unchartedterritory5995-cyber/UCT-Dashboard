// app/src/components/chart/IndicatorTemplatesBar.test.jsx — FT-070 / COV-11 surface
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const H = vi.hoisted(() => ({ stored: undefined, writes: [], answer: undefined }))
vi.mock('../../hooks/usePreferences', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    default: () => ({
      prefs: { indicator_templates: H.stored === undefined ? undefined : JSON.stringify(H.stored) },
      setPref: vi.fn(),
      // the real hook's answer: undefined when the updater abandons the write, else what
      // the POST said — {ok:true} landed, {ok:false} refused (it never throws for that)
      setPrefMerged: vi.fn(async (key, updater) => {
        const next = updater(H.stored)
        if (next === undefined) return undefined
        H.writes.push({ key, next })
        const answer = H.answer || { ok: true }
        if (answer.ok) H.stored = next
        return answer
      }),
    }),
  }
})

const { default: IndicatorTemplatesBar } = await import('./IndicatorTemplatesBar')
const registry = await import('./engine/nativeRegistry')
const { mergeChartSettings } = await import('./chartDefaults')
const { withInstances } = await import('./engine/instanceControls')

function chart() {
  const base = mergeChartSettings(null)
  const cs = mergeChartSettings(JSON.stringify({
    ...base,
    indicatorInstances: [{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: false }],
  }))
  return withInstances(cs, cs.indicatorInstances, registry)
}

beforeEach(() => { H.stored = undefined; H.writes = []; H.answer = undefined })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('Indicator templates surface', () => {
  it('⛔ flag OFF (the default): renders nothing', () => {
    const { container } = render(<IndicatorTemplatesBar settings={chart()} onChange={vi.fn()} registry={registry} />)
    expect(container.innerHTML).toBe('')
  })

  it('flag ON: saves this chart\'s indicators under a name through setPrefMerged(indicator_templates)', async () => {
    vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
    render(<IndicatorTemplatesBar settings={chart()} onChange={vi.fn()} registry={registry} />)
    fireEvent.click(screen.getByRole('button', { name: /Indicator templates/ }))
    expect(screen.getByText(/No indicator templates yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Save this chart’s indicators/ }))
    fireEvent.change(screen.getByLabelText('Indicator template name'), { target: { value: 'My RSI' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(H.writes).toHaveLength(1)
    expect(H.writes[0].key).toBe('indicator_templates')
    expect(H.writes[0].next[0]).toMatchObject({ name: 'My RSI' })
    // the copy the member reads, asserted as rendered TEXT
    expect(screen.getByRole('status').textContent).toMatch(/Saved “My RSI”/)
  })

  it('flag ON: applying a saved template hands the new settings to onChange and says what happened', async () => {
    vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
    const { captureIndicatorTemplate } = await import('./builder/indicatorTemplates')
    const tpl = captureIndicatorTemplate(chart(), registry, { name: 'Swing' }).template
    H.stored = [tpl]
    const onChange = vi.fn()
    const base = mergeChartSettings(JSON.stringify({ ...mergeChartSettings(null), indicatorInstances: [], overlays: [] }))
    render(<IndicatorTemplatesBar settings={base} onChange={onChange} registry={registry} />)
    fireEvent.click(screen.getByRole('button', { name: /Indicator templates \(1\)/ }))
    fireEvent.click(screen.getByTitle('Add the indicators in “Swing” to this chart'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    expect(next.indicatorInstances.some((i) => i.defId === 'rsi' && i.inputs.period === 7)).toBe(true)
    expect(screen.getByRole('status').textContent).toMatch(/from “Swing”/)
    // delete — asks first, inside the panel
    await act(async () => { fireEvent.click(screen.getByLabelText('Delete indicator template Swing')) })
    expect(H.stored).toHaveLength(1)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete “Swing”' })) })
    expect(H.stored).toEqual([])
    expect(screen.getByRole('status').textContent).toMatch(/Deleted “Swing”/)
  })
})

describe('pre-arm review — what the member is told', () => {
  const openSave = (name) => {
    fireEvent.click(screen.getByRole('button', { name: /Indicator templates/ }))
    fireEvent.click(screen.getByRole('button', { name: /Save this chart’s indicators/ }))
    fireEvent.change(screen.getByLabelText('Indicator template name'), { target: { value: name } })
  }

  it('⛔ a save the SERVER refused is not reported as saved', async () => {
    vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
    H.answer = { ok: false }
    render(<IndicatorTemplatesBar settings={chart()} onChange={vi.fn()} registry={registry} />)
    openSave('My RSI')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    const said = screen.getByRole('status').textContent
    expect(said).not.toMatch(/^Saved/)
    expect(said).toMatch(/Couldn’t save “My RSI”/)
    // the name stays in the field so a retry is one click
    expect(screen.getByLabelText('Indicator template name').value).toBe('My RSI')
  })

  it('⛔ a delete the server refused is not reported as deleted', async () => {
    vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
    const { captureIndicatorTemplate } = await import('./builder/indicatorTemplates')
    H.stored = [captureIndicatorTemplate(chart(), registry, { name: 'Swing' }).template]
    H.answer = { ok: false }
    render(<IndicatorTemplatesBar settings={chart()} onChange={vi.fn()} registry={registry} />)
    fireEvent.click(screen.getByRole('button', { name: /Indicator templates \(1\)/ }))
    fireEvent.click(screen.getByLabelText('Delete indicator template Swing'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete “Swing”' })) })
    expect(screen.getByRole('status').textContent).toMatch(/Couldn’t delete “Swing”/)
  })

  it('⛔ a full list says so and writes nothing; it never drops the oldest template', async () => {
    vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
    const { MAX_INDICATOR_TEMPLATES } = await import('./builder/indicatorTemplates')
    H.stored = Array.from({ length: MAX_INDICATOR_TEMPLATES }, (_, i) => ({ id: `t${i}`, name: `T${i}`, instances: [] }))
    render(<IndicatorTemplatesBar settings={chart()} onChange={vi.fn()} registry={registry} />)
    openSave('One more')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(H.writes).toHaveLength(0)
    expect(H.stored).toHaveLength(MAX_INDICATOR_TEMPLATES)
    expect(screen.getByRole('status').textContent).toMatch(new RegExp(`You have ${MAX_INDICATOR_TEMPLATES} indicator templates`))
  })

  it('re-saving under an existing name says it REPLACED that template', async () => {
    vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
    H.stored = [{ id: 'old', name: 'Swing', instances: [] }]
    render(<IndicatorTemplatesBar settings={chart()} onChange={vi.fn()} registry={registry} />)
    openSave('swing')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(H.stored).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toMatch(/Replaced “swing”/)
  })

  it('a delete can be backed out of with Keep', async () => {
    vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
    H.stored = [{ id: 'a', name: 'Swing', instances: [] }]
    render(<IndicatorTemplatesBar settings={chart()} onChange={vi.fn()} registry={registry} />)
    fireEvent.click(screen.getByRole('button', { name: /Indicator templates \(1\)/ }))
    fireEvent.click(screen.getByLabelText('Delete indicator template Swing'))
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(H.writes).toHaveLength(0)
    expect(screen.getByLabelText('Delete indicator template Swing')).toBeTruthy()
  })
})
