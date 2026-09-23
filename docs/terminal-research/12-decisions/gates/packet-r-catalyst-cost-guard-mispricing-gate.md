---
id: PACKET-R
title: RG-12 — the catalyst cost-guard never received the 2026-08-30 Sonnet 5 price fix — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET R — one stale price constant, fixed once already in its sibling

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs
> `api/services/catalyst/cost_guard.py`'s pricing table. **Non-collision:** `PACKET-R`
> appears nowhere in either worktree — grepped `docs/terminal-research/12-decisions/gates/*.md`
> (18 letters taken: A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,T,V), the root `.scopes/` directory
> (same 18 stems, no `packet-r-*`), and every `PACKET-` string anywhere in the
> `s7-price-level` worktree (only the same 18, inside `COMPLETION_AUDIT.md`) — the same way
> `PACKET-F` checked against `PACKET-E`/`PACKET-T` before it.

⛔ **ONE STALE NUMERIC CONSTANT, CORRECTED TO MATCH A FIX THAT ALREADY SHIPPED IN A SIBLING
MODULE.** No new endpoint, no schema change, no behavior beyond correcting what one Anthropic
model costs per token in one guard's pricing table (plus the two test assertions that pin the
old, wrong number).

---

## 1 · The finding (RG-12, `RESEARCH_GAPS.md` row 17), verified against CURRENT source

**RG-12, as filed 2026-08-09:** *"Production cost-guard defect: five LLM price tables with one
rail; `api/services/catalyst/cost_guard.py:33` still prices Sonnet 5 at the old rate after the
2026-08-30 fix landed only in `narrative_cost_guard`. Under-pricing loosens the daily cap."*

**Re-read today, 2026-09-22, against `feat/s7-price-level` (current with `origin/master`):
the core finding still holds byte-for-byte. Its stated risk direction does not — see §1c.**

### 1a · `api/services/catalyst/cost_guard.py` — still carries the pre-2026-08-30 rate

Current file content, verbatim:

```
1:  """Tracks daily spend, enforces soft + hard caps.
2:
3:  Anthropic pricing (USD per million tokens, 2026):
4:    claude-opus-5:     $5.00  input, $25.00 output
5:    claude-opus-4-8:   $5.00  input, $25.00 output
6:    claude-opus-4-7:   $5.00  input, $25.00 output
7:    claude-sonnet-5:   $3.00  input, $15.00 output
8:    claude-sonnet-4-6: $3.00  input, $15.00 output
9:    claude-haiku-4-5:  $1.00  input, $5.00  output
```

```
26:  _PRICING = {
30:      "claude-opus-5":     {"input": 5.0,  "output": 25.0},
31:      "claude-opus-4-8":   {"input": 5.0,  "output": 25.0},
32:      "claude-opus-4-7":   {"input": 5.0,  "output": 25.0},
33:      "claude-sonnet-5":   {"input": 3.0,  "output": 15.0},
34:      "claude-sonnet-4-6": {"input": 3.0,  "output": 15.0},
35:      "claude-haiku-4-5":  {"input": 1.0,  "output": 5.0},
36:  }
```

**Line 33 prices `claude-sonnet-5` identically to `claude-sonnet-4-6` (line 34)** —
$3.00/$15.00 per million input/output tokens — exactly the collision RG-12 named, and the module's
own header docstring (line 7) repeats the same stale figure.

### 1b · `api/services/narrative_cost_guard.py` — the sibling's corrected rate, shipped 2026-08-30

```
57:  # $ per million tokens. ⛔ Published rates — `tests/test_narrative_cost_guard_prices.py`
58:  # pins them. `claude-sonnet-5` sat at (3.0, 15.0) — Sonnet 4.6's rate — until
59:  # 2026-08-30, so EVERY lane on Sonnet 5 over-reported spend by 50%: caps fired
60:  # early and the admin spend figure was wrong in the direction nobody
61:  # investigates. `claude-opus-5` was absent and priced correctly only by
62:  # ACCIDENT (an unknown model falls back to the priciest known rate, which
63:  # happened to equal Opus's) — the COT narrative lane defaults to it.
64:  _PRICES = {
65:      "claude-opus-5": (5.0, 25.0),
66:      "claude-opus-4-8": (5.0, 25.0),
67:      "claude-opus-4-7": (5.0, 25.0),
68:      "claude-sonnet-5": (2.0, 10.0),
69:      "claude-sonnet-4-6": (3.0, 15.0),
70:      "claude-haiku-4-5": (1.0, 5.0),
71:  }
```

