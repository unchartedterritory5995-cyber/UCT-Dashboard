---
id: WISDOM-SESSION-8
title: Session 8 — the key has a name, master synced short; the run is still unbought
status: complete — 2 commits, 1 merge, 3 pushes, 0 API calls, $0.00
---

# Session 8 — key plumbing, master sync, the three passes

> ## ⛔ READINESS: **BLOCKED**
>
> **Export `WISDOM_ANTHROPIC_API_KEY`** in the shell that launches Claude Code, on the machine
> Claude Code runs on.
>
> ⚠️ **A session already running will not see it** — the process environment is inherited at
> launch, so it takes a fresh session afterwards.

**$0.00 spent; the ledger is byte-identical for the fifth session running.** Steps 4, 5 and 6
could not run. Everything else did.

`feat/wisdom-loop` `757a260f6` → **`b3b3ad638`**, pushed. Scoped suite **1158 passed · 0 failed ·
2 xfailed**.

## Rulings — one line each

| ruling | outcome |
|---|---|
| **R32** WISDOM_KEY_VAR: YES | ✅ applied — `KEY_VARS`, 7 tests, 1 mutation proof |
| **R31** MERGE_MASTER: YES | ✅ merged — `3058cde1d`, **25 commits**, 0 conflicts |
| **R27** GOLDEN_SET: V1_1 | ⛔ **BLOCKED** — dry-run verified, pinned, priced; $0.00 |
| **R24** UNCONFIRMED / read NO | ⏭️ **UNMEASURED**, Q24 carried |
| **R28** UNKNOWN | ⏭️ carried, report 1's classification unchanged |
| **R8** FLAGS: HOLD | ⏭️ nothing flipped |
| **PUSH_BRANCH** | ✅ 3 pushes, branch only, master never touched |
| **AGENT_CAP: 3** | 0 sub-agents used |

---

## STEP 1 — R32, the key plumbing · `ed4a98b8b`

`batch.make_client` now reads **`WISDOM_ANTHROPIC_API_KEY`**, then `ANTHROPIC_API_KEY`, then
raises. `KEY_VARS` is the precedence — one tuple, nothing restates it.

### ⛔⛔ Why the wisdom-specific name exists, and it is not tidiness

**`ANTHROPIC_API_KEY` in the operator's shell is the variable Claude Code itself reads to
authenticate and bill.** Exporting it so the golden gate can run would change how the agent
session *launching* the gate is authenticated — a side effect nobody asked for, on the account
paying for that session. A programme that needs a credential should carry its own, under its own
name.

⛔ **The failure message names both variables and neither value.** An error that quotes a key is a
key in a log.

**Seven tests**, every fixture value obviously fake and asserted **absent from the exception text
and from captured logs on the success path as well as the failure path**. A test that checked
precedence while letting a real key reach a log would be worse than no test. Also covered: an
exported-but-**empty** wisdom var falls through rather than masking the fallback — an empty
variable is not a credential.

**Mutation proof:** swap the tuple order → **2 failed, 5 passed**, by name. Restored byte-exact.

`HARD-RULES.md` gains a dated R32 note below the marker, carrying the export instruction and the
inherited-at-launch caveat.

**Readiness, tested by construction:** `ExtractUnavailable: no API key: set
WISDOM_ANTHROPIC_API_KEY (preferred) or ANTHROPIC_API_KEY`. ⛔ The key was never printed, its
length never measured, no environment listing was produced — a client was constructed inside a
`try/except` and only the exception class and its (value-free) message were reported.

---

## STEP 2 — R31, the master sync · `3058cde1d`

**25 behind, 35 ahead. Merged, 0 conflicts.**

**Of the 25, NONE touches** `api/services/wisdom/**`, `tests/test_wisdom_*`, `tests/conftest.py`,
`core/schema.py`, any migration, **or any file under `.github/workflows/`** — so neither the
promotion gate nor the R21 xfail baseline is affected, and there was no workflow change to read.

⭐ **Kept short on purpose.** Session 6 merged **111** after letting the gap run, and the lesson
recorded then was that the risk of waiting looks low right up until it is not. Twenty-five is a
merge you can read; a hundred and eleven is a merge you hope about.

**Verified on the merged tree:** scoped suite **1158 passed · 0 failed · 2 xfailed** · migrations
idempotent (**24 both runs, no new rows, nothing raised**) · **27 GET routes** · **25 gates** (10
member-visible) · dark check `--self-check` **PASS** and `--local` **PASS (dark)**.

---

## STEP 3 — Pre-run verification

**3a — dry run, pinned to the ruled set:** `golden-v1.1.jsonl` (sha `c26c871ea5a1`), **83
segments**, 93 dev records, **26 NULL**, `extractor_version wx-v0-fc47bc97`, `claude-opus-5`,
effort high, transport **batch**, persistence **ON**, worst case **$0.42/request**,
`data/wisdom/gate-runs/` **empty**.

