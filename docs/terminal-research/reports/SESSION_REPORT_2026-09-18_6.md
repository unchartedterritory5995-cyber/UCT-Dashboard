# SESSION REPORT — 2026-09-18, session 6 (D5 CP3/CP4/CP5 built, signed, merged, deployed; D5 CP6 found genuinely UNBUILDABLE; a real merge-tooling bug found and fixed along the way)

**Continuation of session 5's "BUILD THE SIX" work. D5 CP3 (left mid-flight at the
prior compaction boundary) was committed, signed, and merged — then CP4 and CP5
were built the same way. All three are live in production, CI-green. While
merging CP3, master's rapid multi-session churn exposed a real bug in this
programme's own merge tooling (`merge_all.py` never recognized Railway's
`SKIPPED` deploy status as terminal, so any docs-only commit sitting at master's
tip caused a 900-second timeout on every retry) — found, fixed, and verified;
a concurrent session independently fixed the analogous bug in the real
`pre_push_guard.py` git hook while this was in flight. D5 CP6 was investigated
in full and found genuinely UNBUILDABLE-AS-WRITTEN: the paired spec explicitly
forbids emitting a `renamed`/`relation_added` event from inference, and the
`corp_actions` ledger it requires as a sourced input was never actually built
in this codebase (CP2, described as "the ledger" in the packet, does not
exist as code anywhere — confirmed by exhaustive search). D5 CP7 and S6 CP3
remain not attempted, for the reasons already on record from session 5 (CP7)
and this session (CP6's blocker does not touch CP7, but CP7 is a genuinely
large, first-member-visible change needing its own dedicated investigation
pass this session did not have room for after CP3/CP4/CP5/CP6).**

---

## 1 · State

```
ET start                       continuation from session 5's mid-flight D5 CP3
worktrees                      s7-price-level (feat) · terminal-research (docs) ·
                                _merge-master (merge checkout only)
origin/master, each merge      4c2d09b1a (pre_push_guard SKIPPED fix, another
                                session) -> 4fc829aec (D5 CP3) -> ... ->
                                3dfcd8412 (D5 CP4) -> 0f83795dd (D5 CP5)
merge lock                     FREE throughout, reclaimed cleanly at every retry
sign_all --verify               72 SIGNED-ALREADY, 0 NOT YET, 0 refusing
memory                          no writes this session
forks dispatched                none this segment
box condition                   HEAVY multi-session contention throughout: master
                                 moved out from under every single merge attempt
                                 (observed 5+ distinct other sessions' commits
                                 landing during this segment alone), and every
                                 merge_all invocation this segment needed at
                                 least one resync+retry cycle, several needing
                                 three or more. No polling loops — every wait was
                                 a real guard settle window or a real deploy
                                 reaching a terminal status.
```

## 2 · E — unchanged from session 5

E CP38 was scored against real production CI in session 5 (§2 of
`SESSION_REPORT_2026-09-18_5.md`): `NO_NEW_FAILURES` on two consecutive real
master pushes, exact match against the prediction, no E CP39 needed. Nothing
in this segment touches E; not re-scored.

## 3 · S — unchanged from session 5

The S7 price-level dark-read investigation was completed in session 5 (§3),
including the Card 6 rewrite and the F-S7-6 fix. Nothing in this segment
touches S7 price-level; not re-investigated.

## 4 · Q — units built through the engine this session

| unit | scope | tests | mutation arm(s) | commit | row | deploy sha | CI verdict |
|---|---|---|---|---|---|---|---|
| D5 CP3 | `reference_corp_actions.py` — the one confirmed splits source; retires `massive.get_split_tickers` (0 callers); census updated (1 migrated, 1 reclassified, 1 incidental false-positive fixed) | 8 passed (new) + 13 passed (census, 1 updated) | 1 arm, load-bearing (weakened composite PK → RED) | `3bf13974a` | 126 signed (CP3) | `4fc829aec` | all 6 Railway services SUCCESS; GitHub check-runs: promote/rails/gate/coverage all Success |
| D5 CP4 | `bars_sanitize._fetch_meta`'s FMP splits fetch dual-computed against D5's ledger via new `read_confirmed_splits()`; 5 named outcomes, log-only, never changes what is served | 9 passed (new) + 26 passed (bars_sanitize + reference_corp_actions suites) | 2 arms, both load-bearing (let D5 override the served value → RED; removed the sampling gate → RED) | `da2930cec` | 127 signed (CP4) | `3dfcd8412` | GitHub check-runs: promote/rails/gate/coverage all Success |
| D5 CP5 | new module `entity_master_d5_producer.py` (deliberately outside `entity_master/**`) — `source='d5'` for `delisted`/`new_entity`, grounded in Massive's own `delisted_utc`/`list_date` fields, compared each run against `reconciliation.py`'s own proposals | 13 passed (new) + 110 passed (full entity_master suite) | 1 arm, load-bearing (reverted vendor-date grounding to `today()` → RED) | `c7ac0b7bc` | 128 signed (CP5) | `0f83795dd` | GitHub check-runs: promote/rails/gate/coverage all Success |
| merge_all.py SKIPPED-fix | `wait_for_deploy` now recognizes Railway's `SKIPPED` deploy status as an immediate terminal pass (nothing built, nothing in flight to collide with), where it previously fell through both branches and burned the full 900s `DEPLOY_TIMEOUT` | verified with a standalone harness (SKIPPED → True, no sleep; FAILED control → still False) — not part of the pytest suite (this file lives in the docs branch's `tools/`, outside the code repo's own test tree) | n/a — verified by direct harness, not a mutation ladder | `6808f0e85` (docs branch) | — (tooling fix, not a signed unit) | — | n/a |

