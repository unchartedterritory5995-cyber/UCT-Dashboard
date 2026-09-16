# Deploy-gate cutover — runbook

**Purpose: let the owner do the keyboard steps in one sitting with nothing to figure out.**
Produced by Session 10, Workstream C. **This document executes nothing.**

Status at the time of writing: **NO-GO**, with exactly one precondition left unverified
(C.2.i). Everything else is measured.

---

## C.1 The model, stated with evidence

### What Railway does on a master push today

A push to `master` starts a Railway build **immediately**. The `master deploy gate`
workflow runs **in parallel**, not before. The two take about the same time, so they finish
together *and that is a coincidence, not a mechanism*.

| commit | gate completed | gate total | pod booted | boot − gate | source |
|---|---|---|---|---|---|
| `6b606990c` | 05:12:53Z | 118 s | 05:12:55Z | **+2 s** | S9 |
| `587ee51b2` | 05:32:54Z | 121 s | 05:32:36Z | **−18 s** | S9 |
| `cb0949d8c` | 06:40:14Z | 129 s | 06:40:12Z | **−2 s** | S9 |
| 8 further deploys | — | — | — | **−99 to −141 s** | S8 |

Boot times come from the pod's own `uptime` via `/api/health`, not from a Railway field.
`cb0949d8c` was watched live: Railway reported the deploy **`SUCCESS` while that commit's
gate run was still executing.**

⛔ **Ten observations say Railway does not wait; one says it does, by 2 s — inside the
1 s `uptime` resolution and the 20 s poll interval.** The working model is two unrelated
two-minute pipelines running side by side.

### What "Wait for CI" actually does

**Nothing observable.** It is the setting the gate's own header credits with holding the
build, and the table above is incompatible with that. ⚠️ **Whether it is even switched on
cannot be read from the CLI** — `railway deployment list` returns only `status`,
`createdAt`, `id` and `meta`, with no field for a CI hold. That is C.3 step 3.

### What the promoted-branch gate does

- It **serialises checks**, and that is now **measured, not assumed** — see C.2.ii.
- `promote-production.yml` fast-forwards `production` **1–3 s after** the gating check, on
  `workflow_run` filtered to `branches: [master]`.
- **`production` is currently unwatched by Railway**: all 20 sampled deploys carry
  `meta.branch = 'master'`, and 211 remote heads have never produced a deploy.

⭐ **So the promotion pipeline already runs, end to end, and nothing consumes its output.**
The cutover is the act of pointing Railway at it.

---

## C.2 The two preconditions

### C.2.i — Does a push to `production` trigger a Railway deploy? ✅ **ANSWERED: YES**

> **Superseded by the API method; answered 2026-09-16. The click path below is kept for
> the reasoning, and its step 4 is WRONG for this repo — see the correction.**

**The answer.** A `GITHUB_TOKEN` push to `production` DOES reach Railway. Evidence, from a
throwaway `cutover-probe` service whose only trigger was `production` (`checkSuites=false`,
verified by API) and whose only prior build was the connect control:

| time (UTC) | event |
|---|---|
| 00:05:28 | `master deploy gate` starts on `7eef82ec2` |
| 00:07:38 | gate completes success |
| 00:07:40 | `promote to production` starts — fast-forwards with `GITHUB_TOKEN` |
| **00:08:04** | **`cutover-probe` creates a second deployment** — 24 s into that window |
| 00:08:06 | promotion completes; `production` 246204473 → `7eef82ec2` |

⚠️ **Caveat, recorded rather than smoothed over:** the probe was deleted before that
deployment's commit SHA was captured, so the evidence is *a new deployment at exactly the
right moment on a service watching only `production`*, not *a deployment built from
`7eef82ec2`*. The window is 26 s wide and no other trigger existed. Accepted (SD-1.3 C0).
**No probe is rebuilt.**

#### ⛔⛔ CORRECTION — step 4's start-command guard DOES NOT WORK ON THIS REPO

**`railway.json` is config-as-code and its `deploy.startCommand` overrides the service-level
Custom Start Command.** That command falls through to `exec uvicorn api.main:app`, so the
probe **booted a second copy of the app** on the production project. The proof is not an
inference: `echo … && exit 1` cannot produce a SUCCESS deployment, and the deployment
reported SUCCESS.

