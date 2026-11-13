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
      if (Number.isFinite(r.lastMs) && ms >= r.lastMs) return paused({ op: 'seek', index: n - 1 }, { index: n - 1 }, seekBack)
      return paused({ op: 'seekDate', ms }, { dayMs: ms }, seekBack)
    }
    case 'speed': return { arg: { op: 'speed', speed }, want: { mode: true, speed }, back: { arg: { op: 'speed', speed: r.speed }, want: { mode: true, speed: r.speed } } }
    default: return null
  }
}

/** Unchanged state (a no-op) when the replay is already where the op would put it. */
function alreadyThere(r, { op, bars, speed }) {
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

function describe(b, a, { op, bars, date, speed } = {}) {
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
    check(st, args = {}) {
      const { op } = args
      if (!OPS.includes(op)) return 'Start, play, pause, step, jump, change the speed of, or exit the bar replay?'
      if (!st.view) return NOT_READY
      const r = st.view.replay
      if (!r?.can) return NO_REPLAY
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
        if (Number.isFinite(r.firstMs) && ms + DAY_MS - 1 < r.firstMs) return `This chart’s replay starts on ${dayWord(dayOf(r.firstMs))}, so it can’t go back to ${dayWord(d.to)}.`
      }
      return null
    },
    apply(st, args = {}) {
      const r = st.view.replay
      const a = { ...args, bars: args.op === 'forward' || args.op === 'back' ? (args.bars ?? 1) : args.bars }
      if (alreadyThere(r, a)) return st
      const p = plan(r, a)
      return p ? { ...st, viewDo: { op: 'replay', ...p } } : st
    },
    describe: (b, a, args = {}) => describe(b, a, { ...args, bars: args.bars ?? 1 }),
    noop,
  })
}
