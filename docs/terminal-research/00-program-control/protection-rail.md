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

"Application source paths" = every path in the repository EXCEPT `docs/terminal-research/`.

---

# ⛔⛔ RAIL RE-SCOPED 2026-09-11 — IT WAS MEASURING THE WRONG TREE

**Owner ruling 3, 2026-09-11: Terminal-Next is a BUILD program, and check (1) now diffs
`origin/master`, not this worktree.**

⚰️ **What the old check actually proved, and what everyone read it as.** Check (1) diffed *this
worktree* against the start SHA. This worktree only ever receives docs commits, so the diff was
empty by construction and the rail returned PASS at every checkpoint — three times on 2026-09-02
alone, each recorded as evidence that "zero application code was touched."

**In the same 24 hours the program shipped 17 application commits to `origin/master`** from
separate branches this worktree cannot see. Measured on 2026-09-11:

| what shipped | commits | when |
|---|---|---|
| **S3 Entity Master** — created from nothing: schema, read primitives, write path, seed script (with a REAL seed run), provider mapping, reconciliation, adversarial validation | `3c762d25e` `8424b8be5` `195e8e24c` `114052d2d` `f1b75e270` `baaf28906` `53b99ad5a` | 09-02 17:51 → 18:54 |
| **D1 Provider Abstraction** — provenance/freshness hardening, entitlement distinction, stale detection | `9d0b5eb26` | 09-02 21:44 |
| **S8 Provenance & Freshness** — Steps 1, 2 (front + back), `<Cited>` interim form (front + back) | `7adf80bd4` `834b45df4` `8d04bf75f` `03d399a52` `48bba9614` | 09-02 22:15 → 23:58 |
| **S11 Session & Market Clock** | `e14a5836b` `1cf0bf028` | 09-03 07:03 → 07:19 |
| **A3/A4 vertical slice** — `/research/:sym` Estimates + Financials onto S3+D1+S8+S11 | `408f04935` | 09-03 08:44 |
| **A5 Events & Calendar modernization** onto S3/D1/S8 | `1214dc246` | 09-03 15:07 |

**33 files, 5,274 insertions** across the four systems' own paths alone.

⛔⛔ **The last row is why this rail exists, and it is the one the rail missed.** `1214dc246`
modified **Terminal-Current itself** — `api/routers/calendar.py` (163 lines), `app/src/pages/Calendar.jsx`,
`app/src/pages/calendar/CalendarHeader.jsx`, `earningsModalRow.js` and three of its test files. Those
are the exact paths this document's own drift log was checking for when it recorded "no path under
`app/src/pages/calendar/`, `app/src/pages/Calendar.jsx`, or `api/routers/calendar.py` appears in the
diff — Terminal-Current itself untouched." That entry was true of `origin/master`'s *other*
workstreams and false of this program's own work, and the rail could not tell the difference because
it was pointed at a tree containing neither.

⭐ **The general form, worth carrying past this program: a diff proves something about the tree you
diffed, and nothing whatsoever about any other tree.** A rail scoped to the place the work is *not*
happening returns PASS forever, and a PASS forever reads as evidence.

⛔ **THE TABLE ABOVE IS ITSELF AN UNDERCOUNT — see `PROGRAM_STATUS.md`'s implementation ledger.** The
first re-scoped run used a program-owned *path* manifest and a subject filter that omitted `S7`. The
true figure is **50 commits, 207 files, 22,049 insertions** on branch `feat/entity-master`, merged as
`ed6b1f041` on 2026-09-05, additionally covering **S1, S2 (a command palette), S7 Alerts, A6–A8 and
I1** — and D1's full ACL boundary, not merely the hardening pass named above. The ledger is the
authority; this table is kept as the record of what the first re-scoped run surfaced.

⭐ **Two undercounts in one hour, from the same cause, and the lesson is the rail's:** a
**path-filtered** log answers *"what touched this path,"* and a **subject-filtered** log answers
*"what did I think to grep for."* Neither answers *"what did this program ship."* The reliable query
is the merge itself — `git log ed6b1f041^1..ed6b1f041^2`. ⚠️ A corollary already bit once: an earlier
revision of this file recorded "there is no Checkpoint 6 anywhere in the repository's history."
**Checkpoint 6 exists** (`5ecdae012`, "compatibility integration"); it simply touched paths outside
the filter. **A filtered absence is not an absence.**

---

## The three checks (exact commands; identical at every run)

### (1) PROOF — what this program has shipped to production, and whether Terminal-Current moved

Three parts. **(1a) is the old check, kept and re-labelled to what it actually proves.**

**(1a) This worktree has shipped no application code.** Still worth asserting — the orchestrator
must remain docs-only — but it is NOT evidence about the program.

```bash
git -C "C:/Users/Patrick/uct-worktrees/terminal-research" diff --stat 9c3df14b9 -- . ':(exclude)docs/terminal-research'
```

PASS = empty output. ⛔ **A PASS here says nothing about `origin/master`. Never cite it as "the
program touched no code."**

**(1b) Program-authored application code on `origin/master`.** Run against the program-owned path
manifest; every commit returned must be one this program's documents record.

