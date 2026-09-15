# Breadth History Reader — Session 13 report

First run under **SD-1**. The checklist now exists
(`docs/breadth-history-reader/PROGRAMME-CHECKLIST.md`) and is the source of truth from
here on; this report is the delta against it.

⚠️ **Push-guard hours covered the whole working part of this session** (09:25–16:05 ET;
the session opened at 14:23 ET). Per SD-1 §6 that makes it a build-and-record session,
and it is said here at the top rather than apologised for. The landing script holds
R1/R3 and fires at 16:05.

---

## 1 · CHECKLIST DELTA

| Item | Was | Now | Why |
|---|---|---|---|
| **G1** Wait-for-CI reading | owner step since Session 10 | ✅ **DONE** | It never needed a browser — read from the Railway API |
| **S1** `.gitattributes` | NOT STARTED | **BUILT** | 10 derived paths + 8 rails, mutation-proved |
| **S2** hook install | NOT STARTED | **BLOCKED** | The trial is vacuous until the tool is on master — measured |
| **S3** unborn-branch fix | BUILT | **BUILT**, re-verified | 8 rails green after merging current master |
| **G2 / G3** | BLOCKED | **OWNER-PENDING** | No usable browser — measured, not assumed. G3 is now **one change** |
| **R1** M12 | READY | **READY**, branch moved | A defect was found and fixed before it could land |
| D1–D3 | rolling | +D-053, +#40/#41/#42, +checklist | |

**Did not move:** R2, R4–R8 (all behind the 16:05 window), G4–G8, D4.

---

## 2 · STATE CHECK

