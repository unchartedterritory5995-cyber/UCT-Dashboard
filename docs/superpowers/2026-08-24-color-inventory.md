# Phase-0 color inventory — text `color:` declarations

Scope: `app/src/**/*.css` excluding OptionsFlow/DarkPool/LiveFlow, intro, tokens.css. Read-only.

- **1003** raw (non-token) text `color:` declarations across **337** CSS files
- **5330** already use `color: var(--…)`
- **243** distinct raw color values

The grey/white values below are the Phase-1 worklist. Each maps to a target token by luminance/opacity; accent colors are listed separately and are NOT grey-scope (they get their own semantic tokens later).

## → `--text-muted` (currently `#8c8674`) — 27 distinct values, 101 uses

| value | uses | files |
|---|---|---|
| `rgba(255, 255, 255, 0.4)` | 18 | components\voice\AgentPicker.module.css, components\voice\VisionAttachButton.module.css, components\voice\VoiceDocumentsPanel.module.css +3 |
| `rgba(255, 255, 255, 0.5)` | 13 | components\voice\AgentPicker.module.css, components\voice\VisionAttachButton.module.css, components\voice\VoiceDocumentsPanel.module.css +3 |
| `#706b5e` | 10 | components\chart\ChartToolbar.module.css, components\chart\PositionPanel.module.css, pages\charts\ChartsWorkspace.module.css +2 |
| `#6b7480` | 9 | pages\MorningWire.module.css |
| `#8c8675` | 7 | components\chart\PatternSidePanel.module.css |
| `#7f8ea3` | 7 | pages\MorningWire.module.css |
| `#8a8a8a` | 6 | pages\journal-2-0\TrackRecordPage.module.css |
| `#8b96a3` | 5 | pages\MorningWire.module.css |
| `#6a6656` | 3 | pages\ComingSoon.module.css |
| `#3f4a57` | 2 | components\StockChart.module.css |
| `#55606e` | 2 | components\StockChart.module.css, pages\charts\widgets\FundamentalsWidget.module.css |
| `#47525f` | 2 | components\StockChart.module.css |
| `rgba(255,255,255,0.3)` | 2 | components\TickerActions.module.css, pages\Breadth.module.css |
| `rgba(255, 255, 255, 0.3)` | 2 | components\voice\VoiceTelemetryPanel.module.css |
| `rgba(255, 255, 255, 0.25)` | 1 | components\chart\ChartToolbar.module.css |
| `#808080` | 1 | components\chart\ColorPanel.module.css |
| `rgba(255,255,255,0.35)` | 1 | components\TickerActions.module.css |
| `rgba(255,255,255,0.5)` | 1 | components\TickerActions.module.css |
| `#7f8c8d` | 1 | components\tiles\NewsFeed.module.css |
| `#555e6b` | 1 | components\tiles\NewsFeed.module.css |
| `#64748b` | 1 | pages\breadth\views\signals.module.css |
| `#5f5b50` | 1 | pages\charts\ChartsWorkspace.module.css |
| `#45515f` | 1 | pages\charts\ChartsWorkspace.module.css |
| `#566577` | 1 | pages\charts\ChartsWorkspace.module.css |
| `#5a6674` | 1 | pages\charts\widgets\WatchlistPicker.module.css |
| `#8a94a2` | 1 | pages\charts\widgets\WatchlistPicker.module.css |
| `rgba(255, 255, 255, 0.22)` | 1 | pages\ThemeTrackerPage.module.css |

## → `--text` (currently `#b6b09d`) — 10 distinct values, 51 uses

| value | uses | files |
|---|---|---|
| `#a8a290` | 19 | components\chart\ChartToolbar.module.css, components\chart\ColorPicker.module.css, components\chart\PatternSidePanel.module.css +5 |
| `#9aa7b4` | 10 | pages\MorningWire.module.css |
| `rgba(255, 255, 255, 0.6)` | 8 | components\voice\AgentPicker.module.css, components\voice\VisionAttachButton.module.css, components\voice\VoiceDocumentsPanel.module.css +2 |
| `rgba(255, 255, 255, 0.7)` | 6 | components\voice\VisionAttachButton.module.css, components\voice\VoiceDocumentsPanel.module.css, components\voice\VoiceInsightsPanel.module.css +1 |
| `#c0bcb0` | 2 | components\chart\PatternSidePanel.module.css |
| `#b8b4a8` | 2 | components\voice\AudioPlayerBar.module.css |
| `#c8c4b0` | 1 | components\chart\PositionPanel.module.css |
| `#9ca3af` | 1 | components\tiles\CatalystTable.module.css |
| `rgba(255, 255, 255, 0.8)` | 1 | components\voice\VoiceDocumentsPanel.module.css |
| `#94a3b8` | 1 | pages\breadth\BreadthViewSwitcher.module.css |

