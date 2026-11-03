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

export const ROUTING_VERSION = 1

/** Action groups, keyed by capability DOMAIN (the name prefix). Titles are shown to the model. */
export const GROUPS = [
  { id: 'charts', title: 'Chart symbol, timeframe, type, scale, session, theme, colours, display settings, volume', domains: ['chart', 'volume'],
    // Gate B vocabulary (soft): an overlay or a symbol swap said without "compare" / "chart"
    vocab: [/\b(next to (this|it)|on top of (this|it)|swap \$?[a-z]{1,5} (for|with)|instead of \$?[a-z]{1,5})\b/],
    words: [/\bcharts?\b/, /\b(timeframe|daily|weekly|monthly|hourly|intraday|\d+ ?(min|minute|hour|hr)s?|1h|4h)\b/, /\b(candles?|candlesticks?|hollow|bars|hlc|line chart|area chart|heikin)\b/,
      /\b(log|logarithmic|percent|linear) scale\b|\bscale\b/, /\b(extended|pre-?market|post-?market|regular hours|rth)\b/, /\b(theme|colou?rs?|background|grid|crosshair|legend|watermark|labels?|markers?|countdown|swing|thin bars|invert|template|defaults?|tabs?|compar(?:e|es|ing|isons?)|versus|against|overlays?|go to|scroll|as it looked|custom (time ?frame|interval))\b/,
      /\bvolume\b/,
      // P1: a symbol / setting put on a chart NAMED by position or order ("TSLA on the left", "on the second one")
      /\bon the (left|right|top|bottom|first|second|third|fourth|last|middle)\b/] },
  // Charts operator P1 (2026-10-27): the rest of a chart's own controls, in their OWN group so the NL-1 core
  // (charts + indicators + screener + agent ≤ 45) keeps its size — templates (save / delete), one chart's
  // look copied onto another, custom-timeframe removal and ★ favourites, comparison display.
  { id: 'chartSetup', title: 'Chart setup: save or delete chart templates, make one chart look like another, remove a custom timeframe, star a timeframe, comparison scale / Group only, Replay Mode (hide bars after a date / exit replay)', domains: ['chartSetup'], fillLast: true,
    // W1-B B-06: Replay Mode is a chart control too — here by action name, so the NL-1 core (charts group) keeps its size
    // W2-B3: chart.describeSetup here by action name too (a grounded setup description; the charts group keeps its size),
    // named by "describe / summarise / walk me through … setup"
    actions: ['chart.replay', 'chart.describeSetup'],
    words: [/\btemplates?\b/, /\blooks? (just )?like\b/, /\b(describe|summari[sz]e|walk me through)\b.*\bset-?ups?\b/,/\bsame (look|style|colou?rs|settings|setup) as\b/, /\bcopy (the |its |this |that )?(look|style|colou?rs|settings|setup)\b/,
      /\b(custom|favou?rite|starred?|star) (time ?frames?|intervals?)\b|\b(remove|delete|drop|un-?star|star)\b.*\b(time ?frames?|intervals?)\b/,
      /\b(same|new|own) (%|percent|price) scale\b|\bgroup only\b|\bhide (the )?base\b/] },
  // ⭐ live test 2026-10-28: N tickers as N equal charts (reuse, add, re-tile — one change, one Undo) — its OWN group
  // (one action), so neither the NL-1 core nor the workspace group grows: core + workspace is exactly the budget.
  { id: 'chartGrid', title: 'Several charts for named tickers at once: reuse the charts there, add the rest, re-tile them into equal cells', domains: ['chartGrid'], fillLast: true,
    words: [/\b(two|three|four|five|six|seven|eight|nine|[2-9]) (new |separate |more )?(\w+ )?charts? (for|of|with|showing|on)\b/, /\bcharts? (for|of|with|showing)\b/, /\b(as|into) (\w+ )?(\w+ )?charts\b/,
      /\b(grid|2 ?x ?2|2 by 2|side[\s-]by[\s-]side|next to each other|stacked|split (the )?screen)\b/] },
  // ⭐ PHASE 3: two widgets trading places, a chart duplicated into half its cell — their OWN small group (as chartGrid), so
  // neither the NL-1 core nor the workspace group grows past the per-request budget
  { id: 'boardEdit', title: 'Swap two widgets’ places; duplicate a chart (split its cell, the copy beside it); change ONE widget’s own option (a Theme Tracker period or sort, a Fundamentals view, a Breadth tile style, a News filter, an Options Flow lead / scope)', domains: ['board'], fillLast: true,
    // W1-B B-05: widget.setOption here by action name — the workspace group was exactly at the NL-1 reroute budget
    actions: ['widget.setOption'],
    words: [/\b(swap|switch places|trade places|exchange)\b/, /\b(duplicate|clone)\b/, /\b(a |another )?(copy|duplicate) of\b/, /\bmove\b.*\bto the (left|right|top|bottom)\b/, /\bother side\b/] },
  { id: 'workspace', title: 'Widgets on the board (add, remove, move, resize, arrange, link, widget tabs)', domains: ['widget'],
    words: [/\bwidgets?\b/, /\bworkspaces?\b/, /\bboard\b/, /\b(another|new|one more|second|extra) chart\b/, /\b(add|open|close|remove|delete)\b.*\bcharts?\b/, /\b(move|resize|arrange|rearrange|swap|wider|narrower|taller|shorter|bigger|smaller|fill|side by side|grid of|left|right|top|bottom)\b/,
      /\b(link|unlink|colou?r group)\b/, /\btabs?\b/] },
  // Split from 'workspace' (2026-10-09): a whole-group packer packs better with smaller groups, and
  // saved layouts are their own concept ("open my Swing layout", "save this").
  { id: 'layouts', title: 'Saved layouts (open, save, create, copy, rename, delete)', domains: ['layout'],
    // W1.1 R-03 (LT-9): "rename <X> to <Y>" names a layout as often as a tab or a list — the group rides along (routing only ADDS)
    words: [/\blayouts?\b/, /\bworkspaces?\b/, /\bsave\b.*\b(changes|this|it|layout|arrangement|board)\b/, /\brename\b(?!.*\b(?:watch ?lists?|lists?|tabs?|screens?|scans?|indicators?|drafts?|alerts?)\b).*\bto\b/] },
  // INDICATORS M1 (agreed with Indicators, AGENT-INTEGRATION-HANDOFF §11). A message matching an
  // indicators word AND a charts word routes BOTH; the hints decide.
  { id: 'indicators', title: 'Indicators on a chart (list, add, remove, show, hide; build, preview and save indicator drafts)', domains: ['indicator'],
    words: [/\bindicators?\b/, /\b(rsi|macd|ema|sma|vwap|atr|bollinger|keltner|stochastic|supertrend|regression|correlation|momentum|oscillator|histogram)\b/,
      // ⭐ acceptance 2026-10-29: "each with a 50sma", "9ema" — a length typed against its type
      /\b\d{1,4}-?(?:ema|sma|wma|hma|ma)s?\b/,
      // "what's on this chart", "do i have the 50 on here", "a weekly 10 line": the chart's indicators
      /\bwhat'?s on (this|the|my) chart\b|\b(have|got) the \d+ on\b|\b\d+ (line|ma|average)\b/,
      // Gate C: moving averages by name or by LENGTH ("add a 200 day moving average", "add the 9 and 20",
      // "put the 50 on it", "make it a 9" after an add) and the short names traders type ("bollies", "bb")
      /\bmoving averages?\b|\b(mas?|bbands?|bb|bollies|boll)\b|\b\d{1,3}[- ]?(?:day|week|period)\b/,
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
      /\b(make|turn|colou?r|paint)\b.*\bthe \d{1,3}\b.*\b(red|green|blue|white|black|orange|yellow|purple|pink|teal|gr[ae]y)\b/] },
  { id: 'definitions', title: 'Indicator definitions: search UCT\'s and your own indicators, describe one, save a copy, delete one of yours', domains: ['definition'], fillLast: true,
    words: [/\b(my|saved|custom|own) indicators?\b/, /\bindicators? (for|that|which|to)\b/, /\b(find|search|look for|what) .*\bindicators?\b/, /\b(describe|explain|what does)\b.*\b(indicator|rsi|macd|atr|study)\b/, /\b(delete|remove|copy|duplicate)\b.*\b(my|saved|custom)\b(?:\s+[a-z0-9-]+){0,3}\s+(indicator|formula|study)\b/] },
  // ⭐ W1-B (2026-11-02): the TIME-ANCHORED tools in their OWN small group (as chartSetup is), so the drawings group keeps
  // its size and every group still fits a reroute beside the NL-1 core. Membership is by ACTION NAME (`actions`), not by
  // domain: the tools stay `drawing.*` on the drawing kind. Listed BEFORE drawings so "draw a trendline from…" takes this.
  { id: 'drawingTools', title: 'Time-anchored drawings from dates and prices: trendline, ray, horizontal ray, rectangle, Fibonacci retracement, text note, anchored VWAP', domains: [], fillLast: true,
    actions: ['drawing.addTrendline', 'drawing.addRay', 'drawing.addHorizontalRay', 'drawing.addRectangle', 'drawing.addFib', 'drawing.addText', 'drawing.addAvwap'],
    words: [/\b(draw|add|put|place|plot|anchor|drop|mark)\b.*\b(trend ?lines?|rays?|fib\w*|retracements?|rectangles?|boxe?s?|notes?|text|anchored vwap|avwap)\b/,
      /\b(trend ?lines?|rays?|fib\w*|retracements?|rectangles?|anchored vwap|avwap)\b.*\b(from|between|starting|anchored|since)\b/, /\banchored vwap\b|\bavwap\b/] },
  { id: 'drawings', title: 'Chart drawings: horizontal price levels (draw, move to a price), restyle, show/hide, lock, remove one, clear all, list', domains: ['drawing'],
    words: [/\bdraw\w*\b/, /\b(a |the )?line at \$?\d/, /\b(horizontal (line|level)s?|levels?|price lines?|rays?|trend ?lines?|fib\w*|rectangles?|annotat\w+|support|resistance)\b/] },
  { id: 'lists', title: 'Watchlists (show, create, rename, add, remove, clear, delete, sort / reorder, notes)', domains: ['watchlist'],
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
      /\b(stocks|names|tickers|equities) (are |were |that are |that were )?(up|down|gained|lost|gaining|losing|rose|fell|rising|falling|green|red)\b/],
    // ⭐ Gate B (0C): TRADING VOCABULARY that names a SCREEN without the word "screen" (soft, see
    // selectGroups). Routing only: it changes which actions the model SEES first, never what a word
    // means (meanings are Phase 1B) and never drops a group that would otherwise have been sent.
    vocab: [/\b(semis|semiconductors?|semi conductors?|chips?|chip stocks|biotechs?|software (stocks|names)|banks|miners|small[- ]?caps?|mid[- ]?caps?|large[- ]?caps?|mega[- ]?caps?|ipos?|etfs)\b/,
      /\b(gainers?|losers?|movers?|gap(ped|ping|s)? (up|down)|new highs?|near (the )?highs?|all[- ]time highs?|pull(ing|s)?[- ]?backs?|pulling back|tagging|tight (bases?|flags?|ranges?)|bases?|flags?|breakouts?|unusual volume|big volume|leaders?|leading groups?|laggards?|acting well|working)\b/,
      /\b(over|under|above|below) \$?\d+ (bucks|dollars)\b|\b\d+ (million|mil|m|billion|bn?) (a day|dollar volume)\b|\bliquid (names|stocks)\b/,
      /\b(sort (it|them|that|by)|only the ones|same thing but|just (the )?(large|small|mid)[- ]?caps)\b/] },
  { id: 'alerts', title: 'Price alerts (list, create, delete)', domains: ['alert'],
    words: [/\balerts?\b/, /\b(notify|ping|tell) me\b/, /\b(crosses|breaks|hits)\b/] },
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
    words: [/\b(news|headlines?|catalysts?|earnings|profile|fundamentals?|compare|versus|vs\.?|sector|industry|market cap|float|why is|what does .+ do|what'?s driving|what is driving|off (its|the) (52[\s-]?week )?highs?)\b/,
      /\b(how (has|did|does) \S+ (behaved?|do|done|perform(ed)?|react(ed)?|trade[d]?) after|what (happens|happened) (to|with) \S+ after|after .*\b(gaps?|gapped|cross(es|ed)?)\b)\b/],
    // Gate B vocabulary (soft): "when does nvda report", "anything new on tesla", "stack up on valuation"
    vocab: [/\b(reports?|reporting|valuation|stacks? up|anything new (on|with)|what'?s (going on|happening) with|why did .+ (gap|move|drop|fall|jump|rally|sell off))\b/] },
  // MARKET INTELLIGENCE breadth slice 1 (2026-10-11): historical breadth QUESTIONS. "breadth" alone is
  // a question — except a request to GO TO the breadth page / monitor, which stays navigation
  // (settings group). The lookahead is anchored at the start of the message (no lookbehind).
  { id: 'breadth', title: 'Market breadth now and history (US, NYSE, Nasdaq: % of stocks above moving averages, new highs/lows, advance/decline, Stage 2/4)', domains: ['breadth'],
    words: [/^(?!.*\b(open|go to|take me to|navigate to|bring up|pull up|switch to)\b.*\bbreadth\b.*\b(page|monitor|dashboard|tab|screen)\b).*\bbreadth\b/,
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
    words: [/\bsettings?\b/, /\b(dark|light) mode\b/, /\bapp theme\b/, /\bdefault (chart )?timeframe\b/, /\b(alert )?sound\b/, /\bdigest\b/, /\bemail\b/, /\b(open|go to|take me to)\b.*\b(page|screener|dashboard|breadth|research)\b/] },
  { id: 'agent', title: 'Questions about what UCT Agent can do', domains: ['agent'], always: true, words: [] },
  // ⭐ PHASE 2 Workstream B: EXPLAIN a term or feature, SHOW ME where a control is — both change nothing
  { id: 'guide', title: 'Product guide: explain what a UCT term, indicator or feature is; show where a Charts control is (highlighted on the board, step by step) — changes nothing', domains: ['guide'],
    // (show-me words only: an explanation question is the model's to answer, as before — it may reroute to this group)
    words: [/\b(where (do|can|would|should) i|where(?:'s| is| are) the|show me (where|how)|how (do|can|would|should) i|walk me through|guide me|teach me|tutorial)\b/] },
]

const SYMBOL_VERB = /\b(switch|change|put|show|pull up|load|open|chart)\b/
const NOT_TICKERS = new Set(['I', 'A', 'UCT', 'ETF', 'ADR', 'RS', 'RSI', 'MACD', 'EMA', 'SMA', 'ATR', 'ET', 'AM', 'PM', 'OK', 'US', 'NYSE', 'HLC'])
const tickerWords = (raw) => (String(raw).match(/(?:^|[\s$])([A-Z]{1,5})(?=[\s,.!?]|$)/g) || [])
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
const NAME_GROUPS = { layouts: 'layouts', watchlists: 'lists', screens: 'screener' }
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
  return out
}

/** The member's live names for routing, read from the host (never throws; a source that can't be read is empty). */
export function routingNames(host) {
  const read = (fn) => { try { return fn() || [] } catch { return [] } }
  return {
    layouts: read(() => host?.layouts?.snapshot?.()?.entries?.map(e => e.name)),
    watchlists: read(() => host?.watchlists?.snapshot?.()?.map(l => l.name)),
    screens: read(() => host?.savedScreens?.snapshot?.()?.map(s => s.name)),
  }
}

const INDICATOR_LOOK = /\b(red|green|blue|white|black|orange|yellow|purple|pink|teal|gr[ae]y|cyan|magenta|lime|gold|navy|maroon|colou?rs?|thick|thicker|thin|thinner|dashed|dotted|solid|bolder)\b/
/** Did the message's own words select this group (not the always-on, follow-up or fallback ones)? */
export function wordsSelect(id, message) {
  const q = String(message || '').toLowerCase()
  const g = GROUPS.find(x => x.id === id)
  return !!g && (g.words || []).some(re => re.test(q))
}
export function selectGroups(message, { pendingActions = [], recentActions = [], names = null, correct = null } = {}) {
  const raw = String(message || '')
  const q = raw.toLowerCase()
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
  const own = matched ? GROUPS.map(g => g.id).filter(id => hits.has(id)) : [...addOnlyHits, ...soft, ...GROUPS.map(g => g.id)]
  const priority = [...new Set([...always, ...followUps, ...own])]
  return { selected: GROUPS.map(g => g.id).filter(id => priority.includes(id)), priority, matched, soft }
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
  if (!matched && !extra.length && manifest.length <= limit) return { manifest, routing: null }
  // A reroute's requested groups come straight after the always-on ones.
  const always = GROUPS.filter(g => g.always).map(g => g.id)
  // one pass: each group's action count (null = ungrouped) — the packing and both sorts read it many times
  const counts = new Map()
  for (const c of manifest) { const g = groupOfAction(c.name); counts.set(g, (counts.get(g) || 0) + 1) }
  const sizeOf = (id) => counts.get(id) || 0
  // The message's OWN groups are packed smallest-first (after the always-on, reroute and follow-up
  // groups, which keep their place): more of the distinct things a multi-part request names fit,
  // and if one must wait it is the biggest, most often incidental, group.
  const pinned = [...new Set([...always, ...extra, ...(opts.pendingActions || []), ...(opts.recentActions || [])].map(x => (x.includes?.('.') ? groupOfAction(x) : x)).filter(Boolean))]
  const rest = priority.filter(id => !pinned.includes(id))
  // Nothing recognised: the soft-vocabulary groups first, then charts (the page's own controls), then
  // every other group SMALLEST first — the most groups that fit, so a message nothing named (a breadth
  // follow-up, a market question) is not one action short of its group. (Gate C: catalog order sent only
  // charts / workspace / layouts / indicators once the indicators group grew by one.)
  // (`fillLast`: a specialised group is never a filler — when nothing named it, it comes after every other group)
  const LAST = new Set(GROUPS.filter(g => g.fillLast).map(g => g.id))
  const bySize = (a, b) => sizeOf(a) - sizeOf(b)
  const fillOrder = (a, b) => (LAST.has(a) - LAST.has(b)) || bySize(a, b)
  const own = matched ? [...rest].sort(bySize)
    : [...new Set([...(soft || []).filter(id => rest.includes(id)), ...rest.filter(id => id === 'charts'), ...rest.filter(id => id !== 'charts').sort(fillOrder)])]
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
  const present = GROUPS.filter(g => counts.has(g.id))
  const routed = manifest.filter(c => want.has(groupOfAction(c.name)) || groupOfAction(c.name) === null)
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
      : [...new Set([...pinned, ...(soft || []), 'charts'])].filter(id => want.has(id)),
  }
}
