---
id: WISDOM-SESSION-11
title: Session 11 — identity ruled and applied, R36 live, the promotion prepared
status: complete — 6 authored commits, 1 merge (master INTO branch), 0 API calls, $0.00
---

# Session 11 — identity ruled, R36 applied, promotion prepared

> **SPEND $0.00. Ledger BYTE-IDENTICAL** — sha256 `d976dba7a2d963a4…`, 5,405 bytes,
> `total_usd 31.4815`, `cap_usd 40.0`, 28 entries. No API call, no gate run, `railway` never
> invoked.
>
> ⚠️ **R37 was ruled `40.0` — UNCHANGED — so `cap_usd` was not edited.** The prose accompanying the
> brief recommended $100 and the ruling line said 40.0. "Read literally; never infer a value not
> written" settles it, and not raising a spend cap is the fail-safe direction. **This is question
> Q-1 below, not a decision I took.**

`feat/wisdom-loop` `2e3ba62ec` → **`b605a7fa7`**, pushed. Scoped suite **1,210 passed · 1 skipped ·
0 failed** (71 named files, 228 s). No commit of mine is an ancestor of `origin/master`.

## Rulings — one line each

| ruling | outcome |
|---|---|
| **R43** MS_IDENTITY: MERGED_J05 | ✅ applied to the write path — **21 → 61** records clear the floor |
| **R43** PRINCIPLE_IDENTITY: KEY | ✅ unchanged. The grading WOULD support LENS_STRICT; it is not ruled |
| **R17** N: HOLD_3 | ✅ nothing bought |
| **R36** ESTIMATOR: APPLY | ✅ applied **with** the per-batch actuals re-check, mutation-proved |
| **R37** CAP: 40.0 | ✅ **unchanged**, ledger byte-identical — see the note above |
| **R44** PREPARE_PROMOTION: YES | ✅ master merged in, CI parity green, PR body written |
| **R44** OPEN_PR: YES | ⚠️ **`gh` is ABSENT** — command + mobile route written instead |
| **R45** ADMIN_STATS_ROUTE: YES | ✅ existing route extended; **no new route** |
| **R42** ENTITY_MASTER_PROD: INVESTIGATE | ✅ **UNKNOWN, but every artifact points to EMPTY** |
| **R8** FLAGS: HOLD | ⏭️ nothing flipped |
| **PUSH_BRANCH** | ✅ branch only, no force; master never pushed |
| **AGENT_CAP: 3** | 3 read-only scouts, one wave |

---

## Step 1 — grading the merges against golden

    identity              graded  correct  over  ungradeable  precision
    MERGED-MS J=0.4            2        2     0           65      1.000
    MERGED-MS J=0.5            1        1     0           56      1.000
    MERGED-MS J=0.6            1        1     0           36      1.000
    LENS-PRINCIPLE t=0.6      13       13     0           32      1.000
    LENS-PRINCIPLE t=0.9       7        7     0           13      1.000

**1b — the lens already clears ≥0.9 at its own default (t=0.6).** So the threshold behind a future
`LENS_STRICT` is **0.6**, and it would move PRINCIPLE **31 → 67**. ⛔ Not applied: R43 rules KEY.

⚠️ MERGED-MS grades over n ≤ 2 — golden holds only **3** MARKET_SIGNAL expectations across 57
segments, so the labels can barely reach it. Precision 1.000 over one cluster is not evidence; the
ruling stands on R30's audit, not on this.

**1d — hand-check reduced, honestly:** 73 → **71** and 60 → **42** pairs. Smaller, not small.

⚰️ **The first run returned ZERO gradeable PRINCIPLE clusters, and it was a real defect.**
`identity_study._rows_by_segment` did `tuple(row.get(key_field))` and `principle_key` is a STRING —
so it became a tuple of individual CHARACTERS. A bijection, so the clustering grouped correctly and
sessions 9–10's numbers are unaffected (re-verified: LENS 122/67/55, MERGED 163/61/102, KEY
236/21/215), but the grader's intersection with the cluster keys was **0 of 182**.

## Step 2 — R43 on the write path

`reconcile.MS_IDENTITY` is the single switch. On the local store's 826 real records:

    MARKET_SIGNAL clearing the floor   21 -> 61        identities  1,223 -> 1,150
    floor blocked                     143 -> 103       PRINCIPLE   31, unchanged

⭐ KEY is recomputed into every manifest as `comparison_key_identity` — never written to the tables.

⚠️ **The floor enqueues but never retracts.** 103 records blocked, **153** `below_publication_floor`
rows. Harmless today (the queue is advisory), but it overstates what is currently blocked.

### The fixture that made four tests vacuous

`_name_tokens` reads `fields.market_signal.name`, which the synthetic rows did not carry — so no
pair was ever a merge candidate and **every "must not merge" assertion passed because nothing
merged at all.** Two guard mutations went UNCAUGHT. With a name in the fixture and a non-vacuity
control asserting a merge really happens, the component-guard mutation reds a test by name.

