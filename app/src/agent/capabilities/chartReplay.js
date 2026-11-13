// ── CHART REPLAY: the bar replay's playback (Charts execution family, 2026-11-12) ─────────────────────────────────────────
//
// TWO "replays" exist on /charts, and they are different features:
//   · Tools → Replay Mode (ChartsWorkspace replayCutoff → StockChart's `replayCutoff` prop): ONE workspace cutoff date; every
//     chart hides the bars after it. That is chart.replay ("replay as of Oct 15", "go back to Oct 15", "exit Replay Mode").
//   · The chart toolbar's Replay / Time Machine button (StockChart's LOCAL replayMode / replayIndex / replayPlaying /
//     replaySpeed): ONE chart plays its own bars forward from a scrubber position, with the replay bar's ⏮ « ‹ ▶/⏸ › » ⏭,
//     the scrubber and 1× / 5× / 20×. That is THIS action, chartReplay.playback.
// They compose (StockChart slices to the scrubber, then hides what is after the cutoff); neither writes the other.
//
// Every op runs the replay bar's OWN handler (StockChart replayToggle / replayPlayPause / replayStep / replayIndexChange /
// setReplaySpeed), reached through onDateNavApi.replay → ChartPane.viewDo('replay'), and is read back from
// getDateMeta().replay (on, playing, speed, scrubber index): the receipt exists only once the chart's state says so.
// Nothing is saved: the replay is a transient view (it resets on a symbol or timeframe change).
//
// Undo, honestly: start ↔ exit, a step / jump and a speed are restorable exactly (the scrubber index and the speed are
// plain state; an exit's Undo re-enters and puts the scrubber back). Play and pause have no Undo (the bar keeps moving),
// nor does anything done while the replay was PLAYING (its exact bar is not knowable) — the receipt says so (undoNote).
// The replay exists only where the chart's own toolbar shows the Replay button: not a Multi Chart cell, not the phone chart.

import { registerCapability } from '../capabilities'
import { resolveDateWord, dayWord, isoDayMs } from '../dateWords'

export const REPLAY_ACTION = 'chartReplay.playback'
const OPS = ['enter', 'exit', 'play', 'pause', 'forward', 'back', 'first', 'last', 'date', 'speed']
export const REPLAY_SPEEDS = [1, 5, 20]
const MAX_STEP = 500
const DAY_MS = 86400000

export const NO_REPLAY = 'The bar replay (the Replay / Time Machine button) isn’t available on that chart here — it is on a chart’s own toolbar on the Charts board, not in a Multi Chart cell or on the phone chart. For Replay Mode as of a date, say “replay as of <date>”.'
const NOT_IN_REPLAY = 'This chart isn’t in bar replay. Say “start the bar replay” first (it opens paused, part-way back in the history) — or, for Replay Mode as of a date, “replay as of <date>”.'
const NOT_READY = 'That chart hasn’t finished loading, so I can’t read its replay yet. Try again in a moment.'
export const REPLAY_NO_UNDO = 'Replay playback has no Undo for that: play, pause, or anything done while it was playing moves on by itself. Use the replay bar (or ask me) to move it.'