| | |
|---|---|
| `origin/master` | `65899a8f7` → **`79b4b2907`** (moved mid-session: one joystick docs PR, #142) |
| `origin/production` | **`79b4b2907`** — equal to master |
| Newest `web` deploy | `79b4b2907`, **SUCCESS**, `meta.branch = master`, created 14:31 ET |
| Hot path (8 files) | **IDENTICAL** `4a0995a52` → master … |
| … non-vacuity | **0** commits between them touch a hot file ⇒ **unrun, not passing**. Discriminator driven: `fdf7c2201` vs `444f747d8` fires on `breadth_daily_ohlc.py` |
| Flags, from the instrument | `rf_pagecache = 1` in the pool. `rf_resident` **absent** — correct: M13 is not on master |
| Landing script | **alive**, PID 15940, started 13:26:31 ET |
| Sampler job | **not registered** — verified against the full Task Scheduler list |
| Railway services | **six**, not five — `terminal-next-monitor` has joined |

⚠️ **A 30-day probe cannot read the reader's flags.** The first flag check asked for
`days=30`, which never enters the reconstructed path, so `rf_pagecache` came back
**ABSENT** — and the probe reported *UNREADABLE*, not *OFF*. The value was then taken
from the pool at zero cost to production instead.

---

## 3 · LANDING LOG

```
[09-15 13:26:31 ET] === landing sequence start ===
[09-15 13:26:31 ET] deadline: 09-16 09:25 ET
[09-15 13:26:31 ET] window open now: False
[09-15 13:26:31 ET] M14: waiting — inside push-guard hours (opens 16:05 ET)
```

Unchanged all session: the window has not opened. **Nothing pushed to master.**

---

## 4 · SAMPLER SUMMARY (regenerated)

```
BREADTH SAMPLER  ·  breadth-samples.jsonl
  rows 4   deep OK 2   warm OK 0   failures 0   refusals 2
  refusals by reason: uptime_unknown×2
  hot path: 8 files (measured by execution)   pools: 1   pool flags: ('rf_pagecache',)
------------------------------------------------------------------
POOL 1   n=2   flags {'rf_pagecache': 1.0}
  SHAs pooled (1, hot path byte-identical): 4a0995a52
              total_ms  n=2   min=   351.4 p50=  1975.5 p95= not est max=   3599.7
   reconstructed_fetch  n=2   min=    80.2 p50=  1414.5 p95= not est max=   2748.8
        rf_materialise  n=2   min=    57.4 p50=    66.8 p95= not est max=     76.3
  P(true p95 lies ABOVE the worst read seen) = 0.95^2 = 0.902
  ⛔ p95 NOT estimable: n=2, need 59 (57 more on this pool)
```

⭐ The regenerated file is **byte-identical** to the committed one (same sha1), so the
tool is deterministic over an unchanged pool — which is what R2 needs from it.

---

## 5 · EACH ITEM WORKED

### ⚰️ #40 — the report tool's terminal echo could destroy the artifact it was echoing

`_run_and_capture` wrote to `sys.stdout` **before** writing the summary file. This box's
console is cp1252 and the report's text is full of `⛔`, so `sys.stdout.write` raised
`UnicodeEncodeError`, the exception escaped, and **the summary file was never written** —
exit 1, nothing on disk, on the exact box Task Scheduler was about to run it on.

⭐ **The ordering was the whole defect**: C.1's guarantee failed by sacrificing the
**durable** half to the **disposable** half. Fixed — file first, echo cannot raise. Three
mutations, three different rails red.
⚠️ The same trap then bit an ad-hoc probe in the same session. It is a property of this
box, not of one tool.

### ✅ G1 — answered by reading the configuration (D-053)

`checkSuites: False` on all six services. Read from `Environment.deploymentTriggers` with
the CLI's own token, **field name introspected first** — asking for a field that does not
exist returns an error that reads exactly like "the setting is off".

Three things fell out of the one reading:

1. **Two workflow files in the same directory contradict each other.**
   `master-deploy-gate.yml` says Wait-for-CI holds the build; `promote-production.yml`
   says it does not gate. **The promotion workflow is right.** The gate's failure message
   — *"Railway will not build this commit"* — is false.
2. ⚰️ **The negative case already happened.** Of **59** gate runs exactly **one** failed
   (`beace00e0`), and Railway created a `web` deployment for that commit **in the same
   second**. A red gate did not prevent a deploy, in production, with nobody manufacturing
   it. That is stronger than the G5 push SD-1 planned, and it cost nothing.
3. ⚠️ **The promotion gates the tip, not every commit behind it.** `beace00e0` is an
   ancestor of `production` today — carried in as a passenger of a later green tip
   (`57e5131a3`). One gating check, the secret scan, is per-commit by construction
   (`git diff HEAD^ HEAD`), so its changed files were never scanned by a run that gated a
   deploy. `promote-production.yml` already reasons about this exact shape for the
   *cancellation* case; the red-gate route is uncovered. **Proposal only.**

### S1 — and it corrects this programme's own record

10 paths, derived from the **index** (the working tree has CRLF on everything and would
report the whole repo). ⚰️ D-052 §6 says the incident *"silently replaced another
programme's deliberate raw `\x01` bytes"*. Measured: **no joystick document carries a
control byte at HEAD or in its last 15 commits.** The only file that ever did is
`app/src/hub/useHubCursor.js` at `2d8373449`, and joystick removed it themselves.

⭐ **The two hazards are not one hazard.** eol conversion rewrites CR and LF and nothing
else — it cannot touch `0x01` or `0x1B`. What the incident flattened was **line endings**.
So the list is the CR-stored blobs, and the two files that *do* carry bare control bytes
are deliberately **not** listed, with a rail asserting the distinction.

### S2 — two measurements that change the instruction

⛔ **Appended, the call never runs.** The credential-scan loop `exit 0`s from inside
itself the moment it finds `secret_scrub.py`. Same commit, same staged out-of-scope path:

| install position | warn log |
|---|---|
| appended (the literal reading of SD-1) | **empty — never executed** |
| prepended | violation recorded |

⭐ That is the worst failure available: the trial "runs" 24 h, the log stays empty, and an
empty log reads as **zero false positives** — the promotion criterion. It would have
promoted itself to ENFORCE on the strength of never having executed.

⛔ **And the trial cannot observe anyone else until the tool is on master** — the block is
absent-safe and `git_scope.py` exists only on `repo/git-scope`, so every other worktree
skips it. **Order: land the tool → start the window → promote.**

---

## 6 · OWNER-PENDING — true keyboard items only

### ⭐ 1. The cutover (G3) — now **one change**, not two

Railway → project `luminous-recreation` → service **`web`** → **Settings** → **Source** →
change the watched branch from `master` to `production`. Wait-for-CI is already OFF, so
there is nothing else to toggle.

**Paste back:** the branch field before and after, and the time.

⚠️ Preconditions (SD-1 §4.1): outside 09:25–16:05 ET; last deploy SUCCESS and settled
≥ 600 s; `production` HEAD == master HEAD == deployed SHA; no other workstream deploy in
15 min; landing script not mid-step.

### 2. G2 — the probe, or a ruling that it can be skipped

Two of its three unknowns are already answered: environment shared variables are **0**
(control: `web` returns 248), so **the stop condition cannot fire**; and `production`
exists and is advancing. **The question is yours:** run it, or rule it unnecessary.

### 3. Log the browser in, or rule the browser path dead

The Chrome profile is **not authenticated to Railway** (project URL → "Login / 404") and
the window reports a **0×0 viewport**. An agent does not authenticate a session. If the
browser path is wanted for future G work, it needs a human sign-in once.

### 4. Whether the tool may reach master under S1/S3

`repo/git-scope` carries S1 and S3, both authorised items that can only be *done* by
landing. Merging it also unblocks S2's trial. **Not assumed** — the landing script's
queue tonight is M14 → M12 → M13, and a fourth push was not in it.

---

## 7 · OPEN QUESTIONS

1. ⚠️ **The promotion gates the tip, not the range.** Refuse promotion when any commit in
   `production..candidate` has a failed gate run? (D-053 §4 — proposal only.)
2. ⚠️ **`master-deploy-gate.yml`'s header and failure message are false** now that
   `checkSuites` is known OFF. Correcting them is another programme's file; it also
   becomes *true* the moment G3 lands, so it may be a G8 edit rather than a fix.
3. ⚠️ **Can G2 be reduced or skipped** given the shared-variable reading?
4. ⚠️ **Six services now, not five** — `terminal-next-monitor`. The cutover's watched
   branch is per-service; does it change for all six, or only `web`?
5. Carried: the resident-copy flip needs Pool A first; the sampler cap; why 11 of 20
   settled cold reads need zero extra syscalls.

---

## 8 · STATUS — three lines

**The landing script is alive and waiting for 16:05 ET; nothing was pushed to master and
no Railway setting was changed.**
**G1 is answered — Wait-for-CI is OFF, and a red gate has already shipped to production
once because of it; the cutover is now a single dashboard change.**
**S1 and S3 are built on `repo/git-scope`, S2 is blocked on that branch landing, and a
defect in M12's report tool was caught and fixed before it could ship.**
