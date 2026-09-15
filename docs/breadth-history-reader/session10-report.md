# Breadth History Reader — Session 10 report

**Origin:** D-042 measured `/api/breadth-monitor?days=8000` at **54,923 ms cold** in
production. Session 9 measured the H1 page-cache fix at **×9.05 on the tail** and turned it
on. Session 10 makes that flag *recordable*, produces the cutover runbook, and settles —
with a measurement rather than a configuration reading — whether the deploy gate serialises.

**No measurement windows this session** (decision 0.1). Every number below is either from
Session 9's two windows, from a tool run today, or from a table in this report (rule H.1).

**Published page:** *(URL at the end of this file)*

---

## THE HEADLINE

| | |
|---|---|
| **The gate serialises — proven** | run B queued **97 s** behind run A (baseline 3–5 s), and an unplanned **real master push queued 47 s behind B**. First contention in the workflow's 41-run history. |
| **The flag is now recordable** | `BREADTH_OHLC_PAGECACHE_ENABLED`, ledger row armed, and deleting that row now **reds a repo-wide rail** that previously could not see the flag at all. |
| **Zero off-window on the flip** | staged with `--skip-deploys` while M10 was still building, so the flag went old-name-ON → new-name-ON with **no deploy of its own and no moment off**. |
| **Cutover: still NO-GO** | one precondition left (G-3), and it is a dashboard question, not an agent one. |

---

## A. State check

### A.1 Where everything is

