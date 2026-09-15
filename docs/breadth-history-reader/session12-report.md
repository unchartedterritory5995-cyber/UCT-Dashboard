# Breadth History Reader — Session 12 report

A **landing session**: its own new work is small on purpose. The question was whether
already-gated work could reach master, and the answer is the operational finding again.

**OWNER INPUT was not filled in** — all four lines were still bracket placeholders. So:
**no quiet window granted** (Workstream B runs opportunistically, per the prompt's own
fallback), and **Workstream E is skipped**, its stop condition independently confirmed
below.

**Published page:** https://claude.ai/artifact/AwxVDVMwN2x5TYXvSrBZH8 (private)

---

## THE HEADLINE

| | |
|---|---|
| **Four conventions ratified** | the cheap-check rule, the 8-file hot path, strings-not-parsed, sampler load limits |
| **Both held branches re-gated clean** | M12 hot-path diff empty; M13 parity EXACT three ways against *current* master |
| **C and D built** | publishable pool summary with p95 suppressed below n=59; scope checker with 8 rails, mutation-proved |
| **Landing sequence: waiting** | the session opened at 13:07 ET; the window opens at 16:05 ET |
| ⭐ **A clock bug, one session after recording a clock bug** | and the rule I wrote would not have caught it |

---

## A. State check

### A.1 Where everything is

| | |
|---|---|
| `origin/master` at session start | `65899a8f7` — **14 commits** since M11, all charts/joystick |
| files changed by them | **38**, of which **0 under `api/`** |
| production deploy | SUCCESS, `meta.branch = master` — ⛔ **E's stop condition: the cutover has not happened** |
| `breadth/sampler` (M12) | pushed, unmerged |
| `breadth/resident-recon` (M13) | pushed, unmerged |
| `repo/git-scope` | new this session, pushed, unmerged (rides in M15) |

**Hot-path (8-file) identity across those 14 commits: IDENTICAL** — every file's blob SHA
matches between `4a0995a52` and master.

> ### ⚠️ And the non-vacuity count was ZERO, which is not a pass
>
> Those 14 commits touched **no `api/` files at all**, so "none of them were hot" is true
> and says nothing. **A non-vacuity count of zero is not a passing check — it is an unrun
> one.** Re-driven against the commit that last touched `breadth_daily_ohlc.py`
> (`fdf7c2201` vs parent `444f747d8`), the same comparison **fires on exactly one file**.
> Appendix #38.

### A.2 Session 11's open questions

| # | recommendation | class |
|---|---|---|
| 1 Wait-for-CI reading | still open — 1 minute, browser | **needs the owner** |
| 2 G-3 probe | still open — the only cutover blocker | **needs the owner** |
| 3 flip the resident copy | **not this session** (0.5): needs a pool with n ≥ 20 on the current SHA as the *before* | adopted |
| 4 raise the 2× memory bound | **declined for now** (0.2) | adopted |
| 5 sampler cap/cadence | **ratified** (0.1) | adopted |
| 6 pool not phone-readable | **fixed** — C.1/C.2 | adopted |
| 7 why 11 of 20 need zero extra syscalls | still open — the eviction trigger | open |

### A.3 Today's deploy cadence — the input to the landing protocol

| | |
|---|---|
| deploys observed (11.0 h) | **20** = **1.8/hour** |
| gap: min / median / longest | **23 s** / **925 s (15.4 min)** / **12,739 s (212 min)** |
| gaps ≥ 600 s (one settle) | **15 / 19** |
| gaps ≥ 45 min (a full sequence) | **3 / 19** |
| last deploy before the sequence | 12:58:50 ET |

⭐ **A single settle is usually available; a 45-minute run is not.** That is the precise
shape of the constraint, and it is why B runs as gaps allow rather than in one sitting.

### A.4 Both branches re-gated after merging current master