### D5 CP3's real-world merge saga, briefly

D5 CP3 was left committed-but-unmerged at session 5's compaction boundary.
Getting it onto master took **four resync-and-retry cycles**, three of them
genuine RECENCY/BURST guard timing, and the fourth exposing the SKIPPED bug
above: three separate concurrent sessions each landed a docs-only commit
(`bf100aadf`, `d517e7cd7`, `888791525`) that legitimately produced a Railway
`SKIPPED` deploy status for `web` (none of their diffs touched `web`'s
`watchPatterns`), and each one sat at master's tip long enough to be the
commit `merge_all.py`'s `wait_for_deploy` checked before pushing — where it
then waited the full 900s timeout every time, because `SKIPPED` matched
neither its `SUCCESS` pass condition nor its `FAILED`/`CRASHED`/`REMOVED`
refusal condition. Root-caused by tracing the actual commit diffs (`git show
--stat`) against `web`'s real `watchPatterns` (read from a live `railway
deployment list` response) rather than assumed; fixed in `wait_for_deploy`
with a new branch treating `SKIPPED` as an immediate pass (no settle sleep,
since nothing built means nothing to interrupt); verified with a standalone
harness before committing. A concurrent session independently fixed the
matching bug in the real `pre_push_guard.py` git hook (`3b60707a9`,
`4c2d09b1a`) while this was in flight — confirmed by resyncing and reading
the new commits directly, not assumed.

### D5 CP4's inert-strand re-classification

The packet flagged `bars_sanitize.py` as inert-strand risk **YES** ("flow-worker
RUNS it, does not WATCH it — must be classified live-or-incidental before
merge"). Traced the real import chain rather than trusting the flag: `flow_worker_main
-> flow_gap_autofill -> liveflow_monitor -> bars_fetch -> bars_sanitize`.
`flow_gap_autofill.py` is entirely about the options-flow tape, unrelated to
price bars; `liveflow_monitor.py`'s only reference to `bars_fetch` is a single
constant (`_NYSE_HOLIDAYS_YYYYMMDD`), not a function call; and the two places
`bars_fetch.py` actually reaches into `bars_sanitize` are **function-local**
imports inside private, chart-serving functions (`_fmt_sqlite_bars` and the
cold-fetch deep-history block) that only `web`/`bars-api`'s
`/api/bars/{ticker}` route calls — flow-worker never calls either. Conclusion:
**INCIDENTAL, not LIVE** — flow-worker's process never actually loads
`bars_sanitize.py` at all. No marker bump, no after-hours window. Recorded in
the build record, not asserted from the packet's flag alone.

### D5 CP5's data-source decision, and why it needed one

The packet's own CP5 row does not name CP5's data source — a real gap, not an
oversight to route around. `entity_master.reconciliation` (the "interim job"
the packet says to compare against) already proposes `new_entity`/`delisted`
from a pure presence/absence diff against a live Massive symbol list, and its
own header says plainly *"It is explicitly NOT a substitute for D5."*
`massive.list_reference_tickers` already carries two per-ticker fields
reconciliation.py never reads — `delisted_utc` and `list_date`, the vendor's
own declared facts — so CP5's producer reads those directly: a delisting it
proposes carries the date the vendor actually declared, never the date a job
happened to run (reconciliation.py stamps `today()`). That is the genuine,
sourced improvement over the interim job, mutation-proved in the build record.

## 5 · D5 CP6 — investigated in full, found genuinely UNBUILDABLE-AS-WRITTEN

**Not attempted, and not for lack of trying.** The packet's own CP6 row
(`symbol_change → renamed`, `merger → relation_added`) names no data source,
same gap as CP5's — but unlike CP5, this one does not resolve cleanly.

The paired spec document (`reference-corp-actions-spec.md` §4.2, read in full
this segment for the first time) is explicit and unambiguous:

> *"AND D5 MAY NOT EMIT `renamed` FROM AN INFERENCE. `reconciliation.py:24-32`
> refuses to correlate a delisting with a new listing because 'distinguishing
> them requires a corporate-action signal this job does not have — that is
> explicitly D5's job.' D5's answer to that is a SOURCED record, not a better
> correlation. A `symbol_change` row whose `source_activity` cannot be named
> is a row that must stay `detected` and emit nothing."*

The sourced record the spec requires is a row in a `corp_actions` ledger
(§2.1: `action_type IN ('split','dividend','delisting','symbol_change',
'merger')`, with a `source_activity` and `state` column) — the ledger CP2 in
this same packet is supposed to have built ("the ledger, INERT... written by
nothing, read by nothing"). **Searched exhaustively this session: no such
table, database file, or schema exists anywhere in this codebase.** `grep`
for `action_type`, `corp_actions.db`, and `ca_<ULID>`-shaped identifiers
across every `.py` file under `api/` returns nothing but this session's own
CP3 module (`reference_corp_actions.py`, a narrower, splits-only
`confirmed_splits` table — a different, smaller design than the spec's
generic ledger, built against the packet's own simpler CP3 row rather than
the deeper spec document, which this session had not yet read when CP3 was
built).

**The conclusion, stated plainly:** CP6 cannot honestly emit a single
`renamed` or `relation_added` event today. Doing so would require either (a)
inventing a raw vendor endpoint/field for `symbol_change`/`merger` events that
this session has no evidence for — nothing in `massive.py`, this codebase's
docs, or any prior build touches one — which would be exactly the kind of
unfounded fabrication this repo's own standing rules exist to catch, or (b)
emitting from a presence/absence inference the spec explicitly forbids for
these two event types by name. Neither is acceptable. **No code was written
for CP6.**

**PROPOSED, for whoever picks this up next:** before CP6 can honestly do
anything, something has to either (1) build the real CP2 ledger this spec
describes and a genuine ingestion path that writes `symbol_change`/`merger`
rows into it with a named `source_activity` from an actual, verified vendor
source, or (2) the owner decides CP3's narrower per-action-type-table design
(the pattern this session actually used) is the intended replacement for the
spec's generic ledger, in which case CP6 would need its OWN
`reference_corp_actions`-style table (e.g. `confirmed_renames`,
`confirmed_mergers`) fed by whatever real vendor signal exists for those two
event types — which first needs someone to find and verify that signal
exists at all. This is a real, non-trivial, product-architecture-level
decision, not a coding task, and it is the owner's to make, not this
session's to guess at.

## 6 · D5 CP7 and S6 CP3 — not attempted, exact reasons

**D5 CP7.** Its prerequisite (D5 CP4's dual-compute ledger) is now built,
merged, and live — CP7 is no longer blocked on a missing checkpoint the way
session 5 reported. It was not attempted this segment because it is
genuinely large and carries real risk that deserves its own dedicated
investigation pass: the packet calls it *"the first member-visible change in
the programme"* and flags inert-strand risk **YES** on BOTH
`bars_split_repair.py` and `bars_sanitize.py` — a classification that, unlike
CP4's, is likely to resolve LIVE rather than incidental, since
`bars_split_repair.py`'s entire purpose is to rewrite bars in place (a real
operational side effect flow-worker plausibly does watch or depend on,
unlike CP4's read-only dark comparison). The spec's own `AdjustmentBasis`
design (§3) requires writing a label at the exact point an adjustment
decision is made across at least three different mechanisms (a D1 adapter,
`bars_split_repair`, `breadth_dividends`) and carrying it on served payload
metadata without touching the busiest table in the product (`bars_sqlite`'s
own `(ticker, tf, ts, o, h, l, c, v)` — explicitly out of scope) or
`bar_provenance` (already measured once to hold 0 rows behind 8 call sites,
all in a test file — a known trap this repo has already paid for). Rushing a
first-member-visible, multi-site, two-inert-strand change at the end of an
already-long, heavily-contended session is exactly the shortcut this
programme's own mutation-ladder / told-vs-found discipline exists to
prevent. **Next session's exact starting point:** read
`reference-corp-actions-spec.md` §3 in full (not yet quoted here beyond the
`AdjustmentBasis` dataclass and the write/carry/not-written table), trace
`bars_split_repair.py`'s real flow-worker reachability the same way CP4's was
traced (do not trust the packet's flag either direction), and identify the
served-payload metadata shape `data-architecture.md:548-552` names before
writing any code.

**S6 CP3.** Unchanged from session 5's finding (§4 of
`SESSION_REPORT_2026-09-18_5.md`): blocked on S6 CP2, which is
UNBUILDABLE-AS-WRITTEN (F-S6-1 — the "Calendar is the only caller" premise is
false; 3 real call sites exist including a member-facing alerting path). Not
re-investigated this segment; session 5's exact next-steps stand unchanged.

## 7 · Findings filed / closed this stretch

| id | one line |
|---|---|
| (merge-tooling bug, found and fixed) | `merge_all.py::wait_for_deploy` never recognized Railway's `SKIPPED` status as terminal, causing a 900s timeout on every retry whenever master's tip was a docs-only commit from another session. Fixed, verified with a standalone harness, merged (docs branch, `6808f0e85`). |
| (D5 CP6, filed as UNBUILDABLE) | The paired spec forbids emitting `renamed`/`relation_added` from inference and requires a sourced `corp_actions` ledger row this codebase has never built (CP2 does not exist as code, confirmed by exhaustive search). Recorded in §5 with exact PROPOSED next steps — an owner-level architecture decision, not a coding task. |
| (D5 CP3/4 vocabulary note, for the owner) | The deeper spec document (`reference-corp-actions-spec.md`) describes a generic `corp_actions` ledger and an entity-id-keyed, `None`-vs-`[]`-aware `declared_splits()` function that CP3/CP4 (already merged, signed, deployed) do not match — CP3/CP4 were built against the packet's own simpler table rows, which this session read first and treated as the operative, signed scope. Not retrofitted (would mean re-opening already-shipped, production-deployed code for a stricter design this session only discovered after CP4 was already merged). Flagged here so the owner can decide whether the packet's rows or the fuller spec govern CP7, which depends on this exact distinction. |

## 8 · Retractions / corrections

None this segment.

## 9 · Owner-readable summary

**All three of D5 CP3, CP4, and CP5 are now built, signed, merged, and live in
production** — the corporate-actions splits ledger from a real Massive feed,
a dark cross-check of the existing splits-repair pipeline against that
ledger, and a new confirmed source for delisted/new-listing events grounded
in the vendor's own declared dates instead of guesswork. All three passed
their real CI runs clean.

**Getting D5 CP3 onto master took real, unglamorous effort this segment**
because several other sessions were pushing docs-only changes to master at
the same time, and a genuine bug in this programme's own merge tooling
turned each of those into a 15-minute stall. That bug is now fixed and will
help every future merge on this repo, not just this session's.

**D5 CP6 turned out to be a real dead end today, and it was worth finding
out precisely why rather than faking it.** The plan for CP6 depends on a
piece of infrastructure (a ledger of confirmed corporate-action facts like
renames and mergers) that was designed on paper but never actually built —
so there is nothing real for CP6 to read from yet. Building CP6 anyway would
have meant either guessing at a vendor data source that may not exist, or
quietly breaking a rule the design itself insists on (never turn a guess into
a rename). Neither was worth doing. This is a real decision for you to make,
not a bug to fix: either build that missing ledger for real, or decide the
simpler design this session already used for splits is the right pattern
going forward and build CP6 the same way once its own real data source is
found.

**D5 CP7 is unblocked (its prerequisite is now built) but was deliberately
not rushed** — it is the first change in this whole programme that a member
would actually see, and it touches two pieces of the bars pipeline flagged as
needing careful handling. It gets its own session.

**Where to watch:** nothing is in flight as of this report. `origin/master`
reflects all three units built today.

## 10 · Readiness

```
sign_all --verify              72 SIGNED-ALREADY, 0 NOT YET, 0 refusing
merge lock                     FREE
last three master units read   D5 CP3 (4fc829aec) — all 6 Railway services
                                  SUCCESS, GitHub gate/rails/coverage/promote
                                  all Success
                                D5 CP4 (3dfcd8412) — GitHub gate/rails/coverage/
                                  promote all Success
                                D5 CP5 (0f83795dd) — GitHub gate/rails/coverage/
                                  promote all Success
/api/health                    fresh boot after D5 CP5's deploy, status ok,
                                  uptime_seconds 244 at read time
```

## 11 · Three phone-readable sentences

**D5's confirmed-splits ledger, its dark cross-check, and its new
confirmed-delisting/new-listing source are all built, signed, and live —
three real units shipped clean through CI today.**

**A real bug in our own merge tooling was found and fixed along the way
(it was stalling every merge for 15 minutes whenever another session pushed
a docs-only change first) — that fix helps every future session, not just
this one.**

**The next planned piece (CP6, renames/mergers) turned out to need a piece
of infrastructure that was designed but never actually built — that's a real
decision for you, not a bug; the one after that (CP7, the first
member-visible change) is unblocked but deliberately saved for its own
session rather than rushed.**

## 12 · Status

STATUS: RAN
