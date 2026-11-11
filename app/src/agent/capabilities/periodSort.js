// ── PERIOD SORT capability: Tools → Custom-Period Sort (C3-205, C3-206, C3-207) ─────────────────────────────
//
// What a member does by hand: Tools → Custom-Period Sort, drag a span on a chart, then in the popover pick
// Sort (US Common Stocks | Themes | Sectors | Industries), Start, End, Replay mode and Mark start, and press
// Sort. A floating results panel opens; its Dock button turns it into a grid widget.
//
// The Agent writes through the SAME functions (pages/charts/ChartsWorkspace.jsx):
//   periodSort.run  → runPeriodSort, the popover's own Sort (the drag only fills the popover's dates, so the dates
//                     are given here). Opens the panel; sets the Replay cutoff to End or CLEARS it (Replay mode off),
//                     sets or clears the start marker, exactly as Sort always has. A VIEW: the panel is not saved.
//                     It never switches timeframes (the popover's Timeframe is left out: chart.setTimeframe does that).
//                     Undo: the panel, cutoff and marker exactly as they were.
//   periodSort.dock → handleDockPeriodSort, the open panel's own Dock: a Period Sort widget on the board (saved with
//                     the layout). Undo: the widget is removed, any widget the dock's split resized gets its size
//                     back, and the floating panel returns.
//
// ⛔ A receipt follows a read-back: the panel / cutoff / marker (run) or the new widget on the board (dock).
// ⛔ Unreadable state is "unavailable", never "no panel open": host.periodSort.read() returning null refuses.
// ⛔ No existing Period Sort WIDGET is ever targeted here (that is widget.setOption / whichWidget.js): run makes
//    the floating panel, dock acts only on the floating panel that is open.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { resolveDateWord, dayWord, isoDayMs, etToday } from '../dateWords'

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const onCharts = (ctx) => ctx.surface === 'charts'
const settle = () => new Promise(r => setTimeout(r, 40))

export const PERIOD_SORT_GROUPS = ['stocks', 'theme', 'sector', 'industry']
export const PERIOD_SORT_MARKS = ['off', 'line', 'candle']
const GROUP_LABEL = { stocks: 'US common stocks', theme: 'themes', sector: 'sectors', industry: 'industries' }
const UNREADABLE = 'I can\'t read the Custom-Period Sort right now, so I won\'t change it. Try again in a moment.'
const MAX_WAIT_MS = 3000

