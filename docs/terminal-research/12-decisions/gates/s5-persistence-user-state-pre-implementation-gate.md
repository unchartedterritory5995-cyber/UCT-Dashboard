---
id: GATE-S5-PERSISTENCE-USER-STATE
title: S5 — Persistence & User State — pre-implementation gate
role: the approval packet. Nothing builds until an approval line is signed, and nothing builds past the scope that line names.
status: ✅ line 1 CP1 (as written, an extraction this packet does not contain — UNBUILT, deferred as F-S5-1) · line 2 CP2 SIGNED 2026-09-13. Line 3 (S5-C RULED, CP3) SIGNED 2026-09-19 (fingerprint `41ffcc91c`) and BUILT — Tracings moves off `user_preferences` to its own store (`tracings_documents` table, CAS service, `GET/PUT /api/tracings`, 14 tests, DARK, inertness rail asserts it). Line 4 (CP4) SIGNED by the owner directly 2026-09-19 (fingerprint `ea7178473`) and BUILT — Tracings wired to the store behind a compiled OFF constant. CP5 (browser-certification, member-visible) needs a new line.
date: 2026-09-12
measured_against: origin/master @ 5ff6fc04a
pairs_with: SPEC-S5-PERSISTENCE-USER-STATE
---

# ✅ APPROVED — **CP2**, the additions-only rail. Line 1's extraction is deferred (F-S5-1).

## ⛔ APPROVAL

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-12
APPROVED AT SHA:  37e1823a6
SCOPE APPROVED:   CP1 - EXTRACT THE NOTEBOOK OFFLINE PATTERN as a
                  reusable module, with the Notebook as its first and UNCHANGED
                  consumer. Snapshot-identity on the Notebook's behaviour -
                  every existing Notebook test passes untouched, and the
                  offline/outbox/leader-election semantics are byte-identical.
                  NO SECOND ADOPTER in CP1: one consumer proves the extraction,
                  two would let the module drift toward whichever adopter was
                  written second.
```

## ⛔ APPROVAL — LINE 2 (**CP2**). The line-1 block above stands as granted, unbuilt.

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-13
APPROVED AT SHA:      9c7c634da
SCOPE APPROVED:   CP2 - THE ADDITIONS-ONLY RAIL, exactly as §4 names it. One
                  test asserting that no NEW structured-object preference key
                  is written through `setPref`, derived from the client's own
                  call sites, with a non-vacuity control and a mutation proof,
                  and with today's sites BASELINED rather than failed.

                  ⛔ NO NOTEBOOK CODE IS TOUCHED. No product file changes at
                     all - this checkpoint is a test.

                  ⛔ THE EXTRACTION LINE 1 DESCRIBES IS NOT AUTHORIZED BY THIS
                     LINE and is deferred as F-S5-1 below.
```

> ⭐ **THIS LINE NAMES A §4 ROW, AND THAT IS THE POINT OF IT.** Line 1's scope describes an
> extraction that is not CP1, CP2, CP3, CP4 or CP5 — it is not in this packet at all — which is the
> second occurrence of the scope/packet divergence and the reason the owner adopted the §4-naming
> rule on 2026-09-13. Line 1 is left exactly as granted rather than rewritten: **an approval is a
> record of what was approved, not a draft.**
>
> ⛔ **THE FINGERPRINT CONVENTION WITH TWO BLOCKS:** `git hash-object` of this packet as it stood
> at approval **with THIS block's `APPROVED AT SHA` blank** and every other block left as it
> stands. "This field", in the packet's own words, is the field in the block you are signing.

