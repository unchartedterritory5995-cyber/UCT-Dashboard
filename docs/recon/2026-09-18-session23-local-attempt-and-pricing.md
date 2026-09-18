---
title: Session 23 — one bounded local attempt, then measured pricing of every real path
status: complete. Spend this session $0.00 (R95_PAID_PATH = HOLD, never changed).
---

**local-v2 CLEARED types: NONE (FAIL on all 6, 20-segment sample) · corpus clock at local
speed: 23.2 days N=1 / 69.6 days N=3 · GPU host: NO · cheapest goal-buying path:
SWEEP_N1_OPUS + targeted repass, $1,103 p50 / $5,096 p90 · spend this session: $0.00**

---

## Step A — the one bounded local attempt (90-minute ceiling, honored)

Two backend-level fixes shipped as permanent `local_backend.py` defaults (neither touches
`prompt.py`, neither bumps a byte the paid path reads):

1. **`repeat_penalty=1.15`** — measured on session-22's 18 looping segments (isolated
   re-check, no slot contention): 4/4 sampled stopped looping. Clean finish, valid JSON, no
   repeated span.
2. **Schema-constrained decoding**, reusing `params["output_config"]["format"]["schema"]` —
   the SAME contract Anthropic already enforces for the paid path — via llama-server's OAI-
   compat `response_format: json_schema`. Isolated test: a segment whose baseline run
   rejected 4/4 emitted records `quote_missing` produced 3/3 with a non-empty quote under
   the constraint.

