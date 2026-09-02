# PROTECTION RAIL — Terminal-Current must remain intact

Document B §14A, §49 item 25. Run at every checkpoint. A failed rail halts research until resolved.

## Recorded start state (Step Zero, program Day 1a, 2026-09-02 05:39 UTC)

| Item | Value |
|---|---|
| Start SHA (origin/master at program start) | `9c3df14b9` — "Merge remote-tracking branch 'origin/master' into feat/discord-buzz" |
| Research branch | `terminal-research`, remote `origin/terminal-research` |
| Research worktree | `C:\Users\Patrick\uct-worktrees\terminal-research` |
| Charter commit | `a4ef6f240` (docs-only; five charter files byte-identical to `Documents\uct-terminal-program\prompts\`, verified with `cmp` on 2026-09-02) |
| origin/master re-checked after `git fetch origin` on 2026-09-02 05:39 UTC | still `9c3df14b9` — no drift since worktree creation |
| Production host | `https://uctintelligence.com` (Railway service `web`, project `luminous-recreation`; Railway host `web-production-05cb6.up.railway.app`) |

"Application source paths" = every path in the repository EXCEPT `docs/terminal-research/`. The rail proves that nothing outside the research tree differs from the start SHA.

## The three checks (exact commands; identical at every run)

### (1) PROOF — application paths unchanged from the start SHA

```bash
git -C "C:/Users/Patrick/uct-worktrees/terminal-research" diff --stat 9c3df14b9 -- . ':(exclude)docs/terminal-research'
```

PASS = empty output. Any line = FAIL.

Also record `git -C ... status --porcelain -- . ':(exclude)docs/terminal-research'` (untracked or modified application files) — must be empty apart from ignored build artifacts (`app/node_modules`, `app/dist`).

### (2) LIVENESS — the tests that cover Terminal-Current pass, in the research worktree, against a local backend only

Frontend (vitest, from `app/`; `npm ci` must have been run once in the worktree). Vitest positional arguments are SUBSTRING FILTERS, so a renamed or deleted file makes the run shrink silently (D-07 finding). The rail therefore (a) names every file explicitly, (b) pre-checks that each exists, and (c) asserts the file count in the summary line. Tightened 2026-09-02 (DL-009); the file list is the 31 files the R0 run executed.

```bash
cd "C:/Users/Patrick/uct-worktrees/terminal-research/app" && FILES="src/components/AuthGuard.calendarDeepLink.test.jsx src/pages/calendar/Calendar.deepLinkWeek.test.jsx src/pages/calendar/Calendar.earningsRoute.test.jsx src/pages/calendar/Calendar.realModal.test.jsx src/pages/calendar/Calendar.weekNav.test.jsx src/pages/calendar/CalendarDayTable.test.jsx src/pages/calendar/CalendarHeader.test.jsx src/pages/calendar/EarningsCard.test.jsx src/pages/calendar/MyStocksHub.crashRecovery.test.jsx src/pages/calendar/MyStocksHub.stepping.test.jsx src/pages/calendar/WeekView.rankWire.test.jsx src/pages/calendar/WireView.coverage.test.jsx src/pages/calendar/WireView.test.jsx src/pages/calendar/callRecap.test.jsx src/pages/calendar/earningsLifecycle.test.js src/pages/calendar/earningsModalRow.test.js src/pages/calendar/eventCard.test.jsx src/pages/calendar/filterLogic.test.js src/pages/calendar/impliedMoveReason.test.jsx src/pages/calendar/importance.test.js src/pages/calendar/monthGrid.test.js src/pages/calendar/myStocksHub.test.jsx src/pages/calendar/rankOrder.test.js src/pages/calendar/refusalLastHops.test.jsx src/pages/calendar/todaysBrief.test.jsx src/pages/calendar/useCalendarData.test.js src/pages/calendar/useEarningsModalRoute.test.jsx src/pages/calendar/weekAnchor.test.js src/pages/charts/widgets/CalendarWidget.weekIntent.test.jsx src/pages/journal-2-0/hooks/useJ2Calendar.test.jsx src/pages/journal-2-0/tabs/CalendarTab.test.jsx" && for f in $FILES; do [ -f "$f" ] || { echo "RAIL FAIL: missing $f"; exit 1; }; done && npx vitest run $FILES
```

PASS = every named file exists AND the summary reads `Test Files 31 passed (31)` with 0 failed. Read the summary line; do not trust the wrapper exit code alone (`--reporter=basic` exits 0 with no summary). If Terminal-Current gains a calendar test file, ADD it here (the rail may tighten, never loosen).

Backend (pytest, from the worktree root; the repo-root `conftest.py` pins shared-data paths away from the live `C:\data` — never override those pins; never point at production or the port-8077 stale backend). Widened 2026-09-02 (DL-009) to include the market-calendar router, economic-calendar (FMP), and IPO-calendar suites that feed the surface:

```bash
cd "C:/Users/Patrick/uct-worktrees/terminal-research" && python -m pytest tests/test_calendar_*.py tests/test_dividends_calendar.py tests/test_catalyst_market_calendar.py tests/test_econ_calendar_fmp.py tests/test_ipo_calendar.py tests/test_market_calendar_router.py -q -p no:cacheprovider
```

PASS = pytest summary line shows 0 failed / 0 errors (skips allowed and counted); baseline 374 passed.

### (3) LIVENESS — production `/calendar` renders the expected content (read-only)

Read-only GETs with a browser user agent (Cloudflare blocks curl's default UA):

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
curl -s -m 20 -A "$UA" -w "HTTP %{http_code}\n" https://uctintelligence.com/api/health
curl -s -m 20 -A "$UA" -o /tmp/cal.html -w "HTTP %{http_code} %{size_download}\n" https://uctintelligence.com/calendar && grep -c 'id="root"' /tmp/cal.html
```

Assertions: `/api/health` → HTTP 200 and JSON `"status":"ok"`; `/calendar` → HTTP 200 and the SPA shell contains `id="root"`.

Browser assertion (authenticated, the owner's Chrome via the claude-in-chrome tools, read-only): open `https://uctintelligence.com/calendar`; PASS when the page header shows the text "UCT Terminal" (from `app/src/pages/calendar/CalendarHeader.jsx` line 613), the week strip renders five day columns for the current or next trading week, and the roster line renders (either "N reporting · M hidden" or "No reporters scheduled"). The roster is filter-dependent, so NEVER assert a row count (DL-002). Never click Save, Delete, Send, or any mutating control during the smoke.

## Master drift log (DL-011)

| Read (UTC) | origin/master | Commits since start | Files | Touches Terminal-Current? |
|---|---|---|---|---|
| 2026-09-02 07:05 | `c9ae85fb6` | 6 (buzz digest board, indicator-endzone manifest, runbook, formula doc) | 11 (3 `app/src`, 2 `api/services`, tests, docs) | No |
| 2026-09-02 08:05 | `e41d0dcfa` | +1 (notebook handler-refusal walk fix); production redeployed (uptime 109 s at 08:05) | notebook code + tests | No |

## Run log

| Run | Program day / checkpoint | (1) diff empty | (2) frontend | (2) backend | (3) HTTP | (3) browser | Result |
|---|---|---|---|---|---|---|---|
| R0b | Day 1a, 2026-09-02 06:50 UTC, after tightening (DL-009) | PASS (diff empty; only untracked scratch `routers_inv.txt` left by an agent, removed after Wave 1) | PASS — same 31 files, 390 tests (explicit list) | PASS — widened set: 374 passed, 0 failed, 14.3 s | (unchanged from R0) | (unchanged from R0) | **PASS** |
| R0 | Day 1a Step Zero, 2026-09-02 05:40–06:05 UTC | PASS (docs-only branch; `git diff --stat 9c3df14b9 -- . ':(exclude)docs/terminal-research'` empty) | PASS — vitest: 31 test files, 390 tests passed, 0 failed (`npm ci` done in the worktree first) | PASS — pytest: 317 passed, 0 failed, 13.2 s (Python 3.14 on this box runs the suite as-is) | PASS (`/api/health` 200 `status ok`, uptime 776 s, rss 1306 MB, threads 67; `/calendar` 200, `id="root"` present) | PASS — authenticated Chrome load of `/calendar` at 05:46 UTC rendered header "UCT Terminal", tabs Wire/Board/Table/Month, scopes My Stocks/Watchlist/Positions/UCT20/All, week strip MON 31–FRI 4, cap chips, roster line "0 reporting · 145 hidden", "Week of Aug 31 – Sep 4, 2026". Note: the roster is filter-dependent, so the assertion is header + week strip + roster line, never "≥1 earnings row". | **PASS** |
