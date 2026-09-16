---
id: WISDOM-RECON-SESSION-3
title: Session 3 — cost menu, item 3 decision pack, close the ledger
status: complete — 0 commits, 0 merges, 0 pushes, 0 API calls, $0.00
---

# Session 3 — cost menu, item 3 decision pack, close the ledger

**`Q3_RERUN: NO` — so spend this session is $0.00, zero API calls, and Step 1 took branch 1d:
nothing was applied to the ledger.**

Date 2026-09-14. Branch `feat/wisdom-loop`, HEAD **`b4c9bc3fa`** (session 2's docs commit, on top of
merge `6c2b85749`). Prior reports: `docs/recon/2026-09-14-recon-for-guiding-chat.md`,
`docs/recon/2026-09-14-session2-repair-e5-e6.md`.

---

## STEP 0 — Restated in full

### 0a — Q10, Q11, Q12 verbatim, and the full Q1–Q12 list

**Q10** ⭐⭐ — *"**NEW — item 3 is not implementable as written.** Four decisions needed: does the
floor cover `modelbook.py`? What did "the voice profile" mean, given `voice.py` has no PRINCIPLE
path? How does the floor reach Ask-AI, which consumes through the FTS index rather than
`select_records` — filter at index build or at search? And is a NULL stability (every record today)
intended to block, making the rail a total publication stop for two types until item 2 ships?"*

**Q11** — *"**NEW** — item 3's named consumer list is wrong in two directions: it names `voice.py`
(no PRINCIPLE path) and omits `modelbook.py` (has one). Correct the wording in SESSION-STATE, or is
`modelbook` deliberately exempt under D19 'drafts only'?"*

**Q12** — *"**NEW** — the gate discards its validated records, keeping only aggregates and keys.
That is why E5 costs $4.34 to close instead of $0. Should the gate persist records under
`data/wisdom/` (already gitignored, already where quote-bearing golden labels live, so §0.4f is
satisfied) so a future scoring bug is re-scorable for free?"*

| # | question | load-bearing |
|---|---|---|
| 1 | Should §0.4 be copied into a tracked `docs/wisdom/HARD-RULES.md`? | ⭐ |
| 2 | The merge map's D16b row — strike or rewrite? | |
| 3 | Checkpoint 13's PRINCIPLE delta is CONFOUNDED — withdraw, re-run ($4.34), or caveat? | ⭐⭐ |
| 4 | Which catalog size is the basis — 1,052 or 9,733? | ⭐⭐ |
| 5 | Which agent cap is current? | |
| 6 | Should "production is dark" become a committed instrument? | |
| 7 | RQ-v11-001 — NULL false positive: review item or verdict? | ⭐ |
| 8 | Tonight's four flags — flip, subset, or hold dark? | ⭐⭐ |
| 9 | Push the branch, or hold? | |
| 10 | Item 3's four decisions | ⭐⭐ |
| 11 | Item 3's wrong consumer list | |
| 12 | Should the gate persist its records? | |

### 0b — The item 3 implementation plan, in full, with the corrected consumer map

**Files touched (session 2's estimate):** `wisdom-db-v0.sql:76-127` (add `stability REAL`,
`stability_runs INTEGER`) · `core/schema.py` MIGRATIONS (one additive `ALTER TABLE`) ·
`adapters/common.py:149` (`for_publication` parameter) · `brainkb.py:88,112`, `dossier.py:36,96`,
`modelbook.py` (no change if the default is fail-closed) · `publish/review.py` (pass
`for_publication=False`) · `askai.py` or `retrieval.py` (the FTS half) · `tests/…floor.py` (new).

**The corrected consumer map — what the briefing named vs what the code holds:**

| the briefing named | reality | citation |
|---|---|---|
| Brain KB | ✅ PRINCIPLE, **but via a direct `wisdom_principles` SELECT**, not `select_records` | `brainkb.py:83-86` |
| Ask-AI | ✅ PRINCIPLE, **via the FTS index**, not `select_records` | `askai.py:73` → `retrieval.py:184-205`; docs built at `retrieval.py:84-116` |
| dossiers | ✅ PRINCIPLE, via `select_records` | `dossier.py:36`, `:96-97` |
| the voice profile | ❌ **NO PRINCIPLE PATH.** `voice.py` reads `wisdom_sources.title` only; `voicefmt` reads segment text | `voice.py:33-39`, `:44-79`; `voicefmt.py:42-65` |
| — *(not named)* | ✅ **`modelbook.py` HAS one** — playbook drafts | `modelbook.py:129-131`, statements `:120-122`, draft `:175-177` |
| — *(not named)* | ⚠️ **`clips.py` reads ALL SIX types with NO flag at all** — metadata only, no text | `clips.py:45-48`; `RECORD_KEYS` `:20-21`; gated only by `require_push_secret` `routes.py:160-162` |

### 0c — The drafted CONFOUNDED ledger wording (re-printed, NOT applied)

```markdown
⛔⛔ **CONFOUNDED — DO NOT CITE THE PRINCIPLE PRECISION/RECALL DELTA (recorded 2026-09-14 session 2).**
`golden.py` bound `_tokens` twice at module level from `c9d6af653` (2026-09-14 12:09:48Z): the
similarity scorer's at `:329` and the paraphrase lens's at `:689`. Python keeps the last, so
`match_segment`'s PRINCIPLE similarity ran the LENS's tokenizer. gate-run-1's reports are
09:35:44Z and 09:52:59Z (before); gate-run-2's is 13:23:53Z (AFTER). **The two runs were scored
with different similarity functions, so P 0.700 → 0.765 and R 0.933 → 0.867 cannot be attributed
to the schema change.** Master fixed the shadowing in `e56a11b3e`, merged here at `6c2b85749`.
Re-scoring locally is impossible — the raw outputs were never persisted (only aggregates and
record keys) — so closing this costs a $4.34 re-run of the 57-segment gate phase.
⭐ **The DRIFT numbers are NOT affected** and stand as recorded: drift keys on
`writer.Chunk.key` → `writer.normalize_quote_key`, which never calls `golden._tokens`.
```

### 0d — The E3 / E4 / E1 proposed diffs (re-printed, NOT applied)

