# Deploying `worktree-indicator-ecosystem` — checklist, member impact, rollback

**Status: NOT AUTHORISED.** Written 2026-09-09 so the decision can be made on
facts rather than on a diff. Nothing here is a recommendation to ship.

Railway deploys from `master`, so `git push origin worktree-indicator-ecosystem:master`
IS the deploy. There is no staging step between that push and members.

---

## 0. The thing to know before anything else

> **Nothing in the indicator ecosystem program has ever been deployed** — not
> Waves A–C, not C0–C4, not the Pine runtime, not this week's corrections.
> Merge base with master: `12cf5c8d3` (Fri 4 Sep).

**The program ships as ONE UNIT — owner ruling, 2026-09-09.** Cherry-picking a
subset is off the table, so "deploy the wave" is not an option that exists: the
smallest thing that can reach master is the whole branch.

⚰️ **A NUMBER IN THIS SECTION WAS WRONG AND THE REASON IS WORTH KEEPING.** It
first read *"97 commits behind"*, measured against the LOCAL `master` ref — which
was itself **591 commits behind `origin/master`**. The true divergence at the
first merge was **144 ahead, 688 behind**. A local branch ref is a snapshot of
the last fetch, not a fact about the remote; measure against `origin/master`, and
`git fetch` first.

### Merge debt is paid down continuously, not at the end

Owner ruling, 2026-09-09: **merge `origin/master` into this branch at least once
a week, and after any large master push**, so the final deploy is a small delta
rather than hundreds of commits of untested integration. Each merge is its own
commit carrying a summary of what conflicted and what was resolved. **If a master
change collides with the engine or the manifest in a way that needs a decision,
stop and ask** — do not resolve an engine conflict on your own judgement.

| Date | Ahead | Behind | Conflicts | Notes |
|------|-------|--------|-----------|-------|
| 2026-09-09 | 144 | 688 | `.gitignore` only | Master never touched `app/src/components/chart/engine/**`, the manifest, `user_definitions.py`, `ast_*`, `scan_definition.py`, `scan_evaluator.py` or the definitions router. Both sides added an ignore block at the same offset; kept both. `api/main.py`, `StockChart.jsx` and `test_exposed_routes_gated.py` auto-merged and were checked by hand (see §4). |

---

## 1. What members would actually see change

Everything in this table is a **correction**, not a feature. In every case the
old behaviour was wrong and nothing on screen said so.

| # | Change | Who sees it | What they notice |
|---|--------|-------------|------------------|
| 1 | **RSI on a stock that has not moved at all** over the lookback | Screener | The cell reads *not computable* instead of a number. Deliberately narrower than "flat" — `chg_pct_1d` still shows `0.00`, because a change of zero is a true fact while an RSI of a motionless series is not. |
| 2 | **RSI / ATR / MACD / ADX across a data gap** (halt, thin session, late feed) | Charts, alerts, screener | Previously: `atr`/`macd`/`adx` went blank from the first hole to the end of the chart; **`rsi` was worse — it kept drawing, and every value after the hole was wrong and never re-converged, with no visible gap at all.** Now all four hold across the hole and resume correctly. |
| 3 | **`ta.rising` / `ta.falling` across a gap** | Member-authored formulas | Were being evaluated as finite windows; they are carried counters. Three sources, 375/0 against the vendor after the fix vs 287/88 before. |
| 4 | **`ta.wma` across a gap** | Member-authored formulas | Forward-fills its lookback; answers `na` only when the *current* bar is `na`. |
| 5 | **`highestbars` / `lowestbars` / `aroon` on tied extremes** | Member-authored formulas only | Ties now resolve to the **oldest** bar, matching TradingView (380/0 vs 193/187). **~6–10% of bars move on real SPY OHLCV.** |

**How far #5 reaches, measured:** no starter scan, no native indicator, no
screener row and no firm-authored screen calls `highestbars`, `lowestbars` or
`aroon`. They are grammar surface — reachable only if a member writes one, by
hand or through a translated Pine/ThinkScript/PCF script. ✅ **MEASURED ON PRODUCTION, 2026-09-09** (count-only query, authorised by the
owner; no definition text and no member identifiers were read or returned):

```
LIVE_TOTAL=5  ARG_EXTREME_HITS=0  UNREADABLE=0
```

**No live member definition references `highestbars`, `lowestbars` or `aroon`.**
The denominator is in the output on purpose — a bare `0` cannot be told apart
from a query that found nothing to look at. So change #5 moves **no number any
member can currently see**, and the 6–10% figure describes what would move if
somebody writes one of the three tomorrow.

---

## 2. What ships but is invisible

Each of these is verified inert, not assumed inert.

