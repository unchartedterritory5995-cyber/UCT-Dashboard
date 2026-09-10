# RESUME — joystick hub Increment 3

**Created 2026-09-10.** Increment 2 is merged and deployed; this file carries its open items
forward. ⚠️ Increment 2's resume lived at `C:\tools\hub-devicetests\RESUME-inc2.md`, outside the repo and
therefore uncommittable. This one lives in the repo so it can be committed, as ruled.

## State

| | |
|---|---|
| Branch | `feat/joystick-increment-3`, from master `febe8ee67` |
| Worktree | `C:\Users\Patrick\uct-worktrees\joystick-inc3` |
| Deployed | `febe8ee67` — Increment 2, live since 2026-09-10T06:21:42Z |
| Also open | `fix/deploy-watch-probe` @ `245102b1c`, pushed, unmerged — rides the next intentional deploy, **outside 09:00–16:00 ET** |

## ⛔ WINDOW-JOB STATE — written 2026-09-10 ~13:1x ET, read this FIRST

The 15:50 ET window job fires into a fresh context. This block is what it needs to know, so it
does not re-derive any of it under time pressure.

| | |
|---|---|
| Branch tip | see `git log -1`; at ~13:3x ET it is the gate-exit-code commit, rebased onto master `f093bf731`, WITH the fan fix cherry-picked |
| Base | `f093bf731` (was `febe8ee67`, then `4c518db97`, then `0e32db845`) |
| Gate checkpoint | `docs/plans/joystick/gate-runs/2026-09-10T12-00-02.*`, tree `8f0b38e70` |
| Gate verdict | **Zero hub-introduced failures.** 1210 files (reconciles), 18,036 tests, 10 failing |
| Step 6 answered | `OFFLINE_DEFAULT_ON = false` — unchanged, offline layer still off |

### ⛔⛔ HELD 2026-09-10 16:35 ET — the window was lost to master, not to the gate

**Increment 3 is gate-clean and NOT merged.** It ships at the next window: tomorrow before 09:00 ET.

| | |
|---|---|
| Branch tip | `d27d4e579` — rebased onto master `3c8e5126a`, pushed |
| Manifest of record | `docs/plans/joystick/gate-runs/2026-09-10T15-34-17.{json,md}` (stamped in LOCAL time = CT) |
| Verdict | **0 NEW failures**, failing set matches the baseline EXACTLY, 1212 files reconciling, 18,055 tests |
| State hash | manifest start == end == HEAD == pushed branch — all `d27d4e579` |

### What happened, in order

- 15:57 rebased onto master `1b6f39cfe`, gated. **Green at 16:14: 0 NEW.**
- Master had moved to `3c8e5126a` DURING that gate (five pattern-vision commits) and redeployed
  web at **16:04:48 ET**, inside the requested 16:05–17:00 freeze.
- Per the owner's ruling that is ONE authorized lap: rebased onto `3c8e5126a`, re-gated.
  **Green at 16:35: 0 NEW, identical numbers.**
- Master moved AGAIN to `23f6ce271` during the lap gate — ten Wave Q1 notebook files, pushed
  inside the same freeze hour.

### Why holding is the only correct move, and it is not the gate's fault

⛔ The ruling is explicit: *one lap total, then hold, do not burn a second lap.* Beyond that:

1. **A merge now would ship an UNGATED tree.** Master is no longer an ancestor of the branch, so a
   `--no-ff` merge onto `23f6ce271` produces a tree carrying master's ten new files — not the tree
   the manifest describes. The byte-identity proof (condition 1 of the standing authorization)
   would fail by construction.
2. **A re-gate could not finish in time anyway.** ~21 minutes from 16:35 lands at ~16:56, leaving
   no room for the merge, the push conditions and a post-merge check before 17:00.

⭐ **Nothing about the branch is in doubt.** Two independent full gates, on two different bases,
both returned 0 NEW with the identical failing set. What ran out was the window.

### The freeze did not hold — twice

