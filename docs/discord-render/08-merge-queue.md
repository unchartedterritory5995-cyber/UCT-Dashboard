# 08 — Merge queue

Ordered, integrated, gate-green branches waiting for master. One master merge at a time; the next
one is gated and ready **while** the previous waits for `web` SUCCESS, so the deploy wait costs
nothing (07-execution-plan §2).

⛔ **A ROW IS ONLY "READY" IF IT NAMES THE SHA IT WAS GATED AGAINST.** "Gate green" without the base
is a claim about a tree nobody can reconstruct — and master moves under this branch every few
minutes on a Sunday evening.

⛔ **RE-GATE ONLY WHAT MASTER'S MOVEMENT INVALIDATES.** The decision is made with the scoped-file
gate, not by re-running everything: if `git diff --name-only <gated-base>..origin/master` shares no
file with the branch's own changed set *and* touches nothing the branch's scoped files import, the
gate still stands and the row keeps its status. Anything else re-gates. Record which of the two
happened — a row that silently kept a stale green is the defect this column exists to prevent.

---

## Queue

| # | Branch | Step | Gated against | Scoped gate | Mutations | Status |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | *(empty — all five lanes integrated, see below)* |

## Merged (this push)

| # | Branch / SHA | Step | Gate | Deploy | Running SHA |
|---|---|---|---|---|---|
| 5 | `5ca4d5db2` | 2.4b P2.1–P2.10, dark | 44 files, **1,112 passed** | SUCCESS | `5ca4d5db2385` ✅ verified in-process |
| 5a | `954309f0f` | merge-5 record (docs) | n/a — docs only | SUCCESS | `954309f0f` ✅ |
| 7 | `2b3ffd637` | shadow ON + the record made interpretable | 24 passed | SUCCESS | `2b3ffd637` OK |
| 8 | `59a5b1c7a` | resume.ps1 stale-pin fix (Lane F finding) | ran the script | SUCCESS | — |
| 9 | `48a73d4cc` | **Lane B** 2.5 cache + **Lane F** runbook/flip packet/RESUME | 241 passed | SUCCESS | — |
| 10 | *(this push)* | **Lane C** 2.6 delivery · **Lane D** 2.7 badge+goldens · **Lane E** 2.8 regressions + Step-3 harnesses · C-10 fix | see below | pending | pending |
| 6 | `e659454bb` | frozen cross-lane contracts + `07`/`08` | 5 files, **166 passed** | SUCCESS | `e659454bb8f2` ✅ verified in-process |

---

## Flips performed