// ── "exit / stop the replay": WHICH replay is decided from state, never left to the model (AUDIT #1174 ruling 1) ──
// Replay Mode's exit writes EVERY chart (the workspace cutoff); the bar replay's is ONE chart. So:
//   only a bar replay on → chartReplay.playback exit · only Replay Mode on → chart.replay exit ·
//   BOTH on and the words name neither → ask, nothing written · NEITHER on → "no replay is running", nothing written.
// The words name one by "replay mode" / "as of" / "cutoff" / "every chart" (Replay Mode) or "time machine" / "bar replay" /
// "replay bar" / "playback" (the bar replay). Applied twice: the fast path answers the bare sentence before any model call,
// and resolveArgs on BOTH actions checks every plan (a model that picked the other replay is refused or asked, nothing runs).
const NAMES_CUTOFF = /\breplay mode\b|\bas of\b|\bcutoff\b|\bevery chart\b|\ball (?:the )?charts\b/
const NAMES_BAR = /\btime machine\b|\bbar replay\b|\breplay bar\b|\bplayback\b|\bbar[- ]by[- ]bar\b/
export const BARE_EXIT = /^(?:please )?(?:exit|stop|leave|end|quit|close|cancel|kill|turn off|switch off|get out of)(?: out of)? (?:the |my |this |that )?replay(?: now)?$|^(?:turn|switch) (?:the |my )?replay off$|^(?:the )?replay off$|^(?:i'?m |we'?re )?done with (?:the )?replay$/
export const NONE_RUNNING = 'No replay is running: no chart’s bar replay (Replay / Time Machine) is on, and Replay Mode is off. Nothing was changed.'
export const bothAsk = (cut) => `Two replays are on: a chart’s bar replay (its Replay / Time Machine button) and Replay Mode as of ${dayWord(cut)} on every chart. Which should I exit — the bar replay, or Replay Mode? Say “exit the bar replay” or “exit Replay Mode”. Nothing was changed.`
const noBarOn = (cut) => `No chart’s bar replay is on${cut ? ` — Replay Mode (as of ${dayWord(cut)}, on every chart) is: say “exit Replay Mode” for that` : ''}. Nothing was changed.`
const NO_CUTOFF_ON = 'Replay Mode is off — a chart’s bar replay (Replay / Time Machine) is on: say “exit the bar replay” for that. Nothing was changed.'
const NOT_THE_CUTOFF = 'That is a chart’s bar replay (Replay / Time Machine), not Replay Mode: say “exit the bar replay” for it. Nothing was changed.'
const notTheBar = (cut) => `That is Replay Mode (as of ${dayWord(cut)}, on every chart), not a chart’s bar replay: say “exit Replay Mode” for it. Nothing was changed.`
/** Which replays are on now: the charts in bar replay, and the workspace cutoff ('YYYY-MM-DD' | null). */
export function replaysOn(host) {
  let list = []
  try { list = host?.charts?.list?.() || [] } catch { list = [] }
  return { bar: list.filter(s => s?.view?.replay?.mode === true), cutoff: list.map(s => s?.replay).find(Boolean) ?? null }
}
/** The replay an exit means: { use: 'bar' | 'cutoff', bar } or { say } (an ask, nothing running, or the one named is off). */
export function exitVerdict(words, host) {
  const t = String(words || '').toLowerCase()
  const nb = NAMES_BAR.test(t), nc = NAMES_CUTOFF.test(t)
  const { bar, cutoff } = replaysOn(host)
  if (!bar.length && !cutoff) return { say: NONE_RUNNING }
  let use = nb && !nc ? 'bar' : nc && !nb ? 'cutoff' : null
  if (!use) {
    if (bar.length && cutoff) return { say: bothAsk(cutoff), ask: true }
    use = bar.length ? 'bar' : 'cutoff'
  }
  if (use === 'bar' && !bar.length) return { say: noBarOn(cutoff) }
  if (use === 'cutoff' && !cutoff) return { say: NO_CUTOFF_ON }
  return { use, bar, cutoff }
}
/** resolveArgs for an EXIT of either replay: refused (the ask included: nothing runs) unless the state and words mean `mine`. */
export function exitGuard(isExit, mine) {
  return (args, host, words) => {
    if (!isExit(args || {})) return null
    const v = exitVerdict(words, host)
    if (v.say) return { refuse: v.say }
    if (v.use === mine) return null
    return { refuse: mine === 'bar' ? notTheBar(v.cutoff) : NOT_THE_CUTOFF }
  }
}
const bareTyped = (typed) => BARE_EXIT.test(String(typed || '').toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim())
/** The bare "exit / stop the replay" sentence, resolved from state before any model call (fastWhole). */
export function bareExitFast(mine) {
  return ({ lower, host, typed }) => {
    if (!BARE_EXIT.test(String(lower || ''))) return null
    const v = exitVerdict(lower, host)
    // NOTHING running: no claim here (a board read without its state, capreg level b, must not be answered for it); any plan
    // the model makes for it is refused by resolveArgs on both actions with the same "no replay is running"
    if (v.say === NONE_RUNNING) return null
    // said ONCE (by the bar replay's fast) and only for the whole sentence: no op, no model, nothing written
    if (v.say) return mine === 'bar' && bareTyped(typed ?? lower) ? { __say: v.say } : null
    if (v.use !== mine) return null
    if (mine === 'cutoff') return { date: null, __explicit: true }
    return { op: 'exit', bars: null, date: null, speed: null, __explicit: true, ...(v.bar.length === 1 ? { __target: v.bar[0].ref } : {}) }
  }
}
export const isBarExit = (a) => a.op === 'exit'
export const isCutoffExit = (a) => a.date == null

const barWord = (n) => `${n} bar${n === 1 ? '' : 's'}`
const at = (i, n) => `bar ${i + 1} of ${n}`

