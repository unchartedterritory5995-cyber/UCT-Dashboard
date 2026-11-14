# UCT Relative Strength screens: plan v2 (after specialist review)

Date 2026-11-14. Status: PLAN, nothing built. Supersedes
`2026-11-13-uct-rs-leaders-scan-design.md` (v1). Research: `docs/research/relative-strength/05-rs-scans.md`.
Review record: five specialist reviews (trader, quant, engineer, product designer, red team), summarised
in the project resume folder (`REVIEWS-SUMMARY.md`). Owner decisions D1 to D9 in section 11.

## 0. What changed from v1, and why

1. **The owner's three lists lead.** RS New Highs, RS New High Before Price (RSNHBP) and the RS Rating
   ranking are first-class screens and ship first. v1 folded the first into a side view, proposed
   retiring it, and had no ranking. All five reviewers called that wrong.
2. **No second "RS" number at launch.** v1's 0 to 100 "RS Score" sat beside RS Rating, RS ranks and the
   UCT rating, and it did not fix its own problem (the sample still ranked XERS 2nd with 7 of 10 rows
   extended, because about two thirds of its weight was recent strength). In v2 RS Leaders sorts by the
   exact RS Rating rank. A rebuilt composite, named Leader score, runs unseen and is shown only if it
   proves better (section 8).
3. **Separate named screens, not "lens chips".** Matches the owner's ruling on the RS indicators and
   needs no new navigation.
4. **Setup label kept and protected**, reworded, with rules in ATR units and the house moving averages.
   "Buyable now" is gone: it read as advice.
5. **Evidence wording corrected.** v1 graded several parts stronger than the sources support.
6. **Fix first.** The live RS Rating shows wrong 99s on some short-history tickers (section 2).
7. **Engineering corrections** from the code review (section 9).

Verified 2026-11-14: the browser and the desktop app (0.1.11, a thin shell over the live site) load the
same site build (`index-Bp0P56Vx.js`), equal to the server's; no screener commits are waiting on master.
The "outdated" look in the owner's Chrome was the Table view left selected by this session
(`uct.screener.layout = table`); restored to List.

## 1. The Relative Strength group: five screens

One liquidity floor on all five: stocks and ADRs, price $10+, $20M+ traded daily (30-day). SPY is the
benchmark, closing prices. Names flagged "Buyout pending" are left out.

| # | Screen | One-line description (picker) | Default | Tonight |
|---|---|---|---|---|
| 1 | **UCT RS Leaders** | The strongest liquid stocks in real uptrends, each labelled extended or near a buy point | top 50 by RS Rating rank | roughly 270 qualify (estimate) |
| 2 | **RS New Highs** | Stocks whose RS line (price against SPY) hit a 52-week high this week | this week, newest first | 237 this week, 11 today |
| 3 | **RS New High Before Price** | RS line at a 52-week high while price is still below its own high. Also called RSNHBP | this week, 3%+ below the high | 83 at 5%+ |
| 4 | **Top RS Rating** | Every liquid stock ranked by RS Rating, with its exact place and how it is moving | overall rating, 90+ | 331 at 90+ |
| 5 | **RS exit warnings** | RS line just broke down. A prompt to review a position, not an order to sell | any warning, 5 sessions | fills from 11-14 |

Counts for screens 2 to 4 were measured on 2026-11-13 at the current $5 / $10M floor; the $10 / $20M
floor trims them by roughly a fifth. The screen 1 figure is an estimate from a prototype gate (310 before
the RS-line and market-cap rules).

Retired from the menu (hidden, never deleted; saved links keep working): Mansfield turned positive,
Leaders vs equal-weight too, RS line crossed above its 21 EMA, Up on down days (3+ of 20), RS new highs on
a red day (becomes a filter on screen 2), Quicksand (becomes a Type control on screen 5), and Leaders
(RS >= 90) (replaced by screens 1 and 4). The group goes from nine single-rule lists to five.

### 1.1 Top RS Rating (the ranking)
- Population: the liquid floor above. No daily-range floor: it is a ranking, and AAPL belongs.
- Order: the stored unrounded score behind the rating (`rs_rating_history.score`), so the dozens of names
  that share a 99 get an exact place. Shown as "RS 99 · #14 of 1,931".
- Needs a full year of clean history for the overall board (section 2). Younger names appear on the
  shorter boards their history covers, tagged "New issue".
- Movement: "was #40 a month ago", from the unrounded value (an integer change cannot show a 99 climbing).
- Quick controls: **Period** Overall / 1M / 3M / 6M / 12M. **Show** Top rated / Rising fastest / New to
  90+. **Min rating** 70 / 80 / 90.
