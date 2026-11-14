// chartReplay.playback: ONE chart's bar replay (the toolbar's Replay / Time Machine bar), as vertical slices through the
// REAL panel (scripted model). Request → the chart named → the replay bar's own handler (StockChart replayDo, via
// ChartPane.viewDo 'replay') → read-back from getDateMeta().replay → the receipt, and Undo only where it is exact.
// The stand-in chart keeps the replay the way getDateMeta reports it and runs the SAME op semantics as StockChart
// replayDo (toggle at 70%, play / pause only when they change something, step and seek pause it); the real StockChart half
// is components/chart/pane/ChartPane.replayDoor.test.jsx. Routing (words, negatives, the replay-on bare words) at the bottom.
// (agentChartReplay.test.jsx is the OTHER replay: chart.replay, Tools → Replay Mode's cutoff.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO } from './testing/panelHarness'
import { getCapability } from './capabilities'
import { wordsSelect, selectGroups, groupOfAction } from './routing'
import { pendingLine } from './proposalWording'
import { REPLAY_ACTION, replayDone } from './capabilities/chartReplay'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const DAY = 86400000
const D0 = Date.UTC(2026, 0, 1)
const N = 100
const R = (args, target = 'c') => p.env('apply', [{ action: REPLAY_ACTION, target, args: { bars: null, date: null, speed: null, ...args } }])

/** Each chart's replay bar, by ref, as getDateMeta().replay reports it. `land: false` = the chart did nothing. */
// `ws.cutoff`: the workspace's Replay Mode as ChartsWorkspace shares it (host.buildChartSource `replay` source: every chart's
// snapshot reads ONE cutoff, setReplay writes it) — given (null or a date) only for the tests that have Replay Mode too
function withReplay(h, start = {}, ws = null) {
  const views = {}
  const viewOf = (ref) => (views[ref] ||= { land: true, calls: [], can: true, mode: false, playing: false, speed: 1, index: null, total: N,
    frame: { fromRight: 50, toRight: 0, activeRange: null, locked: false, lock: null }, ...start })
  const cut = ws ? { value: ws.cutoff ?? null, calls: [] } : null
  const withCut = (s) => (cut ? { ...s, replay: cut.value } : s)
  const meta = (ref) => {
    const v = viewOf(ref)
    return { firstMs: D0, lastMs: D0 + (N - 1) * DAY, rightMs: D0 + (N - 1) * DAY, frame: { ...v.frame },
      replay: { can: v.can, mode: v.mode, playing: v.playing, speed: v.speed, index: v.mode ? v.index : null, total: v.total,
        dateMs: v.mode && v.index != null ? D0 + v.index * DAY : null, firstMs: D0, lastMs: D0 + (v.total - 1) * DAY } }
  }
  const base = h.charts
  const read = base.read, list = base.list
  h.charts = {
    ...base,
    read: (ref) => { const s = read(ref); return s && withCut({ ...s, view: meta(ref) }) },
    list: () => list().map(s => withCut({ ...s, view: meta(s.ref) })),
    ...(cut ? { setReplay: (iso) => { cut.calls.push(iso ?? null); cut.value = iso ?? null; return true } } : {}),
    viewDo: (ref, o, a) => {
      const v = viewOf(ref)
      v.calls.push([o, a])
      // the Time Navigator's ◀ / ▶ (StockChart.stepBar(n): the logical window + n, so right-relative − n)
      if (v.land && o === 'stepBar') { v.frame = { ...v.frame, fromRight: v.frame.fromRight - a, toRight: v.frame.toRight - a, activeRange: null }; return true }
      if (!v.land || o !== 'replay' || !v.can) return true
      const clamp = (i) => Math.max(0, Math.min(v.total - 1, i))
      if (a.op === 'enter') { if (!v.mode) Object.assign(v, { mode: true, playing: false, index: Math.floor(v.total * 0.7) }) }
      else if (a.op === 'restore') Object.assign(v, { mode: true, playing: false, index: clamp(a.index) })
      else if (!v.mode) return true
      else if (a.op === 'exit') Object.assign(v, { mode: false, playing: false, index: null })
      else if (a.op === 'play') v.playing = true
      else if (a.op === 'pause') v.playing = false
      else if (a.op === 'step') Object.assign(v, { playing: false, index: clamp(v.index + a.n) })
      else if (a.op === 'seek') Object.assign(v, { playing: false, index: clamp(a.index) })
      else if (a.op === 'seekDate') Object.assign(v, { playing: false, index: clamp(Math.floor((a.ms - D0) / DAY)) })
      else if (a.op === 'speed') v.speed = a.speed
      return true
    },
  }
  viewOf.cut = cut
  return viewOf
}
const fastClock = () => {
  const realNow = Date.now
  let t = realNow()
  vi.spyOn(Date, 'now').mockImplementation(() => { t += 2000; return t })   // the 10s read-back wait passes at once
}
const ON = { mode: true, index: 70 }

