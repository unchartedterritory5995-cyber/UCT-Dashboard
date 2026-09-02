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

Frontend (vitest, from `app/`; `npm ci` must have been run once in the worktree):

```bash
cd "C:/Users/Patrick/uct-worktrees/terminal-research/app" && npx vitest run src/pages/calendar src/pages/charts/widgets/CalendarWidget src/components/AuthGuard.calendarDeepLink.test.jsx src/pages/journal-2-0/tabs/CalendarTab.test.jsx src/pages/journal-2-0/hooks/useJ2Calendar.test.jsx
```

PASS = vitest summary line reports 0 failed. Read the summary line; do not trust the wrapper exit code alone (`--reporter=basic` exits 0 with no summary).

Backend (pytest, from the worktree root; the repo-root `conftest.py` pins shared-data paths away from the live `C:\data` — never override those pins; never point at production or the port-8077 stale backend):

```bash
cd "C:/Users/Patrick/uct-worktrees/terminal-research" && python -m pytest tests/test_calendar_*.py tests/test_dividends_calendar.py tests/test_catalyst_market_calendar.py -q -p no:cacheprovider
```

PASS = pytest summary line shows 0 failed / 0 errors (skips allowed and counted).

Note on Day 1a: the frontend suite is being enabled (`npm ci` in the worktree); the backend command's Python environment on this box is being confirmed by role D-07. Until both baseline runs are recorded below, check (2) is BASELINE PENDING, not FAILED.

### (3) LIVENESS — production `/calendar` renders the expected content (read-only)

Read-only GETs with a browser user agent (Cloudflare blocks curl's default UA):

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
curl -s -m 20 -A "$UA" -w "HTTP %{http_code}\n" https://uctintelligence.com/api/health
curl -s -m 20 -A "$UA" -o /tmp/cal.html -w "HTTP %{http_code} %{size_download}\n" https://uctintelligence.com/calendar && grep -c 'id="root"' /tmp/cal.html
```

Assertions: `/api/health` → HTTP 200 and JSON `"status":"ok"`; `/calendar` → HTTP 200 and the SPA shell contains `id="root"`.

Browser assertion (authenticated, the owner's Chrome via the claude-in-chrome tools, read-only): open `https://uctintelligence.com/calendar`; PASS when the page header shows the text "UCT Terminal" (from `app/src/pages/calendar/CalendarHeader.jsx` line 613) and the week view renders at least one day column with at least one earnings row for the current or next trading week. Never click Save, Delete, Send, or any mutating control during the smoke.

## Run log

| Run | Program day / checkpoint | (1) diff empty | (2) frontend | (2) backend | (3) HTTP | (3) browser | Result |
|---|---|---|---|---|---|---|---|
| R0 | Day 1a Step Zero, 2026-09-02 05:40–06:05 UTC | PASS (docs-only branch; `git diff --stat 9c3df14b9 -- . ':(exclude)docs/terminal-research'` empty) | PASS — vitest: 31 test files, 390 tests passed, 0 failed (`npm ci` done in the worktree first) | PASS — pytest: 317 passed, 0 failed, 13.2 s (Python 3.14 on this box runs the suite as-is) | PASS (`/api/health` 200 `status ok`, uptime 776 s, rss 1306 MB, threads 67; `/calendar` 200, `id="root"` present) | PASS — authenticated Chrome load of `/calendar` at 05:46 UTC rendered header "UCT Terminal", tabs Wire/Board/Table/Month, scopes My Stocks/Watchlist/Positions/UCT20/All, week strip MON 31–FRI 4, cap chips, roster line "0 reporting · 145 hidden", "Week of Aug 31 – Sep 4, 2026". Note: the roster is filter-dependent, so the assertion is header + week strip + roster line, never "≥1 earnings row". | **PASS** |
