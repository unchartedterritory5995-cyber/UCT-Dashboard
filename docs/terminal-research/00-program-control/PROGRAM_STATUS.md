# PROGRAM STATUS

**Program day:** 1 CLOSED, Phase 2 CLOSED, Phase 3 CLOSED (technical validation + PRD/spec for the four LOCKED systems).
**Stage: BUILD PROGRAM** — declared by owner ruling 3 on 2026-09-11, and true in fact since 2026-09-02. ⛔ **50 commits / 207 files / 22,049 insertions are already on `origin/master`** covering S1, S2, S3, S7 Alerts, S8, S11, D1, A3–A8 and I1 — none of it recorded in any program document. See **THE IMPLEMENTATION LEDGER** below. Program **idle since 2026-09-04**, and **BLOCKED pending the owner's read of that ledger**.
**Last updated:** 2026-09-11 (control-file reconciliation + S3 spec re-verification; no new build work).
**Last verified against git:** docs branch `terminal-research` @ `a84b1932e`; production tree `origin/master` @ `b63cf9775` (2026-09-11 16:58).
**Deadline health:** GREEN — Day 1, the Readiness Review, Phase 2 (architecture), and Phase 3 (technical validation + 4 PRD/spec pairs) all completed, adversarially validated, corrected, and committed/pushed this session.

## Checkpoint (Document A format)

### Progress
Phase 2 closed per the prior checkpoint (Product/Information/Data architecture + F-09, adversarially
validated, six findings corrected). The owner re-anchored the program to its north-star objective (a
differentiated UCT Terminal built on UCT's existing product/data/AI estate, not a Bloomberg clone)
with an explicit anti-drift rule, then authorized Phase 3: narrow technical validation followed by
PRD + technical specification for the four architecturally LOCKED systems (Entity Master, Provider
Abstraction Layer, Provenance & Freshness, Alerts & Monitoring). Two technical-discovery tasks ran
first, both real codebase investigation, not guesswork: **D13** (which of UCT's two regime
classifiers is authoritative) resolved cleanly — `voice_regime_classifier` is the one live authority,
the engine's `market_regimes` table has a single dashboard reader with zero frontend callers — and
surfaced a genuine, currently-shipping, previously-unknown bug reported outside program scope (RG-32:
Compass can show two different "regime" words in one conversation). Three narrow RESEARCH_GAPS items
(RG-16, RG-24, RG-25) closed by direct grep/read investigation of the actual codebase. Then four
PRD+technical-spec pairs were produced, pipelined per system, each PRD required to open with an
explicit north-star traceability chain and each spec required to ground every reuse claim in the real
UCT codebase. An adversarial validator checked all eight documents against seven specific failure
modes and found two genuine issues (1 medium, 1 low); both corrected directly — a boundary-matrix
exception was named and time-boxed rather than left implicit, and an interim job was retroactively
authorized by its own PRD with a sunset condition. **No scope drift from the north star was found.**
Protection rail re-verified a third time this session: PASS, zero application-code touches despite
extensive codebase reading during technical discovery.

### Important discoveries
* D13 resolved: `voice_regime_classifier.get_current_regime()` is the single regime authority,
  wired into `grade_ticker`, the Awareness Engine's regime-flip rule, and `brain_service`. The
  engine's `market_regimes` table (`/api/risk-summary`) is dead code — zero frontend callers.
* **RG-32 (new, reported outside program scope):** a real, currently-shipping inconsistency —
  Journal 2.0's `journal_two/regime.py` buckets the Exposure Rating score under the label "regime"
  and Compass text chat shows it ambiently, while the same chat's `get_regime` tool returns a
  different, real 5-way market classification. A member can see two different regime words in one
  conversation today. Not a Terminal-Next task; flagged for a normal operations session.
* RG-24: the ticker-mentions backend is live and mounted; the frontend hook was written but has
  zero non-test importers anywhere — the intended UI was never wired.
* RG-25: UCT's SSE streams are confirmed gapless-reconnect-blind (no `id:` field anywhere in the
  `api/` tree) — live-verified. Edge caching is deliberately scoped: on for flow JSON/CSV (with
  documented incident history), off for SSE and mutating endpoints.
* Four architectural decisions are now LOCKED (from Phase 2) plus D13 (Phase 3) = 5 total; two new
  self-expiring exceptions (D14, D15) were named during spec validation rather than left implicit.

### Decisions forming
No new owner-facing product decisions this checkpoint — Phase 3 specified systems that were already
architecturally LOCKED, so no new escalations were needed. D14 and D15 (both self-expiring technical
exceptions tied to not-yet-built systems D2 and D5) are engineering-tracked, not owner-bound.

### Critical unknowns
None newly opened by Phase 3. CP-03 (licensing) remains 🔴 and owner-input-bound, unchanged.

### Blockers
None for further specification work on the four LOCKED systems — all eight documents (4 PRDs, 4
specs) are complete and validated. Implementation itself remains explicitly gated pending the
owner's decision on the Phase 3 exit report.

⛔ **Superseded within hours of being written** — the checkpoint above describes the state at
2026-09-02 17:14. S8 and S11 were authorized and implemented that same evening and the following
morning. See "Post-Phase-3 work" below; everything from here to the end of this checkpoint is
historical.

