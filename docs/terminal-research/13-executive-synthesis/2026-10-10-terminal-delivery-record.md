---
id: TERMINAL-DELIVERY-2026-10-10
title: UCT Terminal delivery record, waves 5-9 (2026-10-08 to 2026-10-10)
role: What shipped in the final terminal push, what was verified on the live site, and what is left.
as_of: master d95f331bb, 2026-10-10
---

# UCT Terminal: delivery record, 2026-10-08 to 2026-10-10

Live on uctintelligence.com. "Verified live" means read on the production site in the owner's
signed-in browser, not inferred from tests. The completion ledger (`COMPLETION-LEDGER.md`) is the
per-item authority; this file is the narrative of the final push and its evidence.

## New function codes (all verified live)

| Code | What it does | Commit |
|---|---|---|
| `NEWS` | Every market headline, newest first; tickers load the linked group | `b142e70b0` |
| `REGM` | Market regime band and exposure guidance with its reasons | `091353618` |
| `INS` | Market-wide open-market insider purchases, last 7 days, from Form 4 filings | `1ac28844e`, `f323c7b0e`, `a8e3f347a` |
| `RSL` | Top 100 by RS rank | `9c4c14a03` |
| `THMS` | UCT theme leaders and laggards by period; a theme opens IMOV | `ae3a3449f` |
| `PEER` | A stock beside its theme/industry peers, 1W to YTD | `3559a1338` |
| `ETF` | An ETF's holdings; a stock's single-stock leveraged ETF family | `dc7056464`, `f05d3ea85` |
| `TWT` | Curated X posts on a ticker, last 7 days | `e35591636` |
| `SIZE` | Position size and R calculator, with a one-ADR stop suggestion | `6021d71f7`, `366635810` |
| `SENT` | AAII, NAAIM, put/call, Fear & Greed and economic series | `fbf7ddb21` |
| `SCAT` | A universe on two metrics; universe and axes are command arguments | `7fff32b41`, `761da5876` |
| `CHK` | Pre-trade check: checklist, win rate, this ticker's and the setup's past trades, own journal, open book | `81a957fa1`, `7acea937e` |
| `BRKO` | Breakout-ready list (bullish pattern near pivot, tight, RS rising); bearish ids excluded | `47b6c9e4d`, `e5917f1e8` |
| `PLAN` | Buy point and stop; sets both price alerts and logs a journal note, only on a button press | `47b6c9e4d` |

Verified live 2026-10-10: SIZE at a $180 entry with ADR 2.0% gave a $176.44 stop, 280 shares,
$996.80 at risk on a $100,000 account at 1%, and 1R/2R/3R targets $183.56/$187.12/$190.68.
PLAN read `NVDA PLAN 180 176` as a $4.00-a-share risk. INS listed 50 purchases filed Oct 5 to Oct 9.

## Linked panels (`523bf837b`)

A ticker row in any list panel loads that ticker into the list's own link group; every panel on the
group follows and the list keeps its function. Verified live: a `BRKO` row moved the group's CORR
panel from MCO to MU with the notice "Loaded MU into Group A: panel 4 kept its function."

## Quality lanes (wave 9, 10 agents)

Discoverability (HELP examples, plain-word search, first-run codes), accessibility with an axe rail,
phone and tablet layout with a layout rail, warming / switched-off / paid-plan states, command-line
routing edge cases, dark pool hooks fixes, the registry moved out of the app entry chunk (-32.6 KB on
every page), and panel headers that state a time (`panelHeaderTime.rail.test.js`).

## Speed, measured on production

| Read | Before | After | Commit |
|---|---|---|---|
| `/api/scatter/universes` | 43 s, then hangs | 0.6 s | `30b855f17`, `c9278d6b3` |
| `/api/screener/meta` | > 60 s | 0.2 s warm; 28 ms warm step after a restart | `c9278d6b3`, `c3e95cb64` |
| `/api/options-screener/sizzle` | 11-43 s after a deploy | warmed at boot | `bd865b78a` |
| `/api/rs-rankings` after a restart | 503 "warming" ~3 min | 200 in 239 ms at 78 s uptime | `433e6957b` |
| `/api/theme-performance` after a 30 s lull | 7-18 s synchronous rebuild | last complete overlay at once, refresh behind | `d95f331bb` |

## Incidents and corrections

- **Web restarts, 2026-10-09 19:25-19:40Z.** Caused by overlapping heavy probe reads, not by the
  batch's code; batch 2 was rolled back (`bdaa5ebf4`) and re-landed (`3ba421547`). Record:
  `11-risks-and-open-questions/2026-10-09-web-restarts-and-heavy-reads.md`.
- **A false alarm.** "Loading NVDA quote..." in a background test tab was the live-price store
  pausing while `document.hidden`, not a bug. The live-price change was rolled back on that
  diagnosis (`15d2e2d02`) and restored (`f3e0b1b5b`). Quote checks belong in a visible tab.
- **Notebook byte budget.** The palette's static import of the terminal parser pushed the Notebook
  over budget by 17 B; fixed by loading it on open (`9860d7b8e`).

## Left, and whose it is

| Item | Owner |
|---|---|
| AAII values in the breadth data unchanged since 2026-09-24 while the survey date advances | breadth data collector |
| Screener serves the 2026-10-07 snapshot; the 10-08 nightly build was incomplete | screener nightly build |
| Market-hours speed check, Wed 2026-10-14, 9-11 AM ET | owner |
| ~~Options Flow `recent=1` wiring (3 lines in `OptionsFlow.jsx`)~~ Done in lane P2 (2026-10-10, owner ruling "no need to wait for ravi"): the page's Search import now comes from `pages/optionsFlow/flowRecentWindow.js`, which asks with `acceptRecent` (so `&recent=1`), and `FlowRecentWindowNote` labels a windowed product ("Showing the most recent N of M sessions"); 3 lines in `OptionsFlow.jsx`, railed by `p2Hooks.wiring.test.js`. Live once `VITE_FLOW_SERVER_SEARCH` is built on (it already is on web) | done |
| Known reds on master not from the terminal: `handRolledFormatters.census` (agent), `reachable.test.js` expired parking note (chart engine), `test_require_paid_is_defined_PER_ROUTER` (screener routers) | their owners |
