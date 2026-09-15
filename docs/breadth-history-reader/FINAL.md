# Breadth History Reader — FINAL REPORT

> ## ⛔⛔ THIS IS A DRAFT. THE PROGRAMME IS NOT DONE.
>
> SD-1 D4 makes this the last artifact: **the checklist reads DONE when this file is
> merged.** It is being written incrementally while the programme waits for slots and
> samples (SD-1 §6), so that the closing session is an edit rather than a composition.
>
> **Every section below carries its own state.** A section marked `PENDING` has no
> number yet and must not be quoted as though it did. Do not merge this file while any
> `PENDING` remains — merging it is the act that ends the programme.
>
> Draft opened 2026-09-15, Session 13. Sections filled: **1, 2, 4, 6, 7.**

---

## 1 · WHAT THE PROGRAMME SET OUT TO DO — `COMPLETE`

**D-042** measured `GET /api/breadth-monitor?days=8000` at **54,923 ms cold** in
production, found that the cost bound was not met, that a `bucket=` parameter would not
fix it, and that the cause was **the reader itself** — not the transport, not the
serialiser, not the client.

**D-043** made the reader its own programme and span-capped `/series` until it landed.

The question the programme exists to answer:

> **Can a deep history read be made fast enough, and known to be fast enough, that the
> span cap can be lifted?**

Two halves, and the second is the harder one. *Fast enough* is an engineering problem.
*Known to be fast enough* is a measurement problem on a single-process production pod
that nobody may load-test — which is why so much of this programme is instruments, pools
and refusals rather than code.

---

## 2 · WHAT SHIPPED — `PARTIAL` (R-track items are still landing)

| Merge | What it changed | Measured band |
|---|---|---|
| **D-045** the numeric store + materialised reconstructed side | the request path reads pre-built rows instead of assembling 174,187 OHLC rows into 4,529 | ⭐ the derivation became the **builder**, not the fallback — `test_the_request_path_never_derives` is the rail |
| **D-047** pre-serialised response, cache holds bytes | removes a re-encode per request | *(fill at close)* |
| **D-049** the H1 page-cache fix, flag **ON** in production | `BREADTH_OHLC_PAGECACHE_ENABLED=1` | p90 **3,052 → 842 ms** (×3.62) · max **11,382 → 1,258 ms** (×9.05) · min `syscr` **1,669 → 182** (×9.17) · `read_bytes` max **187.51 → 0.00 MB** |
| **M12** the sampler + its report | unattended poolable sampling, p95 suppressed below n=59 | `PENDING` — in the landing queue |
| **M13** the resident copy, flag **OFF** | strings, not parsed dicts; 1.15× wire vs 5.06× | `PENDING` — the flip is a separate decision (R5/R6) |
| **S1** `.gitattributes` | 10 derived `-text` paths | no content change by construction |

⚠️ **The reader is not yet closed.** R4–R8 are all downstream of a pool that does not
exist until M12 and M13 land and the sampler runs.

---

## 3 · WHAT IS CLOSED — `PENDING`

*(R8 writes this section: the remaining floor, named, with the winning configuration's
numbers. `rf_materialise` is the known component; the rest is whatever the flip decision
leaves.)*

Already closed and not re-openable:

- **H2 lock/busy wait** — excluded.
- **H3 plan variance** — excluded.
- **H5 per-seek latency × seek count** — **CLOSED by operation count**: per-syscall cost
  went *up* (0.591/0.597 ms → 0.822/1.369 ms) while the count fell 8,883–14,800 → 551–642.
  The win was never per-seek cost.
- **The `/series` span cap** — **D-046**: stays at **365**, on the UI-maximum argument,
  independent of anything the reader achieves.

---

## 4 · WHAT IS OWNER-PENDING — `CURRENT as of Session 13`

| # | Item | Why it cannot be an agent's |
|---|---|---|
| 1 | **G3 — the cutover.** Railway → `web` → Settings → Source → watched branch `master` → `production`. **One change**; Wait-for-CI is already off. | A production deploy-topology change |
| 2 | **G2 — run the probe, or rule it unnecessary.** Its stop condition is already measured as unable to fire (0 shared variables). | The ruling is the owner's |
| 3 | **Sign the browser in, or rule that path dead.** The profile is not authenticated to Railway; the window is 0×0. | An agent does not authenticate a session |
| 4 | **G6 — branch protection on `production`.** | GitHub admin |
| 5 | **May `repo/git-scope` reach master?** It carries S1 and S3 and unblocks S2. | Not in the authorised landing queue |

---

## 5 · WHAT IS PROPOSED AND NOT BUILT — `PENDING`

