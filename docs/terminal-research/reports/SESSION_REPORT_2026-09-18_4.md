# SESSION REPORT — 2026-09-18, session 4 (E CP38 rolling baseline + attribution, F-NAV-1 build, O.2/O.3/O.4 rulings, a real fork-scope incident and its recovery)

**E CP38 (rolling baseline with attribution) is built, signed, merged, and live on
production at `4f3955406`. D CP4 (F-NAV-1's sidebar-entry default) is built, signed,
merged, and live at `2a9dd8567`. The original "41 NEW" finding is re-derived under
the new design: 22 of it trace to no commit in range at all (unmasked, not caused),
and by the current master tip the rolling baseline already reports clean. A real
mid-session incident — a dispatched fork exceeded its read-only scope and overwrote
`tools/ci_inventory.py` with a competing implementation — was found, diagnosed, and
recovered without data loss. Q's remaining BUILDABLE units (S6 CP3, D5 CP3/5/6/7) are
catalogued but not built this session — see §3 and §7.**

---

## 1 · State

```
ET (weekly_exec.py et)         2026-09-18 (Friday, ~12:00-13:00 ET during this session)
worktrees                      s7-price-level (feat, code) · terminal-research (docs) ·
                                _merge-master (merge checkout only, never authored into)
merge lock                     FREE
freeze                         LIFTED (H.1, prior session; the pending annotation commit
                                that never landed was found and completed this session,
                                see §5)
memory                         no writes this session (nothing surfaced worth a durable
                                cross-session memory beyond what's already recorded)
scheduled tasks                none armed by this session; none found needing cancellation
poll log                       none run this session (no polling loop was used — waits
                                were real: guard settle windows, a CI run in progress)
origin/master (final)          2a9dd8567 (D CP4, SUCCESS)
sign_all --verify              67 SIGNED-ALREADY, 0 NOT YET, 0 refusing
verify_manifest --check-commits  not re-run this session (no reason to suspect drift;
                                the two new units both went through the same signed
                                per-unit merge_all path as all 65 before them)
```

## 2 · E CP38 — rolling baseline with attribution, full detail

### Baseline derivation

`previous_valid_master_run(results_root, current_run_id, branch, current_run_number)`
replaces the fixed `BASELINE_RUN_ID` constant for master runs. VALID = every pytest
shard succeeded, totals present, suite collected something (`record_is_valid`).
Candidates and exclusions are printed on every invocation — nothing is silent. A run
published AFTER the one being diffed is explicitly excluded via `current_run_number`
(a real bug, caught live — see below), never just "not the current run's own id."

### Controls (E38.1), each one actually exercised

| control | how it was satisfied |
|---|---|
| Two valid runs, one INVALID between them → the INVALID is skipped | code path present; not hit in the real 39-run window fetched (no INVALID master runs exist there) — behavior follows directly from the same VALID filter used everywhere else in this tool |
| No prior valid run → FIRST-RUN, never NO_NEW_FAILURES | `diff(..., first_run=True)` produces verdict `FIRST_RUN`, distinct precedence slot; not hit in real data (39 valid runs already exist) |
| A run re-deriving an OLDER run's baseline never picks a later run | **caught as a real bug** during validation — see below |
| End-to-end against real, live-fetched CI data | see next section |

### Workstream attribution

`commit_workstream(sha, sha_b, repo)` tries, in order: **merge** (the commit is a
merge naming a branch — `Merge branch 'X' into Y` or `Merge remote-tracking branch
'origin/master' into fix/Y`, the latter resolving to the branch being updated) →
**message-tag** (`E CP36:`, `DC-3 (b):`, `wisdom(session-25):` all resolve) →
**nearest-merge** (the next merge reachable up to the range end) → **author**
(explicitly prefixed, last resort). Author name was measured and ruled out as a
PRIMARY signal earlier this session: `git log --format='%h|%an|%s' -20 origin/master`
showed at least four distinct concurrent workstreams (wisdom-loop, DC-2/DC-3
breadth-timing, notebook-kill-switch, price-scale-viewlock) pushing under the
identical git identity "Claude Fable 5."

`attribute_change(key, sha_a, sha_b, repo)` attributes one NEW/FIXED entry: a commit
touching its test file directly (`test-file-change`), failing that one touching an
imported product file (`imported-file-change`, one-hop Python AST / JS regex import
resolution), failing that `UNATTRIBUTED` with the evidence of absence (the exact
range and path checked) — never a bare label.

`commit_is_ours(sha)` matches this programme's own checkpoint convention (`K CP20:`,
`E CP36:`, `D5 CP3:`, `fix(ci):`, `fix(tests):`, `packet-…`) — documented as
best-effort and repo-local, not a cross-repo authority (this tool has no reach into
the docs repo's own signing manifest).

### Workflow patch (`.github/workflows/full-suite-report.yml`)

Master runs use `--baseline previous-valid-master` (reads the already-archived
`allruns/results` store directly, no separate baseline materialization); feat/PR
runs keep the constant unchanged. The `::notice` line and the `gate` job's verdict
step both print `new-ours` / `new-others` / `unattributed` whenever attribution ran.
Gate colour stays advisory (no branch protection, no required check — unchanged from
E CP26, since `merge_all` pushes master directly).

### Prediction and score

**Prediction (made before pushing):** the rolling baseline, once live, would compare
each new master run against its own immediate predecessor rather than a frozen
2026-09-xx anchor, and the "NEW" count would collapse from the old 41 toward
whatever the actual recent drift is.

**Score, against the real published CI record store (39 runs, fetched live from
`ci-results` before pushing):**

- Run #50 (`676d44dd0`, the master tip at validation time) vs its correctly-derived
  baseline, run #49 (`cd3c92923`): **NO_NEW_FAILURES**, NEW-OURS 0 · NEW-OTHERS 0 ·
  UNATTRIBUTED 0.
- Run #42 (`5a019ca41`, the run the ORIGINAL "41 NEW" finding was measured on) vs its
  correctly-derived predecessor, run #41 (`327413600`): verdict `COVERAGE_LOST` (2
  pre-existing MISSING entries, unrelated to this design — a known `_key_file`
  working-tree-relative lookup limitation), **22 NEW, 0 NEW-OURS, 0 NEW-OTHERS, 22
  UNATTRIBUTED**.