// YYYYMMDD (what the popover hands Sort) ⇄ ISO
const isoToYmd = (iso) => parseInt(String(iso).replace(/-/g, ''), 10)
const ymdToIso = (ymd) => { const s = String(ymd); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` }
const groupKey = (g) => (g == null || g === 'stocks' ? null : g)

function readSort(host) {
  if (!host?.periodSort) return null                      // not on this page (Multi Chart, another page): no target
  let r = null
  try { r = host.periodSort.read?.() ?? null } catch { r = null }
  // ⛔ present but unreadable: a target that REFUSES (UNREADABLE), never one that looks like "no panel open"
  if (!r) return { ref: 'periodSort', label: 'Custom-Period Sort (Tools menu)', unreadable: true, panel: null, cutoff: null, marker: null, markerStyle: 'line', widgets: [] }
  let widgets = []
  try { widgets = (host.periodSort.widgets?.() || []).map(w => ({ id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, opts: w.type === 'periodsort' ? (w.opts || {}) : undefined })) } catch { widgets = [] }
  return { ref: 'periodSort', label: 'Custom-Period Sort (Tools menu)', panel: r.panel || null, cutoff: r.cutoff ?? null, marker: r.marker ?? null, markerStyle: r.markerStyle || 'line', widgets }
}
const viewOf = (s) => ({ panel: s.panel ? { start: s.panel.start, end: s.panel.end, group: s.panel.group ?? null } : null, cutoff: s.cutoff ?? null, marker: s.marker ?? null, markerStyle: s.markerStyle || 'line' })
const viewLanded = (snap, want) => !!snap && sameJson(viewOf(snap), viewOf(want))
const geom = (ws) => (ws || []).map(w => [w.id, w.x, w.y, w.w, w.h])
const dockedMatch = (w, panel) => w.type === 'periodsort' && Number(w.opts?.start) === Number(panel.start) && Number(w.opts?.end) === Number(panel.end) && (w.opts?.group ?? null) === (panel.group ?? null)

async function waitFor(host, ok) {
  const t0 = Date.now()
  for (;;) {
    const s = readSort(host)
    if (s && !s.unreadable && ok(s)) return s
    if (Date.now() - t0 > MAX_WAIT_MS) return null
    await settle()
  }
}

export const periodSortKind = {
  name: 'periodSort',
  list: (host) => { const s = readSort(host); return s ? [s] : [] },
  read: (host, ref) => (ref === 'periodSort' ? readSort(host) : null),
  stateOf: (s) => ({ ...viewOf(s), widgets: s.widgets, unreadable: !!s.unreadable, run: null, dock: false }),
  patch(before, after) {
    if (after.dock) return before.panel ? { dock: { ...before.panel } } : null
    if (!after.run) return null
    // a run always re-opens the panel (the popover's Sort does, even on the same range): never a no-op
    return { run: { ...after.run }, set: viewOf(after) }
  },
  async commit(host, ref, patch) {
    const ps = host?.periodSort
    if (!ps) throw new Error('the Custom-Period Sort is not on this page')
    if (patch.run) {
      if (!ps.run(patch.run)) throw new Error('the Custom-Period Sort did not take the request')
      if (!await waitFor(host, s => viewLanded(s, patch.set))) throw new Error('the Custom-Period Sort panel did not open with that range')
      return true
    }
    if (patch.restore) {
      if (!ps.restore(patch.restore)) throw new Error('the Custom-Period Sort could not be put back')
      if (!await waitFor(host, s => viewLanded(s, patch.restore))) throw new Error('the Custom-Period Sort did not go back')
      return true
    }
    if (patch.dock) {
      const before = readSort(host)
      if (!before || before.unreadable) throw new Error('the Custom-Period Sort could not be read')
      if (!before.panel || !sameJson(viewOf(before).panel, viewOf({ panel: patch.dock }).panel)) throw new Error('the Custom-Period Sort panel changed before it could be docked')
      const known = new Set(before.widgets.map(w => w.id))
      const id = ps.dock()
      if (!id) throw new Error('there is no Custom-Period Sort panel to dock')
      const after = await waitFor(host, s => !s.panel && s.widgets.some(w => w.id === id && !known.has(w.id) && dockedMatch(w, patch.dock)))
      if (!after) throw new Error('the Period Sort widget did not appear on the board')
      // any widget the dock's split resized, as it was (Undo puts it back)
      const set = {}
      for (const w of before.widgets) {
        const n = after.widgets.find(x => x.id === w.id)
        if (n && (n.x !== w.x || n.y !== w.y || n.w !== w.w || n.h !== w.h)) set[w.id] = { x: w.x, y: w.y, w: w.w, h: w.h }
      }
      return { undoData: { undock: { remove: id, set, panel: { ...patch.dock } } } }
    }
    if (patch.undock) {
      if (!ps.undock(patch.undock)) throw new Error('the Period Sort widget could not be taken back')
      const u = patch.undock
      if (!await waitFor(host, s => !s.widgets.some(w => w.id === u.remove) && sameJson(viewOf(s).panel, viewOf({ panel: u.panel }).panel)
        && Object.entries(u.set || {}).every(([id, g]) => { const w = s.widgets.find(x => x.id === id); return w && w.x === g.x && w.y === g.y && w.w === g.w && w.h === g.h }))) {
        throw new Error('the board did not go back')
      }
      return true
    }
    return false
  },
  landed(snap, patch) {
    if (!snap || snap.unreadable) return false
    if (patch.run) return viewLanded(snap, patch.set)
    if (patch.restore) return viewLanded(snap, patch.restore)
    if (patch.dock) return !snap.panel && snap.widgets.some(w => dockedMatch(w, patch.dock))
    if (patch.undock) return !snap.widgets.some(w => w.id === patch.undock.remove)
    return false
  },
  undoPatch(item) {
    const p = item.patch || {}
    if (p.run) return { restore: viewOf(item.before) }
    if (p.dock) return item.undoData?.undock ? { undock: item.undoData.undock } : null
    return null
  },
  // stale once the member changed what this change wrote: the panel / cutoff / marker (run), the board (dock)
  fingerprint: (s) => (s ? JSON.stringify([viewOf(s), geom(s.widgets)]) : 'gone'),
  fingerprintFor: (host, s, item) => {
    if (!s) return 'gone'
    if (item?.patch?.dock) return JSON.stringify([viewOf(s).panel, geom(s.widgets)])
    return JSON.stringify(viewOf(s))
  },
}

// "oct 1" / "2026-10-01" / "today" → ISO, or a refusal sentence
function dayOf(raw, what) {
  const r = resolveDateWord(String(raw ?? '').trim())
  if (!r) return { err: `I couldn't read “${raw}” as the ${what} date — use YYYY-MM-DD or a day like “Oct 1”.` }
  if (r.future) return { err: `${dayWord(r.to)} hasn't happened yet — the ${what} date has to be today or earlier.` }
  if (isoDayMs(r.to) < Date.UTC(1990, 0, 1)) return { err: `The ${what} date is earlier than the sort's history.` }
  return { iso: r.to }
}
function rangeOf({ start, end }) {
  const s = dayOf(start, 'start')
  if (s.err) return s
  const e = end == null || String(end).trim() === '' ? { iso: etToday() } : dayOf(end, 'end')
  if (e.err) return e
  if (!(isoToYmd(s.iso) < isoToYmd(e.iso))) return { err: 'The end date must be after the start date.' }
  return { start: isoToYmd(s.iso), end: isoToYmd(e.iso) }
}

