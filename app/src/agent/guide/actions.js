// ── UCT Agent PRODUCT GUIDE: the action families ────────────────────────────────────────────────────────────
//
// registry.js teaches a feature; a family here teaches MANY small actions that share a surface: everything on the
// chart's right-click menu, on a legend chip's menu, in a watchlist row, on the layout bar. A family is one feature and a
// table of rows. A row is { id, label, re, steps }: `re` says which words name it, `steps` are its walkthrough, and the
// feature's own steps say `{ each: 'slot' }` to take them (guide/slots.js stepsFor). `explain` is what a row says when its
// first control is not on screen.
//
// ⛔ NEVER INVENT A CONTROL. Every row walks to a control the product renders (agentGuideTargets.test.js reads the source)
// and is proved in a real browser before teach-status.md calls it VERIFIED. A row's `re` is not a phrase rule: it only
// narrows a family the member has already reached by asking how to do something.
//
// ⭐ A control that appears only after a right-click: the step asks for the right-click, on the real region, and moves on
// when the menu row it needs appears (`waitFor`). A menu for another region does not satisfy it.

// ── shared openings (registry.js uses the same ones) ──
export const GEAR = { target: 'chart.settings', name: 'the chart’s settings gear', text: 'Open this chart’s settings with the gear.', waitFor: 'chartSettings' }
export const TOOLS_MENU = { target: 'workspace.tools', name: 'the Tools menu', text: 'Open Tools ▾.', waitFor: 'workspace.toolsMenu' }

// the way a member asks is not what they ask about: "show me how…" names no Show, "walk me through…" no walk
const ASKING = /\b(show me|walk me through|guide me (through|to)|teach me|help me)\b/g
const firstRow = (rows) => (text) => {
  const q = String(text || '').toLowerCase().replace(ASKING, ' ')
  return rows.find(r => r.re.test(q)) || null
}

// ── the chart's right-click menu (components/StockChart.jsx sections → components/chart/ChartContextMenu.jsx) ──
const menuRow = (id) => ({ within: 'chart.contextMenu', attr: 'data-menu-id', value: id })
const WHERE = {
  chart: 'Right-click anywhere on the chart.',
  price: 'Right-click on the chart, at the price you want.',
  axis: 'Right-click on the price numbers at the right edge of the chart.',
  volume: 'Right-click on the volume bars at the bottom of the chart.',
  average: 'Right-click on a moving average line.',
}
const rightClick = (id, where, name, say, opts = {}) => [
  { target: 'chart.plot', name: 'the chart', text: WHERE[where], waitFor: menuRow(id) },
  { target: menuRow(id), name, text: say, endsOnClick: true, ...opts },
]

export const CHART_MENU = [
  { id: 'setAlert', label: 'An alert at a price on the chart', re: /\balerts?\b.*(\bright[- ]?click\w*\b|\bon the chart\b|\bat (this|that|a) (price|level)\b)/, steps: rightClick('set-alert', 'price', 'Set alert', 'Click Set alert: it sets a price alert at the price you clicked. Alt+N does the same at the pointer.') },
  { id: 'reset', label: 'Resetting the view', re: /\breset\b.*\b(view|zoom|chart position)\b/, steps: rightClick('reset', 'chart', 'Reset view', 'Click Reset view to go back to the default window.') },
  { id: 'journal', label: 'Sending a chart to the Journal', re: /\b(send|save|capture)\b.*\bchart\b.*\b(journal|notebook)\b|\bchart\b.*\bto (the |my )?(journal|notebook)\b/, steps: rightClick('journal', 'chart', 'Send to Journal', 'Click Send to Journal, or the row below it to choose where it goes.') },
  { id: 'volumeOptions', label: 'Volume settings', re: /\bvolume\b.*\b(separate|own pane|colou?rs?|settings?|hvc|highlight|moving average|ma|label|bar style)\b|\b(separate|own) pane\b.*\bvolume\b|\bhvc\b|\bhigh volume close\b/, steps: [
    ...rightClick('settings-volume', 'volume', 'Volume settings', 'Click Volume settings.', { endsOnClick: false, waitFor: { within: 'chartSettings', attr: 'data-row-primary', text: 'Volume' } }),
    { target: { within: 'chartSettings', attr: 'data-row-primary', text: 'Volume' }, name: 'Volume', text: 'Click Volume in this list.', waitFor: { within: 'chartSettings', attr: 'data-field', value: 'separatePane' } },
    { target: { within: 'chartSettings', attr: 'data-field', value: 'hvcEnabled' }, name: 'the volume settings', text: 'Here: the 52-week volume highlight, the volume average, bar style, colours and separate pane.' },
  ] },
  { id: 'axisSettings', label: 'Axis settings', re: /\baxis\b.*\bsettings?\b|\bsettings?\b.*\baxis\b/, steps: rightClick('settings-axis', 'axis', 'Axis settings', 'Click Axis settings to open the axis labels.') },
  { id: 'maSettings', label: 'A moving average’s settings', re: /\bmoving average\b.*\bright[- ]?click\w*\b|\bright[- ]?click\w*\b.*\bmoving average\b/, steps: rightClick('settings-ma', 'average', 'MA settings', 'Click MA settings to open the moving averages.') },
  { id: 'template', label: 'A template from the right-click menu', re: /\btemplates?\b.*\bright[- ]?click\w*\b|\bright[- ]?click\w*\b.*\btemplates?\b/, steps: rightClick('template', 'chart', 'Chart template', 'Click Chart template, then pick a saved look.') },
  { id: 'addWidget', label: 'Adding a widget by right-click', re: /\bwidgets?\b.*\bright[- ]?click\w*\b|\bright[- ]?click\w*\b.*\bwidgets?\b/, steps: rightClick('add-widget', 'chart', 'Add widget', 'Click Add widget and pick one: it floats on top of the board.') },
  { id: 'clearDrawings', label: 'Clearing all drawings', re: /\b(clear|delete|remove|erase|wipe)\b.*\b(all|every|my)\b.*\bdrawings?\b/, steps: rightClick('clear-draw', 'chart', 'Clear all drawings', 'Click Clear all drawings. This row only shows while the chart has drawings.') },
  { id: 'menu', label: 'The chart’s right-click menu', re: /\bright[- ]?click\w*\b.*\b(menu|chart)\b|\bmenu\b.*\bright[- ]?click\w*\b/, steps: rightClick('settings', 'chart', 'the menu', 'This is the chart’s menu: set an alert, reset the view, open its settings, apply a template, add a widget. The settings row changes with where you clicked.') },
]

// ── a legend chip's menu (components/chart/legend/chipMenu.js) ──
const chipItem = (id) => ({ within: 'chart.chipMenu', attr: 'data-menu-id', value: id })
const chip = (id, name, say, ask = 'Click {ind.label} in the chart’s legend, at the top left.') => [
  { only: 'ind', target: [{ id: 'chart.chip', named: '{ind.label}' }, { id: 'chart.chip', named: '{ind.labelName}' }, 'chart.chip'], name: 'the chart’s legend', text: ask, altText: '{ind.label} isn’t on this chart. Add it first, or click another indicator here.', waitFor: chipItem(id) },
  { unless: 'ind', target: 'chart.chip', name: 'the chart’s legend', text: 'Click the indicator in the chart’s legend, at the top left.', waitFor: chipItem(id) },
  { target: chipItem(id), name, text: say, endsOnClick: true },
]
export const LEGEND_MENU = [
  { id: 'alert', label: 'An alert from the legend', re: /\b(alert)\b.*\b(legend|chip)\b|\b(legend|chip)\b.*\balert\b/, steps: chip('alerts', 'Add alert', 'Click Add alert to open the alert form for this indicator.') },
  { id: 'customCopy', label: 'A custom copy of an indicator', re: /\bcustom copy\b|\bmy own (copy|version)\b/, steps: chip('custom-copy', 'Create custom copy', 'Click Create custom copy to make your own editable version.') },
  { id: 'duplicate', label: 'Duplicating an indicator', re: /\b(duplicate|copy of|another copy|second copy|clone)\b/, steps: chip('duplicate', 'Duplicate on chart', 'Click Duplicate on chart to add a second copy with the same settings.') },
  { id: 'modify', label: 'Modifying an indicator with UCT Intelligence', re: /\bmodify\b/, steps: chip('modify', 'Modify with UCT Intelligence', 'Click Modify with UCT Intelligence to change this indicator in the builder.', 'Click one of your own indicators in the legend. A built-in one has no Modify: make a custom copy of it first.') },
  { id: 'headerValue', label: 'An indicator’s value in the header', re: /\b(latest |current )?value\b.*\bheader\b|\bheader\b.*\bvalue\b/, steps: chip('info-value', 'Show latest value in header', 'Click this to show the latest value in the chart’s header.') },
  { id: 'about', label: 'What an indicator does', re: /\babout\b.*\b(text|indicator)\b|\bread\b.*\babout\b|\bdescription of\b/, steps: chip('about', 'About', 'Click About to read what this indicator does.') },
  { id: 'displayIn', label: 'Moving an indicator to another pane', re: /\b(move|display|put|show)\b.*\b(in|into|to) (another|a different|a new|the price|its own|a separate)\b.*\b(pane|panel|chart)?\b|\bdisplay in\b/, steps: chip('move', 'Display in', 'Click Display in, then choose the pane: the price chart, a new pane, or another indicator’s pane.') },
  { id: 'edit', label: 'Editing an indicator from the legend', re: /\b(legend|chip)\b.*\b(edit|settings?)\b|\b(edit|settings?)\b.*\b(legend|chip)\b/, steps: chip('settings', 'Edit in Indicators', 'Click Edit in Indicators to open this indicator’s settings.') },
  { id: 'remove', label: 'Removing an indicator', re: /\b(remove|delete|get rid of|take off|take away)\b/, steps: chip('remove', 'Delete', 'Click Delete to take this indicator off the chart. Undo brings it back.') },
  { id: 'hide', label: 'Hiding or showing an indicator', re: /\b(hide|show|unhide|turn off)\b/, steps: chip('hidden', 'Hide or Show', 'Click this to hide the indicator or show it again. Nothing about it is lost.') },
]