**Line 68 is the corrected value: $2.00 input / $10.00 output** — cheaper than Sonnet 4.6, not
equal to it. `tests/test_narrative_cost_guard_prices.py:3-4,19` independently corroborates the
same number from the commit that fixed it: *"claude-sonnet-5` was priced at (3.0, 15.0) — Sonnet
4.6's rate. Sonnet 5 is $2/$10."* — a second, independently-written source agreeing on the real
rate, not a restatement of the same claim.

`api/services/catalyst/cost_guard.py` was never touched by that fix. Its `_PRICING["claude-sonnet-5"]`
is byte-identical to what `narrative_cost_guard.py` carried **before** 2026-08-30.

### 1c · ⚰️ RG-12's stated risk direction is backwards — this said "under-pricing loosens the
daily cap"; the arithmetic says the opposite

$3.00/$15.00 is **higher** than the corrected $2.00/$10.00, not lower. A rate that is too high
**over-prices** every Sonnet 5 call by 50% — exactly the "over-reported spend by 50%: caps fired
early" defect `narrative_cost_guard.py`'s own comment names for what this rate used to do there.
Carried into `catalyst/cost_guard.py`'s `may_synthesize()`/`may_member_spend()` gates (both of
which read `store.cost_stats_for_date()`, which sums costs `record()` computed via this exact
table), the practical effect is that Sonnet-5-priced catalyst lanes are charged 1.5x their real
cost, which makes the $8.00 soft cap and $15.00 hard cap (`CATALYST_COST_CAP_DAILY` /
`CATALYST_COST_HARD_CAP`) trip **earlier** in the day than the true dollar spend justifies — the
opposite of "loosens the daily cap." The underlying code defect (the sibling guards have drifted
apart) is exactly as RG-12 described; the practical consequence RG-12 attached to it does not
hold and should be corrected in `RESEARCH_GAPS.md` alongside closing this row.

### 1d · Not dead code — three catalyst lanes default to `claude-sonnet-5` today

```
api/services/catalyst/curator.py:38:      CURATOR_MODEL = os.environ.get("CATALYST_CURATOR_MODEL", "claude-sonnet-5")
api/services/catalyst/hunter.py:197:      model = os.environ.get("CATALYST_HUNTER_LIGHT_MODEL", "claude-sonnet-5")
api/services/catalyst/rule_learner.py:42:  os.environ.get("CATALYST_CURATOR_MODEL", "claude-sonnet-5"))
```

Curator, hunter's light sweeps, and rule_learner all run on `claude-sonnet-5` by default — every
call from those three lanes is mispriced by this table today, live, on the currently deployed
`CATALYST_ENGINE_ENABLED` schedule. (The catalyst engine's main synthesis lane,
`CATALYST_OPUS_MODEL` in `synthesize.py:25`, defaults to `claude-sonnet-4-6` and is unaffected by
this fix — its rate was already correct.)

### 1e · The fix would ship red without touching the pinned tests

`tests/test_catalyst_cost_guard.py` pins the CURRENT (stale) numbers as correct, in two places:

```
66:  def test_sonnet_5_pricing_known():
67:      from api.services.catalyst import cost_guard
68:      assert cost_guard.estimate_cost("claude-sonnet-5", 1_000_000, 0) == 3.0
69:      assert cost_guard.estimate_cost("claude-sonnet-5", 0, 1_000_000) == 15.0
```

```
111: def test_cache_tokens_are_priced_not_ignored():
...
117:     # sonnet-5 input = $3/MTok in this module's table
118:     assert cost_guard.estimate_cost("claude-sonnet-5", 0, 0,
119:                                     cache_read_tokens=1_000_000) == 0.3
120:     assert cost_guard.estimate_cost("claude-sonnet-5", 0, 0,
121:                                     cache_creation_tokens=1_000_000) == 3.75
122:     # and the old positional contract is unchanged
123:     assert cost_guard.estimate_cost("claude-sonnet-5", 1_000_000, 0) == 3.0
```

Correcting only `_PRICING` without updating these four assertions turns a licensing/cost-accuracy
fix into a self-inflicted red suite. `narrative_cost_guard.py`'s own test
(`tests/test_narrative_cost_guard_prices.py:19,39`) already carries the corrected values in the
same shape — this packet's fix makes `catalyst`'s pinned numbers agree with them, nothing more.

