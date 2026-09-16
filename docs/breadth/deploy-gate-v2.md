# Deploy gate v2 — the promoted-branch gate

**Status: DESIGN + BRANCH ONLY. Nothing here is cut over.** `production` does not exist
on origin, no Railway setting has been changed, and Wait-for-CI has not been toggled.
Owner ruling, Session 6 §5.

**Shape:** `master` → the gating checks → a fast-forward of `production` → Railway
watches `production`.

| artifact | what it is |
|---|---|
| `.github/workflows/promote-production.yml` | the promotion, queued and fast-forward-only |
| `tools/promotion_gate.py` | the decision: which checks gate, and did they pass |
| `tests/test_promotion_gate.py` | 15 rails, mutation-proved three ways |
| a `# promotion-gate:` marker in every workflow file | the classification, beside the thing classified |

---

## Why Wait-for-CI is being replaced rather than kept

Two measured problems, and they are different problems.

**1. It does not gate.** Eight consecutive `web` deploys on 2026-09-14 between 19:10Z
and 21:30Z each **started 99–141 s before their check suite finished** — including
`7707b2241`, created *after* the toggle was already ON. Whatever it is waiting for, it
is not "the checks for this commit have concluded".

**2. All-or-nothing is the wrong shape for this repo.** Wait-for-CI waits on **every**
check. `flow-worker deploy coverage` exits 0 on a red *specifically so it can never
block a deploy* (owner ruling `b9acfddbd`), and 6 of the last 50 master runs were red
there — every one a correctly-classified ADDITIVE breadth merge. Turning Wait-for-CI on
would convert that review gate back into a hard deploy block, which is exactly what the
ruling removed.

A promoted branch fixes both: the promotion is a discrete, observable act that happens
**after** a **named** set of checks has concluded.

---

## 5.1a Which checks gate promotion

⛔ **The set is derived from `.github/workflows/`, never from the GitHub UI.** GitHub
lists **9** workflows for this repo; the directory holds **8** (7 + the promotion
itself). The extras are ghosts — run history, no file. A file-less workflow cannot run
on a new commit, so the directory is the only honest source.

Every workflow file carries a `# promotion-gate: yes|no` marker in its first 40 lines,
with its reason. `tools/promotion_gate.py` reads them and **REFUSES the promotion if any
file is unclassified** — "nobody decided" and "decided not to gate" are different facts,
and only one of them is safe to ignore.

| check | gate? | why |
|---|---|---|
| **master deploy gate** | 🔒 **GATE** | secret scan, shadowed definitions, VITE build args, offline flag ledger, line endings. No path filter on master, so it runs for every candidate. |
| **vite build args** | 🔒 **GATE** | an undeclared `VITE_*` bakes in as `undefined`; every `=== '1'` read then reports "off on purpose" behind a green suite and a 200. Nine shipped that way for four days. |
| **Options Flow guard** | 🔒 **GATE** | a red means a stale-buffer commit removed the live perf wiring. The page keeps working and freezes ~2 s per visit; nothing else surfaces it. |
| **wisdom rails** | 🔒 **GATE** | BAN rails, not style: a red means a Wisdom module reaches the Substack publisher or member Journal/J2/Notebook data. Stdlib-only, unfiltered, seconds. |
| **flow-worker deploy coverage** | 📋 advisory | owner ruling `b9acfddbd` — it exits 0 on a red by design. Gating on it rebuilds the coupling that ruling removed. |
| **Joystick device suite** | 📋 advisory | depends on BrowserStack **Automate**, which is not on this account; it takes a clean green skip on positive proof. Gating would put every deploy behind a vendor and a seat nobody bought. |
| **OCR Linux version cert** | 📋 advisory | a measurement that says of itself *"IT SETS NO BAR"*, with a `continue-on-error` step. A job with no pass/fail criterion cannot gate anything. |
| **promote to production** | 📋 advisory | it *is* the promotion; gating on itself would deadlock its own poll. |

**Two holes, both closed explicitly.**

- A **path-filtered** gating check legitimately does not run on every commit, so "no run
  for this SHA" cannot be a failure. But a workflow **disabled in the UI** also produces
  no run and would read the same way. The gate therefore requires every gating workflow
  to report `state == "active"`, which closes it without re-implementing GitHub's path
  matching.
- `master deploy gate` has **no** path filter on master, so its absence can only mean
  something is wrong with the gate itself. It is required to have run
  (`ALWAYS_RUNS`), and a missing run REFUSES.

---

## 5.1b Serialisation, and what happens on two pushes during one gate run