**E3 — the merge map's D16b row**, `docs/wisdom/PROGRAM-MANIFEST.md:265`:
```diff
-| **Ask Notebook / J2 broker** | Nothing member-facing; owner-only reconciliation (D16) | Read-only service calls, owner `user_id` | Owner-private rule §0.11 |
+| **Ask Notebook / J2 broker** | **NOTHING. D16b is DEFERRED with no date (§0.12, W1 GO Part 10 §10.1): not read, not queried, not scaffolded.** | — | ⛔ Hard rule §0.4b. ⚰️ This row read "owner-only reconciliation (D16)" until 2026-09-14 — written before the split, and describing work Part 10 §10.1 removed. |
```

**E4 — the two wrong merge SHAs.** Occurrences: `OVERNIGHT-CHECKPOINTS.md:112`, `:113`,
`SESSION-STATE.md:42-43`. (`OVERNIGHT-CHECKPOINTS.md:102` is correct — it is about the deploy.)
```diff
-| # | merge | commit | web |
+| # | merge | merge commit | deployed & verified tip | web |
-| 6 | S-F1 admin | `49fdc1fbc` | SUCCESS |
-| 7 | **S-F2 publish** | **`fedd8dea1`** | **SUCCESS** |
+| 6 | S-F1 admin | `b9b12b828` | `49fdc1fbc` | SUCCESS |
+| 7 | **S-F2 publish** | **`27921010f`** | **`fedd8dea1`** | **SUCCESS** |
```

**E1 — copy §0.4 into a tracked file?** Recommendation YES, as `docs/wisdom/HARD-RULES.md`. It is
gitignored only because it sits under `data/wisdom/`, the **quote-bearing** tree (paid transcript
text, golden labels) that §0.4f itself forbids in git — a category, not a property of §0.4's own
content. Caveat: lines 15-24 and 231 were inspected and carry no quotes, levels, positions or
credentials; the other 38,000 bytes of that file were not read, so copying the §0.4 block is safe
on inspection while copying the whole file is not a claim I can make.

---

## STEP 1 — 1d. Nothing applied.

`Q3_RERUN` reads **NO**, so no spend, no re-measurement, and **no ledger edit**. The drafted
CONFOUNDED wording is re-printed at 0c above.

### One refinement, proved this session: the confound is NARROWER than session 2 stated

`match_segment` has two matching branches:
- **non-PRINCIPLE** (`golden.py:376-392`) — matches on `pre_entity_type`, `same_instrument`
  (ticker equality), `stance`, `direction`. **It never calls `_tokens`.**
- **PRINCIPLE** (`golden.py:397-410`) — `:404` is the only `_tokens` call site in the function.

The scoring SCOPE is `_overlap_ratio` over char spans (`golden.py:360-362`), also not token-based.

**Therefore only the PRINCIPLE row of checkpoint 13's table is confounded.** CALL, LEVEL,
MARKET_SIGNAL, MENTION and NEGATIVE_CALL stand as recorded. The proposed edit should say so.

### The exact ledger diff a future `Q3_RERUN: YES` would produce

Target: `docs/wisdom/OVERNIGHT-CHECKPOINTS.md:484-498`. Current block:
```
484: ### Precision and recall barely moved, and mostly up
487: type             P old   P new      dP     R old   R new      dR
488: CALL             0.708   0.692   -0.016    0.739   0.783   +0.043
...
493: PRINCIPLE        0.700   0.765   +0.065    0.933   0.867   -0.067
```
A YES run would replace **line 493 only**, and append a provenance line:
```diff
-PRINCIPLE        0.700   0.765   +0.065    0.933   0.867   -0.067
+PRINCIPLE        0.700   <P_new>  <dP>     0.933   <R_new>  <dR>     [re-measured]
```
```markdown
⭐ **PRINCIPLE re-measured 2026-09-__ under run id `<run_id>`** after the `_tokens` shadowing
(E5) was repaired at `6c2b85749`. The withdrawn figures were P 0.765 / R 0.867, scored with the
paraphrase lens's tokenizer instead of the similarity scorer's. Cost $<actual>; ledger entry
`<at>`. Only this row was affected — `match_segment`'s non-PRINCIPLE branch (`golden.py:376-392`)
never calls `_tokens`.
```

---

## STEP 2 — Cost menu ($0.00, paper only)

Inputs, all cited:
- rate **$0.076066/segment** = `gate-run-2/gate-report-20260914T132353Z.json` →
  `phases.gate.summary.cost_usd` 4.335736 ÷ `segments` 57
- corpus **`data/wisdom/extract/catalog-estimate-defaults.json`**, `measured_at 20260913T184934Z`,
  `segmenter seg-v0`, `requests 9733`, `sources 383`
- throttle **`DAILY_SEGMENT_LIMIT = 400`** — `api/services/wisdom/extract/batch.py:48`
- cap **$120** — `api/services/wisdom/extract/budget.py:75` (`DEFAULT_BUDGET_USD`), env
  `WISDOM_EXTRACT_BUDGET_USD` at `:82`

### 2a — Corpus breakdown (reconciles to 9,733 exactly)

| category | sources | segments | chars | seg/src |
|---|---:|---:|---:|---:|
| Live Trading Sessions | 56 | 3,499 | 3,642,078 | 62.5 |
| The Mental Game | 54 | 1,122 | 2,755,178 | 20.8 |
| Interviews | 35 | 1,041 | 3,232,725 | 29.7 |
| Setups & Strategies | 37 | 799 | 2,060,315 | 21.6 |
| Workshops & Fireside Chats | 24 | 704 | 1,977,188 | 29.3 |
| Sunday Scans | 69 | 587 | 1,459,941 | 8.5 |
| Options & Flow | 22 | 492 | 1,341,632 | 22.4 |
| Risk & Trade Management | 18 | 367 | 853,540 | 20.4 |
| Market Analysis & Breadth | 13 | 324 | 859,338 | 24.9 |
| Scanning & Stock Selection | 16 | 267 | 668,948 | 16.7 |
| Mindset & Psychology | 7 | 150 | 514,537 | 21.4 |
| Thoughts on the Market | 9 | 119 | 316,343 | 13.2 |
| Post-Market Recaps | 10 | 90 | 237,625 | 9.0 |
| Evening Update | 10 | 58 | 143,597 | 5.8 |
| LIVE TRAIDNG | 1 | 54 | 44,526 | 54.0 |
| Sharpen Your Trading Skills | 1 | 32 | 88,269 | 32.0 |
| Sharpen your trading skills | 1 | 28 | 43,209 | 28.0 |
| **TOTAL** | **383** | **9,733** | **20,238,989** | |

