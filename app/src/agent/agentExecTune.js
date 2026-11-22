// EXECUTION FAMILIES — the TUNE phrasings (pl-exec, exec-gen-1): the ones routing words, descriptions and table rows MAY be
// changed against. The held-out set (agentExecHeldOut.test.js) was written first and is never tuned on; no phrasing is in both.
export const WIDGET_TUNE = [
  { row: 'C3-169', type: 'themes', text: 'show the theme tracker for the past month', key: 'period', value: '1m' },
  { row: 'C3-169', type: 'themes', text: 'rank the themes year to date', key: 'period', value: 'ytd' },
  { row: 'C3-170', type: 'themes', text: 'sort the themes ascending', key: 'sortDir', value: 'asc' },
  { row: 'C3-171', type: 'themes', text: 'theme performance from the open instead of the close', key: 'todayBasis', value: 'open' },
  { row: 'C3-174', type: 'themes', text: 'switch the theme tracker to my custom set', key: 'themeSet', value: 'Mine' },
  { row: 'C3-166', type: 'optionsflow', text: 'options flow minimum premium 1 million', key: 'minPremium', value: 1000000 },
  { row: 'C3-166', type: 'optionsflow', text: 'show only bearish flow', key: 'direction', value: 'BEAR' },
  { row: 'C3-183', type: 'indexes', text: 'remove the dow from the indexes', key: 'index', value: '-DIA' },
  { row: 'C3-187', type: 'nhnl', text: 'add the nyse universe to new highs new lows', key: 'universes', value: '+NYSE' },
  { row: 'C3-158', type: 'breadth', text: 'hide the 50 day reading on the breadth widget', key: 'reading', value: '-A50' },
  { row: 'C3-159', type: 'breadth', text: 'breadth heatmap view', key: 'view', value: 'heatmap' },
  { row: 'C3-192', type: 'scatter', text: 'market map universe nasdaq 100', key: 'universe', value: 'Nasdaq 100' },
  { row: 'C3-193', type: 'scatter', text: 'size the market map dots by market cap', key: 'sizeKey', value: 'market_cap' },
  { row: 'C3-195', type: 'scatter', text: 'label every dot on the market map', key: 'labelMode', value: 'all' },
  { row: 'C3-148', type: 'calendar', text: 'show tomorrow on the terminal', key: 'day', value: 'tomorrow' },
  { row: 'C3-151', type: 'calendar', text: 'terminal economic events two stars and up', key: 'econStars', value: 2 },
  { row: 'C3-152', type: 'calendar', text: 'collapse the tbd section on the terminal', key: 'tbdOpen', value: false },
  { row: 'C3-133', type: 'news', text: 'news filter down movers only', key: 'filter', value: 'down' },
  { row: 'C3-139', type: 'tradeExchangeNews', text: 'filter the headlines to earnings', key: 'category', value: '+Earnings' },
  { row: 'C3-139', type: 'tradeExchangeNews', text: 'link the trade exchange news to my chart', key: 'linked', value: true },
  { row: 'C3-164', type: 'optionsflow', text: 'options flow for the whole market', key: 'scope', value: 'market' },
  { row: 'C3-165', type: 'optionsflow', text: 'options flow sentiment view', key: 'lead', value: 'sentiment' },
  { row: 'C3-125', type: 'volumescan', text: 'hide the logos on volume surge', key: 'showLogos', value: false },
  { row: 'C3-206', type: 'periodsort', text: 'period sort grouped by sector', key: 'group', value: 'sector' },
]

export const LIST_TUNE = [
  { row: 'C1-066', text: 'add sector to the info row', setting: 'header.fields', value: '+sector' },
  { row: 'C1-066', text: 'show RVOL in the chart header', setting: 'header.fields', value: '+rvol' },
  { row: 'C1-066', text: 'remove next earnings from the info row', setting: 'header.fields', value: '-earn' },
  { row: 'C1-065', text: 'hide the close in the bar info', setting: 'header.barInfo', value: '-close' },
  { row: 'C1-065', text: 'show net change in the bar info strip', setting: 'header.barInfo', value: '+change' },
]

// ── round 2 tune phrasings ──
export const WIDGET_TUNE2 = [
  { row: 'C3-188', type: 'nhnl', text: 'new highs new lows: show the nasdaq tab', key: 'universe', value: 'nasdaq' },
  { row: 'C3-121', type: 'volumescan', text: 'make the volume surge watch my Core list', key: 'list', value: 'Core' },
  { row: 'C3-158', type: 'breadth', text: 'take the up 4% reading off the breadth widget', key: 'reading', value: '-up_4pct_today' },
  { row: 'C3-192', type: 'scatter', text: 'remove the S&P 500 universe from the market map', key: 'universes', value: '-S&P 500' },
  { row: 'C3-193', type: 'scatter', text: 'market map x axis relative volume', key: 'xKey', value: 'rvol' },
]
export const JOURNAL_TUNE = [
  { row: 'C3-184', type: 'indexes', text: 'send the indexes to my journal', where: 'note' },
  { row: 'C3-156', type: 'calendar', text: 'send the terminal to a new journal note', where: 'newNote' },
  { row: 'C3-163', type: 'breadth', text: 'send the breadth widget to my journal inbox', where: 'inbox' },
  { row: 'C3-177', type: 'themes', text: 'send the theme tracker to my journal', where: 'note' },
]
