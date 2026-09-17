---
id: WISDOM-SESSION-12
title: Session 12 — the clock rail retired, the floor retracts, PRINCIPLE under the lens, PR-ready
status: complete — 5 authored commits, 1 merge (master INTO branch), 0 API calls, $0.00
---

# Session 12 — a stale rail retired, the queue self-corrects, the branch is PR-ready

> **SPEND $0.00.** No gate run, no API call, `railway` never invoked.
> **Ledger: `cap_usd` 40.0 → 100.0 by owner ruling R37. Totals identical** — `total_usd 31.4815`,
> 28 entries, 5,405 → 5,406 bytes (+1, the one character in `40.0` → `100.0`).

`feat/wisdom-loop` `4700812c9` → **`1b1cfc4f3`**, pushed, tree clean, 0 0 with origin.
Scoped suite **1,259 passed · 1 skipped · 0 failed** (73 files). CI parity: all four wisdom-rails
steps PASS.

## Rulings — one line each

| ruling | outcome |
|---|---|
| **R46** CLOCK_RAIL: RETIRED | ✅ removed from the guard AND from both docs that carried my error |
| **R37** CAP: 100.0 | ✅ edited; headroom $8.52 → **$68.52** ≈ 1,168 segments |
| **R43** PRINCIPLE: LENS_STRICT_06 | ✅ applied — publishable **31 → 66** |
| **R47** FLOOR_RETRACTION: YES | ✅ open rows now track blocked records exactly |
| **R48** LEDGER_TOKENS: YES | ⚠️ **NOT DONE** — see the honest note below |
| **R44** PR_PATH: COMPARE_URL | ✅ URL + short body written; `gh` absent, nothing half-opened |
| **R8** FLAG_PLAN: INGEST_ONLY | ✅ **rehearsed in a child process**, not merely traced |
| **PUSH_BRANCH** | ✅ branch only; none of my commits is an ancestor of master |
| **AGENT_CAP: 3** | 3 read-only scouts, one wave |

---

## Step 1 — R46: the clock rail, and my own error

**I wrote a waiting period into a promotion document for a rule that does not exist.** Session 11
read `pre_push_guard.py`'s "owner ruling A2" clock and reported *"merge after 16:05 ET or at a
weekend"*.

⚰️ **CLAUDE.md:4805 had already recorded the opposite**, on 2026-08-24: *"Shipping window: NO
FREEZE … the market-hours push freeze and BOTH its guards were removed by owner decision. Push
whenever."* The clause in the guard was a **rescinded rule reinstated** — the failure CLAUDE.md
warns about twice — and it survived because a stale rule is indistinguishable from a live one.

**Removed:** `RTH_GUARD_OPEN/CLOSE`, `CLOCK_OVERRIDE_ENV/VALUE`, `CLEARED_PREFIXES/SUFFIXES`,
`read_clock`, `decide_clock`, `changed_paths`, `is_cleared`, `uncleared_paths`, `next_allowed_et`,
`_freshness`, the `main()` enforcement block, the override branch, and the `clock` key from
`--json`. **19 clock tests removed; 2 adapted** rather than deleted — the cadence-through-main test
used the clock only as scaffolding, and the json test became the stronger assertion that the
payload carries **no** clock key.

**KEPT, deliberately:** the QUEUE guard (`web` SUCCESS, settled ≥ 150 s) and the CADENCE guard
(don't push inside another deploy's build window). Those are about not colliding with a deploy in
flight — physics, not a clock. `--self-check` still PASSES and `--json` still refuses correctly.

`test_the_guard_has_no_time_of_day_branch` walks the module AST and fails by name if any removed
symbol returns or any `.hour`/`.minute` comparison appears. Mutation: reintroducing one reds it.
Its control plants a `.hour` comparison and proves the predicate can see one.

⛔ **And the guard was never in the merge path anyway:** hooks are client-side, so a PR merged on
github.com runs none of them. What runs is the promotion-gate workflow set.

## Step 2 — the one merge

`origin/master` merged in (**1 commit**, touching no wisdom path, workflow or schema). CI parity
green; migrations idempotent on the real runner; 27 routes / 25 gates unchanged.