### Findings for a normal operations session (outside program scope)
* RG-32 (new, see above): Compass's ambient regime context and its `get_regime` tool disagree.
* Four PC-scheduled jobs failing silently: flow-corpus archive empty since 2026-08-09; breadth-live monitor 'could not check' 52 runs since 2026-08-10 (D-14).
* Catalyst cost guard mis-prices Sonnet 5 (D-12); five clause-vs-code licensing collisions (E-04); local-backend recipes run against live `C:\data` (D-04); three real-time endpoints CONFIRMED unauthenticated (`/api/live-prices`, `/api/snapshot/{sym}`, `/api/movers`; R-17).
* The owner's Anthropic subscription seat has TWO confirmed independent consumers producing public artifacts (`desk_insights_polish.py`, `daily_recap.py`) — ESC-17 widened by F-09.
* RG-24: the ticker-mentions frontend was never wired despite a live backend and a written hook.

### Agent allocation
Phase 3 complete; zero agents currently in flight. No further dispatch pending the owner's decision
on the Phase 3 exit gate (implementation vs. further specification vs. targeted revision).

### Protection rail
PASS (re-verified a third time this session, before and after Phase 3 work) — application diff
empty; production `/api/health` 200 and `/calendar` 200. See `protection-rail.md`.

### Deadline health
GREEN.

## Post-Phase-3 work (2026-09-02 17:31 → 2026-09-03 07:19) — added by the 2026-09-11 reconciliation

Eight docs commits landed on `terminal-research` after the Phase 3 close above, and **no control file
recorded any of them** until this reconciliation. The application code that landed in the same
window is far larger and has its own section — see **THE IMPLEMENTATION LEDGER** below.

**Docs, on `terminal-research`:**
* `c46048ae6` — **Entity Master pre-implementation gate packet**, `12-decisions/gates/entity-master-pre-implementation-gate.md`, 564 lines. Status: final, presented, **awaiting explicit owner approval**.
* `a9837d71d` then `633691038` — **RG-33** filed and then corrected: the stale file is `cap_universe.json`, **not** `delisted_tickers_bulk.json`. The correction is the operative version.
* `8935b5092`, `99e7de3b5`, `f23530a8d`, `92296aa62`, `a31cacea1` — the **S8 readiness review and implementation records**, plus the **S11 implementation record** and one factual correction: NYSE's 2026 calendar has **3 July as a full closure, not an early close** (Independence Day observed); only 27 November and 24 December are real early closes. The shipped dataset uses the corrected calendar; the prose error was recorded rather than silently fixed.

## THE IMPLEMENTATION LEDGER — what this program has shipped to production

⛔⛔ **FIFTY COMMITS. 207 FILES. 22,049 INSERTIONS.** Branch `feat/entity-master`, 2026-09-02 17:51
→ 2026-09-04 13:46, merged to `origin/master` as **`ed6b1f041`** on 2026-09-05 00:50 with the
message *"Merge feat/entity-master (50 commits: Entity Master/S3, D1, S8, S11, A3-A7 research
modernization, Analyst Ratings, News Slice 1, Ask AI Slice 1, Security Research Q&A Slice 2, S7
first slice, Command Palette) onto current origin/master for release reconciliation."*

**Not one of those fifty commits is recorded in any program-control document.** The program's own
docs end at `a31cacea1` (2026-09-03 07:04) and describe a specification program awaiting an
implementation gate. Reproduce the list with:

```bash
git log --format='%h %ci %s' ed6b1f041^1..ed6b1f041^2
git diff --stat ed6b1f041^1...ed6b1f041^2 | tail -1
```

## ⛔ THE LEDGER IS [`LEDGER.md`](LEDGER.md) — THAT FILE IS THE AUTHORITY

Full row-per-commit enumeration lives there: **Section 1** the program's own 50 commits with a system
assignment each (**zero unassigned**), **Section 2** what was already ledgered elsewhere, **Section 3**
the **19 commits from other workstreams building on paths this program created**. The rail's check
(1b) PASS condition is *every commit returned by the ledger query has a ledger row*.

⛔ **PASS is scoped to paths the program CREATED, not paths it touched.** A first attempt used the
full 209-file touch footprint and returned 126 "leftovers" that were almost entirely other
workstreams' legitimate work — the program edits shared files (`api/main.py` and the like) that
everyone edits. **A shared file cannot attribute authorship.** The 102 created files have a single
origin, so a later commit touching one is either this program continuing or someone building on it,
and both belong in the ledger.

The summary below is kept as narrative; the ledger is the manifest.

### What the fifty commits built