describe('chartReplay.playback: the replay bar\'s own buttons, read back', () => {
  it('start: the Replay button\'s toggle, read back as on and paused; Undo exits exactly', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h)('c')
    p.st.envelopes.push(R({ op: 'enter' }))
    expect(await say('start the bar replay')).toMatch(/Started the bar replay on this chart/)
    expect(v.calls).toEqual([['replay', { op: 'enter' }]])
    expect(v).toMatchObject({ mode: true, playing: false, index: 70 })
    await say('undo')
    expect(v.calls.at(-1)).toEqual(['replay', { op: 'exit' }])
    expect(v.mode).toBe(false)
  }, 40000)

  it('play: the ▶ button, read back as playing; no Undo, and the receipt says so', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, ON)('c')
    p.st.envelopes.push(R({ op: 'play' }))
    const out = await say('play the replay')
    expect(out).toMatch(/Started playing the bar replay at 1× from bar 71 of 100/)
    expect(out).toMatch(/Replay playback has no Undo for that/)
    expect(v.calls).toEqual([['replay', { op: 'play' }]])
    expect(v.playing).toBe(true)
  }, 40000)

  it('pause: the ⏸ button, read back as paused; no Undo', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, { ...ON, playing: true })('c')
    p.st.envelopes.push(R({ op: 'pause' }))
    const out = await say('pause the replay')
    expect(out).toMatch(/Paused the bar replay on this chart/)
    expect(out).toMatch(/has no Undo/)
    expect(v.playing).toBe(false)
  }, 40000)

  it('step forward 10 bars: ONE step of +10 (the » button\'s handler), read back at the exact bar; Undo puts the scrubber back', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, ON)('c')
    p.st.envelopes.push(R({ op: 'forward', bars: 10 }))
    const out = await say('step the replay forward 10 bars')
    expect(out).toMatch(/Stepped the bar replay forward 10 bars \(now bar 81 of 100\)/)
    expect(out).not.toMatch(/has no Undo/)
    expect(v.calls).toEqual([['replay', { op: 'step', n: 10 }]])
    expect(v.index).toBe(80)
    await say('undo')
    expect(v.calls.at(-1)).toEqual(['replay', { op: 'seek', index: 70 }])
    expect(v.index).toBe(70)
  }, 60000)

  it('back 1 bar, first, last, a date and a speed each run their button\'s handler and land exactly', async () => {
    const cases = [
      [{ op: 'back', bars: null }, ['replay', { op: 'step', n: -1 }], { index: 69 }, /Stepped the bar replay back 1 bar \(now bar 70 of 100\)/],
      [{ op: 'first' }, ['replay', { op: 'seek', index: 0 }], { index: 0 }, /to its first bar \(bar 1 of 100\), paused/],
      [{ op: 'last' }, ['replay', { op: 'seek', index: 99 }], { index: 99 }, /to its last bar \(bar 100 of 100\), paused/],
      [{ op: 'date', date: '2026-01-15' }, ['replay', { op: 'seekDate', ms: Date.UTC(2026, 0, 15) }], { index: 14 }, /Moved the bar replay to .*Jan 15/],
      [{ op: 'speed', speed: 5 }, ['replay', { op: 'speed', speed: 5 }], { speed: 5 }, /Set the bar replay to 5×/],
    ]
    for (const [args, call, want, re] of cases) {
      const { say, h } = p.mount(...ONE('NVDA'))
      const v = withReplay(h, ON)('c')
      p.st.envelopes.push(R(args))
      expect(await say('replay control')).toMatch(re)
      expect(v.calls).toEqual([call])
      expect(v).toMatchObject(want)
      cleanup()
    }
  }, 90000)

  it('exit: the Exit button\'s toggle, read back as off; Undo re-enters at the exact bar (it was paused)', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, { mode: true, index: 42 })('c')
    p.st.envelopes.push(R({ op: 'exit' }))
    expect(await say('exit the bar replay')).toMatch(/Exited the bar replay on this chart: every bar is back/)
    expect(v.mode).toBe(false)
    await say('undo')
    expect(v.calls.at(-1)).toEqual(['replay', { op: 'restore', index: 42 }])
    expect(v).toMatchObject({ mode: true, playing: false, index: 42 })
  }, 60000)

  it('exit while PLAYING has no Undo (its exact bar is not knowable) — said on the receipt', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    withReplay(h, { ...ON, playing: true })('c')
    p.st.envelopes.push(R({ op: 'exit' }))
    expect(await say('stop the replay')).toMatch(/has no Undo for that/)
  }, 40000)

  it('a member who moved the replay since keeps it: a step\'s Undo refuses as stale and moves nothing', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, ON)('c')
    p.st.envelopes.push(R({ op: 'forward', bars: 5 }))
    await say('step the replay forward 5 bars')
    v.index = 30
    const calls = v.calls.length
    await say('undo')
    expect(document.body.textContent).toMatch(/has changed since/)
    expect(v.calls.length).toBe(calls)
    expect(v.index).toBe(30)
  }, 60000)
})