```yaml
concurrency:
  group: promote-production
  cancel-in-progress: false      # QUEUE
```

**Chosen: queue. Not cancel-in-progress, not coalesce.**

The tempting option is `cancel-in-progress: true` — cancel A's promotion when B arrives
and promote only B. B's tree contains A's changes, so one deploy covers both, and the
stacked-push pressure disappears. It is still **wrong here**, for a reason specific to
this repo rather than a general preference:

> `master deploy gate`'s secret scan reads `git diff --name-only HEAD^ HEAD` — **one
> commit's files**. Cancel A's promotion and A's code still deploys inside B, but A's
> changed files were never scanned by any run that gated a deploy.

Coalescing is only sound when every gating check is cumulative over the tree, and one of
ours is per-commit by construction. Queueing keeps each commit's own full check set
attached to its own promotion.

**What actually happens on two pushes during one gate run:** both gates run (GitHub runs
`master deploy gate` under its own `master-deploy` concurrency group, already
`cancel-in-progress: false`); both promotions queue; A is fast-forwarded, then B. Two
deploys, in order, never overlapping.

**Step 3 — the Railway wait, which is what makes the queue real, and is NOT BUILT.**
Owner ruling: *"A push is not clear until its web deploy reaches SUCCESS."* Holding the
promotion job until Railway's `web` deploy for that SHA reaches `SUCCESS` means the next
queued promotion cannot start a second deploy inside the first one's swap — which is the
2026-09-12 502 and the 2026-09-14 mid-flight `REMOVED`, neither of which a client-side
hook could prevent.

⚠️ **The workflow ships the wait as an explicit warning, not as a silent skip.** Without
`RAILWAY_TOKEN` it cannot see the deploy at all and says so in the job summary:
*serialisation is at GitHub only, and two promotions can still overlap one Railway
build.* With the token present it currently reports `not-implemented` rather than
claiming a wait that did not happen. **Building the poll is the first follow-up after
cutover** — Railway's deployment list carries only `status` and `createdAt`, so the poll
matches on the deployment whose commit is the promoted SHA and waits for `SUCCESS`.

---

## 5.1c Fast-forward only

```sh
git merge-base --is-ancestor origin/production "$SHA"   # verify first, for a clear error
git push origin "$SHA":refs/heads/production            # no --force, ever
```

A bare `git push <sha>:refs/heads/production` is **fast-forward-only by default** — git
rejects a non-fast-forward. The explicit ancestry check runs first only so the failure
names the cause instead of printing git's generic rejection.

**If `production` is not an ancestor of the candidate**, somebody pushed to it directly
or reset it by hand. The job **fails loudly and never forces**: forcing past it would
silently discard whatever is deployed. Recovery is in *Rollback* below.

**If `production` does not exist on origin**, the job completes as a loud, explicit
no-op — *"the gate ran and passed, but there is no branch to advance"*. ⛔ **The workflow
never creates the branch.** A workflow that creates the branch it deploys from could
point production at whatever it happened to be holding; creating it is an owner step.

---

## 5.1d Visibility — one place