| system | scope | representative commits |
|---|---|---|
| **S3 Entity Master** | `api/services/entity_master/` created from nothing — canonical schema, read primitives, write path, seed script (**a real seed run was executed**), provider mapping, compatibility integration, reconciliation, adversarial validation at real scale, plus a findings investigation and a root-cause correction. Checkpoints **1–8, all present** | `3c762d25e` … `53b99ad5a`, `ca3176954` |
| **D1 Provider Abstraction** | ⚠️ **far more than "hardening" — the ACL boundary was BUILT.** Shared error taxonomy + licensing-class table, **`fmp_client.py` adapter**, then migration of `insider.py`, `fundamentals.py`, `analyst_actions.py`, `earnings_estimates.py` (6 call sites), `transcript_indexer.py`, `financial_history.py`, `analyst_grades.py`, `engine.py` onto it; a Massive adapter extending `_MassiveRestClient` in place; **AST guard census tools** (`tools/massive_guard_census.py`); `served_total` counter + FMP/Massive admin status endpoints; a real-provider validation checkpoint with two defects found and fixed | `768587e00` … `9d0b5eb26` (~20 commits) |
| **S8 Provenance & Freshness** | the `provenance/` component family, two routers, `bar_provenance.py`, `ProvenanceDemo.jsx` | `7adf80bd4` … `48bba9614` |
| **S11 Session & Market Clock** | `app/src/lib/marketClock/`, `useMarketOpen.js` re-sourced, holiday-aware `nextOpenHint()` | `e14a5836b` `1cf0bf028` |
| **S7 Alerts** | **first slice — `api/services/alert_taxonomy/` package + the `document-arrival` trigger type** | `e994f5337` |
| **S1 + S2** | ⛔ **a global Ctrl/Cmd+K command palette for security search and navigation, plus a visible search trigger and in-box `?` help** — the two systems the Phase 2 gate ruled must NOT be specified ahead of OI-06 | `0eec8343d` `0577245df` |
| **A3–A8 applications** | `/research/:sym` Estimates + Financials onto S3+D1+S8+S11; A6/A7 research tabs (Ratings, Ownership, Filings, Calls & Transcript); **A5 Events & Calendar onto S3/D1/S8** + an empty-week-vs-provider-failure follow-up; a dedicated Analyst Ratings tab; **A8 News Slice 1** | `408f04935` `66b56ccf1` `1214dc246` `529c54987` `a1b10c498` `4605aa8dd` |
| **I1 Intelligence Layer** | **AI-Native Research Assistant Slice 1 (contextual "Explain" tab)** and **Security Research Q&A Slice 2 (6-composer contextual assistant)** | `341bb78de` `a21518d0e` |

⛔⛔ **TERMINAL-CURRENT WAS MODIFIED**: 7 files, +266/−52 — `api/routers/calendar.py` (215 lines
changed), `app/src/pages/Calendar.jsx`, `calendar/CalendarHeader.jsx`, `earningsModalRow.js` and
three test files. That is the surface this program's protection rail is named after, and the rail
returned PASS throughout.

⛔⛔ **THIS NEEDS THE OWNER'S READ BEFORE ANY FURTHER BUILD.** Much of it may have been authorized in
conversation the way S8's and S11's slices were — but four things are true regardless: the work is
recorded nowhere; it covers systems the Phase 2 gate explicitly parked (S1, S2) and systems no gate
packet was ever written for (S7 Alerts, I1, A8); it modified Terminal-Current; and the instrument
that existed to catch exactly this was structurally incapable of seeing it.

⚠️ **Correction to this document's own first draft (2026-09-11):** an earlier revision of this
section reported seventeen commits and said "no Checkpoint 6 exists." Both were wrong, and for the
same reason — the query filtered by `api/services/entity_master/` and by a subject pattern that
omitted `S7`. **Checkpoint 6 (`5ecdae012`, "compatibility integration") exists**; it simply touched
other paths. ⭐ A path-filtered log answers "what touched this path," never "what did this program
do," and the second question is the one that was being asked.


## S3 SPEC RE-VERIFICATION, 2026-09-11 — result: STOP

Run per the owner's Part B before any S3 build work, against `origin/master` @ `b63cf9775`.

**B1 — every repo path the S3 documents name.** 64 distinct paths extracted from
`entity-master-spec.md`, `entity-master-prd.md` and the gate packet; 36 fully qualified and checked
directly against the master tree.

| result | count | detail |
|---|---|---|
| **VERIFIED** | 34 / 36 | every reuse claim naming a real file still resolves at the named path — `cap_universe.py`, `delisted_registry.py`, `ticker_search.py`, `ticker_search_index.py`, `polygon_extras.py`, `massive.py`, `ticker_meta.py`, `bars_sqlite.py`, `auth_db.py`, `voice_tool_impls.py`, both `delisted_tickers*.json`, `cap_universe.json`, `main.py`, `ticker_types.py`, `cot.py`, `modelbook.py`, and the whole long tail of ticker-string call sites |
| **GONE — planned, never built** | 1 | `api/routers/entity_master_admin.py` — the spec's admin status/ops routes (§, "new, `require_admin`, mirrors `cot.py`'s `/status`/`/reseed` shape"). **S3 shipped without its ops lever.** |
| **not a claim** | 1 | `EntityAdminPanel.jsx` — the spec names it only to say **no such panel is proposed**. Absent, and correctly so. My extractor read a negative claim as a positive one. |

**MOVED: none. CHANGED: none detected at path level.** The codebase did not move under this spec in
the way the re-verification was designed to catch.

**B2 — the shipped `api/services/entity_master/` against what the spec describes.** The premise of
the question was wrong and that is the finding: the spec does not describe code the program
*adopted*, it describes code the program *wrote*, hours before the sentence was written. Shipped:
`schema.py`, `store.py`, `api.py`, `reconciliation.py`, `__init__.py` + three test modules
(`test_entity_master.py` 810 lines, `test_reconciliation.py` 231, `test_adversarial_checkpoint8.py`
133). `scripts/entity_master_seed.py` exists. Every module the spec names is present; the only
absence is the admin router above.

**B3 — are the gate's conditions still satisfiable?** The gate packet verified in its §12 that no
owner decision blocked implementation, and its §15 verdict is **IMPLEMENT WITH CONDITIONS**, with
OpenFIGI, store migrations and D5's real corporate-action feed explicitly out of scope. Those
exclusions still hold on master. **But the gate is a PRE-implementation gate for an implementation
that completed on 2026-09-02, twenty minutes after the gate document was written** (`c46048ae6`
17:31 → Checkpoint 1 `3c762d25e` 17:51 → Checkpoint 8 `53b99ad5a` 18:54).

### ⛔⛔ B4 VERDICT: STOP — not on a failed reuse claim, on a void premise