- Honest notes on the screen's help: a rating is a rank of past return, not a forecast; "rising fastest"
  is partly names bouncing back, so it is a list to study, not a signal.
- Build note: per-period exact order needs the per-period values stored (today only the 1 to 99 ranks
  are kept), so exact per-period history starts at launch.

### 1.2 RS New Highs
- Definition: RS line closes above (strictly) its highest close of the prior 252 sessions; valid with at
  least 240 of those bars; the benchmark itself never qualifies. Requires a close above the 200-day line.
- Quick controls: **When** Today / This week (rolling 5 sessions) / This month. **Min RS Rating** Any /
  70 / 80 / 90. **Only on market down days** (off by default; 10-session window; SPY down 0.5% or more).
- Row facts: "High today" or "High 3 sessions ago"; "First RS high in 6 months" when none came in the
  prior 20 sessions; RS highs in the last 20 sessions; tags Before price, Market down day, New.
- Header line: RS new highs per day for the last 20 sessions (tonight's last six: 84, 22, 37, 64, 19, 11).
  It is a simple read of how broad leadership is.
- The red-day filter is the house method. Label: "House method. No published test exists. Our own count
  so far: N." It is not the same thing as "stock closed up on down days", which has weak published
  results and is retired.

### 1.3 RS New High Before Price (RSNHBP)
- Definition: an RS new high inside the window, while the close is 3% to 25% below its own 252-session
  closing high, above the 200-day line. A name stays listed until price makes its high, then carries
  "Confirmed" for 5 sessions.
- Quick controls: **When** Today / This week / This month. **Below its high by** 3% / 5% / 10%.
  **Min RS Rating** Any / 70 / 80.
- Sort: closest to its high first. Second sort key offered: Lead = how much the stock has beaten SPY
  since its price peak.
- Why the change: the shipped rule (last session only, 2% below) read 0 tonight; a 5-session window
  finds 173 at 2%, 83 at 5%, 25 at 10%. The chart dot keeps its current rule.
- Later: a weekly-close version (the house lesson), as a tag then a When option.
- Empty state: "No RS line made a 52-week high ahead of price this week. Normal in a weak market," with
  buttons "Show this month (N)" and "Open RS New Highs (N)".

### 1.4 UCT RS Leaders
Who qualifies (written as visible filters, so a member can see and adjust them):
- the liquid floor, plus average daily range 3%+ and market cap $300M+ (D7);
- RS Rating 80+ (D2), with a full year of clean history or a "New issue" tag;
- RS line above its 21-day average, or an RS new high within 20 sessions ("rising RS line only");
- close above the 200-day line, and that line above its level 20 sessions ago;
- within 25% of the 52-week high.

Order: exact RS Rating rank. Size: top 50; "All" shows every qualifier. To cut churn a name enters at
rank 50 and leaves past 65, and enters at rating 80 and leaves below 75.
Quick controls: **Show** All / Near a buy point / Hide extended. **Group** (sector, industry, theme).
**Min rating** 80 / 85 / 90 / 95.
One line under the controls: "50 of 270 qualify · 9 new · 6 dropped · Nov 13" (the existing new-today
line) and, when one group dominates, "29 of 50 are Healthcare".

## 2. Fix first (before any ranking ships)

1. **Wrong RS 99s.** Measured 2026-11-13: of the 14 liquid stocks rated 99, eight (SPCX, BNY, P, LIFE,
   MDA, BSP, JAN, CBC) have under a year of daily bars on our side yet carry 99 on windows longer than
   their history, with weak 1M and 3M ranks and prices 30 to 49% below their highs. Other young names
   correctly show blanks. The rating maths is right (`rs_weighted_return.py:145-167` returns nothing for
   a window the series does not cover), so the job must be reading more closes than the chart serves:
   most likely old bars from a ticker's previous owner or pre-rename history (MDA's series shows three
   2017 bars spliced before 2026). Step: one read-only pod check of the stored `bars` count and first
   bar date for these names; then a continuity guard in the rating window (no gap above 10 calendar days
   inside the scored closes) and a restate of the affected sessions. Also affects the RS number on charts.
2. **Rating session.** Rows carry the previous session's rating against today's bars, and a table can
   mix sessions. Refresh the rating columns after the 04:15 job and at the end of every build, and stamp
   the session on the screen.
3. **Small repairs:** strict ">" so SPY is not a new high against itself; BRK listed once; a missing
   filter value answers 400 with a sentence, not 500; remove the stale test ban on rating columns in
   starters; the "$300M" coverage sentence; an RS column (not RSI) on the leaders table view; search
   aliases so "RSNHBP" and "blue dot" find screen 3.

