# Render ops — the Discord render products' own instruments (2026-09-25)

Five additions, one module (`api/services/flow_card_ops.py`), all shipped ON by default and each
behind its own kill switch on `web`. None of them posts anything to members.

| # | What | Where it shows | Kill switch (set `0` on web) |
|---|---|---|---|
| 1 | **Post-deploy render smoke** — `DISCORD_RENDER_SMOKE_DELAY_S` (240 s) after each web boot: `/chart NVDA` D and W through the real `produce_chart` path, weekly = daily for NVDA/AMD/QQQ/MSFT/TSLA, and the page-derived `/flow AMD` card | one ✅/❌ line in **#render-smoke** (bot, `DISCORD_RENDER_SMOKE_CHANNEL`); a ❌ also goes to **#render-alerts** | `DISCORD_RENDER_SMOKE_ENABLED` |
| 2 | **Daily `/flow` outcome line** — Mon–Fri 16:25 ET: cards, page-derived (as-of), rollup fallbacks **with the reason**, empty, failed, page p50/p95, most-asked | **#render-alerts** (`DISCORD_RENDER_ALERT_WEBHOOK`) | `DISCORD_FLOW_STATS_ENABLED` |
| 3 | **Window buttons on the `/flow` card** — 1D · 5D · 20D · All beside *View chart*; a click redraws the SAME message (type 6) for that window; the lit button is the window actually on screen (a widened card lights the wider one) | the card itself | none — revert the commit |
| 4 | **`/flow` pre-warm** — every 120 s in market hours, re-derives the page product for up to 4 names asked in the last hour, inside a 40 s budget; takes a build lane only if free, never queues | faster cards; nothing posted | `DISCORD_FLOW_HOTWARM_ENABLED` |
| 5 | **V2 `/flow` deadline 60 s** while the page card is on (the runtime default is 15 s, and its watchdog would tell the member the render FAILED before the 45 s page wait ended) | no false "failed" notice | follows `DISCORD_FLOW_CARD_PAGE_ENABLED` |

## The ledger behind #2

`/data/flow_card_stats.db` (`FLOW_CARD_STATS_DB_PATH`), table `flow_card_outcomes(ts, ticker,
source, days, outcome, reason, ms)`, written by `run_flow_card_job` on every card and pruned past
30 days. Outcomes: `page` · `page_asof` · `rollup_fallback` (+ the reason the page card could not
be had: `timeout`, `busy`, `too big`, `not warm`, `bundle unavailable`, `http N`, `bad body`,
`no worker url`) · `rollup` (page card off) · `empty` · `failed` (+ the failure class). **No member
identity is stored.** A write never raises into the job.

## Verify after deploy

1. ~4 min after the web boot, **#render-smoke** carries `✅ render smoke · web <sha> · …`.
2. Run `/flow AMD` in #chart-flow-requests; the card carries five buttons with the served window
   lit; click **20D** — the same message redraws with 20D lit.
3. The 16:25 ET line in #render-alerts reports that card.

## Rails

`tests/test_discord_render_ops.py` (16), mutation-proved 11/11: the market-hours gate, the bot →
webhook fallback, the weekly = daily check, the lit window, the type-6 ack, the fallback reason,
page vs as-of, served vs asked window, the V2 deadline, the scheduler registration, and the
declined-page reason. The stored golden `instruments/goldens/prev2_replies.json` carries the new
button row for the two delivered `/flow` scenarios; its seven OTHER drift items (buzz board, the
"reconnecting" wording, two PNG hashes) are pre-existing on `origin/master` `8ecf428bc` and are
not this change's to re-bless.

**Update 2026-09-26:** all seven traced and refreshed on `fix/discord-render-goldens-stale`, each by cause:
two card hashes = the `derivation` field added 2026-09-25 (reproduced exactly by removing that one key);
two failure sentences = `a3044a667` (2026-09-17) naming the real cause instead of "reconnecting"; the buzz
board = the INSTRUMENT's stub, which rejected the required `cls=` argument added by `83e430adf` (2026-09-15) and
so recorded no image. The stub now takes the class and hashes it by name (`member`). The goldens test is green
(16/16) and catches a changed render class and a changed window label.

## 2026-09-26 — the smoke covers intraday; the golden runs in the deploy gate

- The smoke renders **D, W, 60m and 5m** (`SMOKE_CHART_TFS`) and checks that the newest **5m** bar
  reaches `last_closed_session()` — the most recent NYSE session whose 16:00 ET close has passed,
  holiday-aware via `bars_fetch._is_nyse_holiday`. A render alone cannot see a frozen feed: a chart
  of four-day-old bars draws perfectly. The line now reads e.g. `5m fresh ok (last bar Fri Sep 25)`.
- The master deploy gate runs `test_discord_render_goldens.py` + `test_discord_render_ops.py`
  (~10 s; extra installs `fastapi tzdata matplotlib pynacl`, measured as their whole import closure).
  **ADVISORY** (`continue-on-error`) until its first green Linux run is recorded, then gating.
- The wiring test now reads `api/main.py` by AST instead of importing it, so it runs on the gate's
  small install.