let registered = false
export function registerPeriodSortCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(periodSortKind)
  registerContextProvider({
    key: 'periodSort',
    build: (host, refFor) => {
      const s = readSort(host)
      if (!s) return undefined
      return [{ ref: refFor('periodSort', 'periodSort'), label: s.label, ...(s.unreadable ? { unavailable: true } : {}),
        open: s.panel ? `${dayWord(ymdToIso(s.panel.start))} → ${dayWord(ymdToIso(s.panel.end))}, ${GROUP_LABEL[s.panel.group || 'stocks']}` : null }]
    },
  })
  const common = { target: 'periodSort', surfaces: ['charts'], available: onCharts }

  registerCapability({
    ...common,
    name: 'periodSort.run',
    summary: 'Tools → Custom-Period Sort: rank US common stocks (or themes, sectors, industries) by their % change between a start and an end date, in a floating results panel — the popover\'s own Sort. Replay mode hides bars after the end date on every chart; Mark start draws the start date. A view: not saved; Undo closes it.',
    hints: 'start / end = YYYY-MM-DD or the member\'s words ("oct 1"); end null = today. group = stocks | theme | sector | industry ("rank sectors since …" = sector). '
      + 'replay = true only when asked to hide bars after the end ("as of the end date"); false otherwise — exactly as the popover, Sort without Replay mode also turns an active replay off. '
      + 'markStart = off | line (gold line at the start) | candle (gold start candle). Never changes the charts\' timeframe.',
    args: {
      type: 'object',
      properties: {
        start: { type: 'string' },
        end: { type: ['string', 'null'] },
        group: { type: 'string', enum: PERIOD_SORT_GROUPS },
        replay: { type: 'boolean' },
        markStart: { type: 'string', enum: PERIOD_SORT_MARKS },
      },
      required: ['start', 'end', 'group', 'replay', 'markStart'], additionalProperties: false,
    },
    argAliases: { start: ['from', 'since', 'startDate', 'start_date'], end: ['to', 'until', 'through', 'endDate', 'end_date'], group: ['groupBy', 'by', 'sort'], markStart: ['mark', 'marker', 'mark_start'] },
    coerce: { group: { stock: 'stocks', themes: 'theme', sectors: 'sector', industries: 'industry', 'us common stocks': 'stocks' }, markStart: { none: 'off', false: 'off', 'vertical line': 'line', 'gold line': 'line', 'start candle': 'candle' } },
    defaults: { group: 'stocks', replay: false, markStart: 'off' },
    shape: '{"start":"2026-10-01","end":null,"group":"stocks","replay":false,"markStart":"off"}',
    check(st, args) {
      if (!st || st.unreadable) return UNREADABLE
      const r = rangeOf(args)
      if (r.err) return r.err
      if (!PERIOD_SORT_GROUPS.includes(args.group)) return 'Sort what: US common stocks, themes, sectors or industries?'
      if (!PERIOD_SORT_MARKS.includes(args.markStart)) return 'Mark the start as a gold line, a gold candle, or not at all?'
      return null
    },
    apply(st, args) {
      const r = rangeOf(args)
      const group = groupKey(args.group)
      const run = { start: r.start, end: r.end, group, replay: !!args.replay, markStart: args.markStart }
      return {
        ...st, run,
        panel: { start: r.start, end: r.end, group },
        cutoff: args.replay ? ymdToIso(r.end) : null,
        marker: args.markStart !== 'off' ? ymdToIso(r.start) : null,
        markerStyle: args.markStart === 'line' || args.markStart === 'candle' ? args.markStart : st.markerStyle,
      }
    },
    describe(b, a) {
      if (!a.run) return null
      const parts = [`Custom-Period Sort: ${GROUP_LABEL[a.run.group || 'stocks']} ranked by % change from ${dayWord(ymdToIso(a.run.start))} to ${dayWord(ymdToIso(a.run.end))}, in a floating panel (not saved — dock it to keep it)`]
      if (a.cutoff) parts.push(`Replay Mode hides every bar after ${dayWord(a.cutoff)}`)
      else if (b.cutoff) parts.push('Replay Mode is off (the sort turns it off unless asked)')
      if (a.marker) parts.push(`the start is marked with a gold ${a.markerStyle === 'candle' ? 'candle' : 'line'}`)
      else if (b.marker) parts.push('the start marker is cleared')
      return parts.join('; ')
    },
    noop: () => 'That sort is already open',
  })

  registerCapability({
    ...common,
    name: 'periodSort.dock',
    summary: 'Dock the open Custom-Period Sort results panel onto the board as a Period Sort widget (the panel\'s own Dock button), so it is kept with the layout. Undo takes it off the board and brings the panel back.',
    hints: 'Only when a Custom-Period Sort panel is open (the context says which range). "Keep / pin / dock that ranking" = this. Adding it as a tab of another widget is not offered.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    check(st) {
      if (!st || st.unreadable) return UNREADABLE
      if (!st.panel) return 'There is no Custom-Period Sort panel open to dock. Ask me to run one first (for example "rank stocks from Oct 1 to today").'
      return null
    },
    apply: (st) => ({ ...st, dock: true }),
    describe: (b, a) => (a.dock && b.panel ? `Docked the Custom-Period Sort (${dayWord(ymdToIso(b.panel.start))} → ${dayWord(ymdToIso(b.panel.end))}, ${GROUP_LABEL[b.panel.group || 'stocks']}) onto the board as a Period Sort widget` : null),
    noop: () => 'There is nothing to dock',
  })
}
