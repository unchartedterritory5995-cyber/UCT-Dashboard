# Notebook widgets browser walk, 2026-10-21

Branch `feat/notebook-widgets`, tip `8260a2265800e9ae8366b7c4972a38cc455527b3`. Plan Task 11, extended to waves 1-6.

## Verdict on C:\data

`SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; log: C:\Users\Patrick\uct-worktrees\notebook-widgets\docs\notebook\evidence\2026-10-20-widgets\sandbox-integrity.md`

The news follow-up run (one step, see below) also read CLEAN at pre-boot, +15 s and shutdown (`sandbox-integrity-news-followup.md`). Run 1 (`walk-results-run1.json`, an instrument defect at 820/390, superseded) read CLEAN at all four checkpoints (`sandbox-integrity-run1.md`).

## How it was run

- Sandbox: `scripts/hub_sandbox_boot.py` through `tools/notebook_perf_harness.Sandbox`, data dir `C:\data-widgets-walk`, port 8231, stopped by the harness (graceful, shutdown checkpoint written).
- `app/dist` rebuilt from the tip (`npm run build`, exit 0) before the walk.
- Flags: `NOTEBOOK_WIDGETS_W1..W6_ENABLED=1`, `J2_SHARE_LINKS_ENABLED=1`, `NOTEBOOK_JOURNAL_STYLES_ENABLED=1`, `NOTEBOOK_EARNINGS_PREP_ENABLED=1`; model keys blank. `/api/auth/me` confirmed every widget wave flag true and the account paid-equivalent.
- Account: signed up through the app, comped and verified by the sandbox admin (`ADMIN_EMAILS`). Seeded through the app API: watchlist "Walk list" (NVDA, AAPL, MSFT), an open NVDA long (entry 120, stop 110), two closed manual trades (AAPL win, MSFT loss), a note, and a saved screen "Walk leaders" (starter AST).
- Browser: Playwright Chromium, own contexts; 820 and 390 with touch emulation (390 as mobile). The share page was opened in fresh contexts with no cookies.
- Share link minted with `POST /api/j2/notes/{id}/share`; the starter styles applied with `POST /api/j2/notes {styleId}` (the app API the style picker uses), then opened in the browser.
- Walk script kept outside the repo (session scratchpad `walk/widgets_walk.py`).

## Results (adjudicated; raw verdicts are in walk-results.json `steps`)