## ⛔ APPROVAL — LINE 3 (S5-C RULED). CP3 named, not yet built.

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-19)
APPROVED ON:      2026-09-19
APPROVED AT SHA:  41ffcc91c
SCOPE APPROVED:   CP3 (S5-C RULED): the second adopter's A-1 obligation (SPEC §5's "hard one") is answered as MOVE TRACINGS OFF `user_preferences`, not grow `POST /api/auth/preferences` a compare-and-set. Reasoning: every other established second-storage pattern in this codebase (Notebook, broker-sync, COT, catalysts) gives a new subsystem its own table rather than growing shared generic infrastructure's concurrency semantics for one consumer; `/api/auth/preferences` has 70 non-Tracings call sites that would otherwise inherit exposure to expected-value/409 handling they do not need. This ruling authorizes CP3 to be BUILT under `persistence-user-state-spec.md` §5's A-1..A-10 list, Tracings-sized per §6's table (a dedicated `tracings_documents`-shaped store keyed `tracings:<userId>`, its own CAS/revision, its own outbox key, its own lock name `uct.tracings.sync.${accountId}`, fork-on-every-409 per A-5 since Tracings has no server-side appender). THIS LINE DOES NOT AUTHORIZE CP4 (Tracings actually adopting the new store, still dark/OFF) OR CP5 (default-ON, member-visible) -- each needs its own line per the packet's own section-4-naming rule. Not authorized: any change to `POST /api/auth/preferences`'s existing semantics for its other 70 call sites, any change to the Notebook layer, any change to `_PREFERENCE_KEYS`.
```

### ✅ EXECUTED 2026-09-19 — CP3 built

- `api/services/auth_db.py` — `tracings_documents` table (`user_id` PK/FK → `users`, `doc`,
  `revision` INTEGER starting at 1, `updated_at`). One row per member, per SPEC A-3.
- `api/services/tracings_store.py` — `get_tracings`/`set_tracings`, mirroring
  `journal_two/notes.py::update_note`'s compare-and-set shape (`expected_updated_at` there,
  `expected_revision` here — an explicit counter rather than a reused timestamp, so there is no
  clock-skew ambiguity in what "unchanged since your baseline" means). `None` baseline is
  last-writer-wins, matching `update_note`'s own default. `TracingsConflictError` on a stale
  baseline; nothing is written on a refusal.
- `api/routers/tracings.py` — `GET /api/tracings`, `PUT /api/tracings` (409 on conflict), mounted
  in `api/main.py`. Auth-gated via the existing `get_current_user` dependency.
- `tests/test_tracings_store.py` — 14 tests: CAS conflict + a positive-path control proving the
  same two writes succeed on a fresh baseline, last-writer-wins on `None`, per-member isolation
  (service AND HTTP layer), auth-gating, and an INERTNESS rail (source-derived scan of
  `app/src/**/*.js*`, 100+ files) asserting no frontend path calls `/api/tracings` yet — CP4 is
  what wires a live consumer, and this rail fails BY NAME the day something does that early.
- `tools/flow_worker_watch_coverage.py` against all four changed/new files: **OK**, no new strand
  — none of them sit in flow-worker's reachable-but-unwatched set. No marker bump needed.
- **NOT done at CP3, deliberately:** `useTracingsSync.js` is untouched. The client-side outbox,
  the lock name (`uct.tracings.sync.${accountId}`), fork-on-every-409, and the compiled
  default-OFF constant are CP4's scope, not this one's.

## ⛔ APPROVAL — LINE 4 (**CP4**). Lines 1-3 above stand as granted, unchanged.

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-19
APPROVED AT SHA:  ea7178473
SCOPE APPROVED:   CP4: Tracings adopts the CP3 store, behind its own compiled constant (TRACINGS_STORE_ENABLED, tracingsStoreFlag.js), defaulting OFF. The pre-existing preferences-path implementation is unchanged (renamed useTracingsSyncViaPreferences, byte-identical body, its own 16 pre-existing tests still pass unmodified). A second implementation, useTracingsSyncViaStore, reads/writes /api/tracings using the CP3 revision as its CAS baseline (A-1/A-2), forks on every 409 by adopting the server's copy rather than merging since Tracings has no server-side appender to reconcile against (A-5), and reserves the unsyncedCopy.js vocabulary for CP5 when this path first becomes member-visible (A-9). A-7 (a generalised/second store layer) and A-8 (its own lock name) are explicitly NOT built at CP4: with one hook instance and no concurrent-push case (a single in-flight debounce, never two at once), there is no real need yet for an outbox or leader-election lock to arbitrate -- recorded so a later pass builds them against a measured need, not a forecast one, rather than silently dropping the spec's A-7/A-8 line items. Dark: the flag stays false, no member is on this path, no product behavior changes while off. Does NOT authorize CP5 (browser-certification, member-visible, needs its own line) or flipping the compiled constant.
```

