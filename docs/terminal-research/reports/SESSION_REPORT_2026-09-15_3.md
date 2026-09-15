# Session report — 2026-09-15, session 3

**RELIABLE PUBLISHING · A BROKEN WORKFLOW, MINE · A RETRACTION**

---

## 1 · ET and trees

Start **2026-09-15 08:37 EDT Tue**, end **2026-09-15 11:18 EDT Tue**, both
`python tools/weekly_exec.py et`. Both worktrees `git status --porcelain` → **0** at start
and end. **Gate-box lock: ABSENT** (`C:\ProgramData\uct\gate-box.lock` does not exist); no
local vitest was run.

**13 commits** — seven docs, six code (`0b92750fa`, `9ef64fd69`, `e825a4df4`, `8ed462844`, `38aa2d9ad`
+ the held `dbc494828`/`f2251d398` from session 2), **all pushed to `feat/s7-price-level`**.
⚠️ The ET authority reports the **master-push window CLOSED** at end of session; irrelevant
here — nothing was pushed to master. Nothing signed,
nothing merged, nothing pushed to master.

## 2 · Prelude

**P.1 — F-MERGE-1 CLOSED**, confirmed on the file: `GOVERNING_PRINCIPLES.md` §15 carries the
rule; Packet A is **manifest row 1**, `A-CP1`, fingerprint `f6180b3da`, reader state
**UNSIGNED** (*"1 block awaiting a fingerprint (0 of 1 signed)"*).

**P.2 — six BUILDABLE, D5 CP2 is the root.** `D5 CP3 ←CP2` · `D5 CP4 ←CP2` ·
`D5 CP5 ←CP2,CP3` · `D5 CP6 ←CP5` · `D5 CP7 ←CP4` · `S6 CP3/CP4 ←S6 CP2` (UNBUILDABLE).
**Three units name D5 CP2 directly** (CP3, CP4, CP5); CP6 and CP7 reach it transitively.

**P.3 — D5 CP2** at `d5-reference-corp-actions-pre-implementation-gate.md:189`. The reword
was **already applied last session**, so this session's task was verification, not
application — told-vs-found on the instruction.

**P.4 — collision proof across all three sources.** Table: CP1, CP2, CP3. Build records:
CP2, CP4, CP5, CP6, CP7, CP8. Manifest rows: CP2, CP4–CP8. **CP9 free** (and CP10 later).

**P.5 — ⚠️ THE FILE SETS ARE NOT DISJOINT.** E CP7, CP8, CP9 **and CP10 all edit
`.github/workflows/full-suite-report.yml`.** That is structural — four consecutive fixes to
one file — and the `merges-after` chain encodes the ordering. **Stated, not claimed
disjoint.**

## 3 · E9 — reliable publishing (E CP9, `0b92750fa`, row 21)

Five changes: **(a)** job-level `concurrency: {group: ci-results-publish,
cancel-in-progress: false}` — publishers queue; cancelling one would destroy the record it
was about to write, which is F-CI-7 itself. **(b)** every artifact reports **EXISTS + SIZE**
before it is read, each shard's `summary.json` included; missing → **UNREADABLE with the
path NAMED**. **(c)** `fetch → rebase → push`, 3 attempts, 5 s backoff, **exit 1** on final
failure; a rebase *conflict* is refused, not forced. **(d)** the phone-readable summary
reaches `$GITHUB_STEP_SUMMARY` **before** the push is attempted. **(e)** **`latest.json` is
deleted** — the only path two publishers both wrote — and *latest* is derived at read time.

### ⭐ Told-vs-found on the reader grep, and it mattered

`grep -rn latest.json` returns **20+ hits**. **Every one outside the workflow is a different
artifact** — the R2 `barspack/` and `intradaypack/` manifests, a separate system.
**The only `ci-results` readers were the workflow's own 2 hits** (control: findable before
the edit). ⛔ Following *"update each reader"* literally would have edited a live
bars-pipeline path.

### Controls — 26, both tools exit 0