| width | step | kind | raw | verdict | note / screenshot |
|---|---|---|---|---|---|
| 1200 | 1-slash-groups |  | PASS | **PASS** |  `1200-1-slash-menu.png` |
| 1200 | 2-insert | myWatchlistToday | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-myWatchlistToday.png` |
| 1200 | 2-insert | myNamesReporting | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-myNamesReporting.png` |
| 1200 | 2-insert | marketOnMyNames | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-marketOnMyNames.png` |
| 1200 | 2-insert | roomBuzzOnMyNames | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-roomBuzzOnMyNames.png` |
| 1200 | 2-insert | myEarningsReactions | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-myEarningsReactions.png` |
| 1200 | 2-insert | tickerCard | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-tickerCard.png` |
| 1200 | 2-insert | tickerFlow | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-tickerFlow.png` |
| 1200 | 2-insert | myPnlStats | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-myPnlStats.png` |
| 1200 | 2-insert | myPositionsRisk | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-myPositionsRisk.png` |
| 1200 | 2-insert | myRulesCheck | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-myRulesCheck.png` |
| 1200 | 2-insert | myMistakes | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-myMistakes.png` |
| 1200 | 2-insert | myPnlCalendar | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-myPnlCalendar.png` |
| 1200 | 2-insert | mySetupEdge | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-mySetupEdge.png` |
| 1200 | 2-insert | tradeRecap | PASS | **FAIL** | entry/exit dates shown one day early (defect D3) `1200-2-tradeRecap.png` |
| 1200 | 2-insert | myScreenToday | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-myScreenToday.png` |
| 1200 | 2-insert | calendar | PASS | **FAIL** | renders the placeholder "[calendar: <day>] snapshot image not captured yet", never the frozen day (defect D2) `1200-2-calendar.png` |
| 1200 | 2-insert | news | FAIL | **PASS** | honest empty sentence (captured in the news follow-up run, walk-results-news-followup.json): "No news feed for NVDA yet. Open NVDA on Charts to build it, then try again." /api/news-catalysts/NVDA?generate=0 answered status "none". Run 2's observer regex missed this sentence (instrument gap, fixed for the follow-up). `1200-2-news.png` |
| 1200 | 2-insert | fundamentals | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-fundamentals.png` |
| 1200 | 2-insert | breadth | FAIL | **PASS** | honest failed sentence: "Breadth heatmap could not be loaded just now, so nothing was added." (sandbox has no breadth snapshot) `1200-2-breadth.png` |
| 1200 | 2-insert | alerts | FAIL | **PASS** | honest empty sentence: "You have no price alerts yet, so nothing was added." `1200-2-alerts.png` |
| 1200 | 2-insert | watchlist | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-watchlist.png` |
| 1200 | 2-insert | themes | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `1200-2-themes.png` |
| 1200 | 3-see-it-now | myWatchlistToday | PASS | **PASS** |  `1200-3-see-it-now-myWatchlistToday.png` |
| 1200 | 3-see-it-now | myPnlStats | PASS | **PASS** |  `1200-3-see-it-now-myPnlStats.png` |
| 1200 | 3-change | tickerCard | PASS | **PASS** |  `1200-3-change-tickerCard.png` |
| 1200 | 5-ticker-click | $NVDA | PASS | **PASS** |  `1200-5-ticker-click.png` |
| 1200 | 5-ticker-hover | $AAPL | PASS | **PASS** |  `1200-5-ticker-hover.png` |
| 1200 | 6-preset-save | myPnlStats | PASS | **PASS** |  `1200-6-preset-save.png` |
| 1200 | 6-preset-insert | myPnlStats | PASS | **PASS** |  `1200-6-preset-insert.png` |
| 1200 | 6-chart-sets-menu | /set | INFO | **INFO** |  `1200-6-set-menu.png` |
| 1200 | 4-market-chip | myWatchlistToday | PASS | **PASS** |  `1200-4-market-chip.png` |
| 1200 | 4-public-off | myPnlStats | PASS | **PASS** |  `1200-4-public-switch-off.png` |
| 1200 | 4-public-on | myPnlStats | PASS | **PASS** |  `1200-4-public-switch-on.png` |
| 1200 | 7-starter-style | Daily prep | PASS | **PASS** |  `1200-7-starter-style.png` |
| 1200 | 9-home-earnings | Reporting soon | PASS | **PASS** |  `1200-9-home-earnings.png` |
| 1200 | 8-send-to-journal | chart | PASS | **PASS** |  `1200-8-charts-sent.png` |
| 820 | 1-slash-groups |  | PASS | **PASS** |  `820-1-slash-menu.png` |
| 820 | 2-insert | myWatchlistToday | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-myWatchlistToday.png` |
| 820 | 2-insert | myNamesReporting | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-myNamesReporting.png` |
| 820 | 2-insert | marketOnMyNames | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-marketOnMyNames.png` |
| 820 | 2-insert | roomBuzzOnMyNames | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-roomBuzzOnMyNames.png` |
| 820 | 2-insert | myEarningsReactions | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-myEarningsReactions.png` |
| 820 | 2-insert | tickerCard | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-tickerCard.png` |
| 820 | 2-insert | tickerFlow | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-tickerFlow.png` |
| 820 | 2-insert | myPnlStats | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-myPnlStats.png` |
| 820 | 2-insert | myPositionsRisk | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-myPositionsRisk.png` |
| 820 | 2-insert | myRulesCheck | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-myRulesCheck.png` |
| 820 | 2-insert | myMistakes | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-myMistakes.png` |
| 820 | 2-insert | myPnlCalendar | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-myPnlCalendar.png` |
| 820 | 2-insert | mySetupEdge | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-mySetupEdge.png` |
| 820 | 2-insert | tradeRecap | PASS | **FAIL** | entry/exit dates shown one day early (defect D3) `820-2-tradeRecap.png` |
| 820 | 2-insert | myScreenToday | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-myScreenToday.png` |
| 820 | 2-insert | calendar | PASS | **FAIL** | renders the placeholder "[calendar: <day>] snapshot image not captured yet", never the frozen day (defect D2) `820-2-calendar.png` |
| 820 | 2-insert | news | FAIL | **PASS** | honest empty sentence (captured in the news follow-up run, walk-results-news-followup.json): "No news feed for NVDA yet. Open NVDA on Charts to build it, then try again." /api/news-catalysts/NVDA?generate=0 answered status "none". Run 2's observer regex missed this sentence (instrument gap, fixed for the follow-up). `820-2-news.png` |
| 820 | 2-insert | fundamentals | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-fundamentals.png` |
| 820 | 2-insert | breadth | FAIL | **PASS** | honest failed sentence: "Breadth heatmap could not be loaded just now, so nothing was added." (sandbox has no breadth snapshot) `820-2-breadth.png` |
| 820 | 2-insert | alerts | FAIL | **PASS** | honest empty sentence: "You have no price alerts yet, so nothing was added." `820-2-alerts.png` |
| 820 | 2-insert | watchlist | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-watchlist.png` |
| 820 | 2-insert | themes | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `820-2-themes.png` |
| 820 | 3-see-it-now | myWatchlistToday | PASS | **PASS** |  `820-3-see-it-now-myWatchlistToday.png` |
| 820 | 3-see-it-now | myPnlStats | PASS | **PASS** |  `820-3-see-it-now-myPnlStats.png` |
| 820 | 3-change | tickerCard | PASS | **PASS** |  `820-3-change-tickerCard.png` |
| 820 | 5-ticker-tap | $NVDA | PASS | **PASS** |  `820-5-ticker-tap.png` |
| 820 | 6-preset-insert | myPnlStats | PASS | **PASS** |  `820-6-preset-insert.png` |
| 820 | 6-chart-sets-menu | /set | INFO | **INFO** |  `820-6-set-menu.png` |
| 820 | 4-public-page | myPnlStats | PASS | **PASS** |  `820-4-public-page.png` |
| 820 | 7-starter-style | Weekly review | PASS | **PASS** |  `820-7-starter-style.png` |
| 820 | 9-home-earnings | Reporting soon | PASS | **PASS** |  `820-9-home-earnings.png` |
| 820 | 8-send-to-journal | chart | FAIL | **NOT WALKED** | at 820 /charts is the touch workspace; its chart sheet has no Send to Journal entry (pre-existing /charts menu, observation O1, not a widgets-branch change) `820-8-charts-menu.png` |
| 390 | 1-slash-groups |  | PASS | **PASS** |  `390-1-slash-menu.png` |
| 390 | 2-insert | myWatchlistToday | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-myWatchlistToday.png` |
| 390 | 2-insert | myNamesReporting | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-myNamesReporting.png` |
| 390 | 2-insert | marketOnMyNames | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-marketOnMyNames.png` |
| 390 | 2-insert | roomBuzzOnMyNames | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-roomBuzzOnMyNames.png` |
| 390 | 2-insert | myEarningsReactions | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-myEarningsReactions.png` |
| 390 | 2-insert | tickerCard | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-tickerCard.png` |
| 390 | 2-insert | tickerFlow | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-tickerFlow.png` |
| 390 | 2-insert | myPnlStats | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-myPnlStats.png` |
| 390 | 2-insert | myPositionsRisk | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-myPositionsRisk.png` |
| 390 | 2-insert | myRulesCheck | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-myRulesCheck.png` |
| 390 | 2-insert | myMistakes | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-myMistakes.png` |
| 390 | 2-insert | myPnlCalendar | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-myPnlCalendar.png` |
| 390 | 2-insert | mySetupEdge | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-mySetupEdge.png` |
| 390 | 2-insert | tradeRecap | PASS | **FAIL** | entry/exit dates shown one day early (defect D3) `390-2-tradeRecap.png` |
| 390 | 2-insert | myScreenToday | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-myScreenToday.png` |
| 390 | 2-insert | calendar | PASS | **FAIL** | renders the placeholder "[calendar: <day>] snapshot image not captured yet", never the frozen day (defect D2) `390-2-calendar.png` |
| 390 | 2-insert | news | FAIL | **PASS** | honest empty sentence (captured in the news follow-up run, walk-results-news-followup.json): "No news feed for NVDA yet. Open NVDA on Charts to build it, then try again." /api/news-catalysts/NVDA?generate=0 answered status "none". Run 2's observer regex missed this sentence (instrument gap, fixed for the follow-up). `390-2-news.png` |
| 390 | 2-insert | fundamentals | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-fundamentals.png` |
| 390 | 2-insert | breadth | FAIL | **PASS** | honest failed sentence: "Breadth heatmap could not be loaded just now, so nothing was added." (sandbox has no breadth snapshot) `390-2-breadth.png` |
| 390 | 2-insert | alerts | FAIL | **PASS** | honest empty sentence: "You have no price alerts yet, so nothing was added." `390-2-alerts.png` |
| 390 | 2-insert | watchlist | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-watchlist.png` |
| 390 | 2-insert | themes | PASS | **PASS** | frame, as-of and source line rendered; see screenshot `390-2-themes.png` |
| 390 | 3-see-it-now | myWatchlistToday | PASS | **PASS** |  `390-3-see-it-now-myWatchlistToday.png` |
| 390 | 3-see-it-now | myPnlStats | PASS | **PASS** |  `390-3-see-it-now-myPnlStats.png` |
| 390 | 3-change | tickerCard | PASS | **PASS** |  `390-3-change-tickerCard.png` |
| 390 | 5-ticker-tap | $NVDA | PASS | **PASS** |  `390-5-ticker-tap.png` |
| 390 | 6-preset-insert | myPnlStats | PASS | **PASS** |  `390-6-preset-insert.png` |
| 390 | 6-chart-sets-menu | /set | INFO | **INFO** |  `390-6-set-menu.png` |
| 390 | 4-public-page | myPnlStats | PASS | **PASS** |  `390-4-public-page.png` |
| 390 | 7-starter-style | Daily prep | PASS | **PASS** |  `390-7-starter-style.png` |
| 390 | 9-home-earnings | Reporting soon | PASS | **PASS** |  `390-9-home-earnings.png` |
| 390 | 8-send-to-journal | chart | - | **NOT WALKED** | the Send to Journal door is the desktop chart context menu; walked at 1200 (PASS) and tried at 820 (O1) |