// ── what is on the chart itself, and the chart's keys (components/chart/keyboardShortcuts.js) ──
const key = (combo, say) => [{ target: 'chart.plot', name: 'the chart', text: `Click the chart, then press ${combo}. ${say}` }]
const DIVIDER = { within: 'chart.plot', cursor: 'row-resize' }
// a pane named: the line along ITS top edge, found from where its own legend sits, never the first line on the chart
const divider = (say, alt) => [
  { only: 'ind', target: [{ ...DIVIDER, above: '{ind.label}' }, { ...DIVIDER, above: '{ind.labelName}' }, 'chart.plot'], name: 'the line above {ind.label}', text: say, altText: '{ind.label} has no pane of its own on this chart, so there’s no line to drag for it.' },
  { unless: 'ind', target: [DIVIDER, 'chart.plot'], name: 'the line between the panes', text: say, altText: alt },
]
export const CHART_VIEW = [
  { id: 'paneResize', label: 'Resizing a pane', re: /\b(resiz\w*|drag\w*|bigger|smaller|taller|shorter|height|tall)\b.*\b(panes?|divider|separator|volume)\b|\b(panes?|divider|separator)\b.*\b(resiz\w*|drag\w*|bigger|smaller|taller|shorter|height)\b/, steps: divider('Point at this line until the cursor changes, then drag it up or down. The pane on each side gives way.', 'This chart has only one pane, so there’s no line to drag. Add a pane indicator such as RSI, or put volume in its own pane.') },
  { id: 'range', label: 'Showing a set range', re: /\brange (buttons?|bar)\b|\b(3|6)[- ]?(m|months?)\b.*\b(view|chart|range|history)\b|\b(ytd|year to date|5 years?|five years|one year|1 year|last year)\b/, steps: [{ target: 'chart.range', name: 'the range buttons', text: 'These buttons frame the chart: 3M, 6M, YTD, 1Y, 5Y or Origin. Click one.' }] },
  { id: 'session', label: 'Regular or extended hours', re: /\b(regular|extended(?! lines?\b)|pre[- ]?market|post[- ]?market|after[- ]?hours|premarket|rth)\b/, steps: [{ target: 'chart.session', name: 'the session buttons', text: 'These buttons switch between regular hours and extended hours. Pre-market and post-market buttons turn on while those sessions run.' }] },
  { id: 'share', label: 'Sharing a chart', re: /\b(share|screenshot|save (an )?image|copy (the )?image|download (the )?(chart|png))\b/, steps: [{ target: 'chart.share', name: 'the Share button', text: 'Click Share: copy an image, download a PNG, or copy a link.' }] },
  { id: 'logScale', label: 'Log, percent or arithmetic scale', re: /\b(log|logarithmic|linear|arith\w*|percent(age)?)\b.*\b(scale|axis|chart)\b|\b(scale|axis)\b.*\b(log|logarithmic|linear|arith\w*|percent\w*)\b/, steps: [{ target: 'chart.scale', name: 'the scale buttons', text: 'A is arithmetic, L is logarithmic and % is percent. Click one. With the chart selected, Shift+L turns log on and off.' }] },
  // cov-5: the light/dark palette is Shift+T on the chart (keyboardShortcuts.js toggle:theme); a UCT chart theme is chartThemes'
  { id: 'palette', label: 'Light or dark chart', re: /^(?!.*\bthemes?\b).*(\b(light|dark)\b.*\b(mode|palette|chart|canvas)\b|\b(chart|palette|canvas)\b.*\b(light|dark)\b)/, steps: key('Shift+T', 'It switches this chart between the light and dark palette; press it again to switch back.') },
  { id: 'invert', label: 'Inverting the scale', re: /\b(invert|flip|upside down)\b.*\b(scale|axis|chart|price)\b/, steps: key('Alt+I', 'It flips the price scale; press it again to flip it back.') },
  // ⭐ owner decision 2026-11-09: a price scale dragged or squeezed out of shape (pl-exec offers this when auto-scale is refused
  // on a dragged log scale). The price axis has no anchor of its own, so the chart is rung and the card says where to double-click.
  { id: 'priceScaleReset', label: 'Resetting the price scale', re: /\b(reset|restore|undo|fix|back to (normal|auto)|unsquish|un-?squeeze)\b.*\b(price (scale|axis)|y[- ]?axis|scale)\b|\b(price (scale|axis)|y[- ]?axis)\b.*\b(back to (normal|auto)|reset|stuck|squish\w*|squeez\w*|dragg\w*)\b|\b(undo|after)\b.*\b(dragg\w*|squish\w*|squeez\w*)\b.*\b(price|axis|scale)\b/, steps: [{ target: 'chart.plot', name: 'the price axis', text: 'Double-click the price axis to reset it to auto. That’s the price numbers along the right edge of the chart.' }] },
  { id: 'autoScale', label: 'Auto-scale', re:/\bauto[- ]?scal\w*\b|\bre-?fit\b.*\bprice\b/, steps: [{ target: 'chart.plot', name: 'the chart', text: 'Double-click the price numbers at the right edge of the chart: the scale fits the bars again.' }] },
  { id: 'volume', label: 'Showing or hiding volume', re: /\b(show|hide|turn (on|off)|toggle|remove|get rid of|take off|bring back)\b.*\bvolume\b/, steps: key('Ctrl+V', 'It hides the volume bars or brings them back.') },
  { id: 'zoom', label: 'Zooming the chart', re: /\bzoom\b/, steps: key('+ to zoom in or - to zoom out', 'The scroll wheel zooms too.') },
  { id: 'priceAlertKey', label: 'A price alert at the cursor', re: /\b(alert)\b.*\b(cursor|mouse|at (this|that) price)\b/, steps: key('Alt+N with the pointer at the price you want', 'The alert is set at that price.') },
  { id: 'hideAll', label: 'Hiding all indicators', re: /\b(hide|show|toggle)\b.*\b(all|every)\b.*\bindicators?\b/, steps: key('Alt+Shift+I', 'It hides every indicator, and pressing it again shows them.') },
  { id: 'toggleKeys', label: 'Toggling an indicator from the keyboard', re: /\b(keyboard|shortcut|hotkey|keys?)\b.*\b(rsi|macd|bollinger|bb|vwap)\b|\b(rsi|macd|bollinger|bb|vwap)\b.*\b(keyboard|shortcut|hotkey|keys?)\b/, steps: key('Ctrl+I for RSI, Ctrl+O for MACD, Ctrl+B for Bollinger Bands or Alt+U for VWAP', 'Each one adds that indicator or hides it.') },
  { id: 'toggleMas', label: 'Toggling moving averages', re: /\b(hide|show|toggle)\b.*\bmoving averages\b/, steps: key('Ctrl+M', 'It hides or shows the moving averages.') },
  { id: 'addIndicatorKey', label: 'The add-indicator keys', re: /\b(keyboard|shortcut|hotkey|keys?)\b.*\badd\b.*\bindicators?\b|\badd\b.*\bindicators?\b.*\b(keyboard|shortcut|hotkey|keys?)\b/, steps: key('Alt+Shift+A', 'It opens the indicator list.') },
  { id: 'addToListKey', label: 'Adding the chart’s ticker to a list', re: /\b(this|chart'?s?|current) (ticker|symbol|stock)\b.*\b(watch ?list|list)\b|\b(watch ?list|list)\b.*\b(this|chart'?s?|current) (ticker|symbol|stock)\b/, steps: key('Alt+Q', 'It offers your lists for this ticker.') },
  { id: 'flagKey', label: 'Flagging the chart’s ticker', re: /\bflag\b.*\b(this|chart'?s?|current|the) (ticker|symbol|stock)\b/, steps: key('Shift+F', 'It adds this ticker to Flagged, or takes it off.') },
]

// ── the Compare Symbols panel (pages/charts/CompareSymbolsPanel.jsx) ──
const COMPARE = [TOOLS_MENU, { target: 'workspace.tools.compare', name: 'Compare Symbols', text: 'Click Compare Symbols.', waitFor: 'compare.panel' }]
const ADD_FIRST = { within: 'compare.panel', aria: 'Add symbol' }
const compareStep = (guide, name, say, alt) => [...COMPARE, { target: alt ? [guide, ADD_FIRST] : guide, name, text: say, altText: alt }]
const NOTHING = 'Nothing is being compared yet. Add a ticker here first, and this control appears in the list below.'
const NO_GROUP = 'No group is on this chart yet. Add one with Theme, Sector or the other group buttons first.'
export const COMPARE_ACTIONS = [
  { id: 'clear', label: 'Clearing all comparisons', re: /\b(clear|remove|delete|wipe)\b.*\b(all|every(thing)?)\b|\b(all|every)\b.*\b(overlays?|comparisons?)\b.*\b(off|away|gone)\b/, steps: compareStep('compare.clear', 'Clear all', 'Click Clear all to remove every comparison.', NOTHING) },
  { id: 'groupOnly', label: 'Showing the group only', re: /\b(group only|hide (the )?base|only the (group|comparison))\b|\bhide\b.*\b(main|base|my) (symbol|ticker|stock)\b|\b(just|only)\b.*\b(show|see)\b.*\b(overlays?|comparisons?)\b|\b(show|see)\b.*\b(just|only)\b.*\b(overlays?|comparisons?)\b/, steps: compareStep('compare.hideBase', 'Group only', 'Click this to hide the base chart, so only the comparison lines show.', NOTHING) },
  { id: 'groupScale', label: 'A group’s scale', re: /\bgroups?\b.*\bscale\b|\bscale\b.*\bgroups?\b/, steps: compareStep('compare.groupScale', 'the group’s scale', 'Same puts the group on the chart’s scale; New gives it its own.', NO_GROUP) },
  { id: 'scale', label: 'A compared symbol’s scale', re: /\b(scale|axis)\b/, steps: compareStep('compare.scale', 'the symbol’s scale', 'Same puts this symbol on the chart’s scale; New gives it its own.', NOTHING) },
  { id: 'removeGroup', label: 'Removing a group', re: /\b(remove|delete|drop|get rid of|take off)\b.*\b(groups?|sector|industry|theme) ?(overlays?)?\b/, steps: compareStep('compare.removeGroup', 'the group’s ×', 'Click this × to remove the whole group.', NO_GROUP) },
  { id: 'group', label: 'Comparing a whole group', re: /\b(groups?|sectors?|themes?|industry|industries|etfs?)\b/, steps: compareStep('compare.groups', 'the group buttons', 'Pick a kind of group here, search for it, and click it to add every symbol in it.') },
  { id: 'remove', label: 'Removing a compared symbol', re: /\b(remove|delete|drop|take off|get rid of)\b|\btake\b.*\boff\b/, steps: compareStep('compare.remove', 'the symbol’s ×', 'Click this × to remove that symbol.', NOTHING) },
]

// ── small paths on panels the registry's walkthroughs already reach ──
const TF_ARROW = { target: 'chart.timeframeMore', name: 'the arrow', text: 'Click this arrow to open every timeframe.', waitFor: 'chart.timeframeMenu' }
const REPLAY = [TOOLS_MENU, { target: 'workspace.tools.replay', name: 'Replay Mode', text: 'Click Replay Mode.', waitFor: 'replay.panel' }]
// the replay date picked by clicking a bar, not typed: a cut-off with the chart or a click, replay with a click, or a replay
// date picked on the chart. “replay from October 15” names none of these and stays the date-box walkthrough.
const REPLAY_PICK = /\bcut ?-?offs?\b.*\b(charts?|bars?|candles?|click\w*)\b|\b(charts?|bars?|candles?|click\w*)\b.*\bcut ?-?offs?\b|\breplay\w*\b.*\b(click\w*|tap\w*)\b|\b(click\w*|tap\w*)\b.*\breplay\w*\b|\b(pick|choose|select|set|mark)\w*\b.*\breplay\w*\b.*\b(on|from|off) (the |a )?(charts?|bars?|candles?)\b/
const THEMES = [GEAR, { target: 'chartSettings.themes', name: 'UCT Chart Themes', text: 'Click UCT Chart Themes.', waitFor: 'chartThemes.scope' }]
export const PANEL_ACTIONS = [
  { id: 'infoRow', label: 'The header’s info row', re: /\binfo row\b/, steps: [GEAR, { target: 'chartSettings.tab.header', name: 'the Header tab', text: 'Open Header.', waitFor: { id: 'chartSettings.tab.header', on: true } }, { target: [{ within: 'chartSettings', label: 'Info Row' }, 'chartSettings.tab.header'], name: 'Info Row', text: 'Info Row chooses the fields under the title, such as Market Cap, and their colours.', altText: 'It’s on this tab: scroll down for Info Row.' }] },
  { id: 'settingsReset', label: 'Restoring a chart’s defaults', re: /\brestore\b.*\bdefaults?\b|\breset\b.*\b(chart )?(settings|defaults?)\b/, steps: [GEAR, { target: 'chartSettings.reset', name: 'Restore Defaults', text: 'Click Restore Defaults, then click again to confirm. It resets the chart’s look; your indicators stay.' }] },
  { id: 'tfRemove', label: 'Deleting a custom timeframe', re: /\b(delete|remove)\b.*\b(custom )?(time ?frames?|intervals?)\b/, steps: [TF_ARROW, { target: ['timeframe.remove', { within: 'chart.timeframeMenu', aria: 'Interval count' }], name: 'the ✕', text: 'Click this ✕ to delete that custom timeframe.', altText: 'You have no custom timeframes yet. Add one here first; each one gets a ✕ in this list.' }] },
  { id: 'tfStar', label: 'Starring a timeframe', re: /\b(star|favou?rite)\w*\b.*\b(time ?frames?|intervals?)\b|\b(time ?frames?|intervals?)\b.*\b(star|favou?rite)\w*\b/, steps: [TF_ARROW, { target: 'timeframe.star', name: 'the star', text: 'Click a star to put that timeframe on the chart’s buttons. Click it again to take it off.' }] },
  { id: 'replayExit', label: 'Leaving replay', re: /\b(exit|leave|stop|end|quit|get out of)\b.*\breplay\w*\b/, steps: [...REPLAY, { target: ['replay.exit', 'replay.panel'], name: 'Exit replay', text: 'Click Exit replay to go back to the live chart.', altText: 'Replay isn’t running, so there’s nothing to exit. Exit replay shows here while it runs.' }] },
  // ReplayPanel “Pick on chart” arms the chart (StockChart replayPick); a click on a bar reopens the panel with that date
  { id: 'replayPick', label: 'Picking the replay date on the chart', re: REPLAY_PICK, steps: [...REPLAY,
    { target: 'replay.pick', name: 'Pick on chart', text: 'Click Pick on chart. This panel closes and the chart waits for your click.', waitFor: { not: 'replay.panel' }, retreat: false },
    { target: 'chart.plot', name: 'the chart', text: 'Click the bar to replay to: every bar after it will be hidden. Replay Mode opens again with that date in it.', waitFor: 'replay.panel', retreat: false },
    { target: 'replay.start', name: 'Start replay', text: 'That’s the date you clicked. Click Start replay (it says Update while a replay is running).', off: 'Start replay stays greyed out until the date is valid.' }] },
  { id: 'themeAllWidgets', label: 'A theme on all widgets', re: /\bthemes?\b.*\ball (the )?widgets\b|\ball (the )?widgets\b.*\bthemes?\b/, steps: [...THEMES, { target: 'chartThemes.scope.allwidgets', name: 'All widgets', text: 'Click All widgets, then pick a theme. It applies to every widget in the layout.' }] },
  { id: 'themeAllCharts', label: 'A theme on all charts', re: /\bthemes?\b.*\b(all|every)( my| the)? charts?\b|\b(all|every)( my| the)? charts?\b.*\bthemes?\b/, steps: [...THEMES, { target: 'chartThemes.scope.all', name: 'All charts', text: 'Click All charts, then pick a theme. It applies to every chart in the layout.' }] },
]

// ── a widget that may not be on the board: it comes off Widgets ▾ first; one that is, skips straight past ──
const PLACE_IT = { target: 'workspace.place', name: 'the Place button', text: 'Your board is full, so choose where it goes: the arrows move it, and the gold outline shows what makes room. Then click Place.', optional: true, late: true }
export const onBoard = (id, label, result) => [
  { target: 'workspace.widgets', name: 'the Widgets menu', text: `That’s in the ${label} widget. Open Widgets ▾.`, waitFor: ['workspace.widgetsMenu', result] },
  { target: `workspace.widgets.${id}`, name: label, text: `Click ${label} to add it to your board.`, waitFor: ['workspace.place', result], off: 'Your board is full, so nothing can be added. Close a widget first.' },
  { ...PLACE_IT, waitFor: result },
]
const cellOf = (type) => ({ widgetType: type })
const inCell = (type, guide) => ({ widgetType: type, guide })
const SCAN_HEAD = { widgetType: 'scanner', aria: 'Sort by Symbol' }
// the row's own control is behind a release switch (guide/releases.js): its last step says which
const released = (name, row) => ({ ...row, steps: row.steps.map((st, i, all) => (i === all.length - 1 ? { ...st, release: name } : st)) })
const point = (type, label, target, name, say, alt) =>[...onBoard(type, label, cellOf(type)), { target: alt ? [target, cellOf(type)] : target, name, text: say, altText: alt }]

// ── the Watchlist widget (pages/Watchlists.jsx, pages/charts/widgets/WatchlistPicker.jsx) ──
const WL = 'watchlist'
const ROW = { widgetType: WL, attr: 'data-watch-sym' }
const PICKER = { widgetType: WL, attr: 'data-guide', value: 'watchlist.picker' }
const OPEN_LIST = [
  ...onBoard(WL, 'Watchlist', [ROW, PICKER]),
  { target: PICKER, name: 'your lists', text: 'Click a list to open it. It needs at least one ticker.', waitFor: ROW, optional: true, late: true },
]
const onRow = (name, say, opts = {}) => [...OPEN_LIST, { target: ROW, name, text: say, ...opts }]
const rowItem = (id) => ({ within: 'watchlist.rowMenu', attr: 'data-menu-id', value: id })
const rowMenu = (id, name, say, more = []) => [
  ...OPEN_LIST,
  { target: ROW, name: 'a ticker in the list', text: 'Right-click the ticker symbol at the left of this row. On a UCT or community list there’s no menu: open one of your own lists.', waitFor: rowItem(id) },
  { target: rowItem(id), name, text: say, endsOnClick: !more.length, ...(more.length ? { waitFor: more[0].target } : {}) },
  ...more,
]
// a row's render is pinned byte for byte (Watchlists.entitykeys.test.jsx), so these are the row's own attributes
const HEAD = { widgetType: WL, aria: 'Sort by Symbol' }
export const WATCHLIST_ACTIONS = [
  { id: 'flagged', label: 'Opening the Flagged list', re: /\b(open|see|view|show|find)\b.*\bflagged\b/, steps: [...onBoard(WL, 'Watchlist', PICKER), { target: 'watchlist.pickFlagged', name: 'Flagged', text: 'Click Flagged to open the tickers you’ve flagged.' }] },
  { id: 'flag', label: 'Flagging a ticker', re: /\b(flag|unflag|star)\b|\b(add|put)\b.*\b(to|on|in|into)\b.*\bflagged\b/, steps: [...OPEN_LIST, { target: { widgetType: WL, attr: 'title', value: 'Add to Flagged (Shift+F)' }, name: 'the star', text: 'Click a row’s star to add it to Flagged, or take it off. With a row selected, Shift+F does the same.' }] },
  { id: 'prebuilt', label: 'Opening a prebuilt list', re: /\b(prebuilt|pre-built|community|uct'?s?) (watch ?)?lists?\b/, steps: [...onBoard(WL, 'Watchlist', PICKER), { target: PICKER, name: 'the list picker', text: 'The tabs at the top of the picker hold My Lists, Prebuilt and Community. Open one and click a list.' }] },
  // ⭐ cov-1: one of the member's own lists, opened in the widget ("show my Momentum list")
  { id: 'openList', label: 'Opening one of your lists', re: /\b(open|load|show|pull up|bring up|switch to|go to)\s+(up\s+)?(one of\s+)?(my|my own|another|other|a different|a saved|one of my)\s+(\w+\s+)?(watch ?)?lists?\b/, steps: [...onBoard(WL, 'Watchlist', PICKER), { target: PICKER, name: 'your lists', text: 'Click one of your lists to open it in this widget. The tabs at the top hold My Lists, Prebuilt and Community.' }] },
  { id: 'remove', label: 'Removing a ticker from a list', re: /\b(remove|delete|take off|take out|get rid of)\b.*\b(tickers?|symbols?|stocks?|names?|from)\b|\b(take|pull|drop)\b.+\b(off|out of)\b.*\b(watch ?)?lists?\b/, steps: rowMenu('remove', 'Remove from watchlist', 'Click Remove from watchlist.') },
  { id: 'note', label: 'A note on a ticker', re: /\bnotes?\b/, steps: rowMenu('notes', 'Notes', 'Click Notes: a note box opens under the ticker, and it saves as you type.') },
  { id: 'research', label: 'Research on a ticker', re: /\b(research|ask ai|ai about)\b/, steps: rowMenu('research', 'Full Research', 'Click Full Research, or Ask AI just below it.') },
  { id: 'compare', label: 'Comparing a ticker from the list', re: /\bcompar\w+\b/, steps: rowMenu('compare', 'Compare', 'Click Compare, then pick the other ticker.') },
  { id: 'alert', label: 'A price alert from the list', re: /\balerts?\b/, steps: rowMenu('alert', 'Set price alert', 'Click Set price alert. The box that opens takes the price, and any alerts on this ticker are listed below with a × to delete them.', [{ target: { id: 'watchlist.alertPrice' }, name: 'the price box', text: 'Type the price and click Set. Alerts on this ticker are listed below, each with a × to delete it.' }]) },
  { id: 'sort', label: 'Sorting a list', re: /\bsort\w*\b/, steps: [...OPEN_LIST, { target: HEAD, name: 'the column titles', text: 'Click a column’s title to sort by it. Click it again to flip the order.' }] },
  { id: 'columns', label: 'Choosing a list’s columns', re: /\bcolumns?\b/, steps: [...OPEN_LIST, { target: HEAD, name: 'the column titles', text: 'Right-click any column title.', waitFor: 'watchlist.colMenu' }, { target: 'watchlist.colMenu', name: 'the columns', text: 'Tick the columns you want. Reset columns at the bottom goes back to the default.' }] },
  { id: 'walk', label: 'Walking a list from the keyboard', re: /\b(arrow|arrows|keyboard|space ?bar|next ticker|walk|go through)\b/, steps: onRow('a ticker in the list', 'Click a ticker, then Up and Down step through the list. Space goes to the next one.') },
  { id: 'pick', label: 'Loading a ticker from a list', re: /\b(load|open|click|view|chart)\b.*\b(tickers?|symbols?|stocks?|rows?)\b/, steps: onRow('a ticker in the list', 'Click a ticker: it loads on the charts linked to this list.') },
]

// ── the layout bar (pages/charts/LayoutDock.jsx) ──
const LAYOUT_TAB = { within: 'workspace.layouts', attr: 'data-layout-pin' }
const layoutItem = (id) => ({ within: 'workspace.layoutMenu', attr: 'data-menu-id', value: id })
// `mine`: the row is only on the member's OWN layouts (UCT Default and the prebuilt ones have no Rename or Version history), so
// capabilities/guide.js rings one of theirs on the bar by name, or says they have none (`mine: 'layout'`)
// a row LayoutDock.jsx offers only when it is on: Version history needs the server's version store (probeArtifactVersions)
const ABSENT = { history: 'Version history isn’t in that menu for you right now, so the guide stopped. It shows there once layout history is switched on.' }
const layoutMenu = (id, name, say, more = [], mine = false) => [
  { target: LAYOUT_TAB, name: 'a layout on the bar', text: 'Right-click one of your own layouts on the bar.', waitFor: layoutItem(id), ...(mine ? { mine: 'layout' } : {}), ...(ABSENT[id] ? { absent: ABSENT[id] } : {}) },
  { target: layoutItem(id), name, text: say, endsOnClick: !more.length },
  ...more,
]
export const LAYOUT_ACTIONS = [
  { id: 'rename', label: 'Renaming a layout', re: /\brenam\w*\b/, steps: layoutMenu('rename', 'Rename layout', 'Click Rename layout, type the new name and press Enter.', [], true) },
  { id: 'duplicate', label: 'Duplicating a layout', re: /\b(duplicate|copy)\b/, steps: layoutMenu('duplicate', 'Duplicate layout', 'Click Duplicate layout to make a copy.') },
  { id: 'history', label: 'A layout’s version history', re: /\b(version|history|restore|older|previous version|go back to)\b/, steps: layoutMenu('history', 'Version history', 'Click Version history. Pick a version, and Restore brings it back.', [], true) },
  { id: 'close', label: 'Taking a layout off the bar', re: /\b(close|remove|take)\b.*\b(bar|tab)\b/, steps: layoutMenu('close', 'Close', 'Click Close to take it off the bar. The layout stays in your library.') },
  { id: 'undoSwitch', label: 'Undoing a layout switch', re: /\bundo\b.*\b(switch|layout)\b/, steps: [{ target: LAYOUT_TAB, name: 'a layout on the bar', text: 'Click another layout on the bar. A note appears with Undo for a few seconds.', waitFor: 'workspace.layoutUndo' }, { target: 'workspace.layoutUndo', name: 'Undo', text: 'Click Undo to go back to the board you were on.', endsOnClick: true }] },
  { id: 'active', label: 'Seeing which layout is open', re: /\bwhich\b.*\blayouts?\b|\b(open|current|active) layout\b/, steps: [{ target: { within: 'workspace.layouts', attr: 'aria-current', value: 'true' }, name: 'the open layout', text: 'The highlighted layout on the bar is the one you have open.' }] },
]

// ── tabs: a widget's own (pages/charts/WidgetHeader.jsx) and a chart's (pages/charts/widgets/ChartTabStrip.jsx) ──
const ADD_TAB = 'widget.addTab'
export const TAB_ACTIONS = [
  { id: 'closeChart', label: 'Closing a chart tab', re: /\bclos\w*\b.*\bchart tabs?\b|\bchart tabs?\b.*\bclos\w*\b/, steps: [{ target: ['chart.tabClose', 'chart.addTab'], name: 'the tab’s ×', text: 'Click this ×, then click again to confirm.', altText: 'This chart has no extra tabs to close. This + adds one.' }] },
  { id: 'switchChart', label: 'Switching chart tabs', re: /\bswitch\w*\b.*\bchart tabs?\b|\bchart tabs?\b.*\bswitch\w*\b/, steps: [{ target: ['chart.tabs', 'chart.addTab'], name: 'the chart’s tabs', text: 'Click a tab to switch to it. Double-click one to rename it.', altText: 'This chart has one tab. This + adds another, and the strip of tabs appears above the chart.' }] },
  // ⭐ cov-4 (7): a widget tab's × shows only on the SELECTED extra tab (WidgetHeader.jsx: `!tab.isMain && active`), so the tab
  // is selected first; with it already selected, that step is met at once and the walkthrough goes straight to its ×
  { id: 'close', label: 'Closing a widget tab', re: /\bclos\w*\b.*\btabs?\b/, steps: [
    { target: [{ within: 'workspace.widgetTabs', attr: 'aria-selected', value: 'false' }, 'workspace.widgetTabClose', ADD_TAB], name: 'the tab', text: 'Click the tab you want to close.', altText: 'This widget has no extra tabs. This + adds one.', waitFor: 'workspace.widgetTabClose' },
    { target: ['workspace.widgetTabClose', ADD_TAB], name: 'the tab’s ×', text: 'Click its ×, then click again to confirm.', altText: 'This widget has no extra tabs. This + adds one.' },
  ] },
  { id: 'switch', label: 'Switching widget tabs', re: /\bswitch\w*\b.*\btabs?\b/, steps: [{ target: ['workspace.widgetTabs', ADD_TAB], name: 'the tabs', text: 'Click a tab to switch to it. Double-click one to rename it.', altText: 'This widget has one tab. This + adds another.' }] },
]

// ── widgets: each row is one control of one widget ──
const W = {
  alerts: 'Alerts', news: 'News & Catalysts', tradeExchangeNews: 'News', calendar: 'UCT Terminal', breadth: 'Breadth', optionsflow: 'Options Flow', themes: 'Theme Tracker', fundamentals: 'Fundamentals', profile: 'Stock Profile',
  nhnl: 'New Highs / Lows', scatter: 'Market Map', aisearch: 'AI Search', notebook: 'Notebook', volumescan: 'Volume Surge', scanner: 'Scanner',
}
const widget = (id, type, label, re, target, name, say, alt) => ({ id, label, re, steps: point(type, W[type], typeof target === 'string' ? inCell(type, target) : target, name, say, alt) })
export const WIDGET_ACTIONS = [
  widget('alertsList', 'alerts', 'Seeing your alerts', /\b(see|view|show|list|where are|find)\b.*\bmy alerts\b|\bmy alerts\b/, 'alerts.row', 'your alerts', 'These are your alerts. Click one to show its ticker on the linked chart.', 'You have no alerts yet. The form at the top of this widget sets one.'),
  widget('scanPick', 'scanner', 'Picking a preset scan', /\b(pick|choose|open|run|use)\b.*\b(preset |prebuilt )?scans?\b|\bpreset scans?\b/, 'scanner.list', 'the scans', 'Click a scan to run it. Its results open in this widget.', 'This widget has a scan open. ‹ takes you back to the list of scans.'),
  // ⭐ cov-1: a scan's columns, sort and conditions sit ahead of "its results", whose words they share ("sort the scan results")
  { id: 'scanColumns', label: 'Choosing a scan’s columns', re: /\bscan\w*\b.*\bcolumns?\b|\bcolumns?\b.*\bscan\w*\b/, steps: [...onBoard('scanner', W.scanner, cellOf('scanner')), { target: [SCAN_HEAD, cellOf('scanner')], name: 'the column titles', text: 'Right-click any column title.', altText: 'Pick a scan first: its columns show on its results.', waitFor: 'watchlist.colMenu' }, { target: 'watchlist.colMenu', name: 'the columns', text: 'Tick the columns you want. Reset columns at the bottom goes back to the default.' }] },
  widget('scanCriteria', 'scanner', 'Reading a scan’s conditions', /\bscan\w*\b.*\b(conditions?|criteria|filters?|rules?|screen\w* for|look\w* for|filter\w* (on|for))\b/, 'watchlist.scanCriteria', 'Scan criteria', 'This button lists what the scan filters on.', 'Pick a scan first: the conditions button shows on its results.'),
  widget('scanSort', 'scanner', 'Sorting a scan', /\bscans?\b.*\b(sort|order|rank)\w*\b|\b(sort|order|rank)\w*\b.*\bscans?\b/, SCAN_HEAD, 'the column titles', 'Click a column’s title to sort. Right-click one to choose the columns.', 'Pick a scan first: its columns show on its results.'),
  // ⛔ behind Wave R's capture switch (guide/releases.js): off, nothing is rung and the guide says it isn't available yet
  released('capture', widget('scanJournal', 'scanner', 'Sending a scan to the Journal', /\bscans?\b.*\bjournal\b|\bjournal\b.*\bscans?\b/, { widgetType: 'scanner', aria: 'Send this scan to Journal' }, 'Send to Journal', 'This sends the scan’s results to your Journal.', 'Pick a scan first: this button shows once it has results.')),
  widget('scanRead', 'scanner', 'Reading a scan’s results', /\b(read|see|view)\b.*\bscan\b.*\bresults?\b|\bscan results?\b/, cellOf('scanner'), 'the Scanner widget', 'Pick a scan, and its results list here. Click a ticker to load it on the linked chart.'),
  widget('alertsDelete', 'alerts', 'Deleting an alert', /\b(delete|remove|cancel)\b.*\balerts?\b/, 'alerts.delete', 'the alert’s ×', 'Click this × to delete that alert.', 'You have no alerts to delete yet.'),
  widget('newsFilter', 'news', 'Filtering catalysts', /\bcatalysts?\b|\bnews\b.*\b(up|down) (moves?|days?)\b/, 'news.filters', 'the filters', 'These pills filter the catalysts: all, up or down.'),
  widget('newsRead', 'news', 'Reading a symbol’s headlines', /\b(headlines?|stored news|news for)\b/, cellOf('news'), 'the News widget', 'This widget lists the stored headlines for the linked chart’s symbol, newest first.'),
  widget('teSearch', 'tradeExchangeNews', 'Searching headlines', /\b(trade exchange|te news)\b.*\bsearch\b|\bsearch\b.*\b(trade exchange|te news)\b/, { widgetType: 'tradeExchangeNews', aria: 'Search headlines' }, 'the search box', 'Type here to search the headlines.'),
  widget('teFilter', 'tradeExchangeNews', 'Filtering the news feed', /\b(trade exchange|te news)\b.*\b(filter|categor\w+|watch ?list)\b|\b(filter|categor\w+)\b.*\b(trade exchange|te news)\b/, { widgetType: 'tradeExchangeNews', aria: 'Filter by watchlist' }, 'the filters', 'This limits the feed to a watchlist. The funnel beside it filters by category or the linked symbol.'),
  widget('teExplain', 'tradeExchangeNews', 'Explaining a headline', /\b(explain|ask about)\b.*\bheadlines?\b/, 'teNews.explain', 'Explain', 'Click this on a headline to have it explained.', 'This shows on each headline once the feed has loaded.'),
  widget('calRow', 'calendar', 'Loading a stock from the earnings list', /\b(click|open|load|chart)\b.*\bearnings\b.*\b(row|stock|ticker)s?\b|\bearnings (row|list)\b/, 'calendar.row', 'an earnings row', 'Click a row to load that stock on the linked chart.', 'No one reports on this day. Step to another day with the arrows.'),
  widget('calDays', 'calendar', 'Stepping through days', /\bcalendar\b.*\b(next|previous|another|step|other) days?\b|\b(next|previous|another) day\b.*\bcalendar\b/, 'calendar.days', 'the day arrows', 'These arrows step one trading day at a time.'),
  widget('calStars', 'calendar', 'Filtering economic events', /\b(economic|econ)\b.*\b(events?|filter|stars?|impact)\b/, 'calendar.stars', 'the stars', 'These stars set the impact shown: one is everything, three is high impact only.', 'There are no economic events on this day. Step to another day with the arrows.'),
  widget('calWho', 'calendar', 'Who reports on a day', /\bwho reports\b|\b(earnings|reports?)\b.*\b(today|tomorrow|on a day|this day)\b/, cellOf('calendar'), 'the Calendar widget', 'This widget lists who reports on the day shown, before the open and after the close. Click a row to load its chart.'),
  widget('breadthRead', 'breadth', 'Reading the breadth tiles', /\b(read|understand)\b.*\bbreadth\b|\bbreadth\b.*\b(tiles?|drill)\b|\btiles?\b.*\bbreadth\b/, cellOf('breadth'), 'the Breadth widget', 'Each tile is one breadth reading, coloured by how strong it is. Click one to open it on Breadth. The widget’s gear adds or removes readings.'),
  widget('flowScope', 'optionsflow', 'Market or symbol flow', /\b(flow|options)\b.*\b(market|symbol|scope)\b/, 'flow.scope', 'Market', 'Market shows the whole tape. The button beside it follows the linked chart’s symbol.'),
  widget('flowLead', 'optionsflow', 'The flow’s lead view', /\b(flow|options)\b.*\b(view|lead|sentiment|tape)\b/, 'flow.lead', 'the views', 'These buttons switch what the widget leads with.'),
  widget('flowFilters', 'optionsflow', 'Flow filters', /\b(flow|options)\b.*\b(filters?|premium|calls?|puts?|sweeps?|blocks?)\b/, 'flow.filters', 'the funnel', 'This funnel opens the filters: minimum premium, calls or puts, sweep or block, and bull or bear.'),
  widget('flowRead', 'optionsflow', 'Reading the flow', /\b(read|understand)\b.*\b(flow|options)\b/, cellOf('optionsflow'), 'the Options Flow widget', 'Each row is one print. Click a row to load its ticker on the linked chart.'),
  widget('themePeriod', 'themes', 'Ranking themes by period', /\bthemes?\b.*\b(period|rank\w*|sort|today|week|month|worst|best)\b|\b(sort|rank|order)\w*\b.*\bthemes?\b/, 'themes.periods', 'the periods', 'These tabs rank the themes by period. Click the active one again to flip the order.'),
  widget('themeBasis', 'themes', 'The today basis', /\bthemes?\b.*\bbasis\b|\bfrom (the )?open\b|\bfrom (the )?close\b/, 'themes.basis', 'Close or Open', 'Close measures today from the previous close. Open measures it from the market open.', 'This shows on the 1D tab. Pick 1D first.'),
  widget('themeOpen', 'themes', 'Opening a theme', /\b(open|expand)\b.*\bthemes?\b|\bthemes?\b.*\bholdings?\b/, 'themes.group', 'a theme', 'Click a theme to open its holdings, then click a holding to load it on the linked chart.', 'No themes are showing yet.'),
  widget('themeSearch', 'themes', 'Searching themes', /\bsearch\b.*\bthemes?\b|\bthemes?\b.*\bsearch\b/, { widgetType: 'themes', aria: 'Search themes or tickers' }, 'the search box', 'Type a theme or a ticker to find it.'),
  widget('themeSets', 'themes', 'Theme presets', /\bthemes?\b.*\b(sets?|presets?)\b|\b(sets?|presets?)\b.*\bthemes?\b/, 'themes.sets', 'the preset menu', 'This menu picks a preset. Its pencil renames one and its bin deletes it.'),
  widget('breadthAdd', 'breadth', 'Adding or removing a reading', /\b(add|remove|hide|change)\b.*\bbreadth\b.*\b(reading|tile|metric)s?\b|\b(reading|tile|metric)s?\b.*\bbreadth\b/, 'widget.settings', 'its gear', 'This gear opens the readings: tick the ones you want.'),
  widget('mapUniverse', 'scatter', 'The Market Map’s universes', /\b(market map|scatter)\b.*\buniverses?\b/, 'scatter.universes', 'the universes', 'Click a tab to switch universe, its × to remove it, and + to add one.'),
  widget('fundView', 'fundamentals', 'Switching the fundamentals view', /\bfundamentals?\b.*\b(quarterly|annual|view|switch)\b|\b(quarterly|annual)\b.*\bfundamentals?\b/, 'fundamentals.view', 'the view buttons', 'These buttons switch between quarterly and annual numbers.', 'These show once the widget has numbers for this symbol.'),
  widget('fundRead', 'fundamentals', 'Reading the fundamentals', /\b(read|understand)\b.*\bfundamentals?\b/, cellOf('fundamentals'), 'the Fundamentals widget', 'This widget shows the linked chart’s earnings and sales by period.'),
  widget('profileRead', 'profile', 'Reading a company profile', /\b(read|see|view)\b.*\bprofile\b|\bcompany profile\b/, cellOf('profile'), 'the Profile widget', 'This widget shows the linked chart’s company, and its earnings table.'),
  widget('nhnlUniverse', 'nhnl', 'New highs and lows universes', /\b(new highs?|nh ?nl|new lows?)\b.*\b(universes?|switch|add|remove)\b|\b(add|remove|switch)\b.*\b(new highs?|nh ?nl|new lows?)\b/, 'nhnl.universes', 'the universes', 'Click a tab to switch universe, its × to remove it, and + to add one.'),
  widget('mapAxes', 'scatter', 'The Market Map’s axes', /\b(market map|scatter)\b.*\b(axis|axes|size|x|y)\b/, 'scatter.axisX', 'the axis title', 'Click an axis title to choose what it measures. The Size button beside it sets the bubble size.', 'These show once the map has a universe.'),
  widget('aiAsk', 'aisearch', 'Asking AI Search', /\bai search\b.*\b(ask|question|follow)\b|\b(ask|question)\b.*\bai search\b/, 'aisearch.ask', 'the question box', 'Type your question here and press Enter. Ask a follow-up in the same box.'),
  widget('noteNew', 'notebook', 'Creating a note here', /\bnotebook\b.*\b(new|create|add)\b|\b(new|create|add)\b.*\bnote\b.*\bnotebook\b/, 'notebook.new', 'New', 'Click New to start a note here.'),
  widget('noteSearch', 'notebook', 'Finding a note', /\b(search|find|open)\b.*\bnotes?\b/, { widgetType: 'notebook', aria: 'Search notes' }, 'the search box', 'Search here, or click a note in the list.'),
  widget('volumeScope', 'volumescan', 'What the scanner watches', /\bvolume (surge|scan\w*)\b.*\b(watch\w*|scope|list|choose)\b/, 'volumeScan.scope', 'the scope', 'Click this to choose what the scanner watches.'),
]

// ── a drawing's own menu (components/chart/ChartDrawingOverlay.jsx DrawingContextMenu, from drawingSettingsSchema.js) ──
const drawRow = (label) => ({ within: 'chart.drawingMenu', label })
const onDrawing = (labels, name, say) => {
  const t = [].concat(labels).map(drawRow)
  return [
    { target: 'chart.plot', name: 'the chart', text: 'Right-click a drawing on the chart. If this chart has none yet, draw one first.', waitFor: t },
    { target: t, name, text: say },
  ]
}
export const DRAWING_ACTIONS = [
  { id: 'erase', label: 'The eraser', re: /\beraser\b|\berase\b.*\bdrawing\b/, steps: key('Alt+Shift+E', 'Then click any drawing to delete it.') },
  { id: 'undo', label: 'Undoing a drawing', re: /\b(undo|redo)\b/, steps: [{ target: 'chart.drawUndo', name: 'Undo', text: 'This arrow undoes your last drawing change, and the one beside it redoes it. Ctrl+Z and Ctrl+Y do the same.', off: 'There’s nothing to undo yet.' }] },
  { id: 'delete', label: 'Deleting a drawing', re: /\b(delete|remove|get rid of)\b/, steps: onDrawing('Delete Drawing', 'Delete Drawing', 'Click Delete Drawing. With a drawing selected, the Del key or the bin on the toolbar does the same.') },
  { id: 'color', label: 'Recolouring a drawing', re: /\b(re)?colou?r\w*\b|\b(make|turn|set)\b.*\b(red|green|blue|purple|violet|orange|yellow|gold|white|black|gr[ae]y|pink|teal|cyan|aqua|magenta|brown|lime|navy)\b/, steps: onDrawing('Color', 'Color', 'Click the swatch here and pick a colour.') },
  { id: 'style', label: 'A drawing’s width and line style', re: /\b(width|thick\w*|thin\w*|style|dash\w*|dott?ed)\b/, steps: onDrawing('Color', 'the style rows', 'Colour, width and line style are in this menu.') },
  // a fib has no Set alert of its own (drawingSettingsSchema.js: only lines and levels carry it): its level's alert is a price alert
  { id: 'alert', label: 'An alert on a line', re: /^(?!.*\bfib\w*\b).*\balert\w*\b/, steps: onDrawing('Set alert…', 'Set alert', 'Click Set alert…, then choose whether it follows the line or stays at a fixed level.') },
  { id: 'fib', label: 'Fibonacci levels and fills', re: /^(?!.*\balert\w*\b).*(\b(fib\w*)\b.*\b(levels?|fills?)\b|\b(levels?|fills?)\b.*\bfib\w*\b)/, steps: onDrawing('Levels…', 'Levels', 'Click Levels… to turn each level and its fill on or off. This shows on a Fibonacci drawing.') },
  { id: 'lock', label: 'Locking a drawing', re: /\b(un)?lock\w*\b/, steps: onDrawing(['Lock', 'Unlock'], 'Lock', 'Click Lock to stop it moving. Click Unlock to free it.') },
  { id: 'hideOne', label: 'Hiding one drawing', re: /\b(hide|show)\b.*\b(one|this|that|single|a) (drawing|line)\b|\b(hide|show)\b.*\b(just|only|this|that|one|single)\b.*\b(drawing|line|fib\w*|trend ?lines?|rectangle|box|channel|arrow|circle)\b/, steps: onDrawing(['Hide', 'Show'], 'Hide', 'Click Hide to hide this drawing only.') },
  { id: 'move', label: 'Moving a drawing', re: /\b(move|drag|adjust|edit)\b/, steps: [{ target: 'chart.plot', name: 'the chart', text: 'Click a drawing to select it, then drag it to move it, or drag one of its round handles to reshape it.' }] },
]

// ── Chart settings → Indicators (components/chart/ChartSettingsIndicators.jsx, IndicatorTemplatesBar.jsx) ──
const IND_TAB = { target: 'chartSettings.tab.indicators', name: 'the Indicators tab', text: 'Open the Indicators tab.', waitFor: { id: 'chartSettings.tab.indicators', on: true } }
const IND_ROW = { within: 'chartSettings', attr: 'data-row-primary' }
const indRow = (result) => [
  { only: 'ind', target: [{ ...IND_ROW, named: '{ind.label}' }, { ...IND_ROW, named: '{ind.labelName}' }, IND_ROW], name: 'the indicator list', text: 'Click {ind.label} in this list.', altText: '{ind.label} isn’t on this chart. Click another indicator here, or add it first.', waitFor: result },
  { unless: 'ind', target: IND_ROW, name: 'the indicator list', text: 'Click the indicator in this list.', waitFor: result },
]
const inSettings = (guide) => ({ within: 'chartSettings', guide })
const ADD = { target: { within: 'chartSettings', guide: 'indicators.add' }, name: 'Add to Chart', text: 'Click ＋ Add to Chart.', waitFor: { within: 'chartSettings', aria: 'Search indicators' } }
const addTab = (text) => ({ within: 'indicators.addSurface', attr: 'role', value: 'tab', text })
export const INDICATOR_ACTIONS = [
  { id: 'addAnother', label: 'Adding a second copy', re: /\b(another|second|extra)\b.*\b(copy|one|indicator)\b|\b(add|put|get|want|need)\b.*\b(another|second|extra)\b(?!\s+(?:charts?|cells?|panes?|tabs?|widgets?|layouts?|lists?|watch ?lists?|symbols?|tickers?)\b)/, steps: [GEAR, IND_TAB, ADD, { target: { within: 'indicators.addSurface', guide: 'indicators.addAnother' }, name: 'the ＋', text: 'An indicator already on the chart shows Active. This ＋ adds another copy with the default settings.' }] },
  { id: 'yours', label: 'Adding your own indicator', re: /\b(add|put)\b.*\b(my|own|saved)\b.*\bindicators?\b/, steps: [GEAR, IND_TAB, ADD, { target: [addTab('Your indicators'), { within: 'chartSettings', aria: 'Search indicators' }], name: 'Your indicators', text: 'Open Your indicators and click one to add it to this chart.', altText: 'You have no saved indicators yet. Search here, or use Create Indicator above.' }] },
  { id: 'symbolSeries', label: 'Adding a symbol as a series', re: /\b(symbol|ticker)\b.*\b(series|data)\b/, steps: [GEAR, IND_TAB, ADD, { target: addTab('Symbols'), name: 'Symbols', text: 'Open Symbols and search: a symbol you pick is added as its own series.' }] },
  { id: 'company', label: 'Adding Company Info', re: /\b(add|get|put)\b.*\bcompany (info|panel)\b/, steps: [GEAR, IND_TAB, ADD, { target: addTab('Research'), name: 'Research', text: 'Open Research, then click Company Info.' }] },
  { id: 'list', label: 'Seeing what’s on a chart', re: /\b(see|list|what)\b.*\bindicators?\b.*\b(on|chart)\b/, steps: [GEAR, IND_TAB, { target: IND_ROW, name: 'the indicator list', text: 'This list is everything on this chart. Click one to change it.' }] },
  { id: 'arrange', label: 'Reordering panes', re: /\b(reorder|order|arrange|rearrange)\b.*\bpanes?\b|\bmove\b.*\bpanes?\b.*\b(up|down)\b|\bpanes?\b.*\border\b/, steps: [GEAR, IND_TAB, { target: inSettings('indicators.arrange'), name: 'Arrange', text: 'Click this to arrange the chart.', waitFor: inSettings('indicators.movePane') }, { target: inSettings('indicators.movePane'), name: 'the pane’s arrows', text: 'These arrows move a pane up or down the chart.' }] },
  { id: 'history', label: 'Undoing an indicator change', re: /\b(undo|redo)\b/, steps: [GEAR, IND_TAB, { target: inSettings('indicators.history'), name: 'Undo and Redo', text: 'These arrows undo and redo your indicator changes.' }] },
  { id: 'removeHere', label: 'Removing an indicator in settings', re: /\b(remove|delete)\b.*\b(settings?|indicators tab)\b/, steps: [GEAR, IND_TAB, ...indRow(inSettings('indicators.remove')), { target: inSettings('indicators.remove'), name: 'Remove', text: 'Click Remove to take it off the chart.' }] },
  { id: 'plotStyle', label: 'An indicator’s plot style', re: /\bplot style\b/, steps: [GEAR, IND_TAB, ...indRow({ within: 'chartSettings', attr: 'data-field' }), { target: { within: 'chartSettings', attr: 'data-field', text: 'style' }, name: 'the plot style', text: 'Choose how each line is drawn here.' }] },
  { id: 'create', label: 'Creating an indicator', re: /\b(create|build|make|describe|write)\b.*\b(an |my |own |custom |new )*indicators?\b|\bindicator builder\b/, steps: [GEAR, IND_TAB, { target: inSettings('indicators.create'), name: 'Create Indicator', text: 'Click Create Indicator, and describe what you want. UCT Intelligence previews it on this chart, and you save it when it’s right.' }] },
]

// ── the Indicator alerts popover, past what the alertIndicator walkthrough teaches (components/chart/IndicatorAlertPopover.jsx) ──
const BELL = { target: 'chart.alerts', name: 'the bell', text: 'Click the bell to open Indicator alerts.', waitFor: 'chart.alertsPopover', off: 'The bell is greyed out until this chart has a symbol.' }
const inAlerts = (aria) => ({ within: 'chart.alertsPopover', aria })
const POPOVER = { id: 'chart.alertsPopover' }
const form = (aria, name, say, alt) => [BELL, { target: alt ? [inAlerts(aria), POPOVER] : inAlerts(aria), name, text: say, altText: alt }]
const NO_ALERTS = 'This chart’s symbol has no indicator alerts yet. Once you add one, it’s listed below the form.'
export const ALERT_ACTIONS = [
  { id: 'pause', label: 'Pausing an indicator alert', re: /\b(pause|resume|disable|enable|turn (on|off))\b.*\balerts?\b/, steps: [BELL, { target: ['alert.toggle', POPOVER], name: 'ON or OFF', text: 'This switch pauses the alert or turns it back on.', altText: NO_ALERTS }] },
  { id: 'delete', label: 'Deleting an indicator alert', re: /\b(delete|remove|cancel)\b.*\bindicator alerts?\b|\b(delete|remove|cancel)\b.*\b(rsi|macd|moving average|ema|sma|vwap|atr|bollinger|stochastic)\b.*\balerts?\b/, steps: [BELL, { target: [inAlerts('Delete alert'), POPOVER], name: 'the alert’s ×', text: 'Click this × to delete the alert.', altText: NO_ALERTS }] },
  { id: 'list', label: 'Seeing your indicator alerts', re: /\b(list|see|view|show|find)\b.*\bindicator alerts?\b/, steps: [BELL, { target: POPOVER, name: 'Indicator alerts', text: 'Your indicator alerts for this symbol are listed below the form.' }] },
  { id: 'cannotFire', label: 'Why an alert can’t fire', re: /\balerts?\b.*\b(can.?t|cannot|won.?t|not) fire\b|\bwhy\b.*\balerts?\b/, steps: [BELL, { target: ['alert.cannotFire', POPOVER], name: 'the reason', text: 'This line says why the alert can’t fire.', altText: 'None of your alerts for this symbol are blocked. A blocked one says why under its name here.' }] },
  { id: 'cross', label: 'An alert on a moving average cross', re: /\bcross\w*\b.*\balerts?\b|\balerts?\b.*\bcross\w*\b/, steps: form('Condition', 'the Condition list', 'Choose the moving average in Indicator, then a crossing here: over a value, or over another line.') },
  { id: 'timeframe', label: 'An alert on another timeframe', re: /\balerts?\b.*\b(another|other|different|higher|lower) time ?frame\b/, steps: form('Timeframe', 'the Timeframe list', 'Choose the timeframe the alert watches. It doesn’t have to match the chart.') },
  { id: 'plot', label: 'Which line an alert watches', re: /\balerts?\b.*\b(plot|signal line|histogram|which line)\b|\b(plot|which line|signal line|histogram)\b.*\balerts?\b/, steps: form('Plot', 'the Plot list', 'Choose which line of the indicator to watch.', 'Choose an indicator with several lines first, such as MACD: the Plot list appears here.') },
  { id: 'instance', label: 'Which copy an alert watches', re: /\balerts?\b.*\b(instance|which copy|second copy)\b/, steps: form('Instance', 'the Instance list', 'Choose which copy of the indicator to watch.', 'This shows when the chart has two copies of the indicator.') },
  { id: 'policy', label: 'When a signal alert fires', re: /\balerts?\b.*\b(yes.no|trigger policy|signal)\b|\b(yes.no|trigger policy)\b.*\balerts?\b/, steps: form('Trigger policy', 'Alert when', 'Choose when it fires: when it becomes true, becomes false, or while it is true.', 'This shows when the indicator gives a yes or no signal.') },
]

// ── the company panel on a chart (pages/charts/widgets/ChartDetailDock.jsx), there once Company Info is added ──
const DOCK_OFF = 'This chart has no company panel. Add Company Info from Chart settings → Indicators → Add to Chart.'
export const DOCK_ACTIONS = [
  { id: 'earnings', label: 'When a stock reports', re: /\bwhen\b.*\b(report|reports|earnings)\b/, steps: [{ target: ['chart.dockTab', 'chart.dockRail', 'chart.plot'], name: 'the company panel', text: 'Earnings in this panel shows when it next reports.', altText: DOCK_OFF }] },
  { id: 'tabs', label: 'The company panel’s tabs', re: /\b(company|dock)\b.*\btabs?\b|\btabs?\b.*\b(company|dock)\b/, steps: [{ target: ['chart.dockTab', 'chart.dockRail', 'chart.plot'], name: 'the tabs', text: 'These tabs switch what the panel shows: overview, financials, earnings, ownership and news.', altText: DOCK_OFF }] },
  { id: 'collapse', label: 'Opening or collapsing the company panel', re: /\b(open|collapse|hide|close|fold)\b.*\bcompany (panel|info|dock)\b/, steps: [{ target: ['chart.dockCollapse', 'chart.dockRail', 'chart.plot'], name: 'the panel’s arrow', text: 'This arrow folds the panel to the chart’s edge. The button left on the edge opens it again.', altText: DOCK_OFF }] },
  { id: 'holdings', label: 'An ETF’s holdings', re: /\b(etf|index)\b.*\bholdings\b|\bholdings\b.*\b(etf|index)\b|\bview holdings\b/, steps: [{ target: ['chart.viewHoldings', 'chart.plot'], name: 'View Holdings', text: 'Click View Holdings to list what this ETF holds.', altText: 'View Holdings shows on a chart of an ETF or an index. Load one first.' }] },
]

// ── Multi Chart (pages/charts/grid/MultiChartMenu.jsx, GridChartCell.jsx) ──
const LAYOUTS = { target: 'workspace.layoutsMenuBtn', name: 'the Layouts menu', text: 'Open Layouts ▾.', waitFor: 'workspace.layoutsMenu' }
const GRID_OPEN = [LAYOUTS, { target: 'workspace.multiChart', name: 'Multi Chart', text: 'Click Multi Chart.', waitFor: 'multiChart.flyout' }]
const inFlyout = (t) => ({ within: 'multiChart.flyout', ...t })
const flyout = (t, name, say, alt, fallback) => [...GRID_OPEN, { target: alt ? [inFlyout(t), inFlyout(fallback)] : inFlyout(t), name, text: say, altText: alt }]
const GROUPS_ROW = { label: 'Groups Mode (type a ticker to fill its group)' }
const NO_GROUP_YET = 'Turn on Groups Mode and pick a group first. This control appears then.'
const cellRow = (target, name, say, alt, fallback) => [{ target: alt ? [target, fallback] : target, name, text: say, altText: alt }]
export const GRID_ACTIONS = [
  { id: 'groupExit', label: 'Leaving Groups mode', re: /\b(exit|leave|turn off|stop|get out of|out of)\b.*\bgroups?\b/, steps: flyout({ label: 'Exit Groups' }, 'Exit Groups', 'Click Exit Groups to go back to choosing each chart yourself.', NO_GROUP_YET, GROUPS_ROW) },
  { id: 'groupStep', label: 'Stepping through groups', re: /\b(next|previous|prev|step|switch)\b.*\bgroups?\b|\bgroups?\b.*\b(next|previous|prev|step|switch)\b/, steps: flyout({ aria: 'Next group' }, 'Next', 'Next and Prev step to the neighbouring group.', NO_GROUP_YET, GROUPS_ROW) },
  { id: 'exit', label: 'Leaving Multi Chart', re: /\b(exit|leave|quit|out of|get out)\b|\bclose (?:the |this |my )?(?:grid|multi[- ]?chart)\b|\bback to (?:my |the )?(?:board|workspace|normal|regular|single)\b/, steps: [{ target: 'workspace.exitGrid', name: 'the Workspace button', text: 'Click Workspace to go back to your board. Your grid is kept.' }] },
  { id: 'syncCross', label: 'Syncing the crosshair', re: /\bcrosshairs?\b/, steps: flyout({ label: 'Sync crosshair across charts' }, 'Sync crosshair', 'Tick this to move one crosshair across every chart.') },
  { id: 'syncTime', label: 'Syncing the time range', re: /\b(time ?range|sync)\b/, steps: flyout({ label: 'Sync time range across charts' }, 'Sync time range', 'Tick this so every chart shows the same dates.') },
  { id: 'groupRefresh', label: 'Refreshing a group', re: /\brefresh\b.*\bgroups?\b|\bgroups?\b.*\brefresh\b/, steps: flyout({ label: '↻ Refresh group' }, 'Refresh group', 'Click this to refill the grid with the group’s names now.', NO_GROUP_YET, GROUPS_ROW) },
  { id: 'groupPick', label: 'Picking a group', re: /\b(pick|choose|fill|select|find)\b.*\bgroups?\b/, steps: flyout({ aria: 'Search groups' }, 'the group search', 'Search for a group and click it to fill the grid with its names.') },
  { id: 'groupMode', label: 'Groups mode', re: /\bgroups?( mode)?\b/, steps: flyout(GROUPS_ROW, 'Groups Mode', 'Tick this, then type a ticker on any chart: the grid fills with its group.') },
  { id: 'cellSettings', label: 'The grid’s shared settings', re: /\bsettings?\b/, steps: cellRow('chart.cellSettings', 'the gear', 'This gear opens the settings all the charts share.') },
  { id: 'gridDelete', label: 'Deleting a saved grid', re: /\b(delete|remove)\b.*\b(saved )?grids?\b/, steps: flyout({ attr: 'title', value: 'Delete' }, 'the grid’s ✕', 'Click this ✕ to delete that saved grid.', 'You have no saved grids yet. Save one here first.', { aria: 'Grid name' }) },
  { id: 'gridGlobal', label: 'Saving a prebuilt grid', re: /\bprebuilt\b.*\bgrids?\b|\bgrids?\b.*\b(prebuilt|all users|everyone|global)\b/, steps: flyout({ label: 'Prebuilt (available to all users)' }, 'Prebuilt', 'Tick this before saving to offer the grid to every member. Admins only.', 'Only admins can offer a grid to everyone, so that box isn’t here for you. Type a name here to save a grid for yourself.', { aria: 'Grid name' }) },
  { id: 'gridSave', label: 'Saving a grid', re: /\bsav(e|ing)\b.*\bgrids?\b/, steps: flyout({ aria: 'Grid name' }, 'Grid name', 'Type a name here, then click Save grid.') },
  { id: 'gridApply', label: 'Opening a saved grid', re: /\b(apply|open|load|use)\b.*\b(saved |my |prebuilt )?grids?\b/, steps: flyout({ label: 'My grids' }, 'My grids', 'Your saved grids are listed here: click one to open it.', 'You have no saved grids yet. Save one here first.', { aria: 'Grid name' }) },
  { id: 'cellStyle', label: 'One chart’s style in the grid', re: /\b(style|candles?|bars|line (?:chart|style)|area|hollow)\b/, steps: cellRow('chart.cellStyle', 'Style', 'This sets the style of this chart only. The option called Style follows your main chart.') },
  { id: 'cellSession', label: 'One chart’s session in the grid', re: /\b(session|regular|extended|pre[- ]?market|post[- ]?market)\b/, steps: cellRow('chart.session', 'the session buttons', 'These switch this chart between regular and extended hours.', 'This chart is too narrow to show them. Maximize it, or close me for a moment.', 'chart.cellMaximize') },
  { id: 'cellReset', label: 'Resetting a chart in the grid', re: /\breset\b/, steps: cellRow('chart.cellReset', 'Reset to my chart', 'Click this to drop this chart’s own settings and match your main chart.', 'This chart has no settings of its own, so there’s nothing to reset. The button shows once you change it.', 'chart.cellStyle') },
  { id: 'cellMax', label: 'Maximizing a chart in the grid', re: /\b(maximi[sz]e|restore|full ?size|expand|bigger)\b/, steps: cellRow('chart.cellMaximize', 'Maximize', 'This fills the grid with this chart. Click it again to restore the grid.') },
  { id: 'cellAlert', label: 'An alert from a grid chart', re: /\balerts?\b/, steps: [{ target: 'chart.plot', name: 'the chart', text: 'Right-click on this chart, at the price you want.', waitFor: { within: 'chart.contextMenu', attr: 'data-menu-id', value: 'set-alert' } }, { target: { within: 'chart.contextMenu', attr: 'data-menu-id', value: 'set-alert' }, name: 'Set alert', text: 'Click Set alert: it sets a price alert at the price you clicked.', endsOnClick: true }] },
  { id: 'cellTimeframe', label: 'One chart’s timeframe in the grid', re: /\b(time ?frames?|interval)\b/, steps: cellRow('chart.timeframe', 'the timeframes', 'These set the timeframe of this chart only.') },
]

// ── the Formula Builder (components/chart/builder/BuilderSheet.jsx), through the indicator library ──
const LIBRARY = { target: 'chart.plot', name: 'the chart', text: 'Click the chart, then press Alt+Shift+A to open the indicator library.', waitFor: 'indicators.newFormula' }
const BUILDER_OPEN = [LIBRARY, { target: 'indicators.newFormula', name: 'New formula', text: 'Click New formula.', waitFor: 'builder.modes' }]
const modeTab = (text, more = {}) => ({ within: 'builder.modes', attr: 'role', value: 'tab', text, ...more })
const inMode = (text, target, name, say) => [...BUILDER_OPEN, { target: modeTab(text), name: text, text: `Click ${text}.`, waitFor: modeTab(text, { on: true }) }, { target, name, text: say }]
export const BUILDER_ACTIONS = [
  { id: 'pine', label: 'Importing a script', re: /\b(pine|thinkscript|import\w*|paste)\b/, steps: inMode('Import', { within: 'builder.modes', attr: 'role', value: 'tab', text: 'Import', on: true }, 'Import', 'Paste your Pine or thinkScript in the box below. It’s translated into a formula you can save.') },
  { id: 'marker', label: 'Signal markers and colours', re: /\b(markers?|signal|colou?r (the )?(candles?|background))\b|\b(paint|shade|tint)\b.*\b(candles?|bars?|background)\b|\b(dots?|arrows?|shapes?|triangles?)\b.*\bwhen\b/, steps: [...BUILDER_OPEN, { target: ['builder.signalLook', 'builder.placement'], name: 'the signal options', text: 'Marker draws a shape where the signal is true. The options beside it colour the candles or the background.', altText: 'These show once the formula gives a yes or no, such as close > open. Type one, then set it as a Signal.' }] },
  { id: 'conditions', label: 'Building by conditions', re: /\bconditions?\b/, steps: inMode('Conditions', modeTab('Conditions', { on: true }), 'Conditions', 'Pick conditions below. Each one you add builds the formula.') },
  { id: 'placement', label: 'A formula’s placement and levels', re: /\b(placement|levels?)\b/, steps: [...BUILDER_OPEN, { target: 'builder.placement', name: 'Placement', text: 'Placement chooses where it draws. The Levels box beside it adds guide lines.' }] },
  { id: 'alert', label: 'Asking for an alert from the builder', re: /\balerts?\b/, steps: [...BUILDER_OPEN, { target: 'builder.conversation', name: 'the conversation box', text: 'Describe the alert here, for example “alert me when it crosses 70”. It’s armed when you save.' }] },
  { id: 'undoDraft', label: 'Undoing a draft step', re: /\bundo\b/, steps: [...BUILDER_OPEN, { target: 'builder.undo', name: 'Undo last change', text: 'This takes back the last change the conversation made.', off: 'There’s nothing to undo yet.' }] },
  { id: 'edit', label: 'Editing a saved formula', re: /\b(open|edit|change|delete|remove)\b.*\b(saved|my|own)\b/, steps: [...BUILDER_OPEN, { target: ['builder.edit', 'builder.placement'], name: 'your saved formulas', text: 'Your saved formulas are listed here. The pencil opens one, and the bin beside it deletes it.', altText: 'You have no saved formulas yet. Save one and it’s listed at the foot of this window.' }] },
  { id: 'name', label: 'Naming a formula', re: /\b(name|rename|call)\b|\bgive\b.*\ba name\b/, steps: [...BUILDER_OPEN, { target: 'builder.name', name: 'the name box', text: 'Type the name here. Save needs one.' }] },
  { id: 'saveDraft', label: 'Saving a formula', re: /\bsav(e|ing)\b/, steps: [...BUILDER_OPEN, { target: 'builder.save', name: 'Save', text: 'Click Save once it has a name and a valid formula. Any warning is shown for you to acknowledge first.', off: 'Save stays greyed out until the formula is valid and has a name.' }] },
  { id: 'discard', label: 'Discarding a draft', re: /\b(discard|cancel|throw\b.*\baway|abandon|scrap|bin)\b/, steps: [...BUILDER_OPEN, { target: 'builder.cancel', name: 'Cancel', text: 'Click Cancel to close without saving.' }] },
  { id: 'enter', label: 'Entering a formula', re: /\b(enter|type|write|edit)\b.*\bformula\b/, steps: [...BUILDER_OPEN, { target: 'builder.formula', name: 'the formula box', text: 'Type the formula here. UCT reads it back underneath as you go.' }] },
  { id: 'formula', label: 'Writing a formula', re: /\b(formula|builder)\b/, steps: [...BUILDER_OPEN, { target: 'builder.conversation', name: 'the builder', text: 'Describe it here, or use the tabs below: Library, Conditions, Import, Screenshot and Formula.' }] },
]

const COMPARE_WORDS = /\bcompar\w+\b|\boverlays?\b|\b(main|same|own|new|separate) scale\b|\bits own scale\b/
const needsAny = (re) => (q) => re.test(q)
const LIST_WORDS = /\b(watch ?lists?|lists?|rows?|flagged)\b/
const LAYOUT_WORDS = /\blayouts?\b/
const TAB_WORDS = /\btabs?\b/
const INDICATOR_WORDS = /\b(indicators?|legend|chips?|study|studies|rsi|macd|moving average|bollinger|vwap|atr|company info|company panel|series)\b/

/** One feature per family: `read` picks the row, `when` (optional) is what else the words must say; registry.js adds what
 *  needs the live catalog: `also` (words that count too) and `guard` (words that rule it out). */
export const ACTION_FAMILIES = [
  { id: 'builderAction', slot: 'builderAct', rows: BUILDER_ACTIONS, when: needsAny(/\b(formulas?|builder|pine|thinkscript|script|drafts?)\b|\bwhen\b.*\b(is |are |it's |its )?true\b/), control: 'the chart', title: '{builderAct.label}', topic: 'indicators', caps: [], explain: 'The Formula Builder opens from the indicator library: Alt+Shift+A on the chart, then New formula.' },
  { id: 'gridAction', slot: 'gridAct', rows: GRID_ACTIONS, when: needsAny(/\b(grids?|multi[- ]?charts?|cells?)\b|\bsync\w*\b.*\b(crosshairs?|time ?ranges?|charts)\b|\b(crosshairs?|time ?ranges?)\b.*\b(across|all|every)\b.*\bcharts\b|\b(all|every)\b.*\bcharts\b.*\bsame time ?range\b|\b(next|previous|prev|exit|leave|refresh)\b.*\bgroups?\b|\bgroups? mode\b|\bout of groups\b/), except: /\bgrid ?lines?\b/, control: 'the Layouts menu', title: '{gridAct.label}', topic: 'layouts', caps: [], explain: 'Multi Chart’s options are under Layouts ▾ → Multi Chart, and each chart in the grid has its own style, timeframe and maximize button.' },
  { id: 'drawingEdit', slot: 'drawAct', rows: DRAWING_ACTIONS, when: needsAny(/\bdrawings?\b|\blines?\b|\bfib\w*\b|\beraser\b|\btrend ?lines?\b|\b(rectangles?|boxes|pitch ?forks?|channels?|arrows?|circles?|anchors?)\b/), except: /\b(crosshair|grid|watermark|prev|indicators?|moving average)\b/, control: 'the drawing toolbar', title: '{drawAct.label}', topic: 'drawings', caps: [], explain: 'Click a drawing to select it. A small bar appears on it, with style, duplicate, lock and delete.' },
  { id: 'indicatorManage', slot: 'indAct', slots: ['ind', 'indAct'], rows: INDICATOR_ACTIONS, when: needsAny(INDICATOR_WORDS), control: 'the chart’s settings gear', title: '{indAct.label}', topic: 'indicators', caps: [], explain: 'Chart settings → Indicators lists what is on the chart, with its settings, templates, pane order and Create Indicator.' },
  { id: 'layoutAction', slot: 'layoutAct', rows: LAYOUT_ACTIONS, when: needsAny(LAYOUT_WORDS), control: 'your layouts bar', title: '{layoutAct.label}', topic: 'layouts', caps: [], explain: 'Right-click a layout on the bar for its menu: rename, duplicate, version history and close.' },
  { id: 'tabAction', slot: 'tabAct', rows: TAB_ACTIONS, when: needsAny(TAB_WORDS), control: 'the tabs', title: '{tabAct.label}', topic: 'widgets', caps: [], explain: 'A tab sits in the strip above its chart or widget: click to switch, double-click to rename, and its × closes it.' },
  { id: 'watchlistAction', slot: 'listAct', rows: WATCHLIST_ACTIONS, when: needsAny(LIST_WORDS), except: /\bearnings\b/, control: 'the Widgets menu', title: '{listAct.label}', topic: 'watchlists', caps: [], explain: 'A Watchlist widget holds the list. Click a ticker to load it, click a column title to sort, and right-click a ticker for its menu.' },
  { id: 'alertAction', slot: 'alertAct', rows: ALERT_ACTIONS, control: 'the bell on the chart’s toolbar', title: '{alertAct.label}', topic: 'alerts', caps: [], explain: 'The bell on the chart’s toolbar opens Indicator alerts: the form, and the alerts already set for this symbol.' },
  { id: 'widgetAction', slot: 'widgetAct', rows: WIDGET_ACTIONS, control: 'the Widgets menu', title: '{widgetAct.label}', topic: 'widgets', caps: [], explain: 'That control is inside its widget. Add the widget from Widgets ▾ if it isn’t on your board.' },
  { id: 'dockAction', slot: 'dockAct', rows: DOCK_ACTIONS, control: 'the chart', title: '{dockAct.label}', topic: 'charts', caps: [], explain: 'A chart’s company panel comes from Chart settings → Indicators → Add to Chart → Company Info.' },
  { id: 'panelAction', slot: 'panelAct', rows: PANEL_ACTIONS, control: 'that control', title: '{panelAct.label}', topic: 'charts', caps: [], explain: 'That control is on a panel of the chart or the workspace.' },
  { id: 'compareAction', slot: 'compareAct', rows: COMPARE_ACTIONS, when: needsAny(COMPARE_WORDS), control: 'the Tools menu', title: '{compareAct.label}', topic: 'charts', caps: ['chart.compare'], explain: 'Tools ▾ → Compare Symbols overlays other symbols on a chart. Each symbol and group in its list has a scale choice and a remove button.' },
  { id: 'chartMenu', slot: 'menuAct', rows: CHART_MENU, control: 'the chart', title: '{menuAct.label}', topic: 'charts', caps: [], explain: 'Right-click the chart for its menu. What it offers depends on where you click: the price area, the price scale, the volume bars or an indicator’s pane.' },
  { id: 'chartView', slot: 'viewAct', slots: ['ind', 'viewAct'], rows: CHART_VIEW, control: 'the chart', title: '{viewAct.label}', topic: 'charts', caps: [], explain: 'That is on the chart itself, or a key that works once the chart is selected.' },
  { id: 'legendChip', slot: 'chipAct', slots: ['ind', 'chipAct'], rows: LEGEND_MENU, when: needsAny(INDICATOR_WORDS), control: 'the chart’s legend', title: '{chipAct.label}', topic: 'indicators', caps: [], explain: 'Every indicator in the chart’s legend, at the top left, has a menu: click its name to hide it, move it, edit it, set an alert or delete it.' },
]

/** The family's features, in the shape of registry.js GUIDE_FEATURES. */
export const actionFeatures = (extra = {}) => ACTION_FAMILIES.map(fam => {
  const read = firstRow(fam.rows)
  const { slot, slots, rows: _rows, when, ...f } = fam
  const { also, guard } = extra[fam.id] || {}
  return {
    ...f, slots: slots || [slot], terms: [], words: [],
    match: (q) => !!read(q) && (!when || when(q) || !!also?.(q)) && (!guard || guard(q)),
    steps: [{ each: slot }],
  }
})

/** The slots the families add (guide/slots.js SLOTS). The first row stands in when the words named none of them. */
export const ACTION_SLOTS = Object.fromEntries(ACTION_FAMILIES.map(fam => [fam.slot, { read: firstRow(fam.rows), rows: fam.rows, fallback: fam.rows[0] }]))