Both of master's moves landed inside 16:05–17:00 ET. This is not a complaint about the other
workstream; it is the measurement the next attempt has to plan against. **Plan the next window as
if master will move**, which is the standing order's own instruction — a freeze is a bonus, never
an assumption. Tomorrow's pre-09:00 window is structurally better: the repo-wide rule bars master
pushes from 09:00, so the hour before it is the quietest of the day rather than the moment every
blocked workstream is released.

### ⛔⛔ THE HARD CUTOFF — owner clarification, 2026-09-10 evening

> The 07:xx ET window is valid, but **the push AND any rollback blip must COMPLETE before 09:00**.
> If the gate or a rebase lap would push the actual push past **~08:15 ET**, HOLD to the 16:15
> window instead of crowding the market open. Below ~08:15, ship.

⭐ **This is why the job is armed for ~07:08, not 07:40.** A clean run pushes ~07:45; even ONE
rebase lap still lands ~08:10, inside the cutoff. The early start IS the margin — a 07:40 start
would leave a lap finishing at ~08:10 with nothing to spare, and any second surprise would blow
the cutoff with the merge half-built.

⚠️ The cutoff is about the ROLLBACK, not the deploy. `HUB_PREVIEW_ENABLED=false` is the fastest
lever and needs no redeploy — but a flag flip is itself a restart, so recovering from a bad deploy
costs a second blip. Both have to fit before the market open, not just the first one.
### What the next window does — it is a lap from scratch, not a resume

1. `git fetch`; rebase onto master's tip; verify by name (file set, patch-ids, delta == master's
   new files, rule 12, zero `api/`).
2. Full gate. **The 15:34:17 manifest is a CHECKPOINT from that moment on**, not the manifest of
   record — the tree will have moved.
3. Merge body is written and ready: `scratchpad/merge_body_final.txt`, carrying the owner's
   verbatim member-impact sentence.
4. Push before 08:30 ET, leaving room for a second blip.

⚠️ **A filename is not a timestamp you can reason about.** The gate wrapper stamps manifests in
LOCAL time (CT) while this whole window is reasoned about in ET, and the first merge attempt
selected the manifest by an hour-glob that matched nothing — reporting "the gate has not produced
a verdict" seconds after it had. The selector now picks the manifest **by the tree it describes**,
which is the property that actually matters.

## ⛔ OWNER RULINGS, 2026-09-10 ~13:2x ET — both settled before the window

**1. The fan fix RIDES TONIGHT.** Cherry-picked onto this branch (the pick that was proved clean
by `git merge-tree` before it was applied), so the window's re-gate covers it and the manifest of
record attests to the tree that actually ships.

⛔ **The member-impact paragraph MUST carry this sentence, verbatim, as ruled:**

> Three of Home's seven bubbles navigated to the wrong section in production for admins; this
> corrects them.

⛔ **The exposure rail must stay green.** The exposure rail itself is Increment 4's file, so on this
branch the equivalent proof is by blob hash, and it was taken before and after the pick:
`useHubActive.js` `6d4138cb56a2`, `useHubSettings.js` `58860afcf428`, `api/routers/auth.py`
`cf3c82112e1f` — **byte-identical across the cherry-pick**. The pick touches exactly two files,
`HubRoot.jsx` and the new `fanResolutionParity.test.js`, so it cannot have moved a gate.

**2. The freeze is being requested of the Wave Q1 session for 16:05–17:00 ET.** Proceed assuming it
holds. ⛔ **If master moves inside that hour anyway: ONE lap, then HOLD for tomorrow's pre-09:00
window. Do NOT burn a second lap.** That is a direct ruling and it overrides the original job
text's "one more lap is authorized" reading — one lap total, then hold.

### What the fan fix is, in one paragraph

`HubRoot:88` draws `fanFor(mode)` — the PROJECTION — while `useJoystick:129` resolved a tap out of
`mode.fan` — the DECLARATION. Both index BY POSITION WITHIN A RING, and for any mode still in
`PREVIEW_MODES` those are different arrays in a different order. Derived from the deployed registry
blob (`febe8ee67`), Home draws seven bubbles (four outer, three inner) and three of them fired
someone else's action: **Flow→Breadth, Breadth→Wire, Wire→Calendar**. A fourth mismatch is a
different kind — five outer actions declared against four drawn, so Flow's own action was
UNREACHABLE from any bubble. Live since Increment 2, and invisible to every existing rail because
each one checked a single list.

