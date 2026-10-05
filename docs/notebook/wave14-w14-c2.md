# Wave 14, lane W14-C2: offer once, cross-tab seen state, Help > What's new, base-tour replay

Branch `feat/notebook-w14-c2`, from `a8e41bcc49` (the W14 integration record). Spec:
`docs/notebook/WAVE-14-PLAN.md` sections 4.3, 4.4, 5 and 11 (defaults **D3**: one prompt at a
time, at most one per session, in arming order, an unseen prompt never expires, every tour
replayable from Help; **D4**: a dismissed checklist stays closed, a newly armed capability
appears under Help's "What's new" instead). Read beside `wave14-w14-0.md` (its 1.4 and 6.2 are
the two open items this lane closes), `wave14-w14-d.md` and `wave14-integration.md`.

No new flag. The offer and What's new are driven by each tour's OWN capability flag; on this
branch the registry holds only the base tour, so **nothing member-visible changes until a W14-B
track registers a tour** (the gate returns null and fetches nothing; What's new renders no
section). Every rail here runs over FAKE registries.

| commit | what |
|---|---|
| `3677ed831f` | server-side per-tour merge route + pytest; client writes through it; `mergeIntoPreferenceCache` |
| `9673f48c56` | offer once: `tourEligibility.js`, `TourOfferGate.jsx` + lazy `TourOfferPrompt.jsx`, first-run stage holder count, NotebookTab mount line, axe + lazy rails |
| `038fef9090` | Help > What's new in `Support.jsx` |
| `bf55896110` | base-tour Replay on a cold load opens at step one |
| (this commit) | this record, mutation evidence, `tools/notebook_w14c2_mutation_proof.py` |

## 1. "Newly switched on, offer once"

### 1.1 Eligibility (`onboarding/tourEligibility.js`, pure)

A registered tour is **offerable** when all hold: it is not the base tour (`notebook-basics`
keeps its own wave-8 auto-start); it is `replayable`; its own flag reads exactly `true`
(`notebookFlag`, so an unlatched flag is off); and the member has **no row** for it in
`notebook_tours` -- not started, not done, not dismissed. Any row means the member has met it,
so it is never offered again.

### 1.2 "Became available" -- there is no arming timestamp

Flags reach the client as booleans on the auth payload (`_access_payload`); the arming time
lives only in `docs/feature_flags.json`, which the client never reads. So "this capability
became available to you" is **defined as "its flag is on and you have never seen its tour"**.
Consequence, stated rather than hidden: a member who had a flag on before this lane shipped and
never took its tour is offered it too. They have not seen it either.

### 1.3 Queue, session, expiry (D3)

* **Order:** registry order. `tours/index.js` lists tracks in the order capabilities are meant
  to arm, and without a timestamp that is the arming order the client can know.
* **Session:** one browser **tab's `sessionStorage`** lifetime -- survives reloads in that tab,
  ends when the tab closes; a new tab is a new session. Key `uct:notebook-tour-offer`, value
  `{id, answered}`. Every read and write is wrapped in try/catch; a store that is missing or
  throws (private mode, blocked storage) falls back to module memory, i.e. one page load, which
  can only make the cap stricter per load. Two tabs are two sessions and may each show one offer.
* **At most one per session** (`pickOffer`): no record -> the first offerable tour; an
  unanswered record -> that same tour again if still offerable (a reload, or after another
  first-run surface that pushed it aside closes -- still the one offer); an answered record, or
  one whose tour was taken in another tab -> nothing until the next session.
* **Never expires:** nothing has a time limit. A tour not yet offered waits for a later session.

### 1.4 The prompt, and why it never stacks (`TourOfferGate.jsx` + `TourOfferPrompt.jsx`)

NotebookTab mounts the eager gate with **one line** beside RegistryToursGate (it needs
`hasAnyNotes`, `notesKnown` and whether a note is open, which only NotebookTab has). The gate
computes the offer and the reasons to wait (`offerBlockedBy`), and only then fetches the small
card chunk. The card is portaled into Layout's in-flow first-run slot (never floating), holds
the first-run stage while on screen (so "Meet Compass" waits behind it), and waits -- records
nothing -- while:

