// #988 (AUDIT probe 2 blocker, LOCAL / SIMULATED): a clause that says where the PRICE is ("it is right above support", "it's
// sitting on support", "this one, which is below resistance, …") is no exclusion of the click. On 91cf48dc79 STAY_CLICK
// (spatialCheck.js) read the comma clause "it is right above support" as "the click is fine as it is" (bare "it" subject +
// "right" adjective, then any words), so the click was dropped and the member was told "You said not the chart you clicked…"
// with no negation in the words. The rails:
//   (a) the probe-2 case applies on the click;
//   (b) the family: a stative / positional clause about the clicked chart or its price, with NO negation word, applies the
//       change to the click (pure: negatedClick() never excludes; panel: the plan on the click is applied, nothing asked);
//   (c) "You said not …" never appears unless the words have a negation word;
//   (d) the real stay-clauses ("the one I clicked stays daily…") still keep the click as it is, and AUDIT's controls hold.
// LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
const { registerBuiltins } = await import('./builtins')
const { setupPanel, bareSettings } = await import('./testing/panelHarness')
const { negatedClick } = await import('./spatialCheck')
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// board: c0 TL SPY · c1 TR QQQ · c2 BL NVDA · c3 BR TSLA
const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
const WIDGETS = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA' }
const transcript = () => screen.getByTestId('agent-transcript').textContent
const tfs = (b) => WIDGETS.map(w => (b.state.widgets.find(x => x.id === w.id).opts?.tf || 'D')).join('')
const logged = (b) => b.state.widgets.filter(x => x.opts?.settings?.logScale).map(x => x.id).sort()
const ref = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
const weeklyOn = (...ids) => (body) => p.env('apply', ids.map(id => ({ action: 'chart.setTimeframe', target: ref(body, id), args: { timeframe: 'W' } })))
const logOn = (...ids) => (body) => p.env('apply', ids.map(id => ({ action: 'chart.setScale', target: ref(body, id), args: { scale: 'log' } })))
const run = async (text, clicked, plan) => {
  const m = p.mount(WIDGETS, SYMS, { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }) })
  if (clicked) p.select(clicked)
  p.st.envelopes.push(plan)
  await m.say(text)
  return { tf: tfs(m.board), log: logged(m.board), t: transcript() }
}
const NEG_WORD = /\b(?:not|never|except|excluding|besides|minus|other\s+than|instead\s+of|rather\s+than|apart\s+from|aside\s+from|save\s+for)\b|n['’]t\b/i
const ASKED = /Which chart|Did you mean|Which charts|Pick one|You said not|leave out/i
// (c) every panel run in this file goes through here: "You said not" only with a negation word
const said = (text, t) => { if (/You said not/.test(t)) expect(NEG_WORD.test(text), `"You said not" without a negation word: ${text}`).toBe(true) }

// ── (b) the family, pure: subject × verb × place × level never EXCLUDES the click ──
const SUBJ = ['it', 'this', 'here', 'this one', 'this chart', 'the clicked one', 'the one I clicked', 'the one I selected', "the chart I'm on"]
const VERB = ['is', "'s", 'sits', 'is sitting', 'stays', 'remains', 'is trading', 'is holding', 'is still', 'can stay', 'should stay']
const PLACE = ['right above', 'just below', 'under', 'near', 'right on', 'above', 'below', 'well above', 'at', 'on', 'around', 'just over', 'beneath', 'right at']
const LEVEL = ['support', 'resistance', 'the 50', 'the 200', 'its high', 'the 50 day', 'the 21 ema', 'the trend line', '$140', 'the 200 day moving average']
const sep = (s) => (/^'/.test(s) ? s : ` ${s}`)
const CLAUSES = SUBJ.flatMap(s => VERB.flatMap(v => PLACE.flatMap(pl => LEVEL.map(l => `${s}${sep(v)} ${pl} ${l}`))))
// …and a stock description after bare it / this / here (no place word at all): the subject is the stock, not the chart
const TREND = ['it stays strong', 'it remains in an uptrend', 'it stays in a range', 'this remains bullish', 'it stays tight', 'here it remains weak',
  'it is right', 'this is fine', "it's ok", 'it remains the leader', 'this stays above water']
const FRAMES = [(c) => `make it weekly, ${c}`, (c) => `${c}, make it weekly`, (c) => `log scale on this one, ${c}`]
const WHICH = VERB.filter(v => !/^'/.test(v)).flatMap(v => PLACE.flatMap(pl => LEVEL.map(l => `this one, which ${v} ${pl} ${l}, make it weekly`)))
describe('(b) pure: a price or stock clause never excludes the click', () => {
  it(`${CLAUSES.length} clauses × ${FRAMES.length} frames + ${TREND.length} stock descriptions + ${WHICH.length} which-clauses: negatedClick() never excludes`, () => {
    const bad = WHICH.filter(t => negatedClick(t).excludes)
    for (const c of [...CLAUSES, ...TREND]) for (const f of FRAMES) { const t = f(c); if (negatedClick(t).excludes) bad.push(t) }
    expect(bad.slice(0, 20), `${bad.length} excluded`).toEqual([])
  })
})

// ── (a) + (b) panel: AUDIT's forms and generalisations apply on the click, nothing asked ──
const APPLY_W = ['make it weekly, it is right above support', "make it weekly, it's sitting on support", 'this one, which is below resistance, make it weekly',
  'make it weekly, it is right below resistance', 'make this one weekly, it sits right on the 200', "weekly on this one, it's right above the 50",
  'make it weekly, this one is right above support', 'make it weekly, the one I clicked is just under resistance', 'make this one weekly, it stays above the 50',
  'make it weekly, this chart remains below the 200', 'make it weekly, it is right at support', 'make it weekly, it remains in an uptrend',
  'make it weekly, it stays strong', 'it is right above support, make it weekly', 'make it weekly, it is holding right on support',
  'make it weekly because it is right above support', 'make it weekly, the one I selected stays near its high']
describe('(a)/(b) a price clause about the clicked chart: the change applies on the click', () => {
  it.each(APPLY_W)('"%s" (c2 clicked, plan c2) → DDWD, nothing asked', async (text) => {
    const r = await run(text, 'c2', weeklyOn('c2'))
    said(text, r.t)
    expect(r.tf, r.t.slice(-200)).toBe('DDWD')
    expect(ASKED.test(r.t), r.t.slice(-200)).toBe(false)
  }, 40000)
  const APPLY_LOG = ['log scale, it is right above the 50', "log scale on this one, it's sitting on support", 'put this one on log scale, it stays below resistance',
    'this chart, which is right above the 200, log scale please', 'log scale here, it is just under its high']
  it.each(APPLY_LOG)('"%s" (c1 clicked, plan c1) → c1 on log, nothing asked', async (text) => {
    const r = await run(text, 'c1', logOn('c1'))
    said(text, r.t)
    expect(r.log, r.t.slice(-200)).toEqual(['c1'])
    expect(ASKED.test(r.t), r.t.slice(-200)).toBe(false)
  }, 40000)
})

// ── (d) the real stay-clauses keep the click as it is; AUDIT's controls ──
const STAY = ['the one I clicked stays daily; make the top-left weekly', 'make the top-left weekly, the one I clicked stays daily',
  'this one can stay as it is, make the top-left weekly', 'this chart is fine as it is; make the top-left weekly',
  'the one I selected stays the way it is, make the top-left weekly', "the chart I'm on is fine, make the top-left weekly",
  'make the top-left weekly; this one remains as it is', 'the clicked one is good as it is, make the top-left weekly',
  'the one I selected stays on a normal scale, make the top-left weekly', 'make the top-left weekly, this one is fine for now']
describe('(d) a real stay-clause keeps the click as it is', () => {
  it.each(STAY)('pure: "%s" excludes the click', (text) => { expect(negatedClick(text).excludes).toBe(true) })
  it.each(STAY)('"%s" (c3 clicked, plan c3) → the click is never applied', async (text) => {
    const r = await run(text, 'c3', weeklyOn('c3'))
    said(text, r.t)
    expect(r.tf[3], r.t.slice(-200)).toBe('D')
  }, 40000)
  it.each(STAY.slice(0, 6))('"%s" (c3 clicked, plan c0) → the top-left is applied', async (text) => {
    const r = await run(text, 'c3', weeklyOn('c0'))
    said(text, r.t)
    expect(r.tf, r.t.slice(-200)).toBe('WDDD')
  }, 40000)
  it('control: "keep this one daily, make the others weekly" (c3 clicked) applies on the others', async () => {
    const text = 'keep this one daily, make the others weekly'
    const r = await run(text, 'c3', weeklyOn('c0', 'c1', 'c2'))
    said(text, r.t)
    expect(r.tf, r.t.slice(-200)).toBe('WWWD')
  }, 40000)
  // the keep-at-a-setting family, said against the rest of the board: the click is kept, the others change
  const KEEP = ['keep this one daily', 'keep it daily', 'leave this chart on daily', 'keep the one I clicked on the daily', 'keep this one on a daily', 'keep it on the 5 minute']
  const REST = ['make the others weekly', 'put the rest on weekly', 'everything else weekly', 'make the other charts weekly', 'make all the others weekly']
  const KEEP_CASES = KEEP.flatMap(k => REST.map(r => `${k}, ${r}`)).concat(REST.slice(0, 2).map(r => `${r}, keep this one daily`), ['make the others weekly but keep this one daily'])
  it.each(KEEP_CASES)('pure: "%s" excludes the click', (text) => { expect(negatedClick(text).excludes).toBe(true) })
  it.each(KEEP_CASES.filter((_, i) => i % 4 === 0))('"%s" (c3 clicked, plan c0 c1 c2) → the others go weekly, the click stays', async (text) => {
    const r = await run(text, 'c3', weeklyOn('c0', 'c1', 'c2'))
    said(text, r.t)
    expect(r.tf, r.t.slice(-200)).toBe('WWWD')
  }, 40000)
  it.each(['keep it on log scale', 'keep this one on log', 'keep this chart on log scale please'])('control: "%s" alone (c1 clicked, plan c1) → applied on the click', async (text) => {
    const r = await run(text, 'c1', logOn('c1'))
    expect(r.log, r.t.slice(-200)).toEqual(['c1'])
  }, 40000)
  it('control: "make the one I selected stay on weekly" (c2 clicked) applies or asks, never elsewhere', async () => {
    const text = 'make the one I selected stay on weekly'
    const r = await run(text, 'c2', weeklyOn('c2'))
    said(text, r.t)
    expect(['DDWD', 'DDDD']).toContain(r.tf)
  }, 40000)
  it('control: "make it weekly, not daily" (c1 clicked) applies on the click', async () => {
    const text = 'make it weekly, not daily'
    const r = await run(text, 'c1', weeklyOn('c1'))
    expect(r.tf, r.t.slice(-200)).toBe('DWDD')
  }, 40000)
})

// ── (c) an exclusion with NO negation word is never told "You said not" ──
const NO_NEG = ['the one I clicked stays daily, make it weekly', 'this one is fine as it is, make it weekly', 'leave this one alone, make it weekly',
  'keep this chart as it is, weekly please', 'the one I selected stays as it is; put it on weekly']
describe('(c) "You said not …" only when the words have a negation word', () => {
  it.each(NO_NEG)('"%s" (c2 clicked, plan c2) → the click is not applied, and no "You said not"', async (text) => {
    const r = await run(text, 'c2', weeklyOn('c2'))
    expect(r.t, r.t.slice(-200)).not.toMatch(/You said not/)
    expect(r.tf[2], r.t.slice(-200)).toBe('D')
  }, 40000)
  it.each(['not this one, make it weekly', 'make it weekly, not the one I clicked'])('"%s" (c2 clicked, plan c2) → the click is not applied (negation present)', async (text) => {
    const r = await run(text, 'c2', weeklyOn('c2'))
    said(text, r.t)
    expect(r.tf[2], r.t.slice(-200)).toBe('D')
  }, 40000)
})
