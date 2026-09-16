---
id: WISDOM-SESSION-13
title: Session 13 — R48 delivered, R50 settled, the branch re-synced; IS_MERGED false
status: complete — 3 authored commits, 1 sync merge, 0 API calls, $0.00. NOT merged.
---

# Session 13 — the two carried rulings, and a merge that superseded one of ours

> **SPEND $0.00.** No gate run, no API call, `railway` never invoked, no key read.
> **Ledger byte-identical: 5,406 bytes, sha `b182b329`, 28 entries, `total_usd 31.481462`,
> `cap_usd 100.0`.** Every R48 proof ran against a COPY.
>
> **IS_MERGED = FALSE.** `git merge-base --is-ancestor HEAD origin/master` → false. The branch tip
> is still not an ancestor of master. **Step 5 was NOT run; its runbook is printed below as the
> next session's Step 5.**

`feat/wisdom-loop` `b54796d8a` → **`b0e8bb94d`**, pushed, tree clean, 0 0 with origin.
**79 ahead, 0 behind.** Scoped suite **1,263 passed · 1 skipped · 0 failed** (75 named wisdom
files). CI parity: all four wisdom-rails steps PASS.

## Rulings — one line each

| ruling | outcome |
|---|---|
| **R48** LEDGER_TOKENS | ✅ delivered — the one ruling session 12 did not, now carried as eight fields |
| **R50** GATING_AUDIT | ✅ settled — **list (i) is EMPTY**, and the finding is enforced, not just written down |
| **R49** SYNC_UNLIMITED | ✅ used once; the conflict it produced is the interesting part |
| **R51** POST_MERGE_VERIFICATION | ⏸️ **IF_MERGED**, and it is not — the runbook is printed, not run |
| **R8** FLAG_PLAN | ✅ HOLD; the rehearsal re-run found two things the flip plan now warns about |
| **PUSH_BRANCH** | ✅ branch only; no commit of mine is an ancestor of master |
| **AGENT_CAP: 3** | 3 read-only scouts, one wave |

---

## Step 1 — R48: the ledger carries its tokens, and absent is unknown

Every new spend-ledger entry now carries `input_tokens, output_tokens, requests,
extractor_version, model, golden_file` (name only), `run_id, rounds`. The 28 existing entries are
untouched.

R36's estimator gains the form **the ruling actually asked for**: p90 × 1.5 over MEASURED tokens
per request, priced through `budget.estimate_cost`, preferred once two entries carry counts —
with cost-per-request as the fallback and `worst_case_usd` still the ceiling. Three branches,
three tests.

⛔⛔ **ABSENT IS UNKNOWN, NEVER ZERO, and it is a spend rule rather than a bookkeeping one.**
`dict.get(k, 0)` is the natural way to read a JSON field, and read that way the 28 pre-R48 entries
say *"used no tokens"*. Averaged in, they drag the p90 toward nothing, reserve under what a real
request costs, and let ACTUALS walk past a cap that is only tested at reserve time. So:

* the **reader** SKIPS an entry without counts;
* the **writer** stays SILENT rather than writing a zero — a batch that timed out, failed to
  create, or collected nothing measured an unknown number of tokens, not none.

⭐ **And `token_fields` is all-or-nothing against what was SENT.** The counts are summed over
succeeded results while the entry's `requests` counts what was sent, so a partially-collected
batch would be divided by too large a denominator and under-estimate. Rather than add a second
denominator field the ruling does not name, **a partial batch contributes no token history at
all** — fewer entries, never a wrong one.