describe('honest no-ops and refusals: nothing is pressed, no Undo', () => {
  it.each([
    [{ op: 'pause' }, ON, /already paused/],
    [{ op: 'play' }, { ...ON, playing: true }, /already playing/],
    [{ op: 'speed', speed: 5 }, { ...ON, speed: 5 }, /already at 5×/],
    [{ op: 'enter' }, ON, /already in bar replay/],
    [{ op: 'exit' }, {}, /No replay is running/],
    [{ op: 'forward', bars: 1 }, { mode: true, index: 99 }, /already at its last bar/],
    [{ op: 'first' }, { mode: true, index: 0 }, /already at its first bar/],
  ])('%j on %j', async (args, start, re) => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, start)('c')
    p.st.envelopes.push(R(args))
    const out = await say('replay control')
    expect(out).toMatch(re)
    expect(v.calls).toEqual([])
  }, 40000)

  it('play at the last bar refuses: nothing left to play', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, { mode: true, index: 99 })('c')
    p.st.envelopes.push(R({ op: 'play' }))
    expect(await say('play the replay')).toMatch(/at its last bar, so there is nothing left to play/)
    expect(v.calls).toEqual([])
  }, 40000)

  it('outside replay a play / pause / step / speed ASKS to start it — never a silent no-op, never enters on its own', async () => {
    for (const args of [{ op: 'play' }, { op: 'pause' }, { op: 'forward', bars: 3 }, { op: 'speed', speed: 20 }, { op: 'date', date: '2026-01-10' }]) {
      const { say, h } = p.mount(...ONE('NVDA'))
      const v = withReplay(h)('c')
      p.st.envelopes.push(R(args))
      expect(await say('replay control')).toMatch(/isn’t in bar replay\. Say “start the bar replay” first/)
      expect(v.calls).toEqual([])
      cleanup()
    }
  }, 90000)

  it('a chart with no Replay button (a Multi Chart cell, the phone chart): "not available here", nothing pressed', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, { can: false })('c')
    p.st.envelopes.push(R({ op: 'enter' }))
    expect(await say('start the bar replay')).toMatch(/isn’t available on that chart here/)
    expect(v.calls).toEqual([])
  }, 40000)

  it('bad args refuse before anything is pressed: a step of 0 / 501, a 3× speed, a date before the first bar', async () => {
    for (const [args, re] of [[{ op: 'forward', bars: 0 }, /1 to 500 bars/], [{ op: 'back', bars: 501 }, /1 to 500 bars/],
      [{ op: 'speed', speed: 3 }, /“3” isn't an option for speed/], [{ op: 'date', date: '2025-06-01' }, /replay starts on/]]) {
      const { say, h } = p.mount(...ONE('NVDA'))
      const v = withReplay(h, ON)('c')
      p.st.envelopes.push(R(args))
      expect(await say('replay control')).toMatch(re)
      expect(v.calls).toEqual([])
      cleanup()
    }
  }, 90000)
})