⭐ And the guard comment is now on its **third** statement and its **first measured** one: the
pre-filter is an optimisation (disabling it changes no test); `_Union.union` is the guard
(disabling it reds one).

## Step 3 — R36 applied, R37 not

Reservation = **p90 of measured cost-per-request × 1.5**, floored at the worst case when
unmeasured, never above the ceiling. `SpendCap.settle` re-checks **actuals** against the cap after
every batch and latches a refusal `run_batch_round` consults.

⚠️ **Deviation, stated:** the ruling asks for a p90 over tokens "for this extractor_version". The
ledger carries `at, batch_id, collected, model, phase, requests, transport, usd` — **no token
counts, no extractor_version** — so that p90 is not derivable from existing history. The estimate
is over cost-per-request, the quantity the cap is denominated in.

⛔ **Why the second half is mandatory:** p90 × 1.5 = 15,962 output tokens against an observed max
of **18,857** (0.85×). A measured reservation CAN sit below the largest real request, and the cap
is otherwise tested only at reserve time. `OBSERVED_MAX_OUTPUT_TOKENS = 18857` is a fixture.

## Step 4 — promotion readiness

**The branch had never touched master.** 61 incoming commits merged in — **none** touching wisdom
paths, workflows or schema. CI parity (`wisdom-rails.yml`) run locally: `core_check_bans` PASS,
rails `--noconftest` **236 passed**, provenance `--self-check` PASS, provenance PASS.

**Promotion gate, evaluated:**

| check | verdict |
|---|---|
| pre-push secret scan (`secret_scrub.py --pre-push`) | **PASS** — 56 files, 0 findings |
| **the A2 clock** (`pre_push_guard.py`) | ⚠️ **WOULD REFUSE a daytime push** — 13 changed files under `api/`, and cleared prefixes are `docs/ tests/ tools/ scripts/ app/` only. Merge after **16:05 ET**, at a weekend, or via the GitHub UI |
| the queue guard (≥150 s settled, `web` SUCCESS) | **NOT EVALUATED** — needs the Railway CLI, forbidden this session |
| `master-deploy-gate.yml` — concurrency, secret scan, shadowed defs, vite args, flag ledger, hygiene | **PASS** locally on every offline half |
| `wisdom-rails.yml` | **PASS** |
| route surface | **unchanged at 27** |

**Migrations:** four additive nullable `ADD COLUMN`s, applied on the first web boot
(`api/main.py:3244-3245`, unconditional). **Proved idempotent by running the real runner twice**:
pass 1 applied 24, pass 2 applied **0**.

⛔⛔ **THE CHAIN IS A NO-OP DARK, and one step is not gated the way the flag plan assumed.**
`registry.py:200-202` skips the whole chain while `WISDOM_INGEST_ENABLED` is unset — one heartbeat
row, nothing else. But chain step 1, `capture`, consults **no gate of its own**;
`WISDOM_CAPTURE_ENABLED` gates the standalone capture jobs (`capture/jobs.py:46`). **So
`WISDOM_INGEST_ENABLED` alone starts capture.**

**PR body:** `docs/wisdom/PROMOTION-2026-09-15.md`. ⚠️ `gh` is **absent**, so it was not opened; the
exact `gh pr create` command and the mobile-app route are in that file.

## Step 5 — production's entity master

**UNKNOWN by repo evidence, and every artifact points to EMPTY.** The only real seed run wrote to
`_local_seed_data/entity_master.db`, explicitly not the `DATA_DIR` default and not Railway's volume
(`docs/entity-master-implementation-log.md:268-280`). It is scheduled nowhere.

⛔ **And the failure is silent**: `entity_master/store.py:129-143` calls `schema.init_db`, so a
missing `/data/entity_master.db` is **created empty by the first consumer** — no error, no log. The
Wisdom chain would then demote every CALL to MENTION with `call_entity_unresolved`, which is
indistinguishable from a corpus with no calls in it.

⭐ The Step 6 route now reports `store_counts`, so one signed-in page load after promotion
distinguishes them.

## Step 6 — R45

`GET /api/admin/wisdom/core/status` gains `store_counts` (9 tables), `floored_stability`,
`extractor_version`. **No new route** — the pinned 27-route list and the dark-check walk are
untouched, and a test pins that claim. Counts only: an AST walk over the two readers refuses any
SELECT naming a text-bearing column, with a control proving it catches a planted one. An absent
table reports **null**, not 0.

## Step 7 — the flag plan

In `PROMOTION-2026-09-15.md`. First flip is **`WISDOM_INGEST_ENABLED`** (which, per the finding
above, is what actually starts capture). EXTRACT stays dark — the only switch that spends.
Ask-AI stays dark — the only switch that makes anything member-visible.

