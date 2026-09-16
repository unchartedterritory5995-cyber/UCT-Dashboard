---
id: WISDOM-SESSION-10
title: Session 10 — identity bounded, the chain on real rows, two session-9 errors corrected
status: complete — 5 commits, 0 merges, 0 API calls, $0.00
---

# Session 10 — identity bounds, end-to-end on real rows, the Tier-1 holes closed

> **SPEND: $0.00. Ledger BYTE-IDENTICAL at both ends** — sha256 `d976dba7a2d963a4…`, 5,405 bytes,
> `total_usd 31.4815` of `cap_usd 40.0`, 28 entries. No API call, no gate run, and **`railway` was
> not invoked in any form**.

`feat/wisdom-loop` `53d3d3ce1` → **`d6d9c926c`**, pushed. Scoped suite **1175 passed · 1 skipped ·
0 failed** over 68 named files (220 s).

## Rulings — one line each

| ruling | outcome |
|---|---|
| **R39** IDENTITY_STUDY: YES | ✅ four identities measured; KEY reproduces session 9 exactly |
| **R40** LOCAL_INGEST_TOOL: YES | ✅ built; **826 of 827 record_ids identical** to the persisted run |
| **R41** RUN_CHAIN_ON_REAL_ROWS: YES | ✅ `records_updated 826`, floor **blocked/enqueued 143**, queue 184 → **327** |
| **R42** ENTITY_MASTER: RERESOLVE_IF_SEED | ✅ a seed EXISTS and runs offline — **76.8% of CALL demotions reverse** |
| **R36** RESERVATION_ESTIMATOR: PROPOSE | ✅ proposed, **not applied** — and the briefed rule is unsafe alone (below) |
| **R37** RAISE_LEDGER_CAP: NO | ✅ `cap_usd` untouched at 40.0 |
| **R17** N_DECISION: HOLD_3 | ✅ planning only; no pass bought |
| **R8** FLAGS: HOLD | ⏭️ nothing flipped; no env, config or cap change |
| **PUSH_BRANCH** | ✅ branch only, no refspec, no force; master never touched |
| **AGENT_CAP: 3** | 3 read-only scouts, one wave |

---

## STEP 0 — what the guiding chat has not seen

### 0a · Item 5 is MEASURED, and the 86%-blind worry has no surface here

`fp_null` = **0** for all six types in all three passes (`null_segments` 26). ⛔ That alone does not
settle it: `fp_null` fires only when a prediction's span OVERLAPS a declared null span
(`golden.py:427-436`), so a record emitted elsewhere in a NULL segment is invisible to it.
Re-derived from the persisted runs, **records emitted on a NULL segment AT ALL = 0** — identical.

⭐ The zero is real, not an un-run instrument: raw output present 26/26 per pass, usage 26/26,
`raw_output["records"]` length **0 for all 26**, NULL-segment spend $0.2002 / $0.1808 / $0.1452.
And every declared null span covers its whole segment (ratio 1.000 min and max), so the blind spot
has **zero surface on golden-v1.1**. **ITEM 5: MEASURED.**

### 0b · Q3 is CLOSED — the schema-lever improvement does not survive

| | precision | recall |
|---|---|---|
| gate-run-1 baseline (v1) | 0.700 | 0.933 |
| the **withdrawn** gate-run-2 figure | 0.765 | 0.867 |
| **v1.1 × 3 passes** | **0.650 / 0.737 / 0.684** | 0.867 / 0.933 / 0.867 |

⛔ **The withdrawn 0.765 lies above the entire three-pass range; the 0.700 baseline lies inside
it.** The apparent improvement was the `_tokens` shadowing confound — refusing to cite it was
right. Recall moves between exactly the two values the baseline and the withdrawn figure took, so
it says nothing either. **Q3 closes as: no measurable schema-lever effect on PRINCIPLE, at a
run-to-run spread of ±0.04 precision.**

### 0c · Per-type stability under the KEY identity, n=3

    product view (record_type)          total   1/3   2/3   3/3   mean   clears floor
      MARKET_SIGNAL                       236   172    43    21  0.453             21
      PRINCIPLE                           182   115    36    31  0.513             31
      MENTION                             778   220   151   407  0.747            778
      LEVEL                                18    12     3     3  0.500             18
      NEGATIVE_CALL                         9     2     2     5  0.778              9
      CALL                                  0     -     -     -      -              0
    extractor view (pre_entity_type)
      CALL                                116    25    12    79  0.822            116
      LEVEL                                46    17    11    18  0.674             46
      MENTION                             642   197   140   305  0.723            642