describe('⛔ never a receipt from the attempt alone', () => {
  it('a chart whose replay did not change gets no success', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, { ...ON, land: false })('c')
    fastClock()
    p.st.envelopes.push(R({ op: 'play' }))
    expect(await say('play the replay')).not.toMatch(/Started playing/)
    expect(v.calls).toEqual([['replay', { op: 'play' }]])
  }, 40000)

  it('a chart that TOGGLED instead of playing (the wrong handler) gets no success', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, ON)('c')
    const real = h.charts.viewDo
    h.charts.viewDo = (ref, o, a) => real(ref, o, o === 'replay' && a.op === 'play' ? { op: 'exit' } : a)
    fastClock()
    p.st.envelopes.push(R({ op: 'play' }))
    expect(await say('play the replay')).not.toMatch(/Started playing/)
    expect(v.mode).toBe(false)
  }, 40000)

  it('a step that landed on the wrong bar gets no success', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    withReplay(h, ON)('c')
    const real = h.charts.viewDo
    h.charts.viewDo = (ref, o, a) => real(ref, o, a.op === 'step' ? { ...a, n: a.n + 1 } : a)
    fastClock()
    p.st.envelopes.push(R({ op: 'forward', bars: 10 }))
    expect(await say('step the replay forward 10')).not.toMatch(/Stepped the bar replay/)
  }, 40000)

  it('replayDone reads the state, not the attempt', () => {
    const r = { mode: true, playing: false, speed: 1, index: 70, total: 100, dateMs: null }
    expect(replayDone(r, { mode: true, playing: true, from: 70 })).toBe(false)
    expect(replayDone({ ...r, playing: true }, { mode: true, playing: true, from: 70 })).toBe(true)
    expect(replayDone({ ...r, index: 71 }, { mode: true, playing: true, from: 70 })).toBe(true)   // a short tail finished before the read
    expect(replayDone(r, { mode: true, playing: false, index: 80 })).toBe(false)
    expect(replayDone({ ...r, mode: false }, { mode: true })).toBe(false)
  })
})

describe('targeting: the chart kind\'s rules', () => {
  it('wrong-target control: with two charts, only the chart named plays', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    const get = withReplay(h, ON)
    const left = get('cl'), right = get('cr')
    p.st.envelopes.push(R({ op: 'play' }, 'cr'))
    await say('play the replay on the AMD chart')
    expect(right.calls).toEqual([['replay', { op: 'play' }]])
    expect(left.calls).toEqual([])
    expect(left.playing).toBe(false)
  }, 40000)
})