⛔ The `--golden-file` pin was used in the dry run too, exactly as the ruling requires — the gate
defaults to *newest present*, and the default will change again.

**3b — chain order on the merged tree:** `chain.py:68` evals → `:79` rq_v11_001 → `:85`
reconcile_stability → `:92` publication_floor. The twelve-step exact-order pin passes.

**3c** — R24 stays **UNMEASURED** (no Railway call attempted); R28 **UNKNOWN**, report 1's
classification unchanged.

**3d — pre-run baseline, 2026-09-15 04:38 ET**, the complete chain against an empty store:

```
rq_v11_001          -> emitted 0, created 0, skipped: no gate run recorded
reconcile_stability -> skipped: only 0 persisted run(s); need 3
publication_floor   -> blocked 0, enqueued 0
review queue rows: 0   wisdom_records rows: 0
```

---

## STEPS 4–6 — the passes, reconcile, the rename audit · ⛔ BLOCKED, $0.00

No key, so no pass; no pass, so nothing to reconcile and nothing for the audit to measure. **No
search of the filesystem or shell history was made** — that is explicitly out of bounds, and
§11.3 keeps secrets in the environment.

**The run, ready to buy the moment the variable exists:**

| | |
|---|---|
| ruled set | **v1.1** — 83 segments, 93 dev records, **26 NULL** |
| projection | **$18.94** · hard stop **$21.78** · headroom **$23.13** |

```
python tools/wisdom/extract_golden_gate.py \
  --db data/wisdom/extract/gate.db \
  --data-dir data/wisdom \
  --out-dir data/wisdom/extract/gate-run-3 \
  --ledger data/wisdom/extract/spend-ledger.json \
  --golden-file golden-v1.1.jsonl \
  --split dev --phases gate --max-usd 40.0
```

Three times; `reconcile_stability` then discovers them automatically.

⭐ **One purchase closes four things**: item 2's three passes, item 5's NULL false-positive
numbers, Q4's real per-segment rate, and the PRINCIPLE re-measurement **Q3 withdrew**.

---

## STEP 7 — Status and the checklist

### Wave 1.5, item by item

| item | state |
|---|---|
| 1 drift as a gate metric | **DONE** |
| 2 N-pass voting | **HALF DONE** — reconciler built, tested, wired, measured inert. Needs the passes |
| 3 publication floor | **DONE**, merged, with Q17's run-count condition |
| 4 tighter schema | **DONE** bar the deliberately deferred segmentation |
| 5 golden v1.1 NULL segments | **BUILT, UNRUN** — RQ-v11-001 now gives its numbers somewhere to land |
| 6 3-pass projection | **DONE** |

### ⚠️ The next window is TONIGHT, not Wednesday

`wisdom_daily_chain` is **cron mon-fri 18:47 ET** (`CONTRACTS.md:296`). At 04:39 ET **Tuesday**
the next fire is **Tuesday 2026-09-15 18:47 ET, ~14 hours away** — not Wednesday the 16th. The
brief said Wednesday; the cron and the clock say tonight. Recorded because a checklist pointing at
the wrong evening is worse than no checklist.

### The flag checklist

| ✓ | precondition | state, with numbers |
|---|---|---|
| ☑ | branch pushed | `origin/feat/wisdom-loop` = `b3b3ad638`, divergence `0 0` |
| ☑ | master synced | merged 25 commits at `3058cde1d`; **0 behind** at merge time |
| ☐ | `stability` populated | **0 records.** Nothing has ever been scored |
| ☐ | publish / block / enqueue counts | **unknown, and unknowable until the passes run** |
| ☐ | production gate state | **UNMEASURED** (Q24) |
| ☐ | which flag first, and why | **`WISDOM_INGEST_ENABLED`** — the master switch at `registry.py:201-202`; every job skips without it, so it goes first or nothing else matters. Then `WISDOM_CAPTURE_ENABLED` (get sources in), `WISDOM_SOURCES_INGEST_ENABLED`, and `WISDOM_EXTRACT_ENABLED` last, because it is the only one that spends |

**What the first live chain would write tonight, by count:** `wisdom_records` = **0 rows** →
**0 extracted, 0 reconciled, 0 blocked, 0 queued.**

**What you would see in the admin review queue afterwards: nothing.** ⛔⛔ That is safe, and it is
exactly the problem — **a flip tonight would prove nothing and measure nothing.** The flip is only
informative *after* records exist, and records only exist after the passes. **Buy the run first.**

---

## 1. MUTATION-PROOF

**`git status --porcelain`:** clean, 0 stray.

**Authored commits — 2, plus 1 merge:**