### ✅ EXECUTED 2026-09-19 — CP4 built and SIGNED (fingerprint `ea7178473`, owner direct)

- `app/src/components/chart/tracingsStoreFlag.js` — `TRACINGS_STORE_ENABLED = false`, a compiled
  constant (not a runtime/localStorage flag, unlike Notebook's evolved `offlineFlag.js` — CP5 is
  this adopter's own certification gate, unscheduled, so rollback for now is a deploy).
- `app/src/components/chart/useTracingsSync.js` — the pre-existing implementation is UNCHANGED
  (renamed to `useTracingsSyncViaPreferences`, byte-identical body); a second implementation
  (`useTracingsSyncViaStore`) reads/writes `/api/tracings` with the revision as its CAS baseline.
  The exported hook branches on the compiled constant at the top — safe under the rules of hooks
  because the branch cannot change across a mounted instance's renders (it is baked in at build
  time, not runtime state).
  - A-1/A-2: `expectedRevision` sent on every PUT; the server's returned `revision` becomes the
    next baseline.
  - A-5 fork-on-every-409: on a conflict, re-fetches and ADOPTS the server's copy rather than
    attempting a merge — honest per the spec, since Tracings has no server-side appender and
    there is nothing benign to reconcile.
  - A-9: `unsyncedCopy.js`'s vocabulary is explicitly reserved for CP5, when this path first gets
    a member-visible surface — CP4 adds none.
  - A-6 (door enumeration): trivially one door, `flushPush`, matching the spec's own sizing.
  - A-7/A-8 (store layer, lock name): NOT built at CP4 — with only one hook instance and no
    outbox/leader-election need (a single in-flight push per debounce, never concurrent), there is
    nothing yet for a lock or a durable local queue to arbitrate. Recorded here rather than
    silently dropped: if CP5 or a later pass finds a real need (e.g. multi-tab races), build it
    then, against a measured need rather than a forecast one.
- Tests: `tracingsStoreFlag.test.js` (2, pins the OFF default + a mutation control),
  `useTracingsSync.viaStore.test.js` (6: hydrate/adopt, correct-baseline push, fork-on-409,
  a non-conflict control, a failed-network case), and the PRE-EXISTING
  `useTracingsSync.test.js` (16) verified to still pass UNCHANGED — proving CP4 made no behavior
  change while the flag is off.
- **NOT done at CP4:** the flag is not flipped. No member is on this path. CP5 (browser
  certification, member-visible) needs its own line.

### ⏸️ F-S5-1 — THE EXTRACTION, DEFERRED WITH A NAMED CONDITION

> **Extracting the Notebook offline pattern as a reusable module is deferred until a SECOND
> ADOPTER EXISTS and Wave Q1 has 30 days live.** (Owner ruling, 2026-09-13.)

⭐ **Both halves of that condition are doing work, and they are different objections.**

**A second adopter is a design condition.** The pattern has **zero adopters outside the Notebook** —
22 import lines across 14 files, every one under `app/src/pages/journal-2-0/`. A module shaped by
exactly one caller is not reusable; it is that caller's internals wearing a new import path, and
the shape only gets tested when something with different needs picks it up. The packet's own §4
puts that moment at **CP4** (Tracings adopts), which is where the extraction belongs.

