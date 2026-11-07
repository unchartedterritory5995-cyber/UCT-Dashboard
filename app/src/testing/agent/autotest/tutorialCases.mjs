// UCT Agent AUTOTEST: the TUTORIAL batch (2026-11-07), written BEFORE any run of it. Guided walkthroughs in the real Charts UI:
//   targeting   the ring encloses the real control on the NAMED chart, not the clicked one
//   lifecycle   ring and card go on completion, Exit, Escape, a click elsewhere, closing the Agent, a reload, a new request
//   stale       no ring left on a chart that was removed
//   advance     a step moves on only for its own control
//   readonly    the guide never executes a change itself
// Each case: { id, family, board, clicks: [role], say, feature, acts: [...], expect: [...], lifecycle }. `feature` is the
// scripted plan's guide.show feature for when the words reach the planner (BROWSER-MOCK-MODEL); the instant path needs none.
// Acts (tutorialRun.mjs): click role | canvasOf role | symbolOf role | gearOf role | next | exit | esc | escBoard | closeChart role
//   | closeAgent | reload | say text [plan] | wait ms
const T = 'chart.timeframe', SYM = 'chart.symbol', GEAR = 'chart.settings', DATE = 'chart.goToDate', TAB = 'chart.addTab', LINK = 'widget.link'

const L = []
const add = (family, id, spec) => L.push({ id: `tut-${family}-${id}`, family: `tut-${family}`, clicks: [], acts: [], ...spec })

// ── targeting: the named chart, whatever was clicked ─────────────────────────────────────────────────────────────────
add('target', 'tf-named-tr', { board: 'FOUR', clicks: ['BL'], say: 'how do I change the timeframe on the top right chart', feature: 'timeframe', expect: [['starts', 'timeframe'], ['ringOn', 'TR', T]] })
add('target', 'symbol-named-br', { board: 'FOUR', clicks: ['TL'], say: 'show me where to change the symbol on the bottom right chart', feature: 'symbol', expect: [['starts', 'symbol'], ['ringOn', 'BR', SYM]] })
add('target', 'gear-named-tl', { board: 'FOUR', clicks: ['BR'], say: 'where are the chart settings for the top left chart', feature: 'settings', expect: [['starts', 'settings'], ['ringOn', 'TL', GEAR]] })
add('target', 'date-by-symbol', { board: 'FOUR', clicks: ['TR'], say: 'how do I go to a date on the NVDA chart', feature: 'goToDate', expect: [['starts', 'goToDate'], ['ringOn', 'BL', DATE]] })
add('target', 'tf-middle-of-three', { board: 'THREE', clicks: ['L'], say: 'how do I change the timeframe on the middle chart', feature: 'timeframe', expect: [['starts', 'timeframe'], ['ringOn', 'M', T]] })
add('target', 'tab-left-of-three', { board: 'THREE', clicks: ['R'], say: 'how do I add a chart tab to the left chart', feature: 'chartTab', expect: [['starts', 'chartTab'], ['ringOn', 'L', TAB]] })
add('target', 'tf-mc-cell', { board: 'MC', clicks: ['A'], say: 'how do I change the timeframe in the bottom left cell', feature: 'timeframe', expect: [['starts', 'timeframe'], ['ringOn', 'C', T]] })
add('target', 'link-named-right', { board: 'TWO', clicks: ['A'], say: 'how do I change the link colour of the right chart', feature: 'link', expect: [['starts', 'link'], ['ringOn', 'B', LINK]] })
add('target', 'tf-deictic-clicked', { board: 'FOUR', clicks: ['BL'], say: 'how do I change the timeframe on this chart', feature: 'timeframe', expect: [['starts', 'timeframe'], ['ringOn', 'BL', T]] })
add('target', 'tf-named-no-click', { board: 'TWO', say: 'how do I change the timeframe on the left chart', feature: 'timeframe', expect: [['starts', 'timeframe'], ['ringOn', 'A', T]] })
add('target', 'gear-chart-number', { board: 'THREE', clicks: ['L'], say: 'where is the settings gear on chart 3', feature: 'settings', expect: [['starts', 'settings'], ['ringOn', 'R', GEAR]] })