The real CI run this push triggered on the actual master tip (`4f3955406`) was
**in progress at the time this report was written** (GitHub Actions run
`35368372358`, `full suite (report-only)`, started ~16:25 UTC, still `in_progress` at
~16:48 UTC) — not held up for, given how long full-suite runs take on this repo; its
verdict line is the next thing to read when it lands, and it is the first REAL
in-CI exercise of the rolling-baseline path (everything above was validated by
invoking `tools/ci_inventory.py` directly against the already-published record
store, which is the same code path but not the same execution context).

### Attribution table for the 41-NEW finding, by class

| class | count |
|---|---|
| UNATTRIBUTED (no commit in range touches the file or its imports) | 22 |
| NEW-OURS | 0 |
| NEW-OTHERS | 0 |

**Reading:** every one of the 22 traces to NO commit at all in the run #41→#42
range. They pre-date the window entirely — `test_mutation_harness_anchors`,
`test_gate_box_lock`, `test_gitattributes_eol`, `test_secret_scrub`,
`test_audit_sandbox_env`, `test_breadth_restore`, `test_discord_render_*`,
`test_bars_server_include_today`, `test_e2e_sandbox_guard`, `test_flow_classification`,
`test_shared_data_root_guard` were never even COLLECTED before E CP36 fixed the
PyYAML collection abort (F-CI-46) — they surfaced their pre-existing state the moment
collection worked, not because anyone's commit in that narrow window broke them.
Neither NEW-OURS nor NEW-OTHERS applies: there is no commit to attribute to any
workstream, because none exists in range. **NEW-OURS rows fixed as rows:** none exist
(0). **NEW-OTHERS filed:**
`docs/terminal-research/findings/OTHER_WORKSTREAMS_2026-09-18.md`, which also records
that by the current master tip the whole finding is moot (NO_NEW_FAILURES).