| | |
|---|---|
| `origin/master` at session start | `cb0949d8c` — **0 commits since Session 9** |
| master after M9 / M10 | `444f747d8` → `30fd58aef` |
| production deployed hash | `30fd58aef`, SUCCESS `08:56:50Z` (then another workstream's `8578d375d`) |
| `breadth/fetch-shape` | `7a79cc9d3` — built, **not merged**, SHELVED (0.3) |

**Reader-path byte identity.** Two independent checks:

1. **Code:** `git diff origin/master...HEAD -- api/` = **0 files** on the docs branch —
   identical by construction. Non-vacuity: the same diff does change **1** file, under
   `docs/`.
2. **Wire:** `days=365` returns **69,979 bytes** today, and the same request returned
   **69,979** in both arms of Session 9. Repeat-request identity confirmed over 69,979
   bytes compared.

**Flag state read from the instrument, not the variable list:** `days=7330`, forced miss →
`rf_pagecache = 1.0`, `rf_rows = 4529`, `rf_bytes = 4,523,328`, `rf_stmts = 12`.

> ### ⚰️ A.1 nearly reported a 6.7× change in the reader output that never happened
>
> The first wire check returned **471,689 bytes** against Session 9's recorded
> `decoded_bytes = 69,979`. That reads as the reader output changing by 6.7×.
>
> It did not. `s9_window.py:90` is `rec["decoded_bytes"] = len(raw)` — **a field named
> `decoded_bytes` holding the GZIPPED wire bytes.** Session 9's harness sent
> `Accept-Encoding: gzip` and never decompressed. Measured today: raw **69,979**,
> decompressed **471,689**.
>
> ⭐ Nothing in Session 9 is invalidated — the field was used identically in both arms, so
> every comparison holds. But **the name asserted a property the value did not have**, and
> the first thing it did on being read by a different session was manufacture a regression.
> Appendix **#24**.

### A.2 Session 9's open questions — verbatim, with recommendation and classification

| # | Session 9's words | recommendation | class |
|---|---|---|---|
| 1 | *"Rename the flag so the ledger can see it? — the first thing Session 10 should do, and it is coupled to D.5's keep ON."* | **Done** — M10 + V2, §B | **adopted** |
| 2 | *"Merge the range-scan shape? — recommendation: no, and do not delete it either. §D removed the case it was built for."* | **Shelved**, revival condition recorded in D-050 | **adopted** (0.3) |
| 3 | *"Is 'Wait for CI' enabled on web? … the highest-value question in this report … Answerable only from the Railway dashboard (A.4, the owner's) — one look, not an experiment."* | **Still open.** It is step 3 of the cutover runbook, where the owner records the pre-change state | **needs the owner** |
| 4 | *"A quiet hour for measurement windows? … it is a scheduling decision, not an engineering one."* | **Still open**, and D.3 now prices it: p95 needs **n ≥ 59** | **needs the owner** |

### A.3(a) H3 vs H5 for the ordinary range — settled, by counting operations not bytes

**Verdict: H5, and the mechanism is now arithmetic rather than inference.** The fix did
**not** make storage faster; it made the reader ask for storage **fewer times**.

Per-read-syscall cost, computed as `rf_fetch ÷ (syscr − that window's own syscr floor)` on
every sample where the request genuinely was doing I/O:

| arm | syscr floor | slow samples | extra syscalls | `rf_fetch` | **ms per extra syscall** |
|---|---|---|---|---|---|
| OFF | 1,669 | i=3 | 8,883 | 5,304.1 ms | **0.597** |
| OFF | 1,669 | i=2 | 14,800 | 8,742.7 ms | **0.591** |
| ON | 182 | i=7 | 551 | 452.8 ms | **0.822** |
| ON | 182 | i=8 | 642 | 879.2 ms | **1.369** |

⭐ **The per-operation cost did not improve — it got slightly worse (0.59 → 0.82–1.37 ms).
What collapsed is the COUNT: 8,883–14,800 → 551–642, a ~20× reduction.** That is H5's model
exactly: *time = seek count × per-seek latency*, with the flag attacking the first term and
the second being a property of the volume.

⚠️ The ON arm's higher per-op cost is a **hypothesis, not a finding**: with mmap the
surviving operations are plausibly the genuinely-scattered cold ones, where OFF's larger
count included readahead-friendly reads that averaged the figure down. Two samples per arm
cannot settle it.

**What remains unexplained:** why *some* settled cold reads need 551–642 extra syscalls
while **11 of 20 need exactly zero**. The page cache is usually warm and occasionally is
not; the eviction trigger is unidentified. That is the residual, and it is H1's territory,
not H5's.

### A.3(b) What a deep cold read is made of now (flag ON)

Composition of three ON samples, phases ≥ 0.05 ms, 95–98% accounted:

| phase | **p50 sample** (281.7 ms) | **p90 sample** (986.2 ms) | max sample (1,257.7 ms) |
|---|---|---|---|
| `numeric_fetch` | 6.2 | 55.5 | 54.4 |
| **`reconstructed_fetch`** | **62.3** | **671.8 (68%)** | **975.6 (78%)** |
| — of which `rf_fetch` | 8.5 | **607.1** | **879.2** |
| — of which `rf_materialise` | 50.8 | 54.4 | 78.4 |
| `merge_rows` | 6.5 | 8.2 | 7.2 |
| `derive` | 76.1 | 80.7 | 71.0 |
| `serialise` | 66.5 | 73.7 | 78.2 |
| `encode_render` | 49.7 | 47.6 | 44.1 |

**Where the remaining ~840 ms at p90 sits: `rf_fetch`.** 607 ms of the 986 ms sample is
cold-page fetching, plus 55 ms in `numeric_fetch` (the other table's read). Everything else
is flat across all three columns.

**The floor no I/O fix can go below** — phase medians across all 20 ON samples:

| phase | p50 | min |
|---|---|---|
| `derive` | 70.5 | 63.5 |
| `serialise` | 63.3 | 53.5 |
| `encode_render` | 46.4 | 41.6 |
| `rf_materialise` | 48.0 | 39.5 |
| `merge_rows` + `adv_seed` | 7.3 | 5.3 |
| **sum** | **235.5** | **203.4** |

Observed minimum total across the arm: **243.0 ms**. So the floor is **~235 ms at p50**, of
which `rf_materialise` is 48.0 and the CPU trio (`derive` + `serialise` + `encode_render`)
is **180.2**. Live I/O at p50 is `rf_fetch` 7.9 + `numeric_fetch` 7.9 = **~16 ms, 6% of the
total.**

### A.4 Re-emitted clean

**The Session 9 A/B, both arms, all fields.** Settle floor uptime ≥ 640 s; arm read from
`rf_pagecache` on each request; `rf_rows = 4529` and `rf_bytes = 4,523,328` on every sample
in both arms.

| `deep_cold` | OFF (n=19) | ON (n=20) | |
|---|---|---|---|
| p50 | 309.0 ms | 281.0 ms | ×1.10 |
| p90 (interpolated) | 3,052.0 ms | 842.0 ms | ×3.62 |
| p90 (nearest-rank) | — | 986.2 ms | |
| max | 11,382.4 ms | 1,257.7 ms | **×9.05** |
| min | 271.0 ms | 243.0 ms | |
| `reconstructed_fetch` p50 / max | 70.6 / 9,072.9 | 61.5 / 975.6 | ×9.30 on max |
| `rf_fetch` p50 / max | 8.7 / 8,742.7 | 7.9 / 879.2 | ×9.94 on max |
| `rf_materialise` p50 / max | 57.7 / 143.8 | 48.0 / 81.7 | |
| `rf_stmt_sum` p50 / max | 10.8 / 8,854.9 | 10.4 / 893.3 | ×9.91 on max |
| **min `syscr`** | **1,669** | **182** | **×9.17** |
| `amp` (rchar ÷ bytes returned) p50 / max | 1.5× / 51.6× | 0.2× / 51.0× | |
| max `read_bytes` | 187.51 MB | 0.00 MB | |
| `rf_busy_retries` | 0 on all | 0 on all | |

| `warm_365` | OFF (n=10) | ON (n=10) |
|---|---|---|
| p50 / p90 / max | 20.1 / 49.3 / 123.9 ms | 16.0 / 19.9 / 20.7 ms |
| min `syscr` | **79** | **79** |
| `decoded_bytes` (gzipped wire) | 69,979 | 69,979 |
| priming read `rf_rows` / `rf_bytes` | 205 / 185,306 | 205 / 185,306 |

⚠️ **`warm_365` is the control and it moved.** Recorded as **INCONCLUSIVE** in D-049 and
going to OPEN QUESTIONS with the window that would settle it (D.4).

**The three deploys supporting "Railway is not waiting"** — full timeline in
`docs/breadth/deploy-gate-cutover-runbook.md` §C.1. Build start/finish are **not** available
(`railway deployment list` returns only `status`, `createdAt`, `id`, `meta`), which is
itself part of why C.2.i needs the dashboard.

| commit | push / deploy `createdAt` | gate start | gate finish | pod boot (swap) | SUCCESS seen |
|---|---|---|---|---|---|
| `6b606990c` | 05:10:54 | 05:10:58 | 05:12:53 | 05:12:55 | — |
| `587ee51b2` | 05:30:52 | 05:30:56 | 05:32:54 | **05:32:36** | — |
| `cb0949d8c` | 06:37:55 | 06:38:08 | 06:40:14 | 06:40:12 | 06:40:29 |

---

## B. The flag rename — done

### B.1 Every read of the old name

| file | occurrences | action |
|---|---|---|
| `api/services/breadth_daily_ohlc.py:49` | 1 (the only code read) | **renamed** |
| `tests/test_breadth_pagecache_flag.py` | 6 | **renamed** |
| `docs/breadth/flow-worker-strand-pagecache.md` | 1 (live description) | **renamed** |
| `docs/breadth/DECISIONS.md` (D-049) | 3 | **kept** — historical record |
| `docs/breadth-history-reader/session9-report.md` | 6 | **kept** — historical record |
| `docs/breadth-history-reader/session9-window-b-predictions.md` | 1 | **kept** — historical record |
| `.env.example` | **0** | — |
| Railway `web` variable | 1 | **V2** |

⛔ **The split is deliberate.** A historical record states what was true then; a live
description states what is true now. Rewriting the Session 9 report would falsify the
record — it *was* `BREADTH_OHLC_PAGECACHE` in Session 9.

### B.2 The ledger row

`is_gate("BREADTH_OHLC_PAGECACHE_ENABLED")` → **True** (the old name → False, which is why
it was invisible). `needs_declaration(NEW, "")` → **True**, so the row is now **required**,
not merely permitted.

Row: `status: armed`, `where: ["web"]`, owner, and a note carrying the measurement that
justifies ON (D-049) plus what is *not* settled. Ledger diff: **8 insertions, 0 deletions** —
the reserialisation matched the file's existing style exactly.

### B.3 Rails, and the mutation proof

Six new tests. The design point: ⛔ **they are AST-derived, never text searches.**
`breadth_daily_ohlc.py` deliberately **still contains** the old string — in the comment
explaining the rename. A grep rail would match its own explanation and demand the deletion
of the reason, which is this repo's most frequently re-committed instrument defect. The
rails use `feature_flag_index.scan()`, which walks source with `ast`.

| mutation | result | test that fired |
|---|---|---|
| a fallback to the old name reintroduced | **RED** 1/20 | `test_the_old_flag_name_is_read_nowhere` |
| renamed back entirely | **RED** 8/20 | `test_the_scan_can_see_this_flag_at_all` (the non-vacuity control) |
| code default flipped to ON | **RED** 2/20 | `test_the_code_default_is_still_OFF_after_the_rename` |
| ledger row deleted | **RED** 1/20 | `test_the_ledger_declares_it_and_says_it_is_on` |
| **ledger row deleted — repo-wide rail** | **RED** 1/185 | **`test_every_off_by_default_gate_is_declared`** |

⭐ **The fifth is the point of the whole workstream.** Before the rename, deleting the row
was impossible because the row could not exist. After it, the repo-wide ledger rail enforces
the record. Files restored, sha match on all.

**Parity EXACT**, four runs — golden/OFF, golden/ON (old name), renamed/OFF, renamed/ON (new
name) — all `sha256 7695923c…` over **5,576,278 bytes**, side discriminator reporting
golden/golden/renamed/renamed. ⚠️ Recorded with its limit: every arm is byte-identical *by
design*, so parity says nothing about whether the flag was applied. That is what the pragma
read-back and the behavioural no-fallback test are for.

**flow-worker: INERT.** Coverage goes red on `breadth_daily_ohlc.py` (a review gate, not a
block). Measured: **neither variable is set on flow-worker, worker or bars-api** — only
`web`. Stale flow-worker reads the old name (unset → early return); current reads the new
name (also unset → identical early return). No ordering of the deploy and the variable
change produces a difference there.

### B.4 ✅ Question B.a — is `DESK_PUBLIC_SHOWS` the same shape today? **No**

| | |
|---|---|
| `is_gate` | **False** — same as the old flag name |
| `is_visibility_flag` | **True** ← this is the difference |
| ledger row | **present**: armed, `where: ["web"]`, exposure public, default `sunday scans` |
| `owner_decision` | present and dated: *"Owner decision 2026-08-19, reaffirmed 2026-09-13…"* |
| live value | `*` — the wildcard the dated decision authorises |

**Not a candidate; nothing to touch.** It *had* this shape and was fixed on 2026-09-13 by a
different mechanism: a second **axis** in the index, because "who can see the output" is a
genuinely different question from "does this feature run".

⭐ **That contrast is the useful part.** There were two possible fixes for invisibility —
add an axis, or rename the flag. The Desk case needed an axis; this flag is an ordinary gate
that merely had the wrong name, so a rename is right and an axis would have been
over-engineering.

### B.5 V2 — and it cost no deploy of its own

| | |
|---|---|
| new variable staged | **08:57:54Z**, `variable set … --skip-deploys` — **no deploy triggered** (queue still showed only M10) |
| M10 deploy | created 08:56:50Z → **SUCCESS 08:58:59Z** |
| flag confirmed under the new name | `rf_pagecache = 1.0` on the new pod |
| **old name unset** | **09:01:51Z** (308 s after the M10 push) |
| final config | `BREADTH_OHLC_PAGECACHE_ENABLED=1`, old variable gone |

⭐ **`--skip-deploys` is the finding.** V2 anticipated either one combined change or
set-new-then-unset-old with a gap. Staging the new variable **while M10 was still building**
meant the new container started with it already present: the flag went old-name-ON →
new-name-ON with **zero moments off**, and V2 added no deploy at all.

⚠️ **I very nearly got the ordering wrong.** Pushing M10 first would have left the flag OFF
between the rename deploy and the variable set. The zero-gap ordering is *set the new
variable first* — and `--skip-deploys` is what makes it free. `variable delete` has **no**
`--skip-deploys`, so the unset is the one step that must cost a deploy.

---

## C. Cutover readiness

Full runbook: **`docs/breadth/deploy-gate-cutover-runbook.md`**. Summary:

- **C.1** the model, with the three-deploy table: Railway builds immediately, the gate runs
  in parallel, they finish together by coincidence.
- **C.2.i** ⚠️ **the one open unknown** — does a `GITHUB_TOKEN` push to `production` trigger
  a Railway build? Probe designed around a blast radius that is **not** small: a second app
  copy can inherit shared variables, and with `MASSIVE_API_KEY` it would kick flow-worker off
  a tape that does not replay. Hence a service whose start command exits 1 — the build proves
  the trigger, the app never runs.
- **C.2.ii** ✅ **verified** — §E.
- **C.3** five numbered steps with owner, verification and rollback each.
- **C.a** ✅ **answered by measurement, and my first draft had it backwards** — see below.

### ✅ C.a — the pre-push guard covers every worktree on this machine

Draft answer: *"only the checkouts somebody put it in"*, reasoned from the correct premise
that hooks are untracked (`git ls-files .git/hooks` = **0**). Measured:

```
git config --get core.hooksPath  ->  C:\Users\Patrick\uct-dashboard\.git\hooks
git rev-parse --git-common-dir   ->  C:/Users/Patrick/uct-dashboard/.git
<common>/hooks/pre-push          ->  PRESENT
```

⭐ `core.hooksPath` lives in the repository's **shared** config, which every worktree reads.
All ~80 worktrees resolve to one hooks directory and the guard is in it — **by construction,
not by luck.** `MIN_SETTLE_SECONDS = 150`.

⛔ Three limits: a fresh clone elsewhere gets nothing; `--no-verify` bypasses it without
trace; a worktree could override the path. **From the server's side a missing hook and
`--no-verify` are indistinguishable** — which is exactly what a server-side gate fixes.

---

## D. What is left in the reader (analysis only — nothing built)

### D.1 A process-resident copy of `breadth_reconstructed_daily`

**Measured on the real 4,700-row table** (41,861,120 B file, mean 1,005 B of metrics/row;
raw text 4,725,369 B):

| resident form | bytes | |
|---|---|---|
| **(a) `dict[date] -> json str`** | **5,214,625** (5.21 MB) | ← the reader's own return shape, **+10% over raw text** |
| (b) `list[(date, json)]` | 5,453,449 (5.45 MB) | |
| (c) two lists + index dict | 5,669,685 (5.67 MB) | |
| (d) parsed to dicts (est. from 400 rows) | 22,176,456 (22.18 MB) | **4.3× (a)** — D-047's trap, re-measured |

⭐ **Form (a) is both the cheapest and the shape the reader already returns.** Against a pod
RSS observed today at **1,961–3,204 MB**, 5.21 MB is **~0.2%**.

**What it removes:** `reconstructed_fetch` entirely — *both* `rf_fetch` **and**
`rf_materialise`, since a resident dict needs no materialisation. From A.3(b):

| | now (ON) | with D.1 | |
|---|---|---|---|
| p50 | 281.7 ms | **~219 ms** | −62.3 |
| p90 sample | 986.2 ms | **~314 ms** | −671.8 |

**Invalidation and writer coupling — the real cost.** The table's writer is the
reconstruction path, not the request path, so the resident copy must be refreshed when that
writer commits. ⛔ **The web pod is one uvicorn process but it is not the writer**, so this
needs either a version/mtime check per request (cheap: one `stat`, and it reintroduces a
syscall the flag just removed) or a notification path that does not exist today. **That
coupling is the whole design risk, and it is larger than the 5 MB.**

**Resulting reader floor:** `derive` + `serialise` + `encode_render` ≈ **180 ms at p50**,
plus `merge_rows`/`adv_seed` ≈ 7 ms. **~187 ms**, with no I/O left on the request path at
all except `numeric_fetch`.

### D.2 Next-largest after that: `derive`

With `reconstructed_fetch` gone, the ranking at p50 is **`derive` 70.5 → `serialise` 63.3 →
`encode_render` 46.4 → `rf_materialise` 48.0** (removed with D.1). `derive` is pure CPU —
the rolling/derived metrics computed server-side — and is flat across the whole distribution
(63.5–90.8 across 20 samples), so it is a *floor* item, not a tail item. **Ranked second and
recommended AFTER D.1**, because D.1 removes 9× more at p90 than `derive` could at p50.

### D.3 The cap, restated — and the ~1 s bar is **not** established at p95

| | |
|---|---|
| samples over 1,000 ms | **1 of 20** (1,257.7 ms) |
| p90 | 842.0 ms (interpolated) / 986.2 (nearest-rank) — **under 1 s either way** |
| P(true p95 lies **above** the observed max) | **0.95²⁰ = 0.358** |
| n needed for the sample max to be a 95% upper bound on p95 | **59** |
| can we claim p95 ≤ 1,000 ms at 95% confidence, n=20? | **No** — P(Binom(20, 0.95) ≤ 19) = 0.642, which is not small |

⛔ **So: the ~1 s bar is met at p90 and is NOT established at p95.** At ~20 settled samples
per surviving window and roughly one window in five surviving, n ≥ 59 is about **three clean
windows ≈ fifteen attempts** — which is D.3's real content: *the bar is now limited by
measurement opportunity, not by the reader.*

**Should anything about the cap change? No.** The `/series` span cap stays at 365 (D-046).
The UI-maximum argument is unchanged: the UI never requests more than 365, so lifting the
cap exposes nothing — and nothing in Session 9 or 10 touches that reasoning. **This is a
record update, not a change.**

### D.4 The window that would settle P-B4

| element | value |
|---|---|
| set | `warm_365`, the same key every time (body-cache hit) |
| n | **≥ 10 per arm**, both arms on a settled pod (uptime ≥ 640 s) |
| arms | flag OFF and ON, read from `rf_pagecache` **on the priming read** (a hit carries no flag stamp) |
| **validity conditions** | (1) min `syscr` equal in both arms — it was **79/79**, so this held; (2) `decoded_bytes` equal — **69,979/69,979**, held; (3) **no deploy inside either window**; (4) ⭐ **the new one: a concurrent-load control**, because the OFF arm's outliers (123.9, 41.0, 37.2 ms) carried *ordinary* I/O counters and were event-loop contention |
| what would make it conclusive | the warm p50 difference surviving when the two arms are matched on event-loop load — e.g. interleaving the arms rather than running them consecutively |

⭐ **The design flaw in Session 9's version was consecutive arms**, which confounds the flag
with whatever else the single uvicorn process was doing. **Interleaving is the fix** and it
costs nothing but a flag flip between samples — which is not possible without a redeploy, so
in practice it means two windows run at matched times of day.

---

## E. Contention proved — without a deploy

Predictions committed before either push:
`docs/breadth-history-reader/session10-gate-contention-predictions.md`.

**Mechanism.** For a `push` event GitHub evaluates the workflow file **as it exists on the
pushed ref**, so adding `gate-test/**` to `on.push.branches` **on the throwaway branch only**
made the gate run there with master's copy untouched — no third master push. The
`concurrency` group is the literal `master-deploy`, so the test runs joined **the same queue
master promotions use**.

**Proof that no deploy could result** — four independent reasons: all 20 sampled deploys
carry `meta.branch = 'master'`; 211 remote heads have never deployed;
`promote-production.yml` triggers on `workflow_run` filtered `branches: [master]`; and the
gate workflow has no promotion step at all.

### E.3 Result

| run | branch | created | started | **queue** | ended | total | conclusion |
|---|---|---|---|---|---|---|---|
| A `d15a2d855` | `gate-test/contention` | 09:06:05 | 09:06:08 | **3 s** | 09:07:57 | 112 s | success |
| B `aa971be13` | `gate-test/contention` | 09:06:24 | **09:08:01** | **97 s** | 09:10:06 | 222 s | success |
| **C `8578d375d`** | **`master`** (another workstream) | 09:09:24 | **09:10:11** | **47 s** | — | — | — |

Pushes were **17 s** apart. Predicted queue wait for B was `gate_total(A) − 17 s`; A's total
was 112 s, so **predicted 95 s, observed 97 s**.

| prediction | result |
|---|---|
| **P-E1** B's queue jumps from 3–5 s to 80–155 s | ✅ **97 s** |
| **P-E2** B starts at or after A's completion | ✅ **+4 s** after |
| **P-E3** neither run cancelled | ✅ both `success` |
| **P-E4** zero deploys | ✅ no deployment carries a non-master branch; no `promote-production` run for the test branch |
| **P-E5** same workflow, same group | ✅ both under `master deploy gate` |

⭐⭐ **Row C is the strongest evidence and it was unplanned.** A *real* master push arrived
mid-test and queued **47 s**, starting **5 s after** run B finished. That proves the test
branch and master genuinely share one queue — using production traffic rather than a
synthetic case, which no deliberate design could have arranged.

⚠️ **And it is the honest cost: the test delayed another workstream's deploy by ~43 s.**
The throwaway branch was deleted; master's workflow file is unchanged
(`branches: [master, main]`) and the marker file never existed on master.

### E.4 Consequence

**Serialisation is proven, so the go/no-go moves to "C.2.i + keyboard steps only."** G-1 was
the last item an agent could settle.

⛔ **But serialising the CHECKS is not spacing the DEPLOYS.** §A.4's three deploys still say
Railway does not wait for CI. Both things are now true at once: the gate's queue works, and
it does not currently gate anything Railway does.

---

## F. Records written

| file | what |
|---|---|
| `docs/breadth/DECISIONS.md` | **D-050** — see F.1 |
| `docs/breadth-history-reader/00-profile.md` | Session 10 section + appendix **#24–#27** |
| `docs/breadth/deploy-gate-cutover-runbook.md` | the runbook (C) |
| `docs/breadth/flow-worker-strand-pagecache.md` | M10 addendum — INERT |
| `docs/feature_flags.json` | the ledger row |

### F.4 The operational finding, recorded as a consequence

**37 master pushes in 10.5 h; median gap 723 s (12.1 min); minimum 152 s.** A window needs
~26 min (640 s settle + ~15 min sampling); only **19%** of gaps are that long.

⛔ **Consequence: production measurement in this repo is not possible at the required
sample size without either a push pause or the cutover.** D.3 prices it exactly — p95 at 95%
confidence needs **n ≥ 59**, i.e. ~3 clean windows, i.e. ~15 attempts at the current rate.

---

## KEYBOARD STEPS FOR THE OWNER

Numbered, in order. Full detail in `docs/breadth/deploy-gate-cutover-runbook.md`.

### 1 · Answer the highest-value open question — 1 minute
Railway → `luminous-recreation` → service `web` → Settings → Source.
**Record whether "Wait for CI" is currently ON or OFF, before changing anything.**
→ *Paste back:* the toggle's state. This settles a question open since Session 9 that no
CLI can read.

### 2 · The C.2.i probe — ~10 minutes, then wait for any master push
Runbook §C.2.i has the click path. In short: new service `cutover-probe` from this repo,
branch **`production`**, custom start command `echo … && exit 1`, **no variables, no domain,
no volume**.
⛔ **If the UI shows inherited shared variables you cannot remove, STOP** and report that —
the probe is unsafe in that configuration (a booted copy can kick flow-worker off the OPRA
tape, which does not replay).
→ *Paste back:* whether a deployment appeared on `cutover-probe` after the next promotion,
its timestamp, status word and commit SHA. **A deployment that FAILED at start is the
expected success case.**
→ Then delete the service.

### 3 · Branch protection on `production` — 3 minutes *(only after step 2 succeeds)*
Runbook §C.3 step 1. Restrict pushes to the workflow, block force-push, block deletion.
→ *Verify:* `git push origin master:production` from a terminal must be **rejected**.
→ *Paste back:* the rejection message.

### 4 · Switch the watched branch — 1 minute
`web` → Settings → Source → Branch: **`production`**. Do not redeploy manually.
→ *Paste back:* a screenshot of the Source panel.

### 5 · Turn Wait-for-CI OFF — 1 minute
Same page. It is not holding anything (§A.4); leaving it on is a signal that reads as
protection and provides none.

### 6 · Decide the quiet hour (or decline to) — no keyboard
See D.3. Without it, p95 cannot be established at the current push rate.

---

## OPEN QUESTIONS

1. ⚠️ **Is "Wait for CI" enabled on `web`?** (keyboard step 1) — open since Session 9, and
   the highest-value single reading available.
2. ⚠️ **Does a `GITHUB_TOKEN` push to `production` trigger a Railway build?** (G-3, keyboard
   step 2) — **the only thing blocking the cutover.** If it does not, switching the watched
   branch silently stops *all* deploys, and the symptom is no deploys rather than an error.
3. ⚠️ **P-B4 — the warm control moved** (20.1 → 16.0 ms p50) and Session 9's consecutive-arm
   design cannot distinguish the flag from event-loop load. D.4 has the window; it needs a
   quiet period.
4. ⚠️ **Which half of the flag carries the win** — `mmap_size` or `cache_size`. Evidence
   *leans* mmap (a 9× `syscr` collapse is mmap's signature specifically), but one A/B cannot
   decompose two coupled changes.
5. ⚠️ **Memory under the flag is unmeasured.** No OFF-arm RSS baseline was captured, and
   today's readings (1,961–3,204 MB) are all flag-ON and mostly on unsettled pods.
6. ⚠️ **A quiet hour for windows** — a scheduling decision. D.3 prices it: n ≥ 59.
7. ⚠️ **Why do 11 of 20 settled cold reads need zero extra syscalls and the rest need
   551–642?** The eviction trigger is unidentified (A.3(a)).

---

## PROPOSED SESSION 11

1. **Nothing until keyboard steps 1–2 come back.** G-3 gates the cutover and no agent can
   answer it.
2. **If G-3 passes:** execute the cutover with the owner (runbook §C.3), then verify with
   the discriminating case — a *failing* gate must leave the deployed SHA at the old
   `production` while master moves ahead.
3. **If a quiet hour is agreed:** the P-B4 interleaved window (D.4) and the n ≥ 59 deep-cold
   accumulation for p95 (D.3), in that order — P-B4 is cheap and settles a control that is
   currently marked inconclusive in a shipped decision record.
4. **D.1 as a design, not a build** — the 5.21 MB is not the risk; the writer-coupling and
   invalidation path is. Propose it against a named invalidation mechanism or not at all.