**Sum reconciles: segments 9,733 = `requests`; sources 383 = `sources`.** ✓

**Per publication year: NOT DERIVABLE.** `by_category` carries only
`['body_tokens','chars','segments','sources']` — no date field. Searched every top-level and
per-category key in the artifact.

⚠️ **Three data-quality observations in the catalog itself**, worth a ruling because they affect
any per-category budget:
1. **`LIVE TRAIDNG`** (1 source, 54 segments) — a typo'd category that should almost certainly be
   `Live Trading Sessions`.
2. **`Sharpen Your Trading Skills`** and **`Sharpen your trading skills`** — a case-duplicate pair
   (1 source / 32 segs and 1 source / 28 segs) that is one category in two spellings.
3. **The source split does not match the docstring.** `extract_catalog_batch.py:4` says "the 319
   transcripts and the 64 Sunday Scans issues" (= 383), but `by_category` shows **Sunday Scans =
   69 sources**, implying 314 transcript sources. Same total, different split.
   `PROGRAM-MANIFEST.md:114` independently records "**320 videos, 319 with transcripts,
   20,334,779 characters**" against the catalog's 20,238,989 — a ~95,790-char shortfall.

### 2b — Per-category 1-pass cost, and cumulative

⚠️ **No value ranking exists.** Searched `data/wisdom/WAVE1-PROMPT-v2.0.md` and
`docs/wisdom/PROGRAM-MANIFEST.md` for any priority/ordering of content categories — **NOT FOUND**.
D14 says "ingest the whole back catalog" without ordering. **So this is ordered by segment count,
and that choice is mine, not the programme's.**

| category | segments | 1-pass $ | cumulative $ | cum % corpus |
|---|---:|---:|---:|---:|
| Live Trading Sessions | 3,499 | 266.15 | 266.15 | 35.9% |
| The Mental Game | 1,122 | 85.35 | 351.50 | 47.5% |
| Interviews | 1,041 | 79.18 | 430.68 | 58.2% |
| Setups & Strategies | 799 | 60.78 | 491.46 | 66.4% |
| Workshops & Fireside Chats | 704 | 53.55 | 545.01 | 73.6% |
| Sunday Scans | 587 | 44.65 | 589.66 | 79.6% |
| Options & Flow | 492 | 37.42 | 627.08 | 84.7% |
| Risk & Trade Management | 367 | 27.92 | 655.00 | 88.5% |
| Market Analysis & Breadth | 324 | 24.65 | 679.65 | 91.8% |
| Scanning & Stock Selection | 267 | 20.31 | 699.96 | 94.5% |
| Mindset & Psychology | 150 | 11.41 | 711.36 | 96.1% |
| Thoughts on the Market | 119 | 9.05 | 720.42 | 97.3% |
| Post-Market Recaps | 90 | 6.85 | 727.26 | 98.2% |
| Evening Update | 58 | 4.41 | 731.67 | 98.8% |
| LIVE TRAIDNG | 54 | 4.11 | 735.78 | 99.4% |
| Sharpen Your Trading Skills | 32 | 2.43 | 738.22 | 99.7% |
| Sharpen your trading skills | 28 | 2.13 | **740.35** | 100.0% |

### 2c / 2g — Budget table, with calendar days at the 400/day throttle

| budget | segs @1p | segs @2p | segs @3p | % corpus @1p | days @1p | whole categories that fit @1p |
|---:|---:|---:|---:|---:|---:|---|
| $120 | 1,577 | 788 | 525 | 16.2% | 4 | **0** — the largest category alone (3,499) exceeds it |
| $250 | 3,286 | 1,643 | 1,095 | 33.8% | 9 | **0** — same reason |
| $500 | 6,573 | 3,286 | 2,191 | 67.5% | 17 | 4 categories (6,461 segs) |
| $750 | 9,733 | 4,929 | 3,286 | 100.0% | 25 | **all 17** (9,733 segs) |
| $1,500 | 9,733 | 9,733 | 6,573 | 100.0% | 25 | all 17 |
| $2,250 | 9,733 | 9,733 | 9,733 | 100.0% | 25 | all 17 |

⚠️ The "whole categories" column reads 0 at $120 and $250 because **Live Trading Sessions alone is
$266.15**. Any sub-$266 budget buys a partial category, not a whole one.
⚠️ "days" is the floor imposed by the throttle, not an estimate of elapsed time: 9,733 ÷ 400 = **25
calendar days minimum** for a single full pass, 75 for three.

### 2d — Reconciling the three 1-pass figures

| figure | value | basis |
|---|---:|---|
| documented | **$80.00** | `budget.py:49`, `CONTRACTS.md:274` — a parenthetical, **no artifact** |
| tool | **$392.34** | `catalog-estimate-defaults.json → cost_usd_expected` |
| measured | **$740.35** | 9,733 × $0.076066 |

**The tool's inputs, and which one differs — derived, not assumed:**
- `input_tokens 47,729,749` = 9,733 × 4,200 system + 6,851,149 body ✓ (exact)
- `output_tokens_expected 29,199,000` = **3,000 per request** — the assumed p50
- Priced with **no** cache discount: **$484.31**. Priced with the **system tokens as cache reads**
  (0.1×): **$392.34** — matches the file exactly. So the tool assumes full system-prompt caching.
- **MEASURED output tokens** (`gate-run-2 … phases.calibration`): mean **5,771.8**, p50 **5,880**,
  p90 **10,898**.
- Ratio measured/assumed = **1.92×**. $392.34 × 1.92 = **$754.84** vs the measured-rate $740.35.

⭐ **THE ENTIRE GAP IS THE OUTPUT-TOKEN ASSUMPTION.** Input tokens, caching and pricing all agree;
the tool simply assumed the extractor would emit 3,000 tokens per segment and it emits ~5,772.
$80 is not reconcilable at all — it has no derivation on disk.

> **OPINION.** A planning decision should use **$740.35**, or better, re-derive from the tool with
> the gate's real calibration substituted for its defaults. Reasons: it is the only figure built
> from a measured rate on real segments; $392.34 is correct arithmetic on a stale assumption that
> is now known to be 1.92× low; and $80 has no artifact behind it at all and should stop being
> quoted. ⚠️ Caveat that cuts the other way: the measured rate came from 57 **dev-split** segments
> averaging 1,648 chars, while the catalog's mean is 20,238,989 ÷ 9,733 = **2,079 chars** — 26%
> longer, so $740.35 may itself be low. The honest range is **$740–$930**, and the cheap way to
> collapse it is 2f's n=250 sample at **$19.02**.

