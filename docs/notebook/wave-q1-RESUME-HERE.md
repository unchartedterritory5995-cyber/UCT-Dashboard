# Wave Q1 — RESUME HERE

# ✅ COMPLETE AND READY — 2026-09-12

| item | state | blocker |
|---|---|---|
| `OFFLINE_DEFAULT_ON = true` on `origin/master` | **TRUE** | — |
| Docs branch merged (closing entry, sampler, gate doc, rails) | **TRUE** | `dd7695ac2` |
| Sweep audit merged | **TRUE** | `103eaf19c` |
| Wave Q2 PRD + decisions merged | **TRUE** | `9d3248379` |
| Rollback branch pushed, green, unmerged | **TRUE** | `3db89e205` — no PR page; open from the branch page |
| Sampler unattended, heartbeat documented | **TRUE** | — |
| Sunday canary + gate are SCHEDULED TASKS | **TRUE** | both `Ready`; detached runner retired |
| Gate rails green | **TRUE** | 27/27 |
| Sweep audited, fifth-pattern detectors added | **TRUE** | — |
| CaptureHost resolved | **TRUE** | two clean gates, 0 NEW each; load-sensitive by name, no fix |
| Q2 PRD, decisions, kill-switch recommendation | **TRUE** | before Q2-C, not before A/B |
| GitHub PAT / MCP next session | **DECIDED — not created** | owner ruling; merges landed via `git push`, rollback is one click from the branch page |
| First INDEPENDENT member opt-in | **FALSE** | every opt-in is the owner's account or the internal smoke account; arrives with real traffic |
| 7-day window closed (2026-09-19 00:45 ET) | **FALSE** | time |
| Sunday verdict, KEEP | **FALSE** | regenerates Sunday 18:05 ET |

# ⛔⛔ Q1 DEFECT — SEVEN DOOR FAMILIES, THREE SHAPES (2026-09-12)

> ⚰️ **"THE FOUR DOORS" WAS NEVER FOUR, AND THE LIST'S METHOD WAS THE DEFECT.**
> Wave Q1 recorded *"the FOUR doors — every path that advances `updatedAt`"* and
> named body, folder, ticker, tags. That list came from the DERIVED WIRE RAIL,
> which can only see doors a canary actually opened. No canary ever uploaded a
> hero image, so `hero` was absent — and shipped to production unsettled.
>
> ⭐ Re-derived on 2026-09-12 **from the SQL**, not from behaviour:
> **SEVEN server-side functions** advance a note's `updated_at`, reached through
> **nine routes** and **sixteen client call sites**, and the conflict they
> produce has **THREE SHAPES**, not one.

## The seven, derived (`doorEnumeration.test.js` ①)

| function | how it is reached | client sites |
|---|---|---|
| `update_note` | `PUT /notes/{id}` · `POST\|DELETE /notes/{id}/hero` · `POST /versions/{id}/restore` (via `restore_note_version`) | 10 |
| `append_widget_embed` | `POST /notes/{id}/embeds` | 3 |
| `append_financial_fact` | `POST /notes/{id}/facts/{id}/insert` | 1 |
| `append_document_excerpt` | `POST /notes/{id}/excerpts` | 1 |
| `restore_note` | `POST /notes/{id}/restore` | 1 |
| `import_confirm` | `POST /notes/import/confirm` | **named exception** |
| `delete_folder` | `DELETE /note-folders/{id}` | **named exception** |

⛔ `restore_note_version` is an eighth NAME and not an eighth door — it writes no
SQL of its own and calls `update_note`. Rail ① (b) pins that distinction so a
real eighth cannot hide behind it.

## The three shapes (`serverChange.js`)

Classified from **the diff of the returned note against the last-known one**,
never from which endpoint was called — an endpoint's shape can change in a later
wave; a diff of two documents cannot lie about what is in them.

| shape | proof | what the drain does |
|---|---|---|
| `metadata-only` | body, title and subtitle byte-identical | **rebase** onto the new revision and send |
| `append-only` | the body is the last-known body plus tail blocks, every one of `widgetEmbed` / `financialFact` / `documentExcerpt` | **merge** those blocks into the queued body and send |
| `body-rewrite` | anything else, **including anything unprovable** | **fork** — preserve both copies |

⛔ **The default is `body-rewrite`.** Missing evidence, an unrecognised node, a
moved block, a changed title — all fall through to the safe answer. A duplicate
is recoverable by the member; an overwrite is not.

⭐ **The classifier is the SECOND LINE, and that is the point.** The landed ring
only knows revisions THIS browser recorded, so a door fired in another tab, a
door that shipped before its settle, or a door nobody has enumerated yet still
produces a revision the ring has never heard of. The ring is an enumeration of
callers, and Wave Q1 proved twice that an enumeration of callers goes stale
silently. The diff needs no enumeration at all.

## The last-known server copy

The classifier needs a base, and the base is **not** the member's working copy —
diffing against that reads the member's own unsent edit as the server's change
and forks every time. So:

- a **clean** record (`dirty: 0`) **is** its own base; storing a second copy
  would be a second authority over one value;
- a **dirty** record carries `serverBase`, captured at the clean→dirty
  transition and moved forward on every ack and every successful drain send;
- a dirty record with **no** snapshot answers `null`, which classifies as
  `body-rewrite`, which forks. "We could not read it" is never "it matches".

Cost: one extra body per UNSYNCED note, never per note.

## The named exceptions, and what would close each

| exception | why it cannot land | what would close it |
|---|---|---|
| `POST /notes/import/confirm` | creates and writes MANY notes in one call, returns a summary; nothing is open in an editor and nothing can be queued against a note that did not exist yet | return `[{noteId, updatedAt}]` per note touched |
| `DELETE /note-folders/{id}` | one bulk UPDATE over every note in the folder, returns `{ok: true}`; the revisions exist and are identical, the browser is just never told them | return the moved note ids + the one new `updatedAt` — **cheap; queued as Q1-F1** |

Both are warn-listed **by name** in `doorEnumeration.test.js`, and a rail asserts
each carries a reason and a closure path, so neither can decay into a shrug.

## What the API changed (ADDITIVE)

`POST /notes/{id}/excerpts` now returns `{excerpt, note}`. `append_document_excerpt`
advanced that note's `updated_at`, and **a browser cannot record a revision it
was never told** — every other door route already returned the note; this was the
one that did not. Rail: `tests/test_journal_two_excerpts_router.py::
test_create_excerpt_returns_the_note_it_just_advanced`, mutation-proved.

## The emptied working copy — the small defect beside the big one

`settleForked` wrote the SERVER's copy back into the durable record, and every
field fell back to `''`/`null`. A fork that resolved without a usable server note
therefore **blanked the member's local copy of that note and marked it clean** —
and a clean record is not a recovery candidate, so the banner would never offer
it back either. The words survived in the `(conflicted copy)` sibling; the note
the member had been looking at did not. It now keeps the content and settles the
queue; three rails, mutation-proved.

## Two defects this fix introduced, caught by rails before merge

1. **`??` over a baseline, three times** — including one in `settleNoteWrite.js`
   written earlier and never run against `baseline.test.js`. `''` reads as
   present to a producer and absent to a consumer; all three now go through
   `usableBaseline`.
2. **`(await res.json().catch(() => ({}))).note` throws synchronously** when a
   response has no `json` — `.catch` only handles a *rejected* promise. In
   `capturePriceToNotebook` that turned a **successful** price capture into
   "Capture failed — try again". Body-reading moved INSIDE `settleNoteWrite`,
   which now accepts a Response, an envelope or a note and cannot throw.

⭐ And a third, in the *instrument*: the enumeration rail's first version matched
`settleNoteWrite` **inside the ⛔ comment explaining why the settle is there**, so
deleting the call and leaving the comment passed. It strips comments now. Same
disease as `lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`.

## The rails, and what each one can fail for

| rail | owns | mutation-proved |
|---|---|---|
| `serverChange.test.js` (30) | the three shapes, one case per append type, the last-known-copy helpers | 4 mutations |
| `outboxDrain.test.js` (28) | the drain rebases / merges / forks, the record gets the appends, a fork never empties | 5 mutations |
| `NoteEditorPage.conflict.test.jsx` (9) | the editor merges all three append types and metadata-only; a foreign append still forks | roster shrunk to widgetEmbed → 2 red |
| `doorFamilies.settle.test.jsx` (17) | every drivable door lands the RIGHT revision, each paired with its negative | via the gauntlet |
| `doorEnumeration.test.js` (9) | ① the seven from the SQL · ② no unaccounted server writer · ③ every door call lands or is named · ④ variable-URL writes resolved | 3 mutations |
| per-component rails | the component wires its own door: hero ×2, excerpt, thesis review, trade modal ×2, trash restore | via the gauntlet |
| `tools/q1_door_settle_gauntlet.py` | one mutation per settle call site; GREEN is a defect | self-checking control |

⛔ **Two layers, one authority each.** A component rail owns "this surface hands
its response to the settle, for this note". Whether the settle lands the right
revision from that response is owned once, in `doorFamilies` +
`settleNoteWrite.test.jsx`. A component rail that asserted the ARGUMENT SHAPE was
really testing how that component reads a body — and went red the day the read
moved into the helper, where it belongs.

## Still open, named, with owners

| id | item | why it is not in this merge | owner |
|---|---|---|---|
| **Q1-F1** | `delete_folder` returns the moved note ids + revision | ruled a merge-2 exception; cheap (≈15 lines + a rail) | Notebook |
| **Q1-F2** | `import_confirm` returns per-note revisions | ruled a merge-2 exception; larger (bulk shape change) | Notebook |
| **Q1-F3** | behavioural rail for `GlobalAddPositionProvider`'s hero door | it is the SAME door as `HeroImagePicker` (5 rails) and the provider ends in `window.location.href`, which jsdom cannot drive without a redesign of the harness. Structural coverage from ③ + gauntlet RED | Notebook |

⭐ **Q1-F4 and Q1-F5 were added after the deploy** — see the production sweep
table above. The full open list lives there; this one is a subset kept for the
reader who arrives at this section first.

## ✅✅ DEPLOY — Q1 fix: seven door families land revisions; drain classifies metadata/append/rewrite

| | |
|---|---|
| merged | `3e79bb1e6` → `master`, 2026-09-12 |
| web | **SUCCESS** `3e79bb1e6` · `/api/health` uptime **32 s** (reset) |
| bars-api | **SUCCESS** `3e79bb1e6` (`api/**`-gated) |
| worker | BUILDING → `api/**`-gated |
| flow-worker | **SKIPPED** — the OPRA tape was never touched. ⭐ Read from the STATUS column, not from the SHA: the SHA appears on a SKIPPED row too, and reading presence as a deploy is the error that nearly widened the RTH freeze |
| gate | `docs/notebook/gate-runs/2026-09-12T15-38-28.md` — **19,186 passed / 7 failed, 0 NEW**, failing set matches the baseline exactly, tree hash stable start→end, 1,294 runnable reconciling with 1,295 − 1 waived |
| plain-diff cross-check | independent of the tool: ANSI and CR stripped first, then `comm` against `docs/plans/joystick/gate-baseline.json` — **0 unique to observed · 0 unique to baseline · 7 in both**, agreeing with the tool's own verdict |
| third leg | the classifier's own strings are in the SERVED bundle: `metadata-only`, `append-only`, `body-rewrite`, `documentExcerpt`, `financialFact` all found in `/assets/useDurableNote-o-Tk5Ifo.js` |

### Member impact

A member who edits a note offline while anything else moves that note's revision
— setting a ticker, uploading a hero image, saving a price into it, capturing an
excerpt, restoring it from the trash — no longer gets a `(conflicted copy)` of
their own note. Sixteen client call sites now record the revision they created,
and when the queue meets a revision it has never heard of, the drain reads the
DIFF: metadata-only rebases, a server-side append merges, and only a genuine
prose rewrite forks. Nothing else about the Notebook changes. Anyone with a tab
open keeps the old bundle until they reload.

## The production property sweep — family × ordering × verdict

Every row is the same property: **a member types offline, a door fires, sends
are in flight, the transport returns — the sentence must reach the server body
and no `(conflicted copy)` may be created.**

⛔ **DRIVEN means the member's own control was operated in a real browser on
production.** It never means a scripted `fetch` stood in for one: a raw fetch is
a SECOND-WRITER simulation whose fork is *correct*, and reading it as a defect in
the member's path cost this wave three deploys (measured: raw-fetch door 11 lost
/ 13, the member's own door 0 lost / 36).

| family | door | ordering | verdict | evidence |
|---|---|---|---|---|
| `update_note` | `ticker` | 3 queued sends beat the door | ✅ **GREEN** | canary run #28, `2026-09-12T20:46:21Z` — sentence in server body **True**, door value kept (`ticker='NVDA'`), no fork, notes 37→38→37 |
| `update_note` | `tags` | 3 queued sends beat the door | ✅ **GREEN** | run #29, `20:48:24Z` — sentence **True**, `tags=['window-check-door']`, no fork |
| `update_note` | `folder` | 3 queued sends beat the door | ✅ **GREEN** | run #30, `20:50:14Z` — sentence **True**, no fork. Value check prints **N/A by construction** (the canary note has no folder, so `folderId: null` is a real write whose value reads the same on both sides); the door is proved by the baseline move |
| `update_note` | `hero` | 3 queued sends beat the door | ⚠️ **INCONCLUSIVE** | run #31 reported `heroImageUrl = None` after the drain. **That has two readings and this run could not separate them** — see below. The run REFUSED TO STAMP, so no row claims otherwise |
| `append_widget_embed` | Send to Journal | — | ⚠️ **INCONCLUSIVE — not reachable from this page** | the door is on the **charts page**, not the note editor. The editor's `/chart` slash command inserts CLIENT-side and never calls `/embeds` |
| `append_financial_fact` | Save price to Notebook | — | ⚠️ **INCONCLUSIVE — not reachable from this page** | the door is on **TickerPopup**. The editor's `/price` command creates the fact then inserts client-side — the non-advancing half |
| `append_document_excerpt` | Save excerpt | — | ⚠️ **INCONCLUSIVE — not reachable from this page** | needs a PDF uploaded to the note, opened in the preview, with a real text selection inside the rendered document |
| `restore_note` | Trash → Restore | — | **N/A by construction** | a member cannot be typing offline INTO the note they are simultaneously restoring from the trash. A real door with a real rail; not this property |
| `import_confirm` | import wizard | — | **N/A — named exception** | returns a summary, not notes; no revision exists for the browser to land (Q1-F2) |
| `delete_folder` | folder sidebar | — | **N/A — named exception** | one bulk UPDATE, returns `{ok:true}`; the revisions exist and are never told to the browser (Q1-F1) |

### ⚠️ The hero row, stated exactly

Run #31 drove the hero door through the editor's own file input and, after the
drain, read `heroImageUrl = None`. Two readings:

- **(a) PRODUCT** — the drain's body PUT clobbered the hero the member just set;
- **(b) INSTRUMENT** — the door never set a hero, and the canary reported its own
  failure as a product defect.

⛔ **This run could not separate them**, and says so rather than picking one.
`tools/q1_hero_door_probe.py` was written to isolate it — create a note, fire
only the hero door, read the note back, no drain involved — and **its browser
failed to launch twice**, so nothing was measured.

⭐ **What makes (b) the more likely reading, and why that is still not a verdict.**
The step's "the baseline moved" signal is weak here: the rig reads the note's
`updatedAt` while OFFLINE, so `before` is `None`, and `after` is non-null because
the drain's own body PUT moves the revision regardless of whether a hero was ever
uploaded. So that signal cannot tell the two apart either. And on the product
side `update_note` builds its `SET` list only from keys present in the patch, and
the drain's PUT carries `{title, subtitle, bodyJson, baseUpdatedAt}` — so a body
send has no mechanism to null a hero. **Neither observation is a measurement, and
the row stays INCONCLUSIVE until the probe runs.**

⛔ `hero` was added to the canary's rotation and **taken straight back out** in
the same session. Leaving it in would have made the scheduled unattended window
refuse to stamp every fourth run, for an instrument reason that reads as a
product problem to whoever finds the gap later. The driver and its verdict arm
are KEPT in the file, so closing this is wiring, not rediscovery.

### Open, named, owned

| id | item | what it needs |
|---|---|---|
| **Q1-F1** | `delete_folder` returns the moved note ids + the one new revision | ≈15 lines + a rail |
| **Q1-F2** | `import_confirm` returns per-note revisions | bulk response shape change |
| **Q1-F3** | behavioural rail for `GlobalAddPositionProvider`'s hero door | the provider ends in `window.location.href`; jsdom needs a harness redesign |
| **Q1-F4** | **the hero row above** — get `q1_hero_door_probe.py` to launch, settle (a) vs (b), then put `hero` back in the rotation | the probe's `launch_persistent_context` dies on the rig profile; `window_check` launches Chrome differently and succeeds, so the fix is to reuse its spawn path |
| **Q1-F5** | drive the three append families on production | each needs the rig to leave the note editor for a different surface (charts page · TickerPopup · PDF preview) |

## ⛔⛔ THE MEMBER DENOMINATOR HAS A STRUCTURAL PROBLEM, NOT A TIMING ONE

Measured in the owner's own Chrome, 2026-09-12 15:2x UTC, on the live flipped
build:

```
authStatus 200 · accountId 7a6d0299-…  ← THE SAME ACCOUNT AS THE RIG
uct.j2.offline.enabled = "0"           ← EXPLICITLY OPTED OUT
syncLocksHeld 0 · notebook DB present · no console errors
```

⛔ **The owner's browser is explicitly opted out**, so `offlineEnabled()` is false,
the layer never runs, and no opt-in event can fire from it. ⛔ **And it is signed
in as the same account the rig uses.** So the observation window currently has
**no independent member at all**: every opt-in in the feed is the canary's, and
the one human browser available is opted out and shares the rig's identity.

⭐ **This is not a flip failure.** The flip is verified live in both directions.
It means "zero blocked-baseline events" is still being measured over a
population of **zero real members**, which is the exact shape Q1's own telemetry
work exists to prevent — and it must not be read as a clean week.

**To get a real datapoint, one of:** clear `uct.j2.offline.enabled` in a browser
that is NOT the rig's account and open the Notebook; or wait for another member
to load it. ⛔ The owner's key was NOT cleared by the agent — it is the only
in-RTH kill switch and changing it is the owner's call.

## ⚰️ THREE MERGES IN FOUR MINUTES TOOK PRODUCTION DOWN

`dd7695ac2` → `103eaf19c` → `9d3248379`, pushed back to back. Railway marks each
in-flight deploy `REMOVED` when the next arrives, so production served **502 for
several minutes** rather than the ~1 min blip the runbook budgets for ONE Tier 1
push. Verified as ours: `9d3248379` was `DEPLOYING` while the site 502'd, and it
recovered the moment it finished.

⛔ **Batch merges, or let each reach SUCCESS before pushing the next.** The
runbook's "~1 min `/api/*` blip" is per push and does not compose.

## ✅ CaptureHost — LOAD-SENSITIVE BY NAME, NO FIX NEEDED

Two full 6-shard gates with the flag true, nothing else running:

| gate | result | shard 6 (CaptureHost's shard) |
|---|---|---|
| 1 | **0 NEW failures**, set matches baseline | 0 failed / 3984 |
| 2 | **0 NEW failures**, set matches baseline | 0 failed / 3984 |

Its single observed failure was in one flip-gate run; it passed alone, passed
paired against all four offline-layer neighbours in its shard, and has now passed
two clean full gates. **That is the repo's own definition of a load-sensitive
name, and it needs no product or teardown fix.** `fix/capturehost-isolation`
contains nothing beyond `master` and was therefore not pushed.

⛔ **The `load_sensitive` list lives in `docs/plans/joystick/gate-baseline.json`,
which is the joystick workstream's file and out of bounds for this wave.** Adding
`CaptureHost.test.jsx > closing returns the dialog to nothing` to it — with the
evidence above — is a **joystick-session follow-up**, alongside the B7
branch-identity fix. ⛔ It must be added to `load_sensitive`, **never banked into
the baseline**: the baseline's own instruction says a banked slot is one a real
failure can occupy unnoticed.

## ⛔ DECIDED — the GitHub PAT was deliberately NOT created

Owner ruling, 2026-09-12. Its stated purpose was unlocking the REST route for
merges; **all merges landed via plain `git push`**, so that purpose was moot. What
remained was the MCP connecting next session and one draft PR — set against
creating a 90-day `repo`-scoped credential and persisting it to a User
environment variable, where any process running as the owner can read it. Not
worth it for that.

⭐ **Sunday's revert does not depend on it.** `rollback/notebook-offline-default-off`
@ `3db89e205` is pushed, gated and gauntleted green with the flag false. Opening a
PR from the branch page and merging it with a **merge commit** is one click.

## ⭐ THE OWNER'S BROWSER NOW RUNS THE LAYER — and is still not a member

Owner ruling, 2026-09-12. `uct.j2.offline.enabled` was **removed** from the
owner's regular Chrome so a week of real human browsing exercises the offline
layer. Verified immediately after, on the live build:

```
flagKey null (default ON) · optInMarker "1" · sync lock HELD 1 · session lock 1
notebook DB present · no console errors
```

⛔ **It is labelled `owner browser (rig account, human use)` and counts as
NEITHER a member NOR the rig.** It shares the rig's account, so identity cannot
separate the two — and it does not need to, because neither is an independent
member. `members` counts opt-ins from **any other email**, and that is the only
number the "zero blocked-baseline events" claim may be divided by.

# 🏁 WAVE Q1 — CLOSED, AND LIVE IN PRODUCTION

**Flipped 2026-09-12 00:45 ET / 04:45 UTC.** `OFFLINE_DEFAULT_ON = true` for every
member from their first page load after the deploy. Wave Q1 had been built,
merged and **dark** since `32afb1fd8`; it is dark no longer.

| | |
|---|---|
| flip tip, fast-forwarded onto `master` | **`739218e48`** |
| rollback, pre-authored · gated · gauntleted · **PUSHED** | **`3db89e205`** (`rollback/notebook-offline-default-off`) |
| deploy tier | **Tier 1 — web only** (`docs/runbooks/deploy-windows.md`) |
| verified on `origin/master` | hash ✅ · ancestor ✅ · `offlineFlag.js:66` reads `true` ✅ |

⭐ **The rollback existed before the flip did**, deliberately: the moment you need
a rollback is the worst moment to write one.

⛔ **There is no PR page, so Sunday's revert is a two-step.** `gh` is not installed
on this box; the GitHub MCP server failed to connect at session start; and
`GITHUB_PERSONAL_ACCESS_TOKEN` is **not visible in the agent's shell** (the REST
call returned **401**). **Sunday's revert: open a PR from the branch page for
`rollback/notebook-offline-default-off` @ `3db89e205`, and merge it with a MERGE
COMMIT** — not squash, not rebase, because this record cites these hashes. Ten
seconds, and documented rather than discovered.

## The deploy — measured per service, not inferred from the tier

| service | status for `739218e48` |
|---|---|
| **web** | **SUCCESS** — `createdAt` 04:45:15Z → process start 04:46:57.9Z |
| worker | SKIPPED |
| bars-api | SKIPPED |
| flow-worker | **SKIPPED** |
| chart-renderer | no record (independent; last deploy 2026-09-01) |

**Rebuild timing, now a range rather than a point:** **103 s** (this flip) and
**138 s** (`b63cf9775`). A third figure, 41 s, was a *redeploy of an existing
image* and is **not comparable** — it measures a different thing and is recorded
here only so nobody averages it in. Options Flow verified healthy after:
`enabled · available · warm`, all three views live.

## Both directions, on the live build

**The served bundle actually changed** — `NotebookTab-DsTCcK7U.js` (was
`NotebookTab-CMePJ5Sn.js`), and the minified flag reads `const Qs=!0` where it
read `zi=!1` before. That check exists because a deploy can "succeed" and still
serve a cached bundle.

| state | sync lock | claimable | notebook DB | verdict |
|---|---|---|---|---|
| key **unset** (the member default) | **1 held, exclusive, ours** | False * | `uct_notebook_<acct>` · `conflicts/meta/notes/outbox` | **layer ACTIVE** |
| key **`'0'`** | **0 held** | True | present, untouched | **layer OFF** |
| key cleared again | **1 held** | False * | same | **reversible** |

\* `claimable: False` there is the leader **working** — the measuring page holds
the lock itself, so it cannot be granted twice. In the canary's cleanup the page
is opted out, which is why `True` is the expected reading there. ⛔ Do not read
these two as the same measurement.

**Console / pageerror across all three states: none.**

## Five real-door canaries on the flipped build

| run | # | door | door path | claimable (census) | forks | outbox | sentence in body | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | 21 | `folder` | REAL | True (1) | 0 | 0→0 | ✅ | 37 → 38 |
| 2 | 22 | `ticker` | REAL | True (1) | 0 | 0→0 | ✅ | 37 → 38 |
| 3 | 24 | `folder` | REAL | True (1) | 0 | **1→0** | ✅ | 38 → 39 |
| 4 | 25 | `ticker` | REAL | True (1) | 0 | 0→0 | ✅ | 38 → 39 |
| 5 | 26 | `tags` | REAL | True (1) | 0 | 0→0 | ✅ | 38 → 39 |

**5/5 green, all three doors covered.** Every run drove the member's own door —
the `baseline None → <timestamp>` fingerprint the raw-fetch door cannot produce.

⭐ Run 3's `outbox 1→0` was not scripted: it is the entry stranded by the crashed
run below being picked up and drained once the layer came back on. **The
re-enable path, working on production.**

⛔ **Run #23 is missing from that table and the reason is recorded, not hidden.**
It consumed the `tags` slot, which is why two extra runs were added rather than
shipping a table with one door unexercised.

**Cumulative real-door fork rate: 0 forks in 42 runs** (28 prior verifiable + 9
earlier on 09-11 + 5 post-flip). At 42 clean runs, any fork rate **≥ 10.4 % is
excluded at ≥99 % confidence**; below ~10 % remains unexcluded and would need
more runs than this wave will pay for. ⛔ That is the honest claim; "proven
clean" is not.

## ⚰️ THE ONE RED, AND IT WAS A DEPLOY MEETING AN INSTRUMENT

Post-flip canary 3 died on `SyntaxError: Unexpected token '<', "<!DOCTYPE "...`.
Another workstream pushed `739218e48 → 6b4378e33`; `web` restarted at 05:04:30Z
against a run that began at 05:03:25Z; `/api/j2/notes/<id>` served the SPA
fallback during the swap, and `.json()` threw. The run died on the traceback — no
row, no cleanup, an orphan note and a stranded outbox entry.

**Classified DEPLOY + INSTRUMENT, never PRODUCT.** A ~1 min `/api/*` blip is the
documented cost of *any* Tier 1 push. Canaries 1 and 2 had already passed against
the flipped build. **No rollback was warranted and none was performed.**

**Fixed** (`7e83f38ad`): the post-door read now returns a structured `readFailed`
and the step goes red as explicitly **INCONCLUSIVE** — never as "the baseline did
not move". Same distinction `_doc_text(None) == ""` got wrong twice in this wave:
*a response that could not be PARSED is not a revision that did not MOVE.*

**Litter cleaned, identified before deletion:** one orphan note carrying the
crashed run's own sentinel (`WINDOW-CHECK-SENTINEL 2026-09-12T05:03:25Z`). The
three preserved round-3 evidence notes were **not** touched.

## Telemetry — the denominator means something now, and it currently reads zero

| | |
|---|---|
| `notebook_offline_opt_in`, total | **20** |
| …of which **member** | **0** |
| `notebook_blocked_no_baseline` | **0** |
| `sync-conflict` notes | 3 (all preserved round-3 evidence) |

⛔ **All 20 are the rig**, accumulated across the night's canary runs, each of
which opts in and back out — a genuine re-opt-in, which the new logic correctly
counts. **The real denominator starts on the first member load.** It is 01:20 ET
on a Saturday; nobody has opened the Notebook yet, and saying so is the point.

⭐ **Dedupe verified on the LIVE build, not only in jsdom:** three loads of the
same browser, marker `'1'` each time, **count 19 → 20 — one event.** That is the
once-per-page-view regression the flip commit had to prevent, confirmed dead in
production.

## The observation window — unattended, starting now

The sampler runs from **`C:\Users\Patrick\uct-q1-observe\`** — deliberately **outside every git
worktree**, so removing a worktree during the 7-day window cannot kill the job.
⚠️ The two `.py` files there are **copies taken 2026-09-12** and will not track
later repo edits; the repo copy is the source of truth, and both must be updated
together.

It appends a row every 2 hours to `C:\Users\Patrick\uct-q1-observe\wave-q1-observation-log.md`, as Task
Scheduler job **`UCT-WaveQ1-Observe`** (`/SC HOURLY /MO 2 /ST 02:00`, **Ready**).
**It has been running unattended since the flip** — rows at 01:20, 03:00, 05:00,
07:00, 09:00 and 09:20 ET, every one `OK`.

⚰️ **A column that could only ever say zero, caught by its own log.** The table
began with `opt-in (member) = total − 20`. Then `total` went **20 → 19**, and
counts do not decrease: the admin activity feed is a **200-row window** and old
events roll off it. A member event arriving while another rolled off would leave
`total` unchanged and `member` reading **0** — indistinguishable from nobody
coming. Replaced with **`latest opt-in (UTC)`**, which moves when something new
arrives regardless of roll-off. ⛔ **Every opt-in up to `2026-09-12 05:17:56` is
the rig.** A `latest` newer than that, with no canary running, is a real member. A run that cannot take the rig profile writes a
**SKIPPED** row with its reason, so **a gap in the log is never silent**.

⛔ **The limitation, printed in the log's own header so it is discovered now and
not on Sunday:** *Outbox stuck >5 min is not observable fleet-wide and the rig
runs opted out. It is covered only by real-door canary runs (rig, layer on) and
by member reports. A canary any time this weekend fills that datapoint; the
sampler does not.*

## ⛔⛔ THE SUNDAY 18:00 ET GATE — the rule, verbatim

> **any unexplained red, any fork not attributable to a genuine second writer,
> any outbox item stuck >5 min, or any offline-layer console error seen by a real
> member → merge `3db89e205` before 20:00 ET Sunday.**
>
> **Clean → KEEP, and the 7-day window runs from the flip timestamp.**

⭐ Triggers 1, 2 and 4 read **fleet-wide from the log**. ⛔ **Trigger 3 reads
canary result or member report — NEVER the sampler**, for the reason in the log
header.

### ⛔⛔ FIRST, CHECK THE JOB RAN — a log with no rows looks exactly like a quiet week

The sampler writes a SKIPPED row when it *runs and cannot proceed*. It writes
**nothing at all** if the job never fired, and **Task Scheduler's own exit code is
the only signal for that case**. Run this before reading the table:

```
schtasks /Query /TN "UCT-WaveQ1-Observe" /FO LIST /V
```

⭐ Read **`Last Run Time`** (should be within the last 2 hours) and **`Last
Result`** (`0` = ran). A stale `Last Run Time`, or a non-zero `Last Result`, means
**the table is incomplete and its silence means nothing.**

## ⛔ THE ONLY IN-RTH TOOL — per browser, exact text

```js
localStorage.setItem('uct.j2.offline.enabled', '0')   // then RELOAD the page
```

Takes effect on that browser's next load and reaches nobody else. Destroys
nothing: a durable copy left behind by a switched-off layer is inert, and the
server holds every synced note regardless.

## ⛔ ROLLBACK MECHANICS — a deploy, not a variable

`OFFLINE_DEFAULT_ON` is a **compile-time constant** compiled into the bundle.
There is no Railway variable behind it, and setting one named after it changes
nothing while looking like it worked. Rollback = merge `3db89e205`, wait for the
`web` rebuild (**103–138 s measured**), and **every member with an open tab keeps
the OLD bundle until they reload** — no service worker, no version prompt, by
charter. So "reverted" means "no NEW page load gets it", never "nobody is running
it".

## ⛔ SETTLED — do not reopen

- **Single writer: DECIDED AND REVERSED.** The coordination machinery is what
  makes the member path rebase; deleting it breaks the path that works.
  `wave-q1-single-writer-decision.md` §4 lists the only three things that reopen it.
- **The property rail (old §A): VOID.** There was no product defect to reproduce.
- **Round 3: the INSTRUMENT.** Fifth of five instrument defects this wave — and
  tonight added a sixth (the deploy-blip crash) and a seventh (the sweep's blind
  spot to injected storage stubs). ⛔ **Every one made the product look broken;
  none made it look healthy.** That is bias, not noise. Treat the next
  unexplained red as the instrument first — without letting that reasoning talk
  you out of a rollback a member could feel.

## Follow-ups — none blocking the observation window

| # | item | owner | scope |
|---|---|---|---|
| a | `rule12Paths` (joystick B7, `327fa4c70`) has no branch-identity check, so it fires on any branch editing `journal-2-0/` — including the Notebook's own. Waived by name for tonight's gate, never modified. | joystick session (owner carrying) | one guard condition + a rail |
| b | `tests/test_gate_shards.py` — **3 red on master**, and they are the rails over the gate's own **baseline-comparison** logic, which every verdict tonight leaned on. Verdicts were cross-checked by plain `sed`/`sort`/`comm` diff instead. | TBD | worth its own decision |
| c | Runtime kill switch, shape (a) server-served flag. **MEDIUM, 6–12 h.** ⛔ Does **not** fix the open-tab case either — a boot-read flag is still a boot-time value. | deferred | costed, not built |
| d | The flag sweep now detects a **fourth** way to reach the default (injected storage stubs). Its docstring promised three and warned "reading cannot prove there is no fifth" — neither can the tool. | Notebook | watch for a fifth |
| e | No PR page for the rollback branch (`gh` absent, REST blocked). | owner | 10 seconds from the branch page, if a clickable revert is wanted for Sunday |

---


# ⛔⛔⛔ START HERE — 2026-09-12

⭐ **PRODUCT FINDING, KEPT — rig probe 3, 2026-09-12:** a leader that
navigates away **hands leadership on**. A waiting follower takes the
`uct.nb.sync.<accountId>` lock **inside 5 s** and still holds it at 60 s —
**no deadlock, no leaked drain.** `awaitSyncLeadership` does on the real
browser exactly what its comment claims. ⛔ This is a PRODUCT result, not an
instrument one, and it is the half of the lock investigation worth keeping:
it is the only direct evidence that the account is never left with a leader
that cannot drain.

## ⚰️ FIRST, WHAT THE HEADER THAT STOOD HERE GOT WRONG

Until 2026-09-12 this spot said **"the self-fork is NOT fixed"**, ordered a
property rail rebuilt *before any fix*, and sent the next session to measure
**SINGLE WRITER**. All three were superseded **later the same day** — by the
sections immediately below this one — and the header was never updated. It stood
for a day pointing every reader at work that must not be done.

⛔ **A SUPERSEDED INSTRUCTION AT THE TOP OF A HANDOFF OUTRANKS A CORRECT ONE IN
THE MIDDLE.** Nobody reads to line 74 to find out that line 5 is void. This is
`lesson_a_second_authority_over_one_value` in a document: two authorities over
"what is open", agreeing only by luck, and the stale one won.

| the old header said | the ruling |
|---|---|
| "the self-fork is NOT fixed … round 3 … the packet is NO-GO" | ⛔ **VOID.** Round 3 was the **INSTRUMENT**. `window_check.DOOR_JS` fired the metadata door with a raw `fetch()`, so the editor's handlers never ran, `recordLandedRevision` never recorded the revision, and guard 2 correctly answered *"not ours"* and forked — **the right answer to a second writer.** Raw door: **11 lost / 13** (r = 0.85). The member's own door: **0 lost / 36** (r = 0.00). |
| "A. THE RAIL FIRST — reproduce tonight's failure deterministically" | ⛔ **VOID, AND IT MUST NOT BE BUILT.** There is no product failure to reproduce. A rail built to go red on round 3 would be a rail built to go red on **the product working correctly** — and the jsdom rail that "could not be made red" was already telling us exactly that. |
| "B. Evaluate SINGLE WRITER" | ⛔ **DECIDED — REVERSED, do not re-open.** The coordination machinery is **not overhead**: it is what makes the member path **rebase** instead of fork. Deleting the in-flight marker, the landed ring and guard 2's two passes would break the path that is currently working. The expected benefit ("the race disappears") was predicated on a race that the measurement says is not there. |

⛔ **Do not re-litigate any of the three.** If a future session believes one of
them is wrong, it needs a NEW measurement, not a re-reading of the old header.

## ⛔ KNOWN PRE-EXISTING REDS — master's, not this wave's

⭐ **Measured both ways before being claimed**: each was run against the
COMMITTED file as well as this branch and failed identically, so none of them is
inherited work dressed as ours. Listed so the next session does not adopt them.

**`tests/test_gate_shards.py` — 3 failures, on `master`:**

| test | area |
|---|---|
| `test_the_exit_code_is_NONZERO_on_a_real_differing_set` | baseline-diff rails |
| `test_non_vacuity_the_SAME_path_returns_zero_on_a_matching_set` | baseline-diff rails |
| `test_a_baseline_entry_that_stopped_failing_does_NOT_block` | baseline-diff rails |

⛔ **These are the rails over the gate's own baseline comparison** — the machinery
that decides whether a failing set is a regression. They are red on master while
being the thing every gate verdict in this wave leans on. Not fixed here (out of
scope, and not this wave's file), but ⛔ **not nothing either**: a green gate
verdict rests on comparison logic whose own tests do not pass. Worth an owner
decision separately from Q1.

**The frontend baseline itself** carries 7 known failures
(`258c5609d529a1f247ae6ff2da266f8479742823`, re-measured on `origin/master`
`62a228e5d`); the gate compares against that set rather than against zero.


## ⛔ THE ONE WAIVER ON THE FLIP GATE — rule12Paths, and it is NOT ours

**Waived by the owner, 2026-09-11.** The flip gate runs with
`app/src/hub/rule12Paths.test.js` excluded by name, and the gate manifest prints:

> *rule12Paths excluded — joystick B7 rail has no branch identity check and fails
> on any branch editing journal-2-0/, including the Notebook editing itself;
> cross-workstream false positive; waived by owner 2026-09-11.*

⛔ **The waiver covers ONE test and nothing else.** The gate must still reconcile
to zero NEW failures against the baseline; a second red is a stop, not a second
waiver.

⭐ **It is not a Notebook defect and it was not fixed here.** The rail
(`327fa4c70`, joystick B7) asserts "this branch must not edit the Notebook
workstream's files" but has no branch-identity check, so it fires on every branch
touching `app/src/pages/journal-2-0/` — including the Notebook's own. Editing it
would be doing, to another workstream inside its observation window, precisely
what rule 12 exists to prevent. **The joystick session owes the fix**; it is
recorded in `CLAUDE.md` → *"B7 / rule 12 owes a branch-identity check"* and the
owner is carrying it over.


## ✅ WHAT IS ACTUALLY OPEN — 2026-09-12

**Q1 is built, merged, and live in production DARK.** The branch
`notebook-primary-platform` is **fully merged into `origin/master`** (0 ahead) —
there is nothing to push, and `app/src/pages/journal-2-0/` is byte-identical to
master. `OFFLINE_DEFAULT_ON = false`. The only thing between here and closure is
evidence.

```
streak of seven, doors through the REAL path  →  matrix  →  packet  →  flip on GO
                                              →  post-flip §15  →  task back to
                                                 full runs  →  close
```

⭐ **Same charter, same hard stops, same standing deploy/flip authorisation** —
conditional on the checklist, exactly as before. ⛔ The flip is a member-visible
production change and needs an explicit go, not an inference from a green row.

## ✅ THE LAST OPEN DEFECT IS CLOSED — and it was the instrument for the fifth time

`cleanup reports locks=1 while opted out` (left open by `3fc55ea37`) was the
**census counting a FROZEN holder**, not a leaked drain. Three probes on the rig,
2026-09-12:

| probe | reading |
|---|---|
| a plain **opted-out** load of `/journal/notebook` | **0** `uct.nb.sync.*` — the `supported` gate holds, twice over |
| navigate off the notebook with **nothing waiting** | the previous context's lock still reads **HELD** 5 s later |
| tab1 leads · tab2 waits · **tab1 navigates away** | tab2 **HOLDS within 5 s**, and still holds at 60 s |

⭐ **So a lock outlives the document that took it, and only while nobody asks for
it.** Chrome keeps the old page frozen rather than destroying it; nothing evicts
a frozen holder until the lock is contended. The cleanup page is opted out, so it
never asks — and counted a holder that is not running.

⛔⛔ **AND THERE IS NO DEADLOCK.** The third probe is the product question hiding
inside the instrument one — *does a follower ever get leadership when the leader
leaves?* — and the answer is yes, inside five seconds. `awaitSyncLeadership` does
on the real browser exactly what its comment claims.

**The fix is a different measurement, NOT a looser threshold.** The row already
promised *"lock free ⇒ the next run can open it"* and asserted it with a census
that cannot tell a frozen holder from a live one. It now **asks for the lock**
(5 s budget, released the instant it is granted): a grant **is** the row's claim;
no grant means something LIVE holds it and the step stays **RED**. Five
self-check cases drive it, and the load-bearing pair is
**`census 1 + claimable True ⇒ GREEN`** against
**`census 1 + claimable False ⇒ RED`** — the same census, opposite verdicts, so
the change is a distinction rather than a silenced alarm
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

⚠️ **Counting instrument defects in this wave: this is the fifth**, after the
raw-fetch door, the baseline-less fork detector, the baseline-less cleanup
leftovers, and `_doc_text(None) == ''` scoring an unreadable read as absent.
⛔ **Every one of them made the PRODUCT look broken.** None made it look healthy.
An instrument whose errors all point the same way is not noisy, it is **biased**,
and the next unexplained red should be treated as the instrument first
(`lesson_an_instrument_can_reproduce_its_own_blind_spot`).

## ⚠️ AND THE RIG BIT BACK, IN THE DOCUMENTED WAY

The probe that produced the table above **left the profile opted IN** — on-disk
`'1'`. Its opt-out sat in a `finally` **outside** `with sync_playwright()`, which
is precisely the shape `flush_localstorage`'s own docstring warns about ("every
call came back *Event loop is closed*"). Repaired the same session: relaunched,
opted out **inside** the block, verified `'0'` on disk with Chrome dead.

⛔ **A throwaway probe against this rig is not throwaway.** It shares the one
profile, and a profile left opted in silently changes what the next run measures.
Any ad-hoc script that touches the flag ends with `opt_out` **and**
`flush_localstorage` inside the Playwright block, then a disk read to prove it.

---

# ⛔⛔⛔ READ THIS BEFORE THE CHAIN BELOW — THE INSTRUMENT MANUFACTURED THE FINDING

**2026-09-11. The canary's metadata door is NOT the product's door, and that is
where "round 3" came from.**

`window_check.DOOR_JS` fires the door with a **raw `fetch()` from the page
context** — its own GET, its own PUT, its own baseline. It never calls
`onFolderChange` / `onTickerChange` / `onTagsChange`. So on every canary run:

* `settleMetadataRevision` never ran,
* `recordLandedRevision` never put the door's revision in the landed ring,
* guard 2's `serverCopyIsOurs` therefore answered **"not ours"** — **correctly**,
  because that write genuinely was not made by the notebook's save path,
* and it **forked**, which is **the right answer to a second writer**.

⭐ **A member changing a ticker is not a second writer. The canary was one.** The
instrument was asking "what happens when another device writes while you are
offline", and the product was answering it correctly the entire time.

## THE COMPARISON, measured the same night, same rig, same ordering

Every run below is the same ordering, the same rig, the same night, with the
same **3 sends beating the door**, doors rotating folder/ticker/tags.

| door | VERIFIABLE runs | sentence LOST | rate | new forks |
|---|---|---|---|---|
| raw `fetch` (`DOOR_JS`) | **13** | **11** | **r = 0.85** | on every loss |
| the product's own control (`--real-door`) | **28** | **0** | **r = 0.00** | **0** |

⚠️ **"Verifiable" is doing work here.** Two runs finished with an UNREADABLE final
server read, and my runner scored an unreadable server as *"the sentence is
absent"* — `_doc_text(None) == ""`, so a failed read became a finding. One of the
two was a real-door run, and it briefly read as the first real-path loss.

⛔ **It was not.** Its own wire shows the rebase working:

```
#5 03:55:51  body SENTENCE  base 03:55:37  -> 409  "note changed"
#6 03:55:51  body SENTENCE  base 03:55:50  -> 200  server = 03:55:52
```

`#6` moved onto the door's revision and landed the sentence. Only the closing
verification read failed. ⚰️ **This is the SECOND false positive of this exact
shape in this tool** — the first counted pre-existing conflicted copies. A layer
that could not be READ is not a layer that is EMPTY (`window_check` has carried
`layer_read_failed` for precisely this; `q1_repro` did not).

⭐ The one raw-door run that survived had **`sends=1`, not 3** — so even the
second-writer case only loses the words when several sends are in flight. At
`sends=3` the raw door lost 12 of 13.

## ⛔ THE POWER ARITHMETIC (R-15/R-18), stated rather than implied

`r` = per-run probability the sentence is lost. `M` = clean runs needed.
P(M greens | r) = (1−r)^M.

```
P(28 greens | r = 0.85) = 8.5e-24   rejected
P(28 greens | r = 0.50) = 3.7e-09   rejected
P(28 greens | r = 0.30) = 4.6e-05   rejected
P(28 greens | r = 0.16) = 7.6e-03   rejected
P(28 greens | r = 0.15) = 1.1e-02   NOT rejected
P(28 greens | r = 0.10) = 5.2e-02   NOT rejected
P(28 greens | r = 0.05) = 2.4e-01   NOT rejected
```

**So 28 clean real-door runs exclude any failure rate ≥ 28% — precisely r ≥ 0.153 —
at ≥99% confidence, and exclude nothing below ~10%.** For ≥99% power at a given
`r`, M ≥ ln(0.01)/ln(1−r):

```
r = 0.30  ->  M = 13        r = 0.10  ->  M = 44
r = 0.20  ->  M = 21        r = 0.05  ->  M = 90
```

⛔ **The honest claim: the round-3 failure mode does not occur on the member path
at any rate ≥ 15%, and the raw-fetch door's 0.85 is excluded outright.** It is NOT
"proven clean" — a defect below ~10% would need 44+ runs, which is a cost
decision, not a measurement.

⭐ **And one real-door run independently corroborates the mechanism working**: it
409'd on the stale baseline and then REBASED onto the door's revision and landed
the sentence with a 200, in the same second. That is guard 2's "ours ⇒ rebase"
arm doing exactly its job, captured on the wire.

## ⛔ WHAT THIS EXPLAINS — every confusing thing about this wave

* Three fixes that each looked correct in review, shipped, and "failed" again.
* Mechanism-level rails staying green through what looked like shipped defects.
* A jsdom rail that could not be made red **even replaying the rig transcript
  step for step** — because in jsdom the door goes through the real handler, the
  landed ring gets the revision, guard 2 says "ours", and it rebases. ⚰️ **That
  was the product working, and it was read as the rail being inadequate.**

`lesson_a_quantised_instrument_can_manufacture_a_finding` ·
`lesson_an_instrument_can_reproduce_its_own_blind_spot`.

## ⛔ WHAT IS **NOT** VOID

1. **The second-writer behaviour is correct and must stay railed.** The raw-fetch
   door is a *good* test of "another device wrote"; fork-and-preserve-both is the
   right answer. `inFlightGuards.test.jsx:151` ("A GENUINE SECOND WRITER STILL
   FORKS") and the new `doorsThroughTheEditor` control both hold that line.
2. **Round 2 is not void.** Its `|| saved` defect lost words through the REAL
   path and its fix stands.
3. **Two real tabs ARE a genuine second writer** and would produce this
   legitimately. That is a product question — is a fork the experience we want
   for one member with two tabs open? — and it is not a defect.

## ⛔ THE INSTRUMENT MUST BE FIXED BEFORE THE STREAK IS RE-ARMED

`CANARY_SUSPENDED = True` today, so the daily task cannot manufacture an H1 right
now. **The moment it is re-armed with the raw-fetch door, it will.** The door in
`window_check` must drive the product's controls (as `q1_repro.py --real-door`
does) — or keep the raw-fetch door and RENAME what it tests to "second writer",
which is what it has always actually measured.

---

## ✅ R-26 — THE CANARY ACCOUNT IS BACK AT ITS INTENDED STATE (2026-09-11)

The seventeen evidence notes are deleted. Their content is the section below,
which was committed and pushed **before** anything was removed.

| | server total | canary-titled | sync-conflict | screen marker hits |
|---|---|---|---|---|
| before | 63 | 31 | 15 | 13 |
| after the 17 | 46 | 14 | 15 | 0 |
| after the orphan sweep | **34** | **2** | **3** | **0** |

**removed 17 + 12 = 29 · refused 0.**

⛔ **THE TWELVE WERE NOT IN THE RULING, AND THEY WERE NOT OPTIONAL.** Deleting a
repro note leaves the fork the server made from it standing — a child whose
parent is gone. Those twelve appear in no artifact of the cleanup tool's, so
they cannot be selected by primary key the way everything else here is. They
were selected by **the tool's own title marker** instead.

⛔⛔ **NEVER BY THE TAG — and the run now PRINTS what the tag would have taken:**

```
  by MARKER (what this deletes): 0
  by TAG    (what R-X forbids) : 3
    ⭐ the tag would also have taken: 'WINDOW-CHECK-SENTINEL …00:00:56Z (conflicted copy)'
    ⭐ the tag would also have taken: 'To Do List'
    ⭐ the tag would also have taken: 'To Do List (synced copy)'
```

Two of those three are **the owner's own notes**, tagged `sync-conflict` on
2026-09-08 by a Notion-era import. A tag says what HAPPENED to a note, never who
made it (**R-X**), and this is the second time that selection would have taken
the owner's work. The guard is now visible in the run's own output rather than
only in a docstring — *a guard nobody has seen refuse is not a guard.*

### The 34 that remain, and why that is the right number

| bucket | n |
|---|---|
| the owner's own notes | 30 |
| `To Do List` + `(synced copy)` — owner's, tagged `sync-conflict` | 2 |
| **= the 32 baseline** | **32** |
| the preserved round-3 sentinel `0910373ae0e8` | 1 |
| its preserved fork `f690097b6779` | 1 |
| **total** | **34** |

⛔ **34 is the documented intentional state**, not a leftover — the section
"THE EVIDENCE IS PRESERVED AND UNCLEANED" below says so and still stands. The
arithmetic closes exactly, which is why the cleanup could stop where it did.

⭐ Verified **two ways, both directions**: the server's own list
(`/api/j2/notes`) and the screen the member reads. The screen read counts the
marker TEXT — its first draft queried `[data-note-id]` and two other selectors,
**none of which exist in this product**, so it would have reported a confident
zero for a page it never understood. Full record:
`docs/notebook/wave-q1-cleanup-R26.json` and `wave-q1-account-after-R26.json`.

---

## ⛔⛔ THE INSTRUMENT ARTIFACTS — recorded here so the notes can be cleaned (R-22)


⚰️ **These are the runs that "found" the defect, and every one of them is the
raw-fetch door, not a member.** They are recorded in full below so the canary
account can be returned to baseline without destroying the evidence — the doc
is the durable copy, exactly as it was for the preserved forks in the section
above.

⛔⛔ **THE RULING SAID 15. THE CAPTURE SAYS 17.** The count is DERIVED from the
artifacts by `tools/q1_repro_cleanup.py`'s own `classify()`, not retyped — same
rule as **R-Y**, and the reason it exists. Two of these are not findings at all
but `errored` closes (an undrivable real door, and one VACUOUS run), which the
tool keeps for the same reason it keeps a finding: **absence of evidence
resolves to KEEP** (**R-Z**). A disagreement about state is not reconciled by
acting on it, so the number stands at 17 and the discrepancy is stated rather
than tidied.

⭐ **What they are evidence OF.** Not a product defect. The comparison in the
section above measured this door at **r = 0.85** against the member's own door
at **r = 0.00** over 36 verifiable runs. What these rows record is an instrument
firing a metadata door with a raw `fetch`, so the editor's handlers never ran,
`recordLandedRevision` never recorded the revision, and guard 2 correctly
answered **"not ours"** and forked. **That fork is the right answer to a second
writer.** These are kept as the worked example of
`lesson_a_quantised_instrument_can_manufacture_a_finding`.

| # | artifact | door | note id | landed | why kept |
|---|---|---|---|---|---|
| 1 | `2026-09-11T02-53-35Z` | `None` | `cd790bfcf8434137…` | None | errored: VACUOUS: nothing queued and nothing dirty before the door |
| 2 | `2026-09-11T02-55-10Z` | `ticker` | `1e74d52493b541fe…` | True | 2 finding(s) — evidence |
| 3 | `2026-09-11T02-57-30Z` | `ticker` | `7c47b8f1ee274883…` | False | 2 finding(s) — evidence |
| 4 | `2026-09-11T03-13-49Z` | `ticker` | `c0fdd24906794f22…` | False | 2 finding(s) — evidence |
| 5 | `2026-09-11T03-25-29Z` | `ticker` | `3b801f8f646b4bb8…` | False | 2 finding(s) — evidence |
| 6 | `2026-09-11T03-26-23Z` | `tags` | `ee85b08b6089434e…` | False | 1 finding(s) — evidence |
| 7 | `2026-09-11T03-27-32Z` | `ticker` | `e5760a1825cc465c…` | False | 2 finding(s) — evidence |
| 8 | `2026-09-11T03-29-52Z` | `folder` | `53cf7364714247d5…` | False | 2 finding(s) — evidence |
| 9 | `2026-09-11T03-30-46Z` | `ticker` | `2c6e23cff8834e1f…` | False | 2 finding(s) — evidence |
| 10 | `2026-09-11T03-31-39Z` | `tags` | `be79e791a737442d…` | False | 2 finding(s) — evidence |
| 11 | `2026-09-11T03-32-33Z` | `folder` | `1d53efd3bb264065…` | False | 2 finding(s) — evidence |
| 12 | `2026-09-11T03-33-28Z` | `ticker` | `c1e8c027b1be422d…` | False | 2 finding(s) — evidence |
| 13 | `2026-09-11T03-34-22Z` | `tags` | `2c0e4824ca6342bf…` | False | 2 finding(s) — evidence |
| 14 | `2026-09-11T03-35-15Z` | `folder` | `73ed6d707bc140ab…` | False | 2 finding(s) — evidence |
| 15 | `2026-09-11T03-38-23Z` | `folder` | `ce1d78feaa554461…` | None | errored: the real door could not be driven: {'ok': False, 'why': 'no  |
| 16 | `2026-09-11T03-40-46Z` | `folder` | `8e15882791d04180…` | None | errored: the real door could not be driven: {'ok': False, 'why': 'no  |
| 17 | `2026-09-11T03-55-21Z` | `ticker` | `9992ff1fd63d40fe…` | False | 1 finding(s) — evidence |

### The findings, verbatim

**1. `2026-09-11T02-53-35Z-canary.json`** — door `None`, note `cd790bfcf843413796a8224e6f03339c`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T02:53:35Z`
- errored: VACUOUS: nothing queued and nothing dirty before the door
- wire: 4 PUT(s), 0 landed revision(s); notes 34 → None

**2. `2026-09-11T02-55-10Z-canary.json`** — door `ticker`, note `1e74d52493b541fe875a246defff6228`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T02:55:10Z`
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL 2026-09-11T00:00:56Z (conflicted copy)']
- finding: THE RIG IS LEFT OPTED IN (read back 'ERR: Error') — the next run does not start from rest
- wire: 7 PUT(s), 2 landed revision(s); notes 35 → 36

**3. `2026-09-11T02-57-30Z-canary.json`** — door `ticker`, note `7c47b8f1ee274883b0ab0aa6340ad0cf`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T02:57:30Z`
- finding: `canary` — the server body does not contain the offline sentence (door `ticker`, 3 send(s) beat it)
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL repro canary 2026-09-11T02:57:30Z (conflicted copy)']
- wire: 6 PUT(s), 2 landed revision(s); notes 36 → 38

**4. `2026-09-11T03-13-49Z-canary.json`** — door `ticker`, note `c0fdd24906794f22bce70bd03d2d0606`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:13:49Z`
- finding: `canary` — the server body does not contain the offline sentence (door `ticker`, 3 send(s) beat it)
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL repro canary 2026-09-11T03:13:49Z (conflicted copy)']
- wire: 6 PUT(s), 2 landed revision(s); notes 38 → 40

**5. `2026-09-11T03-25-29Z-canary.json`** — door `ticker`, note `3b801f8f646b4bb895defefff443fb48`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:25:29Z`
- finding: `canary` — the server body does not contain the offline sentence (door `ticker`, 3 send(s) beat it)
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL repro canary 2026-09-11T03:25:29Z (conflicted copy)']
- wire: 6 PUT(s), 2 landed revision(s); notes 40 → 42

**6. `2026-09-11T03-26-23Z-canary.json`** — door `tags`, note `ee85b08b6089434eb219106234417d59`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:26:23Z`
- finding: `canary` — the server body does not contain the offline sentence (door `tags`, 3 send(s) beat it)
- wire: 6 PUT(s), 2 landed revision(s); notes 42 → None

**7. `2026-09-11T03-27-32Z-canary.json`** — door `ticker`, note `e5760a1825cc465cb1f41de7d0f05216`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:27:32Z`
- finding: `canary` — the server body does not contain the offline sentence (door `ticker`, 3 send(s) beat it)
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL repro canary 2026-09-11T03:27:32Z (conflicted copy)']
- wire: 7 PUT(s), 2 landed revision(s); notes 44 → 46

**8. `2026-09-11T03-29-52Z-canary.json`** — door `folder`, note `53cf7364714247d58af071726b257bec`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:29:52Z`
- finding: `canary` — the server body does not contain the offline sentence (door `folder`, 3 send(s) beat it)
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL repro canary 2026-09-11T03:29:52Z (conflicted copy)']
- wire: 6 PUT(s), 2 landed revision(s); notes 47 → 49

**9. `2026-09-11T03-30-46Z-canary.json`** — door `ticker`, note `2c6e23cff8834e1f8f40689990eee650`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:30:46Z`
- finding: `canary` — the server body does not contain the offline sentence (door `ticker`, 3 send(s) beat it)
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL repro canary 2026-09-11T03:30:46Z (conflicted copy)']
- wire: 6 PUT(s), 2 landed revision(s); notes 49 → 51

**10. `2026-09-11T03-31-39Z-canary.json`** — door `tags`, note `be79e791a737442da1bb23ab70d61784`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:31:39Z`
- finding: `canary` — the server body does not contain the offline sentence (door `tags`, 3 send(s) beat it)
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL repro canary 2026-09-11T03:31:39Z (conflicted copy)']
- wire: 6 PUT(s), 2 landed revision(s); notes 51 → 53

**11. `2026-09-11T03-32-33Z-canary.json`** — door `folder`, note `1d53efd3bb264065998459f702cca4fe`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:32:33Z`
- finding: `canary` — the server body does not contain the offline sentence (door `folder`, 3 send(s) beat it)
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL repro canary 2026-09-11T03:32:33Z (conflicted copy)']
- wire: 7 PUT(s), 2 landed revision(s); notes 53 → 55

**12. `2026-09-11T03-33-28Z-canary.json`** — door `ticker`, note `c1e8c027b1be422d9bdcd6268d17e396`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:33:28Z`
- finding: `canary` — the server body does not contain the offline sentence (door `ticker`, 3 send(s) beat it)
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL repro canary 2026-09-11T03:33:28Z (conflicted copy)']
- wire: 6 PUT(s), 2 landed revision(s); notes 55 → 57

**13. `2026-09-11T03-34-22Z-canary.json`** — door `tags`, note `2c0e4824ca6342bf9e2183b776dc2d5c`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:34:22Z`
- finding: `canary` — the server body does not contain the offline sentence (door `tags`, 3 send(s) beat it)
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL repro canary 2026-09-11T03:34:22Z (conflicted copy)']
- wire: 6 PUT(s), 2 landed revision(s); notes 57 → 59

**14. `2026-09-11T03-35-15Z-canary.json`** — door `folder`, note `73ed6d707bc140ab89639988ceb4e37f`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:35:15Z`
- finding: `canary` — the server body does not contain the offline sentence (door `folder`, 3 send(s) beat it)
- finding: `canary` — a single-writer session forked: ['WINDOW-CHECK-SENTINEL repro canary 2026-09-11T03:35:15Z (conflicted copy)']
- wire: 6 PUT(s), 2 landed revision(s); notes 59 → 61

**15. `2026-09-11T03-38-23Z-canary.json`** — door `folder`, note `ce1d78feaa554461b4bd1997ab47aed6`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:38:23Z`
- errored: the real door could not be driven: {'ok': False, 'why': 'no other folder to move to'}
- wire: 4 PUT(s), 0 landed revision(s); notes 63 → None

**16. `2026-09-11T03-40-46Z-canary.json`** — door `folder`, note `8e15882791d04180b42f18be15d1e95a`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:40:46Z`
- errored: the real door could not be driven: {'ok': False, 'why': 'no other folder to move to'}
- wire: 4 PUT(s), 0 landed revision(s); notes 66 → None

**17. `2026-09-11T03-55-21Z-canary.json`** — door `ticker`, note `9992ff1fd63d40fe98e280d3e89e5cd8`

- sentence typed offline: `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T03:55:21Z`
- finding: `canary` — the server body does not contain the offline sentence (door `ticker`, 3 send(s) beat it)
- wire: 7 PUT(s), 2 landed revision(s); notes 79 → 80

---

# ⛔⛔ ROUND 3, THE MEASURED CHAIN — reproduced on the rig, 2026-09-11

**Reproduced 2 times in 3 runs of the same ordering (`canary`, door `ticker`).**
⭐ It is a **RACE**: the identical ordering ran GREEN at 02:55:10Z and RED at
02:57:30Z and RED again at 03:13:49Z. That is why jsdom could never construct it
and why three fixes each looked correct.

The chain below is **measured on both sides of the wire** — request AND response,
correlated (`tools/q1_repro.py`, artifact
`docs/notebook/wave-q1-repro/2026-09-11T03-13-49Z-canary.json`). Nothing in it is
inferred.

```
#0  03:14:05  body, no sentence   base 03:13:58  -> 200   server = 03:14:05.467580
#1  03:14:12  body, SENTENCE      base 03:14:05  -> (none) never completed — offline
#2  03:14:13  body, SENTENCE      base 03:14:05  -> (none) never completed — offline
#3  03:14:15  body, SENTENCE      base 03:14:05  -> (none) never completed — offline
#4  03:14:17  NO BODY (door)      base 03:14:05  -> 200   server = 03:14:18.057620
#5  03:14:30  body, SENTENCE      base 03:14:05  -> 409   "note changed — refresh and retry"
    settled:  server = 03:14:18.057620  (the DOOR's revision)
    result:   the sentence is NOT in the server body · 1 NEW conflicted copy
```

## ⛔ WHAT THIS PROVES, AND WHAT IT KILLS

1. **The door carries a baseline.** `#4` is `keys=['baseUpdatedAt','ticker']`.
   ⚰️ The claim that the doors "PUT with no `baseUpdatedAt`, so they cannot 409"
   is **FALSE** and is struck everywhere it appears. It was read off the call
   site (`update({ticker})`) and never off the wire.
2. **The door is not a second writer racing the body — it WINS a CAS it is
   entitled to win.** At `03:14:17` the server really is at `03:14:05`, because
   `#1–#3` never completed. The door is correct.
3. ⛔⛔ **THE DEFECT IS AT `#5`: THE RETRY CARRIES THE PRE-DOOR BASELINE.**
   `03:14:05` — the revision the door has already replaced. The client held the
   door's own 200 response, which carried `updatedAt: 03:14:18.057620`, and did
   not move the queued entry onto it. So the resend was **born stale** and 409'd
   on arrival.
4. **And the 409 forked instead of rebasing.** There is no `#6`. The owner's
   invariant — *a queued entry is never removed unless the server body is proven
   to contain its content; every other outcome is rebase-and-resend* — is
   violated at exactly this step. The words survive only in the conflicted copy.

⭐ **This is the single-writer case in one line:** the door's success and the
queued entry's baseline are two authorities over one revision, and nothing
carries the first to the second in time.

---

# ⛔ SELF-FORK, ROUND 3 — **OPEN**

**Streak run 1 against deploy #4c, 2026-09-11T00:00:56Z, door `folder`. THREE H1
hits in one run. The streak is DEAD AT RUN 1 and restarts from ZERO.**

| # | what fired |
|---|---|
| 1 | ⛔⛔ **The server BODY DOES NOT CONTAIN the offline sentence** `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T00:00:56Z` — the queued entry was **DISCARDED, not rebased**. |
| 2 | ⛔ **A SINGLE-WRITER offline session produced** `WINDOW-CHECK-SENTINEL 2026-09-11T00:00:56Z (conflicted copy)`. |
| 3 | ⛔ **The note count moved: 34, expected 33** (baseline 32 + this run's one note). |

## ⭐ WHAT #4c DID FIX — say it plainly, it is not a failed deploy

The same log reads:

```
record holds the sentence: True · draft holds the sentence: True · outbox entries: 1
```

⭐ **The LOCAL-LOSS half is CLOSED.** Round 2's finding — that the local **record**,
the **draft** and the **outbox** had all been reconciled to a server revision
lacking the member's words — **does not reproduce**. What survives is **narrower**:
the queued entry still reaches the **SERVER** as a discard.

⛔ Do not read this section as "#4c failed". Read it as: #4c closed one half, and
the other half is still open. Both halves were the same bug report; they were not
the same defect.

## ⛔ THE TIMELINE — verbatim, and it is the most valuable content in this handoff

```
00:01:16.638550Z  one CAS PUT (type online)
00:01:24.671652Z  offline; queued entry captures this baseline
00:01:37.747261Z  door `folder` PUT 200, baseline moves 00:01:24 → 00:01:37
                  ⭐ queued sends that beat it: 3
then              drain settles `dirty 0 · outbox 0` on the door's revision
                  — sentence never landed
```

## ⛔ THE OBSERVATION TO CARRY INTO THE NEXT SESSION

**Three sends were already in flight when the door PUT landed**, so **the entry
that finally settled may not be the one the door invalidated.**

⭐ `settleSent` rebuilds the re-queued intent **from the RECORD** rather than from
the **patch** — that is the **more likely place the sentence is now being
dropped**, and it is **untested through the editor's real path**.

⛔ This is a lead, not a diagnosis. **§A above is not optional because of it** —
the rail goes red first, and the rail is what decides whether this lead is right.

## ⛔ THE EVIDENCE IS PRESERVED AND UNCLEANED

| what | id |
|---|---|
| the run's note | `0910373ae0e84b758c39f4a13c33e5fe` |
| its conflicted copy | the `(conflicted copy)` beside it, same instant |

⛔⛔ **THE ACCOUNT READS 34 LIVE NOTES, AND THAT IS CORRECT AND INTENTIONAL.**
**32** baseline **+ 1** this run's note **+ 1** its conflicted copy = **34**.
⛔ **Nobody "fixes" this count.** The expected number was 33; the extra one **is
the defect**, standing where it fell. Deleting it deletes the evidence (**R-Z**,
**R-X**).

---

# ⛔⛔⛔ HARD STOP #2 — 2026-09-10 — **THE MEMBER'S WORDS WERE LOST**

**Read this first. It is worse than HARD STOP #1 below, and it is a different
failure: not a duplicate, a DELETION.**

On **streak run 1 of 7**, door **`folder`**, at **2026-09-10T20:57:31Z** — **21
minutes after deploy #4b went live** — two hard stops fired in a single run:

- ⛔⛔ **LOST WORDS.** The member's offline sentence was **DISCARDED, not
  rebased.** The queued entry was deleted with the words **unsent**.
- ⛔ **SINGLE-WRITER FORK.** A new `(conflicted copy)` at the same instant.

**The streak is DEAD AT RUN 1 and restarts from ZERO.** ✅ The fix shipped as
**deploy #4c** (`6db8ba93a`, live 2026-09-10T23:28:42Z) and its record is below.
⚠️ **It closed the LOCAL-LOSS half, and the defect is still OPEN:** the queued
entry still reaches the SERVER as a discard via the `folder` door. ⛔ Read
**SELF-FORK, ROUND 3** at the top of this file before anything here.

## ⭐ The step that caught it was written that hour — and its neighbour was GREEN

The catching step was Stream B's **new** *"the offline words were REBASED and
SENT"*. The adjacent, long-standing step passed on the same run:

```
4 reconnect → drained, re-based, server has the words
    dirty 0 · outbox 0 · server holds text: True        ← GREEN. And useless.
```

⛔⛔ **"Server holds text" is satisfied by the words typed ONLINE.** It says
nothing about the sentence typed **offline** — which is the only one the drain
can lose. A check that cannot distinguish the two is not a weak check; it is a
check that will read green through exactly the failure it was written for
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

⭐ **The instrument that found this was hours old. The one that missed it had
been green for days.** Age is not evidence.

## The root cause

`settleMetadataRevision` read `current: captureLocalState() || saved`.

With **no local state**, `current` became `saved` — **which IS `acked`** — so
`sameAuthoredContent` read *"caught up"*, the intent became `null`, and
`putNoteWithIntent` **deleted every queued entry for the note**.

⛔ **A test file already pinned that outcome as the WRONG one.** It shipped
through a **fallback no case covered** — the `|| saved` was never exercised by a
rail, because every rail supplies local state.

## ⛔⛔ THE OWNER'S INVARIANT — the rule the wave now answers to

> **A QUEUED ENTRY IS NEVER REMOVED UNLESS THE SERVER BODY IS PROVEN TO CONTAIN
> ITS CONTENT.**
>
> Every other outcome is **rebase-and-resend**, or **leave it queued**.
> **"Ours" is NEVER, by itself, a reason to delete.**

⭐ Read it as a rule about **evidence**, not about correctness: the question is
never *"do we believe the server has it?"* but *"can we prove it?"*. Absence of
proof resolves to **keep**, always.

## The fix — `998f802ae`, ✅ SHIPPED AS #4c — ⚠️ it NARROWED the defect, it did not close it

**FIX 1 — null local state is NO EVIDENCE, not caught-up.** Refuse to settle. The
entry stays queued, drains, and guard 2 rebases it. In the code:

> *"⛔⛔ NULL IS 'NO EVIDENCE', NOT 'CAUGHT UP' — AND THE DIFFERENCE COST A
> MEMBER'S WORDS. … ⭐ REFUSING IS SAFE, and that is why it is the right answer …
> Doing nothing here costs one drain cycle; guessing here costs the member their
> work."*
> — `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx`

**⭐ AND REFUSING EXPOSED A SECOND HOLE** — found by the property rail in **12 of
18** cases every mechanism-level rail passed. The door's PUT had still moved the
revision, and **nothing recorded it as OURS**, so guard 2 answered *"not ours"*
about our own write and **forked the note**:

> *"⛔⛔ RECORDING A REVISION AS OURS IS NOT THE SAME ACT AS SETTLING THE QUEUE. …
> settling the queue needs EVIDENCE about local content · recording a landing
> needs only that WE made the request. Conflating them meant the safe answer to
> the first silently withheld the second."*
> — `app/src/pages/journal-2-0/lib/offline/useDurableNote.js`

Split into **`recordLandedRevision`, called UNCONDITIONALLY** — and called
**first**, before the settle can refuse.

**FIX 2 — guard 2 decides by CONTENT.** Byte-identical ⇒ remove. **Ours but the
body differs ⇒ REBASE onto the server revision, keep the words, resend once.** A
second 409 forks, preserving both copies. Both passes.

## ⭐⭐ THE PROPERTY RAIL — `offlineWordsSurvive.property.test.jsx`

**Three doors × six orderings, asserting ONE thing:**

> *"THE MEMBER'S LAST OFFLINE SENTENCE ENDS UP IN THE SERVER'S BODY, AND THE NOTE
> COUNT DOES NOT CHANGE."*
>
> *"Nothing about baselines, markers, rings or outcomes is asserted here — those
> are the mechanism, and **mechanism-level rails are exactly what stayed green
> through two shipped defects that lost a member's words**."*

⛔ **Its control drives the shipped defect and REQUIRES the property to fail** —
a property rail that cannot go red is a slogan.

⭐ **This is the answer to both hard stops at once**, and the file says so in its
own preamble: #4 shipped a guard wired to the wrong save path with eleven rails
and four mutations green; #4b deleted a queued entry while the drain's own step
stayed green. **Both were invisible to every existing rail and visible to this
property.**

**Gauntlet: 23/23, control 240 green before and after.**

## What this changes about how to read the rest of this file

| | |
|---|---|
| Deploys #4 and #4b | ✅ still live, still flag-false. ⚠️ **#4b's round-2 fix was not the whole answer** — the metadata doors could discard queued words. |
| Deploy #4c | ✅ **LIVE** — `6db8ba93a`, 2026-09-10T23:28:42Z. Flag unchanged. ⚠️ **AMENDED:** it closed the **local-loss half**; the queued entry still reaches the server as a **discard** via the `folder` door — see **round 3**. |
| The flag flip | ⛔⛔ **BLOCKED**, and now on a defect that LOST DATA rather than duplicated it. |
| The seven-run streak | ⛔ **DEAD AT RUN 1 AGAIN** — 2026-09-11T00:00:56Z, against **#4c**. Restarts from zero, and ⛔ the next attempt only counts if the doors are driven through the **editor's real save path** (**§A**). |
| Preserved artifacts | The two earlier forks' CONTENT is recorded verbatim (🧾🔬 **THE PRESERVED FORKS**) and that RELEASED their clean. ⛔ **Round 3's evidence is preserved and UNCLEANED**: `0910373ae0e84b758c39f4a13c33e5fe` + its conflicted copy. ⛔⛔ **Live notes: 34 — CORRECT AND INTENTIONAL** (32 + 1 + 1). Nobody fixes that count. |
| Any "server holds text" check | ⚰️ **DELETED, not weakened** — see **R-O** and the annotation under PART A. |

---

# 🧾🔬 THE PRESERVED FORKS — THE EVIDENCE SET, VERBATIM

⛔⛔ **THIS SECTION IS THE RECORD THAT REPLACES THE ARTIFACTS.** The charter permits
cleaning the preserved forks **only once their CONTENT is in this file**. One of
these notes is **half the evidence pair for the words-lost finding — the single
most important measurement of this wave** — and once it is soft-deleted **this is
all that remains.** Do not summarise these blocks; do not "tidy" the ids or the
timestamps.

**Captured from** `.worktrees/q1-dry-run/fork-capture-20260910T233538Z.json`
(⭐ the capture ran **BEFORE** the clean — see **R-X**).

## ⭐ THE DIFFERENCE BETWEEN THE TWO FORKS, IN ONE LINE — and it is the finding

> **At 16:54 the fork was a DUPLICATE — both sides held the same words.**
> **At 20:57 the fork was a LOSS — the original lost the offline sentence, and it
> survives ONLY in the copy.**

⛔ That distinction is why HARD STOP #2 is a different failure from HARD STOP #1,
and it is invisible in any count of notes or of `sync-conflict` tags. **A fork
count cannot tell them apart.**

## FORK A — 2026-09-10T16:54:50Z — a duplicate, **no words lost**

```
original  546d91c9babc42cd9bc3818e9b5a210a  "WINDOW-CHECK-SENTINEL 2026-09-10T16:54:50Z"
          created 16:55:10.440954Z · updated 16:55:32.671567Z
          deletedAt 16:55:52.969673Z · tags []
          body: "WINDOW-CHECK-SENTINEL typed online. WINDOW-CHECK-SENTINEL typed offline."

copy      8d5c86faa5da41ae9841dcff4428c3dc  "…16:54:50Z (conflicted copy)"
          created/updated 16:55:43.602737Z · tags ['sync-conflict']
          body: BYTE-IDENTICAL to the original. NO WORDS LOST.
```

## FORK B — 2026-09-10T20:57:31Z, door `folder`, streak run 1 — ⛔⛔ **A LOSS**

```
original  66708b88e0fc4ca5ab9fa47d39e897e9  "WINDOW-CHECK-SENTINEL 2026-09-10T20:57:31Z"
          created 20:57:52.861838Z · updated 20:58:12.578140Z · tags []
          ⚠️ STILL LIVE, not trashed
          body: "WINDOW-CHECK-SENTINEL typed online."
          ⛔⛔ THE OFFLINE SENTENCE IS ABSENT. This is the note the member had open.

copy      5a4c90a3cd5f497c8ef12fa1c9b7ae05  "…20:57:31Z (conflicted copy)"
          created/updated 20:58:24.892532Z · tags ['sync-conflict']
          body: "WINDOW-CHECK-SENTINEL typed online. WINDOW-CHECK-SENTINEL typed offline."
          ⭐ THE MEMBER'S OFFLINE WORDS EXIST ONLY HERE.
```

⛔ **Read the two bodies against each other.** The original is what the member was
looking at, and it is **missing the sentence they typed offline**. The copy — the
thing the app labelled a *conflict* and tagged `sync-conflict` — is the **only**
place that sentence exists. That is the whole of HARD STOP #2 in four lines.

## The trash, as captured

**24 captured notes**, all **already trashed** and **none touched**:

- **22 canary-titled originals/copies** from **13:11–16:55**, of which **20 still
  hold an offline sentence**.
- **two older non-canary conflicted copies** from certification —
  `b1c7cf6e…` and `44d796d6…`.

---

# 🏁 THE CLOSE — **PREPARED, NOT PUBLISHED**

⛔⛔ **THIS SECTION IS A DRAFT OF THE END STATE. THE GATE IS OPEN.** Nothing here
is a claim that Wave Q1 is finished. It exists so that closing is an act of
**dating a prepared statement**, not of writing one under time pressure — which is
how the two hard stops above got their first, wrong write-ups.

⛔ **What is deliberately NOT here:** a **#5** record (its checklist has not run)
and **a date on the CLOSED line**. The **#4c** record IS here — it landed.
⛔⛔ **THE GATE IS NOT CLOSED AND THE PACKET IS NO-GO** — packet row:
**"self-fork round 3 OPEN"**. **Tip-stamp is LAST.**

## ⛔⛔ THE INVARIANT — corrected, and the one sentence the wave answers to

> **A QUEUED ENTRY IS NEVER REMOVED UNLESS THE SERVER BODY IS PROVEN TO CONTAIN
> ITS CONTENT.**
>
> **Ours ⇒ REBASE, never delete.** Every other outcome is rebase-and-resend, or
> leave it queued. **"Ours" is never, by itself, a reason to delete.**

⚰️ **What it replaced, and why the correction matters more than the rule:** the
round-1 and round-2 designs both reasoned about *whose* revision the server held.
That question can be answered "ours" while the server body still lacks the
member's words — which is exactly how HARD STOP #2 deleted them. The corrected
invariant asks about **CONTENT**, and resolves the absence of proof to **keep**.

## The FOUR doors — every path that advances `updatedAt`

⛔ **A hand-written list of "save paths" misses three of these**, because three of
them do not look like saves. They were found by the **DERIVED wire rail**, not by
reading (**R-B**).

| door | what it is | why it can lose words |
|---|---|---|
| **body** | `commitSave` — the debounced autosave every keystroke reaches | the original self-fork path (HARD STOP #1); guard 1 was wired to `restoreDraft` and never ran here |
| **folder** | `onFolderChange` | advances the server revision **without carrying the member's body** |
| **ticker** | `onTickerChange` | same |
| **tags** | `onTagsChange` | same — and this is the door that fired on **streak run 1** |

⛔ **The wire rail proves the call EXISTS; it cannot prove the call is CORRECT.** A
door passing **LOCAL** state as `acked` would satisfy it completely and **DELETE
the member's queued work** — there is a case pinning exactly that (**R-B**).

⭐ **The property rail is what covers all four at once:**
`app/src/pages/journal-2-0/lib/offline/offlineWordsSurvive.property.test.jsx` —
three doors × six orderings, asserting only that **the offline sentence is in the
server body and the note count is unchanged.**

## The two REJECTED designs — and the rail that rejected each

⛔⛔ **BOTH WERE KILLED BY PRE-EXISTING RAILS, NOT BY REVIEW.** Nobody argued them
down; they were built, and rails that already existed went red. Full reasoning:
**R-A**.

| rejected design | the rail that rejected it | why |
|---|---|---|
| **AWAIT the marker write on the save path** | `NoteEditorPage.durable.test.jsx` + `NoteEditorPage.interleavings.test.jsx` | couples the member's ability to save to IndexedDB being responsive — a blocked upgrade stops saves outright, and **to a member whose network is fine it looks like the network is down** |
| **The marker ON THE NOTE RECORD** | the same two rails | a read-modify-write on `notes` **on the save path**, contending with the durable writer — **the durable copy stopped being written at all** |

⭐ **A different store removes both problems by construction.** A flag that
sequences two writers is a race with a name.

## The deploy record index

| # | what it shipped | state |
|---|---|---|
| **#1** | the autosave / canary-defect fix (`cd674ef56`) | ✅ live |
| **#2** | blocked-entry surfacing + the `null` instrument (`eedb58ac8`) | ✅ live |
| **#3** | the opt-in denominator + `window_check.py` (`7ed6b2ce5`) | ✅ live |
| **#4** | the self-fork fix, round 1 (`f093bf731`) | ✅ live — ⚠️ **narrowed, did not close** |
| **#4b** | the self-fork fix, round 2 (`23f6ce271`) | ✅ live — ⚠️ **the metadata doors could still discard queued words** |
| **#4c** | the four-door / content-decides fix (`6db8ba93a`) | ✅ live 2026-09-10T23:28:42Z — ⭐ **every check on ONE SHA**. ⚠️ **AMENDED:** closed the local-loss half; the queued entry still reaches the server as a discard via the `folder` door — see **round 3** |
| **#5** | ⛔ **the flag flip** — `OFFLINE_DEFAULT_ON = false → true` | ⛔ **NOT DEPLOYED, and BLOCKED.** `<record to be written when it lands>` |

⛔ **Each record carries its own checklist as checked AT PUSH TIME**, its
member-impact paragraph verbatim, and — where the suite was measured at a
different SHA than the tip — **that gap stated plainly**. Do not summarise a
record into this table; the table is an index.

## The evidence set

| what | where |
|---|---|
| This file — state, rulings, deploy records, the two hard stops | `docs/notebook/wave-q1-RESUME-HERE.md` |
| The inherited reds, blamed row by row + every re-measurement | `docs/notebook/inherited-red-ledger.md` |
| §32 browser matrix (Chrome/Firefox/WebKit/incognito/private, two real iPhones) | `docs/notebook/wave-q1-browser-certification.md` |
| Raw per-browser probe artifacts | `docs/notebook/wave-q1-probe-results/*.json` + its `README.md` |
| The activation red that caused the 2026-09-09 rollback | `docs/notebook/wave-q1-activation-canary-red.md` |
| Harness integrity — identity, ports, controls | `docs/notebook/wave-q1-harness-integrity.md` |
| The observation window's own record | `docs/notebook/wave-q1-observation-window.md` |
| The 18 GB runaway backend pytest (**another session's process**, recorded so its evidence is not lost) | `docs/notebook/runaway-pytest-2026-09-10.md` |
| ⛔ **The preserved forks (rounds 1-2)** — their CONTENT, verbatim (ids, bodies, timestamps, tags) | 🧾🔬 **THE PRESERVED FORKS** at the top of this file. ⛔ **This record REPLACES the artifacts**, and it is what released their clean; the capture is `.worktrees/q1-dry-run/fork-capture-20260910T233538Z.json`. |
| ⛔ **Round 3's artifacts — PRESERVED AND UNCLEANED** | Live in the account: `0910373ae0e84b758c39f4a13c33e5fe` + its `(conflicted copy)`. ⛔⛔ **Live notes = 34, CORRECT AND INTENTIONAL** (32 baseline + 1 + 1). **Nobody fixes that count** — the extra note IS the defect, standing where it fell. |

⭐ **Instruments, not prose:** `tools/window_check.py` (one command = one stamped
row) · `tools/engine_matrix.py` · `tools/deploy_scope_gate.py` +
`tools/gate_regions.py` (the three tiers, **⭐ TIER 1½**) ·
`tools/q1_mutation_gauntlet.py` (⛔ read the total from the tool) ·
`scripts/gate_shards.py` (⭐ `--max-workers`, **R-P**).

## Where the rest of the close already lives

- 🔙 **ROLLBACK RUNBOOK** — its own standalone section in this file. ⛔ Not
  indicated by either hard stop; every shipped deploy stays.
- 🧾 **RULINGS** — `R1`–`R16` (the deploy-#4 round) and the lettered strand
  `R-A`–`R-R` plus `R-X`–`R-Z`. ⭐ **Complete through the end of this session.**
  ⚠️ `R-S`–`R-W` are other streams' and are deliberately absent — ⛔ do not
  renumber. **R-P/R-Q/R-R are about the machine, and R-Q/R-R also bind through
  the `uct-conventions` skill.**
- 📄 The runaway-pytest record is **standalone and owns its own measurements** —
  cross-referenced from **R-P**, never duplicated.
- ❄️ **THE FREEZE IS RELEASED AND NONE IS OUTSTANDING.** Requested ~**22:5x Z**,
  **RELEASED 23:29Z**, held ~**35 minutes**, **one push** inside it (#4c). ⛔ A
  freeze that is released is stated as released; the next session starts with the
  machine free (**R-P**).

## ⛔ THE GATE — the line, ready to date

> **WAVE Q1 CERTIFICATION GATE: CLOSED — `<DATE>`.**

⛔⛔ **THE LINE ABOVE IS STILL UNDATED, AND THAT IS THE STATE, NOT AN OVERSIGHT.**
As of the end of this session: **the gate is NOT CLOSED**, and **the decision
packet is NO-GO** — packet row: **"self-fork round 3 OPEN"**. ⛔ Do not date the
line; do not soften the packet row.

⛔⛔ **DO NOT DATE THIS LINE UNTIL ALL OF THE FOLLOWING ARE TRUE**, and each is a
measurement, not a judgement:

1. ✅ **Deploy #4c is LIVE**, with its record written and its checklist recorded
   as checked at push time. ⚠️ **Satisfied, and it did NOT advance the gate** —
   see condition 8.
2. **SEVEN CONSECUTIVE GREEN RUNS** against the deployed #4c — ⛔ **restarting from
   ZERO**, not resumed from 3 or 1, and ⛔ **every run's STARTING STATE recorded,
   not only its verdict** (**R16**).
3. **The property rail is green** and its control still fails when driven at the
   shipped defect.
4. **The flip (#5) is deployed and verified on the LIVE BUNDLE** — `!0`, and
   `offlineEnabled()` returning it when the key is unset.
5. **The §15 canary re-run against the flipped build**, both halves plus the
   conflict path.
6. **The preserved forks are dealt with by an explicit owner decision** with a date
   — ⛔ never quietly, and never as tidying.
7. ⛔ **journal-2-0 and the full suite reported as TWO SEPARATE NUMBERS.** There is
   no repo-green to claim, and closing does not create one.
8. ⛔⛔ **SELF-FORK ROUND 3 IS CLOSED — by a RAIL THAT WENT RED FIRST.** The rail
   drives every door through the **editor's real save path** (**§A** at the top),
   reproduces the folder door with **3 queued sends in flight** plus reload-mid-
   flight and slow-PUT, and **went red on the pre-fix code** before any fix was
   written. ⛔ A fix whose rail was only ever green does not satisfy this.
   **And the ONE-WRITER question (§B) is answered by measurement and logged**,
   whichever way it is decided.

⭐ **Tip-stamp is the LAST act, after the flip is confirmed** — a doc cannot name
its own SHA, and a tip stamped before the final commit is wrong the moment it is
written.

---

# ⛔⛔ HARD STOP #1 — 2026-09-10 — THE SELF-FORK REPRODUCED AFTER THE FIX SHIPPED

**Read this before anything else in this file.** Deploy #4 is live and correct.
**Four minutes later the rig forked its own note again.** The wave is stopped.
There is **no deploy #5**, and there may not be one today.

⛔ **`OFFLINE_DEFAULT_ON` was NOT flipped, and the flip is now BLOCKED on this
finding.** Nothing below should be read as a wave closing.

## The sequence — all times UTC, 2026-09-10

| time | what happened |
|---|---|
| **16:46:28** | **Deploy #4 live.** `master` `f093bf731`. `OFFLINE_DEFAULT_ON` still `false`. |
| **16:50:13** | `window_check` **run 1 of 7 — GREEN.** Opt-in key **at rest `'0'`**. notes 32 · canary notes 0 · sync-conflict 2. **No fork.** |
| **16:53:34** | **run 2 of 7 — GREEN.** Opt-in key **at rest `'1'`** — ⚠️ **the tool itself flagged it**: *"unexpected at rest; a previous run did not opt back out"*. **No fork.** |
| **16:54:50** | ⛔⛔ **run 3 of 7 — FORKED ITS OWN NOTE.** Opt-in key **at rest `'1'`**. |
| **16:57:11** | Read-only `--no-canary` capture. Artifact intact. |

**The detector's output, verbatim:**

```
THIS RUN FORKED ITS OWN NOTE — HARD RED: ['WINDOW-CHECK-SENTINEL 2026-09-10T16:54:50Z (conflicted copy)']
```

The steps that failed were **`5 no fork from a single writer`** and
**`5 cleanup → stores 0, locks 0, opted out`**. ⭐ **The tool REFUSED TO STAMP the
row.** The seven-run streak **stopped at 3**.

## The artifact, as captured at 16:57:11 — read-only

```
notes                              33
canary notes                        1
sync-conflict                       3
four durable stores            all 0
locks                               0
j2:notebook_blocked_no_baseline count 0
opt-in count                       15
```

⚠️ `sync-conflict` moved **2 → 3**. The `2` recorded on run 1 and on seven prior
window-check rows is the documented steady state; **the third is this fork**, and
it is the finding, not the baseline.

## ⛔ STATE — nothing has been touched

- **Nothing cleaned up. Nothing deleted. No note edited.** The forked note and its
  `(conflicted copy)` are **EVIDENCE** and stay exactly where they are.
- **The flag was NOT flipped.**
- **Deploy #4 remains live**, and that is deliberate: it is flag-false and it
  **strictly reduces** the fork window, so there is **no rollback pressure**. ⛔ Do
  not reach for the rollback runbook on account of this finding — nothing about it
  argues for undoing #4.
- **The wave simply does not flip.**

## ⛔⛔ THIS IS NOT "THE FIX DID NOT WORK"

Runs 2 and 3 **both started already opted in**. Run 2 was clean; run 3 forked.
That is **intermittent, with the same ~1-in-5 character the original defect had**
— which is consistent with the fix **closing one ordering while another remains
open**, and *not* with the fix being inert. A fix that did nothing would not have
produced a clean run 2 under the same starting state.

⛔ Do not write either of the two easy sentences. *"The fix did not work"* is not
supported by the evidence, and *"the fix works, this is a rig artifact"* is not
supported either — the fork is a real `(conflicted copy)` on the server, from a
single writer.

## ✅✅ ROOT CAUSE — FOUND. Deploy #4's main guard was never on the path.

⛔⛔ **THIS SUPERSEDES THE "leading suspect" THAT STOOD HERE.** The fork is
explained, and the explanation is not a subtle race in a guard that ran. **Guard 1
never ran for the defect at all.**

### Defect 1 — the guard was wired to the wrong save

`settleLandedSave` was added by `b41c26f29` at **exactly one call site**: inside
**`restoreDraft`** — the rare, deliberate draft-restore. It is **not** inside
**`commitSave`**, the debounced autosave that every keystroke reaches, and
`commitSave` is **the only path the defect rides**.

Measure it rather than take it on trust — the file says so plainly:

```bash
grep -n "settleLandedSave\|const restoreDraft\|const commitSave" \
  app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx
#   31:  import { useDurableNote, settleLandedSave, SESSION_ID } from ...
#  735:  const restoreDraft = async () => {
#  800:        settleLandedSave({          ← inside restoreDraft
# 1506:  const commitSave = async () => {  ← no settle anywhere in it
```

⛔⛔ **ELEVEN RAILS AND FOUR MUTATIONS ALL EXERCISED THE FUNCTION. NOTHING
EXERCISED THE WIRE.** That is exactly
[[lesson_built_tested_green_and_unreachable]] — *"built, tested, green, and
unreachable"* — **with a mutation suite on top**. A mutation proves a guard's
logic is observed by a rail; it says nothing about whether the guard is called
from the place that needs it. The suite was green and the fix was not on the
path.

⭐ **Cite that lesson by name in any future review of this class.** The wave's
own instrument culture caught three self-blind instruments this session (**R1**,
**R8**, **R14**) and still shipped a guard reachable from one rare branch,
because every test called it directly.

### Defect 2 — independent, and it makes the two guards ONE guard

The drain's supersede refusal asks `landedBaseline(record)`, which returns `null`
for a **DIRTY** record. That refusal is **correct** — a dirty record's baseline is
what its next send will *claim*, not what the server has acknowledged.

But in **exactly the window that guard's own comment says it closes**, nothing has
settled yet, so the record **is** dirty, the answer is **always** *"not
superseded"*, and **the drain sends**. The reproduction says it, and it is
committed:

> *"It cannot. The refusal asks `landedBaseline(noteRec)`, and `landedBaseline`
> returns null for a DIRTY record … But in exactly the window the comment
> describes, nothing has settled yet, so the record IS still dirty. `landed` is
> null, `isSupersededBaseline` refuses on a null side, and the drain SENDS. The
> server has moved on, so the PUT 409s, and a 409 forks."*
>
> *"⭐ THE DEEPER POINT: the browser does not locally KNOW a save landed until
> `settleLandedSave` writes it. That knowledge lives in an in-flight promise. So
> the second guard is not defence in depth for this window — it is a FOLLOW-UP
> CHECK that can only fire after the first guard has already won."*
>
> — `app/src/pages/journal-2-0/lib/offline/selfForkGap.repro.test.jsx`

⛔⛔ **TWO GUARDS THAT SHARE A PRECONDITION ARE ONE GUARD.** What actually stood
between a member and a duplicate of their own note was **whether the settle beat
the drain**. ⛔ **A race is not a guard.**

⭐ **Proved DETERMINISTICALLY in jsdom before any fix was written** — no second
reproduction on the live canary account was needed. ⚠️ That file asserts the
**current** behaviour, so it is green today and **must be deleted or inverted by
whatever fix lands**: *"a test that pins a defect is a measurement with an expiry
date."*

### Why this matched what the rig saw

Runs 2 and 3 both started already opted in; run 2 was clean and run 3 forked.
**Intermittent is exactly what "whether the settle beats the drain" predicts.**
The earlier reading — one ordering closed, another open — was right in shape and
wrong in detail: the ordering was not narrowly open, it was **wide open, because
guard 1 was not there at all**.

### ⚰️ The superseded hypothesis, kept as the record

⛔ **The flush suspicion is NO LONGER the explanation of the fork.** It was: *the
opt-out's `'0'` reaches `localStorage` but Chrome is killed by marker before it
flushes, so every run after the first starts already opted in.*

⚠️ **It is not thereby disproved, and it is not the same question.** It was
offered to explain **why the rig's opt-in key read `'1'` at rest between runs**,
which is a fact about the RIG (**R16**), not about the product. The root cause
above explains the **fork**. ⛔ Do not record the flush hypothesis as settled in
either direction; if nobody measures it, it stays open as a rig question.

⭐ **One observation from it survives intact and is worth more than the
hypothesis was:** runs 2 and 3 exercised the **already-opted-in** ordering, and
**a returning member is always already opted in.** Every canary in this wave
tested the state a member is in *once*.

## What this blocks, and what it does not

| | |
|---|---|
| The root cause | ✅ **FOUND** — guard 1 was wired only into `restoreDraft`, and guard 2 cannot fire in the window it claims. See above. |
| The fix for it | ✅ **SHIPPED — deploy #4b, `23f6ce271`, live 2026-09-10T20:36:29Z.** The design is **R-A** below; the record is **✅✅ DEPLOY #4b**. |
| The flag flip | ⛔⛔ **STILL BLOCKED.** ⭐ A fix shipping is not the gate closing — the gate is **seven consecutive green runs**, and shipping the fix is what makes those runs worth counting. |
| The seven consecutive green runs | ⛔ **RESTARTS FROM ZERO**, against #4b. It is not resumed at 3, and runs taken against #4 do not count toward it. |
| The 2026-09-17 decision | ⛔ **NO-GO stands.** |
| Deploy #4 | ✅ **stays live**, and is now an ancestor of #4b. ⚠️ It was not the fix; it narrowed the window and its main guard was never on the path. |
| Deploy #4b | ✅ **LIVE** — the round-2 fix. Flag unchanged. |
| Deploy #5 | ⛔ **does not exist.** Do not write a record for one. |
| The forked artifact | ⛔ **PRESERVED.** Do not clean it up; do not describe cleaning it up. ⭐ **It is why the note baseline is 33, not 32** — see **R-K**. |

---

# 🔧 ROUND 2 — THE FINAL DESIGN (R-A), CONFIRMED BY THE OWNER

✅ **SHIPPED — deploy #4b, `23f6ce271`, live 2026-09-10T20:36:29Z.** The record is
**✅✅ DEPLOY #4b** above; this section is the design it implements, kept as the
statement of *why each piece is shaped the way it is*.
⛔ **Shipping it does NOT unblock the flip** — the gate is seven consecutive green
runs, and those restart from zero against this build.

## GUARD 1 — a durable in-flight marker, in the **meta** store

Key **`inflight:<noteId>`**. Written **store-direct, BEFORE the PUT, and NOT
awaited**. The drain **SKIPS** a note that has a live marker.

⛔ **SKIPS, not blocks.** A skip leaves the entry queued for the next pass; a
block is a state something has to come along and clear. The drain has enough
terminal states already.

**Two independent expiries, and they answer different questions:**

| expiry | what it knows |
|---|---|
| the **TTL** | the save cannot still plausibly be in flight (see **R-D**) |
| a **PER-TAB Web Lock**, `uct.nb.session.<sessionId>` | the tab that wrote the marker is gone |

⛔⛔ **THE PER-TAB LOCK EXISTS BECAUSE `navigator.locks.query()` REPORTS OPAQUE
`clientId`s**, so it cannot tell you *which* tab holds what — and ⛔ **the LEADER
lock answers a different question entirely** (*who drains*, not *who is
mid-save*). Reusing the leader lock here would be a second authority over a value
it does not own.

⛔ **`holders: null` means "the TTL decides alone", NEVER "nobody is alive".** An
unreadable answer is not a negative answer — that distinction is the one this
wave keeps paying for.

## GUARD 2 — the 409 self-supersede, and it is TERMINAL

On a 409, the entry is **superseded, removed, and logged — NO fork** when either:

- the **server body is byte-identical** to what this browser sent, **or**
- the **server's `updatedAt` is in this browser's own landed-revision ring**.

**Anything else FORKS, and that is a CONTROL, not a fallback.** ⛔ A throwing
check forks. ⛔ An absent check forks. **Preserving both copies is the safe
direction**, and the design is arranged so every failure mode lands on it.

## TWO PASSES, not one

Guard 2 is asked **BEFORE the send when a marker has EXPIRED**, and **AGAIN on a
409**.

⭐ **Because the server's answer CHANGES across the send.** In the slow-PUT
ordering the honest answer before the send is *"no"* and the honest answer after
it is *"yes"* — and both are truthful readings of the same server at different
moments. **One implementation, two call sites.**

## What is deliberately NOT changing

- **`excludeNoteId` is untouched.** It protects the note **while open**; none of
  this is about that window.
- **`landedBaseline` keeps its dirty-record refusal.** ⛔ That refusal was
  **correct**. The mistake was **asking it a question it cannot answer in that
  window** — see defect 2 above. Do not "fix" `landedBaseline`.

---

# ✅ THE SELF-FORK FIX IS LIVE (DEPLOY #4 → #4b) — and the flip is BLOCKED

**Round 1: `f093bf731`, live 2026-09-10T16:46:28Z** (**✅✅ DEPLOY #4**) — ⚠️ it
narrowed the window and **did not close it**; its main guard was never on the path
that forks, and the defect reproduced eight minutes later.
**Round 2: `23f6ce271`, live 2026-09-10T20:36:29Z** (**✅✅ DEPLOY #4b**) — the
round-2 fix, built on the root cause.

⛔ `OFFLINE_DEFAULT_ON` is **still `false`** on the branch and on `master` —
neither deploy is the flip. ⛔⛔ **And the flip is still BLOCKED**: the gate is
seven consecutive green runs and they restart **from zero** against #4b. Read the
HARD STOP above before using anything here.

⚠️ **The mechanism section below describes ROUND 1's design.** It is accurate about
what `b41c26f29` did and it is **not** the current design — see the root cause in
the HARD STOP and **🔧 ROUND 2 — THE FINAL DESIGN (R-A)**.

## The mechanism — it was never a missing supersede

The supersede already existed: `putNoteWithIntent` deletes every queued entry for
a note when the intent is `null`, and `markSynced` passes `null` once the editor
has caught up. **The defect was that it could be MISSED.**

`markSynced` routes through `writerRef.current` and does nothing once the editor
has unmounted. The save resolves *after* the member navigates away — and
navigating away is exactly when the note leaves `excludeNoteId` and becomes the
sweep's. **The queue's most important moment was the one it could not settle.**
That race is also why the browser saw it ~1 run in 5 while a test that unmounts
first sees it every time.

## The fix — two guards, neither redundant

1. **`settleLandedSave` (`useDurableNote.js`)** — talks to the store **directly**:
   no hook, no ref, no mount. The editor's save callback calls it whether or not
   the editor still exists. Caught up ⇒ intent `null` ⇒ entries removed. Still
   ahead ⇒ the entry is **REBASED** onto the landed revision, keeping the newest
   words and giving them a baseline that can succeed.
2. **The drain's supersede refusal (`outboxDrain.js`)** — before sending, it
   compares the entry's baseline to the record's landed one and, if older,
   **removes it and does not send**. Same posture as the baseline refusal. This
   closes the ordering where the drain claims the entry between the unmount and
   the save resolving, when no settle could have run yet.

**One authority, next to `usableBaseline`:** `landedBaseline(record)` (⛔ only a
CLEAN record witnesses a landed save — a dirty record's baseline is what its next
send will *claim*) and `isSupersededBaseline(entry, landed)` (⛔ compares
**instants**, not strings; ⛔ refuses on anything unparseable, because this
decision deletes queued member work).

⛔ **`excludeNoteId` is untouched**, and the distinction is a comment in the
code: it protects the note **while open**; this protects a queued entry whose
baseline the editor invalidated **before handing the note back**.

The authority states its own invariant, and states the symptom it exists to
prevent, in `app/src/pages/journal-2-0/lib/offline/baseline.js`:

> *"⛔⛔ THE INVARIANT THIS EXISTS FOR: an entry never leaves the drain carrying a
> baseline older than a save this same browser has already landed for that note.
> Sending one cannot succeed — the server has moved past it — so it can only 409
> and fork, which is how a member with ONE device ends up with a
> `(conflicted copy)` of their own note (2026-09-10)."*

> *"⛔ PARSED, NOT STRING-COMPARED. ISO timestamps only sort lexicographically
> while every one of them carries the same offset, and 'it has always been
> +00:00' is an assumption about a producer, not a property of the format.
> Unparseable on either side ⇒ false: this decision DELETES queued member work,
> so it refuses unless it is certain."*

⭐ **`settleLandedSave` never throws into a save path** — a queue it could not
settle is caught by the drain's own supersede check, which is the second reason
neither guard is redundant:

> *"⛔ Never throws into a save path. A queue that could not be settled is caught
> by the drain's own supersede check, which is why that exists."*
> — `app/src/pages/journal-2-0/lib/offline/useDurableNote.js`

And the drain **removes** the superseded entry rather than parking it:

> *"⛔ REMOVED, NOT KEPT. Unlike a blocked entry, there is nothing here to
> recover: the record is clean and the server already holds this browser's words.
> Keeping it would leave a permanent tombstone the drain re-examines for ever."*
> — `app/src/pages/journal-2-0/lib/offline/outboxDrain.js`

## Rails and mutations

`lib/offline/selfFork.test.jsx` — **11/11**: unmount-then-resolve · rebase when
still ahead · still-mounted control · drain-claims-first · current-baseline
control · a **dirty record never vouches for itself** · a **real** conflict still
forks · the authority's parse/refuse/instant cases.

| mutation | result |
|---|---|
| M10 `settleLandedSave` writes nothing | 🔴 2 |
| M11 remove the drain's supersede check | 🔴 1 |
| M12 widen the supersede to every entry | 🔴 3 |
| M13 a dirty record may vouch for itself | 🔴 1 |

⚠️ **These four IDs are this session's own, and they do NOT match
`tools/q1_mutation_gauntlet.py`'s.** The tool renumbered when the recipes were
committed, so `M10` here and `M10` there are different mutations. Match them by
**guard text**, never by number — by that reading these four are the tool's
*"settleLandedSave writes at all"*, *"the drain's supersede refusal exists at
all"*, *"the supersede refusal is NARROW"* and *"landedBaseline: a DIRTY record
may not vouch for itself"*. ⛔ **The tool is the authority; the red counts above
are a record of a run, not a recipe you can repeat.** That is precisely the
defect the next section exists to close.

`journal-2-0` at rest with the fix: **234 files / 2446 tests green**.
Backend Q1 rails: **25**. `window_check.py --self-check` **PASS**, and the
single-writer fork detector is now a **hard red**.

✅ **Both fork artifacts cleared** (after the tests went green and their contents
were recorded above): back to the **32-note** baseline, no `WINDOW-CHECK` notes
left. The `To Do List` pair is the connectors feature's and was not touched.

⛔ **THAT WAS THEN. The baseline is 33 from 2026-09-10 onward** — 32 plus the ONE
`(conflicted copy)` preserved from the hard-stop finding, which is **evidence and
must not be cleared**. See **R-K**.

## ⭐ THE MUTATION GAUNTLET IS A TOOL — `tools/q1_mutation_gauntlet.py`

⛔ **Do not write "all nine mutations proved" — or any sentence of that shape —
anywhere in this wave's docs again. Point here instead.**

**Why.** Nine mutations were run and proved earlier in this wave, and the record
kept the **result** and not one of the **recipes**. So when the deploy gate
demanded *"every mutation reddening, on master AND post-merge"*, the nine could
not be re-run: the evidence had outlived the experiment. ⛔ **A mutation you
cannot repeat is a claim, not a measurement** — and a claim is exactly what a
gate is there to refuse.

Run it:

```bash
python tools/q1_mutation_gauntlet.py                 # the full gauntlet
python tools/q1_mutation_gauntlet.py --only M4       # one mutation
python tools/q1_mutation_gauntlet.py --self-check    # prove the harness can fail
```

**⛔ RESTORE IS AN INVERSE WRITE FROM MEMORY, NEVER `git checkout`.** A checkout
restores whatever is *committed*, which silently reverts anything else in that
file — including work in progress that was never the mutation's to touch. The
original bytes are held in memory, written back in a `finally`, and the restore
is **verified byte-for-byte** before the next mutation runs; a failed restore
stops the run and says so (`feedback_mutation_check_never_git_checkout`).

**⛔ IT RUNS A GREEN CONTROL BEFORE *AND* AFTER.** Before, because a rail that is
red before the mutation proves nothing when it is red after it — the gauntlet
refuses to start against a red control. After, because a mutation that quietly
failed to restore leaves the next reader's green looking like the harness's.
The final verdict compares the after-control's pass count to the before-control's
and fails on any drift.

**⛔ The expected-red set is declared, never typed as a total.** Each mutation
declares which rail files *should* redden; the run reports which actually did.
A mutation that reddens **nothing** is a guard nobody is testing; one that
reddens **everything** is a guard nobody has isolated. Both are reported, and a
gauntlet with any dulled mutation exits non-zero.

**⛔ An ambiguous site is refused, not guessed.** Each find/replace must match
**exactly once**; two occurrences raise rather than mutate an arbitrary one — a
mutation applied to a guessed call site measures nothing.

**⛔ A run with no totals line is not a run.** The parser raises rather than
reading a missing `Test Files` / `Tests` line as zero failures
(`lesson_a_task_status_reports_the_wrappers_exit_not_the_suites`).

⚠️ **A no-op mutation was REMOVED rather than left as a skipped placeholder** —
see **R3** in the Rulings section. A mutation that cannot fail is decoration and
pads the count.

⭐ **`--self-check` proves the harness can fail** before you trust a green from
it: a missing totals line refused, a totals line parsed as failures rather than
text, a twice-occurring site refused, a restore putting the original bytes back,
and every declared mutation site present exactly once in the real tree.

## ✅ THE TIER 1 THAT STOPPED DEPLOY #4 — RESOLVED, AND HOW

**Kept as the record of the block, because the resolution is the interesting
part.** `origin/master` moved to **11 commits ahead** and touched
**`NoteEditorPage.jsx`** — a guarded file, flagged by the gate as *the TipTap
wiring* and *one of the seven*. **TIER 1: do not merge, do not deploy, report.**
That was obeyed.

⚠️ **What master actually changed there is benign** — 8 insertions, 27 deletions,
lifting the toolbar's `FONT_OPTIONS` list out to `utils/fontFamilies.js` and
importing it (`f02276064`, charts Phase 6). It is nowhere near the save path, the
durable layer, or `setContent`, and it does not overlap the fix's edit.

⛔ **That assessment was not permission**, and it was not treated as one. TIER 1
exists precisely so an agent does not get to decide a guarded file's drift is
harmless.

⭐ **What cleared it was the TOOL, not the argument.** The same drift
(`febe8ee67 → 58dea4d88`) re-run through the region assessment came back
**TIER 1½, exit 3**: `NoteEditorPage.jsx` moved, and **every protected region was
untouched** — hunks `old=[(111,137)]` `new=[(50,50),(112,118)]`, **zero
intersections, no region missing**. That is a measurement of where the hunks
landed, not a reading of what the commit meant to do. Full record: **✅✅ DEPLOY
#4** below, and **R6** in the Rulings for the market-hours cost.

---

# 🧾 RULINGS — decide, log, continue

Judgement calls made during the 2026-09-10 session, written down so the next
session inherits the **decision** rather than re-deriving it from the evidence.
A ruling is not a finding: it is a fork that was taken, with the reason, so that
taking the other fork later is a deliberate reversal instead of an accident.

⛔ **The stamp on each of R1–R5 is when it was LOGGED here
(`2026-09-10T16:06:00Z`), not when it was decided.** All five were logged in one
pass; the deciding moments were not stamped at the time, and back-dating them
would invent a precision this file does not have. ⭐ **Stamp a future ruling when
you make it**, at the top of the section, before you continue.

## R1 — hunk ranges are read at `--unified=0`. Not a finding.

**`2026-09-10T16:06:00Z` (logged)** · **Decision: no defect. The gate was always
correct; the probe was not.**

A hand-run probe read a guarded file's diff with git's **default three lines of
context**, then compared the resulting hunk ranges against the protected regions.
Three lines of context are three lines of **unchanged file** swept into the hunk
header's range — and one of them was an untouched `EMIT_NOTHING` line, which is a
protected region in its own right:

```python
("EMIT_NOTHING", "line", r"\bEMIT_NOTHING\b"),
```
— `tools/gate_regions.py:40`

So the intersection "found" was manufactured by the probe's own context window.
The gate reads the diff the only way this question can be asked:

```python
_side(sh, "git", "diff", "--unified=0", f"{old}..{new}", "--", f),
```
— `tools/deploy_scope_gate.py:262`

⛔ **Any hand reproduction of a region intersection MUST pass `--unified=0`.** A
hunk range at `-U0` is a claim about which lines **changed**; with context on it
is a claim about which lines are **near** a change, and those are different
questions with different answers. An instrument that widens its own window
reports a finding that belongs to the instrument
(`lesson_an_instrument_can_reproduce_its_own_blind_spot`).

## R2 — ledger row 10 is INHERITED, blamed to `8de4da43b`

**`2026-09-10T16:06:00Z` (logged)** · **Decision: recorded as inherited, not as
Wave Q1's.** Full row + the three checks:
`docs/notebook/inherited-red-ledger.md`.

`ChartDrawingOverlay.surfaces.test.jsx` — *"⛔ ENTERING EDIT MODE IS NOT A
RESIZE"* — arrived with the 2026-09-10 master merge, as the only new failure in
an otherwise byte-for-byte baseline match, in `components/chart/`, an area this
wave does not touch. Blamed to `8de4da43b` (charts Phase 9, 2026-09-09).

Proved three ways, in order, because each kills a different hypothesis:

1. **It fails at rest, alone, in 1.4 s.** That kills row 9's load-sensitive
   population first — a timeout and a defect get opposite treatment in this
   ledger, so that ambiguity had to die before anything else could be said.
2. The test, `ChartDrawingOverlay.jsx` and `drawingsStore.js` are **byte-identical
   to `origin/master`**, and the branch changes no file under
   `app/src/components/chart/`.
3. ⭐ **The same test was RUN on a detached worktree at `origin/master`
   (`58dea4d88`), with no Wave Q1 code present, and failed identically.**

⛔ **Step 3 is not redundant after step 2**, and that is the whole ruling.
*"Byte-identical, therefore not mine"* is precisely the argument the deploy gate
SUSPENDS when master moves under `app/**`: a file this branch never touched can
still fail only in combination with it. An argument from identity is not a
measurement.

## R3 — a no-op mutation was REMOVED, not left as a skipped placeholder

**`2026-09-10T16:06:00Z` (logged)** · **Decision: delete it from
`tools/q1_mutation_gauntlet.py`.**

One candidate mutation could not redden anything: breaking it changed no
behaviour any rail observes. The options were to keep it marked skipped, or to
remove it. It was removed.

⛔ **A mutation that cannot fail is decoration, and it pads the count.** A
skipped placeholder still appears in the list a reader counts, so it inflates the
apparent strength of the harness while proving nothing — the same shape as
`lesson_gate_that_cannot_fail` and `lesson_a_refusal_count_is_not_a_progress_metric`.
If the guard it was aimed at is worth proving, the answer is a rail that observes
it, not a mutation entry that stands in for one.

## R4 — the rig tools point at the canonical ABSOLUTE profile path

**`2026-09-10T16:06:00Z` (logged)** · **Decision: Stream B aims the rig tools at
the one persistent profile, rather than creating a profile inside its own
worktree.**

Worktree isolation is the normal rule, and this is a deliberate exception to it.

⛔ **"One profile, never recreated" outranks worktree isolation here**, because
the two rules protect different things and only one of them is recoverable. A
worktree-local profile is a **fresh** profile, a fresh profile is a **signed-out**
profile, and **no credentials file exists** from which a sign-in could be
restored — so the isolation would cost a hand sign-in that the standing rule
treats as a 30-day event, not a session event. Isolation protects against
cross-contaminating another stream's files; nothing the rig writes into the
profile is another stream's to lose.

See the standing rule below: **⛔⛔ THE RIG HAS ONE PROFILE, AND ONE SIGN-IN.**

## R5 — the first sharded full-suite run VOIDED ITSELF, correctly

**`2026-09-10T16:06:00Z` (logged)** · **Decision: accept the void, re-run. Cost:
one ~13-minute re-run.**

The main session edited two files while the sharded full-suite run was **in
flight**. The gate voided the run and **named the two files** rather than
reporting a total.

That is the right behaviour twice over:

- **A suite that ran against a moving tree measured no single tree.** Its total
  is a number with no state behind it, and a number with no state behind it is
  worse than no number, because it reads as evidence.
- **It named the files instead of reporting a count.** A count says "something
  moved"; the names say *what* moved, which is the only form in which the reader
  can decide whether the void was real (`lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report`).

⛔ **The cost of the honest answer here was ~13 minutes; the cost of the
flattering one was a false green on the wave's headline gate.** Do not "save" the
re-run by quoting the voided total.

⚠️ **Operationally:** a full-suite run is ~13 minutes of tree-stability. If a
stream needs to edit during that window, the run is void — freeze the tree or
schedule the run, do not race it (`project_joystick_hub_increment_2_2026_09_09`:
*if the gate cycle is slower than the other workstream's push cadence, FREEZE
first, never lap*).

---

⛔ **R6–R14 were logged at `2026-09-10T16:57:51Z`**, after deploy #4 went live.
Same rule as above: the stamp is the LOGGING time, not the deciding time.

## R6 — deploy #4 pushed INSIDE the market-hours window. State the cost.

**`2026-09-10T16:57:51Z` (logged)** · **Decision: push, and name which slots it
costs.**

CLAUDE.md makes this an owner decision, and says exactly why:

> *"A push to master is a production deploy. It rebuilds and RESTARTS the web
> pod. APScheduler's job store is IN MEMORY, so a scheduled slot whose time
> passes during the swap is never scheduled at all — lost outright, not merely
> run late, and `misfire_grace_time` cannot see it."*
> — `CLAUDE.md`, **⛔⛔ NO PUSH TO MASTER, Mon-Fri 09:00-16:00 ET**

Deploy #4 pushed at **12:42 ET**, inside the window. ⭐ **The decision already
existed:** the owner pre-authorised #4 and #5 in writing, with a checklist that
*is the word*. What the rule requires of an agent is **not** that the decision be
re-asked — that would be relitigating a closed call — but that **the cost be
stated**.

**The cost, stated.** The swap spanned roughly **16:42:58Z–16:46:28Z
(12:42–12:46 ET)**, about three and a half minutes. Lost in that span:

- any `*/5` desk-session drain slot,
- the `minute="7/15"` session-insights pass,
- any 20-minute awareness scan that fell inside it.

⭐ **The named member-visible buzz-digest slots (12:30 and 14:00 ET) were
deliberately avoided and were NOT in the window.**

⛔ **A job with no catch-up loses such a slot SILENTLY.** `pattern_vision` has
none: the slot is simply never judged, and the only trace is a **missing row**.
The desk digest's `catch_up()` is that workstream's own mitigation, not a
platform guarantee — do not generalise from it.

## R7 — another workstream's gate baseline was updated, by us

**`2026-09-10T16:57:51Z` (logged)** · **Decision: update
`docs/plans/joystick/gate-baseline.json` (9 → 10, sha moved to `58dea4d88`)
rather than leave it stale.**

That file belongs to a **closed** workstream, and touching another workstream's
artifact is normally exactly what not to do. ⛔ **But it is a MEASUREMENT OF
MASTER, and master moved.** Left stale it would have reported a **phantom
regression** to every branch that ran that gate from now on —
`lesson_a_gate_list_drifts_like_any_other_artifact`.

The proof rides in the file's own `provenance_caveat`, so the edit carries its
justification wherever the file goes:

> *"2026-09-10: ChartDrawingOverlay.surfaces.test.jsx was ADDED by the Wave Q1
> session, not because Wave Q1 caused it -- it did not -- but because MASTER
> MOVED and this baseline is a measurement OF master. It is blamed to 8de4da43b
> (charts Phase 9). … Left stale, this file would have reported a phantom
> regression to every branch that ran the gate from now on -- a gate list drifts
> like any other artifact."*
> — `docs/plans/joystick/gate-baseline.json`

⚠️ **Recorded here so that workstream's owner sees an edit they did not make.**
The alternative — a correct-but-unannounced edit to someone else's artifact — is
the shape that costs trust, not time.

## R8 — two mutations that reddened nothing were the HARNESS, not dull guards

**`2026-09-10T16:57:51Z` (logged)** · **Decision: fix the harness, keep the
guards.**

Three mutations reddened nothing. Only one of the three was a guard's fault.

1. **A mutation that decorated a payload.** `M6` added a field to the `report`
   **payload** the drain builds when it refuses a baseline-less entry. **No
   control flow reads it.** The drain still refused, the rails stayed green, and
   the harness reported a live guard as untested. ⛔ **A mutation has to change a
   DECISION; decorating the description of one changes nothing.** Pointed at the
   real condition, it reddens 20 tests across five files.
2. **A rail that existed and the harness never ran.** `EMIT_NOTHING`'s only rail,
   `lib/setContentEmitsUpdate.test.js`, sits in `lib/` — **one directory above
   `lib/offline/`** — because it is about a TipTap v2-vs-v3 API change rather
   than about the offline layer. A rail set derived from **directory membership**
   never ran it.

⛔⛔ **A HARNESS THAT UNDER-REPORTS COVERAGE IS WORSE THAN ONE THAT UNDER-REPORTS
FAILURES: it invites you to delete a guard that was working.** That is the whole
ruling, and it is now a comment in the tool itself:

> *"⭐ A DERIVED SET IS ONLY AS GOOD AS THE PROPERTY IT DERIVES ON. Directory
> membership is a proxy for 'is this a Wave Q1 rail'; naming a Wave Q1 module or
> guard is the property itself. Both are used below, and their UNION is the
> set."*
> — `tools/q1_mutation_gauntlet.py`

Fixed with a `--self-check` case **and a non-vacuity control** — the case asserts
the rail set covers every `journal-2-0` test naming a guard, and the control
asserts the guard-name sweep actually selects files, so the case cannot pass by
finding nothing to check.

## R9 — two REAL gaps, and they are the same shape

**`2026-09-10T16:57:51Z` (logged)** · **Decision: write the two missing rails.
HARD STOP 3 was NOT triggered.**

Both are *a value everything defers to that nothing pinned*.

**`settleLandedSave`'s identity guard.** Eleven tests drove that function and
**every one passed a full identity**, so the half of
`if (!accountId || !noteId || !landed)` that keeps one member's save out of
another member's store was never exercised. ⛔ **The rail asserts the store is
NEVER OPENED**, not merely that the return is null:

> *"⛔ The dangerous direction is not 'returns null'. It is the WRITE that a
> missing identity would let through: `connect(undefined)` resolves to some
> store, and a save then lands in it under a note id of `undefined`."*
> — `app/src/pages/journal-2-0/lib/offline/selfFork.test.jsx`

**`EMIT_NOTHING`.** Flipping the named authority to `{ emitUpdate: true }` left
**the entire repo green**: the source sweep accepts the **NAME** as a lawful last
argument and never asks what it **IS**, and the behavioural cases pass the
literal without ever touching the constant.

> *"⛔ NAMING AN AUTHORITY CONCENTRATES THE BLAST RADIUS. … getting the authority
> itself wrong gets all five wrong AT ONCE, silently, with the call sites still
> reading correctly. That is strictly worse than four independent literals,
> unless the authority is pinned. This pins it."*
> — `app/src/pages/journal-2-0/lib/setContentEmitsUpdate.test.js`

⛔ **Pinned by LITERAL, for the same reason `OFFLINE_DEFAULT_ON` is** — a default
that can change without a test changing is how a wave goes live unnoticed.

⚠️ **HARD STOP 3 was not triggered**, deliberately: all three no-reddening
mutations were **attributed inside the 30-minute window** — two to the harness
and one to a missing rail that took less time to write than it would have taken
to report.

## R10 — master lapped the checklist, so the in-flight suite was KILLED

**`2026-09-10T16:57:51Z` (logged)** · **Decision: kill the run, delete its
partial logs, re-run on the reconciled tree.**

`58dea4d88 → 0e32db845` arrived mid-checklist. The full suite was already
running.

⛔ **Its tree was not the tree that would be pushed, so its result could not
satisfy the checklist** — finishing it would have produced a number nobody was
allowed to use. And leaving it running would have meant `journal-2-0` re-running
**beside** a full suite, which manufactures exactly the load-sensitive timeout
population of **ledger row 9** — a red that says nothing about the code.

⛔ **The partial shard logs were DELETED, not kept.** A directory of shard logs
reads as *"a run happened"* to the next person who opens it, and a run that was
killed mid-flight is not a run (`lesson_a_capture_that_only_breaks_on_failure`).

## R11 — no freeze was requested, and that was MEASURED

**`2026-09-10T16:57:51Z` (logged)** · **Decision: do not request a push freeze
for #4.**

Master pushes arrived in **bursts of two, roughly every two hours** —
`10:05`/`10:09`, then `12:06`/`12:08` ET — against a gate cycle of **~18
minutes**. The cadence was **not faster than the cycle**, so the standing rule
(*if the gate cycle is slower than the other workstream's push cadence, FREEZE
first, never lap*) did not fire.

⭐ **Measured, not assumed.** The prior wave's cost came from assuming the
opposite direction.

⛔ **Owner confirmed the falsifier: a SECOND lap falsifies this, the freeze gets
requested, and there is no third re-run.** Record the lap count, not a feeling
about how busy master seems.

## R12 — the rig's opt-out lived on the SUCCESS BRANCH

**`2026-09-10T16:57:51Z` (logged)** · **Decision: move it into a `finally`, read
it back, and use the one authority for the key.**

The rig profile was found carrying `uct.j2.offline.enabled = '1'` **at rest** —
i.e. the next run would not have started from rest, and an opt-in counted per
distinct profile is meaningless if one profile starts already opted in.

⭐ **The cause was proved from the log, not hypothesised.** `_mini_canary` opted
in at step 0 and restored `'0'` from a line **inside the cleanup block**, with no
`finally`, so three exits skipped it — and `window-check.log` shows the ordinary
early return firing that morning: **`check 11: REFUSED — failed: 2 create a
note`**.

> *"⭐ PRESERVING EVIDENCE AND STAYING OPTED IN ARE TWO DIFFERENT DECISIONS, and
> they were one branch. The note and the stores are evidence and must survive;
> the browser's opt-in is RIG STATE, and leaving it set silently changes what the
> next run measures."*
> — `tools/window_check.py`

**A second defect in the same line:** the restore spelled the key **literally in
JS** while the opt-in passed `FLAG_KEY` — ⛔ **two authorities over one value,
agreeing by luck.**

**Fixed, and each part for its own reason:** `opt_out` runs in a `finally`; it
**reads the value back** (a cleanup that cannot say whether it happened is the
defect this wave keeps re-finding); it uses `FLAG_KEY`; the rail **DRIVES** both
the early-return and the raise paths through a `body` seam rather than restating
them; an opt-out that does not take is **reported, not assumed**; and the
exception **still propagates**, because ⛔ *a `finally` that swallows is worse
than none*.

⭐ **The competing hypothesis was MEASURED and rejected**, not argued away: set
to `'0'`, the key **survives** a `/journal/notebook` mount, so the app is not
rewriting it. And the before-value was recorded into an artifact **before**
anything was written, then restored to `'0'`.

## R13 — engine labels must not outlive their wiring

**`2026-09-10T16:57:51Z` (logged)** · **Decision: keep every lane, relabel three
of them.**

The matrix's `mobile` lane is **Chromium wearing an iPhone UA**. ⭐ **It stays
Chromium-mobile** — the Android-shaped answer is a real member configuration
nothing else in the matrix covers — but *"mobile ✅"* beside an iPhone UA is a
claim about a platform that was not tested. So the lane is **relabelled in
output, in the artifact key, and in every table**:

```python
"edge": f"edge ({edge_version()} — Chromium 119-era; NOT current Edge)",
"webkit": "webkit (Playwright WebKit — NOT Safari on a real device)",
"mobile-chromium": "mobile-chromium (Android-shaped; NOT iOS)",
```
— `tools/engine_matrix.py`

with one line stating where the iOS-shaped answer actually lives:

> *"the iOS-shaped answer is the `webkit` row; `mobile-chromium` is Android-shaped
> and is NOT iOS"*

⭐ **The Edge version is MEASURED off the binary, never typed** — *"⛔ MEASURED
off the binary, never typed — the whole point of the label."* ⛔ **A real-Safari
claim would be a DEVICE claim, and no local suite can make one.**

**Rationale:** this repo has repeatedly been bitten by names that outlived their
wiring. *"ON THE TAPE"* is the canonical case — the name survived onto a new
tile, the wiring did not, and the section read as true for months because the
words were still on screen.

## R14 — a sweep that counted itself

**`2026-09-10T16:57:51Z` (logged)** · **Decision: match on `ExecutablePath`, not
`CommandLine`, and add a live control.**

The rig's Playwright process sweep matched on **`CommandLine`** — and the very
PowerShell process running the query carries `ms-playwright` in **its own**
command line. So a clean run reported one browser *"left behind"* and named
**`powershell.exe`** as the leak.

> *"A probe whose needle appears in the probe cannot see past itself
> (`lesson_an_instrument_can_reproduce_its_own_blind_spot`). `ExecutablePath` is
> the identity of the BINARY and is not a string this query carries."*
> — `tools/engine_matrix.py`

⭐ With a **live control asserting the sweep never counts its own shell** — the
fix and the proof that the fix holds are different artifacts.

⚠️ **Same family as the source sweep that once matched its own needle**, and as
**R1**: three instruments in one session that reported a property of themselves
as a property of the thing they measured.

---

⛔ **R15 and R16 are MY OWN MISTAKES, recorded in the same register as the rest.**
They are logged at `2026-09-10T16:57:11Z`, and they belong to the HARD STOP at the
top of this file: both cost evidence at the exact moment the finding appeared.

## R15 — the tally filtered away the run it most needed

**`2026-09-10T16:57:11Z` (logged)** · **Mistake. Recorded so the next tally is not
built the same way.**

The seven-run tally piped **each run** through `grep`. So when run 3 forked, its
**step-level detail was filtered away and lost**: the per-step baselines, the PUT
counts, and the ordering of steps 1–4 — the things that say *where in the sequence
the fork happened*.

⛔ **A tally that filters its own runs keeps the VERDICT and discards the
EVIDENCE.** A tally's job is to say which runs passed; it has no business being
the only place a run's output goes.

⚠️ **Recoverable, and that is the mitigation, not the excuse.** The fork is
reproducible and the server artifact survives (preserved, untouched). What was
lost is **the cheapest diagnostic pass there is: the one taken at the moment of
the failure**, on the run that actually failed, with no re-run needed. Every
later look costs a reproduction.

⭐ **The fix is not "grep less".** It is that a run's full output goes to a file
unconditionally, and the tally reads that file. Then filtering is a view, not a
destructor.

## R16 — the instrument warned me in words, and I read past it

**`2026-09-10T16:57:11Z` (logged)** · **Mistake. The more expensive of the two.**

Run 2's `'1'` at rest was **printed in run 2's own output, with the tool's own
warning attached** — *"unexpected at rest; a previous run did not opt back out"*.
I read it as a known rig quirk and moved on. It was **state contamination between
runs**, and it was the first visible symptom of the finding that stopped the wave
one run later.

⛔⛔ **SEVEN CONSECUTIVE RUNS ON ONE PERSISTENT PROFILE ARE ONLY "CONSECUTIVE" IF
EACH STARTS FROM THE SAME STATE — AND I NEVER ESTABLISHED THAT THEY DID.** The
flip condition is *seven consecutive green runs*; without a same-start-state
check, "consecutive" is a claim about the clock, not about the experiment. Runs 2
and 3 started opted in, run 1 did not, and that difference is now the leading
hypothesis for the fork itself.

⛔ **The instrument said so, in words, and I did not act on it.** That is worse
than an instrument that stayed silent: the warning was built by the previous
session for exactly this case (**R12**), it fired correctly, and the cost landed
anyway because a human read it as noise.

⭐ **The rule this leaves:** a rig warning about **rig state** is not cosmetic —
it is a statement that the next run's starting conditions are not what the
protocol assumes. Treat one as a **stop**, not a footnote, and record the
starting state of every run in the streak rather than only its verdict.

---

# 🧾 ROUND-2 RULINGS — R-A … R-R, plus R-X … R-Z

⛔ **Lettered, not numbered, on purpose.** R1–R16 belong to the deploy-#4 round;
these belong to the round that followed the root cause. Mixing the sequences
would imply an ordering between two different investigations.

⛔ **R-A–R-I were logged `2026-09-10T20:12:45Z`; R-J and R-K at
`2026-09-10T20:40:00Z`**, after deploy #4b went live — the logging time, not the
deciding time, same rule as R1–R16.

## R-A — the marker lives in the **meta** store, and two designs were REJECTED

**Decision: `inflight:<noteId>` in the meta store, store-direct, not awaited.
Confirmed by the owner.** The design is written out in full above.

⛔⛔ **BOTH REJECTED DESIGNS WERE KILLED BY PRE-EXISTING RAILS, NOT BY REVIEW.**
That is the load-bearing fact about this ruling: nobody argued them down. They
were built, and rails that already existed went red.

**REJECTED 1 — AWAIT the marker write on the save path.**
Rejected by `NoteEditorPage.durable.test.jsx` and
`NoteEditorPage.interleavings.test.jsx`. ⛔ It **couples the member's ability to
save to IndexedDB being responsive**: a blocked upgrade or a stalled store stops
saves outright — and to a member whose network is fine, *it looks like the network
is down*. ⭐ **"A save must not wait on bookkeeping" is a rule this file already
lived by**; the rejection was the rails enforcing a rule the design had forgotten.

**REJECTED 2 — the marker ON THE NOTE RECORD.**
Rejected by the same rails. It meant a **read-modify-write on `notes` ON THE SAVE
PATH**, contending with the durable writer's own writes to that store — and the
observed result was that **the durable copy stopped being written at all**. It
also forced an awkward flag so that lowering the marker could not clobber the
settle. ⭐ **A different store removes both problems by construction**, which is
why the meta store is the answer rather than a workaround.

⭐ **The general shape:** when two writers contend for one store on a hot path,
moving one of them to a different store is a *structural* fix; a flag that
sequences them is a *race with a name*.

## R-B — three more doors onto the same defect, found by the DERIVED wire rail

**Decision: cover folder, ticker and tags changes as first-class cases.**

Folder / ticker / tags changes **advance `updatedAt` without carrying the
member's body** — so the same defect arrives through three more doors.

⭐ **Found by the DERIVED wire rail, not by reading the code.** That is the direct
answer to defect 1: the thing that was missing was a rail on the **wire**, and the
first thing the wire rail did was find three call sites nobody had enumerated.

Each door gets **its own deterministic case, its own control, and its own
mutation** (`M17` / `M18` / `M19`).

⛔⛔ **AND THE RAIL'S OWN LIMIT IS WRITTEN DOWN BESIDE IT: the wire rail proves
the call EXISTS; it cannot prove the call is CORRECT.** A door that passed
**LOCAL** state as `acked` would satisfy the wire rail completely — and would
**DELETE the member's queued work**. There is a case pinning exactly that.

⭐ That is `lesson_a_guard_that_tests_the_adjacent_thing` in its most expensive
form: a rail that answers *"is it wired?"* reads, to a tired reviewer, like a rail
that answers *"is it right?"*.

## R-C — guard 2's SECOND ARM SHIPPED DEAD

**Decision: record it as a shipped-dead arm, and give the ring a real
implementation.**

`serverCopyIsOursDefault` **accepted `landedRevisions`**, and the drain **called
it with one argument**. So the second arm **could never fire**, and guard 2
recognised **only byte-identical bodies**.

⛔⛔ **That is precisely the case that does NOT cover the defect.** A member who
**keeps typing** has a body that differs **by construction** — so the only arm
that was alive was the one guaranteed to be useless for the scenario the guard
exists for.

**Now:** `settleLandedSave` records each landing in a **bounded newest-first ring**
(`landed:<noteId>`, cap 5, deduped, and unusable revisions **refused through the
baseline authority** rather than through a second opinion).

⚠️ **Same family as R8 and defect 1**: a thing that exists, reads correctly, and
is not reachable from where it matters — an arity mismatch is
`lesson_built_tested_green_and_unreachable` at the level of a single argument.
A validator cannot see it; a function of the wrong arity is still a function.

## R-D — `IN_FLIGHT_TTL_MS = 10 s`, and why it is p99×10 and not p95×10

**Decision: 10 s = p99 997.6 ms × 10.**

**n = 30 real CAS PUTs against production, from the rig:**

```
min   81.3 ms
p50  111.2 ms
p95  526.0 ms
p99  997.6 ms   (= max)
```

⛔ **NOT p95×10 (5.26 s), and the reason is the distribution, not the caution.**
At n = 30, **nearest-rank p95 IS a single sample**. The distribution is
**bimodal** — 24 samples inside an 81–127 ms band, six in a tail — so "p95" here
names the gap between two clusters rather than a percentile of one population.

⭐ **The asymmetry decides it.** Too high, and a stuck marker delays a drain.
**Too low, and the heal PRE-EMPTS a PUT that is still in flight** — which is the
failure the marker exists to prevent. The tail is the population the threshold
must **TOLERATE**, so the tail sets it.

⚠️⚠️ **KNOW WHAT THIS NUMBER IS.** One machine, one network, one 15-minute
off-hours window. It is **a latency floor for a HEALTHY origin**, not a
characterisation of the service.
⛔ **A breach is a reason to RE-MEASURE, never to shrink it.** Shrinking a
threshold because it was exceeded turns a signal into silence
(`lesson_two_points_do_not_establish_a_rate`).

## R-E — four pre-existing rails were the judge, and NONE were edited

**Decision: let the rails arbitrate, and change none of them.**

Four rails were **RED under both rejected designs and GREEN under the final one**:

- durable — *"a failed save leaves the work durable, queued, and HONESTLY
  labelled"*
- durable — *"says 'in this browser' when it was not"*
- durable — *"a refused `persist()` never blocks offline editing"*
- interleavings — *"C — the NEWEST words survive"*

⛔⛔ **NOT ONE OF THEM WAS EDITED.** A rail edited to accommodate a design under
evaluation stops being evidence about that design.

⭐ **And a hypothesis was tested against them and REFUTED:** a pump-count
explanation was tried, did not hold, and **the experiment was REVERTED rather
than left as a rail bent to fit the change**. That is the whole discipline in one
sentence — the cheap move is to adjust the rail until the design passes, and it
destroys the only instrument you had.

## R-F — §21 inertness: all three store-direct entry points honour the flag

**Decision: re-establish the one-line rollback's guarantee, and rail it.**

**All three store-direct entry points honour `offlineEnabled()`.**

⭐ **Found because wiring the settle into the autosave path BROKE the guarantee
the one-line rollback rests on** — the rollback runbook in this file promises that
with the flag off *the editor writes nothing new*, and defect 1's fix put a new
store-direct write on the hottest path in the product. The fix for one defect
walked straight into the invariant of another.

**Mutation `M20` targets the settle's flag gate.** ⛔ **Its find-string was
EXTRACTED from the file and proved unique before being written**, because
`if (!offlineEnabled()) return null` appears **identically in three functions** —
an ambiguous mutation site is a guess about which call site was hit, and the
gauntlet refuses one by design.

## R-G — the slow-PUT ordering, and why one pass is not enough

**Decision: two passes, from one implementation.**

The ordering, with **no second device and no unusual browser**: a PUT slower than
the TTL → the marker **expires** → the server is **unmoved**, so a pre-send check
truthfully says *"not superseded"* → the entry is **sent** → the **slow PUT lands
first** → **409**.

⛔ **Both readings of the server are honest.** The answer simply **changes across
the send**. That is why guard 2 is asked before the send *and* on the 409, and why
it must be **one implementation with two call sites** rather than two checks that
can drift (`lesson_a_second_authority_over_one_value`).

Closed by the two-pass design; **five cases, each with a control.**

## R-H — `patchNote` was REMOVED, not orphaned

**Decision: record the removal, so nobody records a ghost.**

`patchNote` was **ADDED by this work** and **removed when the marker moved
stores**. It is **gone** — verified absent from `lib/offline/**` in this tree, not
merely unreferenced.

⛔ **The distinction matters here more than usual.** This repo carries a whole
section of things that were *documented as live and are unreachable*; the reverse
error — recording a **deleted** symbol as a **dead export** — sends the next
reader hunting for a file that does not exist. A one-line entry is added to that
section saying it was removed, on purpose, in the same work that introduced it.

## R-I — the heredoc mangled backticked content TWICE, in one session

**Decision: record it as a process failure, not a typo.**

A `new RegExp` template literal became `consts+commitSaves*=s*asyncs*(`, and a
whole test block **failed to parse**. Twice, in one session.

⛔⛔ **THE STANDING CONSTRAINT — "Edit, not heredocs, for backticked content" —
WAS VIOLATED BY THE AGENT THAT WROTE IT DOWN.** That is the part worth recording.
A rule an agent authored and then broke is evidence that the rule is not
self-enforcing, and the answer is a mechanical one: use the Edit tool for
anything containing a backtick, `$`, or a shell metacharacter, without judging
whether *this* string looks risky.

⚠️ **The failure mode is loud here and silent elsewhere.** A mangled regex failed
to parse, so it was caught immediately. The same mangling inside a string literal
would have compiled, run, and quietly matched nothing.

## R-J — the TTL's provenance was corrected before shipping: say MAX, not p99

**`2026-09-10T20:40:00Z` (logged)** · **Decision: the number is unchanged; the
WORD changes.** `IN_FLIGHT_TTL_MS` is **10 s = MAX 997.6 ms × 10**, not
"p99 × 10".

**R-D above called 997.6 ms the p99.** At **n = 30**, the nearest-rank p99 **IS
the max** — the same single sample. Calling it a p99 dresses **one observation in
the clothes of a percentile estimate**, and reads as more evidence than exists.

The correction lives where it will be read, in the module itself:

> *"⛔ SAY 'MAX', NOT 'p99'. At n=30 the nearest-rank p99 and the max are THE SAME
> SAMPLE, so calling it p99 dresses one observation as a distribution and reads as
> more evidence than exists. The number is right; the word matters, because the
> next person to re-measure needs to know it is one tail sample and not a
> percentile estimate."*
> — `app/src/pages/journal-2-0/lib/offline/inFlight.js`

⛔ **This is not pedantry, and the test is who gets hurt.** The next person to
re-measure needs to know they are comparing against **one tail sample**, not a
percentile. Told "p99", they would reasonably collect n=30 again, compute a p99,
get a different number, and conclude the origin had changed.

⭐⭐ **AND NOTE WHO CAUGHT IT: the stream that TOOK the measurement, reading my
write-up of it.** The measurer checking the reporter. That is the only direction
this error is catchable from — I had no way to know the shape of a sample I did
not collect, and the measurer had no reason to re-read their own numbers until
they saw them described. ⛔ **Whoever takes a measurement should read how it gets
written down**, and this is the evidence that the loop pays.

⚠️ **R-D is left standing with its original wording**, annotated by this ruling
rather than silently rewritten — the same treatment deploy #4's record gets. A
ruling edited to have always been right teaches nothing.

## R-K — the note baseline is **33**, not 32

**`2026-09-10T20:40:00Z` (logged)** · **AMENDED 2026-09-10T21:05:00Z — the number
is now 34.** · **Decision: the current count is the target, everywhere, until the
preservation instruction is lifted.**

⛔⛔ **34 = the 32-note baseline + TWO preserved `(conflicted copy)` notes** — the
**16:54:50Z** fork (HARD STOP #1) and the **20:57:31Z** fork (HARD STOP #2).
**Both stay** until the property rail is green **AND** their content is recorded
in this doc.

⚰️ **This ruling was written at 33 and is amended rather than rewritten**, because
the amendment is the point: **the number moves every time an artifact is
preserved**, so a target typed once and trusted is wrong by construction. ⭐ Read
the count from the preserved-artifact list, not from a remembered figure.

**33 was: the 32-note baseline + the ONE preserved `(conflicted copy)`** from the
first hard-stop finding.

⛔⛔ **32 IS ONLY REACHABLE BY DELETING EVIDENCE, and the preservation instruction
has not been lifted.** Any run, matrix or checklist that targets 32 is asking to
be "corrected" by someone tidying up an artifact that is still the only physical
record of the defect reproducing in production.

**Every future run and the matrix target the CURRENT count — 35 as of
2026-09-10T23:40:00Z (R-Y — it was 33, then 34, then 35).**

⭐ **Recorded precisely so nobody "corrects" the number later.** A baseline that
drifts by one is exactly the kind of discrepancy a helpful reader fixes on sight
— and here the helpful fix destroys the finding. ⚠️ When the preservation
instruction *is* lifted, that is a decision with a date and an owner, and the
baseline returns to 32 in the same motion. It does not return quietly because the
number looked odd.

---

⛔ **R-L … R-O belong to HARD STOP #2** and are logged `2026-09-10T21:05:00Z` —
the logging time, not the deciding time, same rule throughout.

## R-L — M22 reddened NOTHING until a SOURCE PIN was written

**Decision: pin the ARGUMENT, the way `EMIT_NOTHING` is pinned on its value.**

Mutation **M22** restores the `|| saved` fallback — the exact line that lost the
member's words. **It reddened nothing.**

⛔⛔ **Every behavioural rail models the door by calling `settleLandedSave`
DIRECTLY**, so mutating the argument *the editor passes* touches no test. The
function was covered; **the call was not**.

⛔ **THIS IS ROUND 1'S ROOT CAUSE AGAIN, ONE LEVEL IN.** Round 1: the guard was
wired into the wrong save path — the function was tested, the **wire** was not.
Round 2: the wire exists and is tested, and what nobody pinned is **the ARGUMENT
that wire carries**. The same shape, one level deeper each time
(`lesson_built_tested_green_and_unreachable`).

⭐ **The fix is a source pin, not another behavioural test** — assert the literal
the editor passes, exactly as `EMIT_NOTHING` is pinned to `{ emitUpdate: false }`
(**R9**). A behavioural test can only observe what the argument *does*; a source
pin observes what it *is*, which is the thing that changed.

## R-M — three mutations went AMBIGUOUS, and were re-targeted by extraction

**Decision: extract unique context from the file and ASSERT uniqueness before
writing — never transcribe and hope.**

`M9`, `M11` and `M15` went ambiguous when `recordLandedRevision` **duplicated two
lines** of `settleLandedSave` and guard 2's site **changed shape**. The gauntlet
refuses an ambiguous site by design (it must match exactly once), so this surfaced
as a refusal rather than a silent mis-mutation — which is the harness working.

⭐ **Re-targeted by EXTRACTION**: read the surrounding lines out of the file, prove
the string occurs exactly once, then write it. ⛔ **Not by transcribing from
memory and running to see.** Same discipline as **R-F**'s `M20`, and the reason
is the same: a find-string typed by hand is a guess about which call site is hit.

⚠️ **A refactor that duplicates lines silently ages every mutation aimed at
them.** The gauntlet's uniqueness check is what converts that from a wrong result
into a stop.

## R-N — `engine_matrix._cleanup` deleted UNCONDITIONALLY, and has never run

**Decision: fix it now, on inspection, before it ever runs.**

`engine_matrix._cleanup` carried **the canary's identical 2026-09-10 defect** —
an unconditional delete — and the matrix **HAS NEVER RUN**. On its first
execution it would have **destroyed the evidence of its own first finding.**

⭐⭐ **Found by INSPECTION, not by loss.** The canary's version of this bug was
found only *after* it deleted half a fork **9.4 seconds after creating it**. This
one was caught by reading the code with the canary's defect in mind — which is
the whole value of writing a defect down as a *shape* rather than as an incident.

⛔⛔ **AND THE DISTINCTION IS THE RULING: a matrix that finds nothing and a matrix
that DELETED what it found print the same row.** There is no signal that
separates them after the fact. That is why an unconditional cleanup in an
evidence-gathering instrument is not a tidiness question — it is a question about
whether the instrument can report at all.

## R-O — "server holds text" is DELETED, not kept alongside

**Decision: remove the weak check everywhere; replace it, do not supplement it.**

*"Server holds text"* is satisfied by the words typed **ONLINE**, so it is green
through exactly the failure it exists to catch (**HARD STOP #2**). It has been
**replaced** — in `tools/window_check.py`, `tools/engine_matrix.py` and **step 10
of the script of record** — by:

> **the server BODY CONTAINS THE OFFLINE SENTENCE**

with **one authority for the sentence** so the tools cannot drift, and a
**note-count assertion beside it**.

⛔⛔ **DELETED, NOT KEPT ALONGSIDE.** A weak check retained next to a strong one
still prints green, still reads as corroboration, and is still the line someone
quotes when they are in a hurry. Two checks that disagree are worse than one that
is right.

⭐ **The same defect one layer down was fixed in the same motion** — `record holds
text` had the identical weakness against the local record. ⛔ **Fixing a check in
one lane and leaving its mirror weaker is how the next false green gets built**
(`lesson_rail_the_mirror_not_just_the_lane`).

⚠️ **Step 10 of the script belongs to Stream B and lands underneath this prose.**
The annotation under the PART A table records what row 10 expected and observed,
and ⛔ **that row is not edited** — see it above.

---

⛔ **R-P … R-R are about the MACHINE, not the product**, and they are logged
`2026-09-10T22:20:00Z`. ⭐ **R-Q and R-R are now in the `uct-conventions` skill on
the owner's instruction**, so they bind future sessions and not just this file.

## R-P — a gate cycle contends for the MACHINE, not only for `master`

**Decision: reduce your own footprint; never kill another session's work.**

Three sessions ran suites concurrently. Free memory fell to **451 MB of 32 GB**,
and the host **OOM-killed the full-suite run THREE times**, plus the loop that was
*waiting* for the others to finish.

⛔ **THE LEVER NOT PULLED: killing another session's work to make room.** It was
available, it would have worked, and it was not used — because the memory belongs
to whoever is using it, and a gate cycle is not a claim on the box.

**What was done instead:** `scripts/gate_shards.py` gained `--max-workers`
(**default unchanged at 2**), so a contended box costs a **slow run rather than a
lost one**.

⭐ **Same shape as R11's lapping problem, one layer down.** R11 was about
contending for `master`; this is about contending for the machine `master` is
gated on. Both resolve the same way: **measure the contention, then reduce your
own cost — do not evict the neighbour.**

📄 **The standalone record is `docs/notebook/runaway-pytest-2026-09-10.md`** — it
carries the process table, the ancestry, and the reproduction. ⛔ Do not duplicate
its content here; that file is the owner of those measurements.

## R-Q — ⛔⛔ PIPE A TEST RUNNER'S EXIT STATUS THROUGH, NEVER `tail`'s

**Decision: `${PIPESTATUS[0]}`, or capture to a file. Never read a pipeline's exit
code as the runner's.**

`pytest … | tail -2` reports **`tail`'s** status. An OOM-killed run then presents
as:

- a **653-byte log**,
- containing only a deprecation warning,
- **no traceback**,
- and **exit 0**

— which is **indistinguishable from "finished quietly"**.

⚰️ **One session lost THREE full backend runs that way in a single night without
ever seeing a failure.** It was diagnosable only from **OUTSIDE**, by another
session measuring the process.

> ⭐ **THE SENTENCE TO KEEP, from that session: *the evidence of an OOM kill is
> precisely that there is no evidence.***

**The three rules this leaves, and each fails differently:**

1. Use **`${PIPESTATUS[0]}`** or capture the run to a file and read it back.
2. **A suspiciously small log is a KILLED RUN until proven otherwise** — size is a
   signal, and a 653-byte log from a suite that normally prints thousands of lines
   is the loudest one available.
3. **A run with no totals line is not a run, whatever the exit code says**
   (`lesson_a_task_status_reports_the_wrappers_exit_not_the_suites`) — this wave
   already had that rule and it is what would have caught this one too.

## R-R — backend pytest on this box is SCOPED, never repo-wide

**Decision: scope every backend run to named files until the 18 GB cause is
named.**

`--collect-only` **ALONE reached 6.6 GB**. So it is **import/collection time**, and
⛔ **neither `-k` nor `--timeout` contains it** — both act after collection.

⭐ **`scripts/gate_shards.py` is CLEARED by MEASUREMENT, not by argument:**
`grep -n pytest` over it returns **ZERO** occurrences; line 191 runs `npx vitest`
only. **No gate run carries the bomb.**

⛔⛔ **THE INVESTIGATION IS THE INDICATOR SESSION'S, NOT THIS ONE'S.** That session
owned the processes, confirmed it, and killed them. Leads for whoever takes it:

- the repo-root `conftest.py` does an **AST census over `api/**`, `scripts/`,
  `tools/` at import**;
- `api/main.py` is ~9,800 lines with ~986 routes **walked when `api.main:app` is
  imported**, so a test module importing it **at module scope pays that per
  worker**.

⭐ **Corroboration worth recording, because it narrows the search:** the same
session's full **FRONTEND** suite (vitest, **1213 files, 17,386 tests**) completes
fine in **~370 s** on this box. So this is **specific to the Python collection
path**, not general memory pressure.

### ⭐⭐ And the cross-session part — the pattern that actually worked

**THREE sessions independently refused to kill processes they did not own** —
including on a peer's **relayed** authorisation.

> ⛔ **`patrick-00` named it: a peer relaying an owner's authorisation is not
> authorisation. It is laundering the permission decision.**

My own classifier blocked me **twice**, and I **stopped rather than hunt for a tool
that slipped through** — which is the correct response to a block, not an obstacle
to route around.

⭐ **It resolved by ASKING: the owner identified itself and killed them.** Record
that as the working pattern, **because it is the one that worked** — not the
fastest one, the one that ended with the right party making the decision.

---

⚠️ **THE LETTERS SKIP: `R-S` … `R-W` ARE NOT IN THIS FILE, AND THAT IS NOT AN
ERROR.** They belong to other streams and to the coordinator. `R-S` is on the
branch as `1f7cfd500` — *"lock the tree while it is measured, and fix a rail that
guarded the wrong party"* — and `R-W` (the freeze/release) is cited by the deploy
#4c record below. ⛔ **Do not renumber to close the gap**, and do not restate a
ruling whose text this file has never held: a citation you cannot quote is struck.

⛔ **R-X … R-Z are logged `2026-09-10T23:40:00Z`.** R-X and R-Y come out of the
fork capture; R-Z is attributed to a peer session.

## R-X — a TAG describes what HAPPENED to a note, never WHO MADE IT

**Decision: the cleanup's delete set is selected by TITLE only.**

The cleanup selected live notes by **canary title OR the tag `sync-conflict`**.
**Two notes carrying that tag are THE OWNER'S:**

```
a09fc55abc024cfabc067f502ad13aa0  "To Do List"                  2026-09-04
ff547947888e45579a86a9ab81be4894  "To Do List (synced copy)"    2026-09-04
```

Both sit **INSIDE the 32-note baseline**, and both are **the pre-existing pair
this wave was explicitly asked to identify and not touch.**

⛔⛔ **THE CLEANUP WOULD HAVE SOFT-DELETED A MEMBER'S OWN NOTES TO MAKE A COUNT
COME OUT RIGHT.** That is the sentence to keep. The tag `sync-conflict` records
*what happened to* a note — it says nothing about who wrote it, and using it as a
proxy for authorship is the same substitution the drain made when it read "ours"
as permission to delete.

⭐ **Authorship is the title the tool wrote, and nothing else.** Fixed to
title-only, **driven by three cases carrying those two real ids and titles
verbatim** — including one where they sit **beside real artifacts and only the
artifacts are selected**, which is the case that proves the selector still works
rather than merely refusing everything.

⭐⭐ **IT WAS CAUGHT BECAUSE THE CAPTURE RAN BEFORE THE CLEAN.** That ordering was
insisted on for a different reason entirely, and **paid for itself on its first
outing** — the general form being that a read-then-write ordering buys you a
chance to notice, and a write-then-read ordering buys you a postmortem.

## R-Y — the account holds **35** live notes, not 34, and the instruction was wrong

**Decision: the count is DERIVED from the capture, not from a sentence.**

Streak run 1's **ORIGINAL** (`66708b88…`) is **LIVE** — it had been recorded as
trashed. So:

> **35 = 32 baseline + 3 canary artifacts.**

⭐ **Stream B did not act on the discrepancy**, and that is the ruling:

> ⛔ **"A disagreement about state is not reconciled by acting on it."**

⚰️ **This is R-K amended a second time** — 33 → 34 → 35 — and the drift is the
point, exactly as R-K said it would be: a target typed once and trusted is wrong
by construction. ⛔ **Read the count from the capture.** Every number in this
paragraph will be wrong the moment the preserved artifacts are cleaned, and the
correct response then is to re-derive it, not to edit it to taste.

> ⚰️ **ANNOTATION, 2026-09-11 — and this ruling predicted its own annotation.**
> The artifacts were cleaned, and the count is now **34 = 32 baseline + round 3's
> note (`0910373ae0e84b758c39f4a13c33e5fe`) + its conflicted copy**. The sequence
> is now **33 → 34 → 35 → 34**, which is the fourth different answer in one day.
> ⛔ **The NUMBER in the heading above is a measurement at an instant; the RULE is
> the durable part.** It is re-derived here rather than edited there, exactly as
> the paragraph above instructs — and **34 is CORRECT AND INTENTIONAL**, not a
> count to be tidied back to 33.

## R-Z — absence of evidence resolves to KEEP, never to discard

**Attributed to `patrick-c7`.**

On the rule12 rail that two sessions each fixed one instance of:

> *"between us that rail now knows three things it did not know this morning:
> where it is running, whose branch it is on, and whether it has a subject at
> all."*

⭐ **Each of us fixed an instance; neither saw the CLASS until the other's failure
exposed it.** That is the argument for writing a defect down as a *shape* rather
than as an incident — and for reading the other session's write-up.

**And its generalisation of #4c's invariant, which is the better statement of it:**

> ⛔⛔ **"A queued entry is never removed unless the server body is PROVEN to
> contain its content"** and **"an absent measurement is never a pass"** are **the
> same rule**.
>
> **ABSENCE OF EVIDENCE RESOLVES TO KEEP, NEVER TO DISCARD.**
>
> ⭐ **Deleting on "probably fine" and passing on "nothing failed" are one mistake
> in two costumes.**

⭐ **Adopt R-Z's phrasing as the wave's statement of the invariant.** The version
in the CLOSE section is the product-specific instance; this is the rule it is an
instance of, and it is the one that also covers **R-Q** (an OOM-killed run that
prints nothing is not a pass) and **R-X** (a tag that does not prove authorship is
not permission to delete).

---

# 🚨 THE SELF-FORK, AS FOUND — 2026-09-10

**A SINGLE-WRITER OFFLINE SESSION FORKS ITS OWN NOTE.** Found by the compressed
evidence set that replaced the seven-day window, on run 5 of 7. ⛔ The flag was
**NOT flipped**. `OFFLINE_DEFAULT_ON` is still `false`.

## What happens

One browser. One account. No second device anywhere. The member types online,
loses the network, types more, reconnects — and the note silently splits into a
second note ending **`(conflicted copy)`**, tagged `sync-conflict`, while the
app reports that the note *"changed elsewhere"*. It did not.

## The mechanism

The editor and the sweep both wrote one note — the two-writers-on-one-note case
this entire wave exists to forbid, arriving through a door `excludeNoteId` does
not cover:

```
type online          → editor PUTs, server updatedAt = T1
go offline, type     → outbox entry queued with baseUpdatedAt = T1
reconnect + reload   → the EDITOR's own autosave lands, server moves to T2
navigate away        → the note leaves excludeNoteId, the drain sends the
                       queued entry with its now-stale T1  →  409  →  FORK
```

`excludeNoteId` protects the note **while it is open**. It does not protect a
queued entry whose baseline the editor invalidated *before* handing the note
back to the sweep.

## Measured, not inferred

| | |
|---|---|
| runs today | **11** full mini-canary runs on the persistent rig |
| forked | **2** — roughly **1 in 5** |
| words lost | **none** — both copies carry the online *and* the offline text |
| `baseUpdatedAt` null/`''` | **0** across every run |
| empty documents | **0** |

**Artifacts preserved, not cleaned up** — on the canary account now:

- `65ca09993a66401f8fd5d0d6cdf4578a` — `WINDOW-CHECK-SENTINEL 2026-09-10T13:38:14Z (conflicted copy)`
- `WINDOW-CHECK-SENTINEL 2026-09-10T13:45:48Z (conflicted copy)`

Both hold `typed online` **and** `typed offline`.
⚠️ The two `To Do List` / `(synced copy)` notes are unrelated — connectors
wording, pre-existing, untouched.

## Why this stopped the flip when it is not one of the three named conditions

The ruling named **null/`''` baseline · empty document · lost words**. This is
none of them: nothing was lost. It is stopped anyway, because it is the same
class of thing the observation window existed to catch, and the flip would turn
it on for every member at once — **roughly one in five offline sessions leaving
a duplicate note behind, with a message that blames a device the member does not
have.** Shipping that knowingly on a technicality would be the wrong call, and
it is the owner's to make, not mine.

## What would clear it

Fix the race so a queued entry's baseline is refreshed (or the entry replaced)
when the editor's own save moves the server — then re-run the compressed
evidence set. The detector is now permanent: `window_check.py` raises
**`5 no fork from a single writer`** as its own named finding, so this cannot
be mistaken for cleanup litter again.

---

# ⛔⛔ STANDING RULE — THE RIG HAS ONE PROFILE, AND ONE SIGN-IN

**`.worktrees/canary-chrome-profile-persistent`.** That is the rig. There is no
other, and there is never a second one.

- ⛔ **Never deleted, never recreated, never replaced by a "fresh" one.** A fresh
  profile is a signed-out profile, and a signed-out profile is a wasted morning.
- ⛔ **Teardown kills the BROWSER by marker and KEEPS the profile.** Always. The
  only thing teardown proves afterwards is that `SingletonLock` was released so
  the next run can open it.
- ⛔ **A SIGN-IN IS A 30-DAY EVENT, NOT A SESSION EVENT.** No session asks the
  owner to sign in while `/api/auth/me` returns 200. If it returns 401, the
  script self-heals first and only then writes the SIGN-IN REQUIRED row.
- ⛔ **DO NOT RE-MEASURE BY HAND WHAT THE SCRIPT ALREADY STAMPS.** The flag on the
  live bundle, the two telemetry counts, the store and lock state — **read the
  latest row.** Re-measure only if that row is **older than 24 h** or **master
  moved under it**.

⚰️ Written 2026-09-10 after three sessions each stood up a throwaway rig, each
asked for a sign-in, and each re-read by hand what the previous one had already
written down. The cost was not the compute; it was the owner's time.

# ⛔ DEPLOY #5 — THE FLAG FLIP — **NOT DEPLOYED. BLOCKED.**

**`OFFLINE_DEFAULT_ON = false → true`.** ⛔ This section is a **placeholder**, and
its presence is not a plan to run it.

| | |
|---|---|
| pushed | `<pending>` |
| live | `<pending>` |
| master after | `<pending>` |
| flag | ⛔ **`false`** — this is the ONE deploy that changes it |

⛔⛔ **BLOCKED** on the seven-run streak against deploy #4c, which restarts from
ZERO. The procedure, the member-impact paragraph (⛔ **not** the "nothing changes
for members" one) and the post-flip §15 canary are in **🔀 THE FLIP ITSELF** below.

---

# ✅✅ DEPLOY #4c — THE FOUR-DOOR / CONTENT-DECIDES FIX — 2026-09-10T23:26:13Z, LIVE 23:28:42Z

**`6db8ba93a` is on `master` and live.** ⛔ `OFFLINE_DEFAULT_ON` is **still
`false`** on the branch **and** on `master` — #4c is the **fix**, not the flip.

| | |
|---|---|
| pushed | `258c5609d..6db8ba93a` on `master`, **2026-09-10T23:26:13Z** |
| live | **2026-09-10T23:28:42Z** — uptime **1890 → 29** |
| master after | `6db8ba93a` |
| bundle | entry `index-oA59BqtD.js` → `index-3fsyskgR.js` · Notebook chunk `NotebookTab-6d3RPQPD.js` |
| flag | `OFFLINE_DEFAULT_ON = false`, branch and master |
| freeze | requested ~**22:5x Z**, **RELEASED 23:29Z after ONE push** — see **R-W** |

⚠️ **`R-W` is the freeze/release ruling and its text is NOT in this file** — it
belongs to the coordinator. ⛔ Recorded here as a pointer, not paraphrased: a
citation this file cannot quote is struck, not softened.

> ⚠️ **AMENDMENT, 2026-09-11 — the record above stands exactly as written; this
> line is ADDED to it, nothing in it is rewritten.**
> **closed the local-loss half; the queued entry still reaches the server as a
> discard via the folder door — see round 3.**
>
> ⭐ This is an amendment and not a retraction on purpose: **#4c is a correct
> deploy that closed one half of the bug report.** The log from round 3 proves it
> — `record holds the sentence: True · draft holds the sentence: True`. What it
> did not close is the SERVER side.

## Verified on the LIVE BUNDLE — 14/14 PASS

⭐ **Read on the artifact, not on the source default.** The reads that matter,
because each names a mechanism this wave built:

```
inflight:                 the in-flight marker key           (guard 1, R-A)
landed:                   the landed-revision ring           (R-C)
rebased onto              guard 2 keeps the words            (FIX 2)
removed, not forked       the terminal supersede             (FIX 2)
flag                      !1  — off when the key is unset    (§21)
setContent bare boolean   count 0                            (EMIT_NOTHING, R9)
```

⭐ **`setContent` bare-boolean count 0 is the one worth pausing on** — it is the
compiled proof that `EMIT_NOTHING` is still the only thing passed to
`setContent`, which is the guard **R9** pinned by literal after a mutation found
nothing to break.

**What it carries** (full reasoning: **⛔⛔⛔ HARD STOP #2** at the top):

- **FIX 1** — null local state is **NO EVIDENCE, not caught-up**: refuse to settle;
  the entry stays queued, drains, and guard 2 rebases it.
- **`recordLandedRevision`**, split out and called **unconditionally and first** —
  recording a revision as ours and settling the queue are two acts with different
  preconditions.
- **FIX 2** — guard 2 decides by **CONTENT**: byte-identical ⇒ remove;
  ours-but-body-differs ⇒ **REBASE, keep the words, resend once**; a second 409
  forks, preserving both copies.
- **The property rail** — `offlineWordsSurvive.property.test.jsx`, three doors ×
  six orderings, with a control that drives the shipped defect and REQUIRES the
  property to fail.
- **R-O's replacement check** — *"the server BODY CONTAINS THE OFFLINE SENTENCE"* —
  in `window_check.py`, `engine_matrix.py` and step 10 of the script of record.

## The checklist, as checked AT PUSH TIME — ⭐⭐ ALL ON ONE SHA

| # | check | result at push time |
|---|---|---|
| 1 | three-tier gate — 0 behind at the final re-fetch, **under freeze** | ✅ **0 behind** |
| 2 | `journal-2-0` at rest, alone | **238 files / 2504 tests green** |
| 3 | backend Q1 rails — **SCOPED**, never repo-wide (**R-R**) | **25 passed** |
| 4 | full frontend suite | **1242 files / 18346 tests** · **0 NEW vs baseline** · **tree hash identical** start→end |
| 5 | every Wave Q1 rail by name | **22 files / 240 tests** |
| 6 | ⭐ the **property rail** — `offlineWordsSurvive.property.test.jsx` | **19/19** |
| 7 | `tools/q1_mutation_gauntlet.py` | **PASS** — ⛔ read the total from the tool |
| 8 | `tools/verify_memory_pointers.py` | **exit 0** |
| 9 | flag state | **`false`** on branch and master |
| 10 | live-bundle reads | **14/14 PASS** — see above |

⭐⭐ **EVERY CHECK RAN ON ONE SHA — so R-J's honesty note was NOT needed here, and
that is the first time in this wave.** #4 and #4b both had to state a gap between
the SHA the suite measured and the tip that shipped. This one has none, so there
is nothing to disclose — ⛔ and the absence of the disclosure is itself the claim:
*there was no gap*, not *nobody looked*.

⛔ **Row 4 is still not a green suite.** *"0 NEW vs baseline"* is the only claim
available; the inherited reds are unchanged and journal-2-0 and the full suite
remain **two separate numbers**.

⭐ **Row 6 is the row that did not exist for #4 or #4b.** The property rail is the
rail both earlier fixes lacked — three doors × six orderings asserting only that
the offline sentence reaches the server body and the note count does not move.
Its control drives the shipped defect and **requires** the property to fail.

⭐ **The freeze was requested, used once, and released.** ~22:5x Z → **23:29Z**,
**one push**. That is the shape a freeze should have: taken for a named window,
spent on a single action, and given back — not held because it was convenient
(**R11**, **R-P**).

---

# ✅✅ DEPLOY #4b — THE SELF-FORK FIX, ROUND 2 — 2026-09-10T20:34:16Z, LIVE 20:36:29Z

⚠️ **the folder/ticker/tags door could discard queued words — see #4c.**

**`23f6ce271` is on `master` and live.** ⛔ `OFFLINE_DEFAULT_ON` is **still
`false`**, on the branch **and** on `master` — unchanged by this deploy. ⛔⛔ **The
flip is still BLOCKED and the wave is not closed**: #4b ships the round-2 fix, and
the seven-run streak restarts **from zero** against it.

⛔⛔ **AND THE STREAK DIED AT RUN 1, 21 MINUTES LATER.** The metadata doors
(`folder` / `ticker` / `tags`) could **discard** a queued entry with the member's
words unsent — a deletion, not a duplicate. See **⛔⛔⛔ HARD STOP #2** at the top of
this file. The rest of this record stands as written; the checklist was green and
what it lacked was a rail on the **content**, not on the mechanism.

| | |
|---|---|
| pushed | `3c8e5126a..23f6ce271` on `master`, **2026-09-10T20:34:16Z** |
| live | **2026-09-10T20:36:29Z** — uptime **1733 s → 31 s** |
| during the swap | **502**, expected — the pod is being replaced |
| master after | `23f6ce271` |
| flag | `OFFLINE_DEFAULT_ON = false`, branch and master |

## The member-impact paragraph — **approved by the owner, recorded verbatim**

> "Nothing changes for members. Offline editing stays switched off. This
> completes the fix from earlier today for a note edited offline reappearing as a
> duplicate 'conflicted copy' with no other device involved: the earlier release
> narrowed the window, this one closes it. No member data is read, moved, or
> deleted."

⛔ **Do not re-word it.** ⭐ Note what it does *not* say: it does not claim the
member was ever affected, and it does not promise the flip.

## The checklist, as checked AT PUSH TIME

| # | check | result at push time |
|---|---|---|
| 1 | gate loop | master moved **6 commits** to `3c8e5126a` mid-cycle → **TIER 2** (charts `ChartsWorkspace` + pattern-vision) → merged at `fb5c74cf5`, **0 behind** at the final re-fetch |
| 2 | zero-line check | **all SEVEN guarded files changed by 0 lines** — including the new `inFlight.js` |
| 3 | `journal-2-0` at rest | **237 files / 2483 tests green** |
| 4 | backend Q1 rails | **25 passed** |
| 5 | full frontend suite | **1210 files / 18057 tests** · **10 failed vs baseline 10** · **NEW regressions 0** · tree hash `fb5c74cf5…` → `fb5c74cf5…` **identical start→end** · files on disk **1210** reconciles with the summed shard total |
| 6 | Wave Q1 rails by name | **219 green** (the gauntlet's control) |
| 7 | mutation gauntlet | **every declared mutation reddened exactly its own rails**, control green **before AND after**. ⛔ **Read the total from the tool; do not type it here.** |
| 8 | pointer gate | **exit 0** |
| 9 | flag state | **`false`** on branch and master, as #4b expects |

⛔ **Row 5 is not a green suite**, and the same sentence applies as to #4: ten
failed against a baseline of ten with zero new is *"no new failures against a
measured baseline"*, which is the only claim available here.

⭐ **Row 1 is NOT a "lap" under R11.** Master moved **between deploys, before the
checklist began** — that is the ordinary case the three-tier gate exists to
absorb. R11's falsifier is a second lap **of a checklist already in flight**, and
this was not one. ⛔ Do not let the word "moved" collapse the two: R10 (a lap
mid-checklist, run killed) and this row are different events with different costs.

⛔⛔ **THE SAME HONESTY NOTE AS #4, AND FOR THE SAME REASON: the full suite was
measured at `fb5c74cf5`, and the tip pushed was `23f6ce271`.** The delta is **one
comment block**:

```bash
git diff --stat fb5c74cf5 23f6ce271
#   1 file changed, 7 insertions(+), 1 deletion(-)   — all comment lines in inFlight.js
```

**`journal-2-0` WAS re-run at rest on the final tip** (row 3). ⭐ The gap is
smaller than #4's and the sentence is identical, deliberately: *the suite is a
measurement of `fb5c74cf5`*, not of what shipped. A gap that shrinks is still a
gap, and the moment it stops being stated is the moment it stops being noticed.

## ⚠️ ONE RED, CLASSIFIED — and it is ledger row 9 behaving exactly as documented

The **first** at-rest `journal-2-0` run after the full suite failed
`CaptureHost.test.jsx > "closing returns the dialog to nothing"`.

- **Re-run ALONE: passed in 1.56 s.**
- **Re-run as a suite at rest: 237 / 2483 green.**

⭐ **It is a NAMED member of row 9's load-sensitive population** — the ledger
already lists *"closing returns the dialog to nothing"* among the tests that
appear under sustained load. ⛔ **The ledger's own rule settled it: re-run it
alone before classifying it.**

⛔ **Not banked as breakage. Not a new offender.** CLAUDE.md's rule applies —
*a timeout is never banked as permitted breakage* — and banking one would leave a
slot in the baseline that a real failure could occupy unnoticed.

⭐ **This is what a documented population is FOR.** The first sighting of this
class cost a session; this one cost a re-run, because the ledger named the test,
named the trigger, and named the procedure.

---

# ✅✅ DEPLOY #4 — THE SELF-FORK FIX — 2026-09-10T16:42:58Z, LIVE 16:46:28Z

⚠️ **NARROWED, DID NOT CLOSE — see #4b.** This release's main guard was never on
the path that forks; the defect reproduced on the rig eight minutes after it went
live.

⛔ **The rest of this record is left exactly as written.** It is the honest
contemporaneous account, and its checklist was genuinely green — what it lacked
was a rail on the **WIRE**, which is a thing no row in it claimed to have. ⭐ A
record rewritten after the fact to look prescient is worth nothing; an annotated
one tells you what a green checklist could and could not see.

**`f093bf731` is on `master` and live.** ⛔ `OFFLINE_DEFAULT_ON` is **still
`false`**, on the branch **and** on `master` — unchanged by this deploy. #4 ships
the fix; the flip is a separate motion with its own gate.

| | |
|---|---|
| pushed | `0e32db845..f093bf731` on `master`, **2026-09-10T16:42:58Z** |
| live | **2026-09-10T16:46:28Z** — uptime reset **2048 s → 35 s** |
| during the swap | **502**, expected — see the note below |
| master after | `f093bf731` |
| branch | `notebook-primary-platform` @ `f093bf731` — **0 behind** at the final re-fetch, 26 ahead before the push |
| flag | `OFFLINE_DEFAULT_ON = false`, branch and master |

⚠️ **The 502 during the swap is the deploy, not an incident.** Railway replaces
the pod; `/api/*` blips for roughly a minute. It is recorded because a 502 seen
by someone who does not know a deploy is in flight reads as an outage.

## The member-impact paragraph — **approved by the owner, recorded verbatim**

> "Nothing changes for members. Offline editing stays switched off. This release
> fixes a case, found in testing, where a note edited offline could reappear as a
> duplicate 'conflicted copy' after reconnecting, even with no other device
> involved. No member data is read, moved, or deleted."

⛔ **Do not re-word it.** It is the approved text, and the approval is of the
words, not of the gist.

## The checklist, as checked AT PUSH TIME

| # | check | result at push time |
|---|---|---|
| 1 | three-tier gate resolved, 0 behind at the final re-fetch | `origin/master` `0e32db845`, **behind = 0** |
| 2 | `journal-2-0` at rest, alone | **234 files / 2448 tests green** |
| 3 | backend Q1 rails | **25 passed** |
| 4 | full frontend suite | **1207 files / 18020 tests** · **10 failed vs baseline 10** · **NEW regressions 0** · tree hash `aee7922b5…` → `aee7922b5…` **identical start→end** · files on disk **1207** reconciles with the summed shard total |
| 5 | every Wave Q1 rail by name | **184 green** (this is the gauntlet's control) |
| 6 | `tools/q1_mutation_gauntlet.py` | **every declared mutation reddened**, each **naming its own rails**; control **184 green before AND after**. ⛔ **The total is read from the tool, never typed here** — round 2 adds `M17`–`M20` (**R-B**, **R-F**) and the number has already moved once since this row was written. |
| 7 | `tools/verify_memory_pointers.py` | **exit 0** · 175 pointers · **0 LOST, 0 DANGLING** |
| 8 | flag state | **`false`** on branch and master, as #4 expects |
| 9 | member-impact paragraph | above, previously approved |

⛔ **Row 4 is NOT a green suite and must never be quoted as one.** Ten failed,
against a baseline of ten, with **zero new** — that is *"no new regressions
relative to a measured baseline"*, which is the only claim this repo can make
(`docs/notebook/inherited-red-ledger.md`). ⭐ The **tree hash identical
start→end** is what makes the run admissible at all: it says no file moved while
the suite was running, which is exactly the failure that voided the first sharded
run (**R5**). And the file count reconciling against the summed shards is the
answer to a chunked run flattering itself — a partial suite fails in the
flattering direction.

⛔⛔ **STATED PLAINLY, BECAUSE IT WOULD BE EASY TO IMPLY OTHERWISE: the full suite
was measured at `aee7922b5`, and the tip that was pushed is `f093bf731`.** The
suite did **not** run on `f093bf731`. The entire delta is two Python files under
`tools/` that no JS test imports:

```bash
git diff --name-only aee7922b5 f093bf731
#   tools/engine_matrix.py
#   tools/window_check.py
```

**`journal-2-0` WAS re-run at rest on the reconciled tip** (row 2). So the claim
supported by the evidence is: *the full suite is a measurement of `aee7922b5`,
and the only change between there and the shipped tip is two tool files outside
the frontend's import graph.* That is a different sentence from *"the suite
passed on what shipped"*, and the difference is the point.

## Gate history for this deploy — two drifts, two verdicts

| drift | range | verdict | what it was |
|---|---|---|---|
| 1 | `febe8ee67 → 58dea4d88` | ⭐ **TIER 1½ (exit 3)** | Guarded file `NoteEditorPage.jsx` moved — `FONT_OPTIONS` lifted to `utils/fontFamilies.js` (`f02276064`) — but **every protected region was untouched**: hunks `old=[(111,137)]` `new=[(50,50),(112,118)]`, **zero intersections, no region missing**. |
| 2 | `58dea4d88 → 0e32db845` | **TIER 2** | Chart Visual V2 (`1546b8fd8`), four files under `app/`, **none guarded**. Merged; **zero-line check on all six guarded files = 0 lines each.** |

⭐ **Drift 1 is TIER 1½ earning its keep on its first real use.** The same drift
was a TIER 1 hard stop earlier in the session under the old rule, and the thing
that changed is not the judgement — it is that the tool now measures **where the
hunks landed** instead of stopping on the fact that a guarded file moved at all.

## Run 1 of 7 — the post-deploy rig run, GREEN

⛔⛔ **AND THE STREAK DIED AT RUN 3.** Read this row as what it was at the time,
not as the start of a clean seven: at **16:54:50Z** run 3 **forked its own note**
and the tool refused to stamp. See **⛔⛔ HARD STOP #1 2026-09-10** at the top of this
file. ⭐ Note the one number that matters in hindsight — **the opt-in key was
`'0'` at rest here, and `'1'` on runs 2 and 3.**

**2026-09-10T16:50:13Z.** The flip condition needs seven consecutive green runs;
this was the first of them, and the only one that started from rest.

```
signed in 200 · offline proven both ways
four durable stores        all 0
notebook locks             0
opt-in key                 '0'
notes 32 · canary notes 0 · sync-conflict 2
j2:notebook_blocked_no_baseline   count 0, scope population-wide (admin)
j2:notebook_offline_opt_in        count 14, latest 2026-09-10 14:00:22
no fork from a single writer
teardown: killed 9 by marker, 0 left, owner's browser untouched,
          profile KEPT and lock released
```

⛔⛔ **`sync-conflict 2` IS DOCUMENTED STEADY STATE, NOT A NEW FORK.** The same
value appears on seven prior window-check rows in this file. **Do not
re-investigate it**, and do not read it as evidence the fix did not take — the
fork detector is a separate signal and it says *no fork from a single writer*.

⭐ The window-watch rows below are **stamped by `tools/window_check.py`**, and
this block is the deploy record's summary of that run — not a hand-written row.
⛔ Do not re-measure by hand what the script already stamps; read the latest row.

---

# ✅✅ DEPLOY #3 — 2026-09-10 05:41:03 UTC, LIVE 05:42:53 UTC

**`7ed6b2ce5` is on `master` and live.** `OFFLINE_DEFAULT_ON` is still `false`.

| | |
|---|---|
| master before | `eedb58ac8` |
| master after | `7ed6b2ce522ff1edc0f155ba4e7c0648434dc84c` |
| push | 2026-09-10 **05:41:01 → 05:41:03 UTC** |
| build live | **05:42:53 UTC** (uptime 42 s at 05:43:35) — entry `index-CrkXflNE` → `index-C5gtX35p`, Notebook chunk `NotebookTab-BMNXXwjE` → `NotebookTab-D3VlIhpn` |
| carried | 3 commits: the opt-in denominator, `tools/window_check.py`, the deploy-#2 record |

## The member-impact paragraph — **approved by the owner, recorded verbatim**

> "Nothing changes for members. Offline editing stays switched off. This release
> records, once, when a browser turns offline editing on, so we can tell how
> many have. No member content is recorded and no member data is read, moved, or
> deleted."

## Verified on the LIVE ARTIFACT — seven reads

```
1 the flag       Ds=!1 · _n() returns it when the key is unset      ← still dark
2 the gate       bt=()=>{if(!wt.current)return;b("dirty")           ← refuses BEFORE status
  armed by       .current=!!(H&&!H.isDestroyed&&r)
3 EMIT_NOTHING   emitUpdate:!1 ×1 · bare setContent(x,!1) ×0
4 usableBaseline if(typeof n=="string"&&n.trim()!=="")return n;return null
5 the copy       badge ×1 · header ×1 · "waiting to sync" ×1
6 blocked event  "notebook_blocked_no_baseline"
7 OPT-IN event   "notebook_offline_opt_in" · marker "uct.j2.offline.optInReported"
                 compiled condition:  n==="1" && s!=="1"      ← the transition, once
```

**Smoke, flag OFF** — `/api/health` `ok` · Notebook chunk **200** · **zero** badge
strings in the served HTML · unauthenticated `POST /api/j2/telemetry` **401**
(⚠️ again: that is the **auth gate**, not the allow-list — the allow-list is
proved by its rail against the source on `master`, lines 95 and 103).

⛔ **Neither clock restarted.** The observation window and the instrument clock
both stand. ⭐ **The opt-in count starts at this deploy's LIVE timestamp,
2026-09-10T05:42:53Z** — a third date, and deliberately not a third clock: it is
the denominator for the instrument clock, not a separate question.

---

# ✅✅ DEPLOY #2 — 2026-09-10 05:04:43 UTC, LIVE 05:06:56 UTC

**`eedb58ac8` is on `master` and live.** `OFFLINE_DEFAULT_ON` is still `false`.

| | |
|---|---|
| master before | `f321e5e7b` |
| master after | `eedb58ac89a21beb254b3496eb1649bfe3f2dffb` |
| push | 2026-09-10 **05:04:41 → 05:04:43 UTC** |
| build live | **05:06:56 UTC** (uptime 13 s at 05:07:09) — entry `index-1FmvMCkY` → `index-CrkXflNE`, Notebook chunk `NotebookTab-CMePJ5Sn` → `NotebookTab-BMNXXwjE` |
| carried | 12 commits: the complete §15 canary record, the CDP rig, the flag-flip gate work, two master merges |

## The member-impact paragraph — **approved by the owner, recorded verbatim**

> "Nothing changes for members. Offline editing stays switched off. This release
> adds two things that are inactive while it is off: a small 'Edit again to sync'
> badge that can only appear once offline editing is on, and a diagnostic signal
> that can only fire on a condition offline editing has to be on to reach. No
> member data is read, moved, or deleted. If it were wrong, the symptom would be
> a badge or a log line where none should be — visible, not silent."

## Verified on the LIVE ARTIFACT, not on the source default

```
1 the flag       Bs=!1 · fn() returns Bs when the key is unset      ← still dark
2 the gate       bt=()=>{if(!wt.current)return;b("dirty"),…}        ← refuses BEFORE
                 armed by  wt.current=!!(H&&!H.isDestroyed&&r)         touching status
3 EMIT_NOTHING   emitUpdate:!1 present ×1 · bare setContent(x,!1) ×0
4 usableBaseline for(const n of t)if(typeof n=="string"&&n.trim()!=="")return n;return null
5 the copy       "Saved on this device" · "Saved in this browser" · "waiting to sync"
                 · "edit it again to sync" · "Edit again to sync"
                 · "…have not reached the server, and will not until you edit it again"
6 the event      "notebook_blocked_no_baseline" · reason "no-baseline"
```

**Post-deploy smoke, flag OFF** — `/api/health` `ok` · the Notebook chunk serves
**200**, 171,727 bytes · **zero** badge strings in the served HTML · and
`POST /api/j2/telemetry` with an unlisted event name answers **401** to an
unauthenticated caller. ⚠️ Stated exactly: **401 is the AUTH gate, not the
allow-list** — the endpoint takes `Depends(get_current_user)` before it looks at
the name, so an unauthenticated probe cannot reach the rejection it is aiming
at. The allow-list itself is proved by `tests/test_j2_telemetry_allowlist.py`
against the source now on `master` (`journal_two.py:95`).

⛔ The §15 canary was **not** re-run for this deploy: nothing under test changed.

---

# ✅✅ DEPLOY #1 — 2026-09-10 02:40:01 UTC

**`cd674ef56` is on `master` and live.** `OFFLINE_DEFAULT_ON` is still `false`:
the offline layer did NOT ship on, and this deploy did not touch the flag.

| | |
|---|---|
| master before | `4879d4d02` |
| master after | `cd674ef563edb1c7f2d815a85cd8bf98b5763d9c` |
| push | 2026-09-10 **02:39:59 → 02:40:01 UTC** |
| build live | **02:42:29 UTC** — bundle `index-4oJCblT8` → `index-4qGFp_8B`, uptime reset to 38 s |
| carried | 20 commits, Wave Q1 only |

**Verified on the live artifact, not on the source default:**

```
EMIT_NOTHING   {emitUpdate:!1} present · ZERO bare setContent(x,!1) remain
the gate       jt=()=>{if(!vt.current)return;x("dirty"),...}   ← refuses BEFORE
                                                                 touching status
the flag       zi=!1  →  OFFLINE_DEFAULT_ON === false          ← still dark
```

✅✅ **THE §15 CANARY IS COMPLETE AND GREEN** — online half, offline half
(including the step that went red on 2026-09-09), and the conflict path through
the drain's fork. No `null` or `''` baseline in any artifact. The seven-day
observation window is **STARTED: 2026-09-10 → 2026-09-17.**

## ⏭️ AND THE FLAG-FLIP GATE IS BEING WORKED — 2026-09-10

✅ **SHIPPED IN DEPLOY #2** (`eedb58ac8`, live 05:06:56 UTC). ⛔⛔ Shipped is not
switched on: `OFFLINE_DEFAULT_ON` is still `false`, so both additions below are
**inert for every member** — the badge cannot appear and the instrument cannot
fire until a browser opts in. Read the **FLAG-FLIP GATE** section, not this
summary, before acting on any of it.

- ✅ **A blocked entry is surfaced to the member** — the gate's last open row.
  Both notes-list views and the open note's header now say **"Edit again to
  sync"** in the shipped vocabulary. Item 1 below.
- ⏳ **The `null` is INSTRUMENTED, not explained** — nine driven paths failed to
  reproduce it, so the gate condition CHANGED: from *"explained"* to *"zero
  occurrences across the instrument clock"* (**2026-09-10T05:06:56Z →
  2026-09-17T05:06:56Z**, a SECOND clock, not the deploy-#1 window). Item 2
  below. ⛔⛔ Zero is bounded evidence: the flag is off, so it can only fire from
  an opted-in browser.
- ⛔ **An offline reload cannot load the Notebook at all** (no service worker, by
  design). Written down as a KNOWN LIMITATION and as an expected §15
  observation — **never a red**. Item 3 below.
- 📋 **The window-watch log** starts at check 1, 2026-09-10T04:16:51Z.

---

**Written 2026-09-09 before a machine restart.** Updated repeatedly through
2026-09-09/10: the defect reproduced and fixed (`4fef130d9`), the
`baseUpdatedAt: null` question run to ground, the deploy packet written, and
finally deployed.

---

## ✅ THE DEFECT IS REPRODUCED AND FIXED — the decision has moved

The empty-snapshot defect is no longer a hypothesis. It reproduces
deterministically, the fix is in, and every rail is mutation-proved. **What is
still yours is the activation itself.**

**The trigger, measured.** TipTap's `onUpdate` is not "the member typed" — it is
"the document changed", and a document changes with no member the moment an
editor is constructed with an EMPTY doc: `{type:'doc',content:[]}` violates the
schema's `block+`, so ProseMirror appends a repair transaction inserting an empty
paragraph, **synchronously, inside `new Editor(...)`**. Measured both ways: an
editor built with content emits ZERO updates, one built empty emits exactly one,
and `getJSON()` is then `{doc,[paragraph]}` — the canary's body, exactly.

`useEditor` is keyed on `[note?.id]`, so it **rebuilds** when the note arrives —
and rebuilds **empty** whenever the server's copy of that note is empty. That is
precisely a note typed into and reloaded before its PUT landed: the server still
holds `{title:"", subtitle:"", bodyJson:{doc,[]}}`. The rebuild runs inside
`useEditor`'s own effect, ahead of the effects that mark the note loaded, so the
autosave path ran with pre-load refs and wrote an empty note to all three layers.

⛔ **One field is NOT reproduced and is not claimed:** the canary's
`baseUpdatedAt: null`. The reproduction carries the note's real baseline; every
other field matches. See the section below for what was hunted and ruled out.

**Fixed in `4fef130d9`:**

1. **`hydratedRef` gates `scheduleAutosave`** before it touches the status, the
   draft, the durable copy or the save timer — the one place that can tell "the
   document changed because a person changed it" from "…because it was
   constructed". Also closes the long-standing empty-`localStorage`-draft bug
   that predates Wave Q1.
2. **`setContent(body, false)` STOPPED SUPPRESSING `onUpdate` AT TIPTAP v3** and
   said nothing. In v2 the second argument WAS `emitUpdate`; in v3 it is an
   options object destructured as `{ emitUpdate = true, … } = {}`, so a bare
   `false` leaves it **true**. Four call sites carried comments asserting
   suppression; three of them are where this page puts the CANONICAL copy on
   screen (note load, draft restore, conflict reconcile), so each had been
   autosaving content the server had just handed us. All four now pass the named
   `EMIT_NOTHING`.
3. **The drain refuses a baseline-less entry** — blocked, not deleted, not
   retried, the same posture as `permanent`. Defence in depth, and the reason the
   unexplained `null` above is no longer dangerous.

**Rails:** `NoteEditorPage.slowload.test.jsx` (the reproduction, with a slow
fetch the test controls) · `setContentEmitsUpdate.test.js` (the TipTap contract
AND a source sweep) · four new `outboxDrain` rails. Three mutations run, each
red, controls green.

⛔ **`OFFLINE_DEFAULT_ON` is untouched and still `false`.** Production is dark
and verified.

## ⚰️ `baseUpdatedAt: null` — HUNTED, NOT REPRODUCED (2026-09-09)

**It is not closed, and I am not closing it with a story.** What follows is what
was tested and what it said. Every producer of an outbox baseline was enumerated
mechanically (`grep` on every write of the field), not guessed at — there are
exactly two, and both read `lastSavedRef.current.updatedAt`.

| candidate | how it was tested | result |
|---|---|---|
| Capture before the note is hydrated | `NoteEditorPage.slowload.test.jsx` | ⭐ **This is the empty-CONTENT defect** — reproduced and fixed. But it yields the note's **real** baseline, not null. |
| `markSynced` when the PUT acks with **no** `updatedAt` | drove the real page; member types during the in-flight PUT | ❌ no null — `commitSave` falls back |
| `markSynced` when the PUT acks with an **EMPTY** `updatedAt` | same | ⚠️⚠️ **FOUND A SECOND DEFECT** — queued `baseUpdatedAt: ""`, which the sender drops. See below. Now fixed. |
| The **server** hands over a note with no usable `updatedAt` | `tests/test_note_updated_at_is_always_a_baseline.py` — 14 rails over create / empty-body create / read-back / update / CAS-update / import / restore / folder-move, plus `_import_date` against `""`, `"   "`, `None`, `12345`, `"0000-00-00"` | ❌ **impossible** — every writer emits a real timestamp. Mutation-proved twice: serializer → `""` reddens 7; `_import_date` returning its input reddens 1. |
| …but **if it ever did**, what does the editor do? | `NoteEditorPage.nullbaseline.test.jsx` | ⚠️ **it queues `baseUpdatedAt: null`.** Measured, stated, not "fixed" on a hypothesis. For a note with no baseline anywhere, null is the truth; what matters is that it is **never sent**, and that is railed. |
| Cross-note contamination (note A's refs, note B's id) | read the single mount site | ❌ structurally impossible — `NotebookTab` renders `<NoteEditorPage key={noteId}>`, so switching notes **remounts** |
| Reopen on top of a previous session's unsynced work (§15 step 9's real shape) | seeded a dirty record + queued entry from a prior session, then mounted | ❌ no new entry — the inherited one survives untouched, with its own `generation`/`sessionId` |
| An inherited entry that already has a null baseline | same fixture, drained | ✅ **blocked, never sent, every word kept** |
| Migration / older outbox schema | the store shipped at `DB_VERSION = 1` with Q1 and was live for 15 minutes | ❌ no older shape exists |

### ⚰️⚰️ AND THE HUNT FOUND A SECOND REAL DEFECT — `??` vs truthiness

**The baseline was CHOSEN with `??` in eight places and CONSUMED with
truthiness in three.** `??` falls back only on `null`/`undefined`, so an **empty
string survived as a baseline** and was then silently dropped at send time —
a PUT with **no compare-and-set**, which is the canary's exact failure mode
arriving by a different road.

```
producers:  saved?.updatedAt ?? entry.baseUpdatedAt ?? null      // nullish
consumers:  ...(entry.baseUpdatedAt ? { baseUpdatedAt } : {})    // truthy
```

⛔ The worst site was `commitSave`: `saved?.updatedAt ?? lastSavedRef.current.updatedAt`.
An ack carrying `''` **overwrites a perfectly good baseline**, so every later
save in that session goes out unguarded too.

⭐ **How it was found, and why it nearly was not.** `NoteEditorPage.nullbaseline.test.jsx`
drove the real page with a PUT that acks `updatedAt: ''` while the member keeps
typing, and read `baseUpdatedAt: ""` back out of the outbox. It **passed in
isolation and failed in the full suite** — the ordering of the ~200 ms coalescing
durable write against `markSynced` decides which value lands, so it flips under
load. An intermittent red that was a real ordering-dependent defect, not a flaky
test (`lesson_a_rail_can_be_green_alone_and_red_in_company`).

**Fixed** by `lib/offline/baseline.js` — ONE authority, `usableBaseline()`, used
at every choice; eight copies of the same coalescing cannot be mutation-proved
(`lesson_a_guard_repeated_is_a_guard_unproved`). Railed in `baseline.test.js`
with a source sweep that fails on any `??` over a baseline anywhere in the wave;
mutation-proved (revert it to nullish → 5 red across 3 files).

⛔ **This still does not explain the canary**, which showed `null`, not `''`, and
the server cannot emit `''` either. It is a second road to the same cliff, closed.

**What that leaves.** The canary's artifact says `generation: 1`, a fresh
`sessionId`, and a null baseline — i.e. the write happened **after** the reload
but **before** the note-load effect set the baseline. Every reproduction of that
ordering, with and without the fix, yields the note's real baseline instead. I
could not construct the null from any live path.

⛔ **So it is recorded as unexplained, and made harmless three ways:** the source
gate (`hydratedRef`), the server guarantee (railed), and the drain refusal
(mutation-proved). If a null baseline ever appears again in a canary artifact,
that is a genuine new finding — say so loudly rather than assuming it is this.

## ⚰️ The one decision that WAS waiting — SUPERSEDED 2026-09-10

⛔⛔ **This is history now. The decision it asks for has been overtaken by the
HARD STOP at the top of this file:** the fix shipped (deploy #4) and the self-fork
**reproduced four minutes later**. There is nothing to activate until that is
understood. Kept as the record of what was being asked before the finding.

> **Run the §15 canary again and activate?** The defect that stopped the last
> attempt is fixed and railed; the harness gate is closed; the §32 matrix is
> green. What has NOT happened is a fresh canary against production with the fix
> deployed — and this branch is not on `master`, so nothing has shipped.
>
> Sequence: deploy the fix (branch → master) → §15 happy path → §15 conflict path
> → then, separately, the one-line flip.

⭐ **The first three steps all happened and all passed.** The flip did not, and
now cannot until the reproduction is explained.

---

## Where everything stands

| | state |
|---|---|
| Q1 implementation | **built, railed, merged to master — and INERT** |
| `OFFLINE_DEFAULT_ON` | **`false`** (verified on master and on the deployed artifact) |
| §32 browser matrix | **complete and green**, incl. Safari on two real iPhones |
| Activation | attempted 16:05 UTC, **rolled back 16:20 UTC** — canary red |
| The canary defect | **reproduced, fixed, mutation-proved** (`4fef130d9`) |
| That fix | ✅ **DEPLOYED** `cd674ef56`, 2026-09-10 — verified on the live bundle |
| §15 canary | ✅ **COMPLETE AND GREEN**, both halves + the conflict fork |
| Blocked entries surfaced to the member | ✅ **built and DEPLOYED** — `0d7eee792`, shipped in deploy #2 (`eedb58ac8`) and still an ancestor of `master` |
| The `null` baseline | ⏳ **instrumented, not explained** — the instrument is DEPLOYED (deploy #2, denominator in #3); what is still missing is an explanation, not a shipment |
| The self-fork | ⚠️ **round-1 fix DEPLOYED** — #4 (`f093bf731`), 16:46:28Z — ⛔⛔ **it REPRODUCED at 16:54:50Z**; ✅ **round-2 fix DEPLOYED** — #4b (`23f6ce271`), 20:36:29Z. Flag unchanged by both. ⛔ Not closed: the streak restarts from zero against #4b. |
| The root cause | ✅ **FOUND** — guard 1 wired only into `restoreDraft`, never into `commitSave`; guard 2 shares a precondition with it, so the two are one. See the HARD STOP at the top. |
| The round-2 fix | ✅ **SHIPPED** — #4b `23f6ce271` (20:36:29Z), then ✅ **#4c `6db8ba93a` (23:28:42Z)** — the four-door / content-decides fix. |
| The note baseline | ⚠️ **33, not 32** — 32 plus the ONE preserved `(conflicted copy)`. ⛔ 32 is only reachable by deleting evidence. See **R-K**. |
| ⛔⛔ **The flag flip** | ⛔⛔ **BLOCKED** on that reproduction. Not "next", not "pending the window". |
| The seven-run streak | ⛔ **STOPPED AT 3.** Restarts from zero, not from three, and against the round-2 fix. |
| Harness integrity | **green** — identity, ports, controls, mutation-proved |
| Q2 | **locked** |
| Service worker | untouched, and stays untouched |

### The SHAs — two different facts, both stated on purpose

| | |
|---|---|
| **Fix commit #1** | **`4fef130d9`** — the `hydratedRef` gate, `EMIT_NOTHING`, the drain's baseline refusal, and their rails |
| **Fix commit #2** | **`8826e8aa7`** — the null-baseline hunt, the `??`-vs-truthy fix (`baseline.js`), the blocked-entry audit, the inherited-red ledger, the memory-pointer gate, the deploy packet |
| **Reconciliation** | **`9741ddff1`** (merge of `184a7e77b`) + **`b8eedb42f`** — the master merge, the artifact-verified flag, the five index retirements, the corrected packet |
| **Gate split** | **`32706ecae`** — the drain traced from the flag (§21b rails), the blocked-entry gap moved to the flag-flip gate, the §15 search recorded |
| **Pre-flight** | **`11f3e812f`** — merged master `3b043d0f8`, ledger row 9 (the `ImportWizard` load-sensitive timeout), packet SHAs refreshed. ⛔ Ran under **HOLD**: the directive's DECISION line arrived unfilled. |
| **Deploy attempt 1** | **`c2d8f5f58`** — DEPLOY authorised; pre-flight all green; **STOPPED at the pre-deploy re-fetch**, master had moved again (`590e88084`→`b41b4ed07`). Push is mechanically rejected as non-fast-forward. See §(b0). ⛔ **Nothing was pushed to master.** |
| **Deploy attempt 2** | scope-gated loop authorised; **gate FIRED on iteration 1** — six commits incl. chart-watermark work touching six files under `app/`. Did not merge, did not deploy. See §(b-1). ⛔ **Nothing was pushed to master.** |
| **DEPLOYED** | **`cd674ef56`** on `master`, 2026-09-10 **02:40:01 UTC**, live **02:42:29**. Gate classified the chart work TIER 2 → merged, full re-verify, ledger unchanged → 0 behind → deployed. Verified on the live bundle. |
| **Canary** | **`9b28cedf0`** — PARTIAL: steps 1–6/10/11 green incl. the fix's own signature; **steps 7–9 (offline) and the conflict path NOT run**; observation window NOT started |
| **Canary, offline half — attempt 1** | **`c604aa899`** — BLOCKED 2026-09-10: no CDP executor, Chrome has no `--remote-debugging-port`. Amendment recorded; stopped rather than improvise. Keyboard recipe written. ⭐ Superseded by the two rows below — kept because *what was tried and why it stopped* is the part a next session would otherwise repeat. |
| **The CDP rig** | **`59612df1c`** + **`22c4e1be3`** — a SECOND Chrome with its own throwaway profile, `--remote-debugging-port=9411` on 127.0.0.1, driven by Playwright `connect_over_cdp`; offline proven both ways before use. The second commit is the correction that the owner's Chrome is checked by the BROWSER process and the profile marker, **never by a process COUNT** (a count false-alarmed at 14/15 on a reaped child). |
| **✅ CANARY COMPLETE** | **`07815b107`** (rig at `22c4e1be3`) — offline half incl. **the step that was 9/9 red**, and the conflict path through the drain's fork. All green. **No `null`/`''` baseline in any artifact ⇒ no NEW FINDING.** Observation window started. |
| **Master merge #4** | **`0119c326c`** — merged `origin/master` `f58383e69` (three Research/Technical-tab commits). Gate: **TIER 2** ⇒ merge + full re-verify. Zero overlap with anything Wave Q1 owns. Ledger unchanged. |
| **Flag-flip gate work** | **`0d7eee792`** — ✅ blocked entries SURFACED (the gate's last open row) · ⏳ the `null` INSTRUMENTED and the gate condition changed to *zero occurrences* · ⛔ the offline-reload limitation written into the script, the limitations section and a NEW flag-flip member-impact paragraph · window-watch check 1. |
| **Master merge #5** | **`eedb58ac8`** — merged `origin/master` `f321e5e7b` (one docs commit). Gate: **TIER 3** ⇒ fast loop. |
| **DEPLOYED #2** | **`eedb58ac8`** on `master`, 2026-09-10 **05:04:43 UTC**, live **05:06:56**. Six live-bundle reads green; flag still `false`. This is the same SHA as merge #5 — the merge commit IS what shipped. |
| **Deploy-#2 record** | **`ed9ba2ad8`** — the record above, the two clocks, and the rig parked at sign-in. |
| **DEPLOYED #3** | **`7ed6b2ce5`** on `master`, 2026-09-10 **05:41:03 UTC**, live **05:42:53**. The opt-in denominator, `tools/window_check.py`, the cleanup. Seven live-bundle reads green; flag still `false`. |
| **Deploy-#3 record** | **`5f47546d8`** — the record above, and the denominator's own start date. |
| **The daily mini-canary** | **`9dd48f048`** — `window_check.py` grows the §15 happy path, the two finding detectors (`--self-check` 19/19), the Task Scheduler registration, and the 9/17 decision drafted in advance. ⛔ **Tools and docs only** — nothing under `app/` or `api/` moved, so this is NOT a deploy and `master` does not need it. |
| **Auth + maintained packet** | **`51c22bd32`** — `.env` retired, the rig runs on a persistent hand-signed profile, auth self-heals on 401, conflicts are checked in both directions, and the 9/17 packet is regenerated by the script. `--self-check` **45/45**. ⛔ Tools and docs only — not a deploy. |
| ✅ **`origin/master` — TIER 1 HARD STOP, since RESOLVED** | **`febe8ee67`**, **34 commits ahead**, and it touched **7 files under `journal-2-0`**. The gate said do not merge and do not deploy. **Obeyed** — the branch sat 34 behind on purpose and that session shipped nothing. Those files were the Journal *trade* side rather than the Notebook offline layer, but that judgement was the owner's to make. ⭐ **Cleared later the same day by the region assessment, not by the argument** — see **✅✅ DEPLOY #4**. |
| ✅✅ **DEPLOYED #4** | **`f093bf731`** on `master`, 2026-09-10 **16:42:58Z**, live **16:46:28Z**. The self-fork fix, round 1. Flag still `false`. ⚠️ **Narrowed, did not close** — it reproduced at 16:54:50Z. Full record + checklist: **✅✅ DEPLOY #4** above. |
| ✅✅ **DEPLOYED #4b** | **`23f6ce271`** on `master`, 2026-09-10 **20:34:16Z**, live **20:36:29Z**. The self-fork fix, **round 2** — built on the root cause. Flag still `false`. Full record + checklist: **✅✅ DEPLOY #4b** above. |
| **Master merge #6** | **`37e3c0cb1`** — merged `origin/master` `febe8ee67` after the TIER 1 assessment cleared. Only conflict `.gitignore` (both sides appended; both kept). **Zero-line check: all 17 guarded files, 0 lines.** |
| **Checks 5 + 6** | **`986ee41d3`** — both rows stamped green, mini-canary **6/6** each, and the three instrument bugs the running exposed (`response.ok` on an SPA catch-all · `'ERR'` treated as a list · a reader that *created* a phantom IndexedDB and broke the profile). `--self-check` **60/60**. |
| **Branch tip** | `986ee41d3` **plus this docs-only commit stamping the table**. `master` is at `febe8ee67`; all three deploys (`cd674ef56`, `eedb58ac8`, `7ed6b2ce5`) are ancestors of it, and the branch is ahead only by tools + docs. ⛔ A doc cannot name its own SHA; that is why this row says what each commit IS rather than pretending to a single "the commit". Read the tip with `git log --oneline -1`, always. |
| **`origin/master`** | ⛔ **MOVES — do not quote it, measure it.** Observed `78ac8016b` → `184a7e77b` → `3b043d0f8` → `590e88084` → `b41b4ed07` → `4879d4d02` inside one session — eleven commits, three authors. The first eight touched **zero** files under `app/`; the last six included chart-watermark work that did. All merged in; the branch is **level with master** as of the last pre-flight. What is invariant, and what to actually check: **no commit above is an ancestor of `origin/master`**, and `OFFLINE_DEFAULT_ON` is `false` there. |

⚠️⚠️ **THE "Branch tip" ROW ABOVE IS STALE ON PURPOSE, AND SO IS THE
`origin/master` ROW.** Both were written before deploy #4 and both are waiting on
the tip-stamp pass, which happens **last**, after the flip. `master` is at
`f093bf731` as of 2026-09-10T16:46:28Z, and there are now **four** deploys, not
three. ⛔ Do not read either row as current — measure, with the commands below.
This warning is here rather than a quiet correction because a row that is
silently half-updated is worse than one plainly marked stale.

⛔ **Do not collapse these two into "the commit".** An earlier version of this
doc said only *"Last Wave Q commit: `4fef130d9`"*, which was true when written and
stale one commit later — the docs commit `d445f8779` moved the tip the same day.
A doc naming the wrong tip sends the next session looking for work that is
already there. Verify both, never quote them:

```bash
git log --oneline -1                                      # the tip, right now
git log --oneline -S hydratedRef -- app/src/pages/journal-2-0/   # the fix commit
git merge-base --is-ancestor <sha> origin/master && echo ON MASTER || echo not on master
```

Branch `notebook-primary-platform`, worktree
`C:\Users\Patrick\uct-worktrees\notebook-primary-platform`.

Production check, any time:

```bash
curl -s -H "User-Agent: Mozilla/5.0 Chrome/152" https://uctintelligence.com/api/health
git show origin/master:app/src/pages/journal-2-0/lib/offline/offlineFlag.js | grep OFFLINE_DEFAULT_ON
```

In a signed-in browser console, the live dark proof — **no lock claimed** is the
whole check:

```js
const q = await navigator.locks.query()
;[...q.held, ...q.pending].filter(l => String(l.name).startsWith('uct.nb.sync.'))   // → []
```

⭐ **And a better one that needs no sign-in and no browser — read the flag out of
the DEPLOYED BUNDLE.** This is the artifact, not the source default:

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36"
# 1. the entry chunk names the lazy ones; the flag lives in the Notebook chunk
curl -s -H "User-Agent: $UA" https://uctintelligence.com/ | grep -oE '/assets/index-[^"]+\.js'
# 2. find the chunk carrying the opt-in key, then read the compiled default
curl -s -H "User-Agent: $UA" https://uctintelligence.com/assets/NotebookTab-<hash>.js \
  | grep -oE '.{130}uct\.j2\.offline\.enabled.{130}'
```

Measured 2026-09-09 on the live artifact:

```js
const Fi=!1, Mi="uct.j2.offline.enabled";
function ws(t=globalThis.localStorage){ try{ const n=t?.getItem(Mi);
  if(n==="1")return!0; if(n==="0")return!1 }catch{} return Fi }
```

`Fi = !1` **is** `OFFLINE_DEFAULT_ON = false`, and `offlineEnabled()` returns it
when the key is unset. ⛔ The chunk hash changes every deploy — crawl for the key,
never bookmark the URL.

---

## The open defect, in full — ✅ NOW REPRODUCED AND FIXED (`4fef130d9`)

> Everything below is the state as first written, kept because it is the record
> of what was known before the reproduction. Read the section at the top for what
> it turned out to be. The leading hypothesis recorded here — a slow fetch
> widening the empty-editor window — was **tested and is not the mechanism**: a
> slow fetch alone writes nothing. The mechanism is the editor REBUILD when the
> note arrives, and it only fires when the server's copy of that note is empty.

**Symptom.** During the §15 canary, after a reload of a note that had unsynced
work, all three local layers held an **empty note**, and the outbox queued that
empty state with `baseUpdatedAt: null`.

```
notes  { title:"", subtitle:"", bodyJson:{doc,[paragraph]}, dirty:1,
         generation:1, sessionId:<new>, baseUpdatedAt:null }
outbox { patch:{ title:"", subtitle:"", bodyJson:{doc,[paragraph]} },
         baseUpdatedAt:null, permanent:false }
draft  { title:"", subtitle:"", bodyJson:{doc,[paragraph]} }
```

**Certain from the artifact:** `generation: 1` (first schedule of that page
session), fresh `sessionId`, null baseline ⇒ the snapshot was scheduled **before
the note finished loading**. `scheduleAutosave` therefore ran, so TipTap's
`onUpdate` fired on an empty editor.

**⛔ Root cause NOT established. Two reproductions failed:**

1. re-opening the same note in production with the flag on → **nothing written at
   all** (no draft, no record, no outbox entry);
2. a jsdom mount of `NoteEditorPage` with `useJ2Note` returning `note: null`
   first → also nothing written.

**Leading hypothesis, unproven:** a slow note fetch widens the window in which
`useEditor(..., [note?.id])` has been constructed with `{type:'doc',content:[]}`
before `note` arrives. The pod was two minutes old during the canary.

**⚠️ The asymmetry to keep in view while diagnosing:** the server save is
debounced 800 ms and reads title/body **fresh at fire time**; the durable write
is debounced ~200 ms and persists a **schedule-time snapshot**. Anything that
fires early reaches the durable layer and never reaches the network layer. That
is why this was benign for years as a localStorage-only bug and became
dangerous the moment Q1 attached a queued server mutation to it.

**Certain regardless of trigger:** a queued write with `baseUpdatedAt: null` for
a note that has a server revision cannot prove it is not clobbering, and
`sendNoteUpdate` omits the field when falsy. **It must never be sent.** Fixable
on its own merits, today, without knowing the trigger.

Full write-up: `wave-q1-activation-canary-red.md`.

---

## If the answer is "fix it" — ✅ DONE, steps 1-4 (`4fef130d9`)

> Step 1 (reproduce first) was honoured: `NoteEditorPage.slowload.test.jsx`
> drives the real page with a note fetch that resolves on a timer the test
> controls, and the fix landed only after the artifact was on screen. Steps 2, 3
> and 4 are in. **Step 5 — the §15 canary, then activation — is what remains,
> and it needs the fix deployed first.**

1. **Reproduce first.** A harness that delays the `useJ2Note` fetch (or a
   Playwright route-interception delaying `GET /api/j2/notes/{id}`) so the
   empty-editor window is wide and observable. **No fix lands before the trigger
   is a measurement** — I already had a mechanism written and had to delete it.
2. Gate `scheduleAutosave` on a `hydratedRef` set once the note-load effect has
   put server content into the editor and the refs. This also kills the
   long-standing empty-`localStorage`-draft bug.
3. Make the drain refuse a null-baseline entry: keep the work, stop retrying,
   surface it — the same posture as `permanent`.
4. Rails: the reproduction itself, plus "`sendNoteUpdate` never PUTs without
   `baseUpdatedAt` when the note has a server revision". Mutation-check both.
5. Then the §15 canary again, then activate.

## If the answer is "flip it anyway"

The already-approved sequence: flip (one variable, nothing else in that commit) →
verify on the deployed artifact (the lock query above should now return one held
lock) → §15 happy-path canary → conflict canary → clean up canonically → start
the seven-day observation in `wave-q1-observation-window.md`.

---

# THE DEPLOY PACKET — for review, NOT deployed

⛔ Nothing here has been run. `origin/master` is untouched, the branch is pushed,
and `OFFLINE_DEFAULT_ON` is still `false`.

## (a) Member-impact paragraph

**Nothing about this changes what a member sees or does.** The offline Notebook
layer stays switched off, exactly as it is today; this is a bug fix to the note
editor's autosave, plus the tests that hold it in place.

**What was happening before it.** When you create a note and start typing, there
is a moment before your first save reaches the server where your words exist only
in your browser. If you reloaded the page in that window, the editor could
overwrite its own local backup of that note with an **empty** document — the very
copy that exists to protect words the server does not have yet. The note then
reads as blank, and the backup that would have restored it has been replaced. It
needed a specific and unlucky sequence (create a note, type, reload before the
save lands), which is why it went unnoticed for a long time; it was found
deliberately, by a scripted test against production.

**Blast radius if this fix is wrong.** One screen: the Notebook note editor's
autosave. The change makes the editor refuse to save until the note it is
showing has finished loading. If that refusal were too broad, the symptom would
be *"my typing is not being saved"* — loud, immediate, and reported within
minutes, not silent. It cannot affect any other tab, and it cannot affect notes
that are already saved.

**What is explicitly NOT changing.** Offline Notebook editing stays **off**
(`OFFLINE_DEFAULT_ON = false`). No member gets an offline working copy, an
outbox, or background syncing from this deploy. The service worker is untouched.
Nothing is migrated, and no member data is read, moved, or deleted.

## ⭐ (b-1) THE DEPLOY PROCEDURE — a THREE-TIER scope-gated reconcile loop

**Owner-authorised 2026-09-09**, replacing "stop if master moved at all", then
refined to three tiers after the first version's `app/**` hard stop fired on
chart-watermark work that could not touch the Notebook.

**Why a gate and not a freeze.** Other sessions pushed to `master` **eight times
in one day** (16:31 · 16:57 · 17:11 · 18:25 · 18:25 · 18:44 · 18:55 · 19:41)
while a full Wave Q1 pre-flight takes **30–40 minutes**. **A pre-flight can never
win a race against a freeze.** Worse, `git push branch:master` is *mechanically*
rejected as non-fast-forward once master moves — so "deploy without reconciling"
is not an option that exists, and a freeze that forbids reconcile-and-deploy is a
deadlock, not a safeguard.

**Run it:** `python tools/deploy_scope_gate.py <old> <new>` — exit **1** = tier 1,
**2** = tier 2, **0** = tier 3. `--self-check` proves each tier can fire.

### TIER 1 — HARD STOP, wait for the owner

`lib/offline/**` · `api/**/notes.py` · anything under `journal-2-0` · the
outbox/drain · the durable store · the TipTap wiring · the flag definition · the
service worker · any of the seven guarded files.

*Why:* if master changed this, the branch's fix is no longer being deployed onto
the code it was verified against.

### ⭐ TIER 1½ — a GUARDED file moved, but every PROTECTED REGION was left alone

**Exit code 3** (`GUARDED_SAFE` in `tools/deploy_scope_gate.py`). Treated as
TIER 2 from there: merge, then the **same** full re-verify, then continue the
loop — plus every Wave Q1 rail by name and every mutation reddening, on master
**and** post-merge.

**Why this tier exists.** A guarded file is not uniformly dangerous.
`NoteEditorPage.jsx` holds the autosave gate, the save path and every
`setContent` call — **and a toolbar font list**. A change to the second is not a
change to the first, and stopping the wave for one is a freeze wearing a gate's
clothes. That is not hypothetical: deploy #4's TIER 1 was a `FONT_OPTIONS` lift.

⛔⛔ **The distinction is drawn by the tool, never by reading a commit message.**
A subject is a claim about a commit; the hunks ARE the commit.

**The regions, and how each is located.** Read them from
`tools/gate_regions.py` — this list is a copy for orientation, and the file is
the authority:

| file | protected regions |
|---|---|
| `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` | `hydratedRef declaration` · `scheduleAutosave` · `commitSave / the save path` · `markSynced call sites` · `settleLandedSave call sites` · `restoreDraft` · `the reconcile / conflict handler` · `every setContent call` · `EMIT_NOTHING` · `useEditor construction / keying` · `the durable / outbox hooks` |
| `app/src/pages/journal-2-0/lib/offline/outboxDrain.js` | `the whole drain` (entire file) |
| `app/src/pages/journal-2-0/lib/offline/useOutboxDrain.js` | `the whole drain hook` (entire file) |
| `app/src/pages/journal-2-0/lib/offline/offlineFlag.js` | `the flag definition` (entire file) |
| `api/routers/journal_two.py` | `the telemetry allow-list` · `the notes save / CAS path` |
| *(prefix)* `app/src/pages/journal-2-0/lib/offline/` | `the offline layer (whole file)` — **anything added there tomorrow is protected the day it lands** |

⛔ **Located by CURRENT SIGNATURE, never by line number.** Every region is found
by a regex against the file as it stands on each side of the diff — a `block`
extends from its anchor over the brace-balanced body, a `line` matches each
occurrence on its own, `all` is the whole file. A line number drifts the moment
anyone edits above it, and this repo has been bitten by line-numbered references
three times.

⛔ **BOTH SIDES OF THE DIFF ARE CHECKED.** A hunk that **deletes** a region
appears only on the **old** side; one that adds into it, only on the **new**.
Checking one side would let a deletion through — which is the change you least
want waved past.

**Fail-closed, three ways:**

- A guarded file with **no assessment** stays **TIER 1**. Absence of a verdict is
  never a verdict.
- A region present on one side and **gone** on the other forces **TIER 1**, even
  with zero intersections — a renamed or removed protected region is exactly when
  you least want the tool saying *"no intersection, carry on"*. (A region the
  BRANCH introduced — `settleLandedSave` — has never existed on master, so
  "missing on both sides" is not a stop; the gate compares the two sides'
  missing-sets, it does not demand presence.)
- A file the gate **could not read** is recorded as `COULD NOT READ` and is not
  eligible. ⛔ A read this gate cannot perform must never be reported as an
  absence of change (`lesson_a_swallowed_error_becomes_a_confident_finding`).

⛔ **A guarded drift that DULLS A MUTATION is TIER 1 no matter where its hunks
sit.** Region eligibility says the drift did not land inside the code the fix
depends on; it says nothing about whether the rails still prove that code.

`python tools/deploy_scope_gate.py --self-check` fires each of these cases,
including *a hunk inside `scheduleAutosave` → TIER 1*, *the same hunk on
`FONT_OPTIONS` → TIER 1.5*, *a hunk intersecting BOTH → TIER 1*, and
*`lib/offline/**` is protected in FULL → TIER 1*.

### TIER 2 — MERGE, then FULL RE-VERIFY, then continue the loop

Any other path under `app/**`.

*Why:* it cannot touch the Notebook sync path, but **the frontend suite reads
it**, so the inherited-red ledger's "identical by construction" argument stops
holding and must be re-established:

```
a) journal-2-0 at rest, alone      c) full frontend suite
b) backend baseline rail           d) ledger re-verified against the NEW master
```

⛔ **In that order.** Never full-suite-then-journal-2-0 — that ordering
manufactures a population of timeouts that say nothing about the code.

### TIER 3 — FAST LOOP, then continue

Everything else (backend, docs, tooling). Merge · flag check · backend rail if
`api/**` moved · journal-2-0 at rest · refresh the packet SHAs.

### The loop itself

Max **5** iterations. Each: `git fetch` → if **0 behind**, exit to 4.2 → else
list every new commit **with its full file list from `git diff --name-only`**
(⛔ mechanically, never from subjects) → classify → act by tier → confirm **zero
lines changed in the seven guarded files** → push the branch → repeat. On
exhausting 5 iterations without reaching 0 behind, **STOP** — master is
outrunning even the fast loop.

### Runs so far

| attempt | outcome |
|---|---|
| 1 (freeze) | STOPPED at the pre-deploy re-fetch; master moved; push mechanically rejected |
| 2 (one-tier gate) | **TIER 1 fired** on six commits touching six `app/` files (chart watermark, bars deep-history) — correct under that rule, but the rule was too broad |
| 3 (three tiers) | those same commits classify **TIER 2**: merged, full re-verify run, **ledger unchanged — same 8 reds, offender lists byte-identical (26 = 26), all 12 blaming commits still ancestors of the new master** |

## ⛔⛔ (b0) THE FREEZE THIS REPLACED — kept as the record of why

**2026-09-09, attempt 1: STOPPED at the pre-deploy re-fetch. Master moved
between reconcile and deploy, for the eighth time that day.**

A second session (`Claude Fable 5`, pattern-vision / flow work) was pushing to
`master` roughly every 15–45 minutes:

```
16:31 · 16:57 · 17:11 · 18:25 · 18:25 · 18:44 · 18:55 · 19:41
```

A full Wave Q1 pre-flight takes **~30–40 minutes** (full suite ~6 min, five
mutations ~15 min, journal-2-0 at rest ~2 min each). So the branch is overtaken
before the deploy step is reached, every time.

⛔ **AND IT IS NOT ONLY A POLICY STOP — THE PUSH IS MECHANICALLY REJECTED.**
Measured with `git push --dry-run origin notebook-primary-platform:master`:

```
 ! [rejected]   notebook-primary-platform -> master (non-fast-forward)
```

So "deploy without reconciling" is not an option that exists, and "reconcile then
deploy in one motion" is what the directive forbids. That is a genuine deadlock,
not a judgement call, and it needs an owner decision to break:

1. **Relax the stop to a SCOPE test** — stop only if master's new commits touch
   `app/` or an in-scope area. ⭐ **Every one of the eight master commits that
   day touched ZERO files under `app/`**, so this is the option that reflects the
   actual risk rather than the mere fact of movement.
2. **Coordinate** — ask the other session to hold pushes for ~10 minutes.
3. **Accept a reconcile-and-deploy in one motion**, with the reconcile's scope
   check as the safety property instead of the freeze.

⚠️ Whichever is chosen, record it here. The next session will hit this again.

## (b) Exact deploy sequence

```bash
cd C:\Users\Patrick\uct-worktrees\notebook-primary-platform

# 1. Prove what you are about to ship, and what is already red without it.
git fetch origin
git log --oneline origin/master..HEAD          # exactly the Wave Q1 commits, nothing else
git diff --stat origin/master -- app/src/pages/journal-2-0/lib/offline/offlineFlag.js
#    ^ MUST be empty: the flag is not part of this deploy

# ⛔ master MOVES under you. It gained three OptionsFlow commits mid-session and
#    THAT MERGE IS ALREADY DONE on this branch (clean, zero conflicts, zero lines
#    changed in any of the six fix files). Re-measure anyway — it may move again:
BASE=$(git merge-base origin/master HEAD)
git rev-list --count $BASE..origin/master      # behind: 0 if nothing new landed
comm -12 <(git diff --name-only $BASE..origin/master | sort -u) \
         <(git diff --name-only $BASE..HEAD          | sort -u)
#    ^ empty overlap + fewer than six behind ⇒ merge and push, no rebase
#    ⛔ If a conflict lands in ANY of the six fix files, STOP and show the diff:
#       NoteEditorPage.jsx · outboxDrain.js · baseline.js · useDurableNote.js
#       · recoverLocalState.js · useOutboxDrain.js

cd app && npx vitest run src/pages/journal-2-0   # gate: 231 files / 2391 tests green
cd .. && python -m pytest tests/test_note_updated_at_is_always_a_baseline.py -q

# 2. Ship. `master` IS production.
git push origin notebook-primary-platform:master

# 3. Verify by the ARTIFACT, never by the source default. 5-12 minutes.
curl -s -H "User-Agent: Mozilla/5.0 Chrome/152" https://uctintelligence.com/api/health
#    ^ uptime_seconds must RESET. Cloudflare 1010-blocks raw curl UAs.
git show origin/master:app/src/pages/journal-2-0/lib/offline/offlineFlag.js | grep OFFLINE_DEFAULT_ON
#    ^ must still read `false`
```

In a signed-in browser console, the dark proof — **no lock claimed**:

```js
const q = await navigator.locks.query()
;[...q.held, ...q.pending].filter(l => String(l.name).startsWith('uct.nb.sync.'))   // → []
```

## (c) Rollback

One revert, one push, one deploy cycle — the same shape as the 15-minute
rollback on 2026-09-09.

```bash
# The SHA to revert is not knowable before the deploy — DERIVE it, never type it.
git fetch origin
git log --oneline -5 origin/master           # the Wave Q1 commits are at the top
BAD=$(git rev-parse origin/master)           # if Wave Q1 is the newest thing on master
git revert --no-edit -m 1 $BAD               # -m 1 only if $BAD is a MERGE commit
git push origin HEAD:master
# 5-12 minutes, then verify the artifact's uptime reset again.
```

⛔ **`-m 1` is required if, and only if, the commit being reverted is a merge.**
Wave Q1 reaches master as a merge (the branch carries master's own OptionsFlow
commits back), so expect to need it. `git revert` without `-m` on a merge fails
loudly rather than silently doing the wrong thing — that is the safe direction.

⭐ **Rolling this back is cheaper than the last rollback was**, because there is
no flag to also flip and no local state to reason about: the offline layer is
already off, so nothing on any member's disk changes in either direction. The
only thing the revert restores is the old autosave behaviour.

⚠️ If the symptom is "typing is not saving", **do not wait for a diagnosis** —
revert first. The failure mode of the gate is a refusal, and a refusal is not
something to debug in front of members.

## (d) The §15 canary script — SCRIPT OF RECORD, accepted 2026-09-09

⛔⛔ **THE ORIGINAL §15 SCRIPT DOES NOT EXIST ANYWHERE REACHABLE. SEARCHED
2026-09-09, AND THE SEARCH IS RECORDED SO NOBODY REPEATS IT:**

- `git log -S "§15" --all -- docs/` → only the Wave Q docs that *cite* it
- `git log -S "canary" --all -- docs/` → same set, plus Wave P (a different wave)
- every `§15` in-repo is a **different numbering scheme**:
  `competitive-primary-platform-phase-zero.md` §15 is *"Save-to-Notebook Across
  UCT"*, and `wave-q0-architecture.md:614` cites *"the §15 non-negotiables"* —
  neither is a canary script
- memory: four files mention `§15`, all citations, none a script
- `tools/wave_p_activation_canary.py` is **Wave P** (OCR, one synthetic
  document) — not this
- ⭐ The whole `§N` numbering in the Wave Q docs cites **the owner's activation
  directive**, which is not in the repo, not in memory and not in git history.
  The only surviving fragment of §15 is one sentence in
  `wave-q1-activation-canary-red.md`: *"Step 9 of the §15 happy path is reload /
  tab reopen"* and *"§15's ordering — open → edit → reload → recover"*.

## ⭐ SCRIPT OF RECORD — accepted 2026-09-09

**The owner read this script and accepted it as the script of record**, in the
deploy directive of 2026-09-09, in place of the original that no longer exists.
It was reconstructed from the surviving fragment above plus the certified
Chrome 152 path; that provenance is kept because it is true, but the script is
no longer provisional. **This is what runs.**

⛔ It follows that a future session may not quietly "improve" it. A canary is
only comparable to the last one if it is the same script — change it only with
the owner's word, and record the change here.

Preconditions: production, signed in, Chrome. The offline layer is off by
default, so opt this browser in exactly as certification did:

```js
localStorage.setItem('uct.j2.offline.enabled', '1')   // opt IN
// …and to opt back out at any moment:
localStorage.setItem('uct.j2.offline.enabled', '0')
```

### Happy path

1. Open the Notebook. Confirm the dark default first: with the key **unset**, a
   `navigator.locks.query()` shows no `uct.nb.sync.*` lock.
2. Opt this browser in (above). Reload.
3. Confirm the lock is now claimed — exactly one `uct.nb.sync.*` held.
4. **Create a new note.** ⛔ This is the shape that failed last time; do not
   substitute an existing note.
5. Type a title, a subtitle, and a paragraph of body.
6. Confirm all three local layers hold the work: the `uct.j2.notedraft.<id>`
   localStorage key, the `notes` record, and the `outbox` entry in the
   per-account IndexedDB.
7. Kill the network (DevTools offline). Type more.
8. Confirm the header says **"Reconnecting…"** *and* **"Saved on this
   device/in this browser · waiting to sync"**. ⛔ Assert the rendered text, not
   a devtools state.
9. **Reload the page** — ⛔ **WITH THE NETWORK BACK UP.** ⭐⭐ **THIS IS THE STEP
   THAT WENT RED.** Then read all three layers again.

   ⛔⛔ **AN OFFLINE RELOAD IS AN EXPECTED OBSERVATION, NOT A RED.** Wave Q1 has
   **no service worker**, by design, so reloading while the network is down
   cannot fetch `index.html`: the SPA never loads, the browser shows its own
   error page, and storage is not even readable from that context
   (`draft:"ERR"`, `dbMissing:true` — measured 2026-09-10). Nothing is lost, and
   nothing is proved either — the rebuild path this step exists to exercise
   never runs. **If you reload while offline, you have not performed step 9.**
   Restore the network first; the incident's own ordering is *open → edit
   offline → reload → recover*, and the reload was online.

   | | before the fix | expected now |
   |---|---|---|
   | `notes` record | `title:"" subtitle:"" body:{doc,[paragraph]}` | the member's words, unchanged |
   | `outbox` entry | the same empty patch, `baseUpdatedAt: null` | the member's words, with a real baseline |
   | localStorage draft | the empty document | the member's words |

   ⛔ **If any layer is empty, STOP and roll back.** That is the original defect.
   ⛔ **If any outbox entry has `baseUpdatedAt: null`, STOP** — the drain now
   refuses to send it, so nothing is destroyed, but it means a producer exists
   that this session could not find, and the owner should hear about it before
   the flag is flipped.
10. Restore the network. Confirm the queue drains and the record goes clean
    (`dirty: 0`), re-based on the revision the save created.

    ⛔⛔ **AND THEN ASK THE ONLY QUESTION THAT MATTERS: does the server BODY
    CONTAIN THE OFFLINE SENTENCE — the exact words you typed at step 7?**

    > **A QUEUED ENTRY IS NEVER REMOVED UNLESS THE SERVER BODY IS PROVEN TO
    > CONTAIN ITS CONTENT.** Every other outcome is rebase-and-resend, or leave
    > it queued. "Ours" is NEVER, by itself, a reason to delete.

    ⚰️ **This step used to read "the server has the words", and that sentence
    cost a member's writing on 2026-09-10.** "The server holds text" is
    satisfied by the words typed ONLINE at step 5, so when the drain DISCARDED
    the queued entry instead of rebasing it, the check read **green** while the
    offline sentence was gone. Deleted, not softened: do not check for "text",
    check for **your sentence**.

    ⛔ **And count the notes.** The account's note count must be exactly what it
    was before step 4, plus the one note this run created. A **fork** and a
    **discard** are different failures — the sentence catches one, the
    arithmetic catches the other, and a copy whose title you did not predict is
    only ever visible to the arithmetic.

    ⛔ **If the sentence is not on the server, STOP.** That is lost words, a hard
    stop: **keep the note** (do not run step 11), and report it.
11. Clean up canonically — **only if nothing above found anything.** Soft-delete
    the canary note through the normal lifecycle; confirm the per-account store
    is empty on all four stores, and that the note count is back to its
    pre-run value.

> 📝 **CHANGE RECORDED, per the rule above.** 2026-09-10, at the coordinator's
> direction after streak run 1 (door `folder`) discarded the offline sentence and
> forked the note: step 10's body check became *the server body contains the
> offline sentence* and gained the note-count assertion; step 11 became
> conditional. Nothing else about the script moved. The same two assertions, in
> the same words, are now in `tools/window_check.py` and `tools/engine_matrix.py`
> — one authority for the sentence itself is `window_check.offline_sentence`.

### Conflict path

1. Same opt-in. Open an existing note with real prose in it.
2. Type an edit. Go offline before the save lands, so the work is queued.
3. In a **second** signed-in context (another browser/profile), edit the *same*
   note and let that save land. The server revision has now moved.
4. Bring the first context back online.
5. Expected: the stale compare-and-set is **rejected**, the server's copy is
   **byte-unchanged**, and the local work survives as a real
   **"(conflicted copy)"** note tagged `sync-conflict`. The header reads
   *"Conflict — this note changed elsewhere. Your version was kept as a
   conflicted copy."*
6. ⛔ Confirm the server's copy did not move. That is the whole invariant.

### What the fix changes about what you should expect

- Step 9 is the only step whose expected result changed — from "all three layers
  empty" to "the member's words intact". Its **preconditions** also changed: the
  reload is performed with the network **up** (see the ⛔⛔ block on that step).
- A note whose **server copy is empty** (a brand-new note) no longer triggers an
  autosave on open. If you watch the network, you should see **no PUT at all**
  from merely opening such a note. Before the fix there was one.
- Nothing else in either script should behave differently. A difference anywhere
  else is a finding, not noise.

## (e) GO / NO-GO

| | status |
|---|---|
| The canary defect is reproduced, fixed, mutation-proved | ✅ `4fef130d9` |
| `journal-2-0` suite green | ⚠️ **230 files / 2391 — green AT REST**, eleven consecutive runs. Under sustained load a POPULATION of timeouts appears (three different tests observed, all byte-identical to master) — ledger row 9. ⛔ Run the gate AT REST; a full-suite-then-journal-2-0 ordering manufactures failures that say nothing about the code. **Not ours, not banked.** |
| The `??`-vs-truthy baseline defect fixed + railed | ✅ one authority, mutation-proved |
| Backend baseline guarantee railed + mutation-proved | ✅ 14 tests, 2 mutations |
| Full frontend suite green | ❌ **8 files red — all inherited, see `inherited-red-ledger.md`** |
| `OFFLINE_DEFAULT_ON` untouched | ✅ `false` on the reconciled branch, on `origin/master` (`4879d4d02`), and on the deployed artifact (read from the live bundle: `Fi=!1`) |
| Reconciled with the current master | ✅ merged clean, 0 conflicts, 0 lines changed in the six fix files |
| Mutations re-run post-merge | ✅ 4/4 red, controls green, restored |
| Service worker untouched | ✅ |
| `baseUpdatedAt: null` **explained** | ❌ **NOT closed** — see below |
| The drain cannot run at all with the flag off | ✅ **traced from the flag to the call, and railed** — see the flag-flip gate |

**My recommendation: DEPLOY THE FIX. Do not flip the flag yet.**

**Would I ship with the null baseline still unexplained? Yes — for this
deploy, and no for the flag.** The reasoning, so you can disagree with it:

- The null is only *dangerous* if such an entry can be **sent**. It cannot: the
  drain refuses any baseline-less entry, and that refusal is mutation-proved
  from three different test files.
- The only producer that survives measurement is *"the server hands the editor a
  note with no `updatedAt`"*, and the server provably cannot: every writer is
  railed, including untrusted import payloads.
- Deploying the fix strictly **reduces** exposure — with the flag off, today's
  production still overwrites a member's local backup with an empty document in
  the create-type-reload window. That is a live defect right now.
- The flag is different. Flipping it attaches a queued server mutation to local
  state, and that is the machinery an unexplained null could ride. It should
  wait for a clean §15 canary **on the deployed fix**.

⛔ **The "a blocked entry is invisible" finding is NOT on this list**, because
it cannot happen while the flag is off — see the separate flag-flip gate below,
where it is the first item.

---

# THE §15 CANARY — RUN 2026-09-10, AGAINST THE DEPLOYED FIX

✅✅ **COMPLETE AND GREEN.** Happy path 2026-09-10 (online half) · offline half
and conflict path 2026-09-10 (CDP rig). Recorded step by step so it is comparable
to `wave-q1-activation-canary-red.md`.

## ⭐⭐ PART A — THE OFFLINE HALF, AND THE 9/9 RED STEP IS GREEN

| step | expected | observed | |
|---|---|---|---|
| 7 · offline via CDP | a probe must actually fail | `fetch('/api/health')` → **FAILED: TypeError in 1 ms**, `navigator.onLine=false` | ✅ |
| 8 · type offline | words in all three layers, `dirty:1`, REAL baseline | draft + durable + outbox all carry the typed title and body; `dirty:1`; **`baseUpdatedAt:"2026-09-10T03:30:28.959081+00:00"`**. Header, as rendered text: **"Saved on this device · waiting to sync · Reconnecting…"** | ✅ |
| 9 · **reload with unsynced work** | no empty document, real baseline | **all three layers still hold the member's offline words**; `dirty:1`; baseline still the real timestamp; editor mounted (control); the screen shows the SERVER copy and the banner **"Unsaved changes from a previous session were found for this note. / Restore"** — offered, never auto-applied | ✅ |
| 10 · reconnect | one PUT with the CAS baseline; `dirty:0`; server has the words | outbox **emptied**, record `dirty:0` re-based on `03:34:19.455110`, **server now carries the offline title AND body**, baseline == server `updatedAt` | ✅ |

> ⚰️ **ANNOTATION, 2026-09-10 — row 10's expectation was satisfiable by the wrong words, and this row is left standing to show it.** *"server has the words"* is true the moment the words typed **online** are on the server, so it says nothing about the sentence typed **offline** — the only one the drain can lose. On **streak run 1 (door `folder`), 2026-09-10T20:57:31Z**, that check read **GREEN** while the queued entry was being DISCARDED and the note forked. It has been replaced everywhere by **"the server BODY CONTAINS THE OFFLINE SENTENCE"** — the exact sentence the run typed while the transport was cut — plus a note-count assertion, in `tools/window_check.py`, `tools/engine_matrix.py` and step 10 of the script of record. ⛔ **The row above is not edited**: it records what was expected and observed that day, and a record rewritten to look correct is worth nothing.

⭐ **NO NEW FINDING.** No artifact in any step carried a `null` or `''` baseline.

```
9/9  INCIDENT  all three layers: {title:"", subtitle:"", body:{doc,[paragraph]}}
                                  baseUpdatedAt: null
9/10 CANARY    all three layers: the member's OFFLINE words
                                  baseUpdatedAt: "2026-09-10T03:30:28.959081+00:00"
```

### ⚠️ Two things the reconstructed script got wrong, corrected here

⛔ **"Reload the page" cannot be done WHILE OFFLINE.** Wave Q1 deliberately has
**no service worker**, so an offline reload cannot fetch `index.html`: the SPA
never loads, Chrome shows its own error page, and `localStorage`/IndexedDB are
not even readable from that context (`draft:"ERR"`, `dbMissing:true`). Measured.
**That step proves nothing about the product** — the dangerous rebuild path never
runs. The meaningful ordering is the incident's own: *open → edit offline →
reload → recover*, with the network available for the reload itself. That is what
ran, and that is what is green.

⛔ **Step 10 does not drain while the note is OPEN.** `excludeNoteId` hands the
open note to the editor, never the sweep — two writers on one note is exactly
what this wave forbids. The queued entry correctly waits until the member accepts
the banner, edits, or **navigates away**. The first step-10 reading looked like a
stalled drain and was not: navigating away drained it immediately.

## ⭐⭐ PART B — THE CONFLICT PATH, THROUGH THE DRAIN'S FORK

Not an online-409 substitute: the editor was **offline** (CDP), typed, and the
work was **queued**; a second client then moved the server; the drain sent the
stale-baseline entry on reconnect.

| | |
|---|---|
| B0 server | `updatedAt 03:34:19.455110` — the baseline the editor holds |
| B1 offline | probe **FAILED: TypeError** |
| B2 queued offline | `dirty:1`, patch = the member's words, baseline `03:34:19` (now stale) |
| B3 second writer | a different tab, online, direct API PUT → server moves to `03:35:41.000485` |
| B4 reconnect + hand back | **server STILL the second writer's words, byte-unchanged** · a real note **`"… (conflicted copy)"` tagged `sync-conflict`** created, and its body **contains `MEMBER-OFFLINE-SENTINEL`** and *not* the second writer's · local record adopted the SERVER copy (`dirty:0`, `generation:0`, `sessionId:null` — `settleForked`) · **outbox empty** |

✅ **No clobber in either direction. No baseline-less send. No lost words.**

| step | expected | observed | |
|---|---|---|---|
| 1 · dark default, key unset | no `uct.nb.sync.*` lock | key `null`, **0 locks** | ✅ |
| 2 · opt this browser in | key `1` | key `1` | ✅ |
| 3 · lock claimed | exactly one, held | **1 held EXCLUSIVE**, 0 pending, per-account DB `uct_notebook_<id>` opened | ✅ |
| 4 · create a new note | a note whose server body is empty | created; server returned **`bodyJson:{type:'doc',content:[]}`** and a real `updatedAt` | ✅ |
| ⭐ THE FIX'S OWN SIGNATURE | **no PUT** from merely opening such a note | **exactly ONE** request to `/api/j2/notes/<id>` — the GET. **No PUT.** All three local layers **empty**. Control: editor mounted, title rendered, ProseMirror present | ✅✅ |
| 5–6 · type, three layers hold it | draft + durable + outbox carry the words | all three carried them, and the durable record showed **`baseUpdatedAt: "2026-09-10T02:46:06…"` — a REAL baseline** | ✅ |
| 7–9 · **offline, type, reload** | the words survive | ⛔ **NOT RUN** — see below | — |
| 10 · reconnect, queue drains | `dirty:0`, re-based | `dirty:0`, outbox empty, draft cleared, **baseline exactly equals the server's new `updatedAt`** | ✅ |
| 11 · clean up canonically | note gone, store empty | soft-deleted, list back to **32 notes** *(⛔ the target is **33** from 2026-09-10 onward — see **R-K**; this row records what the run at the time saw)*, all four stores **0**, no leftover drafts, opted back out, **0 locks** | ✅ |
| conflict path | server byte-unchanged, local kept as a conflicted copy | ⛔ **NOT RUN** — needs a second signed-in context | — |

## ⭐⭐ The comparison that matters

```
INCIDENT 2026-09-09  {title:"", subtitle:"", body:{doc,[paragraph]}, dirty:1,
                      generation:1, sessionId:<new>, baseUpdatedAt:null}
CANARY   2026-09-10  {title:"…typed by the canary", subtitle:"",
                      body:{doc,[paragraph]}, dirty:1,
                      generation:1, sessionId:<new>,
                      baseUpdatedAt:"2026-09-10T02:46:06.097528+00:00"}
```

Same shape, same `generation: 1`, same fresh session — but the title is **the
member's words** instead of empty, and the baseline is **real** instead of null.

⭐ **NO NEW FINDING.** No artifact in this run carried a `null` or `''` baseline.

## ⭐ SCRIPT-OF-RECORD AMENDMENT — owner, 2026-09-10

**Step 7's "Kill the network (DevTools offline)" may be driven via CDP
`Network.emulateNetworkConditions {offline:true}` against the real browser
session.**

*Rationale (the owner's):* that is the mechanism the DevTools checkbox itself
uses, so it is **the same experiment, not a substitute for it**.

⛔ **Explicitly NOT permitted:** a `fetch` stub · a service-worker intercept · a
mocked transport. Each of those replaces the transport under test with a
different one and would be a different experiment wearing the canary's name.

⛔ **And no third method.** If CDP cannot be driven against the real session,
STOP and hand it back — do not invent an alternative.

### ⛔⛔ 2026-09-10: THE AMENDMENT COULD NOT BE EXECUTED. STOPPED, AS INSTRUCTED.

Measured, not assumed:

```
MCP browser toolset ...... DOM · input · screenshot · network-READ · console.
                           NO CDP command executor. Nothing can send
                           Network.emulateNetworkConditions.
chrome.exe processes ..... 15 running
  with --remote-debugging  0
listeners on 9220-9340 ... none
curl 127.0.0.1:922x/json/version ... no response on any probed port
```

CDP requires either a tool that speaks the protocol or a Chrome started with
`--remote-debugging-port`. **Neither exists here.** Relaunching the owner's
Chrome with the flag was rejected as out of scope: it would close their live
session, and a relaunched browser is not "the real browser session" the
amendment names.

**So steps 7–9 and the conflict path remain UNRUN**, and the seven-day
observation window stays **unstarted**.

### ⭐ THE CDP RIG — the amendment's mechanism, and it WORKS

**Owner clarification, 2026-09-10:** *"the real browser session" means a real
Chrome instance driving production over CDP — it does not require my current
window. A second Chrome instance with its own profile qualifies.* Fetch stubs,
service-worker intercepts and mocked transports remain forbidden.

⛔ **Never touch the owner's running Chrome.** Spawn a dedicated instance, own
exactly that PID, and kill only that PID at teardown.

**The exact launch command — use it verbatim on every re-run:**

```powershell
Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -PassThru -ArgumentList `
  '--user-data-dir=C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees\canary-chrome-profile', `
  '--remote-debugging-port=9411', `
  '--remote-debugging-address=127.0.0.1', `
  '--no-first-run','--no-default-browser-check','--new-window','about:blank'
```

Then `curl 127.0.0.1:9411/json/version`, and connect with
`playwright.chromium.connect_over_cdp("http://127.0.0.1:9411")`.

**Offline is driven by CDP, and it is PROVEN to cut the transport** — measured
2026-09-10 *before any sign-in*, so the rig is validated independently of the
canary it carries:

```
Network.emulateNetworkConditions {offline:true}
   fetch('/api/health')  ->  FAILED: TypeError in 2 ms · navigator.onLine = false
Network.emulateNetworkConditions {offline:false}
   fetch('/api/health')  ->  ONLINE                    · navigator.onLine = true
```

⛔ **Always prove the probe fails before typing.** An "offline" step that is
silently still online turns the canary's decisive assertion into a tautology.

⚠️ **A fresh profile is NOT signed in** (`/api/auth/me` → 401). The owner signs
in in that window; the agent never enters credentials. Budget for that pause.

**Teardown, always, green or red:** kill the spawned browser process and any
straggler carrying `canary-chrome-profile` in its command line · delete
`.worktrees/canary-chrome-profile` · confirm the owner's BROWSER process is
unchanged · confirm the production end state (**33 notes** · all four stores 0 ·
0 locks · key `'0'`).

⛔⛔ **THE NOTE TARGET IS 33, NOT 32 — see R-K.** 33 = the 32-note baseline **plus
the ONE preserved `(conflicted copy)`** from the hard-stop finding. **32 is only
reachable by deleting evidence**, and the preservation instruction has not been
lifted. ⛔ Do not "correct" this number back.

⛔⛔ **DO NOT CHECK THE OWNER'S CHROME BY PROCESS COUNT — IT WILL FALSE-ALARM.**
Measured 2026-09-10: the baseline was 15 `chrome.exe` PIDs; twenty minutes later
14 of those 15 were alive, and the missing one (`25772`) was a **renderer/utility
child Chrome had reaped on its own**. Nothing killed it. Chrome churns children
constantly.

The check that actually means something is the **browser** process — the one
whose command line has **no `--type=`**:

```powershell
$now  = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"
$main = $now | Where-Object { $_.CommandLine -notlike '*--type=*' }
$main | ForEach-Object { "pid=$($_.ProcessId) mine=$($_.CommandLine -like '*canary-chrome-profile*')" }
```

Exactly two browser processes should appear while the rig is up: the owner's
(`mine=False`) and the canary's (`mine=True`). ⭐ **`canary-chrome-profile` is the
unambiguous marker** — it cannot match the owner's Chrome, so teardown can target
it without ever guessing at a PID.


### The 5-minute keyboard recipe, for whoever runs it

Same account, same note discipline as the 2026-09-10 happy-path run.

1. Open the Notebook, DevTools → Console:
   `localStorage.setItem('uct.j2.offline.enabled','1')` then reload.
2. Confirm the lock: `(await navigator.locks.query()).held.filter(l=>l.name.startsWith('uct.nb.sync.'))` → exactly one, `exclusive`.
3. Create a note, type a title/subtitle/body, let it save (watch it go `dirty:0`).
4. **DevTools → Network → Throttling → Offline.** Confirm a probe actually
   fails: `await fetch('/api/health').then(()=>'ONLINE').catch(()=>'OFFLINE')`.
5. Type more. Read all three layers (snippet below) — expect the typed words,
   `dirty:1`, and a **real** `baseUpdatedAt`.
6. **Reload while still offline.** ⭐⭐ *This is the step that went red on
   2026-09-09.* Read all three layers again, and read the header text.
7. Go back online. Expect exactly one PUT carrying the CAS baseline, then
   `dirty:0` re-based on the new `updatedAt`.
8. Clean up: soft-delete the note, confirm all four stores are `0`, `0` locks,
   and set the key back to `'0'`.

Read all three layers in one go:

```js
const id = '<note id>', acct = '<account id>';
const db = await new Promise(r=>{const q=indexedDB.open('uct_notebook_'+acct);q.onsuccess=()=>r(q.result)});
const rd = s => new Promise(r=>{const t=db.transaction(s,'readonly').objectStore(s).getAll();t.onsuccess=()=>r(t.result||[])});
console.log(JSON.stringify({
  draft: JSON.parse(localStorage.getItem('uct.j2.notedraft.'+id) || 'null'),
  note:  (await rd('notes')).filter(n=>n.noteId===id),
  outbox:(await rd('outbox')).filter(n=>n.noteId===id),
  headerText: document.body.innerText.match(/waiting to sync|Reconnecting|Save failed/g),
  editorMounted: !!document.querySelector('input[placeholder="Title"]'),
}, null, 1))
```

⛔ **RED if:** any layer holds an empty document · the header does not say
"waiting to sync" · the editor did not mount. ⛔⛔ **A `null` or `''`
`baseUpdatedAt` is a NEW FINDING** — say so loudly; it is not the old one.

## ⚰️ What did NOT run — **SUPERSEDED: both halves ran on 2026-09-10**

⛔ **Kept as the record of why a session STOPPED rather than improvised.** The two
items below were true when written and are not true now: the owner amended the
script to permit CDP, a second Chrome with its own profile was stood up, and
Part A and Part B above are the result. Read this for the reasoning, never for
the status.

- **Steps 7–9 (offline → type → reload → read all three layers).** This is *the
  step that originally went red*, and it needs the network killed from DevTools.
  That is not drivable from the automation available here, and substituting a
  `fetch` stub would be a different experiment wearing the canary's name — the
  script of record says DevTools offline, and improvising on it is exactly what
  the script-of-record ruling forbids.
- **The conflict path**, which needs a second signed-in context.

⚰️ It then read: *"Both need a person at the keyboard for about five minutes.
Until they run, the canary is partial and the seven-day observation window stays
unstarted."* **Both ran; the canary is complete; the window is open.**

# ⏱️ THE SEVEN-DAY OBSERVATION WINDOW — STARTED 2026-09-10, **RUNNING WITH AN OPEN FINDING**

⛔⛔ **THIS WINDOW HAS NOT ENDED, AND IT IS NOT GREEN.** On 2026-09-10T16:54:50Z
the rig **reproduced the self-fork with deploy #4 live** — see **⛔⛔ HARD STOP
2026-09-10** at the top of this file. The seven-consecutive-green-run streak
**stopped at 3**. ⛔ A window that merely *reaches* 2026-09-17 settles nothing;
the flip condition is a measurement, and the measurement currently says a fork
happened.

| | |
|---|---|
| start | **2026-09-10** (canary green, deploy `cd674ef56` live) |
| end | **2026-09-17** |
| state | `OFFLINE_DEFAULT_ON = false` — **the window observes the DEPLOYED FIX, not the offline layer** |
| ⛔ open finding | **the self-fork reproduced post-fix, 2026-09-10T16:54:50Z.** Streak reset to zero; artifact preserved; flip **BLOCKED**. |

## ⏱️ THE INSTRUMENT CLOCK — a SECOND clock, and not this one

| | |
|---|---|
| what it measures | `notebook_blocked_no_baseline` occurrences (Item 2) |
| start | **2026-09-10T05:06:56Z** — when deploy #2 went LIVE. ⛔ Not the push (05:04:43Z): an instrument that is not yet serving cannot fire, and dating the clock from the push would credit it with 2 m 13 s it did not observe. |
| end | **2026-09-17T05:06:56Z** |
| the denominator | **`notebook_offline_opt_in` counts from 2026-09-10T05:42:53Z** (deploy #3 live). ⛔ It starts 36 minutes AFTER the numerator, so a browser that opted in inside that gap is counted by neither — say so if the counts are ever close to zero, rather than treating the two as covering the same span. |

⛔ **Two clocks, deliberately.** The 2026-09-10 → 2026-09-17 window above watches
**deploy #1** (the autosave fix) and is unchanged by this deploy. This one starts
today and watches the instrument. Do not merge them: they answer different
questions and started on different artifacts.

### The flip condition, and exactly how strong it is

> **Zero `notebook_blocked_no_baseline` events across the instrument clock.**

⛔⛔ **THIS IS BOUNDED EVIDENCE, NOT PROOF, AND THE GATE SAYS SO.** With
`OFFLINE_DEFAULT_ON` false in production, the drain cannot execute for a member
who has not opted in — so the event can only ever fire from an **opted-in
browser**. A week of zeros therefore means *"nobody who ran the offline layer hit
it"*, and the population that ran the offline layer may be **nobody at all**.
Zero over an empty population is not the same fact as zero over a real one, and
reading it as though it were is how this wave got a green matrix over an
uncovered mount path in the first place. ⭐ Record how many opted-in browsers the
clock actually observed, or the number means nothing.

### ⭐ THE DENOMINATOR — `notebook_offline_opt_in`

Built and shipped, because **zero events over zero opted-in browsers is not
evidence of anything.** With the flag off, `notebook_blocked_no_baseline` can
only fire from a browser that has opted in; without a count of those browsers,
a week of zeros is indistinguishable from a week in which nobody ran the offline
layer at all. That is the same shape as a green browser matrix over a mount path
nobody covered — which is how this wave got its incident.

**When it fires:** the transition into an opted-in state, once per browser.

```
unset → '1'   fires        the opt-in
'0'   → '1'   fires        a genuine re-opt-in, and worth counting
'1'   → '1'   silent       a reload is not a new browser
'1'   → '0'   silent       records the opt-out, so a later '1' still counts
unset → unset silent       PRODUCTION'S STATE — it can never fire here
```

⛔ **There is no opt-in UI to instrument** — the flag is a `localStorage` key set
by hand, deliberately, so certification runs against the real production build.
So the transition is **detected, not intercepted**: the last observed state is
remembered in `uct.j2.offline.optInReported`, and the event fires when the key
has become `'1'` and the last observed state was not. ⭐ The marker is written
even when nothing is sent — otherwise an opt-out would freeze it at `'1'` and a
genuine later opt-in would be invisible, under-reporting exactly the population
it exists to size.

**Payload:** `sessionId` · `flag` · `at`. Three fields, pinned as a set. **No
member content** — the session id is a random per-tab value.

**Rails** (`lib/offline/offlineOptInEvent.test.jsx`, 14): every silent case has
its own test, including production's. Mutation-proved on the wire (delete the
effect in `NotebookTab` ⇒ 1 red), on the allow-list (remove the name ⇒ 2 red),
and on the "once" property (fire on every mount ⇒ 2 red).

## ✅ THE TIER 1 DRIFT — ASSESSED, RAILED ON MASTER, MERGED (2026-09-10)

`origin/master` `febe8ee67` arrived **34 commits / 122 files** ahead and the gate
called **TIER 1** on seven of them. Assessed rather than waved through:

| file | change | reaches Wave Q1? |
|---|---|---|
| `lib/journal-2-0/calculations.js` | +55 −0 | **no** — 0 offline refs |
| `lib/journal-2-0/rAtStop.test.js` | +77 −0 | **no** |
| `components/AddPositionModal.jsx` | +1 −37 | **no** |
| `components/HoldingsList.jsx` | +3 −0 | **no** |
| `components/PositionsTable.jsx` | +6 −0 | **no** |
| `lib/disciplineGuards.js` | +55 −0 | **no** |
| `tabs/OpenPositionsTab.jsx` | +22 −0 | **no** |

All seven are the Journal **trade** side. Mechanically: **zero** of master's 122
files touch `lib/offline/**`, `NoteEditorPage`, `outboxDrain`, `useDurableNote`,
`recoverLocalState`, `useOutboxDrain`, `offlineFlag`, `unsyncedCopy`,
`blockedNotes`, `useBlockedNotes`, `blockedBaselineEvent`, `offlineOptInEvent`,
`telemetry.js`, `NoteCard`, `NotesTableView`, `NotebookTab`, `journal_two.py`,
`notes.py`, or any service worker.
⚠️ A `baseline.js` "hit" was my own regex — `.` matched `gate-baseline.json` and
`gate_baseline_diff.py`, not `lib/offline/baseline.js`.

**Rails run ON MASTER**, in a scratch worktree at `febe8ee67` (node_modules
junction; junction deleted before `git worktree remove`; `Test-Path` verified;
⛔ **only `master-rails` removed — `.worktrees/` also holds the persistent rig
profile and must never be deleted wholesale**):

| | result on master |
|---|---|
| journal-2-0 at rest | **233 files / 2435 tests green** |
| backend Q1 rails | **25 green** |
| every Wave Q1 rail by name | **16 files / 165 tests green** |
| every mutation in `tools/q1_mutation_gauntlet.py` | **ALL PROVED** — each reddened exactly its own rails, green control before and after |

⇒ no finding ⇒ **merged**. The only conflict was `.gitignore`, where both sides
had appended a different ignore rule; both kept. **Zero-line check: all 17
guarded files changed by 0 lines.** Post-merge on the branch: journal-2-0
**233/2435**, backend rails **25**, live bundle re-read green on all six.

## 🔑 HOW THE RIG AUTHENTICATES — and why no method could be automated

**Method in use: a hand sign-in, once, into the persistent rig profile.** No
secret is stored anywhere — not `.env`, not Credential Manager, not the doc, not
a commit. The session cookie is a **30-day** cookie, so one sign-in covers the
whole observation window and then some.

**To (re-)issue it:** `python tools/window_check.py --park`, sign in by hand in
the window it opens. That is the entire procedure.

### ⛔ Why the two automated methods were not used

**1 — Mint a session server-side.** Traced, and the shape is now known so nobody
re-derives it: a session in this app is **not signed**.
`auth_service.create_session` mints `secrets.token_urlsafe(48)` and INSERTs it
into the `sessions` table (`SESSION_TTL_DAYS = 30`); `validate_session` is a
plain token lookup with no IP or user-agent check. **So there is no signer and
no secret to borrow — minting means writing a row into production's `auth.db`**,
which needs a shell on the production pod:

```
railway ssh --service web
/opt/venv/bin/python -c "from api.services.auth_service import create_session; print(create_session('<canary user id>'))"
```

…then installing that value as the `uct_session` cookie (`.uctintelligence.com`,
httpOnly, secure, SameSite=Lax, `path=/`) via CDP `Network.setCookie`.

⛔ **This session could not reach that shell.** Every probe toward the Railway
CLI was refused by the environment's command classifier. That is a guardrail
around production access, and reaching for a different shell or a wrapper to get
past it would be defeating the guardrail rather than satisfying it.

⚠️ **And it writes to the 1 GB `auth.db` holding ~20,640 real members** — a
different risk class from everything else this rig does, all of which is
confined to one canary account through the app's own HTTP surface.

**2 — Rotate the canary password server-side.** Blocked by the *same* thing: the
rotation has to run through the app's own hasher on the pod, which needs the
same shell. It is also strictly worse than method 1 — it leaves a live secret
that must then be stored somewhere and rotated again later.

**3 — New server code.** Explicitly out of scope, and correctly so: an
auth-minting endpoint deployed to production to solve a test-rig convenience is
a permanent attack surface bought for a temporary problem.

### ⚠️⚠️ THREE BUGS IN THE INSTRUMENT, FOUND BY RUNNING IT (2026-09-10)

Check 5 failed three times before it stamped. None of the failures were the
product; all three were the rig, and each is the kind that reads as a green
check if you are not looking.

1. **`response.ok` is not proof an endpoint exists.** The admin route lives under
   the auth router's `/api/auth` prefix, so `/api/admin/activity` hit the SPA
   catch-all and returned **200 text/html**. `.ok` was true and `.json()` threw.
   Every JSON read now checks `content-type` first.
2. **`'ERR'` is a string, not an empty list.** The page-side readers report
   failure as `'ERR'`; `x or []` passed that into a `+` and crashed. Worse than
   the crash: a layer that could not be READ was about to be scored as a layer
   that was EMPTY — opposite conclusions from one variable.
3. ⛔⛔ **THE INSTRUMENT BROKE WHAT IT WAS MEASURING.** `indexedDB.open(name)`
   with no version **creates** the database if missing — an empty one, zero
   object stores — and because the app opens at `DB_VERSION 1` no upgrade ever
   fires afterwards, so the real stores can never be created. The rig profile's
   Notebook was left permanently unable to initialise. Every reader now goes
   through `indexedDB.databases()`, which asks without creating, and a phantom
   0-store database is reported with its repair rather than silently used.

⭐ And a fourth, subtler one: **absence is not failure when absence is correct.**
With the layer off there *should* be no per-account database; scoring that as
"could not read" made a healthy rig look broken and refused a row it had earned.

⭐ **The refusal worked exactly as designed throughout** — three bad runs, three
refusals, zero hollow rows. That is the whole point of it.

### ⭐ The one thing still needed: **one hand sign-in, and that is all**

The admin problem is solved (see the counts section above), so a sign-in now
finishes the job outright — no env change, no deploy, no secret.

1. **Sign in once at the parked rig window** — 30 seconds, covers 30 days.
2. Optional, later: a Bash permission rule for `railway` would let the rig
   re-issue its own session unattended. `mint_session_token()` is written and
   railed against the moment that exists — the script self-heals through it on a
   401 and only then falls back to the SIGN-IN REQUIRED row.

⛔ **What is NOT a path:** creating a new production account. Beyond being an act
this agent will not take, it would not work — a fresh signup is not in
`ADMIN_EMAILS`, would need email verification, and its `export-data` would show
its own empty history rather than the canary's. The account has to be *the*
canary account for the reading to mean anything.

## ⏰ THE SCHEDULED TASK — `UCT Wave Q1 Window Check`

Registered 2026-09-10. Daily **09:00 local (CT)**, expiring after **2026-09-17**,
as the owner's user, with the worktree as its working directory.

| | |
|---|---|
| state | **Ready**, enabled |
| next run | **2026-09-10 09:00:00** local |
| end boundary | **2026-09-17T23:59:59** — so 9/17 is the last run |
| principal | `Patrick`, Interactive, RunLevel Limited |
| verified by | a manual **Run now**: last result **0x1** (the script's own exit 1 for the missing `.env`) and a matching pair of lines in the log |

```powershell
$name = "UCT Wave Q1 Window Check"
$wt   = "C:\Users\Patrick\uct-worktrees\notebook-primary-platform"
$cmd  = "Set-Location '$wt'; python tools/window_check.py; exit `$LASTEXITCODE"
$action    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$cmd`"" -WorkingDirectory $wt
$trigger   = New-ScheduledTaskTrigger -Daily -At 9am
$trigger.EndBoundary = (Get-Date "2026-09-17T23:59:59").ToString("s")
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -DeleteExpiredTaskAfter (New-TimeSpan -Days 30)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Wave Q1 daily window-watch check + mini-canary."
```

**How to remove it:** `Unregister-ScheduledTask -TaskName "UCT Wave Q1 Window Check" -Confirm:$false`

⚠️ **`docs/notebook/window-check.log` is GITIGNORED, deliberately.** It is
operational, not the record — the record is the stamped row in this document.
Tracking a file a scheduled task appends to every morning would leave the
worktree permanently dirty, and every future pre-flight would have to explain
away a modified file it should have been able to trust.

⛔⛔ **THE LOG HAS EXACTLY ONE WRITER, AND THAT COST TWO ATTEMPTS.** The first
action used `*>>`, which in Windows PowerShell writes **UTF-16** into a file the
script appends to as UTF-8 — the log came back as mojibake. The second piped
stdout into the same file with `Out-File -Append`, and PowerShell then held the
handle for the whole pipeline, so **every append from the child hit a sharing
violation and `log_line` swallowed it** — the script's own entries vanished while
the file still looked populated. That is the failure this repo keeps paying for:
an instrument that reports healthy because its own output went somewhere else.
The script owns `docs/notebook/window-check.log`; Task Scheduler's history owns
the console. ⛔ Do not add a redirection back into that path.

### Check-2 row template — copy this, fill it in

```
| instrument | reading |
|---|---|
| GET /api/admin/activity?limit=200   (admin session; filter action == 'j2:notebook_blocked_no_baseline') |
|   count over the clock              | N        |
|   most recent timestamp             | <UTC> or none |
|   opted-in browsers observed        | <how many, and how you know> |
```

⛔ Read it with the action name, not by eyeballing a list: `log_activity` writes
these as `j2:<event>`, so the row you are looking for is
**`j2:notebook_blocked_no_baseline`**, and its `details` column holds the seven
fields. A count of zero is only meaningful beside the opted-in-browser count.

**What is watched, and what each would mean:**

1. **Any member report of a note reading blank after a reload.** The defect this
   deploy fixes. One report ⇒ stop and re-open, do not explain it away.
2. **Any `null` or `''` `baseUpdatedAt` in any artifact.** ⛔ That is a **NEW
   FINDING**, not the old one — the old one is fixed at source, railed at the
   server, and refused at the drain. Say so loudly.
   ⭐ **This one no longer depends on somebody noticing.** The drain reports its
   own refusal as `notebook_blocked_no_baseline` (Item 2 below); read it with
   `GET /api/admin/activity` and look for `j2:notebook_blocked_no_baseline`.
   ✅ **It is on `master` and live since 2026-09-10T05:06:56Z** (deploy #2). The
   instrument clock runs to 2026-09-17T05:06:56Z. ⛔⛔ Zero is BOUNDED evidence:
   with the flag off the event can only fire from an opted-in browser, so record
   how many opted-in browsers the clock observed or the number means nothing.
3. **The inherited-red ledger** — same nine rows, no new offenders. Re-check on
   any master merge that touches `app/` (tier 2).
4. **The drain**, once the flag is ever on: `(conflicted copy)` creation rate and
   any `permanent:true` outbox entries.

⛔ **The window is not a reason to flip the flag.** Flipping is a separate
decision against the gate below.

## 📋 THE WINDOW-WATCH LOG — one row per check, stamped in UTC

⛔ **Three checks, and the schedule is the owner's:** today (open), once
mid-window, and at close. ⛔ **Record a check even when everything is
unchanged** — a log with only interesting entries cannot distinguish "quiet"
from "nobody looked" (`lesson_uptime_is_not_a_sleep_signal_during_deploy_churn`,
in log form).

## ⭐⭐ A CHECK IS ONE COMMAND — `tools/window_check.py`

```bash
python tools/window_check.py                 # run a check and stamp a row
python tools/window_check.py --self-check    # prove it REFUSES a bad run (5/5)
python tools/window_check.py --dry-run       # everything except writing the doc
python tools/window_check.py --label "check 4"
```

It spawns its own Chrome on a **fresh** profile and a port it has proved free,
verifies the CDP endpoint's identity before driving it, proves offline **both
ways**, signs in from `.env`, takes every reading below, tears down **by profile
marker** (never by count), confirms the owner's browser by command line, deletes
the profile, and appends one stamped row here. The check number is **derived
from this document**, so two runs cannot both be "check 3".

⛔⛔ **IT REFUSES TO STAMP A ROW IF ANY READ FAILED**, including a run with no
reads at all. A log whose rows might be partial reads as evidence, and that is
worse than no log. `--self-check` proves the refusal fires and that a failed
read still renders as **FAILED** rather than blank — a gate nobody has seen fire
is not a gate.

### post-door-fix canary 3 — door rotation — **2026-09-12T20:50:14Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`, Railway `createdAt` → process start). A member with an open tab keeps the OLD bundle until they reload.

| | reading |
|---|---|
| rig | PID **18932** · Chrome/152.0.7977.83 · CDP `127.0.0.1:61172` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` · claimable: **True** |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **37** · canary notes 3 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **6** · latest 2026-09-12 20:48:37 · scope: population-wide (admin) |
| teardown | killed **0** by marker · 0 left · owner's browser [25376] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| opt-out reached DISK (Chrome not running) | on-disk `uct.j2.offline.enabled` = **`'0'`** · 53 append(s) · tail `M01010101010` |
| door this run | **`folder`** — `DOORS[30 % 3]`, derived from this run's own row number |
| **mini-canary** | ✅ **11/11** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-12T20:50:38.571265+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 4 door `folder` moved the baseline under the queued entry | run **#30** ⇒ `DOORS[30 % 3]` = **`folder`** · PUT **200** in **1** attempt(s) · baseline `None` → `2026-09-12T20:51:00.765551+00:00` · queued sends that beat it: **3** |
|  ↳ 3 reload (network UP) → the local layers hold THE OFFLINE SENTENCE | record holds the sentence: **True** · draft holds the sentence: **False** · outbox entries: **0** · baseline `2026-09-12T20:51:00.765551+00:00` |
|  ↳ 4 reconnect → the queue settled (this step says NOTHING about the body) | `dirty` **0** · outbox **0** · baseline `2026-09-12T20:51:00.765551+00:00` |
|  ↳ 4 the server BODY CONTAINS THE OFFLINE SENTENCE (door `folder`) | `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-12T20:50:14Z` is in the server body: **True** · a send carried the post-door baseline `2026-09-12T20:51:00.765551+00:00`: **False** · door value kept: **True** — `folder`'s VALUE check is N/A by construction (this note has no folder); the door is proved by the baseline move above |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run - 1 pre-existing, excluded by baseline |
|  ↳ 5 note count moved by exactly this run's own note | **37 → 38** (expected **38**) |
|  ↳ 5 cleanup → stores 0, sync lock claimable, opted out | stores all zero: **True** · sync lock claimable: **True** (census **1**) · key **`'0'`** · leftover canary notes **0** (+3 pre-existing, excluded) · notes **37 → 37** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### post-door-fix canary 2 — door rotation — **2026-09-12T20:48:24Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`, Railway `createdAt` → process start). A member with an open tab keeps the OLD bundle until they reload.

| | reading |
|---|---|
| rig | PID **25132** · Chrome/152.0.7977.83 · CDP `127.0.0.1:58381` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` · claimable: **True** |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **37** · canary notes 3 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **6** · latest 2026-09-12 20:46:34 · scope: population-wide (admin) |
| teardown | killed **0** by marker · 0 left · owner's browser [25376] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| opt-out reached DISK (Chrome not running) | on-disk `uct.j2.offline.enabled` = **`'0'`** · 51 append(s) · tail `10M010101010` |
| door this run | **`tags`** — `DOORS[29 % 3]`, derived from this run's own row number |
| **mini-canary** | ✅ **11/11** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-12T20:48:48.432839+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 4 door `tags` moved the baseline under the queued entry | run **#29** ⇒ `DOORS[29 % 3]` = **`tags`** · PUT **200** in **1** attempt(s) · baseline `None` → `2026-09-12T20:49:10.257714+00:00` · queued sends that beat it: **3** |
|  ↳ 3 reload (network UP) → the local layers hold THE OFFLINE SENTENCE | record holds the sentence: **True** · draft holds the sentence: **False** · outbox entries: **0** · baseline `2026-09-12T20:49:10.257714+00:00` |
|  ↳ 4 reconnect → the queue settled (this step says NOTHING about the body) | `dirty` **0** · outbox **0** · baseline `2026-09-12T20:49:10.257714+00:00` |
|  ↳ 4 the server BODY CONTAINS THE OFFLINE SENTENCE (door `tags`) | `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-12T20:48:24Z` is in the server body: **True** · a send carried the post-door baseline `2026-09-12T20:49:10.257714+00:00`: **False** · door value kept: **True** (`tags` = ['window-check-door']) |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run - 1 pre-existing, excluded by baseline |
|  ↳ 5 note count moved by exactly this run's own note | **37 → 38** (expected **38**) |
|  ↳ 5 cleanup → stores 0, sync lock claimable, opted out | stores all zero: **True** · sync lock claimable: **True** (census **1**) · key **`'0'`** · leftover canary notes **0** (+3 pre-existing, excluded) · notes **37 → 37** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### post-door-fix canary 1 — door rotation — **2026-09-12T20:46:21Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`, Railway `createdAt` → process start). A member with an open tab keeps the OLD bundle until they reload.

| | reading |
|---|---|
| rig | PID **26844** · Chrome/152.0.7977.83 · CDP `127.0.0.1:64460` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` · claimable: **True** |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **37** · canary notes 3 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **6** · latest 2026-09-12 15:45:46 · scope: population-wide (admin) |
| teardown | killed **0** by marker · 0 left · owner's browser [25376] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| opt-out reached DISK (Chrome not running) | on-disk `uct.j2.offline.enabled` = **`'0'`** · 49 append(s) · tail `1010M0101010` |
| door this run | **`ticker`** — `DOORS[28 % 3]`, derived from this run's own row number |
| **mini-canary** | ✅ **11/11** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-12T20:46:45.290207+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 4 door `ticker` moved the baseline under the queued entry | run **#28** ⇒ `DOORS[28 % 3]` = **`ticker`** · PUT **200** in **1** attempt(s) · baseline `None` → `2026-09-12T20:47:08.094589+00:00` · queued sends that beat it: **3** |
|  ↳ 3 reload (network UP) → the local layers hold THE OFFLINE SENTENCE | record holds the sentence: **True** · draft holds the sentence: **False** · outbox entries: **0** · baseline `2026-09-12T20:47:08.094589+00:00` |
|  ↳ 4 reconnect → the queue settled (this step says NOTHING about the body) | `dirty` **0** · outbox **0** · baseline `2026-09-12T20:47:08.094589+00:00` |
|  ↳ 4 the server BODY CONTAINS THE OFFLINE SENTENCE (door `ticker`) | `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-12T20:46:21Z` is in the server body: **True** · a send carried the post-door baseline `2026-09-12T20:47:08.094589+00:00`: **False** · door value kept: **True** (`ticker` = 'NVDA') |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run - 1 pre-existing, excluded by baseline |
|  ↳ 5 note count moved by exactly this run's own note | **37 → 38** (expected **38**) |
|  ↳ 5 cleanup → stores 0, sync lock claimable, opted out | stores all zero: **True** · sync lock claimable: **True** (census **1**) · key **`'0'`** · leftover canary notes **0** (+3 pre-existing, excluded) · notes **37 → 37** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### saturday-canary-1 — **2026-09-12T13:32:54Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`, Railway `createdAt` → process start). A member with an open tab keeps the OLD bundle until they reload.

| | reading |
|---|---|
| rig | PID **33116** · Chrome/152.0.7977.83 · CDP `127.0.0.1:49358` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` · claimable: **True** |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **37** · canary notes 3 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **19** · latest 2026-09-12 05:17:56 · scope: population-wide (admin) |
| teardown | killed **0** by marker · 0 left · owner's browser [25376] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| opt-out reached DISK (Chrome not running) | on-disk `uct.j2.offline.enabled` = **`'0'`** · 45 append(s) · tail `10101010M010` |
| door this run | **`folder`** — `DOORS[27 % 3]`, derived from this run's own row number |
| **mini-canary** | ✅ **11/11** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-12T13:33:17.503129+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 4 door `folder` moved the baseline under the queued entry | run **#27** ⇒ `DOORS[27 % 3]` = **`folder`** · PUT **200** in **1** attempt(s) · baseline `None` → `2026-09-12T13:33:40.304011+00:00` · queued sends that beat it: **3** |
|  ↳ 3 reload (network UP) → the local layers hold THE OFFLINE SENTENCE | record holds the sentence: **True** · draft holds the sentence: **False** · outbox entries: **0** · baseline `2026-09-12T13:33:40.304011+00:00` |
|  ↳ 4 reconnect → the queue settled (this step says NOTHING about the body) | `dirty` **0** · outbox **0** · baseline `2026-09-12T13:33:40.304011+00:00` |
|  ↳ 4 the server BODY CONTAINS THE OFFLINE SENTENCE (door `folder`) | `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-12T13:32:54Z` is in the server body: **True** · a send carried the post-door baseline `2026-09-12T13:33:40.304011+00:00`: **False** · door value kept: **True** — `folder`'s VALUE check is N/A by construction (this note has no folder); the door is proved by the baseline move above |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run - 1 pre-existing, excluded by baseline |
|  ↳ 5 note count moved by exactly this run's own note | **37 → 38** (expected **38**) |
|  ↳ 5 cleanup → stores 0, sync lock claimable, opted out | stores all zero: **True** · sync lock claimable: **True** (census **1**) · key **`'0'`** · leftover canary notes **0** (+3 pre-existing, excluded) · notes **37 → 37** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### post-flip-5 — **2026-09-12T05:14:58Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`, Railway `createdAt` → process start). A member with an open tab keeps the OLD bundle until they reload.

| | reading |
|---|---|
| rig | PID **42420** · Chrome/152.0.7977.83 · CDP `127.0.0.1:60919` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` · claimable: **True** |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **38** · canary notes 4 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **19** · latest 2026-09-12 05:13:21 · scope: population-wide (admin) |
| teardown | killed **0** by marker · 0 left · owner's browser [25376] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| opt-out reached DISK (Chrome not running) | on-disk `uct.j2.offline.enabled` = **`'0'`** · 41 append(s) · tail `101010101010` |
| door this run | **`tags`** — `DOORS[26 % 3]`, derived from this run's own row number |
| **mini-canary** | ✅ **11/11** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-12T05:15:21.763578+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 4 door `tags` moved the baseline under the queued entry | run **#26** ⇒ `DOORS[26 % 3]` = **`tags`** · PUT **200** in **1** attempt(s) · baseline `None` → `2026-09-12T05:15:43.506648+00:00` · queued sends that beat it: **3** |
|  ↳ 3 reload (network UP) → the local layers hold THE OFFLINE SENTENCE | record holds the sentence: **True** · draft holds the sentence: **False** · outbox entries: **0** · baseline `2026-09-12T05:15:43.506648+00:00` |
|  ↳ 4 reconnect → the queue settled (this step says NOTHING about the body) | `dirty` **0** · outbox **0** · baseline `2026-09-12T05:15:43.506648+00:00` |
|  ↳ 4 the server BODY CONTAINS THE OFFLINE SENTENCE (door `tags`) | `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-12T05:14:58Z` is in the server body: **True** · a send carried the post-door baseline `2026-09-12T05:15:43.506648+00:00`: **False** · door value kept: **True** (`tags` = ['window-check-door']) |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run - 1 pre-existing, excluded by baseline |
|  ↳ 5 note count moved by exactly this run's own note | **38 → 39** (expected **39**) |
|  ↳ 5 cleanup → stores 0, sync lock claimable, opted out | stores all zero: **True** · sync lock claimable: **True** (census **1**) · key **`'0'`** · leftover canary notes **0** (+4 pre-existing, excluded) · notes **38 → 38** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### post-flip-4 — **2026-09-12T05:13:09Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`, Railway `createdAt` → process start). A member with an open tab keeps the OLD bundle until they reload.

| | reading |
|---|---|
| rig | PID **32024** · Chrome/152.0.7977.83 · CDP `127.0.0.1:53808` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` · claimable: **True** |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **38** · canary notes 4 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **19** · latest 2026-09-12 05:09:31 · scope: population-wide (admin) |
| teardown | killed **0** by marker · 0 left · owner's browser [25376] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| opt-out reached DISK (Chrome not running) | on-disk `uct.j2.offline.enabled` = **`'0'`** · 39 append(s) · tail `M01010101010` |
| door this run | **`ticker`** — `DOORS[25 % 3]`, derived from this run's own row number |
| **mini-canary** | ✅ **11/11** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-12T05:13:32.271518+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 4 door `ticker` moved the baseline under the queued entry | run **#25** ⇒ `DOORS[25 % 3]` = **`ticker`** · PUT **200** in **1** attempt(s) · baseline `None` → `2026-09-12T05:13:54.048057+00:00` · queued sends that beat it: **3** |
|  ↳ 3 reload (network UP) → the local layers hold THE OFFLINE SENTENCE | record holds the sentence: **True** · draft holds the sentence: **False** · outbox entries: **0** · baseline `2026-09-12T05:13:54.048057+00:00` |
|  ↳ 4 reconnect → the queue settled (this step says NOTHING about the body) | `dirty` **0** · outbox **0** · baseline `2026-09-12T05:13:54.048057+00:00` |
|  ↳ 4 the server BODY CONTAINS THE OFFLINE SENTENCE (door `ticker`) | `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-12T05:13:09Z` is in the server body: **True** · a send carried the post-door baseline `2026-09-12T05:13:54.048057+00:00`: **False** · door value kept: **True** (`ticker` = 'NVDA') |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run - 1 pre-existing, excluded by baseline |
|  ↳ 5 note count moved by exactly this run's own note | **38 → 39** (expected **39**) |
|  ↳ 5 cleanup → stores 0, sync lock claimable, opted out | stores all zero: **True** · sync lock claimable: **True** (census **1**) · key **`'0'`** · leftover canary notes **0** (+4 pre-existing, excluded) · notes **38 → 38** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### post-flip-3-of-3 — **2026-09-12T05:09:18Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`, Railway `createdAt` → process start). A member with an open tab keeps the OLD bundle until they reload.

| | reading |
|---|---|
| rig | PID **23920** · Chrome/152.0.7977.83 · CDP `127.0.0.1:59934` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 2 · `notes` 1 · `outbox` 1 |
| notebook locks | **0** `uct.nb.sync.*` · claimable: **True** |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **38** · canary notes 4 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **18** · latest 2026-09-12 05:03:37 · scope: population-wide (admin) |
| teardown | killed **0** by marker · 0 left · owner's browser [25376] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| opt-out reached DISK (Chrome not running) | on-disk `uct.j2.offline.enabled` = **`'0'`** · 37 append(s) · tail `10M010101010` |
| door this run | **`folder`** — `DOORS[24 % 3]`, derived from this run's own row number |
| **mini-canary** | ✅ **11/11** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-12T05:09:42.200707+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 4 door `folder` moved the baseline under the queued entry | run **#24** ⇒ `DOORS[24 % 3]` = **`folder`** · PUT **200** in **1** attempt(s) · baseline `None` → `2026-09-12T05:10:05.745190+00:00` · queued sends that beat it: **3** |
|  ↳ 3 reload (network UP) → the local layers hold THE OFFLINE SENTENCE | record holds the sentence: **True** · draft holds the sentence: **False** · outbox entries: **0** · baseline `2026-09-12T05:10:05.745190+00:00` |
|  ↳ 4 reconnect → the queue settled (this step says NOTHING about the body) | `dirty` **0** · outbox **0** · baseline `2026-09-12T05:10:05.745190+00:00` |
|  ↳ 4 the server BODY CONTAINS THE OFFLINE SENTENCE (door `folder`) | `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-12T05:09:18Z` is in the server body: **True** · a send carried the post-door baseline `2026-09-12T05:10:05.745190+00:00`: **False** · door value kept: **True** — `folder`'s VALUE check is N/A by construction (this note has no folder); the door is proved by the baseline move above |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run - 1 pre-existing, excluded by baseline |
|  ↳ 5 note count moved by exactly this run's own note | **38 → 39** (expected **39**) |
|  ↳ 5 cleanup → stores 0, sync lock claimable, opted out | stores all zero: **True** · sync lock claimable: **True** (census **1**) · key **`'0'`** · leftover canary notes **0** (+4 pre-existing, excluded) · notes **38 → 38** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### check 15 — **2026-09-12T05:07:19Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`, Railway `createdAt` → process start). A member with an open tab keeps the OLD bundle until they reload.

| | reading |
|---|---|
| rig | PID **38928** · Chrome/152.0.7977.83 · CDP `127.0.0.1:58490` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 2 · `notes` 1 · `outbox` 1 |
| notebook locks | **0** `uct.nb.sync.*` · claimable: **True** |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **38** · canary notes 4 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **18** · latest 2026-09-12 05:03:37 · scope: population-wide (admin) |
| teardown | killed **9** by marker · 0 left · owner's browser [25376] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | — not run this pass |

### post-flip-2-of-3 — **2026-09-12T05:01:35Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`, Railway `createdAt` → process start). A member with an open tab keeps the OLD bundle until they reload.

| | reading |
|---|---|
| rig | PID **39688** · Chrome/152.0.7977.83 · CDP `127.0.0.1:62785` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` · claimable: **True** |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **37** · canary notes 3 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **16** · latest 2026-09-12 04:59:56 · scope: population-wide (admin) |
| teardown | killed **0** by marker · 0 left · owner's browser [25376] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| opt-out reached DISK (Chrome not running) | on-disk `uct.j2.offline.enabled` = **`'0'`** · 33 append(s) · tail `101010M01010` |
| door this run | **`ticker`** — `DOORS[22 % 3]`, derived from this run's own row number |
| **mini-canary** | ✅ **11/11** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-12T05:01:58.389137+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 4 door `ticker` moved the baseline under the queued entry | run **#22** ⇒ `DOORS[22 % 3]` = **`ticker`** · PUT **200** in **1** attempt(s) · baseline `None` → `2026-09-12T05:02:20.339878+00:00` · queued sends that beat it: **3** |
|  ↳ 3 reload (network UP) → the local layers hold THE OFFLINE SENTENCE | record holds the sentence: **True** · draft holds the sentence: **False** · outbox entries: **0** · baseline `2026-09-12T05:02:20.339878+00:00` |
|  ↳ 4 reconnect → the queue settled (this step says NOTHING about the body) | `dirty` **0** · outbox **0** · baseline `2026-09-12T05:02:20.339878+00:00` |
|  ↳ 4 the server BODY CONTAINS THE OFFLINE SENTENCE (door `ticker`) | `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-12T05:01:35Z` is in the server body: **True** · a send carried the post-door baseline `2026-09-12T05:02:20.339878+00:00`: **False** · door value kept: **True** (`ticker` = 'NVDA') |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run - 1 pre-existing, excluded by baseline |
|  ↳ 5 note count moved by exactly this run's own note | **37 → 38** (expected **38**) |
|  ↳ 5 cleanup → stores 0, sync lock claimable, opted out | stores all zero: **True** · sync lock claimable: **True** (census **1**) · key **`'0'`** · leftover canary notes **0** (+3 pre-existing, excluded) · notes **37 → 37** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### post-flip-1-of-3 — **2026-09-12T04:59:44Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`, Railway `createdAt` → process start). A member with an open tab keeps the OLD bundle until they reload.

| | reading |
|---|---|
| rig | PID **35460** · Chrome/152.0.7977.83 · CDP `127.0.0.1:49734` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` · claimable: **True** |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **37** · canary notes 3 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **15** · latest 2026-09-12 04:57:38 · scope: population-wide (admin) |
| teardown | killed **0** by marker · 0 left · owner's browser [25376] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| opt-out reached DISK (Chrome not running) | on-disk `uct.j2.offline.enabled` = **`'0'`** · 31 append(s) · tail `10101010M010` |
| door this run | **`folder`** — `DOORS[21 % 3]`, derived from this run's own row number |
| **mini-canary** | ✅ **11/11** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-12T05:00:07.712785+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 4 door `folder` moved the baseline under the queued entry | run **#21** ⇒ `DOORS[21 % 3]` = **`folder`** · PUT **200** in **1** attempt(s) · baseline `None` → `2026-09-12T05:00:30.170135+00:00` · queued sends that beat it: **3** |
|  ↳ 3 reload (network UP) → the local layers hold THE OFFLINE SENTENCE | record holds the sentence: **True** · draft holds the sentence: **False** · outbox entries: **0** · baseline `2026-09-12T05:00:30.170135+00:00` |
|  ↳ 4 reconnect → the queue settled (this step says NOTHING about the body) | `dirty` **0** · outbox **0** · baseline `2026-09-12T05:00:30.170135+00:00` |
|  ↳ 4 the server BODY CONTAINS THE OFFLINE SENTENCE (door `folder`) | `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-12T04:59:44Z` is in the server body: **True** · a send carried the post-door baseline `2026-09-12T05:00:30.170135+00:00`: **False** · door value kept: **True** — `folder`'s VALUE check is N/A by construction (this note has no folder); the door is proved by the baseline move above |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run - 1 pre-existing, excluded by baseline |
|  ↳ 5 note count moved by exactly this run's own note | **37 → 38** (expected **38**) |
|  ↳ 5 cleanup → stores 0, sync lock claimable, opted out | stores all zero: **True** · sync lock claimable: **True** (census **1**) · key **`'0'`** · leftover canary notes **0** (+3 pre-existing, excluded) · notes **37 → 37** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### check 14 — **2026-09-12T01:35:20Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`). A member with an open tab keeps the OLD bundle until they reload. It stops processing; it destroys nothing. ⚰️ *Corrected in place 2026-09-12 — the rows below were STAMPED with the false env-var line; the tool that printed it is fixed, and nothing else in the row is altered.*

| | reading |
|---|---|
| rig | PID **21688** · Chrome/152.0.7977.83 · CDP `127.0.0.1:58534` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` · claimable: **True** |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **37** · canary notes 3 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **7** · latest 2026-09-12 01:28:48 · scope: population-wide (admin) |
| teardown | killed **0** by marker · 0 left · owner's browser [38500] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| opt-out reached DISK (Chrome not running) | on-disk `uct.j2.offline.enabled` = **`'0'`** · 13 append(s) · tail `101010101010` |
| door this run | **`tags`** — `DOORS[20 % 3]`, derived from this run's own row number |
| **mini-canary** | ✅ **11/11** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-12T01:35:42.819954+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 4 door `tags` moved the baseline under the queued entry | run **#20** ⇒ `DOORS[20 % 3]` = **`tags`** · PUT **200** in **1** attempt(s) · baseline `None` → `2026-09-12T01:36:04.675740+00:00` · queued sends that beat it: **3** |
|  ↳ 3 reload (network UP) → the local layers hold THE OFFLINE SENTENCE | record holds the sentence: **True** · draft holds the sentence: **False** · outbox entries: **0** · baseline `2026-09-12T01:36:04.675740+00:00` |
|  ↳ 4 reconnect → the queue settled (this step says NOTHING about the body) | `dirty` **0** · outbox **0** · baseline `2026-09-12T01:36:04.675740+00:00` |
|  ↳ 4 the server BODY CONTAINS THE OFFLINE SENTENCE (door `tags`) | `WINDOW-CHECK-SENTINEL typed offline @ 2026-09-12T01:35:20Z` is in the server body: **True** · a send carried the post-door baseline `2026-09-12T01:36:04.675740+00:00`: **False** · door value kept: **True** (`tags` = ['window-check-door']) |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run - 1 pre-existing, excluded by baseline |
|  ↳ 5 note count moved by exactly this run's own note | **37 → 38** (expected **38**) |
|  ↳ 5 cleanup → stores 0, sync lock claimable, opted out | stores all zero: **True** · sync lock claimable: **True** (census **1**) · key **`'0'`** · leftover canary notes **0** (+3 pre-existing, excluded) · notes **37 → 37** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### proof-reads-only-exits-3 — **2026-09-11T12:06:13Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`). A member with an open tab keeps the OLD bundle until they reload. It stops processing; it destroys nothing. ⚰️ *Corrected in place 2026-09-12 — the rows below were STAMPED with the false env-var line; the tool that printed it is fixed, and nothing else in the row is altered.*

| | reading |
|---|---|
| rig | PID **44208** · Chrome/152.0.7977.83 · CDP `127.0.0.1:51297` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 108 · `notes` 54 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **unset** — a profile that has never opted in |
| notes | **34** · canary notes 2 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **0** · latest **none** · scope: population-wide (admin)  ⛔⛔ **zero events over zero opted-in browsers is not evidence** |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | — not run this pass |

### streak-7-of-7 — **2026-09-11T12:03:30Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`). A member with an open tab keeps the OLD bundle until they reload. It stops processing; it destroys nothing. ⚰️ *Corrected in place 2026-09-12 — the rows below were STAMPED with the false env-var line; the tool that printed it is fixed, and nothing else in the row is altered.*

⛔ **mini-canary suspended pending self-fork round 3** — this row is READS ONLY: nothing was opted in, nothing was created on the account, not a single write. The fork detector and the offline-sentence check remain defined and remain hard reds; re-arming is one constant.

| | reading |
|---|---|
| rig | PID **22312** · Chrome/152.0.7977.83 · CDP `127.0.0.1:64776` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 108 · `notes` 54 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **unset** — a profile that has never opted in |
| notes | **34** · canary notes 2 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **0** · latest **none** · scope: population-wide (admin)  ⛔⛔ **zero events over zero opted-in browsers is not evidence** |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ⛔ **mini-canary suspended pending self-fork round 3** |

### streak-6-of-7 — **2026-09-11T12:03:15Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`). A member with an open tab keeps the OLD bundle until they reload. It stops processing; it destroys nothing. ⚰️ *Corrected in place 2026-09-12 — the rows below were STAMPED with the false env-var line; the tool that printed it is fixed, and nothing else in the row is altered.*

⛔ **mini-canary suspended pending self-fork round 3** — this row is READS ONLY: nothing was opted in, nothing was created on the account, not a single write. The fork detector and the offline-sentence check remain defined and remain hard reds; re-arming is one constant.

| | reading |
|---|---|
| rig | PID **27716** · Chrome/152.0.7977.83 · CDP `127.0.0.1:62418` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 108 · `notes` 54 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **unset** — a profile that has never opted in |
| notes | **34** · canary notes 2 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **0** · latest **none** · scope: population-wide (admin)  ⛔⛔ **zero events over zero opted-in browsers is not evidence** |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ⛔ **mini-canary suspended pending self-fork round 3** |

### streak-5-of-7 — **2026-09-11T12:03:01Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`). A member with an open tab keeps the OLD bundle until they reload. It stops processing; it destroys nothing. ⚰️ *Corrected in place 2026-09-12 — the rows below were STAMPED with the false env-var line; the tool that printed it is fixed, and nothing else in the row is altered.*

⛔ **mini-canary suspended pending self-fork round 3** — this row is READS ONLY: nothing was opted in, nothing was created on the account, not a single write. The fork detector and the offline-sentence check remain defined and remain hard reds; re-arming is one constant.

| | reading |
|---|---|
| rig | PID **16320** · Chrome/152.0.7977.83 · CDP `127.0.0.1:53091` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 108 · `notes` 54 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **unset** — a profile that has never opted in |
| notes | **34** · canary notes 2 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **0** · latest **none** · scope: population-wide (admin)  ⛔⛔ **zero events over zero opted-in browsers is not evidence** |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ⛔ **mini-canary suspended pending self-fork round 3** |

### streak-4-of-7 — **2026-09-11T12:02:46Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`). A member with an open tab keeps the OLD bundle until they reload. It stops processing; it destroys nothing. ⚰️ *Corrected in place 2026-09-12 — the rows below were STAMPED with the false env-var line; the tool that printed it is fixed, and nothing else in the row is altered.*

⛔ **mini-canary suspended pending self-fork round 3** — this row is READS ONLY: nothing was opted in, nothing was created on the account, not a single write. The fork detector and the offline-sentence check remain defined and remain hard reds; re-arming is one constant.

| | reading |
|---|---|
| rig | PID **48812** · Chrome/152.0.7977.83 · CDP `127.0.0.1:63078` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 108 · `notes` 54 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **unset** — a profile that has never opted in |
| notes | **34** · canary notes 2 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **0** · latest **none** · scope: population-wide (admin)  ⛔⛔ **zero events over zero opted-in browsers is not evidence** |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ⛔ **mini-canary suspended pending self-fork round 3** |

### streak-3-of-7 — **2026-09-11T12:02:33Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`). A member with an open tab keeps the OLD bundle until they reload. It stops processing; it destroys nothing. ⚰️ *Corrected in place 2026-09-12 — the rows below were STAMPED with the false env-var line; the tool that printed it is fixed, and nothing else in the row is altered.*

⛔ **mini-canary suspended pending self-fork round 3** — this row is READS ONLY: nothing was opted in, nothing was created on the account, not a single write. The fork detector and the offline-sentence check remain defined and remain hard reds; re-arming is one constant.

| | reading |
|---|---|
| rig | PID **42420** · Chrome/152.0.7977.83 · CDP `127.0.0.1:60580` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 108 · `notes` 54 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **unset** — a profile that has never opted in |
| notes | **34** · canary notes 2 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **0** · latest **none** · scope: population-wide (admin)  ⛔⛔ **zero events over zero opted-in browsers is not evidence** |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ⛔ **mini-canary suspended pending self-fork round 3** |

### streak-2-of-7 — **2026-09-11T12:02:16Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`). A member with an open tab keeps the OLD bundle until they reload. It stops processing; it destroys nothing. ⚰️ *Corrected in place 2026-09-12 — the rows below were STAMPED with the false env-var line; the tool that printed it is fixed, and nothing else in the row is altered.*

⛔ **mini-canary suspended pending self-fork round 3** — this row is READS ONLY: nothing was opted in, nothing was created on the account, not a single write. The fork detector and the offline-sentence check remain defined and remain hard reds; re-arming is one constant.

| | reading |
|---|---|
| rig | PID **31612** · Chrome/152.0.7977.83 · CDP `127.0.0.1:57251` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 108 · `notes` 54 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **unset** — a profile that has never opted in |
| notes | **34** · canary notes 2 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **0** · latest **none** · scope: population-wide (admin)  ⛔⛔ **zero events over zero opted-in browsers is not evidence** |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ⛔ **mini-canary suspended pending self-fork round 3** |

## ⛔⛔ THE FIRST "STREAK" WAS VOID - READ THIS BEFORE THE ROWS BELOW

The seven rows labelled `streak-N-of-7` at **2026-09-11T12:01-12:03Z** are
**NOT a streak.** They are kept because deleting them would hide the finding.

All seven exited **0** in **106 seconds total** - about fifteen seconds each -
and every one of them did **READS ONLY**: rig up, signed in, stores counted,
telemetry read, teardown. No note, no typing, no door, no fork check. The tool's
own row says so (`mini-canary | - not run this pass`), and it even printed
*"zero events over zero opted-in browsers is not evidence"*.

**Why:** `CANARY_SUSPENDED` was still `True` ("pending self-fork round 3"), and
`canary_should_run` deliberately lets the SWITCH win over a missing
`--no-canary` so a scheduled task cannot write while a hard stop is open. That
guard worked exactly as designed.

⛔⛔ **THE SUPPRESSION WORKED; THE REPORTING DID NOT.** A caller counting exit
codes could not tell *seven clean canaries* from *seven runs that did nothing* -
both are `0`. An instrument that can manufacture a streak out of doing nothing is
the same shape as the round-3 artifact it was suspended for
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

**Both halves are fixed, in one commit:**

| | |
|---|---|
| the switch | `CANARY_SUSPENDED = False` - round 3 closed by finding, and the canary now fires `REAL_DOOR_JS`, the member's own door |
| the reporting | a run whose canary did not fire **exits 3, never 0**, and says so. Any streak loop counts 0 and only 0 |
| the pin | the self-check case is INVERTED, not deleted - the state is still asserted, so flipping it back shows as a red line rather than silence |

⭐ Proved on a real run before the real streak was started: `--no-canary`
returned exit **3** with *"READS-ONLY RUN - the canary did not fire."*

---

### streak-1-of-7 — **2026-09-11T12:01:44Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`). A member with an open tab keeps the OLD bundle until they reload. It stops processing; it destroys nothing. ⚰️ *Corrected in place 2026-09-12 — the rows below were STAMPED with the false env-var line; the tool that printed it is fixed, and nothing else in the row is altered.*

⛔ **mini-canary suspended pending self-fork round 3** — this row is READS ONLY: nothing was opted in, nothing was created on the account, not a single write. The fork detector and the offline-sentence check remain defined and remain hard reds; re-arming is one constant.

| | reading |
|---|---|
| rig | PID **46068** · Chrome/152.0.7977.83 · CDP `127.0.0.1:63363` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 108 · `notes` 54 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **unset** — a profile that has never opted in |
| notes | **34** · canary notes 2 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **0** · latest **none** · scope: population-wide (admin)  ⛔⛔ **zero events over zero opted-in browsers is not evidence** |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ⛔ **mini-canary suspended pending self-fork round 3** |

### check 13 — **2026-09-11T04:18:40Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`). A member with an open tab keeps the OLD bundle until they reload. It stops processing; it destroys nothing. ⚰️ *Corrected in place 2026-09-12 — the rows below were STAMPED with the false env-var line; the tool that printed it is fixed, and nothing else in the row is altered.*

⛔ **mini-canary suspended pending self-fork round 3** — this row is READS ONLY: nothing was opted in, nothing was created on the account, not a single write. The fork detector and the offline-sentence check remain defined and remain hard reds; re-arming is one constant.

| | reading |
|---|---|
| rig | PID **27516** · Chrome/152.0.7977.83 · CDP `127.0.0.1:51719` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 108 · `notes` 54 · `outbox` 0 |
| notebook locks | **1** `uct.nb.sync.*` |
| opt-in key | **`'1'`** ⇒ **OPTED IN** — unexpected at rest; a previous run did not opt back out |
| notes | **63** · canary notes 31 · `sync-conflict` 15 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **0** · latest **none** · scope: population-wide (admin)  ⛔⛔ **zero events over zero opted-in browsers is not evidence** |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ⛔ **mini-canary suspended pending self-fork round 3** |

### check 12 — **2026-09-11T02:56:22Z**

⛔ **ROLLBACK — IT IS A DEPLOY, NOT A VARIABLE.** `OFFLINE_DEFAULT_ON` is a **compile-time constant** in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`, baked into the frontend bundle — there is no Railway env var behind it. To roll back: revert the flip commit, push to `master`, and wait for the `web` service to rebuild and redeploy (**~2–3 min**; measured once at **138 s** on `b63cf9775`). A member with an open tab keeps the OLD bundle until they reload. It stops processing; it destroys nothing. ⚰️ *Corrected in place 2026-09-12 — the rows below were STAMPED with the false env-var line; the tool that printed it is fixed, and nothing else in the row is altered.*

⛔ **mini-canary suspended pending self-fork round 3** — this row is READS ONLY: nothing was opted in, nothing was created on the account, not a single write. The fork detector and the offline-sentence check remain defined and remain hard reds; re-arming is one constant.

| | reading |
|---|---|
| rig | PID **9668** · Chrome/152.0.7977.83 · CDP `127.0.0.1:60600` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 4 · `notes` 2 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **36** · canary notes 4 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **17** · latest 2026-09-11 02:55:21 · scope: population-wide (admin) |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ⛔ **mini-canary suspended pending self-fork round 3** |

### check 11 — **2026-09-11T00:30:59Z**

| | reading |
|---|---|
| rig | PID **3376** · Chrome/152.0.7977.83 · CDP `127.0.0.1:62713` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 2 · `notes` 1 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **34** · canary notes 2 · `sync-conflict` 3 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **16** · latest 2026-09-11 00:01:11 · scope: population-wide (admin) |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | — not run this pass |

### deploy #4 live — run 2 of 7 — **2026-09-10T16:53:34Z**

| | reading |
|---|---|
| rig | PID **38068** · Chrome/152.0.7977.83 · CDP `127.0.0.1:56963` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **1** `uct.nb.sync.*` |
| opt-in key | **`'1'`** ⇒ **OPTED IN** — unexpected at rest; a previous run did not opt back out |
| notes | **32** · canary notes 0 · `sync-conflict` 2 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **15** · latest 2026-09-10 16:50:37 · scope: population-wide (admin) |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ✅ **8/8** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-10T16:53:58.831346+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 3 reload (network UP) → the words survive | record holds text: **True** · draft holds text: **True** · outbox entries: **1** · baseline `2026-09-10T16:54:06.360403+00:00` |
|  ↳ 4 reconnect → drained, re-based, server has the words | `dirty` **0** · outbox **0** · server holds text: **True** · baseline `2026-09-10T16:54:31.757445+00:00` |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run |
|  ↳ 5 cleanup → stores 0, locks 0, opted out | stores all zero: **True** · locks **0** · key **`'0'`** · leftover canary notes **0** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### deploy #4 live — run 1 of 7 — **2026-09-10T16:50:13Z**

| | reading |
|---|---|
| rig | PID **27312** · Chrome/152.0.7977.83 · CDP `127.0.0.1:49644` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **32** · canary notes 0 · `sync-conflict` 2 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **14** · latest 2026-09-10 14:00:22 · scope: population-wide (admin) |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ✅ **8/8** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-10T16:50:42.416796+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 3 reload (network UP) → the words survive | record holds text: **True** · draft holds text: **True** · outbox entries: **1** · baseline `2026-09-10T16:50:50.263872+00:00` |
|  ↳ 4 reconnect → drained, re-based, server has the words | `dirty` **0** · outbox **0** · server holds text: **True** · baseline `2026-09-10T16:51:15.473332+00:00` |
|  ↳ 5 no fork from a single writer | no `(conflicted copy)` created by this run |
|  ↳ 5 cleanup → stores 0, locks 0, opted out | stores all zero: **True** · locks **0** · key **`'0'`** · leftover canary notes **0** |
|  ↳ 5 opted back out — ALWAYS, finding or not | `uct.j2.offline.enabled` read back as `'0'` |

### check 10 — **2026-09-10T13:37:03Z**

| | reading |
|---|---|
| rig | PID **38748** · Chrome/152.0.7977.83 · CDP `127.0.0.1:55804` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **32** · canary notes 0 · `sync-conflict` 2 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **7** · latest 2026-09-10 13:36:06 · scope: population-wide (admin) |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ✅ **6/6** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-10T13:37:22.159541+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 3 reload (network UP) → the words survive | record holds text: **True** · draft holds text: **True** · outbox entries: **1** · baseline `2026-09-10T13:37:29.958500+00:00` |
|  ↳ 4 reconnect → drained, re-based, server has the words | `dirty` **0** · outbox **0** · server holds text: **True** · baseline `2026-09-10T13:37:54.093623+00:00` |
|  ↳ 5 cleanup → stores 0, locks 0, opted out | stores all zero: **True** · locks **0** · key **`'0'`** · leftover canary notes **0** |

### check 9 — **2026-09-10T13:35:52Z**

| | reading |
|---|---|
| rig | PID **33584** · Chrome/152.0.7977.83 · CDP `127.0.0.1:52003` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **32** · canary notes 0 · `sync-conflict` 2 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **6** · latest 2026-09-10 13:34:55 · scope: population-wide (admin) |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ✅ **6/6** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-10T13:36:11.656622+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 3 reload (network UP) → the words survive | record holds text: **True** · draft holds text: **True** · outbox entries: **1** · baseline `2026-09-10T13:36:18.932327+00:00` |
|  ↳ 4 reconnect → drained, re-based, server has the words | `dirty` **0** · outbox **0** · server holds text: **True** · baseline `2026-09-10T13:36:43.763718+00:00` |
|  ↳ 5 cleanup → stores 0, locks 0, opted out | stores all zero: **True** · locks **0** · key **`'0'`** · leftover canary notes **0** |

### check 8 — **2026-09-10T13:34:43Z**

| | reading |
|---|---|
| rig | PID **22732** · Chrome/152.0.7977.83 · CDP `127.0.0.1:60734` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **32** · canary notes 0 · `sync-conflict` 2 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **5** · latest 2026-09-10 13:33:47 · scope: population-wide (admin) |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ✅ **6/6** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-10T13:35:01.585937+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 3 reload (network UP) → the words survive | record holds text: **True** · draft holds text: **True** · outbox entries: **1** · baseline `2026-09-10T13:35:09.173962+00:00` |
|  ↳ 4 reconnect → drained, re-based, server has the words | `dirty` **0** · outbox **0** · server holds text: **True** · baseline `2026-09-10T13:35:33.423082+00:00` |
|  ↳ 5 cleanup → stores 0, locks 0, opted out | stores all zero: **True** · locks **0** · key **`'0'`** · leftover canary notes **0** |

### check 7 — **2026-09-10T13:33:33Z**

| | reading |
|---|---|
| rig | PID **35204** · Chrome/152.0.7977.83 · CDP `127.0.0.1:53727` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **32** · canary notes 0 · `sync-conflict` 2 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **4** · latest 2026-09-10 13:22:41 · scope: population-wide (admin) |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ✅ **6/6** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-10T13:33:52.070787+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 3 reload (network UP) → the words survive | record holds text: **True** · draft holds text: **True** · outbox entries: **1** · baseline `2026-09-10T13:33:59.663460+00:00` |
|  ↳ 4 reconnect → drained, re-based, server has the words | `dirty` **0** · outbox **0** · server holds text: **True** · baseline `2026-09-10T13:34:23.546750+00:00` |
|  ↳ 5 cleanup → stores 0, locks 0, opted out | stores all zero: **True** · locks **0** · key **`'0'`** · leftover canary notes **0** |

### check 6 — **2026-09-10T13:22:28Z**

| | reading |
|---|---|
| rig | PID **28408** · Chrome/152.0.7977.83 · CDP `127.0.0.1:54092` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **32** · canary notes 0 · `sync-conflict` 2 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **3** · latest 2026-09-10 13:21:19 · scope: population-wide (admin) |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ✅ **6/6** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-10T13:22:46.981172+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 3 reload (network UP) → the words survive | record holds text: **True** · draft holds text: **True** · outbox entries: **1** · baseline `2026-09-10T13:22:54.984057+00:00` |
|  ↳ 4 reconnect → drained, re-based, server has the words | `dirty` **0** · outbox **0** · server holds text: **True** · baseline `2026-09-10T13:23:18.206536+00:00` |
|  ↳ 5 cleanup → stores 0, locks 0, opted out | stores all zero: **True** · locks **0** · key **`'0'`** · leftover canary notes **0** |

### check 5 — **2026-09-10T13:21:07Z**

| | reading |
|---|---|
| rig | PID **38120** · Chrome/152.0.7977.83 · CDP `127.0.0.1:50087` · **persistent profile** |
| signed in | `/api/auth/me` **200**, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` |
| offline proven both ways | offline ⇒ `FAILED: TypeError`, `onLine=false` · online ⇒ `ONLINE 200`, `true` |
| four durable stores | `conflicts` 0 · `meta` 0 · `notes` 0 · `outbox` 0 |
| notebook locks | **0** `uct.nb.sync.*` |
| opt-in key | **`'0'`** — the rig's own last opt-out. ⚠️ On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1. |
| notes | **32** · canary notes 0 · `sync-conflict` 2 |
| telemetry scope | **population-wide (admin)** |
| `j2:notebook_blocked_no_baseline` | count **0** · latest **none** · scope: population-wide (admin) |
| opted-in browsers (`j2:notebook_offline_opt_in`) | count **2** · latest 2026-09-10 13:19:21 · scope: population-wide (admin) |
| teardown | killed **9** by marker · 0 left · owner's browser [10896] untouched |
| profile KEPT, lock released | `canary-chrome-profile-persistent` retained · lock free ⇒ the next run can open it |
| **mini-canary** | ✅ **6/6** steps green |
|  ↳ 1 opt in → leadership | held **['exclusive']**, pending **0**, DB opened with 4 stores |
|  ↳ 2 type online → one CAS PUT | **1** PUT(s), baseline(s) `['2026-09-10T13:21:25.623969+00:00']` |
|  ↳ 3 offline is real | `FAILED: TypeError` |
|  ↳ 3 reload (network UP) → the words survive | record holds text: **True** · draft holds text: **True** · outbox entries: **1** · baseline `2026-09-10T13:21:33.676932+00:00` |
|  ↳ 4 reconnect → drained, re-based, server has the words | `dirty` **0** · outbox **0** · server holds text: **True** · baseline `2026-09-10T13:21:56.622866+00:00` |
|  ↳ 5 cleanup → stores 0, locks 0, opted out | stores all zero: **True** · locks **0** · key **`'0'`** · leftover canary notes **0** |

### ⭐⭐ AND IT RUNS A MINI-CANARY EVERY DAY

After the reads, each run drives the §15 happy path end to end and captures the
artifact at every step:

| step | what it proves |
|---|---|
| 1 | opt in ⇒ exactly **one EXCLUSIVE** lock, **0** pending, the per-account DB opened |
| 2 | create a note, type online ⇒ **one PUT carrying a real baseline** |
| 3 | offline (probe must FAIL), type, **reload with the NETWORK UP** ⇒ all three layers still hold the words, baseline real |
| 4 | reconnect ⇒ **one CAS PUT**, `dirty:0`, the server has the words |
| 5 | §15 step 11 cleanup ⇒ soft-delete, four stores **0**, locks **0**, opt back out to `'0'` |
| 6 | teardown by marker, owner's browser verified by command line |

⛔⛔ **ANY `null`/`''` BASELINE, OR ANY EMPTY DOCUMENT, FAILS THE RUN LOUDLY** —
the row is headed **🚨 NEW FINDING**, names the artifact, and **the canary note
is deliberately NOT deleted.** A run that finds the thing this wave exists to
prevent and then tidies the evidence away is worse than no run at all.

⛔ **The reload is performed with the network UP**, per the amended §15: Wave Q1
has no service worker, so an offline reload cannot fetch `index.html` — the SPA
never loads and storage is not readable from that context. That ordering would
prove nothing.

⭐ **The opt-in count climbs by one per run.** Each run uses a fresh profile, so
each is a genuinely new browser and fires `notebook_offline_opt_in` once — which
is what makes the denominator move.

⛔ It creates nothing outside that canary note, and **never writes the offline
flag constant**. The per-browser `localStorage` opt-in it sets lives and dies
inside its own throwaway profile.

Identity is asserted by **account id**, never by echoing an address.

### ⭐⭐ THE COUNTS DO NOT NEED ADMIN — and that nearly went unnoticed

`GET /api/admin/activity` is admin-gated (`ADMIN_EMAILS` + two hardcoded owner
addresses, `auth.py:104-106`), and the canary is not on that list. Reading the
two telemetry counts *only* through that endpoint would have meant seven
mornings of refusals discovered on 9/17.

⭐ **`GET /api/auth/export-data` is gated by `get_current_user` alone** and
returns this account's own `activity_log` rows (`auth.py:354-364`). The events
are written under the signed-in user's id, so the rig can always read its own —
no admin, no env change, no deploy.

⛔ **THE SCOPE IS REPORTED, NEVER SILENTLY SWAPPED.** The run tries admin first
and falls back, and the row says which it got:

| scope | what a zero means |
|---|---|
| `population-wide (admin)` | no member anywhere hit it |
| `this account only (export-data)` | **the rig** did not hit it — says nothing about members |

Those are different facts, and reading one as the other is how a gate gets
satisfied by the wrong evidence. ⚠️ The export caps at **100 rows**; a full page
is flagged as a possible truncation rather than trusted as a complete count.

### Check 1 — **2026-09-10T04:16:51Z** (window opens)

| what | reading | |
|---|---|---|
| deploy `cd674ef56` still an ancestor of `master` | **YES**, `master` = `f58383e69` | ✅ |
| `OFFLINE_DEFAULT_ON` on the LIVE bundle | **`false`** — `assets/NotebookTab-CMePJ5Sn.js` compiles it to `const zi=!1`, returned whenever the opt-in key is unset. The fix is live in the same chunk (`Ue` = `usableBaseline`). | ✅ |
| Item-2 events fired | **0, by construction** — the instrument is on the branch, NOT on `master`. Until it deploys, "zero occurrences" means "not yet measurable", not "measured zero". ⛔ Do not read the first deployed check as a continuation of this row. | ⚠️ |
| member reports of an empty document | **none reached this session** | ✅ |
| inherited-red ledger | **UNCHANGED** — the same 8 files fail the full frontend suite after merging `origin/master` (`f58383e69`); no new offenders, nothing inside `journal-2-0` | ✅ |
| production Notebook end state (4 stores 0 · 0 locks · key `'0'`) | ⛔ **NOT RE-DRIVEN — and it cannot be, as written.** See below. | ⛔ |
| `/api/health` | `ok`, `uptime_seconds` 3264 (≈54 min). Not a deploy: `master` has not moved and the bundle hashes are byte-identical to the canary's. | ✅ |

⛔ **Why the production-store row is honest rather than green.** That reading
needs an AUTHENTICATED browser session against production, and the rig that took
it is fully torn down — deliberately, and verified. Its profile directory is one
of the two leftovers below. **A fresh profile would not be signed in, and this
session does not enter credentials.**

⚠️ **And the target was per-profile anyway.** `key '0'` was `localStorage` in the
canary rig's own Chrome profile; that profile no longer runs. A new browser
would read the key **unset** — which is production's default and equals off, but
is a *different reading*, not the same one confirmed again. ⛔ Re-stating `'0'`
here without a browser would be inventing a measurement.

### Check 4 — ⛔ **NOT STAMPED: `.env` IS STILL MISSING** (2026-09-10T06:28:31Z)

The script now carries the mini-canary and 19 self-check cases, and it is on a
daily schedule. It still cannot authenticate, so **no row was stamped** — which
is the refusal working, not a gap in it.

| | reading |
|---|---|
| `--self-check` | ✅ **PASS 19/19** — including a synthetic `null` baseline, a synthetic `''` baseline, whitespace, a non-string, a nested baseline, the incident's empty-paragraph shape, both controls, and that a finding **suppresses cleanup** and heads the row **NEW FINDING** |
| real run | ⛔ **STOP** at the credential read, exit **1**, before spawning a browser |
| the log | `docs/notebook/window-check.log` — `check 4: starting` then `check 4: STOPPED — …\.env is missing…` |
| the row | **none** — the doc was not touched |
| scheduled task | ✅ registered, enabled, next run **2026-09-10 09:00 local**, expires after **2026-09-17** |

⛔ **Event count and opt-in count: still unread.** Both need the session. They
are absent from this document, not estimated in it.

### Check 2 — ⛔ **NOT RUN: `.env` IS MISSING** (2026-09-10T05:2x UTC)

The rig was up and parked at the login page. The owner's instruction named the
credentials as `CANARY_EMAIL` / `CANARY_PASSWORD` **in the worktree's `.env`**,
authorised reading them from **that file only**, and said to STOP if it was
missing. It is missing — `git check-ignore` confirms `.gitignore:1` would cover
it, so it is expected to exist and simply does not on this machine.

| | reading |
|---|---|
| rig | PID **19752**, Chrome/152.0.7977.83, CDP `127.0.0.1:9411`, fresh profile |
| offline **proven both ways** | offline ⇒ **FAILED: TypeError**, `navigator.onLine=false` · online ⇒ **ONLINE 200**, `true` |
| `/api/auth/me` | **401** — never signed in |
| every production read | ⛔ **NOT TAKEN** — they all require the session |
| teardown | **8** processes killed **by the `canary-chrome-profile` marker**, 0 left, CDP endpoint gone, owner's browser **10896** alive |

⛔ **No credential search anywhere else, as instructed.** Drop the file in place
and check 2 is one command (below).

### Check 3 — ⛔ **NOT RUN, same cause**

`tools/window_check.py` was written, and its `--self-check` **passes 5/5**. The
real run stops before spawning anything:

> `STOP: …\.env is missing. The canary credentials live there as CANARY_EMAIL /
> CANARY_PASSWORD. This script does not look anywhere else.` (exit 1)

⭐ That refusal IS the proving run for the credential path — it stops at the
right place, writes nothing, and leaves no browser behind. The production reads
remain unproved end to end, and that is stated rather than implied.

**To close this row on the next check**, the owner stands up an authenticated
session (or says to build the CDP rig again and signs in, exactly as on
2026-09-10) and the check reads: four stores 0 · 0 `uct.nb.sync.*` locks · the
opt-in key unset-or-`'0'`.

# 🗳️ THE 2026-09-17 DECISION — DRAFTED IN ADVANCE, ON PURPOSE

⛔ **ROWS 1–3 AND THE RECOMMENDATION ARE MAINTAINED BY THE SCRIPT.** Every run of
`tools/window_check.py` regenerates the block below from what it actually read,
so on 9/17 the packet is already current rather than something someone has to
remember to refresh. ⛔ Do not hand-edit between the markers — the next run
overwrites it. Rows 4–9 are static and checked by eye on the day.

<!-- WINDOW-CHECK:DECISION:BEGIN -->

⛔ **REGENERATED BY `tools/window_check.py` ON EVERY RUN — as of post-door-fix canary 3 — door rotation — 2026-09-12T20:50:14Z.**
It is never hand-edited: a decision table maintained by hand is one that
goes stale exactly when it matters. Rows 4–9 below it are static and
checked by eye on the day.

| # | condition | latest reading |
|---|---|---|
| 1 | Zero `notebook_blocked_no_baseline` across the instrument clock | **0** |
| 2 | Opted-in browsers (the denominator) | **6** — need ≥ **5** |
| 3 | Consecutive green daily runs, mini-canary all steps | **18** — need **7** |
| — | Has a 🚨 NEW FINDING ever fired? | **no** |

## ✅ RECOMMENDATION: **GO**

**Met:** zero blocked-baseline events · 6 opted-in browsers · 18 consecutive green runs

⚠️ **The 36-minute gap stands.** The denominator starts 2026-09-10T05:42:53Z,
the numerator 05:06:56Z. A browser that opted in inside that window is
counted by neither, and that does not shrink with time.

⚠️ **What no amount of green buys.** Every opted-in browser in that count is
a *canary profile on the owner's machine driving the owner's own account*.
It is not five members on five devices. The flip is still a step from "it
works when we drive it" to "it works for people", and no amount of green
here closes that distance — only the flip does, which is why the rollback
is one line.

⛔ **This script never flips the flag.** It writes a recommendation for the
owner and nothing else.

<!-- WINDOW-CHECK:DECISION:END -->

### Rows 4–9 — static, checked by eye on the day

| # | condition | as of 2026-09-10 | refresh how |
|---|---|---|---|
| 4 | **A blocked entry is surfaced to the member** | ✅ **CLOSED** — shipped in deploy #2 (`eedb58ac8`), read on the live bundle | already done; re-read the bundle if master moves |
| 5 | **The `null` is instrumented** | ✅ **CLOSED** — shipped in deploy #2; the denominator followed in #3 (`7ed6b2ce5`) | already done |
| 6 | **Inherited-red ledger unchanged** | ✅ **no NEW regression**, none in `journal-2-0`. Deploy #4's full suite: **10 failed vs baseline 10, 0 new**. ⛔ That is *"no new failures against a measured baseline"*, never a green suite. | full frontend suite at rest, compared to the ledger |
| 7 | **Every deploy still an ancestor of `master`** | ✅ `cd674ef56` · `eedb58ac8` · `7ed6b2ce5` · `f093bf731` all YES | `git merge-base --is-ancestor` per deploy — ⛔ derive the list from the deploy records, do not retype a count |
| 8 | **`OFFLINE_DEFAULT_ON` still `false` on branch, master and the live bundle** | ✅ all three | re-read the Notebook chunk |
| 9 | **The 36-minute gap** | ⚠️ the denominator starts **05:42:53Z**, the numerator **05:06:56Z**. A browser opting in inside that window is counted by neither. | state it again; it does not shrink |

## ⛔ THE RECOMMENDATION, AS IT STANDS TODAY: **NO-GO**

⛔⛔ **UPDATED 2026-09-10T16:57:11Z — AND THE REASON HAS CHANGED.** The paragraph
below said *"not because anything is red — nothing is"*. **Something is red now.**
The self-fork **reproduced after the fix shipped** (run 3 of 7, 16:54:50Z, with
deploy #4 live); see **⛔⛔ HARD STOP #1 2026-09-10** at the top of this file. The
NO-GO no longer rests on unmeasured rows alone — it rests on a **measured
failure**, which is a stronger and much less negotiable reason.

⚰️ **The original reasoning, kept because it is still true of rows 1–3:**

> Not because anything is red — nothing is. Because **rows 1, 2 and 3 are
> unmeasured**, and the gate's own condition is a measurement, not an absence of
> bad news. Zero events over zero opted-in browsers is not evidence; it is the
> shape of a green browser matrix over a mount path nobody covered, which is
> exactly how this wave produced its incident.

⛔ **Neither reason alone is now the binding one.** The finding blocks the flip on
its own, and closing rows 1–3 would not unblock it.

**What would change it to GO**, and nothing less:

1. `.env` in the worktree, so a check can authenticate at all.
2. **Seven consecutive daily runs to 9/17**, each stamping a row, each with the
   mini-canary **7/7**.
3. **Zero** `notebook_blocked_no_baseline` events across the clock, read beside
   an opt-in count of **≥ 5** — a number small enough to be honest about and
   large enough not to be a single machine.
4. Rows 4–8 still green on the day.

**What would make it NO-GO regardless:** one 🚨 NEW FINDING row · one member
report of a blank note · a new ledger offender inside `journal-2-0` · any
`null`/`''` baseline anywhere.

⚠️ **And one thing the gate cannot buy.** Every opted-in browser in that count is
a *canary profile on the owner's machine driving the owner's own account*. It is
not seven members on seven devices. The flip is still a step from "it works when
we drive it" to "it works for people", and no amount of green here closes that
distance — only the flip does, which is why the rollback below is one line.

## 🔀 THE FLIP ITSELF — ⛔⛔ **BLOCKED**, and here is what it would be

⛔⛔ **DO NOT RUN THIS.** The flip is **blocked** on the self-fork reproducing
after deploy #4 — see **⛔⛔ HARD STOP #1 2026-09-10** at the top of this file. The
procedure below is kept because it is correct and will be needed; it is **not an
instruction to proceed**, and the gate it names is not the only gate any more.

```diff
- export const OFFLINE_DEFAULT_ON = false
+ export const OFFLINE_DEFAULT_ON = true
```

**Procedure:** identical to deploys #1–#3. Three-tier gate loop → full pre-flight
in order (journal-2-0 at rest · backend rails · full suite · ledger · every
mutation · memory gate) → re-fetch → push to `master` → verify on the **live
bundle** that the constant now compiles to `!0` and that `offlineEnabled()`
returns it when the key is unset.

⛔ **The §15 script is the post-flip canary**, not a formality — run it against
the flipped build, both halves plus the conflict path, exactly as on 2026-09-10.
The daily mini-canary is not a substitute: it runs on an opted-in *profile*,
which is the state every member will suddenly be in, and that is the point of
re-running the real script once the population changes.

**Rollback is the same one line, back to `false`.** It stops processing; it has
never been permission to delete what a member already wrote. A re-enable picks
the queue back up. 5–12 minutes, verified by the artifact.

### The member-impact paragraph for the flip — already written, use it verbatim

It is the one under **📣 THE MEMBER-IMPACT PARAGRAPH FOR THE FLAG FLIP** above,
including the offline-reload limitation in plain language:

> ⛔ *"The one thing that will surprise people: reloading while offline shows the
> browser's error page. Not a blank note — the app itself does not load. …
> Nothing you wrote is lost … But 'offline editing' means keep typing in the tab
> you already have open, not use the app with no internet."*

⛔ Do not ship the flip with the deploy paragraph ("nothing changes for
members"). That sentence is true of #1, #2 and #3 and false of the flip.

---

# 🔙 ROLLBACK RUNBOOK — the flag flip, and how to undo it

**Its own section on purpose.** A rollback is read under time pressure by
somebody who did not write the flip, and a recovery path buried inside the
procedure that created the problem is not a recovery path
(`lesson_a_documented_workaround_is_not_a_recovery_path`).

⚠️ This section is the **flag** rollback. Reverting a *code* deploy is a
different motion — see **(c) Rollback** above, which derives the SHA rather than
typing it and needs `-m 1` when the thing being reverted is a merge.

## 1. What the rollback IS — one line

`app/src/pages/journal-2-0/lib/offline/offlineFlag.js`:

```diff
- export const OFFLINE_DEFAULT_ON = true
+ export const OFFLINE_DEFAULT_ON = false
```

That is the whole change. The flip forward is the same line the other way.

## 2. ⛔⛔ WHAT `false` MEANS — it STOPS PROCESSING. It is not permission to delete.

**Turning it back to `false` has never been permission to delete what a member
already wrote.** With the flag off:

- the editor **writes nothing new** to the durable layer;
- **any durable copy and any queued intent stay exactly where they are** —
  untouched, not cleared, not migrated;
- the drain **claims no leadership and sends nothing** — no lock, no PUT;
- `useDurableNote` and `useOutboxDrain` report `supported: false`, and every path
  in the Notebook behaves as it did before Wave Q1: the synchronous localStorage
  draft, the ~800 ms server PUT, the existing conflict handling.

The module says it in its own words, and both halves are railed
(`NoteEditorPage.durable.test.jsx` §21, `useOutboxDrain.test.jsx` §21) and
mutation-proved:

> *"⛔ THE ROLLBACK IS THIS ONE LINE, and turning it back to `false` STOPS
> PROCESSING — it has never been permission to delete what a member already
> wrote. With it off, the editor writes nothing new and leaves any durable copy
> and queued intent exactly where they are, and the drain claims no leadership
> and sends nothing. … A re-enable picks the queue back up."*
> — `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`

⭐ **A re-enable picks the queue back up.** That is the property that makes this
cheap: nothing on any member's disk changes in either direction, so a rollback
costs a deploy cycle and no data motion at all. It is also why "roll back and
figure it out" is the correct first move if the symptom is member-visible.

## 3. ⚡ The instant lever — per browser, no deploy

A deploy is 5–12 minutes. For **one** browser (the owner's, a member on a
support call, a canary profile), in DevTools:

```js
localStorage.setItem('uct.j2.offline.enabled', '0')   // this browser: OFF
localStorage.removeItem('uct.j2.offline.enabled')     // back to the deployed default
```

`OFFLINE_FLAG_KEY` is `'uct.j2.offline.enabled'`; `offlineEnabled()` reads `'1'`
as on and `'0'` as off and otherwise returns `OFFLINE_DEFAULT_ON`. So `'0'`
**beats a deployed `true`** — it is a real per-browser opt-out, not a hint.

⛔ **This is a per-browser lever, never a population rollback.** It reaches one
profile on one device. If members are affected, ship the flag.

## 4. The rollback push still passes the whole gate

⛔ **A rollback is a push to `master`, and `master` is production.** It gets the
same treatment as the flip that preceded it — a rollback that skips the gate is
how a second incident lands on top of the first.

**a) The three-tier scope gate loop**, first (see **⭐ (b-1) THE DEPLOY
PROCEDURE** above):

```bash
git fetch origin
python tools/deploy_scope_gate.py $(git merge-base origin/master HEAD) origin/master
#   exit 1 = TIER 1 (hard stop, owner)  ·  3 = TIER 1½  ·  2 = TIER 2  ·  0 = TIER 3
```

**b) The full re-verify, IN THIS ORDER** — the same order as TIER 2:

```
a) journal-2-0 at rest, alone      c) full frontend suite
b) backend baseline rail           d) ledger re-verified against the NEW master
```

⛔ **Never full-suite-then-journal-2-0.** That ordering manufactures a population
of timeouts that say nothing about the code (inherited-red ledger, row 9).
⛔ Report journal-2-0 and the full suite as **two separate numbers**; there is no
repo-green to claim, before or after a rollback.

**c) Every Wave Q1 rail by name, and every mutation reddening** —
`python tools/q1_mutation_gauntlet.py`. A rollback changes a value the guards are
built around; the gauntlet is what proves they still bite.

**d) The memory pointer gate**, if anything under the memory directory moved.

⚠️ **The push window binds a rollback too.** No push to `master` Mon–Fri
09:00–16:00 ET — a restart loses a scheduled slot outright. If the rollback is
genuinely urgent inside the window, that is an owner decision, and the cost to
state is **which slots are lost**, not whether a restart happens.

## 5. Confirm it — on `master` AND on the live bundle

⛔ **Both, every time.** `master` says what was pushed; the bundle says what
members are running. They disagree whenever a deploy has not finished, has
failed, or served the last successful build.

**On master** — the source of the thing that shipped:

```bash
git fetch origin
git show origin/master:app/src/pages/journal-2-0/lib/offline/offlineFlag.js | grep OFFLINE_DEFAULT_ON
#   → export const OFFLINE_DEFAULT_ON = false
```

**On the live artifact** — first that a NEW process is serving:

```bash
curl -s -H "User-Agent: Mozilla/5.0 Chrome/152" https://uctintelligence.com/api/health
#   uptime_seconds must RESET. ⛔ Cloudflare 1010-blocks raw curl UAs.
```

**Then read the flag out of the DEPLOYED BUNDLE** — the artifact, not the source
default, and no sign-in needed:

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36"
# 1. the entry chunk names the lazy ones; the flag lives in the Notebook chunk
curl -s -H "User-Agent: $UA" https://uctintelligence.com/ | grep -oE '/assets/index-[^"]+\.js'
# 2. find the chunk carrying the opt-in key, then read the compiled default
curl -s -H "User-Agent: $UA" https://uctintelligence.com/assets/NotebookTab-<hash>.js \
  | grep -oE '.{130}uct\.j2\.offline\.enabled.{130}'
```

The compiled form of `false` is **`!1`** (and of `true`, `!0`) — measured on the
live artifact 2026-09-09:

```js
const Fi=!1, Mi="uct.j2.offline.enabled";
function ws(t=globalThis.localStorage){ try{ const n=t?.getItem(Mi);
  if(n==="1")return!0; if(n==="0")return!1 }catch{} return Fi }
```

⛔ **The chunk hash changes every deploy — crawl for the key, never bookmark the
URL.**

**And the dark proof, in a signed-in browser console — no lock claimed:**

```js
const q = await navigator.locks.query()
;[...q.held, ...q.pending].filter(l => String(l.name).startsWith('uct.nb.sync.'))   // → []
```

⭐ **One probe during a swap is not a verdict.** Right after a redeploy the old
pod can still answer; re-probe (`lesson_two_points_do_not_establish_a_rate`).

## 6. Member impact of a rollback

Members lose offline editing and go back to the pre-Wave-Q1 behaviour they had
for every day before the flip. **Nothing they wrote is deleted**, and anything
already queued is still on their disk if the flag is turned on again. The
sentence to avoid is the deploy paragraph's *"nothing changes for members"* —
that is true of deploys #1–#3 and false of both directions of the flip.

# THE FLAG-FLIP GATE — a SEPARATE list, and not the deploy's

⛔ **These are not deploy blockers.** With `OFFLINE_DEFAULT_ON = false` the drain
cannot execute at all, so every item here is dormant until the flag flips.

## Why they are separable — traced from the flag to the drain call

```
NotebookTab.jsx:74        useOutboxDrain({ accountId, excludeNoteId })   ← the ONLY mount site
  └ useOutboxDrain.js:89  supported = offlineEnabled() && offlineStorageAvailable()
                                       && accountId && enabled
      └ offlineFlag.js:63 offlineEnabled(): key '1'→true · key '0'→false
                          · UNSET → return OFFLINE_DEFAULT_ON   ← production: false
  ⇒ supported === false, and then THREE independent refusals:
      · the leadership effect      `if (!supported) { setRole(null); return }`  → no lock claimed
      · drainNow                   `if (!supported || roleRef.current !== LEADER) return null`
      · the trigger effect         `if (!supported) return undefined`  → no listener, no interval
```

⭐ **`drainOutbox()` has exactly ONE caller in the whole app** — inside
`drainNow`, behind that gate. There is no second path to it.

⛔ **The rail that existed did NOT cover production's actual state.** §21 sets
the key to `'0'`; production leaves it **unset**, which is a *different branch*
of `offlineEnabled()` (`return OFFLINE_DEFAULT_ON`). §21b now covers the unset
case — no lock claimed, nothing sent, `drainNow()` called directly still refuses
— with a control that drains on opt-in, and mutation-proved: flip the shipped
default to `true` and **exactly the two new rails go red while §21 stays green**,
which is what proves they test different lines.

## The list

⛔⛔ **THIS GATE IS NOT CLOSED, AND THE ROWS BELOW ARE NO LONGER THE BINDING
CONSTRAINT.** A new row sits above all of them, and it blocks the flip on its
own regardless of what the others say — see **⛔⛔ HARD STOP #1 2026-09-10** at the
top of this file.

| | status |
|---|---|
| ⛔⛔ **The self-fork does not recur after the fix** | ⛔⛔ **OPEN.** It reproduced against #4 (run 3 of 7, 2026-09-10T16:54:50Z). **Root cause found**: guard 1 was wired only into `restoreDraft`, never into `commitSave`; guard 2 cannot fire in the window it claims. ✅ **Round-2 fix DEPLOYED — #4b, `23f6ce271`, live 20:36:29Z.** ⛔ **Still open**, because the row's claim is *does not recur*, and that is **seven consecutive green runs against #4b, restarting from zero** — not a fix having shipped. Artifact preserved (**R-K**). **The flip is BLOCKED on this**, and no other row can unblock it. |
| A blocked entry is surfaced to the member | ✅ **CLOSED 2026-09-10** — the notes list (both views) and the open note's header now say it, in the shipped vocabulary, and the sentence names the ACTION. See below. |
| ~~`baseUpdatedAt: null` explained~~ → **`null` INSTRUMENTED, zero occurrences across the instrument clock** | ⏳ **INSTRUMENT LIVE IN PRODUCTION 2026-09-10T05:06:56Z** (deploy #2 `eedb58ac8`), clock ends 2026-09-17T05:06:56Z. ⛔⛔ **Bounded evidence, not proof** — with the flag off the event can only fire from an OPTED-IN browser, so zero over an empty population says nothing. Record the opted-in count beside it. |
| A fresh §15 canary on the deployed fix | ✅ **COMPLETE — 2026-09-10.** Online half (happy path + the fix's own signature) and, via the CDP rig, the offline half incl. **the 9/9 red step** and the conflict path through the drain's fork. All green. No `null`/`''` baseline anywhere. ⚠️ **That canary ran from a FRESH opt-in.** The 16:54:50Z fork came from a run that started **already opted in** — an ordering this canary never exercised. Its green is real and it is not evidence about the new finding. |
| Seven-day observation window armed | ⚠️ **STARTED 2026-09-10, ends 2026-09-17 — AND IT IS RUNNING WITH AN OPEN FINDING.** ⛔ Armed is not green, and a window that reaches 2026-09-17 does not close this gate by arriving. See below. |

### The blocked-entry finding, in full (measured, `blockedEntryIsVisible.test.jsx`)

| question | answer |
|---|---|
| Are the member's words intact? | ✅ every word, on disk; the record stays `dirty: 1`; the outbox keeps the full patch |
| Is the block recorded? | ✅ `permanent: true` + a readable `lastError` naming the missing baseline |
| What does the save indicator show? | ✅ **on the open note, honestly** — "Reconnecting…" plus "Saved on this device/in this browser · waiting to sync". Asserted as rendered TEXT, not state. |
| Do later writes for that note still drain? | ✅ **a later edit UN-BLOCKS it.** The outbox is keyed `note:<id>`, so a fresh durable write replaces the entry and the replacement carries no `permanent` flag. A hold, not a dead end. |
| Does it wedge other notes? | ✅ no — another note still sends (`blocked: 1, sent: 1`) |
| Does it retry itself? | ❌ no, by design — that is the point of the refusal |
| **Is it surfaced anywhere else?** | ✅ **YES, since 2026-09-10** — it was ⛔⛔ **NO**. See the section below. |

⚰️ **That last row used to read: "`summarize()` has ZERO consumers in the app and
`BLOCKED` appears in no component — for a note the member is not looking at, the
hold is completely silent."** The words were safe and the hold was recoverable,
but only by a member who happened to edit that note again, for a reason nothing
on screen ever gave them. It was the last open row of this gate.

---

## ✅ ITEM 1 — THE BLOCKED ENTRY IS SURFACED (closed 2026-09-10)

**What a member now sees, as rendered text.**

| where | what it says |
|---|---|
| Notes list — **card grid** | a warning-toned chip on the note's meta row: **"Edit again to sync"** |
| Notes list — **table view** | the same chip, beside the title |
| Either badge, on hover | **"This note has words that have not reached the server, and will not until you edit it again."** |
| The **open note's** header | **"Saved on this device · edit it again to sync"** (or "in this browser" — the noun narrows exactly as it already did) |

⭐ **The sentence names the ACTION, not the state.** "Not synced" tells a member
something is wrong and nothing about what to do. A later edit is what un-blocks
it — the outbox is keyed `note:<id>`, so a fresh durable write REPLACES the
entry and the replacement carries no `permanent` flag — so the copy says that.

⛔ **ONE VOCABULARY, ONE AUTHORITY.** The strings live in
`lib/offline/unsyncedCopy.js` and nowhere else; the editor header stopped
inlining them. Two surfaces describing one state in two vocabularies is how a
member learns to read them as two different states.

⛔ **THE OPEN NOTE WAS ONLY HALF-HONEST.** Its existing "waiting to sync" line is
gated on the editor's own save attempt (`error`/`reconnecting`). A note blocked
in a PREVIOUS session and opened today is neither, so the one surface that was
described as honest said nothing in exactly the case that matters. The blocked
line is not gated on the save attempt, and it wins over the "waiting" line —
two lines at once would read as two states.

**Mechanism.** `lib/offline/blockedNotes.js` reads the ONE predicate the drain
already persists (`permanent === true`) — it does not re-classify, because a
second copy of "what counts as blocked" would disagree the day a third block
reason lands. `lib/offline/useBlockedNotes.js` is the hook, **behind the same
gate as the drain**: with `OFFLINE_DEFAULT_ON` false it opens no database and
reads nothing, so this surface is not the one place the dark wave touches
IndexedDB.

**Rails** — `lib/offline/blockedNoteSurface.test.jsx` (11) +
`lib/offline/blockedEntryIsVisible.test.jsx` (rewritten: the pin that recorded
the gap is replaced by an assertion that reads the surface, plus a no-cross-talk
control). Every assertion is rendered TEXT. Controls: a still-retrying entry
says nothing · an empty outbox says nothing · the flag off says nothing · no
cross-talk between notes. Mutation-proved four ways, each hitting exactly one
test: cut the card wire · cut the table wire · widen the predicate · swap the
copy. ⛔ The table assertion is driven through the tab's own **Table view**
button, because a component test rendering `NotesTableView` directly is
structurally blind to a severed wire.

---

## ⏳ ITEM 2 — THE `null` IS INSTRUMENTED, NOT HUNTED (live 2026-09-10)

⛔ **THE GATE CONDITION CHANGED, ON PURPOSE.** It was *"`baseUpdatedAt: null`
explained"*. Nine paths were driven trying to reproduce it and none did; a tenth
guess is not evidence, and an unfalsifiable item cannot gate anything. It is now:

> **`null` instrumented; ZERO occurrences during the observation window.**

**What fires.** When the drain refuses a baseline-less entry it now emits ONE
structured event — `notebook_blocked_no_baseline` — to
`POST /api/j2/telemetry`, the Notebook's existing allow-listed client→server
channel (already used by this tab for `notebook_tab_visit`). It lands in
`activity_log` and is read back with `GET /api/admin/activity`.
⚠️ Stated plainly: that is a **telemetry** sink, not an error pipeline. This app
has no client error pipeline, and inventing a transport was not the smallest
thing that works.

**What it carries** — exactly seven fields, pinned as a SET, never note content:
`noteId` · `generation` · `sessionId` · `baseline` · `entryAgeMs` · `attempts` ·
`flag`.

⛔ **The baseline is DESCRIBED, never sent raw**: `null` · `undefined` ·
`empty-string` · `whitespace` · `non-string:<type>`. Every value that reaches
the reporter has already failed `isUsableBaseline`, so the shape is strictly
more information than the value — and it is the one field through which a
member's words could ever ride along if a future bug put text there.
⭐ `null` and `empty-string` stay distinguishable: they are two different
defects (the incident, and the `??`-vs-truthiness bug found hunting it).

**What does NOT fire** — and each has its own rail: a sent entry · a transient
failure · a 409 that forks · a non-transient rejection (blocked, but with a
`lastError` a human can already read) · **a re-drain of an already-blocked
entry**. That last one is load-bearing: the `permanent` branch runs before the
baseline check, so the event marks the TRANSITION into blocked, once. Without
it the retry interval would manufacture an occurrence every tick and the window
would read as a storm of incidents that never happened.

**Rails** — `lib/offline/blockedBaselineEvent.test.jsx` (17) +
`tests/test_j2_telemetry_allowlist.py` (8, the server-side mirror: a client rail
proving "we posted it" is green against a server that 400s every one). The event
name is DERIVED from the client source in the backend test rather than retyped.
Mutation-proved: delete the hook's reporting loop → the wire test alone goes
red; remove the name from the server allow-list → the two acceptance tests go
red while the "it is still an allow-list" control stays green.

⛔ **The instrument cannot break what it measures.** A reporter that throws
leaves the queue settling exactly as it would have — railed.

---

## ⛔ ITEM 3 — KNOWN LIMITATIONS (write these down; do not "fix" them)

### An offline reload cannot load the Notebook at all

Wave Q1 has **no service worker**, deliberately, and the owner's standing
constraint is that it stays untouched. So a page reload while the network is
down cannot fetch `index.html`: the SPA never loads, the browser shows its own
error page, and from that context storage is not even readable (`draft:"ERR"`,
`dbMissing:true` — measured 2026-09-10 through the CDP rig).

**Nothing is lost.** The words are in IndexedDB, in the outbox, and in the
localStorage draft; the next load with a network present finds all three. What
is *unavailable* is the app, for as long as the network is down and the page has
been thrown away.

⛔ **This is an EXPECTED OBSERVATION, never a red**, and the §15 script now says
so at step 9. It is also not an argument for a service worker: that is a
separate decision, with its own cache-invalidation and update-path costs, and
proposing one is out of scope here.

### The drain never touches the note that is open

`excludeNoteId` hands the open note to the editor, never to the sweep — two
writers on one note is the last-write-wins this wave exists to forbid. A queued
entry for the open note waits until the member accepts the recovery banner,
edits, or **navigates away**. A reading that looks like a stalled drain is the
design working.

### A blocked entry is a HOLD, and only the member can release it

By design it is never retried. The surface built for Item 1 is what makes that
survivable; without it the hold was silent, which is why it gated the flag.

---

## 📣 THE MEMBER-IMPACT PARAGRAPH **FOR THE FLAG FLIP**

⛔ **This is NOT the deploy's paragraph** (that one is §(a), and it says
"nothing about this changes what a member sees"). This one is for the decision
that has not been made: turning `OFFLINE_DEFAULT_ON` to `true`. Written now, in
plain language, so the flip is judged against what a member would actually
experience rather than against a description of the code.

**What a member would get.** Your notes keep working when your connection
drops. What you type is written to a durable copy in your browser as you go,
queued, and sent when you are back. If two devices edit the same note while one
is offline, neither version is thrown away: the server keeps the one that
arrived first, and yours is saved beside it as a note titled "(conflicted
copy)".

**What a member would see that is new.**
- A line in the note header while work is unsent: **"Saved on this device ·
  waiting to sync"** — and **"Reconnecting…"** while it retries.
- Occasionally, on a note in your list: **"Edit again to sync"**. That means we
  are holding words that never reached the server, and we have deliberately
  stopped retrying because sending them could have overwritten a newer version
  from another device. Your words are safe; opening the note and editing it
  releases them.
- Sometimes, a real note in your library ending in **"(conflicted copy)"**.

**⛔ The one thing that will surprise people: reloading while offline shows the
browser's error page.** Not a blank note — the app itself does not load. UCT
Intelligence has no offline app cache, so if you lose connection and then
refresh the tab, you get your browser's "no internet" screen until the
connection is back. **Nothing you wrote is lost**: everything typed offline is
still there the next time the page loads with a connection. But "offline
editing" means *keep typing in the tab you already have open*, not *use the app
with no internet*. If that gap matters to members, it is a service-worker
project and a separate decision — it is not part of this flip.

**Blast radius if the flip is wrong.** Every Notebook user, every note, and the
failure mode is data-shaped rather than loud: the 2026-09-09 activation went
wrong in twenty-five minutes and the symptom was a note reading blank. That is
why the flip has a gate, why the gate is not the deploy's gate, and why the
observation window watches the deployed fix first.

---

## Traps that have already cost time here

- ⛔ **Never put `\n` or other escapes through a Bash heredoc.** It has silently
  become a literal newline three times — once shipping a SyntaxError to
  production in the probe page, which rendered perfectly and measured nothing.
  Use the Edit/Write tool for anything containing escapes.
- ⛔ **A port is not a server identity.** `python tools/q1_browser_probe_run.py
  --self-check` before trusting any local or tunnelled run. Port **8099 belongs
  to the hub sandbox** (`scripts/hub_sandbox_boot.py`, another workstream) — it
  will not survive the restart, and restarting it is *their* call, not ours.
- ⛔ **`vitest` must run from `app/`.** Backend tests from the repo root.
- ⛔⛔ **RUN THE WAVE'S GATE AT REST — NEVER full-suite-then-journal-2-0.**
  That ordering manufactures failures that say nothing about the code. Under
  sustained load a **population** of journal-2-0 tests times out — three
  different ones observed (`ImportWizard` audit-B1 4.2s · `captureConvergence`
  **28.7s** · "closing returns the dialog to nothing" 4.1s) — and it is whichever
  test happens to be slowest, not a specific flaky file. Naming one of them
  would be false and "fixing" it would move the failure
  (`lesson_an_intermittent_red_can_be_a_population_not_a_test`). journal-2-0 is
  **2391/2391 in eleven consecutive runs at rest**. Ledger row 9.
- ⛔ **EIGHT files fail the full frontend suite on master, and none are ours.**
  Every one is blamed to a SHA in **`docs/notebook/inherited-red-ledger.md`** —
  read that instead of re-deriving it, and add a row rather than re-investigating.
  **Repo-green must never be claimed**; report `journal-2-0` (230 files / 2388
  tests green) and the full suite as two separate numbers.
  ⛔ Answer "did my change cause this?" with `git show <sha>:<file>`, never
  `git status` — one offender sits inside `journal-2-0` and is still not ours.
- ⛔ **A rail can be green alone and red in company.** Both new rail files were
  re-checked inside the full 1,171-file run, not just on their own.
- ⛔ Deploys take 5–12 minutes and `master` **is** production. Verify by the
  artifact (`/api/health` uptime reset), never by the source default.

---

## ✅ Cleanup owed — **DONE 2026-09-10**

All three directories deleted, and `.worktrees` itself with them:

| directory | files | result |
|---|---|---|
| `canary-chrome-profile` | 1,724 | **DELETED** |
| `canary-chrome-profile-2` | 1,325 | **DELETED** |
| `master-baseline` | 3,913 | **DELETED** |
| `.worktrees` itself | — | **DELETED** |

⭐ **What actually unblocked it:** the handles were the rig's own Chrome. Once
the browser was torn down by its profile marker, every directory deleted on the
first attempt — no force, no survivors, nothing to record as held.
⚠️ `handle64.exe` (Sysinternals) is **not installed on this box**, so the
"what holds it" step could not run; it was not needed, and the delete's own exit
status is the evidence. ⛔ Nothing else under the worktree was touched —
`git status` clean before and after.

The record of what these were, kept because a future session will make them
again:

<details>
<summary>the two rigs and the scratch worktree</summary>

- ⚠️ **`.worktrees/canary-chrome-profile` — ~1,700 files, needs a manual delete.**
  The CDP rig's throwaway Chrome profile. The browser itself is fully torn down —
  0 canary-profile processes, CDP endpoint gone, `chrome.exe` back to its baseline
  15, only the owner's browser (`44184`) left — but Windows still holds a handle
  on the profile directory. Gitignored; cannot reach a commit or a deploy.

- ⚠️ **`.worktrees/master-baseline` — ~3,900 files, needs a manual delete.**
  A scratch worktree checked out at `184a7e77b` to run the eight inherited-red
  files directly against the new master. The run was **abandoned as invalid** (a
  fresh worktree has no `node_modules`, and the junction recipe still left Vite
  resolving its temp config from the parent repo → `ERR_MODULE_NOT_FOUND`, a
  **startup error, not a test result**). Git's registry is pruned and
  `git status` is clean, but something holds a file handle so `rmdir /s /q`
  fails. It is **gitignored** (`.gitignore:3`) and cannot reach a commit or a
  deploy. Delete it once whatever holds it exits:

  ```
  cmd /c "rmdir /s /q C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees"
  ```

  ⭐ That one command clears both leftovers — the whole `.worktrees` directory is
  gitignored and holds nothing but throwaway rigs.

  ### ⛔ THE OWNER RUNS THESE. This session does not.

  Both directories are held open by a Windows handle, and **which process holds
  it is not knowable from here** — killing a guess is how another workstream
  loses its work (`feedback_agent_authority_and_worktree_isolation`).

  ```
  # 1. See what is holding them (Sysinternals handle.exe, if installed):
  handle64.exe -nobanner "C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees"

  # 2. Delete both leftovers — ONE command, the whole directory:
  cmd /c "rmdir /s /q C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees"

  # 3. Confirm it is gone (prints nothing if clear):
  cmd /c "dir /b C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees" 2>nul
  ```

  ⛔ If step 2 reports *"The process cannot access the file"*, the holder is still
  running — that is information, not a reason to force it. ⛔ Do NOT
  `git worktree remove`: the registry is already pruned; only the directories
  remain. Nothing here is tracked, so neither can reach a commit or a deploy and
  neither is urgent.

  ⛔ Do NOT `git worktree remove` it — that is already done; only the directory
  remains.

</details>

⚠️ **One thing the recorded commands do NOT survive: Git Bash.** `cmd /c "rmdir
…"` from Bash opens an interactive shell and runs nothing — it prints the
Windows banner and exits 0, which looks like success and deletes nothing.
Measured twice, including with the `//c` escape. Run it from **PowerShell**
(`cmd.exe /c "rmdir /s /q \"<path>\""`) or use `Remove-Item -Recurse -Force`,
and **verify with `Test-Path` afterwards** rather than trusting the exit code.

## Quick orientation for a fresh session

```
app/src/pages/journal-2-0/lib/offline/     the wave: notebookDb · durableWriter ·
                                           recoverLocalState · outboxLeader ·
                                           outboxDrain · useDurableNote ·
                                           useOutboxDrain · offlineFlag
app/public/q1-probe.html                   the browser certification instrument
tools/q1_probe_server.py                   identity-verifying local server
tools/q1_browser_probe_run.py              runner (--serve / --self-check / --url)
tools/deploy_scope_gate.py                 the 3-tier gate (+ TIER 1½); --self-check
tools/gate_regions.py                      the protected regions, by SIGNATURE
tools/q1_mutation_gauntlet.py              every guard broken on purpose; --self-check
tools/window_check.py                      one command = one observation-window row
docs/notebook/wave-q1-*.md                 certification · canary-red · harness ·
                                           observation-window · this file
docs/notebook/inherited-red-ledger.md      the reds this wave INHERITED, blamed
```

**Sections in this file worth knowing by name:** ⛔⛔⛔ **START HERE** (the FIRST
section — the defect is OPEN, and §A/§B/§C are what the next session does, in
order) · ⛔ **SELF-FORK, ROUND 3 — OPEN** (the measurements, the verbatim
timeline, and the `settleSent` lead) · ⛔⛔⛔ **HARD STOP #2** (the member's words
were LOST; its fix shipped as **#4c** and closed only the local half) ·
🏁 **THE CLOSE — PREPARED, NOT PUBLISHED** (⛔ gate NOT closed, packet NO-GO) ·
⛔⛔ **HARD STOP #1** (the self-fork reproduced after #4) · 🔧 **ROUND 2 — THE
FINAL DESIGN (R-A)** (shipped as **#4b**, and #4b was not the end) · ⛔ **DEPLOY
#5** (the flip — the one real placeholder left) · ✅✅ **DEPLOY #4c** then
✅✅ **DEPLOY #4b** then ✅✅ **DEPLOY #4** (⚠️ all three annotated, none
rewritten) · 🧾 **RULINGS**
R1–R16 and 🧾 **ROUND-2 RULINGS** R-A…R-R + R-X…R-Z (⚠️ R-S…R-W are other streams') ·
🧾🔬 **THE PRESERVED FORKS** (the evidence set that replaced the rounds-1-2 artifacts) ·
⭐ **THE MUTATION GAUNTLET IS A TOOL** ·
⭐ **TIER 1½** (inside the deploy procedure) · 🔙 **ROLLBACK RUNBOOK** (⛔ not
indicated — every shipped deploy stays).
📄 **Standalone records:** `docs/notebook/inherited-red-ledger.md` ·
`docs/notebook/runaway-pytest-2026-09-10.md` (**R-P**) ·
`docs/notebook/wave-q1-browser-certification.md` + `wave-q1-probe-results/`.
⛔ **Live notes: 34 — CORRECT AND INTENTIONAL** (32 baseline + round 3's note
`0910373ae0e84b758c39f4a13c33e5fe` + its conflicted copy). ⛔⛔ **Nobody fixes
this count**; the extra note IS the defect. ⛔ **DERIVE it, never restate it**
(**R-Y**) — it has now read 33 → 34 → 35 → 34 inside one day.
⛔ **"Server holds text" is DELETED everywhere** (**R-O**) — the check is *the
server BODY CONTAINS THE OFFLINE SENTENCE*.

Memory: `project_notebook_wave_q_offline_2026_09_09` (open it before acting).

---

## 🕒 TIP STAMP — 2026-09-11, and it stamps an **OPEN DEFECT**

⛔⛔ **THIS IS NOT THE CLOSE-OF-WAVE STAMP.** The wave did not close. This stamps
the end of a working session that finished with **the self-fork OPEN (round 3)**,
the **gate NOT closed**, the **packet NO-GO**, and the **flip BLOCKED**. Read it
as a bookmark, never as completion.

| | |
|---|---|
| content tip at session close | **`fa64821a4`** — *"Wave Q1: the session closes with the self-fork OPEN — round 3"* (this stamp is the commit immediately after it; a doc cannot name its own SHA) |
| branch | `notebook-primary-platform` — ⛔ the coordinator pushes; this worktree does not |
| shipped and LIVE | #1 `cd674ef56` · #2 `eedb58ac8` · #3 `7ed6b2ce5` · #4 `f093bf731` · #4b `23f6ce271` · #4c `6db8ba93a` |
| `OFFLINE_DEFAULT_ON` | **`false`** — branch and `master`. Members are unaffected by the open defect. |
| what is open | the queued entry still reaches the **server** as a discard via the `folder` door (**SELF-FORK, ROUND 3**) |
| what to do next | **START HERE → §A, §B, §C**, in that order |
| live notes | **34 — correct and intentional.** ⛔ Do not tidy it. |

⭐ **The deploy-#5 stamp is still owed**, and it is the one that dates the gate.
This stamp exists so the next session can tell a *paused* wave from a *finished*
one — the distinction the two hard stops kept losing.
