import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CriteriaBox from './CriteriaBox'

const ok = (json) => ({ ok: true, status: 200, json: async () => json })
const no = (status, json = {}) => ({ ok: false, status, json: async () => json })

function fetcherFor({ armed = true, parse, compile } = {}) {
  return vi.fn(async (url, init = {}) => {
    if (url === '/api/screener/grammar') return armed ? ok({ version: 1 }) : no(404)
    if (url === '/api/screener/grammar/parse') return parse()
    if (url === '/api/screener/compile') {
      if (!compile) return no(404)
      return init.method === 'POST' ? compile() : ok({ available: true })
    }
    throw new Error(`unexpected ${url}`)
  })
}

describe('CriteriaBox', () => {
  it('renders nothing while the server says the grammar is dark', async () => {
    const fetcher = fetcherFor({ armed: false })
    const { container } = render(<CriteriaBox logic={null} onApply={() => {}} fetcher={fetcher} />)
    await waitFor(() => expect(fetcher).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('applies the parsed tree and shows one sentence per criterion', async () => {
    const tree = { all: [{ key: 'price', op: 'gt', min: 10 }, { key: 'rsi14', op: 'lt', max: 30 }] }
    const fetcher = fetcherFor({ parse: async () => ok({ logic: tree, criteria: 2, explanation: [
      { depth: 0, text: 'All of the following:' },
      { depth: 1, text: 'Price is above $10' },
      { depth: 1, text: 'RSI (14) is below 30' },
    ] }) })
    const onApply = vi.fn()
    const { rerender } = render(<CriteriaBox logic={null} onApply={onApply} fetcher={fetcher} />)
    const box = await screen.findByLabelText('Criteria')
    fireEvent.change(box, { target: { value: 'price > 10 and rsi14 < 30' } })
    fireEvent.click(screen.getByText('Apply'))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(tree))
    rerender(<CriteriaBox logic={tree} onApply={onApply} fetcher={fetcher} />)
    const outline = screen.getByLabelText('Applied criteria')
    expect(outline.textContent).toContain('Price is above $10')
    expect(outline.textContent).toContain('RSI (14) is below 30')
  })

  it('no English line while the compile door is dark', async () => {
    render(<CriteriaBox logic={null} onApply={() => {}} fetcher={fetcherFor()} />)
    await screen.findByLabelText('Criteria')
    expect(screen.queryByLabelText('Describe it')).toBeNull()
  })

  it('English writes editable criteria, applies them, and lists the assumptions', async () => {
    const tree = { key: 'rs_rank', op: 'gte', min: 90 }
    const fetcher = fetcherFor({ compile: async () => ok({
      criteria: 'rs_rank >= 90', logic: tree,
      explanation: [{ depth: 0, text: 'RS Rank is at least 90' }],
      assumptions: ["'strong' read as RS Rank 90+"] }) })
    const onApply = vi.fn()
    const { rerender } = render(<CriteriaBox logic={null} onApply={onApply} fetcher={fetcher} />)
    fireEvent.change(await screen.findByLabelText('Describe it'), { target: { value: 'strong stocks' } })
    fireEvent.click(screen.getByText('Write criteria'))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(tree))
    expect(screen.getByLabelText('Criteria').value).toBe('rs_rank >= 90')
    rerender(<CriteriaBox logic={tree} onApply={onApply} fetcher={fetcher} />)
    expect(screen.getByLabelText('Assumptions made').textContent).toContain("RS Rank 90+")
  })

  it('a refused text shows the parser sentence and applies nothing', async () => {
    const fetcher = fetcherFor({ parse: async () => no(400, { detail: "'pirce' is not a screener field; did you mean price?" }) })
    const onApply = vi.fn()
    render(<CriteriaBox logic={null} onApply={onApply} fetcher={fetcher} />)
    fireEvent.change(await screen.findByLabelText('Criteria'), { target: { value: 'pirce > 1' } })
    fireEvent.click(screen.getByText('Apply'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/did you mean price/)
    expect(onApply).not.toHaveBeenCalled()
  })
})
