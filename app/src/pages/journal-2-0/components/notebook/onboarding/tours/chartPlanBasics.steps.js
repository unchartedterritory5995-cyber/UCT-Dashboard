// Tour `chart-plan-basics` (W14-B2, plan 4.2 row 13; D6: the first of two chart-plan tours).
// Anchors live in WidgetEmbedView.jsx (the chart in a note, its Draw and Plan buttons) and
// ChartPlanPanel.jsx (the plan panel), the capability's own components (wave 13 lane 13H-2).
// On a computer the chart's toolbar shows while the pointer is over the chart, and the
// panel only once Plan is open. The Plan step waits for the member to open it (`waitFor`,
// W14-C1), so the panel steps show; a step whose anchor never appears is skipped.
const EMBED = 'components/notebook/WidgetEmbedView.jsx'
const PANEL = 'components/notebook/ChartPlanPanel.jsx'
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })

export const STEPS = Object.freeze([
  step('chart', 'chart-embed', EMBED),
  step('draw', 'chart-plan-draw', EMBED),
  Object.freeze({ id: 'plan', anchor: 'chart-plan-open', file: EMBED, waitFor: 'chart-plan-panel' }),
  step('roles', 'chart-plan-panel', PANEL),
  step('numbers', 'chart-plan-numbers', PANEL),
  step('alert', 'chart-plan-alert', PANEL),
])

export const COPY = Object.freeze({
  chart: Object.freeze({
    title: 'The chart is your plan',
    body: 'A chart in a note can hold your trade plan: the lines you draw become the entry, stop and target. On a computer, point at the chart to show its toolbar.',
  }),
  draw: Object.freeze({
    title: 'Draw your levels',
    body: 'Choose Draw, then the horizontal line tool, and place a line at each price that matters. Choose Done when you finish.',
  }),
  plan: Object.freeze({
    title: 'Open the plan',
    body: 'Plan lists every flat line you drew, with its price. Choose Plan to continue.',
  }),
  roles: Object.freeze({
    title: 'Entry, stop and target',
    body: 'Mark each line as Entry, Stop or Target. The marks are saved in the note, and the plan grade reads them after the trade.',
  }),
  numbers: Object.freeze({
    title: 'Reward to risk and size',
    body: 'With an entry and a stop set, you see R:R, risk per share, account risk and a position size, and which method sized it. Use this size writes it into the plan.',
  }),
  alert: Object.freeze({
    title: 'Alert at a level',
    body: 'Arm an alert at any drawn line. Move the line and the alert moves with it; delete the line and the alert goes too.',
  }),
})