/** The replay bar's state, as a short context line — only while it is on (so a normal chart's context is unchanged). */
export function replayContext(r) {
  if (!r?.mode) return {}
  return { barReplay: `on, ${r.playing ? 'playing' : 'paused'} at ${r.speed}×${r.index != null ? `, ${at(r.index, r.total)}` : ''}` }
}

/** What a replay Undo is pinned to: what the op touched (a speed's Undo ignores the moving scrubber). */
export function replaySig(r, op) {
  if (!r) return null
  return op === 'speed' ? JSON.stringify([r.mode, r.speed]) : JSON.stringify([r.mode, r.playing, r.index, r.speed])
}

/** Did the replay land where the op asked? Read from getDateMeta().replay — never from the attempt. */
export function replayDone(r, want) {
  if (!r || !want) return false
  if ('mode' in want && r.mode !== want.mode) return false
  if (!r.mode) return true
  if ('speed' in want && r.speed !== want.speed) return false
  // play: the replay is playing — or it already advanced past where it was (a short tail at 20× can finish before the read)
  if (want.playing === true && !(r.playing || (r.index ?? -1) > want.from)) return false
  if (want.playing === false && r.playing) return false
  if ('index' in want && r.index !== want.index) return false
  // a step while it was playing: paused, and moved the asked way from where it was then
  if (want.dir && !(want.dir > 0 ? r.index > want.from : r.index < want.from)) return false
  // a date: the scrubber on the last bar on or before that day (the first bar when the day is before it)
  if (want.dayMs != null) {
    if (r.dateMs == null || r.dateMs > want.dayMs + DAY_MS - 1) return false
    if (r.index !== 0 && want.dayMs - r.dateMs > 45 * DAY_MS) return false
  }
  return true
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)

function plan(r, { op, bars, date, speed }) {
  const n = r.total, i = r.index ?? 0, playing = r.playing
  const paused = (arg, want, back) => ({ arg, want: { mode: true, playing: false, ...want }, back: playing ? null : back })
  const seekBack = { arg: { op: 'seek', index: i }, want: { mode: true, playing: false, index: i } }
  switch (op) {
    case 'enter': return { arg: { op: 'enter' }, want: { mode: true, playing: false }, back: { arg: { op: 'exit' }, want: { mode: false } } }
    case 'exit': return { arg: { op: 'exit' }, want: { mode: false }, back: playing ? null : { arg: { op: 'restore', index: i }, want: { mode: true, playing: false, index: i } } }
    case 'play': return { arg: { op: 'play' }, want: { mode: true, playing: true, from: i }, back: null }
    case 'pause': return { arg: { op: 'pause' }, want: { mode: true, playing: false }, back: null }
    case 'forward': case 'back': {
      const d = op === 'back' ? -bars : bars
      const to = Math.max(0, Math.min(n - 1, i + d))
      return paused({ op: 'step', n: d }, playing ? { dir: Math.sign(d), from: i } : { index: to }, seekBack)
    }
    case 'first': return paused({ op: 'seek', index: 0 }, { index: 0 }, seekBack)
    case 'last': return paused({ op: 'seek', index: n - 1 }, { index: n - 1 }, seekBack)
    case 'date': {
      const ms = isoDayMs(resolveDateWord(date).to)
      return paused({ op: 'seekDate', ms }, { dayMs: ms }, seekBack)
    }
    case 'speed': return { arg: { op: 'speed', speed }, want: { mode: true, speed }, back: { arg: { op: 'speed', speed: r.speed }, want: { mode: true, speed: r.speed } } }
    default: return null
  }
}

/** A multi-step replay plan that stopped part-way: an error the runtime says as-is (`complete`), keeping what landed (`keptNote`). */
export function replayStopped(done, total, r) {
  const now = !r ? 'I can’t read it right now' : !r.mode ? 'the bar replay is off'
    : `the bar replay is on, ${r.playing ? 'playing' : 'paused'} at ${r.speed}×${r.index != null ? `, ${at(r.index, r.total)}` : ''}`
  const e = new Error(`The bar replay did ${done} of the ${total} steps you asked for, then the next one did not take effect on the chart, so I stopped there and pressed nothing after it. The chart now: ${now}.`)
  e.complete = true
  e.keptNote = `the ${done === 1 ? 'first step stays' : `first ${done} steps stay`} (${now})`
  return e
}

