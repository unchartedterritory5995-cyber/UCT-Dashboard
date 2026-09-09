# Options Flow roll gate — follow-ups filed 2026-09-09

---

## E0 — CORRECTION: the market-hours freeze rule is BROADER than "flow-worker"

**Stated wrongly during the 2026-09-09 deploy and corrected the same evening.** The
freeze was justified narrowly — "a push touching a flow-worker watched file bounces the
OPRA consumer" — and I repeated that a change to `api/flow_router.py` "deploys
flow-worker on its own." **It does not.** The `184a7e77b` push rebuilt **four** services.

Derived from Railway's live `serviceManifest.build.watchPatterns`:

| service | watchPatterns | matched by that push |
|---|---|---|
| `web` | **`[]` — empty** | **every push**, no filter |
| `worker` | `/api/**`, `/requirements.txt`, `/railway.json`, `/nixpacks.toml`, `/Procfile`, `/runtime.txt` | `api/flow_router.py` |
| `bars-api` | `api/**`, `requirements.txt`, `nixpacks.toml`, `railway.json` | `api/flow_router.py` |
| `flow-worker` | 23 explicit `api/*.py` files incl. `api/flow_router.py` | `api/flow_router.py` |
| `chart-renderer` | `[]` | none — **not git-connected**, so it never rebuilds from a push |

⛔ **AN EMPTY watchPatterns LIST IS NOT "WATCHES NOTHING" — IT IS "NO FILTER".** `web`
carries an empty list and therefore redeploys on **any** master push, including one that
touches only a test file or a doc.

**The accurate freeze rule:** *any* push to master during RTH is a **full-site bounce**,
not a flow-worker event. It costs:

- **flow-worker** — the OPRA consumer drops for the 4–7 min container start, and that
  tape gap is **permanent** until the overnight T+1 flat file. This is the expensive one.
- **web** — `/api/*` blips for roughly a minute. Observed live on 2026-09-09 at
  18:14 ET: the roll-gate sampler recorded `HTTPError 502: Bad Gateway` on the capture
  taken mid-swap, then recovered on the next one.
- **worker**, **bars-api** — restarted; scheduled jobs and chart-data serving cycle.

So "no deploys between 09:30 and 16:00 ET" is not a flow-worker-specific rule and must
not be relaxed for a change that "doesn't touch flow-worker files." There is no such
change: `web` rebuilds on all of them.

---

Filed so they stop riding along in deploy messages. **None of these are actioned.**
Context: `fix/flow-roll-classifier` (`ec0824dc0`, `3e8eea179`, `184a7e77b`) fixed the
classifier that left `rolls_steady` permanently empty. Today had **two independent
failures**; the fix addresses one.

---

## E1 — Ledger retention (the second failure, still open)

`_PREPARE_ROLLS = collections.deque(maxlen=80)` is a **single deque shared by both
classifications**, and the endpoints serve `rolls_steady[-25:]` / `rolls_startup[-5:]`.

2026-09-09 proved this loses evidence independently of classification. The forced-bump
offset went 0 → 1 at **08:00 ET** (fill run 246, 17,492 rows inserted), not at boot.
So rolls from 00:08–08:00 ET **were** classified `steady_state_roll` correctly by the
bucket rule — and were then **evicted** from the 80-slot deque by the ~9 hours of
misclassified rolls that followed. By 17:19 ET the ledger showed `rolls_steady: []`
against `prepared: 437`.

Options to evaluate: separate deques per kind (so late-session volume of one kind
cannot evict the other), a larger `maxlen`, or persistence across restarts.