### 2e — Rate sensitivity (1 pass, 9,733 segments)

| rate | $/segment | 1 pass | 3 passes |
|---|---:|---:|---:|
| 0.5× | 0.038033 | $370.17 | $1,110.52 |
| **1× measured** | **0.076066** | **$740.35** | **$2,221.04** |
| 1.5× | 0.114098 | $1,110.52 | $3,331.56 |

**What drives the rate**, cited: output tokens dominate — `PRICES_PER_MTOK` gives opus-5
$5 in / $25 out per Mtok (`budget.py:70-73`), `BATCH_DISCOUNT = 0.5` (`:66`),
`DEFAULT_OUTPUT_TOKENS = 6000` (`:76`), `system_tokens_each 4200` (catalog artifact). At the
measured mix, output is ~5,772 × $12.5/Mtok = **$0.0722** of the $0.0761 — **95% of the rate is
output tokens.** So the rate moves with how verbose the extractor is per segment, which is exactly
what Wave 1.5 item 4's schema tightening reduced (cost fell $4.80 → $4.34 on the same 57 segments).

### 2f — Stratified sample (proportional across `by_category`), 1 pass

| n | cost | % of corpus | days @400/day |
|---:|---:|---:|---:|
| 250 | **$19.02** | 2.57% | 1 |
| 500 | **$38.03** | 5.14% | 2 |
| 1,000 | **$76.07** | 10.27% | 3 |
| 9,733 (full) | $740.35 | 100% | 25 |

**What statistical claim each n supports for the 0.8-floor question — stated honestly.** The
existing drift figure is **n = 10 segments, ONE run, and no variance is recorded anywhere** (session
2, D3). So there is no measured spread to extrapolate from, and any confidence interval quoted here
would be manufactured. What can be said without inventing a number:
- a sample gives a **point estimate per record type**, whose precision is bounded by the count of
  that type in the sample, not by the segment count;
- PRINCIPLE appeared **26–30 times per 10 segments** in the drift runs, so n=250 would be expected
  to surface **several hundred** PRINCIPLE records — two orders of magnitude more than the current
  basis;
- it would also produce, for the first time, an **observed variance**, which is the input every
  "is 0.325 really below 0.8" question needs and which does not exist today.

**Not recommended — presented.**

---

## STEP 3 — Item 3 decision pack

Answer in the form **3-i-B, 3-ii-…, 3-iii-A, 3-iv-…**.

### 3-i — WHERE THE STABILITY SCORE LIVES

**Option A — nullable columns on the record table(s).** Two tables, because two different consumers
read two different tables: `brainkb.py:83-86` reads `wisdom_principles`, while `dossier.py:36` and
`modelbook.py:129` read `wisdom_records` via `select_records`.
```sql
-- core_0NN_records_stability   (ONE statement per migration — core/schema.py:17-19)
ALTER TABLE wisdom_records ADD COLUMN stability REAL;
-- core_0NN_records_stability_runs
ALTER TABLE wisdom_records ADD COLUMN stability_runs INTEGER;
-- core_0NN_principles_stability
ALTER TABLE wisdom_principles ADD COLUMN stability REAL;
```
House style to copy: `core/schema.py:32-36` (`core_003_ticker_alias_context_rule`,
`core_004_vocab_provisional`). ⛔ **ONE statement per migration** — `store.init_db` records a
migration only when the whole script succeeds, so a two-statement script that dies after its ALTER
retries forever on "duplicate column".
**Which record types get it:** all six carry the column; only PRINCIPLE and MARKET_SIGNAL are ever
read against the floor. **Populated by:** a separate N-pass reconciler, NOT the writer's per-record
path — see D below.
⛔ **The trap, and it is severe:** the value must be a **column**, never injected into the model's
`fields` dict. `_canonical_hash` (`writer.py:302-306`) hashes `fields | {"record_type": …}`, so a
field would change every `record_hash`, every `record_id` (`writer.py:683`), and defeat
`UNIQUE(segment_id, extractor_version, record_hash)` (`wisdom-db-v0.sql:127`) — **re-extraction
would duplicate the entire corpus.** As a column it disturbs nothing.

**Option B — side table keyed by record id.**
```sql
CREATE TABLE IF NOT EXISTS wisdom_record_stability (
  record_id       TEXT PRIMARY KEY,
  stability       REAL NOT NULL,
  runs_present    INTEGER NOT NULL,
  runs_total      INTEGER NOT NULL,
  extractor_version TEXT NOT NULL,
  computed_at     TEXT NOT NULL
);
```
**Join cost at the consumer:** one `LEFT JOIN` in `select_records` (`common.py:160-172`) — cheap.
But `brainkb.py:83-86` reads `wisdom_principles`, which has **no `record_id`** — its key is
`principle_key` — so B needs either a second side table keyed by `principle_key` or a
`wisdom_principle_support` hop. **B is cleaner for `wisdom_records` and worse for the Brain KB lane**,
which is the lane item 3 most cares about.

