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

### ⛔⛔ SEVEN FAMILIES TO RULE OUT, NOT FOUR — corrected 2026-09-12

⚰️ This gate was written against *"the FOUR doors — every path that advances
`updatedAt`"*: body, folder, ticker, tags. That list came from the DERIVED WIRE
RAIL, which can only see doors a canary actually opened — and no canary could
reach a hero, so `hero` shipped to production **unsettled** while every artifact
said the list was complete.

Re-derived from the SQL: **SEVEN** server-side functions advance a note, through
nine routes and sixteen client call sites.

| family | reached by |
|---|---|
| `update_note` | the body PUT · hero set · hero remove · version restore · any property write |
| `append_widget_embed` | Send to Journal |
| `append_financial_fact` | Save price to Notebook |
| `append_document_excerpt` | Save excerpt |
| `restore_note` | Trash → Restore |
| `import_confirm` | the import wizard |
| `delete_folder` | deleting a folder — **one bulk UPDATE across every note in it** |

⛔ **The last two are the ones an operator will not think of.** A member who
deletes a folder moves every note inside it in a single UPDATE; a re-import
rewrites notes that already existed. Both produce revisions in bulk, and before
2026-09-12 neither told the browser about them at all.

⭐ **The derived list is `app/src/pages/journal-2-0/lib/offline/doorEnumeration.test.js`
(assertion ①), not this table.** That rail reads the SQL, then the router, then
the client, and fails by name when a door appears without a settle. If this table
and that rail ever disagree, the rail is right — a hand-typed roster beside the
source that owns it is exactly the defect that produced the four.

## 3b. ⛔⛔ ONE MEMBER REPORT IS A KNOWN, FIXED DEFECT — AND NOT A REVERT TRIGGER

> *"I sent a chart to my journal / saved a price / saved a PDF excerpt, and it
> VANISHED after I came back online."*

**That is Q1 fix 3, fixed at `9a213bd45`.** The landed ring vouched for the
revision the capture created and the drain rebased-and-resent the queued body over
the server's own appended block, so the append-only merge was unreachable for any
door that browser had fired. Found 2026-09-13 by widening the property rail to
seven families: 24/24 metadata green, **0/18 append**.

⭐ **It is ATTRIBUTABLE, and it is NOT a reason to revert the wave.** The wave is
what makes the merge possible at all — reverting returns that member to a product
with no queue for the block to be lost from, which does not give them their widget
back and costs everyone else the durable working copy. Check the SHA the pod is
serving: if `9a213bd45` is an ancestor, the report predates the fix.

⚠️ **It is bounded.** It needs a queued outbox entry for the same note at the
moment the capture fires. With nothing queued there is no 409 and nothing to
rebase, which is why no canary caught it in seven days of observation — the rig
never captured a widget while holding queued work.

## 3c. ⛔⛔ HOW THE GATE READS THE LOG — four faults fixed 2026-09-13, before the 17:05 run

**Each one alone printed `REVERT` against the live log, and nothing was wrong
with the wave.** Recorded here because an operator reading a verdict has to
know what the reader can and cannot see.

| # | the fault | what it printed |
|---|---|---|
| 1 | rows were selected on *“starts with a pipe”*, so §3's member identity/exclusion table — **prose, in this very document's sibling log** — was read as five observation rows ending in `**no**` / `**YES**` | *trigger 1: 5 non-OK row(s), first at identity* |
| 2 | triggers 2 and 4 read **hard-coded column indices**, correct for the 8-column header and off by one under the 9-column one the Wave K config-served column created | trigger 2 was reading `blocked-baseline` under the name sync-conflict; trigger 4 was reading `outbox` under the name console errors |
| 3 | the **SKIPPED exclusion lived in trigger 1 only**. The 2026-09-12 23:00 SKIP (production unreachable mid-deploy) carries 20 console errors from a page that could not load | *trigger 4: console errors at 2026-09-12 23:00 ET* |
| 4 | the sampler's **identity-based member count was computed and overwritten** on the next line, and that branch emptied the canary windows the timing fallback needs | *FIRST MEMBER OPT-IN 2026-09-12 15:45:46* — on a row whose own count says `members 0` |

⭐ **What the reader does now, and what it still cannot do.** Columns are
resolved **by name** from the log's own header, so the eight- and nine-column
blocks are both read correctly and a **header spelling the gate does not know
is a LOUD failure** rather than a silent shift onto the neighbouring column. A
row is an observation row only when its first cell is `YYYY-MM-DD HH:MM ET`.
`SKIPPED` is decided in **one place** and every trigger reads the same
partition. The identity count **wins whenever a row carries one**; the timing
rule answers only when no row does, and the verdict line says which rule
answered.

⚠️ **A row the gate cannot READ is reported as its own line and makes the
verdict `INCOMPLETE`, never `REVERT`.** “I could not parse it” and “it is bad”
are different facts, and this wave has now conflated them three times.

⚰️ **All four arrived with work that made the gate BETTER** — the
attributable-member report, the config-served column, the sampler learning to
write a SKIPPED row instead of failing silently. Every one of those was right.
**What was missing is that the READER was never re-derived when the thing it
reads changed.** Rails: `tests/test_nb_gate_columns.py`, plus **G1–G3 in the
mutation gauntlet, permanent**.

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

0. ⭐ **SINCE WAVE K THERE IS A FASTER LEVER, AND IT IS THE ONE TO PULL FIRST.**
   `railway variables --service web --set "NOTEBOOK_OFFLINE_DEFAULT_ON=0"` turns
   the wave off without removing any code — read per request in `_access_payload`,
   so no rebuild. Verify a NEW BOOT and read the value in-process, never `--kv`.
   Steps 1–3 below still apply when the CODE has to come out (a defect in the
   durable layer itself, not a decision to stop defaulting it on).

   > **REACH — verbatim, §2b of `kill-switch-spec.md`:** a flip reaches a member on their next authenticated request or reload; it does not reach a tab mid-session (latched for §21). If the auth payload is unreachable, the wave stays ON — the switch kills a decision, not an outage, until K-1.

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
