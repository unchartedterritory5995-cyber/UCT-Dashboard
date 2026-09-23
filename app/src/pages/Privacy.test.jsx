import { renderWithProviders, screen } from '../test-utils'
import Privacy from './Privacy'

// The policy names every service provider member data actually reaches. Each
// entry below was traced to a live code path on 2026-09-23 (Ask Notebook and
// Compass -> Anthropic; dictation, voice and voice-history search -> OpenAI;
// Compass web research -> Perplexity; broker sync -> SnapTrade; auth.db
// backups -> Cloudflare R2). A provider added in code without a line here is a
// disclosure gap; a line removed here is one too.

const PROVIDERS = ['Stripe', 'Resend', 'Railway', 'Cloudflare', 'Anthropic', 'OpenAI', 'Perplexity', 'SnapTrade']

test('names every service provider that receives member data', () => {
  renderWithProviders(<Privacy />)
  for (const name of PROVIDERS) {
    expect(screen.getAllByText(name, { selector: 'strong' }).length).toBeGreaterThan(0)
  }
})

test('says what each AI provider receives, not just that it exists', () => {
  renderWithProviders(<Privacy />)
  expect(screen.getByText(/is sent to Anthropic to produce the answer/)).toBeInTheDocument()
  expect(screen.getByText(/The audio or text involved is sent to OpenAI/)).toBeInTheDocument()
  expect(screen.getByText(/the research question is sent to Perplexity/)).toBeInTheDocument()
})

test('never claims activity data is anonymous — page views are stored per account', () => {
  const { container } = renderWithProviders(<Privacy />)
  const text = container.textContent
  // auth_db.page_views carries user_id and activity_log carries ip_address, so
  // the March 2026 wording ("not tied to your identity") was false.
  expect(text).not.toMatch(/not tied to your identity/i)
  expect(text).not.toMatch(/anonymized usage data/i)
  expect(screen.getByText(/These records are linked to your account/)).toBeInTheDocument()
})

test('states how long deleted data can survive in backups', () => {
  renderWithProviders(<Privacy />)
  expect(screen.getByText(/can remain in those\s+copies for up to 7 days/)).toBeInTheDocument()
})

test('covers the Browser Capture extension — the Chrome Web Store listing points here', () => {
  renderWithProviders(<Privacy />)
  expect(screen.getByRole('heading', { name: 'Browser Capture Extension' })).toBeInTheDocument()
  expect(screen.getByText(/It does not read the rest of the page, your browsing history/)).toBeInTheDocument()
})

test('discloses the Notebook working copy kept on the device', () => {
  renderWithProviders(<Privacy />)
  expect(screen.getByText(/keeps a working copy in your browser's\s+local storage on your device/)).toBeInTheDocument()
})
