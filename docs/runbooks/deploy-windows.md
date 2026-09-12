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

## Current state — what actually restarts, measured 2026-09-12

⛔ **The literal watch-pattern STRINGS are still unread.** Railway's GraphQL API
rejects the CLI's session token (403 on Bearer and `Project-Access-Token`, both
hosts), `railway status --json` omits `watchPatterns`, and no CLI command exposes
them. A project token would settle it — `tools/railway_watch_patterns.py` is written
and waiting for `RAILWAY_TOKEN`; it exits **2 (INCONCLUSIVE)** without one, never 0.

What follows is therefore **behaviour, not configuration** — which is the stronger
evidence for "what restarts", and the weaker evidence for "what the patterns say".

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
