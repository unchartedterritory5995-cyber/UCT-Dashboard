// 🔴 W11-R87 — A DOOR THAT MOUNTS THE SHEET WITH A DRAFT PAINTS THE DRAFT, NOT AN EMPTY BOX.
//
// ScanObjectCard mounts a FRESH BuilderSheet with `open` and an `initialDraft`. The open-reset is a passive effect,
// so if `source` started as '' the first paint showed an empty Formula field and the draft arrived a frame later.
// `ScanObjectCard.test.jsx` read that field the moment it appeared and went red whenever its `findByLabelText`
// resolved between the commit and the effect flush (a cold lazy chunk under load). That read was timing-dependent;
// this one is not: a parent's layout effect runs after the sheet's DOM is committed and BEFORE any passive effect,
// so it sees exactly the first paint.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { AuthContext } from '../../../context/AuthContext'

const DRAFT = '(close > sma(close, 50))'
const noop = () => {}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ definitions: [] }) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function FirstPaintProbe({ onFirstPaint, children }) {
  useLayoutEffect(() => {
    const field = screen.queryByLabelText('Formula')
    onFirstPaint(field ? field.value : null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return children
}

function mountWith(props) {
  const seen = []
  render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <FirstPaintProbe onFirstPaint={(v) => seen.push(v)}>
          <BuilderSheet open onClose={noop} {...props} />
        </FirstPaintProbe>
      </SWRConfig>
    </AuthContext.Provider>,
  )
  return seen
}

describe('🔴 the first paint of a sheet mounted with a draft', () => {
  it('already holds the draft in the Formula field (the picker tab ScanObjectCard opens on)', () => {
    const seen = mountWith({ initialMode: 'picker', initialDraft: { source: DRAFT } })
    expect(seen).toEqual([DRAFT])
    // …and the settled sheet agrees: the open-reset wrote the same value, it did not replace it.
    expect(screen.getByLabelText('Formula')).toHaveValue(DRAFT)
  })

  it('CONTROL: with no draft the first paint is the empty box, so the probe can tell the two apart', () => {
    const seen = mountWith({ initialMode: 'picker' })
    expect(seen).toEqual([''])
  })

  it('a blank draft is not a draft: the box starts empty', () => {
    const seen = mountWith({ initialMode: 'picker', initialDraft: { source: '   ' } })
    expect(seen).toEqual([''])
  })
})