⭐ **What actually contained it was the VARIABLE isolation, not the guard.** The probe
carried nine `RAILWAY_*` platform names and nothing else — no `MASSIVE_API_KEY` (so the OPRA
tape was never at risk; `massive.py` raises at client construction without it), no
`DISCORD_WEBHOOK_URL`, no `RESEND_*`, no volume, no domain. The clause this probe's operator
nearly waved through as a false positive is the one that held; the clause relied on failed
silently. Full audit: `docs/breadth/INC-1-second-app-instance.md`.

**If a probe is ever rebuilt, it must fail at BUILD, not at start** — a *created deployment*
is the whole evidence, and one that never builds cannot run anything. Verify the control
build FAILS before driving a promotion, and **capture the deployment's commit SHA before
deleting the service.**

---

#### The original click path (kept for its reasoning; step 4 is superseded above)

**The question.** `promote-production.yml` fast-forwards `production` using the workflow's
`GITHUB_TOKEN`. If Railway is later pointed at `production`, will that push actually cause
a build?

**Why it is genuinely open.** GitHub deliberately suppresses *workflow* runs for
`GITHUB_TOKEN` pushes, to stop recursion. Railway does not use workflow triggers — it uses
a GitHub App webhook, which is a different mechanism and should fire. **"Should" is not
evidence**, and this is the single load-bearing unknown in the cutover.

#### ⛔⛔ BLAST RADIUS FIRST — and it is the reason this probe is designed the way it is

A second copy of this app booting in the same Railway project is **not** harmless:

- ⛔ **Railway shared/project variables can be inherited by a new service.** If the
  throwaway service inherits `MASSIVE_API_KEY`, the Massive OPRA consumer starts and
  **Massive allows roughly one connection per key** — it would kick `flow-worker` off the
  tape, and **Massive does not replay**, so the gap is permanent until the T+1 flat file.
- ⛔ If it inherits `DISCORD_WEBHOOK_URL`, `RESEND_*` or the scheduler flags, it posts to a
  ~750-member channel, emails members, and publishes to YouTube. This is exactly the
  reasoning that made `docs/` reject Railway PR environments.
- ⚠️ A volume is **per-service**, so a new service cannot reach `web`'s `/data`. That one
  risk is genuinely absent — but it is the *only* one that is.

**Therefore the probe must never start the app.**

#### The probe — click path

1. Railway → project `luminous-recreation` → **New** → **GitHub Repo** →
   `unchartedterritory5995-cyber/UCT-Dashboard`.
2. Name it **`cutover-probe`**.
3. **Settings → Source → Branch: `production`.**
4. ⛔ **Settings → Deploy → Custom Start Command:**
   ```
   echo "cutover probe: build observed; app deliberately not started" && exit 1
   ```
   This is the whole safety design. A build proves the trigger fired; the app never runs,
   so no socket, no scheduler, no webhook, no email.
5. ⛔ **Settings → Variables: add none. Remove any inherited shared variable** before the
   first deploy. If the UI shows inherited variables that cannot be removed, **stop and do
   not proceed** — report that instead; the probe is not safe in that configuration.
6. ⛔ **Do not add a domain.** Do not attach a volume.
7. Let it sit. **Do not push anything for it** — the next promotion under normal work will
   drive it.

#### What to observe, and what to send back

After the next master push completes its gate and promotes:

| observation | where | what it means |
|---|---|---|
| `cutover-probe` shows a deployment created within ~1 min of the promotion | Deployments tab | ✅ **the push to `production` DID trigger Railway** |
| it shows nothing after ~10 min | Deployments tab | ❌ a `GITHUB_TOKEN` push does not reach Railway → fallback below |
| it shows a deployment that **FAILED at start** | Deployments tab | ✅ **expected and correct** — the start command is meant to exit 1 |

**Screenshot:** the `cutover-probe` Deployments list showing the deploy's timestamp and
status. **Paste back:** that timestamp, the status word, and the commit SHA it built.

8. **Delete the service** when done: Settings → Danger → Remove Service.

#### Fallback if C.2.i fails — a PAT or deploy key for the promotion push