## Step 3 — R47: the floor retracts

    before   153 open below_publication_floor rows for 103 blocked records
    after    open rows track blocked records EXACTLY; 40 resolved, second run 0 changes

Items are **RESOLVED, never deleted**. Three traps, each railed and each mutation-proved:
**filter on the tab** (`writer.py:667-670` uses the identical `record:{id}` subject_ref on
`extraction_audit` — dropping the filter reds 7 of 9 tests), **expect more than one open row per
record** (`item_id_for` hashes the block-time stability), and **match `new_json.reason`**.

⭐ An item a PERSON decided is untouched for free — `review.act` refuses anything not open — and
that is pinned by a test that vetoes an item and asserts the floor leaves it `vetoed`,
`resolved_by: patrick`. The retraction signs as `publication_floor`, never a person.

⚠️ **Open:** 10 still-blocked records carry a second, superseded row at an older score. The ruling
says leave items for still-blocked records alone, so they stand.

## Step 4 — R43: PRINCIPLE under the lens

    PRINCIPLE records clearing the floor   31 -> 66
    MARKET_SIGNAL (unchanged, MERGED_J05)  61
    floor blocked                         103 -> 68
    identities                          1,150 -> 1,090

Two constants, two types, each flippable alone and each mutation-proved by name. KEY is still
computed into the manifest as the lower bound for both.

⚠️ **PROVISIONAL.** n is small (13 gradeable clusters) and the lens over-merges by design. The
**42** ungradeable pairs in `data/wisdom/identity-study/lens-principle-pairs.jsonl` are the
confirmation. **If any is an over-merge, `PRINCIPLE_IDENTITY = "KEY"` restores 31 — one line.**

⚰️ **The fixture lesson, twice more.** My first merge pair scored **0.400** — below the 0.6
threshold — so the test failed honestly. My first POLARITY pair scored **0.500**, also below
threshold: it would not have merged whether the guard existed or not, and that test would have
passed forever proving nothing. Both pairs are now chosen by measurement (0.800; exactly 0.600
with a conflict), and removing the polarity guard now reds a test by name.

## Step 5 — budget

**R37 applied.** `cap_usd` 40.0 → 100.0, written with the gate's OWN writer
(`extract_common.write_json`). ⚠️ My first attempt used a hand-rolled `json.dumps` and the file came
back **245 bytes shorter** — same data, reformatted. A ledger whose shape drifts makes its next diff
unreadable, so it was rewritten through the one writer that owns the format: **+1 byte exactly.**

| at $0.058671/segment, headroom $68.5185 | cost | fits |
|---|---|---|
| N=5 for the gate set (2 × 83) | $9.74 | ✅ |
| the n=250 sample | $14.67 | ✅ |
| one EXTRACT day at 400/day | $23.47 | ✅ |
| the 9,733-segment catalog, one pass | $571.04 | ❌ (never the intent) |

⚠️ **R48 (ledger token fields) was NOT done.** It is ruled YES and it is the one ruling this
session did not deliver. The scout mapped the write sites, but the session's remaining effort went
to the clock rail, the retraction and the lens — all of which the branch needs before a merge, and
R48 affects only future gate runs. **It is carried as Q-5.**

## Step 6 — R8: the INGEST-only plan, REHEARSED

Run in a **child process** against a throwaway store with census pins, so capture could not reach
any live product data. Session env `WISDOM_INGEST_ENABLED=<UNSET>` before and after, printed both
times.

**Dark:** the job is skipped before `run_chain` — every table 0 rows except **one heartbeat**.

**INGEST alone:** 8 steps ok, 4 skipped. `extract` **SKIPPED** (the spend gate holds),
`retrieval` **SKIPPED** so no Ask-AI index is even built, `wisdom_records` **0**. capture wrote 15
rows; `wisdom_d20_scoring_runs` 2.

⚠️ **Three things the plan now warns about**, none of which was in the brief's assumption:
1. `WISDOM_INGEST_ENABLED` alone starts capture (the chain step has no gate of its own);
2. the `level_alerts` and `lookalike` **scorers** are also ungated and ran;
3. **36 review rows appeared on the `attribution` tab** — not floor blocks, and worth knowing
   before they look like a publication problem.