⛔ **The sampler is a workaround for this, not a fix.** `C:\Users\Patrick\flow-gate-sampler\`
externalises the union because the in-process ledger cannot hold a session.

---

## E2 — The `prev_version is None` latch, deferred

**Deferred, not rejected.** The fix classifies a bumped roll as a catch-up iff
`prev_version is None`. The proposed alternative latches the first version the detector
ever saw (`_FIRST_SEEN_VERSION`) and classifies catch-up iff `version ==
_FIRST_SEEN_VERSION`.

**Why deferred:** the boot tick consumes the catch-up before anything else can. At
startup `_PREPARE_LAST` is `None`, and the loop's first tick (~2 s, `FLOW_PREPARE_POLL_S=2`)
prepares and records roll #1 as the catch-up. Every later roll therefore carries a
non-null `prev_version` under the fallback **and** a version differing from
`_FIRST_SEEN_VERSION` under the latch. The two rules agree on every roll that actually
occurs, so the latch was not worth a second untested-in-prod change on the critical path.

**What it would buy:** the one sample lost when a process boots, its first prepare
**declines**, the version then moves, and the first *recorded* roll is therefore a new
generation wrongly filed as a catch-up. With `declined: 261` against `prepared: 437` in
the observed process, that case is **not rare**. The error is always in the direction of
discarding a sample, never of admitting a bad one.

Cost: ~5 lines (one module global, one assignment in `_note_version_seen`, one fixture
reset) plus two tests.

**Rejected alternative:** a set of bump-minted versions fed from `bump_data_version()`.
It covers only *bumped* versions; ordinary signature rolls are the majority and would
still need a separate rule — strictly more machinery covering less.

---

## E3 — `/api/flow/aggregate-health` is unauthenticated

It serves internal byte counts, cache keys, per-process counters and the version
ledgers with no session. Deliberate — the docstring argues "a health check nobody can
reach without a session is a health check nobody runs" — but the payload has grown well
past the booleans that argument was written for. Revisit after the gate closes.

---

## E4 — CSV materialization is now the dominant cold-window cost

`first paint warmed in 28814ms` against `parts built in 8928ms` puts **≈19.9 s** in
`_get_cached_or_build`, turning SQLite into a **14.8 MB CSV**. It is keyed by
`(source, days, version)`, so it is **rebuilt on every version roll**; both preparer
passes share it (pass 2 was only 7.4 s), so it is paid once per roll rather than twice.
With the emission-filter + two-pass change having cut the parts build from ~33 s to
~8.9 s, this is the **largest remaining piece of the cold window** and the next thing
worth attacking.

---

## E5 — Stale-valid serving (owner decision, pending)

**Today:** a member whose load lands in the ~8 s window just after a version roll finds
no prepared parts for the current generation and falls back to the raw tape — several MB
downloaded and `processFlowData` run client-side. Current-generation data, slowly.

**The change:** serve the *previous* generation's already-built parts instead —
~200 ms prehydrated, but up to ~60 s older. Concretely, on a 60 s roll cadence a member
opening Options Flow in that window could see a TOP 10 table, ticker aggregates and
cap-filter counts computed from a tape snapshot up to a minute stale; trades printed in
the last minute would be missing from the numbers on screen.

**What the transport already guarantees:** `planBundle` requires only that the requested
parts agree *with each other* (`versions.size === 1`) — it never compares against the
current version. The server already serves a stale part under lock contention
(`stale_served`, 304 occurrences in the observed process) with an honest `X-Flow-Version`.
So bundle self-consistency is guaranteed — a member never sees parts mixed across
generations — and previous-generation delivery is something the transport already permits.

**What authorizing it means:** extending that from an incidental lock-contention
fallback to a deliberate cold-path policy — *serve generation N−1 rather than dropping
the member to the raw tape.* It trades up to ~60 s of freshness for a ~40× faster load
in the window that is today the worst member experience on the page. It is
member-visible, which is why it is an owner call.

---

## E6 — `web` has an EMPTY watchPatterns list (configuration defect)

`web` carries `watchPatterns: []`, and on Railway an empty list means **no filter** —
so the member-facing service redeploys on **every** master push, including docs-only and
test-only ones. That is what made `184a7e77b` a four-service bounce, and it is what makes
the RTH freeze (E0) apply to changes that touch nothing web depends on.

**Fix:** give `web` an explicit list. The other three services are the template —
`bars-api` uses `api/**`, `requirements.txt`, `nixpacks.toml`, `railway.json`; `worker`
uses the same with leading slashes plus `/Procfile` and `/runtime.txt`. web additionally
serves the built frontend, so its list must include the `app/**` sources and lockfiles
that feed `npm run build`, or a real frontend change would silently NOT deploy — the
failure mode is worse than the one being fixed. Derive it from web's build command
rather than copying a sibling.

**Two questions to answer before doing it:**
1. Does editing `watchPatterns` on Railway itself trigger a redeploy? (Unknown — check
   before changing it during market hours.)
2. Is the empty list deliberate — a deploy-everything-always safety choice — rather
   than an oversight? Confirm with the owner before narrowing it.

⛔ Getting this wrong fails **closed on deploys**: a too-narrow list means a shipped
change never reaches production while every status badge reads green.

---

## E7 — The two docs commits ship AFTER the close, not before

`5a3754e72` and `22965ec87` are on `fix/flow-roll-classifier` and deliberately NOT on
master. Per E0, pushing them to master would bounce `web` (empty watchPatterns), so they
must not be pushed between 09:30 and 16:00 ET **2026-09-10**, however tidy it would feel.
Plan: merge after the close, together with whatever the gate result implies.

---

## E8 — `_BUILD_LOCK` contention can inflate `observed_s`

`observed_s` runs from the detector's sighting to first-paint publication, so a roll that
spent time DECLINED — `_BUILD_LOCK.acquire(blocking=False)` failing because a member
request or the search warm lane held it — carries that wait **inside** the number. There
is a ~90 s precedent: one pathological ticker (MU, 465,956 rows) exceeded the 60 s derive
timeout and held the single build lock for ~90 s per attempt, starving every other warm.

So an `observed_s >= 60 s` reading has two possible causes with two different fixes:
**lock contention** (`declined` climbing across the roll's window) versus **the preparer
itself losing the race** (`declined` flat). `summary.py` now attributes any roll over
30 s automatically. If tomorrow's session shows contention, that is the next thing to
fix and it is **separate from the classifier**.

---

## E9 — A BUILD CAN HANG FOR 30+ MINUTES WITH NO OUTPUT (observed 2026-09-09)

The freeze rule (E0) costs "4–7 min container start". **The honest number is
"4–7 min *if the build does not hang*, and a build can hang for 30+ minutes emitting
nothing."**

**Observed.** Master push `184a7e77b` at 18:11:58 ET rebuilt four services.
`web`, `worker` and `bars-api` all reached SUCCESS within ~5 minutes. **`flow-worker`
sat in `BUILDING` for 35+ minutes**, with its build log frozen on the same line across
three fetches ~13 minutes apart:

```
[INFO]   Downloading resend-2.43.0-py2.py3-none-any.whl.metadata (3.7 kB)
```

**Stage: dependency install** — pip's metadata-collection phase inside
`RUN pip install -r requirements.txt && cd app && npm install && npm run build`,
at line 52 of `requirements.txt`. Not the nixpacks plan, not the image push, not the
container start, and **not the health check** — the new container never started, so
`/api/health` was never involved.

**Three of four services built fine on the same commit at the same moment, so this
was not a Railway builder outage.** flow-worker's build is the heaviest of the four
(pip + `npm install` + a full Vite build producing `flow-facts.cjs`).

### What this changes

⛔ **A "quick revert" is not a thing.** Any plan whose safety rests on "we can push a
fix and be serving in 4–7 minutes" is resting on an assumption this incident falsified.
Pre-open remediation windows must be sized against a build that may never finish, not
against the happy path.

### Two operational facts worth keeping

- ⭐ **Railway keeps the old container serving throughout.** `activeDeployments` listed
  BOTH `25622bb9` (BUILDING) and `ff886d43` (SUCCESS, the 00:08 ET deploy) for the whole
  35 minutes. A hung build is *blind*, never *down*.
- ⛔ **`railway redeploy` REFUSES while a build is in flight**: *"The latest deployment
  for service flow-worker cannot be redeployed. This may be because it's currently
  building, deploying, or was removed."* So the CLI cannot rescue a hung build — the
  only CLI verb that could is `railway down` ("Remove the most recent deployment"),
  whose interaction with the still-serving old container is exactly the risk you do not
  want to take blind. **Cancelling a stuck build is a Railway dashboard action.**

### What a hung build looks like from the outside

**Indistinguishable from a slow one, and invisible to the sampler.** The roll-gate
sampler showed `prepared=437, gen=0, restart=False` throughout — which is also what a
healthy quiet tape looks like. **Railway's deployment status is the only authority.**
Do not try to infer build health from application telemetry.