## → `--text-bright` (currently `#e0dac8`) — 41 distinct values, 76 uses

| value | uses | files |
|---|---|---|
| `#e2dfd6` | 10 | components\chart\ChartToolbar.module.css, components\chart\ColorPicker.module.css, components\chart\PatternSidePanel.module.css |
| `#d6d0c2` | 4 | pages\patterns\PatternFilter.module.css, pages\Patterns.module.css |
| `#d4cfc0` | 3 | components\StockChart.module.css |
| `#cbd5e1` | 3 | components\tiles\CatalystTable.module.css, pages\CatalystsHistory.module.css, pages\FlowScoreboard.module.css |
| `rgba(220, 218, 212, 0.7)` | 3 | pages\modelbook\BottomsView.module.css, pages\modelbook\shared\ChartExampleKit.module.css |
| `rgba(214, 213, 207, 0.8)` | 3 | pages\modelbook\builder\BuilderView.module.css, pages\ModelBook.module.css |
| `rgba(220, 218, 212, 0.72)` | 3 | pages\modelbook\builder\BuilderView.module.css, pages\ModelBook.module.css |
| `#cfcfcf` | 3 | pages\MorningWire.module.css |
| `#d8d2c2` | 2 | components\video\GlobalVideoLayer.module.css, pages\patterns\PatternFilter.module.css |
| `#cfe6d8` | 2 | components\video\VideoDockSlot.module.css, pages\journal-2-0\components\notebook\NoteVideoRails.module.css |
| `rgba(255, 255, 255, 0.85)` | 2 | components\voice\VisionAttachButton.module.css, pages\Breadth.module.css |
| `#e0e0e0` | 2 | pages\Breadth.module.css |
| `#e0dac8` | 2 | pages\charts\ChartsWorkspace.module.css, pages\CotData.module.css |
| `rgba(220, 218, 212, 0.4)` | 2 | pages\modelbook\BottomsView.module.css |
| `rgba(220, 218, 212, 0.55)` | 2 | pages\modelbook\BottomsView.module.css |
| `rgba(214, 213, 207, 0.65)` | 2 | pages\modelbook\BottomsView.module.css, pages\modelbook\shared\ChartExampleKit.module.css |
| `rgba(220, 218, 212, 0.85)` | 2 | pages\modelbook\builder\BuilderView.module.css |
| `rgba(214, 213, 207, 0.75)` | 2 | pages\modelbook\builder\BuilderView.module.css, pages\modelbook\shared\ChartExampleKit.module.css |
| `#d6d6d6` | 2 | pages\MorningWire.module.css |
| `#cfcabb` | 1 | components\chart\ColorPanel.module.css |
| `#dcdcdc` | 1 | components\chart\ColorPanel.module.css |
| `#d4d4d4` | 1 | components\chart\ColorPanel.module.css |
| `#d0ccc0` | 1 | components\chart\PatternSidePanel.module.css |
| `#cfd6e0` | 1 | components\CompanyLogo.module.css |
| `#d8d2c0` | 1 | components\video\GlobalVideoLayer.module.css |
| `rgba(224, 218, 200, 0.05)` | 1 | pages\CotData.module.css |
| `rgba(224, 218, 200, 0.055)` | 1 | pages\CotData.module.css |
| `rgba(220, 219, 213, 0.78)` | 1 | pages\modelbook\BottomsView.module.css |
| `rgba(214, 213, 207, 0.74)` | 1 | pages\modelbook\BottomsView.module.css |
| `rgba(222, 221, 215, 0.8)` | 1 | pages\modelbook\BottomsView.module.css |
| `rgba(214, 213, 207, 0.78)` | 1 | pages\modelbook\BottomsView.module.css |
| `rgba(220, 218, 212, 0.75)` | 1 | pages\modelbook\BottomsView.module.css |
| `rgba(220, 218, 212, 0.6)` | 1 | pages\modelbook\BottomsView.module.css |
| `rgba(220, 218, 212, 0.45)` | 1 | pages\modelbook\BottomsView.module.css |
| `rgba(216, 215, 209, 0.78)` | 1 | pages\modelbook\BottomsView.module.css |
| `rgba(220, 218, 212, 0.5)` | 1 | pages\modelbook\BottomsView.module.css |
| `rgba(218, 217, 211, 0.8)` | 1 | pages\modelbook\BottomsView.module.css |
| `rgba(214, 213, 207, 0.72)` | 1 | pages\modelbook\builder\BuilderView.module.css |
| `rgba(220, 218, 212, 0.8)` | 1 | pages\modelbook\builder\BuilderView.module.css |
| `rgba(214, 213, 207, 0.6)` | 1 | pages\modelbook\shared\ChartExampleKit.module.css |
| … | | +1 more values |

