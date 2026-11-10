// ── RAILS: the chart-key family (guide/keys.js) ─────────────────────────────────────────────────────────────────────────
// Every key the chart declares (components/chart/keyboardShortcuts.js SHORTCUTS) is a row; its card names the key EXACTLY as
// declared and says to click the chart first; a Ctrl key also names ⌘ (the chart reads ctrlKey || metaKey); Esc says when it
// works. Words that are not about a key never reach the family. Answering a key question writes nothing and presses nothing.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { guideSteps } from './capabilities/guide'
import { SHORTCUTS, matchShortcut } from '../components/chart/keyboardShortcuts'
import { CHART_KEY_ACTIONS, keyAsSaid } from './guide/keys'

beforeAll(() => { registerBuiltins() })
const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })

describe('chart keys: one row per declared key, the key said exactly', () => {
  const taught = SHORTCUTS.filter(s => s.keys !== '+ / -')
  it('every declared key but zoom (taught by chartView) has exactly one row', () => {
    expect(CHART_KEY_ACTIONS.map(r => r.id).sort()).toEqual(taught.map(s => `key.${s.command}`).sort())
  })
  it.each(taught.map(s => [s.keys, s]))('%s: the card names it as declared, on the chart', (_k, s) => {
    const row = CHART_KEY_ACTIONS.find(r => r.id === `key.${s.command}`)
    expect(row.label).toBe(`${s.description} (${s.keys})`)
    expect(row.steps).toHaveLength(1)
    expect(row.steps[0].target).toBe('chart.plot')
    expect(row.steps[0].text).toContain(`Click the chart, then press ${s.keys}`)
  })
  it('a Ctrl key also names ⌘ on a Mac; Alt and Shift are said as they are', () => {
    expect(keyAsSaid('Ctrl+M')).toBe('Ctrl+M (⌘M on a Mac)')
    expect(keyAsSaid('Alt+Shift+A')).toBe('Alt+Shift+A')
    expect(CHART_KEY_ACTIONS.find(r => r.id === 'key.toggle:volume').steps[0].text).toContain('Ctrl+V (⌘V on a Mac)')
  })
  // ⭐ the ⌘ substitution is earned per key, not granted by the word "Ctrl": a card may say ⌘ only for a key the chart's own
  // matcher answers under metaKey exactly as under ctrlKey. A handler that checks ctrlKey alone (Ctrl+Alt+J, CWID's Journal
  // capture) must get no Mac substitution: declaring it in SHORTCUTS as-is fails here, which is the point (findings C3-223 (b)).
  it('every card that says ⌘ names a key the chart matches under metaKey exactly as under ctrlKey', () => {
    const macRows = CHART_KEY_ACTIONS.filter(r => r.steps[0].text.includes('on a Mac)'))
    expect(macRows.length).toBeGreaterThan(0)
    for (const r of macRows) {
      const s = SHORTCUTS.find(x => `key.${x.command}` === r.id)
      const parts = s.keys.split('+')
      const key = parts.at(-1).toLowerCase()
      const mods = { altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift') }
      const asCtrl = matchShortcut({ key, ctrlKey: true, metaKey: false, ...mods })
      const asCmd = matchShortcut({ key, ctrlKey: false, metaKey: true, ...mods })
      expect(asCtrl, s.keys).toBeTruthy()
      expect(asCmd, s.keys).toEqual(asCtrl)
    }
  })
  it('Esc says it works while a drawing tool is armed', () => {
    expect(CHART_KEY_ACTIONS.find(r => r.id === 'key.tool:cursor').steps[0].text).toMatch(/while a drawing tool is armed/)
  })
})

describe('chart keys: reached only by words about a key', () => {
  it.each([
    ['what does Ctrl+M do', 'Toggle moving averages (Ctrl+M)'],
    ['what is the shortcut for the eraser', 'Eraser (click to delete) (Alt+Shift+E)'],
    ['which key opens chart settings', 'Open chart settings (Alt+,)'],
    ['what does ? do', 'Show this help overlay (?)'],
    ['how do I use the Alt+T shortcut', 'Trendline (Alt+T)'],
    ['what does Alt+J do', 'Horizontal ray (Alt+J)'],
    ['what does Alt + Shift + E do', 'Eraser (click to delete) (Alt+Shift+E)'],
  ])('%s → %s', (q, title) => {
    const g = route(q)
    expect(g?.feature).toBe('chartKey')
    expect(guideSteps(guideFeature(g.feature), g.detail || q).title).toBe(title)
  })
  it.each([
    'what are the key levels on NVDA',
    'what is a key reversal',
    'is there a press release for AAPL',
    'what does RSI mean',
    'what is the daily chart',
    // a chord the chart does not declare is no row, not the declared chord inside it (C3-223's Ctrl+Alt+J is not Alt+J)
    'what does Ctrl+Alt+J do',
    'how do I toggle the journal shortcut (Ctrl+Alt+J)',
  ])('not a key question: %s', (q) => {
    expect(route(q)?.feature).not.toBe('chartKey')
  })
})

describe('chart keys: several keys at once are not one key card', () => {
  it('the indicator chords asked together stay with the chart row that lists them all (C2-010)', () => {
    const g = route('how do I keyboard chord toggles RSI, MACD, BB, VWAP')
    expect(g?.feature).not.toBe('chartKey')
    expect(route('what is the keyboard shortcut for RSI')?.feature).toBe('chartKey')
  })
})

describe('chart keys: answering writes nothing and presses nothing', () => {
  it('a key walkthrough calls no writer on the host and dispatches no key event', async () => {
    const calls = []
    const deep = (path) => new Proxy(function () {}, {
      get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => path : deep(`${path}.${String(k)}`)),
      apply: (_t, _this, args) => { calls.push(path); return path.endsWith('list') ? [] : null },
    })
    const host = new Proxy({ surface: 'charts' }, { get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : deep(String(k))) })
    const keySpy = vi.fn()
    window.addEventListener('keydown', keySpy, true); document.addEventListener('keydown', keySpy, true)
    try {
      const cap = getCapability('guide.show')
      const args = cap.fast({ raw: 'what is the keyboard shortcut for log scale', host })
      expect(args.feature).toBe('chartKey')
      await cap.answer(null, args, host, null)
    } finally {
      window.removeEventListener('keydown', keySpy, true); document.removeEventListener('keydown', keySpy, true)
    }
    expect(calls.filter(c => /(set|add|remove|apply|dispatch|write|save|toggle|create|delete|press|run|exec|update|mutate)/i.test(c.split('.').pop()))).toEqual([])
    expect(keySpy).not.toHaveBeenCalled()
  })
})
