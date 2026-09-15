---
id: WISDOM-SESSION-9
title: Session 9 — the three passes are bought; the floor blocks 88% and every CALL was demoted
status: complete — 13 commits, 249 API calls, $14.6090
---

# Session 9 — three passes, and what they cost to learn

> ## ✅ READINESS: **RUN BOUGHT**
>
> Three passes of the golden gate against `golden-v1.1`, `claude-opus-5` / `high` / batch,
> **$14.6090**. Ledger **$31.4815 of the ruled $40.00**. 2,490 records persisted across three
> runs, every one re-derivable offline for $0.00.

`feat/wisdom-loop` `87d3bfb6d` → **`e74347ec9`**, pushed (13 commits). Scoped suite **1145 passed · 1 skipped ·
0 failed** over 66 named files (128 s).

## Rulings — one line each

| ruling | outcome |
|---|---|
| **R33** `railway run`: YES/AUTO | ✅ used for all three passes; injects, never writes |
| **R34** KEYRING: YES | ✅ applied + mutation-proved — ⚠️ but `requirements.txt` **backed out**, see step 2 |
| **R35** SETTINGS_ENV: DOCUMENT_ONLY | ✅ documented as refused; nothing written |
| **R27** GOLDEN_SET: V1_1 | ✅ **BOUGHT** — 3 × 83 segments, sha `c26c871ea5a1` pinned on every pass |
| **R24** via railway exit codes: YES | ✅ **CLOSED** — 0 of 25 gates SET on production `web` |
| **R8** FLAGS: HOLD | ⏭️ nothing flipped |
| **PUSH_BRANCH** | ✅ pushed after every commit, branch only; master never touched |
| **AGENT_CAP: 3** | 0 sub-agents used |

---

## STEP 1 — R24 is closed: production is dark, and now that is MEASURED

> **0 of 25 registry gates SET on `web`**, including all **10 member-visible** ones.

⛔ **The method is the only reason this was permissible.** Presence was read by a child process's
**exit code**, one child per gate name — exits 0 if present, 1 if not, prints nothing either way.
No command that lists variables was run; no value was printed, hashed, compared or written.
**Presence is a one-bit fact and a value is not**, and an exit code is the only channel narrow
enough to carry the first without the second.

The session-5 paragraph calling this "unmeasured rather than measured" is **marked in place, not
rewritten** — it was honest when written.

## STEP 2 — R34, and the rail that refused it

The key now has three sources: `WISDOM_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY` → the OS
credential store (`uct-wisdom` / `anthropic`). **A tie goes to the ENVIRONMENT**: `railway run` and
a one-off export are deliberate acts scoped to one process; the store is ambient and applies to
every run on the machine.

⚠️ **The rail refused my implementation and was right twice.** I declared `keyring>=24.0` in
`requirements.txt`. That file is **flow-worker watched (§0.4i)**: merging it redeploys flow-worker,
drops the Massive OPRA socket, and Massive does not replay — **the tape gap is permanent until the
T+1 flat file.** Investigating surfaced a second objection the rail does not state: *"declared but
not installed"* was true of this box and **false of Railway**, where it would install a
credential-store library on six services to serve a fallback that only ever runs on the operator's
laptop. **Backed out; `requirements.txt` is byte-identical to its pre-R34 blob.** Nothing is lost —
the fallback was built to be absent and is railed both ways.

## STEP 3 — R35: the settings-`env` fallback is documented, never written

DOCUMENT_ONLY. Two standing rules forbid it independently (§11.3 — a key never lives in a file; and
never self-granting through settings). ⭐ Written down anyway because an undocumented path gets
rediscovered and tried, and **the hazard is that it would work.**

## STEPS 4–6 — the three passes, reconciled and audited

| pass | run id | records | cost | rounds | cache read | 4d |
|---|---|---:|---:|---:|---:|---|
| 1 | `20260915T085142Z` | 827 | $4.7497 | 2 | 0.7484 | **MATCH 30/30** |
| 2 | `20260915T121930Z` | 824 | $5.0955 | 3 | 0.5833 | **MATCH 30/30** |
| 3 | `20260915T123550Z` | 839 | $4.7638 | 4 | 0.7594 | **MATCH 30/30** |

Every pass re-scores offline from its persisted records to all 30 reported fields, each with a
**self-check that fires on the same data** (dropping one record reds `PRINCIPLE fp`). A MATCH over
30 fields is otherwise just as consistent with a comparison that stopped comparing.

### ⭐⭐ Recall is stable; precision is where the non-determinism lives

`tp` is **invariant across all three runs** for CALL (17, 17, 17), MENTION (51, 51, 51),
NEGATIVE_CALL (5, 5, 5) and MARKET_SIGNAL (3, 3, 3). Only `fp` moves. **The model finds the same
true records every time and varies in how much extra it emits.** No single pass could have said
this, and it is the most useful thing the three passes bought.