The re-verification came back clean. **The thing it was gating did not.** Approving a
pre-implementation gate, and then implementing against it, describes work that shipped nine days
ago and has been serving members since `ed6b1f041` merged on 2026-09-05.

Four questions now sit with the owner, and no build work proceeds until they are answered:

1. **Was the 50-commit merge authorized?** Much of it plausibly was, in conversation, the way S8 and
   S11 were. But it is recorded nowhere, and it reaches systems the Phase 2 gate explicitly parked.
2. **S1 and S2 shipped a command palette** (`0eec8343d`, `0577245df`) while the Phase 2 gate's own
   condition reads *"do not finalize any PRD/spec for a PROVISIONAL/OWNER-BOUND system ahead of its
   gating input"* — OI-06, still unanswered.
3. **S7 Alerts, I1 and A8 shipped slices with no PRD/spec and no gate packet at all** — `alert_taxonomy`,
   two AI research-assistant slices, and company news on `/research/:sym`.
4. **Terminal-Current was modified.** 7 files, +266/−52, including 215 changed lines in
   `api/routers/calendar.py`.

⭐ **What the re-verification actually proved, and it is worth keeping:** the spec's reuse claims are
sound and the codebase did not drift under them. **The risk was never drift. It was that the
document set and the production tree had been describing two different programs for nine days**, and
only a rail pointed at the production tree could tell.

## Q4 — Terminal-Current classification: **S11-related 0 · other 7 files, all flagged**

The owner's ruling: *intended only if it was S11/calendar work.* **None of it is S11.** Both commits
are **A5 Events & Calendar modernization onto S3/D1/S8** — `1214dc246` and its follow-up
`529c54987`. 7 files, **+266 / −52**. Every line classified; nothing is S11-related, so every row
below is flagged for the owner with its production-behaviour change.

| file | Δ | class | what changed in production behaviour |
|---|---|---|---|
| `api/routers/calendar.py` | +215/−… | **other — S3 + D1/S8** | Adds `_attach_entities()`, stamping a **canonical S3 entity onto every earnings entry of a week** (a resolution miss stamps an honest `{"status":"not_found","entityId":null}` rather than omitting the field). Routes the FMP earnings/econ legs through **D1's adapter** (`_fmp_calendar_day`, `_fmp_range_week`) and returns a **provenance envelope** (`vendor`, `sourceActivity`, `fetchedAt`, `sourceObservedAt`, `tieBreak`) as `earnings_provenance` / `econ_provenance`. Adds a new response source **`range_error`** when *both* earnings providers fail for a paged week. |
| `app/src/pages/calendar/CalendarHeader.jsx` | +23 | **other — S8** | **New member-visible sentence** in the calendar header when a provider leg degraded: *"Some earnings/economic data may be incomplete this week (a provider was unavailable)."* Renders only on `degraded`; a healthy week shows nothing new. Desktop only (`!isPhone`). |
| `app/src/pages/Calendar.jsx` | +17/−… | **other — A5 error handling** | The new `range_error` source now shows the **existing** error banner instead of rendering a silently empty week, and is excluded from the retry-suppression path. ⭐ `range_error+finviz` is **deliberately excluded** — Finviz salvaged real rows, so that case falls through to normal rendering rather than hiding real data behind an error. |
| `app/src/pages/calendar/earningsModalRow.js` | +9 | **other — S3** | Passes `entity` through the shell-level projection. Without it the modal's entity-unresolved note **could never fire** even though the backend returns the field — caught live during A5 validation, because the embedded research panels resolve independently server-side and stayed correct while only this projection dropped it. |
| `CalendarHeader.test.jsx` · `earningsModalRow.test.js` · `refusalLastHops.test.jsx` | +34/+16/+4 | **other — coverage** | Tests for the three behaviours above. |

⛔ **Nothing here is reverted** (owner ruling). The four behaviour changes are recorded so the owner
can confirm each was intended. The member-visible one is the `CalendarHeader` degraded note — it is
the only row a member could notice on a healthy day's regression.

⛔ **Why the protection rail never noticed — and what changed.** The rail diffed *this worktree's*
application paths against the start SHA. This worktree receives only docs commits, so the diff was
empty **by construction** and PASS was guaranteed regardless of what the program shipped. **A green
protection rail proved this worktree shipped nothing; it never could prove the program shipped
nothing.** Per owner ruling 3 the rail now diffs `origin/master` over a program-owned path manifest,
and PASS is no longer "empty output" but "every commit returned is in the ledger above" — a build
program's rail cannot demand emptiness without failing on its own successful work. Full before/after
and the re-scoped commands: `protection-rail.md`.

**Deferred, recorded, not gaps:** S10 (Presentation Primitives) and the vendor-side entitlement
taxonomy (SPEC-S8 §17a) are both formally DEFERRED and neither blocks. S11 has **no PRD/spec
document** by deliberate judgement — its `product-architecture.md` system block was held sufficient
for a system that size.

## Codebase drift since these documents were written

The PRDs and specs describe a codebase as it stood on 2026-09-02. The (separate, now closed) UCT
Terminal convergence program has shipped to master continuously since. **Exactly one confirmed
overlap**, found by diffing master's history against every path this program owns:

* **Seam 7, `4c4e19ede` (2026-09-07)** edited S11's own `nyseCalendar.js` — added 2027 holiday data
  (the table had ~4 months of runway and degraded to "every weekday is a full trading day" once
  `COVERED_YEARS=[2026]` lapsed), and added `tests/test_nyse_calendar_parity.py` so a hand-edit to
  either calendar table fails CI instead of drifting. It explicitly preserved S11's bundled
  zero-latency design as deliberate architecture. **This is a strict improvement to S11 and requires
  no revision here** — but S11's own record must not be read as describing the current file.