**Verdict: RG-12's core finding STILL HOLDS, unfixed, as of 2026-09-22.** Its stated risk
direction should be corrected when this row is closed (§1c).

---

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | `api/services/catalyst/cost_guard.py`'s `claude-sonnet-5` entry (docstring line 7 + `_PRICING` line 33) corrected from $3.00/$15.00 to $2.00/$10.00, matching `narrative_cost_guard.py:68`'s already-shipped, already-tested value — plus the four dependent assertions in `tests/test_catalyst_cost_guard.py` updated to the corrected arithmetic so the fix does not ship red. | none | **S** |

### MUST-BUILD, exactly

1. **`api/services/catalyst/cost_guard.py` line 7** (module docstring): change
   `  claude-sonnet-5:   $3.00  input, $15.00 output` to
   `  claude-sonnet-5:   $2.00  input, $10.00 output`.
2. **`api/services/catalyst/cost_guard.py` line 33** (`_PRICING` dict): change
   `"claude-sonnet-5":   {"input": 3.0,  "output": 15.0},` to
   `"claude-sonnet-5":   {"input": 2.0,  "output": 10.0},`.
3. **Same file, immediately above the `_PRICING` dict** (near the existing comment block at
   lines 22-25): add one dated line recording the correction and citing this packet, in the same
   style `narrative_cost_guard.py:57-63` already uses for its own history — e.g. *"Corrected
   2026-09-22 (PACKET-R): `claude-sonnet-5` sat at Sonnet 4.6's rate since before this file
   existed; `narrative_cost_guard.py` fixed the same number 2026-08-30 and this table was never
   brought in line."* This is the ONE rail against the two guards drifting apart a third time —
   the next person to touch either file sees the other's history.
4. **`tests/test_catalyst_cost_guard.py` lines 68-69** (`test_sonnet_5_pricing_known`): change
   `== 3.0` to `== 2.0` and `== 15.0` to `== 10.0`.
5. **`tests/test_catalyst_cost_guard.py` lines 117-123** (`test_cache_tokens_are_priced_not_ignored`):
   update the comment ("$3/MTok" → "$2/MTok") and its three arithmetic assertions:
   `cache_read_tokens=1_000_000` result `0.3` → `0.2` (0.1 × $2.00); `cache_creation_tokens=1_000_000`
   result `3.75` → `2.5` (1.25 × $2.00); the closing positional-contract assertion `== 3.0` → `== 2.0`.
6. Nothing else in either file changes. No other model's entry, no other function, no schema, no
   endpoint, no env var.

### Explicitly deferred, NOT authorized by this line

- **Correcting `RESEARCH_GAPS.md` row RG-12's "under-pricing loosens the daily cap" language**
  (§1c) — a docs-only edit the integrating session should make when it closes this row, not a
  product-code change this packet authorizes.
- **`api/services/journal_two/compass_cost_guard.py`** (the third cost-guard sibling named in
  RG-12's "five LLM price tables with one rail") — untouched. It runs in-memory and behind a
  per-user cap by design (`narrative_cost_guard.py:16-19`'s own docstring explains why it does
  NOT need the durable-table treatment); whether its own price table has drifted is a separate
  question this packet does not investigate or fix.
- **`CATALYST_CURATOR_MODEL` / `CATALYST_HUNTER_LIGHT_MODEL` / `CATALYST_OPUS_MODEL` defaults** —
  unchanged. This packet corrects what a model COSTS in the table, never which model a lane runs.
- **Any change to `may_synthesize` / `may_member_spend` / the $8.00 / $15.00 cap constants
  themselves** — unchanged; only the per-token price feeding their arithmetic moves.

### Risk

**Low.** A two-file, five-line numeric correction bringing one guard's pricing table into
agreement with a sibling's already-shipped, already-tested fix. The practical effect on the three
Sonnet-5-default catalyst lanes (curator, hunter light sweeps, rule_learner) is that their
per-call cost is computed 33% lower than today (correctly, matching real Anthropic billing),
which very slightly delays when `may_synthesize`/`may_member_spend` trip on a day where those
lanes dominate spend — a move toward correctness, not a new failure mode. No schema change, no
endpoint change, no change to any model selection. The four updated test assertions are pure
arithmetic follow-through on the same constant; `test_opus_5_is_priced_BY_NAME_not_by_the_fallback`
and every other existing test in the file is untouched and unaffected (none of them price
`claude-sonnet-5`).