| | M12 `breadth/sampler` | M13 `breadth/resident-recon` |
|---|---|---|
| master is ancestor | yes | yes |
| file overlap with master's changes | **none** | **none** |
| tests | **17** green (14 + C.4's 3) | **493** breadth + **187** ledger green |
| hot-path diff | **empty** — 5 files, 0 under `api/` | 1 file (`breadth_daily_ohlc.py`, where the feature lives) |
| parity | — | **EXACT three ways** vs current master: golden / OFF / ON all `sha256 7695923c…`, 5,576,278 B |

---

## B. The landing protocol

### B.1 The sequence, with predicted clock times

Predicted from A.3 (gate ≈130 s, build+deploy ≈120 s, settle 600 s), assuming a 16:10 ET
start and no intrusion:

| step | predicted | needs |
|---|---|---|
| **M14** `docs/session11-record` → master | 16:10 → SUCCESS ≈16:15 | window open, previous deploy settled 600 s |
| settle | → 16:25 | |
| **M12** `breadth/sampler` | 16:25 → SUCCESS ≈16:30 | |
| settle | → 16:40 | |
| **dry run** 3 samples | 16:40 → 16:43 | pod settled ≥600 s (booted ≈16:30 ✓) |
| **S1** register the scheduler job | 16:43 → 16:45 | local, no push |
| **M13** `breadth/resident-recon` | 16:45 → SUCCESS ≈16:50 | |
| settle + confirm flag OFF from the instrument | → 17:00 | |

**Total quiet needed ≈ 50 minutes.** Against A.3: only **3 of 19** gaps today were that
long.

### B.2 Intrusion rule

Any deploy from any workstream resets the 600 s settle. **The pre-push guard is the
authority** — never bypassed, never `--no-verify`, never `UCT_SKIP_PREPUSH_GUARD`. Every
refusal is logged with the intruding SHA to `logs/session12-landing.log`; **those refusals
are the operational record.**

### B.3 Where it got to

**Started 13:26 ET, waiting for the window** (opens 16:05 ET). Deadline: 09-16 09:25 ET.

```
[09-15 13:26:31 ET] === landing sequence start ===
[09-15 13:26:31 ET] deadline: 09-16 09:25 ET
[09-15 13:26:31 ET] window open now: False
[09-15 13:26:31 ET] M14: waiting — inside push-guard hours (opens 16:05 ET)
```

⛔ **Nothing was pushed to master this session.** Branch pushes only. The live log is the
record of what happened after this report was written.

### B.4 The quiet window

**Not granted** — the OWNER INPUT line was unfilled. B therefore runs opportunistically,
which is the prompt's own fallback.

---

## C. Pool readability

**C.1** — `tools/breadth_sampler_report.py` now writes
`docs/breadth-history-reader/sampler-summary.md` on every run. ⭐ **One rendering written
twice, not two renderings** — two could disagree. The header declares the file
**GENERATED**, declares it **NOT A SOURCE** (no rail may treat it as an authority; the
authority is the JSONL and the git history it points at), and states why it is safe to
publish: the pool holds request timings, flag states and a commit SHA — **a property of
what the sampler records, not a promise about redaction.**

**C.4** — the p95 cell reads `not est` below n = 59, **in the cell itself**. A printed p95
is read as an estimate whatever caveat sits beside it, and Session 10 measured
P(true p95 above the worst read) = **0.358** at n = 20. The rail drives **both**
directions: n=20 must suppress it while still printing p50/max, and n=59 must print it —
because a report that always says `not est` is equally useless.

### The pool as it stands

```
POOL 1   n=2   flags {'rf_pagecache': 1.0}
  SHAs pooled (1, hot path byte-identical): 4a0995a52
              total_ms  n=2  min=351.4  p50=1975.5  p95= not est  max=3599.7  sd=2296.9
  P(true p95 lies ABOVE the worst read seen) = 0.95^2 = 0.902
  ⛔ p95 NOT estimable: n=2, need 59 (57 more on this pool)
```

### ⚠️ C.a — is there a zero-push way to refresh the page between sessions?

**No.** Publishing goes through the Artifact tool, which exists **only inside a Claude Code
session**; a Task Scheduler job on this box cannot reach it. So the summary refreshes
either when a session publishes it, or it rides with the next docs merge. There is no third
option that avoids both a push and a session.

---

## D. Repo safety — the `git add -A` incident, made mechanical

**Built:** `tools/git_scope.py`, `.git-scope/breadth-history-reader.json`,
`tests/test_git_scope.py` (8 rails), `docs/breadth/git-scope-hook-proposal.md`.

⭐ **An undeclared branch is not a violation.** It enforces only scopes written down —
today exactly one, this programme's. A check that refuses everybody gets bypassed within a
day, and a bypassed check is worse than none.

**Rails include the actual paths from the incident**, and the non-vacuity half (the same
commit *without* the sweep must pass), plus an end-to-end test in a **throwaway repo** so
nothing ever stages into the real index. Mutation-proved: inverting the allow-list check
and refusing undeclared branches each turn the rails red by name. **Dogfooded** — the
checker ran on its own commit: *4 staged path(s), all inside 'breadth-history-reader'*.

### ⚠️ D.2 — another programme owns the hook path, so nothing was installed

| mechanism | owner |
|---|---|
| `<repo>/.git/hooks/pre-commit` — the credential scan | rig-credential-hygiene |
| `<repo>/.git/hooks/pre-push` — the deploy guard | deploy-windows |
| `app/src/hub/rule12Paths.test.js` — a scope rail, as a **test**, identifying the change set **from the diff** | joystick |

⛔ **Proposed, not installed.** The wiring is one `-f`-guarded call in the existing
`pre-commit`, absent-safe exactly like the credential scan beside it. **Coordination is an
OPEN QUESTION.**

### D.3 — the `\x01` normalisation: cause measured

| | |
|---|---|
| `core.autocrlf` | **`true`** |
| `.gitattributes` entry for those paths | **none** — `git check-attr -a` returns nothing |

So git decided text-vs-binary by **sniffing**, and a mostly-ASCII markdown file carrying a
few raw control bytes sniffs as text. ⭐ **This repo has met that failure twice before and
fixed it the same way** — `*.woff2 binary`, and the OCR corpus `-text`; `.gitattributes`
explains the class in its own header.

**Proposed line, NOT added** (another programme's files): `-text` on the two joystick docs.
⚠️ `-text`, not `binary` — `binary` also suppresses diffs, a worse cure for a document
people review.

---

## E. Cutover verification — **skipped**

OWNER INPUT unfilled, and the Railway deployment list independently confirms the stop
condition: every deploy still carries `meta.branch = master`. Nothing was pushed for E.

---

## F. Records

`docs/breadth/DECISIONS.md` **D-052** (the four conventions, the three-design evidence
table, the operational row); `00-profile.md` Session 12 + appendix **#36–#39**.

---

## KEYBOARD STEPS FOR THE OWNER

1. **Grant the quiet window** — the single highest-leverage action. Tell the other sessions
   to hold master pushes for ~50 minutes after 16:10 ET. Everything unlanded lands.
2. **Wait-for-CI reading** — 1 minute, browser. *(carried since Session 10)*
3. **The C.2.i probe** — ~10 min. ⛔ Stop if inherited variables cannot be removed.
4. **Cutover steps 3–5** — only after 3 says a build was triggered.
5. ⚠️ **NEW — coordinate the hook.** `tools/git_scope.py` is built and proposed but not
   installed, because `pre-commit` in the shared hooks dir is another programme's. Someone
   has to say yes.

---

## OPEN QUESTIONS

1. ⚠️ **Hook ownership** (D.2) — who approves a second call in the shared `pre-commit`?
2. ⚠️ **The `.gitattributes` `-text` line** (D.3) — joystick's files, joystick's call.
3. ⚠️ **Resident-copy flip** — needs a pool with **n ≥ 20 on the current SHA** as the
   *before*. Flipping starts a **new** pool.
4. ⚠️ **Sampler cap** — 60/day ratified; say if you want it lower once you see the load.
5. ⚠️ **Wait-for-CI and G-3** — unchanged, still the cutover blockers.
6. ⚠️ **Why 11 of 20 settled cold reads need zero extra syscalls** — the last open piece of
   the original 54,923 ms question.

---

## PROPOSED SESSION 13

1. **Read `logs/session12-landing.log` first** — it says which steps landed overnight and
   which were refused, by SHA.
2. **Finish whatever the sequence did not**, then **S1**, then let the sampler run.
3. **Read the first real pool.** At 60/day one pool reaches n = 59 in a day, provided no
   commit touches one of the eight hot files.
4. **Do not build.** The resident-copy flip is the next decision and it is a measurement
   decision.