**Thirty days live is a risk condition, and it is about a specific date.** Wave Q1 went live
2026-09-12; its predecessor was rolled back **25 minutes after activation** on 2026-09-09. A
14-file refactor of the most recently destabilised subsystem in the estate, sold on a
snapshot-identity promise, is a large bet against a surface that has not yet held. **30 days from
2026-09-12 is 2026-10-12** — recorded as a date rather than a duration, because "30 days live"
read six weeks from now is an invitation to re-derive the start.

⛔ **This is a DEFERRAL with two conditions, not a rejection and not a parking space.** When both
are met the work is CP4-and-after, and it needs its own approval line naming that row.

---

> ## ⛔ EVERYTHING NOT NAMED ON A LINE ABOVE IS UNAUTHORIZED.
>
> No file may be created, edited or deleted on the strength of this document beyond the scope a
> signed line names. The checkpoints in §4 exist so that an approval line can NAME one — an
> approval reading "build S5" would authorize a scope nobody has bounded, which is the defect the
> D2 packet's §2 note records.

---

## 1. What is being asked for, in one paragraph

Ratify the offline-first durable-state pattern the Notebook programme already built and shipped —
a durable working copy, an outbox, Web Locks leader election, and conflict that FORKS rather than
clobbers — as the programme's answer for member-authored work; name the two other persistence
classes it must never be confused with (server-authoritative preferences, per-viewer
localStorage); state the rule for choosing between them; and price the second adopter.
**No member-visible change. No change to the Notebook layer. No new store.**

---

## 2. ⛔ THE FINDING THAT SHOULD DECIDE THE SHAPE OF THE ANSWER

> **The pattern is not implicit and it is not a prototype. It is 3,163 lines of production code
> with 5,040 lines of rails behind it, `OFFLINE_DEFAULT_ON = true`, live for every member — and it
> has exactly ONE adopter.**

Measured this pass (method: SPEC §9.1, §9.6):

| | measured |
|---|---|
| `app/src/pages/journal-2-0/lib/offline/` | **19 production modules / 3,163 lines** |
| rails beside them | **21 test files / 5,040 lines** |
| default state | **ON** — `OFFLINE_DEFAULT_ON = true`, `offlineFlag.js:66` |
| adopters outside the Notebook | **ZERO** — 22 import lines across 14 files, every one under `app/src/pages/journal-2-0/` |

⭐ **This codebase does not need to be taught offline-first. It has it, in production, working.**
What it does not have is that pattern applied past one surface — and it does not have a written
rule telling the next engineer which of three persistence classes their new state belongs in.

⛔ **THE CONSEQUENCE FOR THIS GATE: a proposal that designed a persistence architecture from first
principles would be the wrong answer to a measured question**, and it would put a second authority
against a layer that has already survived a production rollback, a re-activation, and a
seven-environment browser certification.

⛔⛔ **AND THE ONE FINDING THAT MUST SURVIVE INTO ANY APPROVAL LINE:**

> **The coordination machinery is NOT overhead. The leader lock, the landed-revision ring and the
> server-change classifier are what make the member's OWN path REBASE instead of FORK. Deleting
> them does not simplify the working path — it breaks it.**

This is the correction of a published finding, recorded in the source at
`settleNoteWrite.js:5-27`: Wave Q1's own record named *"the FOUR doors"*, derived from what a
canary happened to drive; enumerating from the other side found **six** client doors, of which
**one** recorded its landing. The other five advanced the server revision silently, so the
"is this our own revision?" guard answered *"not ours"* about this browser's own write **and
forked the note.** A second-writer fork is the right answer to a second writer; a member changing
a ticker in another tab is not one.

---

## 3. The decisions this packet asks the owner to make

### S5-A — Is the scope "ratify and generalise", or "design"?