## → `--text-heading` (currently `#f0ead8`) — 19 distinct values, 54 uses

| value | uses | files |
|---|---|---|
| `#f3efe2` | 6 | components\video\GlobalVideoLayer.module.css, components\video\VideoDockSlot.module.css, pages\journal-2-0\components\notebook\NoteVideoRails.module.css |
| `#e8e4d0` | 5 | components\chart\PositionPanel.module.css |
| `rgba(232, 230, 224, 0.85)` | 5 | pages\modelbook\BottomsView.module.css, pages\modelbook\builder\BuilderView.module.css, pages\modelbook\shared\ChartExampleKit.module.css |
| `#e8e8e8` | 5 | pages\MorningWire.module.css |
| `#e8e3d4` | 5 | pages\patterns\PatternFilter.module.css, pages\patterns\PatternResultCard.module.css |
| `#e8e6df` | 4 | components\voice\AudioPlayerBar.module.css, components\voice\TranscriptBubble.module.css, components\voice\VoiceMemoryPanel.module.css |
| `#f3f3f3` | 4 | pages\MorningWire.module.css |
| `#f4f1e8` | 3 | components\chart\PatternSidePanel.module.css |
| `#e2e8f0` | 3 | pages\breadth\BreadthViewSwitcher.module.css, pages\breadth\views\signals.module.css, pages\Breadth.module.css |
| `rgba(232, 230, 224, 0.82)` | 3 | pages\modelbook\BottomsView.module.css, pages\modelbook\builder\BuilderView.module.css, pages\ModelBook.module.css |
| `#e5e5e5` | 2 | components\chart\ChartToolbar.module.css |
| `#f0ead8` | 2 | pages\CotData.module.css |
| `#e8eaed` | 1 | pages\journal-2-0\components\notebook\FolderSidebar.module.css |
| `#e8e6e1` | 1 | pages\journal-2-0\TrackRecordPage.module.css |
| `rgba(242, 233, 216, 0.75)` | 1 | pages\Landing.module.css |
| `rgba(232, 230, 224, 0.92)` | 1 | pages\modelbook\BottomsView.module.css |
| `rgba(232, 230, 224, 0.7)` | 1 | pages\modelbook\shared\ChartExampleKit.module.css |
| `rgba(232, 230, 224, 0.8)` | 1 | pages\modelbook\shared\ChartExampleKit.module.css |
| `#c8f4d8` | 1 | pages\research\ResearchPage.module.css |

## → `INK-ON-LIGHT (dark text on bright/accent bg — NOT grey-scope)` — 36 distinct values, 118 uses