| | |
|---|---|
| **What** | a fine-grained PAT, or a repo deploy key with write access, used by `promote-production.yml` instead of `GITHUB_TOKEN` |
| **Scope needed** | `contents: write` on this repo **only**. Nothing else — no actions, no packages, no org scope |
| **Storage** | GitHub → repo → Settings → Secrets and variables → Actions → **New repository secret**, e.g. `PROMOTE_TOKEN`. Never in the repo, never in a log |
| **Rotation** | expiry ≤ 90 days, with a calendar reminder; rotating means regenerating and re-pasting the secret — the workflow does not change |
| **Keyboard step** | ⚠️ **yes — creating it is a GitHub keyboard step for the owner**; an agent must not create or hold this credential |
| **Risk it adds** | a second write credential for the repo. It is narrower than the default `GITHUB_TOKEN` in scope but longer-lived, so the expiry is the control |

### C.2.ii — Contention: ✅ **VERIFIED THIS SESSION**

**The `master-deploy` concurrency group serialises.** Measured 2026-09-15 with two pushes
17 s apart to a throwaway branch Railway does not build:

| run | branch | created | started | **queue** | ended |
|---|---|---|---|---|---|
| A `d15a2d855` | `gate-test/contention` | 09:06:05 | 09:06:08 | **3 s** | 09:07:57 |
| B `aa971be13` | `gate-test/contention` | 09:06:24 | 09:08:01 | **97 s** | 09:10:06 |
| **C `8578d375d`** | **`master`** (another workstream) | 09:09:24 | 09:10:11 | **47 s** | — |

⭐ **Row C is the strongest evidence and it was unplanned.** A *real* master push arrived
while the test was running and queued behind it, starting **5 s after** run B finished.
That proves the test branch and master genuinely share one queue — the premise of the whole
design — using production traffic rather than a synthetic case.

⚠️ **And it is the honest cost: the test delayed another workstream's deploy by ~43 s.**

**Zero deploys resulted.** No deployment in the list carries a non-master branch, and
`promote-production.yml` produced no run for `gate-test/contention`.

---

## C.3 The cutover — numbered, with owner, verification and rollback

> ⛔ **Do steps 1–3 in one sitting, in this order.** Between step 2 and step 3 the system is
> in a valid state, but do not stop between 1 and 2.

### Step 1 — Branch protection on `production` · GitHub · OWNER

GitHub → repo → Settings → Branches → Add branch ruleset.

| setting | value | why |
|---|---|---|
| Target | `production` | |
| Restrict who can push | **the Actions app / the promotion workflow only** | `production` must only ever be written by the gate |
| Block force pushes | **on** | a force push here would deploy arbitrary code |
| Restrict deletions | **on** | deleting it would strand the watched branch |

**Verify:** try a manual `git push origin master:production` from a terminal — **it must be
rejected**. Paste back the rejection message.
**Rollback:** delete the ruleset. Instant, no side effects.

### Step 2 — Railway: watched branch `master` → `production` · Dashboard · OWNER

Railway → `luminous-recreation` → service **`web`** → Settings → Source → **Branch:
`production`**.

⚠️ Do **not** redeploy manually after changing this. The next promotion should drive it.

**Verify:** the Source panel reads `production`. Screenshot it.
**Rollback:** set it back to `master`. **Recovery time ≈ one build**, and the measured build
+ deploy is ~120 s (§C.1). `production` is left wherever the last promotion put it, which is
always a commit that passed the gate — so rolling back strands nothing.

### Step 3 — Railway: Wait-for-CI **OFF** · Dashboard · OWNER

Same Settings page → turn **Wait for CI** off.

⛔ **Do this even though it looks like a safety feature.** Ten observations say it is not
holding anything (§C.1). Leaving it on after the cutover adds a signal that reads as
protection and provides none — the failure mode this programme names most often.

⭐ **While you are on this page, answer C.2.i's cousin for free: record whether Wait-for-CI
was ON or OFF before you changed it.** That is the one reading no CLI can give, and it
settles Session 9's open question retrospectively.

**Verify:** the toggle reads off. Screenshot.
**Rollback:** turn it back on.

### Step 4 — Verification: one docs-only master push · OWNER or agent

Push any docs-only commit to `master` and watch this timeline:

| t | event | how to see it |
|---|---|---|
| 0 | push lands on `master` | |
| +3–5 s | `master deploy gate` run starts | Actions |
| +~120 s | gate passes | Actions |
| +1–3 s | `promote-production` fast-forwards `production` | Actions |
| **then** | **Railway build starts — from `production`** | Railway Deployments |
| +~120 s | SUCCESS | `/api/health` returns 200 with a reset `uptime_seconds` |