### Stability at n=3, and the floor's first real verdict

    MARKET_SIGNAL   236 identities    3/3: 21    2/3: 43    1/3: 172
    PRINCIPLE       182 identities    3/3: 31    2/3: 36    1/3: 115
    MENTION         778 identities    3/3: 407
    CALL *          116 identities    3/3: 79                     (* extractor view — see step 7)

    floor:  MARKET_SIGNAL  PUBLISH 21  BLOCK 215
            PRINCIPLE      PUBLISH 31  BLOCK 151
            ENQUEUE -> 'contradictions' / 'below_publication_floor':  366

⭐⭐ **The two types Q17 chose to floor are, by a wide margin, the two least reproducible** —
MARKET_SIGNAL 8.9%, PRINCIPLE 17%, against CALL's 68%. The floor was placed on the right types and
that is now a measurement rather than a design assumption. **It blocks 366 of the 418 identities it
governs — 88%**, where sessions 4 and 5 could only measure it inert against an empty store.

⚠️ **PUBLISH equals the `3/3` column exactly**, because at n=3 only 1.0 clears a floor of 0.8 and
0.667 does not. The floor is currently **"unanimous or blocked"**. See question 4.

⛔ **366 is the predicate's verdict, not 366 review rows.** `wisdom_review_queue` holds **0**.

### R30 — a third of MARKET_SIGNAL's churn looks like RENAMING

`market_signal_keys 236 · suspected_renames 85 · share 0.3602 · threshold 0.5 · n 3` — up from 22%
at n=2. R30 accepted a name-based identity because the error is bounded safe and fully recoverable
offline; that bet is now quantified. ⛔ Counts only: the keys are `normalize_quote_key` of
model-written names, so they are quote-derived and the audit's `examples` field is **dropped, not
truncated** — a truncated quote is still a quote.

## STEP 7 — two findings that no number would have shown

### ⛔⛔ Every CALL was demoted to MENTION, and the gate table cannot show it

**99 of 99 CALLs, 28 of 38 LEVELs, 2 of 9 NEGATIVE_CALLs.** `record_type` contains no CALL at all,
while the gate reports `CALL tp=17 P=0.680`. Both are correct: **the table scores
`pre_entity_type`**, fixed before entity resolution (`writer.py:494`). The gate measures the
extractor; it does not measure what would be written.

Traced, not guessed — and the innocent explanation was checked first: `authors.json` marks all four
authors `can_author_calls: true` and only 8 records anywhere say `not_a_call_author`. The author
gate passed; the **entity** gate fired (`writer.py:504`). All 99 carry `call_entity_unresolved`,
**not** `:no_resolver` — a resolver ran and returned nothing — and all 827 records have
`entity: none`. Cause: `entity_master/schema.py:33` derives its path from `DATA_DIR` **at import**,
so under `railway run` it took production's `DATA_DIR` and landed on this box's
`C:\data\entity_master.db` — present, 86 KB, **untouched since 09-02**, holding nothing for these
tickers.

**Bounded:** the gate table, the floor (PRINCIPLE and MARKET_SIGNAL are never demoted) and the R30
audit are unaffected. Only the reconciler's per-type view is hit, and it is **recoverable offline
for $0.00** — every row carries `pre_entity_key` beside `record_key` (129 rows differ; 99+28+2).

⛔ **Nothing was changed.** Seeding the entity master mid-programme would confound the three-run
comparison exactly as the withdrawn PRINCIPLE delta was confounded by a tokenizer that moved
between runs. The environment stayed frozen across all three passes.

### The run-to-run spread retrospectively vindicated refusing the v1 comparison

v1 measured PRINCIPLE at **14/6/1**. Pass 1: 13/7/2 — a drop, cited alone. Pass 2: **14/5/1**,
nearer v1 than pass 1 was. Same configuration, same bytes. **The regression was sampling noise.**

### `baseline=True` on every pass is correct

`decide_gate` (`golden.py:517`) **deliberately skips** a prior run of the same
extractor_version+model+effort. It is a cross-**configuration** check; comparing a configuration to
itself would flag exactly the spread above and be muted within a week. ⛔ So read `accepted` as
*"no different configuration to regress against"*, not *"these numbers are good"*.

### The local chain run — `reconcile_stability` fires, and writes to nothing

