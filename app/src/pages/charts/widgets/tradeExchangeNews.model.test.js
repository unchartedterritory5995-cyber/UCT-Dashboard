// Trade Exchange News — pure model + settings + canonical theme integration.
// Synthetic headlines only.
import { describe, expect, it } from 'vitest'
import { coverageNotice, fmtReceived, liveStatus, matchesQuery, tokenize, viewHealth, visibleItems } from './tradeExchangeNewsModel'
import {
  TXN_WIDGET_DEFAULTS, mergeTxnWidgetSettings, txnSettingsFor, txnWidgetStyleVars,
} from './tradeExchangeNewsSettings'
import { mergeNewsWidgetSettings } from './newsWidgetSettings'
import { mergeWatchlistSettings, watchlistStyleVars } from '../../watchlist/watchlistSettings'
import { CHART_THEME_BY_ID, mapThemeToWidgetSettings, patchWidgetOptsWithTheme } from '../../../components/chart/chartThemes'
import { widgetOwnChrome } from '../widgetChrome'
import { contrastRatio } from '../../../lib/theme'

const item = (seq, content, tickers = []) => ({ seq, content, tickers })

describe('tokenize — clickable tickers only where the headline names them', () => {
  it('links $CASHTAGS and bare upper-case symbols, keeps everything else verbatim', () => {
    const parts = tokenize('SYNTHETIC: $NVDA and AMD rally; Apple flat', ['NVDA', 'AMD', 'AAPL'])
    expect(parts.map((p) => p.text).join('')).toBe('SYNTHETIC: $NVDA and AMD rally; Apple flat')
    expect(parts.filter((p) => p.sym).map((p) => [p.text, p.sym])).toEqual([['$NVDA', 'NVDA'], ['AMD', 'AMD']])
  })
  it('handles class shares in either spelling and never matches inside a word', () => {
    const parts = tokenize('SYNTHETIC BRK.B and BRK-B; AMDOCS unrelated', ['BRK-B', 'AMD'])
    expect(parts.filter((p) => p.sym).map((p) => p.sym)).toEqual(['BRK-B', 'BRK-B'])
  })
  it('no tickers or no content is a single text segment', () => {
    expect(tokenize('SYNTHETIC plain', [])).toEqual([{ text: 'SYNTHETIC plain' }])
    expect(tokenize('', ['NVDA'])).toEqual([{ text: '' }])
  })
})

describe('filters', () => {
  const items = [item(1, 'SYNTHETIC alpha', ['NVDA']), item(2, 'SYNTHETIC beta guidance', ['AMD']),
    item(3, 'SYNTHETIC gamma', ['NVDA', 'TSLA'])]
  it('newest first, search is case-insensitive over text and exact over tickers', () => {
    expect(visibleItems(items).map((i) => i.seq)).toEqual([3, 2, 1])
    expect(visibleItems(items, { query: 'GUIDANCE' }).map((i) => i.seq)).toEqual([2])
    expect(visibleItems(items, { query: '$tsla' }).map((i) => i.seq)).toEqual([3])
    expect(matchesQuery(items[0], '  ')).toBe(true)
  })
  it('linked symbol and watchlist filters compose', () => {
    expect(visibleItems(items, { linkedSym: 'NVDA' }).map((i) => i.seq)).toEqual([3, 1])
    expect(visibleItems(items, { watchSet: new Set(['AMD', 'TSLA']) }).map((i) => i.seq)).toEqual([3, 2])
    expect(visibleItems(items, { linkedSym: 'NVDA', watchSet: new Set(['TSLA']) }).map((i) => i.seq)).toEqual([3])
    expect(visibleItems(items, { watchSet: new Set() })).toEqual([])
  })
})

describe('status, time and coverage words', () => {
  it('live status says it is UCT\'s connection, not Trade Exchange\'s', () => {
    const now = 1_800_000_100_000
    const s = liveStatus({ status: 'live', lastHeadlineAt: now - 120_000 }, now)
    expect(s).toMatchObject({ tone: 'live', label: 'Live' })
    expect(s.title).toMatch(/last headline 2m ago/)
    expect(s.title).toMatch(/cannot tell whether Trade Exchange itself is publishing/)
    expect(liveStatus({ status: 'reconnecting' }).tone).toBe('warn')
    expect(liveStatus({ status: 'unavailable', reason: 'admin_only' }).label).toBe('Admin preview')
  })
  it('receipt time is ET, with the day when it is not today', () => {
    const ms = Date.UTC(2026, 9, 27, 13, 31, 5)          // 9:31:05 AM ET
    expect(fmtReceived(ms, ms + 1000)).toBe('9:31:05 AM')
    expect(fmtReceived(ms, ms + 2 * 86400000)).toBe('10/27/2026, 9:31:05 AM ET')
  })
  it('a coverage gap becomes a plain-language warning; complete coverage is silent', () => {
    expect(coverageNotice({ complete: true, gaps: [] })).toBeNull()
    const n = coverageNotice({ gaps: [{ from_ms: Date.UTC(2026, 9, 27, 13, 0), to_ms: Date.UTC(2026, 9, 27, 14, 0), reason: 'journal_unreachable' }] },
      Date.UTC(2026, 9, 27, 15, 0))
    expect(n.text).toBe('Headlines may be missing between 9:00:00 AM and 10:00:00 AM')
    expect(n.title).toMatch(/could not be reached/)
  })
})