## 3. The Setup label (kept on all five screens)

Words in the row caption, never a coloured pill (green and red mean direction of money only). First
match wins; "Tight range" is a second tag that can sit beside any label.

| Label | Rule |
|---|---|
| Below its 50-day line | close under the 50-day |
| Extended | 4+ ATR above the 50-day, or 3+ ATR above the 21-day, or more than 5% past a pivot |
| At pivot | 3% below to 5% above a fresh pivot; the row prints the pivot price |
| Pullback to the 8-day / 21-day | a 20-session high in the last 15 sessions, then the low within 0.5 ATR of a rising 8-day or 21-day EMA and the close no more than 0.5 ATR under it (D5) |
| Uptrend, no setup | none of the above |

"Near a buy point" = At pivot, Pullback, or Tight range without Extended. A "One-day move" flag (one
session supplied over half of the 3-month gain) keeps a name out of "Near a buy point". "Buyout pending"
triggers after 3 flat sessions following a 15%+ gap. v1 freezes labels to the close with one date stamp;
a live label is a later step.

## 4. Customisation rule

A member can change who is on a list, never how it is ranked or labelled.
- At most three quick controls per screen, in one row under the top bar; on phones the first shows and
  the rest open from "Adjust".
- Each control writes an ordinary filter, so the Filters button, its count and the "(edited)" mark agree.
- A gold dot marks any control off its default; one "Reset". Choices are remembered per member per
  screen; "Save as new" makes a named copy.
- Price, volume and sector stay in the Filters drawer; sort stays in the Sort menu.
- Not adjustable: the benchmark, the 200-day rule, Setup thresholds, the ranking recipe.

## 5. Row, header, words

Row (list is 340 px on desktop): rank, ticker, one tag, one lead number, sparkline, price, change; caption
"Setup label · group". Lead number: RS Rating on every screen. Days on list, score parts and the rest
live in the "Why it's here" strip and the Table view.
Header on a phone, three lines: screen name and count; the first quick control and "Adjust"; the
new/dropped line with the date. A market caution line appears only in a caution state (section 7).
First visit: one dismissible line: "The strongest liquid stocks, ranked. The line under each name says
whether it is extended or near a buy point. RS is relative strength, not RSI. How it works".
Plain words: Avg daily range (not ADR), Market down day (not red day), "RS Rating up 12 in a month",
"4th strongest of 118 groups (31 stocks)". Help page states that our RS Rating is our own calculation
and can differ from IBD's by a few points.

## 6. Daily-use additions (after the screens ship)

Earnings date and days to earnings on the row (known for about 43% of names today); "why isn't X here"
(which rule failed); reasons in the existing "N dropped" popover; alerts when a stock joins or leaves a
screen, as one daily digest with a per-session key so catch-up runs never repeat; weekly RSNHBP; a live
"holding an RS high now" flag on market down days.
Cut from v1: the four header number cards, the leadership strip, the Dropped tab, map colouring by
score, score bands, the watchlist score column, the Study lesson.

## 7. Market caution state

