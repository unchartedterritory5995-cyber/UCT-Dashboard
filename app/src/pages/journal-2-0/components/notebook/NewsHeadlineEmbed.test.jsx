// UCT News V2: the Notebook card for a headline sent from UCT News — a frozen reference,
// rendered from its params alone. Synthetic only.
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NewsHeadlineEmbed from './NewsHeadlineEmbed'
import { normalizeParams, paramsPlainText, isReconstructable } from '../../../../widgets/registry'

const PARAMS = {
  eventId: '01JSYNTHETIC0000000000000A', content: 'SYNTHETIC: ALFA Corp raises full-year guidance <b>x</b>',
  receivedAtMs: Date.parse('2026-10-30T13:31:05Z'), source: 'Trade Exchange', tickers: ['ALFA', 'BRVO'],
}
const attrs = (params = PARAMS) => ({ widgetId: 'tradeExchangeHeadline', params, capturedAt: '2026-10-30T14:00:00Z' })

afterEach(() => vi.unstubAllGlobals())

describe('NewsHeadlineEmbed', () => {
  it('shows the headline verbatim (as text), the receipt time, the source, the tickers and the archive ref', () => {
    render(<NewsHeadlineEmbed attrs={attrs()} />)
    const text = screen.getByTestId('news-headline-embed-text')
    expect(text.textContent).toBe(PARAMS.content)
    expect(text.querySelector('b')).toBeNull()                            // never parsed as markup
    expect(screen.getByTestId('news-headline-embed-received').textContent).toMatch(/^Received by UCT .*ET/)
    expect(screen.getByText('Trade Exchange')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Tickers' }).textContent).toBe('ALFABRVO')
    expect(screen.getByTestId('news-headline-embed-ref').textContent).toContain(PARAMS.eventId)
  })

  it('asks nothing: the card is its params', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<NewsHeadlineEmbed attrs={attrs()} />)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a note search finds it by its words and tickers, and the registry calls it reconstructable', () => {
    const p = normalizeParams('tradeExchangeHeadline', PARAMS)
    expect(paramsPlainText('tradeExchangeHeadline', p)).toBe(`[UCT News: ${PARAMS.content} · ALFA BRVO — Trade Exchange]`)
    expect(isReconstructable('tradeExchangeHeadline', p)).toBe(true)
  })
})