describe('the capability, its terms, and the other "replay"', () => {
  // AUDIT #1174 condition (af6e75e71b): apply() on a chart with NO replay read-out — run without its check, as the chart-rail
  // census does — returns the state unchanged and never throws (it used to throw reading `st.view.replay.mode`)
  it('apply() on a chart with no replay read-out returns the SAME state, deeply equal, and does not throw', () => {
    const c = getCapability(REPLAY_ACTION)
    const base = { symbol: 'NVDA', tf: 'D', cs: { a: 1 }, viewDo: null }
    const states = [{ ...base, view: null }, { ...base, view: {} }, { ...base, view: { frame: { fromRight: 50, toRight: 0 } } },
      { ...base, view: { replay: undefined } }, { ...base, view: { replay: { can: false, mode: false } } }]
    const ops = [{ op: 'enter' }, { op: 'exit' }, { op: 'play' }, { op: 'pause' }, { op: 'forward', bars: 5 }, { op: 'back', bars: null },
      { op: 'first' }, { op: 'last' }, { op: 'date', date: '2026-01-15' }, { op: 'speed', speed: 5 }]
    for (const st of states) {
      const before = JSON.parse(JSON.stringify(st))
      for (const o of ops) {
        const args = { bars: null, date: null, speed: null, ...o }
        let out
        expect(() => { out = c.apply(st, args) }, `${JSON.stringify(st.view)} ${o.op}`).not.toThrow()
        expect(out, `${JSON.stringify(st.view)} ${o.op}`).toEqual(st)
        expect(out).toBe(st)                                                   // the very same object: nothing planned
      }
      expect(st).toEqual(before)                                               // and the input was not mutated
    }
  })
  it('ONE chart, a view; honest Undo (exact where it is, a note where it is not); member-facing strings', () => {
    const c = getCapability(REPLAY_ACTION)
    expect(c.target).toBe('chart')
    expect(c.undo).toBe('exact')
    expect(c.undoNote).toMatch(/no Undo for that: play, pause/)
    expect(c.args.properties.op.enum).toEqual(['enter', 'exit', 'play', 'pause', 'forward', 'back', 'first', 'last', 'date', 'speed'])
    expect(c.args.properties.speed.enum).toEqual([1, 5, 20, null])
    expect(c.hints).toMatch(/"Replay as of <date>" \/ "go back to <date>" \/ Replay Mode = chart\.replay/)
    expect(c.hints).toMatch(/NO bar replay on = chartSetup\.stepBars/)
    expect(getCapability('chart.replay').name).toBe('chart.replay')     // the cutoff stays its own action, unchanged
    expect(groupOfAction(REPLAY_ACTION)).toBe('chartReplay')
  })
  it('chartSetup.stepBars, while the chart is in bar replay, asks instead of scrolling the window under it', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, ON)('c')
    p.st.envelopes.push(p.env('apply', [{ action: 'chartSetup.stepBars', target: 'c', args: { direction: 'forward', bars: 1 } }]))
    expect(await say('next bar')).toMatch(/This chart is in bar replay: say “step the replay forward/)
    expect(v.calls).toEqual([])
  }, 40000)
  it.each([['Started the bar replay on this chart', /^Start the bar replay/], ['Paused the bar replay on this chart', /^Pause the bar replay/],
    ['Stepped the bar replay forward 10 bars', /^Step the bar replay/]])('proposal wording: "%s" reads pending', (line, re) => {
    expect(pendingLine(line)).toMatch(re)
  })
})

describe('routing: the bar replay\'s own words, and every other "replay" left alone', () => {
  it.each(['play the replay', 'pause the replay', 'resume the bar replay', 'step the replay forward 10 bars', 'speed the replay up to 5x',
    'set the replay speed to 20x', 'start the bar replay', 'exit the bar replay', 'next bar in the replay', 'step forward 10 bars in the replay',
    'open the time machine', 'jump the replay to the end', 'scrub the replay to oct 15', 'rewind the replay', 'replay faster'])(
    '"%s" selects chartReplay', (msg) => {
      expect(wordsSelect('chartReplay', msg)).toBe(true)
      expect(selectGroups(msg).selected).toContain('chartReplay')
    })
  // ⛔ the cutoff stays chart.replay's (chartSetup group), a stepBar outside replay stays stepBars, other replays are not this
  it.each(['replay mode as of oct 15', 'go back to oct 15', 'replay as of last friday', 'start replay mode', 'exit replay mode',
    'start replay from oct 15', 'next bar', 'step forward 10 bars', 'step back a bar', 'replay the tutorial', 'replay that alert',
    'watch the replay of the earnings call', 'replay the onboarding video', 'pause the alert', 'play the guide again'])(
    '"%s" does not select chartReplay', (msg) => {
      expect(wordsSelect('chartReplay', msg)).toBe(false)
      expect(selectGroups(msg).selected).not.toContain('chartReplay')
    })
  it('the cutoff phrases still reach chart.replay\'s group (chartSetup)', () => {
    for (const msg of ['replay mode as of oct 15', 'replay as of last friday', 'exit replay mode']) expect(selectGroups(msg).selected).toContain('chartSetup')
  })
  it('bare playback words route to the bar replay ONLY while a chart\'s replay is on', () => {
    for (const msg of ['next bar', 'pause', 'play', 'step forward 10 bars', 'speed it up', '5x', 'go to the end']) {
      expect(selectGroups(msg, { names: { replayOn: true } }).selected, msg).toContain('chartReplay')
      expect(selectGroups(msg, { names: { replayOn: false } }).selected, msg).not.toContain('chartReplay')
      expect(selectGroups(msg).selected, msg).not.toContain('chartReplay')
    }
    // and never the non-replay meanings, even then
    for (const msg of ['replay the tutorial', 'open my swing layout']) expect(selectGroups(msg, { names: { replayOn: true } }).selected).not.toContain('chartReplay')
  })
})