The fix is one memo (`{ ...activeModeConfig, fan }`). The rail is `fanResolutionParity.test.js`,
four tests including a NON-VACUITY control proving preview modes really do project differently, so
it cannot pass tautologically after a revert. Mutation-proved on this branch: reverting the one
line fires *"useJoystick is back on the raw config — the wedge and the action disagree again"*.

### The gate wrapper's exit code was fixed in the same lap

`scripts/gate_shards.py` exited **0** while printing *"The failing set DIFFERS from the baseline"*.
It now returns `EXIT_NEW_FAILURES = 1` when `vs_baseline.new` is non-empty, `0` otherwise, with `2`
still meaning the run was refused and produced no verdict.

⭐ **`new` is enforced; `matches_baseline` is reported.** A baseline entry that STOPPED failing is
master fixing something — `test_gate_baseline_diff.py` pins that direction as never-blocking, and
failing a branch for an improvement is how a gate teaches people to ignore it. When the two
disagree the run says so out loud.

⚠️ **So the window job must now expect a NON-ZERO exit if anything is genuinely new.** That is the
point of the change — but it means `python scripts/gate_shards.py` inside a `&&` chain will now
stop the chain on a real regression instead of sailing past it. Read the manifest either way.

### The gate result, and why its one "NEW" is not ours

The checkpoint manifest flags exactly one NEW failure:

    src/components/chart/ChartDrawingOverlay.surfaces.test.jsx > ... > ⛔ ENTERING EDIT MODE IS NOT A RESIZE

It is **master's, not the hub's**, and this is settled — not assumed. The Wave Q1 session hit the
identical failure independently and measured it three ways: it fails alone at rest in 1.4s (so it
is not the load-sensitive population); the test and its subject are byte-identical to
`origin/master`; and it was re-run on a detached worktree at `origin/master` with none of their
code present and failed identically. Blamed to `8de4da43b` (charts Phase 9). They ADDED it to
`gate-baseline.json` **on master**, and the rebase to `f093bf731` inherited that correction — so a
re-gate at the current base will no longer flag it.

⭐ Direction is `master_introduced` → ADD, never BLOCKS. Two independent measurements agreeing is
the strongest form this evidence takes.

⚠️ **The wrapper exited 0 while printing "The failing set DIFFERS from the baseline."** The exit
code is not the verdict; the manifest is. Read the manifest.

### ⛔⛔ THE BINDING CONSTRAINT: THE GATE IS SLOWER THAN MASTER MOVES

Measured 2026-09-10 on `origin/master`, inter-commit gaps in minutes:

    5, 10, 2, 2, 3, 4, 3, 2, 3, 23, 16, 5      median 3 min

The six-shard gate takes **~25-30 minutes**. Master advanced **26 commits** (Wave Q1 notebook
workstream) *during* the 12:00 gate run alone. This is Increment 2's lesson repeating verbatim:
**if the gate cycle is slower than the other workstream's push cadence, FREEZE first, never lap.**
Increment 2 cost four rebases to learn it.

And the collision is **structural, not bad luck**. The repo-wide rule master landed at 10:09 ET
(`58dea4d88`) bars pushes to master Mon-Fri 09:00-16:00 ET. That blocks the other workstream until
16:00 and unblocks it exactly when this increment's merge window opens (16:15-17:00). Both are
aimed at the same hour by construction.

Walked forward unfrozen, step 8's *"origin/master unchanged since step 4"* fails, lap 2 burns, and
the **third lap is a STOP** — Increment 3 does not ship.

⛔ **The owner has been asked to freeze the notebook/Wave Q1 session's master pushes ~16:05-17:00
ET.** He did this once before, for 40 minutes, and it worked. If the freeze is NOT in place at
15:50, do not burn both laps discovering that: say so and hold for the pre-09:00 window instead.
A day's delay costs less than a stopped merge plus two wasted gate cycles.

### Load-sensitive names — re-run ALONE before classifying