### 0d · Cost actuals

Per-segment mean **$0.058671** over 249 segment-passes. Rounds per pass 2 / 3 / 4 — **caused by
the cap, not the work** (step 5).

### 0e · The six session-9 questions, with status

| # | question | status now |
|---|---|---|
| Q1 | raise `--max-usd` for wall-clock only? | **quantified** — the reservation is 90% a constant; R36's estimator is the alternative. R37 = NO, cap untouched |
| Q2 | the entity master — seed and re-run, or accept? | **ANSWERED by measurement** — a seed exists, runs offline, recovers **76.8%**. The decision is still yours |
| Q3 | MARKET_SIGNAL's identity (R30) | **BOUNDED** — 21 (KEY) → 61 (merged, R30's own threshold). 73 pairs written for hand-check |
| Q4 | is "unanimous or blocked" the intended yield? | **quantified** — a floor ≤0.667 admits 64 MS / 67 PR at KEY; merging admits 61 MS. Two different levers, near-identical yields |
| Q5 | what populates `wisdom_records`? | **ANSWERED locally** — R40's tool; production still needs a real capture→extract run |
| Q6 | merge timing | **ANSWERED** — the branch touches **no** flow-worker watched file (path-filtered diff EMPTY); a master merge restarts web only |

### 0f · The entity-master incident, restated — ⚰️ **AND SESSION 9 HAD IT BACKWARDS**

Session 9 said `railway run` handed the gate production's `DATA_DIR`, which resolved to this box's
`C:\data\entity_master.db`. **That is wrong.** The measured chain:

1. `extract_golden_gate.py:412` calls `common.bootstrap(...)` **before** its first `api.*` import;
2. `extract_common.py:39` does `import conftest` **deliberately**;
3. `conftest.py:515` runs the redirect at module import, **not gated on pytest**;
4. `conftest.py:469` mints a **fresh `mkdtemp` per process**; `:505-508` skips a variable only when
   its value is truthy AND outside the shared root — and `/data` abspaths to `C:\data`, which IS
   the shared root, so a production `/data` is redirected exactly like an unset one;
5. `entity_master/schema.py:33` then captured that sandbox at import and the store **created** it.

⭐ **Evidence: three sandbox databases whose mtimes match the three gate manifests to within 0.3 s**
(07:16:47 / 07:33:43 / 07:55:47), each **86,016 bytes, 0 rows in every table**. The shared-root copy
was never opened; its sha256 was baselined before this session's work and verified unchanged after.

> ⛔⛔ **THE RULE (HARD-RULES.md, R42): a sandbox redirect protects against WRITES by guaranteeing
> an EMPTY READ.** Before running any tool whose CORRECTNESS depends on a populated store, ask what
> the redirect will hand it.

⚠️ Nothing reported it because the empty store made every ticker unresolvable and `writer.py:504`
then downgraded every CALL — a **legitimate fail-closed path**, indistinguishable from a corpus
with no calls in it. ✅ **The gate's pre-resolution P/R table is unaffected** and was re-verified
untouched: it scores `pre_entity_type`, fixed before the entity step (CALL tp=17 in all three
receipts).

---

## STEP 1 — R39: the identity bounds

| identity | bound | MS ids | MS mean | MS pub | PR ids | PR mean | PR pub |
|---|---|---:|---:|---:|---:|---:|---:|
| **KEY** (ruled) | **LOWER** | 236 | 0.453 | **21** | 182 | 0.513 | **31** |
| MERGED-MS J=0.4 | upper | 150 | 0.713 | 70 | — | — | — |
| MERGED-MS J=0.5 | R30's own | 163 | 0.656 | **61** | — | — | — |
| MERGED-MS J=0.6 | lower | 191 | 0.560 | 44 | — | — | — |
| **LENS-PRINCIPLE** | **UPPER** | — | — | — | 122 | **0.765** | **67** |
| STRUCTURED-MS | *skipped* | — | — | — | — | — | — |

> **KEY publishes 52 of 418 floored identities (12.4%); the upper bounds publish 128 (30.6%).**
> **~18 points of the 88% are a matching artifact; ~70% is real instability.**

⭐ LENS-PRINCIPLE's mean lands at **0.7650**, within 0.002 of session 3's independently measured
0.767 — different data, same lens.