| value | uses | files |
|---|---|---|
| `#0e0f0d` | 14 | components\chart\PatternSidePanel.module.css, components\dashboard\DeskVideoRail.module.css, components\TickerActions.module.css +7 |
| `#1a1a1a` | 14 | components\voice\FloatingOrb.module.css, pages\journal-2-0\components\BrokerConnectionsCard.module.css, pages\journal-2-0\components\connectors\ConnectConsentPanel.module.css +4 |
| `#241b07` | 12 | pages\BrokersPage.module.css, pages\Compare.module.css, pages\Landing.module.css +1 |
| `#0d0d10` | 11 | pages\modelbook\BottomsView.module.css, pages\modelbook\builder\BuilderView.module.css, pages\modelbook\SetupsView.module.css +1 |
| `#1a1408` | 10 | pages\calendar\Calendar.module.css, pages\charts\CompareSymbolsPanel.module.css |
| `#14150f` | 9 | components\community\ShareToFloor.module.css, pages\ComingSoon.module.css, pages\community\Community.module.css |
| `#1c2836` | 4 | components\StockChart.module.css, pages\charts\widgets\WatchlistPicker.module.css |
| `#151310` | 4 | pages\journal-2-0\components\position\PositionDetailPage.module.css, pages\journal-2-0\components\trade\TradeDetailPage.module.css, pages\journal-2-0\tabs\OpenPositionsTab.module.css |
| `#0c0c0c` | 3 | components\JournalBacklinks.module.css, pages\journal-2-0\components\notebook\WidgetEmbedView.module.css |
| `#12202c` | 3 | components\StockChart.module.css, pages\charts\ChartsWorkspace.module.css |
| `#1a1c17` | 3 | pages\Admin.module.css, pages\research\ResearchPage.module.css |
| `#243040` | 3 | pages\charts\widgets\WatchlistPicker.module.css |
| `#0b1f12` | 2 | pages\calendar\Calendar.module.css |
| `#161616` | 2 | pages\calendar\Calendar.module.css |
| `#17150c` | 2 | pages\desk\PathView.module.css, pages\desk\VideosSection.module.css |
| `#14171c` | 2 | pages\journal-2-0\components\notebook\import\ImportWizard.module.css, pages\journal-2-0\tabs\NotebookTab.module.css |
| `#12131a` | 1 | components\calendar\PlayableTranscript.module.css |
| `#14120c` | 1 | components\calendar\TranscriptSearch.module.css |
| `#33404f` | 1 | components\StockChart.module.css |
| `#16212e` | 1 | components\StockChart.module.css |
| `#0a0e12` | 1 | components\TickerPopup.module.css |
| `#14140f` | 1 | components\tiles\CatalystTable.module.css |
| `#1a1306` | 1 | components\tiles\JournalSnapshotTile.module.css |
| `#051408` | 1 | pages\calendar\Calendar.module.css |
| `#223243` | 1 | pages\charts\ChartsWorkspace.module.css |
| `#0b0f14` | 1 | pages\charts\ChartsWorkspace.module.css |
| `#14100a` | 1 | pages\charts\widgets\WatchlistPicker.module.css |
| `#2a0a0a` | 1 | pages\Compare.module.css |
| `#100d06` | 1 | pages\desk\ArticleReader.module.css |
| `#16181d` | 1 | pages\desk\ArticleReader.module.css |
| `#3a3d45` | 1 | pages\desk\ArticleReader.module.css |
| `#04140a` | 1 | pages\journal-2-0\components\HoldingsList.module.css |
| `#16130a` | 1 | pages\journal-2-0\JournalLayout.module.css |
| `#0a0a0a` | 1 | pages\MorningWire.module.css |
| `#14110a` | 1 | pages\MorningWire.module.css |
| `#12100b` | 1 | pages\screener\SharedScreen.module.css |

## → `ACCENT/OTHER (not grey-scope)` — 110 distinct values, 603 uses

