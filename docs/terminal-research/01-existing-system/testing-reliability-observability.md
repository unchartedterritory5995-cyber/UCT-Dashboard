---
id: D-07
title: Testing, reliability and observability — current state of the dashboard
role: Testing / Reliability / Observability Engineer
wave: 1
group: D
category: internal-system
scope: uct-dashboard (research worktree `C:\Users\Patrick\uct-worktrees\terminal-research`, branch `terminal-research`)
confidence: 🟢 high on everything executed or read on disk; 🟡 on production-runtime claims
evidence_ceiling: No production access. Every statement about what runs on Railway (scheduler jobs firing, monitors posting, flags actually set) is a CLAIM read from code/config — no logs, no `railway` CLI, no health endpoint were consulted. GitHub branch-protection / required-checks state is not visible from the repo.
sources: pytest.ini, conftest.py, tests/conftest.py, app/vite.config.js, app/src/test-setup.js, .github/workflows/optionsflow-guard.yml, railway.json, api/main.py, api/services/readiness.py, api/services/serve_stale.py, api/event_loop_watchdog.py, api/flow_watchdog.py, api/services/disk_watchdog.py, api/services/provider_coverage_monitor.py, api/services/chart_health_alerts.py, api/deploy_log.py, api/services/feature_flag_index.py, docs/feature_flags.json, tools/flag_ledger_audit.py, docs/runbooks/*, docs/operations/*
uct_relevance: high
status: draft
date: 2026-09-02
---

# D-07 — Testing / Reliability / Observability (current state)

TERMINAL-CURRENT is the existing surface at route `/calendar`, display-named "UCT Terminal" since 2026-09-01. TERMINAL-NEXT is the product this program designs. Everything below describes what protects TERMINAL-CURRENT today.

---

## 0. HEADLINE

The dashboard has an **unusually deep, self-aware, entirely local test estate** — 1,188 collectable backend test files, 959 frontend test files, AST-derived rails that refuse to be typed by hand, mutation gauntlets with positive controls, and a repo-root tripwire that makes "the suite did not touch production data" a *measurement* rather than an assumption. It has **almost no CI**: one narrow GitHub workflow scoped to a single page, and **nothing whatsoever gates a deploy**. Deploy is `git push` → Railway. The gap between the quality of the rails and the fact that no automated gate stands between a red suite and production is the single largest reliability finding in this contract.

---

## 1. Protection-rail check (2) — EXECUTED

Both commands were run by me, in this worktree, on 2026-09-02. Exact summary lines recorded verbatim.

### 1.1 Frontend rail

```
cd C:/Users/Patrick/uct-worktrees/terminal-research/app && npx vitest run \
  src/pages/calendar \
  src/pages/charts/widgets/CalendarWidget \
  src/components/AuthGuard.calendarDeepLink.test.jsx \
  src/pages/journal-2-0/tabs/CalendarTab.test.jsx \
  src/pages/journal-2-0/hooks/useJ2Calendar.test.jsx
```

**Summary lines, verbatim:**

```
 Test Files  31 passed (31)
      Tests  390 passed (390)
   Start at  01:00:09
   Duration  7.32s (transform 12.63s, setup 6.82s, import 25.63s, tests 10.65s, environment 26.12s)
[exited with code 0]
```

Non-fatal `stderr` noise inside `Calendar.realModal.test.jsx`: `[ECharts] Can't get DOM width or height…` (jsdom has no layout). It does not fail the run and is a known consequence of the canvas/ECharts shims in `app/src/test-setup.js`.

**OBSERVATION.** The rail reproduces exactly. 31 files / 390 tests, ~7.3 s wall.

**EVIDENCE.** Run above; file inventory measured with `find`/`ls`:
* `app/src/pages/calendar/` holds **27** `*.test.*` files.
* `app/src/components/AuthGuard.calendarDeepLink.test.jsx` — exists.
* `app/src/pages/journal-2-0/tabs/CalendarTab.test.jsx` — exists.
* `app/src/pages/journal-2-0/hooks/useJ2Calendar.test.jsx` — exists.
* `app/src/pages/charts/widgets/CalendarWidget.test.jsx` — **DOES NOT EXIST.** The only matching test file is `app/src/pages/charts/widgets/CalendarWidget.weekIntent.test.jsx`.

27 + 1 + 1 + 1 + 1 = 31. CONFIRMED by the run's own file count.

**INTERPRETATION — and a live fragility.** Vitest positional arguments are **substring filters over test-file paths**, not paths that must resolve. The argument `src/pages/charts/widgets/CalendarWidget` matched `CalendarWidget.weekIntent.test.jsx` by substring. That is convenient here, but it means **a filter that matches nothing contributes zero files and the run still exits 0**. Rename or delete a file this rail names and the rail silently shrinks — it reports "31 passed" today and would report "30 passed" tomorrow with no failure, no warning, and no one reading the number. This is precisely the *gate-that-cannot-fail* shape this repo has documented repeatedly (`pytest.ini`'s own comment about `testpaths` being ignored the moment a path argument is passed; `tests/test_startup_fingerprint.py`'s stale-`4` story).

**RELEVANCE TO UCT.** If protection-rail check (2) is going to be the standing gate for calendar work during the Terminal-Next program, the file COUNT must be asserted, not read. A one-line addition — assert `Test Files N passed` where N is derived from a glob, or replace the four hand-typed filters with a committed list the suite itself validates — converts an observation into a rail.

**CONFIDENCE.** 🟢 high (executed; file inventory measured).

**RECOMMENDATION.** Pin the expected file count for the rail, derived from disk rather than typed. Consider replacing the four ad-hoc filters with a `--project`/glob or a committed `calendar-rail.txt` that a test validates against the filesystem.

**OPEN QUESTION.** Was `CalendarWidget.test.jsx` renamed to `CalendarWidget.weekIntent.test.jsx`, or did the rail command ever name a file that existed?

### 1.2 Backend rail

```
cd C:/Users/Patrick/uct-worktrees/terminal-research && python -m pytest \
  tests/test_calendar_*.py tests/test_dividends_calendar.py \
  tests/test_catalyst_market_calendar.py -q -p no:cacheprovider
```

**Summary line, verbatim:**

```
317 passed, 35764 warnings in 13.69s
[exited with code 0]
```

Zero failed, zero skipped, zero errors. Progress line shows a clean five-row dot field (`[100%]`).

**OBSERVATION.** The backend rail runs cleanly in this environment on the box Python. No project venv is required.

**EVIDENCE.**
* `python -V` → **Python 3.14.0**. `python -m pytest --version` → **pytest 8.3.4**.
* `import sqlalchemy` → `ModuleNotFoundError`. **It is not needed** — the rail passes without it. The dashboard's stores are raw `sqlite3` (`api/services/auth_db.py`, `bars_sqlite.py`, `cot_service.py`, …); no ORM.
* `import pytest_timeout` → OK (required by `pytest.ini`'s `timeout = 300`, and pinned per `tests/test_requirements_pins.py`).
* **No `.venv` exists in this worktree.** `run-local.ps1` assumes one at `.venv\Scripts\python.exe` and *exits 1* with setup instructions if absent — so the owner's documented local-dev path is a venv, but the test rail does not depend on it.
* `CLAUDE.md` → "Running Locally" gives **only** `uvicorn api.main:app --reload --port 8000` and `cd app && npm run dev`. **It documents no test command at all.** The `-q -p no:cacheprovider` convention is documented only inside plan files (e.g. `docs/superpowers/plans/2026-08-25-discord-chart-command.md`, which repeats `python -m pytest tests/<file> -q -p no:cacheprovider` at every task).

**INTERPRETATION.** The 35,764 warnings are almost entirely `DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16`, raised from `pytest_asyncio`, `fastapi/routing.py`, `starlette/_utils.py` and `slowapi/extension.py` — i.e. **third-party**, on Python 3.14. One is first-party: `api/baselines.py:456` uses `datetime.utcnow()`. This is warning *debt*, not failure, but at 35,764 lines it means the run's own output is unreadable and any *new* first-party warning is invisible.

**RELEVANCE TO UCT.** Terminal-Next will add routers and services. A warning field this loud means a genuine deprecation in new code will not be noticed. The remedy is a `filterwarnings` block in `pytest.ini` that silences the four known third-party sources by module and lets first-party warnings through.

**CONFIDENCE.** 🟢 high (executed).

**RECOMMENDATION.** Add targeted `filterwarnings` ignores keyed to the four third-party modules; fix `api/baselines.py:456`. Add the two rail commands to `CLAUDE.md` "Running Locally" — right now the only place a new engineer can learn the invocation is a plan file about a Discord command.

### 1.3 Does the selected set actually cover the calendar?

**File inventory.** `tests/*calendar*` matches **33** files. The rail selects **30** of them (28 `test_calendar_*.py` + `test_dividends_calendar.py` + `test_catalyst_market_calendar.py`).

**Three calendar test files are NOT in the rail:**

| Excluded file | What it covers (measured by its imports) |
|---|---|
| `tests/test_econ_calendar_fmp.py` | `api/services/econ_calendar_fmp.py` — the macro/econ band |
| `tests/test_ipo_calendar.py` | `api/services/ipo_calendar.py` — IPO event type |
| `tests/test_market_calendar_router.py` | `api/routers/market_calendar.py` — a whole router |

A fourth, `api/services/journal_two/test_calendar.py` (the J2 calendar backend), is also outside the rail — it lives under `api/**`, which the rail's `tests/`-only globs never reach.

**What the 30 selected files DO reach**, counted by dotted-path references across the selection:

| Module | refs |
|---|---|
| `api.routers.calendar` | 86 |
| `api.services.dividends_calendar` | 14 (+17 cache patch points) |
| `api.services.cache` | 9 |
| `api.services.econ_calendar_fmp.fetch_us_econ_week` | 7 (patched, not exercised) |
| `api.services.massive._get_client` | 7 |
| `api.services.engine._load_wire_data` | 6 |
| `api.services.earnings_estimates.get_earnings_intel` | 6 |
| `api.services.earnings_enrichment.get_implied_move` | 5 |
| `api.services.calendar_anticipated_png` / `calendar_week_png` / `calendar_png_common` | 11 |
| `api.services.calendar_seen`, `calendar_sector_read`, `ticker_meta`, `industry_map`, `serve_stale`, `ticker_logos`, `watchlist_alert_service`, `finnhub_client` | 1–5 each |

**OBSERVATION.** The rail covers the **primary calendar router very thoroughly** and the enrichment/PNG/personalization/seen/alerts services well. It does **not** cover a second calendar router (`market_calendar.py`), the IPO event source, or the econ source as anything but a patched stub.

**EVIDENCE.** `grep -ho 'api\.routers\.[a-z_]*\|api\.services\.[a-z_]*'` over the 30 selected files versus the 3 excluded ones; `ls api/routers | grep -i calendar` → `calendar.py`, `earnings.py`, `earnings_intel.py`, `market_calendar.py`.

**INTERPRETATION.** `tests/test_calendar_*.py` is a *naming* convention, and the rail's glob inherits its blind spots. `market_calendar`, `ipo_calendar` and `econ_calendar_fmp` are calendar-critical paths whose test files simply do not begin with `test_calendar_`. The rail's own filename pattern is doing the selecting, not a statement about what the calendar is.

**RELEVANCE TO UCT.** Terminal-Next will almost certainly reuse or replace these surfaces. A rail that silently omits an entire router is a rail that will read green through a `market_calendar` regression.

**CONFIDENCE.** 🟢 high.

**RECOMMENDATION — the only additions I would propose, and only these three:**
1. Add `tests/test_market_calendar_router.py` — it is the only test for a mounted router that the rail excludes.
2. Add `tests/test_ipo_calendar.py` and `tests/test_econ_calendar_fmp.py` — both are event types the calendar surface renders, and both are currently only *mocked* inside the rail, never exercised.
3. Consider `api/services/journal_two/test_calendar.py` if the J2 calendar is in Terminal-Next scope (the rail's frontend half already includes `CalendarTab` and `useJ2Calendar`, so the backend half is asymmetric).

**OPEN QUESTION.** Is `api/routers/earnings.py` mounted? `CLAUDE.md` records `api/earnings_router.py` as present-but-unmounted; `api/routers/earnings.py` is a different file and I did not verify its mount. D-01/D-02 territory.

---

## 2. Test infrastructure

### 2.1 Counts (measured 2026-09-02)

| Estate | Count | How measured |
|---|---|---|
| Backend test files under `tests/` (recursive, `test_*.py`) | **1,065** | `find tests -name "test_*.py"` |
| Backend test files under `api/**` (`test_*.py` + `*_test.py`) | **123** | `find api \( -name "test_*.py" -o -name "*_test.py" \)` |
| **Backend total collectable** | **1,188** | sum |
| Frontend `*.test.jsx` | **548** | `find app/src -name "*.test.jsx"` |
| Frontend `*.test.js` | **411** | `find app/src -name "*.test.js"` |
| **Frontend total** | **959** | sum |
| `tests/` subdirectories | `api/` (25 files), `pattern_engine/` (11), `theme_curation/`, `theme_engine/`, `fixtures/` | `ls -d tests/*/` |
| api-embedded `*_test.py` (co-located beside the module) | 15 | e.g. `api/services/cache_test.py`, `api/routers/stream_bars_test.py` |
| api-embedded `test_*.py` | 108 | mostly `api/services/journal_two/**` and `api/services/compass_eval/**` |

**Note on the mixed convention.** `api/**` uses BOTH `*_test.py` (co-located, 15) and `test_*.py` (108). That is why `pytest.ini`'s `testpaths` names `api` as a root and why `tests/test_test_discovery_coverage.py` exists — see §2.5.

### 2.2 Frontend — vitest (`app/vite.config.js`, `test:` block)

| Setting | Value | Rationale recorded in-file |
|---|---|---|
| `environment` | `jsdom` | — |
| `globals` | `true` | — |
| `setupFiles` | `./src/test-setup.js` | — |
| `pool` | `forks` | — |
| `execArgv` | `['--max-old-space-size=8192']` | The full suite (~3,100 tests under jsdom + echarts/recharts) OOMs a fork at the default ~4 GB heap. ⛔ **Must stay top-level**: it lived under `poolOptions.forks.execArgv` until 2026-08-01; Vitest 4 removed `poolOptions` and the block was accepted **silently** (deprecation line only) while the flag reached no worker. |
| `maxWorkers` | `'50%'` | Measured table in-file over 377 files: 23 forks (default) → 308–336 s cumulative test time, RED; 12 forks (50%) → 155 s, green; 6 forks (25%) → 97 s, green but 67.5 s wall. "Cumulative test time TRIPLES from 25% to default while wall time barely moves — that extra parallelism is thrashing, not throughput." A **percentage, not a literal**, so a 4-core CI box scales down. |
| `testTimeout` | `15000` | Default 5000 ms measured the scheduler, not the code. Suite wall speed varies ~2× with transform-cache state (191–226 s warm, 377 s after `npm run build`); **115 tests report ≥2,000 ms and 73 report ≥3,333 ms** in a clean run, so the margin is systemic, not one slow test. |
| `server.deps.inline` + `alias` | `@picovoice/porcupine-web` → `src/test-stubs/porcupine-web.js` | The package's `exports` do not resolve under vitest's resolver. |

`stripManifestProse()` (a build plugin) is declared `apply: 'build'` **deliberately**: vitest runs through the same config, and dozens of rails assert on the engine manifest's prose. Stripping it in test would red them.

**`app/src/test-setup.js` (213 lines)** does five things:

1. `configure({ asyncUtilTimeout: 4000 })` — ⛔ **Testing Library's `waitFor`/`findBy` ceiling is SEPARATE from vitest's `testTimeout` and is not raised by it.** Default 1000 ms was "the single largest source of intermittent red". Three consecutive reproductions killed three *different* unrelated tests (`BuilderSheet.plots`, `ImportWizard`, `ArticlesSection`) — "a population, not a defect", which is why pinning "the" flaky test always failed. **4000, not 5000, on purpose**: at exactly `testTimeout` the two deadlines race and you non-deterministically get either the useful "Unable to find an element with the text: …" or the useless "Test timed out in 5000ms".
2. **SWR cache isolation per test** — purges `swrCache` plus the `MUTATION`/`FETCH`/`PRELOAD` bookkeeping from `SWRGlobalState`, leaving `EVENT_REVALIDATORS` alone. Without it, `dedupingInterval` is wall-clock and a later test silently reuses the previous test's resolved data instead of its own `global.fetch` mock.
3. **jsdom shims**: `window.matchMedia`, `EventSource` (for `useRealtimePrices` SSE), `IntersectionObserver`, `ResizeObserver` (Lightweight Charts).
4. **`HTMLCanvasElement.getContext('2d')` stub** — jsdom ships no canvas, so ECharts/zrender's `initContext` (`this.ctx.dpr = …`) and `doClear` (`ctx.clearRect`) fault on `null`. It is a *flake* rather than a hard failure because both calls come off a `requestAnimationFrame` loop and off `dispose()`.
5. Component testing is React Testing Library (`@testing-library/react` ^16.3.2, `user-event` ^14.6.1, `jest-dom` ^6.9.1) — behavioural, DOM-level, with `vi.mock` for hooks and network.

**Scripts** (`app/package.json`): `test` → `vitest run`; `test:watch` → `vitest`. `lint` → `eslint .`; `lint:css` → `stylelint`.

**CONFIDENCE.** 🟢 high — all read from the config files themselves.

### 2.3 Backend — pytest (`pytest.ini`)

Three directives, each with an unusually long recorded rationale:

* **`asyncio_mode = auto`.**
* **`testpaths = tests, api`.** In-file: there were originally NO testpaths, so every runner globbed `tests/**` and walked past **93 collectable files under `api/**` (1,289 of them passing, 3 failing and one HANGING, unnoticed)**. ⚠️ The comment then falsifies its own fix: *"`testpaths` is IGNORED the moment pytest is given a path argument, and the real runners here (chunked suite runs, the mutation gauntlets) all pass explicit paths. So this line alone would be a fix that cannot fail."* The **actual enforcement is `tests/test_test_discovery_coverage.py`** (§2.5).
* **`timeout = 300`** (repo-wide, per test). Origin: `@pytest.mark.timeout(10)` sat on two tests in `api/routers/stream_bars_test.py` **while `pytest-timeout` was not installed** — an unregistered mark silently ignored; that same file hung the whole suite behind an infinite SSE generator and the fix had to be a hand-rolled `faulthandler` watchdog. The number is measured, not picked: slowest single test on this box is **84.3 s** (`tests/pattern_engine/test_schedulers.py::test_universe_scan_job_callable`), next is 37.3 s, **nothing under `api/**` takes even 1 s**; 300 is 3.6× the slowest. It is generous **because on Windows pytest-timeout has no SIGALRM** and falls back to `timeout_method = thread`, which **kills the process** rather than failing one test — a low budget turns a chunk into a dead chunk with no pytest summary. The method is deliberately left auto-selecting so Linux keeps the per-test `signal` behaviour. The file is kept **ASCII-only on purpose** (parsers may open it under the box's cp1252 locale).
* **`markers = benchmark`** — "informational latency benchmarks; not run in CI".

**`-p no:cacheprovider` convention.** Not explained in `pytest.ini` or `CLAUDE.md`. It appears as the standing invocation throughout `docs/superpowers/plans/**` (seven occurrences in the Discord-chart plan alone). Its effect is to suppress `.pytest_cache` writes — consistent with this repo's stated horror of stray writes and with `docs/runbooks/ast-conformance-gate.md`'s sibling rule `PYTHONDONTWRITEBYTECODE=1` on **every** pytest run ("a same-size mutation applied within one second of the previous run imports the previous `.pyc` and the mutation silently never executes"). **NOT DETERMINED**: whether `no:cacheprovider` was adopted for that reason or for `-p no:randomly`-style plugin isolation. What would determine it: the commit that introduced the phrase.

**CONFIDENCE.** 🟢 high on the directives; 🟡 on the `no:cacheprovider` rationale.

### 2.4 The repo-root `conftest.py` — shared-data pins and the `C:\data` tripwire

**This is the single most load-bearing piece of test infrastructure in the repo (1,026 lines).** It is not `tests/conftest.py`; it sits at the repo root so it is imported **before any other conftest and before any test module**.

**What it protects, precisely.** `/data` is a real directory on this box (`C:\data`). Every product path that resolves to `/data/...` resolves to the owner's **live** files. A test that reaches one **does not fail — it succeeds, silently, into production state.** Two measured costs are recorded in-file:
* `C:\data\auth.db` grew to **1.01 GB / 20,640 users** off ~40 `setenv` calls that isolated nothing.
* `C:\data\screener.db` took a single row (ticker `A`, `snapshot_date` 2026-08-08) from `test_refresh_admin_starts`, which then made the **member-facing screener label 3,583 month-old rows as "today"** (`e86ad6d5`).

**Why a fixture cannot do this.** `AUTH_DB_PATH` is read **once, at module import**, by six product modules — `auth_db`, `awareness.regime_snapshots`, `bar_provenance`, `bar_quarantine`, `bars_audit`, `indicator_alert_service` — because `get_connection()` closes over the module global, never over `os.environ`. `monkeypatch.setenv` in a fixture reaches none of them. An AST census puts those six in the import-time class against **seven** `journal_two` modules that re-read per call; ~40 tests `setenv` and only ever reached the second group. Measured: pop the var, import `auth_db`, set the var, call `get_connection()` → `PRAGMA database_list` still reports `C:\data\auth.db`.

**How a local run stays safe — the two halves.**

1. **REDIRECT.** `SHARED_DATA_LITERALS`, `SHARED_DATA_ENV_PINS` and `UNPINNABLE_SHARED_LITERALS` are **derived by AST over `api/**`** (never grep, never typed) — every `/data…` string constant in non-test product source. Every env var the census can associate with such a literal is re-pointed, at conftest import, at a per-session sandbox (`SHARED_ROOT_ENV_REDIRECTS`, conftest.py:461). `AUTH_DB_PATH` is minted here into `tempfile.mkdtemp(prefix="uct_tests_authdb_")` and `tests/conftest.py` **reads it back** rather than minting a second store (two stores would split the six import-time capturers from the seven per-call readers).
2. **TRIPWIRE.** ⭐ *A redirect alone HIDES THE NEXT OFFENDER* — **8 of the ~55 literals have no env override at all** (`/data/trades.json`, `/data/avatars`, `/data/watchlists.json`, …). So every write primitive is wrapped: `sqlite3.connect`, `open`, `io.open`, `os.makedirs`/`mkdir`/`remove`/`unlink`/`rename`/`replace`. On a path inside the shared root it **raises `SharedDataRootWrite`**, **records** the attempt with test id + thread name + stack (`_record`, conftest.py:518), and **fails the whole run at `pytest_sessionfinish`** (conftest.py:724). Reads are recorded separately (`SHARED_ROOT_READS`) and reported as a NOTE, not a failure.

⭐ **The record is the guard, not the raise.** A daemon thread's exception goes to `threading.excepthook` and the test that spawned it passes green. `POST /api/screener/refresh` hands the real builder to a `daemon=True` thread and returns; the test returned, `monkeypatch` unset `SCREENER_DB_PATH`, and the still-running thread resolved `get_db_path()` afterwards with the override gone. **There are 260 thread/task spawn sites in `api/**`.** Four of the five leaks this found were on a background thread.

**Modes.** `UCT_TEST_SHARED_ROOT_GUARD` = `enforce` (default: raise + record + fail the run) · `report` (record only — the audit mode that makes "nothing reaches `C:\data`" a MEASUREMENT) · `off`. `_GUARD_MODE`, conftest.py:478.

**Three further autouse fixtures in the root conftest**, each closing a reload-shaped hole:
* `_auth_db_capturers_agree_with_the_env_var` — re-pins every already-imported `AUTH_DB_PATH` capturer before each test (`AUTH_DB_PATH_CAPTURERS` derived by AST).
* `_env_derived_paths_survive_a_reload` — snapshots every `api/**` module-level global computed from `os.environ` that currently holds a **path-shaped** string (derived from the *runtime value*, never a typed name list) and restores on teardown. Origin: `catalyst/tuning.py:72` computes `_OVERRIDES_PATH` at import from another module's state, so **no env var can read it back**; a reload in `test_catalyst_tuning.py` left a `{"CATALYST_MIN_PRICE": 4.5}` overrides file standing and the whole suite's price floor moved. Measured: `pytest tests/test_catalyst_tuning.py tests/test_catalyst_filters.py` → EXIT 1, 3 failed; reversed order → EXIT 0, 55 passed.
* `os.environ.setdefault("SCREENER_SNAPSHOT_WARM_ENABLED", "0")` at conftest import — `register_screener_jobs()` starts a `screener-warm` daemon that sleeps ~120 s then runs a **real** build with **one uncached Massive REST call per ticker** on whatever key the developer's env holds; a full suite run lasts ~7 min, so the thread would wake mid-run.

**Rails on the guard itself.** `tests/test_shared_data_root_guard.py` — including probes that watch the guard **actually fire**, against a throwaway directory, never `C:\data`. *"A guard nobody has seen fire is not a guard."* `tools/audit_shared_root_probe.py` and `tools/audit_sandbox_env.py` are the offline companions.

**⚠️ What it does NOT cover.** Writes into `C:\data` from **outside pytest** — a bare `python tools/…` run, a local script — hit the live files. **The guard is a test-suite rail only.** Note that `run-local.ps1` *creates* `C:\data` if it does not exist (`if (-not (Test-Path "C:\data")) { New-Item -ItemType Directory "C:\data" }`), i.e. the local-dev script deliberately reproduces the production path shape.

**Each leak found is fixed by an env override whose default is the literal that was already there, so production resolves byte-identically with nothing set.**

**RELEVANCE TO UCT.** Any Terminal-Next work that adds a `/data`-resolving store inherits this protection *automatically* (the census is AST-derived), and inherits the tripwire's obligation: a new background thread that writes must be reachable by an env override or it will fail the run by name. This is the right default and should not be weakened.

**CONFIDENCE.** 🟢 high (read in full).

### 2.5 The three named enforcement rails

| Rail | Lines | What it enforces |
|---|---|---|
| `tests/test_test_discovery_coverage.py` | 210 | Every collectable test file must live under a declared `testpaths` root. Fails **BY NAME** on orphans. Also: `test_no_production_module_is_wearing_a_test_name`; an EXEMPTIONS list where every entry carries the reason it must stay out of collection ("several would do real damage if collected"), re-checked against disk by `test_the_exemptions_are_all_still_real` **so a stale exemption can never quietly cover a future file**. Excludes `external/*` explicitly because submodules are EMPTY in a worktree — "walking them would make this rail read clean for the wrong reason". |
| `tests/test_feature_flag_ledger.py` | 143 | See §6. |
| `tests/test_requirements_pins.py` | 152 | Upper bounds on dependencies "where a silent major bump is BOTH plausible and damaging" (value = *why it matters*, surfaced in the failure message so whoever trips it understands the stake rather than deleting the assertion). Includes `test_snaptrade_stays_below_12`, `test_requirements_file_parses`, and — critically — **`test_the_timeout_bound_is_ENFORCED_not_decorative`**, which reads `pytestconfig` so the pin and the enforcement cannot drift apart (the original defect was a `timeout` marker with no plugin installed). |

Adjacent, same family: **`tests/test_startup_fingerprint.py`** — `api/main.py` printed the literal `idb_cache_logic_version=4` while `app/src/utils/barsIDB.js` had read `5` since 2026-07-14, and `CLAUDE.md` published that line "for grep verification" while instructing engineers to "bump to 5". Following the instruction bumped the constant to the value already live, invalidated nothing, and the designated verification grep confirmed the 4 and read green. `api/main.py::idb_cache_logic_version()` now **parses the declaration in `barsIDB.js`** and prints `unreadable` rather than guess; this test is the rail on that.

**INTERPRETATION.** This repo has independently discovered and institutionalised one lesson: **a rail whose subject list is typed goes stale, and a stale rail is worse than none because it reads as coverage.** Every gate above derives its subject from the source by AST.

**CONFIDENCE.** 🟢 high.

### 2.6 AST conformance gate + mutation gauntlets

**`docs/runbooks/ast-conformance-gate.md`** governs `tools/ast_conformance.py`, `tools/phase_d_gauntlet.py`, `tests/fixtures/ast/{corpus,escapes}.json`, `tests/test_ast_conformance.py`. Key structure:

* **Four exit codes, deliberately**: 0 `EXIT_CLOSED` · 1 `EXIT_ESCAPES` (guard leaks) · 2 `EXIT_VACUOUS` (the corpus cannot report an escape) · 3 `EXIT_NO_GUARD`. *"'There is no guard yet' and 'the guard leaks' are opposite findings and must not share an exit code."*
* **The headline PAIR, recorded every time**: `--escapes --unguarded` MUST be non-zero (the positive control); `--escapes` MUST be zero — *and only means something after the line above.* Current reading: unguarded **16 of 16**, guarded **CLOSED, 0 escaped of 16 parsed**; conformance log `17 asts × 579 bars` at `REL_TOL = 1e-9`; coverage `70 declared entries, ALL COVERED` with the floor a 70-name LIST, not a count.
* **§4 "WHAT THIS GATE DOES NOT COVER"** is an explicit, tabulated blind-spot register — a discipline worth copying wholesale into Terminal-Next.
* **§4.2 THE FIRE LOG HAS NO TOTAL.** Phase D's plan quoted `685,193` in **17 places**, every one stale on the day it was typed; measured, the real sum is 1,153,245 over 22 blocks. The gate is the literal string `FIRE LOG MATCHES` at exit 0, **per block digest** — never a total.
* **Read every exit code bare.** *"An exit code is lost through a pipe: `| tail` reported `EXIT=0` over a real failure on this branch, and `rc=$?` after a pipeline read `sed`'s status."*
* **`PYTHONDONTWRITEBYTECODE=1` on every pytest run** in a mutation context.

**Mutation gauntlets on disk** (`tools/`): `phase_c_gauntlet.py`, `phase_d_gauntlet.py`, `phase_d_task3_gauntlet.py`, `flipc_mutation_gauntlet.py`, `flipc_task12_gauntlet.py`, `alert_corpus_mutations.py`, `alert_bars_freshness_mutations.py`, `alert_bar_close_60m_mutations.py`, `mutation_check_admin_guard.py`, `mutation_check_coverage_blanks.py`, `task8_mutations.py`. **Eleven distinct harnesses.**

Three hardening rules the Phase-D gauntlet encodes and that generalise:
* **`GUARDED` snapshots every artifact a mutation can reach**, not just the file it patches — Phase C's M2 reported `3/3 KILLED, exit 0` **and left a corrupted fire log**, because the harness restored the file it *patched* and never the file the mutation *wrote*. sha256 in both directions inside the `finally`.
* **Counts come from the runner's SUMMARY LINE and nothing else.** A bare `re.search(r"(\d+) passed", out)` reads the *first* match in the capture, and pytest echoes a failing test's **docstring** into that capture — M4's real result `1 failed, 1 passed, 41 deselected` was first reported as `passed=5 failed=0` because a docstring contained the words `` `5 passed rc=0` ``. Same class as the vitest trap where `Test Files N passed` prints **before** `Tests M passed`. A capture with no summary line now **refuses**.
* **pytest exit 4 is a USAGE error that prints "no tests ran", which reads exactly like a pass.** Detected by code and aborted; never a verdict.

**Other pixel/parity gates** (`tools/`): `chart_parity.py` + `chart_parity_cases.json` + `gen_parity_regions.py` (deterministic per-indicator screenshot diff), `flipc_screenshots.py`, `mobile_audit.py` (Playwright phone/tablet sweep for horizontal overflow + sub-44 px tap targets), `breadth_live_visual_check.py`, `alert_replay.py`, `cutover_watch.py` (exit 0 = GO, 1 = NO-GO).

**⛔ The runbook's own most important sentence**, restated because Terminal-Next will be tempted to trust the pixel number: *"A total regression of every user-visible thing Phase D built would report 0 changed pixels on 46 of its 48 cases."* Pixel diffs are a **regression fence**, not a gate.

**CONFIDENCE.** 🟢 high on the runbook contents (read in full); 🟡 that the numbers quoted in it still hold today — I did not re-run `ast_conformance.py` (out of budget/scope).

### 2.7 Chunked backend runs

**NOT DETERMINED in-repo.** The "~14 chunks" figure comes from operator memory, not from any committed script. I found **no chunk runner** under `tools/` or `scripts/`; the only in-repo `chunk` references are unrelated (`ast_conformance.py`, `chart_parity.py`, and a `railway ssh` base64-chunking note in `docs/runbooks/cutover-watch.md`). `pytest.ini`'s comment *does* name "chunked suite runs" as one of the real runners that passes explicit paths — so chunking is a **practice**, not an artifact.

**What would determine it:** the operator's shell history, or a committed runner. **RECOMMENDATION:** if chunked runs are the real full-suite protocol, commit the chunk manifest — an uncommitted partition is exactly the "list somebody remembered" shape every other rail in this repo was rewritten to avoid, and a chunk that quietly stops existing is invisible.

---

## 3. CI — `.github/workflows/`

**There is exactly ONE workflow file in the entire repository.**

`.github/workflows/optionsflow-guard.yml` — "Options Flow guard".

* **Triggers:** `push` and `pull_request`, both `paths:`-scoped to `app/src/pages/OptionsFlow.jsx` and `app/src/pages/optionsFlow/**`.
* **Job:** ubuntu-latest → checkout → setup-node 20 (npm cache on `app/package-lock.json`) → `npm ci` → `npx vitest run src/pages/optionsFlow/`.
* **On failure** it prints a `::error::` plus a three-step recovery pointing at `docs/OPTIONS-FLOW-RECOVERY.md`.
* **Why it exists (in-file):** `OptionsFlow.jsx` is edited through the GitHub **web UI**; twice on 2026-07-25 a save from a long-open browser tab landed as a stale-buffer commit and silently reverted the performance work. "The page kept working, it just went back to freezing for ~2 seconds on every visit. Nothing surfaced it."
* **Why it is narrow (in-file):** *"The full suite has a couple of timing-sensitive specs that flake under parallel CI load (ModelBook, useAnimatedNumber), and a workflow that cries wolf gets ignored — which would defeat the entire point of this file."*

### Does any check gate a deploy?

**No. CONFIRMED from config.**

* `railway.json` `deploy.startCommand` / `healthcheckPath` / `restartPolicyType` describe how Railway runs the pod. Railway builds and deploys **on git push**; there is no GitHub-Actions-to-Railway handoff in this repo, no `deployments:` API usage, no `needs:`-chained deploy job.
* The only workflow does not run on the default branch broadly (it is path-scoped) and produces no artifact any deployer consumes.
* `.git/hooks/` contains **no non-sample hooks**. The `pre-push` market-hours freeze hook and the "Deploy window guard" workflow that `CLAUDE.md` documents were **removed by owner decision on 2026-08-24**; their absence on disk confirms it.
* No `husky` in either `package.json`.

**INTERPRETATION.** The path from "engineer's laptop" to "~200 members' production" is: run whatever tests you chose to run locally → `git push origin <branch>:master` → Railway builds → healthcheck `/api/health` → live. **Nothing mechanical stands in that path.** `railway.json` `healthcheckTimeout: 600` and `restartPolicyType: ALWAYS` bound *boot* failures; they do not bound *logic* failures.

**RELEVANCE TO UCT.** Terminal-Next is a ~100-role, multi-agent program shipping into the same repo. The existing estate can tell you a regression happened; nothing currently *prevents* one from reaching members. The cheapest high-value change available is a single `push`-triggered workflow running the two rails already proven to be fast and green: **7.3 s frontend / 13.7 s backend** for the calendar pair. That is a CI budget of well under a minute.

**CONFIDENCE.** 🟢 high on repo contents. 🟡 **EVIDENCE CEILING** on GitHub-side configuration: branch-protection rules and required status checks live in GitHub settings, not in the repo, and I could not read them (the `plugin:github` MCP server failed to connect this session: `400 … Authorization header is badly formatted`). What would raise confidence: `gh api repos/:owner/:repo/branches/master/protection`.

**RECOMMENDATION.**
1. Add a `push`-triggered workflow that runs the calendar rails (both halves) plus the three cheap meta-rails (`test_test_discovery_coverage.py`, `test_feature_flag_ledger.py`, `test_requirements_pins.py`). All are deterministic and offline by construction — `tests/test_feature_flag_ledger.py`'s docstring says so explicitly ("keep them separate so the suite stays offline and deterministic").
2. Do **not** put the full suite in CI without first addressing the known flake population — `app/vite.config.js` and `test-setup.js` already document that the flakes are a *scheduler* population, and a 4-core CI runner is exactly the "2× slow" condition that tips 73 tests.
3. Note that `maxWorkers: '50%'` was chosen as a percentage precisely so CI scales — the config is already CI-ready.

---

## 4. Observability

### 4.1 Sentry

* **Server:** `api/main.py:148` `_SENTRY_DSN = os.environ.get("SENTRY_DSN")`; `api/main.py:195–200` `if _SENTRY_DSN: sentry_sdk.init(dsn=…, traces_sample_rate=0.1, environment=os.environ.get("RAILWAY_ENVIRONMENT", "development"))`. Dependency pinned `sentry-sdk[fastapi]==2.23.1` (`requirements.txt:28`).
* **Client:** **THERE IS NO FRONTEND SENTRY.** No `@sentry/*` package in `app/package.json`; the only occurrence of the string "Sentry" under `app/src` is `app/src/pages/Privacy.jsx` (a privacy-policy mention). Browser errors — the ones a *terminal* user actually experiences — reach nobody automatically.
* **Status:** **KEY-PRESENT / CODE-REFERENCED.** The init is conditional on `SENTRY_DSN` being set on Railway, which I cannot verify. CLAIM, not CONFIRMED.

**RELEVANCE TO UCT.** A trading terminal is a client-heavy product (charts, streams, workspaces). Server-only error capture is structurally blind to the class of failure that matters most on a terminal: a widget that throws in one browser. This is a genuine gap, not a preference.

**CONFIDENCE.** 🟢 on the code; 🔴 on whether Sentry is receiving anything in production. **EVIDENCE CEILING:** no Railway variable read permitted by this contract.

### 4.2 `/api/health` and the health family

`api/main.py:6764 health()` returns:

| Field | Producer |
|---|---|
| `status` | literal `"ok"` |
| `wire_date` | `cache.get("wire_data")["date"]` — the morning-wire push date |
| `uptime_seconds` | `int(time.time() - _APP_BOOT_TS)`; `_APP_BOOT_TS` captured at module import (`api/main.py:15`) |
| `thread_count` | `threading.active_count()` — added after the 2026-06-09 thread-exhaustion incident |
| `rss_mb` | `_process_rss_mb()` |

This route is the `railway.json` `healthcheckPath` **and** the target of `worker_main`'s down-alert monitor (which posts a red 🔴 "site down" to Discord), so it must never fail during a warm window.

**Sibling routes:**
* `api/main.py:6779 /api/ready` — **readiness, OBSERVABILITY ONLY.** 200 when warm, **503 until every warm gate finishes**.
* `/api/health/threads` (6835), `/api/health/memory` (6848, supports `?trim=1`), `/api/health/thread-stacks` (6875), `/api/health/cache` (6914) — **ADMIN-ONLY since 2026-08-09.** 🔴 These three answered **anonymous callers**: `/thread-stacks` returned 2,841 bytes of live Python stack traces — absolute module paths, function names and line numbers for every running thread — to anyone on the internet. They were missed by the 2026-08-09 auth sweep only because they are declared in `main.py` rather than in a router, "which is not a security property".
* ⛔ The comment above them is explicit that `AdminGuardMiddleware` must **not** be widened to `/api/health/*`, because that would put the liveness probes one prefix-typo away from a 403 while Railway healthchecks and the Discord down-alert both poll `/api/health`.
* `/api/watchdog/status`, `/api/admin/bars-stream-status`, `/api/admin/reconciliation-status`, `/api/admin/fundamentals-health`, `/api/admin/deploy-log`, `/api/desk/sessions-status`, `/api/desk/session-audit` — a broad diagnostic surface, mostly PUSH_SECRET-bearer or admin gated.

### 4.3 ☠️ The `/api/ready` lore — the most expensive documentation defect in the repo

`api/services/readiness.py` and the `/api/ready` docstring both record it. Verbatim substance:

* Warm threads are staggered after boot: **T+20 s** dashboard warm (movers/themes/news/breadth/calendar) · **T+45 s** bars hot tier → charts · **T+60 s** darkpool prewarm · **T+120 s** RS rankings (~17 s compute, computed INLINE on a miss). So every deploy opened a **0–120 s window** where users hit a cold pod. On 2026-07-26 there were **40 deploys** → 40 such windows.
* Wiring `healthcheckPath` to `/api/ready` was tried in production (deploy `650865d5`) and caused a **~3 MINUTE OUTAGE**: `Attempt #1..#8 failed with service unavailable`, uctintelligence.com 502. **Railway does NOT keep the old pod serving while the new one healthchecks — the old pod is already gone.** A 503-until-warm probe therefore does not hold traffic on the warm pod; it takes the site down until the gate releases.
* **Slow-but-serving beats hard-down.** `healthcheckPath` is `/api/health`, and **nothing may gate a deploy on readiness.**
* ⭐ **FOUR places in this repo asserted the wiring existed** — the `/api/ready` docstring, `api/services/readiness.py`, `api/worker_main.py`, `api/flow_worker_main.py`. *"Four copies of one claim read as corroboration, so the single config line that falsifies them went unopened — and the sentence is an active trap, because acting on it reproduces the outage."*
* **Standing guard:** `tests/api/test_ready_endpoint.py::test_railway_healthcheck_must_not_gate_on_readiness`.

**RELEVANCE TO UCT.** This is the reliability lesson Terminal-Next most needs to inherit: **a warm-aware readiness probe is an observability instrument, never a routing gate, on this platform.** It is also the clearest example of the repo's dominant defect shape — *a comment naming a mechanism is a claim about a run.*

**CONFIDENCE.** 🟢 high (the incident, the deploy id, the guard test and the config line are all on disk and mutually consistent).

### 4.4 `deploy_log`

`api/deploy_log.py` — records every WEB boot (= a deploy) to `<DATA_DIR>/deploy_log.jsonl` so the team can **MEASURE** how often web actually redeploys during market hours, and (offline) whether those deploys touched flow-ingest code. `FLOW_INGEST_FILES = ("massive_ws_worker", "massive_processor", "flow_db", "bs_iv", "live_massive_router", "massive_flatfiles_worker")`. Read via `GET /api/admin/deploy-log`. Best-effort — a bad record never affects boot.

⭐ **Its stated purpose is to decide whether a proposed cutover is worth its cost — "so we instrument before we pay."** That is the healthiest pattern in this codebase and worth naming as such for Terminal-Next.

### 4.5 Watchdogs

| Module | Lines | Shape |
|---|---|---|
| `api/event_loop_watchdog.py` | 467 | A **daemon OS thread** (not on the event loop, so it survives a wedge) captures the running loop and every `WATCHDOG_CHECK_SEC` (default 5 s) schedules a trivial probe via `loop.call_soon_threadsafe`, measuring lag. After `WATCHDOG_WEDGE_SEC` (default 30 s) of consecutive misses, **and if the kill is armed**, it declares a wedge. Exists because the web pod is ONE uvicorn process = ONE event loop shared by ~200 users (the 2026-07-01 524-outage surface) and **Railway only restarts a container on process EXIT** — the pre-existing monitors were Discord-alert-only. |
| `api/flow_watchdog.py` | 274 | Out-of-band **tape-freeze** watchdog (2026-07-14 incident). "The guard that cannot die with its patient": a plain OS thread watching `flow.db` insert progress from outside, force-exiting so `restartPolicy=ALWAYS` brings a fresh consumer in ~60 s. ⭐ **FREEZE vs LAG is the critical distinction**: freeze (MAX(id) stops advancing during market hours) → exit; lag (rows insert but timestamps trail) → **do nothing, a restart makes lag WORSE**. Guarded to 9:45–15:55 ET Mon–Fri and requires the newest row to be from TODAY. |
| `api/services/disk_watchdog.py` | 252 | Volume-level `/data` monitor. Origin (2026-07-23): the options tape spool paused itself on a disk budget and gap capture stayed dead for **three trading days**, because the only thing watching disk was the spool's OWN budget check — "a per-feature guard that alerts about ITSELF, in ITS OWN terms". The actual cause was 33 GB of unpruned gap-fill backups in a sibling directory. This watches **total usage** and names the **top consumers by size and growth since the last check**. |

⭐ **The `disk_watchdog` framing generalises directly to Terminal-Next: a per-feature health check reports on itself; a class detector reports on the neighbourhood.**

### 4.6 Monitors that post to Discord

Modules referencing `DISCORD_WEBHOOK_URL` / a Discord post path (25+ found; the operationally significant ones):

| Module | What it watches |
|---|---|
| `api/services/provider_coverage_monitor.py` (873 lines) | **Per-field DATA COVERAGE + bounded self-heal + alert-on-change.** Origin: on 2026-08-05 two Finnhub endpoints (`/stock/upgrade-downgrade`, `/stock/transcripts/list`) were found to have been returning HTTP 403 on **every** call for months — 100% blank in production — "discovered only because a human happened to look". Same night: a 48 h-cached blank Financials tab, a 7-day logo-miss retry job with **no scheduler caller**, and a nightly implied-move capture silently returning `{'captured': 0}`. ⭐ **Every one was a 200 response with an empty field, which no uptime check would ever catch.** This measures **FILL RATE, not response status.** |
| `api/services/fundamentals_monitor.py` | The pattern this generalises from — detect → self-heal (cache invalidate, EXACT key) → alert only on **newly**-flagged tickers. Status at `GET /api/admin/fundamentals-health`. Invariants include a deliberately non-tautological forward-quarter contiguity oracle (the naive `label == _label_from_period_end(period_end)` check is tautological because the label is *derived* from period_end). |
| `api/services/wire/coverage_monitor.py` + `coverage.py` | Morning-wire coverage. (Not read in depth — D-07 budget; owner is the wire program.) |
| `api/services/chart_health_alerts.py` | In-memory operator alert deque, throttled 10 min per key. Triggers: source pass-rate <95%, WS disconnect >60 s, new corruption pattern. Surfaces at `/api/admin/bars/alerts`. ⭐ **CRITICAL alerts also PAGE Discord since 2026-08-18** — the deque was admin-**pull**-only, "the gap that let the 2026-08-11 daily freeze run for a week". |
| `api/services/liveflow_monitor.py`, `api/services/disk_watchdog.py`, `api/event_loop_watchdog.py`, `api/flow_backup.py`, `api/auth_surface_check.py`, `api/services/journal_two/broker/{fleet_monitor,live_sentinel,mirror_check,fidelity_audit,notifications}.py`, `api/services/desk_session_recap.py`, `api/services/ipo_maintenance.py`, `api/services/catalyst/rule_learner.py`, `api/services/cot_weekly_post.py`, `api/services/discord_notify.py`, `api/services/discord_relay.py` | The rest of the Discord alerting fleet. |
| `api/main.py:671–686, 2875` `_run_deploy_smoke_now()` / `_start_deploy_smoke_background(delay_seconds=30)` | **Post-ship check.** A daemon thread runs a deploy smoke audit 30 s after boot; failures go to `logging.getLogger(__name__).exception("[startup] deploy smoke failed")`. Scheduled alongside a "priority resolver" and "priority audit" run. |
| `api/services/desk_session_audit.py` + `GET /api/desk/session-audit` + a 09:00 ET job | ⭐ **The best-designed audit in the repo, and the one whose *design rationale* Terminal-Next should copy.** It re-reads **artifacts** (the `edu_videos` row, the announce ledger), never a counter — because `desk_session_insights._FAIL_STREAKS` is an in-memory dict alerting on the 4th consecutive failure, which needs an uninterrupted hour of 15-minute passes on a pod that redeploys several times a day, so **the streak resets before it can fire and a proxy that resets on redeploy reports healthy straight through a total failure.** It has a load-bearing **grace window** (3 h) because insights land 2 min–3 h after publish, and "without it this fires on every healthy session and gets muted inside a week". It reads the announcer's **own** allowlist so it can never disagree with the thing it audits. It reports **names, not counts**. Wiring is test-pinned two ways (an AST over `api/main.py` proving the `add_job` id exists, plus a route-presence check off `router.routes`), **each with a non-vacuity control**. ⛔ *"An audit nobody runs is worse than none: it reads as coverage"* — literally this pipeline's own history. |

### 4.7 Structured logging conventions — and the honest finding

**There are effectively none.** `api/main.py` contains **391 `print(` calls**. `logging` is used sparingly and inconsistently (`logging.getLogger(__name__)` appears at lines 265, 278, 396, 446, 463, 640, 654, 677…). Line 35 sets noisy third-party loggers to `WARNING`.

The de-facto convention is a **bracketed prefix on stdout**: `[startup] …`, `[startup] chart-realtime-mode: …`, `[startup] bars-push-rail: …`. These "startup fingerprints" are the repo's grep-verification mechanism (`tests/test_startup_fingerprint.py` is the rail keeping one of them honest). There is **no JSON logging, no request id, no correlation id, no log level discipline, and no log aggregation** beyond Railway's own console.

**Where errors surface for staff:**
1. **Discord** — the primary channel, ~25 modules.
2. **Admin endpoints** — `/api/admin/*` status/diagnose routes and `/api/health/*` (admin-gated).
3. **Railway logs** — but ⚠️ `CLAUDE.md` records that Railway's log `timestamp` is **batched**, and the desk-sessions runbook states plainly: *"Diagnose via `GET /api/desk/sessions-status`, NOT logs — engine logs are flooded by yfinance/theme noise."*
4. **Sentry** — server-side only, and unverified.
5. **In-app** — `AlertBell` for member-facing alerts; `chart_health_alerts` deque for operators.

**INTERPRETATION.** Observability here is **artifact-first, not log-first** — and given that logs are batched and flooded, that is a *correct adaptation*, not a shortcoming. The shortcoming is that it is undocumented as a convention, so each new subsystem invents its own status endpoint shape.

**RELEVANCE TO UCT.** Terminal-Next should adopt the artifact-first pattern deliberately (a status endpoint + an audit that reads the artifact, per `desk_session_audit`), and should NOT invest in structured logging until log aggregation exists — logs that nobody can read are not observability.

**CONFIDENCE.** 🟢 high on the counts and conventions; 🟡 on "no aggregation" (an external drain configured on Railway would not be visible to me).

---

## 5. Reliability patterns

### 5.1 `serve_stale` — `api/services/serve_stale.py`

**The problem it names.** `cache.TTLCache` expires on a **hard clock**: `get()` only does `move_to_end` for LRU, never extends `expires_at`. So a cache in front of an expensive rebuild "does not protect users — it just decides WHICH user pays". Measured on prod 2026-07-31, polling `/api/calendar` every 20 s for 13 minutes:

```
07:50:02   4.51s   <- cold
08:00:18   7.97s   <- cold, exactly ~10 min later (TTL = 600s)
(38 others) 0.12s
```

**Raising the TTL only makes the stall rarer and the data staler; it cannot remove it.**

**The three rules (verbatim structure):**
1. **Bounded.** Stale is served only while younger than `max_age_seconds`; past that, rebuild synchronously. *"Options Flow lesson: never delete serve-stale — bound it."*
2. **Only GOOD payloads are remembered.** An error/empty rebuild must never become the value every user sees for the next window; caller supplies `good()`.
3. **Single-flight.** Concurrent cold callers collapse onto ONE build; at most one background refresh per key.

**Consumers:** `api/routers/calendar.py:27`, `api/routers/wire.py:19`, `api/routers/signature.py:49`, `api/services/implied_move.py:14`, `api/services/setup_grade.py:25`.

⭐ **This is the single most directly reusable reliability primitive for TERMINAL-NEXT** — a terminal is exactly a set of expensive multi-provider surfaces polled by many users.

### 5.2 Deploy-survival invariants (`railway.json`)

```json
"startCommand": "if [ \"${BARS_API_ENABLED:-0}\" = \"1\" ]; then exec python -m api.bars_api_main;
                 elif [ \"${FLOW_WORKER_ENABLED:-0}\" = \"1\" ]; then exec python -m api.flow_worker_main;
                 elif [ \"${WORKER_ENABLED:-0}\" = \"1\" ]; then exec python -m api.worker_main;
                 else exec uvicorn api.main:app --host 0.0.0.0 --port $PORT --proxy-headers
                      --forwarded-allow-ips='*' --timeout-graceful-shutdown 5; fi",
"drainingSeconds": 30,
"healthcheckPath": "/api/health",
"healthcheckTimeout": 600,
"restartPolicyType": "ALWAYS"
```

**Three settings are a unit and must never be removed alone** (`CLAUDE.md`, corroborated by the file):
* **`exec` in BOTH branches** — without it `sh` is PID 1 and swallows SIGTERM, so **no graceful shutdown can ever run**.
* **`--timeout-graceful-shutdown 5`** — bounds the never-ending SSE streams so the lifespan shutdown is actually reached.
* **`drainingSeconds: 30`.**

Also: `api/main.py` uses `FastAPI(lifespan=lifespan)`, so **`@app.on_event` handlers are SILENTLY IGNORED** — shutdown hooks must be registered after the `yield`, defensively via `getattr`.

`healthcheckTimeout: 600` (vs the 300 s default) exists because startup carries COT seed + DB migrations + scheduler init.

**⚠️ One config, four services.** `railway.json` is SHARED by web / worker / flow-worker / bars-api. **`watchPatterns` are therefore set per-service in the Railway dashboard ONLY, never in `railway.json`** — an api-only list in the file would stop web frontend deploys.

**"Serves last SUCCESS on failure."** CLAIM (operator memory + `CLAUDE.md`); I found no in-repo config expressing it. It is a Railway platform behaviour, and its interaction with the §4.3 finding is important: Railway *replaces* the pod at healthcheck time (old pod already gone), but *retains the last successful build* if a new build/healthcheck fails outright. Those are different failure modes and the second does not rescue the first.

### 5.3 Rollback mechanisms

| Mechanism | Where | Notes |
|---|---|---|
| **Feature flags** | `docs/feature_flags.json` + 104 gates | The primary rollback: "Rollback = unset either one — no code change, no rebuild." |
| **`railway redeploy --service web --yes`** | Operator command | ⚠️ `railway variables --set` **STAGES ONLY** — it does not restart; a redeploy is required to apply. (Documented in `CLAUDE.md`; also noted in `tools/flag_ledger_audit.py`: `railway variables --kv` does **not** redeploy, `--set` does.) |
| **Cohort narrowing** | `export const BARS_PUSH_ROLLOUT_PCT = 100` in `StockChart.jsx` | % of browsers on the push feed; lower + deploy ≈ 10 min. |
| **Per-browser instant kill** | DevTools `window.__uctBarsPush(false)` (`localStorage['uct.barsPush.enabled']='0'`); pool kill `uct.barsPool.disabled`; SSE pool `uct.ssePool.disabled` | Client-side escape hatches that need no deploy. |
| **Blank-value-is-safe contracts** | `DESK_PUBLIC_SHOWS`, `DESK_TSDR_ANNOUNCE_SHOWS` | ⭐ **A blank value makes NOTHING public / announces NOTHING** — the failure direction is private, never a leak. Rollback is an env var, not a deploy. **This idiom is worth mandating for every Terminal-Next allowlist.** |
| **Emergency escape hatches** | `R2_PERIODIC_PULL_LEGACY_REPLACE=1` | Explicitly emergency-only; re-enabling replace-pull caused the 2026-05-07 universe freeze. |
| **Router-comment-out** | `api/routers/trades.py` kept, `include_router` commented out | The documented retirement idiom: keep the file, cut the wire, schedule removal ~30 d later. |

### 5.4 Self-heal / lease patterns

* **Request-driven self-heal** (COT): `get_status()` invokes `_maybe_auto_refresh_if_stale()`; if DB latest is older than the calendar-expected report date and no auto-refresh in 30 min (module-level `_LAST_AUTO_REFRESH_AT` cooldown), it kicks a background refresh. **Any visit to the COT tab self-heals — no scheduler required.** Added 2026-05-22 after the Friday scheduler silently missed its window. The same idiom is mirrored in `api/routers/admin_twitter.py`.
* **Cache self-heal**: `fundamentals_monitor` / `provider_coverage_monitor` invalidate + recheck before alerting.
* **`api/services/bar_self_heal.py`, `api/services/breadth_self_heal.py`** — per-domain heals.
* **`api/services/scheduler_lock.py`** — cross-process advisory lock so multiple uvicorn workers cannot double-fire crons. `fcntl.flock` on Linux (released by the kernel on process exit — no atexit hook needed); **degrades to an always-grant no-op on Windows**, which is correct because nobody runs `--workers >1` on Windows. ⚠️ For Terminal-Next: this means **local Windows runs have no scheduler lock at all** — a fact worth knowing before assuming local behaviour matches prod.
* **Flow-worker lease**: `api/services/liveflow_monitor.py:290` mentions "Self-heal steals a hung fill after the lease". `api/flow_worker_main.py:125` registers a clean OPRA slot release on SIGTERM (the P1 contract) so the next process's connect is not refused. **The lease itself I did not read in full — see GAPS.**
* ⚠️ **Single-process assumptions.** `CLAUDE.md` enumerates per-PROCESS state that are *correctness guards, not caches*: `sync._locks`, `recent_orders._last_poll`, `manual_refresh._last_trigger`, `notifications._failure_pinged`/`_spike_pinged`, `partner_health._cache`. A second web instance silently doubles each. Durable equivalents exist where a repeat is costly (`j2_broker_member_stale_notify`, `j2_broker_digest_dedup`). **This is the first thing that breaks if Terminal-Next scales out.**

**CONFIDENCE.** 🟢 on `serve_stale`, `railway.json`, `readiness`, `scheduler_lock` (all read directly). 🟡 on the flow-worker lease and "serves last SUCCESS" (not read to primary source / platform behaviour).

---

## 6. The feature-flag ledger AS A RAIL (enforcement mechanism only — D-10 owns semantics)

Three parts, and the separation between them is the design:

**(a) `api/services/feature_flag_index.py` — THE ONE READER.** Derives every feature gate the code reads **by AST** over `api/`, `scripts/`, `tools/`. Handles `os.getenv("X")`, `os.environ.get("X")`, `os.environ["X"]` and the `(os.getenv("X") or "1")` fallback idiom. ⛔ **DERIVED, NEVER TYPED** — "a hand-maintained list of flag names is the artifact that goes stale first". The subscript form is included **deliberately**: leaving it out made an early pass report `SESSION_SECRET` and three others as unreferenced when they were merely read a different way. Measured 2026-08-30: **973 env names read**, of which **198 are feature gates**, of which **twelve default off and are set on no Railway service**.

**(b) `docs/feature_flags.json` — the ledger (INTENT).** `{_readme, flags}`. Measured today: **104 entries** — **86 `armed`**, **13 `pending`**, **5 `dark`**.
* `armed` = set on at least one Railway service (its value is the decision).
* `dark` = deliberately off; **note MUST say why**. Current: `BUZZ_DIGEST_ENABLED`, `HISTORY_PREWARM_ENABLED`, `BARS_HISTORY_ORIGIN_ENABLED`, `BARS_HISTORY_PROXY_ENABLED`, `PERMANENT_DAILY_FRESHNESS_ENABLED`.
* `pending` = built, no decision yet; **note + `since` MUST be present**. Current: `CATALYST_AV_NEWS_ENABLED`, `COMPASS_HEALTH_EMAIL_ENABLED`, `DEEP_CACHE_ENABLED`, `EARNINGS_PREWARM_ENABLED`, `FLOW_PRUNE_ENABLED`, `FLOW_REST_BACKFILL_ENABLED`, `FMP_BULK_ENABLED`, `INDICATOR_VISION_ENABLED`, `OI_MORNING_ENABLED`, `SCAN_LIVE_SWEEP_ENABLED`, `SCREEN_BACKTEST_ENABLED`, `STANDING_FLOW_ENABLED`, `INSTANT_UNIVERSE_ENABLED`.

**(c) `tests/test_feature_flag_ledger.py` — the offline gate (143 lines).** Nine tests:
`test_every_off_by_default_gate_is_declared` (fails **BY NAME**) · `test_the_ledger_does_not_describe_gates_that_no_longer_exist` (the reverse direction — stale entries are also drift) · `test_each_entry_states_a_real_decision` (parametrised; enforces the note/`since` obligations) · `test_the_derivation_reads_every_form_the_codebase_actually_uses` (a synthetic tmp_path corpus proving the AST scanner sees every read form) · **`test_an_undeclared_gate_is_actually_caught`** (the non-vacuity control — plants a gate and proves the rail goes red) · `test_inverted_disable_gates_are_not_dragged_in` (a `*_DISABLED` var is not an off-by-default gate).

**(d) `tools/flag_ledger_audit.py` — the half that LOOKS.** Shells out to the Railway CLI, read-only (`railway variables --kv` does not redeploy). Prints **names, never counts**. Three services: `web`, `worker`, `flow-worker`. ⛔ Raises `RailwayUnavailable` rather than returning an empty set — "an unreachable CLI read as … " (an empty read must never be inferred as "nothing set"). **Exit codes: 0 = agree · 1 = drift found · 2 = "did not look"** — a distinct code precisely because *"did not look" is not "looks clean"*. **Deliberately NOT in the test suite**: "tests must stay offline and deterministic."

**The problem the whole apparatus solves, stated in the ledger's own `_readme`:** *"a gate that defaults off and is set nowhere is indistinguishable, from outside the repo, from a gate that is off ON PURPOSE."* `PATTERN_VISION_ENABLED=0` was a deliberate retirement (the patterns engine measured 15.7 % precision); twelve others were simply built, tested, merged and forgotten. **Nothing in the repo could tell the two apart** — `lesson_built_tested_green_and_unreachable`.

**One concrete defect I observed in the ledger data.** Every `where` field I sampled reads `["(set \ufffd service not captured)"]` — a **mojibake/replacement character** where an em-dash or arrow should be, i.e. the ledger was generated through a cp1252-lossy write. It does not affect the gate (only `status`/`note`/`since` are asserted), but it means the `where` column carries no service information at all today, which is the one field that would let a reader see *which* service arms a flag without running the audit.

**CONFIDENCE.** 🟢 high (all four components read; counts measured from the JSON).

**RECOMMENDATION.** (1) Fix the `where` generation to write UTF-8 (`io.open(..., encoding="utf-8")` — the same trap `docs/runbooks/ast-conformance-gate.md` §10 already names: "cp1252 kills a harness's own stdout"). (2) Terminal-Next flags should enter this ledger from day one — the rail already covers `tools/` and `scripts/`, so a new gate anywhere fails the suite by name until it is declared.

---

## 7. Runbooks index

### `docs/runbooks/` (11 files)

| File | One line |
|---|---|
| `alert-replay-gate.md` | What replaces the pixel gate in Phase C — "no screenshot catches a wrong alert and **an email cannot be un-sent**". Three measurements, the gate being the literal `FIRE LOG MATCHES` at exit 0. |
| `ast-conformance-gate.md` | The AST conformance gate + reachability census (`tools/ast_conformance.py`, `phase_d_gauntlet.py`). Four exit codes; the mandatory unguarded/guarded PAIR; §4 blind-spot register; §4.2 "the fire log has no total". |
| `broker-canary-arming.md` | Arming `BROKER_CANARY_USER_ID` — full-syncs one designated connection nightly (3:10 AM ET) and pings owner Discord unless the sync **actually produced data**. No-op until set. |
| `buzz-activation.md` | Activating `/buzz`. "The code is deployed and completely inert. Five gates hold it, and you open them one at a time." Every step has a check that proves it worked *before* the next depends on it. |
| `chart-parity-gate.md` | Deterministic per-indicator screenshot diff. Phase B migrates fifteen indicators onto an engine; each ships under **Flip A** and must be pixel-identical to the legacy version. |
| `cutover-watch.md` | `tools/cutover_watch.py` — read-only GO/NO-GO gate for the `ALERT_EVAL_MODE` flip. **Exit 0 = GO, 1 = NO-GO**, so it can gate a script. Run repeatedly through the window. |
| `definition-record.md` | The rule record (`definition_evaluations`) — `api/services/definition_record.py`, rails `tests/test_definition_record.py`, decision doc `docs/decisions/2026-08-08-the-rule-record-is-not-the-ledger.md`. Lives in `SIGNAL_LEDGER_DB_PATH`. |
| `liveflow-unstick.md` | The Massive OPRA feed is down RIGHT NOW during market hours. **Three gates must ALL be true before restarting.** Works because the 600 s `max_connections` cooldown is process-local and a cooldown-stuck process holds no open WS session. |
| `options-flow-cloudflare-cache.md` | Cloudflare cache rule for `/api/flow/data`. **Status: rule NOT yet applied**; code side ready (`baseFetchUrl`, 2026-07-25). |
| `postgres-migration-trigger.md` | *When* to stop scaling SQLite and move `auth.db` to Postgres. SQLite (WAL) on one web pod is right today; the ONE ceiling is **concurrent writers**. |
| `rest-backfill-arming.md` | Arming `flow_rest_backfill` — re-reads a gap window from Massive REST `/v3/trades` the SAME day. "It closes the one gap class nothing else covers." |

### `docs/operations/` (2 files)

| File | One line |
|---|---|
| `gate-5-shadow-mode-runbook.md` | Gate 5 production shadow mode — the operator reviews live engine detections daily for **5 consecutive trading days**, target **≥85 % accept rate** sustained. |
| `phase-7-launch-checklist.md` | Public launch of the chart pattern overlay, gated by Gate 4 (calibration backtest) and Gate 5. Both pass → overlay flips default-ON. |

**INTERPRETATION.** The runbook estate is strong on *incident* and *arming* procedures and has a consistent, unusual quality: **every one states its gates and its failure direction explicitly.** What is missing is any runbook for the ordinary path — there is no `how-to-run-the-tests.md`, no `deploy.md`, no `on-call.md`.

**RELEVANCE TO UCT.** A ~100-role program will need the ordinary-path runbook that does not exist. It should be written from what §1 and §2 of this document measured, not from memory.

**CONFIDENCE.** 🟢 high (headers read from each file).

---

## 8. Gaps a terminal would expose

Ordered by what a real-time, multi-widget trading terminal would actually hit.

| # | Gap | Evidence | Why a terminal makes it worse |
|---|---|---|---|
| **1** | **NOTHING gates a deploy.** One path-scoped workflow; no branch protection visible; no pre-push hook (removed 2026-08-24); Railway deploys on push. | `.github/workflows/` holds exactly one file; `.git/hooks/` has no non-sample hooks; `railway.json` has no gate. | A terminal is a *persistent* surface. Members leave it open all day; a bad deploy is not a page they reload past, it is their workstation going wrong mid-session. |
| **2** | **No client-side error reporting.** Sentry is server-only; no `@sentry/*` in `app/package.json`. | `grep -rln sentry app/src` → only `Privacy.jsx`. | Terminal failures are overwhelmingly *client-side*: a widget throws, a chart blanks, a stream detaches. Today those reach nobody unless a member reports them. |
| **3** | **No visual regression in CI.** `tools/chart_parity.py`, `flipc_screenshots.py`, `mobile_audit.py` all exist and are excellent — **none runs automatically.** | No workflow references them. `docs/runbooks/chart-parity-gate.md` describes a manual protocol. | A terminal is *mostly* pixels. And per the AST runbook's own warning, the pixel gate is a fence around committed cases — it cannot see a user-authored layout at all. |
| **4** | **No load / concurrency testing.** `tools/screener_ui_stress.py` + `_analyze_stress_findings.py` are the only artifacts; no locust/k6/artillery anywhere. | `grep -rln 'locust\|k6\|artillery'` finds only two spec docs. | The web pod is **ONE uvicorn process = ONE event loop + ONE anyio threadpool (64)** shared by every user (the 2026-07-01 524 outage). A terminal multiplies per-user concurrent surfaces. **The 524 outage class has a watchdog but no pre-production test.** |
| **5** | **No provider contract tests against live vendors.** There are shape tests (`test_analyst_intel_fmp_shapes.py`, `test_institutional_holdings_fmp_shapes.py`, `test_bars_vendor_verify.py`, `test_vendor_truth.py`) and a socket guard (`test_vendor_socket_guard.py` / `api/services/vendor_socket_guard.py`, `refuse_if_local()` at `bar_stream.py:497`, `realtime_stream.py:525`) — all **offline against recorded shapes**. | The `provider_coverage_monitor` docstring is the proof: two Finnhub endpoints returned **403 on every call for months** and no test noticed, because a shape test on a mock cannot see a live 403. | Terminal-Next will add providers. The *monitor* is the compensating control and it is production-only — a provider break is detected after shipping, never before. |
| **6** | **The rail's own selection is unguarded.** Vitest positional args are substring filters; `CalendarWidget.test.jsx` does not exist and the run still passed 31 files. `tests/test_calendar_*.py` misses `market_calendar`, `ipo_calendar`, `econ_calendar_fmp` and the J2 calendar backend. | §1.1, §1.3 above. | The rail Terminal-Next is told to trust can shrink silently. |
| **7** | **35,764 warnings drown the backend run.** | §1.2. | Any first-party deprecation introduced by Terminal-Next is invisible on Python 3.14. |
| **8** | **No full-suite protocol is committed.** The "~14 chunks" partition exists only in operator memory; `pytest.ini` names "chunked suite runs" as a real runner but no runner is on disk. | §2.7. | With ~100 roles, "run the suite" must be a command, not a habit. |
| **9** | **Windows/Linux divergence is untested.** `scheduler_lock` degrades to an always-grant no-op on Windows; pytest-timeout has no SIGALRM on Windows and **kills the process** instead of failing one test. All local development is Windows; production is Linux. | `api/services/scheduler_lock.py`; `pytest.ini` timeout comment. | A scheduler-ordering bug is structurally invisible locally. |
| **10** | **The `C:\data` tripwire is a *test-suite* rail only.** A bare `python tools/…` run writes to live files, and `run-local.ps1` *creates* `C:\data` if absent. | conftest.py's own closing warning; `run-local.ps1`. | Terminal-Next will run many `tools/` scripts during research. **This is a live hazard for this very program.** |
| **11** | **Single-process correctness guards.** `sync._locks`, `recent_orders._last_poll`, `manual_refresh._last_trigger`, `notifications._failure_pinged`, `partner_health._cache` are per-PROCESS state that are guards, not caches. | `CLAUDE.md` "SINGLE-PROCESS assumptions"; `api/services/scheduler_lock.py`. | The first thing that breaks when a terminal forces horizontal scale. |
| **12** | **`/api/ready` exists, is correct, and is deliberately wired to nothing.** | §4.3. | Terminal-Next will be tempted to wire it. Doing so reproduces a 3-minute outage. The guard test exists; the *documentation* trap is what needs to be carried forward, loudly. |

---

## GAPS (what my budget did not reach)

* **I did not run the full test suite, any mutation gauntlet, `tools/ast_conformance.py`, `tools/chart_parity.py`, or `tools/flag_ledger_audit.py`.** Contract forbids the first; the rest were out of budget. Every number I quote from `docs/runbooks/ast-conformance-gate.md` (16/16 unguarded, 0 escaped, 17 asts × 579 bars, 70 declared entries, 7/7 killed) is a **CLAIM read from the runbook**, not a measurement I made. The runbook itself warns that its §3 numbers went stale once already.
* **I did not read `api/services/wire/coverage_monitor.py` or `coverage.py`** beyond confirming they exist and post to Discord. The wire is another agent's subject.
* **I did not read the flow-worker self-heal lease in full** — only the two references (`liveflow_monitor.py:290`, `flow_worker_main.py:125`). The lease semantics (duration, steal conditions) are unverified.
* **I did not read `api/services/readiness.py` past line 35**, so I cannot enumerate its warm gates from primary source; the T+20/45/60/120 s schedule is quoted from its own docstring.
* **I did not enumerate scheduler jobs** in `api/main.py` (there are dozens). D-04 owns topology.
* **I did not verify `api/routers/earnings.py` is mounted.**
* **I did not read `tests/test_shared_data_root_guard.py`**, only the root conftest's description of it.
* **`docs/superpowers/plans/**` and `docs/superpowers/specs/**` were sampled, not surveyed** — they are large and contain much of the historical rationale.

## NOT INSPECTED (out of reach, and why)

* **Production Railway state** — services, variables, logs, deploy history, `railway status`. This contract does not authorise the Railway CLI, and the preamble forbids production probing. **Every statement about what is running, scheduled, armed, or alerting in production is therefore a CLAIM.** Specifically unverified: whether `SENTRY_DSN` is set; whether the 86 `armed` flags really are armed; whether any monitor has posted to Discord recently; whether `healthcheckPath` on the live services matches `railway.json`.
* **`https://uctintelligence.com/api/health`** — the contract did not authorise it and I did not call it.
* **The local backend on port 8077** — preamble forbids probing it, and it serves stale data against live `C:\data`.
* **GitHub repository settings** — branch protection, required status checks, environments. Not in the repo. The `plugin:github` MCP server failed to connect this session (`400 … Authorization header is badly formatted`), so I could not query the API. This is the one place my §3 conclusion ("nothing gates a deploy") could be wrong: a required-check rule configured in GitHub would not appear on disk. **What would settle it:** `gh api repos/:owner/:repo/branches/master/protection`.
* **`external/morning-wire` and `external/uct-intelligence`** — submodules, empty in this worktree by design (and `tests/test_test_discovery_coverage.py` excludes them explicitly for exactly that reason).
* **Partner-owned files** (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`) — noted as existing and, in `OptionsFlow.jsx`'s case, as the *sole* subject of the repo's only CI workflow. Not described further.
* **Git history** — this contract does not name the read-only git exceptions, so no `git log`/`show`/`blame` was run. Commit SHAs quoted anywhere above (`e86ad6d5`, `650865d5`, `021b4926`, `d26cee0c`, `ed53f9b6`) are transcribed from source comments and `CLAUDE.md`, unverified.