**STRUCTURED-MS skipped on its own evidence:** the payload carries `name` 100% and `direction`
88.8%, **no instrument, no timeframe**; the row-level ticker is **48.3%**, under the ruled 80%
floor. Forced through as a diagnostic it collapses **122 distinct names**.

### Q17 read against each identity (FLOOR 0.8, MIN_RUNS 3)

    KEY             MS  21 publish / 215 block      PR  31 / 151
    MERGED-MS J0.5  MS  61 / 102                    PR  31 / 151
    LENS-PRINCIPLE  MS  21 / 215                    PR  67 /  55

**Floor sensitivity at KEY:** a floor ≤ 0.667 would admit **64 MS** and **67 PR**. ⭐ Note that
merging MARKET_SIGNAL (61) and lowering the floor (64) give almost the same yield **for completely
different reasons** — one fixes a matching artifact, the other lowers the evidence bar.

**Owner evidence:** `data/wisdom/identity-study/merged-ms-pairs.jsonl` (**73 rows**) and
`lens-principle-pairs.jsonl` (**60 rows**), both gitignored. Counts only here.

### OPINION (≤ 8 lines)

1. **MARKET_SIGNAL: adopt a merged identity, at J=0.5.** The KEY is demonstrably splitting one
   signal into two — 73 pairs, and 36% of keys are suspected renames.
2. **PRINCIPLE: keep the KEY for now.** LENS is an upper bound by construction — its threshold is
   documented as deliberately generous and it over-merges; 0.765 is a ceiling, not a proposal.
3. **What would settle it:** the two review files. If ≥ ~80% of the 73 MS pairs read as the same
   signal, J=0.5 is safe; if the 60 PRINCIPLE pairs read as distinct claims, the lens is confirmed
   as a bound only.
4. ⛔ Neither identity was written to any table. The ruled key-based identity remains the only one
   that ever writes.

---

## STEP 2 — R42: the entity master

**A seed exists and runs offline.** `scripts/entity_master_seed.py --db-path <local> --max-pages 0`
— the Massive pagination loop body never executes, so no network, no key, **$0.00**. Built here:
**9,824 entities**, 9,824 aliases, 21,988 events.

**Re-resolution over the three persisted runs, offline:**

| run | pre-entity CALLs | stay CALL | still demote | recovered |
|---|---:|---:|---:|---:|
| 20260915T085142Z | 99 | 76 | 23 | 76.8% |
| 20260915T121930Z | 96 | 75 | 21 | 78.1% |
| 20260915T123550Z | 102 | 77 | 25 | 75.5% |
| **total** | **297** | **228** | **69** | **76.8%** |

56 distinct tickers probed, 41 resolve (73.2%). The remaining ~19% needs the paid reference feed or
an explicit accept-as-MENTION. ✅ Shared root untouched — sha256 baselined before, verified after.

**2c — PROPOSED, not applied** (for the `entity_master` owner, whose tree is off-limits here):
`entity_master/schema.py:33` should take an explicit path over `DATA_DIR`-at-import —
`DB_PATH = os.environ.get("ENTITY_MASTER_DB_PATH") or os.path.join(os.environ.get("DATA_DIR", "/data"), "entity_master.db")`
— resolved per call rather than captured at import, with a test that a set override wins over
`DATA_DIR`. ⛔ Not written: `entity_master/**` is off-limits for edits this session.

---

## STEP 3–4 — R40/R41: the chain on real rows

    ingest (pass 1 only)   63 sources · 83 segments · 826 records · 91 principles · 4,295 provenance
    fidelity               826 of 827 record_ids identical to the persisted run (99.9%)
    idempotent             second ingest: 0 written, 826 already_written, counts unchanged
    rq_v11_001             skipped: no gate run recorded in THIS store (the evals live in gate.db)
    reconcile_stability    records_updated 826 · principles_updated 51        <- session 9 was 0
    publication_floor      blocked 143 · enqueued 143
    review.counts(conn)    contradictions 143 · extraction_audit 114 · vocabulary 70 · TOTAL 327
    all 143                carry reason 'below_publication_floor'
    second chain run       blocked 143 · enqueued 0 — idempotent