- `iframeFocusBlindSpot.test.jsx > useKeyboardVisible has a consumer OUTSIDE the hub, ...`
  (Increment 4's, Stream E). **18,585 ms under the full hub suite; 4,349 ms passing alone.** It
  walks the filesystem for consumers, so it is timing-bound, not logic-bound. ⛔ Never bank it —
  a banked slot is one a real failure can occupy unnoticed.
- The two already recorded under the baseline's `prior_base` key.

### Open owner decisions blocking or shaping this deploy

1. **Does the fan-parity fix ride tonight?** Three of Home's seven bubbles navigate somewhere other
   than their label, live in production. `registry.js` and `useJoystick.js` on this branch are
   **byte-identical to the deployed commit**, so this merge ships the defect untouched. The fix is
   one memo + one mutation-proved rail, already on Increment 4 (`0a740618b`). `HubRoot.jsx` is
   already this branch's declared product surface, so it adds no new surface. Cherry-picking is
   safe: Increment 4 contains all of Increment 3 by patch-id, so the fix dedups on its next rebase.
2. **Home's chip promises a tap that does nothing** — `tapHint: 'tap: last section'` with no
   controller for `home` in production. Not fixed; needs a ruling.
3. **Spec §C3:888 contradicts plan §3.8:330** on BOTH Home's tap and its scrub. One should be
   struck. The plan's *"already true in the preview"* is false — no mode has ever declared `onTap`
   in the registry; tap comes from section controllers.

## Rulings this increment is built under

- **R-A (AMENDED 2026-09-10 after H1)** — Increment 3 = **B7 rule-12 rail + B8 §8 analytics marker
  + B9 §8 auto-hide + docs**. **3.7 Notebook is OUT**, deferred to Increment 4 and gated on the
  notebook side adding a card identity attribute (see *Blocked on the notebook side* below).
  The original R-A read "3.7 Notebook + #1 + #2"; #1 and #2 shipped, 3.7 did not.
- **R-B** — The real-glass bugs are **not blocking**. Filed in `requests.md` verbatim when they
  arrive.
- **R-C** — Calendar is a **§6 omission, not a §7 error**. §7 declares the mode and C3 has the
  section with three registry actions, so the mode exists; the build order simply did not list it.
  §6 is amended to add calendar after 3.8 Home. **It stays dark until its own increment.**
- **R-D** — Phase 4 settings UI (#11) is **deferred, not rejected**. If the filed bugs turn out to
  be gesture-timing, #11 becomes Increment 4 and the bugs become tuning defaults rather than
  defects.

## Real-glass, Increment 2

> Real-glass D4/D1 performed; owner reports the hub works on glass but is buggy; bug details
> pending; **no write-without-sheet observed or reported.**

## ⛔ RULE 12 — PATHS THIS BRANCH MUST NOT TOUCH

The notebook workstream is in a **2026-09-10 → 2026-09-17 observation window** and pushes to master
many times a day. This branch integrates through the URL contract **as it exists today**.

    app/src/pages/journal-2-0/**
    app/src/pages/journal-2-0/tabs/NotebookTab.jsx

If the seam needs a change on the notebook side: **STOP and report.** The owner takes it to that
workstream. A rail fails the branch if any file under those paths appears in the diff against
master.

## ⛔ RULE 13 — REBASE EARLY AND OFTEN

Master moves faster than one gate cycle (Increment 2 cost four rebases and two lost laps). Rebase
daily, or whenever more than five behind — not just at merge. One backup ref per rebase,
`refs/backup/pre-rebase-inc3[-N]`.

## Open items carried forward from Increment 2

- **real-glass bug details** from the owner's run (R-B) — to be filed verbatim in `requests.md`
- **deferred docs/manifest push to master** — the Increment 2 master-gate manifest is not in the
  tree. Every master push rebuilds web, docs-only included: `f321e5e7b` changed three files under
  `docs/` and web deployed on it (SUCCESS 2026-09-10T04:54:32Z).
- **merge `fix/deploy-watch-probe`** (`245102b1c`, pushed) — next intentional deploy, outside
  09:00–16:00 ET
- R-13 — `scan.scans` ships ABSENT (Screener shell has no open seam)
- R-15 — the Screener cursor is invisible (no row painted `data-hub-cursor`)
- transitive-dataflow rail
- `HubActionsButton` haptic on the WCAG path
- `scan.flag` §C2 exception
- CI device job
- iOS visual escalation (iOS Safari exposes no `navigator.vibrate`)
- `require.main` guard on the device runner (requiring `tests/run.js` RUNS the matrix)
- BrowserStack Automate quota (Live != Automate)
- server-side validation of preference keys — `POST /api/auth/preferences` accepts any
  `{key, value}`, so B6 is an exposure default, not a security boundary
- D-35 / R-14 — `HubConfirmPayload.fields` unreachable; confirm actions have no steppers
- **Increment 3 core remainder, NOT in this increment:** 3.5 Chart (needs a 3.5a scout), 3.6
  Catalysts (needs a 3.6a scout — the Wave 0 state is gone), 3.8 Home scrub, 3.9 Flow verify,
  Calendar (per R-C), Phase 4 settings UI (per R-D)

## The gate

⛔ Never hand-roll the shard loop — `python scripts/gate_shards.py` is committed and its own rails
exist. The baseline is `docs/plans/joystick/gate-baseline.json`; load-sensitive names are re-run
ALONE before classifying, and a timeout is never banked.

## DECISIONS — R-auto-N (autonomy charter)

- **R-auto-1 — §8's "the registry's `fire()` path" reads as `HubRoot.runAction`.**
  Taken: place the one marker at `HubRoot.jsx:108`. Rejected: inventing a `fire()` in
  `registry.js` to match the sentence. Why: `registry.js` is data plus a validator and has never
  had a `fire()`; dispatch has always lived in `runAction`, which is the one point BOTH doors (a
  gesture, and the Peek sheet) pass through exactly once. Code over stale wording; the plan's
  sentence is corrected in the docs commit.

- **R-auto-2 — `contenteditable` is detected by property AND attribute.**
  Taken: `isContentEditable || closest('[contenteditable]')` with a `!== 'false'` check. Rejected:
  the property alone. Why: `isContentEditable` is the correct question in a browser because it
  accounts for inherited editability, but **jsdom does not implement it**, so a property-only check
  reported `false` for the Notebook's own editor in the only environment the suite ever runs in.

- **R-auto-3 — the rule-12 rail checks the committed diff AND the working tree.**
  Taken: both. Rejected: committed-only (the literal reading of the ruling). Why: committed-only
  catches a violation at review time rather than when it is made, and it also makes the rail's own
  mutation proof require a throwaway commit to unwind.

- **R-auto-4 — the analytics rail excludes test files and assembles its own literal.**
  Taken: both. Rejected: a plain scan. Why: the first version found THREE markers — the real one
  plus its own docstring and its own constant — and failed on its own text
  (`lesson_a_search_over_sources_counts_the_searcher`).

- **R-auto-5 — `useKeyboardVisible` stays alongside the new focus hook.**
  Taken: OR them. Rejected: replacing the viewport heuristic. Why: a soft keyboard can cover the pad
  when focus is somewhere the focus hook cannot see (a cross-origin iframe); and the focus hook
  covers the three cases the viewport hook structurally cannot (no `visualViewport`, a hardware
  keyboard, a contenteditable that raises nothing). Neither substitutes for the other.

- **R-auto-6 — B10/B11 STOPPED under H1.** See the hard stop below. No decision taken; the work
  cannot proceed as ruled without a change on the notebook side.

## ⛔ HARD STOP H1 — raised 2026-09-10, B10

The Notebook cannot be wired as ruled without editing a rule-12 path. Two independent blockers:

1. **Mount point.** Every section controller is page-mounted — `wireSection` from
   `pages/MorningWire.jsx`, `breadthSection` from `pages/Breadth.jsx`, `screenerSection` from
   `pages/screener/shell/ScannerShell.jsx`, `journalSection` from
   `pages/journal-2-0/tabs/OpenPositionsTab.jsx`. The Notebook's page is `NotebookTab.jsx`, which
   rule 12 forbids. A hub-side mount avoids that file, but does not solve (2).

2. **No note identity in the DOM.** `NoteCard.jsx` renders `<div className={styles.card}>` with no
   `data-note-id`, no `href`, and no test id. The only per-note identity is `key={n.id}` at
   `NotebookTab.jsx:848` — a React key, which does not render. The one `data-note-id` in the
   codebase (`lib/noteLinkNode.jsx:36-37`) is TipTap's inline note-LINK node inside a note body,
   not a grid card.

   So the hub can PAINT a cursor over cards (`paintCursor`, the Wire precedent) but cannot learn
   which note a card is — and Q1/Q2 rule that selection writes `?note=<id>` through
   `applyTargetToParams`. `useHubCursor` also REQUIRES an explicit identity key.

**Smallest notebook-side change that unblocks it:** one attribute on the card root —
`data-note-id={note.id}` in `NoteCard.jsx`. That is additive, renders nothing visible, and gives
the hub both the identity and the selector Q4's rail needs.

- **R-auto-7 — no B10 work to revert.** Taken: nothing. Why: B10 never produced a file. The scout
  was read-only, and the mount/identity blocker surfaced before any controller, registry edit,
  `PREVIEW_MODES` flip or manifest change was written. Verified: `git diff febe8ee67..HEAD` touches
  `registry.js` by **zero lines**, and the working tree is clean. The five notebook actions,
  `PREVIEW_MODES` and `linkTicker` are exactly as they are on master. **H1: no card identity in
  the DOM.**

## ⛔ BLOCKED ON THE NOTEBOOK SIDE — what Increment 4 needs

**One additive attribute on `NoteCard`'s root, carrying the note id:**

    data-note-card-id={note.id}

⛔ **NOT `data-note-id`.** That name is already taken by TipTap's inline note-LINK node inside note
bodies (`app/src/pages/journal-2-0/lib/noteLinkNode.jsx:36-37`, which renders
`{ 'data-note-id': attrs.noteId }` and parses `span[data-note-id]`). A hub selector on
`[data-note-id]` would match every inline link in an open note as well as every grid card — the Q4
selector would be ambiguous the day it was written, and it would silently over-count on exactly the
screen where the cursor matters most.

**Why it is needed.** `NoteCard.jsx` renders `<div className={styles.card}>` with no id-bearing
attribute; the only per-note identity is `key={n.id}` at `NotebookTab.jsx:848`, and a React key
does not render into the DOM. The hub can PAINT a cursor over cards (`useHubCursor.paintCursor`,
the Morning Wire precedent for markup the hub does not own) but cannot learn WHICH note a card is —
and the rulings require selection to write `?note=<id>` through `applyTargetToParams`, while
`useHubCursor` requires an explicit identity key. Rejected workarounds: deriving identity from card
title text (needs a hub-side fetch of the notebook's own list to map back to an id — a second
authority, and titles are not unique); dispatching a synthetic click on the card (works, but
bypasses `applyTargetToParams`, which is the thing Q2 exists to guarantee).

## The 3.7a scout — STILL VALID, Increment 4 starts from it

Verified 2026-09-10, all quoted from the tree at `febe8ee67`:

- **The read** is `NotebookTab.jsx:62-63` — `const [searchParams, setSearchParams] = useSearchParams()`
  / `const noteId = searchParams.get('note')`. Param name `note`, a raw string id; absent or unknown
  is not handled at the read site (`noteId` is simply `null`).
- **`clearNoteParam`** is `NotebookTab.jsx:365-369`, `{ replace: false }` → **push**. It fires when a
  folder or tag is chosen from the sidebar while a note is open. `closeNote` (`:352-361`) is a
  different function with the same shape plus three refreshes. Four `note` writers in that file:
  `:340` set, `:355`/`:367`/`:387` delete.
- **The seam is `applyTargetToParams(params, target)`** (`journal-2-0/lib/searchNavigation.js:86`),
  a pure exported builder that DELETES `PARAM_DOC`/`PARAM_PAGE`/`PARAM_EXCERPT`/`PARAM_REVIEW`
  before setting `PARAM_NOTE`. Hand-rolling `params.set('note', id)` would leave a stale
  `?doc=&page=47` pointing into a different note.
- **Other readers**: `journal-2-0/lib/captureContext.js:26` (`noteIdFromLocation`), `j2tabRedirect`
  preserves the param, plus tests.
- **The five actions** (`registry.js:393-447`): `newNote`/`linkTicker`/`templates` are `kind:'run'`
  with no run body; `dailyPlan`/`postMortem` are `kind:'navigate'` to `?new=daily-prep` and
  `?new=trade-review`, both **stable template keys** (`lib/notebookTemplates.js:19`), so those two
  already work with no controller.
- **Rulings Q1-Q8 stand**: push; use `applyTargetToParams`; `newNote`+`templates` write and the B4
  manifest grows by one `POST /api/j2/notes`, `owner:'app'`, via `lib/noteCreation.js`;
  `linkTicker` deferred (no symbol source on the route); `paintCursor` accepted with a selector
  rail; no off-route guard, a rail instead; Home needs nothing; flip `PREVIEW_MODES` at the end.


- **R-auto-8 — the sandbox booted against the WRONG data dir, and the boot's own log caught it.**
  `--data-dir C:\data-hubtest` passed through bash lost its separator and became the drive-relative
  `C:data-hubtest`, which Windows resolved to a NEW empty directory **inside the worktree**. The
  integrity log said so in its first line (`sandbox = ...\uct-worktrees\joystick-inc3\data-hubtest`)
  — the standing rule that the snapshot-compare is reported BEFORE any health check is what
  surfaced it, because `/api/health` answered 200 the whole time and the sandbox looked perfectly
  healthy. Taken: stop the process, delete the stray directory (untracked, and it would have
  dirtied the tree for the gate), re-boot with `C:/data-hubtest`. Rejected: trusting a healthy-
  looking boot. ⭐ "Reports clean" is never evidence of "wrote where you meant."

- **R-auto-9 — the member-impact sentence was wrong, and the evidence is what corrected it.**
  The draft said the pad "now hides while a text field has focus on browsers without
  `visualViewport`, where it previously never did." That is **false**: `useHubActive.js:81` returns
  false when `window.visualViewport` is undefined, so on those browsers **the hub never mounts at
  all** — there is no pad to hide. Emulated row B pins that floor in both engines. The real change
  is narrower, and row A's control measures it: the pad now hides on FOCUS even when the viewport
  never moves — a hardware keyboard, a split/floating keyboard, focus while the keyboard is already
  open, and every touch-emulated browser. Taken: correct the paragraph. Rejected: shipping the
  drafted sentence.

- **R-auto-10 — a fresh sandbox admin rather than a password reset.** `hubtest@local.dev` exists in
  the sandbox DB with an unknown password, and `ADMIN_EMAILS` follows `--test-email`
  (`hub_sandbox_boot.py:280`). Taken: re-boot with `--test-email inc3admin@local.dev` and sign that
  account up fresh (`role: admin` confirmed in the signup response). Rejected: hand-writing a
  password hash into the sandbox DB — more invasive, and it would leave the sandbox in a state no
  script produces.

- **R-auto-11 — the fold-in merge became a linear commit through the rebase.** `git rebase` drops
  merge commits and replays their content, so `merge: fold in fix/deploy-watch-probe` became the
  plain commit `dfbae9517` carrying `scripts/deploy_watch.py` + `tests/test_deploy_watch.py`.
  Taken: accept the flattening. Rejected: `--rebase-merges` to preserve the merge topology. Why: a
  feature branch with a merge commit inside it buys nothing here — the content is identical by name
  (21 files, `diff` of the pre/post file lists empty) and a linear branch is easier to reason about
  at merge time. Verified the two watcher files survived.

- **R-auto-12 — rebased onto `4c518db97` at 10:0x ET rather than waiting for the window.** Master
  moved 11 commits (the charts drawing layer, Phases 0-10) while Increment 3 was being gated, which
  trips rule 13's ">5 behind". Overlap with this branch is EMPTY and no watched hub file is touched;
  master's one journal-2-0 change (`NoteEditorPage.jsx`) sits in the BASE after the rebase, so the
  rule-12 rail stays green — verified, 3 passed. Taken: rebase now. Rejected: waiting until 15:50.
  Why: rule 13 exists precisely so the window is not spent doing a big-bang rebase, and master's
  15 new test files move the gate population, which the window gate must measure anyway.