Not walked as separate inserts: `indexes`, `marketcontext` and `scanner` are `held` (Wave R keeps them dark; the / menu does not offer them by design).

## Defects

- **D1.** The embed toolbar (back / overflow / More buttons) is drawn on top of the snapshot frame title whenever the widget is hovered or selected; at 820 and 390 the title is fully hidden. Screenshots: `1200-2-myPositionsRisk.png`, `1200-3-see-it-now-myWatchlistToday.png`, `820-2-myPnlStats.png`, `390-2-myPositionsRisk.png`, `390-2-myWatchlistToday.png`.
- **D2.** /calendar (UCT Terminal day, today) inserts and says "UCT Terminal day added." but renders the author placeholder "[calendar: 2026-10-21] snapshot image not captured yet". resolveEmbedRender sends a same-day calendar capture to captured-before-outcome, which shows the placeholder because no archived image exists, and the archive pass only runs for a live decision. Screenshots: `1200-2-calendar.png`, `820-2-calendar.png`, `390-2-calendar.png`.
- **D3.** Trade recap and the /recap pick row show manual-trade dates one day early: seeded MSFT entryDate 2026-10-13 / exitDate 2026-10-15 renders "Entry $500.00 on Oct 12, 2026" / "Exit $490.00 on Oct 14, 2026" and the row "Recap - MSFT long, Oct 14". Manual date-only trades are stored at UTC midnight; the widget reads them on the ET calendar. Screenshots: `1200-2-tradeRecap.png`, `820-2-tradeRecap.png`, `390-2-tradeRecap.png`.

