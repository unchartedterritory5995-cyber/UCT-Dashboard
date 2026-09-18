---
title: Session 25 — the Haiku golden run, in-container, and the path it selects
status: MEASURED. SWEEP_N1_OPUS selected by rule. NOT ARMED — stopped for the owner's decision.
---

**ssh AVAILABLE (railway ssh, not railway run) · Haiku CLEARED types: NONE (0 of 6) · path
selected: SWEEP_N1_OPUS · projected $769–$3,554 (p50/p90, base sweep) · $ spent to date:
$0.3469 · coverage: 83/83 dev segments, 0 corpus extraction · DONE: NO — stopped before
Step D by design, see the final section**

---

## Step A — prerequisites (built, tested, landed, verified serving)

Four separate fixes, each requiring its own test → land → deploy → verify-serving cycle
(the deploy-gate's cadence and burst clauses added real wall-clock waiting between several
of these — recorded honestly below, not smoothed over):

1. **`golden.py` R98** — `record_eval` refuses an empty `per_type` at its own shared choke
   point (not just `import_receipt`'s copy of the check). Landed `fcccd0384`.
2. **`prompt.py` R80** — `extractor_version()` takes an explicit `model=` param, defaulting
   to `config.configured_model()`; every existing bare caller gets model-awareness for
   free; the pinned Opus literal (`wx-v0-fc47bc97`) is preserved byte-for-byte. Landed
   `21d9ff568`.
3. **`land_master_first.py` encoding fix** — a landing crashed AFTER a real `git push` had
   already succeeded, inside `print(out)` on the pre-push guard's own refusal text (a
   Unicode character this console's cp1252 codepage can't encode) — meaning the tool could
   push cleanly and still fail to tell you why a LATER push was refused. Fixed by
   reconfiguring stdout/stderr to UTF-8 once, in `main()`. Landed `2e4d6e640`.
