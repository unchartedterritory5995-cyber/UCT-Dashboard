# Deploy windows — when a master push is safe

Owner-approved 2026-09-11. Replaces the blanket RTH freeze and the "push anytime forever" line; CLAUDE.md points here and states no rule of its own.
This is the single authority on push timing. `CLAUDE.md` points here and states no
rule of its own.

## ⛔⛔ THE CUTOVER HAPPENED — `web` DEPLOYS FROM `production`, NOT `master` (2026-09-16)

Railway's `web` service watches **`production`**, which only the promotion workflow
advances and only after `master deploy gate` passes. Three consequences, and they are
the whole of what changed:

1. **A red gate is now a NON-DEPLOY, not just a red check.** `production` does not move,
   so the previous commit stays live. Before the cutover a red gate still deployed.
2. **Deploys come from `production`.** To ask what is live, read `origin/production` —
   `master` can be ahead of it by any number of commits that have not passed the gate.
3. **The burst and settle clauses are UNCHANGED.** `tools/pre_push_guard.py` still paces
   this repo at three landings an hour and still refuses inside a 600 s settle. The
   cutover changed WHICH COMMITS deploy, never HOW OFTEN — do not read it as permission
   to push faster.

⚠️ `production` has **no branch protection yet** (G6, owner). The gate carries a
compensating control instead: it refuses, before any scan, if `production` is not where
the last promotion left it. That control is **detective, not preventive**, and only looks
when master is pushed — a direct push to `production` in a quiet period goes unnoticed
until the next one.

Trigger state, read by API at the cutover: `web` trigger `61b50f1f-…`, `branch` master →
production, `checkSuites` **false both before and after** — so Wait-for-CI was already OFF,
which settles that question retrospectively. Records: `docs/breadth/DECISIONS.md`.

## The rule

A master push is a production deploy. **Which services restart depends entirely on
which files the push touches**, and only one service's restart is expensive enough
to need a window.

### Tier 1 — push any time
Docs, markdown, `tests/**`, `tools/**`, `scripts/**`, and frontend (`app/**`).