Defined now, from data we hold: SPY below its 200-day, or its two-year return negative. Then: the
screens show one gold line ("Leadership reverses hardest in rebounds after bear markets; treat lists as
watchlists"), RS New Highs and RSNHBP sit first in the group, and join alerts pause. Tonight is not that
state (SPY is above its 200-day), but SPY is below its 50-day and QQQ below its 200-day, so the line
"Market under pressure: build the watchlist, breakouts fail more often" would show.

## 8. Leader score: earn its place first

Computed nightly, stored, shown to nobody. Rebuilt on the quant review:
`Leader score = 0.40 Strength + 0.25 Steady + 0.20 High + 0.15 Group`
- Strength: percentile, within the liquid floor, of the unrounded rating score.
- Steady: percentile of `sign(return) x (share of up days - share of down days)` over days t-252 to t-21.
- High: mean nearness of price and of the RS line to their 252-session highs, continuous, 0 at 25% away.
- Group: industry only, the stock itself left out, 8-member floor, shrunk toward the sector.
- Facts, not weights: rating change, RS line above its 21-day, RS-high age, market down days.

The test it must pass (fixed in advance): five-year rating backfill in chunks (D9); the newest 252
sessions held out unread; every fifth session form quintiles among qualifiers; one primary endpoint, top
minus bottom quintile at 21 sessions against equal-weight liquid names with 3%+ daily range, net of 0.2%;
block bootstrap over dates; pass = positive with the interval off zero, positive in 3 of 4 years,
quintiles in order, same sign in the holdout. Default is keep each part; remove one only if removal
helps in 3 of 4 years by 0.25 points or more. If it fails, the screens stay rating-ordered for good.
What gets printed on screens meanwhile: only the measured sentences the nightly evidence job already
produces for RS new highs and before-price, plus list membership counted from launch day, under the
existing floor (100 events on 100 sessions), else "not enough data yet". Nothing from a backfill is
called a track record.

## 9. Engineering corrections carried from the code review

- New row values live in `screener_rows` columns filled by one pure function that runs at the end of
  every build AND after the 04:15 rating job (a later build rewrites whole rows, so a single nightly
  pass would be wiped). Membership is re-recorded after that pass.
- 04:40 ET already runs `rs_lists_nightly`, which builds managed watchlists named "RS Leaders" and "RS
  Emerging" (dark). Chain the new pass there and make those watchlists read the same definitions.
- The gate is written as ordinary filters (no baked "is a leader" flag), so quick controls can adjust it.
- The landing screen is each member's last-used screen, else the first pinned one. Changing defaults
  reaches only new members; overriding everyone needs a migration (D3).
- New bar columns ride the existing RS step (under 1 ms per ticker): RS highs in the last 20, sessions
  since the previous RS high, before-price age, span, steady; weekly RS high later, liquid rows only.
- History: extend `membership.py` retention for these screens; a small table of qualifiers only for
  ranks and labels (under 50 MB), not every stock every day. `screener.db` is in no backup rail today.
- UCT Agent field budget has 13 bytes of headroom: new fields are hidden from the Agent until room is made.
- Bookkeeping per Screener PR: `SCREENER_PIN`, `screener-fields.json`, SAT-1 capture, address book,
  starter-count pins, `rs_dark_keys` (a fourth family), the omitted-fields pin.
- Flags: `RS_SCREENS_ENABLED` (server), `RS_SCREENS_UI_ENABLED` per request with `admin` for the owner
  preview, then a small cohort, then everyone.

## 10. Build order

| Step | Work | Owner sees |
|---|---|---|
| 1 Fix first | section 2 | corrected ratings; a short before/after list |
| 2 The screens | exact rank, new bar columns, the five screens, Setup label, quick controls, words, empty states | owner preview on the live site, screenshots desktop and phone |
| 3 Daily use | section 6 | switch on for a small group, then everyone |
| 4 Leader score | shadow run, backfill, the test | a results page and a yes/no |
| 5 Reach | UCT Agent and Compass, Discord (on hold) | |

## 11. Owner decisions

| # | Decision | Recommended |
|---|---|---|
| D1 | Leader score: run unseen until it passes its test, or show at launch | unseen first |
| D2 | RS Leaders default minimum rating | 80, one tap to 85 / 90 / 95 |
| D3 | Landing: first pinned screen for new members only, or override everyone once | new members only; retire Leaders (RS >= 90) |
| D4 | Retire seven old single-rule screens from the menu (section 1) | yes |
| D5 | Pullback reference: add 8-day and 21-day EMAs to match the teaching, or reuse 9/10/20 | add 8 and 21 |
| D6 | "Before price" default: 3% below the high, listed until price makes its high | yes |
| D7 | Floors: $10 and $20M on all RS screens; RS Leaders also 3% daily range and $300M market cap | yes |
| D8 | Chartmaster reviews the market-down-day wording and the 0.5% definition | yes |
| D9 | Five-year rating backfill for the Leader score test, run in chunks at Step 4 | yes, not blocking |

## 12. Corrected evidence statements (replace v1's grades)

- Past 6 to 12 month strength: strong in long-short academic tests; untested for our rating at swing
  horizons; 80 is a convention, not a validated threshold.
- Nearness to the 52-week high: supported in the US original, mixed in replications.
- RS line above its average, RS new highs, before price: trader rules with no published test; our
  nightly job measures them.
- Smooth climb: supported in the original and one international study; one recent large-cap re-test did
  not reproduce it.
- Group strength: a separate, contested effect; nobody has published that leaders in strong groups beat
  leaders alone.
- Rating change ("fresh"): weak, secondary sources only.
- Never in member copy: "no other screener shows this", any hit rate without its baseline, any win rate
  for the dots, bands that imply odds.

## 13. Also found

- The desktop installer and app executable (0.1.11) report as not digitally signed on this PC, so
  Windows may warn members on install.
- Items 2 to 6 of v1 section 14 stand (RSI column, AGL news, three BRK rows, SPY self-high, 500 error).
  The exit-warning columns were empty only because they merged after that day's build.