**A FAILED promotion:** the workflow's own run list —
`https://github.com/<org>/<repo>/actions/workflows/promote-production.yml`. Every
outcome writes `$GITHUB_STEP_SUMMARY` (candidate SHA, whether production existed,
whether it promoted, the state of the deploy wait, and the gate's verdict line), and a
refusal also emits `::error::` so it annotates the commit.

**A MISSING promotion is the harder case** — nothing failed, the workflow simply never
ran (disabled, a trigger broken by a rename, a `workflow_run` that did not fire). The
signal is **`production` falling behind `master` and staying there**.

⚠️ **PROPOSED, NOT BUILT:** `tools/promotion_lag.py` — prints the commits on `master`
that are not on `production` and the age of the oldest, and exits non-zero past a
threshold. It should ride the **existing** hourly `UCT-StackedPushAudit` Task Scheduler
job (`tools/stacked_push_audit.ps1`) rather than adding a second scheduled job, and
append to the same gitignored log. Left unbuilt deliberately: it is worth having before
cutover, but it is not part of the gate and should be reviewed on its own.

---

## 5.1e Rollback — how to demote

**CHOSEN: revert on master, promoted forward.**

```sh
git revert --no-edit <bad-sha>
git push origin HEAD:master          # the gate runs; the next promotion carries the revert
```

**Why not a manual reset of `production`:** it is silently undone. Resetting
`production` back to an older SHA requires a force push (the design forbids one), and —
decisively — that older SHA is still an ancestor of `master`, so **the very next
promotion fast-forwards straight over the rollback** and re-deploys the bad commit. A
rollback that the next green push quietly reverses is worse than none.

**EMERGENCY path, owner-only, and only in this order:**

```sh
gh workflow disable "promote to production"
git push --force-with-lease origin <last-good-sha>:refs/heads/production
# … fix forward on master, then:
gh workflow enable "promote to production"
```

⛔ Disabling first is load-bearing. Leave it enabled and the next master push undoes the
reset. ⭐ And note this is *already* the behaviour the gate protects: with the workflow
enabled, the ancestry check will refuse the following promotion because the forced
`production` is no longer an ancestor — so the failure is loud rather than silent.

---

## 5.1f `tools/pre_push_guard.py` and `--audit`

**Neither needs to watch `production`, and that is a fact about what they read rather
than a judgement call.**

- The guard's `latest_deployment()` reads the **Railway `web` deployment queue**, which
  is branch-agnostic — it asks "is a deploy in flight", not "which branch". Under
  promotion a master push no longer triggers a deploy directly, but the question it asks
  stays exactly as correct: refusing to push master while a deploy is swapping still
  prevents promotions piling into one another. **No change.**
- Its destination check (`refused: a push whose destination is master`) also stays
  right: humans and agents still push `master`; only the workflow pushes `production`,
  from CI, where no client hook runs — by design.
- `--audit` / `suspected_stacked_pushes` infers stacking from Railway `createdAt` gaps
  under `STACK_WINDOW_SECONDS = 300`. Under promotion those deploys are created by the
  workflow, so the detector works unchanged — **and it becomes the instrument that would
  reveal the promotion gate failing to serialise.** Keep it running; do not retire it as
  "solved by the gate".

⚠️ One thing that DOES change meaning: the guard's clock and queue rules protect a push
that no longer deploys. That is a reason to keep them (a queued promotion is still a
queued deploy), not a reason to relax them — but it should be re-read after cutover with
a month of real behaviour, not decided now.

---

## 5.2 The workflow

`.github/workflows/promote-production.yml`. Trigger:
`workflow_run` on **master deploy gate** completing on `master`, plus a
`workflow_dispatch` door for the cutover rehearsal.

Order: refuse a non-success trigger → checkout the candidate at `fetch-depth: 0` →
run the gate's own `--self-check` → poll the gating checks (30 s × 40 ≈ 20 min) →
does `production` exist → fast-forward → Railway wait → summary.

⚠️ **A `workflow_run` workflow only triggers from the DEFAULT branch.** This file does
nothing at all until it is on `master`. That is a property of GitHub, not a safeguard to
rely on.

**Safe to merge before cutover** because every path is inert without `production`: the
gate runs, reports, and no-ops.

---

## 5.3 Test design (replaces A.5) — DESIGN ONLY, run authorised separately

**Precondition:** the workflow is on master; `production` exists on origin; **Railway
still watches `master`** so nothing under test can deploy.

**Push A** — docs-only, commit message contains `[ci-slowtest]`. `master deploy gate`
grows one step, gated on that marker, that sleeps 240 s:

```yaml
- name: Deliberate slow step (test only)
  if: contains(github.event.head_commit.message, '[ci-slowtest]')
  run: sleep 240
```

**Push B** — docs-only, trivial, no marker, pushed ~60 s after A.

**Predicted timelines**

| | serialises correctly | does not |
|---|---|---|
| A's gate | starts t+0, ends ≈ t+250 s | same |
| A's promotion | starts ≈ t+250 s, pushes `production`=A | same |
| B's gate | queued behind A's (`master-deploy` group), starts ≈ t+250 s | starts ≈ t+60 s |
| B's promotion | starts after A's promotion completes | **starts ≈ t+70 s — before A's** |
| `production` | reflog: A then B, A's push ≈ 190 s before B's | B then A, **or B only** |

**The distinguishing observation** is the order and spacing of the two fast-forwards on
`production`, read from the branch itself rather than from the run list:

```sh
git fetch origin production
git reflog show origin/production --date=iso   # local reflog: what this clone observed
git log --format='%H %cI %s' origin/production -3
```

Correct: A's commit is the parent of B's on `production`, and the two promotion runs do
not overlap in the Actions run list. Incorrect: B promoted first (A then fails the
ancestry check and refuses — itself a clean, visible failure), or the two promotion runs
overlap in time.

**What INCONCLUSIVE looks like, and why the design excludes it.** Inconclusive would be
*"both commits are on `production` and we cannot tell which promotion put them there"*.
Three properties exclude it:

1. Each promotion pushes **one specific SHA**, so `production`'s history is the ordering
   — there is no merge commit to hide behind.
2. `cancel-in-progress: false` means a cancelled run cannot silently vanish from the run
   list; every promotion attempt leaves a run.
3. The gate REFUSES on an empty run list, so "the API returned nothing" surfaces as a red
   run rather than as a promotion nobody can explain.

⚠️ The one genuinely inconclusive case is **A's gate failing for an unrelated reason** —
then B is not queued behind anything and the test measures nothing. The run is void and
is repeated; it is not evidence either way. Remove the `[ci-slowtest]` step in the same
PR that records the result.

---

## 5.4 Should Wait-for-CI stay ON as a second gate?

> **No — leave it OFF.** It waits on ALL checks for the commit, which re-couples every
> advisory rail (`flow-worker deploy coverage` above all) to the deploy decision and
> reintroduces exactly the all-or-nothing hazard the promoted-branch gate exists to
> replace with a named, selective check set.
>
> It would also be redundant rather than belt-and-braces: with Railway watching
> `production`, a commit only arrives there **after** the promotion has verified those
> named checks — so Wait-for-CI could add failure modes (an advisory red, or a check
> that never runs) but never a veto the gate has not already applied.

---

## Railway cutover checklist

⚠️ **Every step marked 👑 needs org-admin or account access and is the owner's.** Do not
attempt them from a session.

| # | step | who | verification |
|---|---|---|---|
| 1 | Merge this branch to master (the workflow is inert without `production`) | either | the workflow appears under Actions; a master push produces a run that ends "origin/production does not exist yet" |
| 2 | 👑 Create `production` on origin at the current `master` tip | owner | `git ls-remote --heads origin production` matches `origin/master` |
| 3 | Observe for **one day** with Railway still on `master` | either | every master push leaves a promotion run; `production` tracks `master` with no gaps |
| 4 | 👑 Branch protection on `production`: block force pushes, block deletion, **do not** require a PR (it would break the fast-forward push), restrict pushes to the GitHub Actions app only | owner | a manual `git push origin master:production` from a laptop is rejected |
| 5 | 👑 Railway → `web` service → Settings → Source → change watched branch `master` → `production` | owner | the service page shows `production` |
| 6 | 👑 Railway → `web` → **turn Wait for CI OFF** (see 5.4) | owner | the toggle reads off |
| 7 | Push a docs-only commit to master | either | the promotion run passes, `production` advances, and Railway starts **one** build for the promoted SHA |
| 8 | 👑 Repeat 5–6 for any other service that should follow `production` | owner | per-service source page |
| 9 | Update `docs/runbooks/deploy-windows.md` to describe the promoted branch | either | the runbook names `production`, not `master`, as what Railway watches |

**Rollback of the cutover itself, if it misbehaves:** 👑 set the `web` watched branch
back to `master` in the Railway dashboard. That is a one-field change and takes effect on
the next push; nothing in the repo needs reverting, and the promotion workflow keeps
running harmlessly against a branch nobody watches.

---

## Required GitHub permissions

| need | how | who |
|---|---|---|
| push to `production` from CI | `permissions: contents: write` in the workflow, using the built-in `GITHUB_TOKEN` — **already in the file**, no PAT, no deploy key | — |
| read other workflows' runs and states | `permissions: actions: read` — already in the file | — |
| 👑 branch protection on `production` | repo settings → Branches → add a rule (step 4 above) | owner |
| 👑 allow the Actions token to push through that protection | in the same rule, add GitHub Actions to the push allow-list | owner |
| 👑 `RAILWAY_TOKEN` repo secret, for the deploy wait | repo settings → Secrets and variables → Actions | owner |

⚠️ **Unverified, and it must be verified at step 7 rather than assumed:** a push made
with `GITHUB_TOKEN` does not trigger other **Actions workflows** (GitHub's recursion
guard). Railway builds from its own GitHub App installation and a `push` webhook, which
that guard does not cover — so it *should* see the promotion. Step 7 is where that stops
being reasoning and becomes a measurement. If Railway does **not** build on a
`GITHUB_TOKEN` push, the fix is a deploy key or a PAT for the promotion push (👑 owner),
and the cutover pauses until then.

---

## What is NOT built

- The **Railway deploy wait** (5.1b step 3) — the workflow warns rather than claiming it.
- `tools/promotion_lag.py` (5.1d) — the missing-promotion detector.
- The `[ci-slowtest]` step in `master deploy gate` (5.3) — added and removed with the test.
- The `production` branch, every Railway setting, and the Wait-for-CI toggle — owner, at cutover.