These restart **web only** (and only if web's watch paths match — see below). Cost:
`/api/*` blips for roughly a minute, and APScheduler's job store is in memory, so a
scheduled slot whose minute passes during the swap is lost outright rather than run
late. Acceptable. ⭐ If you can see a scheduled job due in the next couple of
minutes, wait for it — otherwise push.

### Tier 2 — after-hours or weekend only
Any file on **flow-worker's watch list**.

A flow-worker restart drops the Massive OPRA websocket, and **Massive does not
replay**: every second of that gap is lost permanently until the T+1 flat file.
This is physics, not policy, and it is the only reason a window exists at all.

⛔ The watch list lives in the Railway dashboard, which is the authority. Its one
in-repo mirror is the header of `api/flow_worker_main.py`. Do not keep a second
copy here — that is a second authority over one value.

⛔ `api/services/**` and `api/routers/**` are NOT on the list today, which cuts the
other way: a change there deploys **nothing** to flow-worker and ships inert.
`tools/flow_worker_watch_coverage.py` fails a diff that strands such a change.

## How to tell which tier you are in

```sh
python tools/flow_worker_watch_coverage.py
```

It prints what flow-worker reaches, what it watches, and what this branch changes.
Exit 1 means a change is stranded. It does not decide the tier for you — read its
output against the watch list.

## ⛔ REVIEW-GATE-BY-DESIGN — a red from the coverage rail was NEVER a deploy block

> **`flow-worker deploy coverage` exits 0 and reports through a `::warning::` annotation
> and the job summary. A red there requires a written classification; it has never blocked
> a merge, and as of 2026-09-14 it can no longer block a deploy either.**

⚰️ **The rule below said this from the start and the exit code said otherwise.** The
workflow ran `python tools/flow_worker_watch_coverage.py`, which exits non-zero on a RED,
so GitHub recorded a deliberate review signal as a **FAILED CHECK**. That was harmless
while nothing consumed check status — and became load-bearing the moment Railway's
**"Wait for CI"** was considered, because it waits on **all** GitHub checks. Enabling it
would have converted this rail into a hard deploy block for essentially every backend
change.

**Measured before changing it** (last 50 master runs per workflow, 2026-09-14):

| workflow | pass rate on master | class |
|---|---|---|
| Options Flow guard | 50/50 | hard check, healthy |
| wisdom rails | 50/50 | hard check, healthy |
| Joystick device suite | 5/5 | hard check, healthy (scheduled + narrow paths) |
| OCR Linux version cert | 1/1 | hard check, healthy (narrow paths) |
| vite build args | 39/50 | hard check — **recovered**; newest failure 03:59Z, green since |
| master deploy gate | 4/5 | hard check, healthy (the one failure was its own first run) |
| **flow-worker deploy coverage** | **44/50** | **REVIEW GATE** — all 6 "failures" were correctly-classified ADDITIVE breadth merges |
| Clock parity fixture | 0 on master | **ghost** — no file on master (lives on `feat/indicator-r0r1`) |
| Perplexity spike diagnostic (temporary) | 0 on master | **ghost** — file deleted; 2 runs on a since-deleted branch |

⛔ **GITHUB'S WORKFLOW LIST IS NOT THE CHECK SET, and reading it as one would have sent
somebody hunting for two files that do not exist.** The API lists **nine** workflows;
`.github/workflows/` on master holds **seven**. GitHub keeps a workflow in the list once
it has run history, even after its file is deleted — so the last two cannot run on master
and need no disabling. They were about to be "disabled" here before the tree was checked
against the list.

⭐ **No hard check was permanently red**, which is what made option 1 viable: exactly ONE
workflow needed its semantics corrected, and nothing needed disabling.

⚠️ **The script keeps its non-zero exit.** Run locally it still fails, which is what a
developer's own run should do. The neutralisation is in the workflow only — at the one
place where an exit code was being mistaken for a deploy verdict.

## Interpretation — what a red from the coverage rail requires

Owner ruling, 2026-09-11. **The coverage rail is a REVIEW GATE. A red does not block a
merge — it requires a written classification before the push.** The classification goes
in the pushing program's ledger row (for Terminal-Next:
`docs/terminal-research/00-program-control/LEDGER.md`), never only in a commit message.

⭐ **Why a classification rather than a block.** The scale makes a hard block unworkable
and a silent skip dishonest: **flow-worker reaches 154 files and 23 are watched, so 133
are reachable-but-unwatched** — 83 of them in `api/services/`. A rule that blocked every
one would stop most backend work in this repo; a rule that ignored them would make the
rail decorative. Writing down *which kind* of strand this is keeps the signal alive and
puts the judgement on the record.

### ADDITIVE — merge, and say so

The stranded change **adds** functions, routes, tables or constants that flow-worker does
not call. Flow-worker keeps running the older file, which simply lacks something it never
invokes.

- **Merge it.** The ledger row records: *"flow-worker stranded: ADDITIVE, safe; discharge by
  marker bump,"* plus one line naming **which** additions and **that flow-worker does not
  call them**.
- **Discharge it with a MARKER BUMP at the next window** — see "How a strand is actually
  discharged" below.

⚰️ **CORRECTED 2026-09-12.** This section originally read *"flow-worker is redeployed at the
next weekend/after-hours window regardless, so stale never exceeds a week."* **That was an
assumption about other workstreams' commits, not a mechanism.** Flow-worker only rebuilds
when someone pushes a file on its watch list; if nobody does, a strand sits indefinitely.

## How a strand is actually discharged — the deploy marker

⛔⛔ **`railway redeploy --service flow-worker` DOES NOT DO THIS. Do not use it for this.**

