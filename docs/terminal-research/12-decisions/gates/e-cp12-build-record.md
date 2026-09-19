---
id: e-cp12-build-record
unit: E CP12
packet: packet-e-ci-gap-gate
merges-after: E CP11
status: SIGNED (E CP12, fingerprint 9f0ba6cdc)
---

# E CP12 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  9f0ba6cdc
SCOPE APPROVED:   CP12 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP12 — the publisher died on a missing display field, four runs running.** Scope is
> `tools/ci_record.py` (new), `tools/ci_aggregate.py` and
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of
> `8ed462844`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP11**; manifest rows are **CP2, CP4–CP11** (23 rows total).
**CP12 free.**

---

## 1 · ⛔⛔ THE FAILING STEP WAS NAMED IN THE API ALL ALONG — I PUBLISHED THAT IT WAS NOT

**RETRACTION, first, because everything below follows from it.** E CP11's build record, the
session-3 report and my message to the owner all said:

> *"The log endpoint returns **403** and the `jobs` API returns an **empty `steps` array**, so
> the failing step is **UNREADABLE**."*

**That is false.** One `curl` against the public `jobs` endpoint returns the step list for
every one of these runs, with the failing step named:

| run | publish | steps returned | failing step |
|---|---|---|---|
| #6 | failure, 61 s | **14** | **`Build the record`** |
| #8 | failure, 22 s | **16** | **`Build the record`** |
| #9 | failure, 19 s | **17** | **`Build the record`** |

⭐⭐ **Three runs were spent building instruments to make a thing legible that the runner was
already reporting by name.** I wrote UNREADABLE from one bad read and then reasoned from my
own conclusion for three checkpoints. ⛔ **An UNREADABLE is a measurement, and a measurement
gets re-taken before it is built upon** — especially one that licenses building rather than
fixing.

## 2 · The defect, and it is the same one every time

```python
"runner_line": {"vitest": v["runner_line"], "pytest": p["runner_line"]}
KeyError: 'runner_line'
```

`ci_summarize.py` emits `runner_line`. **`ci_aggregate.py` — which replaced it for pytest in
E CP6 — did not.** The arithmetic closes exactly:

| | pytest summary from | publish |
|---|---|---|
| run #3 (`b70a874ed`) | `ci_summarize.py` — **has** `runner_line` | ✅ **succeeded, record published** |
| `0d7c55fb1` = **E CP6** | swapped to `ci_aggregate.py` — **no** `runner_line` | — |
| runs #6, #8, #9 | `ci_aggregate.py` | ❌ **failed at `Build the record`** |

⛔⛔ **The change that sharded the suite is the change that stopped the record from ever
landing** — and the field it died on is a cosmetic one-line string that no verdict depends on.

### Reproduced, not inferred

Run #9's own step body, extracted **verbatim** from the workflow file, against inputs produced
by the real tools:

```
OLD aggregator  ->  KeyError: 'runner_line'   exit 1
NEW aggregator  ->  record.json written        exit 0   (same body, unchanged)
```

## 3 · Two fixes, because either alone leaves the failure live

**(1) The producer emits the key.** `ci_aggregate` now collects each shard's **own** totals
line — `shard_runner_lines` per shard, `runner_line` their join. ⛔ Verbatim, never
re-derived: the suite's line is the shards' own words, and a shard that printed none is simply
absent from the map (its absence is already reported by `shards_without_totals`, so nothing
restates it).

**(2) A missing key can no longer cost the record.** The builder leaves the YAML heredoc and
becomes **`tools/ci_record.py`**. Every value it reads out of a suite summary goes through
`consume()`, which on an absence **NAMES the gap** in `record["contract_gaps"]` and marks the
field `UNREADABLE:` instead of raising.

⛔ **That is not tolerance.** The gap is in the published record AND in the phone summary
under its own heading. What it refuses is a *display string* destroying the measurement it
decorates — which is F-CI-7 exactly. And the failure direction is still closed: `ok` is
consumed the same way, so a missing `ok` is not `True` and the verdict falls to **RED**.

## 4 · ⚰️ AND IT WAS A 50-LINE PYTHON PROGRAM INSIDE A YAML STRING

Nothing could run it, so nothing did. The KeyError is reachable from an empty vitest log and a
one-shard aggregate — a second of local execution, in four runs of real CI that never got a
line of it under test.

