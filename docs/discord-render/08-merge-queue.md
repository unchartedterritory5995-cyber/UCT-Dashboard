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
| 11 | `discord-render-hardening` → `d0586beed` | **OI-34** channel allowlist · **OI-35** per-channel V2 · **B2** dated shadow lines · A1–A3 evidence | `beace00e0` | see below | 3/3 + 4/4 RED | **ready — merges first** |
| 12 | `lane-b1-pool-recycle` → `81176c296` | **B1** admin-only `POST /admin/pool/recycle` | `dcef25baa` | **873 passed** combined with row 11 | 12/12 RED (lane) + **1 re-proved by the integrator** | ✅ **ACCEPTED — merged into row 11** |
| 13 | `lane-b45-harness-hygiene` | **B4** mutation-target refusal · **B5** stale-anchor gate step | — | — | — | agent running |

⛔ **Row 11 goes first and it is not a preference.** B1's value is a determinism/chaos trigger,
which is only reachable once V2 can be narrowed to a canary channel (OI-35) and `/chart` can run in
a private channel at all (OI-34). Merging the lanes first would leave both untestable.

---

## OI-34 and OI-35 — two flip blockers found by trying to execute the brief

Neither was visible from the code alone; both surfaced the moment a command was actually typed into
a private channel. Recorded here because the flip packet's precondition table was written against
**03-architecture's spec** rather than against the shipped code, and agreed with itself.

| OI | What the brief assumed | What the code did | Cost if executed as written |
|---|---|---|---|
| **OI-34** | a smoke channel can be added | `cmd_channel_ok` compared against **one** id | repointing `CHART_FLOW_CHANNEL_ID` MOVES `/chart`, `/charts`, `/flow` — it does not add. Every member of a 1,558-member guild loses all three for the duration |
| **OI-35** | "the flag is per-channel per 2.1" | `enabled()` is one global boolean; `command_enabled()` splits by **command** | flipping the "canary" sends every member's `/chart` to V2 in the same instant — the member-channel flip, reached by following an instruction that says canary |

⭐ **OI-34 also closes Gap 3 properly.** The `/chart` shadow saw no traffic not because the hook was
broken and not merely because "nobody ran it" — a member **can only run `/chart` in one channel**,
`#chart-flow-requests`. The shadow report itself says it cannot tell those apart; the channel gate
is what tells them apart. B3's ruling ("a traffic fact, stop investigating") is adopted, and this is
the mechanism behind the traffic.

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
5. **The B5 anchor check runs BEFORE any harness, on every gate.** One command, below. It is a
   read; it costs about a second.

---

## ⛔⛔ Mutation-harness hygiene — the B4/B5 gate step (owner rulings, 2026-09-14)

> **B4:** *"any harness that can leave a mutation in a working-tree file must refuse to run unless
> cwd is a throwaway worktree matching a known pattern. The integrator's tree is never a mutation
> target. Enforce in code, not memory."*
>
> **B5:** *"Stale mutation anchors have bitten three times (A29, A32 x2). Add a gate step that lists
> every mutation control whose anchor text no longer matches the source, before the harness runs —
> NOT-APPLIED detection at gate time rather than after an 18-minute run."*

### The gate step — run this before any harness, every time

```sh
python docs/discord-render/instruments/anchor_check.py .          # 0 = clean, 1 = defects, 2 = vacuous
python docs/discord-render/instruments/anchor_check.py --self-check   # proves it can fail
python -m pytest tests/test_mutation_harness_hygiene.py -q        # the rails for both
```

⚠️ **THERE IS NO SINGLE SCRIPTED GATE ENTRY POINT FOR THIS PROGRAMME, and that is a measurement,
not an omission.** The scoped gate is a hand-assembled `pytest <named files>` run per lane, recorded
in `LEDGER.md`'s gate column (`07-execution-plan.md` §1: *"scoped, ≤6 named files"*, `-k` and
`pytest tests/` both forbidden). `scripts/gate_shards.py` is the joystick programme's six-shard
vitest wrapper and governs nothing here. So B5 is wired in the two places that actually exist:

1. **This checklist** — the command above, run by the integrator before accepting a lane.
2. **In code, per harness** — `guard(ROOT, __file__)` is the first statement after `ROOT` in every
   `mutation_harness*.py`. It refuses an unsacrificed tree (**exit 86**), then refuses to start an
   18-minute run whose anchors are already stale (**exit 87**). That one is not a checklist item
   anybody can forget.

If a single scripted entry point is ever built, add `anchor_check.py` to it and delete item 1.

### What B4 requires of a tree, and why a marker and not a name

A harness may only mutate a tree that carries **`.mutation-sandbox`** at its root, containing the
token `throwaway`, and whose `.git` is a **file** (a linked worktree, not the main checkout).

