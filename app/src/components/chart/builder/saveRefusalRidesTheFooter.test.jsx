// app/src/components/chart/builder/saveRefusalRidesTheFooter.test.jsx
//
// ─── ⛔⛔ A REFUSAL A MEMBER CANNOT REACH IS STILL A SILENCE (2026-09-18) ─────
//
// The store's refusal on the Save path was rendered — `role="alert"`, its own
// testid, the store's own wording, everything this repo asks of a refusal — and
// it was rendered in the ONE place it could not do its job: in the scrolling
// body, BELOW the whole pasted source. On `uncharted-clouds.pine` that is 9,811
// characters of listing between the button a member just pressed and the
// sentence explaining why nothing happened.
//
// ⭐ THE SHEET'S OWN COMMENT ALREADY STATED THE RULE, one element over. When
// `.actions` was made sticky by itself (2026-08-11) the buttons pinned and the
// two lines that EXPLAIN them scrolled away underneath: "Cancel/Save sitting on
// top of 'Discard this formula?' with its buttons peeking out below and
// unreachable". The fix was to make the whole `.footer` sticky so it carries
// whatever it is answering. The store refusal was never moved in with it.
//
// ⛔ THE ASSERTION IS CONTAINMENT, NOT VISIBILITY. jsdom performs no layout, so
// "is it on screen" is a question it cannot answer and a test that pretended to
// ask it would be measuring nothing (`lesson_did_it_render_needs_the_products_
// own_answer`). What IS structural, and is exactly the property that was wrong,
// is WHICH container the sentence lives in: the sticky one that travels with the
// control, or the scrolling one that does not.
//
// ⛔ AND THE CONTAINER IS FOUND FROM THE BUTTON, not from a hard-coded class
// name. `styles.footer` is a CSS-module hash; naming it here would pin a build
// artifact. `saveButton.closest('[class*="footer"]')` asks the question the
// member's eye asks — *is the explanation in the same box as the control?* — and
// it goes red for the right reason if that box is ever renamed away.
//
// ⚠️ NOT MOVED, DELIBERATELY: `list-error` (the saved-formulas list failed to
// load — it answers the list below, not the button) and `saved-note` (the
// success line; since j.5 the chart door CLOSES on a successful save, so there
// is no longer a member standing in front of it). One concern, one move.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'

import BuilderSheet from './BuilderSheet'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { AuthContext } from '../../../context/AuthContext'

const REPO = path.resolve(__dirname, '../../../../..')
const CLOUDS = fs.readFileSync(
  path.join(REPO, 'tests/fixtures/member/uncharted-clouds.pine'), 'utf8',
)

const REFUSAL = 'That script is too large to store.'

const H = vi.hoisted(() => ({ requests: [] }))
function stubFetch() {
  H.requests = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    // Every write is refused, with the store's own sentence.
    return { ok: false, status: 413, json: async () => ({ detail: REFUSAL }) }
  })
}
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet
          open
          onClose={() => {}}
          onSaved={() => {}}
          settings={null}
          onChange={() => {}}
          sym="SPY"
          tf="D"
        />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const saveBtn = () => screen.getByRole('button', { name: /^Sav/ })
const nameBox = () => document.getElementById('uct-formula-name')

beforeEach(() => {
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.useFakeTimers()
  stubFetch()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('a refused save explains itself where the member is looking', () => {
  it('⭐⭐ the store\'s refusal renders inside the sticky footer, beside the button that produced it', async () => {
    mount()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'close > sma(close, 20)' } })
    })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
    await flush()
    fireEvent.change(nameBox(), { target: { value: 'Twenty bar average' } })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
    await flush()

    expect(saveBtn().disabled).toBe(false)
    fireEvent.click(saveBtn())
    await flush(); await flush()

    // The refusal exists and is the STORE's sentence, not a paraphrase.
    const err = screen.getByTestId('store-error')
    expect(err.textContent).toContain(REFUSAL)

    // ⛔ NON-VACUITY. A null container satisfies nothing, and `contains` on a
    // missing node would throw rather than fail informatively — so the box is
    // found first and proved to be the box that holds the control.
    const footer = saveBtn().closest('[class*="footer"]')
    expect(footer).toBeTruthy()
    expect(footer.contains(saveBtn())).toBe(true)

    expect(footer.contains(err)).toBe(true)
  })

  it('⛔ the attach door\'s refusal is unchanged — still beside its own button', async () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: /^import$/i }))
    fireEvent.change(screen.getByTestId('pine-box').querySelector('textarea'), { target: { value: CLOUDS } })
    await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
    await flush()

    const box = screen.getByTestId('pine-member-pane-attach')
    fireEvent.click(box.querySelector('button'))
    await flush(); await flush()

    // ⭐ THE CONTROL FOR THE MOVE. The pane's refusal was ALREADY adjacent to its
    // button; if this changes, the move went wider than the one element it was
    // supposed to touch.
    expect(box.textContent).toContain(REFUSAL)
    expect(box.contains(box.querySelector('button'))).toBe(true)
    expect(box.closest('[class*="footer"]')).toBeNull()
  })

  it('⛔ the LIST error stays where it is — it answers the list, not the button', async () => {
    // Only the refusal produced BY the Save button moves into the footer. A
    // second sentence riding the sticky bar would put two unrelated failures in
    // one place and make neither obviously about anything.
    const src = fs.readFileSync(path.join(__dirname, 'BuilderSheet.jsx'), 'utf8')
    const footerAt = src.indexOf('className={styles.footer}')
    const listErrAt = src.indexOf('data-testid="list-error"')
    expect(footerAt).toBeGreaterThan(-1)
    expect(listErrAt).toBeGreaterThan(-1)
    expect(listErrAt).toBeLessThan(footerAt)
  })
})