**The EXTRACT condition, as a number:** at **$0.058671/segment**, the **$8.5185** of headroom funds
about **145 segments** — one modest day. EXTRACT is worth flipping only with a ruled per-day
budget, R36 live (it now is), and a cap covering a day's throughput.

⛔ **Nothing was flipped by this session, and no session flips anything.**

---

## 1. MUTATION-PROOF

- `git status --porcelain` **clean**; `origin/feat/wisdom-loop...HEAD` = **0 0**.
- `git diff --stat 2e3ba62ec..HEAD` over my own paths: **27 files, +4,032 / −39**.
- **6 authored commits**, each `git show --stat` reviewed: `b6d511877` (grading + key fix),
  `e818e9c9b` (R43 write path), `eac990815` (study pinned to KEY), `18cad2c87` (R45),
  `6441f3053` (PR body), `b605a7fa7` (R36).
- **Merges: exactly 1** — `3eade7269`, `origin/master` INTO the branch, first-parent verified.
  ⚠️ A naive `--merges` over the range shows 6; five are master's own, inherited by the merge.
- **Master untouched BY THIS SESSION, stated the way it can actually be verified.** `origin/master`
  was `79b4b2907` when I merged it in and is `3a57e3a09` at session end — it moved, by ONE commit,
  `docs(joystick): stage 3 … (#143)`, authored by another session while this one ran. ⛔ The claim
  that matters is not a SHA that other people can move: **none of my seven commits is an ancestor
  of `origin/master`** (`git merge-base --is-ancestor`, checked per commit), and my reflog carries
  pushes to `refs/remotes/origin/feat/wisdom-loop` only. No `gh pr merge`, no master push.
  **PR state: none — `gh` absent.**
  ⚠️ Consequence for the merge: the branch is now **1 behind** master again. That is normal and the
  PR will show it; a re-sync before merging is a one-command step, not a blocker.
- **Ledger byte-identical**, printed before and after; `cap_usd` still `40.0` (R37 = 40.0).
- **Zero** flag / env / config changes. `railway` never invoked. No key printed, measured or
  searched for.
- **Off-limits diff EMPTY across all six AUTHORED commits** (checked per commit, not over the
  merge range — the range carries other teams' `app/src/` and `docs/discord-render/` work that
  arrived with master).
- Member data **NONE**; D16b **not read**.
- **Mutations run:** grading — count an ungradeable cluster as correct → **3 red**; R43 — component
  guard disabled → **1 red**, ruled constant flipped → **3 red**, pre-filter disabled → **0 red**
  (so it is an optimisation, and the comment now says so); R36 — post-batch actuals check removed →
  **1 red**. Every restore byte-exact, sha256-verified.

## 2. TOTALS

| | |
|---|---|
| API calls / spend | **0 / $0.00** |
| sub-agents | 3, read-only, one wave |
| tests | **1,210 passed · 1 skipped · 0 failed** (71 files) |
| new rails | 29 (9 grading, 5 R43, 9 R45, 11 R36 — minus overlap) |
| commits / merges / pushes | 6 authored / **1** / 6, branch only |
| items NOT FOUND | `gh`; token counts and `extractor_version` in the ledger |
| decisions deferred | the cap (R37), LENS_STRICT, the PR merge, the per-day extract budget |

## 3. QUESTIONS FOR PATRICK

**Q-1 ⭐ load-bearing — the cap.** Your ruling line said `R37_LEDGER_CAP_USD: 40.0` while the prose
recommended $100. I read the ruling literally and **did not touch it**. Headroom is **$8.5185**,
which funds ~145 segments — not enough for N=5 ($9.7393), the n=250 sample, or an entity-master
recovery run. **Write the number and it is a one-line commit.**

**Q-2 ⭐ load-bearing — merge the PR.** `gh` is absent here. Open it from the GitHub mobile app
(base `master`, compare `feat/wisdom-loop`, body = `docs/wisdom/PROMOTION-2026-09-15.md`) and merge
it there. ⚠️ **After 16:05 ET or at a weekend** — the clock guard refuses a daytime master push
because 13 changed files live under `api/`.

**Q-3 — LENS_STRICT for PRINCIPLE?** Graded precision is **1.000 at the lens's own t=0.6** (13/13),
which clears the ≥0.9 bar your ruling set. It would move PRINCIPLE **31 → 67**. R43 ruled KEY, so I
did not apply it.

**Q-4 — the reduced hand-check.** 71 MARKET_SIGNAL pairs and 42 PRINCIPLE pairs remain ungradeable,
in `data/wisdom/identity-study/`. Still a sitting, not a glance.

**Q-5 — the per-day EXTRACT budget.** At $0.058671/segment, name a daily ceiling and the first
EXTRACT window can be scheduled.

**Q-6 — production's entity master.** UNKNOWN, almost certainly EMPTY, and it fails silently. One
signed-in load of the admin status route after promotion settles it.

**Q-7 — the floor enqueues but never retracts** (103 blocked, 153 rows). Leave it, or should a
record that starts passing have its review row withdrawn?