| reason | why |
|---|---|
| preferences loading, note count unknown | no decision on half the facts |
| a note is open | R4: never while a member is editing |
| the base first-run tour is still due for this member (`tourIsForThisMember` and not finished) | the first-run tour goes first |
| the get-started checklist is open | that list already offers every armed tour; a second door at the same moment is a stack |
| someone ELSE holds the stage (a tour, the phone editor) | counted with the new `useFirstRunStageHolderCount` minus its own claim, because `useFirstRunStageHeld` answers true for its own claim |
| no slot | never float |
| the slot already holds another card (the Compass card shows without claiming) | a MutationObserver on the slot's children; once the offer is on screen it keeps its place, since anything arriving after it is waiting on its claim |

If a tour opens while the offer shows, the offer yields (hides, nothing recorded) and returns
when the tour closes. It is not a modal: no dialog role, focus is never moved to it, nothing
traps Tab; it is a labelled region, first in `<main>`, so Tab reaches "Take the tour" then "Not
now". Escape inside it is "Not now". Touch tier: both buttons `min-height`/`min-width:
var(--tap-min)` at `<= 1024px`, full-width pair at `<= 640px`; tokens only.

* **Take the tour:** `openRegistryTour(id)` -- RegistryToursGate's existing door. The engine
  records `started` itself. Session answered.
* **Not now:** the tour's row becomes `{v:1, state:'dismissed', step:null}` -- dismissed for
  PROMPTING only. Walkthroughs keeps listing it; What's new keeps listing it (1.6).

### 1.5 RegistryToursGate.jsx

**Zero lines touched.** The offer opens a tour through `openRegistryTour`, the event the gate
already listens for, so C1's later edits to the gate cannot conflict with this lane.
`GenericTourEngine.jsx` is also untouched (`git diff --stat a8e41bcc49 -- ...` empty for both).

## 2. Cross-tab safety for `notebook_tours`

`POST /api/auth/preferences` replaces the whole value (`set_user_preference` writes one TEXT
column), and `setPrefMerged` merges against THIS tab's cache. Two tabs recording different
tours in the same moment each post a map lacking the other's row; the later arrival wins.

**Server-side merge route** -- `PUT /api/j2/onboarding/tours/{tour_id}` with `{state, step}`
(`api/routers/notebook_onboarding.py`, work in `api/services/journal_two/tour_seen_state.py`):

* one SQL statement, `INSERT ... ON CONFLICT(user_id, pref_key) DO UPDATE SET pref_value =
  json_set(<stored map, or {} if not a JSON object>, '$."<id>"', json(<row>))` -- SQLite runs it
  under its write lock, so the read and the write cannot interleave with another request;
* answers `{value}` = the whole merged map as stored, so the client's cache gets other tabs'
  rows too;
* authenticated (`get_current_user`; any member -- a tour is not a paid capability); behind the
  router's existing onboarding gate (404 dark, nothing written); tour id and step validated
  against `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` (which is also what makes the JSON path safe to
  build), state against the enum; capped at `MAX_TOURS` = 64 rows, enforced IN the statement's
  `WHERE`, so the cap cannot be raced either (413, nothing written; rewriting an existing row is
  always allowed);
* no work at import or lifespan (railed by reload with a patched connection).

**Client** -- `recordTourState` (signature unchanged, so the engine is untouched) updates this
tab's cache optimistically through the new `mergeIntoPreferenceCache` (an additive export of
`usePreferences.js`, the no-request sibling of `refreshPreferences`), sends ONE row to the
route through a per-module write queue (so two steps of one tour cannot land out of order), and
puts the server's answer into the cache. Fallback: a 404/405 (gate dark, older server) or a
network failure takes the old `setPrefMerged` path unchanged; any other refusal (400, 413)
writes nothing more -- re-posting the whole map would step around the server's own validation
and cap.

## 3. Help > What's new (`Support.jsx`)

Next to Walkthroughs: every registered, replayable, non-base tour whose flag is on for this
member and which the member has **not taken** -- no row, or `dismissed` with `step: null`
(declined from the offer before walking a step; the engine always records the step it was on
when a tour is closed from inside it, so a skip from inside is "taken"). Each with **Start**,
through the same `startPath`/`startState` door as Replay. It waits for the preferences (never
flashes a list that may be wrong), renders no section when empty, and a tour leaves it the
moment the member starts it. **D4:** it neither reads nor writes `notebook_getting_started`; a
dismissed checklist is never reopened (railed: no POST at all from the page).

## 4. The base tour's Replay on a cold load opened at step 2 -- fixed

**Cause.** Help's Replay and the Support article's "Take the tour" arrive with
`state.startTour`. NotebookTour opened the tour after a fixed `AUTO_START_DELAY_MS` (300 ms) on
whatever anchors were on screen then. On a cold load the notes are still loading at that
moment: the sidebar is painted, the first-run screen (step 1's `first-run` anchor) is not, so
the tour began at step 2, "Folders and tags" -- exactly W14-0's `walk.json` at both widths.
Reproduced in `NotebookTour.coldReplay.test.jsx` before the fix (`Expected: Welcome to your
Notebook / Received: Folders and tags`).

**Verdict: an outright bug** (the door is documented to open the tour from step one, plan 4.2,
and the member it hits is the one the tour exists for). **Fix, smallest form** (`NotebookTour.jsx`,
+23/-2): that one timer now waits, bounded (`REPLAY_FIRST_STEP_WAIT_MS` = 8 s, polled every
100 ms, the same bound the generic engine uses), for step 1's anchor while it can still arrive
-- the note count is unknown, or known to be zero. A member with notes never sees the first-run
screen, so for them it opens as soon as the count is known. Auto-start, "Take the tour" (the
event door) and the M-7 unmount guard are untouched.

**Base tour's existing tests unchanged:** `git diff --stat a8e41bcc49 --` over `tourSteps.js`,
`tourCopy.js`, `tourPref.js`, `tourControl.js`, `NotebookTourGate.jsx`,
`NotebookTour.module.css`, and every existing base-tour rail (`NotebookTour.test.jsx`,
`.a11y`, `.renderLoop`, `.stage`, `NotebookTourGate.test.jsx`, `tourLazy.test.js`,
`tourAnchors.test.js`, `baseTour.zeroDrift.test.jsx`) prints nothing, and all of them pass
(section 5).

## 5. Tests

Full suite, `npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=2` from `app/`,
totals copied:

```
 Test Files  3 failed | 622 passed (625)
      Tests  37 failed | 7777 passed | 1 skipped (7815)