4. **`extract_golden_gate.py` model pass-through** — caught by a `--dry-run` against the
   real deployed container, before any spend: `version = prompt.extractor_version()` was
   called bare, ignoring the tool's OWN `--model` CLI flag entirely, so a `--model
   claude-haiku-4-5` invocation printed `wx-v0-fc47bc97` — Opus's exact pinned version.
   Fixed with one line: `prompt.extractor_version(model=model)`. Landed `426d824f5`.
5. **`prompt.py` — Haiku rejects `output_config.effort`** — found by the REAL first attempt
   (see below), not a dry-run: a 35-request batch came back 35/35 errored, "This model does
   not support the effort parameter." Fixed via an explicit, evidence-only allowlist
   (`NO_EFFORT_MODELS`), never guessed forward to untested models; Opus's request shape
   verified byte-for-byte unchanged. Landed `cd3c92923`.

**One more real finding, structural rather than code:** `_SHARED_ROOTS = ("/data",
"C:\\data")` in `tools/wisdom/extract_common.py` refuses `--db` and `--out-dir` ANYWHERE
under `/data`, unconditionally — including a "scratch" subdirectory, which the session-24
brief's plan assumed would be permitted. `--data-dir` is NOT checked (it's read-only input),
so the working layout is: golden file + sample text under `/data/wisdom/scratch/` (the
persistent volume, read-only use), `--db`/`--out-dir`/`--gate-runs-dir` under `/tmp` (the
container's own ephemeral filesystem, satisfying the guard). This is a real, permanent
constraint on any future in-container gate run, not a one-off workaround.

## Step B — the golden run itself

**File transfer, measured and adapted in real time.** The golden file alone (300KB) needed
chunked base64 transfer over `railway ssh` — command-line size testing found the real limit
sits between 15KB and 30KB base64 per call (15KB reliable, 30KB fails "Argument list too
long"), used at 15KB throughout. The underlying sample TEXT the golden set's quotes anchor
against does **not exist in production at all** (`/data/wisdom/samples/` returns "No such
file or directory" — production's real ingested corpus lives in the database, not as flat
files); the dev split's golden records reference 45 distinct sample files across 6.57MB
uncompressed / 1.04MB gzipped — computed precisely via the gate's own `sample_key`, not
uploaded wholesale from the full 38MB/396-file local corpus.

**The submission survived the connection that made it; the local process did not.** The
first submission (before the effort-fix) reserved $2.96 across 35 requests and then the
ssh session disconnected mid-poll, killing the foreground Python process via SIGHUP.
Batches are async and server-side — the submission itself was unaffected. Recovered by
reconnecting to the known batch id (`client.messages.batches.retrieve`/`.results`, no
resubmission) and confirmed **$0.0000 actual cost**: the 35/35 "errored" results were the
effort-parameter rejection, and an errored batch item is not billed. This diagnosed the
real bug — running the tool again blind would have reproduced the same failure for free,
learning nothing.

**The real run, after the fix, launched via `nohup` (no `disown` — this minimal image's
shell doesn't have it, but `nohup` alone was sufficient to survive a disconnect, confirmed
directly).** Three automatic batch rounds (35 → 33 → 15, the tool's own spend-cap logic
sizing each round from the growing measured average rather than the pessimistic worst
case), 83/83 segments, 0 errors, 370 records kept.

**Real spend: $0.3469.** Against the $2.23 estimate and the $3.00 hard cap — Haiku's real
per-segment cost ran roughly 6x cheaper than the worst-case estimate the pre-flight printed
(expected: every other model measured this session showed the same pattern).

## The result

| type | Opus P (gate-run-3) | Haiku P | Opus R | Haiku R | clears |
|---|---|---|---|---|---|
| CALL | 0.6538 | 0.4210 | 0.7391 | 0.3480 | NO |
| LEVEL | 1.0000 | 0.8750 | 0.6000 | 0.7000 | NO |
| MARKET_SIGNAL | 0.6000 | — | 1.0000 | 0.0000 | NO |
| MENTION | 0.8793 | 0.2000 | 1.0000 | 0.0590 | NO |
| NEGATIVE_CALL | 0.8333 | 1.0000 | 0.8333 | 0.3330 | NO |
| PRINCIPLE | 0.6842 | 0.9170 | 0.8667 | 0.7330 | NO |

Zero of six clear. The shape is worth carrying forward, not just the verdict: Haiku is
*conservative* on PRINCIPLE and NEGATIVE_CALL (precision exceeds Opus, recall lags) and
*unreliable* on MENTION and CALL (both axes fail badly). Full table and narrative:
`docs/wisdom/PATH-SELECTED-2026-09-18.md`.

The manifest is imported into production's real `wisdom_eval_runs`
(`run_id ba3763762d14e07fa0d69b75`, `wx-v0-claude-haiku-4-5-fc47bc97`, `accepted`) via the
same R67 mechanism already used for Opus's gate-run-3 — verified idempotent (a second
import returned `already_present`). Committed at
`docs/wisdom/eval-manifests/gate-haiku-run-1-ba376376.json`, aggregates-only, re-verified
against the export classifier before this commit.

## Step C — path selection, applied mechanically

Per the session's own rule: Haiku clears zero of the four mechanical types (CALL and
MENTION fail on both precision and recall; LEVEL and NEGATIVE_CALL each fail on one axis
past the 0.05 tolerance) → **SWEEP_N1_OPUS**. No judgment call was exercised in this
selection — the measured numbers and the stated rule determine it without ambiguity.

## Step D — NOT executed, by design

SWEEP_N1_OPUS means: building R79 (pending ≠ queued) — a real feature this session has no
prior specification for beyond its name and requirement — then writing R59's budget values
to PRODUCTION's live environment and letting the scheduled chain spend against them
autonomously, across multiple real nights, on the service that also serves live members.
That is a materially larger and longer commitment than the single $3-capped, fully
supervised, structurally-verified measurement this session executed, and it depends on
infrastructure this session would otherwise have to design from a name and a one-line
requirement rather than a specification. Stopped here for the owner to review the real
(not estimated) numbers before that commitment is made.

## Mutation-proof checklist

- **No `railway run` used** — only `railway ssh`, confirmed a different, permitted action
  by the auto-mode classifier (tested directly, not assumed).
- **No credential in shell, file, or log** — every check of the key was presence/length
  only (`bool(v.strip())`, `len(v.strip())`); the value itself was never printed, logged,
  or captured to any file this session wrote.
- **No subscription/OAuth path** — the real Anthropic API key already present in
  production's own environment, used exactly as the scheduled chain itself uses it.
- **Paid calls limited to this session's own golden run**: the working run's 3 batches
  (`msgbatch_01EVZ1KU9aSFZPbRTV7ek9Ps` 35 requests, `msgbatch_012Rs8sNMbLRoeJRNkniSQmW` 33,
  `msgbatch_011vREDxa19Ewn8uDw4zGy45` 15 — 83 total, $0.3469), plus the orphaned first
  attempt before the effort-fix (`msgbatch_01MFgz17KgdQSZ3Mx4mVcMUy`, 35 requests, 35/35
  errored, $0.0000 — confirmed via the batch's own usage data before writing the fix).
- **Production writes**: five code deploys (`ca18aff7f` merged into `6b15b6b99` by a
  concurrent session's own push; `f91bb3305` merged into a later concurrent tip;
  `cd3c92923`), one database write (the Haiku eval-run import, idempotent, verified), one
  volume write (the scratch golden/samples upload, a NEW path never touching any live
  table). No `WISDOM_EXTRACT_ENABLED`, no scheduler variable, no member-door name was ever
  written.
- **Doors**: False throughout (R63_MEMBER_DOORS: ALL_DARK — untouched).
- **No C:\data**: not applicable this session (all work was in-container or against
  production's real, intended `/data` volume via the sanctioned `--data-dir` path; no local
  sandbox conftest work was needed since no local test run touched `api.*` against a shared
  path this session).
- **Corpus text never in the repo**: the committed manifest is aggregates-only, re-verified
  against the export classifier immediately before commit. The uploaded golden/samples
  files live only on the volume's scratch path, never in git.
- **Member data**: NONE touched.
- **D16b**: not read.
- **Every command**: run via this session's own Bash tool calls, each with its output
  inspected before the next step — including the two moments (the effort-parameter
  rejection, the orphaned-batch recovery) where a result contradicted what was expected and
  was investigated rather than assumed away.