⭐ **The self-check builds its inputs with the REAL tools**, not hand-written fixtures: the
defect lived in the *gap between two producers*, and a fixture written by hand would have
carried whatever keys I believed were there — reproducing my own blind spot.

## 5 · The self-check, and both directions of the mutation

```
ci_aggregate emits 'runner_line'                                  -> True   ok
intact: no contract gaps                                          -> []     ok
intact: pytest runner_line is the SHARD's own line                -> ====   ok
missing runner_line: builder does NOT raise                       -> False  ok
missing runner_line: gap is NAMED / field UNREADABLE              -> 1 True ok
missing runner_line: record still publishable (verdict unchanged) -> GREEN  ok
missing ok: verdict falls to RED / gap is NAMED                   -> RED 1  ok
gaps distinguish intact from mutated                              -> True   ok
```

**Mutation-proved against the producer, both directions:**

```
BEFORE mutation      : exit 0
PRODUCER KEY RENAMED : exit 1   (3 assertions red, named)
AFTER restore-by-edit: exit 0   bytes identical: True   (sha256 verified)
```

⛔ **Restored by EDIT, never `git checkout`** — and the bytes were captured and hashed BEFORE
the write, because `open(path, "w")` truncates before anything you write can fail.

## 6 · ⛔ THE SELF-CHECK IS IN ITS OWN STEP, AND IT CANNOT KILL PUBLISH

Running `--self-check` inside `Build the record` would have re-committed the failure this
workflow already warns about above `Fetch this run's job outcomes`: **a verification line must
never destroy the thing it verifies.** It is a separate step with `continue-on-error: true`,
so a red self-check is visible on the job page and the record still publishes.
`continue-on-error` rewrites `conclusion`; the truth stays in that step's `outcome`.

## 7 · Files

```
tools/ci_record.py                        (new — the record builder, runnable, self-checking)
tools/ci_aggregate.py                     (emits runner_line + shard_runner_lines, verbatim)
.github/workflows/full-suite-report.yml   (heredoc -> file; self-check step; gaps in the summary)
```

## 8 · Validators

```
yaml.safe_load             -> OK, 9 named publish steps, skeleton still at position 3
check_workflow_expressions -> exit 0, 20 expressions, every call in the documented set
check_repo_hygiene         -> clean, 9,556 tracked files, no line-ending flip
actionlint                 -> UNREADABLE-TOOL (not installed)
ci_summarize / ci_outcome / ci_aggregate / ci_record / pytest_shards --self-check -> all exit 0
```

## 9 · ⚠️ PREDICTION for run #10 — written before pushing

| field | prediction |
|---|---|
| `publish` job result | **success** — and this one is a claim about a cause I have read, reproduced and fixed, not a guess |
| a record appears at `results/<run_id>/summary.json` on `ci-results` | **yes** — the first since run #4 |
| `contract_gaps` | `[]` |
| `runner_line.pytest` | the twelve shards' own totals lines, joined |
| `shards_without_totals` | `[]` — **condition (b)** |
| shards | 12 of 12 succeed, as in runs #6, #8 and #9 |

⚠️ **What would falsify it:** publish failing at a step OTHER than `Build the record`. That
would mean the KeyError was one of two causes, not the cause — and the step list now names
whichever it is, which is the part I should have been reading all along.

## 10 · Drafted ledger row — NOT written

| 90 | `8ed462844` | 2026-09-15 | CI | 1 | E CP12: `publish` failed at `Build the record` in runs #6/#8/#9 with `KeyError: 'runner_line'` — `ci_aggregate` (E CP6) never emitted the key `ci_summarize` did, so the change that sharded the suite is the change that stopped the record landing. Producer now emits it verbatim from the shards; the builder left the YAML heredoc for `tools/ci_record.py`, where a missing key is NAMED in `contract_gaps` instead of killing publish. |

## 11 · Drafted RESUME delta — NOT applied

- ⛔ **Re-take an UNREADABLE before building on it.** Three checkpoints of instrumentation
  were spent on a step the `jobs` API had been naming all along.
- ⛔ **A program inside a YAML string is a program nobody can run.** Put it in a file.
- ⛔ A producer/consumer key contract needs a rail that runs the REAL producers — a fixture
  carries the keys you believe in.
- ⛔ `open(path, "w")` truncates before your write can fail: capture and hash first.
