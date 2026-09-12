# Deploy windows — when a master push is safe

Owner-approved 2026-09-11. Replaces the blanket RTH freeze and the "push anytime forever" line; CLAUDE.md points here and states no rule of its own.
This is the single authority on push timing. `CLAUDE.md` points here and states no
rule of its own.

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

- **Merge it.** The ledger row records: *"flow-worker stranded: ADDITIVE, safe; redeploy
  at next window,"* plus one line naming **which** additions and **that flow-worker does
  not call them**.
- Flow-worker is redeployed at the next weekend/after-hours window regardless, **so stale
  never exceeds a week.**
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
