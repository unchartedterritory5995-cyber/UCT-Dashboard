// Finish program, lane AI-FE, K3: the Ask panel shows the model's bold and italic as bold
// and italic, never as asterisks, and never as HTML.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AskPanel from './AskPanel'

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

const SOURCE = {
  n: 1, type: 'note', label: 'CRWD plan', citation: 'exact', snippet: 'entry above 412',
  navigation: { kind: 'note', note_id: 'n1' }, location: { from: 1, to: 25, fingerprint: 'abc:12' },
  payload: {}, stance: null, truncated: false,
}
const HEAD = { type: 'sources', scope: 'note', scopeLabel: 'This note', sources: [SOURCE], coverageNotice: null, independentSources: 1, noAnswer: false }

async function ask(answer) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({}),
    body: sse([HEAD, { type: 'delta', text: answer }, { type: 'final', answer, cited: [1], invalidCitations: [] }]),
  })
  render(<AskPanel scope="note" target="n1" autoOpen />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'entry?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  return screen.findByTestId('ask-answer')
}

beforeEach(() => { vi.restoreAllMocks() })

describe('Ask panel: Markdown emphasis in an answer', () => {
  it('bold and italic are rendered, the asterisks are not shown', async () => {
    const box = await ask('**Planned entry (breakout plan):** above 412 [1]. It was *not* chased.')
    await screen.findByText('Planned entry (breakout plan):')
    expect(box.textContent).toBe('Planned entry (breakout plan): above 412 [1]. It was not chased.')
    expect(box.textContent).not.toContain('*')
    const strong = box.querySelector('strong')
    expect(strong.textContent).toBe('Planned entry (breakout plan):')
    expect(box.querySelector('em').textContent).toBe('not')
  })

  it('the citation chip is still the chip, with its own name', async () => {
    const box = await ask('**Stop raised [1] to breakeven** after the report.')
    await screen.findByText('Stop raised')
    const chip = screen.getByRole('button', { name: 'Source 1: CRWD plan' })
    expect(chip.textContent).toBe('[1]')
    expect(box.contains(chip)).toBe(true)
    expect(chip.closest('strong')).toBeNull()
  })

  it('markup inside emphasis stays text', async () => {
    const box = await ask('**<img src=x onerror=alert(1)>** [1]')
    await screen.findByText('<img src=x onerror=alert(1)>')
    expect(box.querySelector('img')).toBeNull()
  })

  it('control: stray asterisks stay as the model wrote them', async () => {
    const box = await ask('5 * 3 * 2 = 30 [1]')
    await screen.findByText(/5 \* 3 \* 2/)
    expect(box.querySelector('strong, em')).toBeNull()
  })
})
