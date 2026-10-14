import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import MoversRender, { bucketUp, pctSign, rowUp } from '../MoversRender'

// The Morning Wire's relative lanes ("Leading / Lagging the Market") are RELATIVE
// to SPY. A Leading name can itself be down (XLU -0.2% while SPY -1.8%), and the
// page used to colour every row by `b.key !== 'big_dn'`, printing that -0.2% GREEN.
// Rows now read their OWN sign; a flat/unparseable pct inherits the bucket.

const GREEN = 'rgb(34, 197, 94)'
const RED = 'rgb(239, 68, 68)'

function b64url(obj) {
  const s = btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function renderWith(buckets) {
  const url = `/r/movers?data=${b64url({ buckets })}`
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MoversRender />
    </MemoryRouter>,
  )
}

const pctColour = (txt) => screen.getByText(txt).style.color

describe('MoversRender row colour', () => {
  it('a Leading-the-Market name that is itself DOWN prints red, not green', () => {
    renderWith([
      { key: 'rel_up', title: 'Leading the Market', marker: '▲', lane: 'relative',
        items: [{ sym: 'XLU', pct: '-0.2%', news: 'utilities hold up', has_why: true },
                { sym: 'GLD', pct: '+0.6%', news: 'gold bid', has_why: true }] },
    ])
    expect(pctColour('-0.2%')).toBe(RED)
    expect(pctColour('+0.6%')).toBe(GREEN)
  })

  it('a Lagging name sent as big_dn + lane:relative that is itself UP prints green', () => {
    renderWith([
      { key: 'big_dn', lane: 'relative', title: 'Lagging the Market', marker: '▼',
        items: [{ sym: 'NVDA', pct: '+0.1%', news: 'x', has_why: true },
                { sym: 'TSLA', pct: '-4.1%', news: 'y', has_why: true }] },
    ])
    expect(pctColour('+0.1%')).toBe(GREEN)
    expect(pctColour('-4.1%')).toBe(RED)
  })

  it('accepts rel_dn as a red (down) bucket', () => {
    renderWith([
      { key: 'rel_dn', title: 'Lagging the Market', marker: '▼',
        items: [{ sym: 'AAPL', pct: '0.0%', news: 'flat', has_why: true }] },
    ])
    // flat -> inherits the bucket direction (red for a down bucket)
    expect(pctColour('0.0%')).toBe(RED)
    expect(screen.getByText('▼').style.color).toBe(RED)
  })

  it('existing buckets render identically (all green up, all red down)', () => {
    renderWith([
      { key: 'small_up', title: 'Top Small-Cap Positive', marker: '▲',
        items: [{ sym: 'ABCD', pct: '+22.4%', news: 'a', has_why: true }] },
      { key: 'big_up', title: 'Top Big-Cap Positive', marker: '▲',
        items: [{ sym: 'MSFT', pct: '+3.1%', news: 'b', has_why: true }] },
      { key: 'big_dn', title: 'Top Big-Cap Negative', marker: '▼',
        items: [{ sym: 'META', pct: '-5.5%', news: 'c', has_why: true }] },
    ])
    expect(pctColour('+22.4%')).toBe(GREEN)
    expect(pctColour('+3.1%')).toBe(GREEN)
    expect(pctColour('-5.5%')).toBe(RED)
  })

  it('two buckets sharing key big_dn both render (no React key collision)', () => {
    renderWith([
      { key: 'big_dn', title: 'Top Big-Cap Negative', marker: '▼',
        items: [{ sym: 'META', pct: '-5.5%', news: 'c', has_why: true }] },
      { key: 'big_dn', lane: 'relative', title: 'Lagging the Market', marker: '▼',
        items: [{ sym: 'TSLA', pct: '-4.1%', news: 'y', has_why: true }] },
    ])
    expect(screen.getByText('Top Big-Cap Negative')).toBeInTheDocument()
    expect(screen.getByText('Lagging the Market')).toBeInTheDocument()
  })
})

describe('MoversRender helpers', () => {
  it('pctSign parses signed strings, numbers, the unicode minus; flat/garbage is null', () => {
    expect(pctSign('+3.4%')).toBe(true)
    expect(pctSign('-0.2%')).toBe(false)
    expect(pctSign('−0.8%')).toBe(false)
    expect(pctSign(1.5)).toBe(true)
    expect(pctSign(-1.5)).toBe(false)
    expect(pctSign('0.0%')).toBe(null)
    expect(pctSign('n/a')).toBe(null)
    expect(pctSign(undefined)).toBe(null)
  })

  it('bucketUp honours an explicit dir over the key, and keeps unknown keys up', () => {
    expect(bucketUp({ key: 'big_dn' })).toBe(false)
    expect(bucketUp({ key: 'rel_dn' })).toBe(false)
    expect(bucketUp({ key: 'rel_up' })).toBe(true)
    expect(bucketUp({ key: 'something_new' })).toBe(true)
    expect(bucketUp({ key: 'rel_up', dir: 'dn' })).toBe(false)
    expect(bucketUp({ key: 'big_dn', dir: 'up' })).toBe(true)
  })

  it('rowUp falls back to the bucket only when the row has no sign', () => {
    expect(rowUp({ pct: '-0.2%' }, true)).toBe(false)
    expect(rowUp({ pct: '+0.2%' }, false)).toBe(true)
    expect(rowUp({ pct: '0%' }, false)).toBe(false)
    expect(rowUp({}, true)).toBe(true)
  })
})