```

Read by name, not by count. All 37 are in three files, none of which this lane touches or
imports: `lib/offline/f5p1OwnerSendsQueued.test.jsx` (35, every one a 15 s timeout under load --
W14-0 section 5 and W14-int section 8 record the same file), `lib/mathNodes.test.js` (1, a timeout)
and `lib/iteratorGlobalFloor.test.js` (1, "app/dist/assets missing -- run `npm run build`": this
fresh worktree had no build). The same three alone, same tree: `Tests 1 failed | 75 passed (76)`
(the dist one); after `npm run build`, `iteratorGlobalFloor.test.js` alone: `Tests 9 passed (9)`.
No failure is a W14-C2 file.

Lane-scoped runs (final tree):

* onboarding dir + `a11y/` + `tabs/` + `components/firstRun` + `hooks/usePreferences*` +
  `styles/`: `Test Files 2 failed | 105 passed (107)`, `Tests 2 failed | 1075 passed | 1 skipped`;
  the two (`notebookTab.a11y` "tab-timeline:flags-off", `NotebookTab.test` "Import entry point")
  were find-timeouts and pass alone: `Test Files 2 passed (2)`, `Tests 73 passed (73)`.
* `src/pages/Support*`: `Test Files 3 passed (3)`, `Tests 26 passed (26)`.
* `src/hooks/usePreferences*`: `Test Files 5 passed (5)`, `Tests 47 passed (47)`.

New rails: `tourEligibility.test.js` (23), `TourOfferGate.test.jsx` (19), `TourOfferPrompt.lazy
.test.js` (4), `tourSeenState.crossTab.test.js` (6), `NotebookTour.coldReplay.test.jsx` (3),
`a11y/tourOffer.a11y.test.jsx` (2 axe recipes), `Support.whatsNew.test.jsx` (9),
`usePreferences.mergeIntoCache.test.jsx` (2), `firstRunStage.test.jsx` (+2). Edited rails:
`Support.notebook.test.jsx` (`WhatsNewSection` joins the link-resolution helpers, one word).

Backend: `python -m pytest tests/test_notebook_tour_seen_state.py` -> `23 passed`. With
`test_sample_notebook.py`, `test_preference_key_validation.py`, `test_async_routes_do_not_block.py`,
`test_exposed_routes_gated.py`, `test_main_router_order.py`, `test_user_definitions_auth.py`:
`1 failed, 215 passed`; the one is pre-existing (section 7), red identically on a `git archive`
of `a8e41bcc49`.

`python tools/check_repo_hygiene.py`: clean.

## 6. Mutation proofs

`tools/notebook_w14c2_mutation_proof.py <name>` applies one textual mutation, runs the named
rails, restores the file from a captured copy and verifies the restore by sha256. Raw output:
`docs/notebook/evidence/wave14-w14-c2/<name>.txt`.

| mutation | rails red |
|---|---|
| **M1** `pickOffer` ignores the session (the cap removed) | `tourEligibility.test.js` 2, `TourOfferGate.test.jsx` 4 (incl. "ONE PER SESSION -- offers nothing else"): `Tests 6 failed / 36 passed` |
| **M2** an answered session offers the next tour | 1 + 4: `Tests 5 failed / 37 passed` |
| **M3** client skips the merge door (always the whole-value path) | `tourSeenState.crossTab.test.js` 5, incl. "both rows survive": `Tests 5 failed / 9 passed` |
| **M4** server writes over the stored map instead of merging into it | `test_notebook_tour_seen_state.py` 5, incl. the two-thread race: `5 failed, 18 passed` |

Every restore verified by sha. The two race rails each carry a CONTROL (the whole-value door
under the same race loses a row), so they can fail without a mutation.

## 7. Open items

* **Real-browser walk** of the offer and What's new at 390/820/1200 is W14-Q's (`tools/
  notebook_w14_0_walk.py` pattern). This lane's phone-width evidence is the CSS rails (touch tier
  at `<= 1024px` on `var(--tap-min)`, `styles/tapFloor.test.js` green) and jsdom, which performs
  no layout -- not a device result.
* **No arming timestamp** (1.2): if the owner wants "newly" to mean "armed after you last
  visited", the server would have to serve a per-flag arm time; nothing in the client can
  derive it.
* **Two tabs, two offers:** the cap is per tab session by definition. A per-member-per-day cap
  would need a server row.
* **Bytes:** `tools/notebook_perf_budgets.py --dist app/dist` on this tree reads **2,292,098 B**
  against the 2,260,793 B budget (already over at the base: W14-int section 7 read 2,287,388 B at
  `0ff7010b93`, and `a8e41bcc49` is docs-only on top). This lane's cost is therefore about
  **+4,710 B** -- the eager gate, the eligibility rules and the stage holder count; the card is
  lazy. Not fixed here and the budget is not raised.
* Pre-existing, not this lane's: `tests/test_user_definitions_auth.py::
  test_require_paid_is_defined_PER_ROUTER_and_this_task_invented_no_shared_one` is red at the
  base `a8e41bcc49` (three screener routers share one refusal sentence), reproduced on a `git
  archive` of the base.