// ── AUDIT #1174 ruling 1: "exit / stop the replay" is decided from STATE, never left to the model ──────────────────────────
// Replay Mode's exit writes every chart (the workspace cutoff); the bar replay's is one chart. Bare sentences are answered
// by the fast path (no envelope is scripted: no model call is needed); every plan is checked by resolveArgs on both actions.
const CUT = '2026-03-02'
const CR = (date = null, target = 'c') => p.env('apply', [{ action: 'chart.replay', target, args: { date } }])
describe('which replay an exit means: from state (fast path, no model)', () => {
  it('only the bar replay on → "stop the replay" exits the bar replay; Replay Mode is not touched', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const view = withReplay(h, ON, { cutoff: null })
    const v = view('c')
    expect(await say('stop the replay')).toMatch(/Exited the bar replay on this chart/)
    expect(v.mode).toBe(false)
    expect(view.cut.calls).toEqual([])
  }, 40000)
  it('only Replay Mode on → "exit the replay" exits Replay Mode (chart.replay); no chart\'s bar replay is pressed', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const view = withReplay(h, {}, { cutoff: CUT })
    const v = view('c')
    expect(await say('exit the replay')).toMatch(/Exited Replay Mode/)
    expect(view.cut.calls).toEqual([null])
    expect(v.calls).toEqual([])
  }, 40000)
  it('BOTH on and the words name neither → it ASKS which; nothing is written', async () => {
    for (const msg of ['exit the replay', 'stop the replay', 'turn the replay off']) {
      const { say, h } = p.mount(...ONE('NVDA'))
      const view = withReplay(h, ON, { cutoff: CUT })
      const v = view('c')
      expect(await say(msg)).toMatch(/Two replays are on: .*Which should I exit — the bar replay, or Replay Mode\?.*Nothing was changed/)
      expect(v.calls).toEqual([])
      expect(v.mode).toBe(true)
      expect(view.cut.calls).toEqual([])
      expect(view.cut.value).toBe(CUT)
      cleanup()
    }
  }, 90000)
  // (nothing on: the fast path does not claim the sentence — capreg level b reads boards without their state — so this is the
  // model's turn; whichever replay its plan names, resolveArgs answers "no replay is running" and nothing runs)
  it('NEITHER on → an honest "no replay is running" whichever replay the plan names; nothing is written', async () => {
    for (const plan of [() => R({ op: 'exit' }), () => CR(null)]) {
      const { say, h } = p.mount(...ONE('NVDA'))
      const view = withReplay(h, {}, { cutoff: null })
      const v = view('c')
      p.st.envelopes.push(plan())
      await say('stop the replay')
      expect(document.body.textContent).toMatch(/No replay is running/)
      expect(v.calls).toEqual([])
      expect(view.cut.calls).toEqual([])
      cleanup()
    }
  }, 60000)
  it('BOTH on and the words NAME one → that one only', async () => {
    {
      const { say, h } = p.mount(...ONE('NVDA'))
      const view = withReplay(h, ON, { cutoff: CUT })
      const v = view('c')
      p.st.envelopes.push(R({ op: 'exit' }))
      expect(await say('exit the bar replay')).toMatch(/Exited the bar replay/)
      expect(v.mode).toBe(false)
      expect(view.cut.value).toBe(CUT)
      cleanup()
    }
    {
      const { say, h } = p.mount(...ONE('NVDA'))
      const view = withReplay(h, ON, { cutoff: CUT })
      const v = view('c')
      p.st.envelopes.push(CR(null))
      expect(await say('exit replay mode')).toMatch(/Exited Replay Mode/)
      expect(view.cut.value).toBe(null)
      expect(v.mode).toBe(true)
    }
  }, 60000)
})