- ⚠️ **Promote the range scan to gating.** Built and shipped **advisory** under SD-1.1 A2.5
  (`repo/range-scan`, `docs/breadth/range-scan-finding.md`). It is advisory because a check
  that has never been watched fire must not be able to block. Promotion criterion: **≥ 20
  runs logging `range-scan: EXECUTED … verdict=CLEAN`** — `INCONCLUSIVE`, `NO RANGE`,
  `NOTHING AHEAD` and `NOTHING-TO-SCAN` deliberately do not count — **or the first true
  finding after review.**
- ⚠️ **Or fix the merge direction instead — these are alternatives, not a pair.** The gate
  scans `HEAD^..HEAD`, and `HEAD^` is the *first parent*. Landing via
  `checkout branch; merge master; push branch:master` makes the branch the first parent, so
  the scan covers **master's** side. Landing via `checkout master; merge branch` (or a
  GitHub squash) puts the old master first and scans correctly.
- **The next reader candidate**, if any — R8 writes it, as a proposal only.
- *(more at close)*

### ⚰️ The measurement behind both, and it was not the one this was authorised for

Range gating was authorised for a single red-gate commit that rode in behind a later green
tip. Measuring it found something structural:

| | |
|---|---|
| first-parent commits reaching `production` since the gate existed | **85** |
| with **no gate run of their own** | **66** |
| largest single push | **18 commits** |
| ⭐ this programme's own M14 push — gate scanned vs actually introduced | **11 files vs 3, overlap 0** |

⭐ **The last row is the finding.** On a merge whose first parent is the feature branch, the
scan does not miss part of the change — **it scans the other side**, eleven already-gated
files belonging to somebody else's work, and none of the three the push existed for.

---

## 6 · THE STANDING RULES THAT SURVIVE THIS PROGRAMME — `CURRENT`

These are the ones that generalise past the reader. They are the programme's real output.

1. ⭐ **An empty result is a failed invocation until proven otherwise.** Applied to
   greps, sweeps, rails — and, in Session 13, to *where a check is installed*: a hook
   placed after an `exit 0` returns no violations, and no violations is indistinguishable
   from working.
2. ⭐ **A non-vacuity count of zero is not a passing check — it is an unrun one.** Drive
   the discriminator.
3. ⭐ **A cheap freshness check may only ever answer "definitely unchanged."** Any other
   answer triggers the full rebuild — never a second cheap check. (Three invalidation
   designs, one test killed all three.)
4. ⭐ **The hot path is what a real request EXECUTES**, not what it imports. Eight files,
   not 169 — and the difference is whether a measurement pool can ever reach n = 59.
5. ⭐ **A process-wide counter needs a plausibility check.** `/proc/self/io` is not
   request-scoped; an implied bandwidth of 3,942 MB/s is how that was caught.
6. ⭐ **A question about configuration is answered by reading the configuration.** Three
   sessions carried "is Wait-for-CI on?" as an owner step; it was one API read.
7. ⭐ **Absolute instants in clock code, never wall-clock comparisons.** And knowing a
   clock is dangerous is not the same as knowing which operation on it is wrong.
8. ⭐ **A harness field is named for what it holds after every transform applied to it.**
   (`decoded_bytes` held gzipped bytes and nearly reported a 6.7× regression.)
9. ⭐ **No number in prose unless it appears in a table or a tool output.** A median is
   never substituted for a measurement.
10. ⭐ **Stage by name. Never `git add -A`.** Now mechanised, not merely written down.
11. ⭐⭐ **A check that speaks only when it finds something cannot be distinguished from a
    check that never ran.** Met three times in one day: an empty WARN log reading as *zero
    false positives*; a pause logged only on state change, so a re-pause was invisible; and
    a range scan that would have printed *"nothing to scan"* on every run because its base
    was unreachable. **Every instrument that can be silent must heartbeat**, and its
    "we could not measure" state must be distinct from its "we measured nothing" state.
12. ⭐ **One worktree, one writer.** A long-running script and an editing session cannot
    share a checkout. Paid for three times in one session — a sequence killed mid-flight, a
    correction staged onto the branch one push from master, and a third near-miss three
    commits after the rule was written. **The fix is to remove the opportunity, not to be
    more careful.**

---

## 7 · THE OPERATIONAL FINDING — `CURRENT`

The programme's most reusable non-technical result, and the one that cost it the most
time:

> **A single 600 s settle is usually available on this repository; a 45-minute run is
> not.** Measured 2026-09-15: 20 deploys in 11.0 h, median gap 925 s, **15 of 19** gaps
> ≥ 600 s, but only **3 of 19** ≥ 45 min.

⚰️ And the finding that outranks it, from Session 13: **the gate everyone believed was
holding deploys was not.** Railway's Wait-for-CI is off, the `master deploy gate`
serialises pushes but does not gate them, and a commit whose gate run **failed** was
deployed in the same second. The cutover is what turns the gate into a gate.

---

## 8 · CLOSING STATEMENT — `PENDING`

*(Written by the session that merges this file. It should say, in three sentences, what a
deep read costs now, what it cost at D-042, and what the next programme would have to do
to move it further.)*