**Measured 2026-09-12 04:07 UTC.** A CLI redeploy returned exit 0 and the deployment went
BUILDING → DEPLOYING → **SUCCESS** — on **the same commit it started from** (`9efbb34a8`),
while master was `b272db249`. The CLI resolves *"the latest deployment"* to the last
**actual** deployment, and flow-worker's recent records are `SKIPPED` (17 of the last 20 —
the strand, visible in the artifact). **It dropped the OPRA websocket and advanced nothing.**
The cost was zero only because the market was closed; in a live window that is a permanent
tape gap for no benefit.

⭐ **And `railway` has no command that can do it.** `railway deployment` offers only `list`,
`up`, `redeploy`; `up` uploads the *local directory*, which is not an acceptable deploy
source for production. There is no "deploy commit X".

**The mechanism: `api/flow_worker_deploy_marker.txt`.** A file read by nothing, whose only
job is to sit on flow-worker's watch list. Appending a dated line to it and pushing forces
flow-worker to rebuild **from master's tip**, picking up every strand accumulated since.

**Rules for a marker bump:**

1. **Window only** — weekend or after-hours, market closed. A bump *is* a flow-worker
   restart and so costs a tape gap.
2. **Append, never rewrite.** One dated line per deploy, naming the strands being discharged.
3. **Confirm by artifact**: flow-worker's running commit must **advance to master's tip**.
   ⛔ A `SUCCESS` status is not the artifact — the *commit hash* is. That distinction is the
   entire lesson of the 04:07 no-op above.
4. **Ledger the bump** with before/after running commits and the strands it discharged.
5. ⛔ **The marker file is the ONLY flow-worker path a non-flow-worker program may touch.**
   Every other path under flow-worker's watch list stays barred.
- ⛔ **"Additive" is a claim about the diff, so check the diff, not the intent.** The
  practical test is `git diff <merge-base>..HEAD -- api/ | grep -cE '^-[^-]'` — zero
  deletions is strong evidence; a non-zero count means read every one before claiming it.
  An added import line is additive; an altered default is not.

### BEHAVIOUR-CHANGING — window only, with a confirmed redeploy

Anything that alters a function flow-worker actually executes, a shared schema, or a
default value.

- **Merge only inside a weekend/after-hours window, with a flow-worker redeploy confirmed
  BY ARTIFACT in the same session** — its uptime reset, not a CLI exit code and not the
  absence of an error.
- ⛔ A behaviour-changing strand merged outside a window leaves flow-worker executing
  *different logic from the rest of the estate* until the next redeploy, with every test
  green. That is the exact condition this rail exists to make visible.

### Both cases

⛔ **Neither classification licenses editing flow-worker's own files or widening its watch
list** to dodge the red. The watch list is deliberately narrow — the workflow's own header
explains that a wider list means more restarts and more permanently-lost tape — and this
Interpretation does not change it.

⚠️ A red with **no** classification in the ledger is the one unacceptable state. It is
indistinguishable from nobody having looked.

Or measure after the fact: `railway deployment list --service flow-worker --json`
reports **`SKIPPED`** for a push that touched no watched file. Over the 14 master
pushes to 2026-09-11, flow-worker was SKIPPED on **14 of 14**.

## ⚰️ Two rules this replaces, and why both were wrong

1. **"No master push Mon–Fri 09:00–16:00 ET, docs-only included."** Too broad. It
   was justified by "every master push redeploys web, worker, bars-api and
   flow-worker in lockstep", which is false: measured over 14 pushes, flow-worker
   deployed **zero** times, worker and bars-api only on the two `api/**` commits,
   and only **web** deploys on every push. A docs-only push has never touched the
   tape.

2. **"Ignore the no push window, we can push anytime anyday forever."** Too narrow
   in the other direction. It dropped the flow-worker case entirely, and that case
   is real: a push touching a watched `api/*.py` file gaps the tape whatever the
   clock says. The rationale under a rescinded rule is not the rule — this file has
   had a restriction re-derived from its own surviving rationale twice.

**Neither should be restored. The tier that applies is decided by the FILES, not by
the hour.**

---

## Current state — LITERAL watch patterns, read from Railway 2026-09-12 03:4x UTC

