// The four states a phone share can land in, and the one thing that must be
// true in every one of them: the member's shared article is not lost.
//
// ⛔ THE FAILURE THIS FILE EXISTS FOR is not an exception — it is a silent,
// cheerful redirect. AuthGuard bounces an unauthenticated visitor to /login and
// keeps no record of where they were going, so the "broken" behaviour looks
// exactly like a normal sign-in: the member shares an article, signs in, lands
// on the dashboard, and the article is simply gone. Nothing throws and nothing
// logs, which is why it needs a rail rather than a manual check.
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import ShareTargetPage from './ShareTargetPage'
import { PENDING_SHARE_KEY, SHARE_ROUTE } from '../../lib/shareTarget'

let auth = { user: null, isPaid: false, loading: false, authTransient: false }
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => auth,
  AuthProvider: ({ children }) => children,
}))

const PAID = { user: { id: 'u1' }, isPaid: true, loading: false, authTransient: false }
const FREE = { user: { id: 'u1' }, isPaid: false, loading: false, authTransient: false }
const OUT = { user: null, isPaid: false, loading: false, authTransient: false }

const SHARE = '?title=Fed%20holds&text=rates%20steady&url=https%3A%2F%2Fwsj.com%2Fx'

function renderAt(search = SHARE) {
  return render(
    <MemoryRouter initialEntries={[`${SHARE_ROUTE}${search}`]}>
      <Routes>
        <Route path={SHARE_ROUTE} element={<ShareTargetPage />} />
        <Route path="/journal/notebook" element={<div>NOTEBOOK</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const pending = () => JSON.parse(sessionStorage.getItem(PENDING_SHARE_KEY) || 'null')

beforeEach(() => {
  sessionStorage.clear()
  auth = { ...OUT }
})

describe('a signed-in paid member', () => {
  beforeEach(() => { auth = { ...PAID } })

  it('is handed straight to the Notebook, where the dialog opens', () => {
    renderAt()
    expect(screen.getByText('NOTEBOOK')).toBeInTheDocument()
  })

  it('leaves the parsed share waiting for CaptureHost', () => {
    renderAt()
    expect(pending()).toMatchObject({
      kind: 'source', url: 'https://wsj.com/x', title: 'Fed holds', passage: 'rates steady',
    })
  })

  it('a text-only share is parked as a thought, not as a quotation', () => {
    renderAt('?text=margins%20normalize%20by%20Q3')
    expect(pending()).toMatchObject({ kind: 'thought', thought: 'margins normalize by Q3', url: '' })
  })
})

describe('⛔ a signed-OUT member — the case this door is for', () => {
  it('is offered sign-in instead of being bounced', () => {
    renderAt()
    expect(screen.getByTestId('share-signin')).toBeInTheDocument()
    expect(screen.queryByText('NOTEBOOK')).not.toBeInTheDocument()
  })

  it('⛔ the payload is saved BEFORE the sign-in prompt renders', () => {
    // Persisting only on the signed-in path would lose the share in exactly the
    // case it needs saving.
    renderAt()
    expect(pending()).toMatchObject({ url: 'https://wsj.com/x' })
  })

  it('⛔ the sign-in link carries the whole share back as ?next=', () => {
    // The second carrier: sessionStorage covers this tab, `?next=` covers a
    // member whose storage is blocked or who lands in a fresh context.
    renderAt()
    const href = screen.getByTestId('share-signin').getAttribute('href')
    expect(href).toContain('/login?next=')
    const next = decodeURIComponent(href.split('next=')[1])
    expect(next.startsWith(SHARE_ROUTE)).toBe(true)
    expect(next).toContain('wsj.com')
  })

  it('⛔ …and `next` stays a same-site path, so this is never an open redirect', () => {
    // Login.jsx's `safeNextPath` refuses anything not starting with a single
    // `/`. Asserted here too: this page is the only thing that composes the
    // value, and a future change here must not start relying on that guard
    // catching it.
    renderAt()
    const next = decodeURIComponent(
      screen.getByTestId('share-signin').getAttribute('href').split('next=')[1])
    expect(next.startsWith('/')).toBe(true)
    expect(next.startsWith('//')).toBe(false)
    expect(next).not.toMatch(/^https?:/i)
  })
})

describe('a free member gets an answer, not a bounce', () => {
  beforeEach(() => { auth = { ...FREE } })

  it('is told Notebook is paid, and that nothing was saved', () => {
    renderAt()
    expect(screen.getByText(/part of a paid plan/i)).toBeInTheDocument()
    expect(screen.getByText(/Nothing was saved/i)).toBeInTheDocument()
    // ⛔ Not forwarded: AuthGuard would redirect them to Morning Wire and the
    // capture dialog would open over a page they cannot save from.
    expect(screen.queryByText('NOTEBOOK')).not.toBeInTheDocument()
  })
})

describe('⛔ a backend that cannot ANSWER the session question', () => {
  it('holds the splash rather than treating a 5xx as signed-out', () => {
    // The R2 ruling in AuthGuard: a blip must never log anyone out — and here
    // it would also discard a share behind a sign-in screen the member does not
    // need. Same reasoning, so the same behaviour.
    auth = { user: null, isPaid: false, loading: false, authTransient: true }
    renderAt()
    expect(screen.queryByTestId('share-signin')).not.toBeInTheDocument()
    expect(screen.queryByText('NOTEBOOK')).not.toBeInTheDocument()
  })

  it('…and the share is still saved while it waits', () => {
    auth = { user: null, isPaid: false, loading: true, authTransient: false }
    renderAt()
    expect(pending()).toMatchObject({ url: 'https://wsj.com/x' })
  })
})
