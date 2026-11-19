// ── REPLAY MODE BAR STEP (owner D20, 2026-11-14): step Tools → Replay Mode's cutoff by REAL chart bars ─────────────────────
//
// Tools → Replay Mode (chart.replay) is ONE workspace cutoff every chart reads. `chart.replayStep` moves it forward or back
// by N bars of ONE chart's own timeframe — the selected or sole chart (the chart kind's targeting: several charts and none
// clicked → "Which chart?"):
//   · daily: N trading sessions — the cutoff stays DAY-ONLY ('YYYY-MM-DD', the session's day);
//   · weekly / monthly: N periods — day-only, the period's last session;
//   · intraday (1/5/15/30/60m): N real bars of that timeframe — PRECISE ('YYYY-MM-DDTHH:mm±HH:MM', the target bar's END,
//     capped at its session's close), so every chart shows only what was known by then (components/chart/replayCutoff.js).
// The bars come from the chart itself (host.charts.replayBarTimes: read-only, timestamps only) — never a calendar: a
// weekend, a holiday, the overnight gap or a halt has no bar, so it is skipped by construction.
//
// ⛔ It never touches the bar replay (chartReplay.playback, the Replay / Time Machine button) and never switches modes.
// Which replay is active is read from STATE (chartReplay.replaysOn), never from words alone; Replay Mode has no play,
// pause or speed, and says so. Boundaries (no later bar, the bar still forming, before the first bar, fewer than N) are
// refused with nothing changed. Undo restores the cutoff EXACTLY as it was (the chart kind: `replay`, null included).

import { registerCapability } from '../capabilities'
import { NATIVE_TFS, tfLabel } from '../../components/chart/timeframes'
import { barVisible, cutoffFetchDay, cutoffWords, intradayBarEndMs, lastSessionOfPeriod, preciseCutoffAt, isPreciseCutoff } from '../../components/chart/replayCutoff'
import { closeTime } from '../../lib/marketClock/sessionCalendar'
import { etYmd } from '../../lib/marketClock/etTime'
import { replaysOn, NONE_RUNNING } from './chartReplay'
import { effectiveCalcFrame } from '../../components/chart/engine/instanceTimeframe'
import { getDefinition } from '../../components/chart/engine/nativeRegistry'

export const STEP_ACTION = 'chart.replayStep'
export const MAX_STEP = 100
const INTRADAY = new Set(['1', '5', '15', '30', '60'])

const stopped = (msg) => Object.assign(new Error(msg), { complete: true })
const barsWord = (n) => `${n} bar${n === 1 ? '' : 's'}`
export const NOT_ON = 'Replay Mode isn’t on. Say “replay as of <date>” to start it (Tools → Replay Mode) — then I can step it forward or back by bars.'
export const NOT_HERE = 'Replay Mode isn’t reachable on that chart here (a Multi Chart cell or a pop-out chart has none). Nothing was changed.'
export const customRefusal = (tf) => `Stepping Replay Mode works on the chart’s native timeframes (1, 5, 15, 30 or 60 minutes, daily, weekly or monthly); this chart is on ${tfLabel(tf)}, a custom timeframe — switch it to one of those first. Nothing was changed.`
/** Replay Mode has no playback: what it IS, and what can be asked instead (owner D20 req 7). Never a pretend execution. */
export const noPlayback = (v) => `Replay Mode (as of ${cutoffWords(v)}) shows the charts as they were at that point; it has no play, pause or speed. I can step it forward or back by bars (“step forward 1 bar”), change its date, or exit it. Nothing was changed.`
export const bothStepAsk = (v) => `Two replays are on: a chart’s bar replay (its Replay / Time Machine button) and Replay Mode as of ${cutoffWords(v)} on every chart. Which should I step — say “step the bar replay forward” or “step Replay Mode forward”. Nothing was changed.`

/** A status answer, from state (owner D20 req 6): which replay is on, and where. */
export function replayStatus(host) {
  const { bar, cutoff } = replaysOn(host)
  if (!bar.length && !cutoff) return NONE_RUNNING
  const parts = []
  if (cutoff) parts.push(`Replay Mode (Tools → Replay) is on: every chart shows only what was known by ${cutoffWords(cutoff)}.`)
  else parts.push('Replay Mode (Tools → Replay) is off.')
  if (bar.length) {
    for (const s of bar) {
      const r = s.view.replay
      parts.push(`The bar replay (Replay / Time Machine) is on for ${s.label || 'a chart'}: ${r.playing ? 'playing' : 'paused'} at ${r.speed}×${r.index != null ? `, bar ${r.index + 1} of ${r.total}` : ''}.`)
    }
  } else parts.push('The bar replay (Replay / Time Machine) is off.')
  return parts.join(' ')
}