No other master commit since 2026-09-03 has touched `app/src/components/provenance/`,
`app/src/lib/marketClock/`, the provenance routers, or `api/services/entity_master/`.

⭐ **This is a two-way seam and the traffic has run one way.** Convergence follow-ups **#1**
(`nyseCalendar.js COVERED_YEARS`) and **#4** (`_et_now()` naive DST) were **maintenance on
Terminal-Next's own shipped output**, carried out by a program that did not know this one existed,
while this program's control files recorded nothing in either direction. Seam 7 also surfaced a
**third, previously unrecorded NYSE holiday table** in `api/services/voice_temporal_awareness.py`
(Compass voice narration) and fixed its missing early-close awareness and naive-DST `_et_now()`.

⛔ **STANDING RULE FROM HERE: any work on a program-owned path gets logged in the implementation
ledger above, whichever program performs it.** The ledger is the manifest the re-scoped rail's check
(1b) validates against, so an unlogged change — ours or another program's — now reads as an
unrecorded shipment and fails the rail. That is the intended behaviour: the rail should notice a
program-owned file moving under us, which is exactly what it failed to do between 09-03 and 09-11.
The S11 record in `product-architecture.md` carries the same note at the point of use.

⚠️ **`S7` names two different things.** Here it is the **Alerts & Monitoring** system. In the
convergence program it is the **filing-watch** feature, live to members since 2026-09-11 12:07:29 ET.
Unrelated. (Checked: the alerts PRD and spec name `alert_fires` and never `user_alerts`, so they are
already consistent with the owner's 2026-09-08 ruling that the durable alert is `alert_fires`.)

## How 50 commits went unrecorded

Four mechanisms, each sufficient on its own. They compounded.

**1. The branch model.** Program artifacts live in the `terminal-research` worktree on the
`terminal-research` branch. Implementation happened on `feat/entity-master`, a branch that worktree
never checks out. A worktree's `git log`, `git diff` and `git status` describe its own branch. There
is no view from inside the docs worktree in which those 50 commits exist.

**2. The protection rail was path- and tree-scoped.** Check (1) diffed the docs worktree against the
start SHA, so its result was empty by construction and PASS was unconditional. When it was first
re-scoped on 2026-09-11 it used a hand-typed path manifest, which undercounted 50 to 17; a
subject-pattern sweep run alongside it omitted `S7` and missed more. A path-filtered log answers
"what touched this path" and a subject-filtered log answers "what did I think to grep for."

**3. A state word was read as an authorship word.** `provenance-freshness-spec.md` §8a calls Entity
Master "already shipped." It was written at ~23:00 on 2026-09-02, five hours after this program
built Entity Master. Read on 2026-09-11 it produced the conclusion that S3 was pre-existing UCT
infrastructure the program had adopted, which is how S3's 11 commits stayed out of the first ledger.

**4. The program's own recorded work used the same channel.** S8's and S11's implementation records
exist because someone wrote them into a PRD by hand after an in-conversation authorization. That is
the same mechanism that produced the other 43 commits; those simply had no one write them down. The
recorded and unrecorded work are not different processes — one had a manual step performed.

### Standing rules

1. **The ledger query is the merge, not a filter.**
   `git log --format='%h %ci %s' ed6b1f041^1..ed6b1f041^2` for the program's own build, and
   `git log 9c3df14b9..origin/master -- $(git diff --diff-filter=A --name-only ed6b1f041^1...ed6b1f041^2)`
   for anyone building on a path the program created. Scope to paths the program **created**; a
   shared file cannot attribute authorship.
2. **Any work on a program-created path gets a ledger row, whichever program performs it.** The
   rail's check (1b) PASS condition is that every commit the query returns has a row in
   [`LEDGER.md`](LEDGER.md). An unrecorded commit is a FAIL.
3. **Every session that touches application code for a Terminal-Next system appends its commits to
   `LEDGER.md` before the session closes.** Hash, timestamp, subject, file count, system
   assignment — the Section 1 row shape. This is the manual step whose absence produced everything
   above; it is now the session's last action, not an afterthought.

## ⛔⛔ THE SPECS ARE NOT ON MASTER — found by W1-A, 2026-09-11

**`docs/terminal-research/` does not exist on `origin/master` at all.** It lives only on the
`terminal-research` branch, which is never merged. Verified both directions:

```
git cat-file -e origin/master:docs/terminal-research/07-technical-architecture/specs/provider-abstraction-spec.md   -> ABSENT
git cat-file -e origin/terminal-research:docs/terminal-research/07-technical-architecture/specs/provider-abstraction-spec.md -> PRESENT
```

⛔ **And the shipped D1 code cites that spec by section.** `api/services/fmp_client.py`,
`tools/fmp_guard_census.py` and `tests/test_fmp_guard_census.py` all reference
`provider-abstraction-spec.md` §4.2, §9.2, §21.1. **An engineer working on master — which is every
engineer working on this codebase — follows those citations to a file that does not exist for them.**

⭐ **This is the structural form of the whole 50-commit problem, and it is worth stating plainly:
the program's DOCUMENTS and the program's CODE live in two doc trees that never meet.** The code's
own record, `docs/d1-implementation-log.md`, **is on master** — so D1's build was documented all
along, just not where this program looks. Each side was complete and each was invisible to the other.

**Not fixed here** (documentation-only session, and the merge decision is the owner's). Two options
when the owner wants it closed: merge `docs/terminal-research/` to master, or replace the in-code
citations with something a master-only reader can resolve. ⚠️ Until then, **treat a spec-section
citation in application code as a pointer into a branch, not into the tree the reader is holding.**

## SESSION SUMMARY — 2026-09-11

**What shipped to branches (nothing merged; the owner merges):** five PRs, all WEB-ONLY.
`feat/s7-filing-watch-parity` (the filing-watch parity rail, precondition for every S7 trigger type);
`feat/i1-rails` (GATE-I1 slice 1 — the S8-boundary AST rail, the `_full_text()` completeness rail,
and adversarial cases); `fix/alert-bell-filing-icon` (member-visible, its own PR by ruling);
`feat/s3-admin-routes` (S3's admin `/status` + `/reconcile`, closing a nine-day-old open item, plus
collecting a suite no standard pytest run had ever executed); `feat/d1-adoption-sweep` (zero
migrations — every remaining FMP call site is blocked, and two quarantine entries were found
suppressing the rail on already-clean files).

**What the rails found the moment they existed.** F-I1-1 caught a **live** violation on its first
run: `AskAiTab.jsx` renders its own citation list while every sibling tab composes S8's primitives
— the Phase-2 double-ownership defect, "fixed" on 2026-09-02 by writing a sentence into an
architecture document, live ever since. The filing-watch parity rail's M2 mutation is **silent in
every existing suite**. And `checks._full_text` never read the refusal sentence, so a fabricated
number inside a refusal passed every mechanical check. ⭐ **Three defects that existed for days and
were invisible until something was built that could see them.**

**What is pending:** the five merges, then GATE-I1 slice 2 (authorized, gated on them), then S7
price-level (needs an absorption ruling), then the D1 adapter gaps.

## ⛔⛔ STANDING HAZARD — this session produced FOUR false signals, all from the instrument

Each looked like a finding about the codebase and was a property of the query. Recorded with the
correct query, because every one of them nearly went into a report as fact.

| # | false signal | why | use instead |
|---|---|---|---|
| 1 | **"17 commits"**, and **"no Checkpoint 6 exists in history"** | a **path-filtered** log answers *"what touched this path"*; a **subject-filtered** log answers *"what did I think to grep for"*. Neither answers *"what did this program ship."* Checkpoint 6 (`5ecdae012`) touched paths outside the filter | the merge itself: `git log ed6b1f041^1..ed6b1f041^2` |
| 2 | **"41 unledgered commits — RAIL FAIL"** | the extraction grep matched Section 3's row shape (`\| \`hash\``) and missed all 50 Section-1 rows, which begin with a row number | match the token, not the row: `grep -oE '\`[0-9a-f]{9}\`'` |
| 3 | **"`feat/i1-rails` is reverting `CLAUDE.md`, joystick docs and `hub_nav_smoke.py`"** | diffed `origin/master..HEAD` while master had moved **two commits ahead** of the branch point; master's newer commits appear as deletions | always diff from the merge-base: `mb=$(git merge-base origin/master HEAD); git diff $mb..HEAD` |
| 4 | **"0 URLs in the C2-02 deliverable"** (a sound 47 KB file with 10) | shell quoting mangled the regex's bracket expression | keep backtick/bracket patterns out of shell strings — write the check to a `.py` file and run it |

⭐ **The general form, and it is the same sentence in all four: an absence is only evidence if the
instrument could have seen a presence.** Three of the four would have been reported as defects in
someone else's work.

## ⚠️ RELATED PATTERN — documents citing artifacts absent from the reader's tree

Three instances found this session, all verified:

1. `fmp_client.py`, the census tool and its tests cite **`provider-abstraction-spec.md` §4.2/§9.2/§21.1** — `docs/terminal-research/` **does not exist on master**.
2. Every `api/services/entity_master/*.py` cites **`entity-master-spec.md`** — same absence.
3. `docs/runbooks/deploy-windows.md`, added to master **today**, instructs the reader to run
   **`python tools/flow_worker_watch_coverage.py`** — that file is **not on master**. It exists only
   on the unmerged branch `origin/ci/flow-worker-watch-coverage` (`2db52c8f3`).

⛔ **Treat a cross-artifact citation as a pointer into a branch until proven otherwise.** The first
two are this program's docs/code split; the third is someone else's runbook shipping ahead of its
tool — the same shape, a different workstream, which is what makes it a pattern rather than an
anecdote.

## ⛔ THE GATE RULE (owner ruling 6, revised and adopted 2026-09-11)

**a. Scope — any system in the 32-system architecture.** Not "any system with a PRD/spec."
⭐ **Having no spec is a reason to write a gate, not an exemption from one.** The original scoping
was precisely inverted: S1, S2, S7 Alerts, I1 and A8 all shipped with no PRD and no spec, which made
them invisible to a rule keyed on having one.

**b. The binding constraint is a second party, not a date.** A gate packet carries an
`APPROVED BY / ON / AT SHA / SCOPE` block, filled in **on the owner's instruction** and **committed
before any Checkpoint 1 commit.**
⛔ **Date-ordering is kept only as a cheap tripwire, because on its own it is nearly vacuous** — the
S3 packet satisfied it: written 17:31, Checkpoint 1 at 17:51, same session, same author. Twenty
minutes of precedence proved nothing. The approval block is what bites.

**c. Three structural requirements, adopted as written:**
1. **A named approver and an empty approval line** — a SHA and a timestamp someone other than the
   author fills in.
2. **Mandatory checkpoints are marked MANDATORY; optional ones are dropped.** The S3 gate's only
   invitation for a human read *"if desired"* and was therefore skipped — that was its one lapsed
   condition.
3. **Scope exclusions get a rail, not a sentence.** Each exclusion names the paths that would
   evidence a breach; the check is *commits on those paths with no `LEDGER.md` row*.

**First instance of (c)(3) is written and has been watched failing:** the S3 gate packet's own
exclusion rail returns **S2 10 commits · S7 4 · D1 9** against real history, D1's first landing
**1h37m after the packet excluded it.** See `12-decisions/gates/entity-master-pre-implementation-gate.md`
→ *THE EXCLUSION RAIL*.

**First gate to actually precede its implementation:** `GATE-I1`, approved 2026-09-11 at
`cd1b37cfc`, scope limited to the first slice (F-I1-1, F-I1-4, adversarial cases).

## How the control files drifted (read before trusting them)

Between 2026-09-02 17:14 and 2026-09-03 07:19, thirteen commits landed across several branches' worth of
branches and not one touched `RESUME.md` or `SESSION_HANDOFF.md`. Those two files went on describing
"Day 1b, Wave 2 partially complete, seven tasks needing re-dispatch" for nine days, while all but one
of those tasks had been completed and accepted hours after they were written. A cold-start session
following the documented reading order would have re-dispatched seven finished research tasks and
believed no code had shipped. Both files now carry a "last verified against git" line; **if the
branch has moved past that SHA, reconcile before acting.**

Two blind spots that made this durable, both worth carrying forward: a docs commit that *records* an
implementation is not the implementation (the code was on branches this worktree cannot see, and only
`origin/master` confirms it), and an **untracked** file is invisible to every `git log` and every
diff — which is exactly how C2-02's 635-byte stub survived nine days looking like completed work.

## THE TRUE SYSTEM ROSTER — rebuilt against the ledger, 2026-09-11

⛔ **The previous roster was wrong on S3 and D1 and silent on five more.** Every row below is derived
from [`LEDGER.md`](LEDGER.md), not from the architecture documents' intentions. "Built" means *this
program shipped code for it*; "pre-existing" means UCT capability the program inherited.

| id | system | built by this program? | PRD/spec | status |
|---|---|---|---|---|
| **S1** | Terminal Shell & Workspace | ✅ narrow slice (`0eec8343d`) | none | **PROVISIONAL-SHIPPED** — ahead of OI-06, gate exception recorded |
| **S2** | Command, Search & Navigation | ✅ narrow slice (`0eec8343d`, `0577245df`) | none | **PROVISIONAL-SHIPPED** — ditto; extended by 4 other workstreams |
| **S3** | Entity Master | ✅ **fully, Checkpoints 1–8** | ✅ both → record | **SHIPPED**, minus its admin ops routes |
| **S4** | Context Bus | ❌ | none | partial pre-existing (`WorkspaceContext`/`ChartsSymContext`); unspecified |
| **S5** | Persistence & User State | ❌ | none | partial pre-existing (`chart_settings` versioning); unspecified |
| **S6** | Personalization | ❌ | none (research only) | not started; OI-21 sharpens order |
| **S7** | **Alerts** (never a bare "S7") | ✅ first slice (`e994f5337`) | ✅ both | **PARTIAL — 1 of 8 trigger types.** ⛔ jointly owned with the convergence filing watch |
| **S8** | Provenance & Freshness | ✅ 5 commits | ✅ both → record | **SHIPPED** (A-ready-now); full `<Cited>` gated on D2 |
| **S9** | Entitlements & Licensing Gate | ❌ | none | mechanism pre-exists (`entitlements.py`); **owner-bound on DEC-05/OI-03** |
| **S10** | Presentation Primitives | ❌ | none | **formally DEFERRED**; S8 uses a local interim formatter |
| **S11** | Session & Market Clock | ✅ 2 commits | none *by design* | **SHIPPED**; extended by convergence Seam 7 |
| **S12** | Rollout, Cohort & Observability | ❌ | none | partial pre-existing (`user_tags` written, read by no gate) |
| **D1** | Provider Abstraction | ✅ **21 commits — ACL boundary built** | ✅ both → record | **SHIPPED, ADOPTION PARTIAL** — 18 files on the adapter, 35 still direct |
| **D2** | Canonical Data Model & Metric Address Book | ❌ | none | **NOT BUILT** — on the critical path; DEC-14 stays in force until it ships |
| **D3** | Realtime Streaming | ❌ | none | pre-existing and strong |
| **D4** | Caching & Serving | ❌ | none | pre-existing, under-adopted |
| **D5** | Reference & Corporate-Actions Data | ❌ | none | not built; DEC-15 stays in force until it ships |
| **A3/A4** | Fundamentals · Estimates | ✅ vertical slice + Analyst Ratings tab | none | **SHIPPED** onto S3+D1+S8+S11 |
| **A5** | Events & Calendar | ✅ 2 commits | none | **SHIPPED** — ⛔ modified Terminal-Current, see Q4 |
| **A6/A7** | Transcripts & Filings · Ownership | ✅ 1 commit | none | **SHIPPED** |
| **A8** | News & Catalyst Intelligence | ✅ News Slice 1 | none | **SHIPPED**; spec not needed, ledger row + licensing check are |
| **I1** | Intelligence Layer | ✅ 2 slices + eval harness | none | **SHIPPED**; ⭐ **needs a spec — highest-value one outstanding** |
| A1, A2, A9–A14, E1 | Markets · Charts · Screening · Options · Breadth · Watchlists · Journal · Portfolio | ❌ | none | untouched by this program |

## ⛔ NEXT-SESSION QUEUE (written 2026-09-11, in order — do not start ahead of it)

| # | item | needs from the owner |
|---|---|---|
| **1** | **Post-merge rail run + ledger close.** Re-run the rail against `origin/master`; flip every Section-4 row from PENDING-MERGE to MERGED with its merge SHA; confirm PASS. **The session's first action.** | nothing — just the word "merged" |
| **2** | **GATE-I1 slice 2 — `feat/i1-askai-provenance`.** Already authorized at `22a0367fe`. ⛔ MEMBER-VISIBLE. Branch off `origin/master` only after the five merge | nothing further |
| **3** | **S7 `price-level` trigger type** | ⛔ **an absorption ruling — draft text below** |
| **4** | **D1 adoption follow-ups** — the five adapter gaps and the 11 Massive sites. Proposal below | a go, once read |
| **5** | **F-I1-2 / F-I1-3** — see below; each needs its own gate approval line | one line each |

### 3 — the draft S7 absorption ruling, for the owner to accept or amend

> **S7 `price-level` absorbs `watchlist_alerts` (`api/services/watchlist_alert_service.py`).**
> Build it under the standing default: **the legacy path stays live and untouched; the new
> `price-level` trigger type runs DARK** — it evaluates, writes its `alert_fires` rows and receipts,
> and **does not call `delivery.py`** — until I flip it. **The flip and the legacy switch-off happen
> in the same PR**, never two. Before the flip, diff the dark fires against the legacy path's fires
> over the same window and show me the comparison. The filing-watch parity rail must be green
> throughout, and any change to predicate or receipt shape carries its own parity test first.

⭐ Why `watchlist_alerts` specifically: it is the highest-volume existing alert path (27 references,
its own service, AlertBell + email + Discord delivery), so it is the absorption that proves the
taxonomy can *replace* a shipped subsystem rather than sit beside it as a seventh table.

### 4 — D1 follow-ups, proposed order

**Safe to do next: G2 and G4.** Both are additive — new typed functions for the 9 uncovered endpoints
(`/stable/profile` alone unblocks 8 modules) and a multi-symbol variant of `get_news_stock`. Neither
changes an existing call path's behaviour.

**G1 next, and it is the one that matters** — exposing a per-call `timeout` on typed functions
unblocks all 34 reaches on its own. ⚠️ It is a behaviour change for any caller currently inheriting
the adapter's 25 s default where the old code used a tighter one (`screener/analyst_pass.py`'s 4 s is
the sharpest case), so it needs a per-call-site review rather than a blanket parameter.

**Defer G3 and G5.** G3 (non-JSON payloads: a PNG, 30–70 MB CSVs needing a 300 s ceiling) is a
different transport, not a gap in the same adapter. G5 (retry/backoff/request-ceiling) would move
`fmp_news.py`'s existing 429 handling into shared code — real work, and the only thing that clears
the pre-existing census red.

**The 11 Massive sites:** leave them. The sweep's own finding was that the mechanical ones are gone
and the rest touch streaming, bars or flow — owner-reserved paths.

### 5 — F-I1-2 and F-I1-3, one line each

- **F-I1-2 — enrich refusals to name the missing thing.** Shipped refusals are correct but terse;
  *"no transcript RAG pipeline exists, so I cannot answer from the call"* is useful where *"I cannot
  answer that"* is not. ⛔ **Member-visible (it changes answer text), so it needs its own gate
  approval line.**
- **F-I1-3 — golden-set adversarial cases for the hard boundary.** ✅ **Already delivered inside
  slice 1** (B01–B06 plus 15 payloads). **No gate line needed — close it** when the merge lands.

## Next actions — re-planned 2026-09-11

**S3 and D1 are off the build list.** Both shipped. The new top five:

| # | work | size | blocked on |
|---|---|---|---|
| **1** | **D1 adoption sweep** — migrate the remaining 35 direct FMP call sites behind `fmp_client`, using the AST guard census tools the program already built. Not new design; finishing what shipped | **M** | nothing. The highest-value work that needs no decision from you |
| **2** | **I1 spec** — narrow: tool-registry contract, the grounding rule, the refusal shape, and the boundary that I1 composes on S8 and never renders its own receipt | **S–M** | nothing |
| **3** | **S3's admin ops routes** (`entity_master_admin.py`) — authorized in the gate, never built; S3 currently has no `/status` or `/reseed` surface | **S** | nothing |
| **4** | **S7 Alerts — FINISH, not start** | **M–L** | ⛔ **a joint-ownership ruling first** — the convergence filing watch lives inside this package |
| **5** | **D2 Canonical Data Model** — needs its own PRD/spec pass first; releases DEC-14 and unblocks S8's full `<Cited>` | **L** | nothing owner-bound, but it is the long pole |

**C2 answer — S7 Alerts is "finish against spec", not "start."** The foundation is real and
spec-cited: `registry.py` implements SPEC-S7 §5.1, the predicate store, delivery seam and receipts
are generic, and document-arrival was the spec's own first step. Seven trigger types remain as
extensions of a working substrate. ⛔ But it cannot be scheduled as ordinary work until you rule on
joint ownership — a change to the predicate or receipt shape is a change to a live member-facing
convergence feature.

**Still parked, unchanged:** S1/S2 rework (awaiting OI-06), S9 (awaiting OI-03/DEC-05), S10
(deferred), and the Day-1 research wave (owner ruling 5).

**Outside program scope, still worth your attention:** RG-32 — Compass's ambient regime context and
its `get_regime` tool disagree, live, today.