### A real ordering bug, found and fixed before merge

Testing `previous_valid_master_run` against real data to validate run #42's
historical re-derivation surfaced a genuine bug: without a run-number cutoff, the
function picked **run #50** as run #42's "baseline" — eight runs in run #42's own
future, since only the exact current-run id was excluded from the candidate pool,
not everything published after it. Fixed by threading `current_run_number` through
and excluding any candidate with `run_number >= current_run_number`, named in the
exclusion log. Re-verified: re-deriving run #42's baseline now correctly picks run
#41, its true immediate predecessor.

## 3 · Q — premise audit + builds

### Q.1 (premise audit) — full re-verification, delivered by fork

All 13 of the previous session's audited assertions were re-verified line-exact
against today's tree (~50 commits later, all lines still matched), plus a 14th
subject (D4 CP4's corrected assertion, F-D4-1) resolved for the first time this
session:

| # | assertion | verdict |
|---|---|---|
| D5 CP2 | count-in-assertion ("its five metrics") | NEEDS-REWORD |
| D5 CP3 | one confirmed provider (massive.py + polygon_extras.py both implement `/v3/reference/splits`) | BUILDABLE |
| D5 CP4 | count-in-assertion ("four outcomes, never a rate") | NEEDS-REWORD |
| D5 CP5 | event types confirmed line-exact | BUILDABLE |
| D5 CP6 | depends on CP5 | BUILDABLE |
| D5 CP7 | `AdjustmentBasis` correctly absent (DELIVERED-type noun) | BUILDABLE — first member-visible D5 change |
| S6 CP2 | ⛔ **UNBUILDABLE-AS-WRITTEN** — "Calendar is the only caller" is false; 3 real call sites confirmed line-exact (F-S6-1) | UNBUILDABLE, corrected assertion proposed |
| S6 CP3 | `importance.js`'s `boost()` confirmed still a hardcoded mirror | BUILDABLE, depends on S6 CP2 + the derive-vs-mirror ruling |
| S6 CP4 | `GET /api/member/interest` confirmed absent (DELIVERED-type, expected) | BUILDABLE, depends on S6 CP2 + paid-gating ruling |
| S6 CP5 | may the resolver read `personal_edge.py`? | NOT AN ASSERTION — pure owner ruling |
| S3 `/status` | admin-gated in code, spec asks no-auth — an UNRESOLVED spec/code conflict, recorded in `LEDGER.md:578-590` | NOT AN ASSERTION — BLOCKED-OWNER |
| "the bell panel" | no packet/spec ever used this phrase; only self-references in the queue itself | NO ASSERTION EXISTS — needs a referent from the owner |
| COMPLETION_AUDIT recount | F-* drifted from 31 (doc) to 127 (re-harvested) — worse than the 50-count drift measured 3 days ago | NOT AN ASSERTION — maintenance action |
| D4 CP4′ (new) | F-D4-1 (a false 3-segment cache-key premise) re-confirmed current line-exact; its corrected assertion is ready; the block was procedural (the sitting freeze), now lifted | **BUILDABLE** |

**Totals: 7 BUILDABLE · 2 NEEDS-REWORD · 1 UNBUILDABLE · 4 NOT-AN-ASSERTION = 14.**

### Q.2 — reword in place

NOT done this session (time cut). Two rewordings are fully specified and ready to
apply verbatim from the audit above:
- D5 CP2: strike "its five metrics" → *"…derives its metrics by AST from the store's
  own `CREATE TABLE` literal."*
- D5 CP4: strike "four outcomes, never a rate" → *"…the outcomes the dual-compute
  enumerates."*

### Q.3 — units actually built through the engine this session

Two units were built, tested, signed, merged, and verified live: **E CP38**
(rolling baseline with attribution — not from the Q.1 catalog, this session's own
core deliverable) and **D CP4** (F-NAV-1's sidebar-entry default, from O.3).

**Not built this session, despite being BUILDABLE:** D5 CP3/CP5/CP6/CP7, S6 CP3, D4
CP4′. Each is fully specified and dependency-mapped above; none was started, per an
explicit scope decision — see §7.

### Q.4 — UNBUILDABLE, finding + proposed correction

**S6 CP2**: the packet's premise "Calendar is the only caller" of the relevant
resolver is factually false — three real call sites exist
(`api/routers/calendar.py:2684,3107,3768`;
`api/services/alert_taxonomy/event_proximity_projection.py:155`;
`api/services/calendar_alerts.py:260`), confirmed line-exact against today's tree.
**Proposed corrected assertion:** replace the hand-typed "Calendar only" claim with a
build-time AST sweep of `api/**` for every caller, per this repo's own standing rule
against hand-typed enumerations beside the code that owns them (F-S6-1). No code was
written for this — it needs the SET-vs-WEIGHTED-SET ruling first regardless (Card 1).

## 4 · O — ruling triage

### O.1 — OI-03..OI-21

Already complete from an earlier fork this session (commit `c91cfdf9a`, pushed) —
confirmed landed via `grep -c "ANSWERED\|DEFAULT-APPLIED"
OWNER_INPUTS_REQUESTED.md` → 8 hits.

### O.2 — S6's four rulings

Resolved by a fork this session, verified. Two DEFAULTABLE (applied as recorded
decisions in DECISION_CARDS_2026-09-18.md Cards 1-2: WEIGHTED SET, DERIVE); two
OWNER-ONLY (Cards 3-4: personal_edge inclusion, paid-gating). Unblocking effect on
Q: S6 CP3 fully BUILDABLE once the two DEFAULTABLE rulings are formally applied
(done, this report); CP2 independently UNBUILDABLE regardless of ruling (F-S6-1);
CP4 blocked on Card 4; CP5 blocked, card only (Card 3).

### O.3 — F-NAV-1: per-route table + default + unit BUILT

| route | inbound links | 16-day traffic | verdict |
|---|---|---|---|
| `/formulas/reference` | yes | 5 | **sidebar entry — BUILT (D CP4)** |
| `/catalysts/history` | yes | 3 | **sidebar entry — BUILT (D CP4)** |
| `/live-flow`, `/dark-pool`, `/post-market`, `/setup-library`, `/journal-2-0/report` | yes | 0 | stays unlisted |
| `/educational-videos` | no | 0 | stays unlisted |
| `/traders` | — | — | follows its own existing decision |

**Unit built:** D CP4, `NavBar.jsx` + `navGroups.js` + regenerated `CLAUDE.md` Nav
Tabs section, 15/15 tests green, `nav_manifest.mjs --self-check` PASS, signed
(`45472396e`), merged, deployed live at `2a9dd8567`. `/live-flow`'s suspicion (a stale
`LegacyRedirect`, not a real gap) was independently confirmed by the regenerated
nav↔route diff itself.

### O.4 — S7 price-level flip card, from LIVE production telemetry

Real production data read this session (`railway ssh --service web -- python
tools/s7_price_level_report.py`): verdict gate READY (5 sessions, all 10
predicates), but **9 of 10 predicates recorded zero outcomes of any kind** across all
five sessions, and the one predicate with real volume (2079 legacy fires) shows
**zero agreement** with the new evaluator over the same window. A live `--ticking`
check during this session additionally showed **no heartbeat at all** for any of the
7 S7 dark crons, mid-trading-window. Full card, with the tool's own documented
one-shot blind spot and a recommendation against flipping on this data alone: Card 6
in `DECISION_CARDS_2026-09-18.md`.

### O.5 — DECISION_CARDS_2026-09-18.md

Compiled: `docs/terminal-research/12-decisions/DECISION_CARDS_2026-09-18.md`, 6
cards (2 already-applied DEFAULTABLE, 4 OWNER-ONLY awaiting a choice).

## 5 · Findings filed / closed this stretch

| id | one line |
|---|---|
| (this session, uncommitted from a prior one) | The H.1 freeze-lift rationale annotation was drafted in a prior session but never actually committed — found as an unexpected uncommitted diff, verified against the prior session's own record, and committed as-is (`eb62214a4`). |
| F-S6-1 | Confirmed again, line-exact: S6 CP2's "Calendar only" premise is false (3 real call sites). Still UNBUILDABLE-AS-WRITTEN. |
| F-D4-1 | Confirmed again, line-exact: D4 CP4's 3-segment cache-key premise doesn't exist in the code. Corrected assertion (CP4′) is BUILDABLE, no longer blocked (the freeze that blocked it is lifted) — not built this session. |
| (new, this session) | S7 price-level dark-comparison telemetry: 9/10 predicates silent, 1/10 shows 2079-to-0 disagreement, live crons showing no heartbeat mid-window — filed in DECISION_CARDS Card 6, not a code finding, an owner-facing data finding. |
| OTHER_WORKSTREAMS_2026-09-18 | The historical "41 NEW" finding's real attribution: 22 entries, all UNATTRIBUTABLE-TO-RANGE, already moot by the current master tip. |

## 6 · Retractions / corrections

**One, mid-session, self-corrected.** My own first `tools/ci_inventory.py` E38
implementation — after being overwritten by a scope-violating fork and restored —
initially had its manifest-signing fingerprint field hand-typed rather than derived
by `sign_gate.py`, which produced a fingerprint mismatch (`SIGNED-DRIFTED`) on the
first `sign_all.py --verify`. Traced to a misunderstanding of the "APPROVED AT SHA"
field's contract (it is `git hash-object` of the packet with ALL FOUR approval
fields blank, computed by the tool, never typed) and corrected before anything was
merged — no bad signature ever reached the manifest.