**Recommended: RATIFY AND GENERALISE.** SPEC §3, §4. The alternative is a second authority over a
shape that already works and is already the default path for every member.

⛔ The honest cost of ratifying, stated: **§4 of the spec (What S5 owes Notebook) becomes closed.**
Twelve rulings — N-1 through N-12 — stop being open questions. A later document that re-opens one
is re-litigating a closed call against live production code, and this packet is asking the owner
to make that explicit rather than leaving it implied.

### S5-B — Does the three-class rule get written down as a REVIEW RULE, or only as prose?

**Recommended: AS A RULE, and the rule is three ordered questions** (SPEC §2.1). Prose in a spec
nobody re-opens is how 59 localStorage keys accumulated with no stated policy.

⚠️ **The honest cost:** the rule's question 1 ("would the member have lost WORK they authored?")
answers YES for things that are P1 or P3 today. It does not require migrating them — SPEC §8 says
so — but it does mean a reviewer can now say a shipped surface is on the wrong tier, and somebody
has to be willing to hear that.

### S5-C — Is the second adopter Tracings, or the workspace layout?

**Recommended: TRACINGS** (`useTracingsSync.js`, 162 lines, one mount point at
`ChartsWorkspace.jsx:665`). SPEC §6. It is already 80% of the pattern under different names, it
documents its own last-write-wins caveat as *"Phase-3 to refine"* (`useTracingsSync.js:14-17`),
and it is the only consumer in the app that already reads `setPref`'s return value.

⛔ **THIS DECISION CARRIES A RULING THAT IS NOT S5'S TO MAKE**, and it is called out here rather
than discovered at implementation time:

> **Tracings persists through `POST /api/auth/preferences`, which has NO compare-and-set at any
> layer** — `set_user_preference` is a bare upsert (`auth_service.py:1524-1532`) into a single
> TEXT column (`auth_db.py:230-236`). Either that endpoint grows an optional expected-value, or a
> document that needs a compare-and-set stops being a preference.

Both directions are defensible and neither is small. **The gate should not be signed without the
owner naming which.**

### S5-D — Does the read-modify-write rule ship with an enforcement rail, or as guidance?

**Recommended: GUIDANCE FIRST, RAIL LATER, and the reason is a measurement.** There are **70
`setPref`/`setPrefMerged` call sites** in non-test `app/src` (SPEC §9.3), and `usePreferences.js`
itself states that migrating them *"is a change to every settings surface in the app and belongs
in its own step"* (`usePreferences.js:194-196`). A rail that fails on all of them on day one gets
disabled within a week.

⛔ **What is NOT negotiable either way: no NEW structured-object preference may be written with
`setPref`.** That is a rule about additions, it costs nothing today, and it is the half that
prevents the next instance.

---

## 4. Proposed checkpoints, so an approval line can name one

| CP | scope | strands anything? | member-visible? | size |
|---|---|---|---|---|
| **CP1** | **Documentation only.** The three-class rule (SPEC §2.1) and the twelve N-rulings (SPEC §4) written into the decision register; the read-modify-write rule stated as a review rule. **No code of any kind.** | no | no | **S** |
| **CP2** | **The additions-only rail.** One test asserting that no NEW structured-object preference key is written through `setPref` — derived from the client's own call sites, with a non-vacuity control and a mutation proof, and with today's 70 sites baselined rather than failed. | no | no | **S/M** |
| **CP3** | **The A-1 ruling, executed** — whichever S5-C direction the owner names: an optional compare-and-set on `POST /api/auth/preferences`, OR a decision that Tracings moves off `user_preferences`. **Backend, additive, dark.** | ⚠️ **YES, possibly.** `api/routers/auth.py` and `api/services/auth_service.py` must be classified by `tools/flow_worker_watch_coverage.py` before merge — the smoke-login work already found both files red on that tool with a traced-inert verdict, and a fresh trace is required, not an inherited one | no | **M** |
| **CP4** | **Tracings adopts the pattern**, behind its own compiled constant, defaulting OFF. Durable store + outbox + its own lock name + fork-on-every-409. | no — dark | no while dark | **L** |
| **CP5** | **Tracings default ON**, after a browser-certification matrix at the same tier Wave Q1 ran (`docs/notebook/wave-q1-browser-certification.md` is the precedent, not a suggestion). | no | ⭐ **YES** — the first member-visible change in the whole programme | **S**, and it is a ruling |

