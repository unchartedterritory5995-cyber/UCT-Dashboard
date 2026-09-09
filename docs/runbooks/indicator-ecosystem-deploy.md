# Deploying `worktree-indicator-ecosystem` — checklist, member impact, rollback

**Status: NOT AUTHORISED.** Written 2026-09-09 so the decision can be made on
facts rather than on a diff. Nothing here is a recommendation to ship.

Railway deploys from `master`, so `git push origin worktree-indicator-ecosystem:master`
IS the deploy. There is no staging step between that push and members.

---

## 0. The thing to know before anything else

> **This branch is 143 commits ahead of `master` and 97 commits behind it.**
> Merge base: `12cf5c8d3` (Fri 4 Sep). **Nothing in the indicator ecosystem
> program has ever been deployed** — not Waves A–C, not C0–C4, not the Pine
> runtime, not this week's corrections.

Two consequences, and they are the whole reason this document leads with them:

1. **"Deploy the wave" is not available as an option.** The smallest thing that
   can reach master from here is the 143-commit program. If only part of it is
   wanted, that is a cherry-pick onto a fresh branch off `master`, and it is a
   separate piece of work with its own testing.
2. **`master` has moved 97 commits under us** — other sessions' Terminal, Buzz,
   breadth-drill and flow work. Those must be merged in and the whole suite
   re-run *before* any push. A merge this size can conflict, and one of the
   conflicts is known dangerous (see §4).

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
hand or through a translated Pine/ThinkScript/PCF script. Production holds 5
live definitions. Whether any of them calls one of these three is a single query
away, and it reads member definition trees, **so it has not been run.** Say the
word and it takes a minute.

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

1. **Merge `master` into the branch** (97 commits) and resolve.
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

> We fixed a few places where our indicators were handling gaps in price history
> incorrectly. If a stock had a hole in its data — a halt, a thin session, a late
> feed — RSI, ATR, MACD and ADX could either stop calculating for the rest of the
> chart or keep quietly reporting a slightly wrong number from that point on,
> with nothing on screen to show it. They now carry across the gap and pick up
> correctly on the other side, and a stock whose price hasn't moved at all is now
> shown as having no RSI reading in the screener rather than being given one.