**⭐ Why only pass 1 (3c).** Stability comes from the RECONCILER reading all three persisted runs,
not from ingesting three copies. The three passes share the same 83 `segment_id`s, and idempotency
is keyed `UNIQUE (segment_id, extractor_version, record_hash)` — so ingesting pass 2 would add only
the records whose HASH differs, i.e. duplicate identities inside one store rather than votes. The
votes live in the runs; the store holds one pass's rows.

⛔ **The constraint is THREE columns, not two.** The brief cited `UNIQUE(extractor_version,
record_hash)`; `wisdom-db-v0.sql:127` says `UNIQUE (segment_id, extractor_version, record_hash)`. A
tool assuming the two-column form would believe a re-segmented statement was blocked when it is not.

**4c — nothing member-visible.** Every consumer of `wisdom_records` sits behind a gate that is
**unset** (0 of 25 SET on production `web`, session 9's exit-code measurement): Ask-AI
`ASKAI_WISDOM_RETRIEVAL_ENABLED` (flags.py:91, the only member-visible one of the five), Brain KB
`WISDOM_BRAINKB_PUBLISH_ENABLED`, dossier, Model Book drafts, badges, desk markers, PV examples,
level alerts, lookalike, weekly report. ⚠️ **Clips has NO flag** — it is gated only by
`require_push_secret` (`adapters/routes.py:160`). 27 Wisdom routes → 401 anonymous.

**4d — reset**, proved on a COPY (live store untouched, 826 records still present):

    DELETE FROM wisdom_review_queue, wisdom_principle_support, wisdom_principles,
                wisdom_field_provenance, wisdom_extract_record_keys, wisdom_records,
                wisdom_segments, wisdom_sources;      -- all eight to 0

---

## STEP 5 — R36: the reservation estimator (PROPOSED, NOT APPLIED)

    current   output leg = MAX_TOKENS 32000 × $25/Mtok × batch 0.5 = $0.4000 — a CONSTANT
              + input ~$0.042 → ~$0.4420/request, of which 90% is the ceiling
    actual    ~$4.85 per 83-request pass = 14% of the reservation
    proposed  p90 10,641 × 1.5 = 15,962 tokens → ~$0.2415/request (55% of current)
    rounds    session 9 would have run 1 / 2 / 2 instead of 2 / 3 / 4

⚠️⚠️ **THE BRIEFED RULE IS NOT SAFE ON ITS OWN, and this is the session's finding on it:
p90 × 1.5 = 15,962 is BELOW the observed max of 18,857 (0.85×).** A reservation under the largest
real request lets ACTUALS pass a cap that is only tested at reserve time. **The second half —
re-checking the cap against ACTUALS after every batch — is therefore what makes the tighter
reservation safe, not an optional extra.** Touch points: `extract_golden_gate.py:121-125`
(`worst_case_usd`), `:50-73` (`SpendCap`), `:187-254` (`run_batch_round`), `budget.py:131-139`.
Tests to ship with it: no-history → worst case; history → p90 × 1.5 floored at the observed max;
cap refuses when actuals + reservation exceed it; mutation — drop the cap check → red.

---

## STEP 6 — budget and checklist

**Q4 restated:** per-segment mean **$0.058671** → 9,733 segments = **$571.04** one pass,
**$1,713.13** three. ⛔ The estimator changes ROUNDS, never ACTUALS.

**N=5 does not fit:** two more passes cost **$9.7393** against **$8.5185** headroom — short by
**$1.2208**. ⚠️ And at N=5, 4/5 = 0.8 **clears** a 0.8 floor, so raising N silently changes the rule
from unanimity to 80% agreement.

**Wave 1.5:** item 2 **DONE and MEASURED** (bounds + the chain writing 826 rows); item 3 **DONE and
MEASURED** (143 blocked, 143 enqueued, idempotent); item 5 **DONE and MEASURED** (0a).

**Flag checklist — next cron window is Tuesday 2026-09-15 18:47 ET** (`CONTRACTS.md:296`; computed
at 08:59 ET, ~9.8 h out):

| row | value |
|---|---|
| rows in the LOCAL store | 826 records · 91 principles · 327 queue |
| publish / block / enqueue (local) | 683 / 143 / 143 |
| production gate state | **0 of 25 SET** (session 9, by exit code) |
| switch order if ever flipped | INGEST → CAPTURE → SOURCES_INGEST → **EXTRACT last** (the only one that spends) |
| what the first live chain would write **in production** | **UNKNOWN — and that is the honest answer.** Production's `wisdom_records` count has never been read. It is NOT this box's 826. Learning it without credentials is not possible; it needs one `railway ssh` read-only `SELECT COUNT(*)`, which this session was forbidden and did not attempt. |

---

## 1. MUTATION-PROOF

- `git status --porcelain` — **clean**. `origin/feat/wisdom-loop...HEAD` = **0 0**.
- `git diff --stat 53d3d3ce1..HEAD` — **7 files, 1,229 insertions, 0 deletions**.
- **5 commits**, each with `git show --stat` reviewed: `1d67437cb` (R39 study + rails),
  `72477a09b` (R42 HARD-RULES), `bb3b918cf` (session-9 corrections in place), `3977600ca`
  (ingest tool + rails), `d6d9c926c` (checkpoint). **Merges: 0.** Pushes: branch only, no refspec,
  no `--force`.
- **Ledger byte-identical**: sha256 `d976dba7a2d963a4…`, 5,405 bytes, $31.4815/$40.00, 28 entries —
  printed before and after.
- **Zero** flag / env / config / cap changes. `cap_usd` untouched (R37 = NO). No `railway`
  subcommand run in any form. No key printed, measured, hashed or searched for.
- **Off-limits paths: path-filtered diff EMPTY** over `requirements.txt`,
  `api/services/entity_master/`, `app/src/`, `docs/discord-render/`, `api/services/desk_*`,
  `api/services/education_service.py`.
- Member data: **NONE** opened. D16b / Journal / J2: **not read**.
- **Mutation proofs run:** (i) the identity study's co-occurrence guard disabled → **1 failed, 10
  passed**, restored byte-exact, sha256-verified; (ii) its candidate pre-filter disabled → **11
  passed**, proving that layer is an optimisation and NOT a guard — now commented as such.
- ⭐ Three rail controls fired during construction and every one was a real defect: a silent no-op
  rewrite (60 merges, total unchanged); `git grep` without `--untracked` answering "clean" for an
  uncommitted file; and `INSERT OR IGNORE` reporting 63 sources into an empty table.
- The report cites the tip as of its own writing; the commit containing it necessarily follows.
  (Noted once, per convention, and not repeated.)

## 2. TOTALS

| | |
|---|---|
| API calls / spend | **0 / $0.00** |
| sub-agents | **3**, read-only, one wave |
| tests | **1175 passed · 1 skipped · 0 failed**, 68 named files, 220 s |
| new rails | 30 (14 identity-study, 16 ingest) |
| commits / merges / pushes | 5 / **0** / 5, branch only |
| files changed | 7 (+1,229 / −0) |
| items NOT FOUND | STRUCTURED-MS fields (instrument, timeframe) — absent from the payload |
| decisions deferred | identity (Q3), cap vs estimator (Q1/R36), N (R17), entity-master path (its owner) |

## 3. QUESTIONS FOR PATRICK

**Q-A ⭐ load-bearing — which identity governs MARKET_SIGNAL?** KEY publishes 21; merged at R30's
own J=0.5 publishes **61**. The evidence for a hand-check is
`data/wisdom/identity-study/merged-ms-pairs.jsonl`, **73 rows**. If most read as the same signal,
adopt J=0.5.

**Q-B ⭐ load-bearing — and PRINCIPLE?** KEY 31, LENS 67, but the lens is an upper bound by
construction. `lens-principle-pairs.jsonl`, **60 rows**. My read: keep KEY until those 60 are
checked.

**Q-C — the floor, or the identity?** A floor ≤0.667 admits 64 MS / 67 PR; merging admits 61 MS.
Nearly the same yield, completely different justifications. Which lever do you want pulled?

**Q-D — R36: apply the estimator?** It would cut rounds 9 → 5 at zero change in actuals. ⚠️ Only
with the actuals re-check, since p90 × 1.5 sits below the observed max.

**Q-E — N=5?** It does **not** fit: $9.7393 needed, $8.5185 available. And it changes the rule from
unanimity to 80%. Hold 3, or raise the cap by ≥ $1.25 and accept the looser rule?

**Q-F — the entity master, for its owner.** A $0.00 offline seed recovers **76.8%** of the CALL
lane. Seed it permanently, take the proposed path override, or accept CALL-as-MENTION?

**Q-G — production's store is unknown.** Everything above about "what the chain would write" is
measured on THIS box. Production's `wisdom_records` count has never been read, and one read-only
`SELECT COUNT(*)` over `railway ssh` would settle it.