/** The replay as a planned op leaves it (for the next op of the SAME plan): exactly the toolbar handler's effect. */
function plannedReplay(r, op, w) {
  const n = { ...r }
  if (op === 'enter') Object.assign(n, { mode: true, playing: false, index: Math.floor((r.total || 1) * 0.7) })
  if (op === 'exit') Object.assign(n, { mode: false, playing: false, index: null })
  if ('playing' in w) n.playing = w.playing === true
  if ('index' in w) n.index = w.index
  if ('speed' in w) n.speed = w.speed
  if (w.dir || w.dayMs != null || w.playing === true) n.uncertain = true
  n.dateMs = null
  return n
}

/** Unchanged state (a no-op) when the replay is already where the op would put it. */
function alreadyThere(r, { op, speed }) {
  const i = r.index ?? 0, last = r.total - 1
  if (op === 'enter') return r.mode
  if (op === 'exit') return !r.mode
  if (op === 'pause') return !r.playing
  if (op === 'play') return r.playing
  if (op === 'speed') return r.speed === speed
  if (r.playing) return false
  if (op === 'forward' || op === 'last') return i >= last
  if (op === 'back' || op === 'first') return i <= 0
  return false
}

function describe(b, a, { op, bars, speed } = {}) {
  const vd = a.viewDo
  if (!vd) return null
  const r = b.view.replay, w = vd.want, n = r.total
  switch (op) {
    case 'enter': return 'Started the bar replay on this chart (the Replay / Time Machine button): it opens paused, part-way back in its history, with the later bars hidden until you play or step (a view only; nothing is saved)'
    case 'exit': return 'Exited the bar replay on this chart: every bar is back'
    case 'play': return `Started playing the bar replay at ${r.speed}× from ${at(r.index ?? 0, n)}`
    case 'pause': return 'Paused the bar replay on this chart'
    case 'forward': case 'back': return `Stepped the bar replay ${op} ${barWord(bars)}${'index' in w ? ` (now ${at(w.index, n)})` : ' and paused it'}`
    case 'first': return `Moved the bar replay to its first bar (${at(0, n)}), paused`
    case 'last': return `Moved the bar replay to its last bar (${at(n - 1, n)}), paused`
    case 'date': return `Moved the bar replay to ${'dayMs' in w ? dayWord(dayOf(w.dayMs)) : 'its last bar'} (the last bar on or before it), paused`
    case 'speed': return `Set the bar replay to ${speed}×${r.playing ? ' (it keeps playing)' : ''}`
    default: return null
  }
}

function noop(st, _a, { op, speed } = {}) {
  const r = st.view?.replay
  if (op === 'enter') return 'This chart is already in bar replay'
  if (op === 'exit') return st.replay ? `The bar replay is already off on this chart (Replay Mode is on, as of ${dayWord(st.replay)} — say “exit Replay Mode” for that)` : 'The bar replay is already off on this chart'
  if (op === 'pause') return 'The bar replay is already paused'
  if (op === 'play') return 'The bar replay is already playing'
  if (op === 'speed') return `The bar replay is already at ${speed}×`
  if (op === 'forward' || op === 'last') return `The bar replay is already at its last bar (${at(r.total - 1, r.total)})`
  return 'The bar replay is already at its first bar'
}