A local-only prompt variant (`api/services/wisdom/extract/local_prompt_v2.py`, its own
`wx-local-v2-*` extractor_version, never imported by the paid path) added on top: `quote`
moved first in the RECORD-level schema (a first version of this reorder operated on the
wrong nesting level and silently did nothing — caught before shipping, with a rail asserting
the correct path and a control proving the input was genuinely not already quote-first), an
explicit verbatim-copy-or-omit instruction appended after the shared rules, and two few-shot
exemplars loaded at runtime from a gitignored data file (`data/wisdom/local-prompt-v2-
fewshot.json`, drawn from golden's TEST split — there is no TRAIN split, `SPLITS =
("dev","test")` — kept disjoint from the DEV segments the sample scores).

**Result, 20-segment stratified sample** (every type with golden labels represented, seeded;
paid gate-run-3 and session-22's v1 sliced to the IDENTICAL segments via
`gate_records.load_phase`, the R12 canonical re-score path — no second scorer, no second
authority):

| type | paid P/R | v1 P/R | v2 P/R |
|---|---|---|---|
| CALL | 0.8889 / 0.8889 | — / 0.0000 | — / 0.0000 |
| LEVEL | 1.0000 / 0.6667 | — / 0.0000 | 0.0000 / 0.0000 |
| MARKET_SIGNAL | 0.5000 / 1.0000 | — / 0.0000 | — / 0.0000 |
| MENTION | 0.2000 / 1.0000 | 0.0000 / 0.0000 | — / 0.0000 |
| NEGATIVE_CALL | 0.6667 / 0.6667 | — / 0.0000 | — / 0.0000 |
| PRINCIPLE | 1.0000 / 1.0000 | — / 0.0000 | 0.0000 / 0.0000 |

**FAIL on R85_CLEAR_RULE, all six types, both local versions.** Full record:
`docs/wisdom/LOCAL-EXTRACTOR-VERDICT.md`.

**The mechanism moved, even though the topline did not.** v2's rejection tally on its 15
completed segments (5 of 20 timed out at 480s — the few-shot turns lengthen the prompt, and
this was not chased further inside the ceiling): `reject:quote_missing` **zero** (was the
dominant v1 failure); `reject:quote_absent` **24** (new dominant failure — present, not
verbatim); 5 records genuinely validated (real quote, real text match) but none matched
golden's *specific* expected item on this sample.

**Throughput, measured**: v1's real session checkpoints (13 segments done at ~2.9 min
elapsed, 82 at ~90 min) give **0.79 segments/min (76s/segment)** under real box contention.
26,454-segment corpus: **23.2 days at N=1, 69.6 days at N=3**. v2's combined levers measured
SLOWER per segment (longer prefill from the few-shot turns) — not a faster path.

**Two harness bugs found and fixed mid-step, recorded because both would have produced a
confidently wrong number if missed:** the sample-run script never set
`WISDOM_LOCAL_LLM_URL`, so it silently defaulted to port 8080 (nothing listening) while the
real server was on 8125 — 20/20 "errored" in 10 seconds on two consecutive attempts before
the missing env var was found; and the resumable-batch's "done" check counts an *errored*
row as done, so retrying the same batch after a fix requires stripping the errored rows
first, or nothing re-runs.

## Step B — R94, GPU search (measured, not assumed)

- **This box**: two NVIDIA GT 710s, 2GB VRAM each (`nvidia-smi` confirmed) — too small to
  hold even a Q4_K_M 7B model's ~4.5GB of weights. An Intel UHD 770 iGPU is present and
  untested (no dedicated VRAM; unlikely to meaningfully beat CPU for this workload, and
  standing up a Vulkan backend for it was out of scope given the answer was already clear
  from the NVIDIA cards alone).
- **WSL2**: not installed (`wsl --status` reports so).
- **Documented remote host**: none. `~/.ssh/config` does not exist; `known_hosts` carries
  only `github.com`. A repo grep for GPU/remote-host references found two false positives
  (both about browser-rendering GPU contention in Playwright tests, unrelated to inference).
- **Deliberately not done**: any LAN scan or port sweep. The ruling asked for
  documented/reachable enumeration only, explicitly warning against indiscriminate probing.

**Conclusion: no GPU host reachable at $0.** Step B's own conditional (B2, run the sample on
a GPU host if one exists) does not apply.

## Step C — R96, pricing every real path (measured, with a blocker stated)

**Blocker, stated rather than routed around**: no Anthropic API key was reachable this
session — not in the shell environment, not in a local `.env` (none exists), not in the OS
keyring service `uct-wisdom`/`anthropic` (`batch.key_from_keyring()` returned `None`). The
one paid-API call this session's ruling permitted (`count_tokens`) could therefore not be
made. **Zero count_tokens calls were made** — not silently skipped, genuinely blocked by a
missing credential.

**What was used instead**: REAL, already-paid-for Anthropic usage persisted from gate-run-3
itself (`data/wisdom/gate-runs/20260915T123550Z/segments.jsonl` — the directory's own
`eval_run_id` matches gate-run-3's `run_id`, `93a248c91ddef458f1168277`, confirmed by direct
comparison). 83 real production-sourced segments, each carrying `usage.input_tokens`,
`usage.cache_read_input_tokens`, `usage.output_tokens` from the actual API responses. This
is a real measurement, not an estimate — and it is a genuinely different number from the
brief's own stated approximation (output p50/p90 5,772/10,898): the measured figures here
are p50 2,097 / p90 10,376 output tokens, p50 6,840 / p90 7,718 total input (dominated by a
near-constant ~6,504-token cache read — the system prompt is cached). The discrepancy is
noted rather than silently reconciled to either number.

**It is not the fresh 500-segment production sample R96 specified** — that would need
`count_tokens` (blocked) or a character-based estimate (available but weaker than reusing
real measured usage). This gap should close before treating the pricing table as final.

**Prices**: Opus 5 $5/$25 per Mtok, Sonnet 5 $2/$10 (`api/services/wisdom/extract/
budget.py:PRICES_PER_MTOK`); Haiku 4.5 $1/$5 (`api/services/catalyst/cost_guard.py` —
budget.py carries no Haiku entry). Batch 0.5×, cache read 0.1× input, per
`budget.py:BATCH_DISCOUNT`/`CACHE_READ_MULT`.

**Density proxy**: 18/83 dev segments (21.7%) carry a PRINCIPLE or MARKET_SIGNAL golden
record — the only measured proxy, since night 1 never ran (stated explicitly per the brief's
own caution, not treated as a real corpus-wide density).

Full table: `docs/wisdom/PATH-PRICING-2026-09-18.md`. Summary:

| path | $ p50 | $ p90 | delivers |
|---|---|---|---|
| LOCAL | $0 | $0 | nothing clears |
| HAIKU_ONLY N=3 | $462 | $2,133 | all 6 types, quality unmeasured |
| TIERED_HAIKU_OPUS | $962 | $4,445 | mechanical@Haiku, judgement@Opus, Haiku quality untested |
| SWEEP_N1_OPUS + repass | $1,103 | $5,096 | all 6 types at Opus quality |
| SWEEP_N1_OPUS alone | $769 | $3,554 | all 6 once, judgement PENDING |
| LOCAL mech. + Opus judgement | n/a | n/a | NOT ACTIONABLE — local cleared zero types |

**Settling measurement**: an 83-segment Haiku golden run, $0.48–$2.23 — close enough to free
that it should run before any Haiku-tiered path is trusted.

## Step D — R95 = HOLD

One line, as the ruling requires: **nothing spent, nothing armed.** No messages/batches call
was made against a paid client this session (verified structurally — the local backend
never imports `anthropic`, per its own test suite, and Step C's pricing came from a file
read, not an API call).

## Step E — mutation-proof checklist

- **No messages/batches call while HOLD**: confirmed. Step A used only the local backend
  (structurally cannot reach the paid SDK — proven by `test_the_local_client_is_built_
  without_importing_the_paid_sdk`). Step C made zero API calls of any kind (file reads
  only). A scratchpad grep for `messages.create`/`batches.create` also matched two files
  dated **before** this session (`dsi.orig.py`, Sep 13; `rt8124.py`, Sep 17) — leftover from
  earlier, unrelated work, not executed under this session's R95 ruling, not audited further
  as out of scope for what this checklist governs.
- **count_tokens calls counted**: zero. Blocked by a missing API key (see Step C).
- **prompt.py hash unchanged**: `prompt.extractor_version()` still returns `wx-v0-fc47bc97`,
  reasserted by both the pre-existing local-backend suite and `local_prompt_v2`'s own tests.
- **Production writes**: NONE. Railway access this session was `railway whoami` only
  (confirms auth) and reads of already-persisted local artifacts; no write endpoint was
  called.
- **Doors**: False (R63_MEMBER_DOORS: ALL_DARK) — untouched this session.
- **No C:\data**: all work ran through the census-sandboxed scratchpad path
  (`conftest.shared_data_root_census()`, 77 pins applied, 0 unpinnable, verified each launch).
- **Corpus text never in the repo**: `local_prompt_v2.py` (tracked) contains no corpus
  text — few-shot content loads from `data/wisdom/local-prompt-v2-fewshot.json`, verified
  gitignored (`git check-ignore`, also a standing test). `git ls-files data/wisdom/` returns
  0 tracked files.
- **Member data**: NONE touched.
- **D16b**: not read.
- **Every command**: run via Bash/PowerShell tool calls in this session's own transcript,
  each with output inspected before the next step — no step assumed a prior command's
  success without checking its output.

## Commits this session

`2151f5fc4` fence unwrap · `459920c84` + `cc22104b7` resumable batch id (the second a fix to
the first, found within one run) · `85360bcb5` runaway cap · `93e86db12` repeat_penalty +
schema-constrained decoding · `cfdd483fc` local-only v2 prompt + verdict doc. All on
`feat/wisdom-loop`, tree clean at every checkpoint.