```bash
cd "C:/Users/Patrick/uct-worktrees/terminal-research" && git fetch origin master -q && \
PROGPATHS="app/src/components/provenance app/src/lib/marketClock api/routers/provenance_quote.py api/routers/provenance_bar.py api/services/bar_provenance.py app/src/pages/ProvenanceDemo.jsx api/services/entity_master" && \
git log --format='%h %ci %s' 9c3df14b9..origin/master -- $PROGPATHS
```

PASS = every commit listed is recorded in `PROGRAM_STATUS.md`'s implementation ledger. **An
unrecorded commit is a FAIL** — it means code shipped that no program document knows about, which
is precisely the 2026-09-02/03 condition. ⛔ PASS is no longer "empty output"; a build program's
rail that demands emptiness would fail on its own successful work. Extend `PROGPATHS` whenever a
system ships its first file — a manifest that lags the build is a blind spot with a different shape.

**(1c) Did the program move Terminal-Current?** The invariant this rail is named for.

```bash
git log --format='%h %ci %s' 9c3df14b9..origin/master -- app/src/pages/calendar app/src/pages/Calendar.jsx api/routers/calendar.py
```

This returns other workstreams' commits too, which is expected and fine. **The assertion is that
every PROGRAM-authored commit in that list is owner-authorized and recorded.** As of 2026-09-11
exactly one qualifies — `1214dc246` — and it is recorded as authorized-but-undocumented, pending the
owner's read.

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
| 2026-09-02 (checkpoint) | `dd57711f0` | 54 commits total since start SHA `9c3df14b9` (superseding the `2b34fee4e` reading below); touched dirs by count: `api/services` (26), `app/src` (20), `api/routers` (5), plus test/docs/tools files | Notably `api/services/journal_two/calendar.py` + its test -- this is the JOURNAL 2.0 CALENDAR TAB (a distinct feature per the system map), NOT the `/api/calendar/*` Terminal-Current router or `app/src/pages/calendar/*`; no path under `app/src/pages/calendar/`, `app/src/pages/Calendar.jsx`, or `api/routers/calendar.py` appears in the diff | No -- confirmed by path; Terminal-Current itself untouched. Flagged for a quick double-check next session since the naming collision ("calendar" in two features) is exactly the kind of thing that has caused confusion before in this codebase. |
| 2026-09-02 16:06 | `2b34fee4e` | (superseded by the `dd57711f0` row above) | — | — |
| 2026-09-02 08:05 | `e41d0dcfa` | +1 (notebook handler-refusal walk fix); production redeployed (uptime 109 s at 08:05) | notebook code + tests | No |

## Run log

| R1 | Recovery checkpoint, 2026-09-02 (after third pause) | PASS (`git diff --stat 9c3df14b9 -- . ':(exclude)docs/terminal-research'` empty) | PASS -- 31 files, `Test Files 31 passed (31)` | PASS -- 374 passed, 0 failed, 14.5s | PASS (`/api/health` 200 `status: ok`, uptime 558s -- production redeployed since R0, consistent with 54 commits on origin/master since the start SHA) | not re-run this checkpoint (unauthenticated HTTP checks sufficient; last browser check at R0 still valid, header/week-strip/roster line unchanged in structure) | **PASS** |
| R2 | Day 1 close (six-task recovery wave + Bloomberg deepening + Day 1 Executive Synthesis all accepted), 2026-09-02 ~14:20 CDT | PASS (`git diff --stat 9c3df14b9 -- . ':(exclude)docs/terminal-research'` empty -- this entire checkpoint was docs-only: 11 new/updated research artifacts, zero application-code touches) | not re-run this checkpoint (docs-only session; nothing in `app/src` could have regressed) | not re-run this checkpoint (docs-only session; nothing in `api/` could have regressed) | PASS (`/api/health` 200, `/calendar` 200, both via `curl` with a browser User-Agent) | not re-run this checkpoint (no frontend change since R1 to verify) | **PASS** |

| Run | Program day / checkpoint | (1) diff empty | (2) frontend | (2) backend | (3) HTTP | (3) browser | Result |
|---|---|---|---|---|---|---|---|
| R0b | Day 1a, 2026-09-02 06:50 UTC, after tightening (DL-009) | PASS (diff empty; only untracked scratch `routers_inv.txt` left by an agent, removed after Wave 1) | PASS — same 31 files, 390 tests (explicit list) | PASS — widened set: 374 passed, 0 failed, 14.3 s | (unchanged from R0) | (unchanged from R0) | **PASS** |
| R0 | Day 1a Step Zero, 2026-09-02 05:40–06:05 UTC | PASS (docs-only branch; `git diff --stat 9c3df14b9 -- . ':(exclude)docs/terminal-research'` empty) | PASS — vitest: 31 test files, 390 tests passed, 0 failed (`npm ci` done in the worktree first) | PASS — pytest: 317 passed, 0 failed, 13.2 s (Python 3.14 on this box runs the suite as-is) | PASS (`/api/health` 200 `status ok`, uptime 776 s, rss 1306 MB, threads 67; `/calendar` 200, `id="root"` present) | PASS — authenticated Chrome load of `/calendar` at 05:46 UTC rendered header "UCT Terminal", tabs Wire/Board/Table/Month, scopes My Stocks/Watchlist/Positions/UCT20/All, week strip MON 31–FRI 4, cap chips, roster line "0 reporting · 145 hidden", "Week of Aug 31 – Sep 4, 2026". Note: the roster is filter-dependent, so the assertion is header + week strip + roster line, never "≥1 earnings row". | **PASS** |