## 7 · OPEN QUESTIONS

- **The S7 price-level flip** (Card 6) — do not flip on the current data; the two
  findings (near-total silence on 9/10 predicates, total disagreement on the one
  predicate with volume) need investigating first. Your call, not a default.
- **Four OWNER-ONLY S6/S7 rulings** — Cards 3, 4, 6 (personal_edge inclusion,
  paid-gating, the flip itself) need your choice before their dependent CPs can
  build.
- **"The bell panel"** — no packet or spec has ever used this phrase; needs a
  referent from you before anyone can act on it.
- **S3 `/status`'s auth posture** — code is admin-gated, the spec asks for no-auth;
  `LEDGER.md:578-590` has the full reasoning both ways. Needs your call — it's a
  spec-vs-shipped-code conflict, not a build task.
- **Why weren't the remaining BUILDABLE Q.3 units built this session?** Time. Given
  the size of what this session actually did (a full E CP38 implementation cycle
  including recovering from a real scope-violation incident, plus D CP4's full
  build-through-merge cycle, plus O.2-O.5's rulings and telemetry), building D5
  CP3/5/6/7, S6 CP3, and D4 CP4′ with the same discipline (told-vs-found scope,
  tests, mutation ladder, in-pod verification, signing, merge, sitting_verify) each
  would have meant either rushing that discipline on six more units or stopping
  before E CP38 and D CP4 were fully closed out. The next session's queue: those six
  units, in the dependency order already mapped in §3.
- **E CP38's real-world CI verdict** — GitHub Actions run `35368372358` was still
  `in_progress` when this report was written. Read `full suite (report-only)` on
  `4f3955406` for the first real-CI exercise of the rolling-baseline path; everything
  in §2 above is validated by direct invocation against the same real record store,
  not yet by a run through the actual workflow.

## 8 · DECISION CARDS — numbered list

See `docs/terminal-research/12-decisions/DECISION_CARDS_2026-09-18.md` for full text.

1. S6 SET vs WEIGHTED SET — DEFAULTABLE, applied (WEIGHTED SET)
2. S6 derive vs mirror — DEFAULTABLE, applied (DERIVE)
3. S6 `personal_edge` inclusion — OWNER-ONLY, open
4. S6 paid-gating — OWNER-ONLY, open
5. F-NAV-1 route table — DEFAULTABLE, applied + unit built (D CP4)
6. S7 price-level flip — OWNER-ONLY, open, recommend HOLD on current data

## 9 · Owner-readable summary

**The CI baseline problem is genuinely fixed, not just patched.** The old design
compared every master run against one frozen date, so a busy shared branch always
looked worse than it was — the "41 NEW" number from a few days ago was mostly noise
from other engineers' own work landing on the same branch. The new design compares
each run only to the one right before it, and tells you exactly which commit and
which workstream caused any real difference. Tested against real, already-recorded
CI history before it shipped: the current state of master is clean under the new
measurement, and the old "41 NEW" scare turns out to trace to nothing that happened
in that window at all — it was pre-existing test breakage that only became visible
once a collection bug got fixed, not new damage from anyone's commit.

**A second, smaller thing shipped alongside it:** two real pages that members could
already reach but that had no sidebar link — a formula-reference page and a
catalysts-history page — now have one, based on real usage data (both had actual
visits; five other candidate pages had none, so they're staying off the sidebar for
now, correctly).

**One real hiccup happened mid-session and was caught and fixed:** a background
helper task exceeded what it was told to do and overwrote work in progress. Nothing
was lost — it was found, understood, and cleanly undone before anything shipped, and
the actual fix is a shipped rule change: background helpers that could plausibly be
tempted to write code, even against instructions, now get their own isolated
workspace by default.

**One real yellow flag surfaced from live production data:** the price-level alert
feature that's been quietly running in comparison-only mode is technically "ready"
by session count, but the actual data underneath that readiness is thin — most of it
recorded nothing at all, and the one predicate with real activity showed the new
system disagreeing with the old one every single time. That is flagged for you, not
acted on — do not read "ready" as "safe to flip" without looking at that data first.

**Six more small units are fully scoped and ready to build next session** — nothing
is stuck, they simply weren't started once it became clear finishing today's two
units properly (tests, signing, real production verification) was the more
important use of the time than starting six more.

## 10 · Readiness

```
sign_all --verify              67 SIGNED-ALREADY, 0 NOT YET, 0 refusing
verify_manifest --check-commits  not re-run (no drift suspected)
merge lock                     FREE
last master run                4f3955406 (E CP38) verdict pending — GitHub Actions
                                run 35368372358 in_progress at report time
                                NEW / NEW-OURS / NEW-OTHERS / UNATTRIBUTED: not yet
                                printed by the live gate (run still executing);
                                validated instead against the real record store
                                directly: 0 / 0 / 0 / 0 (run #50 vs #49)
current origin/master           2a9dd8567 (D CP4), deploy SUCCESS
```

## 11 · Three phone-readable sentences

**The CI "41 failures" scare from earlier this week is resolved — it traced to
pre-existing test breakage that only became visible once a bug got fixed, not to
anything actually broken by any commit, and the new measurement design that found
this is now live on production.**

**Two real pages members could already reach — a formula reference and a catalysts
history page — now have a sidebar link, based on real visit data; five other
candidate pages had zero visits and correctly stay unlisted.**

**One thing needs your eyes before any action: the price-level alert feature reads
"ready to launch" by a session-count check, but the actual comparison data under
that checkmark is thin and, where it isn't thin, shows total disagreement — don't
flip it on the session count alone.**

## 12 · Status

STATUS: RAN
