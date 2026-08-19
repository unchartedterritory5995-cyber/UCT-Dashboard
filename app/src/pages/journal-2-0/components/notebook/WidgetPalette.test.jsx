// Widget palette — the point-and-click twin of the slash commands (owner ask:
// "click Charts → What ticker? What time frame? Boom — click, click, click").
// It must ride the SAME grammar (parseChartSlashArgs & friends) and the SAME
// node builder (chartInsertNodes) as the slash menu — a second hand-written
// insert payload is the "one grammar, four copies" defect.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import WidgetPalette from './WidgetPalette'

const makeEditor = () => {
  const calls = { content: null, focused: 0, ran: 0 }
  const chain = {
    focus: () => { calls.focused += 1; return chain },
    insertContent: (nodes) => { calls.content = nodes; return chain },
    caretAfterWidgetEmbed: () => chain,
    run: () => { calls.ran += 1 },
  }
  const editor = {
    chain: () => chain,
    storage: { uctJournalWidgets: { chartSettings: { background: '#abc123' } } },
  }
  return { editor, calls }
}

describe('WidgetPalette', () => {
  it('lists the chart type and the two composition presets', () => {
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    const panel = screen.getByRole('dialog', { name: 'Insert widget' })
    expect(within(panel).getByText('Chart')).toBeInTheDocument()
    expect(within(panel).getByText('MTF stack')).toBeInTheDocument()
    expect(within(panel).getByText('Before / after')).toBeInTheDocument()
  })

  it('chart flow: ticker → timeframe pill → insert lands the exact /chart payload, settings frozen', () => {
    const { editor, calls } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'amd' } })
    fireEvent.click(screen.getByRole('button', { name: '15m' }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert chart' }))
    expect(calls.ran).toBe(1)
    expect(calls.content).toHaveLength(1)
    expect(calls.content[0].type).toBe('widgetEmbed')
    expect(calls.content[0].attrs.params).toMatchObject({ symbol: 'AMD', tf: '15' })
    expect(calls.content[0].attrs.params.settings).toEqual({ background: '#abc123' })
  })

  it('insert stays disabled until the ticker parses (same strictness as the slash grammar)', () => {
    const { editor, calls } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Chart'))
    const insert = screen.getByRole('button', { name: 'Insert chart' })
    expect(insert).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: '123' } })
    expect(insert).toBeDisabled()
    fireEvent.click(insert)
    expect(calls.ran).toBe(0)
  })

  it('before/after requires a date; a valid one inserts the half-width pair', () => {
    const { editor, calls } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Before / after'))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'AMD' } })
    const insert = screen.getByRole('button', { name: 'Insert charts' })
    expect(insert).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Anchor date'), { target: { value: '2026-03-13' } })
    fireEvent.click(insert)
    expect(calls.content).toHaveLength(2)
    expect(calls.content[0].attrs.params.to).toBe('2026-03-13')
    expect(calls.content[0].attrs.layout.width).toBe('half')
    expect(calls.content[1].attrs.params.to == null).toBe(true)
  })

  it('steps OFF a pre-existing NodeSelection before inserting (the atom-replace trap)', () => {
    // Clicking an embed leaves a NodeSelection ON the atom; focus() restores
    // it, and insertContent over a NodeSelection REPLACES the node. The slash
    // path can't reach this (typing collapses the selection) — the palette
    // can, so its chain must caretAfterWidgetEmbed() BEFORE the insert too.
    const order = []
    const chain = {
      focus: () => { order.push('focus'); return chain },
      insertContent: () => { order.push('insertContent'); return chain },
      caretAfterWidgetEmbed: () => { order.push('caret'); return chain },
      run: () => { order.push('run') },
    }
    const editor = { chain: () => chain, storage: {} }
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'AMD' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert chart' }))
    expect(order.indexOf('caret')).toBeGreaterThan(-1)
    expect(order.indexOf('caret')).toBeLessThan(order.indexOf('insertContent'))
    expect(order.filter((x) => x === 'caret').length).toBe(2) // before AND after
  })

  it('mtf flow inserts the three-chart stack', () => {
    const { editor, calls } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('MTF stack'))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'NVDA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert charts' }))
    expect(calls.content).toHaveLength(3)
    expect(calls.content.map((n) => n.attrs.params.tf)).toEqual(['D', '60', '15'])
  })
})