⛔ **CP3 IS THE ONLY ONE THAT CAN STRAND**, and it is named here rather than discovered at merge.
⛔ **CP5 IS THE ONLY ONE A MEMBER CAN SEE**, and it must never be folded into CP4's approval line —
"merged dark" and "on for everyone" are two decisions, and Wave Q1's own rollback of 2026-09-09
(25 minutes after activation, `offlineFlag.js:43-53`) is the reason to keep them apart.

⛔ **AND NOTHING ABOUT THE 59 localStorage KEYS IS IN ANY CHECKPOINT.** It is the most quotable
number in the spec and it is deliberately excluded: those keys are shipped behaviour a member
already relies on, and reclassifying any of them is a product decision about what should follow a
member between devices. **S5 makes the classes nameable; it does not get to re-tier what exists.**

---

## 5. ⛔ The four mandatory checklist items, answered in advance

Following the S7 completion plan's checklist, as the D2 packet did.

### 1. PIN EVERY SHAPE AT REGISTRATION, INCLUDING THE ONES NOTHING POPULATES YET

**Answered in SPEC §5.** The second-adopter list (A-1…A-10) pins ten obligations even though
Tracings needs no server-change classifier (A-5 is `XS` for it, and the spec says so rather than
dropping the row). ⭐ Same call F-S7-2 made for `trendline`: pin the wider shape, populate the
narrow one, and do not let the narrow shape teach the next engineer it is the whole shape.

### 2. THE COMPARISON IS FORWARD-ONLY, AND SHIPS WITH THE REPORT THAT READS IT

**Applies at CP4, not before.** A dark Tracings adopter must be comparable against the live path,
and the comparison is forward-only for the same reason every S7 harness's is: **a provider's — or
a browser's — answer for a past instant is not recoverable.** Four outcomes, never a pass rate.

⚠️ **AND THE Q1 PRECEDENT IS SPECIFICALLY THAT THE INSTRUMENT CAN MANUFACTURE THE FINDING.** Twice
in that programme: once by counting pre-existing conflicted copies, once by scoring an unreadable
close as "absent" — *a layer that could not be READ is not a layer that is EMPTY.* Any CP4
harness must carry a control that distinguishes those.

### 3. NAME THE THING THAT CALLS IT, AND THE RAIL THAT ASSERTS THE CALL SITE EXISTS

> **At CP1 the answer is: NOTHING CALLS ANYTHING, because CP1 ships no code.** It is a decision
> register entry and a review rule.
>
> **At CP2:** the rail's caller is the test runner, and its non-vacuity control is the thing that
> must exist — a scan that silently matches nothing passes over an empty set.
>
> **At CP4:** `useTracingsSync` calls it, from `ChartsWorkspace.jsx:665`, and the rail asserts
> that exact call site — the same shape as `catalyst-match`'s
> `test_the_harness_is_the_only_caller_of_would_fire`, which exists because `price-level` merged
> with eighteen green tests and nothing calling its evaluator.

⛔ **RATIFICATION IS NOT GENERALISATION, AND GENERALISATION IS NOT A MIGRATED CALL SITE.**

### 4. A LIVENESS STAMP, NOT JUST A RESULT STORE