**The observation that proves the deploy came from `production`:**

```sh
git rev-parse origin/production          # A
railway deployment list --service web --json   # newest meta.commitHash  -> B
```

✅ **A must equal B.** It will also equal `master` when the gate passed — so the
*discriminating* case is a **failing** gate: push something the gate rejects and the
deployed SHA must **stay at the old `production`**, while `master` moves ahead. That is the
one test that distinguishes "deploying from production" from "deploying from master and
coincidentally agreeing".

⚠️ **Do not manufacture a failing gate on production to test this.** Wait for the next
genuine gate failure and check it then.

### Step 5 — The interim rule, until the cutover happens

⛔ **The pre-push guard's settle check is currently the only thing preventing a repeat of
the 2026-09-14 outage.** `tools/pre_push_guard.py` refuses a push while `web` is
BUILDING/DEPLOYING and requires a settled deploy; the constant is `MIN_SETTLE_SECONDS`.

Observed working on all four of this session's master pushes, e.g.
`[pre-push] web is SUCCESS on 444f747d8, 861s settled — safe to push.`

> ### ✅ QUESTION C.a — is that guard installed for every workstream's checkout? **YES, on this machine — measured**
>
> A first draft of this section answered *"only the checkouts somebody put it in"*, on the
> correct premise that git hooks are not tracked (`git ls-files .git/hooks` = **0** files).
> **Measuring it gave the opposite answer**, and the mechanism is worth knowing:
>
> ```
> git config --get core.hooksPath   ->  C:\Users\Patrick\uct-dashboard\.git\hooks
> git rev-parse --git-common-dir    ->  C:/Users/Patrick/uct-dashboard/.git
> hook file at <common>/hooks/pre-push -> PRESENT
> ```
>
> ⭐ **`core.hooksPath` is set in the repository's SHARED config, and every worktree reads
> that same config.** All ~80 worktrees of `uct-dashboard` on this machine therefore resolve
> hooks to one directory, and the guard is in it. This is not per-checkout luck — it is one
> setting covering every workstream **by construction**.
>
> ⛔ **Three limits, and they are the reason the server-side gate still matters:**
> 1. It covers **this repository on this machine**. A fresh `git clone` anywhere else —
>    another box, CI, a colleague — gets no hook, because hooks are not tracked and
>    `core.hooksPath` is local config that is never committed.
> 2. **`--no-verify` bypasses it completely and leaves no trace.**
> 3. A worktree could override the path via `git config --worktree` (needs
>    `extensions.worktreeConfig`), though nothing here does.
>
> From the server's point of view a missing hook and `--no-verify` are indistinguishable,
> and the 2026-09-14 incident was never attributed to either — which is exactly what a
> server-side gate fixes and a client hook cannot.
>
> **Measured constant:** `MIN_SETTLE_SECONDS = 150` (`tools/pre_push_guard.py:90`).

---

## C.4 Go/no-go

| # | precondition | state |
|---|---|---|
| G-1 | the gate's checks actually serialise | ✅ **VERIFIED** 2026-09-15 (C.2.ii), three observations incl. a real master push |
| G-2 | branch protection on `production` | ⬜ **OWNER** — C.3 step 1 |
| G-3 | a push to `production` triggers a Railway build | ⚠️ **UNVERIFIED** — C.2.i, owner probe |
| G-4 | Railway watched-branch change | ⬜ **OWNER** — C.3 step 2 |
| G-5 | Wait-for-CI state known and set OFF | ⬜ **OWNER** — C.3 step 3, and it answers S9's open question |
| G-6 | the promotion pipeline works end to end | ✅ already running — 10+ `promote-production` runs, all `success`, `production` is being fast-forwarded today |

⭐ **The remaining work is entirely keyboard.** No code change, no agent action, and no
further measurement is required before the cutover — G-1 was the last thing an agent could
settle, and this session settled it.

⛔ **NO-GO stands until G-3 is answered**, because if a `GITHUB_TOKEN` push does not reach
Railway, step 2 silently stops all deploys: `web` would watch a branch nothing tells it
about, and the symptom is *no deploys at all* rather than an error.
