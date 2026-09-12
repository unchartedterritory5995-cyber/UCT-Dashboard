---
id: GATE-S5-PERSISTENCE-USER-STATE
title: S5 — Persistence & User State — pre-implementation gate
role: the approval packet. Nothing builds until an approval line is signed, and nothing builds past the scope that line names.
status: ⛔ UNAPPROVED. No approval line exists. Nothing in this packet is authorized.
date: 2026-09-12
measured_against: origin/master @ 5ff6fc04a
pairs_with: SPEC-S5-PERSISTENCE-USER-STATE
---

# ⛔ UNAPPROVED — S5 pre-implementation gate

## ⛔ APPROVAL

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ## ⛔⛔ NOTHING IN THIS PACKET IS AUTHORIZED.
>
> The approval block above is empty and that is its correct state today. No file may be created,
> edited or deleted on the strength of this document. The checkpoints in §4 exist so that a future
> approval line can NAME one — an approval reading "build S5" would authorize a scope nobody has
> bounded, which is the defect the D2 packet's §2 note records.

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