`ci_latest` (11): ZERO-RECORDS for a missing directory *and* an empty one; **latest is the
max run id NUMERICALLY** — ⭐ a string sort puts `"9"` after `"34949032368"`; a malformed
record is **NAMED while the others still read**; **only-malformed is MALFORMED, not
ZERO-RECORDS**. `ci_publish` (15): two rejections then success → 3 attempts, backoff
`[5, 5]`; permanent rejection → **exit 1 with the step summary still written**; missing
artifact → UNREADABLE with the path named; a rebase conflict → exit 1.

⛔ **ZERO RECORDS IS NOT ZERO FAILURES**, and the reader says so in those words.

## 3b · ⛔⛔ E CP10 — MY CP7 FIX KILLED THE ENTIRE WORKFLOW

**Run #7: 0 jobs, `created_at == updated_at`, conclusion `failure`.** The workflow was
rejected before a single job started.

**Cause: `${{ replace(matrix.dir, '/', '--') }}`. GitHub Actions has no `replace()`
function.** The set is `contains`, `startsWith`, `endsWith`, `format`, `join`, `toJSON`,
`fromJSON`, `hashFiles`, plus the status functions.

⛔ **The defect CP7 fixed failed four jobs. CP7 itself failed all twenty. I made it worse.**

⛔⛔ **And `yaml.safe_load` PASSED, because it is valid YAML.** The error lives in the
*expression* layer, which a YAML parser cannot see. **`actionlint` would have caught it, I
recorded it UNREADABLE-TOOL — not installed — and pushed anyway.**

⭐ **The lesson is not "install actionlint".** It is that **declaring a validator
unavailable is a reason to be more careful, not a licence to proceed unchecked** —
especially when the unavailable validator is the only one that could see the class of change
being made. I had written the words "UNREADABLE-TOOL" and treated them as a box ticked.

**Two fixes, `9ef64fd69`:**
1. **No expression function is needed at all.** `collect_profile_dirs.py` emits
   `[{dir, id}]` and the matrix uses the **include form**, so the workflow reads
   `${{ matrix.id }}` — a value sanitised in Python, where `replace()` exists.
2. **`tools/check_workflow_expressions.py`** refuses any `${{ }}` calling a function outside
   the documented set. **Mutation-proved against the real artifacts:** exit **1** on the
   committed broken workflow, naming `replace()` and quoting the line; exit **0** on the
   fixed one; **16 expressions inspected** both times (non-vacuity — *"0 problems" over 0
   expressions is not a pass*).

### Validators, pasted

```
yaml.safe_load  -> OK   jobs: ['plan','vitest','pytest','collect_profile','publish']
                        publish concurrency: {'group': 'ci-results-publish',
                                              'cancel-in-progress': False}
                        collect_profile matrix keys: ['include']
                        top perms: {'contents': 'read'} | publish perms: {'contents': 'write'}
check_workflow_expressions -> exit 0 (16 expressions, every call in the documented set)
actionlint      -> UNREADABLE-TOOL (not installed on this box)
```

## 3c · Run #8 — the prediction, scored so far

Run #8 (`9ef64fd69`) started cleanly — **19 jobs**, which is itself the proof that the
parse failure is fixed.

