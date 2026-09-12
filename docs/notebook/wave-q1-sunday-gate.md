# Wave Q1 — the Sunday 18:00 ET gate

**This is a READ, not work.** If it takes more than ten minutes something has gone
wrong with the preparation, not with you.

---

## 0. FIRST — did the sampler actually run?

⛔⛔ **A log with no rows looks exactly like a quiet week.** The sampler writes a
SKIPPED row when it *runs* and cannot proceed; it writes **nothing at all** if the
job never fired, and Task Scheduler's exit code is the only signal for that case.

```
schtasks /Query /TN "UCT-WaveQ1-Observe" /FO LIST /V
```

- **`Last Run Time`** must be within the last 2 hours.
- **`Last Result`** must be `0`.

⛔ If either is wrong, **the table is incomplete and its silence means nothing.**
Say so in the verdict and treat the window as unobserved for that period rather
than as clean.

## 1. The log

`C:\Users\Patrick\uct-q1-observe\wave-q1-observation-log.md`

One row every 2 hours. Columns: `latest opt-in (UTC)`, `opt-in (windowed)`,
`blocked-baseline`, `sync-conflict notes`, `outbox (rig only)`, `console errors
(rig)`, `flag`.

⛔ **`opt-in (windowed)` is NOT a lifetime count** — it reads the last 200 activity
rows and can DECREASE as old ones roll off. It did (20 → 19). **Read `latest opt-in`
instead.** Every opt-in up to **`2026-09-12 05:17:56`** is the rig; a `latest`
newer than that, with no canary running at that minute, is a **real member**.

## 2. The four triggers

| # | trigger | where it is read | what counts |
|---|---|---|---|
| 1 | any unexplained red | the log's `flag` column | any row not `OK`, whose reason you cannot account for |
| 2 | a fork not attributable to a genuine second writer | `sync-conflict notes` column + canary rows | see §3 |
| 3 | an outbox item stuck > 5 min | ⛔ **canary result or member report — NEVER the sampler** | the sampler runs OPTED OUT, so its outbox is structurally 0 |
| 4 | an offline-layer console error seen by a real member | `console errors (rig)` + any member report | a rig error still counts: it is the same bundle |

## 3. "Attributable to a genuine second writer", operationally

A `(conflicted copy)` note is **expected and correct** when two *different*
writers touched the same note. It is a **defect** when one writer produced it.

**Attributable** — do not trigger — if any of:
- a canary run was in flight at that minute (the rig is a second writer by
  construction when its raw-fetch door is used);
- the member has the Notebook open in **two tabs or two devices** — two real
  writers, and forking is the designed answer;
- the count rose from the **3 preserved round-3 evidence notes**, which are
  historical and must never be counted as new.

**NOT attributable** — trigger a REVERT — if:
- `sync-conflict notes` rose with **no canary running** and **no second
  tab/device**, i.e. a single writer forked its own note. That is the defect this
  whole wave exists to prevent.

## 4. The verdict

Write `docs/notebook/wave-q1-gate-verdict.md`:

```
VERDICT: KEEP | REVERT
at:      <timestamp ET>
heartbeat: Last Run Time <...>  Last Result <...>
rows read: <n> rows, <first> .. <last>
trigger 1 (unexplained red):        PASS/FAIL  <evidence>
trigger 2 (unattributable fork):    PASS/FAIL  <evidence>
trigger 3 (outbox stuck >5 min):    PASS/FAIL  <canary result / member reports>
trigger 4 (member console error):   PASS/FAIL  <evidence>
```

## 5a. KEEP

The 7-day window continues from the flip timestamp (**2026-09-12 00:45 ET**),
closing **2026-09-19 00:45 ET**. Nothing to do but let the sampler run.

## 5b. REVERT

1. Merge the **draft rollback PR** for `rollback/notebook-offline-default-off`
   @ `3db89e205`, **with a MERGE COMMIT** — not squash, not rebase, because this
   record cites these hashes.
2. Verify on `origin/master`:
   `git show origin/master:app/src/pages/journal-2-0/lib/offline/offlineFlag.js | grep OFFLINE_DEFAULT_ON`
   must read **`false`**.
3. Confirm `web` redeployed: `railway deployment list --service web --json` shows
   the revert SHA **SUCCESS**, and `/api/health` `uptime_seconds` has RESET.
4. ⛔ **Reverting does not reach open tabs.** Every member already running the
   flipped bundle keeps it until they reload. There is no service worker and no
   version prompt, by charter. "Reverted" means "no NEW page load gets it".
5. For a specific member who needs it off **now**, in their own browser console:
   `localStorage.setItem('uct.j2.offline.enabled', '0')` then reload.

## 6. What this gate does NOT do

⛔ It does not merge anything automatically. A REVERT verdict is **written to the
file for a person to act on**. An instrument that can deploy is an instrument that
can deploy by mistake, and this wave has produced seven instrument defects — every
one of which made the product look broken.