// ── fast path (from state; no model): status, a bare step, Replay Mode's missing playback ──
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
export const STATUS_WORDS = /^(?:(?:is|are) (?:the |a )?(?:replay|replay mode|bar replay|time machine)(?: mode)? (?:on|active|running|enabled)|am i in (?:a )?(?:replay|replay mode|bar replay)|which replay(?: mode)?(?: is (?:on|active|running))?|what(?:'s| is) the replay (?:status|date|at)|replay (?:mode )?status|where is the replay(?: at)?|what date is (?:the )?replay(?: mode)? (?:at|on|set to))\??$/
const STEP_WORDS = /^(?:(?:step|move|go|advance|jump)(?: the)?(?: replay mode| replay)? )?(forward|ahead|back|backward|backwards)(?: by)?(?: (\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten))?(?: (?:bars?|candles?))?$|^(next|previous|prev) (bar|candle)$/
// "advance two bars" / "jump 3 bars": the verb alone implies FORWARD, but only with a count AND a bar word (bare
// "advance" / "jump" stays unread, as before; "jump back 2 bars" is STEP_WORDS' own back step)
const FORWARD_VERB_STEP = /^(?:advance|jump)(?: the)?(?: replay)?(?: by)? (\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten) (?:bars?|candles?)$/
const NAMES_REPLAY_MODE = /\breplay mode\b/
const PLAYBACK_WORDS = /^(?:(?:play|pause|resume|unpause|stop playing)(?: (?:it|the replay|replay mode|the chart))?|play(?: it)? at \d+ ?x|(?:\d+ ?x|double|triple)(?: speed)?|speed(?: it| the replay)? up|slow(?: it| the replay)? down|faster|slower|play(?: the replay)? (?:faster|slower))$/
/** The bare step sentence → { direction, bars } (null when it is not one). */
export function parseStep(lower) {
  const t = String(lower || '').trim().replace(/\s+/g, ' ')
  const named = NAMES_REPLAY_MODE.test(t)
  const core = t.replace(/\breplay mode\b ?/, '').replace(/\s+/g, ' ').trim()
  const m = STEP_WORDS.exec(core)
  if (!m) {
    const f = FORWARD_VERB_STEP.exec(core)
    return f ? { direction: 'forward', bars: NUM[f[1]] || Number(f[1]), named } : null
  }
  if (m[3]) return { direction: /^(next)$/.test(m[3]) ? 'forward' : 'back', bars: 1, named }
  const n = m[2] == null ? 1 : (NUM[m[2]] || Number(m[2]))
  return { direction: /^(forward|ahead)$/.test(m[1]) ? 'forward' : 'back', bars: n, named }
}
function fast({ lower, host }) {
  const t = String(lower || '').trim()
  if (STATUS_WORDS.test(t)) return { __say: replayStatus(host) }
  const { bar, cutoff } = replaysOn(host)
  if (!cutoff) return null
  if (PLAYBACK_WORDS.test(t) && !bar.length) return { __say: noPlayback(cutoff) }
  const s = parseStep(t)
  if (!s) return null
  if (bar.length && !s.named) return { __say: bothStepAsk(cutoff) }
  return { direction: s.direction, bars: s.bars, __explicit: true }
}

// ── the step itself (run at commit: the chart's bars are read then, never guessed at plan time) ──
const DAY_MS = 86400000
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
/** The calendar days a forward look-ahead needs to hold `n` more bars of `tf` (generous: gaps and holidays). */
function lookAheadDays(tf, n) {
  if (tf === 'D') return Math.ceil(n * 1.6) + 7
  if (tf === 'W') return n * 7 + 10
  if (tf === 'M') return n * 31 + 35
  const perDay = Math.max(1, Math.floor(390 / Number(tf)))
  return Math.ceil(n / perDay) * 2 + 6
}
/** When a bar's last session ends (epoch ms): intraday its end; daily its regular close; W/M its period's last close. */
function barEndMs(t, tf, extended) {
  if (INTRADAY.has(tf)) return intradayBarEndMs(t, tf, { extended })
  const day = tf === 'D' ? String(t).slice(0, 10) : lastSessionOfPeriod(String(t).slice(0, 10), tf)
  return day ? (closeTime(day)?.getTime() ?? null) : null
}
/** The cutoff value that shows exactly through the bar at `t` (and hides the next). */
function cutoffThrough(t, tf, extended) {
  if (INTRADAY.has(tf)) return preciseCutoffAt(intradayBarEndMs(t, tf, { extended }))
  if (tf === 'D') return String(t).slice(0, 10)
  return lastSessionOfPeriod(String(t).slice(0, 10), tf)
}
// AUDIT #1292 (owner req 5): an indicator CALCULATED on a higher timeframe reads its own frame's bars, which the cutoff does
// not cut (engine/secondaryBars.secondaryBarsUrl has no `to`); each chart bar shows the last higher-timeframe period that had
// CLOSED before it (engine/mtfProjection.js, COMPLETED semantics). The receipt says so plainly, generated from every chart's
// actual instances and their effective calculation frames — never per-indicator text.
const indicatorName = (inst) => {
  const d = getDefinition(inst?.defId)
  return d?.meta?.shortName || d?.shortName || d?.meta?.name || d?.name || String(inst?.defId || 'indicator')
}
export function higherCalcIndicators(charts) {
  const out = []
  for (const s of charts) {
    for (const inst of [].concat(s?.cs?.indicatorInstances || [])) {
      if (!inst || inst.hidden) continue
      const f = effectiveCalcFrame(inst, String(s.tf || ''))
      if (f.frame) out.push({ chart: s.label || s.ref, name: indicatorName(inst), frame: f.frame })
    }
  }
  return out
}
export function higherCalcNote(charts) {
  const hits = higherCalcIndicators(charts)
  if (!hits.length) return ''
  const seen = [...new Set(hits.map(h => `${tfLabel(h.frame)}-calculated ${h.name}`))]
  const list = seen.length === 1 ? `the ${seen[0]}` : `the ${seen.slice(0, -1).join(', ')} and ${seen.at(-1)}`
  return `. Note: ${list} ${seen.length === 1 ? 'is' : 'are'} not cut at the cutoff — ${seen.length === 1 ? 'it reads' : 'they read'} its own higher-timeframe bars, and each bar shows the last such period that had closed before it`
}
const lastVisibleIndex = (times, tf, v, extended) => {
  let i = -1
  for (let k = 0; k < times.length; k++) if (barVisible({ t: times[k] }, tf, v, { extended })) i = k
  return i
}

/** Compute and write the stepped cutoff for chart `ref`. Throws a complete (member-facing) error with NOTHING written. */
export async function stepReplay(host, ref, { direction, bars: n, from }, { now = Date.now() } = {}) {
  const snap = host.charts.read(ref)
  const v = snap?.replay ?? null
  if (!v) throw stopped(NOT_ON)
  if (v !== from) throw stopped('Replay Mode moved while I was stepping it, so I left it where it is now. Nothing was changed.')
  const held = typeof host.charts.replayBarTimes === 'function' ? await host.charts.replayBarTimes(ref, {}) : null
  if (!held || !Array.isArray(held.times)) throw stopped('I couldn’t read that chart’s bars, so I can’t tell where its next bar is. Nothing was changed.')
  const { tf, extended } = held
  if (!NATIVE_TFS.includes(tf)) throw stopped(customRefusal(tf))
  let times = held.times
  const pos = lastVisibleIndex(times, tf, v, extended)
  let target
  if (direction === 'back') {
    if (pos < 0) throw stopped(`This chart has no bar at or before ${cutoffWords(v)}, so there is nothing to step back to. Nothing was changed.`)
    if (pos - n < 0) throw stopped(pos === 0
      ? `Replay Mode is already at this chart’s first bar (${cutoffWords(cutoffThrough(times[0], tf, extended))}), so it can’t step back. Nothing was changed.`
      : `This chart has only ${barsWord(pos)} before the cutoff, so it can’t step back ${barsWord(n)}. Nothing was changed.`)
    target = times[pos - n]
  } else {
    if (pos + n >= times.length) {
      // the bars after the cutoff are not held: the SAME request the chart makes, for a window ending later
      const heldTo = cutoffFetchDay(v, tf)
      const through = [addDays(heldTo, lookAheadDays(tf, n)), etYmd(now)].sort()[0]
      const more = through > heldTo ? await host.charts.replayBarTimes(ref, { throughDay: through }) : null
      if (more && Array.isArray(more.times)) {
        const anchor = pos >= 0 ? times[pos] : null
        const at = anchor == null ? -1 : more.times.findIndex(t => t === anchor)
        if (anchor != null && at < 0) throw stopped('I couldn’t line that chart’s later bars up with the ones it shows, so I can’t step it safely. Nothing was changed.')
        times = more.times
        const p2 = anchor == null ? lastVisibleIndex(times, tf, v, extended) : at
        if (p2 + n < times.length) target = times[p2 + n]
        else {
          const left = Math.max(0, times.length - 1 - p2)
          throw stopped(left === 0
            ? `There is no later bar on this chart (Replay Mode is at ${cutoffWords(v)}). Exit Replay Mode to see every bar. Nothing was changed.`
            : `This chart has only ${barsWord(left)} after the cutoff, so it can’t step forward ${barsWord(n)}. Nothing was changed.`)
        }
      } else throw stopped(`There is no later bar on this chart (Replay Mode is at ${cutoffWords(v)}). Exit Replay Mode to see every bar. Nothing was changed.`)
    } else target = times[pos + n]
    // never onto a bar that has not finished: its sessions after now are not history yet
    const end = barEndMs(target, tf, extended)
    if (end == null || end > now) throw stopped(`The next bar on this chart is still forming, so Replay Mode can’t step onto it yet (it is at ${cutoffWords(v)}). Nothing was changed.`)
  }
  const to = cutoffThrough(target, tf, extended)
  if (!to) throw stopped('I couldn’t work out where that bar ends, so I left Replay Mode where it is. Nothing was changed.')
  if (to === v) throw stopped(`Replay Mode is already through that bar (${cutoffWords(v)}), so there is nothing to move. Nothing was changed.`)
  if (!host.charts.setReplay?.(to)) throw stopped('Replay Mode didn’t take the new cutoff. Nothing was changed.')
  const t0 = Date.now()
  while (Date.now() - t0 < 3000 && (host.charts.read(ref)?.replay ?? null) !== to) await new Promise(r => setTimeout(r, 50))
  const others = (host.charts.list?.() || []).filter(s => s.ref !== ref && s.tf && s.tf !== snap.tf).length
  const line = `Moved Replay Mode ${direction} ${barsWord(n)} of this chart (${tfLabel(tf)}): every chart now shows only what was known by ${cutoffWords(to)}`
    + `${others ? ' (charts on other timeframes show only their bars that were complete by then)' : ''}`
    + higherCalcNote(host.charts.list?.() || [])
  return { to, line, precise: isPreciseCutoff(to) }
}

let registered = false
export function registerReplayModeCapabilities() {
  if (registered) return
  registered = true
  registerCapability({
    target: 'chart', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts',
    name: STEP_ACTION,
    summary: `Step Tools → Replay Mode forward or back by N bars (1–${MAX_STEP}) of ONE chart’s own timeframe: daily = sessions, intraday = real bars; every chart hides what came after. Undo puts the cutoff back exactly.`,
    hints: 'Only while Replay Mode (the as-of-a-date cutoff) is on. target = the chart whose bars to count. Replay Mode has no play/pause/speed (that is the bar replay, chartReplay.playback).',
    args: { type: 'object', properties: { direction: { type: 'string', enum: ['forward', 'back'] }, bars: { type: 'integer' } }, required: ['direction', 'bars'], additionalProperties: false },
    fastWhole: true,
    fast,
    check(st, { direction, bars } = {}) {
      if (direction !== 'forward' && direction !== 'back') return 'Step Replay Mode forward or back?'
      if (!Number.isInteger(bars) || bars < 1 || bars > MAX_STEP) return `I can step Replay Mode 1 to ${MAX_STEP} bars at a time — or set its date (“replay as of <date>”).`
      if (st.replay === undefined || st.canStepReplay !== true) return NOT_HERE
      if (!st.replay) return NOT_ON
      if (!NATIVE_TFS.includes(String(st.tf))) return customRefusal(st.tf)
      return null
    },
    apply: (st, { direction, bars }) => (st.replay ? { ...st, replayStep: { direction, bars, from: st.replay } } : st),
    describe: (b, a, { direction, bars } = {}) => (a.replayStep ? `Moved Replay Mode ${direction} ${barsWord(bars)} of this chart` : null),
  })
}
