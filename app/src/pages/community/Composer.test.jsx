import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'
import { extractTickers } from './lib/tickerMention'
import Composer from './Composer'

vi.mock('swr', () => ({
  default: () => ({ data: null }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

test('extractTickers pulls chip attrs out of a doc', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'watching ' },
    { type: 'tickerChip', attrs: { ticker: 'NVDA' } },
    { type: 'text', text: ' and ' },
    { type: 'tickerChip', attrs: { ticker: 'AMD' } },
  ] }] }
  expect(extractTickers(doc)).toEqual(['NVDA', 'AMD'])
})

test('composer renders editor and submit button', () => {
  renderWithProviders(<Composer onSubmit={vi.fn()} submitLabel="Post" />)
  expect(screen.getByText('Post')).toBeTruthy()
})