| value | uses | files |
|---|---|---|
| `#c9a84c` | 159 | components\calendar\CallRecapSection.module.css, components\chart\ChartToolbar.module.css, components\chart\ColorPicker.module.css +54 |
| `#fff` | 46 | components\AlertBell.module.css, components\chart\ColorPanel.module.css, components\StockChart.module.css +27 |
| `#f87171` | 43 | components\chart\ChartToolbar.module.css, components\chart\PatternSidePanel.module.css, components\chart\PositionPanel.module.css +20 |
| `#4ade80` | 36 | components\chart\PatternSidePanel.module.css, components\chart\PositionPanel.module.css, components\tiles\CatalystTable.module.css +15 |
| `#f0d479` | 34 | pages\modelbook\BottomsView.module.css, pages\modelbook\builder\BuilderView.module.css, pages\modelbook\shared\ChartExampleKit.module.css +1 |
| `#ef4444` | 19 | components\chart\ChartToolbar.module.css, components\video\VideoDockSlot.module.css, components\voice\VisionAttachButton.module.css +13 |
| `#fbbf24` | 18 | components\tiles\CatalystTable.module.css, components\tiles\CompassTodayTile.module.css, components\voice\VoiceInsightsPanel.module.css +8 |
| `#d4b45c` | 18 | components\tiles\CatalystTable.module.css, pages\MorningWire.module.css |
| `#000` | 17 | components\chart\ChartToolbar.module.css, components\chart\ComparisonPicker.module.css, components\chart\IndicatorAlertPopover.module.css +10 |
| `#fca5a5` | 14 | components\voice\VoiceDocumentsPanel.module.css, components\voice\VoiceInsightsPanel.module.css, components\voice\VoiceSessionsPanel.module.css +5 |
| `#1ae51a` | 9 | pages\modelbook\SetupsView.module.css, pages\modelbook\shared\ChartExampleKit.module.css, pages\ModelBook.module.css |
| `#3fb950` | 9 | pages\MorningWire.module.css |
| `#60a5fa` | 8 | components\chart\ChartToolbar.module.css, components\tiles\CatalystTable.module.css, pages\Admin.module.css +2 |
| `#e5534b` | 8 | pages\MorningWire.module.css |
| `#e74c3c` | 7 | components\tiles\NewsFeed.module.css, pages\journal-2-0\components\broker\BrokerEquityCurve.module.css, pages\journal-2-0\components\insights\InsightsHub.module.css +3 |
| `#e6cf86` | 7 | components\video\GlobalVideoLayer.module.css, components\video\VideoDockSlot.module.css, pages\journal-2-0\components\notebook\NoteVideoRails.module.css |
| `#86efac` | 7 | components\voice\VoiceDocumentsPanel.module.css, components\voice\VoiceInsightsPanel.module.css, components\voice\VoiceSessionsPanel.module.css +1 |
| `#e0a11a` | 7 | pages\journal-2-0\components\connectors\ConnectedAppsCard.module.css, pages\journal-2-0\components\connectors\ConnectTilesCompact.module.css, pages\journal-2-0\components\connectors\ConnectTokenModal.module.css +2 |
| `#f08484` | 6 | pages\modelbook\BottomsView.module.css, pages\modelbook\SetupsView.module.css |
| `#22c55e` | 5 | components\chart\IndicatorAlertPopover.module.css, pages\journal-2-0\components\analytics\TaxCenterSection.module.css, pages\journal-2-0\components\trade\TradeReplay.module.css +1 |
| `#3cb868` | 5 | components\FundamentalSnapshot.module.css, pages\Admin.module.css, pages\journal-2-0\components\broker\BrokerEquityCurve.module.css +2 |
| `#ff6b74` | 4 | components\chart\ChartSettingsModal.module.css, pages\charts\ChartsWorkspace.module.css |
| `#0a5c22` | 4 | components\StockChart.module.css, pages\charts\ChartsWorkspace.module.css, pages\Watchlists.module.css |
| `#7d1620` | 4 | components\StockChart.module.css, pages\charts\ChartsWorkspace.module.css, pages\Watchlists.module.css |
| `#93c5fd` | 3 | components\chart\ChartToolbar.module.css, pages\journal-2-0\components\notebook\NoteCard.module.css |
| `#111` | 3 | pages\journal-2-0\components\options\OptionStrategiesSection.module.css, pages\Settings.module.css |
| `#666` | 3 | pages\journal-2-0\components\ReportPage.module.css |
| `#e8a34d` | 3 | pages\MorningWire.module.css |
| `#888` | 2 | App.css, pages\journal-2-0\components\ReportPage.module.css |
| `#6ee7a8` | 2 | components\RsBadge.module.css, pages\EducationalVideos.module.css |
| `#27ae60` | 2 | components\tiles\NewsFeed.module.css |
| `#10b981` | 2 | pages\admin\PatternAdmin.module.css, pages\patterns\PatternFilter.module.css |
| `rgba(201, 168, 76, 0.55)` | 2 | pages\charts\widgets\AiSearchWidget.module.css, pages\journal-2-0\components\insights\EdgeScoreCard.module.css |
| `#5c460f` | 2 | pages\charts\widgets\AiSearchWidget.module.css |
| `#8a6d2a` | 2 | pages\desk\ArticleReader.module.css |
| `#ef8a8a` | 2 | pages\journal-2-0\components\analytics\TrackRecordShareCard.module.css, pages\journal-2-0\TrackRecordPage.module.css |
| `rgba(201, 168, 76, 0.8)` | 2 | pages\journal-2-0\components\insights\EdgeScoreCard.module.css, pages\modelbook\builder\BuilderView.module.css |
| `#444` | 2 | pages\journal-2-0\components\ReportPage.module.css |
| `#f7e296` | 2 | pages\modelbook\BottomsView.module.css, pages\modelbook\builder\BuilderView.module.css |
| `rgba(201, 168, 76, 0.9)` | 2 | pages\modelbook\BottomsView.module.css |
| … | | +70 more values |

