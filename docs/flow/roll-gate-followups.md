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