## Step 7 — PR-ready

    https://github.com/unchartedterritory5995-cyber/UCT-Dashboard/compare/master...feat/wisdom-loop?expand=1

Open it on your phone; "Create pull request" is on that page. A short body is in
`docs/wisdom/PROMOTION-2026-09-15.md`, which also carries the full changelog, risks, rollback and
the rehearsed flag plan.

⚠️ **Master moved again during the session — the branch is 3 behind at report time.** The brief
allows one merge and it was used in Step 2, so this is reported rather than merged. A re-sync is
`git fetch && git merge origin/master`, **with no time condition of any kind**.

---

## 1. MUTATION-PROOF

- `git status --porcelain` **clean**; `origin/feat/wisdom-loop...HEAD` = **0 0**.
- **5 authored commits**: `ea7bb8264` (clock retired), `92615388b` (cap), `e1001e182` (retraction),
  `e044c76a8` (lens), `1b1cfc4f3` (flag plan + study pin). Each `git show --stat` reviewed.
- **Merges: exactly 1** — `e87a76e0b`, `origin/master` INTO the branch, first-parent verified.
- **Off-limits diff EMPTY on every authored commit**, checked per commit.
- **None of this session's commits is an ancestor of `origin/master`** — the verifiable claim.
  No master push, no `gh pr merge`, **no PR opened** (`gh` absent).
- **Ledger**: `b182b329…`, 5,406 bytes, `total_usd 31.4815`, 28 entries, `cap_usd 100.0`. The ONLY
  change is the ruled cap; totals and entries identical.
- **Zero flag / env / config changes.** The INGEST rehearsal ran in a **child process** against a
  temp store; the session's own `WISDOM_INGEST_ENABLED` was `<UNSET>` before and after, printed.
- No `railway`. No key printed, measured or searched for. Member data **NONE**. D16b **not read**.
- **Mutations:** clock — reintroduce a time branch → 1 red; retraction — drop the resolve branch
  → 3 red, resolve by DELETE → 2 red, drop the tab filter → 7 red; lens — remove the polarity guard
  → 1 red. Every restore byte-exact, sha256-verified.

## 2. TOTALS

| | |
|---|---|
| API calls / spend | **0 / $0.00** |
| sub-agents | 3, read-only, one wave |
| tests | **1,259 passed · 1 skipped · 0 failed** (73 files) |
| net test change | +18 new rails, −19 clock tests removed, 2 adapted |
| commits / merges / pushes | 5 authored / **1** / 6, branch only |
| rulings delivered | 8 of 9 — **R48 not done**, carried as Q-5 |
| decisions deferred | the hand-check, the per-day EXTRACT budget, R48 |

## 3. QUESTIONS FOR PATRICK

**Q-1 ⭐ load-bearing — create and merge the PR.** Open the compare URL above on your phone. There
is no window to wait for.

**Q-2 ⭐ load-bearing — the hand-check.** **42** ungradeable PRINCIPLE pairs in
`data/wisdom/identity-study/lens-principle-pairs.jsonl` (and 71 MARKET_SIGNAL pairs in
`merged-ms-pairs.jsonl`). If any PRINCIPLE pair is an over-merge, `PRINCIPLE_IDENTITY = "KEY"`
reverts it in one line.

**Q-3 — the per-day EXTRACT budget.** At $0.058671/segment with $68.52 of headroom: name a daily
ceiling and the first EXTRACT window can be scheduled. 400/day = $23.47.

**Q-4 — production's entity master.** Still UNKNOWN, almost certainly EMPTY, and it fails silently.
One signed-in load of the admin status route after promotion settles it.

**Q-5 — R48, not done.** Ledger entries still carry no token counts or `extractor_version`, so
R36's estimator uses cost-per-request. Worth a follow-up session; it changes no bill.

**Q-6 — the 10 superseded queue rows** for still-blocked records at older scores. Leave, or should
a re-block supersede the previous row?
