// ── CAPABILITY ROUTING: send the model only the action groups a request needs ───────────
//
// The flat manifest grows with every capability (51 after Batch 4 against the server's 60),
// and every action costs prompt tokens on every turn. Routing picks, DETERMINISTICALLY (no
// model call), the action groups a message plausibly needs, and tells the model which other
// groups exist. If the model needs one it was not given, it says so (`need_groups`) and the
// browser asks ONCE more with those groups added. Nothing runs between the two calls.
//
// KNOWING ≠ DOING, still: routing only changes what the model SEES. Every op the model returns
// is re-validated against the FULL registry in the browser (executor.planOps / shapeError),
// and the server validates against the manifest it was sent — a capability the member may
// not use is never selectable, because it is never in manifestFor(ctx) to begin with.
//
// SAFE BY DEFAULT:
//   • nothing recognised → the full manifest (exactly the pre-routing behaviour);
//   • the groups of a pending proposal and of the last change ride along (follow-ups);
//   • the agent group (capability questions) always rides along;
//   • a reroute is bounded to ONE extra call, and only when the first call planned nothing.
// Kill switch: localStorage `uct.agent.routing = '0'` sends the full manifest every turn.

import { namedWidgetTypes, controlledWidgetTypes, itemNamedTypes, ITEM_LISTS } from './widgetNames'
export const ROUTING_VERSION = 1