**Proved on a COPY of the real ledger:** first 28 entries byte-identical · `total_usd`
31.481462 → 31.731463 (the probe's own $0.25) · `cap_usd` 100.0 unchanged · no token field
backfilled onto a pre-R48 entry · and the real file still 5,406 bytes, sha `b182b329`.

⚰️ **Two corrections made in passing, both recorded rather than made quietly.**
The R36 comment claimed *"new entries now record `extractor_version` so a future run CAN filter by
it."* **No settle call site passed it.** It is true from here on, and the strike-through says so.
And `transport_label()` removes a second authority: `stream_call` wrote `transport: "stream"`
while `reservation_usd` looked up `"sync"`, so stream history could never match its own entries.
Inert today — only `run_batch_round` reserves — and left inert rather than left wrong.

## Step 2 — R50: the four unfloored types, and who can see them

The floor governs PRINCIPLE and MARKET_SIGNAL only; `floor.passes()` returns True for every other
type **by construction**, so CALL / MENTION / LEVEL / NEGATIVE_CALL are unfloored the moment
EXTRACT runs.

| measured, derived from source | |
|---|---|
| wisdom-owned routes | **38** — 28 `require_admin`, 4 `require_owner`, 6 `require_push_secret` |
| member-reachable wisdom routes | **0** — no `require_paid`, no `get_current_user`, none unguarded |
| doors into the package from outside it | **5** |
| readers of `wisdom_records` | **21** modules, each now carrying a verdict |
| gates | **25**, every one defaulting `"0"`; **10** marked `member_visible` |

**LIST (i) — member-visible AND ungated: EMPTY.**
**LIST (ii) — behind a `member_visible` gate that defaults OFF: 5** — `desk_markers`, `dossier`,
`askai`/`retrieval`, `modelbook` drafts, `brainkb`.

**No minimal gate set is applied, because the minimal set needed to empty list (i) is empty.**
Inventing a gate nobody ruled would be a behaviour change on your chain dressed as an audit
finding.

⭐ **What IS applied is the enforcement.** A one-time audit nobody re-runs reads as coverage —
this repo's own `desk_session_insights` was *"written, documented as scheduled, wired into no
scheduler"* for weeks. `tests/test_wisdom_type_gating_audit.py` fails **by name** when a module
outside the package starts reading it, or when a new reader of `wisdom_records` lands without a
MEMBER / OWNER / INTERNAL verdict. It deliberately duplicates nothing: gate polarity, route guards
and per-consumer behaviour each already have exactly one owner.

### The rehearsal had to be re-run, because the old one could not answer this

⚰️ Session 12 ran INGEST-only against an **EMPTY** store and reported *"0 crosses, 0 scores, 0
records"*. True, and worthless as evidence: **an empty store cannot distinguish "this consumer is
gated" from "this consumer had nothing to read"**, and every UNGATED consumer would have printed
exactly the same zeros.

`tools/wisdom/gating_rehearsal.py` re-runs it with **12 records of the four types present**:

    wisdom_records 12 · wisdom_review_queue 36 · wisdom_kb_rows 3
    shut  0   desk_markers  GET /api/education/tickers/{sym}/mentions  require_paid
    shut  0   dossier       POST /api/ai-search (bundle)               require_paid
    shut  0   askai         POST /api/ai-search (UCT SAID block)       require_paid
    shut  0   brainkb       kb-export rows leaving                     require_push_secret
    shut  0   modelbook     drafts written for owner approval          require_owner
    VERDICT (INGEST only, 12 records present): member doors SHUT

⭐ **And `--self-check` proves 4 of those 5 doors report OPEN when their gate is lit**, so `shut`
is a measurement and not silence. The fifth, Ask-AI, carries a second gate this rig cannot light —
the `wisdom-askai` cohort is a `user_tags` row in auth.db — and is reported as a **stated limit
rather than faked**. Doors report three outcomes, never two: `shut`, `OPEN`, and
`could-not-be-asked`.

⛔⛔ **A FORCED CHAIN RUN BYPASSES `WISDOM_EXTRACT_ENABLED`** — `extract/batch.py:439` reads
`if not ctx.force and not flags.extract_enabled()`. The golden gate and the spend cap still sit
behind it, so it is not an open till; but it is **the one switch that spends**, and on the forced
path it does not mean what its name says. Found because the rehearsal's own first run forced the
chain and watched `extract` report `ok` with the flag unset. **Pinned, not fixed** — whether an
admin-triggered chain run may force is yours to rule, not the audit's.

⚠️ **Three more that are NOT list (i) and are yours to look at anyway:** `clips.clip_candidates`
is the one flagless publish consumer (already ruled R10_ITEM3, FLOOR — recorded so the next audit
finds a decision, not a gap); `report._calls` has no flag on its build and a status filter looser
than every other reader's (`!= 'superseded'`, which admits **rejected** records); and `brainkb`
**stages** rows into `wisdom_kb_rows` flag-OFF — 3 on a dark night, measured — with only the
export gated.

## Step 3 — the sync, and the conflict worth reading

Master moved **33 commits / 41 files**, none touching a wisdom path, workflow or schema. Two
conflicts, both in `tools/pre_push_guard.py`, and both are **the same ruling reached twice by two
workstreams**:

| | |
|---|---|
| **master, R18** | "the RTH deploy window is RETIRED, programme-wide" — KEEPS the machinery, makes `decide_clock` return OK, keeps ONE clock consumer (the fail-closed unreadable-clock branch) and says so in the file. Then R19 (burst-clause owner attestation) and R20 (bypass-log reason codes) on top. |
| **this branch, R46** | reached the same OUTCOME by DELETING ~190 lines and railing that it cannot return. |

**Resolved to MASTER, both files, byte-identical.** Master is the trunk, it is the owning
workstream's treatment of the ruling, and it carries R19+R20 which this branch does not. Keeping
the deletion would have reverted another workstream's work **inside a sync merge**, which is the
one thing a sync merge must never do.

⛔ **What it costs, stated:** R46's `test_the_guard_has_no_time_of_day_branch` is gone. It walked
the AST and failed if any removed symbol returned — **incompatible by design** with master's
decision to keep the machinery deliberately unreachable. The product outcome is identical: no
time-of-day refusal on any path. **Session 12's R46 is SUPERSEDED, not overturned.**

⚠️ Master's file says those symbols are *"still read by `docs/runbooks/deploy-windows.md`,
`tools/flow_worker_watch_coverage.py` and the JSON output"*. Checked rather than relayed: **no
Python module outside the guard imports any of them**, so that is about the Tier concept, not a
call site.

87 guard tests pass; `--self-check` PASS with its discriminator.

## Step 4 — the promotion doc

Refreshed: `79 ahead / 0 behind`, 70 files, +14,632 / −63, suite `1,263 passed · 1 skipped`, the
three session-13 changelog rows, the R46-supersession note, a **fourth** flag-plan warning (the
forced-chain bypass) and the superseding rehearsal record.

## Step 5 — NOT RUN

**IS_MERGED is FALSE**, so per the brief this is printed as the next session's Step 5 rather than
executed. Verbatim runbook:

    1. git fetch && git merge-base --is-ancestor <branch tip> origin/master   # must be TRUE
    2. CI: the promotion-gate workflow set on the push to master — all green
    3. dark check against production, UNAUTHENTICATED GETs only, User-Agent set,
       >= 250 ms spacing, NO body stored:
         python scripts/wisdom_dark_check.py --host https://uctintelligence.com
       three exit codes: 0 PASS (every gate dark) / 1 LIT / 2 INCONCLUSIVE
    4. GET /api/admin/wisdom/core/status signed in as admin — settles Q-4, production's
       entity master (still UNKNOWN, almost certainly EMPTY, and it fails silently)
    5. record the result in docs/recon/ with the live SHA and /api/health uptime

⛔ **When you merge, choose "Create a merge commit," not squash.**

---

## 1. MUTATION-PROOF

- `git status --porcelain` **clean**; `origin/feat/wisdom-loop...HEAD` = **0 0**.
- **3 authored commits**: `401eee074` (R48), `78a51194c` (R50), plus the sync merge `b0e8bb94d`.
  Each `git show --stat` reviewed; **off-limits diff EMPTY on every one**.
- **Merges: exactly 1** — `origin/master` INTO the branch, first-parent verified.
- **None of this session's commits is an ancestor of `origin/master`** — the verifiable claim.
  No master push, no PR opened, no `gh`.
- **Ledger byte-identical**: 5,406 bytes, sha `b182b329`, 28 entries, `total_usd 31.481462`,
  `cap_usd 100.0`. Every R48 proof ran against a temp copy.
- **Zero flag / env / config changes.** The rehearsal ran in a sandbox with the census pins applied
  before any `api.**` import.
- No `railway`. No key printed, measured or searched for. Member data **NONE**. D16b **not read**.
- **Mutations, each restore byte-exact and sha256-verified:**

  | mutation | result |
  |---|---|
  | R48 — absent token counts read as ZERO | **4 red**, incl. the load-bearing one |
  | R48 — estimator preference order inverted | **2 red** |
  | R48 — `token_fields` writes zeros instead of staying absent | **4 red** |
  | R50 — an undeclared door into the package | **1 red, by name** |
  | R50 — an unclassified new reader of `wisdom_records` | **1 red, by name** |
  | R50 — the desk-markers member gate removed | **2 red** — in the EXISTING consumers rail, which is the guard that owns that failure |

⭐ **Two of my own instruments were wrong first, and both were caught by the thing that exists to
catch them.** The R48 literal-scan matched **the comment that EXPLAINS the bug it hunts** — the
defect where deleting the explanation makes the check pass; it is now AST-based, with a control.
And the rehearsal's first run **tripped the shared-root guard**: clearing every `WISDOM_*` name
*after* pinning also cleared `WISDOM_DB_PATH`, so the store resolved to `C:\data`. The guard
refused it. Order is now load-bearing and commented, and the fixed tool was proved clean —
`C:\data\wisdom.db` byte-identical across a full run.

## 2. TOTALS

| | |
|---|---|
| API calls / spend | **0 / $0.00** |
| sub-agents | 3, read-only, one wave |
| tests | **1,263 passed · 1 skipped · 0 failed** (75 named wisdom files) |
| net test change | +32 new rails (17 R48, 15 R50); −1 superseded by master's R18 |
| commits / merges / pushes | 2 authored + 1 sync merge / **1** / 3, branch only |
| rulings delivered | **R48 ✅ · R50 ✅ · R49 ✅ · R8 ✅ · R51 ⏸️ IF_MERGED (not merged)** |

## 3. QUESTIONS FOR PATRICK

**Q-1 ⭐ load-bearing — create and merge the PR.** Still the gate. Compare URL in
`docs/wisdom/PROMOTION-2026-09-15.md`. **Merge commit, not squash.**

**Q-2 ⭐ load-bearing — the 42 pairs.** The sheet now carries the STATEMENTS beside the keys:
`data/wisdom/identity-study/lens-principle-HANDCHECK.tsv`, 42 rows, both statements resolved on
every one, gitignored. Put `Y` or `N` in the `verdict` column, save, then
`python tools/wisdom/pair_verdicts.py --read`. A blank reads as UNJUDGED, never as agreement.

**Q-3 ⭐ NEW — may an admin-triggered chain run FORCE?** `extract/batch.py:439` lets `ctx.force`
bypass `WISDOM_EXTRACT_ENABLED`, the only switch that spends. The golden gate and the spend cap
still sit behind it. Ruling it either way is one line; leaving it unruled means the spend switch
means two different things on two paths.

**Q-4 — production's entity master.** Still UNKNOWN. One signed-in load of the admin status route
after promotion settles it. (Carried; it is Step 5's item 4.)

**Q-5 — the per-day EXTRACT budget.** Unchanged: $0.058671/segment, $68.52 headroom, 400/day =
$23.47. Name a daily ceiling and the first EXTRACT window can be scheduled.

**Q-6 — `WISDOM_RETRIEVAL_INDEX_ENABLED` is marked `member_visible=False`** while the index it
builds is what the member-visible Ask-AI block reads. Ask-AI's own gate decides whether anything
leaves, so the defence in depth is intact — but the label under-states it on a flip checklist.
**Left unchanged: relabelling is a judgement, not a measurement, and it is yours.**

**Q-7 — the 10 superseded queue rows** for still-blocked records at older scores. Carried from
session 12, unchanged: leave, or should a re-block supersede the previous row?

---

## ⚠️ One thing you did not ask about, found while verifying

`C:\data\wisdom.db` was modified during this session and **it was not me** — proved by snapshotting
its sha, running the full rehearsal, and re-reading it byte-identical. Read-only, it holds **8
heartbeat rows and 7 migrations and nothing else**, every heartbeat `skipped: master switch
WISDOM_INGEST_ENABLED is off`. `C:\data\desk.db` and `C:\data\fundamentals_tables.db` were touched
in the same window.

**That is a local backend on this box running the real schedulers against the LIVE data root.**
The wisdom half is harmless and is in fact the dark-chain prediction confirmed against an
unattended process — one heartbeat per tick, nothing else, over two days. But it is the hazard
CLAUDE.md already names: *"writes into `C:\data` from outside pytest hit the live files; the
conftest guard is a test-suite rail only."* Worth knowing which session owns that process.