describe('⛔ a model plan that picks the OTHER replay is refused or asked about — nothing written', () => {
  const wrong = [
    // [what is on, bar replay state, cutoff, the member's words, the model's (wrong) plan, the answer]
    ['only the bar replay on, Replay Mode picked', ON, null, 'could you exit the replay for me', () => CR(null), /That is a chart’s bar replay .*, not Replay Mode/],
    ['only Replay Mode on, the bar replay picked', {}, CUT, 'could you exit the replay for me', () => R({ op: 'exit' }), /That is Replay Mode .* not a chart’s bar replay/],
    ['both on, words name neither, Replay Mode picked', ON, CUT, 'could you exit the replay for me', () => CR(null), /Two replays are on: .*Which should I exit/],
    ['both on, words name neither, the bar replay picked', ON, CUT, 'could you exit the replay for me', () => R({ op: 'exit' }), /Two replays are on: .*Which should I exit/],
    ['both on, words name the bar replay, Replay Mode picked', ON, CUT, 'exit the bar replay', () => CR(null), /That is a chart’s bar replay .*, not Replay Mode: say “exit the bar replay”/],
    ['both on, words name Replay Mode, the bar replay picked', ON, CUT, 'exit replay mode', () => R({ op: 'exit' }), /That is Replay Mode .* not a chart’s bar replay/],
  ]
  it.each(wrong)('%s', async (_name, start, cutoff, words, plan, re) => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const view = withReplay(h, start, { cutoff })
    const v = view('c')
    p.st.envelopes.push(plan())
    await say(words)
    // (the panel renders a quoted request it can run — “exit the bar replay” — as its own element, so read the whole panel)
    expect(document.body.textContent).toMatch(re)
    expect(v.calls).toEqual([])
    expect(view.cut.calls).toEqual([])
    expect(v.mode).toBe(!!start.mode)
    expect(view.cut.value).toBe(cutoff)
  }, 40000)
})

// ── AUDIT #1174 ruling 6: a date OUTSIDE the replay's loaded bars is refused with the reason — never the nearest bar ──────
describe('scrub to a date outside the replay\'s bars', () => {
  it.each([
    ['after its last bar (Apr 10)', '2026-05-01', /replay ends on .*Apr 10.*can’t go to .*May 1.*Nothing was moved/],
    ['before its first bar (Jan 1)', '2025-12-01', /replay starts on .*Jan 1.*can’t go back to .*Dec 1.*Nothing was moved/],
  ])('%s: refused, nothing pressed', async (_n, date, re) => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, ON)('c')
    p.st.envelopes.push(R({ op: 'date', date }))
    expect(await say(`scrub the replay to ${date}`)).toMatch(re)
    expect(v.calls).toEqual([])
    expect(v.index).toBe(70)
  }, 40000)
  it('its last bar\'s own day still lands on the last bar', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, ON)('c')
    p.st.envelopes.push(R({ op: 'date', date: '2026-04-10' }))
    expect(await say('scrub the replay to apr 10')).toMatch(/Moved the bar replay to/)
    expect(v.index).toBe(99)
  }, 40000)
})

// ── AUDIT #1174 ruling 7: chartSetup.stepBars is unchanged when no bar replay is on ─────────────────────────────────────────
describe('chartSetup.stepBars with the bar replay OFF', () => {
  it('"next bar": the Time Navigator\'s stepBar(+1), read back from the window, receipt as before; the replay is never pressed', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h)('c')
    p.st.envelopes.push(p.env('apply', [{ action: 'chartSetup.stepBars', target: 'c', args: { direction: 'forward', bars: 1 } }]))
    expect(await say('next bar')).toMatch(/Moved this chart 1 bar forward \(view only; nothing on the chart changed\)/)
    expect(v.calls).toEqual([['stepBar', 1]])
    expect(v.frame).toMatchObject({ fromRight: 49, toRight: -1 })
    expect(v.mode).toBe(false)
  }, 40000)
  it('a chart with no Replay button steps as before too', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withReplay(h, { can: false })('c')
    p.st.envelopes.push(p.env('apply', [{ action: 'chartSetup.stepBars', target: 'c', args: { direction: 'back', bars: 5 } }]))
    expect(await say('step back 5 bars')).toMatch(/Moved this chart 5 bars back/)
    expect(v.calls).toEqual([['stepBar', -5]])
  }, 40000)
})
