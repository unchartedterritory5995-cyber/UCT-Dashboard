// Notebook widgets Task 16D: the ONE module WidgetEmbedView's snapshot rows load (lazyLeaf's `pick`), keyed
// by widget id. A note that holds any snapshot widget fetches this chunk once; a kind added here costs the
// Notebook's first open a row in EMBED_COMPONENTS, never a chunk and its preload list.
export { default as myWatchlistToday } from './MyWatchlistTodayEmbed'
export { default as myNamesReporting } from './MyNamesReportingEmbed'
export { default as tickerCard } from './TickerCardEmbed'
export { default as myPnlStats } from './MyPnlStatsEmbed'
export { default as myPositionsRisk } from './MyPositionsRiskEmbed'
export { default as myRulesCheck } from './MyRulesCheckEmbed'
export { default as myMistakes } from './MyMistakesEmbed'
export { default as marketOnMyNames } from './MarketOnMyNamesEmbed'
export { default as tickerFlow } from './TickerFlowEmbed'