Run against a **sandbox copy** with the census pins applied before any `api.**` import (bare,
`store.write()` resolves to the owner's live `C:\data\wisdom.db`). It reconciled **1,223
identities** correctly, then reported **`records_updated: 0`**, because `wisdom_records` is empty —
the gate persists to JSONL and never ingests. ⭐ Visible only because `write_scores` returns counts
*"so a write that matched nothing is visible rather than reported as success"*. **Item 2 is correct,
wired, and end-to-end inert against a gate run.**

### The shared root — baseline taken, moved, closed with a named writer

`C:\data\wisdom.db` changed at **07:24:39, 07:29:39, 07:34:39, 07:54:39** — five minutes apart, on
the same second, **size unchanged at 352256** every time. `wisdom_job_heartbeats` (job ids and
timestamps only) shows `wisdom_core_catchup` and `wisdom_core_watchdog` beating at `08:34:39-04:00`
— the mtime to the second, ~380 beats, both `skipped`. A local scheduler; the gate is not
implicated. ⭐ The method is the point: baseline **before** the run, stop when it moves, then read
the artifact that records the fact.

### The flag checklist — computed at report time

**2026-09-15 08:59 EDT, Tuesday.** `wisdom_daily_chain` is cron mon-fri **18:47 ET**
(`CONTRACTS.md:296`), so the next fire is **today, 18:47 EDT — 9.8 hours away.**
⛔ A flip at that window still writes nothing: `wisdom_records` is at 0 rows.

---

## 1. MUTATION-PROOF

**R34 — the store must lose every tie.** Rewrote `make_client` to consult the keyring *before* the
environment:

    R34 mutation — keyring consulted BEFORE the environment
    TOTALS: 1 failed, 13 passed in 0.47s
      - test_the_environment_beats_the_store
    restore: byte-exact

⚠️ The anchor had to be encoded **CRLF** — `batch.py` is CRLF on disk and an LF-anchored mutation
matches zero times and asserts out before touching the file. Restored by writing back captured
bytes and verifying sha256; **never `git checkout`**.

**Three more proofs of a different kind**, run against real paid data: the offline re-scorer's
self-check dropped one persisted record on each of the three passes and reddened a field every
time (`PRINCIPLE fp` 7→6, 5→4, 6→5). A gate nobody has seen fail is not a gate.

**And one rail fixed rather than the thing it matched.** `test_the_grep_on_this_checkout…` searched
the journal-exclusion grep's whole stdout for the substring `INCONCLUSIVE`. That grep **echoes every
matched source line**, so any file containing the word — a three-exit-code tool printing its own
verdict — makes the check report *"the rail could not measure"* because of a string in the material
it measured. The instrument reporting a property of itself; CLAUDE.md lists six earlier instances.
Now line-anchored, with the floor test carrying the control that proves a real verdict is still
seen.

## 2. TOTALS

| | |
|---|---|
| API calls | **249** (83 × 3), 9 batch rounds, 0 errors, 0 retries |
| spend | **$14.6090** — ledger $31.4815 of $40.00 |
| measured rate | **$0.05723 – $0.06139** per segment |
| Q4 — 9,733-segment catalog, one pass | **~$557 – $598** |
| records persisted | **2,490** across 3 runs, all re-derivable for $0.00 |
| identities reconciled | 1,223 |
| commits | **13**, branch only; master never touched |
| scoped suite | **1145 passed · 1 skipped · 0 failed** (66 files, 128 s) |
| sub-agents | 0 |

## 3. QUESTIONS FOR PATRICK

**Q1 — raise `--max-usd`, for wall-clock only?** `SpendCap` is **cumulative over the whole
ledger**, so each pass opened with less headroom and split into more batches: 2, then 3, then 4
rounds. Worst case is $0.42/request, so 83 requests **reserve $34.86** and actually cost ~$4.85 —
**14% of the reservation**. Raising the cap would cost **nothing in actuals** and collapse each
pass to a single batch. ⛔ Not raised: $40 is the ruled figure and a session does not edit the
spend cap.

**Q2 — the entity master.** Every CALL demotes to MENTION because
`C:\data\entity_master.db` holds nothing for these tickers. For *measurement* nothing is needed —
the extractor view recovers it offline for $0.00. For **publishing**, entity resolution has to
work, or the CALL lane produces no CALLs. Seed it and re-run, or accept the extractor view for
now?

**Q3 — MARKET_SIGNAL's identity (R30).** 8.9% stability, of which **36% of keys are suspected
renames**. Change the key, or keep the name-based one and let the floor block?

**Q4 — is "unanimous or blocked" the intended yield?** At n=3, `MIN_RUNS=3` with a floor of 0.8
means only 3/3 publishes; 2/3 = 0.667 does not. That blocks **88%** of the floored types. A floor
at ≤0.667 would admit 2-of-3. Is 88% the intended cost of the guarantee?

**Q5 — when does something populate `wisdom_records`?** Item 2 and item 3 both act on the
database, and the golden gate never ingests. Until a real extraction writes records, the
reconciler computes correct scores for zero rows and the floor blocks nothing in practice.

**Q6 — merge timing.** The branch no longer touches any flow-worker watched file, so a master
merge restarts **web only**. Still a market-hours consideration under `deploy-windows.md`, not a
tape-gap one.