⭐ **The marker is gitignored, and that is the entire argument.** No pull, merge, rebase,
`git worktree add` or `git checkout` can put it in the integrator's tree — somebody has to stand in
a throwaway worktree and write it. A name pattern (`.worktrees/`, `*-mutation`) is a claim *about* a
tree: it survives a rename, it can be matched by accident, and when it is wrong it fails in the
direction where the harness **runs**. The main checkout is refused structurally even with a marker.

To sacrifice a worktree:

```sh
echo 'throwaway worktree - mutation harnesses may edit files here' > .mutation-sandbox
```

⛔ **Both overrides exist so that using one is a deliberate act, not so that it is the way past a
red.** Each requires an exact value — `=1` and `=true` are refused — and each prints a banner naming
the tree, so no evidence artifact can hide that it was used.

| Override | Effect |
|---|---|
| `UCT_MUTATION_HARNESS_ALLOW_UNSAFE_TREE=i-accept-mutations-in-this-tree` | run a harness in a tree that is not a marked sandbox |
| `UCT_MUTATION_HARNESS_STALE_ANCHORS_OK=i-know-some-anchors-are-stale` | start a run anyway when 1 of N anchors is stale and the rest are worth having |

### What B5 reports, and the three outcomes it never collapses

| Outcome | Meaning |
|---|---|
| **OK** | the anchor matches exactly once, and that occurrence is real code |
| **STALE** | zero matches — **or** exactly one that lies entirely inside a comment or docstring, which would edit prose and could never make the rail fire. The two carry different sentences and are never merged |
| **AMBIGUOUS** | more than one match. An exact single replacement is impossible. **A different defect from STALE**, and it must never read as "ok" — the harness reports both as the same `NOT APPLIED` line, so this checker is the only place they are distinguishable |
| **UNREADABLE** | the anchor or its target could not be resolved (an f-string needle, a missing file). ⛔ A control that could not be READ is not a control that is FINE |

Every non-OK control is reported **by name**, with the anchor's first line, never as a count alone.
Zero controls enumerated is a **failed invocation (exit 2)**, never a quiet pass.

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

---

## Queued, 2026-09-14 13:44 ET — refused by the guard, not by the gate

| Branch tip | What | Gate | Why it is waiting |
|---|---|---|---|
| `abda0e0d0` | step 1.3 measured: `#render-alerts`' ACL read through the guild listing; `flip_preconditions` reads it | hygiene clean; instruments self-checked; `flip_preconditions --self-check` 8/8 | **master's own pre-push guard refused** — another session's merge was in flight |

⭐ **This is the queue working, and the refusal is the feature.** `[pre-push] ⛔ REFUSING THE PUSH.
One master merge at a time, repo-wide.` Two merges inside one swap is what produced the 2026-09-12
502 and a lost sampler row; the guard offers `UCT_SKIP_PREPUSH_GUARD=1` and **it was not used** —
an override exists so that it is a deliberate act, not so that it is the way past a red.

⚠️ Nothing about this branch changed. It is gated and ready; only the window moved.

### B1 acceptance — what the integrator actually re-ran

⛔ **A lane's self-report is evidence, never a verdict**, so none of the lane's numbers were taken
on trust:

- **Scoped gate re-run in the integrator's session, on the MERGED tree:** `873 passed, 9 skipped,
  0 failed` (was 798 before B1 — the lane adds 67+ and none of them interact).
- **The mutation table was checked for fabrication first** — every test it names exists in
  `tests/test_chart_renderer_admin_recycle.py`, and the guards it claims exist in
  `services/chart_renderer/app.py`.
- **One mutation re-proved independently.** Inverting the flag guard
  (`== "1"` → `!= "1"`, one occurrence) turned **30 tests red**, matching the lane's "30 red"
  exactly. Control green before and after; restore sha256-verified byte-identical.

⭐ **The lane's most valuable design choice** is that "exactly one page" is a diff over page
*identities*, not a count, and "the browser was not restarted" is a diff over a browser id — because
a replacement browser answers `is_connected(): true` just as happily as the original. A count and a
liveness probe would both have passed a lever that recycled the whole pool.

⚠️ **B1 is merged but DARK and undeployed.** `RENDER_ADMIN_ENDPOINTS` is unset, no
`RENDER_ADMIN_TOKEN` exists, and chart-renderer deploys by `railway up`, not off a master push —
so merging this changes nothing running until that deploy is made deliberately.

### A finding B1 surfaced that is NOT B1's to fix

**The feature-flag ledger is blind to `services/**`.** `feature_flag_index.repo_roots()` scans only
`api/`, `scripts/`, `tools/`. Declaring `RENDER_ADMIN_ENDPOINTS` in `docs/feature_flags.json` makes
`test_the_ledger_does_not_describe_gates_that_no_longer_exist` go **RED** — the ledger reports its
own blindness and blames the entry. `RENDER_POOL_ENABLED` is undeclared for the same reason.

⭐ The lane **measured this instead of assuming it**, and then left the ledger alone rather than
widening `repo_roots` on its own authority. That is the right call: widening the scan is an owner
decision that touches every flag in the repo, and a lane that "fixed" it would have been changing a
shared rail to make its own row green.