⚠️ **THIS DOES NOT APPLY AT CP1 OR CP2 AND SAYING SO IS THE HONEST ANSWER.** There is no sweep, no
tick and no dark run — CP1 is prose and CP2 is a test. It applies at **CP4**, where the dark
adopter's drain needs the heartbeat every Q1 harness carries: a monotonic tick count and a
wall-clock stamp written on **every** cycle including the quiet ones, because a drain with nothing
to send and a drain that is dead are indistinguishable without one.

⛔ Marking it "satisfied" at CP1 would be the worse answer. *A checklist item declared met where it
does not apply is how a checklist stops being read.*

---

## 6. What this packet does NOT ask for

- **No change to the Notebook layer.** Not one line. S5 ratifies it.
- **No new persistence framework** and no abstraction extracted speculatively from one consumer.
- **No CRDT, no operational transform, no field-level merge.** Fork-never-clobber is the answer.
- **No migration of any of the 59 localStorage keys**, or of the 70 existing `setPref` call sites.
- **No change to `_PREFERENCE_KEYS`** — the allow-list is derived and railed by
  `tests/test_preference_key_validation.py`.
- **No rollout mechanism.** WHO sees a dark adopter is S12's question
  (`SPEC-S12-ROLLOUT` §3), and the ordering there is load-bearing: the kill switch is evaluated
  first, so a flag false beats any cohort membership.
- **No member-visible change at any checkpoint except CP5**, which is called out separately for
  exactly that reason.

---

## 7. ⚠️ The evidence gaps in this packet, stated where they bite

1. **No production data was read.** Nothing here rests on a distribution, and no count in the
   spec comes from a database — every one comes from a script over source (SPEC §9). ⛔ **Where it
   would have mattered:** nobody knows how many members have unsynced Notebook work at any moment,
   how often a 409 actually fires, or how large a real `charts_workspace_layout` blob is. The last
   of those is literally OI-21, still open.

2. **The tree read was not verified against the SHA.** The task forbade git commands, so this
   packet has NOT confirmed that the `s7-price-level` worktree it read is identical to
   `origin/master @ 5ff6fc04a`. ⛔ **Where it would matter:** the 43-key allow-list, the 70 call
   sites and the 59 localStorage keys are all counts against a tree, and a reviewer who re-derives
   them at a different SHA should expect drift. **Re-derive before acting; do not quote these.**

3. **Write latency outside Chrome is unmeasured**, by the source's own admission
   (`durableWriter.js:19-21`). The 200 ms debounce is a Chrome 152 operating point. A CP4 adopter
   with a differently-sized document inherits the ceiling, not the number.

4. ⭐ **One measurement in this packet's own spec was wrong on the first attempt and is recorded
   as such** (SPEC §9.5: 28 per-user tables, corrected to 38, because a naive regex silently
   skipped ten DDL blocks declared inside indented migrations). It is left in the spec rather than
   quietly fixed, because **the tell — a parser reporting 37 bodies for 47 names — is the reusable
   part.**

---

## 8. Recommendation

**Sign CP1 alone, or sign nothing yet.**

CP1 is prose: three ordered questions and twelve rulings written into the decision register. It
ships no code, strands nothing, changes no reader, and is revertible by deleting a section. It is
the smallest thing that makes this codebase's existing durable pattern say its own name out loud —
and it is the only checkpoint that can be evaluated without first answering S5-C, which is a
ruling this packet cannot make on the owner's behalf.

⛔ **And CP1 carries the one correction that should not wait.** Two live comments in the client —
`app/src/hub/useHubSettings.js:174` and `app/src/pages/settings/JoystickSettingsCard.jsx:52` —
describe `POST /api/auth/preferences` as accepting *"any `{key, value}` from any authenticated
caller."* The allow-list at `api/routers/auth.py:2041-2050` refuses an unknown key with a 400.
**Two copies of one stale sentence read as corroboration** — which is how the last one survived —
and the sentence sits directly above the endpoint whose real hazard (whole-value replacement) is
unchanged and undocumented at those sites.