| When (UTC) | Flag | Service | Confirmed how | State |
|---|---|---|---|---|
| **2026-09-14 00:28 UTC** (= Sun 2026-09-13 **20:28 ET**) | **`RENDER_V2_SHADOW=1`** | `web` | `--set` **auto-redeployed** here (the `web` behaviour, not `chart-renderer`'s staging one); new boot confirmed by uptime **113 s → 12 s** with the deployment SUCCESS, then the value read **in the running process**: `RENDER_V2_SHADOW="1"`, `shadow.enabled()` → `True`, and the route confirmed wrapping `_dispatch_interaction` and submitting `run_safely`. | **ON** — pre-approved by the owner's brief. `DISCORD_RENDER_V2_ENABLED` remains **absent**, so the member path is unchanged and the shadow only records. |

⛔ `railway variables --kv` was deliberately **not** used as the confirmation: it shows what the
service is CONFIGURED with, which is not evidence the running process has it.

## Rules that decide the order

1. **Leverage first, not list position.** 2.4b → 2.5 → 2.6 → 2.7 → 2.8 is a *dependency* order. A
   branch that unblocks two lanes or de-risks the flip goes ahead of one that only adds code.
2. **Nothing stacks.** `web` SUCCESS and the running SHA confirmed in-process before the next push.
   Master's own pre-push guard now checks this too and refuses an unsettled push — it is a second
   rail, not a replacement for the confirmation.
3. **flow-worker classification in the row** for anything reaching its watch list — ADDITIVE or
   BEHAVIOUR-CHANGING — weekend or not.
4. **If master moves mid-gate more than twice on one merge:** rebase once more and, in parallel,
   write the coordination OI. Do not spend a third gate cycle before the OI is written.

---

## Lane outcomes (2026-09-13, 21:xx ET)

| Lane | Step | Result | Scoped gate | Mutations |
|---|---|---|---|---|
| **B** | 2.5 cache + coalescing | ✅ complete | 57 passed | **34/34** red (re-run by the integrator, not taken on trust) |
| **C** | 2.6 Discord delivery | ✅ complete | 191 passed | **26/26** red (re-run) |
| **D** | 2.7 badge + spec + goldens | ⚠️ **killed by the session rate limit**, work uncommitted — salvaged from its worktree, verified, 2 mis-aimed mutations re-aimed | 67 passed | **29/29** red after re-aiming |
| **E** | 2.8 regressions + Step-3 harnesses | ⚠️ **killed by the rate limit** after committing; 5 tests were failing and it never saw them | 17 passed, 3 xfail | 4 harness `--self-check` PASS |
| **F** | runbook, flip packet, RESUME | ✅ complete | n/a (docs) | n/a |

⭐ **The two killed lanes still paid for themselves.** Lane E's strict-xfail found a **real defect in
the adapter spine** — `_call.guarded` computed the effective budget once per CALL, so an N-attempt
hop could overrun the job deadline N-fold (its chaos harness measured **4.6 s against a 2 s
deadline**). It could not fix it: Lane E ships no `api/` change. The integrator did, the strict
marker turned the pass into an `XPASS(strict)` failure exactly as designed, and the test is now a
standing guard. Lane F found `scripts/resume.ps1` printing green off two stale pinned SHAs — an
ancestor test against a stale pin cannot detect the drift it exists to detect, in the one command a
restarting session runs.

---

## Wave 2 (2026-09-14, from `4eec5e0aa`) — the rulings

**Three agents plus the integrator**, which is the cap the rate-limit ruling set. Each lane owns a
disjoint file set and its own worktree and branch; the integrator merges, and **re-runs each lane's
scoped gate in its own session** before accepting it.

| Lane | Ruling | Branch | Files it owns |
|---|---|---|---|
| **A** (integrator) | **OI-29** — the image PATCH through `delivery.py`; C-04 closed | in `discord-render` | `delivery.py`, `adapters/bindings.py`, `commands.py`, the new image-delivery suite + harness, `01`, `06`, the runbook |
| **B** | **OI-31** — L1 memory + L2 volume, 512 MiB LRU by bytes | `lane-b-cache` | `artifact_cache.py`, its suite + harness, `03` §3.6 |
| **C** | **OI-28** (adopt the renderer reds) + the per-attempt budget made structural | `lane-c-budget` | `adapters/_call.py`, the adapter suite + harness, the `edge_scope` import, `test_chart_renderer_*` |
| **D** | **C-07** — `?stale=` end-to-end, or removed from the contract with the reason ledgered | `lane-d-vintage` | `discord_chart_house.build_render_url`, `badge.py`, goldens, `04` |

⛔ **One overlap, resolved by contract rather than by two lanes editing one file.** C-06's closure
needs the stand-in label on the same footer LINE as vintage and provenance — because
`badge.stamp` recognises its own previous stamp by the trailing `· id <cid>` and cuts exactly one
line, so a label on a second line survives onto the *healed* chart as a stale warning. That is C-06
inverted and worse than the bug. `render_footer` is the one place that line is composed, so Lane D
was asked for a keyword-only `quality` clause rather than having the integrator re-type `_SEP` and
`_ID` into `bindings.py` — which would be a second authority over the one string a member reads.

⛔ **`tests/test_discord_render_forensics.py` is the integrator's file and no lane may touch it.**
Lanes prove their closures in their own files; the integrator removes each strict xfail on the
lane's evidence. Two lanes editing the file that records what is still open is exactly how a
programme loses track of what is still open.

---

⛔ **Why "verified, not trusted" is in every row.** Lane D never reported, so its claims did not
exist; Lane E's report was cut off mid-sentence. Both harnesses and every suite were re-run by the
integrator on the integrated tree. Lane E's suite arrived with **5 failures** — four were the
`FakeDelivery` double drifting behind a signature the integrator had just changed (the contract-arity
defect in miniature), one was a self-inflicted import path. None was a product defect, and none of
that was knowable from the branch alone.
