// THE VERDICT ON A SHARED INDICATOR (sharedVerdict.js; Studio lane R4, backlog 43).
//
// The server sends the saved row's own verdict; the page says it in one line under the name and
// draws nothing when there is none. Nothing here computes a verdict.
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { sharedVerdict } from './sharedVerdict'
import SharedFormula from './SharedFormula'
import { SHARED_FORMULA_ROUTE, sharedFormulaPath } from './formulaShareLink'

afterEach(() => { cleanup(); vi.restoreAllMocks(); delete global.fetch })

describe('the line', () => {
  it('says the author\'s sentence and the engine it was checked on', () => {
    expect(sharedVerdict({ headline: 'Runs fully', engine_version: 'e67' })).toEqual({
      headline: 'Runs fully', checked: 'checked on engine e67', earlier: false,
      sentence: 'Runs fully, checked on engine e67.',
    })
    expect(sharedVerdict({ headline: 'Runs fully', engine_version: 'e67', headline_current: true }).earlier).toBe(false)
  })

  it('says so when the engine has moved on, and only when the server says it has', () => {
    const v = sharedVerdict({ headline: 'Runs on charts, 2 values withheld (not guessed)', engine_version: 'e61', headline_current: false })
    expect(v.earlier).toBe(true)
    expect(v.sentence).toBe("Runs on charts, 2 values withheld (not guessed), checked on engine e61, an earlier engine than today's.")
    // no stamp, but the server says it is not current
    expect(sharedVerdict({ headline: 'Runs fully', headline_current: false }).sentence)
      .toBe("Runs fully, checked on an earlier engine than today's.")
    // absent is not false
    expect(sharedVerdict({ headline: 'Runs fully', engine_version: 'e67', headline_current: null }).earlier).toBe(false)
  })

  it('⛔ no headline, no line: nothing for a row with no stored verdict', () => {
    for (const row of [null, undefined, {}, { headline: null, engine_version: null }, { headline: '   ' },
      { engine_version: 'e67' }, { headline: 7 }]) {
      expect(sharedVerdict(row), JSON.stringify(row)).toBeNull()
    }
    // CONTROL: a headline alone is a line, without an engine clause
    expect(sharedVerdict({ headline: 'Runs fully' }).sentence).toBe('Runs fully.')
  })
})

describe('on the share preview page', () => {
  // built, not written out: a made-up token typed as one literal reads as a key to the secret scan
  const TOKEN = `sh_${'0123456789abcdef'.repeat(2)}`
  const BODY = {
    definition: { meta: { name: 'Leaders pulling back' }, repaint: 'non-repainting',
      compute: { kind: 'ast', scanPlot: 'value', source: 'close > ema(close, 20)' } },
    origin_version: 3,
  }
  const open = (extra) => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...BODY, ...extra }) }))
    render(
      <MemoryRouter initialEntries={[sharedFormulaPath(TOKEN)]}>
        <Routes><Route path={SHARED_FORMULA_ROUTE} element={<SharedFormula />} /></Routes>
      </MemoryRouter>,
    )
  }

  it('one line directly under the name, above everything else, in words', async () => {
    open({ headline: 'Runs fully', engine_version: 'e67', headline_current: true })
    const line = await screen.findByTestId('shared-formula-verdict')
    expect(line.textContent).toBe('Runs fully, checked on engine e67')
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.nextElementSibling).toBe(line)                          // directly under the name
    const install = screen.getByTestId('shared-formula-install')
    expect(line.compareDocumentPosition(install) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()   // above Install
  })

  it('an earlier engine is said in the line', async () => {
    open({ headline: 'Runs fully', engine_version: 'e61', headline_current: false })
    expect((await screen.findByTestId('shared-formula-verdict')).textContent)
      .toBe("Runs fully, checked on engine e61, an earlier engine than today's")
  })

  it('⛔ a row with no verdict draws no line at all', async () => {
    open({ headline: null, engine_version: null })
    await waitFor(() => expect(screen.getByTestId('shared-formula')).toBeInTheDocument())
    expect(screen.queryByTestId('shared-formula-verdict')).toBeNull()
    // and today's server, which sends neither field, is the same page as before
    cleanup()
    open({})
    await waitFor(() => expect(screen.getByTestId('shared-formula')).toBeInTheDocument())
    expect(screen.queryByTestId('shared-formula-verdict')).toBeNull()
  })
})