describe('settings — the News & Catalysts shape, plus behaviour', () => {
  it('sound is muted by default and garbled values fall back', () => {
    expect(TXN_WIDGET_DEFAULTS.sound).toBe('off')
    const s = mergeTxnWidgetSettings({ density: 'huge', sound: 'loud', soundKey: 'nope', bgGradient: { top: '#111111' } })
    expect(s).toMatchObject({ density: 'comfortable', sound: 'off', soundKey: 'ding' })
    expect(s.bgGradient).toEqual({ top: '#111111', bottom: TXN_WIDGET_DEFAULTS.bgGradient.bottom })
  })
  it('an uncustomised widget uses its PLACED theme; a saved blob wins over it', () => {
    expect(txnSettingsFor(null, 'light').bg).toBe('#ffffff')
    expect(txnSettingsFor(null, 'dark').bg).toBe(TXN_WIDGET_DEFAULTS.bg)
    expect(txnSettingsFor({ bg: '#123456' }, 'light').bg).toBe('#123456')
  })
  it('row text, dividers and hover follow the Watchlist derivation from the canvas', () => {
    for (const bg of [TXN_WIDGET_DEFAULTS.bg, '#203040', '#ffffff']) {
      const ours = txnWidgetStyleVars(mergeTxnWidgetSettings({ bg }))
      const wl = watchlistStyleVars(mergeWatchlistSettings({ bg }))
      expect(ours['--txn-text']).toBe(wl['--wl-sym'])
      expect(ours['--txn-divider']).toBe(wl['--wl-divider'])
      expect(ours['--txn-row-divider']).toBe(wl['--wl-divider-strong'])
      expect(ours['--txn-row-hover']).toBe(wl['--wl-row-hover'])
    }
  })
  it("the canvas always comes from the widget's own (placed-theme) settings, like Watchlist", () => {
    expect(txnWidgetStyleVars(txnSettingsFor(null, 'dark'))['--txn-bg']).toBe(TXN_WIDGET_DEFAULTS.bg)
    const light = txnWidgetStyleVars(txnSettingsFor(null, 'light'))
    expect([light['--txn-bg'], light['--txn-text']]).toEqual(['#ffffff', '#1f2328'])   // never pale-on-white
    expect(txnWidgetStyleVars(mergeTxnWidgetSettings({ bg: '#203040' }))['--txn-bg']).toBe('#203040')
    const grad = txnWidgetStyleVars(mergeTxnWidgetSettings({ bgMode: 'gradient', bgGradient: { top: '#111111', bottom: '#222222' } }))
    expect(grad['--txn-bg']).toBe('linear-gradient(to bottom, #111111 0%, #222222 100%)')
  })
  it('ticker up/down TEXT clears 4.5:1 on its own canvas; the theme colour itself is untouched', () => {
    const light = mergeTxnWidgetSettings({ bg: '#ffffff', upColor: '#3fbf7f', downColor: '#ff6b6b' })
    const v = txnWidgetStyleVars(light)
    expect(v['--txn-up']).toBe('#3fbf7f')                       // status dot / highlight: raw theme colour
    expect(contrastRatio(v['--txn-sym-up'], '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(v['--txn-sym-down'], '#ffffff')).toBeGreaterThanOrEqual(4.5)
    const dark = txnWidgetStyleVars(txnSettingsFor(null, 'dark'))
    expect(dark['--txn-sym-up']).toBe(dark['--txn-up'])         // already readable: unchanged
    const grad = txnWidgetStyleVars(mergeTxnWidgetSettings({ bgMode: 'gradient', upColor: '#3fbf7f',
      bgGradient: { top: '#ffffff', bottom: '#f0f0f0' } }))
    expect(contrastRatio(grad['--txn-sym-up'], '#f0f0f0')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('canonical theme integration (theme gallery + Apply to all + frame)', () => {
  const theme = CHART_THEME_BY_ID['midnight-navy'] || Object.values(CHART_THEME_BY_ID)[1]
  it('the widget gallery patches the same colour keys it patches on News & Catalysts', () => {
    const base = mergeTxnWidgetSettings({ density: 'compact', sound: 'on' })
    const ours = mapThemeToWidgetSettings(base, theme, 'tradeExchangeNews')
    const theirs = mapThemeToWidgetSettings(mergeNewsWidgetSettings({}), theme, 'news')
    for (const k of ['bg', 'bgMode', 'textColor', 'headerColor', 'upColor', 'downColor']) expect(ours[k]).toEqual(theirs[k])
    expect(ours).toMatchObject({ density: 'compact', sound: 'on' })     // behaviour survives a theme
  })
  it('"Apply to all widgets" reaches this type (per-widget opts.settings)', () => {
    const out = patchWidgetOptsWithTheme('tradeExchangeNews', { follow: false, settings: { density: 'compact' } }, theme)
    expect(out.follow).toBe(false)
    expect(out.settings.bg).toBe(theme.bgGradient ? theme.bgGradient.bottom : theme.bg)
    expect(out.settings.density).toBe('compact')
  })
  it('the workspace frame follows a customised canvas like every simple-canvas widget', () => {
    expect(widgetOwnChrome({ type: 'tradeExchangeNews', opts: {} })).toBeNull()
    const chrome = widgetOwnChrome({ type: 'tradeExchangeNews', opts: { settings: { bg: '#203040' } } })
    const sibling = widgetOwnChrome({ type: 'news', opts: { settings: { bg: '#203040' } } })
    expect(chrome).toEqual(sibling)
    expect(chrome).not.toBeNull()
  })
})

describe('daily-performance tones, tooltips and the bounded quote set', () => {
  it('tone follows the change vs prior close; missing or stale is neutral', async () => {
    const { tickerTone } = await import('./tradeExchangeNewsModel')
    expect(tickerTone({ change_pct: 1.2 })).toBe('up')
    expect(tickerTone({ change_pct: -0.01 })).toBe('down')
    expect(tickerTone({ change_pct: 0 })).toBe('flat')
    expect(tickerTone(undefined)).toBe('none')
    expect(tickerTone({ change_pct: NaN })).toBe('none')
    expect(tickerTone({ change_pct: 3 }, true)).toBe('none')
  })

  it('quote symbols are distinct, newest rows first, and capped', async () => {
    const { quoteSymbols, QUOTE_SYMBOL_CAP } = await import('./tradeExchangeNewsModel')
    const rows = Array.from({ length: 400 }, (_, i) => ({ tickers: [`S${i}`, 'AAPL'] }))
    const got = quoteSymbols(rows)
    expect(got).toHaveLength(QUOTE_SYMBOL_CAP)
    expect(got.slice(0, 3)).toEqual(['S0', 'AAPL', 'S1'])
    expect(new Set(got).size).toBe(got.length)
  })

  it('names link exactly as written, several per headline, with no overlap', async () => {
    const { tokenize } = await import('./tradeExchangeNewsModel')
    const parts = tokenize('Microsoft and NVDA rally; Rocket Lab too', ['MSFT', 'NVDA', 'RKLB'],
      [['Microsoft', 'MSFT'], ['Rocket Lab', 'RKLB']])
    expect(parts.filter((p) => p.sym).map((p) => [p.text, p.sym])).toEqual(
      [['Microsoft', 'MSFT'], ['NVDA', 'NVDA'], ['Rocket Lab', 'RKLB']])
    expect(parts.map((p) => p.text).join('')).toBe('Microsoft and NVDA rally; Rocket Lab too')
  })
})

describe('viewHealth (the LIVE popover lines that left the footer)', () => {
  it('says the count, the ET receipt times, provisional tickers and what is hidden as graphic-only', () => {
    const l = Object.fromEntries(viewHealth({ dateLabel: 'Fri, Oct 30', count: '12 headlines', provisional: true, hidden: 3 })
      .map((x) => [x.key, x.value]))
    expect(l.view).toBe('12 headlines · Fri, Oct 30 (ET)')
    expect(l.times).toMatch(/received each headline, in ET/)
    expect(l.tickers).toMatch(/provisional/)
    expect(l.graphic).toMatch(/^3 hidden/)
    expect(Object.fromEntries(viewHealth({ hidden: 0 }).map((x) => [x.key, x.value])).graphic).toBe('None hidden in this view')
    expect(Object.fromEntries(viewHealth({ hidden: 5, showing: true }).map((x) => [x.key, x.value])).graphic).toMatch(/^Shown/)
  })
})