// ── lifecycle: the ring and the card go ─────────────────────────────────────────────────────────────────────────────
const tf = { board: 'FOUR', clicks: ['TR'], say: 'how do I change the timeframe here', feature: 'timeframe' }
add('life', 'exit-button', { ...tf, acts: [['exit']], lifecycle: 'Exit', expect: [['starts', 'timeframe'], ['endsGone', 'exit'], ['unchanged']] })
add('life', 'esc-in-composer', { ...tf, acts: [['esc']], lifecycle: 'Escape with focus in the Agent box', expect: [['starts', 'timeframe'], ['endsGone', 'exit']] })
add('life', 'esc-on-board', { ...tf, acts: [['escBoard']], lifecycle: 'Escape with focus on the board', expect: [['starts', 'timeframe'], ['endsGone', 'exit']] })
add('life', 'click-another-chart', { ...tf, acts: [['canvasOf', 'BL']], lifecycle: 'a click on another chart', expect: [['starts', 'timeframe'], ['endsGone', '.']] })
add('life', 'click-watchlist', { ...tf, acts: [['clickWidget', 'w-watch']], lifecycle: 'a click on another widget', expect: [['starts', 'timeframe'], ['endsGone', '.']] })
add('life', 'completed-by-next', { ...tf, acts: [['next'], ['next']], lifecycle: 'its last step', expect: [['starts', 'timeframe'], ['endsGone', 'done'], ['unchanged']] })
add('life', 'close-agent', { ...tf, acts: [['closeAgent']], lifecycle: 'closing the Agent', expect: [['starts', 'timeframe'], ['endsGone', 'closed']] })
add('life', 'reload', { ...tf, acts: [['reload']], lifecycle: 'a reload', expect: [['starts', 'timeframe'], ['noRing'], ['nothingOnScreen']] })
add('life', 'new-howto', { ...tf, acts: [['say', 'how do I change the symbol on this chart', 'symbol']], lifecycle: 'a new how-to', expect: [['starts', 'timeframe'], ['endFeature', 'symbol']] })
add('life', 'new-command', { ...tf, acts: [['say', 'make this chart weekly', { ops: [{ action: 'chart.setTimeframe', target: '$chart:sel', args: { timeframe: 'W' } }] }]], lifecycle: 'a new command', expect: [['starts', 'timeframe'], ['endsGone', '.']] })

// ── stale: the chart under the ring goes away ───────────────────────────────────────────────────────────────────────
add('stale', 'close-named-chart', { board: 'FOUR', clicks: ['TL'], say: 'how do I change the timeframe on the bottom right chart', feature: 'timeframe', acts: [['closeChart', 'BR'], ['wait', 2600]], expect: [['starts', 'timeframe'], ['noRing']] })
add('stale', 'close-clicked-chart', { board: 'THREE', clicks: ['M'], say: 'how do I change the timeframe on this chart', feature: 'timeframe', acts: [['closeChart', 'M'], ['wait', 2600]], expect: [['starts', 'timeframe'], ['noRing']] })
add('stale', 'close-other-chart', { board: 'FOUR', clicks: ['TL'], say: 'how do I change the timeframe on this one', feature: 'timeframe', acts: [['closeChart', 'BR'], ['wait', 1200]], expect: [['starts', 'timeframe'], ['ringOnAtEnd', 'TL', T]] })

// ── advance: only the step's own control moves it on ────────────────────────────────────────────────────────────────
const gear = { board: 'FOUR', clicks: ['TR'], say: 'show me the chart settings on this chart', feature: 'settings' }
add('advance', 'next-button', { ...tf, acts: [['next']], expect: [['starts', 'timeframe'], ['advancedTo', 1]] })
add('advance', 'wrong-chart-click', { ...tf, acts: [['canvasOf', 'BR'], ['wait', 600]], lifecycle: 'a click on another chart', expect: [['starts', 'timeframe'], ['stillOnOrGone', 0]] })
add('advance', 'own-symbol-click', { ...tf, acts: [['symbolOf', 'TR'], ['wait', 600]], lifecycle: 'a click on the wrong control', expect: [['starts', 'timeframe'], ['stillOn', 0]] })
add('advance', 'right-gear', { ...gear, acts: [['gearOf', 'TR'], ['wait', 900]], lifecycle: 'its own control', expect: [['starts', 'settings'], ['advancedTo', 1]] })
add('advance', 'gear-of-another-chart', { ...gear, acts: [['gearOf', 'BL'], ['wait', 900]], lifecycle: 'the same control on another chart', expect: [['starts', 'settings'], ['stillOn', 0]] })

// ── readonly: the guide never executes ──────────────────────────────────────────────────────────────────────────────
add('readonly', 'teach-weekly', { board: 'TWO', clicks: ['A'], say: 'teach me how to switch this chart to weekly', feature: 'timeframe', expect: [['starts', 'timeframe'], ['unchanged'], ['noReceipt']] })
add('readonly', 'show-add-rsi', { board: 'TWO', clicks: ['A'], say: 'show me how to add an rsi to this chart', feature: 'indicators', expect: [['starts', null], ['unchanged'], ['noReceipt']] })
add('readonly', 'show-hline', { board: 'TWO', clicks: ['B'], say: 'how do I draw a horizontal line on this chart', feature: 'drawing', expect: [['starts', null], ['unchanged'], ['noReceipt']] })
add('readonly', 'show-price-alert', { board: 'TWO', clicks: ['A'], say: 'how do I set a price alert', feature: 'alertPrice', expect: [['starts', null], ['unchanged'], ['noReceipt']] })
add('readonly', 'walk-to-end', { board: 'TWO', clicks: ['B'], say: 'how do I change the timeframe on this chart', feature: 'timeframe', acts: [['next'], ['next']], expect: [['starts', 'timeframe'], ['unchanged'], ['noReceipt']] })

export const tutorialCases = () => L.map(c => ({ ...c, set: 'tutorial' }))
