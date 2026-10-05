// Tour `chart-plan-replay` (W14-B2, plan 4.2 row 14; D6: the second of two chart-plan tours).
// Anchors live in WidgetEmbedView.jsx (the chart, its Replay button and timeframe switch) and
// BarReplay.jsx (the replay's own controls), the capability's own components (wave 13 lane
// 13H-2). The replay controls are on screen only while a replay is open; the engine skips
// that step otherwise.
const EMBED = 'components/notebook/WidgetEmbedView.jsx'
const REPLAY = 'components/notebook/BarReplay.jsx'
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })

export const STEPS = Object.freeze([
  step('chart', 'chart-embed', EMBED),
  step('replay', 'chart-plan-replay', EMBED),
  step('controls', 'chart-replay-controls', REPLAY),
  step('context', 'chart-embed-timeframe', EMBED),
])

export const COPY = Object.freeze({
  chart: Object.freeze({
    title: 'What happened next',
    body: 'A chart in a note is frozen at the day you wrote it. You can replay what the stock did after that, one bar at a time.',
  }),
  replay: Object.freeze({
    title: 'Replay',
    body: 'Replay opens the bars after the note with your entry, stop and target drawn as lines, so you can test the plan without hindsight.',
  }),
  controls: Object.freeze({
    title: 'Step through it',
    body: 'Play, step one bar at a time, change the speed or drag to any point. The line above says how far you are and when the stop or target was hit.',
  }),
  context: Object.freeze({
    title: 'More context',
    body: 'Switch the timeframe here. In a note, type /vs and a symbol to see it beside SPY, QQQ or its sector, or /mtf, a symbol and W for a weekly, daily and hourly stack.',
  }),
})