| Change | Why nothing changes for a member |
|--------|----------------------------------|
| **Strict / host mode** in `translatePine` | Opt-in via `opts.strict`. Grepped `app/src` outside tests: **zero callers pass it.** Every existing caller gets the lenient screener contract byte-for-byte as before. |
| **`requirements` column + the five consumer refusals** (screener, sweep, alert, share, listing) | The only tag that exists is set by `ta.cum`, and `translatePine` refuses `ta.cum` in **both** modes today — so no definition a member can author carries a tag, and all five refusals are unreachable. `tests/test_user_definitions_migration.py` asserts that unreachability rather than assuming it. |
| **The column itself** | Already applied to production on 2026-09-09, ahead of the code, and verified read-clean by the *currently deployed* build. See §3. |
| **`ta.cum` in the engine** | Not landed yet. |
| **The plotted pane** | Not built yet; lands behind a feature flag, default off. |
| **The Pine runtime (Phases 2A–2F)** | Reachable only through translate. Strict-mode census: 58 scripts translate, **27 build a runtime IR** — unchanged by strict mode, because `buildRuntimeIr` was already all-or-nothing. |

---

## 3. Rollback

**The code:** revert the merge commit on `master` and push. Railway redeploys
from `master` and serves the previous successful build on failure.

**The `requirements` column: nothing to do, and that is verified rather than
assumed.**

- It is inert to the old code: `SELECT *` results go through `sqlite3.Row` and
  are read **by name** in `_row_to_dict`; every `INSERT` names its columns
  explicitly. Confirmed against the running pod on 2026-09-09 —
  `live_definitions()` returned 5 definitions with the column present.
- `NOT NULL DEFAULT '[]'` means an old-code insert supplies nothing and the row
  is still valid.
- **Do not try to drop it.** SQLite has no safe in-place `DROP COLUMN` on this
  version; removing it means rebuilding the table, which is a far larger risk
  than the thing being removed.
- A revert that removes `_migrate` leaves the column in place, untouched, and
  ignored. That is the intended end state of a rollback.

**The backup, taken before the column existed:**

```
/data/backups/user_definitions.pre-requirements.20260909T032141Z.db
57,344 bytes · opens · PRAGMA integrity_check ok · 6 rows
all 6 ast_hash values match live, in order
```

Taken with `sqlite3.Connection.backup()`, not a file copy — a copy can miss the
WAL. Restoring it is a last resort and would discard any definition saved since.

---

## 4. Pre-deploy gate

Run in order. Any red stops the deploy.

1. **Merge `origin/master` into the branch** and resolve. ⚠️ `origin/master`,
   never the local `master` ref — see §0 for the number that got away.
   With the weekly cadence in §0 this should be a small delta by deploy time.
2. 🔴 **`grep -c broker_sync api/main.py` must be ≥ 7.** This is the locked
   invariant after *every* master merge — a concurrent commit silently dropped
   the router mount once, and `POST /connect` fell through to the SPA catch-all
   as a 405. Check it here, before anything else.
3. **Backend suite in chunks** (~9,600 tests; the full run OOMs in one go).
4. **Frontend:** `cd app && npx vitest run`. ⚠️ Never `-t` — a vitest filter that
   matches nothing exits 0 and reads as a pass.
5. **Conformance re-record** and confirm the diff is the 4 expected moves,
   0 added, 0 removed, no lane disagreement.
6. **Build the frontend** so the backend serves fresh `dist/`.

**Do not run anything heavy on the prod pod.** That has caused a member-visible
outage twice.

### 🟠 One KNOWN-UNRELATED red — do not read it as a regression

```
FAILED tests/test_broker_bias_scan.py::TestTheDigestActuallyRuns::test_it_flags_and_names_a_leaning_book
        AssertionError: a steady lean must be reported
```

It fails **in isolation**, and this branch has never touched its subject:
`git log origin/master..HEAD -- tests/test_broker_bias_scan.py
api/services/journal_two/ api/services/auth_db.py` is **empty**. The test imports
only `auth_db`, `journal_two.accounts`, `journal_two.db` and
`journal_two.broker.mirror_check`.

⛔ **It is recorded here so it is not mistaken for merge damage at deploy time**,
which is exactly what an unexplained red beside a 688-commit merge looks like.
The owner is raising it with the partner who owns that code (2026-09-09); it is
**not this branch's to fix**, and fixing it here would touch partner-owned files
without an ack.

---

## 5. Post-deploy verification

1. `/api/health` — `uptime_seconds` must have **reset**. That is the artifact;
   a successful push is not.
2. Open a chart on an ordinary liquid ticker (SPY) and confirm RSI/MACD/ATR read
   as before. None of the corrections should move a symbol with clean history —
   if one does, that is the signal to revert.
3. Open a chart on a ticker with a known halt and confirm the indicator now
   continues past it instead of stopping.
4. Screener returns rows; spot-check one RSI cell.
5. `/api/scans/definition-results` answers.

---

## 6. The member-facing note

Post as-is. Three sentences, no jargon.

⭐ **THIS IS THE OWNER'S OWN WORDING (2026-09-09), NOT A DRAFT.** It replaced a
longer one. Do not re-edit it without asking — it is member-facing copy and the
voice is the owner's to set.

> We fixed how several indicators handle gaps in price history. When a stock had
> a hole in its data — a halt, a thin session, a late feed — RSI, ATR, MACD and
> ADX could stop calculating or quietly report a slightly wrong value from that
> point on. They now carry across the gap correctly. Separately, a stock whose
> price hasn't moved at all no longer gets an RSI reading in the screener.