let registered = false
export function registerChartReplayCapabilities() {
  if (registered) return
  registered = true
  registerCapability({
    target: 'chart', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts',
    name: REPLAY_ACTION,
    summary: `ONE chart's bar replay (its toolbar's Replay / Time Machine button and replay bar): start it, play, pause, step forward or back by bars, jump to its first or last bar or to a date, speed ${REPLAY_SPEEDS.map(s => `${s}×`).join(' / ')}, exit. A view only; nothing is saved. Undo for start, exit, steps, jumps and speed; none for play / pause.`,
    hints: 'op: enter (start / open the bar replay) | play (resume) | pause | forward | back (bars = how many, 1 when unsaid; "next bar" = forward 1) | first | last | date (date = YYYY-MM-DD or a day word: scrub there) | speed (speed = 1, 5 or 20) | exit. bars / date / speed null unless their op. "Replay as of <date>" / "go back to <date>" / Replay Mode = chart.replay (the cutoff). "Next bar" / step with NO bar replay on = chartSetup.stepBars. Replaying a tutorial, video or alert is not this.',
    args: { type: 'object', properties: { op: { type: 'string', enum: OPS }, bars: { type: ['integer', 'null'] }, date: { type: ['string', 'null'] }, speed: { type: ['integer', 'null'], enum: [...REPLAY_SPEEDS, null] } }, required: ['op', 'bars', 'date', 'speed'], additionalProperties: false },
    undoNote: REPLAY_NO_UNDO,
    // "exit / stop the replay": which replay is decided from state (exitVerdict), on the fast path and for every plan
    fastWhole: true,
    fast: bareExitFast('bar'),
    resolveArgs: exitGuard(isBarExit, 'bar'),
    check(st, args = {}) {
      const { op } = args
      if (!OPS.includes(op)) return 'Start, play, pause, step, jump, change the speed of, or exit the bar replay?'
      if (!st.view) return NOT_READY
      const r = st.view.replay
      if (!r?.can) return NO_REPLAY
      // one view door per plan: a replay op does not ride with another view change (a step of the window, a zoom, a range)
      if (st.viewDo && st.viewDo.op !== 'replay') return 'Ask for the bar replay on its own, after that view change has landed. Nothing was changed.'
      // after a step in this plan whose bar is only known once it lands (a date, a step while playing, play), an op that
      // counts from the bar waits for it: never planned on a bar nobody has read
      if (r.uncertain && ['forward', 'back', 'play', 'first', 'last'].includes(op)) return 'Ask for that once the replay has moved: where it lands is only known then. Nothing was changed.'
      if (op === 'enter' || op === 'exit') return null
      if (!r.mode) return NOT_IN_REPLAY
      if (op === 'forward' || op === 'back') {
        const n = args.bars ?? 1
        if (!Number.isInteger(n) || n < 1 || n > MAX_STEP) return `I can step the replay 1 to ${MAX_STEP} bars at a time — or jump it to a date, its first bar or its last bar.`
      }
      if (op === 'speed' && !REPLAY_SPEEDS.includes(args.speed)) return `The bar replay plays at ${REPLAY_SPEEDS.map(s => `${s}×`).join(', ')}.`
      if (op === 'play' && !r.playing && (r.index ?? 0) >= r.total - 1) return 'The bar replay is at its last bar, so there is nothing left to play: step it back or jump to its first bar first.'
      if (op === 'date') {
        const d = args.date == null ? null : resolveDateWord(args.date)
        if (!d) return `I couldn’t read “${args.date ?? ''}” as a date — use YYYY-MM-DD or a day like “last Friday”.`
        if (d.future) return `${dayWord(d.to)} hasn’t happened yet.`
        const ms = isoDayMs(d.to)
        // AUDIT #1174 ruling 6: a date outside the replay's loaded bars is refused with the reason — never the nearest bar
        if (Number.isFinite(r.firstMs) && ms + DAY_MS - 1 < r.firstMs) return `This chart’s replay starts on ${dayWord(dayOf(r.firstMs))}, so it can’t go back to ${dayWord(d.to)}. Say “jump the replay to its first bar” for its first bar. Nothing was moved.`
        if (Number.isFinite(r.lastMs) && ms > r.lastMs) return `This chart’s replay ends on ${dayWord(dayOf(r.lastMs))}, so it can’t go to ${dayWord(d.to)}. Say “jump the replay to its last bar” for its last bar. Nothing was moved.`
      }
      return null
    },
    // Several replay ops in ONE plan ("start the bar replay and step forward 5 bars", "… at 5×"): each op is checked and
    // planned against the replay as the ops before it leave it (the planned `view.replay`), and they ride ONE viewDo as
    // ordered `steps`; chartKind.commit presses each only after the one before it is READ BACK (StockChart's door acts on its
    // last render's state, so a step pressed before the replay is on would be ignored), and stops at the first that does not
    // land. Undo runs the steps' own ways back in reverse (none if any step has none).
    apply(st, args = {}) {
      const r = st.view.replay
      const a = { ...args, bars: args.op === 'forward' || args.op === 'back' ? (args.bars ?? 1) : args.bars }
      if (alreadyThere(r, a)) return st
      const p = plan(r, a)
      if (!p) return st
      const prev = st.viewDo?.op === 'replay' ? st.viewDo : null
      const view = { ...st.view, replay: plannedReplay(r, a.op, p.want) }
      if (!prev) return { ...st, view, viewDo: { op: 'replay', ...p } }
      const steps = [...(prev.steps || [{ arg: prev.arg, want: prev.want }]), { arg: p.arg, want: p.want }]
      const backs = [p.back, ...(prev.backSteps || [prev.back])]
      const back = backs.every(Boolean) ? { arg: backs[0].arg, want: backs.at(-1).want, steps: backs } : null
      return { ...st, view, viewDo: { op: 'replay', arg: steps[0].arg, want: p.want, steps, back, backSteps: backs } }
    },
    describe: (b, a, args = {}) => describe(b, a, { ...args, bars: args.bars ?? 1 }),
    noop,
  })
}