**Option C — computed at publish time, never stored.** ⛔ **Not viable, and for the E5 reason.**
Stability is agreement across N passes, and the only per-pass artifacts are the gate's
`keys-*.json` files. Those carry `writer.Checked.key()` (`writer.py:189-196`) — for PRINCIPLE,
`(type, normalize_quote_key(statement))`; **no `record_id`, no quote, no char span.** So it is
**not span-defined** (which is good — it avoids E5's blocker) but it is **not record-joinable
either**: for PRINCIPLE the key is two of the three inputs to `principle_key` (`writer.py:691` —
the third is `author_id`, recoverable from the segment), and **for MARKET_SIGNAL there is no id at
all** (`writer.py:195`; the only stored form is `wisdom_records.market_signal_json`,
`wisdom-db-v0.sql:121`). C can score PRINCIPLE with a reconstruction step and **cannot score
MARKET_SIGNAL at all.**

**Backfill, all three options: $0.00 IS IMPOSSIBLE — and not for the reason expected.**
⛔⛔ **There are no stored records anywhere on this box.** All eleven SQLite files under `data/**`
have `wisdom_records` = **0 rows** (`gate-run-1/gate.db`, `gate-run-2/gate.db`,
`extract/gate.db`, `pilot/pilot{,2,3}.db`, `audit-smoke.db`, `gate-dryrun.db`, and three under
`scratch/`). The gate runs are measurement-only. **There is nothing to backfill a score onto.**

⭐ What *is* free: the **drift computation itself is fully reproducible offline**. Restricting
`gate-run-2/keys-*.json` to the 10 drift segments and multiset-matching against
`keys-drift-*.json` reproduces the report's `by_type` exactly — PRINCIPLE agreed **13** ✓,
MARKET_SIGNAL **6** ✓, CALL **17** ✓, LEVEL **3** ✓, MENTION **88** ✓. So a **2-of-2 agreement
flag over 10 segments** is buildable today for $0.00. A genuine 3/3 needs: a persisted extraction
run, a third same-config pass (run-1's drift keys were never saved), coverage beyond 10 of 57
segments, and an id in the keys files.

### 3-ii — RECORD TYPES COVERED

Item 3 as written covers **PRINCIPLE and MARKET_SIGNAL** (`SESSION-STATE.md:24-25`). §0.4 does not
name record types for this rule. The briefing does not say "all six".

⚠️ **But the measured floor list does.** `gate-run-2 … phases.drift.below_floor` reads
**`['CALL', 'LEVEL', 'MARKET_SIGNAL', 'MENTION', 'PRINCIPLE']`** — verified directly from the
artifact — with every type's `below_floor: true` against `stability_floor: 0.8`. So item 2's
"any record type whose drift is below 0.8" currently catches **all five measured types**;
NEGATIVE_CALL has no drift measurement at all (it does not appear in `by_type`).

**Types with no measurable score today:**
- **NEGATIVE_CALL** — absent from `by_type` in both runs; too rare in the 10 drift segments.
- **MARKET_SIGNAL** — has a drift number (0.231) but **no stable id** to attach a score to
  (3-i-C above). It is the one type where the *metric exists and the key does not.*

### 3-iii — ACTION ON FAILURE

| option | behaviour | member-visible without a flag flip? |
|---|---|---|
| **A — block at publish; record stays in the review queue with a reason code** | the record exists, is not exported, and an admin can see why | **NO change.** Everything today is dark; blocking makes a dark thing darker. Admin-only surfaces are all `/api/admin/*` behind `require_admin` |
| **B — publish with a below-floor marker consumers must respect** | the record **leaves** Wisdom carrying a flag; Brain KB / Ask-AI / dossier decide what to do with it | **YES — this needs a flag flip.** The row reaches a member-facing consumer, and whether the marker is honoured is that consumer's code, not Wisdom's. §0.4c binds: "nothing member-visible changes without a flag flip". It also violates §0.4's spirit twice over — it publishes under a named author exactly what item 3 says must not publish, and it makes correctness depend on a *downstream* system's cooperation |
| **C — log only (no rail)** | nothing changes; a counter records what *would* have been blocked | **NO change** — and no protection either. Useful only as a measurement step before A |

⭐ **Why only A and C can satisfy §0.4c without a flag:** both leave the set of rows crossing the
boundary unchanged or smaller. B enlarges it — an unstable PRINCIPLE that does not leave today
would leave tomorrow — and "the consumer will respect the marker" is an assumption about code this
programme does not own.

### 3-iv — WHERE IN THE PATH IT SITS

```
segment ──► extract/writer.py
                 │  validate_output :532   _check :434   _canonical_hash :302
                 │  write_output :656 ──► INSERT wisdom_records :694-717
                 │                   └──► INSERT wisdom_principles :759-763
                 │                   └──► review item (extraction_audit) :647-652 ─┐
                 ▼                                                                 │
           [ wisdom.db ]                                                           │
                 │                                                                 │
     ┌───────────┼─────────────────┬──────────────────┬────────────────┐           │
     │           │                 │                  │                │           │
  select_        direct SQL     FTS index          raw SQL          (drafts)       │
  records        wisdom_        retrieval.py       clips.py :45-48      │          │
  common.py      principles     _principle_docs    NO FLAG              │          │
  :149           brainkb :83-86 :84-116            ALL SIX TYPES        │          │
     │           :              │                  │                    │          │
     ▼           ▼              ▼                  ▼                    ▼          ▼
  dossier.py   brainkb        askai.py           clip program     wisdom_drafts ──► wisdom_review_queue
  :36,:96      export_payload :73                (metadata only)  common.py :279     review.py :112
  modelbook    :189-201        ▼                                        │
  :129         ▼              Ask-AI prompt                             ▼
     │        wisdom_kb_rows   (member)                            drafts.decide :109
     ▼         (member)                                            modelbook_service (member)
  dossier lines
   (member)
```

⛔⛔ **THE REVIEW QUEUE IS *NOT* UPSTREAM OF EVERY MEMBER-FACING CONSUMER.** Five paths bypass it,
and three of them are the PRINCIPLE lanes item 3 names:

| consumer | queue row? | citation |
|---|---|---|
| Brain KB export (PRINCIPLE) | **NO** | `brainkb.build_rows :79` → `stage :140` → `export_payload :177-201` — nothing calls `enqueue` or `upsert_draft` |
| Ask-AI block (PRINCIPLE) | **NO** | `askai.wisdom_block :61-91` → `retrieval.search :73`; no queue in `retrieval.py` |
| Dossier lines (PRINCIPLE) | **NO** | `dossier.wisdom_lines :71-87` → `_lines_from :33-68` |
| Desk markers (CALL/MENTION) | **NO** | `desk_markers.wisdom_rows :36-77` |
| Badges (CALL/MENTION) | **NO** | `badges.badges_for :41-76` |

**So the owner-wanted behaviour conflicts with A, and here is exactly how:** "2/3 records may
surface **only** in the admin review queue" presumes the queue is the default destination for a
blocked record. It is not — **nothing enqueues a PRINCIPLE on the publish path at all today**, so
blocking at publish makes a 2/3 record vanish rather than surface.
⭐ **Narrowest resolution:** pair the block with an `enqueue` at the same site. `review.enqueue`
(`review.py:112-139`) is idempotent — its `item_id_for` (`:89-90`) is
`sha24(tab, subject_ref, canonical_json(new))` — so the same blocked record re-enqueued on every
daily run produces one row, not a flood. That makes A's full statement: *block, and enqueue with a
reason code, at the same point.*

**Where the fail-closed check physically goes — a single point does NOT cover it. Minimum set of
four:**

| # | point | file:line | why it is needed | change required |
|---|---|---|---|---|
| 1 | `common.select_records` | `common.py:149-188`, clause beside `:169-172` | the only gate for `dossier.py:36,:97` and `modelbook.py:129`. A no-op for badges/desk_markers/pv_examples/level_alerts/lookalike — they never request these two types | add `include_unstable: bool = False`; `AND (r.record_type NOT IN ('PRINCIPLE','MARKET_SIGNAL') OR stability >= 1.0)` unless set. **One caller opts in:** `brainkb.py:88-92`, whose `_ALL_TYPES` lookup needs only a date + locator — blocking it drops a *citation*, not a publication |
| 2 | `brainkb.export_payload` | `brainkb.py:189-201`, beside the existing fail-closed filter at `:194-195` | `wisdom_kb_rows` is built from `wisdom_principles` (`:83-86`), which #1 never sees. Filtering at **export** rather than at `build_rows` is deliberate: staged rows keep flowing into `wisdom_kb_rows`, which is what the PC-side `--diff-out` turns into review-queue items — so 2/3 principles stay visible to the owner while never leaving | no signature change; mirror `unmarked_dropped` (`:199`) with `below_floor_dropped` |
| 3 | `retrieval.search` | `retrieval.py:184-205`, beside the `status IN (…)` clause at `:200` | the only gate on the Ask-AI lane. **Must be `search`, not `_principle_docs`** — the same index is read by `brainkb.voice_principle_candidates` (`brainkb.py:225`), an owner-sourcing lane that must keep seeing 2/3 principles | add `include_unstable: bool = False`; `brainkb.py:225` passes `True`. ⛔ `wisdom_segments_fts` is an **FTS5 virtual table** (`adapters/schema.py:113-128`) and FTS5 does not support `ALTER TABLE … ADD COLUMN` — join `wisdom_principles` on the `pr:` doc-id prefix (`retrieval.py:107`) instead of adding a column |
| 4 | `clips.clip_candidates` | `clips.py:45-48` | untyped SQL, **no flag at all**, emits `record_type` + `author_id` for PRINCIPLE and MARKET_SIGNAL over `require_push_secret` (`routes.py:160-162`). No text leaves (`RECORD_KEYS :20-21`) | **owner call** whether a metadata-only internal export counts as "publishing under a named author" |

### ⛔⛔ TWO HOLES A RECORD-LEVEL FLOOR DOES NOT CLOSE

1. **Segment text bypasses every record filter.** `retrieval._segment_docs` (`retrieval.py:49-81`)
   indexes the full `wisdom_segments.text` of **every authored segment**. The sentence an unstable
   PRINCIPLE or MARKET_SIGNAL was extracted from remains retrievable via `askai.py:73` as a
   `segment` doc, attributed by `common.speaker` (`askai.py:78`) and dated — **i.e. still under a
   named author.** Blocking `pr:` docs alone does not implement the rule as stated.
2. **The voice corpus.** `voicefmt.corpus_documents` (`voicefmt.py:42-65`) exports raw TSDR segment
   text, record types irrelevant. Same class.

⭐ **This is the most important finding in the pack.** Item 3 says *"no PRINCIPLE or MARKET_SIGNAL
publishes … under a named author"*. A record-level floor cannot deliver that, because the
**quote** reaches Ask-AI through a path that has no record in it. Either the rule means *"no
extracted RECORD publishes"* (achievable with the four points above) or it means *"the claim must
not reach a member"* (which requires a decision about segment-level retrieval, and is a much larger
change). **That distinction needs the owner.**

### 3-v — Test list for 3-i-A / 3-iii-A (the default)

1. below-floor (0.667) **blocks** at each of the four points
2. at-floor (1.0) **passes** at each
3. **missing score (NULL) blocks** — the fail-closed case, and the only case that exists today
4. a blocked record **appears in the review queue with a reason code** (the paired `enqueue`)
5. re-running the daily chain **does not duplicate** the queue row (`item_id_for` idempotency,
   `review.py:89-90`)
6. CALL / MENTION / LEVEL / NEGATIVE_CALL are **unaffected** at any stability value
7. `status` interaction: stability 1.0 **plus** `rejected` still blocks (AND, not OR)
8. **no member-facing route changes** — assert the 27-GET-route list byte-for-byte off the same
   AST walk that produced it (enumerated in this report's Step 3 appendix); every `/api/admin/*`
   carries `require_admin`, the two draft decisions carry `require_owner` (`routes.py:120,:126`),
   every `/api/internal/*` carries `require_push_secret` (`routes.py:40-48`)
9. mutation proofs: floor never fires · NULL treated as passing · queue not filtered · the
   `brainkb.py:225` opt-in removed (owner sourcing goes blind)

**What changes for other combos:** 3-i-B adds a join-correctness test per consumer and a test that
a missing side-table row blocks. 3-i-C drops tests 1–3 for MARKET_SIGNAL entirely (no id to score)
and adds a reconstruction test for PRINCIPLE. 3-iii-B replaces tests 1–2 with marker-propagation
tests **and requires a flag**, so test 8 changes from "no member-facing change" to "member-facing
change is gated".

### 3-vi — Size estimate

| combo | commits | tests | note |
|---|---:|---:|---|
| **3-i-A + 3-iii-A** | 3 (migration · four check points + enqueue · tests) | ~9 + 4 mutation proofs | the default; nothing to backfill, so it ships inert |
| 3-i-B + 3-iii-A | 4 (+1 for the `principle_key` side table) | ~12 + 4 | extra table for the Brain KB lane |
| 3-i-C + 3-iii-A | 3 | ~7 + 3 | **PRINCIPLE only**; MARKET_SIGNAL cannot be scored |
| any + 3-iii-B | +1 | +3 | **requires a flag flip** — §0.4c |
| any + segment-level closure | +2–3 | +6 | the hole in 3-iv; a different-sized change |

---

## STEP 4 — Branch and push readiness (read-only)

**4a — upstream: `origin/feat/wisdom-loop`, and it EXISTS** at **`ef0393790`**. The branch was
pushed once, long ago, and never since. `git rev-list --left-right --count origin/feat/wisdom-loop...HEAD`
= **0 behind, 392 ahead**.

**4b — local commits on no remote (3):**

| SHA | subject |
|---|---|
| `b4c9bc3fa` | `docs(wisdom): fix E2/E9/E10 pointers and headings` |
| `6c2b85749` | `merge(wisdom): origin/master into feat/wisdom-loop — lands e56a11b3e, …` |
| `3f95d9814` | `docs(wisdom): live-run pre-flight — 0 of 13 jobs would fire tonight` |

No ledger commit — Step 1 took the NO branch.

**4c — contention.** `git fetch --dry-run origin` → **no output** (remote unchanged since session
2's fetch). **Behind origin/master: 0. Ahead: 3.** `origin/master` commit rate:

| hour (ET) | commits |
|---|---:|
| 13:00 | 3 |
| 14:00 | 32 |
| 15:00 | 11 |
| 16:00 | 31 |
| 17:00 | 4 |

**81 commits in four hours.** Peer sessions on this box: **15 listed, 7 interactive and active**
(JOYSTICK, DATA CHARTS, TERMINAL, CLIPPING, DISCORD RENDERS, NOTEBOOK busy/shell; INDICATORS idle).

**4d — (a) pushing the branch vs (b) landing on master.**

| | (a) `git push origin feat/wisdom-loop` | (b) `git push origin feat/wisdom-loop:master` |
|---|---|---|
| what moves | `origin/feat/wisdom-loop` `ef0393790` → `b4c9bc3fa`, a **fast-forward** (0 behind), no force | `origin/master` advances by 3 |
| deploys anything? | **NO.** Railway deploys from master | **YES** — restarts `web` |
| pre-push hook | **secret scan only** — the hook's check 1 is "refuses to publish a credential-shaped value (**any destination**)" | secret scan **plus** the master guard: `pre_push_guard.py:411` — "*refused: a push whose destination is master (it restarts web and chart-renderer)*", the settle/queue check (`MIN_SETTLE_SECONDS = 150`, `:90`) and the A2 clock |
| A2 clock | not applicable | now **18:49 ET Monday**, past the 16:05 ET reopen — would **not** refuse on the clock |
| blocked by anything but a ruling? | **No.** No branch protection is visible in the repo (`.github/` holds 6 workflows, no protection config — that is a GitHub-side setting). The only gate is the secret scan, which this diff should pass: it is docs plus a comment edit | one-merge-at-a-time queue applies; master is quiet right now (0 behind) |

**Neither was pushed.**

---

## 1. MUTATION-PROOF

**`git status --porcelain`:**
```
?? docs/recon/
```
Only the untracked recon directory (which now holds three reports). **No tracked file modified,
added, deleted or renamed this session.**

**`git diff --stat` vs `6c2b85749`:**
```
 CLAUDE.md                             | 24 ++++++++++++++++++++++++
 api/services/wisdom/extract/golden.py |  9 +++++++--
 docs/wisdom/LEDGER.md                 |  4 ++--
 3 files changed, 33 insertions(+), 4 deletions(-)
```
That is **session 2's** commit `b4c9bc3fa`, not this session's work. **This session created zero
commits.**

**Commits created this session: NONE.** Merges: **0**. Pushes: **0**.

**Spend ledger — BEFORE and AFTER, byte-identical:**
```
BEFORE  sha256 e284a42bb1356aac115ca0e97f11ecd762745fa0770df46436aca15e58c69520
        total_usd 16.872452 | cap_usd 40.0 | entries 19
AFTER   sha256 e284a42bb1356aac115ca0e97f11ecd762745fa0770df46436aca15e58c69520
        total_usd 16.872452 | cap_usd 40.0 | entries 19
```

**Zero API calls, $0.00, and how I know:** `Q3_RERUN` read **NO**, so Step 1 took branch 1d and
nothing was submitted. No model client was constructed anywhere; `ANTHROPIC_API_KEY` was never
loaded (the scratchpad helper that loads it was not invoked, and no `.env` was opened); the spend
ledger hash is identical before and after; and no new `gate-report-*.json`, `keys-*.json`, receipt
or batch id was created. The sub-agent confirmed the same in writing.

**No env / flag / config change.** No `railway` CLI invocation. No `.env` opened.
`docs/feature_flags.json` not modified. No variable set, unset or read.

**Member data: NONE.** The sub-agent opened gate DBs with `mode=ro` and printed only table names
and `COUNT(*)` (all zero). No rows. **D16b: not read** by either of us.

**Every command run (integrator):**
```
python -c   (free-memory probe)
python -c   (spend ledger BEFORE: sha256 + fields)
python (heredoc)  catalog-estimate-defaults.json field dump + by_category sums + reconciliation
grep -rn "priority|first|highest value|rank|order of|start with" data/wisdom/WAVE1-PROMPT-v2.0.md
sed -n '52,53p' data/wisdom/WAVE1-PROMPT-v2.0.md ; grep -rn "back catalog|319" docs/wisdom/PROGRAM-MANIFEST.md
grep -n "DAILY_SEGMENT_LIMIT" api/services/wisdom/extract/batch.py
grep -n "PRICES_PER_MTOK|DEFAULT_OUTPUT_TOKENS|BATCH_DISCOUNT" api/services/wisdom/extract/budget.py
python (heredoc)  the full cost menu: 2b per-category + cumulative, 2d reconciliation,
                  2e sensitivity, 2c/2g budget table, 2f sampling
git rev-parse --abbrev-ref '@{upstream}'
git log --format='%h' 1216958ed..HEAD ; git branch -r --contains <each>
git fetch --dry-run origin
git rev-list --count HEAD..origin/master ; …origin/master..HEAD
git log origin/master --since="2 hours ago" --oneline | wc -l
git rev-parse --verify --quiet origin/feat/wisdom-loop
git rev-list --left-right --count origin/feat/wisdom-loop...HEAD
git log origin/master --since="4 hours ago" --format='%cI' | cut | sort | uniq -c
ls tools/pre_push_guard.py ; grep -n "master|refname|MIN_SETTLE" tools/pre_push_guard.py
ls -la <git-common-dir>/hooks/pre-push ; head -5 <same>
python -c  (current ET time vs the A2 window) ; sed -n '405,415p' tools/pre_push_guard.py
ListAgents  x2
grep -n "^| \*\*10\*\*|^| \*\*11\*\*|^| \*\*12\*\*" docs/recon/2026-09-14-session2-repair-e5-e6.md
grep -c "CONFOUNDED — DO NOT CITE" / "Ask Notebook|merge commit|HARD-RULES.md" <same>
grep -n "Precision and recall barely moved" -A14 docs/wisdom/OVERNIGHT-CHECKPOINTS.md
sed -n '365,412p' / '368,392p' api/services/wisdom/extract/golden.py
python -c  (verify phases.drift.below_floor and per-type flags)
python -c  (spend ledger AFTER)
```
**Sub-agents: 1** (read-only, the item 3 consumer map). Its command list is in its report; it
confirmed no files written, no tests, no git mutations, no network/API/Railway, no member data,
nothing from D16b.

⚠️ **One correction to the sub-agent's report, verified directly:** it transcribed the run-2
`below_floor` field as `[CALL, LEVEL, MARKET_SIGNAL]`. The artifact reads
**`['CALL', 'LEVEL', 'MARKET_SIGNAL', 'MENTION', 'PRINCIPLE']`** — all five, each with
`below_floor: true`. This report uses the verified value.

---

## 2. TOTALS

```
SESSION-3 TOTALS: 19 files read, 26 commands run, 1 sub-agent,
                  tests 0 run / 0 passed / 0 failed / 0 skipped,
                  0 commits, 0 merges, 0 pushes,
                  0 API calls ($0.00), 3 items NOT FOUND, 12 decisions deferred to Patrick
```

**Tests: 0.** No claim this session required one — every finding is a file read, a JSON field, or
arithmetic over artifacts. (The standing instruction to include `test_no_shadowed_definitions.py`
and `test_mutation_harness_anchors.py` in *every scoped pytest run* was not triggered, because no
pytest run happened.)

**The 3 NOT FOUND:**
1. **A value ranking of content categories** — searched `WAVE1-PROMPT-v2.0.md` and
   `PROGRAM-MANIFEST.md` for priority/order/first-pass language. 2b is therefore ordered by segment
   count, and that choice is labelled as mine.
2. **Publication dates in the catalog artifact** — `by_category` carries only
   `body_tokens, chars, segments, sources`. A per-year breakdown is not derivable.
3. **Any stored Wisdom record on this box** — all 11 `.db` files under `data/**` have
   `wisdom_records` = 0. This is why no stability backfill is possible at any price.

---

## 3. QUESTIONS FOR PATRICK

| # | question | status |
|---|---|---|
| **1** ⭐ | Copy §0.4 into a tracked `docs/wisdom/HARD-RULES.md`? | **OPEN** — `CLAUDE.md` now points at the gitignored path (session 2, E2) |
| **2** | The merge map's D16b row — strike or rewrite? Diff at 0d. | **OPEN** |
| **3** ⭐⭐ | The CONFOUNDED PRINCIPLE delta. | **OPEN — you answered `Q3_RERUN: NO`, so nothing was applied and nothing was spent.** Narrowed this session: **only the PRINCIPLE row** is affected; the other five rows stand. The exact diff a future YES produces is in Step 1 |
| **4** ⭐⭐ | **RESTATED AS A BUDGET QUESTION, not a count question.** The count is settled: **9,733 segments, 383 sources**, segmenter-derived, no filtering step. The question is *what to buy*: see the Step 2c/2g table. $120 buys 16.2% of one pass; **$750 buys the whole corpus once (25 days at the 400/day throttle)**; $2,250 buys three passes. And the per-pass figure itself is $740–$930, not $80 — the $392.34 tool estimate assumed 3,000 output tokens where the extractor emits 5,772 (2d). **What is the budget?** | **OPEN — reshaped** |
| **5** | Which agent cap is current? `CLAUDE.md` still carries both readings. | **OPEN** |
| **6** | Should "production is dark" become a committed instrument? | **OPEN** |
| **7** ⭐ | RQ-v11-001 — NULL false positive: review item or verdict? | **OPEN** |
| **8** ⭐⭐ | Tonight's four flags. ⚠️ It is now **18:49 ET Monday** — the daily chain's 18:47 ET slot has passed for today. | **OPEN, and today's window has closed** |
| **9** | Push the branch, or hold? Step 4d: (a) is a clean fast-forward of `origin/feat/wisdom-loop` (392 ahead, 0 behind), deploys nothing, and is gated only by the secret scan. (b) advances master and restarts `web`. | **OPEN — neither pushed** |
| **10** ⭐⭐ | **Item 3's decisions — now lettered.** Answer as `3-i-A/B/C`, `3-iii-A/B/C`, plus the four sub-questions in 3-iv (does the floor cover `modelbook.py`? what did "the voice profile" mean? how does it reach Ask-AI? does NULL block?). | **OPEN — full pack at Step 3** |
| **11** | Item 3's consumer list is wrong in two directions; `clips.py` is a third omission (all six types, **no flag at all**). Correct the SESSION-STATE wording? | **OPEN — widened** |
| **12** | Should the gate persist its records? | **OPEN — and now stronger: there are NO stored records anywhere, so nothing can be backfilled at any price** |
| **13** ⭐⭐ | **NEW — the rule as written cannot be delivered by a record-level floor.** `retrieval._segment_docs` (`retrieval.py:49-81`) indexes the **full text of every authored segment**, so the sentence behind an unstable PRINCIPLE stays retrievable through Ask-AI, attributed and dated. Does item 3 mean *"no extracted RECORD publishes"* (achievable — four check points) or *"the claim must not reach a member"* (a much larger change touching segment-level retrieval)? | **OPEN — the biggest open question in the pack** |
| **14** | **NEW** — `clips.py:45-48` reads all six record types with **no feature flag**, gated only by `require_push_secret`, and emits `record_type` + `author_id` (no text). Does a metadata-only internal export count as "publishing under a named author"? | **OPEN** |
| **15** | **NEW** — three data-quality defects in the catalog artifact: a typo'd category `LIVE TRAIDNG` (54 segs), a case-duplicate pair `Sharpen Your/your Trading Skills` (60 segs between them), and a source-split mismatch (docstring says 319+64; `by_category` shows Sunday Scans = 69). Fix before any per-category budget is set? | **OPEN** |

⭐⭐ = blocks other work. ⭐ = load-bearing for one item.