// hotfix 2026-11-03: "on four charts", "4 charts", "two more charts", "all the same size", "equal size", "evenly", "split"
const MULTI_CHARTS = /\b(two|three|four|five|six|seven|eight|nine|ten|twelve|[2-9]|1[0-2]) (new |separate |more |different |individual |equal |identical )?(\w+ )?charts\b/
// W2 audit (live 2026-11-04, CG-6/7/7b): ONE stock's price history — its pullbacks, drawdowns, distance off its (52-week) high,
// its range, its last N days — is the data group's (stock.dailyBars), however the stock is named. A question over a
// UNIVERSE of stocks ("stocks pulling back to the 20") stays the screener's, and a CONCEPT question ("what is a pullback?")
// the model's own answer: neither is matched here.
const STOCK_HISTORY = /\b(?:pull(?:ed|ing|s)?[\s-]?backs?|pulled back|pulling back|draw[\s-]?downs?|off (?:its|the|their) (?:\S+ )?highs?|(?:how far|distance) (?:off|from|below) (?:its|the|their) (?:\S+ )?highs?|(?:trading|price|daily|weekly|recent|52[\s-]?week) range|(?:last|past) \d+ (?:trading )?(?:days|sessions|weeks|months)|price history|(?:trading|stock) history)\b/
const CONCEPT_Q = /\bwhat(?:'s| is| are) (?:a|an) |\b(?:explain|define|definition|meaning of|in plain (?:words|english))\b/
const UNIVERSE_WORDS = /\bpull(?:ed|ing|s)?[-\s]?backs? (?:to|into|toward|near)\b|\bin (?:up|down)trends\b|\b(?:stocks|names|tickers|equities|screens?|scans?|screener|universe|watchlist|list)\b/
const DATA_HISTORY = new RegExp(`^(?!.*(?:${UNIVERSE_WORDS.source}))(?!.*(?:${CONCEPT_Q.source})).*${STOCK_HISTORY.source}`)
// W2 (CG-1): "four equal panels" — a count of chart cells said as panels / cells / boxes / windows / quadrants
const GRID_CELLS = /\b(two|three|four|five|six|seven|eight|nine|[2-9]) (?:\w+ )?(?:panels|cells|boxes|windows|quadrants)\b|\bequal (?:panels|cells|boxes|windows|quadrants)\b/
const EQUAL_SIZE = /\b(same|equal|even|identical) (size|sizes|sized|width|height)\b|\bequal(ly)?[\s-]?sized?\b|\bevenly\b|\bequally\b|\bsplit\b|\btile\b|\btiled\b/

/** Action groups, keyed by capability DOMAIN (the name prefix). Titles are shown to the model. */
export const GROUPS = [
  { id: 'charts', title: 'Chart symbol, timeframe, type, scale, session, theme, colours, display settings, volume', domains: ['chart', 'volume'],
    // Gate B vocabulary (soft): an overlay or a symbol swap said without "compare" / "chart"
    vocab: [/\b(next to (this|it)|on top of (this|it)|swap \$?[a-z]{1,5} (for|with)|instead of \$?[a-z]{1,5})\b/],
    words: [/\bcharts?\b/, /\b(timeframe|daily|weekly|monthly|hourly|intraday|\d+ ?(min|minute|hour|hr)s?|1h|4h)\b/, /\b(candles?|candlesticks?|hollow|bars|hlc|line chart|area chart|heikin)\b/,
      /\b(log|logarithmic|percent|linear) scale\b|\bscale\b/, /\b(extended|pre-?market|post-?market|regular hours|rth)\b/, /\b(colou?rs?|background|grid|crosshair|legend|watermark|labels?|markers?|countdown|thin bars|invert|template|tabs?|compar(?:e|es|ing|isons?)|versus|against|overlays?|go to|scroll|as it looked|custom (time ?frame|interval))\b/,
      /\bvolume\b/,
      // execution family L (pl-exec): the strips Chart Settings → Header names, whose fields chart.setSetting picks
      /\b(?:info row|bar info|header)\b/,
      // CG-25 (corpus #774): "theme" is the CHART's look — never the app's ("light / dark / app / UCT theme")
      // ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js): the 0–5 characters before the space are consumed and
      // checked by lookahead instead — the same answer as `\b` + not-after-"light |dark |app |uct |site " + `themes?\b`
      // (agentNoLookbehindEquivalence.test.js runs the old pattern against this one)
      /(?:^|[^ ])\bthemes?\b|(?:^[^]{0,2}|^(?!app|uct)[^]{3}|^(?!dark|site|[^](?:app|uct))[^]{4}|(?!light|[^](?:dark|site)|[^]{2}(?:app|uct))[^]{5}) themes?\b/,
      // "defaults" — a chart's own defaults ("restore the chart defaults"), never a default for NEW charts (settings)
      /^(?!.*\b(?:new charts?|by default|always open)\b).*\bdefaults?\b/,
      // CG-20 (corpus #774): "swing" (swing labels) — not a layout's / list's NAME ("open my Swing layout")
      /^(?!.*\b(?:layouts?|watch ?lists?|lists?|screens?|templates?)\b).*\bswing\b/,
      // P1: a symbol / setting put on a chart NAMED by position or order ("TSLA on the left", "on the second one")
      /\bon the (left|right|top|bottom|first|second|third|fourth|last|middle)\b/] },
  // Charts operator P1 (2026-10-27): the rest of a chart's own controls, in their OWN group so the NL-1 core
  // (charts + indicators + screener + agent ≤ 45) keeps its size — templates (save / delete), one chart's
  // look copied onto another, custom-timeframe removal and ★ favourites, comparison display.
  { id: 'chartSetup', title: 'Chart setup: save or delete chart templates, list / apply / save / delete indicator templates, make one chart look like another, remove a custom timeframe, star a timeframe, comparison scale / Group only, Replay Mode (hide bars after a date / exit replay), a chart’s date range (3M–5Y, YTD, Origin), Reset view, hide every indicator or moving average at once', domains: ['chartSetup'], fillLast: true,
    // W1-B B-06: Replay Mode is a chart control too — here by action name, so the NL-1 core (charts group) keeps its size
    // W2-B3: chart.describeSetup here by action name too (a grounded setup description; the charts group keeps its size),
    // named by "describe / summarise / walk me through … setup"
    // Phase 1: indicator templates here by action name — the group's own `templates?` word already names them, and a
    // member's saved template NAME brings the group (NAME_GROUPS), so no new phrase rule
    actions: ['chart.replay', 'chart.describeSetup', 'indicatorTemplate.list', 'indicatorTemplate.apply', 'indicatorTemplate.save', 'indicatorTemplate.delete'],
    // CG-33 (corpus #774, live LT-7): Replay Mode had no words of its own — "replay", "bar replay", "as of <date>", "hide
    // what came after", "step through", "exit / stop replay" (routing only ADDS this group) — the first words below
    // W2 (CG-5): "what's the setup here" names chart.describeSetup too (not only describe / summarise / walk me through)
    words: [/\b(?:bar )?replay(?:ing|ed)?\b/, /^(?=.*\b(?:replay|charts?|bars?|candles?)\b).*\bas of (?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]* \d{1,2}|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}|last \w+)\b/,
      /\bhide (?:what|everything|all|the bars?|the candles?)(?: that)? (?:came |comes )?after\b/, /\bstep (?:through|forward|back)\b/,
      // delta nit: "look like" is the copy-look request ("make the left chart look like the right one") — not "what does the
      // market look like as of …"
      /\btemplates?\b/, /\b(?:make|making|made)\b.*\blooks? (just )?like\b|\blooks? (just )?like (?:the|that|my|this) (?:\w+ )?(?:chart|one)\b/,/\b(describe|summari[sz]e|walk me through)\b.*\bset-?ups?\b/, /\bwhat(?:'s|’s|s| is) (?:the |this |my )?(?:chart'?s? )?set-?up\b/,/\bsame (look|style|colou?rs|settings|setup) as\b/, /\bcopy (the |its |this |that )?(look|style|colou?rs|settings|setup)\b/,
      /\b(custom|favou?rite|starred?|star) (time ?frames?|intervals?)\b|\b(remove|delete|drop|un-?star|star)\b.*\b(time ?frames?|intervals?)\b/,
      /\b(same|new|own) (%|percent|price) scale\b|\bgroup only\b|\bhide (the )?base\b/,
      // chart range bar, Reset view, hide-all: chartSetup's own capabilities, by the words a member uses for the buttons
      // temporary reachability; replace with description-driven discovery
      /\b(?:range|show|frame|zoom)\b.*\b(?:3m|6m|ytd|1y|5y|year to date|(?:one|1|last|past|five|5) years?|(?:three|3|six|6) months)\b|\bsince (?:the )?ipo\b/,
      /\breset (?:the |this |my |chart |chart's )*(?:view|zoom)\b|\bdefault view\b/,
      /\b(?:hide|show|bring back|turn (?:off|on)|unhide)\b.*\b(?:all|every)\b.*\b(?:indicators?|moving averages?|mas|overlays)\b/,
      // C1-127: OPENING a chart's own Chart Settings dialog (chartSetup.openSettings) — an open verb and the chart's settings
      /\b(?:open|show|bring up|pull up|pop up|pop open|launch|display)\b.*\b(?:chart'?s? settings|settings (?:dialog|panel|window|modal)|settings (?:for|of|on) (?:the |this |that |my )?(?:\w+ )?(?:\w+ )?chart)\b/] },
  // C1-035 / C1-037 / C1-040: chartSetup.compareGroup in its OWN one-action group, WORDS-ONLY (as #1027's watchlistShow), so the chartSetup group keeps
  // master's size: a 19th chartSetup action made it outsize the lists group, and the per-request budget then cut chartSetup
  // for a template message ("add the Swing Setup indicator template to this chart", corpus indicatorTemplate.apply).
  { id: 'compareGroups', title: 'Compare a whole theme / sector / industry group on a chart (add it, remove it, its scale)', domains: [], fillLast: true, wordsOnly: true,
    actions: ['chartSetup.compareGroup'],
    words: [
      // C1-035 / C1-037 / C1-040: a whole group compared, removed or re-scaled ("compare against the semis group", "remove the semis overlay").
      // The verb (compare… / overlay / remove / drop / take off / clear) must govern the group noun within six words: a bare
      // "vs … themes" or a plural "overlays … group" (indicator talk) never reaches this group.
      /\b(?:compar\w*|overlay|remove|drop|take off|clear)\s+(?:[\w’'-]+\s+){0,6}?(?:groups?|sectors?|industr(?:y|ies)|themes?)\b|\b(?:groups?|sectors?|industr(?:y|ies)|themes?|semis)\b.*\b(?:overlays?|scale|comparisons?)\b/] },
  // Family C (right-click and header parity, 2026-11-11): a chart's right-click Ask AI and the watermark's Reset position, in
  // their OWN words-only group (as compareGroups): never a filler, so no existing group and no unrecognised request changes.
  // "ask" / "watermark" are used elsewhere, so each needs its context: Ask AI with about / on / for or a chart word; the
  // watermark with a reset / back / default word (either order). No lookbehind (src/noRegexLookbehind.test.js).
  { id: 'chartMenu', title: 'A chart’s right-click extras: open Ask AI about the chart’s stock; reset a dragged watermark to its default position', domains: ['chartMenu'], fillLast: true, wordsOnly: true,
    words: [
      /\b(?:ask|open|pull up|bring up|launch|use)\s+(?:the\s+)?ai\s+(?:about|on|for|regarding)\b|\bask\s+(?:the\s+)?ai\b.*\b(?:chart|stock|symbol|ticker|this one|name)\b/,
      /\bwatermark\b.*\b(?:reset|back|default|original|re-?cent(?:er|re)|where it was)\b|\b(?:reset|re-?cent(?:er|re)|restore|undrag)\b.*\bwatermark\b/] },
  // ⭐ live test 2026-10-28: N tickers as N equal charts (reuse, add, re-tile — one change, one Undo) — its OWN group
  // (one action), so neither the NL-1 core nor the workspace group grows: core + workspace is exactly the budget.
  { id: 'chartGrid', title: 'Several charts for named tickers at once: reuse the charts there, add the rest, re-tile them into equal cells', domains: ['chartGrid'], fillLast: true,
    words: [/\b(two|three|four|five|six|seven|eight|nine|[2-9]) (new |separate |more )?(\w+ )?charts? (for|of|with|showing|on)\b/, /\bcharts? (for|of|with|showing)\b/, /\b(as|into) (\w+ )?(\w+ )?charts\b/,
      /\b(grid|2 ?x ?2|2 by 2|side[\s-]by[\s-]side|next to each other|stacked|split (the )?screen)\b/,
      // hotfix 2026-11-03 (live: "Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size." routed [charts, agent]
      // only — the model had no grid and no add, and put four tickers on TABS of one chart): a count of charts said
      // anywhere, and equal sizing, name this group too (routing only ADDS)
      MULTI_CHARTS, EQUAL_SIZE, GRID_CELLS] },
  // ⭐ PHASE 3: two widgets trading places, a chart duplicated into half its cell — their OWN small group (as chartGrid), so
  // neither the NL-1 core nor the workspace group grows past the per-request budget
  { id: 'boardEdit', title: 'Swap two widgets’ places; duplicate a chart (split its cell, the copy beside it); change ONE control of a widget (a view, a filter, a period, the day shown, the open theme, a universe, an axis) or read how it is set; send a widget to the Journal; step a chart back or forward by bars, or put its price scale back on auto-scale', domains: ['board'], fillLast: true,
    // W1-B B-05: widget.setOption here by action name — the workspace group was exactly at the NL-1 reroute budget
    // pl-exec4 (C1-025/C1-032): a chart's ◀ / ▶ step and Auto-scale here by action name too — chartSetup at 18 would pack
    // after the lists group and be cut beside indicators + workspace; a new group would change every unmatched routing
    actions: ['widget.setOption', 'widget.readOptions', 'widget.sendToJournal', 'chartSetup.stepBars', 'chartSetup.autoScale'],
    words: [/\b(swap|switch places|trade places|exchange)\b/, /\b(duplicate|clone)\b/, /\b(a |another )?(copy|duplicate) of\b/, /\bmove\b.*\bto the (left|right|top|bottom)\b/, /\bother side\b/,
      // "go back 5 bars", "nudge it forward a bar", "auto scale", "fit the price axis"
      /\b(?:step|go|move|scroll|nudge|shift|pan)\b.*\b(?:back|backwards?|forwards?|ahead|left|right)\b.*\bbars?\b|\b(?:back|forwards?|ahead)\b.*\b(?:a|one|\d{1,3}|two|three|four|five|ten) (?:more )?bars?\b/,
      /\bauto[- ]?scal\w*\b|\b(?:re-?)?fit\b.*\bprice (?:scale|axis)\b|\bprice (?:scale|axis)\b.*\b(?:fit|auto)\b/] },
  { id: 'workspace', title: 'Widgets on the board (add, remove, move, resize, arrange, link, widget tabs)', domains: ['widget'],
    // CG-14 / CG-16 (corpus #769): "get rid of the AMD chart", "give me new charts for AAPL and MSFT" (widget.addCharts — the
    // existing charts stay; chartGrid.set only with a count, grid or equal-size words, or a replace)
    words: [/\bwidgets?\b/, /\bworkspaces?\b/, /\bboard\b/, /\b(another|new|one more|second|extra) charts?\b/, /\b(add|open|close|remove|delete|get rid of|ditch|kill|lose|drop)\b.*\bcharts?\b/, /\b(move|resize|arrange|rearrange|swap|wider|narrower|taller|shorter|bigger|smaller|fill|side by side|grid of|left|right|top|bottom)\b/,
      /\b(link|unlink|colou?r group)\b/, /\btabs?\b/, EQUAL_SIZE,
      // CG-3a (corpus #769): a COUNT of charts with no tickers ("put four charts on my screen", "create four charts") is
      // new charts + an even re-tile — the widget adds and the arrange live here (chartGrid needs tickers)
      MULTI_CHARTS, GRID_CELLS, /\b(2 ?x ?2|[2-4] by [2-4])\b/] },
  // ⭐ pl-grid (C3-042..061): the Multi Chart GRID itself — its shape, entering / leaving it, the sync toggles, Groups, saved
  // grids, the shared settings dialog, maximize and "Reset to my chart" — its OWN fillLast group (two actions), so neither the
  // NL-1 core nor the workspace / chartGrid groups grow. ADD-ONLY: routing only adds what the model may see.
  { id: 'multiChart', title: 'The Multi Chart grid itself: open it at a shape (2×3, rows × columns) or leave it, crosshair / time-range sync, Groups mode and loading / stepping / refreshing a group, open / save / delete a saved grid, Shared Chart Settings, maximize one cell or restore the grid, reset one cell to my chart', domains: ['multiChart'], fillLast: true,
    // #1030 re-merge (Lead 2026-11-11): WORDS-ONLY (never v2 filler, as watchlistShow / compareGroups), and every word needs GRID
    // context: a bare "group(s)", "row(s)", "sync" or "crosshair" never selects it alone (the frozen no-lookbehind rows stay master's)
    wordsOnly: true,
    // a bare \"grid\" / \"2x2\" is chartGrid's (charts tiled on the board): this group needs the grid AS a thing the member acts on
    words: [/\bmulti[\s-]?charts?\b/, /\bsplit (?:my|the) screen\b/,
      /\b(?:open|save|delete|apply|load|close|exit|leave|restore|fill|refresh|rename) (?:the |this |that |my |a )?(?:[\w’'&-]+ ){0,3}?grids?\b/,
      /\b(?:show|give) me an? (?:\d\s*(?:x|by|×)\s*\d|(?:one|two|three|four)\s+(?:by|x)\s+(?:one|two|three|four)) grid\b/, /\b(?:in|of|across) the (?:whole )?grid\b/,
      // a shape said as rows AND columns ("three rows and four columns")
      /\b(?:\d|one|two|three|four)\s+rows?\b.*\b(?:\d|one|two|three|four)\s+columns?\b|\b(?:\d|one|two|three|four)\s+columns?\b.*\b(?:\d|one|two|three|four)\s+rows?\b/,
      // sync WITH what it syncs (the crosshair, the time range, the charts / cells); link / lock only the crosshair or time range
      // ("link the top two charts" is widget.setLink's)
      /\bsync\w*\s+(?:[\w’'-]+\s+){0,4}?(?:cross[\s-]?hairs?|time[\s-]?ranges?|charts|cells)\b|\b(?:link\w*|lock\w*)\s+(?:[\w’'-]+\s+){0,4}?(?:cross[\s-]?hairs?|time[\s-]?ranges?)\b|\bcross[\s-]?hairs?\s+(?:[\w’'-]+\s+){0,3}?(?:sync\w*|link\w*|across)\b/,
      /\b(?:every|all(?: the| my)?|each) (?:charts?|cells?) (?:\w+ ){0,3}?(?:to |on )?the same (?:dates|time ?range)\b/,
      // Groups mode, or stepping the grid's group
      /\bgroups mode\b|\b(?:next|previous|prev) group\b|\brefresh (?:the |this |my )?group\b|\bswitch (?:over )?to (?:the |my )?[\w&’' -]{1,40}? group\b(?! (?:comparisons?|overlays?|scale))/,
      /\bmaximi[sz]e|\bfull[\s-]?(?:size|screen)\b|\bblow (?:it |that |the \w+ )?up\b|\bwhole grid\b|\bun-?maximi[sz]e\b/,
      /\bshared (?:chart )?settings\b|\bmy (?:own )?(?:chart|normal) settings\b|\breset\b.*\bmy chart\b|\bback to my (?:own )?chart\b/,
      /\bnormal (?:board|charts? board)\b|\bback to (?:the |my )?(?:normal |regular )?(?:board|workspace)\b/] },
  // Split from 'workspace' (2026-10-09): a whole-group packer packs better with smaller groups, and
  // saved layouts are their own concept ("open my Swing layout", "save this").
  { id: 'layouts', title: 'Saved layouts (open, save, create, copy, rename, delete)', domains: ['layout'],
    // W1.1 R-03 (LT-9): "rename <X> to <Y>" names a layout as often as a tab or a list — the group rides along (routing only ADDS)
    words: [/\blayouts?\b/, /\bworkspaces?\b/, /\bsave\b.*\b(changes|this|it|layout|arrangement|board)\b/, /\brename\b(?!.*\b(?:watch ?lists?|lists?|tabs?|screens?|scans?|indicators?|drafts?|alerts?)\b).*\bto\b/] },
  // C3-037..039 (#1074): the Layout Dock's BAR — pin a layout to it, take one off, move one along it. Its OWN three-action group by
  // action name, WORDS-ONLY (never a filler), like watchlistShow (#1027): #1074 re-merge onto 64421f770d — with the three in
  // `layouts`, that group grew past what NL-1's budget fits beside the core + another group (corpus ws-11, layout.duplicate, lost
  // its first call), and the bar words made `layouts` ride on the chart header's bar-info readout (C1-065, chart.setSetting).
  // Words: a place on the bar or dock ("take Swing off the bar", "move Swing to the left on the bar"), but never a bar-info noun
  // after "bar" ("hide the close in the bar info": the chart's readout, not the dock); "unpin"; "pin" with "layout".
  { id: 'layoutBar', title: 'The layout bar (Layout Dock): pin a saved layout to the bar, take one off it, move one along it',
    domains: [], actions: ['layout.pinToBar', 'layout.unpinFromBar', 'layout.moveOnBar'], fillLast: true, wordsOnly: true,
    words: [/\b(?:off|from|to|on|onto|of|in) (?:the |my )?(?:layouts? )?(?:bar|dock)\b(?! (?:info|readouts?|data|values?|legend|strip)\b)/, /\bunpin\b/, /\bpin\b.*\blayout/] },
  // INDICATORS M1 (agreed with Indicators, AGENT-INTEGRATION-HANDOFF §11). A message matching an
  // indicators word AND a charts word routes BOTH; the hints decide.
  { id: 'indicators', title: 'Indicators on a chart (list, add, remove, show, hide; build, preview and save indicator drafts)', domains: ['indicator'],
    words: [/\bindicators?\b/, /\b(rsi|macd|ema|sma|vwap|atr|bollinger|keltner|stochastic|supertrend|regression|correlation|oscillator|histogram)\b/,
      // CG-18 (corpus #774): "momentum" names an indicator — not in a screen's / list's name ("run my Momentum screen")
      /^(?!.*\b(?:screens?|scans?|screener|watch ?lists?|lists?)\b).*\bmomentum\b/,
      // W2 (CG-4): an indicator spelled out ("add the relative strength index") — not the screener's RS words
      /\b(relative strength index|moving average convergence|average true range|exponential moving average|simple moving average|volume[- ]weighted average)\b/,
      // ⭐ acceptance 2026-10-29: "each with a 50sma", "9ema" — a length typed against its type
      /\b\d{1,4}-?(?:ema|sma|wma|hma|ma)s?\b/,
      // "what's on this chart", "do i have the 50 on here", "a weekly 10 line": the chart's indicators
      /\bwhat'?s on (this|the|my) chart\b|\b(have|got) the \d+ on\b|\b\d+ (line|ma|average)\b/,
      // CG-28 (corpus #774): the words traders use for a chart's indicators — "which studies do I have on here", "my
      // oscillators", "the averages", "what overlays are on", "which lines (MAs) are on here" — and "on here" = this chart
      // ⛔ no lookbehind (iOS 16 floor): "case study" is excluded by checking the 4 characters before the space by lookahead
      /(?:^|[^ ])\bstud(?:y|ies)\b|(?:^[^]{0,3}|(?!case)[^]{4}) stud(?:y|ies)\b|\boscillators\b|\bmas\b/,
      /^(?:(?=.*\bcharts?\b)|(?!.*\b(?:the market|market'?s|s ?& ?p|spx|nyse|nasdaq|breadth|stocks)\b)).*\b(?:moving |the |my |which |what |all (?:the |my )?)averages\b/,
      /\b(?:what|which|any|my|the) (?:[a-z-]+ ){0,2}(?:overlays|lines)\b.*\b(?:on|in) (?:here|this chart|the chart|my chart|it)\b/,
      /\b(?:what|which)\b.*\b(?:have|got|is|are)\b.*\b(?:on|in) here\b/,
      // Gate C: moving averages by name or by LENGTH ("add a 200 day moving average", "add the 9 and 20",
      // "put the 50 on it", "make it a 9" after an add) and the short names traders type ("bollies", "bb")
      // CG-36 (corpus #774): the MARKET's moving averages ("how are the moving averages looking for the market") are breadth's
      /^(?:(?=.*\bcharts?\b)|(?!.*\b(?:the market|market'?s|s ?& ?p|spx|nyse|nasdaq|breadth|stocks)\b)).*\bmoving averages?\b/, /\b(mas?|bbands?|bb|bollies|boll)\b/,
      // CG-19 (corpus #774): a LENGTH ("the 200 day") — not in a question over a universe of stocks ("% of stocks above the 50 day")
      /^(?!.*\b(?:percent|%|pct|share|how many)\b.*\b(?:stocks|names|issues)\b)(?!.*\b(?:stocks|names|issues)\b.*\b(?:above|below)\b).*\b\d{1,3}[- ]?(?:day|week|period)\b/,
      /\b(add|put|throw|slap|stick|plot|show|hide|remove|take off|clear|get rid of|make|swap|replace)\b.*\bthe \d{1,3}(?:\s*(?:,|and|&)\s*(?:the )?\d{1,3})*\b/,
      /\b(build|make|create|write|code)\b.*\b(indicator|study|signal|formula)\b/, /\b(when|whenever|if)\b.*\b(cross(es)?|above|below)\b/,
      // a colour RULE ("colour the candles by trend"), not a colour ("colour the candles green")
      /\b(colou?r|paint|highlight|shade)\w*\b.*\bby (trend|momentum|strength|signal|condition)\b/,
      // INDICATORS M3: the authoring draft ("show me the preview", "save the draft")
      /\b(preview|draft)\b/] },
  // ⭐ INDICATORS P2 (AGENT-CONTRACT-P2, 2026-10-27): how an indicator looks and where it draws, pane order and
  // size, duplicating and copying across charts — their own group, so the NL-1 core keeps its size.
  { id: 'indicatorSetup', title: 'Indicator look and placement: colours, line width / style, plot style, which pane it draws in, pane order and height, duplicate, copy indicators to other charts', domains: ['indicatorStyle', 'indicatorCopy', 'pane'], fillLast: true,
    words: [/\b(thick|thicker|thin|thinner|width|dashed|dotted|solid|histogram|columns|plot style|line style)\b/, /\bpanes?\b/, /\b(above|below) (the )?(price|volume)\b/,
      /\b(own|separate|new) pane\b|\b(overlay|put|move)\b.*\b(on|onto) (the )?(price|volume)\b/, /\b(duplicate|copy|copies|clone)\b.*\b(indicators?|studies|rsi|macd|ema|sma)\b/, /\b(same|these|my) indicators\b/,
      /\b(make|turn|colou?r|paint)\b.*\bthe \d{1,3}\b.*\b(red|green|blue|white|black|orange|yellow|purple|pink|teal|gr[ae]y)\b/,
      // ⭐ PACKAGE 3: which timeframes it shows on ("only show it on the daily", "daily charts only", "except the daily")
      /\b(daily|weekly|monthly|intraday|hourly)( charts?)? only\b|\bonly (show|display|draw|on)\b.*\b(daily|weekly|monthly|intraday|hourly)\b|\bexcept (on )?the (daily|weekly|monthly|intraday)\b/,
      // ⭐ PACKAGE 3: the indicator just built / changed onto another chart ("apply it to my other chart", "copy it to the SPY chart")
      /\b(apply|put|copy|add|place)\b.*\b(it|this|that|them|those)\b.*\b(other|another|both|all)\b.*\bcharts?\b|\bcopy (it|this|that|them|those)\b.*\bcharts?\b/] },
  { id: 'definitions', title: 'Indicator definitions: search UCT\'s and your own indicators, describe one, save a copy, delete one of yours', domains: ['definition'], fillLast: true,
    // CG-24 (corpus #774): "are there any volatility indicators", "which momentum indicators do you have" — a SEARCH of the catalog
    words: [/\b(my|saved|custom|own) indicators?\b/, /\bindicators? (for|that|which|to)\b/, /^(?!.*\b(?:remove|delete|clear|hide|show|add|drop|take off)\b)(?!.*\b(?:on|in) (?:my|this|the|that) charts?\b).*\b(?:(?:any|which|what|some|other|more) (?:[a-z-]+ ){1,2}indicators|indicators? (?:do you have|are available|exist)|are there (?:any )?(?:[a-z-]+ ){0,2}indicators?)\b/, /^(?!.*\b(?:on|in) (?:my|this|the|that) charts?\b)(?!.*\bon (?:here|it|there)\b).*\b(find|search|look for|what) .*\bindicators?\b/, /\b(describe|explain|what does)\b.*\b(indicator|rsi|macd|atr|study)\b/, /\b(delete|remove|copy|duplicate)\b.*\b(my|saved|custom)\b(?:\s+[a-z0-9-]+){0,3}\s+(indicator|formula|study)\b/] },
  // Charts family (2026-11-12): a chart's Volume Profile overlay (volumeProfile.set), in its OWN words-only group (as chartMenu):
  // never a filler, so no existing group and no unrecognised request changes. The words name the PROFILE itself (volume
  // profile / VPVR / visible range volume); "VP" only beside an on / off verb or a bins word. A bare "volume" (the Volume
  // pane), "VWAP" and volume alerts are not its words.
  { id: 'volumeProfile', title: 'A chart’s Volume Profile overlay: on / off, bins, colours', domains: ['volumeProfile'], fillLast: true, wordsOnly: true,
    words: [
      /\bvolume[\s-]?profiles?\b|\bvol profile\b|\bvpvr\b|\bvisible range volume\b/,
      /\b(?:add|show|hide|remove|turn on|turn off|enable|disable|switch on|switch off|toggle)\s+(?:the\s+|my\s+)?vp\b|\bvp\s+(?:on|off|bins?)\b/] },
  // ⭐ W1-B (2026-11-02): the TIME-ANCHORED tools in their OWN small group (as chartSetup is), so the drawings group keeps
  // its size and every group still fits a reroute beside the NL-1 core. Membership is by ACTION NAME (`actions`), not by
  // domain: the tools stay `drawing.*` on the drawing kind. Listed BEFORE drawings so "draw a trendline from…" takes this.
  // #1076 (Lead decision 2026-11-11): the drawing menu's Duplicate and a position's Alerts row in their OWN group, WORDS-ONLY
  // (as #1027's watchlistShow / #1073's compareGroups), so `alerts` and `drawings` keep master's exact size: one more action in
  // either moved the nothing-recognised fill, which sits exactly at the 55-action budget (data / boardEdit / screener / undo cut).
  // Its words: a duplicate / copy / clone verb with a drawing noun; an alert word with a position's entry / stop / target.
  // Plain "alert at 150" stays `alerts` and "draw a line" stays `drawings` (no position or duplicate word).
  { id: 'drawingOps', title: 'Duplicate a drawing on its chart; set a position drawing\'s entry / stop / target alerts', domains: [], fillLast: true, wordsOnly: true,
    actions: ['drawing.duplicate', 'drawing.setPositionAlerts'],
    words: [/\b(?:duplicate|copy|clone)\b.*\b(?:drawings?|trend ?lines?|lines?|rays?|shapes?|rectangles?|boxe?s?|fib\w*|channels?|pitchforks?|arrows?|annotations?|positions?)\b/,
      /\balerts?\b.*\b(?:entry|stops?|targets?|positions?)\b|\b(?:entry|stops?|targets?|positions?)\b.*\balerts?\b|\b(?:alert|notify|ping|tell) me\b.*\b(?:entry|stops?|targets?)\b/] },
  { id: 'drawingTools', title: 'Time-anchored drawings from dates and prices: trendline, ray, horizontal ray, rectangle, Fibonacci retracement and extension, text note, anchored VWAP, extended line, vertical line, circle, arrow, pitchfork, parallel channel, cup curve, Measure, Price Range, Bars & Time, Price Move', domains: [], fillLast: true,
    actions: ['drawing.addTrendline', 'drawing.addRay', 'drawing.addHorizontalRay', 'drawing.addRectangle', 'drawing.addFib', 'drawing.addText', 'drawing.addAvwap', 'drawing.add'],
    // CG-29..32 (corpus #774): "connect … with a trend line", "draw a line from <date> to <date>", a bare "fib retracement
    // sep 2 100 to oct 28 180", "write breakout on the chart at …", "anchor a vwap to oct 1"
    words: [/\b(draw|add|put|place|plot|anchor|drop|mark|connect|join|link)\b.*\b(trend ?lines?|rays?|fib\w*|retracements?|rectangles?|boxe?s?|notes?|text|anchored vwap|avwap)\b/,
      /\b(?:draw|put|add|plot)\b.*\blines? from\b.*\bto\b/, /\bfib(?:onacci)?(?: retracement)?\b|\bretracement\b/,
      /\b(?:write|type|label|annotate)\b.*\b(?:on (?:the|my|this) chart|at \$?\d)/, /\banchor(?:ed)? (?:a |an |the )?vwap\b/,
      /\b(trend ?lines?|rays?|fib\w*|retracements?|rectangles?|anchored vwap|avwap)\b.*\b(from|between|starting|anchored|since)\b/, /\banchored vwap\b|\bavwap\b/] },
  { id: 'drawings', title: 'Chart drawings: horizontal price levels (draw, move to a price), move any drawing\'s anchors, restyle, every setting in a drawing\'s menu, Fibonacci levels and fills, show/hide, lock, remove one, clear all, list', domains: ['drawing'],
    // W2 (CG-7): a stock's "drawdowns" are price history (data), never a drawing
    // CG-28 family: "the lines on here" may be the member's drawn levels as much as their averages — both groups ride
    words: [/\bdraw(?![\s-]?downs?\b)\w*\b/, /\b(?:what|which|any|my|the|all) (?:[a-z-]+ ){0,2}lines\b.*\b(?:on|in) (?:here|this chart|the chart|my chart|it)\b/, /\b(a |the )?line at \$?\d/, /\b(horizontal (line|level)s?|levels?|price lines?|rays?|trend ?lines?|fib\w*|rectangles?|annotat\w+|support|resistance)\b/] },
  // drawing extras (C1-144 / C1-160 / C1-165): the Position Calculator with entry / stop / target, a drawing's "Save as
  // default", and a drawing tool's ★ — their OWN group, WORDS-ONLY (as #1027's watchlistShow / #1073's compareGroups), so
  // `drawings` keeps master's exact size and the nothing-recognised fill (exactly at the 55-action budget) does not move.
  // Its words: a position-calculator / position-size word, or entry + stop + target with no alert word; "default" with a
  // save / make / set verb and a drawing noun (or "default style"); a favourite / star word with a TOOL noun. Plain "draw a
  // line" stays `drawings`, "set an alert at my stop" stays `alerts`, and "favourite NVDA" (a ticker flag) is not this.
  { id: 'drawingExtras', title: 'Position Calculator with an entry, stop and target on a chart; make a drawing\'s style the chart\'s default for new drawings; star / unstar a drawing tool as a favourite', domains: [], fillLast: true, wordsOnly: true,
    actions: ['drawing.positionCalculator', 'drawing.saveDefaults', 'drawing.favoriteTool'],
    words: [/\bposition (?:calculator|calc|sizer|sizing)\b|\bsize (?:the|my|a|this) (?:position|trade)\b|^(?!.*\b(?:alerts?|notify|ping)\b)(?=.*\bentry\b)(?=.*\bstops?\b).*\btargets?\b/,
      /\bdefault (?:drawing )?style\b|^(?=.*\b(?:save|make|set|use)\b)(?=.*\b(?:drawings?|trend ?lines?|lines?|rays?|rectangles?|boxe?s?|fib\w*|arrows?|notes?|circles?|channels?|pitchforks?)\b).*\bdefaults?\b/,
      /\b(?:favou?rit\w*|star|unstar|starred)\b.*\b(?:tools?|toolbar)\b|\b(?:tools?|toolbar)\b.*\bfavou?rit\w*\b/] },
  // C1-167..170: the four Drawing Boards actions in their OWN group, WORDS-ONLY (as #1027's watchlistShow, #1073's compareGroups), so the
  // drawings group keeps master's size and routing v2's unrecognised-request fill (at its 55-action budget) is unchanged
  { id: 'drawingBoards', title: 'Drawing Boards: switch the board you draw on, make a new board, rename one, delete one', domains: [], fillLast: true, wordsOnly: true,
    actions: ['drawing.setActiveBoard', 'drawing.createBoard', 'drawing.renameBoard', 'drawing.deleteBoard'],
    // a Drawing Board by its verb ("switch to my Swing board", "rename Board 2 to Earnings"), the verb governing the board noun within
    // two words — a bare "board" is the workspace ("remove everything from the board" is not a Drawing Board)
    words: [/\b(?:switch|change|go|flip|jump|move)\s+(?:back\s+|over\s+)?to\s+(?:my|the|a|another|this|that)?\s*(?:[\w'’-]+\s+){0,2}boards?\b/,
      /\bdraw(?:ing)?\s+on\s+(?:my|the|a|another|this|that)?\s*(?:[\w'’-]+\s+){0,2}boards?\b/,
      /\b(?:rename|delete|remove|erase)\s+(?:my|the|this|that)?\s*(?:[\w'’-]+\s+){0,2}boards?\b/,
      /\b(?:new|another|create|make|start)\s+(?:(?:me|a|an|another|new)\s+)*(?:drawing\s+)?boards?\b/, /\bdrawing\s+boards?\b/] },
  { id: 'lists', title: 'Watchlists and list widgets (show, create, rename, add, remove, keep only some, clear, delete, reorder, notes; sort a widget by a column, add / hide columns, next / previous ticker, what a list shows; flag / unflag tickers)', domains: ['watchlist'],
    words: [/\bwatch ?lists?\b/, /\blists?\b/, /\b(add|put|remove|drop)\b.+\b(to|into|from|off)\b/] },
  { id: 'screener', title: 'Screener (run screens, saved screens: run, save, copy, rename, delete)', domains: ['screener'],
    words: [/\bscreen\w*\b/, /\bscans?\b/, /\bfind (me )?(stocks|names|tickers)\b/, /\bfilter\w*\b/, /\b(stocks|names) (with|above|below|over|under)\b/, /\b(top|first) \d+\b/, /\bresults?\b/, /\b(adr|rs rating|rvol|market cap|dollar volume|52[- ]week)\b/,
      // STRENGTH / LEADERSHIP screens (stabilization, 2026-10-11). A strength/rank word ATTACHED to a
      // stock noun (≤2 words between): "my strongest stocks", "the weakest names", "best semiconductor
      // stocks", "top performers". Never the bare word — "strongest chart color", "best chart theme"
      // or "top-right chart" stays where it was. "momentum" alone stays an indicator word — only
      // "momentum stocks/names/leaders" is a screen.
      /\b(strongest|weakest|best|worst|top|bottom|leading|lagging|top[- ]rated|highest[- ]rated)(?:[- ]performing)?\s+(?:[a-z0-9&.-]+\s+){0,2}?(stocks|names|tickers|equities|performers|movers|setups)\b/,
      /\b(relative strength|rs rank|rs leaders?|market leaders?|strength leaders?|leaders and laggards)\b/,
      /\b(leaders?|leading) (stocks|names)\b|\b(stocks|names) leading\b/,
      /\btop (momentum|performing|performers?|gainers?|losers?|movers?)\b|\bmomentum (stocks|names|leaders?)\b/,
      // SCREEN CONDITIONS (F-SB-1, Sprint 2): a condition on a universe of stocks — a level, a volume
      // multiple, a window, a cross — is a screen even when it names an indicator or a data field. These
      // only ADD the screener group (the indicators / data / breadth group a word also matches stays), so
      // the planner can screen on its first call instead of spending one on need_groups.
      /\b(stocks|names|tickers) (where|that|which|whose)\b/,
      /\b(making|hitting|at|near) new (52[- ]week )?highs\b/,
      /\bunusual (volume|activity)\b/, /\b\d+(\.\d+)?\s*x (their |the |its )?(average|avg|normal|usual) volume\b/, /\bvolume (dried|drying|dries) up\b/,
      /\bconsolidat\w*\b/, /\bpull ?backs? to (the )?\d+\b/, /\buptrends?\b/, /\b(ema|ma|sma) stack\b/, /\brs line\b/,
      /\bwithin \d+(\.\d+)?\s*% of\b/,
      /\b(rsi|adx|cci|stochastics?|mfi)\s*(is |reading |readings? )?(over|above|under|below|greater than|less than|>|<)\s*-?\d+/,
      /\b(ema|sma|ma)\s*\d+\s+cross\w*\s+(above|below|over|under)\b/, /\b(macd|rsi|momentum) (just )?(turned|turning|crossed|went) (positive|negative|up|down|bullish|bearish)\b/,
      /\bshort (float|interest)\b/, /\b(earnings|reporting|reports?|report) (in|within) the next \d+ (days?|weeks?)\b|\b(reporting|earnings) (this|next) week\b/,
      /\bsectors?'? leaders\b|\bleaders (in|of) (the )?(strongest|top|leading|best) (sectors?|groups?|industries)\b/,
      // COUNT / LIST OF STOCKS ON A MOVE (2026-11-03, production miss): "how many stocks are up more than 5% today",
      // "which stocks gained over 5%", "stocks up more than 5%" named no screen word, so the model never saw the
      // screener and answered from the web. A question over a UNIVERSE of stocks — never one named ticker ("is
      // NVDA up more than 5%" stays a quote). turn.py `is_screen_question` (a stricter subset) drops web research.
      /\b(how many|which|what) (stocks|names|tickers|equities)\b/,
      // CG-35 (corpus #774): calendar.day / calendar.nextReport exist ONLY on the Calendar page (surfaces ['calendar']); on
      // /charts "what's on the calendar this week" / "who reports this week" is the earnings-window SCREEN
      /\bon the (?:earnings )?calendar\b|\b(?:report(?:s|ing)?|earnings) (?:this|next) week\b|\bwho(?:'s| is)? report(?:s|ing)\b/,
      /\b(stocks|names|tickers|equities) (are |were |that are |that were )?(up|down|gained|lost|gaining|losing|rose|fell|rising|falling|green|red)\b/],
    // ⭐ Gate B (0C): TRADING VOCABULARY that names a SCREEN without the word "screen" (soft, see
    // selectGroups). Routing only: it changes which actions the model SEES first, never what a word
    // means (meanings are Phase 1B) and never drops a group that would otherwise have been sent.
    vocab: [/\b(semis|semiconductors?|semi conductors?|chips?|chip stocks|biotechs?|software (stocks|names)|banks|miners|small[- ]?caps?|mid[- ]?caps?|large[- ]?caps?|mega[- ]?caps?|ipos?|etfs)\b/,
      /\b(gainers?|losers?|movers?|gap(ped|ping|s)? (up|down)|new highs?|near (the )?highs?|all[- ]time highs?|pull(ing|s)?[- ]?backs?|pulling back|tagging|tight (bases?|flags?|ranges?)|bases?|flags?|breakouts?|unusual volume|big volume|leaders?|leading groups?|laggards?|acting well|working)\b/,
      /\b(over|under|above|below) \$?\d+ (bucks|dollars)\b|\b\d+ (million|mil|m|billion|bn?) (a day|dollar volume)\b|\bliquid (names|stocks)\b/,
      /\b(sort (it|them|that|by)|only the ones|same thing but|just (the )?(large|small|mid)[- ]?caps)\b/] },
  { id: 'alerts', title: 'Price alerts (list, create, delete), and an alert that follows a drawn line or Fibonacci level', domains: ['alert'], actions: ['drawing.setAlert'],
    // CG-12 (corpus #769): "tell me about TSM" is a question, never an alert — only "tell me when / if …" is
    words: [/\balerts?\b/, /\b(notify|ping) me\b/, /\btell me (when|if|once|as soon as)\b/, /\b(crosses|breaks|hits)\b/] },
  // ⭐ W1-B B-03: INDICATOR alerts (RSI, MACD…) in their own small group, `fillLast` like every specialised group — so the
  // fallback fill for a message nothing named still carries the screener (F-SB-1: every discovery question reaches the
  // planner with it) exactly as before. Named by an alert word beside an indicator word, or pause / resume.
  { id: 'indicatorAlerts', title: 'Indicator alerts on a chart\'s indicators — RSI, MACD, EMA / SMA crosses, bands… (create, pause / resume, delete)', domains: ['indicatorAlert'], fillLast: true,
    words: [/\b(alerts?|notify|ping me|tell me when|let me know when)\b.*\b(rsi|macd|stochastics?|bollinger|bands?|adx|cci|mfi|ichimoku|donchian|williams|indicators?|overbought|oversold)\b/,
      /\b(rsi|macd|stochastics?|bollinger|bands?|adx|cci|mfi|ichimoku|donchian|williams|indicators?)\b.*\b(alerts?|notify|ping me)\b/, /\b(pause|resume|re-?arm)\b.*\balerts?\b/,
      // ⭐ W1.1 R-04 (live LT-4, 2026-11-03): "mark when the 9 ema crosses above the 20 on this chart" named no alert word
      // and no RSI/MACD, so the group was never offered and the planner invented a limitation ("can't create them yet").
      // An ALERT-LIKE verb (mark / flag / alert / notify / warn / watch for / let me know / tell me / ping / heads up)
      // beside WHEN / IF / ONCE and any indicator token (ema, sma, ma, vwap, atr, a length such as 9ema / 20-day…)
      /\b(?:mark|flag|alert|alerts|notify|warn|watch for|let me know|tell me|ping|ping me|heads up|set (?:up )?(?:an? )?alert|message me|wake me)\b.*\b(?:when|if|once|whenever|as soon as|the moment)\b.*\b(?:rsi|macd|ema|sma|wma|hma|dema|tema|vwap|atr|adx|cci|mfi|stochastics?|bollinger|bands?|keltner|supertrend|ichimoku|donchian|williams|indicators?|moving averages?|overbought|oversold|signal line|histogram|\d{1,3}[- ]?(?:day|d|ema|sma|ma|dma|period))\b/,
      // an indicator or a plain length CROSSING ("the 9 ema crosses above the 20", "9/20 cross", "ema 9 crossover", "golden cross")
      /\b(?:rsi|macd|ema|sma|wma|hma|vwap|atr|adx|cci|mfi|stochastics?|bollinger|bands?|keltner|supertrend|moving averages?|signal line|\d{1,3}[- ]?(?:ema|sma|ma|dma|day|d))\b[^.]{0,40}\b(?:cross(?:es|ed|ing)?(?: (?:above|below|over|under|up|down))?|crossover)\b/,
      /\b(?:the )?\d{1,3} (?:cross(?:es|ed|ing)?) (?:above|below|over|under|the)\b/, /\b\d{1,3}\s*\/\s*\d{1,3} (?:cross(?:es|ed|ing)?|crossover)\b/, /\b(?:golden|death) cross\b/] },
  // KN-1 (agent-kn): UCT's own trading knowledge — concepts, setup templates, setup records. `words` stays EMPTY here:
  // capabilities/knowledge.js fills it only when its capabilities register (the server serves the kinds), so with
  // the knowledge kinds off this group never matches and routing is exactly what it was.
  { id: 'playbook', title: 'UCT trading knowledge: what a setup or concept means at UCT, the rules of a UCT setup template, the historical record of a setup', domains: ['playbook'], fillLast: true, addOnly: true,
    words: [] },
  // W2-B1 (RS-1): `research.ask` rides in this group by domain ("why is X down", "what's driving …", catalysts);
  // W2-B2: `history.afterEvent` too ("how has X behaved after …", "what happens after …")
  { id: 'data', title: 'Stock information, news and research (profile, earnings, comparisons, news, catalysts, why a stock is moving, pullbacks, off its high)', domains: ['stock', 'news', 'research', 'history'],
    // CG-21 (corpus #774): "news" — not the News WIDGET ("add a news widget")
    words: [/\bnews\b(?! (?:widget|panel|tab|window)s?\b)/, /\b(headlines?|catalysts?|earnings|profile|fundamentals?|compare|versus|vs\.?|sectors?|industry|market cap|float|why is|what does .+ do|what'?s driving|what is driving|off (its|the) (52[\s-]?week )?highs?)\b/,
      /\b(how (has|did|does) \S+ (behaved?|do|done|perform(ed)?|react(ed)?|trade[d]?) after|what (happens|happened) (to|with) \S+ after|after .*\b(gaps?|gapped|cross(es|ed)?)\b)\b/,
      // PKG2: an event study said another way ("in the weeks after gapping up 8%", "after 20-day breakouts", "after new 50-day highs")
      /\b(?:after|following) .*\b(?:gapping|gaps? (?:up|down)|breakouts?|break(?:s|ing)? out|new \d{1,3}[- ]?(?:day|week|session) (?:closing )?highs?)\b/,
      // PKG2: an index level / commodity / crypto price (the asset-class quote kinds, MD-1 §4.7.3) — "gold price", "price of bitcoin"
      /\b(?:gold|silver|copper|crude|oil|brent|wti|natgas|natural gas|bitcoin|btc|ethereum|ether|solana)(?:'s)? (?:price|quote)\b|\b(?:price|quote|level) (?:of|for|on) (?:gold|silver|copper|crude|oil|brent|wti|natgas|natural gas|bitcoin|btc|ethereum|ether|solana|the (?:s&p|dow|nasdaq|russell|vix))\b/,
      DATA_HISTORY,
      // CG-12 (corpus #774): "tell me about AAPL", "tell me about TSM the company"
      /\btell me (?:a (?:little|bit) )?about\b/,
      // CG-11 / CG-13 (corpus #769): "how much is NVDA (right now)", "how does NVDA stack up against AMD"
      /\bhow much is \$?[a-z]{1,5}\b|\bwhat(?:'s| is) \$?[a-z]{1,5} (?:at|worth|going for)\b/, /\bstacks? up (?:against|to|with|vs\.?|versus)\b/],
    // Gate B vocabulary (soft): "when does nvda report", "anything new on tesla", "stack up on valuation"
    vocab: [/\b(reports?|reporting|valuation|stacks? up|anything new (on|with)|what'?s (going on|happening) with|why did .+ (gap|move|drop|fall|jump|rally|sell off))\b/] },
  // MARKET INTELLIGENCE breadth slice 1 (2026-10-11): historical breadth QUESTIONS. "breadth" alone is
  // a question — except a request to GO TO the breadth page / monitor, which stays navigation
  // (settings group). The lookahead is anchored at the start of the message (no lookbehind).
  { id: 'breadth', title: 'Market breadth now and history (US, NYSE, Nasdaq: % of stocks above moving averages, new highs/lows, advance/decline, Stage 2/4)', domains: ['breadth'],
    // W2 gaps-5: "averages for the S&P" — the MARKET's moving-average participation is breadth's (A20…A200: the share of stocks
    // above their averages); UCT's data group has no moving-average reading for an index (stock.dailyBars: closes, ranges,
    // off-high, pullbacks), so breadth is the canonical capability (breadth.show; the US universe stands for the S&P)
    words: [/^(?!.*\b(open|go to|take me to|navigate to|bring up|pull up|switch to)\b.*\bbreadth\b.*\b(page|monitor|dashboard|tab|screen)\b).*\bbreadth\b/,
      // review gaps-5 (2): never ONE symbol's averages ("the 50 day moving average of SPY", "…on the SPY chart"): no SPY, no "on",
      // no chart, no add / put / show
      /^(?!.*\b(?:charts?|add|put|show|plot|draw)\b).*\b(?:moving )?averages?\b.*\b(?:for|of|across|in) (?:the )?(?:s ?& ?p|s and p|spx|market|nasdaq|nyse|us market)\b/,
      /\b(percent|pct|share|portion|how many|what %|what percent)\b.*\b(above|below|over|under)\b.*\b\d+[- ]?(day|d|dma|sma|ema|week)\b/,
      /% (of )?(all )?(us |nyse |nasdaq |uct )?(stocks|names|issues)\b/,
      /\b(us|nyse|nasdaq|uct) (stocks|names|issues) (are |were )?above\b/,
      /\b(?:(?:us|nyse|nasdaq|uct)\s*:?\s*)?a(?:5|10|20|40|50|100|150|200)\b/,
      /\b(last|first|most recent) time\b.*\b(below|above|under|over|cross(?:ed|es)?)\b/, /\bhow (?:many times|often)\b.*\b(below|above|under|over|cross)/,
      /\bcross(?:ed|es)? (above|below) \d+(\.\d+)?\s*%/, /\b(below|above)[\s-]*\d+(\.\d+)?\s*%[\s-]*(episode|stretch|streak|run)\b/,
      /\bnew (52[- ]week |52w |20[- ]day )?(highs?|lows?)\b/, /\bnet new (highs?|lows?)\b|\bhighs? (minus|vs\.?|versus) lows?\b/,
      /\badvance[- /]decline\b|\badvancers?\b|\bdecliners?\b|\ba\/d (line|ratio|numbers?)\b|\badvancing (issues|stocks)\b/,
      /\bstage ?[24] (counts?|stocks|names)\b/, /\b(up|down) 4%/, /\bmarket internals\b/] },
  { id: 'settings', title: 'App settings (app theme, default timeframe, alert sound, email digest) and opening UCT pages', domains: ['settings', 'app'],
    // CG-25..27 (corpus #774): the APP's theme ("use the light theme", "UCT theme"), a DEFAULT for new charts ("new charts
    // should open on the weekly", "by default", "always open") and alert sounds (plural) are settings
    words: [/\bsettings?\b/, /\b(dark|light) mode\b/, /\b(app|uct|site|light|dark) theme\b/, /\bdefault (chart )?time ?frames?\b/, /\b(alert )?sounds?\b/,
      /\bnew charts? (?:should|will|to|must|always) (?:open|start|load|default|be)\b|\bby default\b|\balways (?:open|start|load)\b|\bdefault for new charts?\b/, /\bdigest\b/, /\bemail\b/, /\b(open|go to|take me to)\b.*\b(page|screener|dashboard|breadth|research)\b/] },
  // W2 gaps-5: the earnings CALENDAR (calendar.day / calendar.nextReport) in its own small group — "what's on the calendar
  // this week", "who reports tomorrow" (it was ungrouped: never named by any message's words)
  { id: 'calendar', title: 'Earnings calendar: who reports on a day or this week, when one stock reports next', domains: ['calendar'], fillLast: true,
    words: [/\bcalendar\b/, /\bwho(?:'s| is)? report(?:s|ing)\b/, /\b(?:earnings|reports?) (?:this|next) week\b|\breporting (?:this|next) week\b/] },
  { id: 'agent', title: 'Questions about what UCT Agent can do', domains: ['agent'], always: true, words: [] },
  // hotfix 2026-11-03 (live: "Undo the last change you made to my charts." reached a model with no Undo): the Agent's OWN
  // Undo (agent.undo → the receipt's Undo, browser-only) in its OWN one-action group, named by any Undo word — so the
  // always-on group and every per-request budget keep their size; a model that still needs it asks (need_groups)
  // (review F1: ADD-ONLY — an Undo word never counts as recognising the message, so selection and the full-budget fill
  // are exactly master's; the group only rides along. The phrases name the Agent's own change, never "take me back to …",
  // "roll back my layout to yesterday" or "reverse the order of …")
  { id: 'undo', title: 'Undo your own last change(s) in this conversation (exactly the receipt’s Undo)', domains: [], fillLast: true, addOnly: true, ridesAlong: true,
    actions: ['agent.undo'],
    words: [/\b(?:undo|undoing|revert|reverting)\b/,
      /\b(?:reverse|roll ?back) (?:that|it|this|what (?:you|u)|the last|my last|your last|those changes|that change|everything)\b|\broll (?:it|that|this) back\b/,
      /\bput (?:it|that|them|everything|things) back (?:the way|how|as) (?:it|they) (?:was|were)\b/,
      // W2 (CG-9): "put my layout back", "put the charts back"
      /\bput (?:my|the) (?:layout|board|charts?|workspace|widgets) back\b/,
      // #1076: an undo is MATCHED by its own words whatever the pack size (v1's fallback fill can reach the budget and
      // cut the 1-action undo group): "scratch that", "never mind", "go back to how it was (before)", "put it back"
      /\bscratch (?:that|it|this)\b|\bnever ?mind\b|\bgo back to (?:how|the way|what) (?:it|they|things|everything) (?:was|were)\b|\bput (?:it|that|them) back\b/,
      /\btake (?:it|that|this|them|those|everything|all (?:of )?(?:that|it|this)) (?:all )?back\b|\btake back (?:that|what (?:you|u)|the last|my last|your last|those changes|that change|everything|whatever (?:you|u))\b/] },
  // watchlist group A (pl-exec): what ONE Watchlist widget shows — its own, UCT's prebuilt, community or Flagged lists, or back to
  // its picker. Its OWN one-action group by action name, WORDS-ONLY (never a filler: the lists group and every request keep their size)
  // AUDIT #1027 (NL-1 first-call coverage, corpus.json): the size rule above holds for EVERY action this PR adds. NL-1 sends
  // core 37 + lists 17 = 54 of its 55 (nl1/selection.js), so one more action in `lists` cost the requests that need lists beside
  // another 18-action group ("…put the top 10 in a new list": workspace won the tie). watchlist.arrangeColumns acts on ONE Watchlist
  // widget's own view (a list-view op, like showList), so it is in this group, not in lists. And "on my watchlist" is the ADD idiom
  // ("put tsla on my watchlist": watchlist.add), so "on" names the widget only with its position or the word widget; a list is
  // shown IN a watchlist.
  { id: 'watchlistShow', title: 'What one Watchlist widget shows (one of your lists, a UCT prebuilt or community list, Flagged, or its list picker); copy that list or download it as CSV / Excel; move a column or set its width in that widget',
    domains: [], actions: ['watchlist.showList', 'watchlist.exportList', 'watchlist.arrangeColumns'], fillLast: true, wordsOnly: true,
    words: [/\b(?:list\s+)?picker\b/, /\b(?:prebuilt|community|public|flagged|uct['’]s)\b.*\b(?:lists?|watch ?lists?|widget|tickers)\b|\b(?:lists?|watch ?lists?)\b.*\b(?:prebuilt|community|flagged)\b/,
      /\b(?:switch|change|put|show|open|load)\b.*\bwatch ?list(?:\s+widget)?\b.*\bto\b|\b(?:in|into)\s+(?:my|the|this)\s+(?:left |right |top |bottom |other )?watch ?list\b|\bon\s+(?:my|the|this)\s+(?:(?:left|right|top|bottom|other)\s+watch ?list\b|watch ?list\s+widget\b)/,
      // group C: a column moved (the header drag) or its width set (the gridline) — a column word beside a place or a width
      /\b(?:move|drag|reorder)\b.*\bcolumns?\b|\bcolumns?\b.*\b(?:to the (?:left|right)|before|after|ahead of)\b|\b(?:wider|narrower|widen|narrow|shrink|resize|width)\b.*\bcolumns?\b|\bcolumns?\b.*\b(?:wider|narrower|width|\d+\s*(?:px|pixels?))\b/,
      /\b(?:red|blue|green|yellow|orange|purple|pink)\s+(?:tags?|tag list)\b/,
      // group D: a list out of the widget (the list menu's Copy / Export)
      /\b(?:copy|export|download|save)\b.*\b(?:lists?|watch ?lists?|tickers)\b|\b(?:csv|excel|xlsx|clipboard)\b/] },
  // ⭐ PHASE 2 Workstream B: EXPLAIN a term or feature, SHOW ME where a control is — both change nothing
  { id: 'guide', title: 'Product guide: explain what a UCT term, indicator or feature is; show where a Charts control is (highlighted on the board, step by step) — changes nothing', domains: ['guide'],
    // (show-me words only: an explanation question is the model's to answer, as before — it may reroute to this group)
    words: [/\b(where (do|can|would|should) i|where(?:'s| is| are) the|show me (where|how)|how (do|can|would|should) i|walk me through|guide me|teach me|tutorial)\b/] },
  // ⭐ Wave 3 (W3-1..W3-4, UCT_AGENT_COACH, default off): the trading coach — registered only while the server serves
  // `coach`, so the group is empty (and never sent) on a dark server. Its own fillLast group: the NL-1 core keeps its size.
  { id: 'coach', title: 'Trading coach (educational, not advice): explain a trading concept — price action, support/resistance, consolidation, breakouts, relative strength, volume, moving averages, risk per trade and sizing, stops, market conditions and breadth, earnings gaps, drawdown, expectancy — with one grounded observation from the open chart; consent to use the member’s own journal in this chat; a descriptive review of their recent trades; propose a review note', domains: ['coach', 'journal'], fillLast: true,
    // review B1: EMPTY here — capabilities/coach.js arms COACH_ROUTE_WORDS only while the coach capabilities are
    // registered, so on a dark server routing is byte-identical to the base (a coach word never narrows the catalog)
    words: [] },
  // C1-028 (pl-zoom): VIEW GESTURES on one chart — the + / - zoom (chartSetup.zoom) — in their OWN group, WORDS-ONLY and fillLast
  // (as compareGroups / watchlistShow): master's unrecognised-request fill sits at exactly 55 actions, so a 19th chartSetup
  // action would push another group out. Last in the catalog, so every existing group keeps its place and its listing order.
  // Later view gestures (C1-026 price-axis compress, …) join this group. Only its own words select it: zoom + in / out
  // (optionally "the chart" between), "closer" / "tighter" on the chart's bars, a wider / zoomed-out view, more / fewer bars.
  // Not "reset the zoom" (chartSetup.resetView), not a "zoom" that names no direction (a company, a ticker).
  { id: 'chartView', title: 'Chart view gestures: zoom one chart\'s time axis in or out (the + / - keys), more or fewer bars on screen', domains: [], fillLast: true, wordsOnly: true,
    actions: ['chartSetup.zoom'],
    words: [
      /\bzoom(?:ed|ing)? (?:(?:the |this |that |my |it |its )?(?:\w+ )?(?:chart|view|time axis|axis|one|candles|bars) )?(?:way |all the way |back |a (?:bit|little|lot) |further |more )?(?:in|out)\b/,
      /\b(?:closer|tighter) (?:in |look |view )?(?:on|at) (?:the |this |that |my )?(?:\w+ )?(?:chart|candles|bars|price action)\b|\b(?:wider|broader|zoomed[- ]out) view (?:of|on) (?:the |this |that |my )?(?:\w+ )?(?:chart|candles|bars)\b/,
      /\b(?:show|see|fit|squeeze|cram) (?:me )?(?:more|fewer|less) (?:bars|candles)\b/] },
  // C3-205..207 (pl-exec6, #1082): Tools → Custom-Period Sort (periodSort.run / periodSort.dock) in its OWN two-action group,
  // WORDS-ONLY (as compareGroups / watchlistShow), so boardEdit and every other group stay character-identical to master:
  // in boardEdit (by domain) it changed v2's lexical scores and its fill, and 5 first calls lost the action they needed.
  // Words need context: the tool's name; a rank / sort said over DATES (a month-day, M/D or an ISO day after from / since /
  // between); a Dock of the ranking. LAST in the catalog: the server once named at most turn.MAX_GROUPS (24) groups; #1089
  // raised that cap to 48, so this group is named too. It stays last so it is the first left unnamed if the catalog outgrows the cap.
  { id: 'periodSort', title: 'Period Sort: rank stocks, themes, sectors or industries by their move between two dates; dock that ranking as a widget',
    domains: [], actions: ['periodSort.run', 'periodSort.dock'], fillLast: true, wordsOnly: true,
    words: [/\bperiod[\s-]?sort\b|\bcustom[\s-]period\b/,
      /\b(?:rank|ranking|sort)\b.*\b(?:from|since|between)\b.*(?:\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b)/,
      /\bdock\b.*\b(?:ranking|sort|sorted results)\b/] },
]

const SYMBOL_VERB = /\b(switch|change|put|show|pull up|load|open|chart)\b/
const NOT_TICKERS = new Set(['I', 'A', 'UCT', 'ETF', 'ADR', 'RS', 'RSI', 'MACD', 'EMA', 'SMA', 'ATR', 'ET', 'AM', 'PM', 'OK', 'US', 'NYSE', 'HLC'])
// W2 audit (live 2026-11-04): a POSSESSIVE ticker ("NVDA's recent pullbacks") is a ticker too
const tickerWords = (raw) => (String(raw).match(/(?:^|[\s$])([A-Z]{1,5})(?=['’]s\b|[\s,.!?]|$)/g) || [])
  .map(w => w.trim().replace('$', '')).filter(w => !NOT_TICKERS.has(w))

const BY_DOMAIN = new Map(GROUPS.flatMap(g => g.domains.map(d => [d, g.id])))
// a group may claim whole ACTION NAMES (W1-B drawingTools): checked before the name's domain
const BY_ACTION = new Map(GROUPS.flatMap(g => (g.actions || []).map(a => [a, g.id])))
// ⭐ Memoised per action name: BY_DOMAIN is a module constant, so a name's group never changes. Selection
// asks this per action per group per reroute (the eval's reroute table is ~100 selections per request), and
// the split allocated on every call (2026-10-28: 85% of agentNl1SelectionCoverage's time after PR #481).
// Bounded: names come from the registry and from model output, so the memo stops growing past GROUP_MEMO_MAX.
const GROUP_MEMO = new Map()
const GROUP_MEMO_MAX = 4096
export const groupOfAction = (name) => {
  const key = String(name || '')
  const hit = GROUP_MEMO.get(key)
  if (hit !== undefined) return hit
  const id = BY_ACTION.get(key) || BY_DOMAIN.get(key.split('.')[0]) || null
  if (GROUP_MEMO.size < GROUP_MEMO_MAX) GROUP_MEMO.set(key, id)
  return id
}

export function routingEnabled() {
  try { return globalThis.localStorage?.getItem('uct.agent.routing') !== '0' } catch { return true }
}

/**
 * The groups for this message. `pendingActions` / `recentActions` are action names of a waiting
 * proposal and of the last change, so follow-ups ("only the first two", "do the same on the
 * right") keep their groups. Returns { selected: [ids], matched: bool }.
 */
// ⭐ Gate B (0C): the member's OWN names route too — "open swing board", "put the first 3 in swing",
// "take smci off momentum": a layout / watchlist / saved screen named in the message (whole words,
// from live state the caller passes in) brings its group. Pure: nothing here reads state.
const NAME_GROUPS = { layouts: 'layouts', watchlists: 'lists', screens: 'screener', indicatorTemplates: 'chartSetup' }
// Execution family W (pl-exec): a widget ON THIS BOARD named by its registry label ("the theme tracker", "options flow") brings
// boardEdit, where its one-control action lives. `names.widgetTypes` = the board's types; widgetNames.js holds the names.
const SURFACE_GROUPS = ['charts', 'chartSetup', 'indicators', 'drawings']
// a ONE-word label that already means the chart ("Volume", "Themes" beside chart themes) is not a widget's name; a longer
// label ("Volume Surge", "Theme Tracker") is
const surfaceWord = (n) => !String(n).trim().includes(' ') && SURFACE_GROUPS.some(id => wordsSelect(id, n))
/** The widget types on the board that `message` names (by label), with controls a person sets. */
export const namedBoardWidgets = (message, types) => namedWidgetTypes(message, types || [], surfaceWord)
const normWords = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9$&+.\- ]+/g, ' ').replace(/\s+/g, ' ').trim()} `
function namedGroups(q, names) {
  const out = new Set()
  const text = normWords(q)
  for (const [kind, id] of Object.entries(NAME_GROUPS)) {
    for (const n of names?.[kind] || []) {
      const w = normWords(n).trim()
      if (w.length >= 3 && text.includes(` ${w} `)) { out.add(id); break }
    }
  }
  // #1082 re-merge: a docked Period Sort widget's controls (Refresh) never take a date, so "period sort sectors, Oct 1 to Oct 30"
  // (dates beside the tool's name) asks for a NEW run (the periodSort group), not that widget: it alone does not bring boardEdit
  const runsPeriodSort = /\bperiod[\s-]?sort\b|\bcustom[\s-]period\b/.test(q)
    && /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b/.test(q)
  if (names?.widgetTypes?.length && controlledWidgetTypes(q, names.widgetTypes, surfaceWord).some(t => !(runsPeriodSort && t === 'periodsort'))) out.add('boardEdit')
  if (names?.widgetItems?.length && itemNamedTypes(q, names.widgetItems).length) out.add('boardEdit')
  return out
}

/** The member's live names for routing, read from the host (never throws; a source that can't be read is empty). */
export function routingNames(host) {
  const read = (fn) => { try { return fn() || [] } catch { return [] } }
  return {
    layouts: read(() => host?.layouts?.snapshot?.()?.entries?.map(e => e.name)),
    watchlists: read(() => host?.watchlists?.snapshot?.()?.map(l => l.name)),
    screens: read(() => host?.savedScreens?.snapshot?.()?.map(s => s.name)),
    widgetTypes: read(() => host?.widgets?.types?.()),
    // the member's own items a widget lists (its door), for the types that have such a list: [{ type, key, names }]
    widgetItems: read(() => (host?.widgets?.ids?.() || []).filter(w => ITEM_LISTS[w.type]).flatMap(w => {
      let r = null
      try { r = host.widgets.door?.(w.id)?.read?.() || null } catch { r = null }
      return ITEM_LISTS[w.type].map(l => ({ type: w.type, key: l.key, names: (Array.isArray(r?.[l.key]) ? r[l.key] : []).map(x => x?.name).filter(Boolean) }))
    })),
    indicatorTemplates: read(() => {
      const raw = host?.prefs?.read?.()?.indicator_templates
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(list) ? list.map(t => t?.name).filter(Boolean) : []
    }),
  }
}

const INDICATOR_LOOK = /\b(red|green|blue|white|black|orange|yellow|purple|pink|teal|gr[ae]y|cyan|magenta|lime|gold|navy|maroon|colou?rs?|thick|thicker|thin|thinner|dashed|dotted|solid|bolder)\b/
/** Did the message's own words select this group (not the always-on, follow-up or fallback ones)? */
export function wordsSelect(id, message) {
  const q = String(message || '').toLowerCase().replace(/×/g, 'x')
  const g = GROUPS.find(x => x.id === id)
  return !!g && (g.words || []).some(re => re.test(q))
}
export function selectGroups(message, { pendingActions = [], recentActions = [], names = null, correct = null } = {}) {
  const raw = String(message || '')
  // W2 (CG-2): "2×2" typed with the multiplication sign reads as "2x2"
  const q = raw.toLowerCase().replace(/×/g, 'x')
  const always = GROUPS.filter(g => g.always).map(g => g.id)
  const hits = new Set()
  // ⭐ Gate B (0C): typo-corrected readings route too ("earnigns date for amd", "opne swng board") —
  // `correct` is the caller's lexicon correction (nl/lexicon.js). Routing only adds groups the model
  // may SEE; nothing here acts on a correction.
  let texts = [q]
  try { if (typeof correct === 'function') texts = [q, ...(correct(raw) || []).map(t => String(t).toLowerCase())] } catch { texts = [q] }
  for (const g of GROUPS) {
    if (g.always) continue
    if (texts.some(t => g.words.some(re => re.test(t)))) hits.add(g.id)
  }
  for (const t of texts) for (const id of namedGroups(t, names)) hits.add(id)
  // "put NVDA on the left", "Switch to AMD": a ticker-shaped word (case-sensitive, on the raw
  // text) after a show/switch verb is a chart symbol request.
  if (SYMBOL_VERB.test(q) && tickerWords(raw).length) hits.add('charts')
  // ⭐ acceptance 2026-10-29: "throw the 9 and 20 ema on … make the fast one green and the other one yellow" — a colour or
  // line look in a message about indicators is the indicators' look (indicatorSetup), however the indicator is named
  if (hits.has('indicators') && texts.some(t => INDICATOR_LOOK.test(t))) hits.add('indicatorSetup')
  const followUps = [...new Set([...pendingActions, ...recentActions].map(groupOfAction).filter(Boolean))]
  // KN-1: an add-only group (playbook) never counts as recognising the message on its own: a knowledge-only message
  // routes like an unrecognised one (full manifest when it fits), with its add-only groups first.
  const addOnlyHits = GROUPS.filter(g => g.addOnly && hits.has(g.id)).map(g => g.id)
  const matched = [...hits].some(id => !addOnlyHits.includes(id))
  // ⭐ Gate B (0C) SOFT VOCABULARY: when no group's own words matched, trading vocabulary ("semis",
  // "pulling back", "when does nvda report") moves its groups to the FRONT of the catalog order — it
  // never narrows the request: nothing recognised still means every group is a candidate (and the
  // full manifest when it fits). When a group's own words DID match, vocabulary adds nothing.
  const soft = matched ? [] : GROUPS.filter(g => !g.always && (g.vocab || []).some(re => texts.some(t => re.test(t)))).map(g => g.id)
  // PRIORITY order (Batch 6): always-on, then follow-ups, then the message's own groups (catalog
  // order). routeManifest packs them in this order under the per-request budget. When NOTHING was
  // recognised, every group is a candidate in catalog order (charts first — the page's own
  // controls), so a catalog bigger than one request still sends as much as fits, not just the
  // always-on group; the rest are named and the model can ask for them.
  // `wordsOnly` (Lead 2026-11-09): a NICHE group is sent only when the words name it — never as filler for a message nothing
  // recognised (or a knowledge-only one), so adding one never displaces what such a request packs
  const filler = GROUPS.filter(g => !g.wordsOnly || hits.has(g.id)).map(g => g.id)
  const own = matched ? GROUPS.map(g => g.id).filter(id => hits.has(id)) : [...addOnlyHits, ...soft, ...filler]
  const priority = [...new Set([...always, ...followUps, ...own])]
  return { selected: GROUPS.map(g => g.id).filter(id => priority.includes(id)), priority, matched, soft }
}

/**
 * ROUTE REACHABILITY guard: a group a request needed that the per-request budget could not carry is never cut SILENTLY —
 * one console line names the groups and their actions (names only, never the message). Nothing member-visible changes:
 * the cut groups stay named to the model (need_groups), as before. Pinned by qa/capabilityRegression/routeReachability.test.js.
 * Rate-limited: ONCE per distinct set of cut groups per page session (bounded), so a busy console is not flooded.
 */
const CUT_SEEN = new Set()
const CUT_SEEN_MAX = 256
export const _resetBudgetCutLog = () => CUT_SEEN.clear()
export function warnBudgetCut(manifest, groupOf, ids) {
  if (!ids || !ids.length) return
  const cut = ids.filter(id => manifest.some(c => groupOf(c.name) === id))
  if (!cut.length) return
  const key = [...cut].sort().join(',')
  if (CUT_SEEN.has(key) || CUT_SEEN.size >= CUT_SEEN_MAX) return
  CUT_SEEN.add(key)
  const names = manifest.filter(c => cut.includes(groupOf(c.name))).map(c => c.name)
  try { console.warn(`[uct-agent] routing budget cut: ${cut.join(', ')} not sent (${names.join(', ')})`) } catch { /* no console */ }
}

/**
 * Route a manifest. Returns { manifest, routing } — `routing` is what the server needs to tell
 * the model about the groups it was NOT given (null = the full manifest, no routing).
 * `extra` adds groups (the bounded reroute).
 */
export function routeManifest(manifest, message, opts = {}, extra = []) {
  const limit = opts.limit ?? Infinity                     // the server's per-request maximum
  const budget = Math.min(opts.budget ?? limit, limit)     // what one request may carry (routingThreshold)
  // Kill switch / nothing recognised → the FULL manifest — while it fits the per-request limit.
  // Past it, routing always applies: the always-on and follow-up groups, every other group NAMED,
  // so the model asks for what it needs (need_groups) instead of anything being cut.
  if (opts.enabled === false && manifest.length <= limit) return { manifest, routing: null }
  const { priority, matched, soft } = selectGroups(message, opts)
  // `opts.after` (review #771 delta H1): the groups an ANSWER to the model's question carries over — packed AFTER the
  // message's own groups (never displacing them), and before any fill
  const after = (opts.after || []).filter(id => GROUPS.some(g => g.id === id))
  if (!matched && !extra.length && !after.length && manifest.length <= limit) return { manifest, routing: null }
  // A reroute's requested groups come straight after the always-on ones.
  const always = GROUPS.filter(g => g.always).map(g => g.id)
  // one pass: each group's action count (null = ungrouped) — the packing and both sorts read it many times
  const counts = new Map()
  const groupOf = opts.groupOf || groupOfAction          // (NL-1 only: nl1/selection.js nl1GroupOf)
  for (const c of manifest) { const g = groupOf(c.name); counts.set(g, (counts.get(g) || 0) + 1) }
  const sizeOf = (id) => counts.get(id) || 0
  // The message's OWN groups are packed smallest-first (after the always-on, reroute and follow-up
  // groups, which keep their place): more of the distinct things a multi-part request names fit,
  // and if one must wait it is the biggest, most often incidental, group.
  // review F1: a `ridesAlong` add-only group its words named (agent.undo: one action) is packed right after the always-on
  // ones — it never changes what else is selected, and a full budget never cuts it
  const riders = GROUPS.filter(g => g.ridesAlong && wordsSelect(g.id, message)).map(g => g.id)
  const pinned = [...new Set([...always, ...riders, ...extra, ...(opts.pendingActions || []), ...(opts.recentActions || [])].map(x => (x.includes?.('.') ? groupOfAction(x) : x)).filter(Boolean))]
  const rest = priority.filter(id => !pinned.includes(id))
  // Nothing recognised: the soft-vocabulary groups first, then charts (the page's own controls), then
  // every other group SMALLEST first — the most groups that fit, so a message nothing named (a breadth
  // follow-up, a market question) is not one action short of its group. (Gate C: catalog order sent only
  // charts / workspace / layouts / indicators once the indicators group grew by one.)
  // (`fillLast`: a specialised group is never a filler — when nothing named it, it comes after every other group)
  const LAST = new Set(GROUPS.filter(g => g.fillLast).map(g => g.id))
  const bySize = (a, b) => sizeOf(a) - sizeOf(b)
  const fillOrder = (a, b) => (LAST.has(a) - LAST.has(b)) || bySize(a, b)
  const carried = after.filter(id => !pinned.includes(id))
  const own = matched ? [...new Set([...rest.filter(id => !carried.includes(id)).sort(bySize), ...carried])]
    : [...new Set([...carried, ...(soft || []).filter(id => rest.includes(id)), ...rest.filter(id => id === 'charts'), ...rest.filter(id => id !== 'charts').sort(fillOrder)])]
  const order = [...new Set([...pinned, ...own])]
  // PACK under the budget, in priority order. A group that would overflow is NOT sent — it is
  // named (unselected), so the model can ask for it; nothing is ever partially sent.
  const want = new Set()
  let used = counts.get(null) || 0
  const over = []
  for (const id of order) {
    const n = sizeOf(id)
    if (!n) continue
    if (used + n > budget && want.size >= always.length) { over.push(id); continue }
    want.add(id); used += n
  }
  // a group this message NEEDED (pinned, its own words, a carried answer, soft vocabulary) that the budget cut is logged —
  // the fallback's fill groups are not: past the catalog size they are expected not to fit
  const needed = new Set([...pinned, ...carried, ...(matched ? own : (soft || []))])
  warnBudgetCut(manifest, groupOf, over.filter(id => needed.has(id)))
  const present = GROUPS.filter(g => counts.has(g.id))
  const routed = manifest.filter(c => want.has(groupOf(c.name)) || groupOf(c.name) === null)
  if (routed.length === manifest.length) return { manifest, routing: null }
  return {
    manifest: routed,
    routing: {
      version: ROUTING_VERSION,
      groups: present.map(g => ({ id: g.id, title: g.title })),
      selected: present.filter(g => want.has(g.id)).map(g => g.id),
    },
    // groups the request needed but the budget could not carry (a reroute cannot add these either)
    overBudget: over,
    // ⭐ Gate C: the groups whose live data is worth RE-READING before this request (useAgent
    // refreshContext). Nothing recognised → only the pinned, soft-vocabulary and chart groups: the rest
    // fill the budget so the model can act without a reroute, from the context already loaded (every op
    // is re-validated against live state before it runs). Recognised → every selected group, as before.
    refresh: matched ? present.filter(g => want.has(g.id)).map(g => g.id)
      : [...new Set([...pinned, ...(soft || []), 'charts', 'boardEdit', 'calendar'])].filter(id => want.has(id)),   // these two: a section sent only with its group (widgetControls, the /charts calendar ref)
  }
}