| SHA | branch | subject | stat |
|---|---|---|---|
| `ed4a98b8b` | wisdom-loop | feat: R32 — the gate reads WISDOM_ANTHROPIC_API_KEY first | 3 files, +140/−2 |
| `3058cde1d` | wisdom-loop | **merge** origin/master — R31, 25 commits | 0 conflicts |
| `b3b3ad638` | wisdom-loop | docs: session 8 checkpoint | 1 file |

⚠️ `git log 757a260f6..HEAD` shows more than three; the rest are **master's own commits** arriving
through the merge. Only `ed4a98b8b` and `b3b3ad638` are new writing this session, and both were
checked with `git show --name-only`: **0 off-limits files each**.

**Merges: 1** (`3058cde1d`, the session maximum). **Pushes: 3**, all branch-only, no refspec to
master, no `--force`:

| # | before | after |
|---|---|---|
| 1 | `757a260f6` | `ed4a98b8b` |
| 2 | `ed4a98b8b` | `3058cde1d` |
| 3 | `3058cde1d` | `b3b3ad638` |

**Spend ledger — byte-identical, no new entries:**
```
BEFORE  sha256 e284a42bb1356aac115ca0e97f11ecd762745fa0770df46436aca15e58c69520
        total_usd 16.872452 | cap_usd 40.0 | entries 19
AFTER   sha256 e284a42bb1356aac115ca0e97f11ecd762745fa0770df46436aca15e58c69520
        total_usd 16.872452 | cap_usd 40.0 | entries 19
```
`data/wisdom/gate-runs/` is still **empty** — independent confirmation that no pass ran.

**Zero flag / env / config / cap changes** — name-filtered diff **0** files; assignments to the
five switch names **0**. **No Railway call.**

**The key was never printed, never measured, never searched for.** Readiness came from
constructing a client in a `try/except` and reporting the exception class. No environment listing
was produced at any point.

**Member data: NONE.** No gate run, so **no transcript was read at all** this session; no
production contact of any kind. **D16b / Journal / J2: not read.** **Sub-agents: 0.**

**Commands run, by group:** ledger before/after · `git fetch` ×2 + behind/ahead · the one merge ·
`add` by path ×4, `commit` ×3, **push ×3** · scoped pytest ×2 full + ×3 per-file · one mutation
proof, sha256-verified on restore · gate `--dry-run` ×1 (no API call) · `make_client` readiness
probe ×2 · empty-store chain probe · migration idempotence probe ×1 · dark check `--self-check`
and `--local` · per-commit off-limits sweep · the cron-window calculation.

---

## 2. TOTALS

```
SESSION-8 TOTALS: ~12 files read, ~31 commands run, 0 sub-agents,
                  tests 1161 run / 1158 passed / 0 failed / 2 xfailed / 1 skipped,
                  2 commits + 1 merge, 1 merge, 3 pushes,
                  0 API calls ($0.00), 0 items NOT FOUND, 4 decisions deferred
```

---

## 3. QUESTIONS FOR PATRICK

| # | question | status |
|---|---|---|
| **27** ⭐⭐ | **THE RUN — third session blocked on the same thing, and now with a name.** Export **`WISDOM_ANTHROPIC_API_KEY`** in the shell that launches Claude Code, then start a fresh session. Everything else is done: set ruled, command pinned and dry-run verified, persistence on, chain complete and measured inert, $18.94 against $23.13 headroom. | **OPEN — the single blocker on items 2, 5, Q3 and Q4** |
| **4** ⭐⭐ | **The extraction budget.** Still no new data. Rate stands at **$0.076066/segment** from 57 segments → **$740–930** for one pass over 9,733. The v1.1 run measures it over **83 × 3 = 249** segment-passes, the first figure worth calling a rate. | **OPEN — downstream of Q27** |
| **8** ⭐⭐ | **The four flags.** ⚠️ Next window is **tonight, Tuesday 2026-09-15 18:47 ET**, not Wednesday. ⛔ A flip tonight writes **nothing** — 0 records. Order when it matters: `WISDOM_INGEST_ENABLED` first (master switch), then capture, then sources, then extract last because it is the only one that spends. | **OPEN — with a stated precondition** |
| **24** ⭐ | Production gate state — **UNMEASURED**; `RAILWAY_READ` was NO so nothing was attempted | **OPEN** |
| **28** | Report 1's quote medium — UNKNOWN, classification unchanged, stays gitignored on class B regardless | **OPEN — low stakes** |
| **31** | Merge master | ✅ **CLOSED** — 25 commits, `3058cde1d` |
| **32** | The wisdom key variable | ✅ **CLOSED** — `WISDOM_ANTHROPIC_API_KEY` |
| **30** | MARKET_SIGNAL identity | ✅ accepted provisional; audit built but **never run** — needs the passes |
| 1–3, 5–7, 9–23, 25, 26, 29 | earlier | ✅ **APPLIED / ANSWERED** |

⭐⭐ = blocks other work. ⭐ = load-bearing for one item.