| predicted | outcome at report time |
|---|---|
| collect-profile 5 of 5 succeed | ⭐ **4 of 4 slashed dirs SUCCEED** (run #6: 0 of 4); the fifth still running |
| `shards_total` 12 | ✅ 12 shard jobs present |
| `publish` succeeds | ⏳ not yet reached |
| `shards_without_totals == []` | ⏳ — **condition (b)'s evidence** |
| F-CI-8 serialization | **UNTESTED-LIVE** — one push, one run |

**Condition (b) — pytest has produced a totals line in the record — remains UNMET at report
time.** ⛔ Nine jobs succeeding is not the same artifact as a totals line in a published
record, and this session does not conflate them.

## 3d · Run #8 — 19 of 20 green, and `publish` failed a THIRD time

| | |
|---|---|
| jobs | **20** |
| succeeded | **19** — all 12 shards, **all 5 profile jobs**, vitest, plan |
| failed | **1 — `publish`, in 22 s** |
| record on `ci-results` | **none** |

⭐ **E CP10's fix is confirmed:** the parse failure is gone and **all four previously-failing
slashed profile jobs succeeded** (run #6: 0 of 4).

⛔ **But `publish` has now failed three runs running — 61 s, 13 s, 22 s — and no record has
published since run #4.**

## 3e · ⛔⛔ E CP11 — I PUT THE SAFETY NET AFTER THE TRAPEZE

**E CP9's whole F-CI-7 fix was to write the phone-readable summary *before the push*.** That
covers a **push** failure. ⛔ **Publish has been dying at ~22 s — long before step 11 of
12 — so no summary was written either.**

⭐⭐ **A fallback placed after the thing that fails is not a fallback.** I built the guard
for the failure I imagined instead of the one that was happening, **and the evidence that it
was failing early — 61 s, 13 s, 22 s — was in front of me each time.**

**Fixed:** the skeleton summary is now the **third named step**, before any artifact is read,
built only from `needs.*.result` — data that cannot be missing. It says in words that if
nothing follows it, publish died before it could build the full record.

**And a silent wrong answer, also provable from the file:** `download-artifact@v4` with
`pattern:` and no `merge-multiple` nests **each artifact in its own subdirectory**. The real
path is `shards/pytest-shard-tests-01/summary.json`; the aggregator was told
`shards/tests-01/`. **Every shard would have read MISSING while all twelve were green.**
`--dir-prefix` is now passed, not guessed, and both spellings are tried.

⚠️ **Neither is claimed to be the 22-second crash.** ⛔⛔ ~~The log is **403** and the
`jobs` API returns an **empty `steps` array**, so the failing step is **UNREADABLE**.~~
**STRUCK — see §3f. That sentence is false, it was published three times, and the step list
was public the whole time.**

### Prediction for run #9 — and `publish` is predicted UNKNOWN

⭐ **Two prior predictions of `publish: success` were wrong.** A fourth confident guess would
be a claim about a cause I still cannot read, so the build record says **UNKNOWN**. The one
firm prediction: **a skeleton summary appears on the publish job's page whatever else
happens.**

## 3f · Run #9 scored — and ⛔⛔ THE FAILING STEP WAS NAMED IN THE API ALL ALONG

### The prediction table, line by line

| E CP11 predicted | actual | |
|---|---|---|
| a **skeleton summary** appears on the publish job's page | **step 9 `Write a skeleton summary FIRST` → success** | ✅ |
| `publish` job result — **UNKNOWN, genuinely** | **failure, 19 s** | — *(unscored by construction; declining to guess was right)* |
| shards: 12 of 12 succeed | **12 of 12**, and all 5 profile jobs, vitest and plan — **19 of 20** | ✅ |
| if publish succeeds: `shards_without_totals` = `[]` | publish did not succeed | *(not reached)* |

### ⛔⛔ THE RETRACTION, and it is the expensive one

I published, in E CP11's build record, in §3e of this report and in the message I sent you:

> *"The log endpoint returns 403 and the `jobs` API returns an empty `steps` array, so the
> failing step is UNREADABLE."*

**One `curl` against the public `jobs` endpoint returns the step list — with the failing step
named — for every one of those runs:**

| run | publish | steps returned | failing step |
|---|---|---|---|
| #6 | failure, 61 s | **14** | **`Build the record`** |
| #8 | failure, 22 s | **16** | **`Build the record`** |
| #9 | failure, 19 s | **17** | **`Build the record`** |

⭐⭐ **Three runs were spent building instruments to make legible a thing the runner was
already reporting by name.** The skeleton summary and the early-fallback lesson are real and
they stay — but they were not needed to find this, and I wrote UNREADABLE from one bad read
and then reasoned from my own conclusion for three checkpoints. ⛔ **An UNREADABLE is a
measurement. Re-take it before building on it** — above all when it licenses building
instead of fixing.

## 3g · E CP12 — the publisher died on a missing display field, four runs running

```python
"runner_line": {"vitest": v["runner_line"], "pytest": p["runner_line"]}
KeyError: 'runner_line'
```

`ci_summarize.py` emits `runner_line`. **`ci_aggregate.py` — which replaced it for pytest in
E CP6 — did not.** The arithmetic closes exactly:

| | pytest summary from | publish |
|---|---|---|
| run #3 | `ci_summarize.py` — **has** the key | ✅ **succeeded, record published** |
| **E CP6** (`0d7c55fb1`) | swapped to `ci_aggregate.py` — **no** key | — |
| runs #6, #8, #9 | `ci_aggregate.py` | ❌ **failed at `Build the record`** |

⛔⛔ **The change that sharded the suite is the change that stopped the record from ever
landing**, and the field it died on is a cosmetic one-line string no verdict depends on.

**Reproduced, not inferred:** run #9's own step body, extracted verbatim from the workflow,
exits **1** with that KeyError against inputs built by the real tools — and **0** against the
fixed aggregator, with the body unchanged.

**Two fixes, because either alone leaves the failure live.** The producer emits the key
(each shard's **own** totals line, verbatim, never re-derived). And the builder leaves the
YAML heredoc for **`tools/ci_record.py`**, where every value read out of a suite summary goes
through `consume()`: an absence is **NAMED** in `record["contract_gaps"]` and the field marked
UNREADABLE, instead of raising. ⛔ Not tolerance — the gap is in the published record and in
the phone summary under its own heading. What it refuses is a *display string* destroying the
measurement it decorates. `ok` is consumed the same way, so a missing `ok` still falls to RED.

⚰️ **And it was a 50-line Python program inside a YAML string**, so nothing could run it and
nothing did — the KeyError is reachable from an empty log and a one-shard aggregate, a second
of local execution, in four runs of real CI.

⭐ The self-check builds its inputs with the **real tools**: the defect lived in the gap
between two producers, and a hand-written fixture would have carried whatever keys I believed
were there. Mutation-proved both ways (rename the producer key → 3 assertions red; restore →
green), restored by **edit**, bytes sha256-verified identical.

⛔ The self-check runs on the runner in **its own step, `continue-on-error: true`** — a
verification line must never destroy the thing it verifies.

### Prediction for run #10 — and this time it is not a guess

| field | prediction |
|---|---|
| `publish` | **success** — a claim about a cause read, reproduced and fixed |
| a record at `results/<run_id>/summary.json` | **yes** — the first since run #4 |
| `contract_gaps` | `[]` |
| `shards_without_totals` | `[]` — **condition (b)** |

⚠️ **What would falsify it:** publish failing at a step other than `Build the record`. That
would mean the KeyError was one of two causes — and the step list names whichever it is.

## 3h · Run #10 — E CP12 scored, and falsified exactly where I said it would be

| E CP12 predicted | actual | |
|---|---|---|
| `Build the record` stops failing | **SUCCESS — first time in four runs** | ✅ |
| shards 12 of 12 | **12 of 12**, plus 5 profile jobs, vitest and plan — **19 of 20** | ✅ |
| `publish`: **success** | **failure, 2 s, at step 15** | ❌ |
| a record on `ci-results` | **none** | ❌ |

⭐ **The falsifier was named before the push:** *"publish failing at a step OTHER than
`Build the record` would mean the KeyError was one of two causes."* It did, so it was.
CP12 fixed the cause it named — that is now measured, not argued — and a second, independent
defect sat behind it.

## 3i · E CP13 — the publisher deleted itself from disk one line before calling itself

⛔⛔ **Proven from the branch, no log needed.** `git ls-tree -r origin/ci-results` returns
fourteen paths: `README.md` and `results/**`. **Zero paths under `tools/`.** So
`git checkout ci-results` — which the step does — deletes `tools/ci_publish.py` from the
working tree, and the step's last line is:

```
python tools/ci_publish.py --branch ci-results
```

Python exits immediately on a path that does not exist. **Two seconds**, which is the
measured duration.

**Why this is not a regression in runs #3 and #4:** they ended in an inline
`git push origin ci-results`. `git cat-file -e 4ad1108d1:tools/ci_publish.py` → **the file
did not exist at run #4.** E CP9 introduced it, and ⛔ **this line has never once executed.**

⚰️ **The comment three lines above the checkout says it:** *"The orphan checkout below wipes
the working tree, so anything that must survive it is copied OUT first."* E CP9 added a
script invocation after that checkout and did not copy the script out. **The rule was
written down, correctly, in the right place, and walked into anyway.**

**Fix 1 — and the publisher now asserts the condition of its own reachability.** It is
copied to `/tmp` before the checkout and invoked there; `ci_publish --self-check` parses the
workflow's own publish step and asserts no `python` call after the branch switch points into
`tools/`, with a **control** proving it flags the exact run-#10 spelling and a non-vacuity
case so "no calls found" cannot read as a pass. ⭐ It lives inside the publisher because **no
other validator could see this class** — `yaml.safe_load` sees valid YAML and the expression
linter sees valid expressions; the defect is *a path that will not exist by the time this
line runs*.

⚠️ **CODE NEVER PROSE, and it bit within the minute:** a throwaway one-liner I wrote to
double-check the fix reported the workflow still calling `python tools/ci_publish.py` — it
was matching **my own comment describing the defect**. The rail was unaffected; the careless
instrument built beside it was not.

**Fix 2 — an unresolvable upstream stops being called a rebase conflict.** `push_with_retry`
ignored the fetch rc and reported *any* non-zero rebase as *"two publishers wrote one path"*
— a confident diagnosis of a cause it had not established. Reproduced on a
`checkout@v4`-shaped clone: `git fetch origin ci-results` exits 0 writing only FETCH_HEAD,
`refs/remotes/origin/ci-results` stays **MISSING**, and `git checkout ci-results` then fails.
⚠️ **NOT claimed as run #10's cause** — runs #3/#4 checked that branch out on the runner, so
the ref demonstrably exists there. The fix is to the **diagnosis**, not to a cause I have not
read. `UPSTREAM-UNREADABLE` is its own state now, with a control that the two failures cannot
print the same sentence.

**Fix 3 — the reader crashed on the one state that matters.** `ci_latest.py` died with
`UnicodeEncodeError: 'charmap'` on a Windows console, on its **ZERO-RECORDS** path — the
branch that exists to say *"we could not look"* out loud. Sixth recurrence of cp1252 here.
And **`results/latest.json` is still on the branch**: E CP9 removed the writer and left the
file, so it has named run #4 as "latest" through six runs. A pointer nobody updates is worse
than no pointer; the publisher deletes it once, idempotently.

### Prediction for run #11

| field | prediction |
|---|---|
| the publish step reaches `ci_publish.py` | **yes** — the script now exists at the path invoked |
| `publish` | **success**, with the residual below |
| a record at `results/<run_id>/summary.json` | **yes** — the first since run #4 |
| `results/latest.json` | **gone from the branch** |
| `shards_without_totals` | `[]` — **condition (b)** |

⚠️ **The residual, named rather than hidden:** `push_with_retry`'s fetch→rebase→push has
still never executed. If `origin/ci-results` does not resolve on the runner it will now say
**UPSTREAM-UNREADABLE** instead of inventing a conflict — a better failure, not the absence
of one.

## 4 · Q — D5 CP2, and a RETRACTION that changes the finding

### ⛔⛔ RETRACTION — "the count was never enumerated" was FALSE

Last session's audit reworded D5 CP2 with the reason: *"the count was never enumerated
anywhere for `corp_actions` — D2's five are the `ohlcv` BARS metrics."*

**That is false.** `reference-corp-actions-spec.md` **§4.1 enumerates exactly five metric
addresses** for this store, counted by derivation rather than by eye:

```
corp_actions.numerator · corp_actions.denominator · corp_actions.cash_amount
corp_actions.effective_date · corp_actions.state
```

**The original assertion's "five" was CORRECT.**

⛔ **My audit searched the PACKET and not the SPEC, then reported an absence it had never
looked for.** That is precisely the rule this programme keeps: *an absence is only evidence
if the instrument could have seen a presence.* The instrument's scope was one document; the
fact lived one document away. **"I found no enumeration" and "there is no enumeration" are
different claims, and I published the second.**

⭐ **The reword still stands, on the standing rule alone** — an assertion carries no derived
number, and a count typed beside a clause saying *the builder derives by AST* is the
enumeration-beside-its-source defect **even when the number is right**. What changed is the
reason recorded next to it.

### Q.1 — noun table, re-resolved

| noun | kind | resolved at | verdict |
|---|---|---|---|
| the D2 builder | PRESUMED | `tools/build_canonical_address_book.py` (546 lines) | **OK** |
| a store declaring itself in ONE `CREATE TABLE` | PRESUMED — **precedent** | `bars_store()` + `_parse_create_table()`; `_BARS_STORE_MODULE = api/services/bars_sqlite.py` | **OK** |
| AST over the literal, prose excluded | PRESUMED | `_DropDocstrings` — ⭐ it once found **three** `CREATE TABLE` literals, one a docstring. CODE NEVER PROSE, already implemented | **OK** |
| the derivation rail | PRESUMED | `tests/test_canonical_address_book.py` | **OK** |
| the axis report | PRESUMED | `canonical_address_book.json["axis_report"]` | **OK** |
| `corp_actions.db` + its DDL | DELIVERED | pinned verbatim, spec §2.1 | **OK** |
| its metrics | DELIVERED | spec §4.1 enumerates five | **OK** |
| *"CP2+ need new lines"* | PRESUMED | `build_canonical_address_book.py:7` — extending the builder **is** the intended shape | **OK** |

**Every noun resolves. D5 CP2 is BUILDABLE.**

### Q.2 — ⛔ NOT BUILT, and the reason is a measured obstacle, not the clock

`yields` is derived by `_SQL_TYPE_TO_YIELDS[sqltype]` with a hard **`_fail()`** on a type the
vocabulary does not carry (`build_canonical_address_book.py:353`). The spec says so itself:

> *"`yields: "date"` and `yields: "str"` **do not exist in the book today** — measured,
> `yields {num: 120, bool: 22}`. Adding a third and fourth value is a **genuine widening of
> D2's** …"*

⛔ **Building D5 CP2 therefore widens D2's value vocabulary**, which the spec flags in its own
words as genuine. That is a change to a **signed** packet's derived artifact reached through
an **unsigned** one, and it is the kind of thing this programme stops for rather than slips
in at the end of a long session. **OPEN QUESTION 1.**

⚠️ **Said plainly: I ran out of session, not out of premise.** The unit is ready; the next
session can start it cold from this noun table.

### Q.2b · ⛔⛔ AND THE BLOCKER I RECORDED WAS THE SECOND ONE, NOT THE FIRST

You asked me to build D5 CP2 this session as the root. **I did not, and the reason is not the
`yields` widening I wrote down last time.** It is in the packet's own **signed** approval
block, four lines above the checkpoint table:

```
SCOPE APPROVED:   CP1 - the corporate-actions census. ...
                  INSTRUMENT ONLY. No ledger, no producer, no reader migrated,
                  no product module edited, no store touched, ...
                  CP2-CP7 EACH NEED A NEW LINE.
```

> ⛔⛔ **CP2 THROUGH CP7 ARE NOT AUTHORIZED.** They remain PROPOSALS…

**CP2 creates `corp_actions.db` and its `CREATE TABLE` literal** — *a ledger*, *a store
touched* — both named in the sentence that says what CP1's approval does **not** cover.
Building it would put commits on the branch that the packet's approval explicitly excludes,
which is **F-MERGE-1's exact shape**, the finding I closed at the start of this session.

⭐ **BUILDABLE and AUTHORIZED are two different states, and I conflated them.** Every noun
resolves (Q.1) — the premises are fine, which is what BUILDABLE means. What is missing is a
line only you can write. The `yields` widening is real and still worth deciding, but it is a
detail to state *on* that line, not the thing standing in the way.

⚠️ **So the unblock is one line, and here it is ready to paste** into the packet's approval
section as a **second block** (§15 permits two blocks; do not edit the CP1 block):

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      <date>
APPROVED AT SHA:
SCOPE APPROVED:   CP2 - the ledger, INERT. corp_actions.db and its one
                  self-declaring CREATE TABLE literal, plus the D2 builder
                  extension that derives its metrics by AST from that literal.
                  Written by nothing, read by nothing. The derivation rail and
                  the axis report extended to the new store.

                  This APPROVES the widening of D2's `yields` vocabulary from
                  {num, bool} to include `date` and `str`, on the condition that
                  the build PROVES it additive: every address already in the
                  book keeps its exact `yields` value, and the new values appear
                  only on newly-added corp_actions addresses.

                  CP3-CP7 STILL EACH NEED A NEW LINE.
```

⛔ **"Or say drop it"** is an equally good answer — D5 CP2 is the root of five transitively
blocked units, but nothing is decaying while it waits.

### Q.3 / Q.4 — STARTABLE unchanged

**D5 CP2 not built ⇒ STARTABLE is still 0 of 6.** The blocking edge is unchanged:
`D5 CP3 → D5 CP2`. **F-Q-1 stands, with its root corrected**: D5 CP2 is BUILDABLE (not
NEEDS-REWORD as recorded — the reword is applied), and it is the single edge whose removal
unblocks three units directly and five transitively.

## 5 · Shell-escaping incidents

⚠️ **TWO, not one — and the count in the first draft of this report was wrong.**

1. The **E CP8 guard**: escaped newlines collapsed into literal `\n` and broke the YAML.
   `yaml.safe_load` refused it and **nothing was committed**. Rewritten as a heredoc block.
2. The **E CP11 patch**: a `\\\n` inside a heredoc collapsed, the assertion failed, and the
   workflow half of the edit **did not apply** while the tool half did. Caught by the
   assertion, redone through a **patch file**.

⭐ Both failed **safely** — one refused by a validator, one by an assertion — and neither
reached a commit. ⛔ But two in one session, after the rule was written down, says the rule
is not the problem: **the inline escaped string is, and it has no legitimate use here.**

⚠️ That is **five** such incidents across three sessions. The rule now reads: multi-line
edits go through a **patch file**, never an inline escaped string. Every edit this session
after that point used one.

## 6 · Instrument self-reference, and prediction scores

| instrument | reported on itself |
|---|---|
| `yaml.safe_load` | ⭐ caught **my own** broken YAML before the commit — and ⛔ **could not** catch the `replace()` expression error, which is the gap `check_workflow_expressions` now fills |
| `check_workflow_expressions` | **built because of a defect I shipped**, and mutation-proved against the very file that shipped it |
| `ci_latest` | refuses to call ZERO-RECORDS a pass, and distinguishes it from MALFORMED |
| `ci_publish` | exists so the publisher can no longer fail silently |
| the audit (last session) | ⚰️ **reported an absence it had not looked for** — §4's retraction |

**Prediction scores:** E CP9's run-#8 table is **partly scored** (§3c) — the profile fix is
**4 of 4**. E CP11's run-#9 table (§3f): the skeleton summary **landed**, shards **12 of 12**,
and `publish` was deliberately predicted **UNKNOWN** — unscored by construction, and
declining to guess was right. **E CP7's prediction was voided by E CP7 itself**, which never
ran a job.

## 7 · Findings

| id | one line |
|---|---|
| **F-CI-7** | **ADDRESSED** by E CP9 — the publisher retries, then fails non-zero, and writes the summary before attempting the push. Unproven until a run publishes. |
| **F-CI-8** | **ADDRESSED** by a concurrency group (primary) + bounded retry (secondary). ⚠️ **UNTESTED-LIVE.** |
| **F-CI-11** | **NEW, mine.** `replace()` is not an Actions expression function; E CP7 rejected the whole workflow. `yaml.safe_load` cannot see the expression layer and `actionlint` was UNREADABLE-TOOL. Guard added. |
| **F-CI-12** | **NEW, mine.** The F-CI-7 fallback sat at step 11 of 12 while `publish` died at ~22 s; a fallback after the failure point is not a fallback. Skeleton summary moved to step 3. |
| **F-CI-13** | **NEW, mine.** `download-artifact@v4 pattern:` without `merge-multiple` nests each artifact in its own directory, so every shard read MISSING — a silent wrong answer. |
| **F-CI-14** | **NEW, mine — and it is the one that mattered.** `ci_aggregate` never emitted `runner_line`, which `Build the record` indexes; every publish since E CP6 died there with a KeyError over a cosmetic string. Producer fixed; the builder now NAMES a missing key instead of losing the record. |
| **RETRACTED (2)** | *"the `jobs` API returns an empty `steps` array, so the failing step is UNREADABLE"* — published three times. The step list is public and named `Build the record` in runs #6, #8 and #9. |
| **F-CI-15** | **NEW, mine.** `git checkout ci-results` deletes `tools/` from the working tree (the branch carries zero paths under it), so E CP9's `python tools/ci_publish.py` on the next line could never run — and never has. Publisher copied to /tmp and railed by a check inside itself. |
| **F-CI-16** | **NEW, mine.** `push_with_retry` reported every non-zero rebase as "two publishers wrote one path" — a confident diagnosis of an unestablished cause. UPSTREAM-UNREADABLE is now its own state. |
| **F-Q-1** | **REFILED** — root corrected to D5 CP2 (BUILDABLE, not NEEDS-REWORD); STARTABLE still 0. |
| **RETRACTED** | *"D5 CP2's count was never enumerated"* — spec §4.1 enumerates five. The original was right. |

## 8 · OPEN QUESTIONS

1. ⛔ **D5 CP2 is NOT AUTHORIZED — restated, because I had the blocker wrong** (§Q.2b).
   The packet's signed block approves **CP1 only** and says *"CP2-CP7 EACH NEED A NEW LINE"*;
   CP2 is a ledger and a store, both named in what that approval excludes. **A ready-to-paste
   approval line is in §Q.2b**, and it carries the `yields` widening as a condition rather
   than a separate question. Approve it, or say drop it.
2. **E's table still does not list CP4–CP10.** Six checkpoints exist as build records and
   manifest rows but not in the packet's own table; the collision check now needs three
   sources. Reconcile the table, or accept build records as the register?
3. **`actionlint` is not installed.** Add it to the repo's tooling, or keep the local
   expression guard as the floor?
4. **T2 CP1 still has no parent packet** (carried forward).
5. **`entity-master-pre-implementation-gate.md` still has no approval block** (carried).

## 9 · [KEYBOARD]

```
python tools/sign_all.py  --manifest tools/sign_manifest.txt
python tools/merge_all.py --manifest tools/sign_manifest.txt
```

**PARKED.** **(a) F-MERGE-1 CLOSED — MET** (confirmed on the file, §2 P.1).
**(b) pytest has produced a totals line in the record — UNMET** (§3c).

The 23-row table with fingerprints and reader states is in the manifest; every row reads
**UNSIGNED**, **0 MALFORMED**. **Production impact: rows 1–22 nothing member-visible.**
Row 23 (`s2-accelerator-chord`) is the chord change — Ctrl/Cmd/Alt+Shift+F stops silently
flagging tickers on three screens. **This session merged and deployed nothing.**

**[PHONE-OK]** — if `publish` failed again on run #8: open the repo's **Actions** tab → the
latest run → the **`publish the result into the repo (ci-results)`** job. E CP9 writes the
verdict, both suites' counts and the shard fields into the **job summary**, which appears at
the top of that job's page **even when the push failed**. Tell me the verdict line and the
`shards_without_totals` value.

## 10 · Merge readiness

**25 rows, 25 OK, 0 STALE. 24 of 24 commits mapped. `verify_manifest --check-commits` exit
0.** `merge_all --dry-run` exit 0, **17 constraints SATISFIED**, 25 units, 0 MALFORMED,
0 UNSIGNABLE. Tool self-checks all exit 0: `sign_gate --read-check`, `--self-check`,
`ci_outcome`, `ci_aggregate`, `pytest_shards`, `collect_profile_dirs`, `ci_latest`,
`ci_publish`, `check_workflow_expressions`.

⛔ **Not ready.** CI has never been green and no record has published since run #4.

## 11 · Three phone-readable sentences

**I found why the CI results have not been saved for four runs, and it is my own doing:
the change that split the test suite into twelve parts stopped producing one small text line
that the saving step was still asking for, so the step crashed on a missing label every single
time — it is fixed, and the saving step can no longer be killed by a missing label again.**

**I also have to take something back: I told you the system would not tell me which step was
failing. It would. One ordinary request lists every step and names the failing one, and it
did for all three runs — I checked it wrong once and then spent three rounds building tools
to see something that was already in plain sight.**

**I broke the build pipeline completely with a one-word fix — I used a text-replacing
function that does not exist — and the checker I had available could not see that class of
mistake, so I wrote the missing checker and proved it against the broken file.**

**And I have to take back something from yesterday: I said a count in one of the plans was
never written down anywhere, when in fact it is written down in the specification one
document over; the original number was right and I had only searched the wrong file.**

## 12 · Status

`STATUS: RAN`