## Observations (not counted as branch defects)

- **O1.** 820 /charts (touch workspace) chart sheet offers no Send to Journal; not a widgets-branch surface (820-8-charts-menu.png).
- **O2.** Ticker card "Your history" counts trades only: with an open NVDA position and a note mentioning NVDA it says "No trades in NVDA yet." (spec lists J2 trades/notes).
- **O3.** Console errors are all HTTP 503/401 resource loads from sandbox-dark services (/api/j2/broker/sync, /api/stream/bars, /api/breadth-monitor/live) and the pre-sign-in /api/auth/me; 0 page errors.

## What each step showed

1. **`/` menu.** A bare `/` lists 62 rows under the group labels Before the open, Planning a trade, Reviewing, Basics, More (My presets appears once a preset exists). Snapshot widgets lead each group. `*-1-slash-menu.png`.
2. **Inserts.** Every offered kind showed the busy toast "Adding <title>…" and then either "<title> added." or an honest sentence. Each frame shows its title, "Snapshot" or "Only you", "as of <date, time> ET", "Not shown on shared pages" (market kinds) or the Show on shared pages switch (account kinds), and a source line. n/a cells carry a title reason (e.g. "No options-implied move available", "Not in the theme taxonomy"). Failed vs empty reads are distinct sentences ("Couldn't load options flow right now.", "This screen's results are not ready yet.", "No closed trades in this range yet."). At 390 no page or scroller widens; tables sit in their own horizontal scroller. `<w>-2-<kind>.png`.
3. **See it now / Change.** See it now on My watchlist today and My P&L and stats each sent one `GET /api/j2/notebook-widgets/<kind>` and re-stamped the as-of. Change on the Ticker card (symbol NVDA to AAPL) sent `?symbol=AAPL` and redrew for AAPL. `<w>-3-*.png`.
4. **Share.** Switch off: the public page shows "A private account item is not shown on public pages." for every account widget and "A market-data item is not shown on public pages." for market widgets. Switch on (P&L widget): saved as `params.share: true`, and the public page shows My P&L and stats while the rest stay neutral. Editor chip on market widgets: "Not shown on shared pages". Public page has no sideways scroll at 820/390. `1200-4-*.png`, `820-4-public-page.png`, `390-4-public-page.png`.
5. **$TICKER.** 1200: a click on `$NVDA` placed the caret in the chip and opened no card; resting the mouse on `$AAPL` opened the card, history labelled "Only you" ("1 trade · 100% wins · +$240.00"). 820/390 touch: a tap opened the card (bottom sheet at 390). `<w>-5-*.png`.
6. **Presets.** "Save these settings as a preset" on My P&L and stats answered "Saved as a preset. Type /preset to use it."; `/preset` then offered "Preset — Walk weekly P&L" at every width and inserting it added a second P&L widget. `/set` offers "Manage chart sets" (no set saved by this walk). `<w>-6-*.png`.
7. **Starter styles.** Daily prep (1200, 390) and Weekly review (820) applied to new notes: the server built every `{{block:...}}` slot (My watchlist today + My names reporting; P&L, positions, rules, mistakes), nothing skipped, no literal placeholder text. `<w>-7-*.png`.
8. **/charts Send to Journal.** 1200: right-click on the chart, Send to Journal; a chart embed landed in the last-active note ("Styled 1200"). `1200-8-*.png`.
9. **Notebook Home earnings box.** "REPORTING SOON — Your watchlist, flagged and open-position names, next 7 days: $MSFT Wed, Oct 28, time not announced yet · Watchlist · Create prep note", at every width without sideways scroll. `<w>-9-home-earnings.png`.

## Console

22 console errors, 0 page errors in the evidence run. HTTP failures behind them: 401 /api/auth/me, 503 /api/breadth-monitor/live, 503 /api/j2/broker/sync, 503 /api/stream/bars. See O3.

## Files

- `walk-results.json` — the evidence run: raw `steps` (observed text, layout, toasts), `adjudicated`, `defects`, `observations`, console and HTTP errors, seed, integrity.
- `walk-results-news-followup.json` — the one-step re-run that captured the news sentence.
- `walk-results-run1.json` — the first run, superseded (its 820/390 rows died on the walk's own click target).
- `sandbox-integrity*.md` — the launcher's C:\data snapshot logs.