These are the **literal patterns Railway returns**, not inferences. Re-read any time
with `python tools/railway_watch_patterns.py` — it authenticates from the railway
CLI's own session when no token is set, so it needs no provisioning.

    web             []                                  <- no filter: EVERY push rebuilds it
    worker          /api/**  /requirements.txt  /railway.json
                    /nixpacks.toml  /Procfile  /runtime.txt
    bars-api        api/**  requirements.txt  nixpacks.toml  railway.json
    chart-renderer  []                                  <- but NO repo source, so no push deploys it
    flow-worker     api/massive_ws_worker.py  api/massive_processor.py  api/flow_db.py
                    api/confluence_flow.py  api/flow_worker_main.py
                    api/live_massive_router.py  api/flow_router.py
                    api/flow_router_mount.py  api/flow_heal_enrich.py
                    api/flow_gap_autofill.py  api/massive_flatfiles_worker.py
                    api/flow_watchdog.py  api/oi_snapshots.py  api/massive_stream.py
                    api/flow_tape_spool.py  api/flow_backup.py
                    api/dealer_positioning.py  api/flow_rest_backfill.py
                    railway.json  requirements.txt  api/alpha_gold_eod.py
                    api/weekly_flow.py  api/flow_opt_aggregate.py

⛔ **`[]` MEANS "NO FILTER", NOT "NEVER DEPLOYS" — and the two services holding it
behave oppositely.** `web` has an empty list AND a repo source, so every push rebuilds
it. `chart-renderer` has an empty list and NO repo source, so no push touches it. The
field alone cannot be read as either; pair it with the source. ⚠️ If chart-renderer is
ever connected to the repo, that empty list silently becomes "rebuild on every push".

⚠️ **`worker` anchors its patterns with a leading slash and `bars-api` does not**
(`/api/**` vs `api/**`). Under gitignore semantics a leading `/` anchors to the repo
root while a bare path can match at any depth, so `bars-api` would also match a
hypothetical `packages/foo/api/…`. Neither matters today — there is one `api/` — but
the inconsistency is real and is recorded rather than tidied, because "they looked the
same" is how a pattern difference goes unnoticed.

✅ Every watch target exists in the repo — `Procfile`, `runtime.txt`, `nixpacks.toml`,
`requirements.txt`, `railway.json` all present. No dead entries.

### Two live pushes on 2026-09-12, both confirming the rule

**Docs-only (`13fa3cf84`)** — CLAUDE.md + a runbook:

    web          SUCCESS     (~1 min /api/* blip; a 502 during the swap, recovered)
    flow-worker  SKIPPED
    worker       SKIPPED
    bars-api     SKIPPED

**api/** (`a5173fe41`)** — the flow-worker bundle:

    web          SUCCESS
    flow-worker  SUCCESS     <- restarted; OPRA tape gapped, as designed
    worker       SUCCESS
    bars-api     SUCCESS

⭐ So: **only web restarts on a docs push, and flow-worker restarts only for its own
watched files.** That is the whole rule, now confirmed on real pushes rather than only
on history. worker and bars-api track `api/**` broadly — they woke for the api push and
slept through the docs push.

### Verify a deploy by the ARTIFACT, never the config
- `railway deployment list --service <svc> --json` → `SKIPPED` means the push touched
  nothing that service watches.
- `/api/health` **uptime RESET** is what proves a new web pod, not a 200.
- For flow-worker, `stats_process_local` resetting to zero is the honest restart signal.
- ⛔ `railway variables --kv` shows what the service is CONFIGURED with. It is **not**
  evidence the running process has it. Measured 2026-09-12: `--kv` reported
  `FLOW_FAST_DATE_SCAN=1` while the running pod still returned `None` for it, because
  the variable's own redeploy had not swapped yet. Read it in-process.


## Credentials — how the pattern tool authenticates

`tools/railway_watch_patterns.py` tries, in order: `RAILWAY_TOKEN` (project token,
header `project-access-token`), `RAILWAY_API_TOKEN` (account token, `Authorization:
Bearer`), then the **railway CLI's own OAuth session** from `~/.railway/config.json`.
Precedence is deliberate — most-scoped first — so a broken token is never masked by
the session quietly working. `auth_source()` prints which one was used, never a value.

**No token is currently provisioned, and none is needed on a machine where `railway`
works.** Two attempts to mint one were made and both refused:
`projectTokenCreate` returns **"Not Authorized"** for session-scoped auth, and
persisting a minted account token to the user environment was blocked by this
machine's own secret-store guard. If a token is ever wanted for CI (where no CLI
session exists), create it in Railway → Project → Settings → Tokens, scope it to
`luminous-recreation` / `production`, and set `RAILWAY_TOKEN`. Rotate by deleting it
there and repeating; the tool needs no code change.

⛔⛔ **THE 403s THAT BLOCKED THIS FOR TWO SESSIONS WERE NOT THE CREDENTIAL.** Railway's
GraphQL API refuses any request lacking `x-source` and `user-agent`, both `"CLI
<version>"` (railwayapp/cli v4.35.0, `src/client.rs` + `src/consts.rs`). Four attempts
— two hosts x two auth headers — all returned 403 and were filed as "the public API
rejects the CLI session token". The token was fine; the request was malformed.
⭐ **A 403 says the request was refused, never WHICH part of it was wrong** — and a
plausible explanation for a refusal is not a diagnosis.

---

## ✅ THE ONE-MERGE-AT-A-TIME RULE IS NOW MECHANICAL — `tools/pre_push_guard.py`

⚰️ **THE RULE WAS ALREADY WRITTEN AND IT WAS NOT FOLLOWED.** `CLAUDE.md` carries *"ONE MASTER MERGE
AT A TIME, REPO-WIDE — Railway `web` SUCCESS before the next push"*. On **2026-09-13, 21:08–21:16
UTC** three pushes landed in eight minutes (`e5dfb23fb`, `b66363b9d`, `aa2acfcd2`); `/api/health`
served **502** through the overlap and a `railway ssh` probe was refused outright.

⭐ **A rule that lives only in a file nobody opens before pushing has no reader.** This is that rule
with a reader.

**What it refuses.** A push whose destination is `master`, while the newest `web` deployment is
anything other than `SUCCESS`, **or** is a `SUCCESS` younger than **150 s** — Railway reports
SUCCESS at healthcheck while the old container is still draining (`drainingSeconds: 30`), so a
two-second-old SUCCESS is a coin flip, not a settled service.

⛔ **IT FAILS CLOSED.** CLI missing, unauthenticated, project unlinked, hook file absent — all
REFUSE. A guard that fails open reports "fine" precisely when it has stopped working.

⚠️ **AND IT ALREADY REFUSED EVERY STATE THE 2026-09-14 INCIDENT INVOLVED** — `decide()` returns
REFUSE for `BUILDING`, `DEPLOYING`, `FAILED`, `CRASHED`, `REMOVED`, an empty status, an unreadable
state and a too-young SUCCESS, each with its own rail in `tests/test_pre_push_guard.py`. **How the
12:32 push got past it was NOT determined**: the guard blob was byte-identical on that branch
(`6c717a33d`), the hook lives in the shared `.git/hooks` so every worktree on this machine has it,
and `logs/pre-push-guard-bypass.log` recorded nothing. `git push --no-verify` skips hooks entirely
and leaves no trace, which is the one path that would look exactly like this. ⛔ **Do not "harden"
the unreachable branch into a warning to close this** — it is already the strictest thing it can
be, and softening it would trade a real guarantee for the appearance of a fix. `--audit` below
exists because prevention was already there and something defeated it, so the next occurrence
should at least be VISIBLE.

⛔ **IT DOES NOT REQUIRE THE DEPLOYED COMMIT TO BE YOURS.** `SUCCESS` on another workstream's commit
still means the pod is settled, which is the property that matters. Requiring your own parent would
refuse every legitimate push in a repo five workstreams share.

```sh
python tools/pre_push_guard.py          # 0 = safe, 1 = refuse, prints the state
python tools/pre_push_guard.py --audit  # after the fact: SUSPECTED stacked pushes

# BURST-only refusal (recency + in-flight passing on their own) — the ONLY scoped exit:
UCT_BURST_ATTESTED_BY="<a human who can see every workstream>" \
UCT_BURST_ATTESTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" git push …

# ROLLBACK ONLY (HEAD must revert the commit production is SERVING):
UCT_ROLLBACK_REASON="<why members need this now>" UCT_SKIP_PREPUSH_GUARD=1 git push …
```

⚠️ **`--audit` is a HEURISTIC and says so in its own output.** Railway's deployment list carries
only `status` and `createdAt` — there is no per-deployment "reached SUCCESS at" timestamp — so it
can report that two distinct commits were deployed closer together than a build takes, which is
what a stacked push looks like, and it cannot prove the first was still building. It prints
**SUSPECTED**, never CONFIRMED.

### ⛔⛔ A PUSH IS NOT CLEAR UNTIL ITS WEB DEPLOY REACHES `SUCCESS`

> **A push is not clear until its web deploy reaches SUCCESS. Any session seeing a deploy in
> BUILDING/DEPLOYING state must wait, even if the queue looked clear when it started its gate.**

Owner ruling, 2026-09-14, from a SECOND occurrence eight days after the guard was built.

⚰️ **The incident.** `7705c2d3b` was pushed at **12:29:23 UTC** with the guard green
(*"web is SUCCESS on 00b029552, 333s settled"*). At **12:32:16 UTC** — 173 seconds later, while
that build was still `BUILDING` — another workstream pushed `9e2b93805`, which marked the first
deployment `REMOVED` mid-flight. A production request that was in flight at that moment died with
a **500 after 93 s**, and `/api/health` returned **502** for roughly 45 s until the new pod came
up. It recovered on its own.

⭐ **The gap the rule closes is a TIME gap, not a logic gap.** The guard reads the queue at the
moment of the push and is correct at that moment; a build takes ~3–5 minutes, and nothing in a
point-in-time check covers the window that opens immediately afterwards. "The queue was clear when
I started my gate" is true and useless — the gate takes minutes, and the queue is a property of
the instant you push, not of the instant you began.

⚠️ **So the wait is on the DEPLOY, not on the check.** After a green guard, the pusher owns the
queue until their deploy is `SUCCESS`; anybody else who reads `BUILDING` or `DEPLOYING` waits,
regardless of what their own guard said earlier.

#### ⛔⛔ AND THE RULE ABOVE HAS A HOLE IT CANNOT SEE — a third occurrence, 2026-09-16

> **A Railway deploy record appears ~3m25s AFTER the push that creates it. For that window a
> push exists and the deploy list does not show it, so "nothing is in flight" is true and
> insufficient. `railway deployment list` is evidence about DEPLOYS, never about PUSHES.**

⚰️ **The incident, and note that no rule above was broken.** A breadth session's lander read the
queue at **05:39:49Z** and got *"web is SUCCESS on 95596c83c, 2400s settled"* and *"2 web deploy(s)
in the last 60 min, none inside 600s — master is quiet."* All three of its clauses (no ACTIVE
deploy, burst under 3 distinct commits, newest deploy older than 600 s) were satisfied **and
correct**. It pushed. A peer had already pushed `cc5527f66` at ~05:37:33Z; **that deploy record did
not appear until 05:40:58Z — 69 seconds after the guard had finished reading.** The breadth deploy
`54abdefeb` was created 05:43:14Z and marked the peer's `REMOVED` 2.3 minutes into its build.

⭐ **This is not the same gap as the section above, and that is why it survived it.** The 2026-09-14
rule tells you to wait when you *see* `BUILDING`. Here there was nothing to see: the competing push
had happened and had not yet become a row. **No polling interval closes this** — the checker and the
thing it checks are separated by a delay the checker cannot observe, so a longer wait just moves the
blind window, it does not shrink it.

✅ **What actually closes it is already in the repo and is not a client-side guard.** The
**`master deploy gate`** workflow serialises master pushes at GitHub
(`concurrency: master-deploy`, `cancel-in-progress: false`) and Railway's **Wait for CI** holds the
build behind it. That group observes **the push**, which is the only thing that can. A client hook
asks every session to cooperate and cannot see the sessions that already have.

⚠️ **Nothing was lost in this instance, and do not read that as the outcome being fine.** The peer's
commit was an ancestor of the merge's first parent, so their work shipped inside the superseding
deploy — luck of ordering, not design. Had the breadth branch been based on an older master, the
peer's deploy would have been killed for a build that did not contain their change.

#### ⛔⛔ THE MORE DANGEROUS HALF: A SUPERSEDED DEPLOY LEAVES A HEALTHY-LOOKING UPTIME

> **Verify a deploy by its OWN record's `status` in the deploy list, and prove code is live by
> ANCESTRY against `origin/production`. Never by an `uptime_seconds` you have not tied to a
> named deploy.**

Found by the Notebook session while checking the incident above, and it is the part that would
have gone unnoticed indefinitely. When your deploy is superseded, the pod that answers
`/api/health` is the **superseding** one — so `uptime_seconds` keeps climbing, monotonically and
truthfully, and reads as proof that *your* deploy is healthy while measuring somebody else's.

⭐ **Every individual number in that check is correct.** That is what makes it survive review: a
15-minute blip check returning 30 samples, zero 5xx and uptime rising 408 → 1301 is a real
measurement of a real pod, and nothing in it is wrong except what it is believed to be about. On
2026-09-16 the Notebook session's verification window (05:52–06:07Z) sat **entirely inside the
breadth deploy's pod life** (boot 05:45:23Z), and reported it as verification of a deploy that had
been `REMOVED` at 05:40:58Z.

**The two checks that actually answer it, and they answer different questions:**

| question | the only thing that answers it |
|---|---|
| did MY deploy ship? | its own row's `status` in `railway deployment list` — `SUCCESS`, not the newest row's |
| is my CODE live? | `git merge-base --is-ancestor <sha> origin/production` |

⚠️ Both are needed. Ancestry can be true while your deploy was superseded (your commit rode
someone else's build — exactly what happened here), and a `SUCCESS` row does not by itself say
which commits the build contained.

### ⚰️ THE CLOCK IS GONE — REMOVED PERMANENTLY BY OWNER RULING, 2026-09-17

> *"I am sick of the no push window during market hours. Remove that from whatever is
> causing this every day. Remove that permanently."*

**There is no market-hours push window and there must not be one again.** A clock gate once
refused a master push during the session unless every changed path was Tier 1. R18 retired
the REFUSAL on 2026-09-15 but kept the constants, the override env var, the docstring and a
log line printed on every push — all still naming the hours. **Presence was the problem, not
the predicate:** every session that read the guard re-learned a rule that no longer existed,
and every prompt that read their output re-inherited it.

All of it is deleted. `tests/test_no_market_hours_window.py` fails the master gate if the
mechanism returns, and asserts the guard is **time-of-day invariant** — identical output at
10:00 and 22:00 ET on identical deploy state — so a clock cannot come back under a new name.

⭐ **The incident that built the clock is kept, because the lesson outlived the rule.** On
2026-09-14 a session reasoned a merge should wait for the close, wrote that down, set a timer
— and pushed at 15:49 anyway on a mental estimate that had drifted ~25 minutes. The lesson is
*an estimate that happens to agree with you is not a check*; the clock was the wrong
mechanism for it, and the cadence clauses below are the right one.

## What the guard refuses NOW — the two live clauses, and they are the whole of it

| situation | verdict |
|---|---|
| newest `web` deploy is BUILDING/DEPLOYING | **REFUSE** — a swap is in flight |
| newest `web` deploy is SUCCESS but < 600 s old | **REFUSE** — recency; it has not settled |
| ≥ 3 distinct commits deployed to `web` in 60 min | **REFUSE** — burst |
| the deploy history cannot be read | **REFUSE** — an unreadable queue is not a quiet queue |
| anything else, at any hour of any day | **OK** |

⛔ **THE TIER LIST BELOW DOES NOT EXEMPT ANYTHING FROM THOSE CLAUSES.** `CLEARED_PREFIXES`
was the CLOCK's daytime-clearance list and the clock is gone; `decide_cadence` never
consulted it and still does not. A docs-only push and an `api/**` push are paced
identically. Measured 2026-09-17 from the guard source, because the opposite was assumed.

⛔ **The cleared list is DERIVED FROM TIER 1 ABOVE and re-read at test time**, so editing this
document moves the guard. Do not maintain a second copy of it in the tool — that is the
second-authority defect this runbook already carries three examples of.

⚰️ **THE MARKET-HOURS WINDOW WAS REMOVED PERMANENTLY BY OWNER RULING, 2026-09-17, AND MUST
NOT BE REINSTATED.** The ruling, verbatim: *"I am sick of the no push window during market
hours. Remove that from whatever is causing this every day. Remove that permanently."*

R18 had retired the refusal in 2026-09-15 while KEEPING the constants, the override env var,
the docstring and a log line that all still named the hours — so every session that read the
guard re-learned a rule that no longer existed. **Presence was the problem, not the
predicate.** All of it is deleted, and `tests/test_no_market_hours_window.py` fails the gate
if any of it returns.

**There is no clock override, because there is no clock gate.**

⛔⛔ **AND SINCE R66 (owner ruling D-18, 2026-09-17) THERE IS NO GLOBAL OVERRIDE EITHER.** This
line used to read *"The one remaining bypass is `UCT_SKIP_PREPUSH_GUARD=1`, which overrides the
DEPLOY QUEUE and is logged"* — accurate, and the reason the 2026-09-17 in-flight push happened:
the operator needed to pass **burst** and the only lever in reach waived **everything**.

| refusal | the only exit |
|---|---|
| **burst** alone, recency + in-flight passing independently | `UCT_BURST_ATTESTED_BY` + `UCT_BURST_ATTESTED_AT` (ISO, ≤15 min) — R19's scoped attestation, a named human at a named minute |
| recency · in-flight · unreadable · unparsable | **none. Wait.** No lever this programme holds waives a measurement of the world |
| production is serving a commit that must come off now | `UCT_ROLLBACK_REASON` + `UCT_SKIP_PREPUSH_GUARD=1`, and HEAD must actually revert **that** commit |

Every accepted use of either remaining lever is appended to `logs/pre-push-guard-bypass.log`
with a machine-readable `reason_code` (`BURST-ATTESTED` / `ROLLBACK`).

⚰️ R66's first draft added a third row here: the retired deploy-window override made to **error**
rather than be a no-op. `tests/test_no_market_hours_window.py` went red on the variable's name
alone and was right — **presence was the problem, not the predicate.** Nothing reads it, so it is
already inert, and naming it in order to refuse it would put the window's vocabulary back into
this runbook. Two levers exist; the table above is the whole list.

**Checking harm after a restart:** `tools/deploy_blip_check.py` reads a log pull and counts HTTP
statuses **by structured field**. ⚰️ It replaces a check that grepped for `502` and matched the
**millisecond field** of a timestamp (`19:41:44,502`) — eighteen hits, none of them a status, and
"no 502s found" was therefore never a measurement. It is three-valued and reports **INCONCLUSIVE,
never CLEAN**, when no line in the window carries a status at all or when the pull was a FLOOR.

### Installing it (advisory to the other workstreams)

The hook lives in the **shared** `.git/hooks/` — one install covers every worktree of this
repository:

```sh
cp <repo>/tools/pre_push_guard.hook "$(git rev-parse --git-common-dir)/hooks/pre-push"
chmod +x "$(git rev-parse --git-common-dir)/hooks/pre-push"
```

⚠️ **Hooks are not version-controlled and do not travel with a clone.** Each machine installs it
once. The hook no-ops on any push whose destination is not `master`/`main`.
