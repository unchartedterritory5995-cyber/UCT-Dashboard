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
  // AI Search also sends the member's question to Perplexity
  // (ai_search_agent.py web_search -> perplexity_search.web_search).
  expect(screen.getByText(/When you use AI Search/)).toBeInTheDocument()
})

test('the owner-approved wave-7 lines are present (legal sign-off 2026-09-25, items L6 and L8)', () => {
  const { container } = renderWithProviders(<Privacy />)
  const text = container.textContent
  // Email-in: Cloudflare Email Routing + a Worker receive the member's mail
  // (docs/notebook/email-in-setup.md §1). The drafted clause "handles those
  // messages only to deliver them to UCT" was dropped: no Cloudflare document
  // we could find says it, so the page must not claim it.
  expect(text).toMatch(/if you use your Notebook email address, receiving those emails and passing them\s+to us \(Cloudflare Email Routing and Workers\)/)
  expect(text).not.toMatch(/only to deliver them to UCT/)
  // Writing help sends the selected text to Anthropic (writing_help.py reads
  // note_ask._SYNTH_MODEL), the same vendor and data class as Ask Notebook.
  expect(text).toMatch(/including Ask Notebook,\s+writing help in the Notebook, Compass coaching/)
})

test('community sharing names everything another member can see', () => {
  const { container } = renderWithProviders(<Privacy />)
  const text = container.textContent
  // journal_two/community.py shares each trade's and position's notes, and
  // _display_name falls back to the part of the email before the @.
  expect(text).toMatch(/including the notes you wrote on them/)
  expect(text).toMatch(/the part of your email address before the @/)
})

test('publish-to-web is disclosed in the owner-approved words (L4, 2026-09-25), em dash and all', () => {
  const { container } = renderWithProviders(<Privacy />)
  // Owner legal sign-off L4: this sentence VERBATIM, in section 4, after the share-links item.
  const VERBATIM = 'Published notes and folders — where available, if you publish a note or folder to '
    + 'the web, anyone with its address can read it without signing in until you unpublish it. '
    + 'Published pages ask search engines not to index them, and they do not show your account, '
    + 'your other notes, file attachments, or market data such as charts and financial figures.'
  const items = [...container.querySelectorAll('li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim())
  const at = items.indexOf(VERBATIM)
  expect(at, `the published-pages item is not rendered verbatim:\n${items.join('\n')}`).toBeGreaterThan(-1)
  expect(items[at]).toContain('—')                                   // an EM dash, not a hyphen
  expect(items[at - 1]).toMatch(/^Note share links —/)               // right after the share-links item
  // ...and inside section 4's own list.
  const heading = [...container.querySelectorAll('h2')].find((h) => h.textContent === '4. Sharing You Control')
  const sectionItems = [...(heading?.nextElementSibling?.querySelectorAll('li') || [])]
    .map((li) => li.textContent.replace(/\s+/g, ' ').trim())
  expect(sectionItems).toContain(VERBATIM)
})

test('deleted notes: the Trash window is stated, not "until you delete it"', () => {
  const { container } = renderWithProviders(<Privacy />)
  const text = container.textContent
  // notes.py TRASH_RETENTION_DAYS = 30; the editor says the same to the member.
  expect(text).toMatch(/goes to Trash, where you can restore it for 30 days/)
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
